/** Google OAuth bits shared by the login redirect and its callback. */

/**
 * Must match a redirect URI registered on the OAuth client exactly, including
 * the scheme and any trailing path. `GOOGLE_OAUTH_REDIRECT_URI` overrides it
 * for preview deployments, which have their own hostnames.
 */
export function googleRedirectURI(): string {
  return (
    process.env.GOOGLE_OAUTH_REDIRECT_URI ??
    'https://easy-listing-chi.vercel.app/api/auth/google/callback'
  );
}

export interface GoogleTokens {
  id_token?: string;
}

export async function exchangeGoogleCode(code: string): Promise<GoogleTokens> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not configured');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: googleRedirectURI(),
      grant_type: 'authorization_code',
    }),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${await response.text()}`);
  }
  return response.json();
}
