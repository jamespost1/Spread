// Toolbar popup: lifetime savings, and whether Spread is active on this tab.

import { formatPrice } from '../core/price.js';
import { sourceRetailerFor } from '../core/retailers.js';

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('version').textContent = `v${chrome.runtime.getManifest().version}`;

  document.getElementById('options-link').addEventListener('click', (event) => {
    event.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  await Promise.all([renderStats(), renderTabStatus()]);
});

async function renderStats() {
  const { stats } = await chrome.storage.local.get('stats');
  const s = stats || { comparisons: 0, betterPricesFound: 0, savingsFound: 0 };

  document.getElementById('savings').textContent = formatPrice(s.savingsFound || 0);
  document.getElementById('comparisons').textContent = String(s.comparisons || 0);
  document.getElementById('wins').textContent = String(s.betterPricesFound || 0);
}

async function renderTabStatus() {
  const status = document.getElementById('status');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url) {
    status.textContent = 'Open a product page to compare prices.';
    return;
  }

  const retailer = sourceRetailerFor(tab.url);
  if (retailer) {
    status.textContent = `Active on ${retailer}.`;
    status.classList.add('is-active');
  } else {
    status.textContent = 'Not a supported retailer.';
  }
}
