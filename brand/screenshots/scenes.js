// Store-listing scenes.
//
// Each scene is the real panel rendered by the real `openPanel` from
// src/content/modal.js against a representative response. Nothing here
// describes behaviour the extension does not have: every field is a shape the
// Worker actually returns, and the headline is chosen by the shipped
// `chooseHeadline` rather than written by hand. If the UI changes, these
// screenshots change with it -- which is the whole reason they are generated
// rather than captured once and forgotten.

/** @typedef {{id: string, caption: string, product: object, response: object}} Scene */

/** @type {Scene[]} */
export const SCENES = [
  {
    id: 'cheaper-elsewhere',
    caption: 'See instantly when the same item is cheaper somewhere else.',
    product: { title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones', price: 399.99 },
    response: {
      ok: true,
      matching: { candidates: 11, fromObservations: 2 },
      offers: [
        {
          retailer: 'Walmart',
          title: 'Sony WH-1000XM5 Wireless Noise Cancelling Headphones, Black',
          price: 348.0,
          url: 'https://www.walmart.com/ip/example',
          urlKind: 'product-page',
          match: { verdict: 'same' },
        },
        {
          retailer: 'Best Buy',
          title: 'Sony - WH1000XM5 Wireless Noise Canceling Over-the-Ear Headphones',
          price: 379.99,
          url: 'https://www.bestbuy.com/site/example',
          urlKind: 'product-page',
          match: { verdict: 'same' },
        },
      ],
      carried: [],
    },
  },
  {
    id: 'lowest-ever',
    caption: 'Know whether today’s price is actually a good one.',
    product: { title: 'Apple iPad Air 11-inch (M2, 128GB, Wi-Fi)', price: 549.0 },
    response: {
      ok: true,
      matching: { candidates: 9, fromObservations: 4 },
      history: {
        retailer: 'Amazon',
        current: 549.0,
        lowest: 549.0,
        highest: 599.0,
        days: 34,
        points: 21,
        isLowest: true,
      },
      offers: [],
      carried: [],
    },
  },
  {
    id: 'above-low',
    caption: 'See when a price has been lower \u2014 and decide to wait.',
    product: { title: 'Dyson V15 Detect Absolute Cordless Vacuum', price: 749.99 },
    response: {
      ok: true,
      matching: { candidates: 7, fromObservations: 3 },
      history: {
        retailer: 'Target',
        current: 749.99,
        lowest: 649.99,
        highest: 799.99,
        days: 28,
        points: 16,
        isLowest: false,
      },
      offers: [],
      carried: [],
    },
  },
  {
    id: 'verified-prices',
    caption: 'Every price is read from the retailer’s own listing — never estimated.',
    product: { title: 'LG C4 65" OLED evo 4K Smart TV', price: 1699.99 },
    response: {
      ok: true,
      matching: { candidates: 14, fromObservations: 1 },
      offers: [
        {
          retailer: 'Costco',
          title: 'LG 65" Class C4 Series OLED evo 4K UHD Smart TV',
          price: 1599.99,
          url: 'https://www.costco.com/example.product.html',
          urlKind: 'product-page',
          match: { verdict: 'same' },
        },
      ],
      carried: [
        { retailer: 'Target', url: 'https://www.target.com/p/example' },
        { retailer: 'Walmart', url: 'https://www.walmart.com/ip/example' },
      ],
    },
  },
  {
    id: 'carried-only',
    caption: 'If a price cannot be confirmed, Spread says so rather than guess.',
    product: { title: 'Weber Genesis E-325s 3-Burner Propane Gas Grill', price: 1049.0 },
    response: {
      ok: true,
      matching: { candidates: 6, fromObservations: 0 },
      offers: [],
      carried: [
        { retailer: 'Lowe’s', url: 'https://www.lowes.com/pd/example' },
        { retailer: 'Ace Hardware', url: 'https://www.acehardware.com/example' },
        { retailer: 'Walmart', url: 'https://www.walmart.com/ip/example' },
      ],
    },
  },
];
