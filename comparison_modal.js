// comparison_modal.js
// Price comparison modal UI and logic

/**
 * Create and inject the View Other Retailers button next to the product price
 */
function injectCompareButton(productInfo) {
  if (!productInfo || !productInfo.priceElement) return;
  
  // Check if button already exists
  const existingButton = document.querySelector('.supershopper-compare-btn');
  if (existingButton) return;
  
  try {
    const button = document.createElement('button');
    button.className = 'supershopper-compare-btn';
    button.textContent = 'View other retailers';
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
 * Generate cache key from product info
 */
function getCacheKey(productInfo) {
  // Use URL + retailer as unique identifier
  const url = productInfo.url || window.location.href;
  const retailer = productInfo.retailer || 'unknown';
  return `search_cache_${retailer}_${encodeURIComponent(url)}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Load cached results if available and fresh
 */
function loadCachedResults(cacheKey) {
  return new Promise((resolve) => {
    chrome.storage.local.get([cacheKey], (items) => {
      const cached = items[cacheKey];
      if (!cached) {
        resolve(null);
        return;
      }
      
      // Check if cache is expired (24 hours)
      const now = Date.now();
      if (cached.expiresAt && now > cached.expiresAt) {
        // Cache expired, remove it
        chrome.storage.local.remove([cacheKey]);
        resolve(null);
        return;
      }
      
      // Cache is valid
      console.log('Cache hit for:', cacheKey);
      resolve({
        results: cached.results,
        productInfo: cached.productInfo,
        timestamp: cached.timestamp,
        isCached: true
      });
    });
  });
}

/**
 * Save results to cache
 */
function saveCachedResults(cacheKey, results, productInfo) {
  const cacheData = {
    results: results,
    productInfo: productInfo,
    timestamp: Date.now(),
    expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
  };
  
  chrome.storage.local.set({ [cacheKey]: cacheData }, () => {
    console.log('Cached results for:', cacheKey);
  });
}

/**
 * Fetch price comparisons from Google Shopping via Custom Search API
 */
async function fetchPriceComparisons(productInfo, modal) {
  try {
    // Check cache first
    const cacheKey = getCacheKey(productInfo);
    const cached = await loadCachedResults(cacheKey);
    
    if (cached) {
      // Use cached results
      displayComparisonResults(cached.results, cached.productInfo, modal, true);
      return;
    }
    
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
    
    // Cache the results
    saveCachedResults(cacheKey, results, productInfo);
    
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
  let finalQuery = `${query} buy`;
  
  // Exclude current retailer from search to get more diverse results
  // This prevents Amazon results when searching from Amazon, etc.
  if (productInfo.retailer) {
    const retailerLower = productInfo.retailer.toLowerCase();
    if (retailerLower === 'amazon') {
      finalQuery = `${finalQuery} -site:amazon.com`;
    } else if (retailerLower === 'walmart') {
      finalQuery = `${finalQuery} -site:walmart.com`;
    } else if (retailerLower === 'target') {
      finalQuery = `${finalQuery} -site:target.com`;
    }
  }
  
  return finalQuery; 
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
    num: '10', // Google Custom Search API max is 10 results per request
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
          // Target patterns - more flexible to handle /p/product-name/-/A-12345678 format
          /\/p\/[^\/]+/i, // Match /p/ followed by anything (handles /p/product-name/-/A-123 or /p/-/A-123)
          /\/p\/[A-Z0-9-]+\//i, // Also handle /p/ALPHA-NUM/
          /\/product\/[0-9]+/i,
          // Walmart patterns
          /\/ip\/[^\/]+\/[0-9]+/i,
          /\/product\/[0-9]+/i,
          // Walgreens patterns
          /\/store\/.*\/id=/i,
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
        
        // Filter out app store links (iOS App Store, Google Play Store, etc.)
        if (url.includes('apps.apple.com') || url.includes('play.google.com') || url.includes('app-store') || (url.includes('/app/') && !url.includes('/product'))) {
          console.log(`Item ${index + 1}: Skipped ${url} (app store link)`);
          return;
        }
        
        // Filter out root/homepage URLs (these aren't product pages)
        // But be lenient - Target URLs like target.com/p/product-name/-/A-123 should pass
        const urlPath = url.match(/https?:\/\/[^\/]+\/(.*)/)?.[1] || '';
        // Only reject if it's truly just the domain with no path or just a slash
        if ((!urlPath || urlPath.trim() === '' || urlPath === '/') && !hostname.includes('target.com')) {
          // Allow Target even if path looks short (Target URLs can be complex)
          console.log(`Item ${index + 1}: Skipped ${url} (homepage/root URL)`);
          return;
        }
        
        // ACCEPT if it matches product page patterns
        // For known retailers (especially brand sites), we still require product page patterns
        const knownRetailerDomains = ['amazon.com', 'target.com', 'walmart.com', 'bestbuy.com', 
          'ebay.com', 'costco.com', 'homedepot.com', 'lowes.com', 'kohls.com', 'macys.com',
          'newegg.com', 'staples.com', 'officedepot.com', 'kroger.com', 'walgreens.com', 'frysfood.com'];
        const isKnownRetailer = knownRetailerDomains.some(domain => hostname.includes(domain));
        
        // Brand websites need to have product page patterns too
        const brandDomains = ['jbl.com', 'nike.com', 'apple.com', 'samsung.com', 'sony.com', 'dell.com'];
        const isBrandSite = brandDomains.some(domain => hostname.includes(domain));
        
        // Only accept if:
        // 1. It matches product page patterns, OR
        // 2. It's a known retailer (Amazon, Target, etc.) - they usually have good product URLs
        // But reject brand sites that don't match product page patterns (they often link to homepages)
        if (!isProductPage) {
          if (isBrandSite) {
            // Brand sites must have product page patterns
            console.log(`Item ${index + 1}: Skipped ${url} (brand site without product page pattern)`);
            return;
          }
          // For known retailers like Target, be more lenient - accept if it's from a known retailer domain
          // even if pattern doesn't match exactly (Target URLs can vary)
          if (!isKnownRetailer) {
            console.log(`Item ${index + 1}: Skipped ${url} (not a product page and not known retailer)`);
            return;
          }
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
 * Comprehensive retailer mapping for 20+ major retailers
 * Maps hostname patterns to display names
 */
const RETAILER_MAP = {
  // Major General Retailers
  'amazon': 'Amazon',
  'target': 'Target',
  'walmart': 'Walmart',
  'costco': 'Costco',
  'bestbuy': 'Best Buy',
  'best-buy': 'Best Buy',
  'ebay': 'eBay',
  'kroger': 'Kroger',
  'walgreens': 'Walgreens',
  'frysfood': "Fry's Food",
  'homedepot': 'Home Depot',
  'home-depot': 'Home Depot',
  'lowes': "Lowe's",
  'kohls': "Kohl's",
  'macys': "Macy's",
  'jcpenney': "JCPenney",
  'jc-penney': "JCPenney",
  'sears': 'Sears',
  'overstock': 'Overstock',
  'wayfair': 'Wayfair',
  'zappos': 'Zappos',
  
  // Electronics & Tech
  'newegg': 'Newegg',
  'bhphotovideo': 'B&H Photo',
  'bhphoto': 'B&H Photo',
  'microcenter': 'Micro Center',
  'micro-center': 'Micro Center',
  'frys': "Fry's Electronics",
  'apple': 'Apple',
  'microsoft': 'Microsoft Store',
  
  // Office Supplies
  'staples': 'Staples',
  'officedepot': 'Office Depot',
  'office-depot': 'Office Depot',
  'officemax': 'OfficeMax',
  
  // Sports & Outdoor
  'rei': 'REI',
  'dickssportinggoods': "Dick's Sporting Goods",
  'dicks': "Dick's Sporting Goods",
  'academy': "Academy Sports",
  
  // Pets
  'chewy': 'Chewy',
  'petco': 'Petco',
  'petsmart': 'PetSmart',
  'pet-smart': 'PetSmart',
  
  // Home & Furniture
  'bedbathandbeyond': "Bed Bath & Beyond",
  'bed-bath-and-beyond': "Bed Bath & Beyond",
  'crateandbarrel': 'Crate & Barrel',
  'crate-and-barrel': 'Crate & Barrel',
  'potterybarn': 'Pottery Barn',
  'pottery-barn': 'Pottery Barn',
  'westelm': 'West Elm',
  'west-elm': 'West Elm',
  'ikea': 'IKEA',
  
  // Specialty
  'gamestop': 'GameStop',
  'game-stop': 'GameStop',
  'ulta': 'Ulta Beauty',
  'sephora': 'Sephora',
  'nordstrom': 'Nordstrom',
  'nordstromrack': "Nordstrom Rack",
  'nordstrom-rack': "Nordstrom Rack",
  
  // Brand Websites
  'nike': 'Nike',
  'adidas': 'Adidas',
  'sony': 'Sony',
  'samsung': 'Samsung',
  'dell': 'Dell',
  'hp': 'HP',
  'lenovo': 'Lenovo',
  'jbl': 'JBL',
  'lg': 'LG',
  'tcl': 'TCL',
};

/**
 * Extract retailer name from URL using comprehensive mapping
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
    
    // Remove www. prefix if present for matching
    hostname = hostname.replace(/^www\./, '');
    
    // Check against retailer map by iterating through known patterns
    for (const [pattern, displayName] of Object.entries(RETAILER_MAP)) {
      if (hostname.includes(pattern)) {
        return displayName;
      }
    }
    
    // Extract domain name as fallback (e.g., "www.kohls.com" -> "Kohl's")
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      const domain = parts[parts.length - 2]; // e.g., "kohls" from "www.kohls.com"
      
      // Check if domain matches any known pattern
      for (const [pattern, displayName] of Object.entries(RETAILER_MAP)) {
        if (domain.includes(pattern)) {
          return displayName;
        }
      }
      
      // Capitalize first letter and handle special cases
      const specialCases = {
        'kohls': "Kohl's",
        'macys': "Macy's",
        'jcpenney': "JCPenney",
        'dicks': "Dick's",
        'bedbathandbeyond': "Bed Bath & Beyond",
      };
      
      if (specialCases[domain]) {
        return specialCases[domain];
      }
      
      // Convert camelCase or hyphenated domains to readable format
      const readable = domain
        .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase -> camel Case
        .replace(/-/g, ' ') // hyphens -> spaces
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      return readable || domain.charAt(0).toUpperCase() + domain.slice(1);
    }
    
    return 'Other Retailer';
  } catch (e) {
    console.warn('Error extracting retailer from:', url, e);
    // Try to extract from the string directly if URL parsing fails
    const match = url.match(/(?:www\.)?([^.]+)\.[^.]+/);
    if (match && match[1]) {
      const domain = match[1].toLowerCase();
      // Check against retailer map
      for (const [pattern, displayName] of Object.entries(RETAILER_MAP)) {
        if (domain.includes(pattern)) {
          return displayName;
        }
      }
      // Special cases
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
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const matrix = Array(len2 + 1).fill(null).map(() => Array(len1 + 1).fill(null));
  
  for (let i = 0; i <= len1; i++) matrix[0][i] = i;
  for (let j = 0; j <= len2; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= len2; j++) {
    for (let i = 1; i <= len1; i++) {
      const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,      // deletion
        matrix[j - 1][i] + 1,      // insertion
        matrix[j - 1][i - 1] + cost // substitution
      );
    }
  }
  
  return matrix[len2][len1];
}

/**
 * Calculate Jaccard similarity coefficient (token-based)
 */
function jaccardSimilarity(tokens1, tokens2) {
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  
  return union.size > 0 ? intersection.size / union.size : 0;
}

/**
 * Extract model numbers, SKUs, and UPCs from title
 */
function extractModelNumbers(title) {
  const patterns = [
    /\b[A-Z]{2,5}-?[0-9]{4,8}\b/g,           // Pattern: ABC-1234, ABC1234
    /\b[0-9]{3,}[A-Z]{1,4}\b/g,              // Pattern: 123ABC, 520BT (CHANGED: 3+ digits instead of 4+)
    /\b[A-Z0-9]{5,12}\b/g,                   // Generic alphanumeric codes (CHANGED: 5+ instead of 6+ to catch 520BT)
    /#[A-Z0-9-]+\b/g,                        // Pattern: #ABC-123
    /\b[A-Z]+[0-9]+[A-Z]*\b/g,               // Pattern: ABC123, ABC123D
    /\b[0-9]{12,14}\b/g,                     // UPC codes (12-14 digits)
  ];
  
  const models = new Set();
  patterns.forEach(pattern => {
    const matches = title.match(pattern);
    if (matches) {
      matches.forEach(match => {
        // Filter out very common words that match patterns
        if (match.length >= 4 && !/^(THE|AND|FOR|WITH)$/i.test(match)) {
          models.add(match.toUpperCase().replace(/[^\w]/g, ''));
        }
      });
    }
  });
  
  return Array.from(models);
}

/**
 * Calculate title similarity to determine if products are the same or similar
 * Returns a score between 0 and 1 (1 = identical, 0 = completely different)
 * Uses hybrid scoring with multiple algorithms for better accuracy
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
  
  // A. Model Number Matching (40% weight if match found)
  const models1 = extractModelNumbers(title1);
  const models2 = extractModelNumbers(title2);
  let modelMatchScore = 0;
  
  if (models1.length > 0 && models2.length > 0) {
    const matchingModels = models1.some(m1 => 
      models2.some(m2 => m1 === m2 || m1.includes(m2) || m2.includes(m1))
    );
    if (matchingModels) {
      modelMatchScore = 0.95; // Strong signal - same model number = same product
    }
  }
  
  // If model numbers match, return high similarity immediately
  if (modelMatchScore > 0) {
    return modelMatchScore;
  }
  
  // B. Brand Matching (30% weight)
  let brand = null;
  if (currentProduct && currentProduct.brand) {
    brand = normalize(currentProduct.brand);
  } else {
    // Try to extract brand from title (usually first word or two)
    const firstWords = normalized1.split(/\s+/).slice(0, 2).join(' ');
    brand = firstWords;
  }
  
  const hasBrand1 = brand && normalized1.includes(brand);
  const hasBrand2 = brand && normalized2.includes(brand);
  const bothHaveBrand = hasBrand1 && hasBrand2;
  const brandMatchScore = bothHaveBrand ? 0.8 : 0.3;
  
  // C. Token-Based Jaccard Similarity (20% weight)
  const commonWords = new Set(['the', 'and', 'or', 'for', 'with', 'pack', 'pairs', 'pair', 'set', 'bundle', 'of', 'a', 'an', 'in', 'on', 'at']);
  const extractTokens = (str) => {
    return str.split(/\s+/)
      .filter(word => word.length > 2 && !commonWords.has(word))
      .map(word => word.toLowerCase());
  };
  
  const tokens1 = extractTokens(normalized1);
  const tokens2 = extractTokens(normalized2);
  const jaccardScore = jaccardSimilarity(tokens1, tokens2);
  
  // D. Levenshtein Distance Similarity (10% weight)
  const maxLen = Math.max(normalized1.length, normalized2.length);
  const editDistance = levenshteinDistance(normalized1, normalized2);
  const levenshteinScore = maxLen > 0 ? 1 - (editDistance / maxLen) : 0;
  
  // Hybrid scoring with weighted averages
  // Adjust weights based on available signals
  let finalScore = 0;
  let totalWeight = 0;
  
  // Model number (if available, already returned above)
  // Brand match weight: 30%
  finalScore += brandMatchScore * 0.3;
  totalWeight += 0.3;
  
  // Jaccard similarity weight: 40% (increased since no model match)
  finalScore += jaccardScore * 0.4;
  totalWeight += 0.4;
  
  // Levenshtein weight: 30% (increased since no model match)
  finalScore += levenshteinScore * 0.3;
  totalWeight += 0.3;
  
  // Normalize by total weight
  finalScore = totalWeight > 0 ? finalScore / totalWeight : 0;
  
  // Boost if both have brand and high token similarity
  if (bothHaveBrand && jaccardScore > 0.5) {
    finalScore = Math.min(0.95, finalScore + 0.1);
  }
  
  // Penalize if no brand match but otherwise similar (might be different products)
  if (!bothHaveBrand && jaccardScore > 0.6) {
    finalScore = Math.max(0, finalScore - 0.1);
  }
  
  return Math.min(1.0, Math.max(0.0, finalScore));
}

/**
 * Display comparison results in the modal
 * @param {Array} results - Array of result objects
 * @param {Object} currentProduct - Current product info
 * @param {HTMLElement} modal - Modal element
 * @param {boolean} isCached - Whether results are from cache
 */
function displayComparisonResults(results, currentProduct, modal, isCached = false) {
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
      
      // Lower threshold to 0.65 to catch more same products (they often have slightly different titles)
      // Model number matches will push this over 0.95 anyway
      if (similarity > 0.65) {  // CHANGED: from 0.70 to 0.65
        sameProducts.push({ ...result, similarity });
      } else {
        similarProducts.push({ ...result, similarity });
      }
    }
  });
  
  // Sort similar products by similarity (highest first)
  similarProducts.sort((a, b) => b.similarity - a.similarity);
  
  // Get unique retailer names for filter dropdown
  const allRetailers = [...new Set(results.map(r => r.retailer).filter(Boolean))].sort();
  
  // Store original results in data attribute for filtering
  const containerId = 'supershopper-results-container-' + Date.now();
  
  // Create comparison container
  let html = `
    <div class="supershopper-comparison-container" id="${containerId}">
      ${isCached ? '<div class="supershopper-cache-indicator" title="Results from cache (may be up to 24 hours old)">📦 Cached results</div>' : ''}
      <div class="supershopper-product-header">
        <h3 class="supershopper-product-title">${escapeHtml(currentProduct.title)}</h3>
        ${currentProduct.imageUrl ? `<img src="${escapeUrlForAttribute(currentProduct.imageUrl)}" alt="${escapeHtml(currentProduct.title)}" class="supershopper-product-image" />` : ''}
      </div>
      <div class="supershopper-controls" data-container-id="${containerId}">
        <div class="supershopper-filter-group">
          <label for="supershopper-filter-retailer">Filter:</label>
          <select id="supershopper-filter-retailer" class="supershopper-filter-select">
            <option value="all">All retailers</option>
            ${allRetailers.map(retailer => `<option value="${escapeHtml(retailer)}">${escapeHtml(retailer)}</option>`).join('')}
          </select>
        </div>
        <div class="supershopper-sort-group">
          <label for="supershopper-sort-by">Sort:</label>
          <select id="supershopper-sort-by" class="supershopper-sort-select">
            <option value="relevance">Relevance (default)</option>
            <option value="retailer-az">Retailer name (A-Z)</option>
            <option value="retailer-za">Retailer name (Z-A)</option>
          </select>
        </div>
      </div>
      <div class="supershopper-results-wrapper" data-original-same="${JSON.stringify(sameProducts).replace(/"/g, '&quot;')}" data-original-similar="${JSON.stringify(similarProducts).replace(/"/g, '&quot;')}" data-current-product="${JSON.stringify(currentProduct).replace(/"/g, '&quot;')}">
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
  
  html += `
      </div>
    </div>`;
  
  body.innerHTML = html;
  
  // Add event handlers for filter and sort
  const filterSelect = body.querySelector('#supershopper-filter-retailer');
  const sortSelect = body.querySelector('#supershopper-sort-by');
  const resultsWrapper = body.querySelector('.supershopper-results-wrapper');
  
  if (filterSelect) {
    filterSelect.addEventListener('change', () => {
      applyFiltersAndSort(body, resultsWrapper, filterSelect.value, sortSelect.value, currentProduct);
    });
  }
  
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      applyFiltersAndSort(body, resultsWrapper, filterSelect.value, sortSelect.value, currentProduct);
    });
  }
  
  // Add smooth scroll to top
  body.scrollTop = 0;
}

