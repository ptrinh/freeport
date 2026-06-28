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
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

export async function notificationGranted(): Promise<boolean> {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

export async function requestNotifications(): Promise<boolean> {
  try {
    if (typeof Notification === 'undefined') return false;
    return (await Notification.requestPermission()) === 'granted';
  } catch { return false; }
}

/** Tab a tapped notification should open. */
export type NotifTarget = { tab?: 'post' | 'messages' | 'browse' | 'settings' };

// On web, taps are handled by the service worker's `notificationclick` (which
// navigates / postMessages the app), so this is a no-op for API parity.
export function onNotificationTap(_cb: (data: NotifTarget) => void): () => void {
  return () => {};
}

export async function notify(title: string, body: string, data?: NotifTarget): Promise<void> {
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
