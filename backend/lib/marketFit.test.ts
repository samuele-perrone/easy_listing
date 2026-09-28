import { describe, expect, it } from 'vitest';
import { normaliseMarketFit, type MarketFit } from './marketFit';

function fit(overrides: Partial<MarketFit> = {}): MarketFit {
  return {
    bestPlatform: 'ebay',
    summary: 'Collectable, so the national audience pays most.',
    platforms: [
      { platform: 'ebay', rank: 1, estimatedLow: 20, estimatedHigh: 30, reason: 'widest reach' },
      { platform: 'vinted', rank: 2, estimatedLow: 12, estimatedHigh: 18, reason: 'brand hunters' },
      { platform: 'facebook', rank: 3, estimatedLow: 8, estimatedHigh: 14, reason: 'local, no postage' },
      { platform: 'gumtree', rank: 4, estimatedLow: 5, estimatedHigh: 10, reason: 'quieter locally' },
    ],
    ...overrides,
  };
}

describe('normaliseMarketFit', () => {
  it('leaves a well-formed ranking untouched', () => {
    const input = fit();
    const out = normaliseMarketFit(input);
    expect(out.platforms.map((p) => p.platform)).toEqual(['ebay', 'vinted', 'facebook', 'gumtree']);
    expect(out.platforms.map((p) => p.rank)).toEqual([1, 2, 3, 4]);
    expect(out.bestPlatform).toBe('ebay');
  });

  it('derives bestPlatform from the ranking when the model contradicts itself', () => {
    // Says Vinted is best, then ranks eBay first. The screen must not disagree
    // with itself, and the ranking is the part the seller compares.
    const out = normaliseMarketFit(fit({ bestPlatform: 'vinted' }));
    expect(out.bestPlatform).toBe('ebay');
  });

  it('renumbers ranks so gaps never reach the UI', () => {
    const out = normaliseMarketFit(
      fit({
        platforms: [
          { platform: 'vinted', rank: 2, estimatedLow: 12, estimatedHigh: 18, reason: 'a' },
          { platform: 'ebay', rank: 7, estimatedLow: 20, estimatedHigh: 30, reason: 'b' },
        ],
      }),
    );
    expect(out.platforms.map((p) => [p.platform, p.rank])).toEqual([
      ['vinted', 1],
      ['ebay', 2],
    ]);
  });

  it('breaks a tied rank by which is worth more', () => {
    const out = normaliseMarketFit(
      fit({
        platforms: [
          { platform: 'gumtree', rank: 1, estimatedLow: 5, estimatedHigh: 10, reason: 'a' },
          { platform: 'ebay', rank: 1, estimatedLow: 40, estimatedHigh: 60, reason: 'b' },
        ],
      }),
    );
    expect(out.platforms[0].platform).toBe('ebay');
    expect(out.bestPlatform).toBe('ebay');
  });

  it('keeps the better-ranked entry when a platform appears twice', () => {
    const out = normaliseMarketFit(
      fit({
        platforms: [
          { platform: 'ebay', rank: 1, estimatedLow: 20, estimatedHigh: 30, reason: 'keep me' },
          { platform: 'ebay', rank: 3, estimatedLow: 1, estimatedHigh: 2, reason: 'drop me' },
        ],
      }),
    );
    expect(out.platforms).toHaveLength(1);
    expect(out.platforms[0].reason).toBe('keep me');
  });

  it('puts a back-to-front price range the right way round', () => {
    const out = normaliseMarketFit(
      fit({
        platforms: [{ platform: 'ebay', rank: 1, estimatedLow: 30, estimatedHigh: 20, reason: 'a' }],
      }),
    );
    expect(out.platforms[0].estimatedLow).toBe(20);
    expect(out.platforms[0].estimatedHigh).toBe(30);
  });

  it('drops an unknown platform rather than showing it', () => {
    const out = normaliseMarketFit(
      fit({
        platforms: [
          { platform: 'ebay', rank: 1, estimatedLow: 20, estimatedHigh: 30, reason: 'a' },
          // @ts-expect-error — exactly what we're guarding against
          { platform: 'depop', rank: 2, estimatedLow: 10, estimatedHigh: 15, reason: 'b' },
        ],
      }),
    );
    expect(out.platforms.map((p) => p.platform)).toEqual(['ebay']);
  });

  it('never invents a platform the model left out', () => {
    // A made-up price range is worse than a shorter list.
    const out = normaliseMarketFit(
      fit({
        platforms: [{ platform: 'vinted', rank: 1, estimatedLow: 12, estimatedHigh: 18, reason: 'a' }],
      }),
    );
    expect(out.platforms).toHaveLength(1);
    expect(out.bestPlatform).toBe('vinted');
  });

  it('survives an empty ranking without losing the stated best platform', () => {
    const out = normaliseMarketFit(fit({ platforms: [], bestPlatform: 'gumtree' }));
    expect(out.platforms).toEqual([]);
    expect(out.bestPlatform).toBe('gumtree');
  });
});
