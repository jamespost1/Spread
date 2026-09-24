// Per-retailer DOM selectors, ordered most- to least-specific.
//
// These are the fragile part of any scraper — retailers reship their markup
// without warning. Keeping them as data (rather than six near-identical
// functions) means a broken site is a one-line fix, and `npm run verify:selectors`
// can check them all against live pages.

/**
 * @typedef {object} RetailerSelectors
 * @property {string[]} title
 * @property {string[]} price
 * @property {string[]} image
 * @property {string[]} brand
 * @property {RegExp} productUrl Pattern a URL must match to be a product page.
 */

/** @type {Record<string, RetailerSelectors>} */
export const SELECTORS = {
  Amazon: {
    title: [
      '#productTitle',
      'h1.a-size-large.product-title-word-break',
      'h1.a-size-base-plus',
      '[data-feature-name="title"] h1',
    ],
    price: [
      '.a-price .a-offscreen',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#priceblock_saleprice',
      '.a-price-whole',
    ],
    image: ['#landingImage', '#imgBlkFront', '#main-image', '#leftCol img[data-a-dynamic-image]'],
    brand: ['#brand', '.po-brand .po-break-word', '[data-feature-name="bylineInfo"] a'],
    productUrl: /\/(dp|gp\/product)\/[A-Z0-9]{10}/i,
  },

  Target: {
    title: ['h1[data-test="product-title"]', 'h1.product-title', '[data-test="product-title"]'],
    price: [
      // Target renders the price several times and hides all but one, so the
      // most specific visible container is tried first.
      '[data-test="@web/Price/PriceFull"] [data-test="product-price"]',
      '[data-test="product-price"]',
      '[data-test="current-price"]',
      '[itemprop="price"]',
      '.h-text-bold[aria-label*="price"]',
    ],
    image: ['[data-test="product-image"] img', '[data-test="gallery-image"] img', '.product-image img'],
    brand: ['[data-test="product-brand"]', '.product-brand'],
    productUrl: /\/p\/|\/-\/A-\d+/i,
  },

  Walmart: {
    title: [
      'h1[itemprop="name"]',
      'h1.prod-ProductTitle',
      '[data-testid="product-title"]',
      'h1.prod-product-title',
    ],
    price: [
      '[itemprop="price"]',
      '[data-testid="price"]',
      '.price-display',
      '.price-current',
      '.prod-PriceHero',
    ],
    image: [
      '[data-testid="product-image"] img',
      '.prod-hero-image img',
      '.hover-zoom-hero-image img',
    ],
    brand: ['[itemprop="brand"]', '.prod-brand-name'],
    productUrl: /\/ip\/|\/seo\//i,
  },

  'Best Buy': {
    title: ['.sku-title h1', 'h1[class*="heading"]', 'h1.heading-5'],
    price: [
      '[data-testid="customer-price"]',
      '.priceView-customer-price span[aria-hidden="true"]',
      '.priceView-customer-price',
      '.priceView-hero-price span[aria-hidden="true"]',
      '.pricing-price__value',
      '[class*="pricing-price"]',
    ],
    image: ['.primary-image', '[data-testid="product-image"] img', '.product-image img'],
    brand: ['[data-testid="brand-link"]', '.brand-link'],
    // Best Buy now serves /product/<slug>/<alphanumeric-id>; the older
    // /site/<slug>/<digits>.p links still resolve, so both are matched.
    productUrl: /\/product\/[^/]+\/[A-Z0-9]{6,}|\/site\/.*\/\d+\.p|skuId=\d+/i,
  },

  eBay: {
    title: ['h1[id*="ebay-item-title"]', 'h1.x-item-title-label', '.x-item-title-label', 'h1.it-ttl'],
    price: [
      '[data-testid="x-price-primary"] .ux-textspans',
      '.x-price-primary .ux-textspans',
      '#prcIsum',
      '.notranslate[itemprop="price"]',
      '[itemprop="price"]',
    ],
    image: ['#icImg', 'img[itemprop="image"]', '[id*="icImg"]', '.ux-image-carousel-item img'],
    brand: ['[data-testid="ux-labels-values__values"] .ux-textspans', 'div[class*="itemAttr"]'],
    productUrl: /\/itm\/\d+/i,
  },

  Costco: {
    title: ['h1[automation-id="productOutputTitle"]', '.product-title h1', 'h1.product-title'],
    price: ['.your-price .value', '[automation-id="productPriceOutput"]', '.price .value', '.your-price'],
    image: ['#productImage', '.product-image-container img', '[automation-id="productImage"]'],
    brand: ['[itemprop="brand"]', '.product-brand'],
    // Costco now serves /p/[-/]<slug>/<numeric-id>; the older
    // <slug>.product.<id>.html links still exist.
    productUrl: /\/p\/.*\/\d{6,}|\.product\.\d+\.html/i,
  },
};
