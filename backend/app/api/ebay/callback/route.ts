import { exchangeCodeForTokens } from '@/lib/ebay';

// eBay redirects here after consent. We exchange the code for tokens and hand
// them to the iOS app via its custom URL scheme, in the fragment so they never
// appear in server logs.
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get('code');
  if (!code) {
    return Response.json({ error: 'Missing authorization code.' }, { status: 400 });
  }
  try {
    const tokens = await exchangeCodeForTokens(code);
    const fragment = new URLSearchParams({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? '',
      expires_in: String(tokens.expires_in),
    });
    return Response.redirect(`easylisting://ebay-auth#${fragment.toString()}`, 302);
  } catch (error) {
    console.error('ebay callback failed', error);
    return Response.json({ error: 'eBay authentication failed.' }, { status: 500 });
  }
}
