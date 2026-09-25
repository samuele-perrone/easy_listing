import { describe, expect, it, vi } from 'vitest';
import { APICallError, RetryError } from 'ai';
import { isTransient, withBackoff } from './backoff';

function apiError(
  overrides: Partial<{
    message: string;
    statusCode: number;
    isRetryable: boolean;
    responseBody: string;
  }>,
) {
  return new APICallError({
    message: overrides.message ?? 'boom',
    url: 'https://generativelanguage.googleapis.com/v1beta/models/x:generateContent',
    requestBodyValues: {},
    statusCode: overrides.statusCode,
    isRetryable: overrides.isRetryable,
    responseBody: overrides.responseBody,
  });
}

/** The real overload: what free-tier Gemini returned on 23 Sep 2026. */
const OVERLOADED = apiError({
  message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
  statusCode: 503,
  isRetryable: true,
});

/**
 * The real daily wall: Gemini's free tier allows 20 generations per project per
 * day. It arrives as a retryable-looking 429 with a 32s retryDelay, but nothing
 * clears it until the quota resets. Body trimmed to the fields that matter.
 */
const QUOTA_SPENT_FOR_TODAY = apiError({
  message: 'You exceeded your current quota, please check your plan and billing details.',
  statusCode: 429,
  isRetryable: true,
  responseBody: JSON.stringify({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          violations: [
            { quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' },
          ],
        },
        { retryDelay: '32s' },
      ],
    },
  }),
});

/** A per-minute rate limit, by contrast, does clear inside the budget. */
const RATE_LIMITED_THIS_MINUTE = apiError({
  message: 'You exceeded your current quota, please check your plan and billing details.',
  statusCode: 429,
  isRetryable: true,
  responseBody: JSON.stringify({
    error: {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          violations: [
            { quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier', quotaValue: '15' },
          ],
        },
      ],
    },
  }),
});

/** The real config failure: a retired model id. Retrying this is pointless. */
const RETIRED_MODEL = apiError({
  message: 'This model models/gemini-2.5-flash is no longer available to new users.',
  statusCode: 404,
  isRetryable: false,
});

/** Test doubles: never actually wait, and drive the clock by hand. */
function controlledOptions(overrides = {}) {
  const waited: number[] = [];
  let clock = 0;
  return {
    waited,
    options: {
      sleep: async (ms: number) => {
        waited.push(ms);
        clock += ms;
      },
      now: () => clock,
      ...overrides,
    },
  };
}

describe('isTransient', () => {
  it('retries a capacity failure', () => {
    expect(isTransient(OVERLOADED)).toBe(true);
  });

  it('retries an overload even when the provider omits isRetryable', () => {
    expect(isTransient(apiError({ message: 'The model is overloaded.' }))).toBe(true);
    expect(isTransient(apiError({ message: 'busy', statusCode: 429 }))).toBe(true);
    expect(isTransient(apiError({ message: 'oops', statusCode: 500 }))).toBe(true);
  });

  it('does not retry a retired model id', () => {
    // A 404 is a config error: waiting 30s changes nothing but the user's wait.
    expect(isTransient(RETIRED_MODEL)).toBe(false);
  });

  it('does not retry a spent daily quota, however retryable it claims to be', () => {
    // 429 + isRetryable: true + a 32s retryDelay, and still hopeless: the free
    // tier's 20/day doesn't come back until the quota resets.
    expect(isTransient(QUOTA_SPENT_FOR_TODAY)).toBe(false);
  });

  it('does retry a per-minute rate limit, which clears on its own', () => {
    expect(isTransient(RATE_LIMITED_THIS_MINUTE)).toBe(true);
  });

  it('does not retry a rejected key or a bad request', () => {
    expect(isTransient(apiError({ message: 'API key not valid', statusCode: 400 }))).toBe(false);
    expect(isTransient(apiError({ message: 'unauthorised', statusCode: 401 }))).toBe(false);
  });

  it('looks inside a RetryError at the failure that actually ended it', () => {
    const wrapped = new RetryError({
      message: 'Failed after 3 attempts',
      reason: 'maxRetriesExceeded',
      errors: [OVERLOADED, OVERLOADED],
    });
    expect(isTransient(wrapped)).toBe(true);

    const wrappedConfig = new RetryError({
      message: 'Failed after 1 attempt',
      reason: 'maxRetriesExceeded',
      errors: [RETIRED_MODEL],
    });
    expect(isTransient(wrappedConfig)).toBe(false);
  });

  it('ignores errors that are not provider calls at all', () => {
    expect(isTransient(new Error('type error in our own code'))).toBe(false);
    expect(isTransient(undefined)).toBe(false);
  });
});

