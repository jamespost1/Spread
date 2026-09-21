import { describe, it, expect } from 'vitest';
import { parsePrice, formatPrice, priceDelta, bestSaving } from '../src/core/price.js';

describe('parsePrice', () => {
  it('parses a plain dollar amount', () => {
    expect(parsePrice('$349.99')).toBe(349.99);
  });

  it('parses thousands separators', () => {
    expect(parsePrice('$1,299.00')).toBe(1299);
  });

  it('parses a bare number', () => {
    expect(parsePrice('49.95')).toBe(49.95);
  });

  it('refuses non-USD currencies rather than guessing', () => {
    expect(parsePrice('£349.99')).toBeNull();
    expect(parsePrice('€1.299,00')).toBeNull();
    expect(parsePrice('349.99 EUR')).toBeNull();
  });

  it('rejects implausible values that indicate a parse error', () => {
    expect(parsePrice('$0')).toBeNull();
    expect(parsePrice('$999999')).toBeNull();
  });

  it('returns null for input with no number', () => {
    expect(parsePrice('Check price in cart')).toBeNull();
    expect(parsePrice('')).toBeNull();
    expect(parsePrice(null)).toBeNull();
  });
});

describe('formatPrice', () => {
  it('always shows two decimal places', () => {
    expect(formatPrice(349)).toBe('$349.00');
    expect(formatPrice(1299.5)).toBe('$1,299.50');
  });

  it('renders a dash for a missing price', () => {
    expect(formatPrice(null)).toBe('—');
    expect(formatPrice(NaN)).toBe('—');
  });
});

describe('priceDelta', () => {
  it('reports a cheaper candidate', () => {
    const d = priceDelta(400, 350);
    expect(d).toEqual({ absolute: -50, percent: -12.5, direction: 'cheaper' });
  });

  it('reports a pricier candidate', () => {
    expect(priceDelta(350, 400).direction).toBe('pricier');
  });

  it('reports an identical price', () => {
    expect(priceDelta(350, 350).direction).toBe('same');
  });

  it('returns null for unusable input', () => {
    expect(priceDelta(0, 350)).toBeNull();
    expect(priceDelta(350, null)).toBeNull();
  });
});

describe('bestSaving', () => {
  it('finds the cheapest priced offer', () => {
    const r = bestSaving(400, [
      { retailer: 'A', price: 380 },
      { retailer: 'B', price: 355 },
      { retailer: 'C', price: null },
    ]);
    expect(r.best.retailer).toBe('B');
    expect(r.savings).toBe(45);
  });

  it('returns null when nothing beats the current page', () => {
    expect(bestSaving(300, [{ price: 350 }])).toBeNull();
  });

  it('returns null when no offer carries a price', () => {
    expect(bestSaving(300, [{ price: null }, {}])).toBeNull();
    expect(bestSaving(300, [])).toBeNull();
  });
});
