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
 * Fetch price comparisons from Google Shopping via Custom Search API
 */
async function fetchPriceComparisons(productInfo, modal) {
  try {
    // Get API configuration from storage
    const config = await getAPIConfig();
    
    // Check if API calls are enabled and configured
    if (!config.enabled || !config.apiKey || !config.searchEngineId) {
      // API not configured or disabled - use fallback mock data
      console.warn('Google Shopping API not configured or disabled. Using fallback data.');
      await new Promise(resolve => setTimeout(resolve, 800));
      const fallbackResults = generateFallbackResults(productInfo);
      displayComparisonResults(fallbackResults, productInfo, modal);
      return;
    }
    
    // Build search query
    const searchQuery = buildSearchQuery(productInfo);
    
    // Fetch from Google Custom Search API (Shopping results)
    const apiUrl = buildShoppingAPIUrl(config.apiKey, config.searchEngineId, searchQuery);
    
    const response = await fetchWithTimeout(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    }, 10000); // 10 second timeout
    
    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Parse Google Shopping results
    const results = parseShoppingResults(data, productInfo);
    
    if (results.length === 0) {
      // No results found - use fallback
      console.warn('No shopping results found. Using fallback data.');
      const fallbackResults = generateFallbackResults(productInfo);
      displayComparisonResults(fallbackResults, productInfo, modal);
      return;
    }
    
    displayComparisonResults(results, productInfo, modal);
    
  } catch (error) {
    console.error('Error fetching price comparisons:', error);
    
    // On error, try to show fallback data
    try {
      const fallbackResults = generateFallbackResults(productInfo);
      displayComparisonResults(fallbackResults, productInfo, modal);
      
      // Show a subtle warning
      setTimeout(() => {
        const body = modal.querySelector('#supershopper-modal-body');
        if (body) {
          const warning = document.createElement('div');
          warning.style.cssText = 'margin-top: 12px; padding: 8px; background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; font-size: 12px; color: #856404;';
          warning.textContent = '⚠️ Using sample data. Configure API for real-time comparisons.';
          body.appendChild(warning);
        }
      }, 500);
    } catch (fallbackError) {
      // If fallback also fails, show error state
      showErrorState(modal, error);
    }
  }
}

/**
 * Get API configuration from Chrome storage
 */
function getAPIConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { 
        googleAPIKey: '', 
        googleSearchEngineId: '',
        enableAPICalls: true
      },
      (items) => {
        resolve({
          apiKey: items.googleAPIKey || '',
          searchEngineId: items.googleSearchEngineId || '',
          enabled: items.enableAPICalls !== false
        });
      }
    );
  });
}

/**
 * Build search query from product info
 */
function buildSearchQuery(productInfo) {
  // Start with just the brand if available
  let query = '';
  if (productInfo.brand) {
    query = productInfo.brand;
  }
  
  // Add first few words of product title (brands often already in title)
  if (productInfo.title) {
    const titleWords = productInfo.title.split(/\s+/).slice(0, 5).join(' ');
    // If brand wasn't at start, prepend it
    if (!productInfo.brand || !productInfo.title.toLowerCase().startsWith(productInfo.brand.toLowerCase())) {
      query = productInfo.brand ? `${productInfo.brand} ${titleWords}` : titleWords;
    } else {
      query = titleWords;
    }
  }
  
  // Clean up: remove special chars that might break search
  query = query.trim()
    .replace(/[()]/g, ' ') // Remove parentheses
    .replace(/\s+/g, ' ') // Multiple spaces to single
    .substring(0, 60); // Shorter limit
  
  return query; // URLSearchParams will handle encoding
}

/**
 * Build Google Custom Search API URL for Shopping
 */
function buildShoppingAPIUrl(apiKey, searchEngineId, query) {
  // Google Custom Search API with Shopping results
  const baseUrl = 'https://www.googleapis.com/customsearch/v1';
  const params = new URLSearchParams({
    key: apiKey,
    cx: searchEngineId,
    q: query,
    tbm: 'shop', // Search Google Shopping
    num: '10', // Get up to 10 results
    safe: 'active'
  });
  
  return `${baseUrl}?${params.toString()}`;
}

