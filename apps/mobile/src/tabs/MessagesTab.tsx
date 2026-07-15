import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  FlatList,
  Linking,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Negotiation } from '@freeport/protocol';
import { t, tn } from '../i18n';
import { MobileClient } from '../client';
import { type UserProfile } from '../profile';
import { kvGet, kvSet } from '../kv';
import { negoIsDone, searchableText, isPendingOffer, offerSummary } from '../deals';
import { matchesKeywords } from '../browseFilter';
import { routeUrl, placeUrl, placeParam, dirUrl } from '../maps';
import { type TripStatic } from '../livetrip';
import { categoryOf, subcategoryOf } from '../categories';
import { s, palette } from '../ui/theme';
import { fmtClock, extractPhone, contactWithoutPhone, stateLabel, stateColor } from '../ui/format';
import { policeNumberFor } from '../emergency';
import { quickReplies } from '../quickReplies';
import { uiAlert, runDealAction, confirmAsync, openMaps } from '../ui/alerts';
import { SystemNotice, SlideToConfirm } from '../ui/fields';
import { ChatThread, CounterEditor, ReportModal, isTripMsg } from './messages/Chat';
import { KarmaRater, KarmaReceived } from './messages/Karma';
import { LiveTripShare } from './messages/LiveTripShare';
import { ChatFab, FriendChatModal, FriendChatSection, InviteSheet } from './messages/FriendChat';
import { EscrowSection } from './messages/Escrow';
import { type Conversation } from '../conversations';
import { type EscrowState } from '../client';

// Re-exported so App.tsx keeps importing these from './src/tabs/MessagesTab'.
export { isImageMsg, isAudioMsg, isTripMsg } from './messages/Chat';
// Re-exported so SettingsTab keeps importing SelfStats from './MessagesTab'.
export { SelfStats } from './messages/Karma';

