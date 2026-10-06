// The match cascade: decide whether two listings are the same product.
//
// Stage 1 (here) is deterministic, free, and instant. It resolves the clear
// cases and — critically — reports when it is *not* confident. Stage 2 (an LLM
// adjudicator in the Cloudflare Worker) only ever sees the pairs Stage 1 marks
// AMBIGUOUS, which is what keeps the token bill near zero.

import {
  normalizeTitle, tokenize, extractModelNumbers, extractQuantities,
  canonicalModelCode, isAccessoryTitle, isBundleTitle,
} from './normalize.js';
import { jaccard, containment, levenshteinRatio } from './similarity.js';

/** Verdicts the cascade can reach. */
export const VERDICT = {
  SAME: 'same',
  SIMILAR: 'similar',
  DIFFERENT: 'different',
  AMBIGUOUS: 'ambiguous',
};

/**
 * Score bands. Tuned against evals/fixtures/product-pairs.json -- change these
 * and run `npm run eval` to see what it does to precision/recall.
 */
export const THRESHOLDS = {
  /**
   * Below this, Stage 1 rejects outright: the listings have too little in
   * common to be worth an adjudication call.
   */
  DIFFERENT: 0.45,
  /**
   * Retained for reporting only. Fuzzy scoring never returns a confident SAME
   * no matter how high it climbs -- see the note on the fuzzy path below.
   */
  SAME: 0.86,
};

/**
 * Words that mark a listing as a different purchasable unit even when the rest
 * of the title is identical. Present on one side but not the other is a
 * reliable, free rejection.
 */
const DISQUALIFIERS = [
  'refurbished', 'refurb', 'renewed', 'preowned', 'used', 'openbox',
  'bundle', 'forparts', 'replacement',
];

/**
 * Blend weights for the fuzzy path, used only when no decisive signal fires.
 * They sum to 1.
 */
const WEIGHTS = { jaccard: 0.4, containment: 0.35, levenshtein: 0.25 };

/**
 * Compare two product listings.
 *
 * @param {{title: string, brand?: string, model?: string}} source Product the user is viewing.
 * @param {{title: string, brand?: string, model?: string}} candidate Listing found elsewhere.
 * @returns {{score: number, verdict: string, confident: boolean, signals: object}}
 */
