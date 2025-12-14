// product_extractor.js
// Product information extraction for Amazon, Target, and Walmart

/**
 * Extract product information from the current page
 * Returns a standardized product object or null if extraction fails
 */
function extractProductInfo() {
  const hostname = window.location.hostname.toLowerCase();
  
  // Detect which retailer we're on
  if (hostname.includes('amazon.')) {
    return extractAmazonProduct();
  } else if (hostname.includes('target.')) {
    return extractTargetProduct();
  } else if (hostname.includes('walmart.')) {
    return extractWalmartProduct();
  } else if (hostname.includes('bestbuy.') || hostname.includes('best-buy.')) {
    return extractBestBuyProduct();
  } else if (hostname.includes('ebay.')) {
    return extractEbayProduct();
  } else if (hostname.includes('costco.')) {
    return extractCostcoProduct();
  }
  
  return null;
}

/**
 * Extract product information from Amazon
 */
function extractAmazonProduct() {
  try {
    // Product title - multiple selectors for different page layouts
    const titleSelectors = [
      '#productTitle',
      'h1.a-size-large.product-title-word-break',
      'h1.a-size-base-plus',
      '[data-feature-name="title"]',
      '#title'
    ];
    let title = null;
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        title = el.textContent.trim();
        break;
      }
    }
    
    // Price - try multiple selectors
    const priceSelectors = [
      '.a-price .a-offscreen',
      '.a-price-whole',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '#priceblock_saleprice',
      '.a-price-symbol + .a-price-whole',
      '[data-a-color="price"] .a-offscreen'
    ];
    let price = null;
    let priceElement = null;
    for (const selector of priceSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const priceText = el.textContent || el.innerText || '';
        price = parsePriceText(priceText);
        if (price && price > 0) {
          priceElement = el;
          break;
        }
      }
    }
    
    // If price not found, try to find any price in the page
    if (!price) {
      const priceContainers = document.querySelectorAll('[data-asin-price], .a-price, #price');
      for (const container of priceContainers) {
        const priceText = container.textContent || container.innerText || '';
        price = parsePriceText(priceText);
        if (price && price > 0) {
          priceElement = container;
          break;
        }
      }
    }
    
    // Product image
    const imageSelectors = [
      '#landingImage',
      '#imgBlkFront',
      '#main-image',
      '#leftCol img[data-a-dynamic-image]',
      '.a-dynamic-image[src]'
    ];
    let imageUrl = null;
    for (const selector of imageSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        // First try direct src attribute
        imageUrl = el.src || el.getAttribute('src');
        if (imageUrl && imageUrl.startsWith('http')) {
          break;
        }
        
        // Try data-a-dynamic-image which contains JSON with multiple image sizes
        const dynamicImage = el.getAttribute('data-a-dynamic-image');
        if (dynamicImage) {
          try {
            const images = JSON.parse(dynamicImage);
            // Get the largest/highest quality image (usually first key)
            const imageKeys = Object.keys(images);
            if (imageKeys.length > 0) {
              imageUrl = imageKeys[0];
              if (imageUrl && imageUrl.startsWith('http')) {
                break;
              }
            }
          } catch (e) {
            // If parsing fails, continue to next selector
          }
        }
        
        // Try data-src as fallback
        imageUrl = el.getAttribute('data-src');
        if (imageUrl && imageUrl.startsWith('http')) {
          break;
        }
      }
    }
    
    // Brand - often in product title or separate element
    let brand = null;
    const brandSelectors = [
      '#brand',
      '[data-feature-name="bylineInfo"]',
      '.po-brand .po-break-word',
      '#productOverview_feature_div .po-brand .po-break-word'
    ];
    for (const selector of brandSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        brand = el.textContent.trim().replace(/^by\s+/i, '');
        if (brand) break;
      }
    }
    
    // ASIN (Amazon Standard Identification Number) - from URL or data attributes
    let asin = null;
    const urlMatch = window.location.href.match(/\/dp\/([A-Z0-9]{10})/);
    if (urlMatch) {
      asin = urlMatch[1];
    } else {
      // Try data attributes
      const asinEl = document.querySelector('[data-asin]');
      if (asinEl) {
        asin = asinEl.getAttribute('data-asin');
      }
    }
    
    // UPC/SKU - try to extract from product details
    let upc = null;
    const upcSelectors = [
      'th:contains("UPC") + td',
      'th:contains("ASIN") + td',
      '.product-info-detail:contains("UPC")'
    ];
    // Check in product details table
    const detailRows = document.querySelectorAll('#productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr');
    for (const row of detailRows) {
      const th = row.querySelector('th');
      const td = row.querySelector('td');
      if (th && td) {
        const label = th.textContent.trim().toLowerCase();
        if ((label.includes('upc') || label.includes('ean')) && td) {
          upc = td.textContent.trim();
          break;
        }
      }
    }
    
    // Return product object if we have at least title and price
    if (title && price) {
      return {
        retailer: 'Amazon',
        title: title,
        price: price,
        currency: 'USD',
        imageUrl: imageUrl,
        brand: brand,
        sku: asin || upc,
        upc: upc,
        asin: asin,
        url: window.location.href,
        priceElement: priceElement // Store reference to price element for button placement
      };
    }
  } catch (error) {
    console.warn('Error extracting Amazon product:', error);
  }
  
  return null;
}

