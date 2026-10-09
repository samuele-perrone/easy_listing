import { describe, expect, it } from 'vitest';
import { CONDITION_IDS, normaliseCondition, pickCondition, safeConditionWithoutPolicy } from './ebayConditions';

// Most categories (clothing, accessories, electronics) permit only these.
const GENERAL_CATEGORY = ['1000', '1500', '2000', '2500', '3000', '7000'];
// Media categories add the granular used grades.
const MEDIA_CATEGORY = ['1000', '2750', '4000', '5000', '6000'];

describe('pickCondition', () => {
  it('keeps the seller’s choice when the category allows it', () => {
    expect(pickCondition(GENERAL_CATEGORY, 'NEW')).toBe('NEW');
    expect(pickCondition(MEDIA_CATEGORY, 'USED_VERY_GOOD')).toBe('USED_VERY_GOOD');
  });

  it('degrades a media-only grade to "Used" on an ordinary category', () => {
    // This is the 25021 failure: a watch strap listed as USED_VERY_GOOD.
    expect(pickCondition(GENERAL_CATEGORY, 'USED_VERY_GOOD')).toBe('USED_EXCELLENT');
    expect(pickCondition(GENERAL_CATEGORY, 'USED_GOOD')).toBe('USED_EXCELLENT');
    expect(pickCondition(GENERAL_CATEGORY, 'USED_ACCEPTABLE')).toBe('USED_EXCELLENT');
    expect(pickCondition(GENERAL_CATEGORY, 'LIKE_NEW')).toBe('USED_EXCELLENT');
  });

  it('steps down to the next-best grade when the preferred fallback is also barred', () => {
    // Allows "Very Good" and "Good", but not "Used".
    expect(pickCondition(['4000', '5000'], 'USED_EXCELLENT')).toBe('USED_GOOD');
  });

  it('never invents a condition the category rejects', () => {
    for (const desired of Object.keys(CONDITION_IDS)) {
      const chosen = pickCondition(GENERAL_CATEGORY, desired);
      expect(GENERAL_CATEGORY).toContain(CONDITION_IDS[chosen]);
    }
  });

  it('leaves the choice alone when eBay lists no restrictions', () => {
    expect(pickCondition([], 'USED_VERY_GOOD')).toBe('USED_VERY_GOOD');
  });

  it('never upgrades a used grade into a new one', () => {
    // This previously returned NEW: the old fallback took the first grade in
    // enum order that the category allowed, so a broken item was listed as new
    // whenever NEW was permitted. Returning the original lets eBay answer 25021
    // instead, which translates into something the seller can act on.
    expect(pickCondition(['1000'], 'FOR_PARTS_OR_NOT_WORKING')).toBe('FOR_PARTS_OR_NOT_WORKING');
    expect(pickCondition(['1000'], 'USED_GOOD')).not.toBe('NEW');
  });

  it('steps within the used family when no explicit fallback is allowed', () => {
    // Allows only "Acceptable" and "For parts" — a very good item degrades
    // downwards rather than jumping families.
    expect(pickCondition(['6000', '7000'], 'USED_VERY_GOOD')).toBe('USED_ACCEPTABLE');
  });
});

describe('normaliseCondition', () => {
  it('passes a real enum through unchanged', () => {
    expect(normaliseCondition('USED_EXCELLENT')).toBe('USED_EXCELLENT');
    expect(normaliseCondition('FOR_PARTS_OR_NOT_WORKING')).toBe('FOR_PARTS_OR_NOT_WORKING');
  });

  it('resolves the wording the model actually writes in the visible field', () => {
    // These are the values captured in ScreenshotSeed from real generations —
    // the eBay 2004 "Could not serialize field [condition]" failure.
    expect(normaliseCondition('Used')).toBe('USED_EXCELLENT');
    expect(normaliseCondition('Very good')).toBe('USED_VERY_GOOD');
    expect(normaliseCondition('Used - like new')).toBe('LIKE_NEW');
    expect(normaliseCondition('Used - good')).toBe('USED_GOOD');
    expect(normaliseCondition('Used - fair')).toBe('USED_ACCEPTABLE');
  });

  it('handles the other platforms’ vocabularies and loose punctuation', () => {
    expect(normaliseCondition('New with tags')).toBe('NEW');
    expect(normaliseCondition('New without tags')).toBe('NEW_OTHER');
    expect(normaliseCondition('Satisfactory')).toBe('USED_ACCEPTABLE');
    expect(normaliseCondition('  used  ')).toBe('USED_EXCELLENT');
    expect(normaliseCondition('Spares or repair')).toBe('FOR_PARTS_OR_NOT_WORKING');
    expect(normaliseCondition('Used – like new')).toBe('LIKE_NEW'); // en dash
  });

  it('returns undefined rather than guessing at unrecognisable text', () => {
    // Guessing would overstate condition on a live listing, which is a real harm.
    expect(normaliseCondition('mostly fine honestly')).toBeUndefined();
    expect(normaliseCondition('')).toBeUndefined();
    expect(normaliseCondition('   ')).toBeUndefined();
  });

  it('resolves every label the generation prompt tells the model to use', () => {
    // Keep in step with the eBay line in `generate.ts`. If a label is added
    // there that doesn't resolve here, posting fails with eBay 2004 — which is
    // exactly how this bug reached production in the first place.
    const promptLabels = [
      'New',
      'New other',
      'Like New',
      'Used',
      'Very Good',
      'Good',
      'Acceptable',
      'For parts or not working',
    ];
    for (const label of promptLabels) {
      expect(normaliseCondition(label), label).toBeDefined();
    }
  });

  it('only ever returns values eBay has an id for', () => {
    const inputs = ['Used', 'New', 'Very good', 'Good', 'Used - fair', 'Refurbished', 'Broken'];
    for (const input of inputs) {
      const resolved = normaliseCondition(input);
      expect(resolved).toBeDefined();
      expect(CONDITION_IDS[resolved!]).toBeDefined();
    }
  });
});

describe('safeConditionWithoutPolicy', () => {
  it('avoids media-only grades when the category policy is unavailable', () => {
    expect(safeConditionWithoutPolicy('USED_VERY_GOOD')).toBe('USED_EXCELLENT');
    expect(safeConditionWithoutPolicy('LIKE_NEW')).toBe('USED_EXCELLENT');
  });

  it('leaves broadly-accepted grades untouched', () => {
    expect(safeConditionWithoutPolicy('NEW')).toBe('NEW');
    expect(safeConditionWithoutPolicy('USED_EXCELLENT')).toBe('USED_EXCELLENT');
    expect(safeConditionWithoutPolicy('FOR_PARTS_OR_NOT_WORKING')).toBe('FOR_PARTS_OR_NOT_WORKING');
  });
});
