# Super Shopper – Price Comparison Tool - Chrome Extension (v0.1.0)

**Super Shopper** is a Chrome extension that helps you find the best deals by comparing prices across multiple retailers. Simply browse any product page on Amazon, Target, or Walmart, and click the **Compare Prices** button to see prices from other retailers instantly.

---

## Current Features (v0.1.0)

- Automatically detects product prices on retail websites
- Calculates a **TruePrice** that includes estimated tax and shipping
- Injects price information directly into product pages
- Runs entirely client-side; no backend required

*Note: This version focuses on price detection. Price comparison features are coming in v0.2.0.*

---

## How It Works

The extension uses content scripts to:

1. Detect product pages on supported retailers (Amazon, Target, Walmart)
2. Extract product information (name, price, SKU, images)
3. Display a **Compare Prices** button on product pages
4. Fetch price comparisons from Google Shopping API
5. Show results in a clean modal with price comparisons, product images, and indicators for better/worse deals

---

## Project Structure

```
super-shopper/
│
├── manifest.json          # Chrome extension config
├── content_script.js      # Main logic injected into pages
├── price_utils.js         # Helper functions for parsing, math, and price logic
├── product_extractor.js   # Product information extraction (Amazon, Target, Walmart)
├── comparison_modal.js    # Price comparison modal UI and logic
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

## Roadmap

### v0.2.0 — Price Comparison MVP
- ✅ Product extractor for Amazon, Target, and Walmart
  - Extract product name, price, SKU/UPC, brand, image URL
  - Site-specific selectors for accurate extraction
- ✅ Compare Prices button and modal
  - Clean, non-intrusive button next to product price
  - Modal popup with price comparison table
  - White and light blue theme
- ✅ Google Shopping API integration
  - Fetch real-time price comparisons
  - Display results with product names and images
- ✅ Price comparison indicators
  - Visual indicators (emoji/icons) showing if each retailer's price is better or worse than current page
- ✅ Comparison table features
  - Product images for each result
  - Clear price display
  - Direct links to other retailers

### v0.3.0 — Enhanced Comparison
- Expand to more retailers (Best Buy, eBay, etc.)
- Improved product matching accuracy
- Price history tracking (localStorage)
- Cache recent comparisons for faster loading
- Filter/sort options in comparison modal

### v0.4.0 — Price Alerts & History
- Price drop alerts and notifications
- Historical price charts showing trends over time
- Deal detection (highlight historically low prices)
- Save products to watchlist

### v0.5.0 — Advanced Features
- Price prediction using historical data
- Shipping cost comparison
- Tax estimation across different states
- Multi-product comparison (compare entire cart)

### v1.0.0 — Full-Featured Shopping Assistant
- Complete price comparison across 10+ major retailers
- Advanced product matching with AI
- Personalized deal recommendations
- Total savings tracking
- Integration with shopping lists

---

## Design Principles

- **Clean & Modest**: White and light blue color scheme
- **Non-Intrusive**: Subtle button placement, elegant modal design
- **Fast & Lightweight**: Efficient API calls, cached results
- **User-Friendly**: Clear visual indicators, intuitive interface

---

## Tech Stack

- JavaScript (content scripts, vanilla JS)
- Chrome Extensions API (Manifest V3)
- Google Shopping API (free tier)
- No frameworks required (keeping it lightweight)

---

## Supported Retailers

### Current (v0.2.0)
- Amazon
- Target
- Walmart

### Coming Soon
- Best Buy
- eBay
- Home Depot
- Costco
- And more...

---

## Notes

This project is evolving from a TruePrice calculator to a comprehensive price comparison tool. The goal is to help users make informed purchasing decisions by providing accurate, real-time price comparisons across major retailers.

The extension is built with simplicity and performance in mind—starting with core functionality and gradually adding advanced features as the foundation stabilizes.
