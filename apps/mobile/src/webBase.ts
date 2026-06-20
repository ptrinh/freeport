/**
 * Canonical web origin for share links (live-trip + intent deep links).
 *
 * On web the app is domain-agnostic: it always uses the origin it's actually
 * served from (`window.location.origin`), so it runs unchanged on any domain
 * — freeport.trinh.uk, a *.pages.dev preview, localhost, a self-host, etc.
 *
 * Native apps have no `window.location`, so a link generated on a phone must
 * point at *some* hosted web origin to be openable. That fallback is the only
 * configurable value: `expo.extra.webBase` in app.json (override per build/fork
 * without touching code). Trailing slash is stripped so callers can append.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';

const FALLBACK = 'https://freeport.trinh.uk';

function configured(): string {
  const v = (Constants.expoConfig?.extra as any)?.webBase;
  return (typeof v === 'string' && v ? v : FALLBACK).replace(/\/+$/, '');
}

/** Origin to use as the base for outbound share links. */
export function webBase(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return configured();
}
