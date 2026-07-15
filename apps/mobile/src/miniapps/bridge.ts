/**
 * Mini-app bridge — MECHANISM side of the shell. Receives raw postMessage
 * strings from the WebView shim, routes every request through the firewall
 * (policy), shows approval dialogs via an injected callback, and only then
 * touches the signer/wallet. The secret key never crosses this boundary;
 * only signed events, ciphertexts, and payment results do.
 *
 * Pure TS with injected deps so the adversarial suite can drive it directly
 * (no WebView, no UI).
 */
import * as nip44 from 'nostr-tools/nip44';
import type { Event, EventTemplate } from 'nostr-tools/pure';
import type { Signer } from '../signer';
import { MiniAppFirewall, normalizeOrigin, type AskReason, type BridgeMethod } from './firewall';

/** What the approval dialog needs to render. All strings are attacker-adjacent
 *  — the dialog must display them as data, never interpolate into markup. */
export interface ApprovalRequest {
  origin: string;
  appName: string;
  method: BridgeMethod;
  reason: AskReason;
  /** signEvent: the kind + a content preview. */
  kind?: number;
  contentPreview?: string;
  /** encrypt/decrypt: the peer pubkey (hex). */
  peer?: string;
  /** sendPayment: parsed from the invoice NATIVE-side, never app-claimed. */
  amountSats?: number;
  invoice?: string;
  /** paySpark: the destination address and, for stablecoins, the token amount. */
  address?: string;
  token?: { ticker: string; amount: number };
  /** saveFile: the filename the app wants to save. */
  fileName?: string;
}

export interface ApprovalResult {
  ok: boolean;
  /** "Always allow" — the bridge converts this to a standing grant where the
   *  firewall permits one (sensitive kinds and payments never persist). */
  remember?: boolean;
}

export interface BridgeWallet {
  makeInvoice(amountSats: number, memo: string): Promise<string>;
  payInvoice(bolt11: string): Promise<{ preimage: string }>;
  /** Amount encoded in the invoice, sats. null = zero-amount invoice. */
  parseAmount(bolt11: string): number | null;
  /** Pay a Spark address — sats, or a stablecoin token amount. */
  paySpark(address: string, opts: { sats?: number; token?: { ticker: string; amount: number } }): Promise<{ preimage?: string; sats?: number }>;
}

/** Read-only profile signals an app may request, resolved lazily by the shell.
 *  Each returns a deliberately COARSE, safe subset — never raw history. */
export interface BridgeContext {
  balance(): Promise<{ sats: number }>;
  location(): Promise<{ country: string; state: string; city: string }>;
}

export interface BridgeDeps {
  firewall: MiniAppFirewall;
  signer: Signer;
  approve: (req: ApprovalRequest) => Promise<ApprovalResult>;
  wallet: BridgeWallet | null;
  /** Read-context provider; null disables the freeport.get* read methods. */
  context?: BridgeContext | null;
  /** Hands a generated file to the OS save/share sheet; null disables saveFile. */
  saveFile?: ((file: { name: string; mimeType: string; dataBase64: string }) => Promise<void>) | null;
  /** Called after any state change worth persisting (grants, spend). */
  persist: () => void;
  /** Payment auth gate (Face ID / passkey) — runs AFTER the approval dialog,
   *  right before the wallet is touched. Resolves false to block. Optional so
   *  the adversarial suite and headless shells run ungated. */
  authorizePay?: (info: { amountSats: number | null }) => Promise<boolean>;
  now?: () => number;
}

interface RpcMessage { __fp: 1; id: string; method: string; params?: Record<string, unknown>; t?: string }
interface RpcResponse { id: string; ok: boolean; result?: unknown; error?: string }

// Big enough to carry a small saveFile payload (a receipt/ticket/certificate,
// capped at ~3MB base64 by the firewall) plus JSON overhead; anything larger
// is abuse and dropped before parsing.
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_PENDING = 8;                // in-flight RPCs per bridge (dialogs are capped tighter by the firewall)

/** One bridge instance per WebView session. The shell MUST call setOrigin()
 *  from onNavigationStateChange so verdicts always apply to the page that is
 *  actually loaded — permissions never survive a navigation to another origin. */
export class MiniAppBridge {
  private origin: string;
  private pending = 0;
  private readonly now: () => number;

  constructor(private deps: BridgeDeps, initialUrl: string) {
    this.origin = normalizeOrigin(initialUrl) ?? '';
    this.now = deps.now ?? Date.now;
  }

  setOrigin(url: string): void {
    this.origin = normalizeOrigin(url) ?? '';
  }
  currentOrigin(): string { return this.origin; }

