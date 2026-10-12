/**
 * The generation gate and the monthly allowance.
 *
 * Two separate things, and the distinction is the point: being signed in is
 * what lets you in at all, and the quota is what bounds the cost. An
 * unauthorised call must do no *work* — no usage recorded, no job written, no
 * provider call — because generation can reach a paid model.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkUsage: vi.fn(),
  recordUsage: vi.fn(),
  writeJob: vi.fn(),
  generateListings: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock('@vercel/functions', () => ({ waitUntil: mocks.waitUntil }));
vi.mock('@/lib/generate', () => ({ generateListings: mocks.generateListings }));
vi.mock('@/lib/jobs', () => ({ newJobId: () => 'job-1', writeJob: mocks.writeJob }));
vi.mock('@/lib/usage', () => ({
  checkUsage: mocks.checkUsage,
  recordUsage: mocks.recordUsage,
  normaliseAccountKey: (raw: string) => raw.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'unknown',
}));

import { POST } from './route';
import { mintSession } from '@/lib/auth';

function startRequest(token?: string): Request {
  return new Request('https://easy-listing.test/api/generate/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ images: ['aGVsbG8='], notes: ['a blue jumper'] }),
  });
}

let original: NodeJS.ProcessEnv;

beforeEach(() => {
  original = { ...process.env };
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);

  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.checkUsage.mockResolvedValue({ allowed: true, used: 0, limit: 10 });
  mocks.writeJob.mockResolvedValue(undefined);
});

afterEach(() => {
  process.env = original;
});

describe('POST /api/generate/start', () => {
  it('refuses an unsigned request with 403 and spends nothing', async () => {
    const response = await POST(startRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Sign in with Apple or Google'),
    });
    expect(mocks.checkUsage).not.toHaveBeenCalled();
    expect(mocks.recordUsage).not.toHaveBeenCalled();
    expect(mocks.writeJob).not.toHaveBeenCalled();
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it('refuses a forged session without spending anything', async () => {
    const response = await POST(startRequest('clearly.not.a.jwt'));
    expect(response.status).toBe(403);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it('starts a job for any signed-in account', async () => {
    // No allow-list: a stranger who downloads the app can use it. That is the
    // whole point of the change — a list means an app that cannot work, with
    // nothing the person can do about it.
    const token = await mintSession({ email: 'stranger@example.com', provider: 'google', sub: 'g-1' });
    const response = await POST(startRequest(token));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ jobId: 'job-1' });
    expect(mocks.recordUsage).toHaveBeenCalledOnce();
    expect(mocks.waitUntil).toHaveBeenCalledOnce();
  });

  it('charges the account to the provider id, not the email', async () => {
    // So that Apple's "Hide My Email" relay address changes nothing.
    const token = await mintSession({
      email: 'abc@privaterelay.appleid.com',
      provider: 'apple',
      sub: 'apple-sub-1',
    });
    await POST(startRequest(token));

    expect(mocks.checkUsage).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'apple-sub-1', email: 'abc@privaterelay.appleid.com' }),
    );
  });

  it('refuses with 429 once the allowance is spent, and starts no work', async () => {
    mocks.checkUsage.mockResolvedValue({
      allowed: false,
      used: 10,
      limit: 10,
      error: "You've used your 10 free listings this month.",
      fix: 'The allowance resets on the 1st.',
    });
    const token = await mintSession({ email: 'a@b.com', provider: 'google', sub: 'g-2' });
    const response = await POST(startRequest(token));

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('free listings this month'),
    });
    expect(mocks.recordUsage).not.toHaveBeenCalled();
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it('records usage only after the allowance check passes', async () => {
    const token = await mintSession({ email: 'a@b.com', provider: 'google', sub: 'g-3' });
    await POST(startRequest(token));

    const checkedAt = mocks.checkUsage.mock.invocationCallOrder[0];
    const recordedAt = mocks.recordUsage.mock.invocationCallOrder[0];
    expect(checkedAt).toBeLessThan(recordedAt);
  });

  it('has no escape hatch', async () => {
    // GENERATE_REQUIRE_AUTH existed only for the 12 Oct rollout. Setting it
    // must not reopen the endpoint.
    process.env.GENERATE_REQUIRE_AUTH = 'false';
    expect((await POST(startRequest())).status).toBe(403);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });
});
