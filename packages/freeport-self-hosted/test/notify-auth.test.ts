/**
 * /subscribe proof-of-pubkey-ownership: enrolling a DM-watch on a pubkey must
 * carry a NIP-98-style event (kind 27235) signed BY that pubkey, fresh, and
 * bound to the request's push endpoint/token — otherwise anyone could watch an
 * arbitrary pubkey's inbound DMs and learn their timing metadata.
 *
 * Covers the verifier directly and the mounted Express route end-to-end (real
 * SubStore, Watcher stubbed so no relay sockets open).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';

vi.mock('../src/notify/watcher.js', () => ({
  Watcher: class { refresh() {} close() {} setTelegramSender() {} setIntentSink() {} },
}));

import { verifySubscribeAuth, AUTH_KIND, AUTH_MAX_SKEW_SEC } from '../src/notify/auth.js';
import { mountNotify } from '../src/notify/routes.js';

process.setMaxListeners(0); // SubStore registers exit hooks per instance

const sk = generateSecretKey();
const pk = getPublicKey(sk);
const skOther = generateSecretKey();

const TOKEN = 'ExponentPushToken[test-device-1]';
const now = () => Math.floor(Date.now() / 1000);

function proof(opts: { key?: Uint8Array; u?: string; at?: number } = {}) {
  return finalizeEvent({
    kind: AUTH_KIND,
    created_at: opts.at ?? now(),
    tags: [['u', opts.u ?? TOKEN], ['method', 'POST']],
    content: '',
  }, opts.key ?? sk);
}

describe('verifySubscribeAuth', () => {
  it('accepts a valid proof', () => {
    expect(verifySubscribeAuth(proof(), pk, TOKEN)).toEqual({ ok: true });
  });

  it('rejects a proof signed by a different key', () => {
    const r = verifySubscribeAuth(proof({ key: skOther }), pk, TOKEN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/watched pubkey/);
  });

  it('rejects a stale timestamp (and a future one)', () => {
    const stale = verifySubscribeAuth(proof({ at: now() - AUTH_MAX_SKEW_SEC - 60 }), pk, TOKEN);
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toMatch(/created_at/);
    const future = verifySubscribeAuth(proof({ at: now() + AUTH_MAX_SKEW_SEC + 60 }), pk, TOKEN);
    expect(future.ok).toBe(false);
  });

  it('rejects an endpoint mismatch (proof bound to another endpoint)', () => {
    const r = verifySubscribeAuth(proof({ u: 'ExponentPushToken[attacker-device]' }), pk, TOKEN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/u tag/);
  });

  it('rejects a tampered event (valid shape, broken signature)', () => {
    const ev = { ...proof(), content: 'tampered' };
    const r = verifySubscribeAuth(ev, pk, TOKEN);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/signature/);
  });

  it('rejects a wrong kind and junk shapes', () => {
    const ev = finalizeEvent({ kind: 1, created_at: now(), tags: [['u', TOKEN]], content: '' }, sk);
    expect(verifySubscribeAuth(ev, pk, TOKEN).ok).toBe(false);
    expect(verifySubscribeAuth(null, pk, TOKEN).ok).toBe(false);
    expect(verifySubscribeAuth({}, pk, TOKEN).ok).toBe(false);
  });
});

describe('POST /subscribe (mounted route)', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const dataDir = join(tmpdir(), `freeport-notify-auth-test-${process.pid}-${Date.now()}`);
    mountNotify(app, ['ws://fake'], dataDir, (_req, _res, next) => next());
    await new Promise<void>((r) => { server = app.listen(0, r); });
    base = `http://127.0.0.1:${(server.address() as any).port}`;
  });
  afterAll(() => { server?.close(); });
  afterEach(() => { delete process.env.REQUIRE_SUBSCRIBE_AUTH; });

  const post = (body: unknown) => fetch(`${base}/subscribe`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  it('accepts a pubkey watch with a valid proof', async () => {
    const res = await post({ expoPushToken: TOKEN, pubkey: pk, filters: {}, auth: proof() });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it('rejects a proof signed by the wrong key (401)', async () => {
    const res = await post({ expoPushToken: TOKEN, pubkey: pk, filters: {}, auth: proof({ key: skOther }) });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/invalid auth/);
  });

  it('rejects a stale proof (401)', async () => {
    const res = await post({ expoPushToken: TOKEN, pubkey: pk, filters: {}, auth: proof({ at: now() - AUTH_MAX_SKEW_SEC - 60 }) });
    expect(res.status).toBe(401);
  });

  it('rejects a proof bound to a different endpoint (401)', async () => {
    const res = await post({ expoPushToken: TOKEN, pubkey: pk, filters: {}, auth: proof({ u: 'ExponentPushToken[other]' }) });
    expect(res.status).toBe(401);
  });

  it('still accepts a proofless legacy subscribe (compat) — until REQUIRE_SUBSCRIBE_AUTH', async () => {
    const legacy = await post({ expoPushToken: TOKEN, pubkey: pk, filters: {} });
    expect(legacy.status).toBe(200);

    process.env.REQUIRE_SUBSCRIBE_AUTH = '1';
    const rejected = await post({ expoPushToken: TOKEN, pubkey: pk, filters: {} });
    expect(rejected.status).toBe(401);
    // …but a proof still gets through with enforcement on.
    const proven = await post({ expoPushToken: TOKEN, pubkey: pk, filters: {}, auth: proof() });
    expect(proven.status).toBe(200);
  });

  it('needs no proof when no pubkey is watched (intent-only subscription)', async () => {
    process.env.REQUIRE_SUBSCRIBE_AUTH = '1';
    const res = await post({ expoPushToken: 'ExponentPushToken[intent-only]', filters: { topics: ['sg'] } });
    expect(res.status).toBe(200);
  });

  it('unsubscribe of an endpoint requires no proof', async () => {
    const res = await fetch(`${base}/unsubscribe`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expoPushToken: TOKEN }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
