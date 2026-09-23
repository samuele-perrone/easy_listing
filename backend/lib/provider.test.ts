import { afterEach, describe, expect, it, vi } from 'vitest';
import { APICallError } from 'ai';
import type { LanguageModel } from 'ai';
import { runWithProviders } from './provider';
import { resolveModelChain } from './model';
import type { ModelCandidate } from './model';

function apiError(overrides: Partial<{ message: string; statusCode: number; isRetryable: boolean; responseBody: string }>) {
  return new APICallError({
    message: overrides.message ?? 'boom',
    url: 'https://example.invalid/generate',
    requestBodyValues: {},
    statusCode: overrides.statusCode,
    isRetryable: overrides.isRetryable,
    responseBody: overrides.responseBody,
  });
}

const OVERLOADED = apiError({
  message: 'This model is currently experiencing high demand.',
  statusCode: 503,
  isRetryable: true,
});

/** The free tier's 20/day wall: a 429 that no amount of waiting clears. */
const QUOTA_SPENT = apiError({
  message: 'You exceeded your current quota',
  statusCode: 429,
  isRetryable: true,
  responseBody: JSON.stringify({
    error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] },
  }),
});

const FREE: ModelCandidate = { label: 'google:test', model: 'google:test' as LanguageModel, paid: false };
const PAID: ModelCandidate = { label: 'anthropic:test', model: 'anthropic:test' as LanguageModel, paid: true };

/** Never actually waits; advances a hand-driven clock instead. */
function controlled(overrides = {}) {
  const waited: number[] = [];
  let clock = 0;
  return {
    waited,
    options: {
      candidates: [FREE, PAID],
      sleep: async (ms: number) => {
        waited.push(ms);
        clock += ms;
      },
      now: () => clock,
      ...overrides,
    },
  };
}

describe('resolveModelChain', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('puts the free provider first, so the paid key is only a safety net', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    process.env.ANTHROPIC_API_KEY = 'a';

    const chain = resolveModelChain();
    expect(chain.map((c) => c.paid)).toEqual([false, true]);
    expect(chain[0].label).toContain('google');
    expect(chain[1].label).toContain('anthropic');
  });

  it('is a single provider when only one key is set', () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'g';
    expect(resolveModelChain()).toHaveLength(1);
  });

  it('falls back to the gateway only when no direct key exists', () => {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const chain = resolveModelChain();
    expect(chain).toHaveLength(1);
    expect(chain[0].label).toContain('gateway');
  });

  it('never leaks a key into a label', () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'secret-google-key';
    process.env.ANTHROPIC_API_KEY = 'secret-anthropic-key';

    for (const candidate of resolveModelChain()) {
      expect(candidate.label).not.toContain('secret');
    }
  });
});

describe('runWithProviders', () => {
  it('uses the free provider alone when it works', async () => {
    const { options } = controlled();
    const invoke = vi.fn().mockResolvedValue('listing');

    await expect(runWithProviders(invoke, options)).resolves.toBe('listing');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(FREE.model);
  });

  it('falls through to the paid key when the free quota is spent', async () => {
    const { options } = controlled();
    const invoke = vi.fn(async (model: LanguageModel) => {
      if (model === FREE.model) throw QUOTA_SPENT;
      return 'listing';
    });

    await expect(runWithProviders(invoke, options)).resolves.toBe('listing');
    expect(invoke).toHaveBeenNthCalledWith(1, FREE.model);
    expect(invoke).toHaveBeenNthCalledWith(2, PAID.model);
  });

  it('spends no time on the free tier before falling back on a spent quota', async () => {
    // The daily cap is terminal, so it must not eat the budget with retries.
    const { waited, options } = controlled();
    const invoke = vi.fn(async (model: LanguageModel) => {
      if (model === FREE.model) throw QUOTA_SPENT;
      return 'listing';
    });

    await runWithProviders(invoke, options);
    expect(waited).toEqual([]);
  });

  it('retries a transient failure on the free tier before paying for a fallback', async () => {
    const { options } = controlled();
    const invoke = vi
      .fn()
      .mockRejectedValueOnce(OVERLOADED)
      .mockResolvedValue('listing');

    await expect(runWithProviders(invoke, options)).resolves.toBe('listing');
    // Both calls went to the free provider — no paid call was made.
    expect(invoke.mock.calls.every(([model]) => model === FREE.model)).toBe(true);
  });

  it('leaves the paid fallback room when the free tier is slow to fail', async () => {
    const { options } = controlled({ budgetMs: 60_000 });
    const invoke = vi.fn(async (model: LanguageModel) => {
      if (model === FREE.model) throw OVERLOADED;
      return 'listing';
    });

    await expect(runWithProviders(invoke, options)).resolves.toBe('listing');
    const paidCalls = invoke.mock.calls.filter(([model]) => model === PAID.model);
    expect(paidCalls).toHaveLength(1);
  });

  it('re-throws the last provider’s error when every provider fails', async () => {
    const { options } = controlled();
    const invoke = vi.fn(async (model: LanguageModel) => {
      throw model === FREE.model ? QUOTA_SPENT : OVERLOADED;
    });

    await expect(runWithProviders(invoke, options)).rejects.toBe(OVERLOADED);
  });

  it('does not pay to repeat a failure of our own making', async () => {
    // A bug in prompt building isn't the provider's fault; the paid key would
    // fail identically and bill for it.
    const { options } = controlled();
    const invoke = vi.fn().mockRejectedValue(new TypeError('images is not iterable'));

    await expect(runWithProviders(invoke, options)).rejects.toThrow(/not iterable/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reports when no provider is configured at all', async () => {
    const invoke = vi.fn();
    await expect(runWithProviders(invoke, { candidates: [] })).rejects.toThrow(/No AI provider configured/);
    expect(invoke).not.toHaveBeenCalled();
  });
});
