// KV-backed caching.
//
// Two distinct lifetimes, because the data has two distinct volatilities:
//   - Offers change constantly. Short TTL.
//   - "Is listing A the same product as listing B" is a property of two title
//     strings, and does not change. Effectively permanent, which is what makes
//     the LLM stage affordable.

const OFFER_TTL_SECONDS = 6 * 60 * 60;         // 6 hours -- prices move.
const VERDICT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days -- titles do not.

/** Stable hash for cache keys. FNV-1a: fast, no crypto, good enough for keying. */
export function hashKey(...parts) {
  const input = parts.join(' ').toLowerCase();
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export async function getOffers(kv, key) {
  return readJson(kv, `offers:${key}`);
}

export async function putOffers(kv, key, value) {
  await kv.put(`offers:${key}`, JSON.stringify(value), { expirationTtl: OFFER_TTL_SECONDS });
}

export async function getVerdict(kv, key) {
  return readJson(kv, `verdict:${key}`);
}

export async function putVerdict(kv, key, value) {
  await kv.put(`verdict:${key}`, JSON.stringify(value), { expirationTtl: VERDICT_TTL_SECONDS });
}

async function readJson(kv, key) {
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null; // A corrupt entry should behave as a miss, not an outage.
  }
}
