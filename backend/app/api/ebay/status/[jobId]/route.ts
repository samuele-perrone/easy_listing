import { readJob } from '@/lib/jobs';

/**
 * Polled by the app until an eBay post stops being pending.
 *
 * Deliberately not gated: the job id is a random UUID the caller already holds,
 * it carries no credentials, and gating it would break a phone that was
 * relaunched after its session expired — exactly when it most needs to find out
 * whether the listing went live.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  const job = await readJob(jobId);
  if (!job) {
    return Response.json({ error: 'That eBay post has expired.' }, { status: 404 });
  }

  return Response.json(job);
}
