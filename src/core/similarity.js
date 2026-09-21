// Generic string-similarity primitives. No product knowledge lives here.

/**
 * Levenshtein edit distance, computed with two rolling rows instead of a full
 * matrix so long titles stay O(min(n,m)) in memory.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b ? b.length : 0;
  if (!b) return a.length;

  // Iterate over the shorter string to keep the rows small.
  if (a.length > b.length) [a, b] = [b, a];

  let previous = Array.from({ length: a.length + 1 }, (_, i) => i);
  let current = new Array(a.length + 1);

  for (let j = 1; j <= b.length; j++) {
    current[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[i] = Math.min(
        current[i - 1] + 1,      // insertion
        previous[i] + 1,         // deletion
        previous[i - 1] + cost   // substitution
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[a.length];
}

/**
 * Edit distance rescaled to a 0..1 similarity.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshteinRatio(a, b) {
  const longest = Math.max(a?.length || 0, b?.length || 0);
  if (longest === 0) return 1;
  return 1 - levenshtein(a || '', b || '') / longest;
}

/**
 * Jaccard index: intersection over union of two token sets.
 * @param {string[]} tokensA
 * @param {string[]} tokensB
 * @returns {number}
 */
export function jaccard(tokensA, tokensB) {
  const a = new Set(tokensA);
  const b = new Set(tokensB);
  if (a.size === 0 && b.size === 0) return 0;

  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;

  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Containment: what fraction of the smaller token set appears in the larger.
 * Jaccard punishes listings that are correct but verbose ("Sony WH-1000XM5"
 * vs. a 20-word marketplace title); containment does not, so the two are
 * blended rather than used alone.
 * @param {string[]} tokensA
 * @param {string[]} tokensB
 * @returns {number}
 */
export function containment(tokensA, tokensB) {
  const a = new Set(tokensA);
  const b = new Set(tokensB);
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  if (smaller.size === 0) return 0;

  let shared = 0;
  for (const token of smaller) if (larger.has(token)) shared++;
  return shared / smaller.size;
}
