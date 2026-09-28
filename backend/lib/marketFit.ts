import { PLATFORMS } from '@/lib/schema';

export type PlatformName = (typeof PLATFORMS)[number];

export interface MarketFitEntry {
  platform: PlatformName;
  rank: number;
  estimatedLow: number;
  estimatedHigh: number;
  reason: string;
}

export interface MarketFit {
  bestPlatform: PlatformName;
  summary: string;
  platforms: MarketFitEntry[];
}

/**
 * Tidies the model's ranking into something the app can rely on.
 *
 * The schema accepts it loosely on purpose — the lesson from the eBay title is
 * that validating a detail like this discards a whole good listing over
 * bookkeeping. So the ranking is repaired here instead:
 *
 * - a platform mentioned twice keeps its first (best-ranked) entry
 * - a swapped price range is put the right way round
 * - ranks are renumbered 1..n after sorting, so ties and gaps can't reach the UI
 * - `bestPlatform` is *derived* from whatever ends up ranked first, because the
 *   model sometimes names one platform in `bestPlatform` and ranks another
 *   first, and a screen that contradicts itself reads as a bug
 *
 * A platform the model left out is dropped rather than invented: a made-up
 * price range is worse than a shorter list.
 */
export function normaliseMarketFit(fit: MarketFit): MarketFit {
  const seen = new Set<string>();

  const entries = fit.platforms
    .filter((entry) => {
      if (!PLATFORMS.includes(entry.platform)) return false;
      if (seen.has(entry.platform)) return false;
      seen.add(entry.platform);
      return true;
    })
    .map((entry) => ({
      ...entry,
      estimatedLow: Math.min(entry.estimatedLow, entry.estimatedHigh),
      estimatedHigh: Math.max(entry.estimatedLow, entry.estimatedHigh),
    }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      // Same rank: the one worth more goes first, which is what rank meant.
      return b.estimatedLow + b.estimatedHigh - (a.estimatedLow + a.estimatedHigh);
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));

  return {
    ...fit,
    platforms: entries,
    bestPlatform: entries[0]?.platform ?? fit.bestPlatform,
  };
}
