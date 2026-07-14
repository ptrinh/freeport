/**
 * Mini-app firewall — the single policy choke point for the mini-app shell.
 *
 * Every bridge RPC (window.nostr / window.webln shim → native) is judged here
 * BEFORE it can reach the signer or the wallet. The WebView side is treated as
 * hostile: nothing it sends is trusted, and nothing here depends on it behaving.
 *
 * Pure TS, no I/O: callers inject `now` and persist `serialize()` output.
 * Mechanism (shim, transport, dialogs) lives in the bridge/shell; this module
 * owns only POLICY, so the adversarial test suite can drive it directly.
 */

/** The complete RPC surface. Anything else is denied, never "not yet implemented". */
export const BRIDGE_METHODS = [
  'getPublicKey',
  'signEvent',
  'nip04.encrypt', 'nip04.decrypt',
  'nip44.encrypt', 'nip44.decrypt',
  'webln.enable', 'webln.getInfo', 'webln.makeInvoice', 'webln.sendPayment',
  // Freeport extension: pay a Spark address (sats or a stablecoin token).
  // ALWAYS per-payment approval — spend caps never auto-allow these.
  'freeport.paySpark',
  // Freeport read extensions — the PRIVATE signals an app cannot otherwise
  // obtain. Anything public (reputation, karma, deal counts, account age) is
  // derivable from the npub the app already learns via getPublicKey, so it is
  // deliberately NOT bridged — the app looks that up itself. Each asks once
  // and is grantable per-app.
  'freeport.getBalance', 'freeport.getLocation',
  // Freeport extension: hand a generated file (receipt, ticket, certificate)
  // to the OS save/share sheet. ALWAYS asks — never a standing grant.
  'freeport.saveFile',
] as const;
export type BridgeMethod = (typeof BRIDGE_METHODS)[number];

/** The read methods an app can hold a standing grant for. */
export const READ_METHODS = ['freeport.getBalance', 'freeport.getLocation'] as const;

/**
 * Kinds that ALWAYS require a per-event approval dialog — a standing grant is
 * refused even if requested. Signing any of these lets a mini-app act as the
 * user where it hurts: identity (0/3), DMs and deal negotiation (4/1059),
 * deleting the user's events (5), the encrypted settings/profile sync bundle
 * (30078), storefront products (30018) and every Freeport marketplace kind
 * (listings, karma, receipts, chat invites: 32101–32105).
 */
export const ALWAYS_ASK_KINDS = new Set([0, 3, 4, 5, 1059, 30018, 30078, 32101, 32102, 32103, 32104, 32105]);

export interface AppPermissions {
  /** getPublicKey granted (asked once when the app is added or on first call). */
  pubkey: boolean;
  /** signEvent silent allowlist. ALWAYS_ASK_KINDS can never be added here. */
  kinds: number[];
  /** Per-peer encrypt grants (64-hex pubkeys). No wildcard exists. */
  encryptPeers: string[];
  /** Per-peer decrypt grants. Deliberately the ONLY grant shape for decrypt —
   *  a blanket grant would expose the entire DM history. */
  decryptPeers: string[];
  /** Payments up to this many sats/day auto-approve. 0 = every payment asks. */
  spendCapDaySats: number;
  /** Read methods granted (freeport.getBalance / getReputation / getLocation). */
  reads: string[];
}

export interface MiniAppRecord {
  /** Normalized https origin — the trust unit for everything. */
  origin: string;
  /** Launch URL (may carry a path, e.g. https://freeport.network/esim-store/).
   *  Always inside `origin`; permissions are still keyed by origin alone. */
  url: string;
  name: string;
  /** Tile icon (https URL, often a CDN — any origin is fine: it's only ever
   *  rendered as an image, never executed). */
  icon?: string;
  addedAt: number;
  perms: AppPermissions;
}

export type DenyReason =
  | 'unregistered' | 'blocklisted' | 'unknown-method' | 'bad-params'
  | 'rate-limited' | 'ask-flood' | 'wildcard-grant' | 'ungrantable-kind';
export type AskReason =
  | 'pubkey' | 'kind-unlisted' | 'kind-sensitive' | 'encrypt-peer' | 'decrypt-peer'
  | 'payment' | 'payment-over-cap' | 'payment-global-cap' | 'payment-unknown-amount'
  | 'payment-cooldown' | 'wallet-info'
  | 'read-balance' | 'read-location' | 'save-file';

export type Verdict =
  | { action: 'allow' }
  | { action: 'ask'; reason: AskReason }
  | { action: 'deny'; reason: DenyReason };

