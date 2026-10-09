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
 * Condition grades grouped into families, ordered best → worst.
 *
 * A fallback must never leave its family: listing a used item as NEW because
 * NEW happened to be the first grade the category allowed is worse than not
 * listing it at all. See `pickCondition`.
 */
const CONDITION_FAMILIES: string[][] = [
  ['NEW', 'NEW_OTHER', 'NEW_WITH_DEFECTS'],
  ['CERTIFIED_REFURBISHED', 'SELLER_REFURBISHED'],
  ['LIKE_NEW', 'USED_EXCELLENT', 'USED_VERY_GOOD', 'USED_GOOD', 'USED_ACCEPTABLE', 'FOR_PARTS_OR_NOT_WORKING'],
];

/** Upper case, separators collapsed to "_", punctuation dropped. */
function canonical(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s\-–—/]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Human condition wording → the Inventory API enum.
 *
 * The generated listing carries the condition twice: `ebayDraft.condition` is
 * schema-constrained to a real enum, but the *visible* "Condition" field is
 * free text, and the app posts whatever is on screen so that edits are honoured
 * (`editedEbayDraft`). The model writes that field in each platform's own
 * vocabulary — "Used", "Very good", "Used - like new" — so the value arriving
 * here is often a label rather than an enum. eBay answers error 2004
 * "Could not serialize field [condition]" for anything it can't parse.
 */
const CONDITION_SYNONYMS: Record<string, string> = {
  // eBay's own display labels
  USED: 'USED_EXCELLENT',
  BRAND_NEW: 'NEW',
  NEW_OTHER_SEE_DETAILS: 'NEW_OTHER',
  OPEN_BOX: 'NEW_OTHER',
  OPENED_BOX: 'NEW_OTHER',
  EXCELLENT: 'USED_EXCELLENT',
  VERY_GOOD: 'USED_VERY_GOOD',
  GOOD: 'USED_GOOD',
  ACCEPTABLE: 'USED_ACCEPTABLE',
  // Vinted's scale
  NEW_WITH_TAGS: 'NEW',
  NEW_WITHOUT_TAGS: 'NEW_OTHER',
  SATISFACTORY: 'USED_ACCEPTABLE',
  // Facebook's scale
  USED_LIKE_NEW: 'LIKE_NEW',
  USED_FAIR: 'USED_ACCEPTABLE',
  FAIR: 'USED_ACCEPTABLE',
  // Refurbished phrasings
  REFURBISHED: 'SELLER_REFURBISHED',
  MANUFACTURER_REFURBISHED: 'CERTIFIED_REFURBISHED',
  // Broken / spares
  FOR_PARTS: 'FOR_PARTS_OR_NOT_WORKING',
  FOR_PARTS_ONLY: 'FOR_PARTS_OR_NOT_WORKING',
  NOT_WORKING: 'FOR_PARTS_OR_NOT_WORKING',
  SPARES_OR_REPAIR: 'FOR_PARTS_OR_NOT_WORKING',
  SPARES_OR_REPAIRS: 'FOR_PARTS_OR_NOT_WORKING',
  BROKEN: 'FOR_PARTS_OR_NOT_WORKING',
};

/**
 * Resolves any condition wording to an Inventory API enum, or `undefined` when
 * it can't be recognised. Deliberately does not guess: condition drives price
 * and buyer expectations, so overstating it on a live listing is a real harm.
 */
export function normaliseCondition(raw: string): string | undefined {
  const key = canonical(raw);
  if (!key) return undefined;
  if (key in CONDITION_IDS) return key;
  return CONDITION_SYNONYMS[key];
}

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

  // Nothing explicit fits, so step through the desired grade's own family,
  // nearest grade first. Staying inside the family is the point: the previous
  // version took the first allowed grade in enum order, which listed a
  // for-parts item as NEW whenever the category permitted NEW.
  const family = CONDITION_FAMILIES.find((grades) => grades.includes(desired));
  if (family) {
    const from = family.indexOf(desired);
    const nearestFirst = [...family].sort(
      (a, b) => Math.abs(family.indexOf(a) - from) - Math.abs(family.indexOf(b) - from),
    );
    const found = nearestFirst.find(accepts);
    if (found) return found;
  }

  // Out of options. Returning the valid enum lets eBay answer 25021 ("condition
  // invalid for this category"), which translates into something actionable —
  // better than inventing a grade the seller didn't choose.
  return desired;
}

/** Used when the category's policy can't be read: avoid the media-only grades. */
export function safeConditionWithoutPolicy(desired: string): string {
  return MEDIA_ONLY_CONDITIONS.includes(desired) ? 'USED_EXCELLENT' : desired;
}
