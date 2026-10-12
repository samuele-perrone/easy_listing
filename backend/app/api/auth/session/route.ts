import {
  AuthError,
  accountKeyFor,
  mintSession,
  verifyAppleIdentityToken,
  verifyGoogleIdToken,
  verifySession,
} from '@/lib/auth';
import { quotaFor } from '@/lib/usage';

/**
 * POST — trades a provider identity token for one of our sessions.
 *        Used by native Sign in with Apple. (Google comes in through
 *        /api/auth/google/callback, which mints the same session.)
 * GET  — re-checks an existing session, so a seller added to the allow-list
 *        gains the button without signing in again.
 */

interface Body {
  provider?: 'apple' | 'google';
  idToken?: string;
}

export async function POST(request: Request) {
  try {
    const { provider, idToken } = (await request.json()) as Body;
    if (!idToken || (provider !== 'apple' && provider !== 'google')) {
      return Response.json({ error: 'Missing provider or idToken.' }, { status: 400 });
    }

    const identity =
      provider === 'apple'
        ? await verifyAppleIdentityToken(idToken)
        : await verifyGoogleIdToken(idToken);

    const user = { email: identity.email, sub: identity.sub, provider };
    const sessionToken = await mintSession(user);
    const quota = await quotaFor({ key: accountKeyFor(user), email: user.email });
    return Response.json({
      sessionToken,
      email: user.email,
      listingsUsed: quota.used,
      listingsLimit: quota.limit,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: 401 });
    }
    console.error('auth session failed', error);
    return Response.json({ error: 'Could not verify that sign-in.' }, { status: 401 });
  }
}

export async function GET(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token) return Response.json({ error: 'Not signed in.' }, { status: 401 });

  try {
    const user = await verifySession(token);
    const quota = await quotaFor({ key: accountKeyFor(user), email: user.email });
    return Response.json({
      email: user.email,
      provider: user.provider,
      listingsUsed: quota.used,
      listingsLimit: quota.limit,
    });
  } catch {
    return Response.json({ error: 'Your sign-in has expired.' }, { status: 401 });
  }
}
