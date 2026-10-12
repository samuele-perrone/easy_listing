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
import { normaliseAccountKey } from '@/lib/usage';

const APPLE_ISSUER = 'https://appleid.apple.com';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

const appleKeys = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export type Provider = 'apple' | 'google';

export interface SignedInUser {
  email: string;
  provider: Provider;
  /**
   * The provider's stable id for this person.
   *
   * Quota is keyed on this, not the email, so Apple's "Hide My Email" is a
   * non-event: the relay address changes nothing, because nothing depends on
   * the address. Keying on email would have stranded every seller who picked
   * that option, with no fix available to them or to us.
   *
   * Optional because sessions minted before 12 Oct 2026 don't carry it; those
   * fall back to an email-derived key rather than signing everyone out.
   */
  sub?: string;
}

/** Apple sends `email_verified` as a boolean or the string "true", depending on the flow. */
function isVerified(claim: unknown): boolean {
  return claim === true || claim === 'true';
}

function requireIdentity(payload: JWTPayload, provider: Provider): { email: string; sub: string } {
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
  const sub = typeof payload.sub === 'string' ? payload.sub : '';
  if (!sub) throw new AuthError('That sign-in carried no account id.');
  return { email, sub };
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/** Verifies a native Sign in with Apple identity token. */
export async function verifyAppleIdentityToken(idToken: string): Promise<{ email: string; sub: string }> {
  // The audience is the app's bundle id for a native sign-in (it would be the
  // Services ID for a web one, which we don't use).
  const audience = process.env.APPLE_CLIENT_ID ?? 'com.samperrone.easylisting';
  const { payload } = await jwtVerify(idToken, appleKeys, {
    issuer: APPLE_ISSUER,
    audience,
  });
  return requireIdentity(payload, 'apple');
}

/** Verifies a Google OIDC id_token. */
export async function verifyGoogleIdToken(idToken: string): Promise<{ email: string; sub: string }> {
  const audience = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!audience) throw new AuthError('GOOGLE_OAUTH_CLIENT_ID is not configured.');
  const { payload } = await jwtVerify(idToken, googleKeys, {
    issuer: GOOGLE_ISSUERS,
    audience,
  });
  return requireIdentity(payload, 'google');
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
  return new SignJWT({ email: user.email, provider: user.provider, sub: user.sub })
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
  const sub = typeof payload.sub === 'string' && payload.sub ? payload.sub : undefined;
  return { email, provider, sub };
}

/**
 * The key a session's usage is charged to.
 *
 * Prefers the provider's stable id. Sessions minted before that was carried
 * fall back to the email, prefixed so the two namespaces can never collide.
 */
export function accountKeyFor(user: SignedInUser): string {
  return normaliseAccountKey(user.sub ?? `email-${user.email}`);
}

/**
 * @deprecated Not a gate any more. Kept only because `lib/usage.ts` reads the
 * same variable to decide which accounts are uncapped — see `isUncapped`.
 * Anyone signed in may use the app; cost is bounded by the monthly quota.
 *
 * Historically: emails permitted to use the app at all. Comma-, space- or newline-separated so it can
 * be pasted in any shape.
 *
 * `ALLOWED_EMAILS` is the name to use. `EBAY_POST_ALLOWED_EMAILS` is read as a
 * fallback because it was the original name, set before the list also governed
 * generation; it can go once `ALLOWED_EMAILS` is set everywhere.
 *
 * One list rather than two deliberately. Generation is the part that spends
 * money (the AI key is ours), while an eBay post spends the seller's *own* eBay
 * account through their own OAuth token — so if anything the generation side
 * wants the tighter control, and separate lists would invite getting that
 * backwards.
 */
export function allowedEmails(): string[] {
  const raw = process.env.ALLOWED_EMAILS ?? process.env.EBAY_POST_ALLOWED_EMAILS ?? '';
  return raw
    .split(/[,\s]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string): boolean {
  const list = allowedEmails();
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}

/** @deprecated Same list as `isAllowed`; kept so existing call sites read clearly. */
export function isAllowedToPost(email: string): boolean {
  const list = allowedEmails();
  // An empty list permits nobody. The alternative — an unset variable meaning
  // "everyone" — turns a typo or a missed env var into an open endpoint.
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}

/**
 * Refuses a request, saying why in the log.
 *
 * A 403 is not a fault, so it doesn't belong in the error log — but logging
 * *nothing* was worse: on 12 Oct 2026 a seller hit refusals during a rollout
 * and there was no way to tell which of the three reasons had fired, because
 * this path returned silently. One line per refusal, naming the reason and the
 * account, and never the token.
 */
function refuse(gate: 'generation' | 'ebay', reason: string, who: string): never {
  console.log(`refused ${gate}: ${reason} (${who})`);
  throw new AuthError(REFUSALS[reason] ?? 'Sign in to use Easy Listing.');
}

const REFUSALS: Record<string, string> = {
  'no session': 'Sign in with Apple or Google to use Easy Listing.',
  'no session (ebay)': 'Sign in with Apple or Google to post to eBay.',
  'bad session': 'Your sign-in has expired. Sign in again in Settings.',
};

export interface Authorisation {
  email: string;
  allowed: boolean;
  user: SignedInUser;
}

/**
 * Resolves the caller of a generation, or throws something the app can show.
 *
 * This is what actually bounds spend: the daily caps in `lib/usage.ts` limit how
 * much an identified caller may use, but the install id they key off is
 * self-asserted, so without this anyone who found the endpoint could mint a new
 * one per request. A verified, allow-listed email is the part that can't be
 * invented.
 */
export async function authoriseGeneration(request: Request): Promise<Authorisation> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    refuse('generation', 'no session', 'no Authorization header');
  }

  let user: SignedInUser;
  try {
    user = await verifySession(token);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    refuse('generation', 'bad session', error instanceof Error ? error.message : 'unverifiable');
  }

  // Signing in is the whole requirement. There is deliberately no allow-list
  // here any more: a list means a stranger who downloads the app installs
  // something that cannot work, with no way forward. What bounds cost is the
  // per-account quota in lib/usage.ts, which has a number attached and so can
  // be explained.
  return { email: user.email, allowed: true, user };
}

/**
 * Resolves the caller of an eBay write, or throws something the app can show.
 * Call this before doing any eBay work.
 */
export async function authoriseEbayPost(request: Request): Promise<Authorisation> {
  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    refuse('ebay', 'no session (ebay)', 'no Authorization header');
  }

  let user: SignedInUser;
  try {
    user = await verifySession(token);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    refuse('ebay', 'bad session', error instanceof Error ? error.message : 'unverifiable');
  }

  // Posting spends the seller's *own* eBay account through their own OAuth
  // token, so it costs us nothing and needs no allowance — being signed in is
  // the only requirement.
  return { email: user.email, allowed: true, user };
}
