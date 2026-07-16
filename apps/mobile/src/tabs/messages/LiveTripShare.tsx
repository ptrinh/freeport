import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { MobileClient } from '../../client';
import { kvGet, kvSet } from '../../kv';
import { getCurrentCoords } from '../../maps';
import { createTripSession, tripLink, tripSecret, restoreTripSession, publishTripLocation, type TripStatic, type TripSession } from '../../livetrip';
import { webBase } from '../../webBase';
import { palette } from '../../ui/theme';

// Rider-side control for a confirmed rideshare deal: publishes the rider's GPS
// over Nostr (kind 30420, throwaway key) on a foreground interval and hands out
// a "#trip=…" link anyone can open to watch live. Foreground-only on web — the
// browser pauses timers/geolocation when the tab is backgrounded.
/**
 * Slide-to-confirm control — drag the thumb to the end to fire onConfirm.
 * Used for stage advances (Picked up / Completed) so they can't be tapped by
 * accident. JS-driven translateX (setValue during drag + spring/timing release).
 */
export function LiveTripShare({ client, info, onShare, auto, dealId, alreadyShared }: { client: MobileClient | null; info: TripStatic; onShare?: (link: string) => void; auto?: boolean; dealId?: string; alreadyShared?: boolean }) {
  const c = palette;
  const [sharing, setSharing] = useState(false);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [located, setLocated] = useState(false);
  const [optedOut, setOptedOut] = useState(false);
  const session = useRef<TripSession | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // dealId is a negotiation id ("d:pubkey:pubkey") — the colons are INVALID in an
  // expo-secure-store key (only [A-Za-z0-9._-] allowed), so kvGet/kvSet would throw
  // and the auto-start would hang forever at "Starting live location…". Sanitize it.
  const kvId = (dealId || '').replace(/[^A-Za-z0-9._-]/g, '_');

  const push = async (status: 'live' | 'ended') => {
    if (!client || !session.current) return;
    const coords = await getCurrentCoords();
    if (!coords) return;
    await publishTripLocation(client.pool, session.current, {
      lat: coords.latitude, lon: coords.longitude, ts: Math.floor(Date.now() / 1000), status,
    });
    if (status === 'live') setLocated(true);
  };

  // Begin publishing for a prepared session: post the link to chat (when asked),
  // push the current position, then keep refreshing every 20s. The link is valid
  // right away; the position publishes as soon as GPS resolves and the timer
  // keeps retrying until permission is granted / a fix is available.
  const begin = async (sess: TripSession, shouldPost: boolean) => {
    if (!client) return;
    session.current = sess;
    const url = tripLink(sess, webBase());
    setLink(url);
    setLocated(false);
    setSharing(true);
    // Drop the tracking link straight into the conversation so the other party
    // gets a tappable "Track live location" button — no copy/paste, no tap.
    if (shouldPost) { try { onShare?.(url); } catch { /* ignore */ } }
    const coords = await getCurrentCoords();
    if (coords) {
      await publishTripLocation(client.pool, sess, {
        lat: coords.latitude, lon: coords.longitude, ts: Math.floor(Date.now() / 1000), status: 'live',
      }).then(() => setLocated(true)).catch(() => {});
    }
    if (!timer.current) timer.current = setInterval(() => { push('live').catch(() => {}); }, 20000);
  };

  // Auto-share path: reuse a persisted per-deal key so the link stays stable
  // across remounts/restarts, and only post it to chat the first time.
  const autoBegin = async () => {
    if (!client || !dealId) return;
    // Respect a per-deal opt-out: the user tapped "Stop" and a remount/restart
    // must not silently restart the broadcast.
    if ((await kvGet(`freeport.tripStop.${kvId}`).catch(() => null)) === '1') {
      setOptedOut(true);
      return;
    }
    const saved = await kvGet(`freeport.trip.${kvId}`);
    let sess = saved ? restoreTripSession(saved, info) : null;
    if (!sess) { sess = createTripSession(info); await kvSet(`freeport.trip.${kvId}`, tripSecret(sess)).catch(() => {}); }
    // Post the tracking link to chat once per SESSION, keyed on the session id.
    // The link is derived purely from the session secret, so the peer tracks
    // whichever session we publish to. If the persisted secret ever fails to
    // restore, the line above mints a NEW key; keying the guard on the id (not a
    // deal-level flag) re-shares that new link exactly once, instead of silently
    // publishing location to a session the peer (holding the old, dead link) isn't
    // tracking. A stable, restorable session matches and re-posts nothing.
    const postedId = await kvGet(`freeport.tripPosted.${kvId}`);
    let shouldPost: boolean;
    if (postedId && postedId !== '1') {
      shouldPost = postedId !== sess.id; // re-share only when the session changed
    } else if (postedId === '1' || alreadyShared) {
      // Migration: link shared under the earlier deal-level guard ('1') or before
      // any guard. Adopt this session's id silently, without re-sending.
      shouldPost = false;
      await kvSet(`freeport.tripPosted.${kvId}`, sess.id).catch(() => {});
    } else {
      shouldPost = true; // never shared for this deal
    }
    if (shouldPost) await kvSet(`freeport.tripPosted.${kvId}`, sess.id).catch(() => {});
    await begin(sess, shouldPost);
  };

  const start = async () => { await begin(createTripSession(info), true); };

  const resume = async () => {
    if (dealId) await kvSet(`freeport.tripStop.${kvId}`, '0').catch(() => {});
    setOptedOut(false);
    await autoBegin();
  };

  const stop = async () => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    await push('ended').catch(() => {});
    session.current = null;
    setSharing(false);
    setCopied(false);
    setLocated(false);
    // Remember an explicit opt-out so auto-sharing doesn't restart on remount.
    if (auto) { setOptedOut(true); if (dealId) kvSet(`freeport.tripStop.${kvId}`, '1').catch(() => {}); }
  };

  const shareLink = async () => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && (navigator as Navigator & { clipboard?: { writeText?: (t: string) => Promise<void>; readText?: () => Promise<string> } }).clipboard) {
      try { await (navigator as Navigator & { clipboard?: { writeText?: (t: string) => Promise<void>; readText?: () => Promise<string> } }).clipboard?.writeText?.(link); setCopied(true); return; } catch { /* ignore */ }
    }
    try { await Share.share({ message: link }); } catch { /* ignore */ }
  };

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    // The deal card unmounts this component the moment the trip completes, so
    // stop() never runs in auto mode — publish `ended` here or link-holders
    // keep seeing a stale "live" pin forever.
    if (session.current) { push('ended').catch(() => {}); session.current = null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Kick off automatic sharing for the travelling party once the deal is live.
  // Shared by default — there's no UI to stop it, so we don't gate on a stored
  // opt-out; the driver/provider just shares while the deal is underway.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!auto || !dealId || !client || autoStarted.current) return;
    autoStarted.current = true;
    autoBegin().catch((e) => { autoStarted.current = false; console.warn('[livetrip] auto-start failed', e); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, dealId, client]);

  if (auto) {
    // Shared automatically — but the user must be able to stop a broadcast of
    // their own position without digging through Settings.
    if (optedOut) {
      return (
        <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="navigate-outline" size={14} color={c.muted} />
          <Text style={{ color: c.muted, fontSize: 12, flex: 1 }}>
            {t('Live location sharing is off for this deal.')}
          </Text>
          <Pressable onPress={() => { resume().catch(() => {}); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Resume live location sharing')}>
            <Text style={{ color: c.link, fontSize: 12, fontWeight: '600' }}>{t('Resume')}</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={{ marginTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="navigate" size={14} color={c.text3} />
          <Text style={{ color: c.text3, fontSize: 12, flex: 1 }}>
            🛰 {t('Sharing live location — anyone with the link can see this trip while the app is open.')}
          </Text>
          <Pressable onPress={() => { stop().catch(() => {}); }} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Stop sharing live location')}>
            <Text style={{ color: c.link, fontSize: 12, fontWeight: '600' }}>{t('Stop')}</Text>
          </Pressable>
        </View>
        {sharing && !located && (
          <Text style={{ color: c.warn, fontSize: 12, marginTop: 4 }}>
            📍 {t('Waiting for your location — allow location access to share your position.')}
          </Text>
        )}
      </View>
    );
  }
  if (!sharing) {
    return (
      <Pressable
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.accentBorder, borderRadius: 10, paddingVertical: 11, marginTop: 8 }}
        onPress={() => { start().catch(() => {}); }}
      >
        <Ionicons name="navigate" size={15} color={c.link} />
        <Text style={{ color: c.link, fontWeight: '600' }}>{t('Share live trip')}</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ marginTop: 8, padding: 12, backgroundColor: c.panel, borderWidth: 1, borderColor: c.border, borderRadius: 10 }}>
      <Text style={{ color: c.text3, fontSize: 12, marginBottom: 8 }}>
        🛰 {t('Sharing live location — anyone with the link can see this trip while the app is open.')}
      </Text>
      {!located && (
        <Text style={{ color: c.warn, fontSize: 12, marginBottom: 8 }}>
          📍 {t('Waiting for your location — allow location access to share your position.')}
        </Text>
      )}
      <Text selectable style={{ color: c.link, fontSize: 12, marginBottom: 8 }} numberOfLines={2}>{link}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable style={{ flex: 1, alignItems: 'center', backgroundColor: c.accentBtn, borderRadius: 8, paddingVertical: 9 }} onPress={() => { shareLink().catch(() => {}); }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>{copied ? t('Trip link copied') : t('Share live trip')}</Text>
        </Pressable>
        <Pressable style={{ flex: 1, alignItems: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.borderStrong, borderRadius: 8, paddingVertical: 9 }} onPress={() => { stop().catch(() => {}); }}>
          <Text style={{ color: c.text2, fontWeight: '600' }}>{t('Stop sharing')}</Text>
        </Pressable>
      </View>
    </View>
  );
}
