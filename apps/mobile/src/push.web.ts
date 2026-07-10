/**
 * Web Push opt-in (PWA). Subscribes the browser to push via the bundled service
 * worker (pwa/sw.js) and registers with a self-hostable, content-blind sender
 * (the notifier bundled into freeport-self-hosted — see packages/freeport-self-hosted). One
 * subscription covers BOTH:
 *   - DMs: the sender watches kind:4 to your pubkey → "New message".
 *   - Intent alerts: new offers/requests matching your `filters` (topic /
 *     geohash) → "New request/offer near you".
 * It never sees message contents (DMs are NIP-04 encrypted).
 *
 * The VAPID public key is fetched from the sender (`/vapidPublicKey`) so this
 * works with ANY host the user points at — no key baked into the app.
 *
 * iOS note: only works once the site is Added to Home Screen (iOS 16.4+), and
 * the permission prompt must come from a user tap.
 */
export type PushStatus = 'on' | 'off' | 'denied' | 'unsupported' | 'error';

export interface PushFilters {
  kinds?: number[];
  topics?: string[];
  near?: { lat: number; lon: number; radiusKm: number };
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function api(endpoint: string, path: string): string {
  return endpoint.replace(/\/$/, '') + path;
}

async function fetchVapidKey(endpoint: string): Promise<string | null> {
  try {
    const res = await fetch(api(endpoint, '/vapidPublicKey'));
    if (!res.ok) return null;
    const { publicKey } = await res.json();
    return typeof publicKey === 'string' ? publicKey : null;
  } catch {
    return null;
  }
}

async function register(endpoint: string, pubkeyHex: string, sub: PushSubscription, filters?: PushFilters): Promise<boolean> {
  const res = await fetch(api(endpoint, '/subscribe'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), pubkey: pubkeyHex || undefined, filters: filters ?? {} }),
  });
  return res.ok;
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/** Request permission, subscribe, and register with the sender. Call from a tap.
 *  Never rejects — resolves 'error' instead: pushManager.subscribe() rejects
 *  with DOMException NetworkError where the browser's push service is
 *  unreachable (e.g. FCM blocked country-wide), which surfaced as unhandled
 *  rejections in production (GlitchTip issue 4). */
export async function enablePush(pubkeyHex: string, endpoint: string, filters?: PushFilters): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  if (!endpoint) return 'error' as PushStatus;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
    const key = await fetchVapidKey(endpoint);
    if (!key) return 'error' as PushStatus;
    const reg = await navigator.serviceWorker.ready;
    // A browser allows ONE push subscription per SW, bound to one VAPID key. If a
    // stale one exists (e.g. a previous sender's key), drop it and resubscribe so
    // the subscription matches THIS sender — otherwise pushes silently fail.
    const existing = await reg.pushManager.getSubscription();
    if (existing) await existing.unsubscribe().catch(() => {});
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });
    return (await register(endpoint, pubkeyHex, sub, filters)) ? 'on' : ('error' as PushStatus);
  } catch {
    return 'error' as PushStatus;
  }
}

/** Update the registered filters without re-subscribing (cheap; safe to call
 *  on pref changes). No-op if not currently subscribed. */
export async function updatePush(pubkeyHex: string, endpoint: string, filters?: PushFilters): Promise<void> {
  if (!pushSupported() || !endpoint) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await register(endpoint, pubkeyHex, sub, filters);
  } catch {
    /* ignore */
  }
}

export async function disablePush(_pubkeyHex: string, endpoint: string): Promise<void> {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      if (endpoint) {
        await fetch(api(endpoint, '/unsubscribe'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
      }
      await sub.unsubscribe().catch(() => {});
    }
  } catch {
    /* ignore */
  }
}
