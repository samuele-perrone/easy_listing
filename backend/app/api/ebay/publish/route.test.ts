/**
 * Publishing a saved draft makes it live, so it needs the same gate as a direct
 * post — and must not reach eBay at all when the caller isn't allowed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));

vi.mock('@/lib/ebay', () => ({
  EBAY: { apiHost: 'https://api.ebay.test', marketplaceId: 'EBAY_GB' },
  ebayHeaders: () => ({ Authorization: 'Bearer seller' }),
  listingViewURL: (id: string) => `https://www.ebay.co.uk/itm/${id}`,
}));

import { POST } from './route';
import { mintSession } from '@/lib/auth';

function publishRequest(token?: string): Request {
  return new Request('https://easy-listing.test/api/ebay/publish', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ accessToken: 'ebay-seller-token', offerId: 'offer-1' }),
  });
}

let original: NodeJS.ProcessEnv;

beforeEach(() => {
  original = { ...process.env };
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  process.env.EBAY_POST_ALLOWED_EMAILS = 'samuele.perrone@icloud.com';
  delete process.env.EBAY_POST_REQUIRE_AUTH;

  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValue(
    new Response(JSON.stringify({ listingId: 'listing-9' }), { status: 200 }),
  );
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  process.env = original;
  vi.unstubAllGlobals();
});

describe('POST /api/ebay/publish', () => {
  it('refuses an unsigned request without calling eBay', async () => {
    const response = await POST(publishRequest());
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('refuses a seller who is not allow-listed without calling eBay', async () => {
    const token = await mintSession({ email: 'stranger@example.com', provider: 'google' });
    const response = await POST(publishRequest(token));
    expect(response.status).toBe(403);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('publishes for an allow-listed seller', async () => {
    const token = await mintSession({ email: 'samuele.perrone@icloud.com', provider: 'apple' });
    const response = await POST(publishRequest(token));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      listingId: 'listing-9',
      viewURL: 'https://www.ebay.co.uk/itm/listing-9',
    });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    expect(mocks.fetch.mock.calls[0][0]).toContain('/offer/offer-1/publish');
  });
});
