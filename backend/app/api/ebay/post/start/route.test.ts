/**
 * The background eBay post.
 *
 * The point of the route is that the phone can be closed, so the assertions are
 * about what happens *without* the caller waiting: it answers 202 immediately,
 * and the slow work — including uploading the photos — happens after.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createListing: vi.fn(),
  put: vi.fn(),
  writeJob: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock('@vercel/functions', () => ({ waitUntil: mocks.waitUntil }));
vi.mock('@vercel/blob', () => ({ put: mocks.put }));
vi.mock('@/lib/ebay', () => ({
  createListing: mocks.createListing,
  listingViewURL: (id: string) => `https://www.ebay.co.uk/itm/${id}`,
}));
vi.mock('@/lib/jobs', () => ({ newJobId: () => 'ebay-job-1', writeJob: mocks.writeJob }));

import { POST } from './route';
import { mintSession } from '@/lib/auth';

function postRequest(token?: string, publish = true): Request {
  return new Request('https://easy-listing.test/api/ebay/post/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      accessToken: 'ebay-seller-token',
      publish,
      draft: { title: 'A thing', description: 'd', condition: 'Used', price: 9.99, currency: 'GBP', categoryQuery: 'thing' },
      images: ['aGk='],
    }),
  });
}

/** waitUntil just receives a promise; run it so the job body is exercised. */
async function runDeferred() {
  for (const [promise] of mocks.waitUntil.mock.calls) await promise;
}

let original: NodeJS.ProcessEnv;
let token: string;

beforeEach(async () => {
  original = { ...process.env };
  process.env.AUTH_JWT_SECRET = 'a'.repeat(40);
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.put.mockResolvedValue({ url: 'https://blob.test/p.jpg' });
  mocks.writeJob.mockResolvedValue(undefined);
  mocks.createListing.mockResolvedValue({ offerId: 'offer-1', listingId: 'listing-1' });
  token = await mintSession({ email: 'a@b.com', provider: 'apple', sub: 'a-1' });
});
afterEach(() => { process.env = original; });

describe('POST /api/ebay/post/start', () => {
  it('refuses an unsigned request and starts nothing', async () => {
    const response = await POST(postRequest());
    expect(response.status).toBe(403);
    expect(mocks.waitUntil).not.toHaveBeenCalled();
    expect(mocks.writeJob).not.toHaveBeenCalled();
  });

  it('answers before the eBay chain finishes — the whole point of the route', async () => {
    // Hang the listing call forever. If the response still arrives, the phone
    // is genuinely free to be closed. Asserting "not yet called" instead would
    // only be measuring microtask ordering.
    let release!: () => void;
    mocks.createListing.mockReturnValue(new Promise((resolve) => {
      release = () => resolve({ offerId: 'offer-1', listingId: 'listing-1' });
    }));

    const response = await POST(postRequest(token));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ jobId: 'ebay-job-1' });
    // Still unfinished, and the job is pending so a poll right now says so.
    expect(mocks.writeJob).toHaveBeenCalledWith('ebay-job-1', expect.objectContaining({ status: 'pending' }));
    expect(mocks.writeJob).not.toHaveBeenCalledWith('ebay-job-1', expect.objectContaining({ status: 'ready' }));

    release();
    await runDeferred();
    expect(mocks.writeJob).toHaveBeenLastCalledWith('ebay-job-1', expect.objectContaining({ status: 'ready' }));
  });

  it('uploads the photos and lists once the response has gone', async () => {
    await POST(postRequest(token));
    await runDeferred();

    expect(mocks.put).toHaveBeenCalledOnce();
    expect(mocks.createListing).toHaveBeenCalledOnce();
    expect(mocks.writeJob).toHaveBeenLastCalledWith('ebay-job-1', expect.objectContaining({
      status: 'ready',
      ebayResult: expect.objectContaining({
        offerId: 'offer-1',
        listingId: 'listing-1',
        viewURL: 'https://www.ebay.co.uk/itm/listing-1',
        published: true,
      }),
    }));
  });

  it('marks a draft as unpublished, so the app offers Publish rather than View', async () => {
    mocks.createListing.mockResolvedValue({ offerId: 'offer-2' });
    await POST(postRequest(token, false));
    await runDeferred();

    expect(mocks.writeJob).toHaveBeenLastCalledWith('ebay-job-1', expect.objectContaining({
      status: 'ready',
      ebayResult: expect.objectContaining({ published: false, listingId: null }),
    }));
  });

  it('writes a readable failure into the job rather than losing it', async () => {
    const { EbayApiError } = await vi.importActual<typeof import('@/lib/ebayErrors')>('@/lib/ebayErrors');
    mocks.createListing.mockRejectedValue(
      new EbayApiError('Creating the listing', JSON.stringify({ errors: [{ errorId: 25002 }] })),
    );
    await POST(postRequest(token));
    await runDeferred();

    expect(mocks.writeJob).toHaveBeenLastCalledWith('ebay-job-1', expect.objectContaining({
      status: 'failed',
      error: expect.stringContaining('more detail'),
    }));
  });
});
