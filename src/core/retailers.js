// Retailer identification and product-URL validation.

/**
 * Retailers Spread can read a product directly off the page for. These are the
 * only sites the content script is allowed to run on (see manifest matches).
 */
export const SOURCE_RETAILERS = {
  'amazon.com': 'Amazon',
  'target.com': 'Target',
  'walmart.com': 'Walmart',
  'bestbuy.com': 'Best Buy',
  'ebay.com': 'eBay',
  'costco.com': 'Costco',
};

/**
 * Retailers Spread can query for live prices, and the API each one is served
 * by. Adding a retailer here without a working adapter in the Worker will
 * simply yield no offers for it.
 */
export const PRICED_RETAILERS = {
  'bestbuy.com': { name: 'Best Buy', source: 'bestbuy-api' },
  'ebay.com': { name: 'eBay', source: 'ebay-api' },
};

/** Domain fragment -> display name, for labelling links we cannot price. */
const RETAILER_NAMES = {
  amazon: 'Amazon', target: 'Target', walmart: 'Walmart', costco: 'Costco',
  bestbuy: 'Best Buy', ebay: 'eBay', kroger: 'Kroger', walgreens: 'Walgreens',
  homedepot: 'Home Depot', lowes: "Lowe's", kohls: "Kohl's", macys: "Macy's",
  jcpenney: 'JCPenney', overstock: 'Overstock', wayfair: 'Wayfair',
  zappos: 'Zappos', newegg: 'Newegg', bhphotovideo: 'B&H Photo',
  microcenter: 'Micro Center', apple: 'Apple', staples: 'Staples',
  officedepot: 'Office Depot', rei: 'REI', chewy: 'Chewy', petco: 'Petco',
  petsmart: 'PetSmart', ikea: 'IKEA', gamestop: 'GameStop', ulta: 'Ulta Beauty',
  sephora: 'Sephora', nordstrom: 'Nordstrom', nike: 'Nike', adidas: 'Adidas',
  sony: 'Sony', samsung: 'Samsung', dell: 'Dell', lenovo: 'Lenovo', jbl: 'JBL',
};

/**
 * Resolve a hostname or URL to a human-readable retailer name.
 * @param {string} input
 * @returns {string|null}
 */
export function retailerFromUrl(input) {
  const host = hostnameOf(input);
  if (!host) return null;

  for (const [fragment, name] of Object.entries(RETAILER_NAMES)) {
    // Match on a label boundary so "notamazon.com" does not resolve to Amazon.
    if (host === fragment || host.split('.').includes(fragment)) return name;
  }
  return null;
}

/**
 * Which source retailer, if any, a page belongs to.
 * @param {string} input hostname or URL
 * @returns {string|null} Display name.
 */
export function sourceRetailerFor(input) {
  const host = hostnameOf(input);
  if (!host) return null;

  for (const [domain, name] of Object.entries(SOURCE_RETAILERS)) {
    if (host === domain || host.endsWith(`.${domain}`)) return name;
  }
  return null;
}

/**
 * Reject anything that is not a plain http(s) link before it reaches an href.
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeHttpUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** Normalize a hostname from a URL or a bare host string. */
function hostnameOf(input) {
  if (!input || typeof input !== 'string') return null;
  try {
    const host = input.includes('://')
      ? new URL(input).hostname
      : input.split('/')[0];
    return host.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * Where to send someone for a product we know the retailer of but not the URL.
 *
 * Google Shopping names the merchant but only ever links back to Google, so
 * without this every "view" leaves the shopper on a search page they did not
 * ask for. A retailer's own search for a model number reliably surfaces the
 * product, which is a far better destination than Google -- and honest,
 * provided the link is labelled as a search rather than a product page.
 */
const SEARCH_URLS = {
  Amazon: 'https://www.amazon.com/s?k=',
  Target: 'https://www.target.com/s?searchTerm=',
  Walmart: 'https://www.walmart.com/search?q=',
  'Best Buy': 'https://www.bestbuy.com/site/searchpage.jsp?st=',
  eBay: 'https://www.ebay.com/sch/i.html?_nkw=',
  Costco: 'https://www.costco.com/CatalogSearch?keyword=',
  Newegg: 'https://www.newegg.com/p/pl?d=',
  'B&H Photo': 'https://www.bhphotovideo.com/c/search?q=',
  'Home Depot': 'https://www.homedepot.com/s/',
  "Lowe's": 'https://www.lowes.com/search?searchTerm=',
  "Kohl's": 'https://www.kohls.com/search.jsp?search=',
  "Macy's": 'https://www.macys.com/shop/featured/',
  Wayfair: 'https://www.wayfair.com/keyword.php?keyword=',
  Staples: 'https://www.staples.com/search?query=',
  GameStop: 'https://www.gamestop.com/search/?q=',
  Chewy: 'https://www.chewy.com/s?query=',
  REI: 'https://www.rei.com/search?q=',
  Nordstrom: 'https://www.nordstrom.com/sr?keyword=',
};

/**
 * A search URL on the retailer's own site, or null if we do not know one.
 * @param {string} retailer Display name.
 * @param {string} query Usually a model number.
 * @returns {string|null}
 */
export function retailerSearchUrl(retailer, query) {
  const base = SEARCH_URLS[retailer];
  if (!base || !query) return null;
  return base + encodeURIComponent(String(query).trim().slice(0, 120));
}
