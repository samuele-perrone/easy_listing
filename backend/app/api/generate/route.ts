import { generateListings } from '@/lib/generate';
import { isExhaustedForTheDay } from '@/lib/backoff';
import { quotaExhaustedBody } from '@/lib/generateErrors';
import { checkUsage, recordUsage } from '@/lib/usage';
import { AuthError, accountKeyFor, authoriseGeneration } from '@/lib/auth';

export const maxDuration = 300;

/**
 * The synchronous route, kept for builds already installed. New builds use
 * /api/generate/start and poll — see lib/generate.ts.
 */
export async function POST(request: Request) {
  try {
    // Before the body is even read: generation can reach a paid model, so the
    // caller has to be a verified account first, and then within its allowance.
    const caller = await authoriseGeneration(request);

    const { images, notes } = (await request.json()) as { images: string[]; notes?: string[] };
    if (!images?.length) {
      return Response.json({ error: 'No images provided.' }, { status: 400 });
    }

    const account = { key: accountKeyFor(caller.user), email: caller.user.email };
    const usage = await checkUsage(account);
    if (!usage.allowed) {
      return Response.json({ error: usage.error, fix: usage.fix }, { status: 429 });
    }
    await recordUsage(account);

    return Response.json(await generateListings(images, notes));
  } catch (error) {
    // Not signed in — a refusal, not a fault, so it shouldn't land in the
    // error log as though generation broke.
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
