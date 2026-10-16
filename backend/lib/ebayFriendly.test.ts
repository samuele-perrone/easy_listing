/**
 * When the model gets asked to explain an eBay error, and when it doesn't.
 *
 * The hand-written table wins where it applies: free, instant, known-correct.
 * The model is for the errors we have never diagnosed, where the alternative is
 * showing eBay's own message — which has twice been wrong about its own error.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ explain: vi.fn() }));
vi.mock('@/lib/ebayExplain', () => ({ explainEbayError: mocks.explain }));

import { explainIfUnmapped } from './ebayFriendly';
import { EbayApiError, toFriendly } from './ebayErrors';

const CONTEXT = { action: 'Posting to eBay', title: 'A thing' };

function ebayError(errorId: number, message = 'something') {
  return new EbayApiError('Posting to eBay', JSON.stringify({ errors: [{ errorId, message }] }));
}

beforeEach(() => {
  mocks.explain.mockReset();
  mocks.explain.mockResolvedValue({ error: 'eBay says the price is too low.', fix: 'Raise the Price field.' });
});
afterEach(() => vi.restoreAllMocks());

describe('explainIfUnmapped', () => {
  it('does not ask the model about an error we already explain by hand', async () => {
    const err = ebayError(25021);
    const result = await explainIfUnmapped(toFriendly(err, 'Posting to eBay'), err, CONTEXT);

    expect(mocks.explain).not.toHaveBeenCalled();
    expect(result.error).toContain('condition isn’t valid');
  });

  it('asks the model about an error we have never seen', async () => {
    const err = ebayError(31337, 'Totally unfamiliar failure');
    const result = await explainIfUnmapped(toFriendly(err, 'Posting to eBay'), err, CONTEXT);

    expect(mocks.explain).toHaveBeenCalledOnce();
    expect(result.error).toBe('eBay says the price is too low.');
    expect(result.fix).toBe('Raise the Price field.');
  });

  it('keeps the raw payload for the support email either way', async () => {
    const err = ebayError(31337);
    const result = await explainIfUnmapped(toFriendly(err, 'Posting to eBay'), err, CONTEXT);
    expect(result.detail).toContain('31337');
    expect(result.code).toBe(31337);
  });

  it('falls back to eBay’s own wording when the model cannot help', async () => {
    mocks.explain.mockResolvedValue(undefined);
    const err = ebayError(31337, 'Totally unfamiliar failure');
    const friendly = toFriendly(err, 'Posting to eBay');
    const result = await explainIfUnmapped(friendly, err, CONTEXT);

    expect(result).toEqual(friendly);
  });

  it('never turns one failure into two when the provider throws', async () => {
    // The seller is already looking at an error; a busy provider must not
    // become a second one.
    mocks.explain.mockRejectedValue(new Error('all models busy'));
    const err = ebayError(31337);
    const friendly = toFriendly(err, 'Posting to eBay');

    await expect(explainIfUnmapped(friendly, err, CONTEXT)).resolves.toEqual(friendly);
  });

  it('ignores errors that did not come from eBay', async () => {
    const err = new Error('our own bug');
    const friendly = toFriendly(err, 'Posting to eBay');
    const result = await explainIfUnmapped(friendly, err, CONTEXT);

    expect(mocks.explain).not.toHaveBeenCalled();
    expect(result).toEqual(friendly);
  });
});
