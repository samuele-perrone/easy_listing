import { waitUntil } from '@vercel/functions';
import { generateListings } from '@/lib/generate';
import { isExhaustedForTheDay } from '@/lib/backoff';
import { genericFailureBody, quotaExhaustedBody } from '@/lib/generateErrors';
import { newJobId, writeJob } from '@/lib/jobs';

export const maxDuration = 300;

/**
 * Starts a generation and answers immediately with an id to poll.
 *
 * The synchronous route made the phone hold a connection open for as long as
 * the provider took, and connections that ran past about a minute were being
 * cut — the seller saw "The network connection was lost" while the server was
 * still working, and lost their photos with it. Here the answer is instant and
 * the work continues under `waitUntil`, so a slow provider costs a longer wait
 * rather than a failed request.
 */
export async function POST(request: Request) {
  const { images, notes } = (await request.json()) as { images: string[]; notes?: string[] };
  if (!images?.length) {
    return Response.json({ error: 'No images provided.' }, { status: 400 });
  }

  const jobId = newJobId();
  await writeJob(jobId, { status: 'pending', startedAt: new Date().toISOString() });

  waitUntil(
    (async () => {
      try {
        // Nothing is holding a connection open here — the app polls — so the
        // only real ceiling is maxDuration. The short budget belongs to the
        // synchronous route, and inheriting it meant the paid fallback was
        // reached and then cut off mid-generation: Sonnet with four images and
        // a full four-platform response doesn't finish inside 35s.
        const result = await generateListings(images, notes, {
          budgetMs: 240_000,
          perCallTimeoutMs: 90_000,
        });
        await writeJob(jobId, {
          status: 'ready',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          result,
        });
      } catch (error) {
        console.error(`generate job ${jobId} failed`, error);
        const body = isExhaustedForTheDay(error) ? quotaExhaustedBody() : genericFailureBody();
        await writeJob(jobId, {
          status: 'failed',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          ...body,
        });
      }
    })(),
  );

  return Response.json({ jobId }, { status: 202 });
}
