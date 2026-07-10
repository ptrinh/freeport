import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { Platform } from 'react-native';
import { onNotificationTap } from '../notify';

type Tab = 'post' | 'messages' | 'browse' | 'settings';

/**
 * Deep-link on notification tap. Native: a tapped local/push notification
 * (incl. cold start). Web: the service worker postMessages an open client.
 */
export function useDeepLinkNav(
  setTab: (t: Tab) => void,
  setMessagesView: (v: 'active' | 'completed') => void,
  deepLinkedRef: MutableRefObject<boolean>,
  pickMessagesView: () => 'active' | 'completed' | null,
) {
  useEffect(() => {
    const go = (t: unknown) => {
      if (t === 'messages' || t === 'browse' || t === 'post' || t === 'settings') {
        deepLinkedRef.current = true;
        if (t === 'messages') { const v = pickMessagesView(); if (v) setMessagesView(v); }
        setTab(t);
      }
    };
    if (Platform.OS !== 'web') {
      return onNotificationTap((data) => go(data?.tab));
    }
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const handler = (e: MessageEvent) => { if (e.data?.type === 'freeport-nav') go(e.data.tab); };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, []);
}
