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
//
// The retailer the shopper is currently on is deliberately NOT filtered here.
// Results are cached per product rather than per source retailer, so the set
// has to be complete; the current retailer is removed when serving.

import { parsePrice } from '../../../src/core/price.js';
import { retailerFromUrl, retailerSearchUrl, isKnownRetailer } from '../../../src/core/retailers.js';

const ENDPOINT = 'https://google.serper.dev/shopping';

/**
 * Search Google Shopping for a product.
 *
 * @param {object} product Normalized source product.
 * @param {string} apiKey Serper API key.
 * @returns {Promise<object[]>} Offer candidates.
 */
export async function searchShopping(product, apiKey, { includeMarketplace = false } = {}) {
  if (!apiKey) return { returned: 0, offers: [] };

  const query = buildQuery(product);
  if (!query) return { returned: 0, offers: [] };

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 20 }),
  });

  if (!response.ok) {
    throw new Error(`Serper ${response.status}`);
  }

  const data = await response.json();
  const raw = data.shopping || [];
  return {
    // The pre-filter count matters: without it there is no way to tell a thin
    // result ("Google found little") from an over-aggressive filter ("Google
    // found plenty and we threw it away"), and those need opposite fixes.
    returned: raw.length,
    offers: raw.map((item) => toOffer(item, product, includeMarketplace)).filter(Boolean),
  };
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

  // Strip the variant suffix retailers append to a model. Best Buy reports
  // "WH1000XM6/B" for the black one, and searching that string returns almost
  // nothing -- one merchant instead of the whole market -- because no listing
  // is indexed under it.
  const model = String(product.model || '').split('/')[0].trim();
  if (model) parts.push(model);

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

function toOffer(item, product, includeMarketplace) {
  const price = parsePrice(String(item.price ?? ''));
  if (!Number.isFinite(price) || price <= 0) return null;

  const { retailer, seller } = splitMerchant(item.source);
  const name = retailer || (item.link ? retailerFromUrl(item.link) : null);
  if (!name) return null;

  // Quote only retailers a shopper would recognise and can reach. The long
  // tail Google returns is mostly unreachable or not the same goods.
  if (!isKnownRetailer(name)) return null;

  // Serper exposes no merchant URL, so route to wherever the offer is actually
  // reachable. A retailer's own search finds its own stock reliably; it will
  // not find a marketplace seller's listing, and for those the Google product
  // page is the only destination that names the seller and links to a purchase.
  const marketplace = Boolean(seller) && seller.toLowerCase() !== name.toLowerCase();

  // A third-party listing is excluded by default, and the reasons compound:
  // the price cannot be verified, the seller is not the retailer whose name
  // would be displayed, and there is no page that shows that specific offer --
  // the store's own product page shows the store's own price, which is a
  // different number than the one quoted. Set INCLUDE_MARKETPLACE to allow it.
  if (marketplace && !includeMarketplace) return null;
  const productPage = item.productId
    ? `https://www.google.com/shopping/product/${encodeURIComponent(item.productId)}`
    : null;
  const storeSearch = retailerSearchUrl(name, product.model || product.title);

  const target = marketplace
    ? productPage || storeSearch || item.link
    : storeSearch || productPage || item.link;
  if (!target) return null;

  return {
    retailer: name,
    seller: marketplace ? seller : null,
    title: item.title || '',
    price,
    url: target,
    urlKind: target === storeSearch ? 'store-search' : target === productPage ? 'offer-page' : 'google',
    imageUrl: item.imageUrl || null,
    brand: null,
    model: null,
    sku: null,
    inStock: true,
    source: 'google-shopping',
  };
}

/**
 * Split "Walmart - Focus Camera" into the storefront and who is actually
 * selling. Google uses the same separator for marketing noise ("Best Buy -
 * Official Site"), so phrases that name no real seller are discarded rather
 * than reported as one.
 *
 * This matters: a marketplace listing shown as plain "Walmart" overstates it.
 * The price is real, but who is behind it is part of whether to trust it.
 */
function splitMerchant(source) {
  if (!source || typeof source !== 'string') return { retailer: null, seller: null };

  const parts = source.split(/\s+[-–|]\s+/).map((x) => x.trim()).filter(Boolean);
  const retailer = (parts[0] || '').replace(/\.(com|net|org|co)\b.*$/i, '').trim();
  if (retailer.length < 2 || retailer.length > 40) return { retailer: null, seller: null };

  const MARKETING = /^(official\s+(site|store)|seller|store|shop|online)$/i;
  const rest = parts.slice(1).find((x) => !MARKETING.test(x)) || null;

  return { retailer, seller: rest && rest.length <= 40 ? rest : null };
}