export function compareProducts(source, candidate) {
  const sourceTitle = source?.title || '';
  const candidateTitle = candidate?.title || '';

  if (!sourceTitle || !candidateTitle) {
    return result(0, VERDICT.DIFFERENT, true, { reason: 'missing-title' });
  }

  const a = normalizeTitle(sourceTitle);
  const b = normalizeTitle(candidateTitle);

  if (a === b) {
    return result(1, VERDICT.SAME, true, { reason: 'exact-title' });
  }

  // --- Veto checks, before any positive signal. ----------------------------
  // These must outrank model matching rather than follow it. A refurbished
  // unit and an accessory both carry the product's own model code, so a code
  // match would otherwise confirm them as the same purchasable item -- and
  // quote a $12.99 carrying case as the price of a $349 pair of headphones.
  const disqualifier = findDisqualifier(a, b);
  if (disqualifier) {
    return result(0.2, VERDICT.DIFFERENT, true, { reason: 'condition-mismatch', disqualifier });
  }
  if (isAccessoryFor(candidateTitle, sourceTitle)) {
    return result(0.1, VERDICT.DIFFERENT, true, { reason: 'accessory' });
  }
  const extras = bundledExtras(candidateTitle, sourceTitle);
  if (extras.length > 0) {
    // Priced as a package, so the figure is not this product's price.
    return result(0.2, VERDICT.DIFFERENT, true, { reason: 'bundled-extras', extras });
  }
  // And the reverse: a standalone item is not a substitute for a bundle. It
  // is cheaper because it is less, which is not a saving.
  if (isBundleTitle(sourceTitle) !== isBundleTitle(candidateTitle)) {
    return result(0.2, VERDICT.DIFFERENT, true, { reason: 'bundle-mismatch' });
  }

  // --- Decisive signal 1: explicit model/SKU fields agree. -----------------
  // Retailer-supplied model numbers are authoritative in a way titles never
  // are, so this outranks everything below it.
  const sourceModel = canonicalModelCode(source?.model, source?.brand);
  const candidateModel = canonicalModelCode(candidate?.model, candidate?.brand);
  if (sourceModel && candidateModel) {
    if (sourceModel === candidateModel) {
      return result(1, VERDICT.SAME, true, { reason: 'model-field-exact' });
    }
    // Two known-but-different manufacturer codes is a reliable rejection.
    return result(0.2, VERDICT.DIFFERENT, true, { reason: 'model-field-conflict' });
  }

  // --- Decisive signal 2: model codes mined from the titles agree. ---------
  const modelsA = extractModelNumbers(sourceTitle);
  const modelsB = extractModelNumbers(candidateTitle);
  const sharedModel = findSharedCode(modelsA, modelsB);
  if (sharedModel) {
    return result(0.97, VERDICT.SAME, true, { reason: 'model-in-title', sharedModel });
  }

  // --- Decisive signal 3: both sides declare a brand, and they differ. -----
  // Sony is not Bose no matter how alike the rest of the words are, so this
  // resolves locally instead of spending an adjudication call.
  const brandA = normalizeTitle(source?.brand || '');
  const brandB = normalizeTitle(candidate?.brand || '');
  if (brandA && brandB && brandA !== brandB) {
    return result(0.15, VERDICT.DIFFERENT, true, { reason: 'brand-conflict', brandA, brandB });
  }

  // --- Fuzzy path ----------------------------------------------------------
  const tokensA = tokenize(sourceTitle);
  const tokensB = tokenize(candidateTitle);

  const signals = {
    jaccard: jaccard(tokensA, tokensB),
    containment: containment(tokensA, tokensB),
    levenshtein: levenshteinRatio(a, b),
    brandMatch: brandsAgree(source, candidate, a, b),
    quantityMatch: quantitiesAgree(sourceTitle, candidateTitle),
  };

  let score =
    signals.jaccard * WEIGHTS.jaccard +
    signals.containment * WEIGHTS.containment +
    signals.levenshtein * WEIGHTS.levenshtein;

  // Brand is a gate, not a term: a shared brand lifts an otherwise decent
  // match, a conflicting brand caps it no matter how similar the words are.
  if (signals.brandMatch === true) {
    score = Math.min(1, score + 0.12);
  } else if (signals.brandMatch === false) {
    // Only the weak case reaches here: one side named a brand the other's
    // title never mentions. Suggestive of a mismatch, not proof of one.
    score = Math.min(score, 0.5);
  }

  // Brand + pack size agreeing is how consumables (which carry no model
  // number) get matched at all.
  if (signals.brandMatch === true && signals.quantityMatch === true) {
    score = Math.min(1, score + 0.1);
  } else if (signals.quantityMatch === false) {
    // Same product, different pack size is a *different* SKU and usually a
    // different price — never merge them.
    score = Math.min(score, 0.6);
  }

  score = clamp(score);

  if (score < THRESHOLDS.DIFFERENT) {
    return result(score, VERDICT.DIFFERENT, true, signals);
  }

  // Everything else is ambiguous, however high it scores.
  //
  // This is the central lesson from evals/run.mjs: string similarity cannot
  // tell "same product, different wording" from "different product, similar
  // wording". "Apple Watch Series 9" and "Apple Watch Series 8" are 100%
  // containment and 88% edit-similar, and are not the same product. A
  // confident SAME is only ever earned by a decisive signal above -- a
  // matching model field or a model code mined from both titles.
  return result(score, VERDICT.AMBIGUOUS, false, signals);
}

/**
 * Split candidates by what Stage 1 could decide alone.
 * @param {object} source
 * @param {object[]} candidates
 * @returns {{resolved: object[], ambiguous: object[]}}
 */
export function partitionCandidates(source, candidates) {
  const resolved = [];
  const ambiguous = [];

  for (const candidate of candidates || []) {
    const match = compareProducts(source, candidate);
    const enriched = { ...candidate, match };
    if (match.confident) resolved.push(enriched);
    else ambiguous.push(enriched);
  }
  return { resolved, ambiguous };
}

