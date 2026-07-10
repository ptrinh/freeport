#!/usr/bin/env node
/**
 * Self-hosted Freeport in a box — one process, one HTTP port (default 1988):
 *  - the FREEPORT WEB APP itself, served from ./web-dist (build with
 *    `npm run build:web`; set ENABLE_WEB=0 — or just don't build it — for the
 *    original API-only behavior, e.g. the hosted mcp.freeport.network)
 *  - POST /mcp — the stateless, read-only MCP endpoint (fresh server+transport
 *    per request, all sharing the process-wide `sharedPool`)
 *  - the Web Push notifier routes (/subscribe, /vapidPublicKey, /unsubscribe),
 *    stateful (subscription store + VAPID secret + a long-lived relay
 *    watcher); set ENABLE_NOTIFY=0 to disable
 *  - an embedded NIP-01 Nostr relay on its own WS port RELAY_PORT (default
 *    PORT+1 = 1989 — WebSocket can't share the HTTP port here); on by
 *    default, set ENABLE_RELAY=0 to disable
 *  - the Telegram bridge, when TELEGRAM_BOT_TOKEN is set
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, sharedPool, NAME, VERSION } from './server.js';
import { rateLimit } from './ratelimit.js';
import { mountNotify, type Notifier } from './notify/routes.js';
import { mountTelegram, type TelegramBridge } from './notify/telegram/index.js';

const PORT = Number(process.env.PORT ?? 1988);
const HOST = process.env.HOST ?? '127.0.0.1';
const NOTIFY = process.env.ENABLE_NOTIFY !== '0';
const TELEGRAM = process.env.ENABLE_TELEGRAM !== '0' && !!process.env.TELEGRAM_BOT_TOKEN;
const DATA_DIR = process.env.DATA_DIR ?? './data';
const WEB_DIR = path.resolve(process.env.WEB_DIR ?? './web-dist');
const WEB = process.env.ENABLE_WEB !== '0' && fs.existsSync(path.join(WEB_DIR, 'index.html'));

const app = express();
// Behind the Cloudflare tunnel: trust the proxy so req.ip / forwarded headers
// are meaningful (the rate limiter prefers CF-Connecting-IP regardless).
app.set('trust proxy', true);

// CORS: the web app / iOS PWA (e.g. freeport.network) and browser-based MCP
// clients call these endpoints cross-origin. They carry no cookies/credentials,
// so any origin is safe. Without this, the browser blocks /vapidPublicKey and
// /subscribe and the PWA reports "couldn't reach the notification service".
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-session-id, mcp-protocol-version');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  next();
});

app.use(express.json({ limit: '256kb' }));

// Rate-limit only the MCP/notify routes; /health stays free for the healthcheck.
const limiter = rateLimit();

// Stand up the notifier (if enabled) before routes so /health can report it.
let notifier: Notifier | null = null;
if (NOTIFY) notifier = mountNotify(app, sharedPool.relays, DATA_DIR, limiter);

// Telegram bridge (group feed + personal pings) — needs the notifier's watcher
// and store. Async (calls getMe on boot); errors are logged, not fatal.
let telegram: TelegramBridge | null = null;
if (TELEGRAM && notifier) {
  mountTelegram(app, notifier, DATA_DIR, limiter, sharedPool)
    .then((b) => { telegram = b; })
    .catch((err) => console.error('[telegram] failed to start bridge', err));
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true, name: NAME, version: VERSION, relays: sharedPool.relays,
    web: { enabled: WEB },
    notify: notifier ? { enabled: true, subscriptions: notifier.store.size() } : { enabled: false },
    relay: { enabled: process.env.ENABLE_RELAY !== '0' },
    telegram: telegram
      ? { enabled: true, groups: telegram.groups.size(), guests: telegram.guests?.size() ?? 0, guestMode: !!telegram.guests }
      : { enabled: TELEGRAM },
  });
});

app.post('/mcp', limiter, async (req, res) => {
  const server = createServer(); // uses sharedPool by default
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0', id: null,
        error: { code: -32603, message: 'Internal server error' },
      });
    }
    console.error('[freeport-nostr] request error', err);
  }
});

// GET/DELETE are only meaningful in stateful (SSE-stream) mode; reject cleanly.
const methodNotAllowed = (_req: express.Request, res: express.Response) =>
  res.status(405).json({
    jsonrpc: '2.0', id: null,
    error: { code: -32000, message: 'Method not allowed (stateless server).' },
  });
app.get('/mcp', limiter, methodNotAllowed);
app.delete('/mcp', limiter, methodNotAllowed);

// The Freeport web app itself. Mounted AFTER the API routes so /mcp, /health,
// and the notifier/telegram endpoints keep priority; the trailing GET fallback
// serves index.html for client-side routes (SPA), making http://host:1988/
// a complete self-hosted Freeport.
if (WEB) {
  app.use(express.static(WEB_DIR, { index: 'index.html', maxAge: '1h' }));
  app.get(/^\/(?!mcp|health|subscribe|unsubscribe|vapidPublicKey|telegram).*/, (req, res, next) => {
    if (req.method !== 'GET' || (req.headers.accept ?? '').indexOf('text/html') === -1) return next();
    res.sendFile(path.join(WEB_DIR, 'index.html'));
  });
}

app.listen(PORT, HOST, () => {
  console.error(
    `[freeport-self-hosted] http://${HOST}:${PORT} — ${WEB ? 'web + ' : ''}mcp${NOTIFY ? ' + notify' : ''}${TELEGRAM ? ' + telegram' : ''}`,
  );
});

// Embedded NIP-01 relay (on by default — this is "Freeport in a box"); runs on
// its own WS port since WebSocket can't share the express HTTP port here.
if (process.env.ENABLE_RELAY !== '0') {
  const relayPort = Number(process.env.RELAY_PORT ?? PORT + 1);
  const relayHost = process.env.RELAY_HOST ?? HOST;
  import('./relay.js')
    .then(({ startRelay }) => startRelay({ port: relayPort, host: relayHost }))
    .catch((e) => console.error('[freeport-self-hosted] relay failed to start', e));
}
