/**
 * The session endpoint: what the app gets back after Apple verifies, and what a
 * stored session reports later.
 *
 * Provider verification itself is covered in lib/authTokens.test.ts against a
 * real signature; here it's stubbed so these tests are about the route's own
 * behaviour — status codes, and whether `canPostToEbay` tracks the allow-list.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  verifyApple: vi.fn(),
  verifyGoogle: vi.fn(),
}));

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>();
  return {
    ...actual,
    verifyAppleIdentityToken: mocks.verifyApple,
    verifyGoogleIdToken: mocks.verifyGoogle,
  };
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
  process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@gmail.com';
  mocks.verifyApple.mockReset();
  mocks.verifyGoogle.mockReset();
});

afterEach(() => {
  process.env = original;
});

describe('POST /api/auth/session', () => {
  it('returns a session and the eBay entitlement for an allow-listed email', async () => {
    mocks.verifyApple.mockResolvedValue('samuele.perrone@gmail.com');
    const response = await POST(signInRequest({ provider: 'apple', idToken: 'apple-token' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.email).toBe('samuele.perrone@gmail.com');
    expect(body.canPostToEbay).toBe(true);
    expect(typeof body.sessionToken).toBe('string');
  });

  it('still signs in an email that cannot post, just without the entitlement', async () => {
    // Signing in is open; only eBay posting is restricted. Refusing the sign-in
    // outright would leave a tester unable to use the rest of the app.
    mocks.verifyApple.mockResolvedValue('friend@example.com');
    const response = await POST(signInRequest({ provider: 'apple', idToken: 'apple-token' }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.email).toBe('friend@example.com');
    expect(body.canPostToEbay).toBe(false);
    expect(typeof body.sessionToken).toBe('string');
  });

  it('rejects an unknown provider', async () => {
    const response = await POST(signInRequest({ provider: 'facebook', idToken: 'x' }));
    expect(response.status).toBe(400);
    expect(mocks.verifyApple).not.toHaveBeenCalled();
    expect(mocks.verifyGoogle).not.toHaveBeenCalled();
  });

  it('rejects a missing token', async () => {
    const response = await POST(signInRequest({ provider: 'apple' }));
    expect(response.status).toBe(400);
  });

  it('answers 401 when the provider rejects the token', async () => {
    mocks.verifyApple.mockRejectedValue(new Error('bad signature'));
    const response = await POST(signInRequest({ provider: 'apple', idToken: 'forged' }));
    expect(response.status).toBe(401);
  });

  it('routes a google provider to the google verifier', async () => {
    mocks.verifyGoogle.mockResolvedValue('samuele.perrone@gmail.com');
    const response = await POST(signInRequest({ provider: 'google', idToken: 'google-token' }));

    expect(response.status).toBe(200);
    expect(mocks.verifyGoogle).toHaveBeenCalledOnce();
    expect(mocks.verifyApple).not.toHaveBeenCalled();
  });
});

describe('GET /api/auth/session', () => {
  it('reports the current entitlement for a stored session', async () => {
    const token = await mintSession({ email: 'samuele.perrone@gmail.com', provider: 'apple' });
    const response = await GET(checkRequest(token));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      email: 'samuele.perrone@gmail.com',
      provider: 'apple',
      canPostToEbay: true,
    });
  });

  it('picks up an allow-list change without a new sign-in', async () => {
    // This is the whole reason the app re-checks: adding a tester is a server
    // change, and they shouldn't have to sign out and back in to see it.
    const token = await mintSession({ email: 'friend@example.com', provider: 'google' });

    let body = await (await GET(checkRequest(token))).json();
    expect(body.canPostToEbay).toBe(false);

    process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@gmail.com,friend@example.com';
    body = await (await GET(checkRequest(token))).json();
    expect(body.canPostToEbay).toBe(true);
  });

  it('answers 401 with no session, so the app offers sign-in again', async () => {
    expect((await GET(checkRequest())).status).toBe(401);
    expect((await GET(checkRequest('not-a-jwt'))).status).toBe(401);
  });

  it('answers 401 once the signing secret is rotated', async () => {
    const token = await mintSession({ email: 'samuele.perrone@gmail.com', provider: 'apple' });
    process.env.AUTH_JWT_SECRET = 'b'.repeat(40);
    expect((await GET(checkRequest(token))).status).toBe(401);
  });
});
