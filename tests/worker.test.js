import { describe, it, expect } from 'vitest';
import { hashKey } from '../worker/src/cache.js';
import { handleChallenge, handleNotification } from '../worker/src/ebay-compliance.js';
import nodeCrypto from 'node:crypto';

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
