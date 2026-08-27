// eBay OAuth + Sell API helpers.
// Env vars: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_RU_NAME (the eBay "RuName"
// redirect value), EBAY_ENV ("production" | "sandbox", default sandbox),
// EBAY_MARKETPLACE_ID (default EBAY_GB).

import { chooseAspectValues, type CategoryAspect } from '@/lib/aspects';
import { EbayApiError } from '@/lib/ebayErrors';
import { pickCondition, safeConditionWithoutPolicy } from '@/lib/ebayConditions';

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

const MARKETPLACE_COUNTRIES: Record<string, string> = {
  EBAY_GB: 'GB',
  EBAY_US: 'US',
  EBAY_AU: 'AU',
  EBAY_CA: 'CA',
  EBAY_IE: 'IE',
  EBAY_DE: 'DE',
  EBAY_FR: 'FR',
  EBAY_IT: 'IT',
  EBAY_ES: 'ES',
};

export function ebayLanguage() {
  return MARKETPLACE_LANGUAGES[EBAY.marketplaceId] ?? 'en-GB';
}

export function ebayCountry() {
  return MARKETPLACE_COUNTRIES[EBAY.marketplaceId] ?? 'GB';
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
/** Picks a condition the category actually accepts (eBay 25021 otherwise). */
export async function supportedCondition(
  categoryTreeId: string,
  categoryId: string,
  desired: string,
): Promise<string> {
  const accessToken = await getApplicationToken();
  // The braces in eBay's filter syntax must be percent-encoded.
  const filter = `categoryIds:%7B${categoryId}%7D`;
  const response = await ebayFetch(
    `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_item_condition_policies?filter=${filter}`,
    accessToken,
  );
  if (!response.ok) {
    console.log('condition policy lookup failed', response.status, await response.text());
    // Without the policy we can't verify, so avoid the media-only grades.
    return safeConditionWithoutPolicy(desired);
  }

  const data = await response.json();
  const allowed: string[] = (data.itemConditionPolicies?.[0]?.itemConditions ?? []).map(
    (c: { conditionId: string | number }) => String(c.conditionId),
  );
  console.log(`eBay category ${categoryId} allows conditions [${allowed.join(', ')}]`);

  const chosen = pickCondition(allowed, desired);
  if (chosen !== desired) {
    console.log(`eBay category ${categoryId} rejects ${desired}; using ${chosen}`);
  }
  return chosen;
}

/** The item specifics eBay requires for a category (e.g. "Type" on watch straps). */
export async function requiredAspects(
  categoryTreeId: string,
  categoryId: string,
): Promise<CategoryAspect[]> {
  const accessToken = await getApplicationToken();
  const response = await ebayFetch(
    `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_item_aspects_for_category?category_id=${categoryId}`,
    accessToken,
  );
  if (!response.ok) {
    console.log('aspect lookup failed', response.status, await response.text());
    return [];
  }

  const data = await response.json();
  type RawAspect = {
    localizedAspectName: string;
    aspectConstraint?: { aspectRequired?: boolean; aspectMode?: string };
    aspectValues?: { localizedValue: string }[];
  };

  return (data.aspects ?? [])
    .filter((aspect: RawAspect) => aspect.aspectConstraint?.aspectRequired)
    .map((aspect: RawAspect) => ({
      name: aspect.localizedAspectName,
      allowedValues: (aspect.aspectValues ?? []).map((v) => v.localizedValue),
      selectionOnly: aspect.aspectConstraint?.aspectMode === 'SELECTION_ONLY',
    }));
}

export async function suggestCategory(
  query: string,
): Promise<{ categoryId: string; categoryTreeId: string }> {
  const accessToken = await getApplicationToken();

  const treeResponse = await ebayFetch(
    `/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${EBAY.marketplaceId}`,
    accessToken,
  );
  if (!treeResponse.ok) throw new EbayApiError('Looking up the eBay category', await treeResponse.text());
  const { categoryTreeId } = await treeResponse.json();

  const suggestResponse = await ebayFetch(
    `/commerce/taxonomy/v1/category_tree/${categoryTreeId}/get_category_suggestions?q=${encodeURIComponent(query)}`,
    accessToken,
  );
  if (!suggestResponse.ok) throw new EbayApiError('Looking up the eBay category', await suggestResponse.text());
  const data = await suggestResponse.json();
  const suggestion = data.categorySuggestions?.[0]?.category?.categoryId;
  if (!suggestion) throw new Error(`No eBay category found for "${query}"`);
  return { categoryId: suggestion, categoryTreeId };
}

/**
 * The Inventory API can only create listings for sellers enrolled in eBay's
 * Business Policies programme, so enrol the account if it isn't already.
 */
export async function ensureBusinessPoliciesOptIn(accessToken: string): Promise<void> {
  const status = await ebayFetch('/sell/account/v1/program/get_opted_in_programs', accessToken);
  if (status.ok) {
    const data = await status.json();
    const programs: string[] = (data.programs ?? []).map((p: { programType: string }) => p.programType);
    if (programs.includes('SELLING_POLICY_MANAGEMENT')) return;
  }

  const optIn = await ebayFetch('/sell/account/v1/program/opt_in', accessToken, {
    method: 'POST',
    body: JSON.stringify({ programType: 'SELLING_POLICY_MANAGEMENT' }),
  });
  if (!optIn.ok) {
    const detail = await optIn.text();
    // Already enrolled is reported as an error; anything else is a real failure.
    if (!detail.includes('already opted in')) {
      throw new Error(
        `Could not enrol your eBay account in Business Policies: ${detail}. ` +
          `You may need to set them up manually in eBay Seller Hub → Account → Business policies.`,
      );
    }
  }
}

/**
 * An offer can only be published once eBay knows where the item ships from.
 * Reuses the seller's existing location if they have one.
 */
export async function ensureInventoryLocation(accessToken: string): Promise<string> {
  const postalCode = process.env.EBAY_LOCATION_POSTCODE;

  const existing = await ebayFetch('/sell/inventory/v1/location?limit=1', accessToken);
  if (existing.ok) {
    const data = await existing.json();
    const location = data.locations?.[0];
    if (location?.merchantLocationKey) {
      // A location saved with a missing or partial postcode blocks publishing
      // (eBay 25012), so bring it back in line with the configured one.
      const current = location.location?.address?.postalCode;
      if (postalCode && current !== postalCode) {
        const updated = await ebayFetch(
          `/sell/inventory/v1/location/${location.merchantLocationKey}/update_location_details`,
          accessToken,
          {
            method: 'POST',
            body: JSON.stringify({
              location: { address: { country: ebayCountry(), postalCode } },
            }),
          },
        );
        if (!updated.ok) {
          throw new EbayApiError('Updating your item location', await updated.text());
        }
      }
      return location.merchantLocationKey;
    }
  }

  const key = 'easylisting-default';
  const created = await ebayFetch(`/sell/inventory/v1/location/${key}`, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      location: {
        address: {
          country: ebayCountry(),
          ...(postalCode ? { postalCode } : {}),
        },
      },
      name: 'Easy Listing',
      merchantLocationStatus: 'ENABLED',
      locationTypes: ['WAREHOUSE'],
    }),
  });

  if (!created.ok) {
    const detail = await created.text();
    if (!detail.includes('already exists')) {
      throw new EbayApiError('Saving your item location', detail);
    }
  }
  return key;
}

