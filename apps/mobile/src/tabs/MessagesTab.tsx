import React, { useDeferredValue, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { KIND_KARMA, type Negotiation, type ProposedTerms } from '@freeport/protocol';
import { t, tn } from '../i18n';
import { MobileClient } from '../client';
import { type UserProfile } from '../profile';
import { karmaLabel, type KarmaScore } from '../karma';
import { query } from '../query';
import { fetchReputation } from '../reputation';
import { kvGet, kvSet } from '../kv';
import { uploadImage, uploadFile, UploadError } from '../upload';
import { startRecording, stopRecording, playAudio } from '../voice';
import { negoIsDone, searchableText, isPendingOffer, offerSummary } from '../deals';
import { matchesKeywords } from '../browseFilter';
import { routeUrl, placeUrl, placeParam, dirUrl, getCurrentCoords } from '../maps';
import { createTripSession, tripLink, tripSecret, restoreTripSession, publishTripLocation, type TripStatic, type TripSession } from '../livetrip';
import { webBase } from '../webBase';
import { dirIcon } from '../rtl';
import { categoryOf, subcategoryOf } from '../categories';
import { currencyForMarket, fmtMoney, type Currency } from '../locations';
import { s, palette } from '../ui/theme';
import { defaultIntentTime, fmtClock, timeToWindow, parsePayment, fmtWindow, extractPhone, contactWithoutPhone, stateLabel, stateColor, formatAge } from '../ui/format';
import { uiAlert, runDealAction, confirmAsync, openMaps } from '../ui/alerts';
import { SystemNotice, SlideToConfirm, Field, ReadonlyField, DurationField, TimeField, PaymentField, Row } from '../ui/fields';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
const fmtPayment = fmtMoney;

// ─── Deals tab ───────────────────────────────────────────────────────────────

// Rider-side control for a confirmed rideshare deal: publishes the rider's GPS
// over Nostr (kind 30420, throwaway key) on a foreground interval and hands out
// a "#trip=…" link anyone can open to watch live. Foreground-only on web — the
// browser pauses timers/geolocation when the tab is backgrounded.
/**
 * Slide-to-confirm control — drag the thumb to the end to fire onConfirm.
 * Used for stage advances (Picked up / Completed) so they can't be tapped by
 * accident. JS-driven translateX (setValue during drag + spring/timing release).
 */
function LiveTripShare({ client, info, onShare, auto, dealId, alreadyShared }: { client: MobileClient | null; info: TripStatic; onShare?: (link: string) => void; auto?: boolean; dealId?: string; alreadyShared?: boolean }) {
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
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && (navigator as any).clipboard) {
      try { await (navigator as any).clipboard.writeText(link); setCopied(true); return; } catch {}
    }
    try { await Share.share({ message: link }); } catch {}
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

/** A message-style notification from "System" (Hệ thống) shown in the Messages tab. */
export function DealsTab({
  client,
  negos,
  setNegos,
  profile,
  onScroll,
  view,
  onViewChange,
  expiredNotices = [],
  onDismissExpired,
  glowDealId = null,
  glowCompleted = false,
  role,
  sendLocationOnDeal = true,
  blockedPubkeys,
  onToggleBlock,
}: {
  client: MobileClient | null;
  negos: Negotiation[];
  setNegos: React.Dispatch<React.SetStateAction<Negotiation[]>>;
  profile: UserProfile;
  /** Current user's side: 'passenger' = rider/customer (buyer), 'driver' = driver/provider. */
  role: 'passenger' | 'driver' | '';
  onScroll?: (e: any) => void;
  view: 'active' | 'completed';
  onViewChange: (v: 'active' | 'completed') => void;
  /** Posts that expired with no confirmed deal — shown as System notifications. */
  expiredNotices?: { d: string; title: string }[];
  onDismissExpired?: (id: string) => void;
  /** Deal id whose rating panel should glow (just-celebrated completion). */
  glowDealId?: string | null;
  /** Pulse the Completed segment — the guided tour's "completed rides" step. */
  glowCompleted?: boolean;
  /** When off, don't auto-share live location during an active deal. */
  sendLocationOnDeal?: boolean;
  /** Peer pubkeys (hex) the user has blocked. */
  blockedPubkeys: Set<string>;
  /** Toggle a peer's blocked state (block ⇄ unblock). */
  onToggleBlock: (pubkey: string) => void;
}) {
  const [counteringId, setCounteringId] = useState<string | null>(null);
  // Our full contact (name · phone [· 🚗 vehicle • plate if we're the driver]),
  // sent on counter-offers too so the peer can phone us mid-negotiation.
  const myContactFor = (n: Negotiation): string => {
    const iAmDriver = n.intent.content.schema.startsWith('rideshare') && n.weInitiated;
    const parts = [profile.name, profile.phone];
    if (iAmDriver && profile.vehicleModel?.trim() && profile.plateNumber?.trim()) {
      parts.push(`🚗 ${profile.vehicleModel.trim()} • ${profile.plateNumber.trim()}`);
    }
    return parts.filter(Boolean).join(' · ') || (client?.pubkey.slice(0, 12) ?? '');
  };
  // Deal currently showing the inline "confirm cancellation" buttons (Alert with
  // buttons is a no-op on web, so we confirm inline instead).
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  // Which deals we've already rated. Persisted so a reload doesn't re-show the
  // "Rate this deal" button and let the same deal be rated (karma published) twice.
  const [ratedIds, setRatedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    kvGet('freeport.rated').then((raw) => {
      if (!raw) return;
      try { setRatedIds(new Set(JSON.parse(raw) as string[])); } catch {}
    });
  }, []);
  const markRated = (id: string) =>
    setRatedIds((prev) => {
      const next = new Set([...prev, id]);
      kvSet('freeport.rated', JSON.stringify([...next])).catch(() => {});
      return next;
    });
  const setView = onViewChange;
  // Pulse the Completed segment during the guided tour's "completed rides" step.
  const segGlow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!glowCompleted) { segGlow.stopAnimation(); segGlow.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(segGlow, { toValue: 1, duration: 650, useNativeDriver: false }),
      Animated.timing(segGlow, { toValue: 0, duration: 650, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [glowCompleted, segGlow]);
  // Deals where the user dismissed the auto-opened rater (session-only — a reload
  // re-opens it, which is fine: we still want them to rate a completed deal).
  const [skippedRating, setSkippedRating] = useState<Set<string>>(new Set());
  const [reportingId, setReportingId] = useState<string | null>(null);
  // Fulfillment progress lives on the negotiation (n.stage) so it syncs to both
  // parties over the DM channel and survives reloads — no local-only state.

  // A confirmed deal stays Active until its trip/service is marked completed.
  // Cancelled/expired are always Completed (history).
  const isDone = negoIsDone;
  // Completed deals accumulate forever, so the Completed tab filters by recency.
  // null = all time; otherwise show deals updated within the last N days. Active
  // deals are never date-filtered. Default: last 7 days.
  const COMPLETED_RANGES = [7, 30, 90, null] as const;
  const [completedDays, setCompletedDays] = useState<number | null>(7);
  const completedCutoff = completedDays != null ? Math.floor(Date.now() / 1000) - completedDays * 86400 : 0;
  // Keyword filter for the Completed tab (same idea as Browse). Deferred so typing
  // stays responsive. Searches the post text plus the counterpart's contact name.
  const [completedKeyword, setCompletedKeyword] = useState('');
  const completedKw = useDeferredValue(completedKeyword.trim().toLowerCase());
  const negoText = (n: Negotiation) => (searchableText(n.intent, client) + ' ' + (n.theirContact ?? '')).toLowerCase();
  const sorted = [...negos]
    .filter((n) => {
      if (view !== 'completed') return !isDone(n);
      if (!isDone(n) || n.updatedAt < completedCutoff) return false;
      if (completedKw && !matchesKeywords(negoText(n), completedKw)) return false;
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const header = (
    <View>
      <View style={[s.segRow, { marginHorizontal: 12, marginTop: 8 }]}>
        {(['active', 'completed'] as const).map((v) => {
          const seg = (
            <Pressable onPress={() => setView(v)} style={[s.seg, view === v && s.segActive, { flex: 1 }]}>
              <Ionicons
                name={v === 'active' ? 'pulse-outline' : 'checkmark-done-outline'}
                size={15}
                color={view === v ? palette.chipBlueText : palette.dim}
                style={{ marginEnd: 6 }}
              />
              <Text style={[s.segText, view === v && s.segTextActive]}>
                {v === 'active' ? t('Active') : t('Completed')}
              </Text>
            </Pressable>
          );
          return v === 'completed' && glowCompleted ? (
            <Animated.View
              key={v}
              style={{
                flex: 1, borderRadius: 8, borderWidth: 2,
                borderColor: segGlow.interpolate({ inputRange: [0, 1], outputRange: ['rgba(251,191,36,0.45)', 'rgba(251,191,36,1)'] }),
                backgroundColor: segGlow.interpolate({ inputRange: [0, 1], outputRange: ['rgba(251,191,36,0.04)', 'rgba(251,191,36,0.22)'] }),
                shadowColor: '#fbbf24',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: segGlow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.95] }),
                shadowRadius: segGlow.interpolate({ inputRange: [0, 1], outputRange: [2, 14] }),
              }}
            >
              {seg}
            </Animated.View>
          ) : <React.Fragment key={v}>{seg}</React.Fragment>;
        })}
      </View>
      {/* System notifications — posts that expired with no one accepting. */}
      {view === 'active' && expiredNotices.map((e) => (
        <SystemNotice
          key={'exp-' + e.d}
          text={t('Your post expired — its scheduled time passed and no one accepted it.')}
          detail={e.title}
          onDismiss={() => onDismissExpired?.(e.d)}
        />
      ))}
      {view === 'completed' && (
        <View style={[s.searchInputWrap, { marginHorizontal: 12, marginTop: 8 }]}>
          <Ionicons name="search" size={16} color={palette.dim} />
          <TextInput
            style={s.searchInput}
            value={completedKeyword}
            onChangeText={setCompletedKeyword}
            placeholder={t("Filter by keyword")}
            placeholderTextColor={palette.placeholder}
            autoCapitalize="none"
          />
          {completedKeyword ? (
            <Pressable onPress={() => setCompletedKeyword('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Clear search')}><Ionicons name="close-circle" size={16} color={palette.dim} /></Pressable>
          ) : null}
        </View>
      )}
      {view === 'completed' && (
        <View style={[s.segRow, { marginHorizontal: 12, marginTop: 8 }]}>
          {COMPLETED_RANGES.map((d) => (
            <Pressable key={String(d)} onPress={() => setCompletedDays(d)} style={[s.seg, completedDays === d && s.segActive, { flex: 1 }]}>
              <Text style={[s.segText, completedDays === d && s.segTextActive]}>
                {d === null ? t('All') : tn(d, '{n} day', '{n} days')}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {view === 'completed' && client && <KarmaReceived client={client} />}
    </View>
  );

  const reportNego = reportingId ? negos.find((n) => n.id === reportingId) : null;

  return (
    <>
    {reportNego && (
      <ReportModal
        onClose={() => setReportingId(null)}
        onSubmit={async (reason) => {
          setReportingId(null);
          // Await the publish and be honest about the outcome — telling a user
          // in a bad situation "reported" while nothing left the device is
          // worse than asking them to retry.
          try {
            await client?.rateKarma(reportNego.id, reportNego.peer, -1, `Report: ${reason}`, false);
            uiAlert(t('Reported'), t('Thanks — your report was recorded as negative karma on this deal.'));
          } catch {
            uiAlert(t('Report not sent'), t('Could not connect. Check your internet and try again.'));
          }
        }}
      />
    )}
    <FlatList
      data={sorted}
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      keyExtractor={(n) => n.id}
      contentContainerStyle={{ paddingVertical: 8 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      removeClippedSubviews
      initialNumToRender={6}
      maxToRenderPerBatch={6}
      windowSize={7}
      updateCellsBatchingPeriod={50}
      ListHeaderComponent={header}
      ListEmptyComponent={
        <View style={s.emptyWrap}>
          <Ionicons name={view === 'completed' ? 'checkmark-done-outline' : 'chatbubbles-outline'} size={40} color={palette.dim} />
          <Text style={s.emptyText}>
            {view === 'completed' ? t('No completed deals yet.') : t('No active conversations.')}
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const needsAction =
          item.state === 'accepted_by_them' ||
          (item.state === 'open' && item.termsBy === 'them');
        const isCountering = counteringId === item.id;
        const terminal = item.state === 'confirmed' || item.state === 'cancelled' || item.state === 'expired' || item.state === 'cancel_requested';
        const canAcceptCounter = item.state === 'open' || item.state === 'accepted_by_them';
        const showActions = !isCountering && !terminal && needsAction;
        return (
          <View style={[s.card, needsAction && s.cardHighlight]}>
            {(() => {
              const isRide = item.intent.content.schema.startsWith('rideshare');
              const p = item.intent.content.payload as Record<string, any>;
              // My role in this deal
              let role: string;
              if (isRide) role = item.weInitiated ? t('Driver') : t('Passenger');
              else {
                const posterProvides = item.intent.content.side === 'offer';
                const iProvide = item.weInitiated ? !posterProvides : posterProvides;
                role = iProvide ? t('Provider') : t('Customer');
              }
              // Compact title: "Ride: <destination> @ <time>" / "<service> @ <loc>" (+ payment)
              const win = item.terms?.window ?? item.intent.content.window;
              const timeStr = win ? fmtClock(new Date(win.start * 1000)) : '';
              const pay = item.terms?.payment ?? p.payment;
              let title: string;
              if (isRide) {
                // Show the destination — pairing it with the time reads more naturally
                // ("going to X at 6pm") than the pickup.
                const toShort = String(item.terms?.to ?? p.to?.name ?? '').split(',')[0].trim();
                title = `${t('Ride')}: ${toShort}${timeStr ? ' @ ' + timeStr : ''}`;
              } else {
                const svc = String(item.terms?.service ?? p.service ?? '').trim();
                const locShort = String(item.terms?.location ?? p.location?.name ?? '').split(',')[0].trim();
                title = `${svc}${locShort ? ' @ ' + locShort : ''}${timeStr ? ' · ' + timeStr : ''}`;
              }
              if (pay) title += ` · ${pay}`;
              return (
                <>
                  <View style={[s.row, { justifyContent: 'space-between' }]}>
                    <View style={[s.row, { flexWrap: 'wrap', flex: 1 }]}>
                      <Text style={[s.chip, s.chipBlue]}>{role}</Text>
                      <Text style={[s.chip, stateColor(item.state)]}>{t(stateLabel(item.state))}</Text>
                      {(() => {
                        const cat = categoryOf(item.intent.content.schema, p);
                        const sub = subcategoryOf(item.intent.content.schema, p);
                        return (
                          <>
                            {cat ? <Text style={s.chip}>{t(cat)}</Text> : null}
                            {sub ? <Text style={s.chip}>{t(sub)}</Text> : null}
                          </>
                        );
                      })()}
                    </View>
                    {item.state === 'confirmed' && (
                      <Pressable onPress={() => setReportingId(item.id)} hitSlop={8}>
                        <Text style={s.reportLink}>{'⚠️ ' + t('Report')}</Text>
                      </Pressable>
                    )}
                  </View>
                  <Text style={s.cardTitle}>{title}</Text>
                </>
              );
            })()}

            {/* Route / area shortcuts from the underlying intent */}
            {(() => {
              const p = item.intent.content.payload as Record<string, any>;
              if (item.intent.content.schema.startsWith('rideshare') && p.from?.name && p.to?.name) {
                // Route to the EXACT pinned coordinates (now a high-precision
                // geohash), unless the route was renegotiated to a different label
                // in terms (which carries no pin) — then use that label.
                const from = item.terms?.from && item.terms.from !== p.from.name
                  ? item.terms.from : placeParam(p.from?.geohash, p.from.name);
                const to = item.terms?.to && item.terms.to !== p.to.name
                  ? item.terms.to : placeParam(p.to?.geohash, p.to.name);
                return (
                  <Pressable style={s.mapLink} onPress={() => openMaps(routeUrl(from, to))}>
                    <Text style={s.mapLinkText}>{'🗺 ' + t('View route in Google Maps')}</Text>
                  </Pressable>
                );
              }
              if (item.intent.content.schema.startsWith('service') && p.location?.name) {
                const loc = item.terms?.location ?? p.location.name;
                return (
                  <Pressable style={s.mapLink} onPress={() => openMaps(placeUrl(loc, p.location?.geohash))}>
                    <Text style={s.mapLinkText}>{'🗺 ' + t('View location in Google Maps')}</Text>
                  </Pressable>
                );
              }
              return null;
            })()}

            {/* Note attached to the proposed terms (offer/counter/accept) */}
            {item.terms?.note ? (
              <View style={s.noteBox}>
                <Text style={s.noteLabel}>{item.termsBy === 'us' ? t('Your note') : t('Their note')}</Text>
                <Text style={s.noteText}>{item.terms.note}</Text>
              </View>
            ) : null}

            {/* Confirmed deal */}
            {(item.state === 'confirmed' || item.state === 'cancel_requested') && (() => {
              // We flip to `confirmed` the moment we Accept, but the deal is only
              // mutual once the other side receives it and back-flows their
              // contact. Until that lands (e.g. they're offline), show a pending
              // banner and withhold the trip controls instead of "Deal confirmed".
              const awaiting = item.state === 'confirmed' && !item.theirContact;
              return (
              <>
                {/* Hide the banner once the trip is done — the rater takes over. */}
                {item.stage !== 'completed' && (
                  awaiting ? (
                    <View style={s.pendingBanner}>
                      <Text style={s.pendingText}>{t("Waiting for the other party to come online to confirm…")}</Text>
                      <Text style={s.pendingSub}>{t("You accepted. The deal is confirmed once they receive it — keep the app open.")}</Text>
                      {/* Surface whatever number they published (from their public
                          profile) so you can try to reach them without waiting for
                          them online. Masked → shown as text; full → tap to call. */}
                      {(() => {
                        const peerRaw = client?.profiles.get(item.peer)?.phone || '';
                        if (!peerRaw) return null;
                        const peerCallable = extractPhone(peerRaw);
                        return (
                          <View style={{ marginTop: 8 }}>
                            {peerCallable ? (
                              // The Call button already shows the number — don't repeat it as text.
                              <Pressable style={[s.callBtn, { marginTop: 6 }]} onPress={() => Linking.openURL('tel:' + peerCallable)}>
                                <Ionicons name="call" size={14} color="white" />
                                <Text style={s.callBtnText}>{t('Call')} {peerCallable}</Text>
                              </Pressable>
                            ) : (
                              <Text style={s.pendingSub}>{t('Their number')}: {peerRaw}</Text>
                            )}
                          </View>
                        );
                      })()}
                    </View>
                  ) : (
                  <View style={s.dealBanner}>
                  <Text style={s.dealText}>{t("Deal confirmed")}</Text>
                  {(() => {
                    const phone = extractPhone(item.theirContact);
                    return phone ? (
                      <>
                        <Text style={s.dealContact}>{t('Their contact')}: {contactWithoutPhone(item.theirContact, phone)}</Text>
                        <Pressable style={s.callBtn} onPress={() => Linking.openURL('tel:' + phone)}>
                          <Ionicons name="call" size={14} color="white" />
                          <Text style={s.callBtnText}>{t('Call')} {phone}</Text>
                        </Pressable>
                      </>
                    ) : (
                      <Text style={s.dealContact}>{t('Their contact')}: {item.theirContact ?? '—'}</Text>
                    );
                  })()}
                  </View>
                  )
                )}
                {/* Fulfillment flow: Confirmed → Picked up → Completed trip → Rate.
                    Withheld until the deal is mutually confirmed (not just accepted). */}
                {item.state === 'confirmed' && !awaiting && (() => {
                  const isRide = item.intent.content.schema.startsWith('rideshare');
                  const st = item.stage;
                  const startLabel = isRide ? t('Picked up') : t('Started service/delivery');
                  const doneLabel = isRide ? t('Completed trip') : t('Service completed');
                  const statusText = st === 'completed'
                    ? '✓ ' + (isRide ? t('Trip completed') : t('Service completed'))
                    : st === 'picked_up'
                      ? '● ' + (isRide ? t('Picked up — in transit') : t('In progress'))
                      : '○ ' + t('Confirmed — not started yet');
                  return (
                    <>
                      <Text style={s.stageLine}>{statusText}</Text>
                      {/* Turn-by-turn navigation for whoever travels: the driver
                          heads to the pickup, then to the destination once the
                          passenger is aboard; for a service/product deal, either
                          side can route to the agreed meeting point. */}
                      {st !== 'completed' && (() => {
                        const p = item.intent.content.payload as Record<string, any>;
                        const iAmDriver = item.weInitiated;
                        // Navigation prefers the human ADDRESS over the geohash: a 6-char
                        // geohash (~±600m) decodes to a centre Google snaps to the nearest
                        // building (e.g. "100 Orchard Road" landed on "The Metz, 83
                        // Devonshire Rd"). The typed address geocodes accurately; fall back
                        // to the geohash coordinate only when there's no name.
                        // Prefer the EXACT pinned coordinates (high-precision geohash);
                        // fall back to the typed name only if there's no pin.
                        const navDest = (name?: string, geohash?: string) =>
                          placeParam(geohash, (name || '').trim());
                        let dest = '', label = '';
                        if (isRide) {
                          if (!iAmDriver) return null; // passenger tracks the driver instead
                          if (st === 'picked_up') {
                            dest = navDest(item.terms?.to || p.to?.name, p.to?.geohash);
                            label = t('Navigate to destination');
                          } else {
                            dest = navDest(item.terms?.from || p.from?.name, p.from?.geohash);
                            label = t('Navigate to pickup');
                          }
                        } else {
                          dest = navDest(item.terms?.location || p.location?.name, p.location?.geohash);
                          label = t('Navigate to location');
                        }
                        if (!dest) return null;
                        return (
                          <Pressable style={s.navBtn} onPress={() => openMaps(dirUrl(dest))}>
                            <Ionicons name="navigate" size={15} color={palette.link} />
                            <Text style={s.navBtnText}>{label}</Text>
                          </Pressable>
                        );
                      })()}
                      {!st && (
                        // Buyer side (rideshare passenger / services customer): before the
                        // deal proceeds, confirm they met the *right* counterparty. The
                        // positive button advances the deal; a plate/phone mismatch is a
                        // serious safety risk → warn hard and report on the spot. The
                        // seller side (driver / provider) keeps the plain start button.
                        role === 'passenger' ? (
                          <View style={{ gap: 8 }}>
                            <Pressable style={s.btnAccept} onPress={() => runDealAction(client?.setStage(item.id, 'picked_up'), t('Could not update the deal'))}>
                              <Text style={s.btnText}>{isRide ? t('I entered the correct vehicle') : t('Met the correct provider')}</Text>
                            </Pressable>
                            <Pressable
                              style={s.btnDangerOutline}
                              onPress={async () => {
                                const ok = await confirmAsync(
                                  isRide ? t('Do not get in this vehicle') : t('Do not proceed with this deal'),
                                  isRide
                                    ? t("A licence plate or phone number that doesn't match is a serious safety risk. Do NOT get in. We'll report this immediately so others are warned.")
                                    : t("A phone number that doesn't match is a serious safety risk. Do NOT continue. We'll report this immediately so others are warned."),
                                  t('Report now'),
                                );
                                if (!ok) return;
                                const reason = isRide
                                  ? 'Report: Incorrect licence plate or phone number — vehicle did not match the listing'
                                  : 'Report: Incorrect phone number — provider did not match the listing';
                                // Await + honest outcome: never claim "reported"
                                // when the publish failed — the user is making a
                                // safety decision on that information.
                                try {
                                  await client?.rateKarma(item.id, item.peer, -1, reason, false);
                                  uiAlert(t('Reported — stay safe'), isRide
                                    ? t('Thank you. This was reported as negative karma on this deal. Do not get in the vehicle.')
                                    : t('Thank you. This was reported as negative karma on this deal. Do not continue with this provider.'));
                                } catch {
                                  uiAlert(t('Report not sent'), t('Could not connect. Check your internet and try again.') + ' ' + (isRide ? t('Do not get in the vehicle.') : t('Do not continue with this provider.')));
                                }
                              }}
                            >
                              <Text style={s.btnDangerOutlineText}>{'⚠️ ' + (isRide ? t('Incorrect plate number or phone number') : t('Incorrect phone number from provider'))}</Text>
                            </Pressable>
                          </View>
                        ) : (
                          <SlideToConfirm label={startLabel} onConfirm={() => runDealAction(client?.setStage(item.id, 'picked_up'), t('Could not update the deal'))} />
                        )
                      )}
                      {st === 'picked_up' && (
                        <SlideToConfirm label={doneLabel} onConfirm={() => runDealAction(client?.setStage(item.id, 'completed'), t('Could not update the deal'))} />
                      )}
                      {/* Trip done → the rater opens automatically. Skipping shows a
                          button to reopen it; once submitted it's locked. */}
                      {st === 'completed' && (
                        ratedIds.has(item.id) ? (
                          <Text style={s.ratedText}>{t("Rating submitted")}</Text>
                        ) : skippedRating.has(item.id) ? (
                          <Pressable style={s.rateBtn} onPress={() => setSkippedRating((prev) => { const n = new Set(prev); n.delete(item.id); return n; })}>
                            <Text style={s.rateBtnText}>{t("Rate this deal")}</Text>
                          </Pressable>
                        ) : (
                          <KarmaRater
                            glow={glowDealId === item.id}
                            onSubmit={async (score, note, contactVerified) => {
                              await client?.rateKarma(item.id, item.peer, score, note, contactVerified);
                              markRated(item.id);
                            }}
                            onCancel={() => setSkippedRating((prev) => new Set([...prev, item.id]))}
                          />
                        )
                      )}
                      {/* Live-location sharing while the deal is underway. BOTH parties
                          auto-share the moment the deal is confirmed — each one's link is
                          posted into the chat so the other just taps "Track live location".
                          No button to press; the share UI is a passive status line. */}
                      {st !== 'completed' && sendLocationOnDeal && (() => {
                        const p = item.intent.content.payload as Record<string, any>;
                        const iAmDriver = item.weInitiated; // rideshare responder = driver
                        // BOTH sides auto-share once the deal is confirmed (no role gate),
                        // so passenger+driver / customer+provider can each follow the other.
                        const myName = profile.name || undefined;
                        const theirName = (item.theirContact || '').split('·')[0].trim() || undefined;
                        const shareLink = (link: string) => { client?.sendChat(item.id, link).catch(() => {}); };
                        const alreadyShared = (item.messages || []).some((m) => m.dir === 'out' && isTripMsg(m.text));
                        // Trip metadata (route + the driver's vehicle/plate) is identical for
                        // both parties; only which name is the "driver" flips by side.
                        let vehicleModel: string | undefined, plateNumber: string | undefined;
                        if (isRide) {
                          if (iAmDriver) {
                            vehicleModel = profile.vehicleModel?.trim() || undefined;
                            plateNumber = profile.plateNumber?.trim() || undefined;
                          } else {
                            const m = (item.theirContact || '').match(/🚗\s*(.+)$/);
                            if (m) { const [vm, pl] = m[1].split('•').map((x) => x.trim()); vehicleModel = vm || undefined; plateNumber = pl || undefined; }
                          }
                        }
                        const info: TripStatic = isRide
                          ? {
                              from: item.terms?.from || p.from?.name || '',
                              to: item.terms?.to || p.to?.name || '',
                              vehicle: p.subcategory || p.vehicle || undefined,
                              driver: iAmDriver ? myName : theirName,
                              phone: iAmDriver ? (profile.phone || undefined) : (extractPhone(item.theirContact || '') || undefined),
                              vehicleModel, plateNumber,
                              passenger: iAmDriver ? theirName : myName,
                            }
                          : {
                              from: item.terms?.location || p.location?.name || '',
                              to: '',
                              driver: myName, phone: profile.phone || undefined, passenger: theirName,
                            };
                        return (
                          <LiveTripShare
                            client={client}
                            auto
                            dealId={item.id}
                            alreadyShared={alreadyShared}
                            onShare={shareLink}
                            info={info}
                          />
                        );
                      })()}
                    </>
                  );
                })()}

                {/* Cancellation. Before the deal is mutually confirmed (we accepted
                    but they haven't acknowledged), it's not a real deal yet — allow an
                    immediate unilateral cancel. Once mutual, use the cooperative
                    request-and-agree flow (karma stays 0). Done → no cancelling. */}
                {item.state === 'confirmed' && item.stage !== 'completed' && (
                  awaiting ? (
                    confirmCancelId === item.id ? (
                      <View style={s.cancelBox}>
                        <Text style={s.cancelBoxText}>{t("The deal isn't confirmed yet, so this cancels your offer immediately.")}</Text>
                        <View style={s.btnRow}>
                          <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={() => setConfirmCancelId(null)}>
                            <Text style={s.btnText}>{t("Keep")}</Text>
                          </Pressable>
                          <Pressable style={[s.btnDecline, { flex: 1 }]} onPress={() => { runDealAction(client?.decline(item.id), t('Could not update the deal')); setConfirmCancelId(null); }}>
                            <Text style={s.btnText}>{t("Cancel offer")}</Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : (
                      <Pressable hitSlop={8} onPress={() => setConfirmCancelId(item.id)}>
                        <Text style={s.cancelLink}>{t("Cancel offer")}</Text>
                      </Pressable>
                    )
                  ) : (
                  confirmCancelId === item.id ? (
                    <View style={s.cancelBox}>
                      <Text style={s.cancelBoxText}>{t("Send a cancellation request to the other party. The deal is only cancelled when both agree — no karma impact.")}</Text>
                      <View style={s.btnRow}>
                        <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={() => setConfirmCancelId(null)}>
                          <Text style={s.btnText}>{t("Keep deal")}</Text>
                        </Pressable>
                        <Pressable style={[s.btnDecline, { flex: 1 }]} onPress={() => { runDealAction(client?.requestCancel(item.id), t('Could not update the deal')); setConfirmCancelId(null); }}>
                          <Text style={s.btnText}>{t("Request cancellation")}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable hitSlop={8} onPress={() => setConfirmCancelId(item.id)}>
                      <Text style={s.cancelLink}>{t("Request to cancel deal")}</Text>
                    </Pressable>
                  )
                  )
                )}
                {item.state === 'cancel_requested' && item.cancelRequestedBy === 'them' && (
                  <View style={s.cancelBox}>
                    <Text style={s.cancelBoxText}>{t("The other party requested to cancel this deal. Agreeing cancels it (no karma impact).")}</Text>
                    <View style={s.btnRow}>
                      <Pressable style={[s.btnDecline, { flex: 1 }]} onPress={() => runDealAction(client?.agreeCancel(item.id), t('Could not update the deal'))}>
                        <Text style={s.btnText}>{t("Agree to cancel")}</Text>
                      </Pressable>
                      <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={() => runDealAction(client?.keepDeal(item.id), t('Could not update the deal'))}>
                        <Text style={s.btnText}>{t("Keep deal")}</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
                {item.state === 'cancel_requested' && item.cancelRequestedBy === 'us' && (
                  <Text style={s.cancelBoxText}>{t("Cancellation requested — waiting for the other party to agree.")}</Text>
                )}

                {/* Block this person — completed deals only. Blocking drops all
                    further inbound messages from this peer (client-side). */}
                {isDone(item) && item.peer ? (() => {
                  const isBlocked = blockedPubkeys.has(item.peer);
                  const doBlock = () => onToggleBlock(item.peer);
                  const onPress = () => {
                    if (isBlocked) { doBlock(); return; } // unblock needs no confirm
                    if (Platform.OS === 'web') {
                      if ((globalThis as any).confirm?.(`${t('Block this person?')}\n\n${t('You will not receive any more messages from them.')}`)) doBlock();
                    } else {
                      Alert.alert(t('Block this person?'), t('You will not receive any more messages from them.'), [
                        { text: t('Cancel'), style: 'cancel' },
                        { text: t('Block'), style: 'destructive', onPress: doBlock },
                      ]);
                    }
                  };
                  return (
                    <Pressable style={s.blockBtn} onPress={onPress} hitSlop={6}>
                      <Ionicons name={isBlocked ? 'ban' : 'ban-outline'} size={14} color={palette.danger} />
                      <Text style={s.blockBtnText}>{isBlocked ? t('Unblock') : t('Block this person')}</Text>
                    </Pressable>
                  );
                })() : null}

                <ChatThread nego={item} onSend={(t) => client?.sendChat(item.id, t) ?? Promise.resolve()} />
              </>
              );
            })()}

            {/* My offer is out, the poster hasn't responded — without this the
                card showed nothing below the title and read as broken next to
                accepted deals with their waiting banner (user report). */}
            {isPendingOffer(item) && (() => {
              const summary = offerSummary(item.terms, (d) => fmtClock(d));
              return (
                <>
                  <View style={s.pendingBanner}>
                    <Text style={s.pendingText}>{t('Offer sent — waiting for the other party to respond…')}</Text>
                    <Text style={s.pendingSub}>
                      {summary ? t('You offered {terms}. They can accept, counter, or decline.', { terms: summary })
                               : t('They can accept, counter, or decline.')}
                    </Text>
                  </View>
                  {confirmCancelId === item.id ? (
                    <View style={s.cancelBox}>
                      <Text style={s.cancelBoxText}>{t("The deal isn't confirmed yet, so this cancels your offer immediately.")}</Text>
                      <View style={s.btnRow}>
                        <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={() => setConfirmCancelId(null)}>
                          <Text style={s.btnText}>{t("Keep")}</Text>
                        </Pressable>
                        <Pressable style={[s.btnDecline, { flex: 1 }]} onPress={() => { runDealAction(client?.decline(item.id), t('Could not update the deal')); setConfirmCancelId(null); }}>
                          <Text style={s.btnText}>{t("Cancel offer")}</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable hitSlop={8} onPress={() => setConfirmCancelId(item.id)}>
                      <Text style={s.cancelLink}>{t("Cancel offer")}</Text>
                    </Pressable>
                  )}
                </>
              );
            })()}

            {/* Peer's contact during negotiation — their offer/counter now carries
                their full number (over the encrypted DM), so either party can phone
                the other before the deal is confirmed. Confirmed/cancel states show
                the contact in the deal banner instead, so skip it there. */}
            {item.theirContact && item.state !== 'confirmed' && item.state !== 'cancel_requested' && (() => {
              const phone = extractPhone(item.theirContact);
              return (
                <View style={s.dealBanner}>
                  <Text style={s.dealContact}>{t('Their contact')}: {phone ? contactWithoutPhone(item.theirContact, phone) : (item.theirContact ?? '—')}</Text>
                  {phone && (
                    <Pressable style={s.callBtn} onPress={() => Linking.openURL('tel:' + phone)}>
                      <Ionicons name="call" size={14} color="white" />
                      <Text style={s.callBtnText}>{t('Call')} {phone}</Text>
                    </Pressable>
                  )}
                </View>
              );
            })()}

            {/* Action buttons — when the peer proposed terms */}
            {showActions && (
              <>
              {item.state === 'accepted_by_them' && (
                <Text style={[s.dim, { marginTop: 10 }]}>{t("The other party agreed — confirm to finalize & exchange contact.")}</Text>
              )}
              <View style={s.btnRow}>
                {canAcceptCounter && item.terms && (
                  <Pressable
                    style={s.btnAccept}
                    onPress={() => {
                      // In a rideshare deal the responder (weInitiated) is the driver.
                      const iAmDriver = item.intent.content.schema.startsWith('rideshare') && item.weInitiated;
                      // A driver must have vehicle details on file — they're sent to the
                      // passenger over DM on confirm so they can identify the car.
                      if (iAmDriver && (!profile.vehicleModel?.trim() || !profile.plateNumber?.trim())) {
                        Alert.alert(
                          t('Vehicle details required'),
                          t('Add your vehicle model and plate number in Profile before accepting a ride. They are shared with the passenger over encrypted DM when the deal is confirmed.'),
                        );
                        return;
                      }
                      // Contact travels via encrypted DM only — full phone is safe here.
                      const parts = [profile.name, profile.phone];
                      if (iAmDriver) parts.push(`🚗 ${profile.vehicleModel.trim()} • ${profile.plateNumber.trim()}`);
                      const contact = parts.filter(Boolean).join(' · ') || client!.pubkey.slice(0, 12);
                      runDealAction(client?.accept(item.id, contact), t('Could not update the deal'));
                    }}
                  >
                    <Text style={s.btnText}>{item.state === 'accepted_by_them' ? t('Confirm deal') : t('Accept')}</Text>
                  </Pressable>
                )}
                {canAcceptCounter && (
                  <Pressable style={s.btnGhost} onPress={() => setCounteringId(item.id)}>
                    <Text style={s.btnGhostText}>{t("Counter")}</Text>
                  </Pressable>
                )}
                <Pressable style={s.btnTextOnly} onPress={() => { runDealAction(client?.decline(item.id), t('Could not update the deal')); setCounteringId(null); }}>
                  <Text style={s.btnTextDanger}>{t("Decline")}</Text>
                </Pressable>
              </View>
              </>
            )}

            {/* Counter-offer editor */}
            {isCountering && (
              <CounterEditor
                nego={item}
                onSend={async (terms) => {
                  await client?.counter(item.id, terms, myContactFor(item));
                  setCounteringId(null);
                }}
                onCancel={() => setCounteringId(null)}
              />
            )}
          </View>
        );
      }}
    />
    </>
  );
}

/** Report-a-problem sheet: pick a reason, Submit → negative karma on the deal. */
function ReportModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string) => void }) {
  const REASONS = [
    'Could not contact',
    'Incorrect phone number/vehicle details',
    'No-show / didn’t appear',
    'Cancelled last minute',
    'Not as agreed',
    'Other',
  ];
  const [reason, setReason] = useState(REASONS[0]);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.sortBackdrop} onPress={onClose}>
        <Pressable style={s.sortSheet} onPress={() => {}}>
          <Text style={s.sectionTitle}>{t("Report a problem")}</Text>
          <Text style={s.dim}>{t("Submitting records a negative karma (−1) tied to this deal.")}</Text>
          <View style={{ marginTop: 10 }}>
            {REASONS.map((r) => (
              <Pressable key={r} style={s.reportReason} onPress={() => setReason(r)}>
                <View style={[s.radio, reason === r && s.radioOn]}>
                  {reason === r && <View style={s.radioDot} />}
                </View>
                <Text style={s.reportReasonText}>{t(r)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.btnRow}>
            <Pressable style={[s.btnDecline, { flex: 1 }]} onPress={onClose}>
              <Text style={s.btnText}>{t("Cancel")}</Text>
            </Pressable>
            <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={() => onSubmit(reason)}>
              <Text style={s.btnText}>{t("Submit")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Karma/feedback this user has RECEIVED (kind:32103 with #p = my pubkey). */
/** Compact self stats under the avatar: Karma · Completed deals · Account age.
 *  Tap → open Messages → Completed (feedback received). */
export function SelfStats({ client, onPress }: { client: MobileClient; onPress: () => void }) {
  const [rep, setRep] = useState<{ score: number; deals: number; count: number } | null>(null);
  const [createdAt, setCreatedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Account-creation timestamp — stamped here lazily if not set yet.
      let c = await kvGet('freeport.created');
      if (!c) { c = String(Math.floor(Date.now() / 1000)); await kvSet('freeport.created', c); }
      if (!cancelled) setCreatedAt(parseInt(c, 10));
    })();
    fetchReputation(client.pool, client.relays, client.pubkey, null)
      .then((r) => { if (!cancelled) setRep({ score: r.score, deals: r.deals, count: r.ratingCount }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [client]);

  const age = createdAt ? formatAge(Date.now() / 1000 - createdAt) : '…';
  return (
    <Pressable style={s.statsRow} onPress={onPress}>
      <View style={s.statBox}>
        <Text style={s.statValue} numberOfLines={1}>{rep ? karmaLabel(rep.score, rep.count) : '…'}</Text>
        <Text style={s.statLabel}>{t("Karma score")}{rep && rep.count ? ` · ${rep.count}` : ''}</Text>
      </View>
      <View style={s.statBox}>
        <Text style={s.statValue}>{rep ? rep.deals : '…'}</Text>
        <Text style={s.statLabel}>{t("Completed deals")}</Text>
      </View>
      <View style={s.statBox}>
        <Text style={s.statValue}>{age}</Text>
        <Text style={s.statLabel}>{t("Account age")}</Text>
      </View>
      <Ionicons name={dirIcon('chevron-forward', 'chevron-back')} size={16} color={palette.dim} />
    </Pressable>
  );
}

function KarmaReceived({ client }: { client: MobileClient }) {
  const [loading, setLoading] = useState(true);
  const [ratings, setRatings] = useState<{ score: number; note?: string; from: string; ts: number }[]>([]);

  useEffect(() => {
    let cancelled = false;
    // Keep the latest karma event per (rater, d-tag). Backfill once, then keep
    // a live subscription open so a rating that lands while this screen is open
    // shows up without a reload (previously it only fetched once on mount).
    const latest = new Map<string, any>();
    const recompute = () => {
      if (cancelled) return;
      const parsed = [...latest.values()]
        .flatMap((ev) => {
          try {
            const c = JSON.parse(ev.content);
            if (typeof c.score !== 'number') return [];
            return [{ score: c.score as number, note: c.note as string | undefined, from: ev.pubkey as string, ts: ev.created_at as number }];
          } catch { return []; }
        })
        .sort((a, b) => b.ts - a.ts);
      setRatings(parsed);
    };
    const ingest = (ev: any) => {
      const d = ev.tags.find((t: string[]) => t[0] === 'd')?.[1] ?? '';
      const k = `${ev.pubkey}|${d}`;
      const prev = latest.get(k);
      if (prev && prev.created_at >= ev.created_at) return false;
      latest.set(k, ev);
      return true;
    };
    query(client.pool, client.relays, { kinds: [KIND_KARMA], '#p': [client.pubkey], limit: 200 })
      .then((events) => { if (cancelled) return; events.forEach(ingest); recompute(); })
      .finally(() => { if (!cancelled) setLoading(false); });
    const sub = client.pool.subscribeMany(
      client.relays,
      { kinds: [KIND_KARMA], '#p': [client.pubkey], since: Math.floor(Date.now() / 1000) },
      { onevent: (ev: any) => { if (ingest(ev)) recompute(); } },
    );
    return () => { cancelled = true; sub.close(); };
  }, [client]);

  const count = ratings.length;
  const avg = count ? ratings.reduce((sum, r) => sum + r.score, 0) / count : 0;
  const emoji = (sc: number) => (sc >= 2 ? '⭐' : sc >= 1 ? '👍' : sc >= 0 ? '😐' : '👎');

  return (
    <View style={[s.card, { marginTop: 4 }]}>
      <Text style={[s.sectionTitle, { marginTop: 0 }]}>{t("Feedback received")}</Text>
      {loading ? (
        <ActivityIndicator color="#3b82f6" style={{ marginTop: 6 }} />
      ) : count === 0 ? (
        <Text style={s.dim}>{t("No ratings yet. Complete deals to build karma.")}</Text>
      ) : (
        <>
          <Text style={[s.repLine, { marginStart: 0 }]}>
            {karmaLabel(avg, count)} · {t('{count} ratings', { count })} · avg {avg.toFixed(1)}
          </Text>
          {ratings.map((r, i) => (
            <View key={i} style={[s.row, { marginTop: 6, alignItems: 'flex-start' }]}>
              <Text style={{ fontSize: 14, marginEnd: 6 }}>{emoji(r.score)}</Text>
              <Text style={s.rowValue}>
                {r.note || t('(no note)')} <Text style={s.meta}>· {r.from.slice(0, 8)}…</Text>
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function CounterEditor({
  nego,
  onSend,
  onCancel,
}: {
  nego: Negotiation;
  onSend: (terms: ProposedTerms) => Promise<void>;
  onCancel: () => void;
}) {
  const isRide = nego.intent.content.schema.startsWith('rideshare');
  const existing = nego.terms ?? {};
  const existingWindow = existing.window;
  // Same market-derived default as RespondEditor: counters on unpriced threads
  // follow the intent's market currency, not a hardcoded one.
  const existingPay = parsePayment(existing.payment, currencyForMarket(nego.intent.content.market, 'USD'));
  const existingDur = existing.duration_minutes ?? 60;
  const [time, setTime] = useState<Date>(() =>
    existingWindow ? new Date(existingWindow.start * 1000) : defaultIntentTime(),
  );
  const [flexible, setFlexible] = useState(!existingWindow);
  const [payAmount, setPayAmount] = useState(existingPay.amount);
  const [payCurrency, setPayCurrency] = useState<Currency>(existingPay.currency);
  // Ride route is locked to the original request — display only, never edited.
  const ridePayload = nego.intent.content.payload as any;
  const routeFrom = String(existing.from ?? ridePayload?.from?.name ?? '');
  const routeTo = String(existing.to ?? ridePayload?.to?.name ?? '');
  const [location, setLocation] = useState(existing.location ?? '');
  const [service, setService] = useState(existing.service ?? '');
  const [durHours, setDurHours] = useState(Math.floor(existingDur / 60));
  const [durMinutes, setDurMinutes] = useState(existingDur % 60);
  const [note, setNote] = useState(existing.note ?? '');

  const send = async () => {
    const terms: ProposedTerms = {
      window: timeToWindow(time, flexible),
      payment: payAmount > 0 ? fmtPayment(payAmount, payCurrency) : undefined,
      note: note || undefined,
    };
    if (isRide) {
      // Route stays as the original request's — preserve it, don't let a counter change it.
      if (routeFrom) terms.from = routeFrom;
      if (routeTo) terms.to = routeTo;
    } else {
      if (location) terms.location = location;
      if (service) terms.service = service;
      const dur = durHours * 60 + durMinutes;
      if (dur > 0) terms.duration_minutes = dur;
    }
    try {
      await onSend(terms);
    } catch (e) {
      uiAlert(t('Could not send'), e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <View style={s.counterBox}>
      <Text style={s.sectionTitle}>{t("Your counter-offer")}</Text>
      {isRide ? (
        <>
          {/* Route is fixed by the original request — you negotiate time/price,
              not where the ride goes. Shown read-only. */}
          <ReadonlyField label={t("From")} value={routeFrom} />
          <ReadonlyField label={t("To")} value={routeTo} />
        </>
      ) : (
        <>
          <Field label={t("Location")} value={location} onChange={setLocation} placeholder={t("leave blank to keep")} />
          <Field label={t("Service")} value={service} onChange={setService} placeholder={t("leave blank to keep")} />
          <DurationField hours={durHours} minutes={durMinutes} onChange={(h, m) => { setDurHours(h); setDurMinutes(m); }} />
        </>
      )}
      <TimeField time={time} onChange={setTime} flexible={flexible} onFlexible={setFlexible} />
      <PaymentField amount={payAmount} currency={payCurrency} onChange={(a, c) => { setPayAmount(a); setPayCurrency(c); }} />
      <Field label={t("Note")} value={note} onChange={setNote} placeholder={t("optional note")} />
      <View style={s.btnRow}>
        <Pressable style={s.btnAccept} onPress={send}><Text style={s.btnText}>{t("Send counter")}</Text></Pressable>
        <Pressable style={s.btnDecline} onPress={onCancel}><Text style={s.btnText}>{t("Cancel")}</Text></Pressable>
      </View>
    </View>
  );
}

/**
 * Header connectivity indicator: a solid colored core wrapped in a soft halo
 * that continuously expands and fades (a "glow" pulse) so the status reads at a
 * glance. Color reflects online (green) / offline (red) / connecting (amber).
 */
/** Free-text chat for a confirmed deal — coordinate pickup, share details. */
/** A chat message that is just an uploaded image URL renders as an image. */
export function isImageMsg(t: string): boolean {
  if (!/^https?:\/\//i.test(t)) return false;
  if (isAudioMsg(t)) return false; // audio/voice URLs (also hosted on nostr.build) are not images
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(t) || /nostr\.build|image\.nostr|imgur|i\.ibb/i.test(t);
}

/** A chat message that is an uploaded audio URL renders as a play button. */
export function isAudioMsg(t: string): boolean {
  if (!/^https?:\/\//i.test(t)) return false;
  return /\.(m4a|mp3|webm|ogg|caf|mp4|wav|aac)(\?|$)/i.test(t);
}

/** A live-location share link (".../#t=<key>") renders as a tap-to-track button. */
export function isTripMsg(t: string): boolean {
  return /^https?:\/\/\S+#t=[A-Za-z0-9\-_]+/.test(t.trim());
}

/** A single voice-memo bubble with a tap-to-play button. */
function VoiceMessage({ url, dir }: { url: string; dir: 'in' | 'out' }) {
  const [playing, setPlaying] = useState(false);
  const play = async () => {
    setPlaying(true);
    try { await playAudio(url); } catch {} finally { setPlaying(false); }
  };
  // Outgoing bubbles are accent-filled; the default text/accent colors are low
  // contrast on them in light mode — use the light "out" color there.
  const outColor = dir === 'out' ? '#f5f7fa' : undefined;
  return (
    <Pressable style={s.voiceMsg} onPress={play}>
      <Ionicons name={playing ? 'volume-high' : 'play'} size={18} color={outColor ?? palette.accent} />
      <Text style={[s.voiceMsgText, dir === 'out' && s.chatTextOut]}>{t("Voice memo")}</Text>
    </Pressable>
  );
}

// Memoised so typing in the message box (which re-renders ChatThread on every
// keystroke) doesn't re-render the whole chat history. Each bubble only
// re-renders if its own message or the zoom handler changes.
const ChatBubble = React.memo(function ChatBubble({
  text,
  dir,
  onZoom,
}: {
  text: string;
  dir: 'in' | 'out';
  onZoom: (uri: string) => void;
}) {
  return (
    <View style={[s.chatBubble, dir === 'out' ? s.chatOut : s.chatIn]}>
      {isAudioMsg(text)
        ? <VoiceMessage url={text} dir={dir} />
        : isImageMsg(text)
        ? <Pressable onPress={() => onZoom(text)}>
            <Image source={{ uri: text }} style={s.chatImage} resizeMode="cover" />
          </Pressable>
        : isTripMsg(text)
        ? <Pressable style={s.trackMsg} onPress={() => Linking.openURL(text.trim())}>
            {/* On an outgoing (accent-filled) bubble the link color equals the
                bubble color in light mode — use the light "out" text color so it
                stays legible on both sides. */}
            <Ionicons name="navigate" size={16} color={dir === 'out' ? '#f5f7fa' : palette.link} />
            <Text style={[s.trackMsgText, dir === 'out' && s.chatTextOut]}>{t('Track live location')}</Text>
          </Pressable>
        : <Text style={[s.chatBubbleText, dir === 'out' ? s.chatTextOut : s.chatTextIn]}>{text}</Text>}
    </View>
  );
});

function ChatThread({ nego, onSend }: { nego: Negotiation; onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [showAllMsgs, setShowAllMsgs] = useState(false);
  const msgs = nego.messages ?? [];
  // Keep the thread compact: show only the most recent few, with a tap to reveal
  // the rest. Otherwise a long conversation pushes the input box far down the card.
  const CHAT_PREVIEW = 5;
  const collapsedMsgs = !showAllMsgs && msgs.length > CHAT_PREVIEW;
  const shownMsgs = collapsedMsgs ? msgs.slice(-CHAT_PREVIEW) : msgs;

  const toggleRecord = async () => {
    if (recording) {
      setRecording(false);
      setUploading(true);
      try {
        const clip = await stopRecording();
        if (clip) {
          const url = await uploadFile(clip.data, clip.name, clip.mime);
          await onSend(url); // rendered as a voice memo on both sides
        }
      } catch (e) {
        Alert.alert('Voice memo failed', e instanceof UploadError ? e.message : (e as Error).message || 'Try again.');
      } finally { setUploading(false); }
    } else {
      try {
        await startRecording();
        setRecording(true);
      } catch (e) {
        Alert.alert('Cannot record', (e as Error).message || 'Microphone unavailable.');
      }
    }
  };

  const send = async () => {
    const msg = text.trim();
    if (!msg) return;
    setSending(true);
    try {
      await onSend(msg);
      setText('');
    } catch (e) {
      uiAlert(t('Could not send'), e instanceof Error ? e.message : undefined);
    } finally { setSending(false); }
  };

  const attach = async () => {
    // System photo picker — no media permission needed (Play-policy compliant).
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const url = await uploadImage(result.assets[0]);
      await onSend(url); // sent as a chat message; rendered as an image on the other side
    } catch (e) {
      Alert.alert('Upload failed', e instanceof UploadError ? e.message : 'Try again.');
    } finally { setUploading(false); }
  };

  return (
    <View style={s.chatBox}>
      <Text style={s.chatTitle}>{t("Chat")}</Text>
      {msgs.length === 0 ? (
        <Text style={s.dim}>{t("Send a message to coordinate the pickup.")}</Text>
      ) : (
        <>
          {collapsedMsgs && (
            <Pressable onPress={() => setShowAllMsgs(true)} style={s.chatExpand} hitSlop={6}>
              <Text style={s.chatExpandText}>{t("Show earlier messages")} ({msgs.length - CHAT_PREVIEW})</Text>
            </Pressable>
          )}
          {shownMsgs.map((m, i) => (
            // Stable per-message key. Index keys made React reuse the memoised
            // bubble at a given slot when the array grew (new send / inbound DM /
            // FlatList clipping its card), which mis-reconciled and visually
            // duplicated the last bubble — and the constant tear-down/rebuild
            // thrashed layout while scrolling. ts is epoch *seconds* so two quick
            // messages can share one; disambiguate with dir + index.
            <ChatBubble key={m.id ?? `${m.ts}-${m.dir}-${i}`} text={m.text} dir={m.dir} onZoom={setViewerUri} />
          ))}
        </>
      )}
      <View style={[s.row, { marginTop: 8 }]}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          value={text}
          onChangeText={setText}
          placeholder={t("Message…")}
          placeholderTextColor={palette.placeholder}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable style={[s.chatAttach, uploading && { opacity: 0.6 }]} onPress={attach} disabled={uploading || recording} accessibilityRole="button" accessibilityLabel={t('Attach photo')}>
          {uploading ? <ActivityIndicator color="#93c5fd" /> : <Ionicons name="image" size={18} color="#93c5fd" />}
        </Pressable>
        <Pressable style={[s.chatAttach, recording && s.chatAttachRec]} onPress={toggleRecord} disabled={uploading} accessibilityRole="button" accessibilityLabel={recording ? t('Stop recording') : t('Record voice memo')}>
          <Ionicons name={recording ? 'stop' : 'mic'} size={18} color={recording ? '#fff' : '#93c5fd'} />
        </Pressable>
        <Pressable style={[s.pinBtn, sending && { opacity: 0.6 }]} onPress={send} disabled={sending} accessibilityRole="button" accessibilityLabel={t('Send message')}>
          {sending ? <ActivityIndicator color="white" /> : <Ionicons name="send" size={18} color="white" />}
        </Pressable>
      </View>
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <View style={s.imgViewerBackdrop}>
          <ScrollView
            style={s.imgViewerScroll}
            contentContainerStyle={s.imgViewerContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            {viewerUri ? <Image source={{ uri: viewerUri }} style={s.imgViewerImage} resizeMode="contain" /> : null}
          </ScrollView>
          <Pressable style={s.imgViewerClose} onPress={() => setViewerUri(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Close image')}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

function KarmaRater({
  onSubmit,
  onCancel,
  glow = false,
}: {
  onSubmit: (score: KarmaScore, note: string | undefined, contactVerified: boolean) => Promise<void>;
  onCancel: () => void;
  /** Pulse a colored glow on the panel to draw attention after a celebration. */
  glow?: boolean;
}) {
  const [score, setScore] = useState<KarmaScore | null>(null);
  const [note, setNote] = useState('');
  const [contactVerified, setContactVerified] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Attention glow: loop the panel's shadow/border opacity while `glow` is true.
  const glowAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!glow) { glowAnim.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(glowAnim, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [glow, glowAnim]);
  const glowStyle = glow
    ? {
        borderColor: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [palette.accentBorder, palette.warn] }),
        shadowColor: palette.warn,
        shadowOpacity: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.1, 0.9] }) as unknown as number,
        shadowRadius: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [2, 12] }) as unknown as number,
        shadowOffset: { width: 0, height: 0 },
        elevation: glowAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 10] }) as unknown as number,
      }
    : null;

  const SCORES: { value: KarmaScore; label: string; icon: IoniconName; color: string }[] = [
    { value: -1, label: t('Bad'), icon: 'thumbs-down-outline', color: palette.danger },
    { value: 0, label: t('Neutral'), icon: 'remove-outline', color: palette.muted },
    { value: 1, label: t('Good'), icon: 'thumbs-up-outline', color: palette.success },
    { value: 2, label: t('Excellent'), icon: 'star-outline', color: palette.warn },
  ];

  const submit = async () => {
    if (score === null) { uiAlert(t('Select a score')); return; }
    setSubmitting(true);
    try {
      await onSubmit(score, note || undefined, contactVerified);
    } catch (e) {
      uiAlert(t('Could not send'), e instanceof Error ? e.message : undefined);
    } finally { setSubmitting(false); }
  };

  return (
    <Animated.View style={[s.counterBox, glowStyle]}>
      <Text style={s.sectionTitle}>{t("Rate this deal")}</Text>
      <View style={s.karmaBtns}>
        {SCORES.map((opt) => (
          <Pressable
            key={opt.value}
            style={[s.karmaBtn, { flexDirection: 'row', gap: 6 }, score === opt.value && s.karmaBtnActive]}
            onPress={() => setScore(opt.value)}
          >
            <Ionicons name={opt.icon} size={15} color={score === opt.value ? 'white' : opt.color} />
            <Text style={[s.karmaBtnText, score === opt.value && s.karmaBtnTextActive]}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable style={s.checkRow} onPress={() => setContactVerified((v) => !v)}>
        <View style={[s.checkbox, contactVerified && s.checkboxOn]}>
          {contactVerified && <Text style={s.checkboxTick}>✓</Text>}
        </View>
        <Text style={s.checkLabel}>{'📱 ' + t('I reached them at their listed phone number')}</Text>
      </Pressable>
      <Field label={t("Note (optional)")} value={note} onChange={setNote} placeholder={t("Leave a comment…")} multiline />
      <View style={s.btnRow}>
        <Pressable style={[s.btnAccept, submitting && { opacity: 0.6 }]} onPress={submit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t("Submit")}</Text>}
        </Pressable>
        <Pressable style={s.btnDecline} onPress={onCancel}><Text style={s.btnText}>{t("Skip")}</Text></Pressable>
      </View>
    </Animated.View>
  );
}

function TermsSummary({ terms, schema }: { terms: ProposedTerms; schema: string }) {
  const isRide = schema.startsWith('rideshare');
  return (
    <View style={s.termsBox}>
      <Text style={s.termsTitle}>{t("Proposed terms")}</Text>
      {isRide ? (
        <>
          {terms.from && <Row label={t("From")} value={terms.from} />}
          {terms.to && <Row label={t("To")} value={terms.to} />}
        </>
      ) : (
        <>
          {terms.location && <Row label={t("Location")} value={terms.location} />}
          {terms.service && <Row label={t("Service")} value={terms.service} />}
          {terms.duration_minutes && <Row label={t("Duration")} value={`${terms.duration_minutes} min`} />}
        </>
      )}
      {terms.window && <Row label={t("Time")} value={fmtWindow(terms.window)} />}
      {terms.payment && <Row label={t("Payment")} value={terms.payment} />}
      {terms.note && <Row label={t("Note")} value={terms.note} />}
    </View>
  );
}
