// Spread comparison API.
//
// The extension holds no credentials and talks only to this Worker. Every
// retailer key and the Anthropic key live here as Wrangler secrets.
//
// Request flow:
//   1. Offer cache hit?              -> return immediately, no upstream calls.
//   2. Fan out to retailer adapters  -> free first-party APIs, in parallel.
//   3. Stage 1 match (deterministic) -> resolves most candidates for free.
//   4. Stage 2 match (LLM)           -> only the ambiguous ones, batched+capped.
//   5. Cache and return.

import { partitionCandidates, compareProducts, VERDICT } from '../../src/core/matching.js';
import { productKey, keyStrength } from '../../src/core/product-key.js';
import { searchBestBuy } from './adapters/bestbuy.js';
import { searchEbay } from './adapters/ebay.js';
import { searchShopping } from './adapters/serper.js';
import { resolveProductUrl } from './adapters/resolve-url.js';
import { readProductPage, priceAppearsOnPage } from './adapters/verify.js';
import { adjudicate, lastAdjudicatorError } from './adjudicator.js';
import { budgetStatus, dailyLimitFrom, shoppingLimitFrom, reserveCall } from './budget.js';
import { hashKey, getOffers, putOffers } from './cache.js';
import { handleChallenge, handleNotification } from './ebay-compliance.js';
import { recordObservation, observedOffers } from './history.js';

/** Per-install request ceiling, per hour. Blunt, but enough to stop a runaway loop. */
const RATE_LIMIT_PER_HOUR = 120;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return corsResponse(env, new Response(null, { status: 204 }));

    try {
      if (url.pathname === '/health') {
        return corsResponse(env, json(await health(env)));
      }
      if (url.pathname === '/v1/compare' && request.method === 'POST') {
        return corsResponse(env, await handleCompare(request, env, ctx));
      }
      if (url.pathname === '/v1/observe' && request.method === 'POST') {
        return corsResponse(env, await handleObserve(request, env));
      }

      // eBay calls this directly, not the extension, so it is deliberately
      // outside the CORS wrapper and must answer exactly what eBay expects.
      if (url.pathname === '/ebay/account-deletion') {
        if (request.method === 'GET') return handleChallenge(url, env);
        if (request.method === 'POST') return handleNotification(request);
      }

      return corsResponse(env, json({ error: 'not_found' }, 404));
    } catch (error) {
      // Never leak internals to the extension; log for the operator instead.
      console.error('unhandled', error);
      return corsResponse(env, json({ error: 'internal_error' }, 500));
    }
  },
};

