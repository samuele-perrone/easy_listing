import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AuthError,
  allowedEmails,
  authoriseEbayPost,
  isAllowedToPost,
  mintSession,
  requireAuthForEbay,
  verifySession,
} from './auth';

const SECRET = 'a'.repeat(40);

let original: NodeJS.ProcessEnv;
beforeEach(() => {
  original = { ...process.env };
  process.env.AUTH_JWT_SECRET = SECRET;
});
afterEach(() => {
  process.env = original;
});

function requestWith(token?: string): Request {
  return new Request('https://example.test/api/ebay/post', {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe('allowedEmails', () => {
  it('accepts commas, spaces and newlines, since the value gets pasted', () => {
    process.env.EBAY_POST_ALLOWED_EMAILS = 'a@x.com, b@y.com\nc@z.com d@w.com';
    expect(allowedEmails()).toEqual(['a@x.com', 'b@y.com', 'c@z.com', 'd@w.com']);
  });

  it('lower-cases, so a capitalised address still matches', () => {
    process.env.EBAY_POST_ALLOWED_EMAILS = 'Samuele.Perrone@Gmail.com';
    expect(isAllowedToPost('samuele.perrone@gmail.com')).toBe(true);
    expect(isAllowedToPost('SAMUELE.PERRONE@GMAIL.COM')).toBe(true);
  });

  it('is empty when the variable is unset', () => {
    delete process.env.EBAY_POST_ALLOWED_EMAILS;
    expect(allowedEmails()).toEqual([]);
  });
});

describe('isAllowedToPost', () => {
  it('permits nobody when the list is unset or blank', () => {
    // An unset variable must not mean "everyone" — a missed env var would
    // otherwise silently open the endpoint.
    delete process.env.EBAY_POST_ALLOWED_EMAILS;
    expect(isAllowedToPost('samuele.perrone@gmail.com')).toBe(false);
    process.env.EBAY_POST_ALLOWED_EMAILS = '   ';
    expect(isAllowedToPost('samuele.perrone@gmail.com')).toBe(false);
  });

  it('matches whole addresses only', () => {
    process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@gmail.com';
    expect(isAllowedToPost('samuele.perrone@gmail.com')).toBe(true);
    expect(isAllowedToPost('evil-samuele.perrone@gmail.com')).toBe(false);
    expect(isAllowedToPost('samuele.perrone@gmail.com.attacker.net')).toBe(false);
  });

  it('handles both of the owner’s addresses', () => {
    process.env.EBAY_POST_ALLOWED_EMAILS =
      'samuele.perrone@gmail.com,samuele.perrone@icloud.com';
    expect(isAllowedToPost('samuele.perrone@gmail.com')).toBe(true);
    expect(isAllowedToPost('samuele.perrone@icloud.com')).toBe(true);
    expect(isAllowedToPost('someone.else@gmail.com')).toBe(false);
  });
});

describe('sessions', () => {
  it('round-trips an email and provider', async () => {
    const token = await mintSession({ email: 'a@x.com', provider: 'apple' });
    expect(await verifySession(token)).toEqual({ email: 'a@x.com', provider: 'apple' });
  });

  it('rejects a session signed with a different secret', async () => {
    const token = await mintSession({ email: 'a@x.com', provider: 'apple' });
    process.env.AUTH_JWT_SECRET = 'b'.repeat(40);
    await expect(verifySession(token)).rejects.toThrow();
  });

  it('refuses to mint without a long enough secret', async () => {
    process.env.AUTH_JWT_SECRET = 'short';
    await expect(mintSession({ email: 'a@x.com', provider: 'apple' })).rejects.toThrow(AuthError);
  });
});

describe('authoriseEbayPost', () => {
  it('rejects an unsigned request by default', async () => {
    delete process.env.EBAY_POST_REQUIRE_AUTH;
    expect(requireAuthForEbay()).toBe(true);
    await expect(authoriseEbayPost(requestWith())).rejects.toThrow(/Sign in with Apple or Google/);
  });

  it('rejects a signed-in email that isn’t on the list', async () => {
    process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@gmail.com';
    const token = await mintSession({ email: 'stranger@example.com', provider: 'google' });
    await expect(authoriseEbayPost(requestWith(token))).rejects.toThrow(/isn’t on the list/);
  });

  it('admits an allow-listed email', async () => {
    process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@icloud.com';
    const token = await mintSession({ email: 'samuele.perrone@icloud.com', provider: 'apple' });
    await expect(authoriseEbayPost(requestWith(token))).resolves.toEqual({
      email: 'samuele.perrone@icloud.com',
      allowed: true,
    });
  });

  it('rejects a garbled token rather than treating it as anonymous', async () => {
    process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@gmail.com';
    await expect(authoriseEbayPost(requestWith('not-a-jwt'))).rejects.toThrow(AuthError);
  });

  it('still checks the allow-list when auth is not required', async () => {
    // The escape hatch is for builds that predate sign-in, so a request with no
    // token passes — but a request that *is* signed still has to be allowed, or
    // the hatch would become a way to bypass the list by signing in as anyone.
    process.env.EBAY_POST_REQUIRE_AUTH = 'false';
    process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@gmail.com';
    await expect(authoriseEbayPost(requestWith())).resolves.toEqual({ email: null, allowed: true });

    const token = await mintSession({ email: 'stranger@example.com', provider: 'google' });
    await expect(authoriseEbayPost(requestWith(token))).rejects.toThrow(/isn’t on the list/);
  });
});
