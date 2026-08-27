import { describe, expect, it } from 'vitest';
import { CONDITION_IDS, pickCondition, safeConditionWithoutPolicy } from './ebayConditions';

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

  it('falls back to any allowed condition when no mapping fits', () => {
    const chosen = pickCondition(['1000'], 'FOR_PARTS_OR_NOT_WORKING');
    expect(chosen).toBe('NEW');
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
