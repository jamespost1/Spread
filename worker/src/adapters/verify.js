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
 * @param {{retailer?: string, reserve?: () => Promise<boolean>}} [options]
 *   `retailer` lets an offer sold by the store itself be preferred over a
 *   marketplace one. `reserve` is called immediately before the network
 *   request and may refuse it, which is how the daily Serper budget covers
 *   page reads as well as searches; a cache hit never calls it.
 * @returns {Promise<{title: string, price: number|null, text: string}|null>}
 */
export async function readProductPage(url, apiKey, kv, options = {}) {
  const { retailer = '', reserve = null } = options;
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

  // Past the cache, so this will cost a Serper call.
  if (reserve && !(await reserve())) return null;

  let result = null;
  try {
    const response = await fetch(SCRAPE_ENDPOINT, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (response.ok) {
      const data = await response.json();
      result = readProduct(data.jsonld, data.metadata?.title, retailer);
      if (result) {
        // Keep the top of the page only. A price further down belongs to a
        // related item, a recommendation carousel or a bundle, and would
        // corroborate the wrong thing.
        result.text = String(data.text || '').slice(0, 4000);
      }
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
 * Only JSON-LD is trusted as a *source* of a price. Several retailers --
 * Target among them -- render the price client-side and ship no structured
 * data at all, so there is frequently nothing here to read. Those are handled
 * by corroboration instead: see priceAppearsOnPage.
 */
function readProduct(jsonld, pageTitle, retailer = '') {
  const product = findProduct(jsonld, 0);

  const title =
    (product && typeof product.name === 'string' && product.name) ||
    cleanPageTitle(pageTitle) ||
    '';
  if (!title) return null;

  return { title, price: product ? priceFromOffers(product.offers, retailer) : null };
}

/**
 * The price a shopper would actually pay for this item on this page, or null
 * when the structured data does not say so unambiguously.
 *
 * A listing publishes more than one offer. Best Buy's page for the WH-1000XM5
 * carried an offer at $198 -- an open-box or marketplace unit -- while the
 * page itself charged $248. Reading whichever offer happened to come first,
 * and falling back to an AggregateOffer's `lowPrice`, quoted the $198 and then
 * linked the shopper to a page reading $248. That is the $118 eBay error in a
 * new costume, and it is the one failure this product cannot have.
 *
 * So: an AggregateOffer spans sellers and conditions, which makes its
 * `lowPrice` an answer to "what is the least anyone charges" rather than "what
 * does this page charge". It is never read as a price unless low and high
 * agree, which makes it unambiguous. And where several concrete offers survive
 * but disagree, this returns nothing rather than pick one -- the caller then
 * names the retailer without quoting a price, which is honest and is a state
 * the panel already renders.
 */
export function priceFromOffers(offers, retailer) {
  const concrete = concreteOffers(offers);
  if (concrete.length === 0) return null;

  // The store's own offer beats a marketplace seller's on the same page.
  const own = concrete.filter((o) => sellerMatches(o.seller, retailer));
  const pool = own.length > 0 ? own : concrete;

  const distinct = [...new Set(pool.map((o) => o.price))];
  return distinct.length === 1 ? distinct[0] : null;
}

/** `itemCondition` values that describe something other than a new unit. */
const NOT_NEW = /(used|refurb|damaged|open\s*-?box)/i;

/**
 * Flatten a JSON-LD `offers` value into the single purchasable offers inside
 * it, discarding anything priced in another currency or sold as not-new.
 */
function concreteOffers(node, depth = 0, out = []) {
  if (!node || typeof node !== 'object' || depth > 3) return out;

  if (Array.isArray(node)) {
    for (const entry of node) concreteOffers(entry, depth + 1, out);
    return out;
  }

  const types = [].concat(node['@type'] ?? []).filter((t) => typeof t === 'string');
  const usd = !node.priceCurrency || node.priceCurrency === 'USD';

  if (types.some((t) => /aggregateoffer/i.test(t))) {
    const low = parsePrice(String(node.lowPrice ?? ''));
    const high = parsePrice(String(node.highPrice ?? ''));
    if (usd && Number.isFinite(low) && Number.isFinite(high) && low === high) {
      out.push({ price: low, seller: sellerName(node) });
    }
    concreteOffers(node.offers, depth + 1, out); // Nested offers still count.
    return out;
  }

  const price = parsePrice(String(node.price ?? ''));
  if (usd && Number.isFinite(price) && !NOT_NEW.test(String(node.itemCondition || ''))) {
    out.push({ price, seller: sellerName(node) });
  }
  concreteOffers(node.offers, depth + 1, out);
  return out;
}

/** The named seller of an offer, however the page spells the field. */
function sellerName(offer) {
  const seller = offer?.seller ?? offer?.offeredBy;
  if (!seller) return '';
  return String(typeof seller === 'object' ? seller.name || '' : seller);
}

/** Whether an offer's seller is the retailer whose page this is. */
function sellerMatches(seller, retailer) {
  const a = String(seller || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = String(retailer || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
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

/**
 * Whether a price Google attributed to this retailer actually appears on the
 * retailer's own page.
 *
 * This is corroboration, not extraction, and the distinction is the whole
 * point. Pattern-matching a price *out of* page text is how the previous
 * implementation of this project produced numbers no listing supported.
 * Checking whether a number obtained elsewhere is *present* carries no such
 * risk: the only way to pass is for the page to say it too.
 *
 * It is exactly the check that would have caught the worst bug this project
 * has had -- Google claimed an eBay offer at $256.27 while the listing said
 * $374.99, and that page never contained $256.27.
 *
 * @param {string} text Page text, already truncated to the top of the page.
 * @param {number} price Price to look for.
 * @returns {boolean}
 */
export function priceAppearsOnPage(text, price) {
  if (!text || !Number.isFinite(price) || price <= 0) return false;

  const whole = Math.floor(price);
  const cents = Math.round((price - whole) * 100);
  const grouped = whole.toLocaleString('en-US');

  // Accept the forms a retailer actually renders: grouped or plain thousands,
  // cents present or omitted, with or without the symbol. Require a boundary
  // so 49.99 cannot be satisfied by 1,349.99.
  const amounts = new Set([
    `${grouped}.${String(cents).padStart(2, '0')}`,
    `${whole}.${String(cents).padStart(2, '0')}`,
  ]);
  if (cents === 0) {
    amounts.add(grouped);
    amounts.add(String(whole));
  }

  return [...amounts].some((amount) => {
    const escaped = amount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^0-9.,])\\$?\\s?${escaped}(?![0-9])`).test(text);
  });
}
