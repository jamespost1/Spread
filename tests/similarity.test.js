import { describe, it, expect } from 'vitest';
import { levenshtein, levenshteinRatio, jaccard, containment } from '../src/core/similarity.js';

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('kitten', 'kitten')).toBe(0);
  });

  it('computes the classic distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('is symmetric', () => {
    expect(levenshtein('flaw', 'lawn')).toBe(levenshtein('lawn', 'flaw'));
  });

  it('handles empty input', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('', '')).toBe(0);
  });
});

describe('levenshteinRatio', () => {
  it('is 1 for identical strings', () => {
    expect(levenshteinRatio('sony', 'sony')).toBe(1);
  });

  it('is 1 when both sides are empty', () => {
    expect(levenshteinRatio('', '')).toBe(1);
  });

  it('falls between 0 and 1 otherwise', () => {
    const ratio = levenshteinRatio('sony headphones', 'sony earphones');
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(1);
  });
});

describe('jaccard', () => {
  it('is 1 for identical token sets', () => {
    expect(jaccard(['a', 'b'], ['b', 'a'])).toBe(1);
  });

  it('is 0 for disjoint sets', () => {
    expect(jaccard(['a'], ['b'])).toBe(0);
  });

  it('is 0 when both sets are empty', () => {
    expect(jaccard([], [])).toBe(0);
  });

  it('computes intersection over union', () => {
    expect(jaccard(['a', 'b', 'c'], ['b', 'c', 'd'])).toBeCloseTo(2 / 4);
  });
});

describe('containment', () => {
  it('is 1 when the smaller set is fully contained', () => {
    expect(containment(['sony', 'xm5'], ['sony', 'xm5', 'wireless', 'black'])).toBe(1);
  });

  it('does not punish a verbose listing the way jaccard does', () => {
    const short = ['sony', 'xm5'];
    const verbose = ['sony', 'xm5', 'wireless', 'noise', 'canceling', 'over', 'ear'];
    expect(containment(short, verbose)).toBeGreaterThan(jaccard(short, verbose));
  });

  it('is 0 when either set is empty', () => {
    expect(containment([], ['a'])).toBe(0);
  });
});
