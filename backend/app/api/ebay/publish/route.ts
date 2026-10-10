import { EBAY, ebayHeaders, listingViewURL } from '@/lib/ebay';
import { EbayApiError, toFriendly } from '@/lib/ebayErrors';
import { AuthError, authoriseEbayPost } from '@/lib/auth';

export const maxDuration = 300;

// Publishes a previously created (draft) offer.
export async function POST(request: Request) {
  try {
    // Publishing a draft makes it live, so it needs the same allow-list as a
    // direct post — see authoriseEbayPost.
    const caller = await authoriseEbayPost(request);

    const { accessToken, offerId } = (await request.json()) as { accessToken?: string; offerId?: string };
    if (!accessToken || !offerId) {
      return Response.json({ error: 'Missing accessToken or offerId.' }, { status: 400 });
    }
    const response = await fetch(`${EBAY.apiHost}/sell/inventory/v1/offer/${offerId}/publish`, {
      method: 'POST',
      headers: ebayHeaders(accessToken),
    });
    console.log(`eBay draft publish requested by ${caller.email ?? 'an unauthenticated build'}`);
    if (!response.ok) throw new EbayApiError('Publishing the listing', await response.text());
    const { listingId } = await response.json();
    return Response.json({ listingId, viewURL: listingViewURL(listingId) });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    console.error('ebay publish failed', error);
    return Response.json(toFriendly(error, 'Publishing the listing'), { status: 500 });
  }
}