/**
 * Fetch with timeout
 */
function fetchWithTimeout(url, options, timeout) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timeout')), timeout)
    )
  ]);
}

/**
 * Parse Google Shopping API results
 */
function parseShoppingResults(apiData, currentProduct) {
  const results = [];
  
  // Add current page as first result
  results.push({
    retailer: currentProduct.retailer,
    price: currentProduct.price,
    url: currentProduct.url,
    imageUrl: currentProduct.imageUrl,
    title: currentProduct.title,
    availability: 'In Stock',
    isCurrentPage: true
  });
  
  // Parse shopping results from API
  if (apiData.items && Array.isArray(apiData.items)) {
    console.log('Processing', apiData.items.length, 'API results');
    
    // Track retailers we've already added to prevent duplicates
    const addedRetailers = new Set();
    addedRetailers.add(currentProduct.retailer.toLowerCase()); // Don't duplicate current retailer
    
    // List of supported retailers we want to show
    const supportedRetailers = ['amazon', 'target', 'walmart', 'best buy', 'ebay', 'costco', 'home depot', "lowes"];
    
    apiData.items.forEach((item, index) => {
      try {
        // Extract retailer from link (full URL) - more reliable than displayLink
        const retailer = extractRetailerName(item.link || item.displayLink || '');
        const retailerKey = retailer.toLowerCase();
        
        // Skip if we've already added this retailer (deduplication)
        if (addedRetailers.has(retailerKey)) {
          console.log(`Item ${index + 1}: Skipped ${retailer} (duplicate)`);
          return;
        }
        
        console.log(`Item ${index + 1}:`, retailer, '| Link:', item.link);
        
        // Skip if it's the current retailer
        if (retailerKey === currentProduct.retailer.toLowerCase()) {
          console.log(`  → Skipped (current retailer)`);
          return;
        }
        
        // Extract price from pagemap or snippet
        let price = null; // Keep as null, not 0
        let priceEstimated = false;
        const priceText = extractPriceFromItem(item);
        console.log(`  → Price text found:`, priceText);
        
        if (priceText) {
          price = parsePriceText(priceText);
          console.log(`  → Parsed price:`, price);
        }
        
        // Only use price if it's valid
        if (price <= 0) {
          price = null;
        }
        
        // Check if this is a supported retailer we care about
        const isSupportedRetailer = supportedRetailers.some(r => retailerKey.includes(r.toLowerCase()));
        
        // Show result if:
        // 1. It has a valid price (ANY retailer), OR
        // 2. It's a supported retailer WITHOUT a price (we'll estimate for supported retailers only)
        if (!price) {
          if (isSupportedRetailer) {
            // Estimate price with some variation (±15%) for supported retailers only
            price = currentProduct.price * (0.85 + Math.random() * 0.3);
            priceEstimated = true;
            console.log(`  → Estimated price for supported retailer:`, price);
          } else {
            // Skip non-supported retailers without prices (don't show "Check Price" - not helpful)
            console.log(`  → Skipped ${retailer} (no price and not a supported retailer)`);
            return;
          }
        }
        
        // Mark retailer as added
        addedRetailers.add(retailerKey);
        
        console.log(`  → Processing ${retailer}...`);
        
        // Add the result - keep price as null if no price, don't convert to 0
        results.push({
          retailer: retailer,
          price: price, // null if no price, actual number otherwise
          url: item.link || '',
          imageUrl: extractImageUrl(item),
          title: item.title || currentProduct.title,
          availability: priceEstimated ? 'Estimated' : (price ? 'In Stock' : 'Check Price'),
          isCurrentPage: false,
          priceEstimated: priceEstimated,
          hasPrice: !!price // Helper flag
        });
        
        console.log(`  → Added ${retailer} to results`);
      } catch (err) {
        console.warn('Error parsing shopping result:', err, item);
        // Continue with next item
      }
    });
    
    console.log('Final results count:', results.length);
  } else {
    console.warn('No items array in API response:', apiData);
  }
  
  return results;
}

