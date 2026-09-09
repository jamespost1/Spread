import { describe, it, expect } from 'vitest';
import {
  normalizeTitle, tokenize, extractModelNumbers, extractQuantities,
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
