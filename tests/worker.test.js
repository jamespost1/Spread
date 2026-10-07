import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashKey } from '../worker/src/cache.js';
import { reserveCall, budgetStatus } from '../worker/src/budget.js';
import { adjudicate, lastAdjudicatorError } from '../worker/src/adjudicator.js';
import { handleChallenge, handleNotification } from '../worker/src/ebay-compliance.js';
import { priceAppearsOnPage, priceFromOffers } from '../worker/src/adapters/verify.js';
import nodeCrypto from 'node:crypto';

/** Minimal in-memory stand-in for a KV namespace. */
function fakeKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

describe('hashKey', () => {
  it('is stable for the same inputs', () => {
    expect(hashKey('a', 'b')).toBe(hashKey('a', 'b'));
  });

  it('is case-insensitive', () => {
    expect(hashKey('Sony XM5')).toBe(hashKey('sony xm5'));
  });

  it('differs for different inputs', () => {
    expect(hashKey('sony xm5')).not.toBe(hashKey('sony xm4'));
  });
});

describe('budget', () => {
  it('allows calls up to the limit then refuses', async () => {
    const kv = fakeKV();
    expect((await reserveCall(kv, 2)).allowed).toBe(true);
    expect((await reserveCall(kv, 2)).allowed).toBe(true);

    const third = await reserveCall(kv, 2);
    expect(third.allowed).toBe(false);
    expect(third.used).toBe(2);
  });

  it('reports remaining budget without consuming any', async () => {
    const kv = fakeKV();
    await reserveCall(kv, 10);
    const status = await budgetStatus(kv, 10);
    expect(status).toEqual({ used: 1, limit: 10, remaining: 9 });
    expect((await budgetStatus(kv, 10)).used).toBe(1);
  });
});

describe('adjudicate', () => {
  const source = { title: 'Sony WH-1000XM5 Headphones', brand: 'Sony', price: 349.99 };
  const candidates = [
    { title: 'Sony WH-1000XM4 Headphones', price: 279, match: { verdict: 'ambiguous', score: 0.79 } },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns immediately when there is nothing to judge', async () => {
    const result = await adjudicate(source, [], { SPREAD_KV: fakeKV() });
    expect(result.stats.requested).toBe(0);
    expect(result.candidates).toEqual([]);
  });

  it('serves a cached verdict without spending budget', async () => {
    const kv = fakeKV();
    // Key is the two normalized titles, sorted, hashed.
    const key = hashKey(
      ...['sony wh-1000xm5 headphones', 'sony wh-1000xm4 headphones'].sort()
    );
    await kv.put(
      `verdict:${key}`,
      JSON.stringify({ verdict: 'different', confidence: 0.95, reason: 'prior generation' })
    );

    const result = await adjudicate(source, candidates, { SPREAD_KV: kv });

    expect(result.stats.cached).toBe(1);
    expect(result.stats.adjudicated).toBe(0);
    expect(result.candidates[0].match.verdict).toBe('different');
    expect(result.candidates[0].match.stage).toBe('adjudicated-cached');
    // No budget was consumed.
    expect((await budgetStatus(kv, 100)).used).toBe(0);
  });

  it('degrades to a heuristic fallback when the budget is exhausted', async () => {
    const kv = fakeKV();
    const env = { SPREAD_KV: kv, ADJUDICATION_DAILY_LIMIT: 0, ANTHROPIC_API_KEY: 'sk-test' };

    const result = await adjudicate(source, candidates, env);

    expect(result.stats.error).toBe('budget-exhausted');
    expect(result.stats.skipped).toBe(1);
    // Crucially it never claims SAME without having actually verified.
    expect(result.candidates[0].match.verdict).toBe('similar');
    expect(result.candidates[0].match.stage).toBe('heuristic-fallback');
  });

  it('degrades gracefully when no API key is configured', async () => {
    const result = await adjudicate(source, candidates, {
      SPREAD_KV: fakeKV(),
      ADJUDICATION_DAILY_LIMIT: 10,
    });
    expect(result.stats.error).toBe('no-api-key');
    expect(result.candidates[0].match.stage).toBe('heuristic-fallback');
  });

  it('never throws when the model call fails', async () => {
    // Fail at the network layer so the test needs no credentials and no
    // connectivity -- adjudicate must absorb whatever comes out of the SDK.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));

    const env = { SPREAD_KV: fakeKV(), ADJUDICATION_DAILY_LIMIT: 10, ANTHROPIC_API_KEY: 'sk-test' };
    const result = await adjudicate(source, candidates, env);

    expect(result.stats.error).toBeTruthy();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].match.stage).toBe('heuristic-fallback');
  });
});

