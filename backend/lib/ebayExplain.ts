import { generateText, Output } from 'ai';
import { z } from 'zod';
import { runWithProviders } from '@/lib/provider';

/**
 * Asks a model to explain an eBay failure we have no mapping for.
 *
 * eBay's own text is frequently wrong about its own errors. Error 25019 says
 * the title or description "may contain improper words"; it has twice meant
 * something else entirely — once a miscategorised accessory, once a smart watch
 * whose title mentioned the charger in the box. A seller reading the raw
 * message is being actively misled.
 *
 * The hand-written table in `ebayErrors.ts` stays the first choice: it is free,
 * instant, and known-correct for the errors we have actually diagnosed. This
 * runs only for the ones we haven't, where the alternative is showing eBay's
 * guess.
 */

const explanationSchema = z.object({
  error: z
    .string()
    .describe('One sentence, plain English, saying what eBay actually objected to. No jargon, no error codes.'),
  fix: z
    .string()
    .describe(
      'What the seller should change, naming the field where possible (Title, Description, Condition, Price, Category). One or two sentences. If the payload does not say, state that plainly rather than guessing.',
    ),
});

export interface ExplainContext {
  /** What we were doing, e.g. "Publishing the listing". */
  action: string;
  title?: string;
  categoryQuery?: string;
}

const SYSTEM_PROMPT = `You explain eBay Sell API errors to a person selling one second-hand item.

You will be given the raw JSON error and the listing it came from.

Rules:
- Explain what eBay objected to, in plain English. The seller is not a developer.
- eBay's own "message" and "longMessage" are often wrong or generic. The real
  reason is usually in "parameters". Trust the parameters over the message.
- Point at the specific text that caused it when you can see it. If the listing
  title contains a word eBay is complaining about, quote that word.
- Name the field the seller should edit: Title, Description, Condition, Price or
  Category.
- Never invent a cause. If the payload genuinely does not say why, say that the
  error does not explain itself and suggest contacting support.
- Never tell the seller to contact eBay unless the payload says the account or
  listing is restricted.`;

/**
 * Returns an explanation, or undefined if one couldn't be produced.
 *
 * Deliberately swallows every failure: this runs while a seller is already
 * looking at an error, and a provider being busy must not turn one failure into
 * two. The caller falls back to the existing message.
 */
export async function explainEbayError(
  raw: string,
  context: ExplainContext,
): Promise<{ error: string; fix: string } | undefined> {
  try {
    const listing = [
      context.title ? `Listing title: ${context.title}` : '',
      context.categoryQuery ? `Category searched for: ${context.categoryQuery}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const { output } = await runWithProviders(
      (model, abortSignal) =>
        generateText({
          abortSignal,
          maxRetries: 0,
          model,
          output: Output.object({ schema: explanationSchema }),
          system: SYSTEM_PROMPT,
          prompt: `We were ${context.action.toLowerCase()} when eBay returned this.\n\n${listing}\n\nRaw error:\n${raw.slice(0, 6000)}`,
        }),
      {
        label: 'ebay-error',
        // Short: the seller is staring at a spinner that has already failed
        // once. Better to show eBay's own wording than to keep them waiting.
        budgetMs: 12_000,
        perCallTimeoutMs: 8_000,
      },
    );

    if (!output?.error || !output?.fix) return undefined;
    return { error: output.error.trim(), fix: output.fix.trim() };
  } catch (error) {
    console.log(
      'could not explain eBay error —',
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}
