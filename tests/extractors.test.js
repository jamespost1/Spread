// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { extractProduct, isProductPage } from '../src/content/extractors/index.js';

/** Build a fake page: JSON-LD payload plus arbitrary body markup. */
function page({ jsonLd, body = '', canonical } = {}) {
  document.head.innerHTML = canonical ? `<link rel="canonical" href="${canonical}">` : '';
  document.body.innerHTML =
    (jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : '') + body;
  return document;
}

const amazonLoc = {
  hostname: 'www.amazon.com',
  href: 'https://www.amazon.com/dp/B09XS7JWHH?ref=tracking',
};

describe('isProductPage', () => {
  it('accepts an Amazon product URL', () => {
    expect(isProductPage(document, amazonLoc)).toBe(true);
  });

  it('rejects an Amazon search page', () => {
    expect(
      isProductPage(document, { hostname: 'www.amazon.com', href: 'https://www.amazon.com/s?k=tv' })
    ).toBe(false);
  });

  it('rejects an unsupported retailer', () => {
    expect(
      isProductPage(document, { hostname: 'www.newegg.com', href: 'https://www.newegg.com/p/1' })
    ).toBe(false);
  });
});

describe('extractProduct — structured data', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('reads a schema.org Product', () => {
    page({
      jsonLd: {
        '@type': 'Product',
        name: 'Sony WH-1000XM5 Headphones',
        brand: { '@type': 'Brand', name: 'Sony' },
        model: 'WH1000XM5',
        sku: 'B09XS7JWHH',
        image: 'https://img.example/xm5.jpg',
        offers: { '@type': 'Offer', price: '349.99', priceCurrency: 'USD' },
      },
    });

    const product = extractProduct(document, amazonLoc);
    expect(product).toMatchObject({
      retailer: 'Amazon',
      title: 'Sony WH-1000XM5 Headphones',
      price: 349.99,
      brand: 'Sony',
      model: 'WH1000XM5',
      sku: 'B09XS7JWHH',
      imageUrl: 'https://img.example/xm5.jpg',
    });
  });

  it('finds a Product nested inside an @graph', () => {
    page({
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          { '@type': 'BreadcrumbList' },
          { '@type': ['Product'], name: 'Graph Product', offers: { price: 19.99 } },
        ],
      },
    });
    expect(extractProduct(document, amazonLoc)?.title).toBe('Graph Product');
  });

  it('reads an AggregateOffer lowPrice', () => {
    page({
      jsonLd: {
        '@type': 'Product',
        name: 'Ranged Product',
        offers: { '@type': 'AggregateOffer', lowPrice: '99.00', priceCurrency: 'USD' },
      },
    });
    expect(extractProduct(document, amazonLoc)?.price).toBe(99);
  });

  it('ignores a non-USD structured price', () => {
    page({
      jsonLd: {
        '@type': 'Product',
        name: 'Euro Product',
        offers: { price: '349.99', priceCurrency: 'EUR' },
      },
    });
    expect(extractProduct(document, amazonLoc)).toBeNull();
  });

  it('survives malformed JSON-LD', () => {
    document.body.innerHTML =
      '<script type="application/ld+json">{ not json </script>' +
      '<span id="productTitle">Fallback Title</span><div class="a-price"><span class="a-offscreen">$12.00</span></div>';
    const product = extractProduct(document, amazonLoc);
    expect(product?.title).toBe('Fallback Title');
  });
});

describe('extractProduct — selector fallback', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('falls back to CSS selectors when no structured data exists', () => {
    page({
      body: `
        <span id="productTitle">  Instant Pot Duo 7-in-1  </span>
        <div class="a-price"><span class="a-offscreen">$89.99</span></div>
        <img id="landingImage" src="https://img.example/pot.jpg">
        <span id="brand">Instant Pot</span>`,
    });

    const product = extractProduct(document, amazonLoc);
    expect(product).toMatchObject({
      title: 'Instant Pot Duo 7-in-1',
      price: 89.99,
      brand: 'Instant Pot',
      imageUrl: 'https://img.example/pot.jpg',
    });
  });

  it('exposes the price element so the button can be anchored to it', () => {
    page({ body: '<span id="productTitle">X</span><div class="a-price"><span class="a-offscreen">$5.00</span></div>' });
    expect(extractProduct(document, amazonLoc)?.priceElement).toBeTruthy();
  });

  it('returns null when no price can be read', () => {
    page({ body: '<span id="productTitle">Priceless</span>' });
    expect(extractProduct(document, amazonLoc)).toBeNull();
  });

  it('returns null when no title can be read', () => {
    page({ body: '<div class="a-price"><span class="a-offscreen">$5.00</span></div>' });
    expect(extractProduct(document, amazonLoc)).toBeNull();
  });

  it('prefers the canonical URL over one carrying tracking parameters', () => {
    page({
      canonical: 'https://www.amazon.com/dp/B09XS7JWHH',
      body: '<span id="productTitle">T</span><div class="a-price"><span class="a-offscreen">$1.00</span></div>',
    });
    expect(extractProduct(document, amazonLoc)?.url).toBe('https://www.amazon.com/dp/B09XS7JWHH');
  });
});