/**
 * Extract product information from Target
 */
function extractTargetProduct() {
  try {
    // Product title
    const titleSelectors = [
      'h1[data-test="product-title"]',
      'h1.product-title',
      '[data-test="product-title"]',
      'h1'
    ];
    let title = null;
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        title = el.textContent.trim();
        if (title && title.length > 0) break;
      }
    }
    
    // Price
    const priceSelectors = [
      '[data-test="product-price"]',
      '[data-test="current-price"]',
      '.h-text-bold[aria-label*="price"]',
      '[itemprop="price"]',
      '.price'
    ];
    let price = null;
    let priceElement = null;
    for (const selector of priceSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const priceText = el.textContent || el.innerText || el.getAttribute('aria-label') || '';
        price = parsePriceText(priceText);
        if (price && price > 0) {
          priceElement = el;
          break;
        }
      }
    }
    
    // Product image
    const imageSelectors = [
      '[data-test="product-image"] img',
      '[data-test="gallery-image"] img',
      '.product-image img',
      '#zoomImage',
      'img[alt*="' + (title ? title.substring(0, 30) : '') + '"]'
    ];
    let imageUrl = null;
    for (const selector of imageSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        imageUrl = el.src || el.getAttribute('data-src') || el.getAttribute('srcset')?.split(' ')[0];
        if (imageUrl && imageUrl.startsWith('http')) {
          break;
        }
      }
    }
    
    // Brand
    let brand = null;
    const brandSelectors = [
      '[data-test="product-brand"]',
      '.product-brand',
      '[itemprop="brand"]'
    ];
    for (const selector of brandSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        brand = el.textContent.trim();
        if (brand) break;
      }
    }
    
    // TCIN (Target's product identifier) - from URL
    let tcin = null;
    const urlMatch = window.location.href.match(/\/-\/A-(\d+)/);
    if (urlMatch) {
      tcin = urlMatch[1];
    }
    
    // UPC/DCPI
    let upc = null;
    const specs = document.querySelectorAll('[data-test="specifications"] tr, .specifications tr');
    for (const row of specs) {
      const label = row.querySelector('td:first-child')?.textContent?.trim()?.toLowerCase();
      const value = row.querySelector('td:last-child')?.textContent?.trim();
      if (label && (label.includes('upc') || label.includes('dpci')) && value) {
        upc = value;
        break;
      }
    }
    
    if (title && price) {
      return {
        retailer: 'Target',
        title: title,
        price: price,
        currency: 'USD',
        imageUrl: imageUrl,
        brand: brand,
        sku: tcin || upc,
        upc: upc,
        tcin: tcin,
        url: window.location.href,
        priceElement: priceElement
      };
    }
  } catch (error) {
    console.warn('Error extracting Target product:', error);
  }
  
  return null;
}

