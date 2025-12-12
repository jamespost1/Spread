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
  
  // Append "buy" to get commerce-focused results (not reviews/info pages)
  return `${query} buy`; 
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
    // tbm: 'shop', // REMOVED: Use regular web search for better metadata/snippets
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
    // Added major brands and category-specific stores
    const supportedRetailers = [
      'amazon', 'target', 'walmart', 'best buy', 'ebay', 'costco', 'home depot', "lowes",
      'jbl', 'nike', 'apple', 'samsung', 'sony', 'dell', 'hp', 'microsoft', 'lego', 'wayfair',
      'chewy', 'gamestop', 'newegg', 'b&h', 'staples', 'office depot', 'kohls', 'macys'
    ];
    
    apiData.items.forEach((item, index) => {
      try {
        // Filter out non-commerce domains (.org, .edu, .gov, etc.)
        // Also filter out non-US country-specific domains and subdomains
        const url = (item.link || item.displayLink || '').toLowerCase();
        if (url.includes('.org/') || url.includes('.edu/') || url.includes('.gov/') || 
            url.includes('.org') && !url.includes('search')) { // stricter .org check
           console.log(`Item ${index + 1}: Skipped ${url} (non-commerce domain)`);
           return;
        }
        
        // Filter out non-US country-specific domains (e.g., .com.ph, .com.au, .co.uk, .ca)
        // Also check for country subdomains (e.g., amazon.co.uk, amazon.com.au)
        const nonUSDomains = [
          '.com.ph', '.com.au', '.co.uk', '.com.br', '.com.mx', '.ca', '.co.jp', '.fr', '.de',
          '.it', '.es', '.nl', '.com.sg', '.com.hk', '.co.in', '.com.tr', '.com.ar',
          '.co.za', '.com.tw', '.com.cn', '.ae', '.sa'
        ];
        const isNonUSDomain = nonUSDomains.some(domain => url.includes(domain));
        if (isNonUSDomain) {
          console.log(`Item ${index + 1}: Skipped ${url} (non-US domain)`);
          return;
        }
        
        // Also check for country-specific hostnames (e.g., amazon.co.uk, walmart.ca)
        const hostname = url.match(/https?:\/\/([^/]+)/)?.[1] || '';
        if (hostname && (hostname.endsWith('.co.uk') || hostname.endsWith('.com.au') || 
            hostname.endsWith('.com.ph') || hostname.endsWith('.ca') || 
            hostname.match(/\.(ph|au|uk|br|mx|jp|fr|de|it|es|nl|sg|hk|in|tr|ar|za|tw|cn|ae|sa)$/))) {
          console.log(`Item ${index + 1}: Skipped ${url} (non-US country domain)`);
          return;
        }
        
        // Filter out non-retailer sites (social media, forums, Wikipedia, etc.)
        const nonRetailerDomains = [
          'reddit.com', 'redd.it',
          'facebook.com', 'fb.com',
          'twitter.com', 'x.com',
          'instagram.com',
          'pinterest.com',
          'tiktok.com',
          'youtube.com', 'youtu.be',
          'wikipedia.org', 'wikimedia.org',
          'quora.com',
          'medium.com',
          'linkedin.com',
          'tumblr.com',
          'blogspot.com', 'blogger.com',
          'wordpress.com',
          'yahoo.com', 'yahoo.co',
          'buzzfeed.com',
          'cnn.com', 'bbc.com', 'nytimes.com', 'washingtonpost.com', 'wsj.com', 'usatoday.com',
          'theverge.com', 'techcrunch.com', 'engadget.com', 'arstechnica.com',
          'amazon.com/review', 'amazon.com/customer-reviews',
          'amazon.com/product-reviews'
        ];
        
        const isNonRetailer = nonRetailerDomains.some(domain => hostname.includes(domain) || url.includes(domain));
        if (isNonRetailer) {
          console.log(`Item ${index + 1}: Skipped ${url} (non-retailer site)`);
          return;
        }

        // Filter URLs to ONLY product pages (not reviews, blogs, categories, etc.)
        const productPagePatterns = [
          // Amazon patterns
          /\/dp\/[A-Z0-9]{10}/i,
          /\/gp\/product\/[A-Z0-9]/i,
          /\/product\/[A-Z0-9]/i,
          // Target patterns
          /\/p\/[A-Z0-9-]+\//i,
          /\/product\/[0-9]+/i,
          // Walmart patterns
          /\/ip\/[^\/]+\/[0-9]+/i,
          /\/product\/[0-9]+/i,
          // Generic product patterns
          /\/product[s]?\/[^\/]+/i,
          /\/item[s]?\/[^\/]+/i,
          /\/p\/[^\/]+/i,
          /\/products\/[^\/]+/i,
          /\/shop\/[^\/]+\/[^\/]+/i, // shop/category/product
          /\/buy\/[^\/]+/i,
          // Best Buy, eBay, etc.
          /\/site\/[^\/]+\/[^\/]+\/p\.aspx/i,
          /\/itm\/[0-9]+/i,
        ];
        
        const isProductPage = productPagePatterns.some(pattern => pattern.test(url));
        
        // Also check for common NON-product page patterns to exclude
        const nonProductPatterns = [
          '/search',
          '/category',
          '/categories',
          '/brand',
          '/brands',
          '/review',
          '/reviews',
          '/compare',
          '/guide',
          '/help',
          '/blog',
          '/article',
          '/news',
          '/about',
          '/contact',
          '/faq',
          '/sitemap',
          '/cart',
          '/checkout',
          '/account',
          '/profile',
          '/wishlist',
        ];
        
        const isNonProductPage = nonProductPatterns.some(pattern => url.includes(pattern));
        
        // REJECT if it's clearly not a product page
        if (isNonProductPage) {
          console.log(`Item ${index + 1}: Skipped ${url} (non-product page)`);
          return;
        }
        
        // ACCEPT if it matches product page patterns OR is from known retailers
        const knownRetailerDomains = ['amazon.com', 'target.com', 'walmart.com', 'bestbuy.com', 
          'ebay.com', 'costco.com', 'homedepot.com', 'lowes.com', 'kohls.com', 'macys.com',
          'newegg.com', 'staples.com', 'officedepot.com', 'jbl.com', 'nike.com', 'apple.com',
          'samsung.com', 'sony.com', 'dell.com'];
        const isKnownRetailer = knownRetailerDomains.some(domain => hostname.includes(domain));
        
        if (!isProductPage && !isKnownRetailer) {
          console.log(`Item ${index + 1}: Skipped ${url} (not a product page and not known retailer)`);
          return;
        }

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
        
        // REMOVED: All price extraction logic - focus on retailer discovery only
        
        // Mark retailer as added
        addedRetailers.add(retailerKey);
        
        console.log(`  → Processing ${retailer}...`);
        
        // Extract product info from API result
        const resultTitle = item.title || currentProduct.title;
        const resultImageUrl = extractImageUrl(item);
        
        // Add the result - no price data
        results.push({
          retailer: retailer,
          url: item.link || '',
          imageUrl: resultImageUrl,
          title: resultTitle,
          isCurrentPage: false
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
 * Parse price text - USD ONLY (strict $ symbol required)
 * This prevents currency confusion (e.g., PHP peso showing as $2400)
 */
function parsePriceTextUSDOnly(text) {
  if (!text || typeof text !== "string") return null;
  
  // Only accept prices with $ symbol (USD)
  // Reject other currency symbols: £, €, ¥, ₱, etc.
  const usdPriceRegex = /\$\s*([0-9]{1,3}(?:[, \u00A0][0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)/;
  const match = text.match(usdPriceRegex);
  
  if (!match || !match[1]) return null;
  
  // Remove commas and spaces
  const cleaned = match[1].replace(/[, \u00A0]/g, "");
  const value = parseFloat(cleaned);
  
  if (isNaN(value) || value <= 0) return null;
  return value;
}

/**
 * Extract price from shopping result item - USD ONLY
 */
function extractPriceFromItem(item, referencePrice = null) {
  // 1. Try Structured Data (Rich Snippets) - Most Reliable
  if (item.pagemap) {
    // Try offer/product schemas - check for USD currency
    if (item.pagemap.offer) {
      const offers = Array.isArray(item.pagemap.offer) ? item.pagemap.offer : [item.pagemap.offer];
      for (const offer of offers) {
        // Check if currency is USD
        if (offer.price && (offer.priceCurrency === 'USD' || !offer.priceCurrency || offer.priceCurrency === '')) {
          const priceStr = String(offer.price);
          // If it has $, parse it; otherwise assume it's a number
          if (priceStr.includes('$')) {
            return priceStr;
          } else {
            // Structured data often provides just the number, prepend $
            return `$${priceStr}`;
          }
        }
      }
    }
    if (item.pagemap.product) {
      const products = Array.isArray(item.pagemap.product) ? item.pagemap.product : [item.pagemap.product];
      for (const product of products) {
        if (product.offers && product.offers.price) {
          const priceCurrency = product.offers.priceCurrency || product.priceCurrency || '';
          if (priceCurrency === 'USD' || !priceCurrency) {
            const priceStr = String(product.offers.price);
            return priceStr.includes('$') ? priceStr : `$${priceStr}`;
          }
        }
        if (product.price) {
          const priceStr = String(product.price);
          // Try to validate it's reasonable if we have reference
          if (referencePrice) {
            const val = parseFloat(priceStr.replace(/[$,]/g, ''));
            if (!isNaN(val) && val > 0 && val / referencePrice < 50 && val / referencePrice > 0.01) {
              return priceStr.includes('$') ? priceStr : `$${priceStr}`;
            }
          } else {
            return priceStr.includes('$') ? priceStr : `$${priceStr}`;
          }
        }
      }
    }
    
    // Try Open Graph / Metatags (Common in many retailers)
    if (item.pagemap.metatags) {
      const tags = Array.isArray(item.pagemap.metatags) ? item.pagemap.metatags : [item.pagemap.metatags];
      for (const tag of tags) {
        // Check for USD currency
        if (tag['og:price:currency'] && tag['og:price:currency'] !== 'USD') continue;
        if (tag['product:price:currency'] && tag['product:price:currency'] !== 'USD') continue;
        
        if (tag['og:price:amount']) {
          const priceStr = String(tag['og:price:amount']);
          return priceStr.includes('$') ? priceStr : `$${priceStr}`;
        }
        if (tag['product:price:amount']) {
          const priceStr = String(tag['product:price:amount']);
          return priceStr.includes('$') ? priceStr : `$${priceStr}`;
        }
        if (tag['twitter:data1'] && tag['twitter:label1'] === 'Price' && tag['twitter:data1'].includes('$')) {
          return tag['twitter:data1'];
        }
      }
    }
  }

  // 2. Text Extraction Strategy - STRICT USD ONLY ($ symbol required)
  // Combine title and snippet for search
  const textToSearch = (item.title + " " + (item.snippet || "") + " " + (item.htmlSnippet || "")).replace(/\s+/g, " ");
  
  // STRICT regex: ONLY match prices with $ symbol (USD)
  // Negative lookahead to avoid "off", "discount", "saved" immediately after
  // Also avoid prices that look like dates or other numbers
  const priceRegex = /\$\s*([0-9]{1,3}(?:[,][0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)(?!\s*(?:off|discount|saved|cash back|shipping|tax))/gi;
  
  const matches = [...textToSearch.matchAll(priceRegex)];
  
  if (matches.length > 0) {
    const candidates = matches.map(m => m[0].trim()); // Get the full strings "$10.00"
    
    // If we have a reference price, pick the candidate closest to it
    if (referencePrice && candidates.length > 1) {
      let bestCandidate = candidates[0];
      let minDiff = Number.MAX_VALUE;
      
      for (const candidate of candidates) {
        const val = parsePriceTextUSDOnly(candidate);
        if (val !== null && val > 0) {
          // Reject prices that are way off (currency confusion)
          const ratio = val / referencePrice;
          if (ratio > 50 || ratio < 0.01) continue;
          
          const diff = Math.abs(val - referencePrice);
          if (diff < minDiff) {
            minDiff = diff;
            bestCandidate = candidate;
          }
        }
      }
      return bestCandidate;
    }
    
    return candidates[0];
  }

  // Fallback: Try decoding HTML snippet if simple regex failed
  if (item.htmlSnippet) {
    const decoded = item.htmlSnippet
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/&#36;/g, '$'); // Decode $ entity
      
    const matchesHtml = [...decoded.matchAll(priceRegex)];
    if (matchesHtml.length > 0) {
      return matchesHtml[0][0].trim();
    }
  }
  
  return null;
}

/**
 * Extract price from text only (fallback when structured data unavailable)
 * This is less reliable than structured data but better than nothing
 */
function extractPriceFromItemTextOnly(item, referencePrice = null) {
  // ONLY use this as fallback - structured data is preferred
  const textToSearch = (item.title + " " + (item.snippet || "") + " " + (item.htmlSnippet || "")).replace(/\s+/g, " ");
  
  // STRICT regex: ONLY match prices with $ symbol (USD)
  const priceRegex = /\$\s*([0-9]{1,3}(?:[,][0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)(?!\s*(?:off|discount|saved|cash back|shipping|tax))/gi;
  
  const matches = [...textToSearch.matchAll(priceRegex)];
  
  if (matches.length > 0) {
    const candidates = matches.map(m => m[0].trim());
    
    if (referencePrice && candidates.length > 1) {
      let bestCandidate = candidates[0];
      let minDiff = Number.MAX_VALUE;
      
      for (const candidate of candidates) {
        const val = parsePriceTextUSDOnly(candidate);
        if (val !== null && val > 0) {
          // Reject prices that are way off (currency confusion)
          const ratio = val / referencePrice;
          if (ratio > 50 || ratio < 0.01) continue;
          
          const diff = Math.abs(val - referencePrice);
          if (diff < minDiff) {
            minDiff = diff;
            bestCandidate = candidate;
          }
        }
      }
      return bestCandidate;
    }
    
    return candidates[0];
  }
  
  // Fallback: Try decoding HTML snippet if simple regex failed
  if (item.htmlSnippet) {
    const decoded = item.htmlSnippet
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
      .replace(/&#36;/g, '$'); // Decode $ entity
      
    const matchesHtml = [...decoded.matchAll(priceRegex)];
    if (matchesHtml.length > 0) {
      return matchesHtml[0][0].trim();
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
 * Calculate title similarity to determine if products are the same or similar
 * Returns a score between 0 and 1 (1 = identical, 0 = completely different)
 * Improved to better detect same products vs similar ones
 */
function calculateTitleSimilarity(title1, title2, currentProduct = null) {
  if (!title1 || !title2) return 0;
  
  const normalize = (str) => str.toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Remove special chars
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
  
  const normalized1 = normalize(title1);
  const normalized2 = normalize(title2);
  
  // Exact match
  if (normalized1 === normalized2) return 1.0;
  
  // Check if one contains the other (likely same product with different description)
  if (normalized1.includes(normalized2) || normalized2.includes(normalized1)) {
    return 0.95; // Same product, just different description length
  }
  
  // Extract brand from current product if available
  let brand = null;
  if (currentProduct && currentProduct.brand) {
    brand = normalize(currentProduct.brand);
  } else {
    // Try to extract brand from title (usually first word or two)
    const firstWords = normalized1.split(/\s+/).slice(0, 2).join(' ');
    brand = firstWords;
  }
  
  // Check if both titles contain the brand (strong indicator of same product)
  const hasBrand1 = brand && normalized1.includes(brand);
  const hasBrand2 = brand && normalized2.includes(brand);
  const bothHaveBrand = hasBrand1 && hasBrand2;
  
  // Extract model numbers / product codes (alphanumeric sequences)
  const extractCodes = (str) => {
    // Match patterns like: SX1234, DR-1234, 123456, etc.
    return str.match(/\b[A-Z0-9]{3,}[-\s]?[A-Z0-9]{2,}\b/gi) || [];
  };
  
  const codes1 = extractCodes(title1);
  const codes2 = extractCodes(title2);
  
  // If same model codes exist, it's the same product
  if (codes1.length > 0 && codes2.length > 0) {
    const matchingCodes = codes1.some(code1 => 
      codes2.some(code2 => normalize(code1) === normalize(code2))
    );
    if (matchingCodes) {
      return 0.95; // Same product code/model number
    }
  }
  
  // Extract key product words (exclude common words)
  const commonWords = new Set(['the', 'and', 'or', 'for', 'with', 'pack', 'pairs', 'pair', 'set', 'bundle']);
  const extractKeyWords = (str) => {
    return str.split(/\s+/)
      .filter(word => word.length > 2 && !commonWords.has(word))
      .slice(0, 8); // First 8 meaningful words
  };
  
  const keywords1 = extractKeyWords(normalized1);
  const keywords2 = extractKeyWords(normalized2);
  
  // Count matching keywords
  const set1 = new Set(keywords1);
  const set2 = new Set(keywords2);
  let matches = 0;
  for (const word of set1) {
    if (set2.has(word)) {
      matches++;
    }
  }
  
  // Calculate base similarity
  const totalUnique = new Set([...keywords1, ...keywords2]).size;
  let similarity = totalUnique > 0 ? matches / totalUnique : 0;
  
  // Boost similarity if both have the brand
  if (bothHaveBrand && similarity > 0.3) {
    similarity = Math.min(0.95, similarity + 0.2);
  }
  
  // If high keyword overlap and both have brand, treat as same product
  if (bothHaveBrand && matches >= 4 && similarity > 0.5) {
    similarity = Math.max(0.85, similarity);
  }
  
  return similarity;
}

/**
 * Display comparison results in the modal
 */
function displayComparisonResults(results, currentProduct, modal) {
  const body = modal.querySelector('#supershopper-modal-body');
  if (!body) return;
  
  // Categorize results into same vs similar products
  const sameProducts = [];
  const similarProducts = [];
  
  results.forEach(result => {
    if (result.isCurrentPage) {
      // Current page always goes in "same" group
      sameProducts.push(result);
    } else {
      // Calculate similarity to current product (pass currentProduct for brand matching)
      const similarity = calculateTitleSimilarity(currentProduct.title, result.title, currentProduct);
      
      // Higher threshold (0.75) to be more strict about "same product"
      // This prevents same products from appearing in "similar" section
      if (similarity > 0.75) {
        sameProducts.push({ ...result, similarity });
      } else {
        similarProducts.push({ ...result, similarity });
      }
    }
  });
  
  // Sort similar products by similarity (highest first)
  similarProducts.sort((a, b) => b.similarity - a.similarity);
  
  // Create comparison container
  let html = `
    <div class="supershopper-comparison-container">
      <div class="supershopper-product-header">
        <h3 class="supershopper-product-title">${escapeHtml(currentProduct.title)}</h3>
        ${currentProduct.imageUrl ? `<img src="${escapeUrlForAttribute(currentProduct.imageUrl)}" alt="${escapeHtml(currentProduct.title)}" class="supershopper-product-image" />` : ''}
      </div>
  `;
  
  // SECTION 1: Same Product (simpler table, no images needed)
  if (sameProducts.length > 0) {
    html += `
      <div class="supershopper-section">
        <h4 class="supershopper-section-title">Available at these retailers</h4>
        <table class="supershopper-comparison-table">
          <thead>
            <tr>
              <th>Retailer</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    sameProducts.forEach(result => {
      html += `
        <tr class="${result.isCurrentPage ? 'supershopper-current-row' : ''}">
          <td>
            <div class="supershopper-retailer-cell">
              ${result.isCurrentPage ? '<span class="supershopper-price-indicator same">✓</span>' : ''}
              <strong>${escapeHtml(result.retailer)}</strong>
            </div>
          </td>
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
  }
  
  // SECTION 2: Similar Products (with images and product names)
  if (similarProducts.length > 0) {
    html += `
      <div class="supershopper-section">
        <h4 class="supershopper-section-title">Similar products</h4>
        <div class="supershopper-similar-products">
    `;
    
    similarProducts.forEach(result => {
      html += `
        <div class="supershopper-similar-product-card">
          ${result.imageUrl ? `<img src="${escapeUrlForAttribute(result.imageUrl)}" alt="${escapeHtml(result.title)}" class="supershopper-similar-product-image" />` : '<div class="supershopper-similar-product-image-placeholder">No image</div>'}
          <div class="supershopper-similar-product-info">
            <div class="supershopper-similar-product-title">${escapeHtml(result.title)}</div>
            <div class="supershopper-similar-product-retailer">${escapeHtml(result.retailer)}</div>
            <a href="${escapeUrlForAttribute(result.url)}" target="_blank" class="supershopper-visit-btn">Visit Store</a>
          </div>
        </div>
      `;
    });
    
    html += `
        </div>
      </div>
    `;
  }
  
  html += `</div>`;
  
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

