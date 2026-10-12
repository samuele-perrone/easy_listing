import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthError,
  allowedEmails,
  authoriseEbayPost,
  isAllowedToPost,
  mintSession,
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
  it('rejects an unsigned request', async () => {
    await expect(authoriseEbayPost(requestWith())).rejects.toThrow(/Sign in with Apple or Google/);
  });

  it('admits any signed-in account', async () => {
    // Posting spends the seller's own eBay account through their own OAuth
    // token, so there is nothing to ration and no list to be on.
    process.env.ALLOWED_EMAILS = 'someone.else@example.com';
    const token = await mintSession({ email: 'stranger@example.com', provider: 'google', sub: 'g-1' });
    const result = await authoriseEbayPost(requestWith(token));
    expect(result.email).toBe('stranger@example.com');
    expect(result.allowed).toBe(true);
    expect(result.user.sub).toBe('g-1');
  });

  it('rejects a garbled token rather than treating it as anonymous', async () => {
    process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@gmail.com';
    await expect(authoriseEbayPost(requestWith('not-a-jwt'))).rejects.toThrow(AuthError);
  });

  it('has no escape hatch left', async () => {
    // EBAY_POST_REQUIRE_AUTH / GENERATE_REQUIRE_AUTH existed only to keep
    // pre-sign-in builds working during the 12 Oct rollout. They are gone, and
    // setting them must not reopen anything.
    process.env.EBAY_POST_REQUIRE_AUTH = 'false';
    process.env.GENERATE_REQUIRE_AUTH = 'false';
    await expect(authoriseEbayPost(requestWith())).rejects.toThrow(/Sign in with Apple or Google/);
  });
});

describe('refusals are logged', () => {
  // A 403 isn't a fault, so it stays out of console.error — but it has to leave
  // *some* trace. Returning silently made a real rollout failure undiagnosable.
  it('names the reason, and never the token', async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...a) => { logged.push(a.join(' ')); });
    try {
      process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@gmail.com';
      const token = await mintSession({ email: 'stranger@example.com', provider: 'google' });

      await expect(authoriseEbayPost(requestWith())).rejects.toThrow();
      await expect(authoriseEbayPost(requestWith('not-a-jwt'))).rejects.toThrow();
      void token;
    } finally {
      spy.mockRestore();
    }

    expect(logged.some((l) => l.includes('no session'))).toBe(true);
    expect(logged.some((l) => l.includes('bad session'))).toBe(true);
    expect(logged.join('\n')).not.toContain('not-a-jwt');
  });
});