/** Returns the seller's first fulfillment/payment/return policy IDs (they must exist on the account). */
export async function getSellerPolicies(accessToken: string) {
  await ensureBusinessPoliciesOptIn(accessToken);

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
    if (!response.ok) throw new EbayApiError('Reading your eBay business policies', await response.text());
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

  // Resolve the category first: which conditions are legal depends on it.
  const { categoryId, categoryTreeId } = await suggestCategory(draft.categoryQuery);
  const condition = await supportedCondition(categoryTreeId, categoryId, draft.condition);

  const aspects = await requiredAspects(categoryTreeId, categoryId);
  const aspectValues = await chooseAspectValues(draft.title, draft.description, aspects);
  console.log(`eBay category ${categoryId} requires aspects`, JSON.stringify(aspectValues));

  const inventoryItem = {
    availability: { shipToLocationAvailability: { quantity: 1 } },
    condition,
    product: {
      title: draft.title.slice(0, 80),
      description: draft.description,
      imageUrls: imageUrls.slice(0, 12),
      ...(Object.keys(aspectValues).length ? { aspects: aspectValues } : {}),
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
      throw new EbayApiError('Creating the listing', await itemResponse.text());
    }
  }

  const policies = await getSellerPolicies(accessToken);
  const merchantLocationKey = await ensureInventoryLocation(accessToken);

  const offerResponse = await ebayFetch('/sell/inventory/v1/offer', accessToken, {
    method: 'POST',
    body: JSON.stringify({
      sku,
      marketplaceId: EBAY.marketplaceId,
      format: 'FIXED_PRICE',
      listingDescription: draft.description,
      availableQuantity: 1,
      categoryId,
      merchantLocationKey,
      listingPolicies: policies,
      pricingSummary: {
        price: { value: draft.price.toFixed(2), currency: draft.currency },
      },
    }),
  });
  if (!offerResponse.ok) throw new EbayApiError('Creating the listing', await offerResponse.text());
  const { offerId } = await offerResponse.json();

  if (!publish) return { offerId };

  const publishResponse = await ebayFetch(`/sell/inventory/v1/offer/${offerId}/publish`, accessToken, {
    method: 'POST',
  });
  if (!publishResponse.ok) throw new EbayApiError('Publishing the listing', await publishResponse.text());
  const { listingId } = await publishResponse.json();
  return { offerId, listingId };
}

export function listingViewURL(listingId: string) {
  return ENV === 'production'
    ? `https://www.ebay.co.uk/itm/${listingId}`
    : `https://sandbox.ebay.co.uk/itm/${listingId}`;
}
