import { z } from 'zod';

export const listingFieldSchema = z.object({
  label: z.string().describe('The exact field name as it appears in the platform listing form'),
  value: z.string().describe('Ready-to-paste content for that field'),
});

export const PLATFORMS = ['ebay', 'vinted', 'gumtree', 'facebook'] as const;

/**
 * Where this particular item is worth listing, and roughly what it fetches
 * there. Ranked rather than scored: the seller's question is "which one", and a
 * rank answers it without pretending to a precision nobody has.
 *
 * Deliberately loose about `rank` and completeness — the model drops or
 * duplicates a rank often enough that validating it would throw away a good
 * listing over bookkeeping. `normaliseMarketFit()` tidies it instead.
 */
export const marketFitSchema = z.object({
  bestPlatform: z.enum(PLATFORMS).describe('Where this item should fetch the most'),
  summary: z
    .string()
    .describe('One sentence on why that platform pays best for THIS item, in plain language'),
  platforms: z.array(
    z.object({
      platform: z.enum(PLATFORMS),
      rank: z.number().describe('1 = pays best. Rank every platform.'),
      estimatedLow: z.number().describe('Realistic lower end a seller actually gets, GBP'),
      estimatedHigh: z.number().describe('Realistic upper end, GBP'),
      reason: z
        .string()
        .describe('Short reason — who shops there, postage vs collection, reach, fees'),
    }),
  ),
});

export const generateResultSchema = z.object({
  title: z.string().describe('Short internal name for the item, e.g. "Levi\'s 501 jeans, dark blue, W32"'),
  summary: z.string().describe('One or two sentences describing the item and its condition'),
  listings: z.array(
    z.object({
      platform: z.enum(['ebay', 'vinted', 'gumtree', 'facebook']),
      fields: z.array(listingFieldSchema),
    }),
  ),
  marketFit: marketFitSchema,
  ebayDraft: z.object({
    // Deliberately NOT .max(80): as a validator it discarded an entire good
    // generation over a two-character overshoot. fitEbayTitle() applies eBay's
    // real limit instead, trimming at a word boundary.
    title: z.string().describe('eBay listing title, aim for 80 characters or fewer'),
    description: z.string().describe('Full eBay item description'),
    condition: z
      .enum(['NEW', 'LIKE_NEW', 'USED_EXCELLENT', 'USED_VERY_GOOD', 'USED_GOOD', 'USED_ACCEPTABLE', 'FOR_PARTS_OR_NOT_WORKING'])
      .describe('eBay condition enum'),
    price: z.number().describe('Suggested asking price'),
    currency: z.string().describe('ISO currency code, e.g. GBP'),
    categoryQuery: z.string().describe('Short phrase to find the right eBay category, e.g. "mens jeans"'),
  }),
});

export type GenerateResult = z.infer<typeof generateResultSchema>;
