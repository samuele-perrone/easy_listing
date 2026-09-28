import { get, put } from '@vercel/blob';
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
  });
}

export async function readJob(id: string): Promise<JobState | null> {
  // useCache: false — a cached read would keep answering "pending" after the
  // job finished, which is the one thing polling must never do.
  const blob = await get(pathFor(id), { access: 'public', useCache: false });
  if (!blob || blob.statusCode !== 200) return null;

  const text = await new Response(blob.stream).text();
  try {
    return JSON.parse(text) as JobState;
  } catch {
    return null;
  }
}
