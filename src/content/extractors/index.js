// Product extraction.
//
// Two passes, in order of trustworthiness:
//   1. schema.org JSON-LD / microdata — structured, retailer-authored, stable.
//   2. CSS selectors — brittle, but the only option when a site ships no
//      structured data (or ships it incomplete, which is common).
//
// Anything that fails both passes yields null, and Spread stays invisible on
// the page rather than showing a half-read product.

import { parsePrice } from '../../core/price.js';
import { sourceRetailerFor } from '../../core/retailers.js';
import { SELECTORS } from './selectors.js';

/**
 * @typedef {object} Product
 * @property {string} retailer
 * @property {string} title
 * @property {number|null} price
 * @property {string|null} brand
 * @property {string|null} model
 * @property {string|null} sku
 * @property {string|null} imageUrl
 * @property {string} url
 * @property {Element|null} priceElement Anchor for button injection.
 */

/**
 * Read the product on the current page.
 * @param {Document} [doc]
 * @param {Location|URL} [loc]
 * @returns {Product|null}
 */
export function extractProduct(doc = document, loc = window.location) {
  const retailer = sourceRetailerFor(loc.hostname);
  if (!retailer) return null;

  const config = SELECTORS[retailer];
  if (!config || !config.productUrl.test(loc.href)) return null;

  const structured = readStructuredData(doc);
  const priceElement = findFirst(doc, config.price);

  const title = structured.title || textOf(findFirst(doc, config.title));
  if (!title) return null;

  const price =
    (Number.isFinite(structured.price) ? structured.price : null) ??
    parsePrice(textOf(priceElement));

  // A product with no readable price is not useful — the whole feature is a
  // price comparison — so bail rather than render a button that can't help.
  if (!Number.isFinite(price)) return null;

  return {
    retailer,
    title: title.trim().slice(0, 300),
    price,
    brand: structured.brand || textOf(findFirst(doc, config.brand)) || null,
    model: structured.model || null,
    sku: structured.sku || null,
    imageUrl: structured.image || srcOf(findFirst(doc, config.image)),
    url: canonicalUrl(doc, loc),
    priceElement,
  };
}

/** True when this page looks like a supported product page. */
export function isProductPage(_doc = document, loc = window.location) {
  const retailer = sourceRetailerFor(loc.hostname);
  if (!retailer) return false;
  const config = SELECTORS[retailer];
  return Boolean(config && config.productUrl.test(loc.href));
}

/**
 * Pull whatever schema.org Product data the page ships.
 * @returns {{title?: string, price?: number, brand?: string, model?: string, sku?: string, image?: string}}
 */
function readStructuredData(doc) {
  const out = {};

  for (const node of doc.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed;
    try {
      parsed = JSON.parse(node.textContent || '');
    } catch {
      continue; // Malformed JSON-LD is common; skip it silently.
    }

    const product = findProductNode(parsed);
    if (!product) continue;

    if (!out.title && typeof product.name === 'string') out.title = product.name;
    if (!out.brand) out.brand = nameOf(product.brand);
    if (!out.model && product.model) out.model = String(product.model);
    if (!out.sku && (product.sku || product.mpn)) out.sku = String(product.sku || product.mpn);
    if (!out.image) out.image = firstImage(product.image);
    if (out.price == null) {
      const offer = firstOffer(product.offers);
      const value = offer?.price ?? offer?.lowPrice;
      const currency = offer?.priceCurrency;
      // Only trust a structured price that is explicitly USD or unlabelled.
      if (value != null && (!currency || currency === 'USD')) {
        const parsed = parsePrice(String(value));
        if (parsed != null) out.price = parsed;
      }
    }
  }
  return out;
}

/** Walk a JSON-LD payload (object, array, or @graph) for the first Product. */
function findProductNode(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 4) return null;

  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findProductNode(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }

  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === 'string' && t.toLowerCase().includes('product'))) {
    return node;
  }
  if (node['@graph']) return findProductNode(node['@graph'], depth + 1);
  return null;
}

function firstOffer(offers) {
  if (!offers) return null;
  if (Array.isArray(offers)) return offers[0] || null;
  if (offers['@type'] === 'AggregateOffer' || offers.lowPrice) return offers;
  return offers;
}

function nameOf(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.name === 'string') return value.name;
  return null;
}

function firstImage(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) return firstImage(image[0]);
  if (typeof image === 'object' && image.url) return String(image.url);
  return null;
}

/**
 * First element matching any selector, preferring one that is actually visible
 * and descending into shadow roots when the light DOM has nothing.
 *
 * Both behaviours come from live pages. Target renders several price nodes and
 * hides all but one, so taking the first match anchored the button inside a
 * `visibility: hidden` container -- present in the DOM, invisible to the user.
 * Costco puts its price inside web components, where `querySelector` cannot
 * reach at all.
 */
function findFirst(doc, selectors) {
  let fallback = null;

  for (const selector of selectors || []) {
    let matches;
    try {
      matches = doc.querySelectorAll(selector);
    } catch {
      continue; // A selector a future Chrome rejects must not break extraction.
    }
    for (const el of matches) {
      if (isVisible(el)) return el;
      if (!fallback) fallback = el;
    }
  }

  // Nothing visible in the light DOM -- try shadow roots before giving up.
  for (const selector of selectors || []) {
    const el = queryShadow(doc, selector);
    if (el) return el;
  }

  // A hidden match still carries usable text for title or brand; only the
  // price element is used as a layout anchor, and a hidden anchor beats none.
  return fallback;
}

/**
 * Visibility by computed style only.
 *
 * Deliberately not using getBoundingClientRect: a collapsed rect is normal for
 * an element that has not been laid out yet, and test environments report zero
 * for everything. `visibility` and `display` inherit the way we need, so an
 * element inside a hidden container reports hidden here.
 */
function isVisible(el) {
  if (!el) return false;
  const view = el.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return true; // No layout engine: assume visible.

  try {
    const style = view.getComputedStyle(el);
    if (!style) return true;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (style.display === 'none') return false;
    if (style.opacity !== '' && Number(style.opacity) === 0) return false;
    return true;
  } catch {
    return true;
  }
}

/** Search open shadow roots breadth-first. Only runs when the light DOM missed. */
function queryShadow(root, selector, depth = 0) {
  if (depth > 4) return null;

  let hosts;
  try {
    hosts = root.querySelectorAll('*');
  } catch {
    return null;
  }

  for (const host of hosts) {
    const shadow = host.shadowRoot;
    if (!shadow) continue;
    try {
      const direct = shadow.querySelector(selector);
      if (direct) return direct;
    } catch {
      continue;
    }
    const nested = queryShadow(shadow, selector, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function textOf(el) {
  return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
}

function srcOf(el) {
  if (!el) return null;
  return el.getAttribute('src') || el.getAttribute('data-src') || null;
}

/** Prefer the canonical link so cache keys are stable across tracking params. */
function canonicalUrl(doc, loc) {
  const link = doc.querySelector('link[rel="canonical"]');
  const href = link?.getAttribute('href');
  if (href) {
    try {
      return new URL(href, loc.href).href;
    } catch {
      /* fall through to the raw location */
    }
  }
  return loc.href;
}
