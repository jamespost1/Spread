import { describe, it, expect } from 'vitest';
import { compareProducts, partitionCandidates, VERDICT, THRESHOLDS } from '../src/core/matching.js';

const sony = { title: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones', brand: 'Sony' };

describe('compareProducts — decisive signals', () => {
  it('returns a perfect score for identical titles', () => {
    const r = compareProducts(sony, { ...sony });
    expect(r.verdict).toBe(VERDICT.SAME);
    expect(r.score).toBe(1);
  });

  it('trusts matching retailer-supplied model fields above everything', () => {
    const r = compareProducts(
      { title: 'Completely different words here', model: 'WH1000XM5' },
      { title: 'Nothing alike whatsoever', model: 'wh-1000-xm5' }
    );
    expect(r.verdict).toBe(VERDICT.SAME);
    expect(r.signals.reason).toBe('model-field-exact');
  });

  it('rejects outright when two model fields conflict', () => {
    const r = compareProducts(
      { title: 'Sony WH-1000XM5 Headphones', model: 'WH1000XM5' },
      { title: 'Sony WH-1000XM4 Headphones', model: 'WH1000XM4' }
    );
    expect(r.verdict).toBe(VERDICT.DIFFERENT);
    expect(r.confident).toBe(true);
  });

  it('matches a model code mined from both titles despite different wording', () => {
    const r = compareProducts(sony, {
      title: 'Sony WH1000XM5 Over-Ear Bluetooth Headphone, Black',
      brand: 'Sony',
    });
    expect(r.verdict).toBe(VERDICT.SAME);
    expect(r.signals.reason).toBe('model-in-title');
  });

  it('treats a colour-suffixed model code as the same model', () => {
    const r = compareProducts(
      { title: 'Sony WH1000XM5 Headphones' },
      { title: 'Sony WH1000XM5B Headphones' }
    );
    expect(r.verdict).toBe(VERDICT.SAME);
  });
});

describe('compareProducts — rejections', () => {
  it('rejects a different brand outright', () => {
    const r = compareProducts(sony, {
      title: 'Bose QuietComfort 45 Wireless Noise Cancelling Headphones',
      brand: 'Bose',
    });
    expect(r.verdict).toBe(VERDICT.DIFFERENT);
  });

  it('rejects when a title is missing', () => {
    expect(compareProducts(sony, { title: '' }).verdict).toBe(VERDICT.DIFFERENT);
    expect(compareProducts({ title: '' }, sony).signals.reason).toBe('missing-title');
  });

  it('caps the score when pack sizes conflict', () => {
    const r = compareProducts(
      { title: 'Tide Pods Spring Meadow 150 Count', brand: 'Tide' },
      { title: 'Tide Pods Spring Meadow 42 Count', brand: 'Tide' }
    );
    expect(r.score).toBeLessThanOrEqual(0.6);
    expect(r.verdict).not.toBe(VERDICT.SAME);
  });
});

describe('compareProducts — the ambiguous band', () => {
  it('refuses to decide between adjacent model generations', () => {
    // The titles are ~96% similar as strings but are different products.
    // Stage 1 must hand this to the adjudicator rather than guess.
    const r = compareProducts(
      { title: 'Sony WH-1000XM5 Headphones', brand: 'Sony' },
      { title: 'Sony WH-1000XM4 Headphones', brand: 'Sony' }
    );
    expect(r.verdict).toBe(VERDICT.AMBIGUOUS);
    expect(r.confident).toBe(false);
  });

  it('flags equivalent-but-differently-worded pack sizes', () => {
    const r = compareProducts(
      { title: 'Hanes Mens Crew Socks 12 Pack White', brand: 'Hanes' },
      { title: 'Hanes Men Cushion Crew Sock White 12 Pair', brand: 'Hanes' }
    );
    expect(r.confident).toBe(false);
  });

  it('keeps ambiguous scores inside the configured band', () => {
    const r = compareProducts(
      { title: 'Sony WH-1000XM5 Headphones', brand: 'Sony' },
      { title: 'Sony WH-1000XM4 Headphones', brand: 'Sony' }
    );
    expect(r.score).toBeGreaterThanOrEqual(THRESHOLDS.DIFFERENT);
    expect(r.score).toBeLessThan(THRESHOLDS.SAME);
  });
});

describe('compareProducts — the precision invariant', () => {
  // The property the whole cascade rests on: a confident SAME is only ever
  // earned by a decisive signal. Fuzzy scoring may reject, never confirm.
  const nearIdenticalButDifferent = [
    ['Apple Watch Series 9 GPS 45mm Midnight', 'Apple Watch Series 8 GPS 45mm Midnight'],
    ["Carhartt Men's Acrylic Watch Hat One Size Black", "Carhartt Men's Acrylic Watch Hat One Size Navy"],
    ['Apple AirPods Pro (2nd Generation)', 'Apple AirPods Pro (1st Generation)'],
    ['Samsung 990 PRO 2TB NVMe M.2 SSD', 'Samsung 990 PRO 1TB NVMe M.2 SSD'],
  ];

  it.each(nearIdenticalButDifferent)(
    'never confidently claims SAME from string similarity alone: %s',
    (a, b) => {
      const r = compareProducts({ title: a }, { title: b });
      // It may say ambiguous or different, but never a confident same.
      expect(r.verdict === VERDICT.SAME && r.confident).toBe(false);
    }
  );

  it('rejects a refurbished listing against a new one', () => {
    const r = compareProducts(
      { title: 'Dyson V15 Detect Cordless Vacuum', brand: 'Dyson' },
      { title: 'Dyson V15 Detect Cordless Vacuum - Certified Refurbished', brand: 'Dyson' }
    );
    expect(r.verdict).toBe(VERDICT.DIFFERENT);
    expect(r.signals.reason).toBe('condition-mismatch');
  });

  it('does not treat a shared storage capacity as a shared model code', () => {
    // Regression: "512GB" was being mined as a model code, which confirmed two
    // entirely different laptops as the same product.
    const r = compareProducts(
      { title: 'Dell XPS 9520 512GB 16GB RAM Laptop', brand: 'Dell' },
      { title: 'Dell Inspiron 3520 512GB Touchscreen', brand: 'Dell' }
    );
    expect(r.verdict).toBe(VERDICT.DIFFERENT);
    expect(r.signals.reason).not.toBe('model-in-title');
  });

  it('rejects a bundle against the standalone item', () => {
    const r = compareProducts(
      { title: 'Instant Pot Duo 6 Quart', brand: 'Instant Pot' },
      { title: 'Instant Pot Duo 6 Quart Bundle with Glass Lid', brand: 'Instant Pot' }
    );
    expect(r.verdict).toBe(VERDICT.DIFFERENT);
  });

  it('still confirms SAME when a model code backs it up', () => {
    const r = compareProducts(
      { title: 'Sony WH-1000XM5 Headphones' },
      { title: 'Sony WH1000XM5 Wireless Over-Ear Headphone Black' }
    );
    expect(r.verdict).toBe(VERDICT.SAME);
    expect(r.confident).toBe(true);
  });
});

describe('partitionCandidates', () => {
  it('splits candidates by whether stage 1 could decide alone', () => {
    const { resolved, ambiguous } = partitionCandidates(sony, [
      { title: 'Sony WH1000XM5 Over-Ear Bluetooth Headphone', brand: 'Sony' },
      { title: 'Bose QuietComfort 45 Headphones', brand: 'Bose' },
      { title: 'Sony WH-1000XM4 Headphones', brand: 'Sony' },
    ]);
    expect(resolved).toHaveLength(2);
    expect(ambiguous).toHaveLength(1);
    expect(ambiguous[0].title).toContain('XM4');
  });

  it('attaches the match result to every candidate', () => {
    const { resolved } = partitionCandidates(sony, [{ ...sony }]);
    expect(resolved[0].match.verdict).toBe(VERDICT.SAME);
  });

  it('handles a missing candidate list', () => {
    expect(partitionCandidates(sony, null)).toEqual({ resolved: [], ambiguous: [] });
  });
});
