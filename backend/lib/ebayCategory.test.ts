import { describe, expect, it } from 'vitest';
import { looksLikeAccessory, pickCategory } from './ebayCategory';

/** Shaped like eBay's get_category_suggestions response. */
const WATCH_FIRST = [
  { category: { categoryId: '178893', categoryName: 'Smart Watches' },
    categoryTreeNodeAncestors: [{ categoryName: 'Mobile Phones & Communication' }] },
  { category: { categoryId: '182066', categoryName: 'Smart Watch Bands' },
    categoryTreeNodeAncestors: [
      { categoryName: 'Smart Watch Accessories' },
      { categoryName: 'Mobile Phones & Communication' },
    ] },
];

describe('pickCategory', () => {
  it('prefers the accessories branch for an accessory, even when ranked lower', () => {
    // The 16 Oct 2026 failure: eBay ranked Smart Watches first for an Apple
    // Watch band, then rejected the publish with LP_Miscat_SmartWatch_Accessories.
    expect(pickCategory(WATCH_FIRST, 'Apple Watch band')).toBe('182066');
    expect(pickCategory(WATCH_FIRST, 'silicone watch strap')).toBe('182066');
  });

  it('leaves eBay’s ranking alone for an actual product', () => {
    expect(pickCategory(WATCH_FIRST, 'Apple Watch Series 9')).toBe('178893');
    expect(pickCategory(WATCH_FIRST, 'smart watch')).toBe('178893');
  });

  it('falls back to the top suggestion when no accessories branch exists', () => {
    const noAccessory = [{ category: { categoryId: '1', categoryName: 'Smart Watches' } }];
    expect(pickCategory(noAccessory, 'watch band')).toBe('1');
  });

  it('returns undefined only when there is nothing to pick', () => {
    expect(pickCategory([], 'anything')).toBeUndefined();
  });
});

describe('looksLikeAccessory', () => {
  it('spots the usual accessory words, singular and plural', () => {
    for (const q of ['Apple Watch band', 'phone case', 'laptop sleeve', 'charging cable',
                     'screen protector', 'watch straps', 'camera lens cap']) {
      expect(looksLikeAccessory(q), q).toBe(true);
    }
  });

  it('does not fire on the products themselves', () => {
    for (const q of ['Apple Watch Series 9', 'iPhone 15 Pro', 'Levi 501 jeans',
                     'Trunki ToddlePak backpack', 'kids barefoot shoes']) {
      expect(looksLikeAccessory(q), q).toBe(false);
    }
  });

  it('matches whole words only, so "bandana" is not a band', () => {
    expect(looksLikeAccessory('silk bandana')).toBe(false);
    expect(looksLikeAccessory('bookcase')).toBe(false);
  });
});
