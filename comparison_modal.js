// comparison_modal.js
// Price comparison modal UI and logic

/**
 * Create and inject the Compare Prices button next to the product price
 */
function injectCompareButton(productInfo) {
  if (!productInfo || !productInfo.priceElement) return;
  
  // Check if button already exists
  const existingButton = document.querySelector('.supershopper-compare-btn');
  if (existingButton) return;
  
  try {
    const button = document.createElement('button');
    button.className = 'supershopper-compare-btn';
    button.textContent = 'Compare Prices';
    button.setAttribute('data-supershopper-injected', '1');
    
    // Add click handler
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openComparisonModal(productInfo);
    });
    
    // Insert button next to price element
    const priceContainer = productInfo.priceElement.parentElement;
    if (priceContainer) {
      // Try to insert after the price container
      priceContainer.insertAdjacentElement('afterend', button);
    } else {
      // Fallback: insert after price element itself
      productInfo.priceElement.insertAdjacentElement('afterend', button);
    }
  } catch (error) {
    console.warn('Error injecting compare button:', error);
  }
}

/**
 * Open the comparison modal and fetch price comparisons
 */
function openComparisonModal(productInfo) {
  // Close existing modal if open
  closeComparisonModal();
  
  // Create modal
  const modal = createModal(productInfo);
  document.body.appendChild(modal);
  
  // Show loading state
  showLoadingState(modal);
  
  // Fetch price comparisons (will integrate Google Shopping API later)
  fetchPriceComparisons(productInfo, modal);
  
  // Add escape key handler
  const escapeHandler = (e) => {
    if (e.key === 'Escape') {
      closeComparisonModal();
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);
}

/**
 * Create the modal HTML structure
 */
function createModal(productInfo) {
  const modal = document.createElement('div');
  modal.className = 'supershopper-modal-overlay';
  modal.setAttribute('data-supershopper-modal', '1');
  
  const modalContent = document.createElement('div');
  modalContent.className = 'supershopper-modal-content';
  
  // Modal header
  const header = document.createElement('div');
  header.className = 'supershopper-modal-header';
  
  const title = document.createElement('h2');
  title.className = 'supershopper-modal-title';
  title.textContent = 'Price Comparison';
  
  const closeBtn = document.createElement('button');
  closeBtn.className = 'supershopper-modal-close';
  closeBtn.innerHTML = '&times;';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', closeComparisonModal);
  
  header.appendChild(title);
  header.appendChild(closeBtn);
  
  // Modal body (content will be injected here)
  const body = document.createElement('div');
  body.className = 'supershopper-modal-body';
  body.id = 'supershopper-modal-body';
  
  // Close modal when clicking overlay
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeComparisonModal();
    }
  });
  
  modalContent.appendChild(header);
  modalContent.appendChild(body);
  modal.appendChild(modalContent);
  
  return modal;
}

/**
 * Show loading state in modal
 */
function showLoadingState(modal) {
  const body = modal.querySelector('#supershopper-modal-body');
  if (!body) return;
  
  body.innerHTML = `
    <div class="supershopper-loading">
      <div class="supershopper-spinner"></div>
      <p>Searching for price comparisons...</p>
    </div>
  `;
}

/**
 * Fetch price comparisons from Google Shopping API (placeholder for now)
 */
async function fetchPriceComparisons(productInfo, modal) {
  try {
    // TODO: Integrate Google Shopping API here
    // For now, show mock data structure
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Mock comparison results for testing
    const mockResults = [
      {
        retailer: 'Amazon',
        price: productInfo.price,
        url: productInfo.url,
        imageUrl: productInfo.imageUrl,
        title: productInfo.title,
        availability: 'In Stock',
        isCurrentPage: true
      },
      {
        retailer: 'Target',
        price: productInfo.price * 0.95, // Example: 5% cheaper
        url: 'https://target.com/product',
        imageUrl: productInfo.imageUrl,
        title: productInfo.title,
        availability: 'In Stock',
        isCurrentPage: false
      },
      {
        retailer: 'Walmart',
        price: productInfo.price * 1.08, // Example: 8% more expensive
        url: 'https://walmart.com/product',
        imageUrl: productInfo.imageUrl,
        title: productInfo.title,
        availability: 'In Stock',
        isCurrentPage: false
      }
    ];
    
    displayComparisonResults(mockResults, productInfo, modal);
  } catch (error) {
    showErrorState(modal, error);
  }
}

/**
 * Display comparison results in the modal
 */
