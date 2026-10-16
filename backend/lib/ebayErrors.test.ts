import { describe, expect, it } from 'vitest';
import { EbayApiError, describeEbayError, ebayErrorCode, ebayGuidance, toFriendly } from './ebayErrors';

const ebayPayload = (errorId: number, message = 'Something terse', longMessage?: string) =>
  JSON.stringify({
    errors: [{ errorId, domain: 'API_INVENTORY', message, ...(longMessage ? { longMessage } : {}) }],
  });

describe('ebayErrorCode', () => {
  it('reads the first error id', () => {
    expect(ebayErrorCode(ebayPayload(25021))).toBe(25021);
  });

  it('returns undefined for anything that is not an eBay error payload', () => {
    expect(ebayErrorCode('<html>502 Bad Gateway</html>')).toBeUndefined();
    expect(ebayErrorCode('')).toBeUndefined();
    expect(ebayErrorCode('{}')).toBeUndefined();
  });
});

describe('describeEbayError', () => {
  it('explains a known error in terms a seller can act on', () => {
    const result = describeEbayError(ebayPayload(25021), 'Publishing the listing');

    expect(result.code).toBe(25021);
    expect(result.error).toContain('condition');
    expect(result.fix).toContain('Edit');
    // The raw payload is kept for support, never surfaced as the message.
    expect(result.detail).toBe(ebayPayload(25021));
    expect(result.error).not.toContain('errorId');
  });

  it('describes the transient inventory fault as worth retrying', () => {
    const result = describeEbayError(ebayPayload(25001), 'Creating the listing');
    expect(result.fix).toMatch(/try again/i);
  });

  it('falls back to eBay wording for ids we have not mapped', () => {
    const raw = ebayPayload(99999, 'short', 'The long explanation from eBay.');
    const result = describeEbayError(raw, 'Creating the listing');

    expect(result.error).toBe('The long explanation from eBay.');
    expect(result.detail).toBe(raw);
  });

  it('still says something useful when the payload is unparseable', () => {
    const result = describeEbayError('502 Bad Gateway', 'Creating the listing');

    expect(result.error).toBe('Creating the listing failed.');
    expect(result.detail).toBe('502 Bad Gateway');
  });
});

describe('toFriendly', () => {
  it('translates an eBay failure', () => {
    const result = toFriendly(new EbayApiError('Publishing the listing', ebayPayload(25012)), 'x');
    expect(result.error).toContain('postcode');
  });

  it('passes through messages we wrote ourselves, which already read well', () => {
    const message = 'Your eBay account has no fulfillment policy.';
    expect(toFriendly(new Error(message), 'Creating the listing').error).toBe(message);
  });

  it('handles a non-Error being thrown', () => {
    expect(toFriendly('kaboom', 'Creating the listing').error).toBe('Creating the listing failed.');
  });
});

describe('25019 — miscategorised, not "improper words"', () => {
  // The real payload from an Apple Watch band, 16 Oct 2026. eBay's message
  // blames the wording; the actual reason is buried in `parameters`.
  const RAW = JSON.stringify({ errors: [{
    errorId: 25019,
    domain: 'API_INVENTORY',
    message: 'Cannot revise listing. The item cannot be listed or modified. The title or description may contain improper words, or the listing or seller may be in violation of eBay policy.',
    parameters: [
      { name: '0', value: '<p style=margin: 10px><font color=#333333>It looks like you&#39;re listing an accessory for a smart watch. Accessories should be listed in the Mobile Phones &amp; Communication&gt;Smart Watch Accessories categories.</font></p>' },
      { name: '1', value: "It looks like you're listing an accessory for a smart watch. Accessories, including bundles that only include accessories, should be listed in the Mobile Phones & Communication>Smart Watch Accessories categories." },
      { name: '2', value: 'LP_Miscat_SmartWatch_Accessories' },
      { name: '3', value: '985549' },
    ],
  }] });

  it('extracts the plain-text guidance, not the HTML copy or the rule name', () => {
    const guidance = ebayGuidance(RAW)!;
    expect(guidance).toContain('Smart Watch Accessories');
    expect(guidance).not.toContain('<');
    expect(guidance).not.toContain('LP_Miscat');
    expect(guidance).not.toBe('985549');
  });

  it('stops telling the seller their words were improper', () => {
    const friendly = describeEbayError(RAW, 'Publishing the listing');
    expect(friendly.code).toBe(25019);
    expect(friendly.error).not.toContain('improper words');
    // Two different causes share this id — a miscategorised accessory, and a
    // smart watch whose title mentioned a charger — so the fix must not name a
    // single control. eBay's own guidance is what tells them apart.
    expect(friendly.fix).toContain('Title');
    expect(friendly.fix).toContain('Category');
    expect(friendly.fix).toContain('Smart Watch Accessories');
  });

  it('still works when eBay sends no usable parameters', () => {
    const bare = JSON.stringify({ errors: [{ errorId: 25019, message: 'nope' }] });
    expect(ebayGuidance(bare)).toBeUndefined();
    expect(describeEbayError(bare, 'Publishing').fix).toContain('Title');
  });
});
