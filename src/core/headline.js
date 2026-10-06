// What the panel leads with.
//
// This is the single most user-visible decision in the product, so it lives
// here as a pure function rather than inside DOM building: it is domain logic
// about what Spread can honestly claim, not presentation.
//
// The ordering reflects what is actually useful, not which subsystem produced
// it. A cheaper retailer wins when one exists, but on most pages none does --
// the free retailer APIs cover a narrow slice of the catalog -- so price
// history carries the panel. Leading with a comparison that found nothing
// reads as failure on a page where finding nothing is the expected outcome.

import { formatPrice, bestSaving } from './price.js';

/**
 * @typedef {object} Headline
 * @property {string} kind Machine-readable reason, useful in tests and logs.
 * @property {'good'|'neutral'} tone Whether this is good news for the shopper.
 * @property {string} title
 * @property {string} detail
 */

/**
 * Choose the strongest honest statement about this price.
 *
 * @param {{price: number}} product Product being viewed.
 * @param {Array<{retailer?: string, price?: number}>} sameOffers Confirmed same-product offers.
 * @param {object|null} history Price history summary for this retailer.
 * @returns {Headline}
 */
export function chooseHeadline(product, sameOffers = [], history = null) {
  const price = product?.price;
  const tracked = Boolean(history && history.points > 1);
  const saving = bestSaving(price, sameOffers);

  // 1. Somewhere cheaper sells the same item. Nothing beats a number they save.
  if (saving) {
    return {
      kind: 'cheaper-elsewhere',
      tone: 'good',
      title: `Save ${formatPrice(saving.savings)}`,
      detail: `${saving.best.retailer} has this for ${formatPrice(saving.best.price)}, versus ${formatPrice(price)} here.`,
    };
  }

  // 2. Cheapest it has been. Only claimable once there is a real series.
  if (tracked && history.isLowest) {
    const detail =
      Number.isFinite(history.highest) && history.highest > price
        ? `${formatPrice(price)} now, down from ${formatPrice(history.highest)} at its highest.`
        : `${formatPrice(price)} is the lowest Spread has recorded.`;
    return {
      kind: 'lowest-ever',
      tone: 'good',
      title: `Lowest price in ${history.days} ${dayWord(history.days)}`,
      detail,
    };
  }

  // 3. It has been cheaper. Say how much, so waiting becomes an informed choice.
  if (tracked && Number.isFinite(history.lowest) && history.lowest < price) {
    const above = round(price - history.lowest);
    return {
      kind: 'above-low',
      tone: 'neutral',
      title: `${formatPrice(above)} above the low`,
      detail: `This dropped to ${formatPrice(history.lowest)} within the last ${history.days} ${dayWord(history.days)}.`,
    };
  }

  // 4. Tracked, but the price has not moved. Still worth knowing.
  if (tracked) {
    return {
      kind: 'steady',
      tone: 'neutral',
      title: `Steady at ${formatPrice(price)}`,
      detail: `Unchanged across ${history.points} checks over ${history.days} ${dayWord(history.days)}.`,
    };
  }

  // 5. No history yet, but comparisons ran and nothing undercut it.
  if (sameOffers.length > 0) {
    return {
      kind: 'best-available',
      tone: 'good',
      title: 'Best price available',
      detail: `Checked ${sameOffers.length} other listing${sameOffers.length === 1 ? '' : 's'}. Nothing cheaper.`,
    };
  }

  // 6. First sighting. Say what happens next rather than reporting a failure.
  return {
    kind: 'now-tracking',
    tone: 'neutral',
    title: 'Now tracking this price',
    detail: `${formatPrice(price)} recorded. Revisit this page and Spread will tell you whether it moved.`,
  };
}

function dayWord(days) {
  return days === 1 ? 'day' : 'days';
}

function round(n) {
  return Math.round(n * 100) / 100;
}
