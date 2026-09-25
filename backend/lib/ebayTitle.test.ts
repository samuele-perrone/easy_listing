import { describe, expect, it } from 'vitest';
import { EBAY_TITLE_MAX, fitEbayTitle } from './ebayTitle';

/** The real one: 82 characters, which used to fail the whole generation. */
const OVERLONG = 'Hobibear Kids Black Barefoot Shoes Trainers School Double Velcro Size EU 26 UK 8.5';

describe('fitEbayTitle', () => {
  it('leaves a title that already fits completely alone', () => {
        const fits = 'Moleskine Classic Notebook Large Ruled Hardcover Navy Blue';
    expect(fits.length).toBeLessThanOrEqual(EBAY_TITLE_MAX);
    expect(fitEbayTitle(fits)).toBe(fits);
  });

  it('keeps a title of exactly the limit', () => {
    const exact = 'x'.repeat(EBAY_TITLE_MAX);
    expect(fitEbayTitle(exact)).toBe(exact);
  });

  it('trims the title that broke generation, at a word boundary', () => {
    expect(OVERLONG.length).toBe(82);

    const fitted = fitEbayTitle(OVERLONG);
    expect(fitted.length).toBeLessThanOrEqual(EBAY_TITLE_MAX);
    // Whole words only — no "UK 8." stump from a mid-word cut.
    expect(fitted).toBe('Hobibear Kids Black Barefoot Shoes Trainers School Double Velcro Size EU 26 UK');
    expect(OVERLONG.startsWith(fitted)).toBe(true);
  });

  it('keeps the front of the title, where the searchable words are', () => {
    const fitted = fitEbayTitle(OVERLONG);
    expect(fitted.startsWith('Hobibear Kids Black Barefoot Shoes')).toBe(true);
  });

  it('never returns a title ending in a dangling separator', () => {
    const cases = [
      'Nike Air Max 90 Trainers White Black UK 9 Mens Running Shoes Excellent - Boxed',
      'Apple Watch Sport Band 44mm Black Silicone Genuine Original Spare Strap, Unused',
      'Levi 501 Jeans W32 L34 Dark Blue Straight Leg Mens Denim Vintage Made in USA / EU',
    ];
    for (const long of cases) {
      const fitted = fitEbayTitle(`${long} plus some more words here to push it over`);
      expect(fitted.length).toBeLessThanOrEqual(EBAY_TITLE_MAX);
      expect(fitted).not.toMatch(/[\s,;:/&+\-–—|]$/);
    }
  });

  it('collapses the whitespace a model sometimes emits', () => {
    expect(fitEbayTitle('  Moleskine   Classic    Notebook  ')).toBe('Moleskine Classic Notebook');
  });

  it('still fits when a single word is longer than the limit', () => {
    // No space to cut at, so it has to cut hard rather than return nothing.
    const oneWord = 'A'.repeat(120);
    expect(fitEbayTitle(oneWord)).toHaveLength(EBAY_TITLE_MAX);
  });

  it('holds the limit for any input', () => {
    const words = ['Vintage', 'Retro', 'Genuine', 'Leather', 'Jacket', 'Brown', 'Size', 'Medium'];
    for (let count = 1; count < 40; count += 1) {
      const title = Array.from({ length: count }, (_, i) => words[i % words.length]).join(' ');
      expect(fitEbayTitle(title).length).toBeLessThanOrEqual(EBAY_TITLE_MAX);
    }
  });

  it('honours a different limit when one is given', () => {
    expect(fitEbayTitle('one two three four five', 13)).toBe('one two three');
  });
});
