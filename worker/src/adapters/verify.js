// Read the price off the page Spread is about to link to.
//
// This exists because of a real failure. Google Shopping supplied the price
// and a separate site-restricted search supplied the link, and nothing tied
// the two together -- so an eBay offer was shown at $256.27 linking to a
// listing that said $374.99. Two unrelated listings, one displayed as the
// other.
//
// A price and its destination have to come from the same place. Google
// Shopping is now used only for discovery -- which retailers carry the thing --
// and the number shown is read from the product page itself. An offer whose
// price cannot be read is dropped, because the alternative is quoting a figure
// no page supports, which is the one failure this product must not have.

import { parsePrice } from '../../../src/core/price.js';

const SCRAPE_ENDPOINT = 'https://scrape.serper.dev';
const VERIFIED_TTL_SECONDS = 6 * 60 * 60;

/**
 * Fetch a product page and read its advertised price.
 *
 * @param {string} url Product page to read.
 * @param {string} apiKey Serper key.
 * @param {KVNamespace} kv
 * @returns {Promise<{price: number, title: string}|null>}
 */
export async function verifyPrice(url, apiKey, kv) {
  if (!url || !apiKey) return null;

  const cacheKey = `verified:${url}`.slice(0, 500);
  const cached = await kv.get(cacheKey);
  if (cached !== null) {
    if (!cached) return null; // Cached "looked, could not read it".
    try {
      return JSON.parse(cached);
    } catch {
      /* fall through and re-read */
    }
  }

  let result = null;
  try {
    const response = await fetch(SCRAPE_ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (response.ok) {
      const data = await response.json();
      result = readProduct(data.jsonld);
    }
  } catch {
    return null; // Leave the cache alone so a transient failure can retry.
  }

  await kv.put(cacheKey, result ? JSON.stringify(result) : '', {
    expirationTtl: VERIFIED_TTL_SECONDS,
  });
  return result;
}

/**
 * Pull name and price out of a page's structured data.
 *
 * Only JSON-LD is trusted. The scrape also returns page text, and a price
 * could be pattern-matched out of it -- but that is precisely the unreliable
 * snippet-scraping the previous implementation of this project got wrong, and
 * a wrong price is worse than a missing one.
 */
function readProduct(jsonld) {
  const product = findProduct(jsonld, 0);
  if (!product) return null;

  const offer = firstOffer(product.offers);
  const currency = offer?.priceCurrency;
  if (currency && currency !== 'USD') return null;

  const price = parsePrice(String(offer?.price ?? offer?.lowPrice ?? ''));
  if (!Number.isFinite(price)) return null;

  return { price, title: typeof product.name === 'string' ? product.name : '' };
}

function findProduct(node, depth) {
  if (!node || typeof node !== 'object' || depth > 4) return null;

  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findProduct(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === 'string' && t.toLowerCase().includes('product'))) {
    return node;
  }
  if (node['@graph']) return findProduct(node['@graph'], depth + 1);
  return null;
}

function firstOffer(offers) {
  if (!offers) return null;
  if (Array.isArray(offers)) return offers[0] || null;
  return offers;
}
