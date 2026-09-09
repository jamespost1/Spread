#!/usr/bin/env node
// Upload and publish a build to the Chrome Web Store.
//
// Usage: node scripts/publish-cws.mjs <zip-path>
// Requires EXTENSION_ID, CLIENT_ID, CLIENT_SECRET and REFRESH_TOKEN in the
// environment. See docs/PUBLISHING.md for how to mint those once.

import { readFileSync } from 'node:fs';

const [zipPath] = process.argv.slice(2);
if (!zipPath) {
  console.error('usage: publish-cws.mjs <zip-path>');
  process.exit(1);
}

const { EXTENSION_ID, CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN } = process.env;
for (const [name, value] of Object.entries({ EXTENSION_ID, CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN })) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
}

const token = await getAccessToken();
await upload(token);
await publish(token);
console.log('  ✓ Published to the Chrome Web Store');

// ---------------------------------------------------------------------------

async function getAccessToken() {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`OAuth failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()).access_token;
}

async function upload(token) {
  const response = await fetch(
    `https://www.googleapis.com/upload/chromewebstore/v1.1/items/${EXTENSION_ID}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
      body: readFileSync(zipPath),
    }
  );

  const result = await response.json();
  if (result.uploadState === 'FAILURE') {
    throw new Error(`Upload failed: ${JSON.stringify(result.itemError)}`);
  }
  console.log(`  ✓ Uploaded (${result.uploadState})`);
}

async function publish(token) {
  const response = await fetch(
    `https://www.googleapis.com/chromewebstore/v1.1/items/${EXTENSION_ID}/publish`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-goog-api-version': '2',
        'Content-Length': '0',
      },
    }
  );

  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Publish failed: ${JSON.stringify(result)}`);
  }
  // Google returns status codes here rather than HTTP errors for review states.
  console.log(`  ✓ Publish status: ${(result.status || []).join(', ') || 'OK'}`);
}
