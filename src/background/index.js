// Service worker: the extension's only network egress point.
//
// Content scripts run inside the retailer's page. Nothing with a credential or
// an outbound request belongs there, so the content script sends a message and
// this worker does the talking.

const DEFAULT_API_BASE = 'https://spread-api.workers.dev';

chrome.runtime.onInstalled.addListener(async (details) => {
  // A stable anonymous id, used only for server-side rate limiting. It is a
  // random UUID that identifies an install, never a person.
  const { installId } = await chrome.storage.local.get('installId');
  if (!installId) {
    await chrome.storage.local.set({ installId: crypto.randomUUID() });
  }
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('options.html?welcome=1') });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'COMPARE_PRODUCT') {
    compareProduct(message.product)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true; // Keep the channel open for the async reply.
  }

  if (message?.type === 'OBSERVE_PRODUCT') {
    observeProduct(message.product)
      .then(sendResponse)
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === 'GET_STATS') {
    chrome.storage.local.get(['stats']).then(({ stats }) => sendResponse(stats || emptyStats()));
    return true;
  }
  return false;
});

/**
 * Ask the Spread API which retailers carry this product and at what price.
 * @param {object} product
 * @returns {Promise<{ok: boolean, offers?: object[], error?: string}>}
 */
async function compareProduct(product) {
  const { apiBase, installId } = await chrome.storage.local.get(['apiBase', 'installId']);
  const endpoint = `${(apiBase || DEFAULT_API_BASE).replace(/\/+$/, '')}/v1/compare`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product, installId }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      return { ok: false, error: errorMessageFor(response.status, detail) };
    }

    const data = await response.json();
    await recordStats(product, data);
    return { ok: true, ...data };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, error: 'The comparison timed out. Try again in a moment.' };
    }
    return { ok: false, error: 'Could not reach the Spread service.' };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Report the price on a page the user opened, and get back that product's price
 * history.
 *
 * Runs on product page views rather than on click, so it is deliberately quiet:
 * a short timeout, and every failure resolves rather than rejects. Nothing about
 * this call should ever be visible to someone who is just browsing.
 *
 * @param {object} product
 * @returns {Promise<{ok: boolean, history?: object}>}
 */
async function observeProduct(product) {
  const { apiBase, installId } = await chrome.storage.local.get(['apiBase', 'installId']);
  const endpoint = `${(apiBase || DEFAULT_API_BASE).replace(/\/+$/, '')}/v1/observe`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product, installId }),
      signal: controller.signal,
    });

    if (!response.ok) return { ok: false };

    const data = await response.json();
    return { ok: true, history: data.history || null };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

function errorMessageFor(status, detail) {
  if (status === 429) return 'Too many comparisons in a short window. Try again shortly.';
  if (status === 400) return 'This page could not be read as a product.';
  return `Comparison service error (${status}${detail?.error ? `: ${detail.error}` : ''}).`;
}

/**
 * Track lifetime savings found, for the popup. Stored locally, never uploaded.
 */
async function recordStats(product, data) {
  const { stats } = await chrome.storage.local.get('stats');
  const current = stats || emptyStats();

  const cheapest = (data.offers || [])
    .filter((o) => o.match?.verdict === 'same' && Number.isFinite(o.price))
    .sort((a, b) => a.price - b.price)[0];

  current.comparisons += 1;
  if (cheapest && Number.isFinite(product.price) && cheapest.price < product.price) {
    current.savingsFound += Math.round((product.price - cheapest.price) * 100) / 100;
    current.betterPricesFound += 1;
  }
  current.updatedAt = Date.now();

  await chrome.storage.local.set({ stats: current });
}

function emptyStats() {
  return { comparisons: 0, betterPricesFound: 0, savingsFound: 0, updatedAt: null };
}
