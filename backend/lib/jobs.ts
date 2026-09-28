import { put } from '@vercel/blob';
import type { GenerateResult } from '@/lib/schema';

export type JobStatus = 'pending' | 'ready' | 'failed';

export interface JobState {
  status: JobStatus;
  startedAt: string;
  finishedAt?: string;
  result?: GenerateResult;
  /** Seller-facing failure, same shape the synchronous route returns. */
  error?: string;
  fix?: string;
}

/**
 * Job state lives in Vercel Blob, which is already attached for listing photos.
 *
 * It's written with `access: 'public'` because the attached store is a public
 * one — it has to be, since eBay fetches listing photos from it by URL, and
 * `private` is rejected outright ("Cannot use private access on a public
 * store"). A second, private store would mean a second token env var next to
 * `BLOB_READ_WRITE_TOKEN`, with a real chance of clobbering the one the photo
 * upload depends on.
 *
 * That's an acceptable trade here, but for a specific reason rather than
 * convenience: a job holds a *draft of a listing the seller is about to publish
 * publicly*, keyed by a random UUID. It holds no credentials and nothing about
 * the seller. If this store ever holds something genuinely private, move jobs to
 * their own private store instead of widening what goes in here.
 */
const pathFor = (id: string) => `jobs/${id}.json`;

export function newJobId(): string {
  return crypto.randomUUID();
}

export async function writeJob(id: string, state: JobState): Promise<void> {
  await put(pathFor(id), JSON.stringify(state), {
    access: 'public',
    // The id is the only thing guarding the URL, so don't let Blob append a
    // random suffix — the app has to be able to address it back.
    addRandomSuffix: false,
    contentType: 'application/json',
    // The job is written at least twice: pending, then its outcome.
    allowOverwrite: true,
    // Polling reads this every few seconds, so it's served from the CDN rather
    // than origin — but it changes, so it can only be cached briefly.
    cacheControlMaxAge: 0,
  });
}

/**
 * Reads go straight to the blob's public URL, not through the Blob SDK.
 *
 * `get()` counts against the Blob *API* rate limit, and the app polls every
 * three seconds: measured 28 Sep 2026, a quarter of rapid polls came back
 * "403 Forbidden" while the same object over its public URL never failed once.
 * The app read that as a poll error, retried, and sat on a spinner — with a
 * finished listing already written in the store.
 *
 * The CDN has no such limit, so the read is a plain fetch. `cacheControlMaxAge:
 * 0` on the write is what keeps a finished job from being served as pending.
 *
 * `BLOB_PUBLIC_HOST` is the store's public hostname. It only changes if the Blob
 * store is replaced — at which point job polling 404s until it's updated.
 */
export async function readJob(id: string): Promise<JobState | null> {
  const host = process.env.BLOB_PUBLIC_HOST;
  if (!host) throw new Error('BLOB_PUBLIC_HOST is not set; job polling cannot read job state.');

  const url = `https://${host}/${pathFor(id)}`;

  // Even the CDN rate-limits a hammered object: rapid back-to-back reads of the
  // same job returned 403 about a third of the time, while the app's own
  // three-second cadence never did. A couple of quick attempts turn that into a
  // successful read rather than a failure the app has to interpret.
  let lastStatus = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { cache: 'no-store' });
    if (response.status === 404) return null;

    if (response.ok) {
      try {
        return (await response.json()) as JobState;
      } catch {
        return null;
      }
    }

    lastStatus = response.status;
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }

  throw new Error(`Job store read failed: ${lastStatus}`);
}