function displayComparisonResults(results, currentProduct, modal) {
  const body = modal.querySelector('#supershopper-modal-body');
  if (!body) return;
  
  // Sort results by price (cheapest first)
  const sortedResults = [...results].sort((a, b) => a.price - b.price);
  const currentPrice = currentProduct.price;
  
  // Create comparison table
  let html = `
    <div class="supershopper-comparison-container">
      <div class="supershopper-product-header">
        <h3 class="supershopper-product-title">${escapeHtml(currentProduct.title)}</h3>
        ${currentProduct.imageUrl ? `<img src="${escapeHtml(currentProduct.imageUrl)}" alt="${escapeHtml(currentProduct.title)}" class="supershopper-product-image" />` : ''}
      </div>
      <table class="supershopper-comparison-table">
        <thead>
          <tr>
            <th>Retailer</th>
            <th>Price</th>
            <th>Difference</th>
            <th>Availability</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  sortedResults.forEach(result => {
    const priceDiff = result.price - currentPrice;
    const priceDiffPercent = ((priceDiff / currentPrice) * 100).toFixed(1);
    const isBetter = priceDiff < 0;
    const isSame = Math.abs(priceDiff) < 0.01;
    
    let indicator = '';
    let indicatorClass = '';
    if (isSame || result.isCurrentPage) {
      indicator = '✓';
      indicatorClass = 'same';
    } else if (isBetter) {
      indicator = '↓';
      indicatorClass = 'better';
    } else {
      indicator = '↑';
      indicatorClass = 'worse';
    }
    
    let priceDiffText = '';
    if (result.isCurrentPage) {
      priceDiffText = '<span class="supershopper-current-badge">Current Page</span>';
    } else if (isSame) {
      priceDiffText = '<span class="supershopper-price-diff same">Same price</span>';
    } else {
      const diffFormatted = formatCurrency(Math.abs(priceDiff));
      const percentText = Math.abs(priceDiffPercent) + '%';
      const betterWorse = isBetter ? 'cheaper' : 'more expensive';
      priceDiffText = `<span class="supershopper-price-diff ${indicatorClass}">${isBetter ? '-' : '+'}${diffFormatted} (${percentText} ${betterWorse})</span>`;
    }
    
    html += `
      <tr class="${result.isCurrentPage ? 'supershopper-current-row' : ''}">
        <td>
          <div class="supershopper-retailer-cell">
            <span class="supershopper-price-indicator ${indicatorClass}">${indicator}</span>
            <strong>${escapeHtml(result.retailer)}</strong>
          </div>
        </td>
        <td class="supershopper-price-cell">
          <strong>${formatCurrency(result.price)}</strong>
        </td>
        <td>${priceDiffText}</td>
        <td>${escapeHtml(result.availability)}</td>
        <td>
          ${result.isCurrentPage 
            ? '<span class="supershopper-current-badge">You are here</span>' 
            : `<a href="${escapeHtml(result.url)}" target="_blank" class="supershopper-visit-btn">Visit Store</a>`
          }
        </td>
      </tr>
    `;
  });
  
  html += `
        </tbody>
      </table>
    </div>
  `;
  
  body.innerHTML = html;
  
  // Add smooth scroll to top
  body.scrollTop = 0;
}

/**
 * Show error state in modal
 */
function showErrorState(modal, error) {
  const body = modal.querySelector('#supershopper-modal-body');
  if (!body) return;
  
  body.innerHTML = `
    <div class="supershopper-error">
      <p>⚠️ Unable to fetch price comparisons at this time.</p>
      <p class="supershopper-error-detail">${escapeHtml(error.message || 'Please try again later.')}</p>
      <button class="supershopper-retry-btn">Retry</button>
    </div>
  `;
  
  // Add event listener for retry button (CSP compliant - no inline onclick)
  const retryBtn = body.querySelector('.supershopper-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      location.reload();
    });
  }
}

/**
 * Close the comparison modal
 */
function closeComparisonModal() {
  const modal = document.querySelector('.supershopper-modal-overlay');
  if (modal) {
    modal.classList.add('supershopper-modal-closing');
    setTimeout(() => {
      if (modal.parentElement) {
        modal.remove();
      }
    }, 200); // Match CSS transition duration
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Initialize comparison functionality for product pages
 */
function initComparisonFeature() {
  // Wait for page to load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      checkAndInjectButton();
    });
  } else {
    checkAndInjectButton();
  }
  
  // Also check when DOM changes (for dynamic pages)
  const observer = new MutationObserver(() => {
    checkAndInjectButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/**
 * Check if we're on a product page and inject the compare button
 */
function checkAndInjectButton() {
  // Only run on supported retailers
  const hostname = window.location.hostname.toLowerCase();
  if (!hostname.includes('amazon.') && 
      !hostname.includes('target.') && 
      !hostname.includes('walmart.')) {
    return;
  }
  
  // Check if already injected
  if (document.querySelector('.supershopper-compare-btn')) {
    return;
  }
  
  // Extract product info
  const productInfo = extractProductInfo();
  if (productInfo && productInfo.priceElement) {
    injectCompareButton(productInfo);
  }
}

// Auto-initialize when script loads
initComparisonFeature();

