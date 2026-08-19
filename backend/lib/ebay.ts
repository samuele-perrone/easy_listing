// eBay OAuth + Sell API helpers.
// Env vars: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME (the eBay "RuName"
// redirect value), EBAY_ENV ("production" | "sandbox", default sandbox),
// EBAY_MARKETPLACE_ID (default EBAY_GB).

const ENV = process.env.EBAY_ENV === 'production' ? 'production' : 'sandbox';

export const EBAY = {
  authHost: ENV === 'production' ? 'https://auth.ebay.com' : 'https://auth.sandbox.ebay.com',
  apiHost: ENV === 'production' ? 'https://api.ebay.com' : 'https://api.sandbox.ebay.com',
  marketplaceId: process.env.EBAY_MARKETPLACE_ID ?? 'EBAY_GB',
  scopes: [
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.account',
  ].join(' '),
};

function basicAuth() {
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error('EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not configured');
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function exchangeCodeForTokens(code: string): Promise<TokenSet> {
  const response = await fetch(`${EBAY.apiHost}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.EBAY_RU_NAME ?? '',
    }),
  });
  if (!response.ok) throw new Error(`eBay token exchange failed: ${await response.text()}`);
  return response.json();
}

let cachedAppToken: { token: string; expiresAt: number } | null = null;

/**
 * An application token (client credentials grant). The Taxonomy API serves public
 * category data and needs eBay's base scope, which the seller's own token doesn't
 * carry — so mint one from the app credentials rather than re-prompting the seller.
 */
export async function getApplicationToken(): Promise<string> {
  if (cachedAppToken && Date.now() < cachedAppToken.expiresAt) {
    return cachedAppToken.token;
  }

  const response = await fetch(`${EBAY.apiHost}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(),
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  });
  if (!response.ok) throw new Error(`eBay application token failed: ${await response.text()}`);

  const tokens = (await response.json()) as TokenSet;
  cachedAppToken = {
    token: tokens.access_token,
    expiresAt: Date.now() + (tokens.expires_in - 300) * 1000,
  };
  return tokens.access_token;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const response = await fetch(`${EBAY.apiHost}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: basicAuth(),
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      scope: EBAY.scopes,
    }),
  });
  if (!response.ok) throw new Error(`eBay token refresh failed: ${await response.text()}`);
  return response.json();
}

// Marketplace ID → the language tag eBay expects for that site.
const MARKETPLACE_LANGUAGES: Record<string, string> = {
  EBAY_GB: 'en-GB',
  EBAY_US: 'en-US',
  EBAY_AU: 'en-AU',
  EBAY_CA: 'en-CA',
  EBAY_IE: 'en-IE',
  EBAY_DE: 'de-DE',
  EBAY_FR: 'fr-FR',
  EBAY_IT: 'it-IT',
  EBAY_ES: 'es-ES',
};

export function ebayLanguage() {
  return MARKETPLACE_LANGUAGES[EBAY.marketplaceId] ?? 'en-GB';
}

export function ebayHeaders(accessToken: string): Record<string, string> {
  const language = ebayLanguage();
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Content-Language': language,
    // Must be set explicitly: undici defaults to `*`, which eBay rejects (error 25709).
    'Accept-Language': language,
    Accept: 'application/json',
    'X-EBAY-C-MARKETPLACE-ID': EBAY.marketplaceId,
  };
}

async function ebayFetch(path: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(`${EBAY.apiHost}${path}`, {
    ...init,
    headers: {
      ...ebayHeaders(accessToken),
      ...init.headers,
    },
  });
  return response;
}

/** Finds the best category ID for a search phrase via the Taxonomy API. */
export async function suggestCategoryId(_userToken: string, query: string): Promise<string> {
  const accessToken = await getApplicationToken();

  const treeResponse = await ebayFetch(
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${EBAY.marketplaceId}`,
    accessToken,
  );
  if (!treeResponse.ok) throw new Error(`Taxonomy tree lookup failed: ${await treeResponse.text()}`);
  const { categoryTreeId } = await treeResponse.json();

  const suggestResponse = await ebayFetch(
    `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_category_suggestions?q=${encodeURIComponent(query)}`,
    accessToken,
  );
  if (!suggestResponse.ok) throw new Error(`Category suggestion failed: ${await suggestResponse.text()}`);
  const data = await suggestResponse.json();
  const suggestion = data.categorySuggestions?.[0]?.category?.categoryId;
  if (!suggestion) throw new Error(`No eBay category found for "${query}"`);
  return suggestion;
}

