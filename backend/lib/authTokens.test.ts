/**
 * Exercises the provider token verification for real: a locally generated RSA
 * key signs the tokens, and the JWKS fetch is stubbed to serve its public half.
 *
 * Worth doing properly rather than mocking `jwtVerify` away — this is the check
 * that stops someone handing us a token they wrote themselves, and the
 * interesting cases (wrong audience, wrong issuer, Apple's string-valued
 * `email_verified`, a missing email) are all things only a real verify catches.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK, type KeyLike } from 'jose';

// `AuthError` is deliberately not imported for assertions: `vi.resetModules()`
// re-evaluates auth.ts per test, so each load defines a *different* class
// object and `instanceof` fails even on the right error. Match the message.

/**
 * Serve our test key where the code asks for the provider's.
 *
 * Stubbing `globalThis.fetch` does **not** work: jose's Node build fetches a
 * JWKS through `node:https` directly, so a stubbed global fetch is ignored and
 * the test silently reaches the real appleid.apple.com — which of course
 * publishes no key called `test-key`, giving a confusing
 * "no applicable key found" instead of an obvious failure.
 */
const keys = vi.hoisted(() => ({ jwks: { keys: [] as unknown[] } }));

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    // Built lazily: the key pair only exists once `beforeAll` has run.
    createRemoteJWKSet: () => {
      let local: ReturnType<typeof actual.createLocalJWKSet> | undefined;
      return (header: Parameters<ReturnType<typeof actual.createLocalJWKSet>>[0], input: Parameters<ReturnType<typeof actual.createLocalJWKSet>>[1]) => {
        local ??= actual.createLocalJWKSet(keys.jwks as Parameters<typeof actual.createLocalJWKSet>[0]);
        return local(header, input);
      };
    },
  };
});

/**
 * `createRemoteJWKSet` caches the fetched key set at module scope, and that
 * cache leaks between tests — a set fetched by one test is reused by the next,
 * which makes failures depend on test order. Load a fresh copy of the module
 * per test instead.
 */
async function loadAuth() {
  vi.resetModules();
  return import('./auth');
}

async function verifyApple(token: string): Promise<string> {
  const auth = await loadAuth();
  return auth.verifyAppleIdentityToken(token);
}

async function verifyGoogle(token: string): Promise<string> {
  const auth = await loadAuth();
  return auth.verifyGoogleIdToken(token);
}

const APPLE_AUD = 'com.samperrone.easylisting';
const GOOGLE_AUD = '1234.apps.googleusercontent.com';

let privateKey: KeyLike;
let publicJWK: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  publicJWK = await exportJWK(pair.publicKey);
  publicJWK.kid = 'test-key';
  publicJWK.alg = 'RS256';
  publicJWK.use = 'sig';
  keys.jwks = { keys: [publicJWK] };
});

let original: NodeJS.ProcessEnv;

beforeEach(() => {
  original = { ...process.env };
  process.env.APPLE_CLIENT_ID = APPLE_AUD;
  process.env.GOOGLE_OAUTH_CLIENT_ID = GOOGLE_AUD;
});

afterEach(() => {
  process.env = original;
});

interface TokenOptions {
  issuer?: string;
  audience?: string;
  email?: string | null;
  emailVerified?: unknown;
  expiresIn?: string;
}

async function signToken(options: TokenOptions = {}): Promise<string> {
  const claims: Record<string, unknown> = { sub: 'provider-user-id' };
  if (options.email !== null) claims.email = options.email ?? 'samuele.perrone@gmail.com';
  if (options.emailVerified !== undefined) claims.email_verified = options.emailVerified;
  else claims.email_verified = true;

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuedAt()
    .setIssuer(options.issuer ?? 'https://appleid.apple.com')
    .setAudience(options.audience ?? APPLE_AUD)
    .setExpirationTime(options.expiresIn ?? '10m')
    .sign(privateKey);
}

