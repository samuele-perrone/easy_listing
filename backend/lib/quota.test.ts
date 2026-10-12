/**
 * The monthly allowance and the global circuit breaker.
 *
 * These two refusals have to read differently, and that is the point of the
 * tests below: the allowance is the seller's own and has a number attached; the
 * ceiling is ours and is never their fault.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ list: vi.fn(), put: vi.fn() }));
vi.mock('@vercel/blob', () => ({ list: mocks.list, put: mocks.put }));

import { checkUsage, isUncapped, normaliseAccountKey, quotaFor, recordUsage } from './usage';

const ACCOUNT = { key: 'apple-sub-1', email: 'seller@example.com' };

/** Counts are read by prefix, so the stub answers per prefix. */
function counts({ account = 0, global = 0 }: { account?: number; global?: number }) {
  mocks.list.mockImplementation(async ({ prefix }: { prefix: string }) => ({
    blobs: new Array(prefix.startsWith('accounts/') ? account : global).fill({}),
  }));
}

let original: NodeJS.ProcessEnv;

beforeEach(() => {
  original = { ...process.env };
  delete process.env.UNLIMITED_ACCOUNTS;
  delete process.env.ALLOWED_EMAILS;
  process.env.FREE_LISTINGS_PER_MONTH = '10';
  process.env.DAILY_LIMIT_TOTAL = '200';
  mocks.list.mockReset();
  mocks.put.mockReset().mockResolvedValue({});
});

afterEach(() => {
  process.env = original;
});

describe('the monthly allowance', () => {
  it('allows a seller under their limit, and says where they are', async () => {
    counts({ account: 3 });
    await expect(checkUsage(ACCOUNT)).resolves.toMatchObject({ allowed: true, used: 3, limit: 10 });
  });

  it('refuses at the limit, with a number and a reset the seller can plan around', async () => {
    counts({ account: 10 });
    const decision = await checkUsage(ACCOUNT);
    expect(decision.allowed).toBe(false);
    expect(decision.error).toContain('10 free listings this month');
    expect(decision.fix).toContain('resets on the 1st');
  });

  it('does not refuse one short of the limit', async () => {
    counts({ account: 9 });
    await expect(checkUsage(ACCOUNT)).resolves.toMatchObject({ allowed: true });
  });

  it('uncaps the accounts named in the env, and reports no limit', async () => {
    process.env.UNLIMITED_ACCOUNTS = 'seller@example.com';
    counts({ account: 500 });
    await expect(checkUsage(ACCOUNT)).resolves.toMatchObject({ allowed: true, limit: null });
    await expect(quotaFor(ACCOUNT)).resolves.toEqual({ used: 0, limit: null });
  });

  it('still reads the old ALLOWED_EMAILS name', async () => {
    process.env.ALLOWED_EMAILS = 'seller@example.com';
    expect(isUncapped('seller@example.com')).toBe(true);
    expect(isUncapped('someone@else.com')).toBe(false);
  });
});

describe('the global circuit breaker', () => {
  it('refuses in our own voice, not the seller’s fault', async () => {
    counts({ account: 0, global: 200 });
    const decision = await checkUsage(ACCOUNT);
    expect(decision.allowed).toBe(false);
    expect(decision.error).toContain('over capacity');
    expect(decision.fix).toContain('not yours');
    // It must not look like the seller spent an allowance they still have.
    expect(decision.error).not.toContain('your');
  });

  it('takes precedence over an allowance that is also spent', async () => {
    counts({ account: 10, global: 200 });
    await expect(checkUsage(ACCOUNT)).resolves.toMatchObject({ allowed: false });
  });
});

describe('recording a generation', () => {
  it('writes one marker against the account and one against the day', async () => {
    await recordUsage(ACCOUNT);
    const paths = mocks.put.mock.calls.map((c) => c[0] as string);
    expect(paths).toHaveLength(2);
    expect(paths.some((p) => p.startsWith('accounts/') && p.includes('apple-sub-1'))).toBe(true);
    expect(paths.some((p) => p.startsWith('usage/'))).toBe(true);
  });
});

describe('normaliseAccountKey', () => {
  it('cannot escape its prefix', () => {
    expect(normaliseAccountKey('../../etc')).not.toContain('/');
    expect(normaliseAccountKey('../../etc')).not.toContain('.');
  });

  it('clamps length and never returns empty', () => {
    expect(normaliseAccountKey('x'.repeat(300))).toHaveLength(64);
    expect(normaliseAccountKey('///')).toBe('unknown');
  });
});
