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

function findFirst(doc, selectors) {
  for (const selector of selectors || []) {
    try {
      const el = doc.querySelector(selector);
      if (el) return el;
    } catch {
      // A selector that a future Chrome rejects should not break extraction.
    }
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
