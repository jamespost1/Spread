// content_script.js
// Runs in page context. Finds price-like nodes and injects True Price badges.

const TRUE_PRICE_ATTR = "data-trueprice-injected";

/* -----------------------------------------------------------
   1. Targeted selectors to reduce false positives
----------------------------------------------------------- */
const PRICE_SELECTORS = [
  ".price",
  ".a-price-whole",
  ".a-price .a-offscreen",
  "[data-price]",
  ".price-tag",
  ".product-price",
];

/* -----------------------------------------------------------
   2. Helper: extract structured, filtered price elements
----------------------------------------------------------- */
function findPriceNodes(root = document.body) {
  const nodes = [];

  // Pass 1: High-confidence selector-based matches
  const selectorMatches = root.querySelectorAll(PRICE_SELECTORS.join(","));
  for (const el of selectorMatches) {
    if (shouldSkip(el)) continue;

    const text = el.innerText.trim();
    const parsed = parsePriceText(text);
    if (parsed) {
      nodes.push({ el, parsed });
    }
  }

  // Pass 2: Backup fuzzy scan for sites without selectors
  const all = root.querySelectorAll("*:not(script):not(style):not(noscript)");
  for (const el of all) {
    if (shouldSkip(el)) continue;

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

/* -----------------------------------------------------------
   3. Filtering rules to avoid infinite loops + ugly placement
----------------------------------------------------------- */
function shouldSkip(el) {
  if (el.hasAttribute(TRUE_PRICE_ATTR)) return true;
  if (el.classList.contains("trueprice-badge-wrapper")) return true;
  if (el.classList.contains("trueprice-badge")) return true;

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return true;

  return false;
}

/* -----------------------------------------------------------
   4. Inject badge WITHOUT shifting layout
----------------------------------------------------------- */
function injectBadge(el, basePrice) {
  if (el.hasAttribute(TRUE_PRICE_ATTR)) return;
  el.setAttribute(TRUE_PRICE_ATTR, "1");

  // Wrap original element so badge doesn’t push content down
  const wrapper = document.createElement("span");
  wrapper.className = "trueprice-badge-wrapper";
  wrapper.style.position = "relative";
  wrapper.style.display = "inline-block";

  el.parentNode.insertBefore(wrapper, el);
  wrapper.appendChild(el);

  const badge = document.createElement("div");
  badge.className = "trueprice-badge";
  badge.textContent = "TruePrice: ...";
  badge.style.position = "absolute";
  badge.style.top = "-6px";
  badge.style.right = "-6px";
  badge.style.background = "#ff4d4d";
  badge.style.color = "white";
  badge.style.padding = "3px 6px";
  badge.style.fontSize = "11px";
  badge.style.borderRadius = "4px";
  badge.style.zIndex = "99999";
  badge.style.pointerEvents = "none";

  wrapper.appendChild(badge);

  // Load settings + compute true price
  chrome.storage.sync.get(
    { taxRate: 0.08875, defaultShipping: 0, taxOnShipping: true },
    (settings) => {
      const { taxRate, defaultShipping, taxOnShipping } = settings;

      const { total, tax, shipping } = computeTruePrice({
        basePrice,
        shipping: defaultShipping,
        taxRate: taxRate,
        discount: 0,
        taxOnShipping
      });

      badge.textContent = `TruePrice: ${formatCurrency(total)}`;
      badge.title = `Base: ${formatCurrency(basePrice)}\nShipping: ${formatCurrency(shipping)}\nTax: ${formatCurrency(tax)}`;
      badge.dataset.truePriceValue = total;
    }
  );
}

/* -----------------------------------------------------------
   5. Scan + Inject
----------------------------------------------------------- */
function scanAndInject(root = document.body) {
  const nodes = findPriceNodes(root);
  for (const { el, parsed } of nodes) {
    injectBadge(el, parsed);
  }
}

/* -----------------------------------------------------------
   6. Initial scan
----------------------------------------------------------- */
scanAndInject(document.body);

/* -----------------------------------------------------------
   7. Observe DOM changes (SPA support)
----------------------------------------------------------- */
let scanTimeout;
const observer = new MutationObserver(() => {
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(() => scanAndInject(document.body), 300);
});
observer.observe(document.body, { childList: true, subtree: true });