  /**
   * Handle one raw postMessage payload. Returns the JSON response to deliver
   * back to the page, or null when the message is not ours / unanswerable
   * (malformed traffic is dropped silently — no oracle for probing).
   */
  async handleMessage(raw: string, expectToken?: string): Promise<string | null> {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_BYTES) return null;
    let msg: RpcMessage;
    try { msg = JSON.parse(raw); } catch { return null; }
    if (!msg || msg.__fp !== 1 || typeof msg.id !== 'string' || !msg.id || msg.id.length > 64 || typeof msg.method !== 'string') return null;
    // Native only: the per-session token proves this message came from the
    // main-frame shim, not a cross-origin sub-iframe (ad/analytics/widget) that
    // reached window.ReactNativeWebView.postMessage directly — that global is
    // exposed to EVERY frame, and onMessage can't tell us which frame sent it,
    // so without this a subframe's RPC would be judged under the host app's
    // origin and inherit its grants. Web passes no token: there the dedicated
    // MessageChannel port IS the capability and a stray frame never holds it.
    if (expectToken !== undefined && msg.t !== expectToken) return null;
    if (this.pending >= MAX_PENDING) return this.reply({ id: msg.id, ok: false, error: 'busy' });
    this.pending++;
    try {
      return this.reply(await this.dispatch(msg));
    } catch {
      return this.reply({ id: msg.id, ok: false, error: 'internal' });
    } finally {
      this.pending--;
    }
  }

  private async dispatch(msg: RpcMessage): Promise<RpcResponse> {
    const { firewall } = this.deps;
    const id = msg.id;
    const p = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>;

    // Translate raw RPC params → the facts the firewall judges on. For
    // payments the amount comes from parsing the invoice HERE — an app-claimed
    // amount is ignored, so lying about it buys nothing.
    let fwParams: Record<string, unknown> | undefined;
    let invoice = '';
    let template: EventTemplate | null = null;
    switch (msg.method) {
      case 'signEvent': {
        template = sanitizeTemplate(p.event);
        if (!template) return { id, ok: false, error: 'invalid event' };
        fwParams = { kind: template.kind };
        break;
      }
      case 'nip04.encrypt': case 'nip44.encrypt':
      case 'nip04.decrypt': case 'nip44.decrypt':
        fwParams = { peer: p.peer };
        break;
      case 'webln.sendPayment': {
        if (typeof p.invoice !== 'string' || !p.invoice || p.invoice.length > 4096) {
          return { id, ok: false, error: 'invalid invoice' };
        }
        invoice = p.invoice.trim();
        const sats = this.deps.wallet?.parseAmount(invoice);
        fwParams = { amountSats: sats ?? undefined };
        break;
      }
      case 'freeport.paySpark':
      case 'freeport.saveFile':
        fwParams = p; // firewall validates the shape itself
        break;
    }

    const verdict = firewall.evaluate({ origin: this.origin, method: msg.method, params: fwParams, now: this.now() });
    if (verdict.action === 'deny') return { id, ok: false, error: 'denied' };

    if (verdict.action === 'ask') {
      const app = firewall.getApp(this.origin);
      firewall.openAsk(this.origin);
      let res: ApprovalResult;
      try {
        res = await this.deps.approve({
          origin: this.origin,
          appName: app?.name ?? this.origin,
          method: msg.method as BridgeMethod,
          reason: verdict.reason,
          kind: template?.kind,
          contentPreview: template ? String(template.content).slice(0, 300) : undefined,
          peer: typeof p.peer === 'string' ? p.peer : undefined,
          amountSats: typeof fwParams?.amountSats === 'number' ? (fwParams.amountSats as number)
            : typeof p.sats === 'number' ? (p.sats as number) : undefined,
          invoice: invoice || undefined,
          address: typeof p.address === 'string' ? p.address : undefined,
          token: p.token as { ticker: string; amount: number } | undefined,
          fileName: typeof p.name === 'string' ? p.name : undefined,
        });
      } finally {
        firewall.closeAsk(this.origin);
      }
      if (!res.ok) return { id, ok: false, error: 'denied by user' };
      if (res.remember) this.applyGrant(msg.method as BridgeMethod, template?.kind, p.peer);
    }

    // RESERVE the spend synchronously, here, before execute()'s first await —
    // this is the same run as evaluate() (no yield between), so concurrent
    // payments can't each see spend=0 and all slip under the cap (TOCTOU).
    // execute() refunds if the payment throws.
    let reserved = 0;
    if (msg.method === 'webln.sendPayment') reserved = this.deps.wallet?.parseAmount(invoice) ?? 0;
    else if (msg.method === 'freeport.paySpark') reserved = typeof p.sats === 'number' ? p.sats : 0;
    if (reserved > 0) { this.deps.firewall.recordSpend(this.origin, reserved, this.now()); this.deps.persist(); }

    // Payment auth gate — after the reservation (which must stay synchronous
    // with evaluate() for TOCTOU safety), so a denial refunds like a failed
    // payment. Runs even for auto-approved under-cap payments: the cap trusts
    // the app, this step verifies the HUMAN.
    if (msg.method === 'webln.sendPayment' || msg.method === 'freeport.paySpark') {
      const gate = this.deps.authorizePay;
      if (gate) {
        const amountSats = msg.method === 'webln.sendPayment'
          ? this.deps.wallet?.parseAmount(invoice) ?? null
          : typeof p.sats === 'number' ? p.sats : null;
        const ok = await gate({ amountSats }).catch(() => false);
        if (!ok) { this.refund(reserved); return { id, ok: false, error: 'denied by user' }; }
      }
    }

    return this.execute(id, msg.method as BridgeMethod, p, template, invoice, reserved);
  }

  /** Convert an "always allow" into a standing grant — but only the shapes the
   *  firewall permits: sensitive kinds and payments stay per-event forever. */
  private applyGrant(method: BridgeMethod, kind?: number, peer?: unknown): void {
    const { firewall } = this.deps;
    try {
      if (method === 'getPublicKey' || method === 'webln.getInfo') firewall.grantPubkey(this.origin);
      else if (method === 'signEvent' && typeof kind === 'number') firewall.grantKind(this.origin, kind);
      else if ((method === 'nip04.encrypt' || method === 'nip44.encrypt') && typeof peer === 'string') firewall.grantPeer(this.origin, 'encrypt', peer);
      else if ((method === 'nip04.decrypt' || method === 'nip44.decrypt') && typeof peer === 'string') firewall.grantPeer(this.origin, 'decrypt', peer);
      else if (method === 'freeport.getBalance' || method === 'freeport.getLocation') firewall.grantRead(this.origin, method);
    } catch { /* ungrantable (sensitive kind) — the approval stays one-shot */ }
    this.deps.persist();
  }

  private async execute(id: string, method: BridgeMethod, p: Record<string, unknown>, template: EventTemplate | null, invoice: string, reserved = 0): Promise<RpcResponse> {
    const { signer, wallet, context } = this.deps;
    try {
      switch (method) {
        case 'getPublicKey':
          return { id, ok: true, result: signer.pubkey };
        case 'freeport.getBalance':
          if (!context) return { id, ok: false, error: 'unavailable' };
          return { id, ok: true, result: await context.balance() };
        case 'freeport.getLocation':
          if (!context) return { id, ok: false, error: 'unavailable' };
          return { id, ok: true, result: await context.location() };
        case 'freeport.saveFile': {
          if (!this.deps.saveFile) return { id, ok: false, error: 'unavailable' };
          await this.deps.saveFile({ name: String(p.name), mimeType: String(p.mimeType), dataBase64: String(p.dataBase64) });
          return { id, ok: true, result: { saved: true } };
        }
        case 'signEvent': {
          const ev: Event = await signer.signEvent(template!);
          return { id, ok: true, result: ev };
        }
        case 'nip04.encrypt':
          return { id, ok: true, result: await signer.nip04Encrypt(p.peer as string, String(p.plaintext ?? '')) };
        case 'nip04.decrypt':
          return { id, ok: true, result: await signer.nip04Decrypt(p.peer as string, String(p.ciphertext ?? '')) };
        case 'nip44.encrypt':
          return { id, ok: true, result: nip44.encrypt(String(p.plaintext ?? ''), this.nip44Key(p.peer as string)) };
        case 'nip44.decrypt':
          return { id, ok: true, result: nip44.decrypt(String(p.ciphertext ?? ''), this.nip44Key(p.peer as string)) };
        case 'webln.enable':
          return { id, ok: true, result: { enabled: true } };
        case 'webln.getInfo':
          return { id, ok: true, result: { node: { alias: 'Freeport', pubkey: signer.pubkey } } };
        case 'webln.makeInvoice': {
          if (!wallet) return { id, ok: false, error: 'no wallet' };
          const amount = Number(p.amount);
          if (!Number.isInteger(amount) || amount <= 0 || amount > 21_000_000 * 100_000_000) {
            return { id, ok: false, error: 'invalid amount' };
          }
          const pr = await wallet.makeInvoice(amount, String(p.defaultMemo ?? '').slice(0, 200));
          return { id, ok: true, result: { paymentRequest: pr } };
        }
        case 'webln.sendPayment': {
          if (!wallet) { this.refund(reserved); return { id, ok: false, error: 'no wallet' }; }
          // Spend was reserved before this await (TOCTOU-safe); refund on failure.
          const { preimage } = await wallet.payInvoice(invoice);
          return { id, ok: true, result: { preimage } };
        }
        case 'freeport.paySpark': {
          if (!wallet) { this.refund(reserved); return { id, ok: false, error: 'no wallet' }; }
          const opts = {
            sats: typeof p.sats === 'number' ? p.sats : undefined,
            token: p.token as { ticker: string; amount: number } | undefined,
          };
          const r = await wallet.paySpark(p.address as string, opts);
          // A token charge reserves 0 sats up front (the sat cost isn't known
          // until the wallet converts), so record the real sats spent now that
          // we have them. Safe post-await: paySpark always requires a per-payment
          // approval — there's no auto-approve headroom to race against.
          if (reserved === 0 && typeof r.sats === 'number' && r.sats > 0) {
            this.deps.firewall.recordSpend(this.origin, r.sats, this.now());
            this.deps.persist();
          }
          return { id, ok: true, result: { preimage: r.preimage ?? '' } };
        }
      }
    } catch (e) {
      // Wallet/signer internals (paths, balances, stack) must not leak. But for
      // a user-initiated payment, a COARSE reason from an allowlist is safe and
      // saves the user guessing why it failed.
      const isPay = method.startsWith('webln.') || method === 'freeport.paySpark';
      if (isPay) {
        // The reservation didn't happen — give the cap headroom back.
        this.refund(reserved);
        const msg = String((e as Error)?.message || '').toLowerCase();
        if (/insufficient|not enough|balance too low/.test(msg)) return { id, ok: false, error: 'insufficient balance' };
        if (/no .*balance|no exchange rate|no rate/.test(msg)) return { id, ok: false, error: msg.includes('rate') ? 'no exchange rate' : 'insufficient balance' };
        return { id, ok: false, error: 'payment failed' };
      }
      return { id, ok: false, error: 'operation failed' };
    }
  }

  /** Give back a spend reservation whose payment never completed. */
  private refund(reserved: number): void {
    if (reserved > 0) { this.deps.firewall.refundSpend(this.origin, reserved, this.now()); this.deps.persist(); }
  }

  private nip44Key(peer: string): Uint8Array {
    const sk = this.deps.signer.secretKey;
    if (!sk) throw new Error('nip44 unavailable');
    return nip44.getConversationKey(sk, peer);
  }

  private reply(res: RpcResponse): string {
    return JSON.stringify(res);
  }
}

