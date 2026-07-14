/**
 * Adversarial suite for the mini-app firewall — every test is an attack the
 * policy engine must survive. The WebView side is fully hostile: assume the
 * mini-app controls every byte of every request.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MiniAppFirewall, normalizeOrigin, evaluateAdd, ALWAYS_ASK_KINDS,
} from '../src/miniapps/firewall';

const APP = 'https://rides.example';
const T0 = 1_800_000_000_000; // fixed epoch ms
const PEER = 'a'.repeat(64);

function fw(): MiniAppFirewall {
  const f = new MiniAppFirewall();
  f.registerApp(APP, 'Rides', T0);
  return f;
}

describe('origin validation', () => {
  it.each([
    ['http://rides.example', null],           // no plaintext
    ['file:///etc/passwd', null],
    ['data:text/html,<script>', null],
    ['javascript:alert(1)', null],
    ['https://user:pass@rides.example', null], // userinfo tricks
    ['not a url', null],
    ['', null],
    ['https://rides.example/deep/path?q=1#f', 'https://rides.example'], // path stripped
    ['https://RIDES.example', 'https://rides.example'],                 // case-folded
    ['https://rides.example:8443', 'https://rides.example:8443'],       // port is part of the trust unit
  ])('normalizeOrigin(%s) → %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });

  it('rejects absurdly long input without parsing it', () => {
    expect(normalizeOrigin('https://' + 'a'.repeat(600) + '.com')).toBeNull();
  });

  it('flags punycode hosts at add time (homoglyph phishing)', () => {
    expect(evaluateAdd('https://xn--freport-hya.network').warnings).toContain('punycode');
    expect(evaluateAdd('https://rides.example').warnings).toEqual([]);
    expect(evaluateAdd('http://rides.example').origin).toBeNull();
  });
});

describe('registry gate', () => {
  it('denies any request from an unregistered origin', () => {
    const f = fw();
    expect(f.evaluate({ origin: 'https://evil.example', method: 'getPublicKey', now: T0 }))
      .toEqual({ action: 'deny', reason: 'unregistered' });
  });

  it('origin swap: permissions do NOT follow a navigation to another origin', () => {
    const f = fw();
    f.grantPubkey(APP);
    f.grantKind(APP, 30023);
    // page navigated itself to evil.example; shim survives, bridge reports the new origin
    for (const method of ['getPublicKey', 'signEvent', 'webln.sendPayment']) {
      const v = f.evaluate({ origin: 'https://evil.example', method, params: { kind: 30023, amountSats: 1 }, now: T0 });
      expect(v).toEqual({ action: 'deny', reason: 'unregistered' });
    }
  });

  it('blocklisted origins are denied even if previously registered', () => {
    const f = fw();
    f.grantPubkey(APP);
    f.setBlocklist([APP]);
    expect(f.evaluate({ origin: APP, method: 'getPublicKey', now: T0 }))
      .toEqual({ action: 'deny', reason: 'blocklisted' });
  });

  it('refuses to register a blocklisted origin', () => {
    const f = new MiniAppFirewall({ blocklist: ['https://scam.example'] });
    expect(() => f.registerApp('https://scam.example', 'Scam', T0)).toThrow(/blocklisted/);
  });

  it('removeApp wipes permissions and spend state', () => {
    const f = fw();
    f.grantPubkey(APP);
    f.recordSpend(APP, 500, T0);
    f.removeApp(APP);
    expect(f.evaluate({ origin: APP, method: 'getPublicKey', now: T0 }))
      .toEqual({ action: 'deny', reason: 'unregistered' });
    f.registerApp(APP, 'Rides again', T0);
    expect(f.spentToday(APP, T0)).toBe(0); // no ghost spend on re-add
    expect(f.getApp(APP)!.perms.pubkey).toBe(false); // no ghost perms either
  });
});

describe('method surface', () => {
  it.each([
    'eval', 'nostr.getRelays', 'webln.keysend', 'getSecretKey', '__proto__',
    'constructor', 'signEvent ', 'SIGNEVENT', 'webln.sendPaymentAsync',
  ])('unknown method "%s" is denied', (method) => {
    expect(fw().evaluate({ origin: APP, method, now: T0 }))
      .toEqual({ action: 'deny', reason: 'unknown-method' });
  });
});

describe('signEvent policy', () => {
  it.each([
    [undefined], [null], ['4'], [1.5], [-1], [70000], [NaN], [{ valueOf: (): number => 4 }],
  ])('malformed kind %s is denied, not asked', (kind) => {
    expect(fw().evaluate({ origin: APP, method: 'signEvent', params: { kind }, now: T0 }))
      .toEqual({ action: 'deny', reason: 'bad-params' });
  });

  it('ungranted kind asks; granted kind allows', () => {
    const f = fw();
    expect(f.evaluate({ origin: APP, method: 'signEvent', params: { kind: 30023 }, now: T0 }))
      .toEqual({ action: 'ask', reason: 'kind-unlisted' });
    f.grantKind(APP, 30023);
    expect(f.evaluate({ origin: APP, method: 'signEvent', params: { kind: 30023 }, now: T0 + 1 }))
      .toEqual({ action: 'allow' });
  });

  it('sensitive kinds ALWAYS ask and can never be granted', () => {
    const f = fw();
    let now = T0;
    for (const kind of ALWAYS_ASK_KINDS) {
      expect(() => f.grantKind(APP, kind)).toThrow(/ungrantable/);
      // space the calls out so this exercises the kind policy, not the rate limit
      expect(f.evaluate({ origin: APP, method: 'signEvent', params: { kind }, now: (now += 10_000) }).action).toBe('ask');
    }
  });

  it('restore() strips sensitive kinds smuggled into a tampered store', () => {
    const f = fw();
    const blob = JSON.parse(f.serialize());
    blob.apps[0].perms.kinds = [4, 32101, 30023]; // tampered persistence
    const f2 = MiniAppFirewall.restore(JSON.stringify(blob));
    expect(f2.getApp(APP)!.perms.kinds).toEqual([30023]);
  });

  it('rate limit: 11th signEvent inside a minute is denied, window slides', () => {
    const f = fw();
    f.grantKind(APP, 1);
    for (let i = 0; i < 10; i++) {
      expect(f.evaluate({ origin: APP, method: 'signEvent', params: { kind: 1 }, now: T0 + i }).action).toBe('allow');
    }
    expect(f.evaluate({ origin: APP, method: 'signEvent', params: { kind: 1 }, now: T0 + 10 }))
      .toEqual({ action: 'deny', reason: 'rate-limited' });
    // 61s later the window has slid past the burst
    expect(f.evaluate({ origin: APP, method: 'signEvent', params: { kind: 1 }, now: T0 + 61_000 }).action).toBe('allow');
  });
});

describe('encrypt / decrypt', () => {
  it.each(['nip04.decrypt', 'nip44.decrypt'] as const)('%s default-asks per peer, never blanket', (method) => {
    const f = fw();
    expect(f.evaluate({ origin: APP, method, params: { peer: PEER }, now: T0 }))
      .toEqual({ action: 'ask', reason: 'decrypt-peer' });
    f.grantPeer(APP, 'decrypt', PEER);
    expect(f.evaluate({ origin: APP, method, params: { peer: PEER }, now: T0 }))
      .toEqual({ action: 'allow' });
    // a different peer still asks — the grant is per-peer only
    expect(f.evaluate({ origin: APP, method, params: { peer: 'b'.repeat(64) }, now: T0 }).action).toBe('ask');
  });

  it('encrypt grant does NOT unlock decrypt for the same peer', () => {
    const f = fw();
    f.grantPeer(APP, 'encrypt', PEER);
    expect(f.evaluate({ origin: APP, method: 'nip44.encrypt', params: { peer: PEER }, now: T0 }).action).toBe('allow');
    expect(f.evaluate({ origin: APP, method: 'nip44.decrypt', params: { peer: PEER }, now: T0 }).action).toBe('ask');
  });

  it.each([
    ['*'], ['A'.repeat(64)], ['a'.repeat(63)], ['a'.repeat(65)], ['npub1' + 'a'.repeat(59)], [''],
  ])('peer "%s" is rejected as params and as a grant', (peer) => {
    const f = fw();
    expect(f.evaluate({ origin: APP, method: 'nip44.decrypt', params: { peer }, now: T0 }))
      .toEqual({ action: 'deny', reason: 'bad-params' });
    expect(() => f.grantPeer(APP, 'decrypt', peer)).toThrow(/invalid peer/);
  });
});

describe('payments', () => {
  it('no cap set → every payment asks', () => {
    expect(fw().evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 1 }, now: T0 }))
      .toEqual({ action: 'ask', reason: 'payment' });
  });

  it('unknown or zero amount always asks even under cap (zero-amount invoice trick)', () => {
    const f = fw();
    f.setSpendCap(APP, 10_000);
    expect(f.evaluate({ origin: APP, method: 'webln.sendPayment', params: {}, now: T0 }))
      .toEqual({ action: 'ask', reason: 'payment-unknown-amount' });
    expect(f.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 0 }, now: T0 }))
      .toEqual({ action: 'ask', reason: 'payment-unknown-amount' });
  });

  it.each([[-1], [1.5], ['100'], [NaN], [Infinity]])('malformed amount %s is denied', (amountSats) => {
    const f = fw();
    f.setSpendCap(APP, 10_000);
    expect(f.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats }, now: T0 }))
      .toEqual({ action: 'deny', reason: 'bad-params' });
  });

  it('under cap auto-allows; crossing the cap asks; cap counts cumulative daily spend', () => {
    const f = fw();
    f.setSpendCap(APP, 1000);
    expect(f.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 600 }, now: T0 }).action).toBe('allow');
    f.recordSpend(APP, 600, T0);
    // 600 spent + 600 more would cross 1000
    expect(f.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 600 }, now: T0 + 60_000 }))
      .toEqual({ action: 'ask', reason: 'payment-over-cap' });
    // but 400 exactly fills the cap
    expect(f.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 400 }, now: T0 + 60_000 }).action).toBe('allow');
  });

  it('cooldown: rapid-fire auto-payments ask even under cap (drip-drain attack)', () => {
    const f = fw();
    f.setSpendCap(APP, 100_000);
    expect(f.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 10 }, now: T0 }).action).toBe('allow');
    f.recordSpend(APP, 10, T0);
    expect(f.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 10 }, now: T0 + 3000 }))
      .toEqual({ action: 'ask', reason: 'payment-cooldown' });
    expect(f.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 10 }, now: T0 + 11_000 }).action).toBe('allow');
  });

  it('global cross-app cap: many small apps cannot jointly drain the wallet silently', () => {
    const f = new MiniAppFirewall({ globalSpendCapDaySats: 1000 });
    f.registerApp(APP, 'A', T0);
    f.registerApp('https://other.example', 'B', T0);
    f.setSpendCap(APP, 1000);
    f.setSpendCap('https://other.example', 1000);
    f.recordSpend('https://other.example', 900, T0);
    // per-app cap of A is untouched, but the global pool is nearly gone
    expect(f.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 200 }, now: T0 + 60_000 }))
      .toEqual({ action: 'ask', reason: 'payment-global-cap' });
  });

  it('daily spend resets on UTC rollover', () => {
    const f = fw();
    f.setSpendCap(APP, 1000);
    f.recordSpend(APP, 1000, T0);
    expect(f.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 100 }, now: T0 + 60_000 }).action).toBe('ask');
    const nextDay = T0 + 24 * 3600_000;
    expect(f.spentToday(APP, nextDay)).toBe(0);
    expect(f.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 100 }, now: nextDay }).action).toBe('allow');
  });

  it('setSpendCap rejects garbage', () => {
    const f = fw();
    for (const bad of [-1, 1.5, NaN, Infinity]) expect(() => f.setSpendCap(APP, bad)).toThrow(/invalid cap/);
  });
});

describe('ask-flood protection', () => {
  it('a 4th concurrent approval dialog is denied, and closing one restores budget', () => {
    const f = fw();
    for (let i = 0; i < 3; i++) f.openAsk(APP);
    expect(f.evaluate({ origin: APP, method: 'getPublicKey', now: T0 }))
      .toEqual({ action: 'deny', reason: 'ask-flood' });
    f.closeAsk(APP);
    expect(f.evaluate({ origin: APP, method: 'getPublicKey', now: T0 }).action).toBe('ask');
  });

  it('flood budget is per-origin, not shared across apps', () => {
    const f = fw();
    f.registerApp('https://other.example', 'B', T0);
    for (let i = 0; i < 3; i++) f.openAsk(APP);
    expect(f.evaluate({ origin: 'https://other.example', method: 'getPublicKey', now: T0 }).action).toBe('ask');
  });
});

describe('makeInvoice / enable / getInfo', () => {
  it('makeInvoice is allowed (receive-only) but rate-limited', () => {
    const f = fw();
    for (let i = 0; i < 10; i++) {
      expect(f.evaluate({ origin: APP, method: 'webln.makeInvoice', now: T0 + i }).action).toBe('allow');
    }
    expect(f.evaluate({ origin: APP, method: 'webln.makeInvoice', now: T0 + 10 }))
      .toEqual({ action: 'deny', reason: 'rate-limited' });
  });

  it('getInfo is gated like getPublicKey (it reveals identity)', () => {
    const f = fw();
    expect(f.evaluate({ origin: APP, method: 'webln.getInfo', now: T0 }))
      .toEqual({ action: 'ask', reason: 'wallet-info' });
    f.grantPubkey(APP);
    expect(f.evaluate({ origin: APP, method: 'webln.getInfo', now: T0 }).action).toBe('allow');
  });

  it('enable is a no-op allow', () => {
    expect(fw().evaluate({ origin: APP, method: 'webln.enable', now: T0 })).toEqual({ action: 'allow' });
  });
});

describe('audit log', () => {
  it('records every verdict with kind/sats and caps at 500 entries', () => {
    const f = fw();
    f.grantKind(APP, 1);
    f.evaluate({ origin: APP, method: 'signEvent', params: { kind: 1 }, now: T0 });
    f.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 42 }, now: T0 });
    f.evaluate({ origin: 'https://evil.example', method: 'signEvent', params: { kind: 1 }, now: T0 });
    const log = f.auditLog();
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ method: 'signEvent', verdict: 'allow', kind: 1 });
    expect(log[1]).toMatchObject({ method: 'webln.sendPayment', verdict: 'ask', sats: 42 });
    expect(log[2]).toMatchObject({ verdict: 'deny', reason: 'unregistered' });
    for (let i = 0; i < 600; i++) f.evaluate({ origin: APP, method: 'webln.enable', now: T0 + i });
    expect(f.auditLog().length).toBe(500);
  });

  it('truncates attacker-controlled strings instead of storing them verbatim', () => {
    const f = fw();
    f.evaluate({ origin: 'https://' + 'x'.repeat(400) + '.com', method: 'm'.repeat(200), now: T0 });
    const e = f.auditLog()[0];
    expect(e.origin.length).toBeLessThanOrEqual(200);
    expect(e.method.length).toBeLessThanOrEqual(40);
  });
});

describe('persistence', () => {
  it('serialize/restore round-trips apps, grants, and today\'s spend', () => {
    const f = fw();
    f.grantPubkey(APP);
    f.grantKind(APP, 30023);
    f.grantPeer(APP, 'decrypt', PEER);
    f.setSpendCap(APP, 5000);
    f.recordSpend(APP, 1200, T0);
    const f2 = MiniAppFirewall.restore(f.serialize());
    expect(f2.getApp(APP)!.perms).toEqual({
      pubkey: true, kinds: [30023], encryptPeers: [], decryptPeers: [PEER], spendCapDaySats: 5000,
    });
    expect(f2.spentToday(APP, T0)).toBe(1200);
    // restored spend still enforces the cap: 1200 spent leaves 3800 of headroom
    expect(f2.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 3800 }, now: T0 + 60_000 }).action).toBe('allow');
    expect(f2.evaluate({ origin: APP, method: 'webln.sendPayment', params: { amountSats: 3801 }, now: T0 + 60_000 }).action).toBe('ask');
  });

  it('survives corrupt or hostile persisted blobs', () => {
    for (const blob of [null, '', '{', '[]', '{"v":99}', '{"v":1,"apps":[{"origin":"javascript:x"}]}']) {
      const f = MiniAppFirewall.restore(blob);
      expect(f.listApps().length).toBe(0);
    }
  });

  it('does not resurrect spend for origins that lost their registration', () => {
    const f = fw();
    f.recordSpend(APP, 700, T0);
    const blob = JSON.parse(f.serialize());
    blob.apps = []; // app removed, spend entry left behind
    const f2 = MiniAppFirewall.restore(JSON.stringify(blob));
    f2.registerApp(APP, 'Rides', T0);
    expect(f2.spentToday(APP, T0)).toBe(0);
  });
});
