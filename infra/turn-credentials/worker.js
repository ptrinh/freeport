/**
 * TURN credential minting for Freeport calls (Cloudflare Realtime TURN).
 *
 * The app POSTs /turn-credentials and gets back short-lived iceServers to use
 * as the TURN fallback when a direct WebRTC connection fails (~15–20% of
 * calls behind strict NAT). The Cloudflare API token NEVER ships to clients —
 * this worker holds it and mints ephemeral credentials per request.
 *
 * Setup (one-time):
 *   1. Cloudflare dashboard → Realtime → TURN — create a TURN key.
 *   2. wrangler secret put TURN_KEY_ID
 *      wrangler secret put TURN_API_TOKEN
 *   3. wrangler deploy   (route: turn.freeport.network — see wrangler.toml)
 *
 * Media through TURN stays DTLS-SRTP encrypted; the relay sees ciphertext.
 * Rate limit: coarse per-IP via Cloudflare's own limits; credentials are
 * capped at CRED_TTL so a leaked response ages out fast.
 */
const CRED_TTL_SECONDS = 7200;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (request.method !== 'POST' || !url.pathname.endsWith('/turn-credentials')) {
      return new Response('not found', { status: 404, headers: CORS });
    }
    if (!env.TURN_KEY_ID || !env.TURN_API_TOKEN) {
      return new Response(JSON.stringify({ error: 'TURN not configured' }), {
        status: 503,
        headers: { 'content-type': 'application/json', ...CORS },
      });
    }
    const resp = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.TURN_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: CRED_TTL_SECONDS }),
      },
    );
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: 'upstream error' }), {
        status: 502,
        headers: { 'content-type': 'application/json', ...CORS },
      });
    }
    const body = await resp.json();
    return new Response(JSON.stringify({ iceServers: body.iceServers ?? [] }), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
    });
  },
};
