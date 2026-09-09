// Content script entry point.
//
// Responsibilities: notice when the page is showing a product, put one button
// on it, and open the panel when that button is clicked. All network calls go
// through the service worker.

import { extractProduct, isProductPage } from './extractors/index.js';
import { openPanel, closePanel } from './modal.js';

const BUTTON_CLASS = 'spread-trigger';

/** Product currently reflected by the injected button, so we can spot staleness. */
let injectedFor = null;
let lastUrl = location.href;

/** URLs already reported, so a settling SPA does not observe the same page twice. */
const observedUrls = new Set();

/** Most recent history summary, handed to the panel when it opens. */
let latestHistory = null;

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
    if (document.querySelector(`.${BUTTON_CLASS}`) && location.href === lastUrl) return;
    if (records.some((r) => r.addedNodes.length > 0)) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function scan() {
  const navigated = location.href !== lastUrl;
  if (navigated) {
    lastUrl = location.href;
    removeButton();
    closePanel();
  }

  if (!isProductPage()) {
    removeButton();
    return;
  }

  const product = extractProduct();
  if (!product) return;

  // Re-inject when the page has moved to a different product.
  if (injectedFor && injectedFor.url === product.url && document.querySelector(`.${BUTTON_CLASS}`)) {
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

/** Add a price-history signal to the button when there is one worth showing. */
function annotateButton(history) {
  const button = document.querySelector(`.${BUTTON_CLASS}`);
  if (!button || !history) return;

  if (history.isLowest && history.days >= 7) {
    button.textContent = `Compare price · lowest in ${history.days}d`;
  } else if (history.dropFromHighest > 0) {
    button.textContent = 'Compare price · price history';
  }
}

function injectButton(product) {
  const anchor = product.priceElement;
  if (!anchor || !anchor.isConnected) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = BUTTON_CLASS;
  button.textContent = 'Compare price';
  button.setAttribute('aria-label', 'Compare this price across other retailers');

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    // Re-read the page at click time: prices update in place on every retailer.
    openPanel(extractProduct() || product, requestComparison, latestHistory);
  });

  (anchor.parentElement || anchor).insertAdjacentElement('afterend', button);
  injectedFor = product;
}

function removeButton() {
  document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((node) => node.remove());
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
