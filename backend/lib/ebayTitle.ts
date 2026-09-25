/** eBay rejects a listing title longer than this. */
export const EBAY_TITLE_MAX = 80;

/**
 * Trims a title to eBay's 80-character limit at a word boundary.
 *
 * This exists because enforcing the limit as a *validation* threw away good
 * work: the schema had `z.string().max(80)`, so a title two characters over
 * ("…Size EU 26 UK 8.5", 82 chars) failed the whole generation — a complete,
 * accurate four-platform listing discarded over two characters, with
 * `finishReason: 'stop'` proving the model had said everything it meant to.
 *
 * The limit is real, so it still has to be applied; it just belongs here rather
 * than in a validator. Cutting at a space also avoids the mid-word stumps a
 * plain `slice(0, 80)` leaves ("Size EU 26 UK 8."), which look like a bug to a
 * buyer reading the listing.
 */
export function fitEbayTitle(title: string, max: number = EBAY_TITLE_MAX): string {
  const collapsed = title.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;

  const cut = collapsed.slice(0, max);

  // If the limit happens to fall on a word boundary, the cut is already clean —
  // stepping back to the previous space here would drop a word for nothing.
  const endsCleanly = collapsed[max] === ' ';
  const lastSpace = cut.lastIndexOf(' ');
  // Keep whole words, unless the first "word" alone already overruns.
  const trimmed = endsCleanly || lastSpace <= 0 ? cut : cut.slice(0, lastSpace);

  // A title shouldn't end on the separator that preceded the dropped words.
  return trimmed.replace(/[\s,;:/&+\-–—|]+$/, '');
}
