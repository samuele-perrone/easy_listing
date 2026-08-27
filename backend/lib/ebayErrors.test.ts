import { describe, expect, it } from 'vitest';
import { EbayApiError, describeEbayError, ebayErrorCode, toFriendly } from './ebayErrors';

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
