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
 * Fetch a product page and read what it is and what it costs.
 *
 * Title and price are returned independently. A page whose price cannot be
 * read is still worth identifying, because naming a retailer that carries the
 * product requires knowing the page is that product -- and a URL found by
 * site-restricted search can easily land on an accessory. Returning the title
 * without a price is what lets the caller check the match before saying
 * anything at all.
 *
 * @param {string} url Product page to read.
 * @param {string} apiKey Serper key.
 * @param {KVNamespace} kv
 * @returns {Promise<{title: string, price: number|null}|null>}
 */
export async function readProductPage(url, apiKey, kv) {
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
      result = readProduct(data.jsonld, data.metadata?.title);
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
function readProduct(jsonld, pageTitle) {
  const product = findProduct(jsonld, 0);

  const title =
    (product && typeof product.name === 'string' && product.name) ||
    cleanPageTitle(pageTitle) ||
    '';
  if (!title) return null;

  let price = null;
  if (product) {
    const offer = firstOffer(product.offers);
    const currency = offer?.priceCurrency;
    if (!currency || currency === 'USD') {
      const parsed = parsePrice(String(offer?.price ?? offer?.lowPrice ?? ''));
      if (Number.isFinite(parsed)) price = parsed;
    }
  }

  return { title, price };
}

/** Strip the retailer suffix retailers append to a page title. */
function cleanPageTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title.split(/\s+[|:–-]\s+/)[0].trim();
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