async function handleCompare(request, env, ctx) {
  const body = await request.json().catch(() => null);
  const product = body?.product;

  if (!product?.title || !Number.isFinite(product.price)) {
    return json({ error: 'invalid_product' }, 400);
  }

  if (!(await withinRateLimit(env, limiterKey(request, body)))) {
    return json({ error: 'rate_limited' }, 429);
  }

  // Keyed on product identity, deliberately not on which retailer the shopper
  // happens to be viewing. The same headphones should yield the same offers
  // from Amazon as from Best Buy -- a per-retailer key made the answer depend
  // on where the question was asked, and did the same upstream work twice.
  // The source retailer is removed when serving instead.
  const identity = productKey(product);
  const cacheKey = identity || hashKey(product.title, product.model || '');

  // Observed prices are read fresh on every request, never served from the
  // offer cache. They change the moment anyone opens a product page, and
  // freezing them for six hours meant browsing a retailer and then checking
  // from another showed nothing -- the cached answer predated the visit.
  // The cache holds only what is expensive to produce: Shopping lookups,
  // page resolutions and price reads.
  const observedNow = identity && keyStrength(identity) === 'strong'
    ? (await observedOffers(env.SPREAD_KV, identity, product.retailer)).map((offer) => ({
        ...offer,
        title: product.title,
        match: { verdict: VERDICT.SAME, stage: 'observed', score: 1 },
      }))
    : [];

  const cached = await getOffers(env.SPREAD_KV, cacheKey);
  if (cached) {
    return json(serve(cached, observedNow, product.retailer, true));
  }

  // --- Fan out to every price source we have -------------------------------
  // Google Shopping is the broad one; the first-party APIs are narrower but
  // more precise.
  //
  // Every Serper call draws on one counter. It previously covered only the
  // Shopping lookup, while each comparison went on to make up to another
  // twelve -- a URL resolution and a page read for each of RESOLVE_TOP_N
  // offers -- none of them counted. A cap of 250 therefore permitted some
  // 3,250 calls a day and could drain the free grant inside one. The budget
  // now means what it says: calls, not comparisons.
  const reserveSerper = async () =>
    (await reserveCall(env.SPREAD_KV, shoppingLimitFrom(env), 'shopping')).allowed;

  const shoppingAllowed = Boolean(env.SERPER_API_KEY) && (await reserveSerper());

  const [bestBuy, ebay, shopping] = await Promise.allSettled([
    searchBestBuy(product, env.BESTBUY_API_KEY),
    searchEbay(
      product,
      { clientId: env.EBAY_CLIENT_ID, clientSecret: env.EBAY_CLIENT_SECRET },
      env.SPREAD_KV
    ),
    shoppingAllowed
      ? searchShopping(product, env.SERPER_API_KEY, {
          includeMarketplace: env.INCLUDE_MARKETPLACE === 'true',
        })
      : Promise.resolve({ returned: 0, offers: [] }),
  ]);

  const sources = {
    bestbuy: settledStatus(bestBuy),
    ebay: settledStatus(ebay),
    shopping: shoppingAllowed
      ? shopping.status === 'fulfilled'
        ? { ok: true, returned: shopping.value.returned, count: shopping.value.offers.length }
        : settledStatus(shopping)
      : { ok: false, error: env.SERPER_API_KEY ? 'daily-cap-reached' : 'not-configured' },
  };
  const candidates = [
    ...settledValue(bestBuy),
    ...settledValue(ebay),
    ...(shopping.status === 'fulfilled' ? shopping.value.offers : []),
  ];

  // --- Stage 1: deterministic ---------------------------------------------
  const { resolved, ambiguous } = partitionCandidates(product, candidates);

  // --- Stage 2: LLM, only for what Stage 1 could not decide ----------------
  const { candidates: judged, stats } = await adjudicate(product, ambiguous, env);

  // --- Prices observed on other retailers' pages by real traffic ------------
  // These skip the matcher entirely: they were filed under this product's key,
  // and that key *is* the identity claim. Which is why only a strong key
  // qualifies -- a title-derived key is good enough to track one retailer over
  // time, but not to assert that two retailers are selling the same thing.
  const key = productKey(product);
  const observed =
    key && keyStrength(key) === 'strong'
      ? (await observedOffers(env.SPREAD_KV, key, product.retailer)).map((offer) => ({
          ...offer,
          title: product.title,
          match: { verdict: VERDICT.SAME, stage: 'observed', score: 1 },
        }))
      : [];

  const offers = [...resolved, ...judged, ...observed]
    .filter((c) => c.match?.verdict === VERDICT.SAME || c.match?.verdict === VERDICT.SIMILAR)
    .filter((c) => Number.isFinite(c.price))
    // An observed price has no link -- it was seen on a page we did not record.
    // It is still worth showing, so only API-sourced offers require a URL.
    .filter((c) => c.url || c.source === 'observed')
    .sort(byRelevanceThenPrice)
    .slice(0, 12);

  // Upgrade the top offers from a search page to the actual product page.
  // Only the ones a shopper is likely to click, because each unresolved pair
  // costs a search credit -- though a resolved one is cached for a month.
  const { offers: verified, carried } = await resolveAndVerify(
    dedupeByRetailer(offers), product, env, reserveSerper
  );

  const verifiedNames = new Set(verified.map((o) => (o.retailer || '').toLowerCase()));

  const payload = {
    offers: verified.sort(byRelevanceThenPrice),
    // Never repeat a retailer that already appears with a price.
    carried: carried
      .filter((c) => !verifiedNames.has((c.retailer || '').toLowerCase()))
      .slice(0, MAX_CARRIED),
    sources: { ...sources, observed: { ok: true, count: observed.length } },
    matching: {
      candidates: candidates.length,
      resolvedByHeuristics: resolved.length,
      sentToAdjudicator: ambiguous.length,
      fromObservations: observed.length,
      ...stats,
    },
    generatedAt: new Date().toISOString(),
  };

  // Only cache an answer something could actually have answered.
  //
  // With no source configured, "no offers" is an artifact of the deployment,
  // not a fact about the product -- and caching it means a newly added API key
  // appears to do nothing until the entry expires. That is exactly what
  // happened when the Shopping key was first set.
  const anySourceLive = Object.values(sources).some((s) => s.ok && s.error !== 'not-configured');
  if (anySourceLive) {
    ctx.waitUntil(putOffers(env.SPREAD_KV, cacheKey, payload));
  }
  return json(serve(payload, observedNow, product.retailer, false));
}

/**
 * Record the price on a page the user opened, and hand back what we know about
 * that product's price over time.
 *
 * Called on product page views, so it is the hottest path in the service. It
 * does one KV read, and a write only when the observation actually says
 * something new.
 */
