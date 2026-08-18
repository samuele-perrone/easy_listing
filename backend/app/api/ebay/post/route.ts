import { put } from '@vercel/blob';
import { createListing, listingViewURL, type DraftInput } from '@/lib/ebay';

export const maxDuration = 300;

interface Body {
  accessToken: string;
  publish: boolean;
  draft: DraftInput;
  images: string[]; // base64 JPEGs
}

export async function POST(request: Request) {
  try {
    const { accessToken, publish, draft, images } = (await request.json()) as Body;
    if (!accessToken || !draft || !images?.length) {
      return Response.json({ error: 'Missing accessToken, draft, or images.' }, { status: 400 });
    }

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
    console.error('ebay post failed', error);
    const message = error instanceof Error ? error.message : 'Posting to eBay failed.';
    return Response.json({ error: message }, { status: 500 });
  }
}
