/**
 * Adversarial suite for the mini-app bridge (mechanism). The firewall suite
 * proves the POLICY; this one proves the plumbing can't be tricked around it:
 * forged messages, lied-about amounts, template smuggling, grant escalation,
 * response-injection escapes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateSecretKey, getPublicKey, verifyEvent } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { MiniAppFirewall } from '../src/miniapps/firewall';
import { MiniAppBridge, sanitizeTemplate, encodeResponseJs, type BridgeDeps, type ApprovalRequest } from '../src/miniapps/bridge';
import { MINIAPP_SHIM } from '../src/miniapps/shim';
import { LocalSigner } from '../src/signer';

const APP = 'https://rides.example';
const T0 = 1_800_000_000_000;
const sk = generateSecretKey();
const signer = new LocalSigner(sk);
const peerSk = generateSecretKey();
const PEER = getPublicKey(peerSk);

function makeBridge(over?: Partial<BridgeDeps> & { approveResult?: { ok: boolean; remember?: boolean } }) {
  const firewall = new MiniAppFirewall();
  firewall.registerApp(APP, 'Rides', T0);
  const approvals: ApprovalRequest[] = [];
  const approve = vi.fn(async (req: ApprovalRequest) => {
    approvals.push(req);
    return over?.approveResult ?? { ok: true };
  });
  const wallet = {
    makeInvoice: vi.fn(async () => 'lnbc_test_invoice'),
    payInvoice: vi.fn(async () => ({ preimage: 'f'.repeat(64) })),
    parseAmount: vi.fn((_: string) => 500),
    paySpark: vi.fn(async () => ({ preimage: 'e'.repeat(64) })),
  };
  const persist = vi.fn();
  let now = T0;
  const deps: BridgeDeps = { firewall, signer, approve, wallet, persist, now: () => (now += 15_000), ...over };
  const bridge = new MiniAppBridge(deps, APP + '/index.html');
  return { bridge, firewall, approve, approvals, wallet, persist };
}

async function call(bridge: MiniAppBridge, method: string, params?: unknown, id = 'r1') {
  const raw = await bridge.handleMessage(JSON.stringify({ __fp: 1, id, method, params }));
  return raw ? JSON.parse(raw) : null;
}

describe('message parsing (hostile input)', () => {
  it.each([
    ['garbage', 'not json'],
    ['missing flag', JSON.stringify({ id: 'x', method: 'getPublicKey' })],
    ['wrong flag', JSON.stringify({ __fp: 2, id: 'x', method: 'getPublicKey' })],
    ['no id', JSON.stringify({ __fp: 1, method: 'getPublicKey' })],
    ['numeric id', JSON.stringify({ __fp: 1, id: 7, method: 'getPublicKey' })],
    ['oversized id', JSON.stringify({ __fp: 1, id: 'x'.repeat(100), method: 'getPublicKey' })],
    ['method not string', JSON.stringify({ __fp: 1, id: 'x', method: ['signEvent'] })],
  ])('%s is dropped silently — no error oracle', async (_label, raw) => {
    const { bridge } = makeBridge();
    expect(await bridge.handleMessage(raw)).toBeNull();
  });

  it('oversized payloads are dropped before parsing', async () => {
    const { bridge } = makeBridge();
    const raw = JSON.stringify({ __fp: 1, id: 'x', method: 'signEvent', params: { event: { kind: 1, content: 'z'.repeat(300_000) } } });
    expect(await bridge.handleMessage(raw)).toBeNull();
  });

  it('unknown methods come back as a generic denial', async () => {
    const { bridge } = makeBridge();
    expect(await call(bridge, 'getSecretKey')).toEqual({ id: 'r1', ok: false, error: 'denied' });
  });
});

describe('origin tracking', () => {
  it('permissions die on navigation to another origin and revive on return', async () => {
    const { bridge, firewall } = makeBridge();
    firewall.grantPubkey(APP);
    expect((await call(bridge, 'getPublicKey')).ok).toBe(true);
    bridge.setOrigin('https://evil.example/phish');
    expect(await call(bridge, 'getPublicKey')).toEqual({ id: 'r1', ok: false, error: 'denied' });
    bridge.setOrigin(APP + '/back');
    expect((await call(bridge, 'getPublicKey')).ok).toBe(true);
  });

  it('a bridge landed on a non-https URL denies everything', async () => {
    const { bridge } = makeBridge();
    bridge.setOrigin('about:blank');
    expect((await call(bridge, 'getPublicKey')).ok).toBe(false);
  });
});

describe('signEvent', () => {
  it('signs a sanitized template after approval; result verifies; page pubkey is ignored', async () => {
    const { bridge, approvals } = makeBridge({ approveResult: { ok: true } });
    const res = await call(bridge, 'signEvent', {
      event: { kind: 1, content: 'hello', tags: [['t', 'x']], pubkey: 'b'.repeat(64), id: 'forged', sig: 'forged' },
    });
    expect(res.ok).toBe(true);
    expect(verifyEvent(res.result)).toBe(true);
    expect(res.result.pubkey).toBe(signer.pubkey); // forged pubkey discarded
    expect(approvals[0]).toMatchObject({ method: 'signEvent', kind: 1, contentPreview: 'hello' });
  });

  it('user rejection returns an error and nothing is signed', async () => {
    const { bridge } = makeBridge({ approveResult: { ok: false } });
    expect(await call(bridge, 'signEvent', { event: { kind: 1, content: 'x' } }))
      .toEqual({ id: 'r1', ok: false, error: 'denied by user' });
  });

  it('"always allow" persists the grant — second call needs no dialog', async () => {
    const { bridge, approve } = makeBridge({ approveResult: { ok: true, remember: true } });
    await call(bridge, 'signEvent', { event: { kind: 30023, content: 'a' } });
    await call(bridge, 'signEvent', { event: { kind: 30023, content: 'b' } }, 'r2');
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it('"always allow" on a SENSITIVE kind does NOT persist — every DM signature asks again', async () => {
    const { bridge, approve, firewall } = makeBridge({ approveResult: { ok: true, remember: true } });
    await call(bridge, 'signEvent', { event: { kind: 4, content: 'dm1' } });
    await call(bridge, 'signEvent', { event: { kind: 4, content: 'dm2' } }, 'r2');
    expect(approve).toHaveBeenCalledTimes(2);
    expect(firewall.getApp(APP)!.perms.kinds).toEqual([]);
  });
});

describe('sanitizeTemplate', () => {
  it.each([
    [null], ['string'], [{}], [{ kind: '1', content: 'x' }], [{ kind: 1 }],
    [{ kind: 1, content: 5 }], [{ kind: 1, content: 'x', tags: 'nope' }],
    [{ kind: 1, content: 'x', tags: [['a', 7]] }],
    [{ kind: 1, content: 'x', tags: Array(101).fill(['t']) }],
    [{ kind: 1, content: 'x', tags: [Array(21).fill('t')] }],
  ] as unknown[][])('rejects %j', (input) => {
    expect(sanitizeTemplate(input)).toBeNull();
  });

  it('keeps only whitelisted fields and fills created_at', () => {
    const t = sanitizeTemplate({ kind: 1, content: 'x', tags: [['e', 'abc']], extra: 1, sig: 'x' })!;
    expect(Object.keys(t).sort()).toEqual(['content', 'created_at', 'kind', 'tags']);
    expect(t.created_at).toBeGreaterThan(0);
  });
});

describe('nip04 / nip44 round-trips', () => {
  it('nip44 encrypt via bridge decrypts with the peer key', async () => {
    const { bridge, firewall } = makeBridge();
    firewall.grantPeer(APP, 'encrypt', PEER);
    const res = await call(bridge, 'nip44.encrypt', { peer: PEER, plaintext: 'secret deal' });
    expect(res.ok).toBe(true);
    const key = nip44.getConversationKey(peerSk, signer.pubkey);
    expect(nip44.decrypt(res.result, key)).toBe('secret deal');
  });

  it('decrypt of a granted peer works; ungranted peer asks first', async () => {
    const { bridge, firewall, approve } = makeBridge({ approveResult: { ok: true } });
    const key = nip44.getConversationKey(peerSk, signer.pubkey);
    const ct = nip44.encrypt('incoming', key);
    const res = await call(bridge, 'nip44.decrypt', { peer: PEER, ciphertext: ct });
    expect(approve).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ ok: true, result: 'incoming' });
    firewall.grantPeer(APP, 'decrypt', PEER);
    await call(bridge, 'nip44.decrypt', { peer: PEER, ciphertext: ct }, 'r2');
    expect(approve).toHaveBeenCalledTimes(1); // no second dialog
  });

  it('bad peer / bad ciphertext yields a generic error, not a crash or stack trace', async () => {
    const { bridge, firewall } = makeBridge();
    firewall.grantPeer(APP, 'decrypt', PEER);
    const res = await call(bridge, 'nip44.decrypt', { peer: PEER, ciphertext: 'not-a-ciphertext' });
    expect(res).toEqual({ id: 'r1', ok: false, error: 'operation failed' });
  });
});

describe('payments', () => {
  it('the amount shown to the user comes from the INVOICE, not the app\'s claim', async () => {
    const { bridge, approvals, wallet } = makeBridge({ approveResult: { ok: true } });
    wallet.parseAmount.mockReturnValue(50_000);
    await call(bridge, 'webln.sendPayment', { invoice: 'lnbc_real', amountSats: 1 }); // app lies: "1 sat"
    expect(approvals[0].amountSats).toBe(50_000);
  });

  it('successful payment records spend and persists', async () => {
    const { bridge, firewall, wallet, persist } = makeBridge({ approveResult: { ok: true } });
    wallet.parseAmount.mockReturnValue(777);
    const res = await call(bridge, 'webln.sendPayment', { invoice: 'lnbc_x' });
    expect(res.ok).toBe(true);
    expect(firewall.spentToday(APP, T0 + 60_000)).toBe(777);
    expect(persist).toHaveBeenCalled();
  });

  it('user rejection means the wallet is never touched', async () => {
    const { bridge, wallet } = makeBridge({ approveResult: { ok: false } });
    await call(bridge, 'webln.sendPayment', { invoice: 'lnbc_x' });
    expect(wallet.payInvoice).not.toHaveBeenCalled();
  });

  it('wallet failure surfaces as a generic error and records no spend', async () => {
    const { bridge, firewall, wallet } = makeBridge({ approveResult: { ok: true } });
    wallet.payInvoice.mockRejectedValue(new Error('breez: /Users/x/.spark path exploded'));
    const res = await call(bridge, 'webln.sendPayment', { invoice: 'lnbc_x' });
    expect(res).toEqual({ id: 'r1', ok: false, error: 'payment failed' });
    expect(res.error).not.toMatch(/spark|Users/);
    expect(firewall.spentToday(APP, T0 + 60_000)).toBe(0);
  });

  it('no wallet configured → payment and invoice fail cleanly', async () => {
    const { bridge } = makeBridge({ wallet: null, approveResult: { ok: true } });
    expect((await call(bridge, 'webln.sendPayment', { invoice: 'lnbc_x' })).error).toBe('no wallet');
    expect((await call(bridge, 'webln.makeInvoice', { amount: 100 })).error).toBe('no wallet');
  });

  it('makeInvoice validates amount natively', async () => {
    const { bridge } = makeBridge();
    for (const amount of [0, -5, 1.5, 'all', NaN]) {
      expect((await call(bridge, 'webln.makeInvoice', { amount })).error).toBe('invalid amount');
    }
    const ok = await call(bridge, 'webln.makeInvoice', { amount: 100, defaultMemo: 'coffee' });
    expect(ok).toMatchObject({ ok: true, result: { paymentRequest: 'lnbc_test_invoice' } });
  });
});

describe('freeport.paySpark (Spark address / stablecoin payments)', () => {
  const ADDR = 'spark1pgss8767mv3pe7cuakkux5fgemra9u0f707ymc8gpdame6xvlg0qeh5c20sg0h';

  it('token payment always asks, shows the token amount and address, pays via the wallet', async () => {
    const { bridge, approvals, wallet } = makeBridge({ approveResult: { ok: true } });
    const res = await call(bridge, 'freeport.paySpark', { address: ADDR, token: { ticker: 'USDT', amount: 5 } });
    expect(res.ok).toBe(true);
    expect(approvals[0]).toMatchObject({ method: 'freeport.paySpark', token: { ticker: 'USDT', amount: 5 } });
    expect(approvals[0].address).toBe(ADDR);
    expect(wallet.paySpark).toHaveBeenCalledWith(ADDR, { sats: undefined, token: { ticker: 'USDT', amount: 5 } });
  });

  it('spend caps never auto-allow Spark payments — a cap that covers sats still asks', async () => {
    const { bridge, firewall, approve } = makeBridge({ approveResult: { ok: true } });
    firewall.setSpendCap(APP, 1_000_000);
    await call(bridge, 'freeport.paySpark', { address: ADDR, sats: 10 });
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it('sats payments record spend; token payments do not touch the sats caps', async () => {
    const { bridge, firewall } = makeBridge({ approveResult: { ok: true } });
    await call(bridge, 'freeport.paySpark', { address: ADDR, sats: 250 });
    expect(firewall.spentToday(APP, T0 + 60_000)).toBe(250);
    await call(bridge, 'freeport.paySpark', { address: ADDR, token: { ticker: 'USDT', amount: 5 } }, 'r2');
    expect(firewall.spentToday(APP, T0 + 120_000)).toBe(250);
  });

  it.each([
    [{ token: { ticker: 'USDT', amount: 5 } }],                          // no address
    [{ address: 'bc1qxyz', sats: 10 }],                                  // not a spark address
    [{ address: ADDR }],                                                 // neither sats nor token
    [{ address: ADDR, sats: 10, token: { ticker: 'USDT', amount: 5 } }], // both at once
    [{ address: ADDR, sats: -5 }],
    [{ address: ADDR, token: { ticker: 'USDT', amount: -5 } }],
    [{ address: ADDR, token: { ticker: '<script>', amount: 5 } }],
    [{ address: ADDR, token: { ticker: 'USDT', amount: NaN } }],
  ])('malformed params %j are denied before any dialog', async (params) => {
    const { bridge, approve, wallet } = makeBridge();
    const res = await call(bridge, 'freeport.paySpark', params);
    expect(res).toEqual({ id: 'r1', ok: false, error: 'denied' });
    expect(approve).not.toHaveBeenCalled();
    expect(wallet.paySpark).not.toHaveBeenCalled();
  });

  it('user rejection never touches the wallet', async () => {
    const { bridge, wallet } = makeBridge({ approveResult: { ok: false } });
    await call(bridge, 'freeport.paySpark', { address: ADDR, token: { ticker: 'USDT', amount: 5 } });
    expect(wallet.paySpark).not.toHaveBeenCalled();
  });
});

describe('launch URLs (demo-app style paths)', () => {
  it('registerApp keeps the path as the launch url; permissions key on the origin', () => {
    const f = new MiniAppFirewall();
    const rec = f.registerApp('https://freeport.network/demo-app/?x=1#frag', 'Demo', T0);
    expect(rec.origin).toBe('https://freeport.network');
    expect(rec.url).toBe('https://freeport.network/demo-app/?x=1');
  });

  it('a tampered store cannot relocate the launch url outside the origin', () => {
    const f = new MiniAppFirewall();
    f.registerApp('https://freeport.network/demo-app/', 'Demo', T0);
    const blob = JSON.parse(f.serialize());
    blob.apps[0].url = 'https://evil.example/phish';
    const f2 = MiniAppFirewall.restore(JSON.stringify(blob));
    expect(f2.getApp('https://freeport.network')!.url).toBe('https://freeport.network');
  });
});

describe('flood control', () => {
  it('a 4th concurrent approval dialog is refused (firewall ask-flood through the bridge)', async () => {
    let release!: () => void;
    const gate = new Promise<{ ok: boolean }>((r) => { release = () => r({ ok: false }); });
    const { bridge } = makeBridge({ approve: () => gate as Promise<{ ok: boolean }> });
    const inflight = Array.from({ length: 3 }, (_, i) => call(bridge, 'getPublicKey', undefined, 'p' + i));
    await new Promise((r) => setTimeout(r, 0));
    expect(await call(bridge, 'getPublicKey', undefined, 'p4')).toEqual({ id: 'p4', ok: false, error: 'denied' });
    release();
    await Promise.all(inflight);
  });

  it('more than 8 in-flight RPCs are refused as busy (slow-wallet hang)', async () => {
    let release!: (v: { preimage: string }) => void;
    const gate = new Promise<{ preimage: string }>((r) => { release = r; });
    const { bridge, firewall, wallet } = makeBridge();
    firewall.setSpendCap(APP, 1_000_000); // auto-allow path, no dialogs involved
    wallet.payInvoice.mockReturnValue(gate);
    const inflight = Array.from({ length: 8 }, (_, i) => call(bridge, 'webln.sendPayment', { invoice: 'lnbc_x' }, 'p' + i));
    await new Promise((r) => setTimeout(r, 0));
    const ninth = await call(bridge, 'webln.sendPayment', { invoice: 'lnbc_x' }, 'p9');
    expect(ninth).toEqual({ id: 'p9', ok: false, error: 'busy' });
    release({ preimage: 'f'.repeat(64) });
    await Promise.all(inflight);
  });
});

describe('response encoding (injection back into the page)', () => {
  it('escapes line separators and </script> so injectJavaScript cannot be broken out of', () => {
    const hostile = JSON.stringify({ id: 'x', ok: true, result: 'a\u2028b </script><img onerror=alert(1)>' });
    const js = encodeResponseJs(hostile);
    expect(js).not.toMatch(/[\u2028\u2029]/);
    expect(js).not.toContain('</script>');
    expect(js).toContain('__fpBridgeResolve');
    // the encoded payload must round-trip exactly
    const m = js.match(/JSON\.parse\((".*")\)/s)!;
    expect(JSON.parse(JSON.parse(m[1]))).toEqual(JSON.parse(hostile));
  });
});

describe('shim', () => {
  it('is fully static — no template interpolation, no user data', () => {
    expect(MINIAPP_SHIM).not.toMatch(/\$\{/);
  });

  it('covers exactly the bridge surface (nostr + webln entry points present)', () => {
    for (const needle of ['getPublicKey', 'signEvent', 'nip04', 'nip44', 'webln', 'makeInvoice', 'sendPayment', '__fpBridgeResolve', '__fp: 1']) {
      expect(MINIAPP_SHIM).toContain(needle);
    }
    // and nothing that smells like key material can ever be down there
    expect(MINIAPP_SHIM).not.toMatch(/nsec|secretKey|privateKey/);
  });
});