async function handleObserve(request, env) {
  const body = await request.json().catch(() => null);
  const product = body?.product;

  if (!product?.title || !Number.isFinite(product.price) || !product.retailer) {
    return json({ error: 'invalid_product' }, 400);
  }

  if (!(await withinRateLimit(env, limiterKey(request, body)))) {
    return json({ error: 'rate_limited' }, 429);
  }

  const key = productKey(product);
  if (!key) {
    // Identity could not be established confidently. Recording anyway would
    // risk merging different products into one price history.
    return json({ recorded: false, reason: 'no_stable_key' });
  }

  const { summary, wrote } = await recordObservation(env.SPREAD_KV, key, {
    retailer: product.retailer,
    price: product.price,
    url: typeof product.url === 'string' ? product.url.slice(0, 400) : null,
  });

  return json({ recorded: wrote, history: summary });
}

/**
 * Assemble the response: cached Shopping results plus observations read now.
 *
 * A live API price outranks an observation of the same retailer, since it was
 * read during this lookup rather than whenever someone last happened to visit.
 */
function serve(payload, observedNow, sourceRetailer, cached) {
  const priced = withoutSource(payload.offers, sourceRetailer);
  const pricedNames = new Set(priced.map((o) => (o.retailer || '').toLowerCase()));

  const observed = withoutSource(observedNow, sourceRetailer).filter(
    (o) => !pricedNames.has((o.retailer || '').toLowerCase())
  );

  const offers = [...priced, ...observed].sort(byRelevanceThenPrice);
  const shownNames = new Set(offers.map((o) => (o.retailer || '').toLowerCase()));

  return {
    ...payload,
    offers,
    carried: withoutSource(payload.carried, sourceRetailer).filter(
      (c) => !shownNames.has((c.retailer || '').toLowerCase())
    ),
    matching: { ...payload.matching, fromObservations: observed.length },
    cached,
  };
}

/** Never offer the shopper the page they are already looking at. */
function withoutSource(offers, sourceRetailer) {
  if (!sourceRetailer) return offers || [];
  const source = sourceRetailer.toLowerCase();
  return (offers || []).filter((o) => (o.retailer || '').toLowerCase() !== source);
}

/** How many offers are resolved and price-checked per comparison. */
const RESOLVE_TOP_N = 6;

/**
 * Resolve each offer to a product page and read the price off it.
 *
 * Google Shopping is only a discovery signal: it says which retailers carry
 * the thing. The number shown has to come from the page the shopper will land
 * on, or the two can disagree -- which they did, by $118, when price and link
 * were resolved independently.
 *
 * Splits into two outcomes rather than one. An offer whose price can be read
 * is quoted. An offer that resolved to a real page but whose price cannot be
 * read is still worth naming -- the retailer demonstrably carries it and the
 * link works -- but without a price, because asserting a number no page
 * supports is the one failure this product must not have.
 *
 * @returns {{offers: object[], carried: object[]}}
 */
async function resolveAndVerify(offers, product, env, reserve = null) {
  if (!env.SERPER_API_KEY) return { offers: [], carried: [] };

  const query = product.model || product.title;
  const considered = offers.slice(0, RESOLVE_TOP_N);

  const results = await Promise.all(
    considered.map(async (offer) => {
      const url = await resolveProductUrl(
        offer.retailer, query, env.SERPER_API_KEY, env.SPREAD_KV, product.title, reserve
      );
      if (!url) return null;

      const page = await readProductPage(url, env.SERPER_API_KEY, env.SPREAD_KV, {
        retailer: offer.retailer,
        reserve,
      });
      if (!page) return null;

      // The page has to be the product being compared, whether or not a price
      // came with it. The URL came from a separate site-restricted search, so
      // this is the only thing standing between a comparison and an accessory
      // page -- a Target listing for headphone covers was being named as a
      // retailer carrying the headphones.
      const match = compareProducts(product, { title: page.title, price: page.price });
      if (match.verdict === VERDICT.DIFFERENT) return null;
      offer.match = match;

      // Structured data is the best source, but several retailers render the
      // price client-side and publish none. For those, fall back to checking
      // whether the price Google attributed to this retailer actually appears
      // on the retailer's own page. That is corroboration rather than
      // extraction: a number is only used if the page says it too, which is
      // precisely the check the $118 eBay error would have failed.
      let price = page.price;
      let priceSource = 'verified-on-page';

      if (!Number.isFinite(price)) {
        if (Number.isFinite(offer.price) && priceAppearsOnPage(page.text, offer.price)) {
          price = offer.price;
          priceSource = 'corroborated-on-page';
        } else {
          // Right product, no price we can stand behind. Name it, quote nothing.
          return { carried: { retailer: offer.retailer, url } };
        }
      }

      return {
        offer: {
          ...offer,
          price,
          title: page.title || offer.title,
          url,
          urlKind: 'product-page',
          priceSource,
        },
      };
    })
  );

  return {
    offers: results.map((r) => r?.offer).filter(Boolean),
    carried: results.map((r) => r?.carried).filter(Boolean),
  };
}

