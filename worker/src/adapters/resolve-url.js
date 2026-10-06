// Resolve an offer to the retailer's actual product page.
//
// Google Shopping names the merchant and the price but never links to the
// store, so an offer on its own can only send a shopper to a search page. That
// is the right price attached to the wrong destination.
//
// A site-restricted web search does give the real URL: Google has the product
// page indexed, and asking for it by model number on that one domain returns
// it directly. The result is then validated against the retailer's own product
// URL shape, so a category or search page is never mistaken for a listing.
//
// This costs one search credit per (product, retailer) pair -- but only once.
// A product's URL at a given retailer effectively never changes, so resolved
// links are cached for a month and almost every lookup is free thereafter.

import { SELECTORS } from '../../../src/content/extractors/selectors.js';

const SEARCH_ENDPOINT = 'https://google.serper.dev/search';
const URL_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Domains to search, per retailer display name. */
const DOMAINS = {
  Amazon: 'amazon.com',
  Target: 'target.com',
  Walmart: 'walmart.com',
  'Best Buy': 'bestbuy.com',
  eBay: 'ebay.com',
  Costco: 'costco.com',
  Newegg: 'newegg.com',
  "Macy's": 'macys.com',
  "Kohl's": 'kohls.com',
  'B&H Photo': 'bhphotovideo.com',
  'Home Depot': 'homedepot.com',
  "Lowe's": 'lowes.com',
  Wayfair: 'wayfair.com',
  Staples: 'staples.com',
  GameStop: 'gamestop.com',
  Chewy: 'chewy.com',
  REI: 'rei.com',
  Nordstrom: 'nordstrom.com',
  Overstock: 'overstock.com',
  Zappos: 'zappos.com',
};

/**
 * Generic shapes that mark a URL as a product page at retailers we have no
 * specific pattern for. Deliberately conservative: a false positive sends the
 * shopper somewhere irrelevant, which is worse than falling back to a search.
 */
const GENERIC_PRODUCT_URL = /\/(p|ip|dp|product|products|item|pd)\/|\/[a-z0-9-]{8,}\/?$/i;

/** Pages that are definitely not a listing, whatever else they look like. */
const NOT_A_PRODUCT = /\/(search|s|browse|category|c|shop|deals|b|sb)\b|[?&](q|query|keyword|searchTerm)=/i;

/**
 * Find the product page for one offer.
 *
 * Never throws and never blocks the comparison: any failure returns null and
 * the caller keeps whatever fallback destination it already had.
 *
 * @param {string} retailer Display name.
 * @param {string} query Model number, or a title when there is no model.
 * @param {string} apiKey Serper key.
 * @param {KVNamespace} kv
 * @returns {Promise<string|null>}
 */
export async function resolveProductUrl(retailer, query, apiKey, kv) {
  const domain = DOMAINS[retailer];
  if (!domain || !query || !apiKey) return null;

  const cacheKey = `url:${domain}:${String(query).toLowerCase().replace(/\s+/g, '-').slice(0, 80)}`;

  const cached = await kv.get(cacheKey);
  // An empty string is a cached "looked, found nothing" -- honour it rather
  // than paying for the same failed lookup again.
  if (cached !== null) return cached || null;

  let found = null;
  try {
    const response = await fetch(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `${query} site:${domain}`, gl: 'us', num: 10 }),
    });
    if (response.ok) {
      const data = await response.json();
      found = pickProductUrl(data.organic || [], domain, retailer);
    }
  } catch {
    return null; // Leave the cache alone so a transient failure can retry.
  }

  await kv.put(cacheKey, found || '', { expirationTtl: URL_TTL_SECONDS });
  return found;
}

/** First organic result on the right domain that looks like a listing. */
function pickProductUrl(results, domain, retailer) {
  const pattern = SELECTORS[retailer]?.productUrl;

  for (const result of results) {
    const link = result?.link;
    if (!link || typeof link !== 'string') continue;

    let host;
    try {
      host = new URL(link).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      continue;
    }
    if (host !== domain && !host.endsWith(`.${domain}`)) continue;
    if (NOT_A_PRODUCT.test(link)) continue;

    // Prefer the retailer's own known product URL shape where we have one --
    // those patterns already drive extraction, so they are well tested.
    if (pattern) {
      if (pattern.test(link)) return link;
      continue;
    }
    if (GENERIC_PRODUCT_URL.test(link)) return link;
  }
  return null;
}
