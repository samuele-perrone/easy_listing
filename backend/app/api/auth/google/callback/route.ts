import { isAllowedToPost, mintSession, verifyGoogleIdToken } from '@/lib/auth';
import { exchangeGoogleCode } from '@/lib/googleOAuth';

/**
 * Google redirects here after consent. Exchange the code, verify the id_token,
 * and hand the app a session over its custom URL scheme.
 *
 * The session goes in the URL **fragment**, like the eBay callback's tokens:
 * fragments aren't sent to servers and don't land in request logs.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const error = params.get('error');
  if (error) {
    // The seller tapped "Cancel" on Google's sheet; not worth a 500.
    return Response.redirect(
      `easylisting://auth#error=${encodeURIComponent(error)}`,
      302,
    );
  }

  const code = params.get('code');
  if (!code) {
    return Response.json({ error: 'Missing authorization code.' }, { status: 400 });
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    if (!tokens.id_token) throw new Error('Google returned no id_token');

    const email = await verifyGoogleIdToken(tokens.id_token);
    const sessionToken = await mintSession({ email, provider: 'google' });

    const fragment = new URLSearchParams({
      session: sessionToken,
      email,
      can_post: String(isAllowedToPost(email)),
    });
    return Response.redirect(`easylisting://auth#${fragment.toString()}`, 302);
  } catch (err) {
    console.error('google callback failed', err);
    return Response.redirect(
      `easylisting://auth#error=${encodeURIComponent('Google sign-in failed.')}`,
      302,
    );
  }
}
