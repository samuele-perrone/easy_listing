/**
 * Choosing among eBay's category suggestions.
 *
 * `get_category_suggestions` returns a ranked list, and taking the first was
 * enough until an Apple Watch *band* was filed under a smart watch category on
 * 16 Oct 2026. eBay rejected it with 25019 and the rule
 * `LP_Miscat_SmartWatch_Accessories`: accessories belong in the accessories
 * category, and eBay enforces that at publish time even though its own ranking
 * suggested otherwise.
 *
 * So when the item reads as an accessory, prefer the highest-ranked suggestion
 * that actually sits under an Accessories branch. eBay's ranking still decides
 * between equals — this only breaks the tie it keeps getting wrong.
 */

export interface CategorySuggestion {
  category?: { categoryId?: string; categoryName?: string };
  categoryTreeNodeAncestors?: { categoryName?: string }[];
}

/**
 * Words that mean "this is a thing that goes with another thing".
 *
 * Kept narrow on purpose. A false positive sends a real product into an
 * accessories category, which is its own miscategorisation — so a word only
 * belongs here if an item described by it is almost never the main product.
 */
const ACCESSORY_WORDS = [
  'band', 'strap', 'case', 'cover', 'charger', 'cable', 'screen protector',
  'protector', 'stand', 'holder', 'mount', 'dock', 'sleeve', 'pouch', 'lens cap',
  'adapter', 'bumper', 'skin', 'grip', 'lanyard',
];

export function looksLikeAccessory(text: string): boolean {
  const haystack = text.toLowerCase();
  return ACCESSORY_WORDS.some((word) => new RegExp(`\\b${word}s?\\b`).test(haystack));
}

function isAccessoryCategory(suggestion: CategorySuggestion): boolean {
  const names = [
    suggestion.category?.categoryName ?? '',
    ...(suggestion.categoryTreeNodeAncestors ?? []).map((a) => a.categoryName ?? ''),
  ];
  return names.some((name) => /accessor/i.test(name));
}

/**
 * Picks a category id from eBay's ranked suggestions.
 *
 * Returns undefined only when there is nothing to pick, so the caller can keep
 * its own "no category found" error.
 */
export function pickCategory(
  suggestions: CategorySuggestion[],
  query: string,
): string | undefined {
  if (!suggestions.length) return undefined;

  if (looksLikeAccessory(query)) {
    const accessory = suggestions.find(isAccessoryCategory);
    if (accessory?.category?.categoryId) return accessory.category.categoryId;
  }

  return suggestions[0]?.category?.categoryId;
}
