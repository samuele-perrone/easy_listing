/**
 * The generation gate. As with the eBay routes, the point is that an
 * unauthorised call does no *work*: no usage recorded, no job written, no
 * provider call — because generation is what can reach a paid model.
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
vi.mock('@/lib/jobs', () => ({
  newJobId: () => 'job-1',
  writeJob: mocks.writeJob,
}));
vi.mock('@/lib/usage', () => ({
  checkUsage: mocks.checkUsage,
  recordUsage: mocks.recordUsage,
  normaliseInstallId: (id: string | null) => id ?? 'unidentified',
}));

import { POST } from './route';
import { mintSession } from '@/lib/auth';

function startRequest(token?: string): Request {
  return new Request('https://easy-listing.test/api/generate/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-install-id': 'install-1',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ images: ['aGVsbG8='], notes: ['a blue jumper'] }),
  });
}

let original: NodeJS.ProcessEnv;

beforeEach(() => {
  original = { ...process.env };
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  process.env.ALLOWED_EMAILS = 'samuele.perrone@gmail.com';
  delete process.env.GENERATE_REQUIRE_AUTH;

  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.checkUsage.mockResolvedValue({ allowed: true });
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

  it('refuses an account that is not on the approved list', async () => {
    const token = await mintSession({ email: 'stranger@example.com', provider: 'google' });
    const response = await POST(startRequest(token));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('isn’t enabled for stranger@example.com'),
    });
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it('refuses when the approved list is unset rather than admitting everyone', async () => {
    delete process.env.ALLOWED_EMAILS;
    delete process.env.EBAY_POST_ALLOWED_EMAILS;
    const token = await mintSession({ email: 'samuele.perrone@gmail.com', provider: 'apple' });
    expect((await POST(startRequest(token))).status).toBe(403);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it('starts a job for an approved account', async () => {
    const token = await mintSession({ email: 'samuele.perrone@gmail.com', provider: 'apple' });
    const response = await POST(startRequest(token));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ jobId: 'job-1' });
    expect(mocks.recordUsage).toHaveBeenCalledOnce();
    expect(mocks.writeJob).toHaveBeenCalled();
    expect(mocks.waitUntil).toHaveBeenCalledOnce();
  });

  it('still enforces the daily cap for an approved account', async () => {
    // The gate is about who may call; the cap is about how much. Both apply.
    mocks.checkUsage.mockResolvedValue({
      allowed: false,
      error: "You've used your listings for today",
      fix: 'Try again tomorrow.',
    });
    const token = await mintSession({ email: 'samuele.perrone@gmail.com', provider: 'apple' });
    const response = await POST(startRequest(token));

    expect(response.status).toBe(429);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });

  it('falls back to the old allow-list variable name', async () => {
    // EBAY_POST_ALLOWED_EMAILS predates the list governing generation too, and
    // is still what production has set.
    delete process.env.ALLOWED_EMAILS;
    process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@icloud.com';
    const token = await mintSession({ email: 'samuele.perrone@icloud.com', provider: 'apple' });
    expect((await POST(startRequest(token))).status).toBe(202);
  });

  it('lets an older build through when the escape hatch is set', async () => {
    process.env.GENERATE_REQUIRE_AUTH = 'false';
    expect((await POST(startRequest())).status).toBe(202);

    // ...but a signed request is still checked, so the hatch is not a bypass.
    mocks.waitUntil.mockClear();
    const stranger = await mintSession({ email: 'stranger@example.com', provider: 'google' });
    expect((await POST(startRequest(stranger))).status).toBe(403);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
  });
});
