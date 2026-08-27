// Inventory API condition enum → eBay's numeric condition ID.
export const CONDITION_IDS: Record<string, string> = {
  NEW: '1000',
  NEW_OTHER: '1500',
  NEW_WITH_DEFECTS: '1750',
  CERTIFIED_REFURBISHED: '2000',
  SELLER_REFURBISHED: '2500',
  LIKE_NEW: '2750',
  USED_EXCELLENT: '3000',
  USED_VERY_GOOD: '4000',
  USED_GOOD: '5000',
  USED_ACCEPTABLE: '6000',
  FOR_PARTS_OR_NOT_WORKING: '7000',
};

// The granular used grades only exist for media categories, so most categories
// reject anything but USED_EXCELLENT ("Used"). Degrade to the nearest accepted grade.
const CONDITION_FALLBACKS: Record<string, string[]> = {
  LIKE_NEW: ['USED_EXCELLENT', 'NEW_OTHER', 'NEW'],
  USED_VERY_GOOD: ['USED_EXCELLENT', 'USED_GOOD'],
  USED_GOOD: ['USED_EXCELLENT', 'USED_ACCEPTABLE'],
  USED_ACCEPTABLE: ['USED_EXCELLENT', 'FOR_PARTS_OR_NOT_WORKING'],
  USED_EXCELLENT: ['USED_GOOD', 'USED_VERY_GOOD'],
  NEW_OTHER: ['NEW'],
  NEW_WITH_DEFECTS: ['NEW_OTHER', 'NEW'],
  CERTIFIED_REFURBISHED: ['SELLER_REFURBISHED', 'USED_EXCELLENT'],
  SELLER_REFURBISHED: ['USED_EXCELLENT'],
};

/** Grades eBay only permits on media categories (books, DVDs, games). */
export const MEDIA_ONLY_CONDITIONS = [
  'USED_VERY_GOOD',
  'USED_GOOD',
  'USED_ACCEPTABLE',
  'LIKE_NEW',
];

/**
 * Chooses a condition the category accepts, given the condition ids eBay says
 * are allowed there. Keeps the seller's choice when it's legal, otherwise steps
 * to the closest grade rather than failing the listing.
 */
export function pickCondition(allowedIds: string[], desired: string): string {
  if (allowedIds.length === 0) return desired;

  const accepts = (name: string) => allowedIds.includes(CONDITION_IDS[name] ?? '');
  if (accepts(desired)) return desired;

  for (const candidate of CONDITION_FALLBACKS[desired] ?? []) {
    if (accepts(candidate)) return candidate;
  }
  return Object.keys(CONDITION_IDS).find(accepts) ?? desired;
}

/** Used when the category's policy can't be read: avoid the media-only grades. */
export function safeConditionWithoutPolicy(desired: string): string {
  return MEDIA_ONLY_CONDITIONS.includes(desired) ? 'USED_EXCELLENT' : desired;
}
