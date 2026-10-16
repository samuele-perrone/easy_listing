import { EbayApiError, ebayErrorCode, type FriendlyError } from '@/lib/ebayErrors';
import { explainEbayError, type ExplainContext } from '@/lib/ebayExplain';

/** Error ids `ebayErrors.ts` already explains by hand. */
function isMapped(friendly: FriendlyError): boolean {
  // A mapped error always carries a `fix`; the fallthrough branch sets a
  // generic one, so the code alone isn't enough to tell them apart.
  return Boolean(friendly.fix) && !friendly.fix?.startsWith('If this keeps happening');
}

/**
 * Adds a model-written explanation when we have no hand-written one.
 *
 * The table in `ebayErrors.ts` wins where it applies: it is free, instant and
 * known-correct. This covers everything else, where the alternative is showing
 * eBay's own message — which has twice been actively wrong about its own error.
 */
export async function explainIfUnmapped(
  friendly: FriendlyError,
  error: unknown,
  context: ExplainContext,
): Promise<FriendlyError> {
  if (!(error instanceof EbayApiError)) return friendly;
  if (isMapped(friendly)) return friendly;

  // Belt and braces: `explainEbayError` swallows its own failures, but this
  // runs inside a catch block that is already handling one failure. It must not
  // be able to produce a second.
  try {
    const explained = await explainEbayError(error.raw, context);
    if (!explained) return friendly;

    console.log(`explained eBay ${ebayErrorCode(error.raw) ?? '(no code)'}: ${explained.error}`);
    return { ...friendly, error: explained.error, fix: explained.fix };
  } catch (explainFailure) {
    console.log(
      'explainer itself failed —',
      explainFailure instanceof Error ? explainFailure.message : explainFailure,
    );
    return friendly;
  }
}
