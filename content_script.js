// content_script.js
// Runs in page context. Finds price-like nodes and injects True Price badges.

const TRUE_PRICE_ATTR = "data-trueprice-injected";

function findPriceNodes(root = document.body) {
  const nodes = [];
  // Strategy:
  // 1) Look for elements that contain $ and have reasonable length
  // 2) Also target common attributes/classes used by e-commerce sites
  const candidates = root.querySelectorAll("*:not(script):not(style):not(noscript)");
  for (const el of candidates) {
    if (el.hasAttribute(TRUE_PRICE_ATTR)) continue;
    // Limit to elements that have text content length < 80 to avoid paragraphs
    const text = el.textContent && el.textContent.trim();
    if (!text || text.length > 80) continue;
    if (text.includes("$") || /\d{1,3}(?:[,\.]\d{2})/.test(text)) {
      const parsed = parsePriceText(text);
      if (parsed !== null && parsed >= 0.01) {
        nodes.push({ el, parsed });
      }
    }
  }
  return nodes;
}

function injectBadge(el, basePrice) {
  // Avoid injecting multiple times
  if (el.hasAttribute(TRUE_PRICE_ATTR)) return;
  el.setAttribute(TRUE_PRICE_ATTR, "1");

  // Create wrapper div for badge
  const wrapper = document.createElement("span");
  wrapper.className = "trueprice-badge-wrapper";

  // Small loading state while we compute
  const badge = document.createElement("span");
  badge.className = "trueprice-badge";
  badge.textContent = "True: ...";
  wrapper.appendChild(badge);

  // Insert after the price element
  // If element is inline, append; else try placing inline-block after
  try {
    el.parentNode.insertBefore(wrapper, el.nextSibling);
  } catch (e) {
    // fallback
    el.appendChild(wrapper);
  }

  // Ask background/settings for defaults then compute
  chrome.storage.sync.get(
    { taxRate: 0.08875, defaultShipping: 0, taxOnShipping: true },
    (settings) => {
      const { taxRate, defaultShipping, taxOnShipping } = settings;
      // TODO: later call background service to find discounts; for MVP discount=0
      const { total, tax, shipping } = computeTruePrice({
        basePrice,
        shipping: defaultShipping,
        taxRate: taxRate,
        discount: 0,
        taxOnShipping
      });
      badge.textContent = `True: ${formatCurrency(total)}`;
      badge.title = `Base: ${formatCurrency(basePrice)}\nShipping: ${formatCurrency(shipping)}\nTax: ${formatCurrency(tax)}`;
      badge.dataset.truePriceValue = total;
    }
  );
}

// Run initial pass and set up a MutationObserver for dynamic content (SPAs)
function scanAndInject(root = document.body) {
  const nodes = findPriceNodes(root);
  for (const { el, parsed } of nodes) {
    injectBadge(el, parsed);
  }
}

// initial scan
scanAndInject(document.body);

// observe for DOM changes (debounced)
let scanTimeout;
const observer = new MutationObserver((mutations) => {
  if (scanTimeout) clearTimeout(scanTimeout);
  scanTimeout = setTimeout(() => {
    scanAndInject(document.body);
  }, 300);
});
observer.observe(document.body, { childList: true, subtree: true });
