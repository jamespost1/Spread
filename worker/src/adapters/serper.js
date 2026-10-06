// Google Shopping via Serper.
//
// This is the general-coverage price source. The first-party retailer APIs are
// precise but narrow -- Best Buy is electronics, eBay is a marketplace, and
// both sit behind approval gates. Google Shopping covers the whole catalog and
// returns the merchant and price as structured fields.
//
// Worth noting against the earlier implementation: that one used Google Custom
// Search, which returned web pages and forced prices to be scraped out of
// snippet text. That was unreliable in a way that mattered, because a wrong
// price is the worst thing this product can output. Shopping results carry a
// real price field, so no scraping is involved.
//
// Results are candidates, not answers. Google Shopping happily returns
// accessories, bundles and adjacent models for any query, so everything here
// goes through the match cascade before a shopper ever sees it.

import { parsePrice } from '../../../src/core/price.js';
import { retailerFromUrl } from '../../../src/core/retailers.js';

const ENDPOINT = 'https://google.serper.dev/shopping';

/**
 * Search Google Shopping for a product.
 *
 * @param {object} product Normalized source product.
 * @param {string} apiKey Serper API key.
 * @returns {Promise<object[]>} Offer candidates.
 */
export async function searchShopping(product, apiKey) {
  if (!apiKey) return [];

  const query = buildQuery(product);
  if (!query) return [];

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 20 }),
  });

  if (!response.ok) {
    throw new Error(`Serper ${response.status}`);
  }

  const data = await response.json();
  return (data.shopping || [])
    .map((item) => toOffer(item, product))
    .filter(Boolean);
}

/**
 * Build the query.
 *
 * A model number is worth more than any number of title words, because Google
 * matches it exactly and it is what distinguishes adjacent generations. Falls
 * back to brand plus the most distinctive title words.
 */
function buildQuery(product) {
  const parts = [];
  if (product.brand) parts.push(product.brand);
  if (product.model) parts.push(product.model);

  if (parts.length < 2 && product.title) {
    const words = product.title
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 6);
    parts.push(...words);
  }
  return parts.join(' ').trim().slice(0, 120) || null;
}

function toOffer(item, product) {
  const price = parsePrice(String(item.price ?? ''));
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!item.link) return null;

  // Google names the merchant; fall back to deriving it from the link.
  const retailer = cleanMerchant(item.source) || retailerFromUrl(item.link);
  if (!retailer) return null;

  // Never offer the page the shopper is already on as an alternative.
  if (product.retailer && retailer.toLowerCase() === product.retailer.toLowerCase()) {
    return null;
  }

  return {
    retailer,
    title: item.title || '',
    price,
    url: item.link,
    imageUrl: item.imageUrl || null,
    brand: null,
    model: null,
    sku: null,
    inStock: true,
    source: 'google-shopping',
  };
}

/** Google appends noise to merchant names: "Best Buy - Official Site". */
function cleanMerchant(source) {
  if (!source || typeof source !== 'string') return null;
  const name = source
    .split(/\s+[-–|]\s+/)[0]
    .replace(/\.(com|net|org|co)\b.*$/i, '')
    .trim();
  return name.length >= 2 && name.length <= 40 ? name : null;
}