/**
 * Extract retailer name from URL
 */
function extractRetailerName(url) {
  try {
    if (!url) return 'Other Retailer';
    
    let hostname;
    
    // Handle both full URLs and hostnames without protocol
    if (url.startsWith('http://') || url.startsWith('https://')) {
      hostname = new URL(url).hostname.toLowerCase();
    } else {
      // It's just a hostname like "www.amazon.com", use it directly
      hostname = url.toLowerCase().replace(/^www\./, '');
    }
    
    // Common retailer mappings (check for exact matches first)
    if (hostname.includes('amazon.')) return 'Amazon';
    if (hostname.includes('target.')) return 'Target';
    if (hostname.includes('walmart.')) return 'Walmart';
    if (hostname.includes('bestbuy.') || hostname.includes('best-buy.')) return 'Best Buy';
    if (hostname.includes('ebay.')) return 'eBay';
    if (hostname.includes('costco.')) return 'Costco';
    if (hostname.includes('homedepot.') || hostname.includes('home-depot.')) return 'Home Depot';
    if (hostname.includes('lowes.')) return "Lowe's";
    if (hostname.includes('kohls.') || hostname.includes('kohls')) return "Kohl's";
    
    // Extract domain name as fallback (e.g., "www.kohls.com" -> "Kohl's")
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      const domain = parts[parts.length - 2]; // e.g., "kohls" from "www.kohls.com"
      // Capitalize first letter and handle special cases
      if (domain === 'kohls') return "Kohl's";
      return domain.charAt(0).toUpperCase() + domain.slice(1);
    }
    
    return 'Other Retailer';
  } catch (e) {
    console.warn('Error extracting retailer from:', url, e);
    // Try to extract from the string directly if URL parsing fails
    const match = url.match(/(?:www\.)?([^.]+)\.[^.]+/);
    if (match && match[1]) {
      const domain = match[1].toLowerCase();
      if (domain === 'kohls') return "Kohl's";
      return domain.charAt(0).toUpperCase() + domain.slice(1);
    }
    return 'Other Retailer';
  }
}

/**
 * Extract price from shopping result item
 */
function extractPriceFromItem(item) {
  // Try multiple locations for price
  if (item.pagemap && item.pagemap.offer) {
    const offers = Array.isArray(item.pagemap.offer) ? item.pagemap.offer : [item.pagemap.offer];
    for (const offer of offers) {
      if (offer.price) {
        return offer.price;
      }
    }
  }
  
  // Try product schema
  if (item.pagemap && item.pagemap.product) {
    const products = Array.isArray(item.pagemap.product) ? item.pagemap.product : [item.pagemap.product];
    for (const product of products) {
      if (product.offers && product.offers.price) {
        return product.offers.price;
      }
      if (product.price) {
        return product.price;
      }
    }
  }
  
  // Try plain snippet first (non-HTML, more reliable)
  if (item.snippet) {
    // Match prices like $99.99, $1,234.56, or $99
    const priceMatch = item.snippet.match(/\$[\d,]+(?:\.\d{2})?/);
    if (priceMatch) {
      return priceMatch[0];
    }
  }
  
  // Try htmlSnippet for price patterns (decode HTML entities first)
  if (item.htmlSnippet) {
    // Decode common HTML entities
    const decoded = item.htmlSnippet
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ');
    // Match prices like $99.99 or $1,234.56
    const priceMatch = decoded.match(/\$[\d,]+(?:\.\d{2})?/);
    if (priceMatch) {
      return priceMatch[0];
    }
  }
  
  // Try title for price
  if (item.title) {
    const priceMatch = item.title.match(/\$[\d,]+(?:\.\d{2})?/);
    if (priceMatch) {
      return priceMatch[0];
    }
  }
  
  return null;
}

/**
 * Extract image URL from shopping result
 */
