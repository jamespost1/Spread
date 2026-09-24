import { describe, it, expect } from 'vitest';
import {
  normalizeTitle, tokenize, extractModelNumbers, extractQuantities, canonicalModelCode,
} from '../src/core/normalize.js';

describe('normalizeTitle', () => {
  it('lowercases, strips punctuation and collapses whitespace', () => {
    expect(normalizeTitle('Sony  WH-1000XM5,  Black!')).toBe('sony wh 1000xm5 black');
  });

  it('returns an empty string for non-string input', () => {
    expect(normalizeTitle(null)).toBe('');
    expect(normalizeTitle(undefined)).toBe('');
    expect(normalizeTitle(42)).toBe('');
  });
});

describe('tokenize', () => {
  it('drops stopwords and short fragments', () => {
    expect(tokenize('The Sony Headphones for a New Pack')).toEqual(['sony', 'headphones']);
  });

  it('keeps meaningful tokens', () => {
    expect(tokenize('Instant Pot Duo 7-in-1')).toContain('instant');
    expect(tokenize('Instant Pot Duo 7-in-1')).toContain('duo');
  });
});

describe('extractModelNumbers', () => {
  it('finds a hyphenated model code', () => {
    expect(extractModelNumbers('Sony WH-1000XM5 Headphones')).toContain('WH1000XM5');
  });

  it('matches the same code written with and without a hyphen', () => {
    const hyphenated = extractModelNumbers('Sony WH-1000XM5');
    const plain = extractModelNumbers('Sony WH1000XM5');
    expect(hyphenated.some((code) => plain.includes(code))).toBe(true);
  });

  it('ignores plain English words that fit the code patterns', () => {
    const codes = extractModelNumbers('WIRELESS BLUETOOTH PORTABLE SILVER');
    expect(codes).toEqual([]);
  });

  it('requires at least one digit', () => {
    expect(extractModelNumbers('SONY HEADPHONES BLACK')).toEqual([]);
  });

  it('finds UPC-length digit strings', () => {
    expect(extractModelNumbers('Item 012345678905 in stock')).toContain('012345678905');
  });

  it('handles empty and non-string input', () => {
    expect(extractModelNumbers('')).toEqual([]);
    expect(extractModelNumbers(null)).toEqual([]);
  });

  it('rejects a capacity, size or wattage as a model code', () => {
    // "512GB" fits the generic alphanumeric pattern, but two different laptops
    // that both mention 512GB are not the same product.
    expect(extractModelNumbers('Dell XPS 9520 512GB 16GB RAM Laptop')).not.toContain('512GB');
    expect(extractModelNumbers('Anker 20000mAh Power Bank')).toEqual([]);
    expect(extractModelNumbers('Ninja 1000W Blender')).toEqual([]);
    expect(extractModelNumbers('Sandisk 512GB Memory Card')).toEqual([]);
    expect(extractModelNumbers('Gaming Monitor 144HZ')).toEqual([]);
  });

  it('still finds real model codes that end in letters', () => {
    expect(extractModelNumbers('JBL Flip 520BT Speaker')).toContain('520BT');
    expect(extractModelNumbers('LG OLED65C3PUA TV')).toContain('OLED65C3PUA');
  });
});

describe('extractQuantities', () => {
  it('normalizes count aliases', () => {
    expect(extractQuantities('Tide Pods 150 Count')).toEqual(['150 count']);
    expect(extractQuantities('Tide Pods 150 ct')).toEqual(['150 count']);
  });

  it('reads hyphenated pack sizes', () => {
    expect(extractQuantities('Batteries 12-Pack')).toEqual(['12 pack']);
  });

  it('reads fluid measures', () => {
    expect(extractQuantities('Shampoo 24 fl oz')).toEqual(['24 floz']);
  });

  it('returns an empty list when no quantity is present', () => {
    expect(extractQuantities('Sony Headphones')).toEqual([]);
  });
});

describe('canonicalModelCode', () => {
  it('strips punctuation and casing', () => {
    expect(canonicalModelCode('wh-1000xm5')).toBe('WH1000XM5');
  });

  it('drops a brand that the retailer folded into the model field', () => {
    // Observed live: eBay reports "Sony WH-1000XM5" where Amazon reports
    // "WH-1000XM5". Without this they are two keys for one product.
    expect(canonicalModelCode('Sony WH-1000XM5', 'Sony')).toBe('WH1000XM5');
    expect(canonicalModelCode('WH-1000XM5', 'Sony')).toBe('WH1000XM5');
  });

  it('keeps the brand when removing it would leave nothing identifying', () => {
    // "LG" off "LG65" leaves "65", which names no product.
    expect(canonicalModelCode('LG65', 'LG')).toBe('LG65');
  });

  it('is unaffected by brand casing or punctuation', () => {
    expect(canonicalModelCode('BEST-BUY-ABC1234', 'Best Buy')).toBe('ABC1234');
  });

  it('rejects a letters-only series name', () => {
    expect(canonicalModelCode('QUIETCOMFORT', 'Bose')).toBeNull();
  });

  it('rejects a capacity or wattage', () => {
    expect(canonicalModelCode('512GB')).toBeNull();
    expect(canonicalModelCode('1000W')).toBeNull();
  });

  it('rejects anything too short to identify a product', () => {
    expect(canonicalModelCode('A1')).toBeNull();
    expect(canonicalModelCode('')).toBeNull();
    expect(canonicalModelCode(null)).toBeNull();
  });
});