/**
 * Apply filter and sort to results and re-render
 */
function applyFiltersAndSort(body, resultsWrapper, retailerFilter, sortBy, currentProduct) {
  try {
    // Get original data - unescape HTML entities in JSON
    const sameAttr = resultsWrapper.getAttribute('data-original-same') || '[]';
    const similarAttr = resultsWrapper.getAttribute('data-original-similar') || '[]';
    const originalSame = JSON.parse(sameAttr.replace(/&quot;/g, '"'));
    const originalSimilar = JSON.parse(similarAttr.replace(/&quot;/g, '"'));
    
    // Filter results
    let filteredSame = retailerFilter === 'all' 
      ? originalSame 
      : originalSame.filter(r => r.retailer === retailerFilter);
    
    let filteredSimilar = retailerFilter === 'all'
      ? originalSimilar
      : originalSimilar.filter(r => r.retailer === retailerFilter);
    
    // Sort results
    if (sortBy === 'retailer-az') {
      filteredSame = [...filteredSame].sort((a, b) => (a.retailer || '').localeCompare(b.retailer || ''));
      filteredSimilar = [...filteredSimilar].sort((a, b) => (a.retailer || '').localeCompare(b.retailer || ''));
    } else if (sortBy === 'retailer-za') {
      filteredSame = [...filteredSame].sort((a, b) => (b.retailer || '').localeCompare(a.retailer || ''));
      filteredSimilar = [...filteredSimilar].sort((a, b) => (b.retailer || '').localeCompare(a.retailer || ''));
    } else {
      // Relevance: keep same products in original order, sort similar by similarity
      filteredSimilar.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
    }
    
    // Re-render results sections
    const container = resultsWrapper.closest('.supershopper-comparison-container');
    const sameSection = container.querySelector('.supershopper-section:first-of-type');
    const similarSection = container.querySelector('.supershopper-section:last-of-type');
    
    // Update same products section
    if (sameSection && filteredSame.length > 0) {
      let sameHtml = `
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
      
      filteredSame.forEach(result => {
        sameHtml += `
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
      
      sameHtml += `
          </tbody>
        </table>
      `;
      
      sameSection.innerHTML = sameHtml;
    } else if (sameSection && filteredSame.length === 0) {
      sameSection.style.display = 'none';
    } else if (!sameSection && filteredSame.length > 0) {
      // Section was hidden, recreate it
      const sameHtml = `
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
              ${filteredSame.map(result => `
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
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      resultsWrapper.insertAdjacentHTML('afterbegin', sameHtml);
    }
    
    // Update similar products section
    if (similarSection && filteredSimilar.length > 0) {
      let similarHtml = `
        <h4 class="supershopper-section-title">Similar products</h4>
        <div class="supershopper-similar-products">
      `;
      
      filteredSimilar.forEach(result => {
        similarHtml += `
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
      
      similarHtml += `
        </div>
      `;
      
      similarSection.innerHTML = similarHtml;
    } else if (similarSection && filteredSimilar.length === 0) {
      similarSection.style.display = 'none';
    }
    
    // Show message if no results
    if (filteredSame.length === 0 && filteredSimilar.length === 0) {
      const noResultsMsg = container.querySelector('.supershopper-no-results');
      if (!noResultsMsg) {
        const msg = document.createElement('div');
        msg.className = 'supershopper-no-results';
        msg.style.cssText = 'text-align: center; padding: 40px; color: #666;';
        msg.textContent = 'No results match the selected filter.';
        resultsWrapper.appendChild(msg);
      }
    } else {
      const noResultsMsg = container.querySelector('.supershopper-no-results');
      if (noResultsMsg) {
        noResultsMsg.remove();
      }
      // Restore sections if they were hidden
      if (sameSection) sameSection.style.display = '';
      if (similarSection) similarSection.style.display = '';
    }
    
  } catch (error) {
    console.error('Error applying filters:', error);
  }
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
      !hostname.includes('walmart.') &&
      !hostname.includes('bestbuy.') &&
      !hostname.includes('best-buy.') &&
      !hostname.includes('ebay.') &&
      !hostname.includes('costco.')) {
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

