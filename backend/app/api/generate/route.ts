import { generateText, Output } from 'ai';
import { generateResultSchema } from '@/lib/schema';

export const maxDuration = 300;

const SYSTEM_PROMPT = `You are an expert second-hand marketplace seller in the UK.
Given photos of an item (and optional seller notes), produce complete, ready-to-paste
listings for four platforms. For each platform, output fields matching that platform's
actual listing form:

- ebay: Title (max 80 chars, keyword-rich), Description, Condition, Price, Category suggestion
- vinted: Title, Description (casual tone, include hashtags at the end), Brand, Size, Condition (Vinted's scale: New with tags / New without tags / Very good / Good / Satisfactory), Colour, Price
- gumtree: Ad title, Description, Condition (New / Used), Price
- facebook: Title, Description, Condition (New / Used - like new / Used - good / Used - fair), Category, Price

Rules:
- Be accurate: only state what is visible in the photos or given in the notes. Never invent brand, size, or flaws.
- If a detail matters but isn't visible (e.g. size label), write the field with a [CHECK: ...] placeholder so the seller fills it in.
- Mention visible flaws honestly — it reduces returns and disputes.
- Prices in GBP, realistic for the second-hand market.
- Descriptions: eBay slightly formal with specs; Vinted short and friendly; Gumtree and Facebook plain and local-friendly.`;

export async function POST(request: Request) {
  try {
    const { images, notes } = (await request.json()) as { images: string[]; notes?: string[] };
    if (!images?.length) {
      return Response.json({ error: 'No images provided.' }, { status: 400 });
    }

    const note = notes?.join(' ').trim();
    const { output } = await generateText({
      model: 'anthropic/claude-sonnet-5',
      output: Output.object({ schema: generateResultSchema }),
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            ...images.slice(0, 12).map((image) => ({ type: 'image' as const, image })),
            {
              type: 'text' as const,
              text: note
                ? `Create the listings for this item. Seller notes: ${note}`
                : 'Create the listings for this item.',
            },
          ],
        },
      ],
    });

    return Response.json(output);
  } catch (error) {
    console.error('generate failed', error);
    return Response.json({ error: 'Listing generation failed. Please try again.' }, { status: 500 });
  }
}
