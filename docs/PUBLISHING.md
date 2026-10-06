# Publishing Spread

One-time setup for automated releases, then `npm version <x.y.z> && git push --follow-tags` ships.

## 1. Chrome Web Store developer account — $5, once

Register at [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
and pay the one-time $5 fee. There is no renewal and no per-extension charge.

## 2. First upload, by hand

The API can only update an extension that already exists, so the first release is manual:

```bash
npm run zip     # produces spread-extension.zip
```

Upload it in the developer console and fill in the listing. Keep the item ID from the URL — that is
`CWS_EXTENSION_ID`.

### Listing content

- **Name:** Spread — Price history & comparison
- **Category:** Shopping
- **Privacy policy URL:** `https://jamespost1.github.io/Spread/privacy.html`
  (enable GitHub Pages on the `docs/` folder first)
- **Single purpose:** "Show the price history of the product the user is viewing, and its price at other retailers where known."
- **Permission justifications:**
  - `storage` — persists the user's local savings total and settings.
  - `activeTab` — lets the toolbar popup report whether Spread is active on the current tab.
  - Host permissions — reads the product title and price on the six supported retailer sites.
- **Data disclosure:** answer *no* to every collection category except "Website content".
  Declare that it is transferred off-device, and be precise about when: product title and price are
  sent on product-page views at the six supported retailers, not only on click. Stored records carry
  no user identifier. It is not sold, not used for creditworthiness, and not used for any purpose
  unrelated to the extension's single purpose. The privacy policy spells this out -- keep the two
  consistent, since a mismatch between them is a common rejection reason.

### Listing copy — paste as-is

**Short description** (132 character limit, currently 104):

```
Know whether today's price is actually good. Spread tracks price history on the product pages you visit.
```

**Detailed description:**

```
Spread tells you whether the price in front of you is actually a good one.

Open a product page at Amazon, Target, Walmart, Best Buy, eBay or Costco and Spread
quietly records what it costs. Come back later and it tells you whether the price
moved — "Lowest price in 23 days", or "$50 above the low". When it can confirm the
same product cheaper somewhere else, it tells you that too.

WHAT MAKES IT DIFFERENT

Spread will not show you a price it cannot stand behind. Every number it quotes was
read from the page it links to — that retailer's own listing, not a search result or
a cached figure. When a price cannot be confirmed, Spread names the retailer and says
so instead of guessing.

That means you will sometimes see fewer results than other comparison tools show you.
It also means the numbers are real.

It is equally careful about what counts as the same product. A carrying case that
mentions your headphones is not your headphones. A refurbished unit is not a new one.
A bundle with a charger thrown in is not the standalone item. "Apple Watch Series 9"
and "Series 8" are 88% identical as text and a hundred dollars apart — Spread treats
them as different, because they are.

HOW TO USE IT

• A small Spread panel appears on supported product pages
• Click it for price history and any confirmed cheaper offers
• Price history needs a second visit to say anything useful — there is nothing to
  compare against the first time you look

PRIVACY

No account. No sign-up. No tracking. No ads.

On supported product pages, Spread sends that product's title and price to its own
service so the price joins the product's history. What gets stored is a fact about the
product — "this cost $328 at Best Buy at this time" — with no record of who saw it.
Nothing you view on any other website is ever sent, because the extension cannot run
anywhere else.

Full policy: https://jamespost1.github.io/Spread/privacy.html

SUPPORTED RETAILERS

Amazon · Target · Walmart · Best Buy · eBay · Costco

Spread is open source. Everything described here can be verified by reading the code:
https://github.com/jamespost1/Spread
```

### Review form answers — paste as-is

**Single purpose:**

```
Show the price history of the product the user is viewing, and its price at other
retailers where that price can be verified.
```

**Why `storage`:**

```
Stores the user's price-history settings and their running total of savings found, on
their own device. Nothing in storage leaves the browser.
```

**Why `activeTab`:**

```
The toolbar popup reads the current tab's URL to tell the user whether Spread is
active on the page they are looking at. No page content is accessed.
```

**Why host permissions for the six retailer domains:**

```
Spread reads the product title and price from product pages at these six retailers in
order to show the user that product's price history and compare it with other
retailers. It cannot run on any other site.
```

**Why host permission for spread-api.jamesbpost.workers.dev:**

```
The extension's own backend. It performs the price lookups and holds the API
credentials, so that no credentials ship inside the extension.
```

**Data use disclosure:** tick **"Website content"** only, and mark it as transferred
off-device. Leave every other category unticked — no PII, no health, no financial
information, no authentication data, no location, no activity tracking.

Then certify all three statements: not sold to third parties, not used or transferred
for any purpose unrelated to the single purpose, and not used to determine
creditworthiness or for lending.

> **Be precise about timing.** Product title and price are sent on product-page
> *views*, not only when the user clicks. The privacy policy says this explicitly, and
> a mismatch between the policy and the disclosure is a common rejection reason.

### Assets you need

| Asset | Size | Notes |
|---|---|---|
| Icon | 128×128 | already at `public/icons/icon-128.png` |
| Screenshots | 1280×800 | at least one; the comparison panel on a real product page |
| Small promo tile | 440×280 | optional but improves placement |

## 3. API credentials for automated releases

Chrome Web Store uploads go through a Google Cloud OAuth client.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the
   **Chrome Web Store API**.
2. Create an **OAuth client ID** of type *Desktop app*. Note the client ID and secret.
3. Authorize once to mint a refresh token. Visit this URL in a browser, substituting your client ID:

   ```
   https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&client_id=YOUR_CLIENT_ID&redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```

   Exchange the resulting code for a refresh token:

   ```bash
   curl -s https://oauth2.googleapis.com/token \
     -d client_id=YOUR_CLIENT_ID \
     -d client_secret=YOUR_CLIENT_SECRET \
     -d code=THE_CODE \
     -d grant_type=authorization_code \
     -d redirect_uri=urn:ietf:wg:oauth:2.0:oob
   ```

4. Add four **repository secrets** in GitHub → Settings → Secrets → Actions:

   `CWS_EXTENSION_ID` · `CWS_CLIENT_ID` · `CWS_CLIENT_SECRET` · `CWS_REFRESH_TOKEN`

## 4. Cloudflare credentials

Add two more repository secrets so the Worker deploys on the same tag:

- `CLOUDFLARE_API_TOKEN` — a token with the *Edit Cloudflare Workers* template
- `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard sidebar

Set the Worker's own secrets once, directly:

```bash
cd worker
npx wrangler kv namespace create SPREAD_KV   # paste the id into wrangler.toml
npx wrangler secret put BESTBUY_API_KEY
npx wrangler secret put EBAY_CLIENT_ID
npx wrangler secret put EBAY_CLIENT_SECRET
npx wrangler secret put ANTHROPIC_API_KEY    # optional
npx wrangler deploy
```

## 4b. eBay production access

eBay will not release a production keyset until you host a Marketplace Account
Deletion notification endpoint and it passes their challenge verification. The
Worker implements this at `/ebay/account-deletion`.

1. Invent a verification token (32-80 alphanumeric characters) and set it:

   ```bash
   cd worker
   npx wrangler secret put EBAY_VERIFICATION_TOKEN
   ```

2. Uncomment `EBAY_NOTIFICATION_ENDPOINT` in `wrangler.toml` and set it to your
   deployed URL. **It must match what you register with eBay byte for byte** --
   it is part of the verification hash.

   ```toml
   EBAY_NOTIFICATION_ENDPOINT = "https://spread-api.<subdomain>.workers.dev/ebay/account-deletion"
   ```

3. `npx wrangler deploy`, then confirm it answers:

   ```bash
   curl "https://spread-api.<subdomain>.workers.dev/ebay/account-deletion?challenge_code=test"
   # -> {"challengeResponse":"<64 hex chars>"}
   ```

4. In the eBay developer console, under **Alerts and Notifications** ->
   *Marketplace account deletion*, enter the same endpoint URL and the same
   token, then click Send Test Notification. It must go green before eBay will
   grant production access.

If eBay offers an exemption path instead (Spread stores no eBay user data), that
also works -- but the endpoint is already built, so verifying is usually faster
than arguing for an exemption.

## 4c. Best Buy requires a non-free email domain

Best Buy's developer signup rejects Gmail, Outlook and `.edu` addresses. You need
an address on a domain you control. The cheapest route:

1. Register a domain at [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/)
   (sold at wholesale, no renewal markup -- about $11/yr for a `.com`).
2. Enable **Cloudflare Email Routing** on it -- free -- and forward
   `you@yourdomain.com` to your Gmail.
3. Register at [developer.bestbuy.com](https://developer.bestbuy.com/) with that
   address.

The domain doubles as the landing page host, which reads far better than a
`github.io` URL on a resume.

## 4d. Watch for an expired adjudicator key

Anthropic API keys can expire. Expiry is silent from the extension's side:
matching quietly stops confirming ambiguous pairs and falls back to "similar".

`/health` reports it, because "configured" only means a key is present and an
expired key is still present:

```bash
curl -s https://spread-api.jamesbpost.workers.dev/health | jq .adjudicator
```

A `healthy: false` with `credential: true` means the key was rejected. Rotate it:

```bash
cd worker
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler deploy
```

Billing note: a Claude Pro or Max subscription does **not** cover API usage.
The API is metered separately at console.anthropic.com.

## 5. Lock down CORS after the first publish

Once the extension has a stable Web Store ID, restrict the Worker to it — until then any page can
call your API:

```toml
# worker/wrangler.toml
[vars]
ALLOWED_ORIGIN = "chrome-extension://<your-extension-id>"
```

Then redeploy. Also update `host_permissions` and `DEFAULT_API_BASE` in
`src/background/index.js` to your real Worker URL before the first release.

## Release checklist

- [ ] `npm test` and `npm run eval` pass
- [ ] `npm run build && node scripts/verify-build.mjs` passes
- [ ] Version bumped in `public/manifest.json` **and** `package.json`
- [ ] Privacy policy live at its GitHub Pages URL
- [ ] Worker deployed and `/health` returns `ok`
- [ ] `ALLOWED_ORIGIN` set to the published extension ID
