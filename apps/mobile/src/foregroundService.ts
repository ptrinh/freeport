/**
 * Android foreground service (native). Keeps the app's process — and with it the
 * live Nostr relay WebSocket — awake in the background, so message notifications
 * keep firing long past the brief default background window. Android requires a
 * persistent low-importance notification while a foreground service runs.
 *
 * It does NOT re-implement the relay client: by preventing the process from being
 * suspended, the app's existing subscription (client.watchDMs → onIncomingMessage
 * → notify) keeps working while backgrounded. Opt-in (battery + ongoing notice).
 *
 * Limitations: the service stops if the user force-swipes the app away, or if an
 * aggressive OEM battery manager kills it. Guaranteed closed-app delivery still
 * needs server push (the Worker + watcher).
 */
import { Platform } from 'react-native';
import notifee, { AndroidImportance } from '@notifee/react-native';

const FG_CHANNEL = 'background';

// Register the long-running task at module load so a cold start can re-attach to
// a service Android restored. The task simply stays alive while the service runs.
if (Platform.OS === 'android') {
  notifee.registerForegroundService(() => new Promise(() => {}));
}

export async function startBackgroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await notifee.requestPermission();
    const channelId = await notifee.createChannel({
      id: FG_CHANNEL,
      name: 'Background activity',
      importance: AndroidImportance.LOW,
    });
    await notifee.displayNotification({
      title: 'Freeport',
      body: 'Listening for new messages',
      android: {
        channelId,
        asForegroundService: true,
        ongoing: true,
        importance: AndroidImportance.LOW,
        pressAction: { id: 'default' },
      },
    });
  } catch {
    /* best-effort */
  }
}

export async function stopBackgroundService(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await notifee.stopForegroundService();
  } catch {
    /* best-effort */
  }
}
