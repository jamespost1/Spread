// eBay Browse API adapter.
//
// Free tier: 5,000 calls/day, raised for free via eBay's Application Growth
// Check. Uses the OAuth client-credentials flow; the token is cached in KV so
// we spend one token request per two hours rather than one per search.

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const SCOPE = 'https://api.ebay.com/oauth/api_scope';
const TOKEN_CACHE_KEY = 'ebay:oauth-token';

/**
 * Search eBay for a product.
 * @param {object} product
 * @param {{clientId: string, clientSecret: string}} credentials
 * @param {KVNamespace} kv
 * @returns {Promise<object[]>}
 */
export async function searchEbay(product, credentials, kv) {
  if (!credentials?.clientId || !credentials?.clientSecret) return [];

  const query = buildQuery(product);
  if (!query) return [];

  const token = await getAccessToken(credentials, kv);

  const url = new URL(SEARCH_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '10');
  // New items only, in USD. Used and refurbished units are not comparable to a
  // new retail listing and would make the price column dishonest.
  url.searchParams.set('filter', 'conditions:{NEW},buyingOptions:{FIXED_PRICE}');

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      // Restricts results to the US marketplace, so prices are USD.
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });

  if (!response.ok) {
    throw new Error(`eBay API ${response.status}`);
  }

  const data = await response.json();
  return (data.itemSummaries || []).map(toOffer).filter(Boolean);
}

function buildQuery(product) {
  const parts = [];
  if (product.brand) parts.push(product.brand);
  if (product.model) parts.push(product.model);

  if (parts.length < 2 && product.title) {
    const words = product.title
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 5);
    parts.push(...words);
  }
  return parts.join(' ').trim().slice(0, 100) || null;
}

/** Fetch an application access token, reusing the cached one when it is fresh. */
async function getAccessToken(credentials, kv) {
  const cached = await kv.get(TOKEN_CACHE_KEY);
  if (cached) return cached;

  const basic = btoa(`${credentials.clientId}:${credentials.clientSecret}`);
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: SCOPE }),
  });

  if (!response.ok) {
    throw new Error(`eBay OAuth ${response.status}`);
  }

  const data = await response.json();
  const token = data.access_token;
  // eBay issues 2-hour tokens; expire ours a little early to avoid racing the
  // boundary on a slow request.
  const ttl = Math.max(60, Number(data.expires_in || 7200) - 300);
  await kv.put(TOKEN_CACHE_KEY, token, { expirationTtl: ttl });
  return token;
}

function toOffer(item) {
  const price = Number(item.price?.value);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (item.price?.currency && item.price.currency !== 'USD') return null;

  // eBay quotes shipping separately, and a $9 item with $30 shipping is not a
  // $9 offer. Fold it in so the comparison is honest.
  const shipping = Number(item.shippingOptions?.[0]?.shippingCost?.value ?? 0);
  const total = Number.isFinite(shipping) ? price + shipping : price;

  return {
    retailer: 'eBay',
    title: item.title || '',
    price: Math.round(total * 100) / 100,
    basePrice: price,
    shipping: Number.isFinite(shipping) ? shipping : null,
    url: item.itemWebUrl || null,
    imageUrl: item.image?.imageUrl || null,
    brand: item.brand || null,
    model: null,
    sku: item.itemId || null,
    inStock: true,
    source: 'ebay-api',
  };
}
