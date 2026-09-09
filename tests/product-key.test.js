import { describe, it, expect } from 'vitest';
import { productKey, keyStrength } from '../src/core/product-key.js';

describe('productKey — cross-retailer stability', () => {
  it('produces the same key for the same product listed two ways', () => {
    const amazon = productKey({
      title: 'Sony WH-1000XM5 Wireless Noise Canceling Headphones',
      brand: 'Sony',
    });
    const bestbuy = productKey({
      title: 'Sony WH1000XM5 Over-Ear Bluetooth Headphone, Black',
      brand: 'Sony',
    });

    expect(amazon).toBeTruthy();
    expect(amazon).toBe(bestbuy);
  });

  it('prefers a declared model field over anything in the title', () => {
    const a = productKey({ title: 'LG C3 Series 65-Inch OLED', brand: 'LG', model: 'OLED65C3PUA' });
    const b = productKey({ title: 'LG 65" Class C3 OLED 4K Smart TV', brand: 'LG', model: 'oled-65-c3-pua' });
    expect(a).toBe(b);
    expect(a).toContain('OLED65C3PUA');
  });

  it('ignores colour and marketing words when building a title key', () => {
    const a = productKey({ title: 'Carhartt Acrylic Watch Beanie Black Premium', brand: 'Carhartt' });
    const b = productKey({ title: 'Carhartt Premium Acrylic Watch Beanie Navy', brand: 'Carhartt' });
    expect(a).toBe(b);
  });

  it('is insensitive to word order', () => {
    const a = productKey({ title: 'Instant Pot Duo Evo Pressure Cooker', brand: 'Instant' });
    const b = productKey({ title: 'Instant Pressure Cooker Pot Evo Duo', brand: 'Instant' });
    expect(a).toBe(b);
  });
});

describe('productKey — collision safety', () => {
  it('separates adjacent model generations', () => {
    const xm5 = productKey({ title: 'Sony WH-1000XM5 Headphones', brand: 'Sony' });
    const xm4 = productKey({ title: 'Sony WH-1000XM4 Headphones', brand: 'Sony' });
    expect(xm5).not.toBe(xm4);
  });

  it('separates capacity variants', () => {
    const a = productKey({ title: 'Samsung 990 PRO SSD', brand: 'Samsung', model: 'MZ-V9P2T0B' });
    const b = productKey({ title: 'Samsung 990 PRO SSD', brand: 'Samsung', model: 'MZ-V9P1T0B' });
    expect(a).not.toBe(b);
  });

  it('separates different brands with similar titles', () => {
    const a = productKey({ title: 'Wireless Noise Cancelling Over Ear Headphones', brand: 'Sony' });
    const b = productKey({ title: 'Wireless Noise Cancelling Over Ear Headphones', brand: 'Bose' });
    expect(a).not.toBe(b);
  });

  it('refuses a title carrying several candidate codes', () => {
    // Cannot tell which code identifies the product and which is a capacity.
    const key = productKey({ title: 'Dell XPS 9520 512GB 16GB RAM Laptop', brand: 'Dell' });
    expect(keyStrength(key)).not.toBe('strong');
  });

  it('returns null when there is no brand to anchor a title key', () => {
    expect(productKey({ title: 'Stainless Steel Mixing Bowl Set' })).toBeNull();
  });

  it('returns null for a title with too few distinctive tokens', () => {
    expect(productKey({ title: 'Sony Black Large', brand: 'Sony' })).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(productKey(null)).toBeNull();
    expect(productKey({})).toBeNull();
  });

  it('rejects a letters-only model field as a series name', () => {
    const key = productKey({ title: 'Bose QuietComfort Headphones Wireless', brand: 'Bose', model: 'QUIETCOMFORT' });
    expect(key?.includes('QUIETCOMFORT')).not.toBe(true);
  });
});

describe('keyStrength', () => {
  it('rates a model-derived key strong', () => {
    expect(keyStrength(productKey({ title: 'Sony WH-1000XM5', brand: 'Sony' }))).toBe('strong');
  });

  it('rates a title-derived key weak', () => {
    const key = productKey({ title: 'Instant Pot Duo Evo Pressure Cooker', brand: 'Instant' });
    expect(keyStrength(key)).toBe('weak');
  });

  it('rates a missing key none', () => {
    expect(keyStrength(null)).toBe('none');
  });
});
