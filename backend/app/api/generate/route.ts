import { generateListings } from '@/lib/generate';
import { isExhaustedForTheDay } from '@/lib/backoff';
import { quotaExhaustedBody } from '@/lib/generateErrors';

export const maxDuration = 300;

/**
 * The synchronous route, kept for builds already installed. New builds use
 * /api/generate/start and poll — see lib/generate.ts.
 */
export async function POST(request: Request) {
  try {
    const { images, notes } = (await request.json()) as { images: string[]; notes?: string[] };
    if (!images?.length) {
      return Response.json({ error: 'No images provided.' }, { status: 400 });
    }

    return Response.json(await generateListings(images, notes));
  } catch (error) {
    console.error('generate failed', error);

    if (isExhaustedForTheDay(error)) {
      return Response.json(quotaExhaustedBody(), { status: 429 });
    }

    return Response.json({ error: 'Listing generation failed. Please try again.' }, { status: 500 });
  }
}
