// Content script entry point.
//
// Responsibilities: notice when the page is showing a product, put one button
// on it, and open the panel when that button is clicked. All network calls go
// through the service worker.

import { extractProduct, isProductPage } from './extractors/index.js';
import { openPanel, closePanel } from './modal.js';
import { formatPrice } from '../core/price.js';

const PILL_CLASS = 'spread-pill';

/** Product currently reflected by the injected button, so we can spot staleness. */
let injectedFor = null;
let lastUrl = location.href;

/** URLs already reported, so a settling SPA does not observe the same page twice. */
const observedUrls = new Set();

/** Most recent history summary, handed to the panel when it opens. */
let latestHistory = null;

/** Set when the user hides the pill; cleared on navigation to a new product. */
let dismissed = false;

init();

function init() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan, { once: true });
  } else {
    scan();
  }
  watchForNavigation();
}

/**
 * Retailer product pages are single-page apps: navigating between products
 * never reloads the document, so the old build left a stale button bound to
 * the previous product. Watch both the URL and the DOM.
 */
function watchForNavigation() {
  let pending;
  const schedule = () => {
    clearTimeout(pending);
    pending = setTimeout(scan, 400);
  };

  // URL changes without a reload (pushState / replaceState / popstate).
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function patched(...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event('spread:navigation'));
      return result;
    };
  }
  window.addEventListener('spread:navigation', schedule);
  window.addEventListener('popstate', schedule);

  // Late-rendered content (prices in particular) arrives well after load.
  // Only react to added nodes, and only while we have no button up.
  const observer = new MutationObserver((records) => {
    if (document.querySelector(`.${PILL_CLASS}`) && location.href === lastUrl) return;
    if (records.some((r) => r.addedNodes.length > 0)) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function scan() {
  const navigated = location.href !== lastUrl;
  if (navigated) {
    lastUrl = location.href;
    dismissed = false;
    latestHistory = null;
    removeButton();
    closePanel();
  }

  if (dismissed) return;

  if (!isProductPage()) {
    removeButton();
    return;
  }

  const product = extractProduct();
  if (!product) return;

  // Re-inject when the page has moved to a different product.
  if (injectedFor && injectedFor.url === product.url && document.querySelector(`.${PILL_CLASS}`)) {
    return;
  }

  removeButton();
  injectButton(product);
  observe(product);
}

/**
 * Report this page's price so it joins the product's history, and use whatever
 * comes back to say something useful on the button itself.
 *
 * Deliberately at most once per product per page: `scan` can fire several times
 * as a single-page app settles, and this is a network call.
 */
function observe(product) {
  if (observedUrls.has(product.url)) return;
  observedUrls.add(product.url);

  const { priceElement: _priceElement, ...payload } = product;

  try {
    chrome.runtime.sendMessage({ type: 'OBSERVE_PRODUCT', product: payload }, (response) => {
      // A failed observation is not worth surfacing -- the user did not ask for
      // it. Reading lastError marks it handled so Chrome stays quiet too.
      void chrome.runtime.lastError;
      if (response?.ok && response.history) {
        latestHistory = response.history;
        annotateButton(response.history);
      }
    });
  } catch {
    // The extension can be reloaded mid-page; nothing to do about it here.
  }
}


function injectButton(product) {
  // Fixed position, appended to body, deliberately not anchored to the price.
  //
  // Anchoring was the single most fragile thing in the extension: it put the
  // button inside a hidden container on Target and beside the shopping cart on
  // Best Buy, and retailer SPAs destroy injected nodes when they re-render. A
  // fixed element outside their tree has none of those failure modes, sits in
  // the same place on every retailer, and can show the answer without a click.
  if (document.querySelector(`.${PILL_CLASS}`)) return;

  const pill = document.createElement('div');
  pill.className = PILL_CLASS;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'spread-pill-main';
  button.setAttribute('aria-label', 'Open Spread price history for this product');

  const mark = document.createElement('span');
  mark.className = 'spread-pill-mark';
  mark.textContent = 'Spread';

  const label = document.createElement('span');
  label.className = 'spread-pill-label';
  label.textContent = 'Price history';

  button.append(mark, label);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Re-read at click time: prices update in place on every retailer.
    openPanel(extractProduct() || product, requestComparison, latestHistory);
  });

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'spread-pill-dismiss';
  dismiss.textContent = '\u00d7';
  dismiss.setAttribute('aria-label', 'Hide Spread on this page');
  dismiss.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    dismissed = true;
    removeButton();
  });

  pill.append(button, dismiss);
  document.body.appendChild(pill);
  injectedFor = product;
}

/** Put the current signal on the pill so it reads before anyone clicks. */
function annotateButton(history) {
  const label = document.querySelector(`.${PILL_CLASS} .spread-pill-label`);
  const pill = document.querySelector(`.${PILL_CLASS}`);
  if (!label || !history) return;

  if (history.isLowest && history.points > 1) {
    label.textContent = `Lowest in ${history.days}d`;
    pill?.classList.add('is-good');
  } else if (history.points > 1 && Number.isFinite(history.lowest) && history.lowest < history.current) {
    label.textContent = `Was ${formatPrice(history.lowest)}`;
  } else if (history.points > 1) {
    label.textContent = `Steady ${history.days}d`;
  }
}

function removeButton() {
  document.querySelectorAll(`.${PILL_CLASS}`).forEach((node) => node.remove());
  injectedFor = null;
}

/**
 * Hand the product to the service worker, which owns all network access.
 * @param {object} product
 */
function requestComparison(product) {
  // priceElement is a live DOM node and cannot cross the message boundary.
  const { priceElement: _priceElement, ...payload } = product;

  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'COMPARE_PRODUCT', product: payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: 'Extension was reloaded. Refresh the page and try again.' });
        return;
      }
      resolve(response);
    });
  });
}
