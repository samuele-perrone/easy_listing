import { z } from 'zod';

export const listingFieldSchema = z.object({
  label: z.string().describe('The exact field name as it appears in the platform listing form'),
  value: z.string().describe('Ready-to-paste content for that field'),
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
  ebayDraft: z.object({
    title: z.string().max(80).describe('eBay listing title, max 80 chars'),
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
