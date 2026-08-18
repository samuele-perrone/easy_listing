import { EBAY } from '@/lib/ebay';

// Sends the user to eBay's consent page. eBay redirects back to the RuName,
// whose "Your auth accepted URL" must point at /api/ebay/callback.
export function GET() {
  const url = new URL(`${EBAY.authHost}/oauth2/authorize`);
  url.searchParams.set('client_id', process.env.EBAY_CLIENT_ID ?? '');
  url.searchParams.set('redirect_uri', process.env.EBAY_RU_NAME ?? '');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', EBAY.scopes);
  return Response.redirect(url.toString(), 302);
}
