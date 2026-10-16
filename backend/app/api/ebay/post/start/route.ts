import { waitUntil } from '@vercel/functions';
import { put } from '@vercel/blob';
import { createListing, listingViewURL, type DraftInput } from '@/lib/ebay';
import { EbayApiError, toFriendly } from '@/lib/ebayErrors';
import { explainIfUnmapped } from '@/lib/ebayFriendly';
import { AuthError, authoriseEbayPost } from '@/lib/auth';
import { newJobId, writeJob } from '@/lib/jobs';

export const maxDuration = 300;

interface Body {
  accessToken: string;
  publish: boolean;
  draft: DraftInput;
  images: string[];
}

/**
 * Starts an eBay post and answers immediately with an id to poll.
 *
 * Same reasoning as `/api/generate/start`: the synchronous route makes the
 * phone hold a connection open for the whole chain — inventory item, category,
 * condition policy, aspects, policies, location, offer, publish — which can run
 * past a minute. Leaving the app suspends it, the connection dies, and the
 * seller has no idea whether their item went live. Here the work continues
 * under `waitUntil` and the phone can be closed.
 *
 * `POST /api/ebay/post` is unchanged and still live, because builds already on
 * phones call it.
 */
export async function POST(request: Request) {
  let caller;
  try {
    caller = await authoriseEbayPost(request);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: 403 });
    }
    throw error;
  }

  const { accessToken, publish, draft, images } = (await request.json()) as Body;
  if (!accessToken || !draft || !images?.length) {
    return Response.json({ error: 'Missing accessToken, draft, or images.' }, { status: 400 });
  }

  const jobId = newJobId();
  await writeJob(jobId, { status: 'pending', startedAt: new Date().toISOString() });
  console.log(`eBay ${publish ? 'publish' : 'draft'} job ${jobId} started by ${caller.email}`);

  waitUntil(
    (async () => {
      try {
        // Inside the job, not before it: uploading a dozen photos is itself
        // slow enough to be worth not making the phone wait for.
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
        await writeJob(jobId, {
          status: 'ready',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          ebayResult: {
            offerId: result.offerId,
            listingId: result.listingId ?? null,
            viewURL: result.listingId ? listingViewURL(result.listingId) : null,
            published: Boolean(result.listingId),
          },
        });
      } catch (error) {
        console.error(`eBay job ${jobId} failed`, error);
        const friendly = toFriendly(error, 'Posting to eBay');
        const explained = await explainIfUnmapped(friendly, error, {
          action: 'Posting to eBay',
          title: draft.title,
          categoryQuery: draft.categoryQuery,
        });
        await writeJob(jobId, {
          status: 'failed',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: explained.error,
          fix: explained.fix,
        });
      }
    })(),
  );

  return Response.json({ jobId }, { status: 202 });
}
