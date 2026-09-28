import { generateText, Output } from 'ai';
import { generateResultSchema } from '@/lib/schema';
import { isExhaustedForTheDay } from '@/lib/backoff';
import { runWithProviders } from '@/lib/provider';
import { fitEbayTitle } from '@/lib/ebayTitle';
import { normaliseMarketFit } from '@/lib/marketFit';

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
- Descriptions: eBay slightly formal with specs; Vinted short and friendly; Gumtree and Facebook plain and local-friendly.

Also rank the four platforms by what this specific item would actually net the seller (marketFit).
Rank all four, 1 = pays best, and give a realistic GBP range for each. What moves the number:
- Who shops there. Vinted is clothing, shoes, bags and kidswear to people hunting brands; eBay is
  everything, and the only one with real demand for electronics, parts, collectables and niche items;
  Gumtree and Facebook Marketplace are local buyers, mostly furniture, white goods, bikes, garden and
  bulky things nobody wants to post.
- Postage. Anything heavy or awkward loses its margin to shipping, which pushes it towards the local
  platforms even when a national audience would pay more. Small and light favours Vinted and eBay.
- Reach versus speed. eBay's audience is the largest, so rare or specific items find their buyer
  there; a common item may simply sell faster locally for slightly less.
- Fees and payouts differ per platform and change often — factor them in generally, but do not quote
  specific fee percentages, because you cannot know today's rates.
Be honest about the ranges: they are estimates from the photos, not sold-price data. If the item is
one where condition or a hidden detail would swing the price a lot, say so in the reason.`;

export async function POST(request: Request) {
  try {
    const { images, notes } = (await request.json()) as { images: string[]; notes?: string[] };
    if (!images?.length) {
      return Response.json({ error: 'No images provided.' }, { status: 400 });
    }

    const note = notes?.join(' ').trim();
    const { output } = await runWithProviders(
      (model, abortSignal) =>
        generateText({
          // Without this a hung provider call runs until Vercel's 300s limit.
          abortSignal,
          // Own the retry timing rather than letting the SDK burn all three
          // attempts in a few seconds — see lib/backoff.ts.
          maxRetries: 0,
          model,
          output: Output.object({ schema: generateResultSchema }),
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                ...images.slice(0, 12).map((image) => ({
                  type: 'file' as const,
                  mediaType: 'image/jpeg',
                  data: image,
                })),
                {
                  type: 'text' as const,
                  text: note
                    ? `Create the listings for this item. Seller notes: ${note}`
                    : 'Create the listings for this item.',
                },
              ],
            },
          ],
        }),
      { label: 'generate' },
    );

    return Response.json({
      ...output,
      marketFit: normaliseMarketFit(output.marketFit),
      ebayDraft: { ...output.ebayDraft, title: fitEbayTitle(output.ebayDraft.title) },
    });
  } catch (error) {
    console.error('generate failed', error);

    // "Try again" is wrong advice for the daily cap — nothing clears it until
    // the quota resets, so say so rather than sending the seller round a loop.
    if (isExhaustedForTheDay(error)) {
      return Response.json(
        {
          error: 'Today’s listing generations have run out.',
          fix: 'The free allowance resets daily. Try again tomorrow, or add a paid API key to the backend.',
        },
        { status: 429 },
      );
    }

    return Response.json({ error: 'Listing generation failed. Please try again.' }, { status: 500 });
  }
}