/** Retailers worth naming without a price. A footnote, not a second list. */
const MAX_CARRIED = 5;

/**
 * One offer per retailer. Offers arrive already ranked, so the first occurrence
 * of a retailer is its best -- which also means a live API price naturally wins
 * over an observed snapshot for the same store.
 */
function dedupeByRetailer(offers) {
  const seen = new Set();
  const kept = [];
  for (const offer of offers) {
    const retailer = offer.retailer || 'unknown';
    if (seen.has(retailer)) continue;
    seen.add(retailer);
    kept.push(offer);
  }
  return kept;
}

/** Same-product offers first, then cheapest. */
function byRelevanceThenPrice(a, b) {
  const rank = (c) => (c.match?.verdict === VERDICT.SAME ? 0 : 1);
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;

  // Prefer an offer the shopper can actually click through to.
  const linkable = (c) => (c.url ? 0 : 1);
  const byLink = linkable(a) - linkable(b);
  if (byLink !== 0) return byLink;

  return a.price - b.price;
}

async function health(env) {
  return {
    status: 'ok',
    adjudication: await budgetStatus(env.SPREAD_KV, dailyLimitFrom(env)),
    retailers: {
      bestbuy: Boolean(env.BESTBUY_API_KEY),
      ebay: Boolean(env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET),
      shopping: Boolean(env.SERPER_API_KEY),
    },
    adjudicator: await adjudicatorStatus(env),
    shopping: await budgetStatus(env.SPREAD_KV, shoppingLimitFrom(env), 'shopping'),
  };
}

/**
 * Adjudicator health.
 *
 * "Configured" only means a key is present, and an expired key is still
 * present -- so a recent failure is reported alongside it. A credential
 * failure is called out separately because it is the one that will not
 * resolve on its own.
 */
async function adjudicatorStatus(env) {
  const status = {
    configured: Boolean(env.ANTHROPIC_API_KEY),
    model: env.ADJUDICATOR_MODEL || 'claude-haiku-4-5',
  };
  if (!status.configured) return status;

  const failure = await lastAdjudicatorError(env.SPREAD_KV);
  if (failure) {
    status.healthy = false;
    status.lastError = failure;
    if (failure.credential) {
      status.hint = 'Credential rejected — the key is likely expired or revoked.';
    }
  } else {
    status.healthy = true;
  }
  return status;
}

/**
 * What to count requests against.
 *
 * This used to be the caller's `installId` alone, and the check was skipped
 * when that field was absent -- so omitting one line of JSON opted out of rate
 * limiting entirely. An installId is also client-chosen, so rotating it per
 * request reset the window every time.
 *
 * The connecting IP is the part the caller does not control, so it is always
 * the bucket. The installId narrows it further, which keeps one household
 * behind a shared address from spending another's allowance.
 */
function limiterKey(request, body) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const installId = String(body?.installId || '').slice(0, 64);
  return installId ? `${ip}:${installId}` : ip;
}

/** Fixed-window rate limit. Cheap and good enough at this scale. */
async function withinRateLimit(env, bucket) {
  const window = Math.floor(Date.now() / (60 * 60 * 1000));
  const key = `rate:${bucket}:${window}`;
  const used = Number((await env.SPREAD_KV.get(key)) || 0);
  if (used >= RATE_LIMIT_PER_HOUR) return false;
  await env.SPREAD_KV.put(key, String(used + 1), { expirationTtl: 7200 });
  return true;
}

function settledValue(result) {
  return result.status === 'fulfilled' ? result.value : [];
}

function settledStatus(result) {
  return result.status === 'fulfilled'
    ? { ok: true, count: result.value.length }
    : { ok: false, error: String(result.reason?.message || result.reason) };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Only the published extension may call this Worker. `ALLOWED_ORIGIN` is set to
 * `chrome-extension://<id>` after the first Web Store publish; until then it
 * defaults to `*` so local unpacked builds work.
 */
function corsResponse(env, response) {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', env.ALLOWED_ORIGIN || '*');
  headers.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, { status: response.status, headers });
}
