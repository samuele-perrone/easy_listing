import { put } from '@vercel/blob';
import { createListing, listingViewURL, type DraftInput } from '@/lib/ebay';
import { toFriendly } from '@/lib/ebayErrors';
import { AuthError, authoriseEbayPost } from '@/lib/auth';

export const maxDuration = 300;

interface Body {
  accessToken: string;
  publish: boolean;
  draft: DraftInput;
  images: string[]; // base64 JPEGs
}

export async function POST(request: Request) {
  try {
    // Before anything else, and before any work that costs money: publishing
    // spends the seller's own eBay account, so the allow-list is enforced here
    // rather than only by hiding the button in the app.
    const caller = await authoriseEbayPost(request);

    const { accessToken, publish, draft, images } = (await request.json()) as Body;
    if (!accessToken || !draft || !images?.length) {
      return Response.json({ error: 'Missing accessToken, draft, or images.' }, { status: 400 });
    }
    console.log(`eBay ${publish ? 'publish' : 'draft'} requested by ${caller.email ?? 'an unauthenticated build'}`);

    // eBay's Inventory API takes image URLs, so host the photos on Vercel Blob first.
    const imageUrls: string[] = [];
    for (const [index, base64] of images.slice(0, 12).entries()) {
      const blob = await put(
        `listings/${Date.now()}-${index}.jpg`,
        Buffer.from(base64, 'base64'),
        { access: 'public', contentType: 'image/jpeg' },
      );
      imageUrls.push(blob.url);
    }

    const result = await createListing(accessToken, draft, imageUrls, publish);
    return Response.json({
      offerId: result.offerId,
      listingId: result.listingId ?? null,
      viewURL: result.listingId ? listingViewURL(result.listingId) : null,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    console.error('ebay post failed', error);
    return Response.json(toFriendly(error, 'Posting to eBay'), { status: 500 });
  }
}
