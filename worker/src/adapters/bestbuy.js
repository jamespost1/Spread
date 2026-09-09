// Best Buy Products API adapter.
//
// Free, open registration, real-time pricing. Docs: https://bestbuyapis.github.io/api-documentation/

const BASE = 'https://api.bestbuy.com/v1/products';
const FIELDS = 'sku,name,salePrice,regularPrice,url,image,manufacturer,modelNumber,onlineAvailability';

/**
 * Search Best Buy for a product.
 * @param {object} product Normalized source product.
 * @param {string} apiKey
 * @returns {Promise<object[]>} Offer objects.
 */
export async function searchBestBuy(product, apiKey) {
  if (!apiKey) return [];

  // Best Buy's search grammar is positional: `(search=a&search=b)` is an AND
  // over terms. Model number first when we have one -- it is far more precise
  // than title words.
  const terms = buildTerms(product);
  if (terms.length === 0) return [];

  const query = `(${terms.map((t) => `search=${encodeURIComponent(t)}`).join('&')})`;
  const url = `${BASE}${query}?apiKey=${encodeURIComponent(apiKey)}&format=json&show=${FIELDS}&pageSize=10`;

  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Best Buy API ${response.status}`);
  }

  const data = await response.json();
  return (data.products || []).map(toOffer).filter(Boolean);
}

function buildTerms(product) {
  const terms = [];
  if (product.model) terms.push(product.model);

  // Without a model number, fall back to the most distinctive title words.
  if (terms.length === 0 && product.title) {
    const words = product.title
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 4);
    terms.push(...words);
  }
  return terms.slice(0, 5);
}

function toOffer(item) {
  const price = Number(item.salePrice ?? item.regularPrice);
  if (!Number.isFinite(price) || price <= 0) return null;

  return {
    retailer: 'Best Buy',
    title: item.name || '',
    price,
    url: item.url || null,
    imageUrl: item.image || null,
    brand: item.manufacturer || null,
    model: item.modelNumber || null,
    sku: item.sku != null ? String(item.sku) : null,
    inStock: item.onlineAvailability !== false,
    source: 'bestbuy-api',
  };
}
