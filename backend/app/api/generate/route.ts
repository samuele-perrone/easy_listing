import { generateListings } from '@/lib/generate';
import { isExhaustedForTheDay } from '@/lib/backoff';
import { quotaExhaustedBody } from '@/lib/generateErrors';
import { checkUsage, normaliseInstallId, recordUsage } from '@/lib/usage';
import { AuthError, authoriseGeneration } from '@/lib/auth';

export const maxDuration = 300;

/**
 * The synchronous route, kept for builds already installed. New builds use
 * /api/generate/start and poll — see lib/generate.ts.
 */
export async function POST(request: Request) {
  try {
    // Before the body is even read: generation can reach a paid model, so the
    // caller has to be a verified, allow-listed account first.
    await authoriseGeneration(request);

    const { images, notes } = (await request.json()) as { images: string[]; notes?: string[] };
    if (!images?.length) {
      return Response.json({ error: 'No images provided.' }, { status: 400 });
    }

    const installId = normaliseInstallId(request.headers.get('x-install-id'));
    const usage = await checkUsage(installId);
    if (!usage.allowed) {
      return Response.json({ error: usage.error, fix: usage.fix }, { status: 429 });
    }
    await recordUsage(installId);

    return Response.json(await generateListings(images, notes));
  } catch (error) {
    // Not signed in or not allow-listed — a refusal, not a fault, so it
    // shouldn't land in the error log as though generation broke.
    if (error instanceof AuthError) {
      return Response.json({ error: error.message }, { status: 403 });
    }

    console.error('generate failed', error);

    if (isExhaustedForTheDay(error)) {
      return Response.json(quotaExhaustedBody(), { status: 429 });
    }

    return Response.json({ error: 'Listing generation failed. Please try again.' }, { status: 500 });
  }
}
