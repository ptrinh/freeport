import { Alert, Linking, Platform } from 'react-native';
import { t } from '../i18n';
import { appleMapsScheme } from '../maps';
import { isIOSWeb, isStandalonePWA } from './format';

// Open a Google-Maps link. On an installed iOS PWA, opening the maps WEBSITE
// (https://www.google.com/maps/...) renders inside a system in-app browser that
// the PWA cannot dismiss — it lingers on top after the user returns (the stuck
// "internal browser" screen). A URL *scheme* hands off to a native app instead
// (exactly like tel: links do), so it app-switches and comes back cleanly. Use
// the Apple Maps scheme (always present on iOS) only in that case; native apps,
// Android, and desktop web get the https link as-is.
export function openMaps(httpsUrl: string): void {
  if (isIOSWeb() && isStandalonePWA()) {
    const scheme = appleMapsScheme(httpsUrl);
    if (scheme) { window.location.href = scheme; return; }
  }
  Linking.openURL(httpsUrl).catch(() => {});
}

// Alert.alert is a no-op on react-native-web, so any user-facing message in a
// web code path must fall back to the browser's own dialog.
export function uiAlert(title: string, body?: string): void {
  if (Platform.OS === 'web') {
    try { (globalThis as any).alert?.(body ? `${title}\n\n${body}` : title); } catch { /* best-effort */ }
  } else {
    Alert.alert(title, body);
  }
}

// Run a deal action and SURFACE a failure instead of swallowing it. Relay
// outages never reject (the client outbox queues and retries those) — a
// rejection here is a real state error (e.g. the deal changed underneath the
// tap) that the user must see, or their card silently diverges from reality.
export function runDealAction(p: Promise<unknown> | undefined, failTitle: string): void {
  p?.catch((e) => uiAlert(failTitle, e instanceof Error ? e.message : undefined));
}

/**
 * Cross-platform confirm. React Native's Alert with buttons is a no-op on
 * react-native-web, so a button's onPress never fires there — use window.confirm
 * on web and Alert on native. Resolves true when the user confirms.
 */
export function confirmAsync(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: t('Cancel'), style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}
