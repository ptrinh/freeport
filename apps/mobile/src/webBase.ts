/**
 * Canonical web origin for share links (live-trip + intent deep links).
 *
 * On web the app is domain-agnostic: it uses the PUBLIC origin it's served from
 * (freeport.network, a *.pages.dev preview, a fork's own domain), so links run
 * unchanged there. But it must NOT use origins a recipient can't open:
 *   - the Tauri desktop shell (`tauri://localhost`)
 *   - a LAN self-host ("Host Freeport for others" → http://192.168.x.x:port)
 *   - localhost / 127.0.0.1 / *.local
 * In those cases (and on native, which has no window.location) it falls back to
 * the configured public base: `expo.extra.webBase` in app.json (override per
 * build/fork). Trailing slash stripped so callers can append.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const FALLBACK = 'https://freeport.network';

function configured(): string {
  const v = (Constants.expoConfig?.extra as any)?.webBase;
  return (typeof v === 'string' && v ? v : FALLBACK).replace(/\/+$/, '');
}

/** Pure origin-selection (exported for tests). Returns the served origin only
 *  when it's a PUBLIC http(s) origin; otherwise null (caller uses the configured
 *  public base). */
export function resolveWebBase(
  origin: string | undefined,
  protocol: string | undefined,
  hostname: string | undefined,
): string | null {
  const o = (origin || '').replace(/\/+$/, '');
  const isHttp = protocol === 'http:' || protocol === 'https:';
  const h = hostname || '';
  const isLocalOrLan =
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h.endsWith('.local') ||
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h); // 172.16.0.0–172.31.255.255
  return o && isHttp && !isLocalOrLan ? o : null;
}

/** Origin to use as the base for outbound share links. */
export function webBase(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const picked = resolveWebBase(
      window.location?.origin,
      window.location?.protocol,
      window.location?.hostname,
    );
    if (picked) return picked;
  }
  return configured();
}