describe('verifyAppleIdentityToken', () => {
  it('returns the email from a properly signed token', async () => {
    const token = await signToken();
    await expect(verifyApple(token)).resolves.toBe('samuele.perrone@gmail.com');
  });

  it('lower-cases the email, so capitalisation cannot dodge the allow-list', async () => {
    const token = await signToken({ email: 'Samuele.Perrone@Gmail.COM' });
    await expect(verifyApple(token)).resolves.toBe('samuele.perrone@gmail.com');
  });

  it('accepts email_verified as the string "true", which Apple sometimes sends', async () => {
    const token = await signToken({ emailVerified: 'true' });
    await expect(verifyApple(token)).resolves.toBe('samuele.perrone@gmail.com');
  });

  it('rejects a token minted for a different audience', async () => {
    // i.e. someone replaying a token issued to another app.
    const token = await signToken({ audience: 'com.someone.else' });
    await expect(verifyApple(token)).rejects.toThrow();
  });

  it('rejects a token from the wrong issuer', async () => {
    const token = await signToken({ issuer: 'https://evil.example.com' });
    await expect(verifyApple(token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signToken({ expiresIn: '-1m' });
    await expect(verifyApple(token)).rejects.toThrow();
  });

  it('rejects a token signed by a key the provider does not publish', async () => {
    const stranger = await generateKeyPair('RS256');
    const token = await new SignJWT({ email: 'a@b.com', email_verified: true })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuedAt()
      .setIssuer('https://appleid.apple.com')
      .setAudience(APPLE_AUD)
      .setExpirationTime('10m')
      .sign(stranger.privateKey);
    await expect(verifyApple(token)).rejects.toThrow();
  });

  it('rejects an unverified email', async () => {
    const token = await signToken({ emailVerified: false });
    await expect(verifyApple(token)).rejects.toThrow(/has not been verified/);
  });

  it('explains how to fix a token with no email at all', async () => {
    // Apple omits the claim when the authorization never carried email scope,
    // and no amount of retrying fixes it — the message has to say so.
    const token = await signToken({ email: null });
    await expect(verifyApple(token)).rejects.toThrow(/Share My Email/);
  });
});

describe('verifyGoogleIdToken', () => {
  it('accepts both issuer spellings Google uses', async () => {
    for (const issuer of ['https://accounts.google.com', 'accounts.google.com']) {
      const token = await signToken({ issuer, audience: GOOGLE_AUD });
      await expect(verifyGoogle(token)).resolves.toBe('samuele.perrone@gmail.com');
    }
  });

  it('rejects a token audienced to a different OAuth client', async () => {
    const token = await signToken({
      issuer: 'https://accounts.google.com',
      audience: 'someone-elses-client.apps.googleusercontent.com',
    });
    await expect(verifyGoogle(token)).rejects.toThrow();
  });

  it('will not verify anything when the client id is unconfigured', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const token = await signToken({ issuer: 'https://accounts.google.com', audience: GOOGLE_AUD });
    await expect(verifyGoogle(token)).rejects.toThrow(/GOOGLE_OAUTH_CLIENT_ID is not configured/);
  });

  it('does not accept an Apple token as a Google one', async () => {
    const token = await signToken();
    await expect(verifyGoogle(token)).rejects.toThrow();
  });
});

describe('Apple’s Hide My Email', () => {
  it('verifies, but does not reach the allow-list', async () => {
    // Choosing "Hide My Email" yields a relay address. It is a genuine verified
    // email so verification passes — it simply can never match an allow-list
    // entry, which is why the sign-in UI warns about it.
    const relay = 'abc123def@privaterelay.appleid.com';
    const token = await signToken({ email: relay });
    await expect(verifyApple(token)).resolves.toBe(relay);

    process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@gmail.com';
    const { isAllowedToPost } = await loadAuth();
    expect(isAllowedToPost(relay)).toBe(false);
  });
});
