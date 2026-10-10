/**
 * The allow-list has to stop the request *before* any eBay work happens, not
 * merely change the response. These tests assert the side effects never occur:
 * no blob upload, no inventory item, no offer, no publish.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above ordinary consts, so the spies have to be too.
const mocks = vi.hoisted(() => ({ createListing: vi.fn(), put: vi.fn() }));
const { createListing, put } = mocks;

vi.mock('@/lib/ebay', () => ({
  createListing: mocks.createListing,
  listingViewURL: (id: string) => `https://www.ebay.co.uk/itm/${id}`,
}));

vi.mock('@vercel/blob', () => ({ put: mocks.put }));

import { POST } from './route';
import { mintSession } from '@/lib/auth';

const SECRET = 'a'.repeat(40);

function postRequest(token?: string): Request {
  return new Request('https://easy-listing.test/api/ebay/post', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      accessToken: 'ebay-seller-token',
      publish: true,
      draft: {
        title: 'Apple Watch Sport Band',
        description: 'Barely used.',
        condition: 'Used',
        price: 9.99,
        currency: 'GBP',
        categoryQuery: 'watch strap',
      },
      images: ['aGVsbG8='],
    }),
  });
}

let original: NodeJS.ProcessEnv;

beforeEach(() => {
  original = { ...process.env };
  process.env.AUTH_JWT_SECRET = SECRET;
  process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@gmail.com';
  delete process.env.EBAY_POST_REQUIRE_AUTH;

  createListing.mockReset();
  put.mockReset();
  put.mockResolvedValue({ url: 'https://blob.test/photo.jpg' });
  createListing.mockResolvedValue({ offerId: 'offer-1', listingId: 'listing-1' });
});

afterEach(() => {
  process.env = original;
});

describe('POST /api/ebay/post', () => {
  it('refuses an unsigned request with 403 and does no eBay work', async () => {
    const response = await POST(postRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Sign in with Apple or Google'),
    });
    // The important part: nothing was uploaded and nothing was listed.
    expect(put).not.toHaveBeenCalled();
    expect(createListing).not.toHaveBeenCalled();
  });

  it('refuses a signed-in email that is not allow-listed, and does no eBay work', async () => {
    const token = await mintSession({ email: 'stranger@example.com', provider: 'google' });
    const response = await POST(postRequest(token));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('isn’t on the list'),
    });
    expect(put).not.toHaveBeenCalled();
    expect(createListing).not.toHaveBeenCalled();
  });

  it('refuses a forged session', async () => {
    const response = await POST(postRequest('clearly.not.a.jwt'));
    expect(response.status).toBe(403);
    expect(createListing).not.toHaveBeenCalled();
  });

  it('refuses when the allow-list is unset, rather than letting everyone through', async () => {
    delete process.env.EBAY_POST_ALLOWED_EMAILS;
    const token = await mintSession({ email: 'samuele.perrone@gmail.com', provider: 'apple' });
    const response = await POST(postRequest(token));

    expect(response.status).toBe(403);
    expect(createListing).not.toHaveBeenCalled();
  });

  it('lists for an allow-listed seller', async () => {
    const token = await mintSession({ email: 'samuele.perrone@gmail.com', provider: 'apple' });
    const response = await POST(postRequest(token));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      offerId: 'offer-1',
      listingId: 'listing-1',
      viewURL: 'https://www.ebay.co.uk/itm/listing-1',
    });
    expect(createListing).toHaveBeenCalledOnce();

    // Photos reach eBay as URLs, because its Inventory API takes URLs not bytes.
    const [, , imageUrls, publish] = createListing.mock.calls[0];
    expect(imageUrls).toEqual(['https://blob.test/photo.jpg']);
    expect(publish).toBe(true);
  });

  it('lets an older build through when the escape hatch is set', async () => {
    // EBAY_POST_REQUIRE_AUTH=false exists so a build predating sign-in keeps
    // working; it must not also start admitting non-allow-listed accounts.
    process.env.EBAY_POST_REQUIRE_AUTH = 'false';

    const anonymous = await POST(postRequest());
    expect(anonymous.status).toBe(200);

    createListing.mockClear();
    const stranger = await mintSession({ email: 'stranger@example.com', provider: 'google' });
    const refused = await POST(postRequest(stranger));
    expect(refused.status).toBe(403);
    expect(createListing).not.toHaveBeenCalled();
  });

  it('still translates an eBay failure for an allowed seller', async () => {
    const { EbayApiError } = await import('@/lib/ebayErrors');
    createListing.mockRejectedValue(
      new EbayApiError('Creating the listing', JSON.stringify({ errors: [{ errorId: 25002 }] })),
    );
    const token = await mintSession({ email: 'samuele.perrone@gmail.com', provider: 'apple' });
    const response = await POST(postRequest(token));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: 'eBay needs more detail about this item before it can be listed.',
      code: 25002,
    });
  });
});
