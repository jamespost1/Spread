// USD price parsing and comparison.
//
// Deliberately strict: a wrong price is worse than no price, because the whole
// premise of the product is that the numbers can be trusted.

/** Currency symbols that mean this figure is *not* USD. */
const NON_USD = /[£€¥₹₽₩]|\b(EUR|GBP|JPY|CAD|AUD|INR|CNY|MXN)\b/i;

/**
 * Parse a USD price out of free text. Returns null rather than guessing.
 * @param {string} text
 * @returns {number|null}
 */
export function parsePrice(text) {
  if (!text || typeof text !== 'string') return null;

  const cleaned = text.replace(/ /g, ' ').trim();
  if (NON_USD.test(cleaned)) return null;

  // The comma-grouped form must require an actual comma, and the whole match
  // must not be followed by another digit — otherwise "$999999" matches its
  // first three digits and silently parses as $999.
  const match = cleaned.match(
    /\$?\s*((?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]{1,2})?)(?![0-9])/
  );
  if (!match) return null;

  const value = parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  // Reject implausible retail figures — these are almost always a parse error
  // that picked up a review count, a model number, or a shipping weight.
  if (value <= 0 || value > 100000) return null;

  return Math.round(value * 100) / 100;
}

/**
 * Format a number as a USD string.
 * @param {number|null} value
 * @returns {string}
 */
export function formatPrice(value) {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Difference between a candidate price and the price the user is looking at.
 * @param {number} basePrice Price on the page the user is viewing.
 * @param {number} candidatePrice Price found elsewhere.
 * @returns {{absolute: number, percent: number, direction: 'cheaper'|'pricier'|'same'}|null}
 */
export function priceDelta(basePrice, candidatePrice) {
  if (!Number.isFinite(basePrice) || !Number.isFinite(candidatePrice)) return null;
  if (basePrice <= 0) return null;

  const absolute = Math.round((candidatePrice - basePrice) * 100) / 100;
  const percent = Math.round((absolute / basePrice) * 1000) / 10;

  let direction = 'same';
  if (absolute < 0) direction = 'cheaper';
  else if (absolute > 0) direction = 'pricier';

  return { absolute, percent, direction };
}

/**
 * The headline number: how much the cheapest option saves against this page.
 * @param {number} basePrice
 * @param {Array<{price?: number|null}>} offers
 * @returns {{best: object, savings: number}|null}
 */
export function bestSaving(basePrice, offers) {
  if (!Number.isFinite(basePrice)) return null;

  const priced = (offers || []).filter((o) => Number.isFinite(o?.price) && o.price > 0);
  if (priced.length === 0) return null;

  const best = priced.reduce((min, o) => (o.price < min.price ? o : min), priced[0]);
  const savings = Math.round((basePrice - best.price) * 100) / 100;
  return savings > 0 ? { best, savings } : null;
}
