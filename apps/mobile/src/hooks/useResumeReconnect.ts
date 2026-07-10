import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { MobileClient } from '../client';

/**
 * AppState "active" listener: reconnects the relays the OS killed while
 * backgrounded, bumps `resumeTick` so the feed effects re-subscribe (fresh REQ
 * → backfills the gap), and briefly mutes alert sounds around the resume.
 */
export function useResumeReconnect(client: MobileClient | null) {
  // Bumped whenever the app returns to the foreground. Drives re-subscription
  // of the relay feeds so missed events (offers, messages) backfill on resume.
  const [resumeTick, setResumeTick] = useState(0);
  // Alert sounds are muted for a few seconds around a resume: reconnecting
  // relays REPLAY recent events (a relay that hadn't delivered a message yet,
  // an overlapping backfill window) and those replays rang the "new message"
  // ding on every tab reopen with nothing new to show (user report).
  const alertsMutedUntil = useRef(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      alertsMutedUntil.current = Date.now() + 5000;
      // Re-open any sockets the OS killed while we were backgrounded, then
      // nudge the feeds to re-subscribe (fresh REQ → backfills the gap).
      client?.reconnect().catch(() => {});
      setResumeTick((n) => n + 1);
    });
    return () => sub.remove();
  }, [client]);
  return { resumeTick, alertsMutedUntil };
}
