/**
 * eBay reports failures as numeric ids with terse or misleading text
 * ("No <Item.Country> exists" means "no merchant location"). Translate the ones
 * we've actually hit into something a seller can act on.
 */

/** Carries eBay's raw payload so the route can translate it for the app. */
export class EbayApiError extends Error {
  constructor(
    public action: string,
    public raw: string,
  ) {
    super(`${action} failed: ${raw}`);
    this.name = 'EbayApiError';
  }
}

export interface FriendlyError {
  /** Shown as the alert body. */
  error: string;
  /** What the seller can do about it, when there's something. */
  fix?: string;
  /** Raw eBay payload, for a support email. Never shown in the alert. */
  detail?: string;
  code?: number;
}

const EXPLANATIONS: Record<number, { error: string; fix?: string }> = {
  1100: {
    error: 'eBay refused the request because of missing permissions.',
    fix: 'Disconnect and reconnect your eBay account in Settings.',
  },
  20403: {
    error: 'Your eBay account isn’t set up for Business Policies yet.',
    fix: 'We tried to enrol you automatically. If this keeps happening, enrol manually in eBay Seller Hub → Account → Business policies.',
  },
  25001: {
    error: 'eBay had a temporary problem on their side.',
    fix: 'Wait a moment and try again — this usually clears by itself.',
  },
  25002: {
    error: 'eBay needs more detail about this item before it can be listed.',
    fix: 'Check the eBay fields above — one of them is missing or not specific enough for this category.',
  },
  25012: {
    error: 'eBay rejected the postcode for your item location.',
    fix: 'It needs a full postcode, not just the first part.',
  },
  25021: {
    error: 'The condition isn’t valid for this eBay category.',
    fix: 'Tap Edit on the Condition field and choose a different one — "USED_EXCELLENT" works for most categories.',
  },
  25709: {
    error: 'eBay rejected the request format.',
    fix: 'This is a bug on our side rather than anything you did.',
  },
  25802: {
    error: 'eBay couldn’t save your item location.',
    fix: 'Your postcode may be missing or incomplete.',
  },
};

/** Pulls the first error id out of an eBay error payload, if there is one. */
export function ebayErrorCode(raw: string): number | undefined {
  try {
    const parsed = JSON.parse(raw);
    const id = parsed?.errors?.[0]?.errorId;
    return typeof id === 'number' ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Best human-readable summary eBay gave us, when we have no mapping for the id. */
function ebayMessage(raw: string): string | undefined {
  try {
    const parsed = JSON.parse(raw);
    const first = parsed?.errors?.[0];
    const text = first?.longMessage ?? first?.message;
    return typeof text === 'string' ? text : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Turns anything thrown during a listing attempt into something the app can show.
 * Errors we raised ourselves already read well, so they pass through unchanged.
 */
export function toFriendly(error: unknown, action: string): FriendlyError {
  if (error instanceof EbayApiError) {
    return describeEbayError(error.raw, error.action);
  }
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: `${action} failed.` };
}

export function describeEbayError(raw: string, action: string): FriendlyError {
  const code = ebayErrorCode(raw);
  const known = code !== undefined ? EXPLANATIONS[code] : undefined;

  if (known) return { ...known, detail: raw, code };

  const message = ebayMessage(raw);
  return {
    error: message ?? `${action} failed.`,
    fix: 'If this keeps happening, send us the details and we’ll take a look.',
    detail: raw,
    code,
  };
}