/** Returns the seller's first fulfillment/payment/return policy IDs (they must exist on the account). */
export async function getSellerPolicies(accessToken: string) {
  const kinds = [
    ['fulfillment_policy', 'fulfillmentPolicies', 'fulfillmentPolicyId'],
    ['payment_policy', 'paymentPolicies', 'paymentPolicyId'],
    ['return_policy', 'returnPolicies', 'returnPolicyId'],
  ] as const;

  const ids: Record<string, string> = {};
  for (const [path, listKey, idKey] of kinds) {
    const response = await ebayFetch(
      `/sell/account/v1/${path}?marketplace_id=${EBAY.marketplaceId}`,
      accessToken,
    );
    if (!response.ok) throw new Error(`Fetching ${path} failed: ${await response.text()}`);
    const data = await response.json();
    const first = data[listKey]?.[0]?.[idKey];
    if (!first) {
      throw new Error(
        `Your eBay account has no ${path.replace('_', ' ')}. Create one in eBay Seller Hub → Business policies, then try again.`,
      );
    }
    ids[idKey] = first;
  }
  return ids as { fulfillmentPolicyId: string; paymentPolicyId: string; returnPolicyId: string };
}

export interface DraftInput {
  title: string;
  description: string;
  condition: string;
  price: number;
  currency: string;
  categoryQuery: string;
}

/**
 * Creates an inventory item + offer, optionally publishing it.
 * Returns the offer ID and, when published, the live listing ID.
 */
export async function createListing(
  accessToken: string,
  draft: DraftInput,
  imageUrls: string[],
  publish: boolean,
): Promise<{ offerId: string; listingId?: string }> {
  const sku = `easylisting-${Date.now()}`;

  const inventoryItem = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition: draft.condition,
    product: {
      title: draft.title.slice(0, 80),
      description: draft.description,
      imageUrls: imageUrls.slice(0, 12),
    },
  };
  console.log('eBay inventory item request', sku, JSON.stringify(inventoryItem));

  // eBay's Inventory service returns a generic 25001 for transient faults, so retry once.
  let itemResponse = await ebayFetch(`/sell/inventory/v1/inventory_item/${sku}`, accessToken, {
    method: 'PUT',
    body: JSON.stringify(inventoryItem),
  });
  if (!itemResponse.ok) {
    const firstError = await itemResponse.text();
    console.log('eBay inventory item attempt 1 failed', itemResponse.status, firstError);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    itemResponse = await ebayFetch(`/sell/inventory/v1/inventory_item/${sku}`, accessToken, {
      method: 'PUT',
      body: JSON.stringify(inventoryItem),
    });
    if (!itemResponse.ok) {
      throw new Error(`Creating inventory item failed: ${await itemResponse.text()}`);
    }
  }

  const categoryId = await suggestCategoryId(accessToken, draft.categoryQuery);
  const policies = await getSellerPolicies(accessToken);

  const offerResponse = await ebayFetch('/sell/inventory/v1/offer', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      sku,
      marketplaceId: EBAY.marketplaceId,
      format: 'FIXED_PRICE',
      listingDescription: draft.description,
      availableQuantity: 1,
      categoryId,
      listingPolicies: policies,
      pricingSummary: {
        price: { value: draft.price.toFixed(2), currency: draft.currency },
      },
    }),
  });
  if (!offerResponse.ok) throw new Error(`Creating offer failed: ${await offerResponse.text()}`);
  const { offerId } = await offerResponse.json();

  if (!publish) return { offerId };

  const publishResponse = await ebayFetch(`/sell/inventory/v1/offer/${offerId}/publish`, accessToken, {
    method: 'POST',
  });
  if (!publishResponse.ok) throw new Error(`Publishing offer failed: ${await publishResponse.text()}`);
  const { listingId } = await publishResponse.json();
  return { offerId, listingId };
}

export function listingViewURL(listingId: string) {
  return ENV === 'production'
    ? `https://www.ebay.co.uk/itm/${listingId}`
    : `https://sandbox.ebay.co.uk/itm/${listingId}`;
}