export interface BridgeRequest {
  origin: string;
  method: string;
  params?: unknown;
  now: number;
}

export interface AuditEntry {
  t: number;
  origin: string;
  method: string;
  verdict: Verdict['action'];
  reason?: string;
  kind?: number;
  sats?: number;
  /** Token payments (freeport.paySpark): "5 USDT". */
  token?: string;
}

const SIGN_RATE_MAX = 10;        // signEvent calls per origin per minute
const SIGN_RATE_WINDOW_MS = 60_000;
const INVOICE_RATE_MAX = 10;     // makeInvoice per origin per minute
const MAX_OPEN_ASKS = 3;         // concurrent approval dialogs per origin
const PAY_COOLDOWN_MS = 10_000;  // min gap between auto-approved payments
const AUDIT_CAP = 500;

const HEX64 = /^[0-9a-f]{64}$/;

/** Normalize to a bare https origin. Returns null for anything else —
 *  http, file:, data:, javascript:, userinfo tricks, unparseable input. */
export function normalizeOrigin(input: string): string | null {
  if (typeof input !== 'string' || input.length > 512) return null;
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
  return u.origin;
}

/** Normalized https launch URL (origin + path + query, creds/fragment stripped). */
export function normalizeLaunchUrl(input: string): string | null {
  const origin = normalizeOrigin(input);
  if (!origin) return null;
  const u = new URL(input.trim());
  const url = origin + u.pathname + u.search;
  return url.length <= 1024 ? url : origin;
}

/** Icon URLs are display-only but still get the same https-only discipline. */
function sanitizeIcon(input: unknown): string | undefined {
  if (typeof input !== 'string' || !input) return undefined;
  const url = normalizeLaunchUrl(input);
  return url ?? undefined;
}

/** Pre-registration check: hard validity + warnings the add-app UI must show. */
export function evaluateAdd(input: string): { origin: string | null; warnings: string[] } {
  const origin = normalizeOrigin(input);
  if (!origin) return { origin: null, warnings: [] };
  const warnings: string[] = [];
  const host = new URL(origin).hostname;
  if (host.split('.').some((l) => l.startsWith('xn--'))) warnings.push('punycode');
  return { origin, warnings };
}

interface SpendDay { day: string; sats: number; lastPayAt: number }

interface Persisted {
  v: 1;
  apps: MiniAppRecord[];
  spend: Record<string, SpendDay>;
  globalSpend: SpendDay;
  audit: AuditEntry[];
}

function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function emptySpend(now: number): SpendDay {
  return { day: utcDay(now), sats: 0, lastPayAt: 0 };
}

function rolled(s: SpendDay | undefined, now: number): SpendDay {
  return s && s.day === utcDay(now) ? s : emptySpend(now);
}

export const DEFAULT_GLOBAL_SPEND_CAP_SATS = 100_000;

export class MiniAppFirewall {
  private apps = new Map<string, MiniAppRecord>();
  private spend = new Map<string, SpendDay>();
  private globalSpend: SpendDay = emptySpend(0);
  private audit: AuditEntry[] = [];
  private signTimes = new Map<string, number[]>();
  private invoiceTimes = new Map<string, number[]>();
  private openAsks = new Map<string, number>();
  private blocklist: Set<string>;
  /** Auto-approved payments across ALL apps stop at this daily total; beyond it
   *  every payment asks, no matter the per-app cap. */
  readonly globalSpendCapDaySats: number;

  constructor(opts?: { blocklist?: Iterable<string>; globalSpendCapDaySats?: number }) {
    this.blocklist = new Set([...(opts?.blocklist ?? [])].map((o) => normalizeOrigin(o) ?? o));
    this.globalSpendCapDaySats = opts?.globalSpendCapDaySats ?? DEFAULT_GLOBAL_SPEND_CAP_SATS;
  }

  // ── App registry ──────────────────────────────────────────────────────────

  registerApp(input: string, name: string, now: number, icon?: string): MiniAppRecord {
    const origin = normalizeOrigin(input);
    if (!origin) throw new Error('invalid origin');
    if (this.blocklist.has(origin)) throw new Error('blocklisted');
    const existing = this.apps.get(origin);
    if (existing) {
      // Re-adding refreshes the display metadata but NEVER the grants.
      existing.name = name || existing.name;
      if (sanitizeIcon(icon)) existing.icon = sanitizeIcon(icon)!;
      return existing;
    }
    const rec: MiniAppRecord = {
      origin, url: normalizeLaunchUrl(input) ?? origin, name, icon: sanitizeIcon(icon), addedAt: now,
      perms: { pubkey: false, kinds: [], encryptPeers: [], decryptPeers: [], spendCapDaySats: 0, reads: [] },
    };
    this.apps.set(origin, rec);
    return rec;
  }

