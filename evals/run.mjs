#!/usr/bin/env node
// Measure the match cascade against a labeled set.
//
//   node evals/run.mjs                 heuristics only (free, no network)
//   node evals/run.mjs --with-llm      full cascade (needs ANTHROPIC_API_KEY)
//
// The point of this harness is to answer two questions with numbers rather
// than vibes: how accurate is the matcher, and what does the LLM stage
// actually buy for what it costs.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compareProducts, VERDICT } from '../src/core/matching.js';
import { ADJUDICATOR_MODEL } from '../worker/src/adjudicator.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const withLlm = process.argv.includes('--with-llm');
const asJson = process.argv.includes('--json');

// Haiku 4.5 list pricing, $/million tokens.
const PRICE_IN = 1.0;
const PRICE_OUT = 5.0;

const { pairs } = JSON.parse(readFileSync(path.join(here, 'fixtures/product-pairs.json'), 'utf8'));

const results = [];
let tokensIn = 0;
let tokensOut = 0;
let llmCalls = 0;

for (const pair of pairs) {
  const stage1 = compareProducts(pair.source, pair.candidate);

  let predicted = collapse(stage1.verdict);
  let stage = stage1.confident ? 'heuristic' : 'unresolved';

  if (!stage1.confident && withLlm) {
    const judged = await adjudicateOne(pair);
    if (judged) {
      predicted = collapse(judged.verdict);
      stage = 'adjudicated';
      llmCalls++;
      tokensIn += judged.usage.input_tokens;
      tokensOut += judged.usage.output_tokens;
    }
  } else if (!stage1.confident) {
    // Without the LLM the cascade must not guess. Treat it as "not the same",
    // which is the safe direction: a missed match costs a comparison, a false
    // match shows a wrong price.
    predicted = 'different';
  }

  results.push({
    id: pair.id,
    expected: pair.label,
    predicted,
    correct: predicted === pair.label,
    score: stage1.score,
    stage,
    note: pair.note,
  });
}

const metrics = score(results);
const cost = (tokensIn / 1e6) * PRICE_IN + (tokensOut / 1e6) * PRICE_OUT;

if (asJson) {
  console.log(JSON.stringify({ mode: withLlm ? 'cascade' : 'heuristics', metrics, results }, null, 2));
} else {
  report(metrics, results, { llmCalls, tokensIn, tokensOut, cost });
}

// A wrong SAME is the failure that matters, so exit non-zero if precision slips.
process.exit(metrics.precision < 0.9 ? 1 : 0);

// ---------------------------------------------------------------------------

/** The eval labels are binary; SIMILAR and DIFFERENT both mean "not the same item". */
function collapse(verdict) {
  return verdict === VERDICT.SAME ? 'same' : 'different';
}

async function adjudicateOne(pair) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();

  const response = await client.messages.create({
    model: ADJUDICATOR_MODEL,
    max_tokens: 512,
    system:
      'Decide whether two retail listings are the same purchasable item. Adjacent model generations, different capacities, different pack sizes, bundles, and refurbished units are all DIFFERENT. Colour variants of one model are SAME.',
    tools: [
      {
        name: 'record_verdict',
        description: 'Record the verdict for this pair.',
        strict: true,
        input_schema: {
          type: 'object',
          additionalProperties: false,
          required: ['verdict', 'reason'],
          properties: {
            verdict: { type: 'string', enum: ['same', 'different'] },
            reason: { type: 'string' },
          },
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'record_verdict' },
    messages: [
      {
        role: 'user',
        content: JSON.stringify({ viewing: pair.source, candidate: pair.candidate }),
      },
    ],
  });

  const block = response.content.find((b) => b.type === 'tool_use');
  if (!block) return null;
  return { verdict: block.input.verdict, usage: response.usage };
}

/** Precision/recall computed over the positive class ("same"). */
function score(rows) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  for (const r of rows) {
    if (r.predicted === 'same' && r.expected === 'same') tp++;
    else if (r.predicted === 'same' && r.expected === 'different') fp++;
    else if (r.predicted === 'different' && r.expected === 'same') fn++;
    else tn++;
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    total: rows.length,
    correct: tp + tn,
    accuracy: (tp + tn) / rows.length,
    precision,
    recall,
    f1,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    trueNegatives: tn,
  };
}

function report(metrics, rows, usage) {
  const pct = (n) => `${(n * 100).toFixed(1)}%`;

  console.log(`\n  Spread match cascade — ${withLlm ? 'full cascade' : 'heuristics only'}\n`);
  console.log(`  Accuracy    ${pct(metrics.accuracy)}  (${metrics.correct}/${metrics.total})`);
  console.log(`  Precision   ${pct(metrics.precision)}  ← a false SAME shows a wrong price`);
  console.log(`  Recall      ${pct(metrics.recall)}`);
  console.log(`  F1          ${metrics.f1.toFixed(3)}`);
  console.log(
    `\n  TP ${metrics.truePositives}  FP ${metrics.falsePositives}  FN ${metrics.falseNegatives}  TN ${metrics.trueNegatives}`
  );

  const unresolved = rows.filter((r) => r.stage === 'unresolved').length;
  const adjudicated = rows.filter((r) => r.stage === 'adjudicated').length;
  console.log(
    `\n  Resolved by heuristics  ${rows.length - unresolved - adjudicated}/${rows.length}`
  );
  if (withLlm) {
    console.log(`  Sent to adjudicator     ${adjudicated}/${rows.length}`);
    console.log(
      `  Tokens                  ${usage.tokensIn} in / ${usage.tokensOut} out over ${usage.llmCalls} calls`
    );
    console.log(`  Cost this run           $${usage.cost.toFixed(5)}`);
  } else {
    console.log(`  Left unresolved         ${unresolved}/${rows.length}  (run --with-llm to judge these)`);
  }

  const failures = rows.filter((r) => !r.correct);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    ✗ ${f.id.padEnd(30)} expected ${f.expected}, got ${f.predicted} (score ${f.score})`);
      if (f.note) console.log(`      ${f.note}`);
    }
  }
  console.log('');
}
