// Hard daily spend cap for the LLM adjudication stage.
//
// The cascade is designed to be cheap, but "designed to be cheap" is not the
// same as "cannot bill you". This is the guarantee: once the day's call budget
// is spent, adjudication is skipped and the cascade degrades to heuristics
// only. The extension keeps working; it just gets slightly less precise.

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAILY_LIMIT = 200;

/**
 * Read the configured daily call limit.
 *
 * Wrangler passes vars as strings, and 0 is a meaningful value -- it disables
 * adjudication entirely -- so this cannot use `||` to apply the default.
 * @param {object} env
 * @returns {number}
 */
export function dailyLimitFrom(env) {
  const configured = env?.ADJUDICATION_DAILY_LIMIT;
  if (configured === undefined || configured === null || configured === '') {
    return DEFAULT_DAILY_LIMIT;
  }
  const value = Number(configured);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DAILY_LIMIT;
}

/** Key for today's counter, in UTC to match the KV limit reset. */
function todayKey() {
  return `budget:${new Date().toISOString().slice(0, 10)}`;
}

/**
 * Reserve one adjudication call against today's budget.
 * @param {KVNamespace} kv
 * @param {number} dailyLimit Maximum adjudication calls per UTC day.
 * @returns {Promise<{allowed: boolean, used: number, limit: number}>}
 */
export async function reserveCall(kv, dailyLimit) {
  const key = todayKey();
  const used = Number((await kv.get(key)) || 0);

  if (used >= dailyLimit) {
    return { allowed: false, used, limit: dailyLimit };
  }

  // KV is eventually consistent, so concurrent requests can both read the same
  // value and slightly overshoot the cap. That is acceptable here: the
  // overshoot is bounded by concurrency (single-digit calls, fractions of a
  // cent), and the alternative -- a Durable Object per counter -- costs more
  // to run than the budget it would be protecting.
  await kv.put(key, String(used + 1), { expirationTtl: Math.ceil((DAY_MS * 2) / 1000) });
  return { allowed: true, used: used + 1, limit: dailyLimit };
}

/**
 * Read today's usage without reserving.
 * @param {KVNamespace} kv
 * @param {number} dailyLimit
 */
export async function budgetStatus(kv, dailyLimit) {
  const used = Number((await kv.get(todayKey())) || 0);
  return { used, limit: dailyLimit, remaining: Math.max(0, dailyLimit - used) };
}