/**
 * Extract product information from Walmart
 */
function extractWalmartProduct() {
  try {
    // Product title
    const titleSelectors = [
      'h1[itemprop="name"]',
      'h1.prod-product-title',
      '[data-testid="product-title"]',
      'h1.prod-ProductTitle',
      'h1'
    ];
    let title = null;
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        title = el.textContent.trim();
        if (title && title.length > 0) break;
      }
    }
    
    // Price - Walmart often shows price in multiple places
    const priceSelectors = [
      '[itemprop="price"]',
      '[data-testid="price"]',
      '.price-display',
      '.price-current',
      '.prod-PriceHero',
      '[data-automation-id="product-price"]'
    ];
    let price = null;
    let priceElement = null;
    for (const selector of priceSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const priceText = el.textContent || el.innerText || el.getAttribute('content') || '';
        price = parsePriceText(priceText);
        if (price && price > 0) {
          priceElement = el;
          break;
        }
      }
    }
    
    // Product image
    const imageSelectors = [
      '[data-testid="product-image"] img',
      '.prod-hero-image img',
      '.hover-zoom-hero-image img',
      'img[alt*="' + (title ? title.substring(0, 30) : '') + '"]',
      '[itemprop="image"]'
    ];
    let imageUrl = null;
    for (const selector of imageSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        imageUrl = el.src || el.getAttribute('data-src') || el.getAttribute('srcset')?.split(' ')[0];
        if (imageUrl && imageUrl.startsWith('http')) {
          break;
        }
      }
    }
    
    // Brand
    let brand = null;
    const brandSelectors = [
      '[itemprop="brand"]',
      '.prod-brand-name',
      '[data-testid="product-brand"]'
    ];
    for (const selector of brandSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        brand = el.textContent.trim();
        if (brand) break;
      }
    }
    
    // Product ID - from URL or data attributes
    let productId = null;
    const urlMatch = window.location.href.match(/ip\/([^\/]+)\//);
    if (urlMatch) {
      productId = urlMatch[1];
    }
    
    // UPC
    let upc = null;
    const productInfo = document.querySelectorAll('[data-testid="product-info"] tr, .product-info tr');
    for (const row of productInfo) {
      const label = row.querySelector('th, td:first-child')?.textContent?.trim()?.toLowerCase();
      const value = row.querySelector('td:last-child, td:nth-child(2)')?.textContent?.trim();
      if (label && (label.includes('upc') || label.includes('model')) && value) {
        upc = value;
        break;
      }
    }
    
    if (title && price) {
      return {
        retailer: 'Walmart',
        title: title,
        price: price,
        currency: 'USD',
        imageUrl: imageUrl,
        brand: brand,
        sku: productId || upc,
        upc: upc,
        productId: productId,
        url: window.location.href,
        priceElement: priceElement
      };
    }
  } catch (error) {
    console.warn('Error extracting Walmart product:', error);
  }
  
  return null;
}

/**
 * Extract product information from Best Buy
 */