/** Whitelist the template fields we will sign. Anything else the page put on
 *  the object (id, sig, a forged pubkey, prototype junk) is dropped — the
 *  signer derives identity from the key, never from page data. */
export function sanitizeTemplate(input: unknown): EventTemplate | null {
  if (!input || typeof input !== 'object') return null;
  const e = input as Record<string, unknown>;
  const kind = e.kind;
  if (!Number.isInteger(kind) || (kind as number) < 0 || (kind as number) > 65535) return null;
  if (typeof e.content !== 'string' || e.content.length > 100_000) return null;
  const tags: string[][] = [];
  if (e.tags !== undefined) {
    if (!Array.isArray(e.tags) || e.tags.length > 100) return null;
    for (const t of e.tags) {
      if (!Array.isArray(t) || t.length > 20 || !t.every((x) => typeof x === 'string' && x.length <= 1024)) return null;
      tags.push([...t] as string[]);
    }
  }
  // Clamp created_at to now ± 10 min: an approved app must not be able to
  // back/post-date events the user signs under their identity.
  const now = Math.floor(Date.now() / 1000);
  const SKEW = 600;
  let createdAt = Number.isInteger(e.created_at) && (e.created_at as number) > 0
    ? (e.created_at as number)
    : now;
  if (createdAt < now - SKEW || createdAt > now + SKEW) createdAt = now;
  return { kind: kind as number, content: e.content, tags, created_at: createdAt };
}

/**
 * Encode a bridge response for delivery via WebView.injectJavaScript. The
 * response is attacker-influenced (e.g. decrypted plaintext) — escape the
 * characters that could break out of the JS string context (U+2028/U+2029
 * are line terminators inside JS but legal in JSON; `<` blocks `</script>`).
 */
export function encodeResponseJs(responseJson: string): string {
  const safe = JSON.stringify(responseJson)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
    .replace(/</g, '\\u003c');
  return `window.__fpBridgeResolve && window.__fpBridgeResolve(JSON.parse(${safe})); true;`;
}
