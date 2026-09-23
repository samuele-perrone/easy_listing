import { APICallError, RetryError, type LanguageModel } from 'ai';
import { resolveModelChain, type ModelCandidate } from '@/lib/model';
import { isExhaustedForTheDay, withBackoff, type BackoffOptions } from '@/lib/backoff';

/**
 * Budget for the whole chain. Bounded by the *client*, not by `maxDuration`:
 * the iOS app gives up after 120s (`APIClient.generateListings`), so a longer
 * budget here just turns a clear error into a timeout on the phone.
 */
const DEFAULT_BUDGET_MS = 100_000;

export interface ProviderRunOptions extends Pick<BackoffOptions, 'delaysMs' | 'sleep' | 'now'> {
  budgetMs?: number;
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
 */
function isProviderFailure(error: unknown): boolean {
  return APICallError.isInstance(error) || RetryError.isInstance(error);
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
  invoke: (model: LanguageModel) => Promise<T>,
  options: ProviderRunOptions = {},
): Promise<T> {
  const {
    budgetMs = DEFAULT_BUDGET_MS,
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

    try {
      return await withBackoff(() => invoke(candidate.model), {
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