describe('extractProduct — real captured pages', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('reads a Best Buy page on their current URL scheme', () => {
    // Captured live: /product/<slug>/<alphanumeric-id>, with all the useful
    // data in JSON-LD rather than in the markup.
    page({
      jsonLd: {
        '@type': 'Product',
        name: 'Sony - WH-1000XM6- Best Wireless Noise Cancelling Headphones - Black',
        brand: { '@type': 'Brand', name: 'Sony' },
        model: 'WH1000XM6/B',
        offers: { price: 425.49, priceCurrency: 'USD' },
      },
    });

    const product = extractProduct(document, {
      hostname: 'www.bestbuy.com',
      href: 'https://www.bestbuy.com/product/sony-wh-1000xm6-best-wireless-noise-cancelling-headphones-black/J7XSRH5RCF',
    });

    expect(product).toMatchObject({
      retailer: 'Best Buy',
      price: 425.49,
      brand: 'Sony',
      model: 'WH1000XM6/B',
    });
  });

  it('reads a Target page from selectors when no JSON-LD is present', () => {
    // Captured live: Target ships no ld+json at all on product pages.
    page({
      body: `
        <h1 data-test="product-title">Sony WH-1000XM5 Bluetooth Wireless Noise-Canceling Headphones - Black</h1>
        <span data-test="product-price">$299.99</span>`,
    });

    const product = extractProduct(document, {
      hostname: 'www.target.com',
      href: 'https://www.target.com/p/sony-wh-1000xm5/-/A-86314264',
    });

    expect(product).toMatchObject({ retailer: 'Target', price: 299.99 });
    expect(product.priceElement).toBeTruthy();
  });

  it('accepts a Costco page on their current URL scheme', () => {
    expect(
      isProductPage(document, {
        hostname: 'www.costco.com',
        href: 'https://www.costco.com/p/-/soundcore-space-one/4000416065?langId=-1',
      })
    ).toBe(true);
  });
});

describe('extractProduct — visibility and shadow DOM', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('skips a hidden price node in favour of a visible one', () => {
    // Captured live on Target: several price nodes, all but one hidden. Taking
    // the first match anchored the button inside a hidden container, so it was
    // in the DOM at 121x29 and invisible to the user.
    page({
      body: `
        <h1 data-test="product-title">Sony WH-1000XM5</h1>
        <div style="visibility:hidden"><span data-test="product-price">$999.99</span></div>
        <div data-test="@web/Price/PriceFull"><span data-test="product-price">$299.99</span></div>`,
    });

    const product = extractProduct(document, {
      hostname: 'www.target.com',
      href: 'https://www.target.com/p/x/-/A-1',
    });

    expect(product.price).toBe(299.99);
    expect(product.priceElement.textContent).toBe('$299.99');
  });

  it('falls back to a hidden match rather than failing outright', () => {
    page({
      body: `
        <h1 data-test="product-title">Sony WH-1000XM5</h1>
        <span data-test="product-price" style="visibility:hidden">$299.99</span>`,
    });
    const product = extractProduct(document, {
      hostname: 'www.target.com',
      href: 'https://www.target.com/p/x/-/A-1',
    });
    expect(product?.price).toBe(299.99);
  });

  it('finds a price inside a shadow root', () => {
    // Captured live on Costco: 12 shadow roots, price unreachable from the
    // light DOM.
    page({ body: '<h1 class="product-title">Soundcore Space One</h1><div id="host"></div>' });
    const shadow = document.getElementById('host').attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div class="your-price"><span class="value">$99.99</span></div>';

    const product = extractProduct(document, {
      hostname: 'www.costco.com',
      href: 'https://www.costco.com/p/-/soundcore-space-one/4000416065',
    });

    expect(product).toMatchObject({ retailer: 'Costco', price: 99.99 });
  });
});

describe('extractProduct — retailer routing', () => {
  it('returns null off a supported retailer', () => {
    expect(extractProduct(document, { hostname: 'example.com', href: 'https://example.com' })).toBeNull();
  });

  it('reads a Best Buy page with its own selectors', () => {
    page({ body: '<div class="sku-title"><h1>Dyson V15</h1></div><div data-testid="customer-price">$749.99</div>' });
    const product = extractProduct(document, {
      hostname: 'www.bestbuy.com',
      href: 'https://www.bestbuy.com/site/dyson-v15/6501234.p',
    });
    expect(product).toMatchObject({ retailer: 'Best Buy', title: 'Dyson V15', price: 749.99 });
  });
});
