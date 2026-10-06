import { describe, it, expect } from 'vitest';
import { chooseHeadline } from '../src/core/headline.js';

const at = (price) => ({ price });
const hist = (o) => ({ retailer: 'Amazon', points: 5, days: 23, ...o });

describe('chooseHeadline — priority order', () => {
  it('leads with a cheaper retailer above everything else', () => {
    const h = chooseHeadline(
      at(349.99),
      [{ retailer: 'Best Buy', price: 299.99 }],
      hist({ isLowest: true, lowest: 349.99, highest: 399.99 })
    );
    expect(h.kind).toBe('cheaper-elsewhere');
    expect(h.title).toBe('Save $50.00');
    expect(h.detail).toContain('Best Buy');
  });

  it('leads with the low-water mark when no offer undercuts it', () => {
    const h = chooseHeadline(at(299.99), [], hist({ isLowest: true, lowest: 299.99, highest: 399.99 }));
    expect(h.kind).toBe('lowest-ever');
    expect(h.tone).toBe('good');
    expect(h.title).toBe('Lowest price in 23 days');
    expect(h.detail).toContain('$399.99');
  });

  it('says how far above the low it is, so waiting is an informed choice', () => {
    const h = chooseHeadline(at(349.99), [], hist({ isLowest: false, lowest: 299.99, highest: 399.99 }));
    expect(h.kind).toBe('above-low');
    expect(h.title).toBe('$50.00 above the low');
    expect(h.detail).toContain('$299.99');
  });

  it('reports a flat price rather than staying silent', () => {
    const h = chooseHeadline(at(299.99), [], hist({ isLowest: false, lowest: 299.99, highest: 299.99 }));
    expect(h.kind).toBe('steady');
    expect(h.title).toBe('Steady at $299.99');
  });

  it('falls back to comparisons when there is no history yet', () => {
    const h = chooseHeadline(at(299.99), [{ retailer: 'eBay', price: 320 }], null);
    expect(h.kind).toBe('best-available');
    expect(h.detail).toContain('1 other listing');
  });

  it('pluralizes the listing count', () => {
    const h = chooseHeadline(at(299), [{ price: 320 }, { price: 340 }], null);
    expect(h.detail).toContain('2 other listings');
  });
});

describe('chooseHeadline — the common case', () => {
  it('never reports failure on a first visit', () => {
    // This is what most product pages produce, so it must not read as an error.
    const h = chooseHeadline(at(299.99), [], null);
    expect(h.kind).toBe('now-tracking');
    expect(h.title).toBe('Now tracking this price');
    expect(h.detail).toContain('$299.99');
    expect(h.title.toLowerCase()).not.toContain('no ');
    expect(h.detail.toLowerCase()).not.toContain('could not');
  });

  it('treats a single observation as no history, not as a low', () => {
    // One point makes "lowest ever" a tautology.
    const h = chooseHeadline(at(299.99), [], hist({ points: 1, isLowest: true, lowest: 299.99 }));
    expect(h.kind).toBe('now-tracking');
  });

  it('handles a missing history object', () => {
    expect(chooseHeadline(at(50), [], undefined).kind).toBe('now-tracking');
  });

  it('ignores offers that carry no usable price', () => {
    const h = chooseHeadline(at(299.99), [{ retailer: 'eBay', price: null }], null);
    expect(h.kind).toBe('best-available');
  });
});

describe('chooseHeadline — tone', () => {
  it('marks only genuinely good news as good', () => {
    const good = ['cheaper-elsewhere', 'lowest-ever', 'best-available'];
    const cases = [
      chooseHeadline(at(349), [{ retailer: 'X', price: 300 }], null),
      chooseHeadline(at(299), [], hist({ isLowest: true, lowest: 299, highest: 399 })),
      chooseHeadline(at(299), [{ price: 320 }], null),
      chooseHeadline(at(349), [], hist({ isLowest: false, lowest: 299, highest: 399 })),
      chooseHeadline(at(299), [], hist({ isLowest: false, lowest: 299, highest: 299 })),
      chooseHeadline(at(299), [], null),
    ];
    for (const c of cases) {
      expect(c.tone).toBe(good.includes(c.kind) ? 'good' : 'neutral');
    }
  });
});