  /** Reorder the launcher grid: origins in the given order first (unknown ones
   *  ignored), any apps not listed keep their relative order at the end. */
  reorderApps(order: string[]): void {
    const next = new Map<string, MiniAppRecord>();
    for (const o of order) {
      const origin = normalizeOrigin(o);
      const rec = origin ? this.apps.get(origin) : undefined;
      if (rec && !next.has(rec.origin)) next.set(rec.origin, rec);
    }
    for (const [o, rec] of this.apps) if (!next.has(o)) next.set(o, rec);
    this.apps = next;
  }

  removeApp(origin: string): void {
    this.apps.delete(origin);
    this.spend.delete(origin);
    this.signTimes.delete(origin);
    this.invoiceTimes.delete(origin);
    this.openAsks.delete(origin);
  }

  getApp(origin: string): MiniAppRecord | undefined { return this.apps.get(origin); }
  listApps(): MiniAppRecord[] { return [...this.apps.values()]; }

  setBlocklist(origins: Iterable<string>): void {
    this.blocklist = new Set([...origins].map((o) => normalizeOrigin(o) ?? o));
  }

  // ── Grants (called by the shell AFTER the user approves an ask) ───────────

  grantPubkey(origin: string): void { this.mustApp(origin).perms.pubkey = true; }

  grantKind(origin: string, kind: number): void {
    if (!Number.isInteger(kind) || ALWAYS_ASK_KINDS.has(kind)) throw new Error('ungrantable kind');
    const p = this.mustApp(origin).perms;
    if (!p.kinds.includes(kind)) p.kinds.push(kind);
  }

  grantPeer(origin: string, dir: 'encrypt' | 'decrypt', peer: string): void {
    if (!HEX64.test(peer)) throw new Error('invalid peer');
    const p = this.mustApp(origin).perms;
    const list = dir === 'encrypt' ? p.encryptPeers : p.decryptPeers;
    if (!list.includes(peer)) list.push(peer);
  }

  grantRead(origin: string, method: string): void {
    if (!(READ_METHODS as readonly string[]).includes(method)) throw new Error('not a read method');
    const p = this.mustApp(origin).perms;
    if (!p.reads.includes(method)) p.reads.push(method);
  }

  setSpendCap(origin: string, sats: number): void {
    if (!Number.isInteger(sats) || sats < 0) throw new Error('invalid cap');
    this.mustApp(origin).perms.spendCapDaySats = sats;
  }

  /** Record a completed payment (approved OR auto-allowed) against the caps. */
  recordSpend(origin: string, sats: number, now: number): void {
    const s = rolled(this.spend.get(origin), now);
    s.sats += sats;
    s.lastPayAt = now;
    this.spend.set(origin, s);
    this.globalSpend = rolled(this.globalSpend, now);
    this.globalSpend.sats += sats;
    this.globalSpend.lastPayAt = now;
  }

  spentToday(origin: string, now: number): number {
    return rolled(this.spend.get(origin), now).sats;
  }

  /** Approval-dialog accounting — the bridge opens before showing a dialog and
   *  closes when it resolves, so a hostile app can't stack dialogs (ask-flood). */
  openAsk(origin: string): void { this.openAsks.set(origin, (this.openAsks.get(origin) ?? 0) + 1); }
  closeAsk(origin: string): void {
    const n = (this.openAsks.get(origin) ?? 0) - 1;
    if (n > 0) this.openAsks.set(origin, n); else this.openAsks.delete(origin);
  }

  // ── The choke point ───────────────────────────────────────────────────────

  evaluate(req: BridgeRequest): Verdict {
    const v = this.decide(req);
    this.log(req, v);
    return v;
  }

