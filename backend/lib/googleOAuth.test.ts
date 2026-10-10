import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exchangeGoogleCode, googleRedirectURI } from './googleOAuth';

let original: NodeJS.ProcessEnv;

beforeEach(() => {
  original = { ...process.env };
  process.env.GOOGLE_OAUTH_CLIENT_ID = 'client-id';
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'client-secret';
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI;
});

afterEach(() => {
  process.env = original;
  vi.unstubAllGlobals();
});

describe('googleRedirectURI', () => {
  it('defaults to the production callback', () => {
    expect(googleRedirectURI()).toBe(
      'https://easy-listing-chi.vercel.app/api/auth/google/callback',
    );
  });

  it('can be overridden for a preview deployment', () => {
    process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://preview.test/api/auth/google/callback';
    expect(googleRedirectURI()).toBe('https://preview.test/api/auth/google/callback');
  });
});

describe('exchangeGoogleCode', () => {
  it('sends the code with the same redirect URI Google was given', async () => {
    // Google compares this against the authorization request and rejects a
    // mismatch, so the two must come from one place.
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({ id_token: 'an-id-token' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(exchangeGoogleCode('the-code')).resolves.toEqual({ id_token: 'an-id-token' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('code')).toBe('the-code');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe(googleRedirectURI());
    expect(body.get('client_secret')).toBe('client-secret');
  });

  it('throws with Google’s own message when the exchange fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 })),
    );
    await expect(exchangeGoogleCode('stale-code')).rejects.toThrow(/invalid_grant/);
  });

  it('refuses to try without credentials, rather than calling Google blind', async () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(exchangeGoogleCode('the-code')).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