describe('withBackoff', () => {
  it('returns the first success without waiting', async () => {
    const { waited, options } = controlledOptions();
    const attempt = vi.fn().mockResolvedValue('listing');

    await expect(withBackoff(attempt, options)).resolves.toBe('listing');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  it('rides out an overload and returns the eventual success', async () => {
    const { waited, options } = controlledOptions();
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(OVERLOADED)
      .mockRejectedValueOnce(OVERLOADED)
      .mockResolvedValue('listing');

    await expect(withBackoff(attempt, options)).resolves.toBe('listing');
    expect(attempt).toHaveBeenCalledTimes(3);
    expect(waited).toHaveLength(2);
  });

  it('waits longer each time, so a long outage gets a long pause', async () => {
    const { waited, options } = controlledOptions();
    const attempt = vi.fn().mockRejectedValue(OVERLOADED);

    await expect(withBackoff(attempt, options)).rejects.toThrow(/high demand/);
    // Jittered, so compare the trend rather than exact values. Three waits:
    // the ladder stops at 15s so the whole thing fits in the sub-minute budget.
    expect(waited).toHaveLength(3);
    for (let i = 1; i < waited.length; i += 1) {
      expect(waited[i]).toBeGreaterThan(waited[i - 1]);
    }
  });

  it('gives up immediately on a non-transient failure', async () => {
    const { waited, options } = controlledOptions();
    const attempt = vi.fn().mockRejectedValue(RETIRED_MODEL);

    await expect(withBackoff(attempt, options)).rejects.toThrow(/no longer available/);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  it('fails fast once the day’s quota is spent instead of stalling the app', async () => {
    // Before this was special-cased, a spent quota burned the whole budget and
    // the user waited ~90s for a failure that was certain from the first reply.
    const { waited, options } = controlledOptions();
    const attempt = vi.fn().mockRejectedValue(QUOTA_SPENT_FOR_TODAY);

    await expect(withBackoff(attempt, options)).rejects.toThrow(/exceeded your current quota/);
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([]);
  });

  it('re-throws the provider’s own error, so the log keeps the real cause', async () => {
    const { options } = controlledOptions();
    const attempt = vi.fn().mockRejectedValue(OVERLOADED);

    await expect(withBackoff(attempt, options)).rejects.toBe(OVERLOADED);
  });

  it('stops before a wait that would overrun the budget', async () => {
    // Budget only allows the first pause; the second would exceed it.
    const { waited, options } = controlledOptions({ budgetMs: 5_000 });
    const attempt = vi.fn().mockRejectedValue(OVERLOADED);

    await expect(withBackoff(attempt, options)).rejects.toThrow(/high demand/);
    expect(waited).toHaveLength(1);
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('never exceeds the budget even with a generous delay list', async () => {
    const { waited, options } = controlledOptions({
      budgetMs: 30_000,
      delaysMs: [5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000, 5_000],
    });
    const attempt = vi.fn().mockRejectedValue(OVERLOADED);

    await expect(withBackoff(attempt, options)).rejects.toThrow(/high demand/);
    const total = waited.reduce((sum, ms) => sum + ms, 0);
    expect(total).toBeLessThan(30_000);
  });

  it('reports each retry so the cause is visible in the logs', async () => {
    const onRetry = vi.fn();
    const { options } = controlledOptions({ onRetry });
    const attempt = vi.fn().mockRejectedValueOnce(OVERLOADED).mockResolvedValue('listing');

    await withBackoff(attempt, options);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({ attempt: 1, error: OVERLOADED });
  });
});
