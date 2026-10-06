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

import { partitionCandidates, VERDICT } from '../../src/core/matching.js';
import { productKey, keyStrength } from '../../src/core/product-key.js';
import { searchBestBuy } from './adapters/bestbuy.js';
import { searchEbay } from './adapters/ebay.js';
import { searchShopping } from './adapters/serper.js';
import { resolveProductUrl } from './adapters/resolve-url.js';
import { adjudicate } from './adjudicator.js';
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

  const installId = String(body.installId || '').slice(0, 64);
  if (installId && !(await withinRateLimit(env, installId))) {
    return json({ error: 'rate_limited' }, 429);
  }

  const cacheKey = hashKey(product.retailer || '', product.title, product.model || '');
  const cached = await getOffers(env.SPREAD_KV, cacheKey);
  if (cached) {
    return json({ ...cached, cached: true });
  }

  // --- Fan out to every price source we have -------------------------------
  // Google Shopping is the broad one; the first-party APIs are narrower but
  // more precise. A capped reservation runs first so a burst cannot consume
  // the Shopping allowance.
  const shoppingAllowed =
    Boolean(env.SERPER_API_KEY) &&
    (await reserveCall(env.SPREAD_KV, shoppingLimitFrom(env), 'shopping')).allowed;

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
  const ranked = dedupeByRetailer(offers);
  await resolveTopUrls(ranked, product, env);

  const payload = {
    offers: ranked,
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
  return json({ ...payload, cached: false });
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

  const installId = String(body.installId || '').slice(0, 64);
  if (installId && !(await withinRateLimit(env, installId))) {
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
  });

  return json({ recorded: wrote, history: summary });
}

/** How many offers get a real product URL looked up per comparison. */
const RESOLVE_TOP_N = 4;

/**
 * Replace search-page destinations with real product pages, in parallel.
 *
 * Mutates in place. Anything that cannot be resolved keeps the destination it
 * already had, so this can only improve a link, never remove one.
 */
async function resolveTopUrls(offers, product, env) {
  if (!env.SERPER_API_KEY) return;

  const query = product.model || product.title;
  const targets = offers
    .filter((o) => o.urlKind === 'store-search' || o.urlKind === 'google')
    .slice(0, RESOLVE_TOP_N);

  await Promise.all(
    targets.map(async (offer) => {
      const url = await resolveProductUrl(
        offer.retailer, query, env.SERPER_API_KEY, env.SPREAD_KV, product.title
      );
      if (url) {
        offer.url = url;
        offer.urlKind = 'product-page';
      }
    })
  );
}

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
    shopping: await budgetStatus(env.SPREAD_KV, shoppingLimitFrom(env), 'shopping'),
  };
}

/** Fixed-window rate limit. Cheap and good enough at this scale. */
async function withinRateLimit(env, installId) {
  const window = Math.floor(Date.now() / (60 * 60 * 1000));
  const key = `rate:${installId}:${window}`;
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