  private decide(req: BridgeRequest): Verdict {
    const origin = normalizeOrigin(req.origin);
    if (!origin) return { action: 'deny', reason: 'unregistered' };
    if (this.blocklist.has(origin)) return { action: 'deny', reason: 'blocklisted' };
    const app = this.apps.get(origin);
    if (!app) return { action: 'deny', reason: 'unregistered' };
    if (!BRIDGE_METHODS.includes(req.method as BridgeMethod)) {
      return { action: 'deny', reason: 'unknown-method' };
    }
    const method = req.method as BridgeMethod;
    const p = req.params as Record<string, unknown> | undefined;

    switch (method) {
      case 'getPublicKey':
        return app.perms.pubkey ? { action: 'allow' } : this.ask(origin, 'pubkey');

      case 'signEvent': {
        const kind = p?.kind;
        if (!Number.isInteger(kind) || (kind as number) < 0 || (kind as number) > 65535) {
          return { action: 'deny', reason: 'bad-params' };
        }
        const times = (this.signTimes.get(origin) ?? []).filter((t) => req.now - t < SIGN_RATE_WINDOW_MS);
        times.push(req.now);
        this.signTimes.set(origin, times);
        if (times.length > SIGN_RATE_MAX) return { action: 'deny', reason: 'rate-limited' };
        if (ALWAYS_ASK_KINDS.has(kind as number)) return this.ask(origin, 'kind-sensitive');
        if (app.perms.kinds.includes(kind as number)) return { action: 'allow' };
        return this.ask(origin, 'kind-unlisted');
      }

      case 'nip04.encrypt': case 'nip44.encrypt': {
        const peer = p?.peer;
        if (typeof peer !== 'string' || !HEX64.test(peer)) return { action: 'deny', reason: 'bad-params' };
        if (app.perms.encryptPeers.includes(peer)) return { action: 'allow' };
        return this.ask(origin, 'encrypt-peer');
      }

      case 'nip04.decrypt': case 'nip44.decrypt': {
        const peer = p?.peer;
        if (typeof peer !== 'string' || !HEX64.test(peer)) return { action: 'deny', reason: 'bad-params' };
        if (app.perms.decryptPeers.includes(peer)) return { action: 'allow' };
        return this.ask(origin, 'decrypt-peer');
      }

      case 'webln.enable':
        return { action: 'allow' };

      case 'webln.getInfo':
        // Reveals the user's node/identity — same sensitivity as getPublicKey.
        return app.perms.pubkey ? { action: 'allow' } : this.ask(origin, 'wallet-info');

      case 'webln.makeInvoice': {
        const times = (this.invoiceTimes.get(origin) ?? []).filter((t) => req.now - t < SIGN_RATE_WINDOW_MS);
        times.push(req.now);
        this.invoiceTimes.set(origin, times);
        if (times.length > INVOICE_RATE_MAX) return { action: 'deny', reason: 'rate-limited' };
        return { action: 'allow' }; // receive-only
      }

      case 'webln.sendPayment': {
        const sats = p?.amountSats;
        if (sats !== undefined && (!Number.isInteger(sats) || (sats as number) < 0)) {
          return { action: 'deny', reason: 'bad-params' };
        }
        if (sats === undefined || sats === 0) return this.ask(origin, 'payment-unknown-amount');
        const cap = app.perms.spendCapDaySats;
        if (cap <= 0) return this.ask(origin, 'payment');
        const s = rolled(this.spend.get(origin), req.now);
        if (s.sats + (sats as number) > cap) return this.ask(origin, 'payment-over-cap');
        const g = rolled(this.globalSpend, req.now);
        if (g.sats + (sats as number) > this.globalSpendCapDaySats) return this.ask(origin, 'payment-global-cap');
        if (req.now - s.lastPayAt < PAY_COOLDOWN_MS) return this.ask(origin, 'payment-cooldown');
        return { action: 'allow' };
      }

      case 'freeport.saveFile': {
        const name = p?.name, mime = p?.mimeType, data = p?.dataBase64;
        if (typeof name !== 'string' || !name || name.length > 200
          || typeof mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(mime)
          || typeof data !== 'string' || !data || data.length > 3_000_000) {
          return { action: 'deny', reason: 'bad-params' };
        }
        return this.ask(origin, 'save-file');
      }

      case 'freeport.getBalance':
        return app.perms.reads.includes(method) ? { action: 'allow' } : this.ask(origin, 'read-balance');
      case 'freeport.getLocation':
        return app.perms.reads.includes(method) ? { action: 'allow' } : this.ask(origin, 'read-location');

      case 'freeport.paySpark': {
        const address = p?.address;
        if (typeof address !== 'string' || !/^spark1[a-z0-9]{8,512}$/.test(address)) {
          return { action: 'deny', reason: 'bad-params' };
        }
        const sats = p?.sats;
        const token = p?.token as { ticker?: unknown; amount?: unknown } | undefined;
        const satsOk = Number.isInteger(sats) && (sats as number) > 0;
        const tokenOk = !!token && typeof token === 'object'
          && typeof token.ticker === 'string' && /^[A-Za-z0-9]{2,12}$/.test(token.ticker)
          && typeof token.amount === 'number' && Number.isFinite(token.amount) && token.amount > 0;
        if (satsOk === tokenOk) return { action: 'deny', reason: 'bad-params' }; // exactly one of the two
        return this.ask(origin, 'payment');
      }
    }
  }

