import { googleRedirectURI } from '@/lib/googleOAuth';

/**
 * Sends the seller to Google's consent page.
 *
 * Deliberately the web flow rather than the GoogleSignIn SDK: it needs no new
 * dependency in the app, keeps the client secret on the server, and is the same
 * shape as the eBay sign-in already here (ASWebAuthenticationSession → this
 * redirect → callback → custom URL scheme).
 */
export function GET() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) {
    return Response.json({ error: 'GOOGLE_OAUTH_CLIENT_ID is not configured.' }, { status: 500 });
  }

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', googleRedirectURI());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
  // Always show the chooser: on a shared or multi-account phone, silently
  // reusing the last Google account is how you end up signed in as someone else.
  url.searchParams.set('prompt', 'select_account');
  return Response.redirect(url.toString(), 302);
}
