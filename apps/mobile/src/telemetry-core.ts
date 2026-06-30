/**
 * Telemetry config + privacy core, shared by the native and web variants.
 *
 * HARD RULE: nothing that can identify or locate a user ever leaves the device.
 * No nsec/npub/hex keys, no contact (name/phone), no coordinates/geohash, no
 * message content, no IP-derived user data. Analytics is an allowlist of event
 * names with a tiny set of non-PII props. The "user" is an anonymous random
 * install id — deliberately NOT the Nostr pubkey, so telemetry can never be
 * correlated back to the on-device identity the app exists to protect.
 */
import 'react-native-get-random-values';
import { kvGet, kvSet } from './kv';

// Both are client-side public identifiers (they ship in the bundle).
export const GLITCHTIP_DSN = 'https://e471e99aa8f340608038dc61b73022c1@glitchtip.trinh.uk/1';
export const APTABASE_APP_KEY = 'A-SH-8354908404';
export const APTABASE_HOST = 'https://aptabase.trinh.uk';

/** Anonymous, stable-per-install id. Random — never the Nostr pubkey. */
export async function anonInstallId(): Promise<string> {
  const KEY = 'freeport.anonId';
  const existing = await kvGet(KEY);
  if (existing) return existing;
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  const id = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  await kvSet(KEY, id).catch(() => {});
  return id;
}

// Things that must never be transmitted, redacted anywhere they appear in a
// payload string: Nostr keys (bech32 + raw 64-hex), and phone numbers.
const SECRET_RE: RegExp[] = [
  /\b(?:nsec|npub|note|nprofile|nevent|naddr)1[0-9a-z]{20,}\b/gi,
  /\bncryptsec1[0-9a-z]{20,}\b/gi,
  /\b[0-9a-f]{64}\b/gi, // raw hex pubkey/seckey/event id
  /\+?\d[\d\s().-]{7,}\d/g, // phone-ish runs
];

function redactString(s: string): string {
  let out = s;
  for (const re of SECRET_RE) out = out.replace(re, '[redacted]');
  return out;
}

/**
 * Deep-redact a Sentry event before send: drop user/request/server identifiers
 * outright, and scrub secret patterns from every remaining string. Bounded
 * recursion so a pathological payload can't hang the sender.
 */
export function scrubEvent<T extends Record<string, any>>(event: T): T {
  // Keep only our anonymous install id on the user; strip ip/email/username and
  // anything else Sentry may attach. Drop request/server identifiers wholesale.
  const uid = (event as any).user?.id;
  (event as any).user = uid ? { id: String(uid) } : undefined;
  delete (event as any).request;
  delete (event as any).server_name;
  if (event.contexts?.device) {
    delete event.contexts.device.name; // device nickname can be a real name
  }
  const seen = new WeakSet();
  const walk = (v: any, depth: number): any => {
    if (depth > 8 || v == null) return v;
    if (typeof v === 'string') return redactString(v);
    if (typeof v !== 'object') return v;
    if (seen.has(v)) return v;
    seen.add(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) v[i] = walk(v[i], depth + 1); return v; }
    for (const k of Object.keys(v)) v[k] = walk(v[k], depth + 1);
    return v;
  };
  return walk(event, 0);
}

/** Drop breadcrumbs that could carry message/DM/console content. */
export function scrubBreadcrumb(b: { category?: string; message?: string; data?: any } | null) {
  if (!b) return null;
  if (b.category === 'console') return null; // app logs may echo decrypted content
  if (typeof b.message === 'string') b.message = redactString(b.message);
  return b;
}

// Analytics: ONLY these event names are ever sent. Anything else is dropped.
export const ANALYTICS_EVENTS = [
  'app_opened', 'tab_viewed', 'post_published', 'deal_confirmed',
  'deal_completed', 'deal_cancelled', 'rated_peer', 'blocked_peer',
] as const;
export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

// Prop keys allowed alongside an event, and only as short primitives. No ids,
// no amounts, no locations, no free text.
const ALLOWED_PROP_KEYS = new Set(['side', 'category', 'subcategory', 'tab', 'role', 'kind', 'platform']);

export function sanitizeProps(props?: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!props) return out;
  for (const k of Object.keys(props)) {
    if (!ALLOWED_PROP_KEYS.has(k)) continue;
    const v = props[k];
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string') out[k] = redactString(v).slice(0, 40);
  }
  return out;
}

export function isAllowedEvent(name: string): name is AnalyticsEvent {
  return (ANALYTICS_EVENTS as readonly string[]).includes(name);
}
