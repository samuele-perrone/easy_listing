/**
 * The session endpoint: what the app gets back after signing in, and what a
 * stored session reports later.
 *
 * Provider verification itself is covered in lib/authTokens.test.ts against a
 * real signature; here it's stubbed so these tests are about the route — status
 * codes, and the quota figures the app shows before anyone hits the wall.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyApple: vi.fn(),
  verifyGoogle: vi.fn(),
  quotaFor: vi.fn(),
}));

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    verifyAppleIdentityToken: mocks.verifyApple,
    verifyGoogleIdToken: mocks.verifyGoogle,
  };
});

vi.mock('@/lib/usage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/usage')>();
  return { ...actual, quotaFor: mocks.quotaFor };
});

import { GET, POST } from './route';
import { mintSession } from '@/lib/auth';

function signInRequest(body: unknown): Request {
  return new Request('https://easy-listing.test/api/auth/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function checkRequest(token?: string): Request {
  return new Request('https://easy-listing.test/api/auth/session', {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

let original: NodeJS.ProcessEnv;

beforeEach(() => {
  original = { ...process.env };
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  mocks.verifyApple.mockReset();
  mocks.verifyGoogle.mockReset();
  mocks.quotaFor.mockReset();
  mocks.quotaFor.mockResolvedValue({ used: 3, limit: 10 });
});

afterEach(() => {
  process.env = original;
});

describe('POST /api/auth/session', () => {
  it('signs in any account and reports its allowance', async () => {
    mocks.verifyApple.mockResolvedValue({ email: 'stranger@example.com', sub: 'a-1' });
    const response = await POST(signInRequest({ provider: 'apple', idToken: 'apple-token' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.email).toBe('stranger@example.com');
    expect(body.listingsUsed).toBe(3);
    expect(body.listingsLimit).toBe(10);
    expect(typeof body.sessionToken).toBe('string');
  });

  it('reports an uncapped account as having no limit', async () => {
    mocks.verifyApple.mockResolvedValue({ email: 'owner@example.com', sub: 'a-2' });
    mocks.quotaFor.mockResolvedValue({ used: 0, limit: null });
    const body = await (await POST(signInRequest({ provider: 'apple', idToken: 't' }))).json();
    expect(body.listingsLimit).toBeNull();
  });

  it('rejects an unknown provider', async () => {
    const response = await POST(signInRequest({ provider: 'facebook', idToken: 'x' }));
    expect(response.status).toBe(400);
    expect(mocks.verifyApple).not.toHaveBeenCalled();
    expect(mocks.verifyGoogle).not.toHaveBeenCalled();
  });

  it('rejects a missing token', async () => {
    expect((await POST(signInRequest({ provider: 'apple' }))).status).toBe(400);
  });

  it('answers 401 when the provider rejects the token', async () => {
    mocks.verifyApple.mockRejectedValue(new Error('bad signature'));
    expect((await POST(signInRequest({ provider: 'apple', idToken: 'forged' }))).status).toBe(401);
  });

  it('routes a google provider to the google verifier', async () => {
    mocks.verifyGoogle.mockResolvedValue({ email: 'a@b.com', sub: 'g-1' });
    const response = await POST(signInRequest({ provider: 'google', idToken: 'google-token' }));

    expect(response.status).toBe(200);
    expect(mocks.verifyGoogle).toHaveBeenCalledOnce();
    expect(mocks.verifyApple).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/session', () => {
  it('reports the allowance for a stored session', async () => {
    const token = await mintSession({ email: 'a@b.com', provider: 'apple', sub: 'a-1' });
    const response = await GET(checkRequest(token));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      email: 'a@b.com',
      provider: 'apple',
      listingsUsed: 3,
      listingsLimit: 10,
    });
  });

  it('charges the quota lookup to the provider id', async () => {
    const token = await mintSession({ email: 'relay@privaterelay.appleid.com', provider: 'apple', sub: 'a-9' });
    await GET(checkRequest(token));
    expect(mocks.quotaFor).toHaveBeenCalledWith(expect.objectContaining({ key: 'a-9' }));
  });

  it('answers 401 with no session, so the app offers sign-in again', async () => {
    expect((await GET(checkRequest())).status).toBe(401);
    expect((await GET(checkRequest('not-a-jwt'))).status).toBe(401);
  });

  it('answers 401 once the signing secret is rotated', async () => {
    const token = await mintSession({ email: 'a@b.com', provider: 'apple', sub: 'a-1' });
    process.env.AUTH_JWT_SECRET = 'b'.repeat(40);
    expect((await GET(checkRequest(token))).status).toBe(401);
  });
});