describe('eBay account-deletion endpoint', () => {
  const env = {
    EBAY_VERIFICATION_TOKEN: 'spread-verification-token-abc123456789',
    EBAY_NOTIFICATION_ENDPOINT: 'https://spread-api.example.workers.dev/ebay/account-deletion',
  };

  it('answers the challenge with SHA-256(code + token + endpoint)', async () => {
    const code = 'challenge-code-xyz';
    const url = new URL(`https://spread-api.example.workers.dev/ebay/account-deletion?challenge_code=${code}`);

    const response = await handleChallenge(url, env);
    const body = await response.json();

    // Independently computed with Node's crypto, not the implementation's own path.
    const expected = nodeCrypto
      .createHash('sha256')
      .update(code + env.EBAY_VERIFICATION_TOKEN + env.EBAY_NOTIFICATION_ENDPOINT)
      .digest('hex');

    expect(response.status).toBe(200);
    expect(body.challengeResponse).toBe(expected);
    expect(body.challengeResponse).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the configured endpoint, not the request host', async () => {
    // A proxy rewriting the host must not change the hash, or verification
    // fails in a way that is very hard to diagnose.
    const code = 'abc';
    const viaProxy = new URL(`https://internal.proxy.local/ebay/account-deletion?challenge_code=${code}`);
    const direct = new URL(`https://spread-api.example.workers.dev/ebay/account-deletion?challenge_code=${code}`);

    const a = await (await handleChallenge(viaProxy, env)).json();
    const b = await (await handleChallenge(direct, env)).json();
    expect(a.challengeResponse).toBe(b.challengeResponse);
  });

  it('falls back to the request URL when no endpoint is configured', async () => {
    const url = new URL('https://spread-api.example.workers.dev/ebay/account-deletion?challenge_code=abc');
    const body = await (await handleChallenge(url, { EBAY_VERIFICATION_TOKEN: 't'.repeat(32) })).json();
    expect(body.challengeResponse).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a request with no challenge code', async () => {
    const url = new URL('https://spread-api.example.workers.dev/ebay/account-deletion');
    expect((await handleChallenge(url, env)).status).toBe(400);
  });

  it('fails loudly when the verification token is missing', async () => {
    const url = new URL('https://spread-api.example.workers.dev/ebay/account-deletion?challenge_code=abc');
    expect((await handleChallenge(url, {})).status).toBe(500);
  });

  it('acknowledges a deletion notification with 200', async () => {
    const request = new Request('https://x/ebay/account-deletion', {
      method: 'POST',
      body: JSON.stringify({ notification: { data: { username: 'someuser' } } }),
    });
    expect((await handleNotification(request)).status).toBe(200);
  });

  it('still returns 200 for an unreadable body so eBay stops retrying', async () => {
    const request = new Request('https://x/ebay/account-deletion', { method: 'POST', body: 'not json' });
    expect((await handleNotification(request)).status).toBe(200);
  });
});

describe('priceAppearsOnPage', () => {
  const page = 'Sony WH-1000XM5 Headphones Black\n\n$349.99\n\nreg $399.99\n\nSave $50.00';

  it('confirms a price the page actually shows', () => {
    expect(priceAppearsOnPage(page, 349.99)).toBe(true);
  });

  it('rejects a price the page does not show', () => {
    // The exact failure this exists for: Google claimed $256.27 for an eBay
    // listing whose page said $374.99.
    expect(priceAppearsOnPage(page, 256.27)).toBe(false);
  });

  it('does not match a price embedded inside a larger number', () => {
    expect(priceAppearsOnPage('subtotal 1,349.99', 49.99)).toBe(false);
    expect(priceAppearsOnPage('$1299.00', 299.0)).toBe(false);
  });

  it('accepts grouped and plain thousands', () => {
    expect(priceAppearsOnPage('now 1,299.00', 1299)).toBe(true);
    expect(priceAppearsOnPage('now 1299.00', 1299)).toBe(true);
  });

  it('accepts whole dollars written without cents', () => {
    expect(priceAppearsOnPage('just $378 today', 378)).toBe(true);
  });

  it('rejects unusable input', () => {
    expect(priceAppearsOnPage('', 10)).toBe(false);
    expect(priceAppearsOnPage('$10.00', 0)).toBe(false);
    expect(priceAppearsOnPage('$10.00', NaN)).toBe(false);
  });
});

