/**
 * Web debug API — `window.freeport` — for self-debugging the app from the
 * browser console (or via Claude-in-Chrome). Paired with the per-profile
 * storage isolation in kv.web.ts so two tabs can run as two independent users:
 *
 *   <origin>/?profile=1   ← e.g. Passenger
 *   <origin>/?profile=2   ← e.g. Driver
 *
 * Each profile has its own localStorage namespace → its own Nostr identity,
 * profile, prefs and saved negotiations, so they can post intents to each
 * other and negotiate a real deal end-to-end on one machine.
 *
 * Console usage:
 *   freeport.help()              list everything
 *   freeport.state()             { profile, npub, relays, intents, negotiations, … }
 *   freeport.dump()              all of this profile's stored values, parsed
 *   freeport.relays()            connected relay count
 *   freeport.negotiations()      current deals (live, from the client)
 *   freeport.intents()           intents currently in the feed
 *   freeport.profile             active profile id ("" | "1" | "2" | …)
 *   freeport.switchTo(2)         reload this tab as ?profile=2
 *   freeport.open(2)             open ?profile=2 in a NEW tab (the counterparty)
 *   freeport.reset()             wipe THIS profile's storage and reload
 *   freeport.client              the live MobileClient (advanced)
 *
 * This module only runs in the browser and only attaches a single global; it
 * does nothing heavy and is safe to ship (it exposes no more than what the
 * page's own JS could already read from localStorage).
 */
import { profileId, storagePrefix } from './kv';

interface DebugClient {
  pubkey?: string;
  connectedRelayCount?: () => number;
  negotiations?: Map<string, unknown>;
  relays?: string[];
}

interface FreeportDebug {
  profile: string;
  npub: string;
  client: DebugClient | null;
  state(): Record<string, unknown>;
  dump(): Record<string, unknown>;
  keys(): string[];
  relays(): number;
  negotiations(): unknown[];
  intents(): unknown[];
  switchTo(n: string | number): void;
  open(n: string | number): void;
  reset(): void;
  help(): string[];
}

let registeredNpub = '';
let registeredClient: DebugClient | null = null;
let getIntents: (() => unknown[]) | null = null;

/** Storage keys whose VALUES are secret and must never be dumped/listed by the
 *  debug API (they're still wiped by the clear path, which uses profileKeys). */
const SECRET_KEYS = new Set(['freeport.nsec']);

/** Logical localStorage keys for the active profile (prefix stripped). */
function profileKeys(): string[] {
  const ls = globalThis.localStorage;
  if (!ls) return [];
  const prefix = storagePrefix();
  const out: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k == null) continue;
    if (prefix) {
      if (k.startsWith(prefix)) out.push(k.slice(prefix.length));
    } else if (!k.startsWith('fp.p')) {
      // default profile: everything that isn't another profile's namespace
      out.push(k);
    }
  }
  return out;
}

function readKey(logicalKey: string): unknown {
  const raw = globalThis.localStorage?.getItem(storagePrefix() + logicalKey);
  if (raw == null) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}

function navTo(n: string | number, newTab: boolean): void {
  const loc = globalThis.location;
  if (!loc) return;
  const url = new URL(loc.href);
  url.searchParams.set('profile', String(n));
  url.hash = '';
  if (newTab) globalThis.open?.(url.toString(), '_blank');
  else loc.assign(url.toString());
}

function makeApi(): FreeportDebug {
  return {
    get profile() { return profileId(); },
    get npub() { return registeredNpub; },
    get client() { return registeredClient; },
    relays() { return registeredClient?.connectedRelayCount?.() ?? 0; },
    negotiations() { return registeredClient?.negotiations ? [...registeredClient.negotiations.values()] : []; },
    intents() { return getIntents?.() ?? []; },
    keys() { return profileKeys().filter((k) => !SECRET_KEYS.has(k)); },
    dump() {
      // Never surface the secret key here. Same-origin script could read it
      // from storage anyway, but a one-liner `freeport.dump()` is a perfect
      // instrument for a "paste this in your console" self-XSS scam — don't
      // hand it out.
      const out: Record<string, unknown> = {};
      for (const k of profileKeys()) if (!SECRET_KEYS.has(k)) out[k] = readKey(k);
      return out;
    },
    state() {
      return {
        profile: profileId() || '(default)',
        npub: registeredNpub || '(not signed in)',
        relays: this.relays(),
        intentsInFeed: this.intents().length,
        negotiations: this.negotiations().length,
        storedKeys: profileKeys().filter((k) => !SECRET_KEYS.has(k)),
      };
    },
    switchTo(n) { navTo(n, false); },
    open(n) { navTo(n, true); },
    reset() {
      const ls = globalThis.localStorage;
      if (ls) {
        const prefix = storagePrefix();
        for (const k of profileKeys()) ls.removeItem(prefix + k);
      }
      globalThis.location?.reload();
    },
    help() {
      const lines = [
        'freeport.state()        — snapshot: profile, npub, relays, intents, deals',
        'freeport.dump()         — all stored values for this profile (parsed)',
        'freeport.keys()         — stored key names for this profile',
        'freeport.relays()       — connected relay count',
        'freeport.negotiations() — live deals from the client',
        'freeport.intents()      — intents currently in the feed',
        'freeport.profile        — active profile id',
        'freeport.switchTo(2)    — reload this tab as ?profile=2',
        'freeport.open(2)        — open ?profile=2 in a new tab (counterparty)',
        'freeport.reset()        — wipe THIS profile and reload',
        'freeport.client         — the live MobileClient (advanced)',
      ];
      // eslint-disable-next-line no-console
      console.log('[freeport debug]\n' + lines.join('\n'));
      return lines;
    },
  };
}

/**
 * Attach `window.freeport` (idempotent). Called once from App on web. Also sets
 * the document title to the profile id so multiple tabs are easy to tell apart.
 */
export function installDebugApi(): void {
  if (typeof globalThis === 'undefined' || !(globalThis as any).document) return;
  const w = globalThis as any;
  if (!w.freeport) {
    w.freeport = makeApi();
    const id = profileId();
    if (id) {
      try { w.document.title = `Freeport · P${id}`; } catch {}
    }
    // eslint-disable-next-line no-console
    console.log(
      `%c[freeport]%c debug API ready — type %cfreeport.help()%c. profile=${profileId() || '(default)'}`,
      'color:#22c55e;font-weight:bold', '', 'color:#3b82f6;font-weight:bold', '',
    );
  }
}

/** App calls this once the live client + identity exist, so the API can reach them. */
export function registerDebugClient(client: DebugClient, npub: string, intentsGetter?: () => unknown[]): void {
  registeredClient = client;
  registeredNpub = npub;
  if (intentsGetter) getIntents = intentsGetter;
  installDebugApi();
}
