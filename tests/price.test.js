import { describe, it, expect } from 'vitest';
import { parsePrice, formatPrice, priceDelta, bestSaving, flagOutliers } from '../src/core/price.js';

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

describe('flagOutliers', () => {
  // The guard used to switch off below three prices, which left it blind
  // exactly where corroboration was thinnest: a lone Best Buy offer at $198
  // against a $399.99 page went through unflagged.
  it('falls back to the viewed page when there is no consensus', () => {
    const flagged = flagOutliers(
      [{ retailer: 'Best Buy', price: 198 }, { retailer: 'Target', price: 399.99 }],
      399.99
    );
    expect(flagged.find((o) => o.retailer === 'Best Buy').suspect).toBe(true);
    expect(flagged.find((o) => o.retailer === 'Target').suspect).toBe(false);
  });

  it('leaves a merely good deal alone', () => {
    const flagged = flagOutliers([{ retailer: 'Walmart', price: 348 }], 399.99);
    expect(flagged[0].suspect).toBe(false);
  });

  it('flags nothing when there is neither consensus nor a reference', () => {
    const flagged = flagOutliers([{ retailer: 'Best Buy', price: 198 }]);
    expect(flagged[0].suspect).toBe(false);
  });

  it('a consensus outranks the viewed page price', () => {
    // Three retailers agree near $378; the page being viewed is mispriced
    // high. The median still decides, so the $210.99 reseller is flagged and
    // the honest offers are not.
    const flagged = flagOutliers(
      [
        { retailer: 'Walmart', price: 210.99 },
        { retailer: 'Best Buy', price: 378 },
        { retailer: 'Target', price: 379 },
        { retailer: 'Amazon', price: 377 },
      ],
      9999
    );
    expect(flagged.find((o) => o.retailer === 'Walmart').suspect).toBe(true);
    expect(flagged.filter((o) => o.suspect)).toHaveLength(1);
  });

  it('flags a price far below a tight consensus', () => {
    // Observed live: a Walmart marketplace reseller at $210.99 against three
    // retailers within $2 of $378, headlined as "Save $167.01".
    const flagged = flagOutliers([
      { retailer: 'Walmart', price: 210.99 },
      { retailer: 'Best Buy', price: 378 },
      { retailer: 'Target', price: 379.99 },
    ]);
    expect(flagged.find((o) => o.retailer === 'Walmart').suspect).toBe(true);
    expect(flagged.find((o) => o.retailer === 'Best Buy').suspect).toBe(false);
  });

  it('leaves a genuine discount alone', () => {
    const flagged = flagOutliers([
      { retailer: 'A', price: 340 },
      { retailer: 'B', price: 378 },
      { retailer: 'C', price: 380 },
    ]);
    expect(flagged.some((o) => o.suspect)).toBe(false);
  });

  it('flags nothing when there is no consensus to measure against', () => {
    // Two prices cannot establish one -- either could be the odd one out.
    const flagged = flagOutliers([
      { retailer: 'A', price: 199 },
      { retailer: 'B', price: 378 },
    ]);
    expect(flagged.some((o) => o.suspect)).toBe(false);
  });

  it('keeps a suspect price out of the headline saving', () => {
    const flagged = flagOutliers([
      { retailer: 'Walmart', price: 210.99 },
      { retailer: 'Best Buy', price: 378 },
      { retailer: 'Target', price: 379.99 },
    ]);
    expect(bestSaving(378, flagged)).toBeNull();
  });

  it('still reports a saving from a trustworthy offer', () => {
    const flagged = flagOutliers([
      { retailer: 'A', price: 340 },
      { retailer: 'B', price: 378 },
      { retailer: 'C', price: 380 },
    ]);
    expect(bestSaving(378, flagged).savings).toBe(38);
  });

  it('handles empty input', () => {
    expect(flagOutliers([])).toEqual([]);
    expect(flagOutliers(null)).toEqual([]);
  });
});
