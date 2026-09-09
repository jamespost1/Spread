// The comparison panel.
//
// Built entirely with DOM APIs. Every string here originates from a retailer
// API or a page title, so nothing is ever concatenated into innerHTML -- the
// old version stringified result sets into data- attributes and re-parsed
// them, which was both fragile and unnecessary.

import { formatPrice, priceDelta, bestSaving } from '../core/price.js';
import { isSafeHttpUrl } from '../core/retailers.js';

const PANEL_CLASS = 'spread-panel';
let activePanel = null;
let lastFocused = null;

/**
 * Open the panel and run a comparison.
 * @param {object} product
 * @param {(product: object) => Promise<object>} fetchComparison
 */
export function openPanel(product, fetchComparison) {
  closePanel();
  lastFocused = document.activeElement;

  const { overlay, body } = buildShell(product);
  document.body.appendChild(overlay);
  activePanel = overlay;

  renderLoading(body);
  overlay.querySelector('.spread-close')?.focus();

  fetchComparison(product)
    .then((response) => {
      if (activePanel !== overlay) return; // Closed while in flight.
      if (response?.ok) renderResults(body, product, response);
      else renderError(body, response?.error);
    })
    .catch(() => {
      if (activePanel === overlay) renderError(body);
    });
}

export function closePanel() {
  if (!activePanel) return;
  activePanel.remove();
  activePanel = null;
  document.removeEventListener('keydown', onKeydown, true);
  if (lastFocused instanceof HTMLElement) lastFocused.focus();
  lastFocused = null;
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    closePanel();
  }
}

function buildShell(product) {
  const overlay = el('div', PANEL_CLASS);
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Price comparison');

  const card = el('div', 'spread-card');

  const header = el('div', 'spread-header');
  const heading = el('div', 'spread-heading');
  heading.appendChild(el('span', 'spread-logo', 'Spread'));
  heading.appendChild(el('span', 'spread-subtitle', truncate(product.title, 70)));

  const close = el('button', 'spread-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', closePanel);

  header.append(heading, close);

  const body = el('div', 'spread-body');
  card.append(header, body);
  overlay.appendChild(card);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closePanel();
  });
  document.addEventListener('keydown', onKeydown, true);

  return { overlay, body };
}

function renderLoading(body) {
  body.replaceChildren();
  const wrap = el('div', 'spread-state');
  wrap.appendChild(el('div', 'spread-spinner'));
  wrap.appendChild(el('p', 'spread-state-text', 'Checking other retailers…'));
  body.appendChild(wrap);
}

function renderError(body, message) {
  body.replaceChildren();
  const wrap = el('div', 'spread-state');
  wrap.appendChild(el('p', 'spread-state-title', 'Could not compare right now'));
  wrap.appendChild(
    el('p', 'spread-state-text', message || 'Something went wrong reaching the comparison service.')
  );
  body.appendChild(wrap);
}

function renderResults(body, product, response) {
  body.replaceChildren();

  const offers = response.offers || [];
  const same = offers.filter((o) => o.match?.verdict === 'same');
  const similar = offers.filter((o) => o.match?.verdict === 'similar');

  body.appendChild(buildVerdict(product, same));

  if (same.length > 0) {
    body.appendChild(buildSection('Same product', buildOfferTable(product, same)));
  }
  if (similar.length > 0) {
    body.appendChild(buildSection('Worth considering', buildOfferTable(product, similar)));
  }
  if (offers.length === 0) {
    const empty = el('div', 'spread-state');
    empty.appendChild(el('p', 'spread-state-title', 'No other listings found'));
    empty.appendChild(
      el('p', 'spread-state-text', 'None of the retailers Spread can price are carrying this item.')
    );
    body.appendChild(empty);
  }

  body.appendChild(buildFooter(response));
}

/** The headline: the single number the user came for. */
function buildVerdict(product, sameOffers) {
  const wrap = el('div', 'spread-verdict');
  const saving = bestSaving(product.price, sameOffers);

  if (saving) {
    wrap.classList.add('is-saving');
    wrap.appendChild(el('div', 'spread-verdict-amount', `Save ${formatPrice(saving.savings)}`));
    wrap.appendChild(
      el(
        'div',
        'spread-verdict-detail',
        `${saving.best.retailer} has this for ${formatPrice(saving.best.price)}, versus ${formatPrice(product.price)} here.`
      )
    );
  } else if (sameOffers.length > 0) {
    wrap.appendChild(el('div', 'spread-verdict-amount', 'This is the best price'));
    wrap.appendChild(
      el(
        'div',
        'spread-verdict-detail',
        `Checked ${sameOffers.length} other listing${sameOffers.length === 1 ? '' : 's'}. Nothing cheaper.`
      )
    );
  } else {
    wrap.appendChild(el('div', 'spread-verdict-amount', 'No exact match found'));
    wrap.appendChild(
      el('div', 'spread-verdict-detail', 'Spread could not confirm this exact item elsewhere.')
    );
  }
  return wrap;
}

function buildSection(title, content) {
  const section = el('section', 'spread-section');
  section.appendChild(el('h3', 'spread-section-title', title));
  section.appendChild(content);
  return section;
}

function buildOfferTable(product, offers) {
  const list = el('ul', 'spread-offers');

  for (const offer of offers) {
    const item = el('li', 'spread-offer');

    const main = el('div', 'spread-offer-main');
    main.appendChild(el('span', 'spread-offer-retailer', offer.retailer || 'Retailer'));
    main.appendChild(el('span', 'spread-offer-title', truncate(offer.title, 80)));
    if (Number.isFinite(offer.shipping) && offer.shipping > 0) {
      main.appendChild(
        el('span', 'spread-offer-note', `includes ${formatPrice(offer.shipping)} shipping`)
      );
    }

    const right = el('div', 'spread-offer-right');
    right.appendChild(el('span', 'spread-offer-price', formatPrice(offer.price)));

    const delta = priceDelta(product.price, offer.price);
    if (delta && delta.direction !== 'same') {
      const label = `${delta.direction === 'cheaper' ? '−' : '+'}${formatPrice(Math.abs(delta.absolute)).replace('$', '$')}`;
      right.appendChild(el('span', `spread-offer-delta is-${delta.direction}`, label));
    }

    if (isSafeHttpUrl(offer.url)) {
      const link = el('a', 'spread-offer-link', 'View');
      link.href = offer.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      right.appendChild(link);
    }

    item.append(main, right);
    list.appendChild(item);
  }
  return list;
}

/** Quietly shows how the match was decided -- useful, and honest about the AI stage. */
function buildFooter(response) {
  const footer = el('div', 'spread-footer');
  const m = response.matching || {};

  const bits = [];
  if (response.cached) bits.push('cached result');
  if (m.adjudicated > 0) bits.push(`${m.adjudicated} AI-verified`);
  if (m.resolvedByHeuristics > 0) bits.push(`${m.resolvedByHeuristics} matched locally`);

  footer.appendChild(el('span', 'spread-footer-text', bits.join(' · ') || 'Prices from retailer APIs'));
  return footer;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function truncate(text, max) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