  /** An ask is only offered while the app has dialog budget left. */
  private ask(origin: string, reason: AskReason): Verdict {
    if ((this.openAsks.get(origin) ?? 0) >= MAX_OPEN_ASKS) {
      return { action: 'deny', reason: 'ask-flood' };
    }
    return { action: 'ask', reason };
  }

  private mustApp(origin: string): MiniAppRecord {
    const app = this.apps.get(normalizeOrigin(origin) ?? origin);
    if (!app) throw new Error('unregistered app');
    return app;
  }

  private log(req: BridgeRequest, v: Verdict): void {
    const p = req.params as Record<string, unknown> | undefined;
    const e: AuditEntry = { t: req.now, origin: req.origin.slice(0, 200), method: String(req.method).slice(0, 40), verdict: v.action };
    if (v.action !== 'allow') e.reason = (v as { reason: string }).reason;
    if (typeof p?.kind === 'number') e.kind = p.kind as number;
    if (typeof p?.amountSats === 'number') e.sats = p.amountSats as number;
    if (typeof p?.sats === 'number') e.sats = p.sats as number;
    const tok = p?.token as { ticker?: unknown; amount?: unknown } | undefined;
    if (tok && typeof tok.ticker === 'string' && typeof tok.amount === 'number') {
      e.token = `${tok.amount} ${tok.ticker}`.slice(0, 40);
    }
    this.audit.push(e);
    if (this.audit.length > AUDIT_CAP) this.audit.splice(0, this.audit.length - AUDIT_CAP);
  }

  auditLog(origin?: string): AuditEntry[] {
    return origin ? this.audit.filter((e) => e.origin === origin) : [...this.audit];
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  serialize(): string {
    const data: Persisted = {
      v: 1,
      apps: this.listApps(),
      spend: Object.fromEntries(this.spend),
      globalSpend: this.globalSpend,
      audit: this.audit,
    };
    return JSON.stringify(data);
  }

  static restore(json: string | null, opts?: ConstructorParameters<typeof MiniAppFirewall>[0]): MiniAppFirewall {
    const fw = new MiniAppFirewall(opts);
    if (!json) return fw;
    try {
      const data = JSON.parse(json) as Persisted;
      if (data?.v !== 1) return fw;
      for (const a of data.apps ?? []) {
        const origin = normalizeOrigin(a.origin);
        if (!origin) continue;
        // The stored launch url must still live inside the origin (tampered
        // stores don't get to relocate an app).
        const url = typeof a.url === 'string' ? normalizeLaunchUrl(a.url) : null;
        fw.apps.set(origin, {
          origin,
          url: url && url.startsWith(origin) ? url : origin,
          name: String(a.name ?? '').slice(0, 100),
          icon: sanitizeIcon(a.icon),
          addedAt: Number(a.addedAt) || 0,
          perms: {
            pubkey: !!a.perms?.pubkey,
            kinds: (a.perms?.kinds ?? []).filter((k) => Number.isInteger(k) && !ALWAYS_ASK_KINDS.has(k)),
            encryptPeers: (a.perms?.encryptPeers ?? []).filter((x) => HEX64.test(x)),
            decryptPeers: (a.perms?.decryptPeers ?? []).filter((x) => HEX64.test(x)),
            spendCapDaySats: Math.max(0, Number(a.perms?.spendCapDaySats) || 0),
            reads: (a.perms?.reads ?? []).filter((m) => (READ_METHODS as readonly string[]).includes(m)),
          },
        });
      }
      for (const [o, s] of Object.entries(data.spend ?? {})) {
        if (fw.apps.has(o)) fw.spend.set(o, { day: String(s.day), sats: Number(s.sats) || 0, lastPayAt: Number(s.lastPayAt) || 0 });
      }
      if (data.globalSpend) {
        fw.globalSpend = { day: String(data.globalSpend.day), sats: Number(data.globalSpend.sats) || 0, lastPayAt: Number(data.globalSpend.lastPayAt) || 0 };
      }
      if (Array.isArray(data.audit)) fw.audit = data.audit.slice(-AUDIT_CAP);
    } catch { /* corrupt store → start clean */ }
    return fw;
  }
}
