import { describe, it, expect } from 'vitest';
import { retailerFromUrl, sourceRetailerFor, isSafeHttpUrl, retailerSearchUrl } from '../src/core/retailers.js';

describe('retailerFromUrl', () => {
  it('identifies a retailer from a full URL', () => {
    expect(retailerFromUrl('https://www.bestbuy.com/site/product/123.p')).toBe('Best Buy');
  });

  it('identifies a retailer from a bare hostname', () => {
    expect(retailerFromUrl('www.target.com')).toBe('Target');
  });

  it('does not match a lookalike domain', () => {
    expect(retailerFromUrl('https://notamazon.com/deals')).toBeNull();
    expect(retailerFromUrl('https://amazon-deals.example.com')).toBeNull();
  });

  it('matches a regional subdomain', () => {
    expect(retailerFromUrl('https://smile.amazon.com/dp/B01')).toBe('Amazon');
  });

  it('returns null for unknown or malformed input', () => {
    expect(retailerFromUrl('https://example.com')).toBeNull();
    expect(retailerFromUrl('')).toBeNull();
    expect(retailerFromUrl(null)).toBeNull();
  });
});

describe('sourceRetailerFor', () => {
  it('recognises supported source retailers', () => {
    expect(sourceRetailerFor('https://www.walmart.com/ip/123')).toBe('Walmart');
    expect(sourceRetailerFor('costco.com')).toBe('Costco');
  });

  it('rejects a domain that merely contains a retailer name', () => {
    expect(sourceRetailerFor('https://walmart.com.phish.example')).toBeNull();
  });

  it('returns null for unsupported retailers', () => {
    expect(sourceRetailerFor('https://www.newegg.com/p/1')).toBeNull();
  });
});

describe('isSafeHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeHttpUrl('https://example.com')).toBe(true);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
  });

  it('rejects script and data URLs', () => {
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>')).toBe(false);
  });

  it('rejects malformed input', () => {
    expect(isSafeHttpUrl('not a url')).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
  });
});

describe('retailerSearchUrl', () => {
  it('builds a search URL on the retailer’s own domain', () => {
    const url = retailerSearchUrl('Best Buy', 'WH-1000XM5');
    expect(url).toContain('bestbuy.com');
    expect(url).toContain('WH-1000XM5');
  });

  it('encodes the query', () => {
    expect(retailerSearchUrl('Target', 'Sony WH-1000XM5')).toContain('Sony%20WH-1000XM5');
  });

  it('returns null for a retailer it has no pattern for', () => {
    expect(retailerSearchUrl('Some Random Shop', 'abc')).toBeNull();
  });

  it('returns null without a query', () => {
    expect(retailerSearchUrl('Target', '')).toBeNull();
  });

  it('produces a safe http url', () => {
    expect(isSafeHttpUrl(retailerSearchUrl('Walmart', 'WH1000XM5'))).toBe(true);
  });
});
