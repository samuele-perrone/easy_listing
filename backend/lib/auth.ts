/**
 * Sign in with Apple / Google, and the allow-list that decides who may post to
 * eBay.
 *
 * Shape of the thing: the app gets an identity token from Apple or Google, we
 * verify it against that provider's public keys, and mint our own short record
 * of "this email signed in" as a session JWT. The app then sends that session
 * on eBay requests.
 *
 * Why not just send the provider's token on every request? Apple's identity
 * token lasts about ten minutes and Google's about an hour, and neither can be
 * refreshed without putting the sign-in sheet back in front of the seller. A
 * session of our own lets them sign in once.
 *
 * The allow-list is checked **server-side on every eBay write**, not just used
 * to hide a button. Hiding the button is a courtesy; anyone can call the
 * endpoint directly, and publishing spends the seller's eBay account.
 */

import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';

const APPLE_ISSUER = 'https://appleid.apple.com';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export type Provider = 'apple' | 'google';

export interface SignedInUser {
  email: string;
  provider: Provider;
}

/** Apple sends `email_verified` as a boolean or the string "true", depending on the flow. */
function isVerified(claim: unknown): boolean {
  return claim === true || claim === 'true';
}

function requireEmail(payload: JWTPayload, provider: Provider): string {
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email) {
    // Apple omits the email claim if the app's authorization was never granted
    // the email scope, which no amount of retrying fixes on its own.
    throw new AuthError(
      provider === 'apple'
        ? 'Apple did not share an email address for this sign-in. In Settings → Apple Account → Sign in with Apple, remove Easy Listing and sign in again, choosing “Share My Email”.'
        : 'Google did not share an email address for this sign-in.',
    );
  }
  if (!isVerified(payload.email_verified)) {
    throw new AuthError('That email address has not been verified with ' + provider + '.');
  }
  return email;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Verifies a native Sign in with Apple identity token. */
export async function verifyAppleIdentityToken(idToken: string): Promise<string> {
  // The audience is the app's bundle id for a native sign-in (it would be the
  // Services ID for a web one, which we don't use).
  const audience = process.env.APPLE_CLIENT_ID ?? 'com.samperrone.easylisting';
  const { payload } = await jwtVerify(idToken, appleKeys, {
    issuer: APPLE_ISSUER,
    audience,
  });
  return requireEmail(payload, 'apple');
}

/** Verifies a Google OIDC id_token. */
export async function verifyGoogleIdToken(idToken: string): Promise<string> {
  const audience = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!audience) throw new AuthError('GOOGLE_OAUTH_CLIENT_ID is not configured.');
  const { payload } = await jwtVerify(idToken, googleKeys, {
    issuer: GOOGLE_ISSUERS,
    audience,
  });
  return requireEmail(payload, 'google');
}

function sessionSecret(): Uint8Array {
  const secret = process.env.AUTH_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new AuthError(
      'AUTH_JWT_SECRET is not configured (needs at least 32 characters).',
    );
  }
  return new TextEncoder().encode(secret);
}

/**
 * Mints the app's session. 60 days, because the alternative is putting the
 * sign-in sheet in front of someone who is halfway through listing an item.
 */
export async function mintSession(user: SignedInUser): Promise<string> {
  return new SignJWT({ email: user.email, provider: user.provider })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('easy-listing')
    .setAudience('easy-listing-app')
    .setExpirationTime('60d')
    .sign(sessionSecret());
}

export async function verifySession(token: string): Promise<SignedInUser> {
  const { payload } = await jwtVerify(token, sessionSecret(), {
    issuer: 'easy-listing',
    audience: 'easy-listing-app',
  });
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  const provider = payload.provider === 'apple' || payload.provider === 'google' ? payload.provider : undefined;
  if (!email || !provider) throw new AuthError('Session is missing its email.');
  return { email, provider };
}

/**
 * Emails permitted to post to eBay, from `EBAY_POST_ALLOWED_EMAILS`.
 * Comma-, space- or newline-separated so it can be pasted in any shape.
 */
export function allowedEmails(): string[] {
  return (process.env.EBAY_POST_ALLOWED_EMAILS ?? '')
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedToPost(email: string): boolean {
  const list = allowedEmails();
  // An empty list permits nobody. The alternative — an unset variable meaning
  // "everyone" — turns a typo or a missed env var into an open endpoint.
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}

/**
 * Whether eBay writes demand a signed-in, allow-listed caller.
 *
 * Defaults to on. The escape hatch exists for one specific situation: a build
 * already on a phone predates sign-in entirely and would lose eBay posting the
 * moment this deploys. Set `EBAY_POST_REQUIRE_AUTH=false` to keep those working
 * until the new build is installed, then remove it.
 */
export function requireAuthForEbay(): boolean {
  return process.env.EBAY_POST_REQUIRE_AUTH !== 'false';
}

export interface Authorisation {
  email: string | null;
  allowed: boolean;
}

/**
 * Resolves the caller of an eBay write, or throws something the app can show.
 * Call this before doing any eBay work.
 */
export async function authoriseEbayPost(request: Request): Promise<Authorisation> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    if (!requireAuthForEbay()) return { email: null, allowed: true };
    throw new AuthError('Sign in with Apple or Google to post to eBay.');
  }

  let user: SignedInUser;
  try {
    user = await verifySession(token);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('Your sign-in has expired. Sign in again in Settings.');
  }

  if (!isAllowedToPost(user.email)) {
    throw new AuthError(
      `${user.email} isn’t on the list of accounts allowed to post to eBay. ` +
        `Ask Sam to add it, or sign in with a different account.`,
    );
  }
  return { email: user.email, allowed: true };
}
