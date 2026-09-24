// Stable cross-retailer product identity.
//
// A product key is what lets a price seen on Amazon and a price seen on Best
// Buy land in the same history. It must be derivable from one listing alone --
// there is no pair to compare against at observation time -- which makes it a
// harder problem than matching, not an easier one.
//
// The governing risk is collision: two different products sharing a key merge
// into one price history and the extension shows a price that was never real.
// That is the same failure as a false match, so it gets the same treatment --
// return null and record nothing rather than guess.

import { normalizeTitle, tokenize, extractModelNumbers, canonicalModelCode } from './normalize.js';

/** Minimum distinctive tokens before a title-derived key is trustworthy. */
const MIN_TOKENS = 3;

/** Tokens too generic to distinguish products, even in combination. */
const WEAK_TOKENS = new Set([
  'black', 'white', 'blue', 'red', 'green', 'grey', 'gray', 'silver', 'gold',
  'navy', 'brown', 'pink', 'purple', 'orange', 'yellow', 'beige', 'tan',
  'charcoal', 'cream', 'ivory', 'teal', 'maroon', 'olive', 'rose', 'bronze',
  'small', 'medium', 'large', 'wireless', 'bluetooth', 'digital', 'portable',
  'premium', 'edition', 'version', 'series', 'model', 'color', 'size',
  'inch', 'count', 'pack', 'piece', 'case', 'cover', 'kit',
]);

/**
 * Derive a stable key for a product listing.
 *
 * @param {{title?: string, brand?: string, model?: string}} product
 * @returns {string|null} A key, or null when identity cannot be established
 *   confidently enough to be worth recording.
 */
export function productKey(product) {
  if (!product) return null;

  const brand = normalizeTitle(product.brand || '').replace(/\s+/g, '');

  // Strongest: an explicit manufacturer model number. Globally unique in
  // practice, and identical across every retailer that carries the item.
  const declared = canonicalModelCode(product.model, product.brand);
  if (declared) return brand ? `m:${brand}:${declared}` : `m:${declared}`;

  // Next: a model code mined from the title. Only trusted when exactly one
  // distinct candidate survives -- several means we cannot tell which
  // identifies the product and which is a capacity, a year, or a pack count.
  const mined = canonicalCodes(extractModelNumbers(product.title || ''));
  if (mined.length === 1) {
    return brand ? `m:${brand}:${mined[0]}` : `m:${mined[0]}`;
  }

  // Weakest: brand plus distinctive title tokens. Requires a known brand, so
  // that a generic title can never collide across manufacturers.
  if (!brand) return null;

  const tokens = tokenize(product.title || '')
    .filter((token) => !WEAK_TOKENS.has(token))
    .filter((token) => token !== brand);

  const distinctive = [...new Set(tokens)].sort().slice(0, 6);
  if (distinctive.length < MIN_TOKENS) return null;

  return `t:${brand}:${distinctive.join('-')}`;
}

/**
 * How much to trust a key, which decides whether it may be used to join prices
 * across retailers or only to track one retailer's price over time.
 *
 * @param {string|null} key
 * @returns {'strong'|'weak'|'none'}
 */
export function keyStrength(key) {
  if (!key) return 'none';
  return key.startsWith('m:') ? 'strong' : 'weak';
}

/**
 * Collapse codes that are spellings of one another.
 *
 * `extractModelNumbers` deliberately scans both the raw and de-hyphenated form
 * of a title, so "WH-1000XM5" yields both "1000XM5" and "WH1000XM5". Those are
 * one code, not two, and treating them as two makes every hyphenated model
 * look ambiguous. Group by containment and keep the most specific spelling.
 *
 * @param {string[]} codes
 * @returns {string[]}
 */
function canonicalCodes(codes) {
  const sorted = [...new Set(codes)].sort((a, b) => b.length - a.length);
  const kept = [];

  for (const code of sorted) {
    // Longest first, so a shorter code contained in one already kept is a
    // spelling of it rather than a separate identifier.
    if (!kept.some((existing) => existing.includes(code))) kept.push(code);
  }
  return kept;
}