describe('adjudicator failure reporting', () => {
  const source = { title: 'Sony WH-1000XM5 Headphones', brand: 'Sony', price: 349.99 };
  const candidates = [
    { title: 'Sony WH-1000XM4 Headphones', price: 279, match: { verdict: 'ambiguous', score: 0.79 } },
  ];

  it('records a failure so an expired key does not degrade silently', async () => {
    const kv = fakeKV();
    // A rejected fetch is a connection error; an expired key is a 401
    // *response*. Only the latter exercises the credential branch.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }),
        { status: 401, headers: { 'content-type': 'application/json' } }
      )
    );

    await adjudicate(source, candidates, {
      SPREAD_KV: kv, ADJUDICATION_DAILY_LIMIT: 10, ANTHROPIC_API_KEY: 'sk-expired',
    });

    const failure = await lastAdjudicatorError(kv);
    expect(failure).toBeTruthy();
    expect(failure.credential).toBe(true);
    expect(failure.at).toBeTypeOf('string');
  });

  it('marks a network failure as not a credential problem', async () => {
    const kv = fakeKV();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unreachable'));

    await adjudicate(source, candidates, {
      SPREAD_KV: kv, ADJUDICATION_DAILY_LIMIT: 10, ANTHROPIC_API_KEY: 'sk-test',
    });

    expect((await lastAdjudicatorError(kv)).credential).toBe(false);
  });

  it('reports nothing when the adjudicator has not failed', async () => {
    expect(await lastAdjudicatorError(fakeKV())).toBeNull();
  });
});

describe('priceFromOffers', () => {
  // The live defect. Best Buy's listing for the WH-1000XM5 published an
  // aggregate starting at $198 -- an open-box or marketplace unit -- while the
  // page charged $248. The old code read lowPrice, quoted $198, and linked to
  // a page saying $248.
  it('refuses an aggregate whose low and high disagree', () => {
    const offers = {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: '198.00',
      highPrice: '289.99',
    };
    expect(priceFromOffers(offers, 'Best Buy')).toBeNull();
  });

  it('accepts an aggregate that collapses to one price', () => {
    const offers = {
      '@type': 'AggregateOffer',
      priceCurrency: 'USD',
      lowPrice: '248.00',
      highPrice: '248.00',
    };
    expect(priceFromOffers(offers, 'Best Buy')).toBe(248);
  });

  it('reads concrete offers nested inside an aggregate', () => {
    const offers = {
      '@type': 'AggregateOffer',
      lowPrice: '198.00',
      highPrice: '289.99',
      offers: [{ '@type': 'Offer', price: '248.00', priceCurrency: 'USD' }],
    };
    expect(priceFromOffers(offers, 'Best Buy')).toBe(248);
  });

  it('prefers the store\u2019s own offer over a marketplace seller', () => {
    const offers = [
      { '@type': 'Offer', price: '198.00', seller: { name: 'ValueDeals LLC' } },
      { '@type': 'Offer', price: '248.00', seller: { name: 'Best Buy' } },
    ];
    expect(priceFromOffers(offers, 'Best Buy')).toBe(248);
  });

  it('quotes nothing when concrete offers disagree and no seller matches', () => {
    const offers = [
      { '@type': 'Offer', price: '198.00' },
      { '@type': 'Offer', price: '248.00' },
    ];
    expect(priceFromOffers(offers, 'Best Buy')).toBeNull();
  });

  it('takes a single unambiguous offer', () => {
    expect(priceFromOffers({ '@type': 'Offer', price: '349.99' }, 'Target')).toBe(349.99);
  });

  it('agreeing duplicates are not a disagreement', () => {
    const offers = [
      { '@type': 'Offer', price: '349.99' },
      { '@type': 'Offer', price: '349.99' },
    ];
    expect(priceFromOffers(offers, 'Target')).toBe(349.99);
  });

  it('ignores anything not sold as new', () => {
    const offers = [
      { '@type': 'Offer', price: '150.00', itemCondition: 'https://schema.org/UsedCondition' },
      { '@type': 'Offer', price: '248.00' },
    ];
    expect(priceFromOffers(offers, 'Best Buy')).toBe(248);
  });

  it('ignores a price in another currency', () => {
    const offers = { '@type': 'Offer', price: '248.00', priceCurrency: 'GBP' };
    expect(priceFromOffers(offers, 'Best Buy')).toBeNull();
  });

  it('returns null rather than throwing on junk', () => {
    expect(priceFromOffers(null, 'Target')).toBeNull();
    expect(priceFromOffers({}, 'Target')).toBeNull();
  });
});
