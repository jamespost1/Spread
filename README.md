# Super Shopper – Retailer Discovery Tool - Chrome Extension (v0.2.0)

**Super Shopper** is a Chrome extension that helps you discover where else you can buy products you're viewing. Simply browse any product page on Amazon, Target, or Walmart, and click the **View other retailers** button to see where else the same product (or similar products) are available.

---

## Current Features (v0.2.0)

- Automatically detects product pages on supported retailers (Amazon, Target, Walmart)
- Extracts product information (name, brand, SKU, images)
- Displays a **View other retailers** button on product pages
- Uses Google Custom Search API to find the same product across multiple retailers
- Groups results intelligently:
  - **Same Product**: Retailers selling the exact same product (identified by brand, model numbers, and title similarity)
  - **Similar Products**: Alternative options you might consider
- Shows product images and titles for similar products
- Clean, modern UI with white and light blue theme
- Works entirely client-side; no backend required
- Filters out non-retailer sites (social media, news, blogs, etc.)
- Focuses on US retailers and USD pricing

---

## How It Works

The extension uses content scripts to:

1. Detect product pages on supported retailers (Amazon, Target, Walmart)
2. Extract product information (name, brand, SKU, images)
3. Display a **View other retailers** button on product pages
4. Search for the product using Google Custom Search API
5. Filter and categorize results:
   - Same products (grouped by title similarity, brand matching, and model codes)
   - Similar products (related alternatives)
6. Display results in a clean modal with:
   - Simple table showing retailers with the same product
   - Card grid showing similar products with images and titles

---

## Why No Price Comparison?

We've intentionally removed price extraction because:

- **Shipping costs vary** by retailer and location (Prime, free shipping thresholds, etc.)
- **Tax rates differ** by state and retailer
- **Delivery speed** and benefits (same-day, Prime perks) aren't reflected in price
- **Price accuracy** from search snippets is unreliable
- **Users can check prices** directly on retailer sites where they can see final totals

Instead, Super Shopper focuses on **retailer discovery**—helping you find where products are available so you can make informed decisions based on your own priorities (price, shipping speed, return policy, etc.).

---

## Project Structure

```
super-shopper/
│
├── manifest.json          # Chrome extension config (Manifest V3)
├── price_utils.js         # Helper functions for parsing prices and formatting currency
├── product_extractor.js   # Product information extraction (Amazon, Target, Walmart)
├── comparison_modal.js    # Retailer discovery modal UI and logic
├── service_worker.js      # Background/service worker for extension events
│
├── options.html           # Options/settings page UI
├── options.js             # Logic for the options page
├── styles.css             # Shared styling for injected elements and options page
│
├── icons/                 # 16px, 48px, 128px icons for toolbar and Chrome Web Store
│   ├── shopping_cart.png
│
└── README.md              # Project documentation
```

---

## Installation (Developer Mode)

1. Clone or download this repository
2. Open Chrome and go to `chrome://extensions/`
3. Enable Developer Mode
4. Click "Load unpacked"
5. Select the project directory

The extension will load immediately.

---

## Configuration (Optional)

To enable real-time retailer discovery via Google Custom Search API:

1. Get a Google API Key:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing one
   - Enable "Custom Search API"
   - Create credentials (API Key)

2. Create a Custom Search Engine:
   - Go to [Google Custom Search](https://programmablesearchengine.google.com/)
   - Create a new search engine that searches the entire web
   - Note your Search Engine ID

3. Configure in Extension:
   - Right-click the extension icon → Options
   - Enter your Google API Key and Search Engine ID
   - Check "Enable real-time retailer discovery"

Without API configuration, the extension will show fallback sample data.

---

## Roadmap

### v0.2.0 — Retailer Discovery (Current)
- ✅ Product extractor for Amazon, Target, and Walmart
  - Extract product name, brand, SKU/UPC, image URL
  - Site-specific selectors for accurate extraction
- ✅ View Other Retailers button and modal
  - Clean, non-intrusive button next to product price
  - Modal popup with retailer listings
  - White and light blue theme
- ✅ Google Custom Search API integration
  - Fetch real-time retailer results
  - Filter out non-retailer sites
  - Product page URL pattern matching
- ✅ Intelligent product grouping
  - Same product detection (brand matching, model codes, title similarity)
  - Similar products section with images and titles
- ✅ Smart filtering
  - Exclude social media, news sites, blogs
  - Focus on US retailers
  - Product page URL validation

### v0.3.0 — Enhanced Discovery
- Expand retailer recognition to 20+ major retailers
- Improved product matching with better similarity algorithms
- Cache recent searches for faster loading
- Filter/sort options in modal (by retailer, relevance, etc.)
- Support for more product categories

### v0.4.0 — User Experience
- Saved retailer preferences
- Quick access to favorite retailers
- Recently viewed products
- Share product links

### v0.5.0 — Advanced Features
- Browser history integration (track what you've viewed)
- Retailer-specific benefits comparison (shipping policies, return windows, etc.)
- Product availability status
- Mobile-responsive improvements

### v1.0.0 — Full-Featured Shopping Assistant
- Complete retailer discovery across 50+ retailers
- Advanced product matching
- Personalized retailer recommendations
- Integration with shopping lists
- Browser extension for all major browsers

---

## Design Principles

- **Clean & Modest**: White and light blue color scheme
- **Non-Intrusive**: Subtle button placement, elegant modal design
- **Fast & Lightweight**: Efficient API calls, smart filtering
- **User-Friendly**: Clear retailer grouping, intuitive interface
- **Honest**: No misleading price data—let users check prices themselves

---

## Tech Stack

- JavaScript (content scripts, vanilla JS)
- Chrome Extensions API (Manifest V3)
- Google Custom Search API (optional, for real-time results)
- No frameworks required (keeping it lightweight)

---

## Supported Retailers

The extension can discover products from any retailer that appears in Google search results, including:

### Major Retailers
- Amazon
- Target
- Walmart
- Best Buy
- eBay
- Costco
- Home Depot
- Lowe's
- Kohl's
- Macy's
- Newegg
- Staples
- Office Depot
- And many more...

### Brand Websites
- Nike
- Apple
- Samsung
- Sony
- Dell
- HP
- JBL
- And more...

The extension intelligently filters and categorizes results to show the most relevant retailers.

---

## Notes

Super Shopper focuses on **retailer discovery** rather than price comparison. This approach is more accurate and useful because final prices depend on shipping, tax, location, and membership benefits—factors that are best evaluated directly on retailer sites.

The extension is built with simplicity and performance in mind, using smart filtering and intelligent product matching to help you find where products are available across the web.