/** True when the two listings agree on brand, false when they conflict, null when unknown. */
function brandsAgree(source, candidate, normalizedA, normalizedB) {
  const brandA = normalizeTitle(source?.brand || '');
  const brandB = normalizeTitle(candidate?.brand || '');

  if (brandA && brandB) return brandA === brandB;

  // Only one side declares a brand — check whether the other title contains it.
  const known = brandA || brandB;
  if (!known) return null;
  const otherTitle = brandA ? normalizedB : normalizedA;
  return otherTitle.split(/\s+/).includes(known.split(/\s+/)[0]);
}

/** True when both titles state the same pack size, false when they conflict, null when unknown. */
function quantitiesAgree(titleA, titleB) {
  const qtyA = extractQuantities(titleA);
  const qtyB = extractQuantities(titleB);
  if (qtyA.length === 0 || qtyB.length === 0) return null;
  return qtyA.some((q) => qtyB.includes(q));
}

/** Two codes match if they are equal, or one is a prefix-ish superset of the other. */
function findSharedCode(codesA, codesB) {
  for (const a of codesA) {
    for (const b of codesB) {
      if (a === b) return a;
      // One code often carries an extra prefix or suffix that does not change
      // the model — a series letter ("WH1000XM5" vs "1000XM5") or a colour
      // code ("WH1000XM5" vs "WH1000XM5B"). Require a long overlap so this
      // cannot fire on two short, unrelated codes.
      const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
      if (shorter.length >= 6 && longer.includes(shorter)) return shorter;
    }
  }
  return null;
}

/**
 * True when the candidate is an accessory for the source product.
 *
 * Only one direction matters: a case listed against headphones is a different
 * product, but headphones listed against a case is the same mismatch and is
 * caught when that page is the source.
 */
function isAccessoryFor(candidateTitle, sourceTitle) {
  const candidate = String(candidateTitle || '');
  const source = String(sourceTitle || '');
  // If the source is itself an accessory, these are peers, not product vs part.
  return isAccessoryTitle(candidate) && !isAccessoryTitle(source);
}

/**
 * Extra products bundled alongside the one being compared.
 *
 * A bundle does not have to say "bundle". A Macy's listing for
 * "...Headphones Black Power Bank 20W 2-Port USB Wall Charger" is headphones
 * plus two other things at a combined price, and quoting it as the price of
 * the headphones is wrong by whatever the extras cost.
 *
 * The signal is a product category the candidate names and the source does
 * not. Matching on categories rather than arbitrary extra words keeps a
 * verbose-but-honest title from being rejected for being verbose.
 */
const BUNDLED_CATEGORIES = [
  'power bank', 'wall charger', 'car charger', 'charging dock', 'charging stand',
  'memory card', 'sd card', 'tripod', 'gimbal', 'microphone', 'webcam',
  'keyboard', 'mouse', 'speaker', 'soundbar', 'subwoofer', 'remote',
  'controller', 'headphones', 'earbuds', 'smartwatch', 'tablet', 'printer',
  'ink', 'toner', 'battery pack', 'surge protector', 'extension cord',
  'cookbook', 'storage case', 'carrying case', 'screen protector',
];

/**
 * Categories the candidate adds that the source never mentions.
 *
 * The category has to be *introduced* as an extra -- "with a wall charger",
 * "+ power bank" -- not merely named. Without that, any listing that spells
 * out its own product type is read as a bundle: "AirPods Pro 2nd Gen USB-C
 * Wireless Earbuds" was rejected because it contained the word "earbuds".
 */
function bundledExtras(candidateTitle, sourceTitle) {
  const candidate = normalizeTitle(candidateTitle);
  const source = normalizeTitle(sourceTitle);

  return BUNDLED_CATEGORIES.filter((category) => {
    if (source.includes(category)) return false;
    const introduced = new RegExp(
      `\\b(?:with|plus|includes?|and|bundled)\\s+(?:a |an |the |\\d+\\s*)?${category}\\b`
    );
    return introduced.test(candidate);
  });
}

/** A condition/bundle marker present on exactly one side. */
function findDisqualifier(normalizedA, normalizedB) {
  const squash = (t) => t.replace(/\s+/g, '');
  const a = squash(normalizedA);
  const b = squash(normalizedB);

  for (const word of DISQUALIFIERS) {
    if (a.includes(word) !== b.includes(word)) return word;
  }
  return null;
}


function clamp(n) {
  return Math.min(1, Math.max(0, n));
}

function result(score, verdict, confident, signals) {
  return { score: Number(score.toFixed(4)), verdict, confident, signals };
}
