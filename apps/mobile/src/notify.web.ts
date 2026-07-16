/**
 * Local notifications — WEB. Fires a browser notification when a new Nostr DM
 * arrives while the tab/PWA is open or backgrounded (the live relay socket is
 * still alive). Content-blind by design — bodies are generic ("New message"),
 * never the decrypted contents. App.tsx calls notify() only when the app isn't
 * foregrounded (on web that's a hidden/backgrounded tab; the in-app badge covers
 * the focused case).
 *
 * This is the "tab open / recently backgrounded" tier. Delivery to a fully-closed
 * browser is handled by the PWA Web Push path (push.web.ts + the sender Worker),
 * which wakes the service worker via APNs/FCM — that's complementary, not a
 * duplicate: this one needs no server but only works while the page is alive.
 */
export async function initNotifications(): Promise<boolean> {
  // Don't prompt here — browsers reject Notification.requestPermission() outside
  // a user gesture. Permission is granted from the Settings "Notifications"
  // toggle; we just report whether it's already granted.
  if (isTauri()) return nativeNotificationGranted();
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

// Web Push / Notifications need a SECURE context (HTTPS or localhost) and the
// Notification API. Unavailable when self-hosted over plain http on a LAN IP,
// or in the Tauri desktop WebView. There, treat the "enable notifications"
// required-action as satisfied (nothing the user can do) rather than nag.
import { isTauri, nativeNotificationGranted, nativeRequestNotification, nativeNotify, onNativeNotificationTap } from './desktopNative';

function notifUnavailable(): boolean {
  // Web Push / Notification API needs a secure context (HTTPS/localhost).
  // On the Tauri desktop we instead use the native notification plugin (below),
  // so it is NOT "unavailable" there.
  const g = globalThis as { Notification?: { permission: string; requestPermission?: () => Promise<string> }; location?: { protocol?: string }; isSecureContext?: boolean };
  // file:// (offline single-file build): no service worker, and permission
  // grants aren't persisted — suppress the notifications nag entirely.
  const isFile = g.location?.protocol === 'file:';
  return isFile || g.isSecureContext === false || typeof Notification === 'undefined';
}

export async function notificationGranted(): Promise<boolean> {
  if (isTauri()) return nativeNotificationGranted();
  if (notifUnavailable()) return true; // suppress the nag where push can't work
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

export async function requestNotifications(): Promise<boolean> {
  if (isTauri()) return nativeRequestNotification();
  try {
    if (notifUnavailable() || typeof Notification === 'undefined') return false;
    return (await Notification.requestPermission()) === 'granted';
  } catch { return false; }
}

/** Tab a tapped notification should open. */
export type NotifTarget = { tab?: 'post' | 'messages' | 'browse' | 'settings' };

// On web, taps are handled by the service worker's `notificationclick` (which
// navigates / postMessages the app), so this is a no-op for API parity.
export function onNotificationTap(cb: (data: NotifTarget) => void): () => void {
  // Desktop (Tauri): route native-notification taps here so we can deep-link.
  // On web the service worker's notificationclick handles taps, so no-op.
  if (isTauri()) return onNativeNotificationTap((tab) => cb({ tab: tab as NotifTarget['tab'] }));
  return () => {};
}

export async function notify(title: string, body: string, data?: NotifTarget): Promise<void> {
  if (isTauri()) { await nativeNotify(title, body, data?.tab); return; } // native OS notification on desktop
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const url = data?.tab ? `/?tab=${data.tab}` : '/';
  try {
    // Prefer the service worker registration: it shows the notification even
    // when the page is backgrounded, and matches the SW push styling. The `data`
    // is read by the SW's notificationclick handler to deep-link on tap.
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, {
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag: 'freeport-msg',
          data: { url, tab: data?.tab },
        });
        return;
      }
    }
    // Fallback: page-level notification (works while the tab is alive).
    const n = new Notification(title, { body, icon: '/icons/icon-192.png' });
    n.onclick = () => { try { window.focus(); if (data?.tab) location.search = `?tab=${data.tab}`; } catch { /* ignore */ } };
  } catch {
    /* best-effort */
  }
}
