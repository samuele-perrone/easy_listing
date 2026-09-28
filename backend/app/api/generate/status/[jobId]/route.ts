import { readJob } from '@/lib/jobs';

/**
 * Polled by the app until the job stops being pending. A job the store has
 * never heard of is a 404, so a phone holding a stale id gives up rather than
 * polling forever.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;

  const job = await readJob(jobId);
  if (!job) {
    return Response.json({ error: 'That generation has expired.' }, { status: 404 });
  }

  return Response.json(job);
}
