/**
 * The mini-app SDK (packages/miniapp-sdk/freeport-sdk.js) is the page-side
 * half of the security-hardened shell↔mini-app bridge, and until now nothing
 * exercised it — a regression in the handshake or RPC framing would ship
 * silently. The file is a browser IIFE, so run it against a minimal fake
 * `window` (no jsdom needed): what matters is the protocol, not the DOM.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SDK_SRC = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/miniapp-sdk/freeport-sdk.js'),
  'utf8',
);

type Listener = (e: unknown) => void;

/** Minimal window double. `embedded` controls the iframe/opener detection. */
function makeWindow(opts: { embedded?: boolean } = {}) {
  const listeners = new Map<string, Listener[]>();
  const win: any = {
    opener: null,
    addEventListener(type: string, fn: Listener) {
      const arr = listeners.get(type) ?? [];
      arr.push(fn);
      listeners.set(type, arr);
    },
    dispatchEvent() { return true; },
    emit(type: string, ev: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(ev);
    },
  };
  win.top = opts.embedded === false ? win : {};
  return win;
}

/** Fake MessagePort capturing everything the SDK posts. */
function makePort() {
  return {
    sent: [] as string[],
    onmessage: null as null | ((ev: { data: string }) => void),
    postMessage(msg: string) { this.sent.push(msg); },
    start() {},
    close() {},
  };
}

function loadSdk(win: any) {
  // The IIFE only touches `window` (plus Event/setTimeout, which Node has).
  new Function('window', SDK_SRC)(win);
}

function connect(win: any, port: ReturnType<typeof makePort>, origin = 'https://freeport.network') {
  win.emit('message', { data: { __fp: 'connect' }, origin, ports: [port] });
}

describe('miniapp SDK', () => {
  it('does nothing in a top-level tab (never shadows a real NIP-07 extension)', () => {
    const win = makeWindow({ embedded: false });
    loadSdk(win);
    expect(win.nostr).toBeUndefined();
    expect(win.webln).toBeUndefined();
    expect(win.freeport).toBeUndefined();
  });

  it('does not install over the native shell shim', () => {
    const win = makeWindow();
    win.__fpMiniApp = true;
    loadSdk(win);
    expect(win.nostr).toBeUndefined();
  });

  it('installs nostr/webln/freeport when embedded', () => {
    const win = makeWindow();
    loadSdk(win);
    expect(typeof win.nostr.getPublicKey).toBe('function');
    expect(typeof win.webln.sendPayment).toBe('function');
    expect(typeof win.freeport.paySpark).toBe('function');
    expect(win.freeport.isConnected()).toBe(false);
  });

  it('ignores a connect message that carries no MessagePort', () => {
    const win = makeWindow();
    loadSdk(win);
    win.emit('message', { data: { __fp: 'connect' }, origin: 'https://evil.example', ports: [] });
    expect(win.freeport.isConnected()).toBe(false);
    expect(win.freeport.shellOrigin()).toBe('');
  });

  it('ignores messages that are not the handshake', () => {
    const win = makeWindow();
    loadSdk(win);
    const port = makePort();
    win.emit('message', { data: { __fp: 1, id: 'x' }, origin: 'https://evil.example', ports: [port] });
    win.emit('message', { data: 'hello', origin: 'https://evil.example', ports: [port] });
    expect(win.freeport.isConnected()).toBe(false);
  });

  it('handshake sends the hello ack, records the shell origin and flushes queued RPCs', async () => {
    const win = makeWindow();
    loadSdk(win);
    const p = win.nostr.getPublicKey(); // queued — no port yet
    const port = makePort();
    connect(win, port);
    expect(win.freeport.isConnected()).toBe(true);
    expect(win.freeport.shellOrigin()).toBe('https://freeport.network');
    expect(port.sent[0]).toBe('__fp_hello');
    const req = JSON.parse(port.sent[1]);
    expect(req.__fp).toBe(1);
    expect(req.method).toBe('getPublicKey');
    // Shell replies on the port → the queued promise resolves.
    port.onmessage!({ data: JSON.stringify({ id: req.id, ok: true, result: 'npub-hex' }) });
    await expect(p).resolves.toBe('npub-hex');
  });

  it('rejects the RPC promise when the shell denies', async () => {
    const win = makeWindow();
    loadSdk(win);
    const port = makePort();
    connect(win, port);
    const p = win.webln.sendPayment('lnbc1...');
    const req = JSON.parse(port.sent.at(-1)!);
    expect(req.method).toBe('webln.sendPayment');
    port.onmessage!({ data: JSON.stringify({ id: req.id, ok: false, error: 'denied' }) });
    await expect(p).rejects.toThrow('denied');
  });

  it('ignores malformed or unknown-id port replies', () => {
    const win = makeWindow();
    loadSdk(win);
    const port = makePort();
    connect(win, port);
    // None of these must throw or resolve anything.
    port.onmessage!({ data: 'not json' });
    port.onmessage!({ data: JSON.stringify({ ok: true }) });
    port.onmessage!({ data: JSON.stringify({ id: 'unknown', ok: true, result: 'x' }) });
  });

  it('a re-handshake replaces the port (shell reloaded, page kept alive)', async () => {
    const win = makeWindow();
    loadSdk(win);
    const port1 = makePort();
    connect(win, port1);
    const port2 = makePort();
    connect(win, port2, 'https://freeport.network');
    const p = win.nostr.getPublicKey();
    expect(port2.sent.filter((m) => m !== '__fp_hello').length).toBe(1);
    expect(port1.sent.filter((m) => m !== '__fp_hello').length).toBe(0);
    const req = JSON.parse(port2.sent.at(-1)!);
    port2.onmessage!({ data: JSON.stringify({ id: req.id, ok: true, result: 'pk' }) });
    await expect(p).resolves.toBe('pk');
  });

  it('rejects a queued RPC after the connect timeout when no shell ever appears', async () => {
    vi.useFakeTimers();
    try {
      const win = makeWindow();
      loadSdk(win);
      const p = win.nostr.getPublicKey();
      const assertion = expect(p).rejects.toThrow('no Freeport shell');
      vi.advanceTimersByTime(15001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
