/**
 * Small platform/context probes for the web builds.
 *
 * The single-file offline build runs from `file://` (double-clicked HTML, no
 * server). That context can't do things a hosted origin can — notably it can't
 * frame off-origin mini-apps, because the parent origin is `null` and no
 * mini-app host lists `null` in its CSP `frame-ancestors` (allowlisting it
 * would let ANY local page frame mini-apps). Callers use this to degrade
 * gracefully instead of showing a dead "refused to connect" frame.
 */
import { Platform } from 'react-native';

/** True only in the offline single-file build served from `file://`. */
export function isOfflineFile(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof location !== 'undefined' &&
    location.protocol === 'file:'
  );
}