// ─── Deals tab ───────────────────────────────────────────────────────────────

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
  country = '',
  walletEnabled = false,
  onPayDeal,
  onReceiveDeal,
  onRepost,
  sendLocationOnDeal = true,
  customMessage = '',
  blockedPubkeys,
  onToggleBlock,
  chatEnabled = false,
  conversations = [],
  chatReceiptsOn = false,
  onStartCall,
  onPayFriend,
  chatTranslateTo,
  onAcceptChatInvite,
  escrows = [],
  onPayEscrowInvoice,
}: {
  client: MobileClient | null;
  negos: Negotiation[];
  setNegos: React.Dispatch<React.SetStateAction<Negotiation[]>>;
  profile: UserProfile;
  /** Current user's side: 'passenger' = rider/customer (buyer), 'driver' = driver/provider. */
  role: 'passenger' | 'driver' | '';
  /** User's selected country (ISO code) — resolves the local police number. */
  country?: string;
  /** Wallet experiment on for THIS user (the counterparty signals theirs via payAddress). */
  walletEnabled?: boolean;
  /** Open the Wallet tab's Send flow prefilled for this deal. */
  onPayDeal?: (n: Negotiation) => void;
  /** Seller side: open the Wallet tab's Receive flow (Pay QR) for this deal. */
  onReceiveDeal?: (n: Negotiation) => void;
  /** Poster of a completed deal: prefill New Post with this intent (sans time). */
  onRepost?: (n: Negotiation) => void;
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
  /** User's custom quick-reply message (Settings) — third chat chip when set. */
  customMessage?: string;
  /** Peer pubkeys (hex) the user has blocked. */
  blockedPubkeys: Set<string>;
  /** Toggle a peer's blocked state (block ⇄ unblock). */
  onToggleBlock: (pubkey: string) => void;
  /** Experimental friend chat (Settings → Experimental → Chat). */
  chatEnabled?: boolean;
  conversations?: Conversation[];
  /** Chat receipts toggle — reciprocal: off = we send no acks and show no ticks. */
  chatReceiptsOn?: boolean;
  /** Start a call from a chat header (present when calls are on + supported). */
  onStartCall?: (peer: string, video: boolean) => void;
  /** In-chat payments (friend chat): open the wallet Send flow for a friend. */
  onPayFriend?: (peer: string, payAddress: string) => void;
  /** On-device auto-translate target for inbound chat messages. */
  chatTranslateTo?: string;
  /** Accepting an invite (also enables the Chat experiment when off). */
  onAcceptChatInvite?: (peer: string) => void;
  /** HODL escrows (one per deal). */
  escrows?: EscrowState[];
  /** Pay a hold invoice via the wallet Send flow. */
  onPayEscrowInvoice?: (invoice: string) => void;
}) {
  // Friend chat: which conversation is open (peer pubkey) + the invite popup.
  const [openChatPeer, setOpenChatPeer] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const openConv = openChatPeer ? conversations.find((c) => c.peer === openChatPeer) ?? null : null;
  const [counteringId, setCounteringId] = useState<string | null>(null);
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
  const markRated = useCallback((id: string) =>
    setRatedIds((prev) => {
      const next = new Set([...prev, id]);
      kvSet('freeport.rated', JSON.stringify([...next])).catch(() => {});
      return next;
    }), []);
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

  // Stable handlers for the memoized DealCard rows: the action callbacks from
  // App (onPayDeal, onRepost, …) are fresh closures on every parent render, so
  // read them through refs — the wrappers below keep one identity for the
  // list's whole lifetime (same pattern as Browse's PostCard).
  const onPayDealRef = useRef(onPayDeal); onPayDealRef.current = onPayDeal;
  const onReceiveDealRef = useRef(onReceiveDeal); onReceiveDealRef.current = onReceiveDeal;
  const onRepostRef = useRef(onRepost); onRepostRef.current = onRepost;
  const onToggleBlockRef = useRef(onToggleBlock); onToggleBlockRef.current = onToggleBlock;
  const onPayEscrowInvoiceRef = useRef(onPayEscrowInvoice); onPayEscrowInvoiceRef.current = onPayEscrowInvoice;
  const handlePayDeal = useCallback((n: Negotiation) => onPayDealRef.current?.(n), []);
  const handleReceiveDeal = useCallback((n: Negotiation) => onReceiveDealRef.current?.(n), []);
  const handleRepost = useCallback((n: Negotiation) => onRepostRef.current?.(n), []);
  const handleToggleBlock = useCallback((pubkey: string) => onToggleBlockRef.current(pubkey), []);
  const handlePayEscrowInvoice = useCallback((invoice: string) => onPayEscrowInvoiceRef.current?.(invoice), []);
  const handleReport = useCallback((id: string) => setReportingId(id), []);
  const handleConfirmCancelChange = useCallback((id: string | null) => setConfirmCancelId(id), []);
  const handleCounterStart = useCallback((id: string) => setCounteringId(id), []);
  const handleCounterCancel = useCallback(() => setCounteringId(null), []);
  const handleSkipRating = useCallback((id: string) => setSkippedRating((prev) => new Set([...prev, id])), []);
  const handleReopenRating = useCallback((id: string) => setSkippedRating((prev) => { const n = new Set(prev); n.delete(id); return n; }), []);

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
  // Memoized: the filter builds a searchable string per nego and this component
  // re-renders on every parent flush and every keystroke — recompute only when
  // the inputs actually change, not on unrelated renders.
  const sorted = useMemo(() => [...negos]
    .filter((n) => {
      // The keyword box lives at the Messages ROOT — it filters BOTH views
      // (and the chat rows below), comma-separated like Browse.
      if (completedKw && !matchesKeywords(negoText(n), completedKw)) return false;
      if (view !== 'completed') return !isDone(n);
      if (!isDone(n) || n.updatedAt < completedCutoff) return false;
      return true;
    })
    .sort((a, b) => b.updatedAt - a.updatedAt),
    [negos, view, completedKw, completedCutoff, client]);

  const header = (
    <View>
      {/* Search at the ROOT of Messages: filters chats + Active + Archived,
          multiple comma-separated keywords (same semantics as Browse). */}
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
      <View style={[s.segRow, { marginHorizontal: 12, marginTop: 8 }]}>
        {(['active', 'completed'] as const).map((v) => {
          const seg = (
            <Pressable onPress={() => setView(v)} style={[s.seg, view === v && s.segActive, { flex: 1 }]}>
              <Ionicons
                name={v === 'active' ? 'pulse-outline' : 'archive-outline'}
                size={15}
                color={view === v ? palette.chipBlueText : palette.dim}
                style={{ marginEnd: 6 }}
              />
              <Text style={[s.segText, view === v && s.segTextActive]}>
                {v === 'active' ? t('Active') : t('Archived')}
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

  // Friend chats (experimental) — pending requests + WhatsApp-style rows.
  // Rendered even when the experiment is OFF so an incoming request is
  // always answerable (it then shows ONLY pending requests). Archived chats
  // live in the Archived tab. Deliberately BELOW the deals list: a live deal
  // needs action before casual chat.
  const chatsSection = (
    <FriendChatSection
      client={client}
      conversations={conversations}
      blockedPubkeys={blockedPubkeys}
      onOpen={(peer) => setOpenChatPeer(peer)}
      onAcceptInvite={onAcceptChatInvite}
      chatEnabled={chatEnabled}
      archivedView={view === 'completed'}
      filterKeyword={completedKw}
      onToggleBlock={onToggleBlock}
    />
  );

  const reportNego = reportingId ? negos.find((n) => n.id === reportingId) : null;

  return (
    <View style={{ flex: 1 }}>
    {/* Friend chat overlays (experimental) */}
    {showInvite && (
      <InviteSheet client={client} myName={profile.name || undefined} onClose={() => setShowInvite(false)} />
    )}
    {openConv && (
      <FriendChatModal
        client={client}
        conv={openConv}
        receiptsOn={chatReceiptsOn}
        blocked={blockedPubkeys.has(openConv.peer)}
        onToggleBlock={onToggleBlock}
        onClose={() => setOpenChatPeer(null)}
        onStartCall={onStartCall}
        walletEnabled={walletEnabled}
        onPayFriend={onPayFriend}
        translateTo={chatTranslateTo}
      />
    )}
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
      ListFooterComponent={chatsSection}
      ListEmptyComponent={
        <View style={s.emptyWrap}>
          <Ionicons name={view === 'completed' ? 'checkmark-done-outline' : 'chatbubbles-outline'} size={40} color={palette.dim} />
          <Text style={s.emptyText}>
            {view === 'completed' ? t('No completed deals yet.') : t('No active deals.')}
          </Text>
        </View>
      }
      renderItem={({ item }) => (
        <DealCard
          item={item}
          client={client}
          role={role}
          country={country}
          walletEnabled={walletEnabled}
          sendLocationOnDeal={sendLocationOnDeal}
          customMessage={customMessage}
          chatTranslateTo={chatTranslateTo}
          // Per-deal VALUES from mutable containers (profiles map, escrows
          // array, id-matched local state) — resolved HERE so the memoized row
          // re-renders exactly when its own value changes, never reading a
          // captured map that could go stale inside the child.
          myName={profile.name}
          myPhone={profile.phone}
          myVehicleModel={profile.vehicleModel}
          myPlateNumber={profile.plateNumber}
          peerProfilePhone={client?.profiles.get(item.peer)?.phone || ''}
          escrow={escrows.find((e) => e.nego === item.id)}
          countering={counteringId === item.id}
          confirmingCancel={confirmCancelId === item.id}
          rated={ratedIds.has(item.id)}
          ratingSkipped={skippedRating.has(item.id)}
          glow={glowDealId === item.id}
          peerBlocked={!!item.peer && blockedPubkeys.has(item.peer)}
          hasRepost={!!onRepost}
          hasPayDeal={!!onPayDeal}
          hasReceiveDeal={!!onReceiveDeal}
          onReport={handleReport}
          onConfirmCancelChange={handleConfirmCancelChange}
          onCounterStart={handleCounterStart}
          onCounterCancel={handleCounterCancel}
          onPayDeal={handlePayDeal}
          onReceiveDeal={handleReceiveDeal}
          onRepost={handleRepost}
          onToggleBlock={handleToggleBlock}
          onPayEscrowInvoice={handlePayEscrowInvoice}
          onMarkRated={markRated}
          onSkipRating={handleSkipRating}
          onReopenRating={handleReopenRating}
        />
      )}
    />
    {chatEnabled && <ChatFab onPress={() => setShowInvite(true)} />}
    </View>
  );
}

/** One Deals-list card: the full deal state machine for a negotiation — title/
 *  chips, banners, fulfillment flow, pay/escrow, cancellation, rating, chat.
 *
 *  Memoized so a flush that replaces ONE negotiation (or a keystroke in the
 *  root filter) only re-renders the affected row. Correctness relies on:
 *  - `item` (Negotiation) and `escrow` (EscrowState) being immutably REPLACED
 *    on every update (client.ts always commits fresh objects), so identity
 *    comparison is sound;
 *  - everything derived from a mutable container (client.profiles map,
 *    escrows array, rated/blocked sets, per-id UI state) arriving as a
 *    per-deal primitive/object prop resolved in the parent's renderItem —
 *    this component never reads those containers itself;
 *  - all callbacks being referentially stable (useCallback/ref pattern in the
 *    parent) and taking the deal (or its id) as an argument;
 *  - `client` being identity-stable for the app session — its METHODS are only
 *    invoked inside event handlers (tap time), while render-time reads are
 *    limited to the immutable `client.pubkey`.
 */
const DealCard = React.memo(function DealCard({
  item,
  client,
  role,
  country,
  walletEnabled,
  sendLocationOnDeal,
  customMessage,
  chatTranslateTo,
  myName,
  myPhone,
  myVehicleModel,
  myPlateNumber,
  peerProfilePhone,
  escrow,
  countering,
  confirmingCancel,
  rated,
  ratingSkipped,
  glow,
  peerBlocked,
  hasRepost,
  hasPayDeal,
  hasReceiveDeal,
  onReport,
  onConfirmCancelChange,
  onCounterStart,
  onCounterCancel,
  onPayDeal,
  onReceiveDeal,
  onRepost,
  onToggleBlock,
  onPayEscrowInvoice,
  onMarkRated,
  onSkipRating,
  onReopenRating,
}: {
  item: Negotiation;
  client: MobileClient | null;
  role: 'passenger' | 'driver' | '';
  country: string;
  walletEnabled: boolean;
  sendLocationOnDeal: boolean;
  customMessage: string;
  chatTranslateTo?: string;
  /** Own contact fields (from profile) as primitives — value-compared, so the
   *  row can't go stale even if the profile object were mutated in place. */
  myName: string;
  myPhone: string;
  myVehicleModel: string;
  myPlateNumber: string;
  /** The peer's published phone (client.profiles is a mutable Map — read in the parent). */
  peerProfilePhone: string;
  /** This deal's escrow (escrows.find in the parent — objects replaced immutably). */
  escrow: EscrowState | undefined;
  countering: boolean;
  confirmingCancel: boolean;
  rated: boolean;
  ratingSkipped: boolean;
  glow: boolean;
  peerBlocked: boolean;
  hasRepost: boolean;
  hasPayDeal: boolean;
  hasReceiveDeal: boolean;
  onReport: (id: string) => void;
  onConfirmCancelChange: (id: string | null) => void;
  onCounterStart: (id: string) => void;
  onCounterCancel: () => void;
  onPayDeal: (n: Negotiation) => void;
  onReceiveDeal: (n: Negotiation) => void;
  onRepost: (n: Negotiation) => void;
  onToggleBlock: (pubkey: string) => void;
  onPayEscrowInvoice: (invoice: string) => void;
  onMarkRated: (id: string) => void;
  onSkipRating: (id: string) => void;
  onReopenRating: (id: string) => void;
}) {
  // Our full contact (name · phone [· 🚗 vehicle • plate if we're the driver]),
  // sent on counter-offers too so the peer can phone us mid-negotiation.
  const myContact = (): string => {
    const iAmDriver = item.intent.content.schema.startsWith('rideshare') && item.weInitiated;
    const parts = [myName, myPhone];
    if (iAmDriver && myVehicleModel?.trim() && myPlateNumber?.trim()) {
      parts.push(`🚗 ${myVehicleModel.trim()} • ${myPlateNumber.trim()}`);
    }
    return parts.filter(Boolean).join(' · ') || (client?.pubkey.slice(0, 12) ?? '');
  };
  const needsAction =
    item.state === 'accepted_by_them' ||
    (item.state === 'open' && item.termsBy === 'them');
  const terminal = item.state === 'confirmed' || item.state === 'cancelled' || item.state === 'expired' || item.state === 'cancel_requested';
  const canAcceptCounter = item.state === 'open' || item.state === 'accepted_by_them';
  const showActions = !countering && !terminal && needsAction;
  return (
    <View style={[s.card, needsAction && s.cardHighlight]}>
      {(() => {
        const isRide = item.intent.content.schema.startsWith('rideshare');
        const p = item.intent.content.payload as Record<string, any>;
        // My role in this deal
        let roleLabel: string;
        if (isRide) roleLabel = item.weInitiated ? t('Driver') : t('Passenger');
        else {
          const posterProvides = item.intent.content.side === 'offer';
          const iProvide = item.weInitiated ? !posterProvides : posterProvides;
          roleLabel = iProvide ? t('Provider') : t('Customer');
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
                <Text style={[s.chip, s.chipBlue]}>{roleLabel}</Text>
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
                <Pressable onPress={() => onReport(item.id)} hitSlop={8}>
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
            <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
              <Pressable style={s.mapLink} onPress={() => openMaps(routeUrl(from, to))}>
                <Text style={s.mapLinkText}>{'🗺 ' + t('View route in Google Maps')}</Text>
              </Pressable>
              {item.stage === 'completed' && item.intent.pubkey === client?.pubkey && hasRepost && (
                <Pressable style={s.mapLink} onPress={() => onRepost(item)}>
                  <Text style={s.mapLinkText}>{'🔁 ' + t('Repost')}</Text>
                </Pressable>
              )}
            </View>
          );
        }
        if (item.intent.content.schema.startsWith('service') && p.location?.name) {
          const loc = item.terms?.location ?? p.location.name;
          return (
            <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
              <Pressable style={s.mapLink} onPress={() => openMaps(placeUrl(loc, p.location?.geohash))}>
                <Text style={s.mapLinkText}>{'🗺 ' + t('View location in Google Maps')}</Text>
              </Pressable>
              {item.stage === 'completed' && item.intent.pubkey === client?.pubkey && hasRepost && (
                <Pressable style={s.mapLink} onPress={() => onRepost(item)}>
                  <Text style={s.mapLinkText}>{'🔁 ' + t('Repost')}</Text>
                </Pressable>
              )}
            </View>
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
                  const peerRaw = peerProfilePhone;
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
                  <>
                    {/* Settle in-app: the buyer pays (their wallet on +
                        the seller shared a payAddress); the seller can
                        flash a Pay-QR invoice for the agreed price. */}
                    {role === 'passenger' && walletEnabled && !!item.theirPayAddress && hasPayDeal && (
                      <Pressable style={[s.btnAccept, { marginBottom: 8 }]} onPress={() => onPayDeal(item)}>
                        <Text style={s.btnText}>{'⚡ ' + t('Pay')}</Text>
                      </Pressable>
                    )}
                    {role !== 'passenger' && walletEnabled && hasReceiveDeal && (
                      <Pressable style={[s.btnCounter, { marginBottom: 8 }]} onPress={() => onReceiveDeal(item)}>
                        <View style={[s.row, { gap: 6, justifyContent: 'center' }]}>
                          <Ionicons name="qr-code-outline" size={15} color="white" />
                          <Text style={s.btnText}>{t('Pay QR')}</Text>
                        </View>
                      </Pressable>
                    )}
                    <SlideToConfirm label={doneLabel} onConfirm={() => runDealAction(client?.setStage(item.id, 'completed'), t('Could not update the deal'))} />
                    {/* Passenger safety: while in transit, one tap dials the
                        local police. The pickup is in the passenger's own
                        selected area, so the number resolves offline from
                        their country — no geocoding when seconds matter. */}
                    {isRide && role === 'passenger' && (() => {
                      const police = policeNumberFor(country);
                      return (
                        <Pressable
                          style={[s.btnAccept, { backgroundColor: '#dc2626', marginTop: 8 }]}
                          onPress={() => Linking.openURL('tel:' + police)}
                        >
                          <View style={[s.row, { gap: 6, justifyContent: 'center' }]}>
                            <Ionicons name="call" size={15} color="white" />
                            <Text style={s.btnText}>{t('Emergency Call')} · {police}</Text>
                          </View>
                        </Pressable>
                      );
                    })()}
                  </>
                )}
                {/* Trip done → the rater opens automatically. Skipping shows a
                    button to reopen it; once submitted it's locked. */}
                {st === 'completed' && (
                  rated ? (
                    <Text style={s.ratedText}>{t("Rating submitted")}</Text>
                  ) : ratingSkipped ? (
                    <Pressable style={s.rateBtn} onPress={() => onReopenRating(item.id)}>
                      <Text style={s.rateBtnText}>{t("Rate this deal")}</Text>
                    </Pressable>
                  ) : (
                    <KarmaRater
                      glow={glow}
                      onSubmit={async (score, note, contactVerified) => {
                        await client?.rateKarma(item.id, item.peer, score, note, contactVerified);
                        onMarkRated(item.id);
                      }}
                      onCancel={() => onSkipRating(item.id)}
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
                  const ourName = myName || undefined;
                  const theirName = (item.theirContact || '').split('·')[0].trim() || undefined;
                  const shareLink = (link: string) => { client?.sendChat(item.id, link).catch(() => {}); };
                  const alreadyShared = (item.messages || []).some((m) => m.dir === 'out' && isTripMsg(m.text));
                  // Trip metadata (route + the driver's vehicle/plate) is identical for
                  // both parties; only which name is the "driver" flips by side.
                  let vehicleModel: string | undefined, plateNumber: string | undefined;
                  if (isRide) {
                    if (iAmDriver) {
                      vehicleModel = myVehicleModel?.trim() || undefined;
                      plateNumber = myPlateNumber?.trim() || undefined;
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
                        driver: iAmDriver ? ourName : theirName,
                        phone: iAmDriver ? (myPhone || undefined) : (extractPhone(item.theirContact || '') || undefined),
                        vehicleModel, plateNumber,
                        passenger: iAmDriver ? theirName : ourName,
                      }
                    : {
                        from: item.terms?.location || p.location?.name || '',
                        to: '',
                        driver: ourName, phone: myPhone || undefined, passenger: theirName,
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

          {/* HODL escrow — trust-minimized conditional payment on a
              mutually-confirmed deal (both sides need the wallet). */}
          {item.state === 'confirmed' && !awaiting && walletEnabled && client && (
            <View style={{ marginTop: 8 }}>
              <EscrowSection
                escrow={escrow}
                isBuyer={role === 'passenger'}
                paymentHint={item.terms?.payment}
                onRequest={(sats) => client.requestEscrow(item.id, sats)}
                onAccept={() => client.acceptEscrow(item.id)}
                onRelease={() => client.releaseEscrow(item.id)}
                onRetryClaim={() => client.claimEscrow(item.id)}
                onPayInvoice={(inv) => onPayEscrowInvoice(inv)}
              />
            </View>
          )}

          {/* Cancellation. Before the deal is mutually confirmed (we accepted
              but they haven't acknowledged), it's not a real deal yet — allow an
              immediate unilateral cancel. Once mutual, use the cooperative
              request-and-agree flow (karma stays 0). Done → no cancelling. */}
          {item.state === 'confirmed' && item.stage !== 'completed' && (
            awaiting ? (
              confirmingCancel ? (
                <View style={s.cancelBox}>
                  <Text style={s.cancelBoxText}>{t("The deal isn't confirmed yet, so this cancels your offer immediately.")}</Text>
                  <View style={s.btnRow}>
                    <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={() => onConfirmCancelChange(null)}>
                      <Text style={s.btnText}>{t("Keep")}</Text>
                    </Pressable>
                    <Pressable style={[s.btnDecline, { flex: 1 }]} onPress={() => { runDealAction(client?.decline(item.id), t('Could not update the deal')); onConfirmCancelChange(null); }}>
                      <Text style={s.btnText}>{t("Cancel offer")}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : (
                <Pressable hitSlop={8} onPress={() => onConfirmCancelChange(item.id)}>
                  <Text style={s.cancelLink}>{t("Cancel offer")}</Text>
                </Pressable>
              )
            ) : (
            confirmingCancel ? (
              <View style={s.cancelBox}>
                <Text style={s.cancelBoxText}>{t("Send a cancellation request to the other party. The deal is only cancelled when both agree — no karma impact.")}</Text>
                <View style={s.btnRow}>
                  <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={() => onConfirmCancelChange(null)}>
                    <Text style={s.btnText}>{t("Keep deal")}</Text>
                  </Pressable>
                  <Pressable style={[s.btnDecline, { flex: 1 }]} onPress={() => { runDealAction(client?.requestCancel(item.id), t('Could not update the deal')); onConfirmCancelChange(null); }}>
                    <Text style={s.btnText}>{t("Request cancellation")}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable hitSlop={8} onPress={() => onConfirmCancelChange(item.id)}>
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
          {negoIsDone(item) && item.peer ? (() => {
            const doBlock = () => onToggleBlock(item.peer);
            const onPress = () => {
              if (peerBlocked) { doBlock(); return; } // unblock needs no confirm
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
                <Ionicons name={peerBlocked ? 'ban' : 'ban-outline'} size={14} color={palette.danger} />
                <Text style={s.blockBtnText}>{peerBlocked ? t('Unblock') : t('Block this person')}</Text>
              </Pressable>
            );
          })() : null}

          <ChatThread nego={item} onSend={(t) => client?.sendChat(item.id, t) ?? Promise.resolve()} quickReplies={quickReplies(customMessage)} translateTo={chatTranslateTo} />
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
            {confirmingCancel ? (
              <View style={s.cancelBox}>
                <Text style={s.cancelBoxText}>{t("The deal isn't confirmed yet, so this cancels your offer immediately.")}</Text>
                <View style={s.btnRow}>
                  <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={() => onConfirmCancelChange(null)}>
                    <Text style={s.btnText}>{t("Keep")}</Text>
                  </Pressable>
                  <Pressable style={[s.btnDecline, { flex: 1 }]} onPress={() => { runDealAction(client?.decline(item.id), t('Could not update the deal')); onConfirmCancelChange(null); }}>
                    <Text style={s.btnText}>{t("Cancel offer")}</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable hitSlop={8} onPress={() => onConfirmCancelChange(item.id)}>
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
                if (iAmDriver && (!myVehicleModel?.trim() || !myPlateNumber?.trim())) {
                  // uiAlert, not Alert.alert (a no-op on web) — else the
                  // driver taps Accept and nothing visibly happens.
                  uiAlert(
                    t('Vehicle details required'),
                    t('Add your vehicle model and plate number in Profile before accepting a ride. They are shared with the passenger over encrypted DM when the deal is confirmed.'),
                  );
                  return;
                }
                // Contact travels via encrypted DM only — full phone is safe here.
                const parts = [myName, myPhone];
                if (iAmDriver) parts.push(`🚗 ${myVehicleModel.trim()} • ${myPlateNumber.trim()}`);
                const contact = parts.filter(Boolean).join(' · ') || client!.pubkey.slice(0, 12);
                runDealAction(client?.accept(item.id, contact), t('Could not update the deal'));
              }}
            >
              <Text style={s.btnText}>{item.state === 'accepted_by_them' ? t('Confirm deal') : t('Accept')}</Text>
            </Pressable>
          )}
          {canAcceptCounter && (
            <Pressable style={s.btnGhost} onPress={() => onCounterStart(item.id)}>
              <Text style={s.btnGhostText}>{t("Counter")}</Text>
            </Pressable>
          )}
          <Pressable style={s.btnTextOnly} onPress={() => { runDealAction(client?.decline(item.id), t('Could not update the deal')); onCounterCancel(); }}>
            <Text style={s.btnTextDanger}>{t("Decline")}</Text>
          </Pressable>
        </View>
        </>
      )}

      {/* Counter-offer editor */}
      {countering && (
        <CounterEditor
          nego={item}
          onSend={async (terms) => {
            await client?.counter(item.id, terms, myContact());
            onCounterCancel();
          }}
          onCancel={onCounterCancel}
        />
      )}
    </View>
  );
});
