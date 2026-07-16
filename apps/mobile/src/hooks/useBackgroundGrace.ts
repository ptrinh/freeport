import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { AppState, Platform } from 'react-native';
import type { Intent, Negotiation } from '@freeport/protocol';
import { beginBackgroundTask, endBackgroundTask } from '../backgroundTask';
import { notify } from '../notify';
import { kvGet, kvSet } from '../kv';
import { t } from '../i18n';

/**
 * iOS background keepalive + "updates paused" nag.
 *
 * iOS has no foreground service, so once it suspends the app (~seconds after
 * backgrounding) the relay socket dies and no more alerts arrive. If the user
 * has a live post waiting for offers, warn them just before that suspension so
 * they know to keep the app open / check back. Fires shortly after backgrounding
 * (our proxy for the suspension signal, which managed RN can't observe directly)
 * and is cancelled if they return. Throttled to avoid repeat nags.
 */
export function useBackgroundGrace(
  myIntents: Intent[],
  negos: Negotiation[],
  pushOnRef: MutableRefObject<boolean>,
) {
  const suspendNotifiedRef = useRef(0);
  // Persist the last "updates paused" nag time so a reload/cold start doesn't
  // reset the throttle and re-nag on the next open→close.
  useEffect(() => {
    kvGet('freeport.suspendNotifiedAt').then((v) => { const n = parseInt(v || '0', 10); if (n) suspendNotifiedRef.current = n; }).catch(() => {});
  }, []);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let nagTimer: ReturnType<typeof setTimeout> | null = null;
    let releaseTimer: ReturnType<typeof setTimeout> | null = null;
    const clearTimers = () => {
      if (nagTimer) { clearTimeout(nagTimer); nagTimer = null; }
      if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
    };
    const sub = AppState.addEventListener('change', (state) => {
      clearTimers();
      if (state !== 'background') { endBackgroundTask(); return; } // returned to foreground
      // ALWAYS hold the ~30s extended-background window the instant we background.
      // Without it iOS suspends the process in ~5s, killing the relay socket
      // before an inbound DM arrives AND dropping any just-scheduled local
      // notification before UNUserNotificationCenter presents it — which is why
      // alerts only appeared on reopen. Holding the window keeps the socket alive
      // so the DM lands, and lets the 1s time-interval trigger in notify() fire
      // on the lock screen / banner while still backgrounded. Crucially this runs
      // for everyone (e.g. a Driver with no open post who is about to receive a
      // confirm), not just users with a live post awaiting offers.
      beginBackgroundTask();
      const nowSec = Math.floor(Date.now() / 1000);
      const hasOpenPost = myIntents.some(
        (i) => !i.content.payload?.withdrawn
          && i.content.expires_at >= nowSec
          && !(i.content.window && i.content.window.start < nowSec)
          && !negos.some((n) => n.intent.id === i.id && n.state === 'confirmed'),
      );
      // Skip entirely when the push notification server is on — it keeps
      // delivering in the background, so "alerts paused" would be misleading.
      // Otherwise throttle to at most once per hour, persisted across reloads.
      const wantNag = hasOpenPost && !pushOnRef.current && Date.now() - suspendNotifiedRef.current >= 60 * 60_000;
      // Fire the "updates paused" nag EARLY (5s) — iOS doesn't always grant the
      // full ~30s window, so a notification scheduled at 25s often never presents
      // and only appears on reopen. 5s is safely inside even the minimal window.
      if (wantNag) {
        nagTimer = setTimeout(() => {
          suspendNotifiedRef.current = Date.now();
          kvSet('freeport.suspendNotifiedAt', String(suspendNotifiedRef.current)).catch(() => {});
          notify(t('Updates paused'), t('Freeport was paused in the background, so new-offer alerts have stopped. Keep the app open or check back periodically for updates.'), { tab: 'browse' });
        }, 5000);
      }
      // Hold the extended-background window longer (~25s) so the relay socket
      // stays alive to catch inbound DMs, then release it.
      releaseTimer = setTimeout(() => { endBackgroundTask(); }, 25000);
    });
    return () => { sub.remove(); clearTimers(); endBackgroundTask(); };
  }, [myIntents, negos]);
}
