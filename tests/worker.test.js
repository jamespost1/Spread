import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hashKey } from '../worker/src/cache.js';
import { reserveCall, budgetStatus } from '../worker/src/budget.js';
import { adjudicate } from '../worker/src/adjudicator.js';
import { handleChallenge, handleNotification } from '../worker/src/ebay-compliance.js';
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
