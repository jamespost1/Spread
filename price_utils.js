// price_utils.js
// Shared utilities for parsing price text and formatting currency.

/**
 * Try to parse the first currency-like number in a string.
 * Returns number in float (USD assumed) or null.
 */
function parsePriceText(text) {
  if (!text || typeof text !== "string") return null;
  // Remove non-breaking spaces
  text = text.replace(/\u00A0/g, " ");
  // Regex: find currency symbol optional, digits, comma/period
  // We'll accept numbers like "$1,234.56", "1,234.56", "€123.45", "£99"
  const m = text.match(/([£€¥$])?\s*([0-9]{1,3}(?:[, \u00A0][0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)/);
  if (!m) return null;
  // m[2] has numeric with commas/spaces — remove commas/spaces
  const cleaned = m[2].replace(/[, \u00A0]/g, "");
  const v = parseFloat(cleaned);
  if (isNaN(v)) return null;
  return v;
}

function formatCurrency(n) {
  if (n == null || isNaN(n)) return "--";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}
