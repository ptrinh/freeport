/**
 * End-to-end over the REAL route stack (buildApp), booted on an ephemeral port
 * and driven with real HTTP requests. This is the layer the Umbrel reviewer
 * exercised: /health version, the machine-to-machine routes that sit in front
 * of Umbrel auth (/mcp, /vapidPublicKey, /subscribe, /unsubscribe), route
 * priority, and REQUIRE_SUBSCRIBE_AUTH gating. The Watcher is stubbed so no
 * relay sockets open; everything else (Express wiring, SubStore, VAPID, the MCP
 * transport handshake) is the production code path.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';

// No relay sockets during the suite.
vi.mock('../src/notify/watcher.js', () => ({
  Watcher: class { refresh() {} close() {} setTelegramSender() {} setIntentSink() {} },
}));

process.setMaxListeners(0); // SubStore registers an exit hook per instance

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const TOKEN = 'ExponentPushToken[e2e-device]';
const AUTH_KIND = 27235;
const nowSec = () => Math.floor(Date.now() / 1000);

let server: Server;
let base = '';

function proof(u = TOKEN, at = nowSec()) {
  return finalizeEvent({ kind: AUTH_KIND, created_at: at, tags: [['u', u], ['method', 'POST']], content: '' }, sk);
}
const get = (p: string) => fetch(base + p);
const postJson = (p: string, body: unknown) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'fp-e2e-'));
  process.env.ENABLE_WEB = '0';        // no web-dist in the test image
  process.env.ENABLE_RELAY = '0';      // relay is a separate WS port
  process.env.ENABLE_NOTIFY = '1';
  process.env.ENABLE_TELEGRAM = '0';
  process.env.REQUIRE_SUBSCRIBE_AUTH = '1';
  const { buildApp } = await import('../src/http.js');
  const { app } = buildApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
      resolve();
    });
  });
});

afterAll(() => { server?.close(); });

describe('GET /health', () => {
  it('reports the aligned version and enabled subsystems', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBe('0.7.0');       // the mismatch the reviewer flagged
    expect(body.name).toBe('freeport-nostr');
    expect(body.notify.enabled).toBe(true);
    expect(body.web.enabled).toBe(false);
    expect(body.relay.enabled).toBe(false);
    expect(body.telegram.enabled).toBe(false);
  });
});

describe('notifier routes (whitelisted from Umbrel auth)', () => {
  it('GET /vapidPublicKey returns a key', async () => {
    const res = await get('/vapidPublicKey');
    expect(res.status).toBe(200);
    expect(typeof (await res.json()).publicKey).toBe('string');
  });

  it('filter-only /subscribe needs no auth (public intents)', async () => {
    const res = await postJson('/subscribe', { expoPushToken: TOKEN, filters: { kinds: [1] } });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('DM-watch /subscribe without a proof is rejected (REQUIRE_SUBSCRIBE_AUTH)', async () => {
    const res = await postJson('/subscribe', { expoPushToken: TOKEN, filters: {}, pubkey: pk });
    expect(res.status).toBe(401);
  });

  it('DM-watch /subscribe with a valid kind-27235 proof is accepted', async () => {
    const res = await postJson('/subscribe', { expoPushToken: TOKEN, filters: {}, pubkey: pk, auth: proof() });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('DM-watch /subscribe with a proof signed by the WRONG key is rejected', async () => {
    const other = generateSecretKey();
    const bad = finalizeEvent({ kind: AUTH_KIND, created_at: nowSec(), tags: [['u', TOKEN], ['method', 'POST']], content: '' }, other);
    const res = await postJson('/subscribe', { expoPushToken: TOKEN, filters: {}, pubkey: pk, auth: bad });
    expect(res.status).toBe(401);
  });

  it('POST /unsubscribe accepts the transport key', async () => {
    const res = await postJson('/unsubscribe', { key: TOKEN });
    expect(res.status).toBe(200);
  });
});

describe('MCP route', () => {
  it('GET /mcp is 405 (stateless server, no SSE stream)', async () => {
    const res = await get('/mcp');
    expect(res.status).toBe(405);
    expect((await res.json()).error.code).toBe(-32000);
  });

  it('POST /mcp completes the initialize handshake (no relay hit)', async () => {
    const res = await fetch(base + '/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe('freeport-nostr');
  });
});

describe('CORS + route priority', () => {
  it('OPTIONS preflight short-circuits with 204 + wildcard origin', async () => {
    const res = await fetch(base + '/subscribe', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('an unknown path 404s when the web app is disabled (no SPA shadow of the API)', async () => {
    const res = await get('/definitely-not-a-route');
    expect(res.status).toBe(404);
  });
});
