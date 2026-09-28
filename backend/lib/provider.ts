import { APICallError, NoObjectGeneratedError, RetryError, type LanguageModel } from 'ai';
import { resolveModelChain, type ModelCandidate } from '@/lib/model';
import { isExhaustedForTheDay, withBackoff, type BackoffOptions } from '@/lib/backoff';

/**
 * Budget for the whole chain — deliberately under a minute.
 *
 * `maxDuration` is 300s and the iOS client waits 120s, but neither is the real
 * limit: measured 25 Sep 2026, requests that ran past ~60s had the connection
 * cut before they answered (three drops at 60.41s, 60.37s, 60.37s), while every
 * request that finished inside a minute arrived. Not an absolute cap — some
 * longer responses did land earlier in the day — but long enough odds that a
 * budget over 60s mostly buys the seller a network error instead of an answer.
 *
 * So: answer within the minute. Falling through to the next model is what
 * actually rescues a free-tier refusal, and that's fast — a spent quota rejects
 * in about a second. Waiting longer per model was never what helped.
 */
const DEFAULT_BUDGET_MS = 50_000;

/**
 * Hard ceiling on a single provider call.
 *
 * Without this the budget was advisory only: it gates whether to *start* another
 * attempt and can't interrupt one already in flight, and `generateText` has no
 * timeout of its own. On 25 Sep 2026 a `gemini-3.5-flash` call simply never came
 * back and the request sat there until `Vercel Runtime Timeout Error: Task timed
 * out after 300 seconds` — a 45s budget notwithstanding.
 *
 * Sized from what real generations take — and that moves when the schema does.
 * At 25s this was fine for the original response; adding `marketFit` (a ranking
 * and a price range per platform) pushed generation past it and the timeout
 * started firing on healthy calls. Re-measure this after any schema change that
 * makes the model write appreciably more.
 */
const PER_CALL_TIMEOUT_MS = 35_000;

/** A call we abandoned ourselves, via the per-call timeout. */
function isAbort(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

export interface ProviderRunOptions extends Pick<BackoffOptions, 'delaysMs' | 'sleep' | 'now'> {
  budgetMs?: number;
  /** Hard ceiling per provider call. Lowered in tests. */
  perCallTimeoutMs?: number;
  /** Prefix for log lines, e.g. 'generate'. */
  label?: string;
  /** Injectable for tests; defaults to the configured chain. */
  candidates?: ModelCandidate[];
}

/**
 * Whether to give the *next* provider a go, as opposed to giving up.
 *
 * Anything the provider itself rejected is worth trying elsewhere — capacity,
 * a spent quota, a retired model id, a bad key. A plain `Error` is ours (a
 * thrown TypeError, a bug in the prompt building), and the next provider would
 * fail the same way for real money, so those stop here.
 *
 * A schema miss counts as the provider's: the model answered but the answer
 * didn't fit `generateResultSchema`, which is sampling luck as much as anything.
 * Another model is a fair bet, and on the free chain it costs nothing. Before
 * this was included, one such miss failed the request outright — no retry, no
 * fallthrough — which is how a two-character-too-long eBay title became a 500.
 */
function isProviderFailure(error: unknown): boolean {
  return (
    APICallError.isInstance(error) ||
    RetryError.isInstance(error) ||
    NoObjectGeneratedError.isInstance(error) ||
    // A model that stopped responding is the provider's problem too, and the
    // next one deserves the remaining time.
    isAbort(error)
  );
}

/**
 * Runs `invoke` against the configured providers in order, retrying transient
 * failures within each before moving on. Falls through on anything the provider
 * rejected, so a free tier that is out of capacity or out of quota costs one
 * fast failure rather than the whole request.
 *
 * The time budget is shared: each provider gets an equal slice of what's left,
 * and the last one gets the remainder. That way an instant quota rejection from
 * the free tier hands almost the entire budget to the paid fallback, while a
 * slow overload can't consume the budget and leave the fallback no room.
 *
 * Re-throws the last provider's error, so `/api/generate` still sees a real
 * provider message. With one provider configured — production today — that is
 * the only error there was.
 */
export async function runWithProviders<T>(
  invoke: (model: LanguageModel, signal: AbortSignal) => Promise<T>,
  options: ProviderRunOptions = {},
): Promise<T> {
  const {
    budgetMs = DEFAULT_BUDGET_MS,
    perCallTimeoutMs = PER_CALL_TIMEOUT_MS,
    label = 'provider',
    candidates = resolveModelChain(),
    delaysMs,
    sleep,
    now = () => Date.now(),
  } = options;

  if (candidates.length === 0) {
    throw new Error('No AI provider configured. Set GOOGLE_GENERATIVE_AI_API_KEY or ANTHROPIC_API_KEY.');
  }

  const startedAt = now();
  let lastError: unknown;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const remaining = budgetMs - (now() - startedAt);
    if (remaining <= 0) break;

    const isLast = index === candidates.length - 1;
    const slice = isLast ? remaining : Math.floor(remaining / (candidates.length - index));

    if (index > 0) {
      console.warn(
        `${label}: falling back to ${candidate.label}${candidate.paid ? ' (paid)' : ''} —`,
        lastError instanceof Error ? lastError.message : lastError,
      );
    }

    const callTimeoutMs = Math.min(slice, perCallTimeoutMs);

    try {
      // A fresh signal per attempt, so one slow call can't doom the retry.
      return await withBackoff(() => invoke(candidate.model, AbortSignal.timeout(callTimeoutMs)), {
        budgetMs: slice,
        delaysMs,
        sleep,
        now,
        onRetry: ({ attempt, waitMs, error }) =>
          console.warn(
            `${label}: ${candidate.label} busy, retry ${attempt} in ${waitMs}ms —`,
            error instanceof Error ? error.message : error,
          ),
      });
    } catch (error) {
      lastError = error;
      if (!isProviderFailure(error)) throw error;

      if (isLast) throw error;
      if (isExhaustedForTheDay(error)) {
        console.warn(`${label}: ${candidate.label} is out of quota for today`);
      }
    }
  }

  throw lastError;
}
