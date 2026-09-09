// Text normalization for product titles.
//
// Retail titles are noisy in predictable ways: the same product is listed as
// "Sony WH-1000XM5 Wireless Headphones - Black" on one site and
// "Sony - WH1000XM5 Noise Cancelling Headphones (Black), New" on another.
// Everything here exists to strip that variance before two titles are compared.

/**
 * Filler words that carry no identifying signal in a product title. Removing
 * them keeps token overlap from being inflated by boilerplate.
 */
export const STOPWORDS = new Set([
  'the', 'and', 'or', 'for', 'with', 'of', 'a', 'an', 'in', 'on', 'at', 'to',
  'by', 'from', 'new', 'brand', 'genuine', 'official', 'authentic', 'free',
  'shipping', 'sale', 'deal', 'best', 'top', 'buy', 'shop', 'online', 'store',
  'pack', 'pairs', 'pair', 'set', 'bundle', 'includes', 'included', 'item',
]);

/**
 * Lowercase, strip punctuation, collapse whitespace.
 * @param {string} text
 * @returns {string}
 */
export function normalizeTitle(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split a title into meaningful tokens, dropping stopwords and single/double
 * character fragments.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return normalizeTitle(text)
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
}

/**
 * Patterns that identify a manufacturer model number / SKU inside a title.
 * Ordered loosely from most to least specific. A match on any of these is the
 * single strongest same-product signal available from title text alone.
 */
const MODEL_PATTERNS = [
  /\b[A-Z]{2,5}-?[0-9]{4,8}\b/g,   // ABC-1234, ABC1234
  /\b[0-9]{3,}[A-Z]{1,4}\b/g,      // 520BT, 123ABC
  /\b[A-Z0-9]{5,12}\b/g,           // generic alphanumeric codes
  /#[A-Z0-9-]+\b/g,                // #ABC-123
  /\b[A-Z]+[0-9]+[A-Z]*\b/g,       // ABC123, ABC123D
  /\b[0-9]{12,14}\b/g,             // UPC
];

/**
 * Words that match MODEL_PATTERNS but are plain English, not model numbers.
 * Without this filter, titles sharing the word "BLACK" score as a model match.
 */
const MODEL_FALSE_POSITIVES = new Set([
  'THE', 'AND', 'FOR', 'WITH', 'BLACK', 'WHITE', 'GREEN', 'BLUE', 'SILVER',
  'SMALL', 'LARGE', 'XLARGE', 'MEDIUM', 'WIRELESS', 'BLUETOOTH', 'DIGITAL',
  'PORTABLE', 'PREMIUM', 'EDITION', 'VERSION', 'SERIES', 'MODEL', 'COLOR',
]);

/**
 * A number followed by a unit is a specification, not an identifier.
 *
 * This matters more than it looks. "512GB" satisfies the generic alphanumeric
 * model pattern, so without this filter two entirely different Dell laptops
 * that both mention 512GB share a "model code" and get confirmed as the same
 * product -- a false match of exactly the kind the matcher exists to prevent.
 */
const MEASUREMENT = new RegExp(
  '^[0-9]+(?:\\.[0-9]+)?(' +
    'GB|TB|MB|KB|GHZ|MHZ|KHZ|HZ|MM|CM|IN|FT|OZ|FLOZ|ML|LB|LBS|KG|' +
    'WATT|WATTS|MAH|AH|WH|VOLT|VOLTS|PSI|RPM|BTU|MP|NM|DPI|PPI|' +
    'CT|PK|PC|QT|GAL|W|V|K|P' +
  ')$'
);

/**
 * Extract candidate model numbers / SKUs from a title.
 * @param {string} title
 * @returns {string[]} Uppercased, punctuation-stripped codes.
 */
export function extractModelNumbers(title) {
  if (!title || typeof title !== 'string') return [];

  // Manufacturers and retailers spell the same code both ways ("WH-1000XM5"
  // and "WH1000XM5"), so scan a de-hyphenated variant too and let both
  // spellings collapse to the same token.
  const variants = [title, title.replace(/(?<=[A-Za-z0-9])-(?=[A-Za-z0-9])/g, '')];

  const models = new Set();
  for (const pattern of MODEL_PATTERNS) {
    const matches = variants.flatMap((v) => v.match(pattern) || []);
    for (const match of matches) {
      const code = match.toUpperCase().replace(/[^\w]/g, '');
      if (code.length < 4) continue;
      if (MODEL_FALSE_POSITIVES.has(code)) continue;
      // A code made only of letters is a word, not a model number.
      if (!/[0-9]/.test(code)) continue;
      // A capacity, size or wattage identifies a variant, not a product.
      if (MEASUREMENT.test(code)) continue;
      models.add(code);
    }
  }
  return Array.from(models);
}

/**
 * Extract quantity / size markers ("150 count", "2-pack", "24 oz").
 * Two listings that agree on brand *and* pack size are almost always the same
 * SKU, which lets us match consumables that carry no model number.
 * @param {string} title
 * @returns {string[]} Normalized "<number> <unit>" strings.
 */
export function extractQuantities(title) {
  if (!title || typeof title !== 'string') return [];

  const quantities = new Set();
  const unitPattern =
    /\b(\d+(?:\.\d+)?)\s*-?\s*(count|ct|pack|pk|piece|pc|oz|fl\s?oz|ml|l|lb|lbs|kg|g|gal|qt)\b/gi;

  let match;
  while ((match = unitPattern.exec(title)) !== null) {
    const amount = match[1];
    const unit = match[2].toLowerCase().replace(/\s+/g, '');
    quantities.add(`${amount} ${normalizeUnit(unit)}`);
  }
  return Array.from(quantities);
}

/** Collapse unit aliases so "ct" and "count" compare equal. */
function normalizeUnit(unit) {
  const aliases = {
    ct: 'count', pk: 'pack', pc: 'piece', lbs: 'lb', floz: 'floz',
  };
  return aliases[unit] || unit;
}
