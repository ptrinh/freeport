/**
 * Remote push opt-in — NATIVE (iOS/Android). Gets an Expo push token and
 * registers it with the content-blind notifier (bundled into freeport-self-hosted).
 * One token covers DMs (the sender watches kind:4 to your pubkey → "New message")
 * and intent alerts (new offers/requests matching `filters`). The notifier sends
 * via Expo's push service, which uses the APNs/FCM key held in this app's EAS
 * project — so no secret lives in the app or the notifier.
 *
 * The web equivalent is push.web.ts (Metro picks it on web). Local (app-alive)
 * notifications still come from notify.ts; this adds delivery when fully closed.
 */
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { kvGet, kvSet } from './kv';
import { buildSubscribeAuth, type SignAuthFn } from './pushAuth';

export type { SignAuthFn };

export type PushStatus = 'on' | 'off' | 'denied' | 'unsupported' | 'error';

export interface PushFilters {
  kinds?: number[];
  topics?: string[];
  near?: { lat: number; lon: number; radiusKm: number };
}

const TOKEN_KEY = 'freeport.expoPushToken';
const projectId = (Constants.expoConfig?.extra as any)?.eas?.projectId as string | undefined;

export function pushSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function api(endpoint: string, path: string): string {
  return endpoint.replace(/\/$/, '') + path;
}

async function getToken(): Promise<string | null> {
  try {
    const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return data || null;
  } catch {
    return null; // simulator / no entitlement / offline
  }
}

async function register(endpoint: string, token: string, pubkeyHex: string, filters?: PushFilters, sign?: SignAuthFn): Promise<boolean> {
  // Prove we own the pubkey we ask the server to watch (DM-timing metadata).
  const auth = pubkeyHex ? await buildSubscribeAuth(sign, token) : null;
  const res = await fetch(api(endpoint, '/subscribe'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expoPushToken: token, pubkey: pubkeyHex || undefined, filters: filters ?? {}, auth: auth ?? undefined }),
  });
  return res.ok;
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status === 'denied') return 'denied';
    const token = await kvGet(TOKEN_KEY);
    return token ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/** Request permission, get an Expo token, and register with the sender.
 *  Never rejects — resolves 'error' instead (register()'s fetch throws on
 *  network failure; see the web variant's GlitchTip issue 4). */
export async function enablePush(pubkeyHex: string, endpoint: string, filters?: PushFilters, sign?: SignAuthFn): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  if (!endpoint) return 'error';
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return status === 'denied' ? 'denied' : 'off';
    const token = await getToken();
    if (!token) return 'error';
    const ok = await register(endpoint, token, pubkeyHex, filters, sign);
    if (!ok) return 'error';
    await kvSet(TOKEN_KEY, token);
    return 'on';
  } catch {
    return 'error';
  }
}

/** Update registered filters without re-requesting permission. No-op if not registered. */
export async function updatePush(pubkeyHex: string, endpoint: string, filters?: PushFilters, sign?: SignAuthFn): Promise<void> {
  if (!pushSupported() || !endpoint) return;
  const token = await kvGet(TOKEN_KEY);
  if (token) await register(endpoint, token, pubkeyHex, filters, sign).catch(() => {});
}

export async function disablePush(_pubkeyHex: string, endpoint: string): Promise<void> {
  if (!pushSupported()) return;
  const token = await kvGet(TOKEN_KEY);
  if (token && endpoint) {
    await fetch(api(endpoint, '/unsubscribe'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expoPushToken: token }),
    }).catch(() => {});
  }
  await kvSet(TOKEN_KEY, '');
}
