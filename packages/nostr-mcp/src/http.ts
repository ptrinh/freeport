#!/usr/bin/env node
/**
 * Streamable-HTTP entry — the hosted public endpoint (behind a TLS tunnel).
 *
 * Serves two things on ONE hostname:
 *  - POST /mcp — the stateless, read-only MCP endpoint (fresh server+transport
 *    per request, all sharing the process-wide `sharedPool`).
 *  - the Web Push notifier routes (/subscribe, /vapidPublicKey, /unsubscribe),
 *    which are stateful (subscription store + VAPID secret + a long-lived relay
 *    watcher). Enabled by default; set ENABLE_NOTIFY=0 to run MCP-only.
 */
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer, sharedPool, NAME, VERSION } from './server.js';
import { rateLimit } from './ratelimit.js';
import { mountNotify, type Notifier } from './notify/routes.js';
import { mountTelegram, type TelegramBridge } from './notify/telegram/index.js';

const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? '127.0.0.1';
const NOTIFY = process.env.ENABLE_NOTIFY !== '0';
const TELEGRAM = process.env.ENABLE_TELEGRAM !== '0' && !!process.env.TELEGRAM_BOT_TOKEN;
const DATA_DIR = process.env.DATA_DIR ?? './data';

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
    notify: notifier ? { enabled: true, subscriptions: notifier.store.size() } : { enabled: false },
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

app.listen(PORT, HOST, () => {
  console.error(`[freeport-nostr] HTTP server on http://${HOST}:${PORT}/mcp${NOTIFY ? ' (+notify)' : ''}`);
});
