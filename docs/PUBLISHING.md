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

- **Name:** Spread — Real prices across retailers
- **Category:** Shopping
- **Privacy policy URL:** `https://jamespost1.github.io/super-shopper/privacy.html`
  (enable GitHub Pages on the `docs/` folder first)
- **Single purpose:** "Show the price of the product the user is viewing at other retailers."
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