function extractBestBuyProduct() {
  try {
    // Product title
    const titleSelectors = [
      'h1[class*="heading"]',
      '.sku-title h1',
      'h1.sr-only + h1',
      'h1'
    ];
    let title = null;
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        title = el.textContent.trim();
        if (title && title.length > 0 && !title.includes('Best Buy')) break;
      }
    }
    
    // Price
    const priceSelectors = [
      '.priceView-customer-price span[aria-hidden="true"]',
      '.priceView-price .priceView-customer-price',
      '[class*="pricing-price"]',
      '[data-testid="customer-price"]',
      '.pricing-price__value'
    ];
    let price = null;
    let priceElement = null;
    for (const selector of priceSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const priceText = el.textContent || el.innerText || '';
        price = parsePriceText(priceText);
        if (price && price > 0) {
          priceElement = el;
          break;
        }
      }
    }
    
    // Product image
    const imageSelectors = [
      '.product-image img',
      '[data-testid="product-image"] img',
      '.gallery-image img',
      'img.product-image'
    ];
    let imageUrl = null;
    for (const selector of imageSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        imageUrl = el.src || el.getAttribute('data-src') || el.getAttribute('srcset')?.split(' ')[0];
        if (imageUrl && imageUrl.startsWith('http')) {
          break;
        }
      }
    }
    
    // Brand
    let brand = null;
    const brandSelectors = [
      '[data-testid="product-brand"]',
      '.product-brand',
      '[itemprop="brand"]',
      'span[class*="brand"]'
    ];
    for (const selector of brandSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        brand = el.textContent.trim();
        if (brand) break;
      }
    }
    
    // SKU - from URL or meta tags
    let sku = null;
    const urlMatch = window.location.href.match(/skuId=(\d+)/);
    if (urlMatch) {
      sku = urlMatch[1];
    }
    
    // Model number / UPC
    let model = null;
    const specs = document.querySelectorAll('.product-data-specification, .specifications-list');
    for (const spec of specs) {
      const rows = spec.querySelectorAll('tr, .spec-item');
      for (const row of rows) {
        const label = row.querySelector('th, .spec-label, dt')?.textContent?.trim()?.toLowerCase();
        const value = row.querySelector('td, .spec-value, dd')?.textContent?.trim();
        if (label && (label.includes('model') || label.includes('upc') || label.includes('sku')) && value) {
          if (label.includes('model')) model = value;
          if (!sku && (label.includes('sku') || label.includes('upc'))) sku = value;
          break;
        }
      }
    }
    
    if (title && price) {
      return {
        retailer: 'Best Buy',
        title: title,
        price: price,
        currency: 'USD',
        imageUrl: imageUrl,
        brand: brand,
        sku: sku || model,
        model: model,
        url: window.location.href,
        priceElement: priceElement
      };
    }
  } catch (error) {
    console.warn('Error extracting Best Buy product:', error);
  }
  
  return null;
}

/**
 * Extract product information from eBay
 */
function extractEbayProduct() {
  try {
    // Product title
    const titleSelectors = [
      'h1[id*="ebay-item-title"]',
      'h1.x-item-title-label',
      '.x-item-title-label',
      'h1.it-ttl'
    ];
    let title = null;
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        title = el.textContent.trim();
        if (title && title.length > 0) break;
      }
    }
    
    // Price
    const priceSelectors = [
      '.notranslate[id*="prcIsum"]',
      '#prcIsum',
      '.u-flL.condText',
      '.notranslate[itemprop="price"]'
    ];
    let price = null;
    let priceElement = null;
    for (const selector of priceSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const priceText = el.textContent || el.getAttribute('content') || '';
        price = parsePriceText(priceText);
        if (price && price > 0) {
          priceElement = el;
          break;
        }
      }
    }
    
    // Product image
    const imageSelectors = [
      '#icImg',
      '.img.img640',
      '[id*="icImg"]',
      'img[itemprop="image"]'
    ];
    let imageUrl = null;
    for (const selector of imageSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        imageUrl = el.src || el.getAttribute('data-src') || el.getAttribute('srcset')?.split(' ')[0];
        if (imageUrl && imageUrl.startsWith('http')) {
          break;
        }
      }
    }
    
    // Brand (often in title or item specifics)
    let brand = null;
    const brandSelectors = [
      '[data-testid="ux-labels-values__values"]',
      '.u-flL.condText',
      'div[class*="itemAttr"]'
    ];
    for (const selector of brandSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const text = el.textContent.toLowerCase();
        if (text.includes('brand')) {
          brand = el.textContent.replace(/brand:/i, '').trim();
          if (brand) break;
        }
      }
    }
    
    // Item ID - from URL
    let itemId = null;
    const urlMatch = window.location.href.match(/\/itm\/(\d+)/);
    if (urlMatch) {
      itemId = urlMatch[1];
    }
    
    if (title && price) {
      return {
        retailer: 'eBay',
        title: title,
        price: price,
        currency: 'USD',
        imageUrl: imageUrl,
        brand: brand,
        sku: itemId,
        itemId: itemId,
        url: window.location.href,
        priceElement: priceElement
      };
    }
  } catch (error) {
    console.warn('Error extracting eBay product:', error);
  }
  
  return null;
}

