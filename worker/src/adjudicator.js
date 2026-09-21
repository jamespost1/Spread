// Stage 2 of the match cascade: LLM adjudication.
//
// Stage 1 (src/core/matching.js) resolves the clear cases for free. Only the
// pairs it explicitly marks AMBIGUOUS reach this file. Three things keep the
// bill near zero:
//
//   1. Batching -- every ambiguous candidate for one product goes in a single
//      request, not one request per pair.
//   2. Caching -- a verdict is a property of two title strings, so it is
//      cached for 90 days and most lookups never reach the API at all.
//   3. Budget -- a hard daily call cap, checked before every request.
//
// Model choice: Haiku 4.5. This is a high-volume, narrow classification that
// sits directly in the user's click path, so cost and latency both matter more
// than headroom. Change ADJUDICATOR_MODEL to trade up.

import Anthropic from '@anthropic-ai/sdk';
import { hashKey, getVerdict, putVerdict } from './cache.js';
import { reserveCall, dailyLimitFrom } from './budget.js';

export const ADJUDICATOR_MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT = `You decide whether two retail product listings are the same purchasable item.

You are the second stage of a matching pipeline. A deterministic scorer already handled the easy cases; every pair you receive is one it could not resolve, so expect genuinely hard comparisons.

Rules:
- SAME means a shopper buying either listing receives the same physical item. Colour or minor cosmetic variants of one model are SAME. Different capacity, size, pack count, or model generation are NOT.
- Adjacent model generations (XM4 vs XM5, Series 8 vs Series 9) are DIFFERENT even though their titles look nearly identical. This is the most common trap.
- A bundle, multipack, or "with accessories" listing is DIFFERENT from the standalone item.
- Refurbished, renewed, or used listings are DIFFERENT from new.
- SIMILAR means a reasonable alternative a shopper might consider instead -- same category and comparable specs, but not the same item.
- DIFFERENT means unrelated, or any of the disqualifiers above.

Be decisive but honest: when a listing is too vague to tell, return DIFFERENT with low confidence rather than guessing SAME. A wrong SAME shows the shopper an incorrect price, which is the worst outcome this product can produce.`;

/** Strict tool schema -- guarantees parseable, complete verdicts. */
const VERDICT_TOOL = {
  name: 'record_verdicts',
  description: 'Record one verdict for every candidate listing, in the order given.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdicts'],
    properties: {
      verdicts: {
        type: 'array',
        description: 'One entry per candidate, in the same order as the input.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'verdict', 'confidence', 'reason'],
          properties: {
            id: { type: 'integer', description: 'The candidate id being judged.' },
            verdict: { type: 'string', enum: ['same', 'similar', 'different'] },
            confidence: { type: 'number', description: 'Between 0 and 1.' },
            reason: { type: 'string', description: 'At most 12 words, shown to no one but useful in logs.' },
          },
        },
      },
    },
  },
};

/**
 * Adjudicate the ambiguous candidates for one product.
 *
 * Never throws: any failure downgrades to the Stage 1 score, because a missing
 * adjudication should cost precision, not availability.
 *
 * @param {object} source Product the user is viewing.
 * @param {object[]} candidates Candidates Stage 1 marked ambiguous.
 * @param {object} env Worker environment bindings.
 * @returns {Promise<{candidates: object[], stats: object}>}
 */
export async function adjudicate(source, candidates, env) {
  const stats = { requested: candidates.length, cached: 0, adjudicated: 0, skipped: 0, error: null };
  if (candidates.length === 0) return { candidates, stats };

  const resolved = new Array(candidates.length);
  const pending = [];

  // Pass 1: serve whatever the verdict cache already knows.
  for (let i = 0; i < candidates.length; i++) {
    const key = verdictKey(source, candidates[i]);
    const cached = await getVerdict(env.SPREAD_KV, key);
    if (cached) {
      resolved[i] = applyVerdict(candidates[i], cached, true);
      stats.cached++;
    } else {
      pending.push({ index: i, key, candidate: candidates[i] });
    }
  }

  if (pending.length === 0) return { candidates: resolved, stats };

  // Pass 2: one batched call for everything still unknown.
  const budget = await reserveCall(env.SPREAD_KV, dailyLimitFrom(env));

  if (!budget.allowed || !env.ANTHROPIC_API_KEY) {
    stats.skipped = pending.length;
    stats.error = budget.allowed ? 'no-api-key' : 'budget-exhausted';
    for (const { index, candidate } of pending) resolved[index] = fallback(candidate);
    return { candidates: resolved, stats };
  }

  try {
    const verdicts = await requestVerdicts(source, pending, env);

    for (const { index, key, candidate } of pending) {
      const verdict = verdicts.get(index);
      if (verdict) {
        resolved[index] = applyVerdict(candidate, verdict, false);
        await putVerdict(env.SPREAD_KV, key, verdict);
        stats.adjudicated++;
      } else {
        resolved[index] = fallback(candidate);
        stats.skipped++;
      }
    }
  } catch (error) {
    stats.error = String(error?.message || error);
    stats.skipped += pending.length;
    for (const { index, candidate } of pending) resolved[index] = fallback(candidate);
  }

  return { candidates: resolved, stats };
}

/** Issue the batched request and index the verdicts by candidate id. */
async function requestVerdicts(source, pending, env) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  const payload = {
    viewing: describe(source),
    candidates: pending.map(({ index, candidate }) => ({ id: index, ...describe(candidate) })),
  };

  const response = await client.messages.create({
    model: env.ADJUDICATOR_MODEL || ADJUDICATOR_MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [VERDICT_TOOL],
    tool_choice: { type: 'tool', name: 'record_verdicts' },
    messages: [
      {
        role: 'user',
        content: `Judge each candidate against the listing the shopper is viewing.\n\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });

  const block = response.content.find(
    (b) => b.type === 'tool_use' && b.name === 'record_verdicts'
  );
  if (!block) throw new Error('adjudicator returned no tool_use block');

  const results = new Map();
  for (const entry of block.input?.verdicts || []) {
    if (Number.isInteger(entry.id)) {
      results.set(entry.id, {
        verdict: entry.verdict,
        confidence: clamp01(entry.confidence),
        reason: entry.reason,
      });
    }
  }
  return results;
}

/** Only the fields that matter for the judgement -- keeps the token count down. */
function describe(product) {
  return {
    title: (product.title || '').slice(0, 200),
    brand: product.brand || null,
    model: product.model || null,
    price: Number.isFinite(product.price) ? product.price : null,
    retailer: product.retailer || null,
  };
}

/** Cache key: the two normalized titles, order-independent. */
function verdictKey(source, candidate) {
  const a = (source.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const b = (candidate.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return hashKey(...[a, b].sort());
}

function applyVerdict(candidate, verdict, fromCache) {
  return {
    ...candidate,
    match: {
      ...candidate.match,
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      reason: verdict.reason,
      stage: fromCache ? 'adjudicated-cached' : 'adjudicated',
    },
  };
}

/** When adjudication is unavailable, keep Stage 1's score but never claim SAME. */
function fallback(candidate) {
  return {
    ...candidate,
    match: { ...candidate.match, verdict: 'similar', stage: 'heuristic-fallback' },
  };
}

function clamp01(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}
