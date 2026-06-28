/**
 * Local notifications (NATIVE) — fires a device notification when a new Nostr DM
 * arrives while the app is running/recently-backgrounded. No server: it's driven
 * by the live relay subscription (client.onIncomingMessage). Content-blind by
 * design — bodies are generic ("New message"), never the decrypted contents.
 *
 * Limitation: a local notification only fires while the JS/relay socket is alive
 * (foreground or briefly backgrounded). Delivery to a fully-closed app needs a
 * foreground service / push and is out of scope here.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const CHANNEL_ID = 'messages';

// Show the banner even when the app is foregrounded (the in-app badge is the
// primary cue; App gates so this mostly fires when backgrounded).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let ready = false;

/** Create the Android channel and request permission. Call once at startup. */
export async function initNotifications(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Messages',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
      });
    }
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    ready = status === 'granted';
  } catch {
    ready = false;
  }
  return ready;
}

/** Non-prompting check: are notifications currently granted? */
export async function notificationGranted(): Promise<boolean> {
  try { return (await Notifications.getPermissionsAsync()).status === 'granted'; } catch { return false; }
}

/** Prompt for notification permission (no-op dialog if already decided). Returns granted. */
export async function requestNotifications(): Promise<boolean> {
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    ready = status === 'granted';
    return ready;
  } catch { return false; }
}

/** Tab a tapped notification should open (carried in the notification's data). */
export type NotifTarget = { tab?: 'post' | 'messages' | 'browse' | 'settings' };

/**
 * Wire a callback for when the user TAPS a notification (local or push),
 * including a cold start launched from one. Returns an unsubscribe fn.
 */
export function onNotificationTap(cb: (data: NotifTarget) => void): () => void {
  Notifications.getLastNotificationResponseAsync()
    .then((r) => { if (r) cb((r.notification.request.content.data ?? {}) as NotifTarget); })
    .catch(() => {});
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    cb((r.notification.request.content.data ?? {}) as NotifTarget);
  });
  return () => sub.remove();
}

/** Fire an immediate local notification. No-op until permission is granted.
 *  `data` (e.g. {tab}) is attached so tapping it can deep-link into the app. */
export async function notify(title: string, body: string, data?: NotifTarget): Promise<void> {
  if (!ready) return;
  try {
    let trigger: Notifications.NotificationTriggerInput;
    if (Platform.OS === 'web') {
      trigger = null;
    } else {
      // Both iOS AND Android now suspend the process quickly in the background —
      // Android no longer runs a foreground service to stay awake. An immediate
      // trigger requested while the app is backgrounding can be dropped before the
      // OS presents it (the process suspends first), so the banner only shows on
      // reopen. A short time-interval trigger hands the OS a real scheduled local
      // notification it presents on the lock screen / banner even after we
      // suspend. 1s is below the perceptible delay but enough to survive the
      // background→suspend race. On Android the channel is set on the trigger so
      // it still routes to our HIGH-importance channel.
      trigger = (Platform.OS === 'android'
        ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, channelId: CHANNEL_ID }
        : { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 }
      ) as Notifications.NotificationTriggerInput;
    }
    await Notifications.scheduleNotificationAsync({ content: { title, body, data: data ?? {} }, trigger });
  } catch {
    /* best-effort */
  }
}
