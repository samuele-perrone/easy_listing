import { APICallError, RetryError } from 'ai';

/**
 * Free-tier Gemini has no capacity guarantee: it answers "This model is
 * currently experiencing high demand" under load. The AI SDK retries such a
 * call three times of its own accord, but all three land within a few seconds,
 * which is far too short a window to ride out an overload — measured 23 Sep
 * 2026, 2 of 3 live requests failed that way.
 *
 * So the model calls pass `maxRetries: 0` and come through here instead, which
 * spaces the attempts out properly.
 *
 * Callers set the real budget (see `lib/provider.ts`, which keeps the whole
 * chain under a minute because longer requests tend to lose the connection
 * before they answer). These defaults only apply if nobody says otherwise.
 */
const DEFAULT_BUDGET_MS = 45_000;

/**
 * Waits between attempts, growing so a longer outage gets a longer pause —
 * but the whole ladder still fits inside the budget alongside the calls it
 * separates, which is why it stops at 15s rather than carrying on to 30s.
 */
const DEFAULT_DELAYS_MS = [2_000, 6_000, 15_000];

export interface BackoffOptions {
  /** Give up once this much time has elapsed. Never exceed the client timeout. */
  budgetMs?: number;
  delaysMs?: number[];
  /** Injected so tests don't actually wait. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onRetry?: (info: { attempt: number; waitMs: number; error: unknown }) => void;
}

/**
 * A daily cap can't clear inside a request. Gemini's free tier allows 20
 * generations per project per day (`GenerateRequestsPerDayPerProjectPerModel-
 * FreeTier`), and returns 429 for that exactly as it does for a per-minute
 * rate limit — but only the per-minute one is worth waiting for. The quota id
 * is in the response body, not the message, so look there.
 *
 * Google still sends a `retryDelay` (32s observed) with a per-day rejection.
 * It's misleading: the quota resets at midnight Pacific, not in 32 seconds.
 */
export function isExhaustedForTheDay(error: unknown): boolean {
  if (RetryError.isInstance(error)) {
    return error.errors.some(isExhaustedForTheDay);
  }
  if (!APICallError.isInstance(error)) return false;
  const body = typeof error.responseBody === 'string' ? error.responseBody : '';
  return /PerDay/i.test(body);
}

/**
 * Whether an error is worth waiting out. Capacity blips and per-minute rate
 * limits are; a bad model id, a rejected key, or a spent daily quota is not —
 * retrying those just burns the budget and delays the 500 the caller is going
 * to get anyway. (A retired Gemini id returns a non-retryable 404, which is how
 * one real outage presented; a spent daily quota returns a *retryable-looking*
 * 429, which is how the next one did.)
 */
export function isTransient(error: unknown): boolean {
  // The SDK's own retries wrap the last failure in a RetryError.
  if (RetryError.isInstance(error)) {
    return error.errors.length > 0 && isTransient(error.errors[error.errors.length - 1]);
  }

  if (!APICallError.isInstance(error)) return false;
  if (isExhaustedForTheDay(error)) return false;
  if (error.isRetryable) return true;

  // Providers aren't consistent about setting isRetryable on overloads.
  const status = error.statusCode;
  if (status === 429 || status === 408 || (status !== undefined && status >= 500)) return true;
  return /high demand|overloaded|try again later|capacity/i.test(error.message);
}

/**
 * Runs `attempt`, retrying transient provider failures with growing pauses
 * until the budget runs out. Re-throws the last error, so the caller still sees
 * the real provider message.
 */
export async function withBackoff<T>(
  attempt: () => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const {
    budgetMs = DEFAULT_BUDGET_MS,
    delaysMs = DEFAULT_DELAYS_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = () => Date.now(),
    onRetry,
  } = options;

  const startedAt = now();
  let lastError: unknown;

  for (let tryIndex = 0; ; tryIndex += 1) {
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
      if (!isTransient(error) || tryIndex >= delaysMs.length) throw error;

      // Jitter keeps a retry storm from synchronising across requests.
      const base = delaysMs[tryIndex];
      const waitMs = Math.round(base * (0.8 + Math.random() * 0.4));

      // Only wait if the next attempt can still finish inside the budget.
      const elapsed = now() - startedAt;
      if (elapsed + waitMs >= budgetMs) throw error;

      onRetry?.({ attempt: tryIndex + 1, waitMs, error });
      await sleep(waitMs);
    }
  }

  // Unreachable: the loop either returns or throws.
  throw lastError;
}
