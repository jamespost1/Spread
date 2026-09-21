// Price history.
//
// Every supported product page the extension opens yields a price. Recording
// those, keyed by product rather than by person, gives Spread two things no
// retailer API can:
//
//   - A history for the page the user is on right now, so there is something
//     useful to say even when no comparison offer exists. This is most product
//     pages, because the free retailer APIs cover a narrow slice of the catalog.
//   - Cross-retailer prices that accumulate from real traffic, so coverage grows
//     with usage instead of being capped by which APIs will have us.
//
// What is stored is a fact about a product: "this cost $328 at Best Buy at this
// time". No user identifier is attached, and none is needed -- an observation is
// worth exactly the same whoever saw it.

const MAX_POINTS = 300;
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;
const HISTORY_TTL_SECONDS = Math.ceil(RETENTION_MS / 1000);

/**
 * How stale a same-retailer, same-price observation may be before it is worth
 * writing again. KV writes are the scarce resource here -- reads are ~100x
 * cheaper -- so an unchanged price is read, recognised, and dropped.
 */
const REDUNDANT_WINDOW_MS = 6 * 60 * 60 * 1000;

/** A cross-retailer price older than this is not worth showing as an offer. */
const OFFER_FRESHNESS_MS = 48 * 60 * 60 * 1000;

/**
 * Record a price observation and return the resulting summary.
 *
 * @param {KVNamespace} kv
 * @param {string} key Product key from src/core/product-key.js.
 * @param {{retailer: string, price: number, url?: string, title?: string}} observation
 * @returns {Promise<{summary: object, wrote: boolean}>}
 */
export async function recordObservation(kv, key, observation) {
  const now = Date.now();
  const history = await readHistory(kv, key);

  const point = {
    r: observation.retailer,
    p: observation.price,
    t: now,
  };

  if (isRedundant(history.points, point, now)) {
    // Nothing has changed. Return what we know without spending a write.
    return { summary: summarize(history.points, observation, now), wrote: false };
  }

  const points = prune([...history.points, point], now);
  await kv.put(
    `history:${key}`,
    JSON.stringify({ points, updatedAt: now }),
    { expirationTtl: HISTORY_TTL_SECONDS }
  );

  return { summary: summarize(points, observation, now), wrote: true };
}

/**
 * Read a product's history without recording anything.
 * @param {KVNamespace} kv
 * @param {string} key
 */
export async function readHistory(kv, key) {
  const raw = await kv.get(`history:${key}`);
  if (!raw) return { points: [], updatedAt: null };

  try {
    const parsed = JSON.parse(raw);
    return {
      points: Array.isArray(parsed.points) ? parsed.points : [],
      updatedAt: parsed.updatedAt || null,
    };
  } catch {
    return { points: [], updatedAt: null };
  }
}

/**
 * Recent prices observed at retailers *other* than the one being viewed, shaped
 * as comparison offers.
 *
 * These come from other users' page views, so they are real observed prices
 * rather than estimates -- but they are also a snapshot rather than a live
 * quote, which is why each carries the timestamp it was seen at and why stale
 * ones are dropped entirely.
 *
 * @param {KVNamespace} kv
 * @param {string} key
 * @param {string} currentRetailer
 * @returns {Promise<object[]>}
 */
export async function observedOffers(kv, key, currentRetailer) {
  const { points } = await readHistory(kv, key);
  const cutoff = Date.now() - OFFER_FRESHNESS_MS;

  // Keep only the most recent observation per other retailer.
  const latest = new Map();
  for (const point of points) {
    if (!point || point.r === currentRetailer || point.t < cutoff) continue;
    const existing = latest.get(point.r);
    if (!existing || point.t > existing.t) latest.set(point.r, point);
  }

  return [...latest.values()].map((point) => ({
    retailer: point.r,
    price: point.p,
    observedAt: point.t,
    source: 'observed',
    // Deliberately no URL: the price was seen on a page we did not record,
    // so link to nothing rather than to a guess.
    url: null,
  }));
}

/**
 * Reduce a point series to the few facts worth showing a shopper.
 *
 * @param {object[]} points
 * @param {{retailer: string, price: number}} current
 * @param {number} now
 */
function summarize(points, current, now = Date.now()) {
  // Only this retailer's own series is comparable over time -- mixing in other
  // retailers would make "lowest ever" mean nothing.
  const series = points.filter((p) => p && p.r === current.retailer);

  if (series.length === 0) {
    return { retailer: current.retailer, points: 0, current: current.price };
  }

  const prices = series.map((p) => p.p).filter(Number.isFinite);
  const lowest = Math.min(...prices);
  const highest = Math.max(...prices);
  const oldest = Math.min(...series.map((p) => p.t));
  const days = Math.max(1, Math.round((now - oldest) / (24 * 60 * 60 * 1000)));

  return {
    retailer: current.retailer,
    points: series.length,
    current: current.price,
    lowest,
    highest,
    days,
    // Needs more than one observation to be a claim rather than a tautology.
    isLowest: series.length > 1 && current.price <= lowest,
    // Only meaningful once there is a real spread to compare against.
    dropFromHighest:
      highest > lowest ? Math.round((highest - current.price) * 100) / 100 : 0,
  };
}

/** True when this observation adds nothing the series does not already say. */
function isRedundant(points, candidate, now) {
  return points.some(
    (p) =>
      p &&
      p.r === candidate.r &&
      p.p === candidate.p &&
      now - p.t < REDUNDANT_WINDOW_MS
  );
}

/** Drop expired points, then cap the series oldest-first. */
function prune(points, now) {
  const cutoff = now - RETENTION_MS;
  const fresh = points
    .filter((p) => p && Number.isFinite(p.p) && p.t >= cutoff)
    .sort((a, b) => a.t - b.t);

  return fresh.length > MAX_POINTS ? fresh.slice(fresh.length - MAX_POINTS) : fresh;
}
