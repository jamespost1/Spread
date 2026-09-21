import { describe, it, expect } from 'vitest';
import { recordObservation, readHistory, observedOffers } from '../worker/src/history.js';

function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  let writes = 0;
  return {
    writeCount: () => writes,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      writes++;
      store.set(key, value);
    },
  };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Seed a history directly, with timestamps relative to now. */
function seed(kv, key, points) {
  const now = Date.now();
  return kv.put(
    `history:${key}`,
    JSON.stringify({
      points: points.map((p) => ({ r: p.r, p: p.p, t: now - (p.agoMs || 0) })),
      updatedAt: now,
    })
  );
}

describe('recordObservation', () => {
  it('records the first observation for a product', async () => {
    const kv = fakeKV();
    const { summary, wrote } = await recordObservation(kv, 'm:sony:WH1000XM5', {
      retailer: 'Amazon',
      price: 349.99,
    });

    expect(wrote).toBe(true);
    expect(summary.points).toBe(1);
    expect(summary.current).toBe(349.99);
    // A single point cannot support a "lowest ever" claim.
    expect(summary.isLowest).toBe(false);
  });

  it('skips the write when the same price was already seen recently', async () => {
    const kv = fakeKV();
    await seed(kv, 'k', [{ r: 'Amazon', p: 349.99, agoMs: 2 * HOUR }]);

    const before = kv.writeCount();
    const { wrote } = await recordObservation(kv, 'k', { retailer: 'Amazon', price: 349.99 });

    expect(wrote).toBe(false);
    expect(kv.writeCount()).toBe(before);
  });

  it('records again once the redundancy window has passed', async () => {
    const kv = fakeKV();
    await seed(kv, 'k', [{ r: 'Amazon', p: 349.99, agoMs: 10 * HOUR }]);

    const { wrote } = await recordObservation(kv, 'k', { retailer: 'Amazon', price: 349.99 });
    expect(wrote).toBe(true);
  });

  it('records a price change immediately', async () => {
    const kv = fakeKV();
    await seed(kv, 'k', [{ r: 'Amazon', p: 349.99, agoMs: 1 * HOUR }]);

    const { wrote, summary } = await recordObservation(kv, 'k', { retailer: 'Amazon', price: 299.99 });
    expect(wrote).toBe(true);
    expect(summary.lowest).toBe(299.99);
    expect(summary.isLowest).toBe(true);
  });

  it('reports the lowest and highest seen for this retailer', async () => {
    const kv = fakeKV();
    await seed(kv, 'k', [
      { r: 'Amazon', p: 399.99, agoMs: 30 * DAY },
      { r: 'Amazon', p: 379.99, agoMs: 20 * DAY },
      { r: 'Amazon', p: 349.99, agoMs: 10 * DAY },
    ]);

    const { summary } = await recordObservation(kv, 'k', { retailer: 'Amazon', price: 329.99 });
    expect(summary.lowest).toBe(329.99);
    expect(summary.highest).toBe(399.99);
    expect(summary.isLowest).toBe(true);
    expect(summary.dropFromHighest).toBe(70);
    expect(summary.days).toBeGreaterThanOrEqual(30);
  });

  it('does not mix other retailers into the time series', async () => {
    const kv = fakeKV();
    await seed(kv, 'k', [
      { r: 'Amazon', p: 349.99, agoMs: 10 * DAY },
      { r: 'Best Buy', p: 199.99, agoMs: 5 * DAY },
    ]);

    // Best Buy's much lower price must not make Amazon look mid-range.
    const { summary } = await recordObservation(kv, 'k', { retailer: 'Amazon', price: 339.99 });
    expect(summary.retailer).toBe('Amazon');
    expect(summary.lowest).toBe(339.99);
    expect(summary.points).toBe(2);
  });

  it('caps the stored series', async () => {
    const kv = fakeKV();
    const many = Array.from({ length: 320 }, (_, i) => ({
      r: 'Amazon',
      p: 100 + i,
      agoMs: (320 - i) * HOUR,
    }));
    await seed(kv, 'k', many);

    await recordObservation(kv, 'k', { retailer: 'Amazon', price: 42 });
    const { points } = await readHistory(kv, 'k');
    expect(points.length).toBeLessThanOrEqual(300);
    // The newest observation survives the cap.
    expect(points[points.length - 1].p).toBe(42);
  });

  it('drops observations older than the retention window', async () => {
    const kv = fakeKV();
    await seed(kv, 'k', [
      { r: 'Amazon', p: 999, agoMs: 400 * DAY },
      { r: 'Amazon', p: 349, agoMs: 5 * DAY },
    ]);

    await recordObservation(kv, 'k', { retailer: 'Amazon', price: 349 });
    const { points } = await readHistory(kv, 'k');
    expect(points.some((p) => p.p === 999)).toBe(false);
  });
});

describe('readHistory', () => {
  it('returns an empty series for an unknown product', async () => {
    expect(await readHistory(fakeKV(), 'nope')).toEqual({ points: [], updatedAt: null });
  });

  it('treats a corrupt entry as empty rather than throwing', async () => {
    const kv = fakeKV({ 'history:k': '{ not json' });
    expect((await readHistory(kv, 'k')).points).toEqual([]);
  });
});

describe('observedOffers', () => {
  it('returns recent prices from other retailers only', async () => {
    const kv = fakeKV();
    await seed(kv, 'k', [
      { r: 'Amazon', p: 349.99, agoMs: 1 * HOUR },
      { r: 'Best Buy', p: 328.0, agoMs: 2 * HOUR },
      { r: 'Walmart', p: 341.5, agoMs: 3 * HOUR },
    ]);

    const offers = await observedOffers(kv, 'k', 'Amazon');
    expect(offers.map((o) => o.retailer).sort()).toEqual(['Best Buy', 'Walmart']);
  });

  it('keeps only the most recent price per retailer', async () => {
    const kv = fakeKV();
    await seed(kv, 'k', [
      { r: 'Best Buy', p: 399.0, agoMs: 20 * HOUR },
      { r: 'Best Buy', p: 328.0, agoMs: 1 * HOUR },
    ]);

    const offers = await observedOffers(kv, 'k', 'Amazon');
    expect(offers).toHaveLength(1);
    expect(offers[0].price).toBe(328.0);
  });

  it('drops prices too stale to quote', async () => {
    const kv = fakeKV();
    await seed(kv, 'k', [{ r: 'Best Buy', p: 328.0, agoMs: 5 * DAY }]);
    expect(await observedOffers(kv, 'k', 'Amazon')).toEqual([]);
  });

  it('links to nothing rather than guessing a product URL', async () => {
    const kv = fakeKV();
    await seed(kv, 'k', [{ r: 'Best Buy', p: 328.0, agoMs: 1 * HOUR }]);

    const [offer] = await observedOffers(kv, 'k', 'Amazon');
    expect(offer.url).toBeNull();
    expect(offer.source).toBe('observed');
    expect(offer.observedAt).toBeTypeOf('number');
  });

  it('returns nothing for an unknown product', async () => {
    expect(await observedOffers(fakeKV(), 'nope', 'Amazon')).toEqual([]);
  });
});