/**
 * Extract product information from Costco
 */
function extractCostcoProduct() {
  try {
    // Product title
    const titleSelectors = [
      'h1[automation-id="productOutputTitle"]',
      '.product-title h1',
      'h1.product-title',
      'h1'
    ];
    let title = null;
    for (const selector of titleSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        title = el.textContent.trim();
        if (title && title.length > 0 && !title.includes('Costco')) break;
      }
    }
    
    // Price
    const priceSelectors = [
      '[automation-id="productPriceOutput"]',
      '.product-price',
      '.price-value',
      '[itemprop="price"]'
    ];
    let price = null;
    let priceElement = null;
    for (const selector of priceSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        const priceText = el.textContent || el.getAttribute('content') || '';
        price = parsePriceText(priceText);
        if (price && price > 0) {
          priceElement = el;
          break;
        }
      }
    }
    
    // Product image
    const imageSelectors = [
      '[automation-id="productImageOutput"] img',
      '.product-image img',
      '.img-container img',
      'img.product-image'
    ];
    let imageUrl = null;
    for (const selector of imageSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        imageUrl = el.src || el.getAttribute('data-src') || el.getAttribute('srcset')?.split(' ')[0];
        if (imageUrl && imageUrl.startsWith('http')) {
          break;
        }
      }
    }
    
    // Brand
    let brand = null;
    const brandSelectors = [
      '[automation-id="productBrand"]',
      '.product-brand',
      '[itemprop="brand"]'
    ];
    for (const selector of brandSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        brand = el.textContent.trim();
        if (brand) break;
      }
    }
    
    // Item number - from URL or product details
    let itemNumber = null;
    const urlMatch = window.location.href.match(/\.product\.(\d+)\.html/);
    if (urlMatch) {
      itemNumber = urlMatch[1];
    }
    
    // Model number / UPC
    let model = null;
    const details = document.querySelectorAll('.product-details, .specifications');
    for (const detail of details) {
      const rows = detail.querySelectorAll('tr, .spec-row');
      for (const row of rows) {
        const label = row.querySelector('th, .label, dt')?.textContent?.trim()?.toLowerCase();
        const value = row.querySelector('td, .value, dd')?.textContent?.trim();
        if (label && (label.includes('model') || label.includes('item') || label.includes('upc')) && value) {
          if (label.includes('model')) model = value;
          if (!itemNumber && label.includes('item')) itemNumber = value;
          break;
        }
      }
    }
    
    if (title && price) {
      return {
        retailer: 'Costco',
        title: title,
        price: price,
        currency: 'USD',
        imageUrl: imageUrl,
        brand: brand,
        sku: itemNumber || model,
        itemNumber: itemNumber,
        model: model,
        url: window.location.href,
        priceElement: priceElement
      };
    }
  } catch (error) {
    console.warn('Error extracting Costco product:', error);
  }
  
  return null;
}

/**
 * Check if the current page is a supported product page
 */
function isProductPage() {
  const productInfo = extractProductInfo();
  return productInfo !== null;
}

