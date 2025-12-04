// content_script.js
const TRUE_PRICE_ATTR = "data-trueprice-injected";
const PRICE_SELECTORS = [
  ".price",
  ".a-price-whole",
  ".a-price .a-offscreen",
  "[data-price]",
  ".price-tag",
  ".product-price",
  ".pricing",
  ".amount",
];

function findPriceNodes(root = document.body) {
  const nodes = [];
  const candidates = root.querySelectorAll(PRICE_SELECTORS.join(","));

  for (const el of candidates) {
    if (!el.isConnected) continue;
    if (el.classList.contains("trueprice-badge")) continue;
    if (el.hasAttribute(TRUE_PRICE_ATTR)) continue;

    const text = el.innerText.trim();
    if (!text.includes("$")) continue;
    if ((text.match(/\$/g) || []).length > 1) continue;

    const parsed = parsePriceText(text);
    if (parsed !== null && parsed >= 0.01) {
      nodes.push({ el, parsed });
    }
  }

  return nodes;
}

function injectBadge(el, basePrice) {
  try {
    if (!el.isConnected) return;
    if (el.hasAttribute(TRUE_PRICE_ATTR)) {
      return;
    }
    el.setAttribute(TRUE_PRICE_ATTR, "1");

    const badge = document.createElement("span");
    badge.className = "trueprice-badge";
    badge.textContent = " (TruePrice: …) ";
    badge.style.marginLeft = "6px";
    badge.style.whiteSpace = "nowrap";
    badge.style.fontSize = "0.9em";
    badge.style.color = "#555";
    badge.style.fontWeight = "normal";

    el.insertAdjacentElement("afterend", badge);

    chrome.storage.sync.get(
      { taxRate: 0.08875, defaultShipping: 0, taxOnShipping: true },
      (settings) => {
        try {
          if (!badge.isConnected) return;
          const { total, tax, shipping } = computeTruePrice({
            basePrice,
            shipping: settings.defaultShipping,
            taxRate: settings.taxRate,
            discount: 0,
            taxOnShipping: settings.taxOnShipping
          });
          badge.textContent = ` (TruePrice: ${formatCurrency(total)})`;
          badge.title =
            `Base: ${formatCurrency(basePrice)}\n` +
            `Shipping: ${formatCurrency(shipping)}\n` +
            `Tax: ${formatCurrency(tax)}`;
        } catch (_) {}
      }
    );
  } catch (_) {
    console.warn("Skipped badge injection due to context invalidation");
  }
}

function scanAndInject(root = document.body) {
  const nodes = findPriceNodes(root);
  for (const { el, parsed } of nodes) {
    injectBadge(el, parsed);
  }
}

// initial scan
scanAndInject(document.body);

// observe DOM changes
let scanTimeout;
const observer = new MutationObserver(() => {
  clearTimeout(scanTimeout);
  scanTimeout = setTimeout(() => scanAndInject(document.body), 300);
});
observer.observe(document.body, { childList: true, subtree: true });
