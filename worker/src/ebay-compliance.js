// eBay Marketplace Account Deletion / Closure notification endpoint.
//
// eBay requires every production application to host a URL that handles account
// deletion notifications before it will release production API access. The
// endpoint has to do two things:
//
//   GET  with ?challenge_code=...  -> prove ownership by returning
//        SHA-256(challengeCode + verificationToken + endpointUrl) as hex.
//   POST with a notification body  -> acknowledge with a 2xx.
//
// Spread stores nothing about any eBay user -- it only reads public listing
// data -- so there is no personal data to erase when a notification arrives.
// The endpoint still has to exist and respond correctly, and the acknowledgement
// is logged so the obligation is auditable.

/**
 * Handle eBay's ownership challenge.
 *
 * The hash input must be the endpoint URL exactly as registered in the eBay
 * developer console, which is why it comes from configuration rather than from
 * the request -- a proxy that rewrites the host would otherwise break
 * verification in a way that is very hard to diagnose.
 *
 * @param {URL} url
 * @param {object} env
 * @returns {Promise<Response>}
 */
export async function handleChallenge(url, env) {
  const challengeCode = url.searchParams.get('challenge_code');
  if (!challengeCode) {
    return json({ error: 'missing_challenge_code' }, 400);
  }

  const verificationToken = env.EBAY_VERIFICATION_TOKEN;
  if (!verificationToken) {
    console.error('EBAY_VERIFICATION_TOKEN is not configured');
    return json({ error: 'endpoint_not_configured' }, 500);
  }

  const endpoint = env.EBAY_NOTIFICATION_ENDPOINT || `${url.origin}${url.pathname}`;

  // Order matters: challengeCode, then token, then endpoint.
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(challengeCode + verificationToken + endpoint)
  );

  return new Response(JSON.stringify({ challengeResponse: toHex(digest) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Acknowledge an account deletion notification.
 *
 * eBay retries on any non-2xx, so this always returns 200 once the payload is
 * readable. There is no user data to delete; the log line is the audit trail.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleNotification(request) {
  const body = await request.json().catch(() => null);

  if (!body) {
    // Still a 200: an unparseable body is not something a retry will fix.
    console.warn('ebay account-deletion notification had no readable body');
    return new Response(null, { status: 200 });
  }

  const username = body?.notification?.data?.username || 'unknown';
  console.log(
    `ebay account-deletion notification acknowledged for ${username}; ` +
      'no stored personal data to erase'
  );

  return new Response(null, { status: 200 });
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
