# Super Shopper – Online Shopping Assistant - Chrome Extension (v0.1.0)

**Super Shopper** is a lightweight Chrome extension that displays the **TruePrice** of an item — including shipping and tax — directly on any supported product page.  
This is the foundation for a larger AI-powered shopping assistant that will eventually calculate the best discount chain and maximize savings automatically.

---

## Current Features (v0.1.0)

- Automatically detects product prices on retail websites.
- Calculates a **TruePrice** that includes:
  - Base price  
  - Estimated tax  
  - Estimated shipping  
- Injects the **TruePrice** directly into the webpage next to the product’s listed price.
- Runs entirely client-side; no backend required.

Note: Version 0.1.0 has a known issue where True Price labels may be detected as regular prices and reprocessed, causing looping. This will be fixed in v0.2.0.

---

## How It Works

The extension uses a simple content script (`content.js`) to:

1. Scan the DOM for common price selectors.  
2. Parse the price from the page.  
3. Apply tax and shipping logic.  
4. Inject a new DOM element labeled **TruePrice**.

---

## Project Structure

```
true-price-extension/
│
├── manifest.json          # Chrome extension config
├── content.js             # Main logic injected into pages
├── price_utils.js         # Helper functions for parsing, math, and price logic
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

1. Clone or download this repository.  
2. Open Chrome and go to `chrome://extensions/`.  
3. Enable Developer Mode.  
4. Click "Load unpacked."  
5. Select the project directory.

The extension will load immediately.

---

## Roadmap

### v0.2.0  
- Prevent True Price elements from being reprocessed  
- Improve price selector logic  
- Add basic site-specific rules (Amazon, Walmart, etc.)

### v0.3.0  
- Add discount code scanning UI (manual entry)

### v0.4.0  
- Add backend or API structure for coupon searching

### v0.5.0  
- Integrate AI-powered scoring to select the best discount code

### v1.0.0  
- Full AI-powered True Price and automatic discount application  
- Track total user savings  
- Add a Chrome extension settings page

---

## Tech Stack

- JavaScript (content scripts)  
- Chrome Extensions API  
- No frameworks required

---

## Notes

This project intentionally starts small. The goal is to build the core functionality first, refine it, and then layer in AI components once the foundation is stable.  
The structure is meant to be straightforward and easy to extend.