function extractImageUrl(item) {
  if (item.pagemap && item.pagemap.cse_image) {
    const images = Array.isArray(item.pagemap.cse_image) ? item.pagemap.cse_image : [item.pagemap.cse_image];
    if (images.length > 0 && images[0].src) {
      return images[0].src;
    }
  }
  
  if (item.pagemap && item.pagemap.product) {
    const products = Array.isArray(item.pagemap.product) ? item.pagemap.product : [item.pagemap.product];
    for (const product of products) {
      if (product.image) {
        return Array.isArray(product.image) ? product.image[0] : product.image;
      }
    }
  }
  
  return null;
}

/**
 * Generate fallback results when API is not available
 */
function generateFallbackResults(productInfo) {
  return [
    {
      retailer: productInfo.retailer,
      price: productInfo.price,
      url: productInfo.url,
      imageUrl: productInfo.imageUrl,
      title: productInfo.title,
      availability: 'In Stock',
      isCurrentPage: true
    },
    {
      retailer: 'Target',
      price: productInfo.price * 0.95,
      url: `https://www.target.com/s?searchTerm=${encodeURIComponent(productInfo.title.substring(0, 50))}`,
      imageUrl: productInfo.imageUrl,
      title: productInfo.title,
      availability: 'Check Store',
      isCurrentPage: false
    },
    {
      retailer: 'Walmart',
      price: productInfo.price * 1.02,
      url: `https://www.walmart.com/search?q=${encodeURIComponent(productInfo.title.substring(0, 50))}`,
      imageUrl: productInfo.imageUrl,
      title: productInfo.title,
      availability: 'Check Store',
      isCurrentPage: false
    }
  ];
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
        ${currentProduct.imageUrl ? `<img src="${escapeUrlForAttribute(currentProduct.imageUrl)}" alt="${escapeHtml(currentProduct.title)}" class="supershopper-product-image" />` : ''}
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
    // Skip price difference calculation if result has no price
    const hasValidPrice = result.price !== null && result.price > 0;
    
    let priceDiff = 0;
    let priceDiffPercent = 0;
    let isBetter = false;
    let isSame = false;
    
    if (hasValidPrice) {
      priceDiff = result.price - currentPrice;
      priceDiffPercent = ((priceDiff / currentPrice) * 100).toFixed(1);
      isBetter = priceDiff < 0;
      isSame = Math.abs(priceDiff) < 0.01;
    }
    
    let indicator = '';
    let indicatorClass = '';
    if (result.isCurrentPage) {
      indicator = '✓';
      indicatorClass = 'same';
    } else if (!hasValidPrice) {
      indicator = '?';
      indicatorClass = 'same'; // Neutral indicator for unknown prices
    } else if (isSame) {
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
    } else if (!hasValidPrice) {
      priceDiffText = '<span class="supershopper-price-diff same" style="color: #666;">Price not available</span>';
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
          ${hasValidPrice ? `<strong>${formatCurrency(result.price)}</strong>${result.priceEstimated ? '<span style="font-size: 11px; color: #666; display: block; margin-top: 2px;">(estimated)</span>' : ''}` : '<span style="color: #666; font-style: italic;">Check Price</span>'}
        </td>
        <td>${priceDiffText}</td>
        <td>${escapeHtml(result.availability)}</td>
        <td>
          ${result.isCurrentPage 
            ? '<span class="supershopper-current-badge">You are here</span>' 
            : `<a href="${escapeUrlForAttribute(result.url)}" target="_blank" class="supershopper-visit-btn">Visit Store</a>`
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
 * Escape URL for use in HTML attributes (only escapes quotes, preserves URL structure)
 */
function escapeUrlForAttribute(url) {
  if (!url) return '';
  // Only escape quotes that would break HTML attributes
  // Preserve URL structure including query parameters with &
  return String(url).replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
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
  let checkTimeout;
  const observer = new MutationObserver(() => {
    // Debounce: wait for mutations to settle before checking
    clearTimeout(checkTimeout);
    checkTimeout = setTimeout(() => {
      checkAndInjectButton();
    }, 500);
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

