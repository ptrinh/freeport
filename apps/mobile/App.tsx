/**
 * Freeport — P2P marketplace client.
 * Tabs: Market · Post · Deals · Key
 */
import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  Image,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  Pressable,
  Text,
  UIManager,
  useColorScheme,
  View,
} from 'react-native';

// Android (old architecture) needs LayoutAnimation explicitly enabled; on the
// new arch / iOS this is a no-op, and on web the API itself is a no-op.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AreaMap } from './src/Map';
import { t, setI18nLang, ensureI18nLang, onI18nLoaded } from './src/i18n';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import {
  DEMO_MARKET,
  SERVICE_MARKET,
  MSG_COUNTER,
  MSG_ACCEPT,
  MSG_CHAT,
  CHAT_INVITE,
  parseInviteLink,
  parseGroupLink,
  decodeGroupInvite,
  type Intent,
  type Product,
  type Negotiation,
  type GroupInvite,
} from '@freeport/protocol';
import { loadKey, createKey, clearKey, wipeAllLocalData, npubFromHex, npubOf, restoreNsec, getStoredNsec } from './src/identity';
import { resetFirewall as resetMiniAppFirewall } from './src/miniapps/store';
import { createPasskeyIdentity, signInWithPasskey } from './src/passkey';
import { restoreSettingsSync, fillMissingProfileFromRelays } from './src/relaySync';
import { dealFiat } from './src/wallet/fiatConvert';
import { nsecEncode } from 'nostr-tools/nip19';
import { restoreBackupText, buildCloudBundle, restoreFromBundleText } from './src/backup';
import { cloudAvailable, cloudSave, cloudRestore, cloudClear } from './src/cloudBackup';
import { LocalSigner, Nip07Signer, hasNip07, type Signer } from './src/signer';
import { kvGet, kvSet } from './src/kv';
import { MobileClient } from './src/client';
import { eventAlert } from './src/haptics';
import { triggerWheelDemo } from './src/wheelDemo';
import { Fireworks } from './src/Fireworks';
import { installDebugApi, registerDebugClient } from './src/debug';
import { initNotifications, notify, notificationGranted } from './src/notify';
import { loadProfile, saveProfile, defaultAvatarUrl, type UserProfile } from './src/profile';
import { normalizePhone } from './src/phone';
import { locationGranted, requestLocationPermission, detectRawLocationGPS, detectRawLocationIP, effectiveUnit } from './src/maps';
import { messagesViewForNewActivity, walletContacts, repostDraft, type RepostDraft } from './src/deals';
import { newlyConfirmed } from './src/quickReplies';
import { initTelemetry, setTelemetryEnabled, trackEvent } from './src/telemetry';
import { loadPrefs, savePrefs, type UserLocation } from './src/prefs';
import { systemLanguage, systemCountry } from './src/language';
import { RIDESHARE_CATEGORY, categoryOf, subcategoryOf } from './src/categories';
import { applySideBackdrop } from './src/sideBackdrop';
import { setFareConfig, defaultFareConfig, type FareConfig } from './src/pricing';
import { pushSupported, enablePush, disablePush } from './src/push';
import { installDesktopLinkOpener } from './src/desktopNative';
// Desktop shell: window.open() to external origins is silently dropped by the
// WebView, so route Linking.openURL through the system opener plugin instead.
installDesktopLinkOpener(Linking);
import { decodeTripHash, subscribeTrip, type TripView, type TripUpdate } from './src/livetrip';
import { checkForUpdate, useUpdateState, getTrack, applyTrack, trackSupported, reloadApp } from './src/updates';
import { initLayoutDirection, applyLayoutDirection } from './src/rtl';
import { useWebUpdateAvailable } from './src/webUpdate';
import { SimplePool } from 'nostr-tools/pool';
import { currencyForCountry, matchLocation, flagEmoji, type Currency } from './src/locations';
import { s, palette, applyTheme } from './src/ui/theme';
import { isStandalonePWA, myPostTitle } from './src/ui/format';
import { StatusDot, type IoniconName } from './src/ui/fields';
import { useResumeReconnect } from './src/hooks/useResumeReconnect';
import { useRelayStatus } from './src/hooks/useRelayStatus';
import { useContactHandshake } from './src/hooks/useContactHandshake';
import { useDeepLinkNav } from './src/hooks/useDeepLinkNav';
import { useBackgroundGrace } from './src/hooks/useBackgroundGrace';
import { MarketTab } from './src/tabs/BrowseTab';
import { WalletTab } from './src/tabs/WalletTab';
import { activeWalletProvider } from './src/wallet';
import { PostTab } from './src/tabs/PostTab';
import { DealsTab, isImageMsg, isAudioMsg, isTripMsg } from './src/tabs/MessagesTab';
import { InviteResolvedSheet, chatDisplayName } from './src/tabs/messages/FriendChat';
import { GroupInviteSheet, GroupJoinSheet, GroupMembersSheet } from './src/tabs/GroupImport';
import { groupPrefsPatch, recordGroupJoin, joinedGroupGids, type JoinedGroup } from './src/groups';
import { CallManager, type CallState } from './src/calls/manager';
import { CallOverlay } from './src/calls/CallOverlay';
import { callsSupported } from './src/calls/webrtc';
import { defaultAvatarUrl as peerAvatarUrl } from './src/profile';
import { unreadCount as convUnread, type Conversation } from './src/conversations';
import { type EscrowState } from './src/client';
import { ZapSheet } from './src/ui/ZapSheet';
import { DraggableFab } from './src/ui/DraggableFab';
import { ConciergeSheet } from './src/concierge/ConciergeSheet';
import { conciergeAvailability } from './src/concierge/model';
import { translateToggleVisible } from './src/concierge/translate';
import { uiAlert } from './src/ui/alerts';
import { SettingsTab } from './src/tabs/SettingsTab';
import { AppsTab } from './src/tabs/AppsTab';
import { Onboarding } from './src/tabs/Onboarding';

type Tab = 'post' | 'messages' | 'browse' | 'wallet' | 'apps' | 'settings';

// [inactive (outline), active (filled)] per tab
const TAB_ICONS: Record<Tab, [IoniconName, IoniconName]> = {
  post: ['add-circle-outline', 'add-circle'],
  messages: ['chatbubbles-outline', 'chatbubbles'],
  browse: ['compass-outline', 'compass'],
  wallet: ['wallet-outline', 'wallet'],
  apps: ['apps-outline', 'apps'],
  settings: ['settings-outline', 'settings'],
};

// Web: hide native scrollbars to match the chrome-less feel of the mobile app
// (native uses showsVerticalScrollIndicator={false}; the browser needs CSS).
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  try {
    const st = document.createElement('style');
    st.textContent =
      '#freeport-shell *::-webkit-scrollbar{width:0;height:0;background:transparent}' +
      '#freeport-shell *{scrollbar-width:none;-ms-overflow-style:none}';
    document.head.appendChild(st);
  } catch { /* best-effort */ }
}

// Apply the RTL/LTR layout direction before the tree renders (see rtl.ts).
// Runs once at module load; on web it reads a sync hint so the first paint is
// already in the right direction.
initLayoutDirection(systemLanguage());

// ─── Root ────────────────────────────────────────────────────────────────────

export default function App() {
  // Live-trip viewer: a "#trip=…" hash link (web only) opens a read-only map of
  // someone's shared trip instead of the full app.
  const tripView =
    Platform.OS === 'web' && typeof window !== 'undefined' ? decodeTripHash(window.location.hash) : null;
  // Dismiss the instant HTML splash (injected into index.html) once React has
  // mounted — the JS bundle is parsed and the app is interactive by now. Web only.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const el = document.getElementById('ft-splash');
    if (!el) return;
    el.style.opacity = '0';
    const t = setTimeout(() => { try { el.remove(); } catch {} }, 350);
    return () => clearTimeout(t);
  }, []);
  return (
    <SafeAreaProvider>
      {tripView ? <TripViewer view={tripView} /> : <AppInner />}
    </SafeAreaProvider>
  );
}

// ─── Live-trip viewer (web, read-only) ───────────────────────────────────────
// Opened from a shared "#trip=…" link: subscribes to the rider's encrypted
// location over Nostr and shows it live on a map. No identity / client needed.
function TripViewer({ view }: { view: TripView }) {
  const insets = useSafeAreaInsets();
  const c = palette;
  const [loc, setLoc] = useState<TripUpdate | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const pool = new SimplePool();
    const unsub = subscribeTrip(pool, view, setLoc);
    const tick = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => { unsub(); clearInterval(tick); try { pool.close(view.relays); } catch {} };
  }, []);
  const ended = loc?.status === 'ended';
  const info = loc?.info;
  const secs = loc ? Math.max(0, now - Math.floor(loc.ts)) : 0;
  // Fresh (≤45s) ⇒ green; stale ⇒ amber; ended ⇒ gray. Drives the pulsing dot.
  const markerColor = ended ? '#9aa6b2' : secs <= 45 ? '#22c55e' : '#f59e0b';
  return (
    <View style={{ flex: 1, backgroundColor: c.appBg, paddingTop: insets.top }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 480, alignSelf: 'center', padding: 16 }}>
        <Text style={{ color: c.text, fontSize: 22, fontWeight: '700', marginBottom: 4 }}>
          🛰 {t('Live trip')}
        </Text>
        {info ? (
          <Text style={{ color: c.text2, fontSize: 15, marginBottom: 2 }}>
            {info.from} → {info.to}
          </Text>
        ) : null}
        {(info?.vehicleModel || info?.vehicle) ? (
          <Text style={{ color: c.text3, fontSize: 13, marginBottom: 12 }}>{info.vehicleModel || info.vehicle}</Text>
        ) : <View style={{ height: 12 }} />}

        {loc ? (
          <AreaMap
            center={{ latitude: loc.lat, longitude: loc.lon }}
            follow
            markerColor={markerColor}
            style={{ height: 360, borderRadius: 14 }}
          />
        ) : (
          <View style={{ height: 360, borderRadius: 14, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={c.accent} />
            <Text style={{ color: c.muted, marginTop: 10 }}>{t('Waiting for location…')}</Text>
          </View>
        )}

        {(ended || loc) ? (
          <Text style={{ fontSize: 13, marginTop: 14, textAlign: 'center' }}>
            <Text style={{ color: markerColor }}>{ended ? '✓' : '●'} </Text>
            <Text style={{ color: c.text3 }}>{ended ? t('Trip ended') : t('Updated {secs}s ago', { secs })}</Text>
          </Text>
        ) : null}

        {/* Driver + passenger info — pinned to the bottom so a watcher knows who
            the rider is with and which car to look for. */}
        <View style={{ marginTop: 'auto' }}>
          {info?.passenger ? (
            <Text style={{ color: c.text3, fontSize: 13, marginBottom: 8 }}>
              {t('Passenger')}: <Text style={{ color: c.text2, fontWeight: '600' }}>{info.passenger}</Text>
            </Text>
          ) : null}
          {(info?.driver || info?.phone || info?.vehicleModel || info?.plateNumber) ? (
            <View style={{ padding: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 12 }}>
              <Text style={{ color: c.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 6 }}>
                {t('Driver').toUpperCase()}
              </Text>
              {info?.driver ? (
                <Text style={{ color: c.text, fontSize: 16, fontWeight: '600' }}>{info.driver}</Text>
              ) : null}
              {(info?.vehicleModel || info?.plateNumber) ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <Ionicons name="car-sport" size={15} color={c.text3} />
                  <Text style={{ color: c.text2, fontSize: 14 }}>
                    {[info.vehicleModel, info.plateNumber].filter(Boolean).join('  •  ')}
                  </Text>
                </View>
              ) : null}
              {info?.phone ? (
                <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }} onPress={() => Linking.openURL('tel:' + info.phone)}>
                  <Ionicons name="call" size={15} color={c.link} />
                  <Text style={{ color: c.link, fontSize: 15 }}>{info.phone}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function AppInner() {
  const insets = useSafeAreaInsets();
  // Set when a notification tap (or a `?tab=` deep link) chose the tab, so the
  // role-based auto-tab effects below don't override the user's intent.
  const deepLinkedRef = useRef(false);
  const [tab, setTab] = useState<Tab>(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
      const t = new URLSearchParams(window.location.search).get('tab');
      if (t === 'messages' || t === 'browse' || t === 'post' || t === 'settings') { deepLinkedRef.current = true; return t as Tab; }
    }
    return 'post';
  });
  const [messagesView, setMessagesView] = useState<'active' | 'completed'>('active');
  // Celebration: fireworks overlay (deal completed / onboarding done) + the deal id
  // whose rating panel should glow after the fireworks finish.
  const [showFireworks, setShowFireworks] = useState(false);
  const [glowDealId, setGlowDealId] = useState<string | null>(null);
  // Deal id whose panel should glow once the fireworks complete (onboarding leaves
  // this null — no panel to glow).
  const pendingGlowId = useRef<string | null>(null);
  const glowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFireworksDone = () => {
    setShowFireworks(false);
    if (pendingGlowId.current) {
      const id = pendingGlowId.current;
      pendingGlowId.current = null;
      setGlowDealId(id);
      if (glowTimer.current) clearTimeout(glowTimer.current);
      glowTimer.current = setTimeout(() => setGlowDealId((cur) => (cur === id ? null : cur)), 6000);
    }
  };
  // Deals already celebrated — persisted so the burst fires exactly once per deal,
  // including when the OTHER party (who had the app closed at completion) reopens it
  // and the completed deal replays in via loadNegotiations.
  const celebratedIds = useRef<Set<string>>(new Set());
  const celebratedLoaded = useRef(false);
  useEffect(() => {
    kvGet('freeport.celebrated').then((raw) => {
      if (raw) { try { celebratedIds.current = new Set(JSON.parse(raw) as string[]); } catch {} }
      celebratedLoaded.current = true;
    });
  }, []);
  const markCelebrated = (id: string) => {
    celebratedIds.current.add(id);
    kvSet('freeport.celebrated', JSON.stringify([...celebratedIds.current])).catch(() => {});
  };
  // First-run guided tour (coach-marks over the bottom tabs). `tourStep` is the
  // index into the per-role step list (null = not running). It's started from
  // finishOnboarding only for rideshare Passenger/Driver who haven't seen it.
  const [tourStep, setTourStep] = useState<number | null>(null);
  // Whether the user has already seen the tour (persisted under
  // freeport.guidanceSeen). NOT cleared on sign-out, so the tour never replays.
  const guidanceSeen = useRef(true); // assume seen until the kv read says otherwise
  useEffect(() => {
    kvGet('freeport.guidanceSeen').then((raw) => { guidanceSeen.current = raw === '1'; }).catch(() => {});
  }, []);
  const tourTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endTour = () => {
    if (tourTimer.current) { clearTimeout(tourTimer.current); tourTimer.current = null; }
    setTourStep(null);
    guidanceSeen.current = true;
    kvSet('freeport.guidanceSeen', '1').catch(() => {});
  };
  // Pulsing glow behind the tab being highlighted by the current tour step.
  const tourGlow = useRef(new Animated.Value(0)).current;
  // Set when onboarding just finished: once the client exists, auto-subscribe
  // to the default notification server (DM pings only — empty filters match no
  // intents server-side), so new accounts get "new message" alerts without
  // finding the Settings toggle. One-shot; failure/denial just leaves push off.
  const autoPushPending = useRef(false);
  const [client, setClient] = useState<MobileClient | null>(null);
  const [npub, setNpub] = useState('');
  const [intents, setIntents] = useState<Intent[]>([]);
  const [myIntents, setMyIntents] = useState<Intent[]>([]);
  // Market feed index: keyed by `${pubkey}|${d}` so inbound events dedupe in O(1)
  // (newest createdAt per addressable id wins). The rendered `intents` array is
  // materialized from this in batches — see onIntent below — so a relay backfill
  // burst no longer costs O(n) (+ a re-render) per event.
  const intentsIndex = useRef<Map<string, Intent>>(new Map());
  // Gate "new request" alerts: false during the initial relay backfill (which
  // floods in within the first few seconds), flipped true shortly after so only
  // genuinely-new posts ping.
  const feedReady = useRef(false);
  const intentsFlush = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Re-materialize the rendered array from the index, at most once per ~80ms —
  // coalescing bursts of inbound events AND profile/reputation fetch callbacks
  // into a single re-render instead of one per event.
  const scheduleIntentsFlush = () => {
    if (intentsFlush.current) return;
    intentsFlush.current = setTimeout(() => {
      intentsFlush.current = null;
      let arr = [...intentsIndex.current.values()];
      if (arr.length > 10000) { // keep the newest 10k; bound the index too
        arr.sort((a, b) => b.createdAt - a.createdAt);
        arr = arr.slice(0, 10000);
        intentsIndex.current = new Map(arr.map((x) => [x.pubkey + '|' + x.d, x]));
      }
      setIntents(arr);
    }, 80);
  };
  const resetIntents = () => {
    intentsIndex.current.clear();
    if (intentsFlush.current) { clearTimeout(intentsFlush.current); intentsFlush.current = null; }
    setIntents([]);
  };
  // Which (client, services) pair the market subscription was last built for —
  // lets the resume path tell "config changed" from "same session, refresh".
  const marketSubFor = useRef<{ client: MobileClient; services: boolean } | null>(null);
  const [negos, setNegos] = useState<Negotiation[]>([]);
  const [profile, setProfile] = useState<UserProfile>({ name: '', picture: '', about: '', gallery: [], phone: '', phoneDisplay: 'full', link: '', vehicleModel: '', plateNumber: '', plateDisplay: 'masked' });
  const [servicesEnabled, setServicesEnabled] = useState(false);
  const [experimentalWallet, setExperimentalWallet] = useState(false);
  const experimentalChat = true; // Chat graduated from Experimental — always on
  const [chatShowLastSeen, setChatShowLastSeen] = useState(false);
  const [chatReceipts, setChatReceipts] = useState(false);
  const [chatCallsEnabled, setChatCallsEnabled] = useState(false);
  const [chatCallsTurn, setChatCallsTurn] = useState(false);
  const [chatTranslate, setChatTranslate] = useState(false);
  const [experimentalLlm, setExperimentalLlm] = useState(false);
  const [experimentalMiniApps, setExperimentalMiniApps] = useState(false);
  // Calls: one manager per client; prefs read through a ref so the manager's
  // event-time reads never see a stale closure.
  const callPrefsRef = useRef({ callsEnabled: false, turnEnabled: false });
  useEffect(() => { callPrefsRef.current = { callsEnabled: chatCallsEnabled, turnEnabled: chatCallsTurn }; }, [chatCallsEnabled, chatCallsTurn]);
  const [callState, setCallState] = useState<CallState>({ phase: 'idle' });
  const [callStreams, setCallStreams] = useState<{ local: any; remote: any }>({ local: null, remote: null });
  const callManagerRef = useRef<CallManager | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  // An opened invite link (/i/<code> path or legacy #invite= hash), waiting for
  // the client to resolve it.
  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(() =>
    Platform.OS === 'web' && typeof window !== 'undefined' ? parseInviteLink(window.location.href) : null,
  );
  const [resolvedInvite, setResolvedInvite] = useState<{ pubkey: string; name?: string } | null>(null);
  // Group import: a decoded (verified) group invite from an opened /g/<payload>
  // link, awaiting the user's Join; the admin "Create group invite" sheet; the
  // admin members/vouch sheet; and the local membership list (from prefs).
  const [resolvedGroup, setResolvedGroup] = useState<GroupInvite | null>(() =>
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? ((p) => (p ? decodeGroupInvite(p) : null))(parseGroupLink(window.location.href))
      : null,
  );
  const [showGroupInvite, setShowGroupInvite] = useState(false);
  const [groupMembersFor, setGroupMembersFor] = useState<JoinedGroup | null>(null);
  const [joinedGroups, setJoinedGroups] = useState<JoinedGroup[]>([]);
  const [walletNwcUrl, setWalletNwcUrl] = useState('');
  const [walletUnit, setWalletUnit] = useState<'sats' | 'usd' | 'local'>('local');
  const [postDraft, setPostDraft] = useState<RepostDraft | null>(null);
  const [walletPrefill, setWalletPrefill] = useState<{ mode?: 'send' | 'receive'; dest?: string; hint?: string; fiatAmount?: number; fiatCurrency?: string; memo?: string } | null>(null);
  /** Post being zapped (NIP-57) — opens the amount sheet. */
  const [zapTarget, setZapTarget] = useState<Intent | null>(null);
  /** Storefront products (NIP-15), keyed upstream by (pubkey, d). */
  const [products, setProducts] = useState<Product[]>([]);
  /** HODL escrows (one per deal). */
  const [escrows, setEscrows] = useState<EscrowState[]>([]);
  /** AI concierge (on-device Apple Foundation Models, iOS 26+). */
  const [conciergeOk, setConciergeOk] = useState(false);
  const [showConcierge, setShowConcierge] = useState(false);
  useEffect(() => { conciergeAvailability().then((a) => setConciergeOk(a === 'available')).catch(() => {}); }, []);
  const [location, setLocation] = useState<UserLocation>({ country: '', state: '', city: '' });
  // Mirror the latest location so the async launch auto-detect can tell whether
  // the user has manually changed it (e.g. picked a place during onboarding)
  // while detection was in flight — a manual pick must win over a late IP result.
  const locationRef = useRef<UserLocation>(location);
  useEffect(() => { locationRef.current = location; }, [location]);
  const [useNip07, setUseNip07] = useState(false);
  const [theme, setThemeState] = useState<'system' | 'dark' | 'light'>('system');
  const [distanceUnit, setDistanceUnit] = useState<'auto' | 'km' | 'mi'>('auto');
  // Browse preferences (Driver/Provider): default category/subcategory the feed
  // jumps to, alert toggles for new matching posts, and a max-distance filter.
  const [browseCategory, setBrowseCategory] = useState('');
  const [browseSubcategory, setBrowseSubcategory] = useState('');
  const [browseAlertSound, setBrowseAlertSound] = useState(false);
  const [browseAlertNotify, setBrowseAlertNotify] = useState(false);
  const [browseMaxDistance, setBrowseMaxDistance] = useState(100);
  const [sendLocationOnDeal, setSendLocationOnDeal] = useState(true);
  const [customMessage, setCustomMessage] = useState('');
  const [autoSendCustomMessage, setAutoSendCustomMessage] = useState(false);
  const [telemetryOn, setTelemetryOn] = useState(true);
  const [role, setRole] = useState<'passenger' | 'driver' | ''>('');
  // The onIntent handler is a one-time closure; read live browse-alert prefs via a ref.
  const browseAlertRef = useRef({ category: '', subcategory: '', sound: false, notify: false });
  // Whether the push notification server is the active notifier. When it is, the
  // app skips its own local fallback notifications so a message alerts only once
  // (the server push), instead of doubling up when you open the app.
  const pushOnRef = useRef(false);
  useEffect(() => {
    const read = () => { kvGet('freeport.pushOn').then((v) => { pushOnRef.current = v === '1'; }).catch(() => {}); };
    read();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') read(); });
    return () => sub.remove();
  }, []);
  // Honour the chosen OTA track on launch: point updates at its channel BEFORE
  // checking, then stage that track's newest bundle (applied on the next launch).
  // Native auto-check is off (checkAutomatically=ON_ERROR_RECOVERY) so this is
  // the single, track-aware update check.
  useEffect(() => {
    if (!trackSupported()) return;
    getTrack().then((tk) => { applyTrack(tk); checkForUpdate().catch(() => {}); }).catch(() => {});
  }, []);
  useEffect(() => {
    // A Driver's category is fixed to Ridesharing (stored as ''), so resolve the
    // effective category here to match categoryOf() on incoming posts.
    browseAlertRef.current = { category: browseCategory || RIDESHARE_CATEGORY, subcategory: browseSubcategory, sound: browseAlertSound, notify: browseAlertNotify };
  }, [browseCategory, browseSubcategory, browseAlertSound, browseAlertNotify]);
  // UI language; defaults to the device language until the user picks one.
  const [language, setLanguage] = useState<string>(systemLanguage());
  // Point the i18n module at the active language during render, so this render
  // (and all children) resolve t() against the right catalog. Cheap + idempotent;
  // re-runs whenever `language` state changes and re-renders the tree. For
  // code-split (on-demand) languages this also kicks off the chunk fetch.
  setI18nLang(language);
  // On-demand catalogs load asynchronously; re-render once one resolves so the
  // tree swaps from the English fallback to the loaded translation.
  const [, bumpI18n] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onI18nLoaded(bumpI18n), []);
  useEffect(() => { void ensureI18nLang(language); }, [language]);
  // Language picker → set + persist. If the new language flips the layout
  // direction (LTR↔RTL), the app must reload for it to take effect (see
  // rtl.ts), so persist first, then reload; otherwise switch in place.
  const changeLanguage = React.useCallback((l: string) => {
    const needsReload = applyLayoutDirection(l);
    setLanguage(l);
    savePrefs({ language: l })
      .catch(() => {})
      .finally(() => { if (needsReload) void reloadApp(); });
  }, []);
  // Custom fare-estimator coefficients (null = built-in defaults).
  const [fareConfig, setFareConfigState] = useState<FareConfig | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const signerRef = useRef<Signer | null>(null);
  const [initVersion, setInitVersion] = useState(0);
  // "Back up your account" reminder — a slim banner above the tab bar until a
  // backup exists (file export, cloud save, passkey, or restored FROM one).
  // Dismissable, but it re-appears after 7 days (see prefs.backupReminder*).
  const [backupBanner, setBackupBanner] = useState(false);
  // Bumped when the banner is tapped: tells SettingsTab to expand the
  // Account & Backup section and scroll it into view.
  const [openBackupSignal, setOpenBackupSignal] = useState(0);
  useEffect(() => {
    // Only nag once a LOCAL key exists (never during onboarding; NIP-07 users
    // have no local key to back up), and only when the built-in wallet is on
    // AND holds funds — that's when an unbacked-up key means losing money.
    if (onboarding || !npub || !signerRef.current?.secretKey || !experimentalWallet) { setBackupBanner(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const p = await loadPrefs();
        if (p.backupDone) return;
        if (Date.now() - (p.backupReminderDismissedAt || 0) < 7 * 24 * 3600 * 1000) return;
        // Migration for installs that backed up before this flag existed: the
        // key already sitting in the cloud counts as backed up (same check as
        // Settings' Required-actions box).
        if (cloudAvailable()) {
          try {
            const [saved, cur] = await Promise.all([cloudRestore(), getStoredNsec()]);
            if (saved && cur && saved.includes(cur)) {
              savePrefs({ backupDone: true }).catch(() => {});
              return;
            }
          } catch { /* cloud unreachable — fall through to the banner */ }
        }
        // Last gate (and the expensive one, so it runs only when every other
        // condition already passes): the wallet must actually hold funds.
        const { defaultWalletProvider } = await import('./src/wallet');
        const w = await defaultWalletProvider();
        if (!w) return;
        const bal = await w.balance().catch(() => null);
        const hasFunds = (bal?.sats ?? 0) > 0
          || (await w.tokenBalances?.().catch(() => []) ?? []).some((tk) => tk.amount > 0);
        if (!hasFunds) return;
        if (!cancelled) setBackupBanner(true);
      } catch { /* leave hidden */ }
    })();
    return () => { cancelled = true; };
  }, [npub, onboarding, experimentalWallet]);
  const dismissBackupBanner = () => {
    setBackupBanner(false);
    savePrefs({ backupReminderDismissedAt: Date.now() }).catch(() => {});
  };
  // Install the window.freeport debug API on web (no-op on native), so it's
  // available even on the onboarding screen before a client exists.
  useEffect(() => { installDebugApi(); }, []);
  // Ask for notification permission + set up the Android channel once (native only;
  // web is a no-op and uses PWA push instead).
  useEffect(() => { initNotifications(); }, []);

  // iOS background keepalive + "updates paused" nag (see hook).
  useBackgroundGrace(myIntents, negos, pushOnRef);

  // AppState "active" listener: reconnect relays + bump resumeTick + mute alerts.
  const { resumeTick, alertsMutedUntil } = useResumeReconnect(client);

  // Signed DMs waiting for a relay (offline sends). Surfaced in the status pill
  // so a "Confirmed" card the counterparty hasn't received yet is never silent.
  const [outboxPending, setOutboxPending] = useState(0);
  const { updating } = useUpdateState();
  const webUpdate = useWebUpdateAvailable();

  // Live relay connectivity for the header status pill.
  const { netStatus, netSteady } = useRelayStatus(client, resumeTick);

  // Scroll-driven collapse of the header + tab bar. These are LAYOUT props
  // (padding/size/font), which the native animation driver can't touch — the
  // old continuous binding (Animated.event on every scrolled frame,
  // useNativeDriver:false) re-laid-out the header and all four tab items on
  // the JS thread 60×/s while scrolling, the app's hottest interaction.
  // Instead, a threshold with hysteresis flips a single 0→1 value and one
  // 180ms timing drives the same interpolations — per-frame cost is now a
  // trivial number comparison.
  const collapse = useRef(new Animated.Value(0)).current;
  const collapsedRef = useRef(false);
  const onContentScroll = useRef((e: { nativeEvent: { contentOffset: { y: number } } }) => {
    const y = e.nativeEvent.contentOffset.y;
    const want = collapsedRef.current ? y > 14 : y > 52; // hysteresis — no flutter at the boundary
    if (want === collapsedRef.current) return;
    collapsedRef.current = want;
    Animated.timing(collapse, {
      toValue: want ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false, // layout props; runs only on the two transitions
    }).start();
  }).current;
  const anim = useRef(
    (() => {
      const p = (a: number, b: number) =>
        collapse.interpolate({ inputRange: [0, 1], outputRange: [a, b], extrapolate: 'clamp' });
      return {
        logo: p(26, 16), logoR: p(6, 4),
        titlePadT: p(6, 3), titlePadB: p(8, 3),
        titleFont: p(20, 15),
        subOpacity: p(1, 0), subWidth: p(200, 0),
        tabPad: p(10, 5),
        labelH: p(15, 0), labelOpacity: p(1, 0),
      };
    })(),
  ).current;

  // Resolve the effective theme (follow the OS when set to "system") and apply
  // the palette once whenever it changes.
  const systemScheme = useColorScheme();
  // An installed (Home Screen / standalone) PWA defaults to the dark brand to
  // match the launch splash + native app, instead of following a light OS —
  // otherwise it looks like the theme "flips" dark→light on reopen. In-browser
  // still follows the OS. An explicit dark/light choice always wins.
  const isStandalonePWA = Platform.OS === 'web' && typeof window !== 'undefined' &&
    (((window as any).matchMedia && (window as any).matchMedia('(display-mode: standalone)').matches) ||
      (typeof navigator !== 'undefined' && (navigator as any).standalone === true));
  const effectiveTheme: 'dark' | 'light' =
    theme === 'system'
      ? (isStandalonePWA ? 'dark' : (systemScheme === 'light' ? 'light' : 'dark'))
      : theme;
  // Resolve the distance unit through the shared helper (single source of
  // truth with Settings/Browse so labels and values can never disagree).
  const effectiveDistanceUnit: 'km' | 'mi' = effectiveUnit(distanceUnit, location.country);
  const appliedThemeRef = useRef<string>('');
  if (appliedThemeRef.current !== effectiveTheme) {
    applyTheme(effectiveTheme);
    appliedThemeRef.current = effectiveTheme;
  }

  // Faint, tiled icon pattern for the blank side margins on wide web screens.
  // Seeded by the account (npub) so each newly created account gets a different
  // arrangement; re-emits when the theme colour or the account changes.
  useEffect(() => {
    applySideBackdrop(effectiveTheme === 'light' ? 'rgba(15,23,42,0.06)' : 'rgba(226,232,240,0.05)', npub);
  }, [effectiveTheme, npub]);

  // Reset the collapse when switching tabs (the new tab starts at the top).
  useEffect(() => { collapsedRef.current = false; collapse.setValue(0); }, [tab, collapse]);

  useEffect(() => {
    (async () => {
      const p = await loadPrefs();
      setServicesEnabled(p.servicesEnabled);
      setExperimentalWallet(p.experimentalWallet);
      setChatShowLastSeen(p.chatShowLastSeen);
      setChatReceipts(p.chatReceipts);
      setChatCallsEnabled(p.chatCallsEnabled);
      setChatCallsTurn(p.chatCallsTurn);
      setChatTranslate(p.chatTranslate);
      setExperimentalLlm(p.experimentalLlm);
      setExperimentalMiniApps(p.experimentalMiniApps);
      setWalletNwcUrl(p.walletNwcUrl);
      setWalletUnit(p.walletUnit === 'sats' ? 'local' : p.walletUnit); // header is fiat-only now
      setLocation(p.location);
      setUseNip07(p.useNip07);
      setThemeState(p.theme); // palette applied by the effective-theme resolver above
      setDistanceUnit(p.distanceUnit);
      setBrowseCategory(p.browseCategory);
      setBrowseSubcategory(p.browseSubcategory);
      setJoinedGroups(p.groups);
      setBrowseAlertSound(p.browseAlertSound);
      setBrowseAlertNotify(p.browseAlertNotify);
      setBrowseMaxDistance(p.browseMaxDistance);
      setSendLocationOnDeal(p.sendLocationOnDeal);
      setCustomMessage(p.customMessage);
      setAutoSendCustomMessage(p.autoSendCustomMessage);
      setTelemetryOn(p.telemetryEnabled);
      initTelemetry(p.telemetryEnabled).then(() => trackEvent('app_opened')).catch(() => {});
      setRole(p.role);
      setLanguage(p.language || systemLanguage()); // '' pref = follow the device language
      setFareConfigState(p.fareConfig);
      setFareConfig(p.fareConfig); // point the estimator at the saved coefficients
      // Drivers/providers browse listings first → open Browse on launch (unless
      // a notification tap / deep link already chose a tab).
      if (p.role === 'driver' && !deepLinkedRef.current) setTab('browse');

      // A location the user explicitly chose (onboarding confirm / Settings) is
      // sticky — never silently overwrite it with a coarse IP guess on later
      // launches. Auto-detect only fills/refines a location they haven't set.
      if (p.locationManual) return;
      // Auto-detect current location on every launch: the device's real location
      // first, IP only as a fallback. On web, getCurrentPosition needs an explicit
      // permission grant — ask for it so the browser's location access is actually
      // used (IP geolocation is coarse and rate-limited, so it must be last resort).
      if (Platform.OS === 'web') { try { await requestLocationPermission(); } catch { /* ignore */ } }
      const raw = (await detectRawLocationGPS()) ?? (await detectRawLocationIP());
      const m = raw ? matchLocation(raw.countryCode, raw.region, raw.city) : null;
      if (!m) return; // unsupported / undetectable — keep whatever was saved
      // Detection is async (network); if the user manually changed location while
      // it was in flight (e.g. picked a city during onboarding), that pick wins —
      // don't clobber it with a late, coarser IP result.
      const cur = locationRef.current;
      if (cur.country !== p.location.country || cur.state !== p.location.state || cur.city !== p.location.city) return;
      const sameCountry = cur.country === m.country;
      const next: UserLocation = {
        country: m.country,
        // Detection is often coarser than a manual pick — preserve the user's
        // finer state/city when we're still in the same country.
        state: m.state || (sameCountry ? cur.state : ''),
        city: m.city || (sameCountry ? cur.city : ''),
      };
      if (next.country !== cur.country || next.state !== cur.state || next.city !== cur.city) {
        setLocation(next);
        savePrefs({ ...p, location: next }).catch(() => {});
      }
    })();
    // Re-run on initVersion bump (restore / account switch) so a restored
    // account's role + settings load into state, not just on first mount.
  }, [initVersion]);

  // Save the passenger a tap: shortly after load, if they have no live request
  // awaiting offers but DO have an ongoing conversation/deal, open Messages
  // instead of the empty New Request form. One-shot per session; the `tab==='post'`
  // guard means it never overrides manual navigation or a freshly-composed post.
  const autoMsgDone = useRef(false);
  const autoMsgState = useRef({ role, tab, myIntents, negos });
  autoMsgState.current = { role, tab, myIntents, negos };
  useEffect(() => {
    autoMsgDone.current = false;
    const id = setTimeout(() => {
      if (autoMsgDone.current || deepLinkedRef.current) return;
      const { role: r, tab: tb, myIntents: mi, negos: ng } = autoMsgState.current;
      if (r !== 'passenger' || tb !== 'post') return;
      const nowSec = Math.floor(Date.now() / 1000);
      const hasLiveRequest = mi.some((i) => !(i.content.payload as any)?.withdrawn
        && i.content.expires_at >= nowSec
        && !(i.content.window && i.content.window.start < nowSec));
      const hasConversation = ng.some((n) => n.state !== 'cancelled' && n.state !== 'expired');
      if (!hasLiveRequest && hasConversation) { autoMsgDone.current = true; setTab('messages'); }
    }, 4000);
    return () => clearTimeout(id);
  }, [initVersion]);

  // Deep-link on notification tap (native / web SW) — see hook.
  useDeepLinkNav(setTab, setMessagesView, deepLinkedRef, () => pickMessagesViewRef.current());

  // Currency follows the set location; before one is set (or when GPS/IP
  // detection returns empty), fall back to the device locale's region rather
  // than a hardcoded SGD, so e.g. a US device sees USD by default.
  const defaultCurrency: Currency = location.country
    ? currencyForCountry(location.country)
    : currencyForCountry(systemCountry());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Pick the signer: NIP-07 extension if opted in and available, else local key.
      const prefs = await loadPrefs();
      let signer: Signer;
      if (prefs.useNip07 && hasNip07()) {
        try {
          signer = await Nip07Signer.connect();
        } catch {
          const sk = await loadKey();
          if (!sk) { if (!cancelled) setOnboarding(true); return; }
          signer = new LocalSigner(sk);
        }
      } else {
        // First launch (no stored key) → show the create/restore screen instead
        // of silently creating one.
        const sk = await loadKey();
        if (!sk) { if (!cancelled) setOnboarding(true); return; }
        signer = new LocalSigner(sk);
      }
      if (cancelled) return;
      setOnboarding(false);
      signerRef.current = signer;
      setNpub(npubFromHex(signer.pubkey));
      const p = await loadProfile();
      if (cancelled) return;
      setProfile(p);
      const c = new MobileClient(signer);
      // Addressable events: dedupe by (author, d-tag) in O(1) via the index,
      // keeping the latest republish (a withdraw/update has a new event id but
      // the same d, so it must replace — not sit beside — the stale version).
      // Materialize the array once per ~80ms batch instead of per event.
      c.onIntent = (i) => {
        const key = i.pubkey + '|' + i.d;
        const cur = intentsIndex.current.get(key);
        if (cur && cur.createdAt >= i.createdAt) return; // older or duplicate → ignore
        // Alert on a genuinely-new request that lands while the user is here:
        // not a known listing, past the initial backfill, recently posted, app
        // foregrounded. (eventAlert self-throttles bursts.)
        const isNewLive = !cur && feedReady.current && Date.now() >= alertsMutedUntil.current
          && i.createdAt >= Math.floor(Date.now() / 1000) - 120;
        if (isNewLive && AppState.currentState === 'active') {
          eventAlert();
        }
        // Browse-preference alerts: a new post matching the user's default
        // category + subcategory. Sound (foreground) and/or a notification
        // (also when backgrounded) — both opt-in in Settings.
        if (isNewLive) {
          const bp = browseAlertRef.current;
          const pl = i.content.payload as any;
          const matches = bp.subcategory
            && categoryOf(i.content.schema, pl) === bp.category
            && subcategoryOf(i.content.schema, pl) === bp.subcategory;
          if (matches) {
            if (bp.sound && AppState.currentState === 'active') eventAlert();
            if (bp.notify && !pushOnRef.current) notify(t('New post'), (i.content.title || '').trim() || `${t(bp.category)} · ${t(bp.subcategory)}`, { tab: 'browse' });
          }
        }
        intentsIndex.current.set(key, i);
        scheduleIntentsFlush();
      };
      // Dedupe by d-tag, keep the latest republish per intent
      c.onOwnIntent = (i) =>
        setMyIntents((prev) => {
          const existing = prev.find((p) => p.d === i.d);
          if (existing && existing.createdAt >= i.createdAt) return prev;
          return [i, ...prev.filter((p) => p.d !== i.d)];
        });
      c.onNegotiationUpdate = () => setNegos([...c.negotiations.values()]);
      c.onConversationUpdate = () => setConversations([...c.conversations.values()]);
      c.onProduct = () => setProducts([...c.products.values()]);
      c.onProductRemoved = () => setProducts([...c.products.values()]);
      c.onEscrowUpdate = () => setEscrows([...c.escrows.values()]);
      // Friend chat alerts: ding in the foreground, notify when backgrounded
      // (mirrors onIncomingMessage; the push server doesn't know about chat
      // DMs' content either way — envelopes are indistinguishable kind-4s).
      c.onIncomingChat = (conv, env) => {
        if (conv.muted) return; // muted thread: no ding, no notification
        if (AppState.currentState === 'active') {
          if (Date.now() >= alertsMutedUntil.current) eventAlert();
          return;
        }
        if (pushOnRef.current) return;
        const body = env.type === CHAT_INVITE
          ? t('New chat invite')
          : (env.text || '').trim().slice(0, 120) || t('New message');
        notify('Freeport', body, { tab: 'messages' });
      };
      c.onOutboxChange = (n) => setOutboxPending(n);
      // Local notification for a new inbound DM. Only when backgrounded — the
      // in-app Messages badge already covers the foreground. Content-blind body.
      c.onIncomingMessage = (_nego, msg) => {
        if (AppState.currentState === 'active') {
          // Resume replays are silent; only ding while alerts are live.
          if (Date.now() >= alertsMutedUntil.current) eventAlert();
          return;
        }
        if (pushOnRef.current) return; // the notification server handles background → avoid a double alert
        // The app can decrypt, so show the actual chat text (media types as a
        // friendly label). Server pushes stay content-blind for privacy.
        let body: string;
        if (msg.type === MSG_CHAT) {
          const txt = (msg.text || '').trim();
          body = !txt ? t('New message')
            : isImageMsg(txt) ? '📷 ' + t('Photo')
            : isAudioMsg(txt) ? '🎙 ' + t('Voice memo')
            : isTripMsg(txt) ? '📍 ' + t('Live location')
            : txt.length > 120 ? txt.slice(0, 117) + '…' : txt;
        } else if (msg.type === MSG_COUNTER) {
          // Surface the proposed price/terms, not just "an offer arrived".
          const pay = (msg.terms?.payment || '').trim();
          body = pay ? `${t('New offer on your post')}: ${pay}` : t('New offer on your post');
        } else {
          body = msg.type === MSG_ACCEPT ? t('Your deal is confirmed')
            : t('New activity on your deal');
        }
        notify('Freeport', body, { tab: 'messages' });
      };
      // Re-sort the feed when an author's profile/reputation arrives (karma &
      // distance sorts depend on it) — batched via the same flush.
      c.onProfileFetched = () => scheduleIntentsFlush();
      c.onReputationFetched = () => scheduleIntentsFlush();
      await c.loadNegotiations(); // restore deals saved before the last reload
      // watchDMs is wired in its own effect (keyed on resumeTick) so it can be
      // re-subscribed on app resume to backfill DMs missed while offline.
      // Expose this profile's live client to the window.freeport debug API (web only).
      registerDebugClient(c, npubFromHex(signer.pubkey));
      if (!cancelled) setClient(c);
      // Let the initial relay backfill settle before "new request" alerts arm.
      setTimeout(() => { feedReady.current = true; }, 5000);
    })();
    return () => { cancelled = true; feedReady.current = false; };
  }, [initVersion]);

  // Deal-completion celebration. Fires when a deal is confirmed + completed, not yet
  // rated, and not celebrated before. Detecting here (App has `negos`) keeps the
  // overlay + tab switch local. Crucially this also fires for the OTHER party who had
  // the app closed at completion: loadNegotiations replays the completed deal into
  // `negos` on reopen, this effect sees it, and celebrates exactly once (guarded by
  // the persisted `freeport.celebrated` set).
  useEffect(() => {
    if (!celebratedLoaded.current) return; // wait until the persisted set is loaded
    const candidates = negos.filter(
      (n) => n.state === 'confirmed' && n.stage === 'completed' && !celebratedIds.current.has(n.id),
    );
    if (candidates.length === 0) return;
    let cancelled = false;
    (async () => {
      let rated = new Set<string>();
      try { const raw = await kvGet('freeport.rated'); if (raw) rated = new Set(JSON.parse(raw) as string[]); } catch {}
      if (cancelled) return;
      const fresh = candidates.filter((n) => !rated.has(n.id));
      if (fresh.length === 0) return;
      // Most recently updated qualifying deal.
      const winner = fresh.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (celebratedIds.current.has(winner.id)) return; // re-entrancy guard
      markCelebrated(winner.id);
      setMessagesView('completed');
      setTab('messages');
      pendingGlowId.current = winner.id; // glow starts when the fireworks finish (see onDone)
      setShowFireworks(true);
    })();
    return () => { cancelled = true; };
  }, [negos]);

  // Auto-send the custom message when a deal is confirmed (Settings → Features).
  // Every confirmed deal is marked handled exactly once (persisted), even while
  // the toggle is off or the message empty — so enabling the feature later never
  // blasts the message into pre-existing chats. The recency guard keeps relay
  // replays of old confirmed deals (fresh install + key restore) silent too.
  const autoMsgHandled = useRef<Set<string>>(new Set());
  const autoMsgLoaded = useRef(false);
  useEffect(() => {
    kvGet('freeport.autoMsgSent').then((raw) => {
      if (raw) { try { autoMsgHandled.current = new Set(JSON.parse(raw) as string[]); } catch {} }
      autoMsgLoaded.current = true;
    }).catch(() => { autoMsgLoaded.current = true; });
  }, []);
  useEffect(() => {
    if (!client || !autoMsgLoaded.current) return;
    const fresh = newlyConfirmed(negos, autoMsgHandled.current);
    if (fresh.length === 0) return;
    const msg = customMessage.trim();
    const nowSec = Date.now() / 1000;
    for (const n of fresh) {
      autoMsgHandled.current.add(n.id);
      if (autoSendCustomMessage && msg && nowSec - n.updatedAt < 600) {
        client.sendChat(n.id, msg).catch(() => {});
      }
    }
    kvSet('freeport.autoMsgSent', JSON.stringify([...autoMsgHandled.current])).catch(() => {});
  }, [negos, client, autoSendCustomMessage, customMessage]);

  // Subscribe to the coarse market tag(s) every post carries (DEMO_MARKET /
  // SERVICE_MARKET). Discovery must NOT hinge on the location-sharded topic:
  // location detection is best-effort, so two real users frequently resolve to
  // different area keys (or an empty one) and would never see each other —
  // e.g. a brand-new account with no location lands in the `global` shard and
  // sees nothing. Locality is handled client-side instead (distance sort +
  // category/keyword filters); the area `t` tags stay on posts so relay-side
  // area sharding can be switched back on at scale.
  useEffect(() => {
    if (!client) return;
    // Reset only when the client/config actually changed. A foreground resume
    // (resumeTick) keeps the in-memory feed and resubscribes from the client's
    // newest-seen watermark instead of re-downloading 24 h of intents (which
    // also re-triggered profile + reputation fetches for every author).
    const isResumeOnly = marketSubFor.current?.client === client && marketSubFor.current?.services === servicesEnabled;
    if (!isResumeOnly) resetIntents();
    marketSubFor.current = { client, services: servicesEnabled };
    const markets = servicesEnabled ? [DEMO_MARKET, SERVICE_MARKET] : [DEMO_MARKET];
    const unsub = client.watchMarket(markets);
    // Storefronts ride the services vertical — same market tag.
    const unsubShops = servicesEnabled ? client.watchShops(SERVICE_MARKET) : null;
    return () => { unsub(); unsubShops?.(); };
  }, [client, servicesEnabled, resumeTick]);

  // Watch incoming DMs (offers/messages). Re-subscribed on resume so a fresh
  // REQ replays anything that arrived while the app was offline/suspended —
  // e.g. a driver's offer sent while the passenger had no network.
  useEffect(() => {
    if (!client) return;
    const unsub = client.watchDMs();
    return unsub;
  }, [client, resumeTick]);

  // Tick once a minute so time-derived UI (expiry countdowns, expired notices)
  // refreshes even without a relay event.
  const [nowTick, setNowTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setNowTick((t) => t + 1), 60_000); return () => clearInterval(id); }, []);

  // System notifications: a post that reached its expiry OR its requested time
  // with no confirmed deal. We LOG these (persisted) the instant we detect them,
  // so the notice survives a reload even after relays drop the expired event,
  // and fires whether the post died by `expires_at` or by its scheduled time.
  const [expiredLog, setExpiredLog] = useState<{ d: string; title: string }[]>([]);
  const [expiredSeen, setExpiredSeen] = useState<Set<string>>(new Set());
  useEffect(() => {
    kvGet('freeport.expiredLog').then((raw) => { if (raw) try { setExpiredLog(JSON.parse(raw)); } catch {} });
    kvGet('freeport.expiredSeen').then((raw) => { if (raw) try { setExpiredSeen(new Set(JSON.parse(raw) as string[])); } catch {} });
  }, []);
  useEffect(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const dead = (i: Intent) =>
      !(i.content.payload as any)?.withdrawn
      && (i.content.expires_at < nowSec || (!!i.content.window && i.content.window.start < nowSec))
      && !negos.some((n) => n.intent.id === i.id && n.state === 'confirmed');
    setExpiredLog((prev) => {
      const have = new Set(prev.map((e) => e.d));
      const fresh = myIntents.filter((i) => dead(i) && !have.has(i.d));
      if (!fresh.length) return prev;
      const next = [...prev, ...fresh.map((i) => ({ d: i.d, title: i.content.schema.startsWith('rideshare') ? myPostTitle(i) : i.content.title }))];
      kvSet('freeport.expiredLog', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [myIntents, negos, nowTick]);
  const dismissExpired = (id: string) =>
    setExpiredSeen((prev) => {
      const next = new Set([...prev, id]);
      kvSet('freeport.expiredSeen', JSON.stringify([...next])).catch(() => {});
      return next;
    });
  // Hide a logged notice once dismissed, or if the deal later confirmed after all.
  const expiredNotices = expiredLog.filter(
    (e) => !expiredSeen.has(e.d) && !negos.some((n) => n.intent.d === e.d && n.state === 'confirmed'),
  );

  // Unread inbound chat messages drive the Messages badge too (not just
  // action-needed offers). "Seen" advances whenever the Messages tab is open, so
  // viewing the thread clears it. Timestamps are in seconds (ChatMessage.ts).
  const [chatSeenTs, setChatSeenTs] = useState(() => Math.floor(Date.now() / 1000));
  // Persisted so "unread" survives a cold start — otherwise the badge resets to 0
  // on every launch, and a notification tapped from a cold start couldn't tell
  // which deal the new message belongs to (see pickMessagesView).
  useEffect(() => {
    kvGet('freeport.chatSeenTs').then((v) => { const n = Number(v); if (v && Number.isFinite(n)) setChatSeenTs(n); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (tab === 'messages') {
      const now = Math.floor(Date.now() / 1000);
      setChatSeenTs(now);
      kvSet('freeport.chatSeenTs', String(now)).catch(() => {});
    }
  }, [tab, negos]);
  // Badge counts reduce over every message of every negotiation/conversation;
  // memoized so they don't re-run on every AppInner render (e.g. the 80ms
  // intents flush during backfill), only when their inputs actually change.
  const unreadChats = React.useMemo(() => tab === 'messages'
    ? 0
    : negos.reduce((n, g) => n + (g.messages?.filter((m) => m.dir === 'in' && m.ts > chatSeenTs).length ?? 0), 0),
    [tab, negos, chatSeenTs]);

  // When opening Messages (menu tap or notification), jump to the sub-tab where
  // the newest UNREAD activity is: an inbound chat message, or a just-confirmed
  // deal. Returns null when nothing is unread, so a manual sub-tab choice is kept.
  const pickMessagesView = (): 'active' | 'completed' | null => messagesViewForNewActivity(negos, chatSeenTs);
  const pickMessagesViewRef = useRef(pickMessagesView);
  pickMessagesViewRef.current = pickMessagesView;
  // Open Messages and auto-select the right sub-tab for any new message.
  const openMessages = () => { const v = pickMessagesView(); if (v) setMessagesView(v); setTab('messages'); };

  // Blocked peers (hex pubkeys). Inbound DMs from them are dropped by the client,
  // so the user receives no more messages from a person they blocked. Persisted.
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  useEffect(() => {
    kvGet('freeport.blocked').then((v) => { try { if (v) setBlocked(new Set(JSON.parse(v) as string[])); } catch { /* ignore */ } }).catch(() => {});
  }, []);
  useEffect(() => { client?.setBlocked(blocked); }, [client, blocked]);
  const toggleBlock = (pubkey: string) => {
    if (!pubkey) return;
    setBlocked((prev) => {
      const next = new Set(prev);
      if (next.has(pubkey)) next.delete(pubkey); else next.add(pubkey);
      kvSet('freeport.blocked', JSON.stringify([...next])).catch(() => {});
      return next;
    });
  };

  // A deal confirming is a state change, not an inbound chat message — so on the
  // Driver's side a passenger-confirmed deal arrives with no `messages` entry and
  // unreadChats stays 0, leaving the Messages tab without its badge. Count deals
  // that confirmed/updated since the user last opened Messages so the badge shows.
  const unreadDeals = React.useMemo(() => tab === 'messages'
    ? 0
    : negos.filter((n) => n.state === 'confirmed' && n.updatedAt > chatSeenTs).length,
    [tab, negos, chatSeenTs]);

  // Friend chat: unread messages + pending incoming invites join the badge.
  // Pending invites count even while the experiment is OFF — the request row
  // renders regardless, so the badge must lead the user to it.
  const chatBadge = React.useMemo(() => tab === 'messages'
    ? 0
    : conversations.reduce((n, c) => (blocked.has(c.peer) ? n : n + (experimentalChat && !c.muted ? convUnread(c) : 0) + (c.state === 'pending_in' ? 1 : 0)), 0),
    [tab, conversations, blocked, experimentalChat]);

  const pendingCount = negos.filter(
    (n) => n.state === 'open' && n.termsBy === 'them' || n.state === 'accepted_by_them',
  ).length + expiredNotices.length + unreadChats + unreadDeals + chatBadge;

  // Listings whose deal (for us) is finished — completed or cancelled/expired —
  // so Browse can hide them: a closed deal shouldn't keep showing as takeable.
  // Keyed by (author, d-tag) so it matches regardless of event-id replacement.
  const doneListingKeys = React.useMemo(() => {
    const s = new Set<string>();
    for (const n of negos) {
      const done = n.state === 'cancelled' || n.state === 'expired'
        || (n.state === 'confirmed' && n.stage === 'completed');
      if (done) s.add(n.intent.pubkey + '|' + n.intent.d);
    }
    return s;
  }, [negos]);

  // Required-actions count → badge on the Settings tab. Location + notification
  // permission are async (default true so the badge doesn't flash on launch);
  // missing vehicle details (rideshare Driver only) is derived synchronously.
  const [locOk, setLocOk] = useState(true);
  const [notifOk, setNotifOk] = useState(true);
  // Notifications are optional, so let users permanently dismiss that required
  // action on every platform. Persisted via kv (localStorage on web, SecureStore
  // on native) so it survives relaunch; loaded async since native storage is async.
  const [notifDismissed, setNotifDismissed] = useState(false);
  useEffect(() => {
    kvGet('freeport.notifDismiss').then((v) => { if (v === '1') setNotifDismissed(true); }).catch(() => {});
  }, []);
  const dismissNotif = React.useCallback(() => {
    kvSet('freeport.notifDismiss', '1').catch(() => {});
    setNotifDismissed(true);
  }, []);
  const refreshRequired = React.useCallback((override?: { loc?: boolean; notif?: boolean }) => {
    if (override?.loc) setLocOk(true); else locationGranted().then(setLocOk).catch(() => {});
    if (override?.notif) setNotifOk(true); else notificationGranted().then(setNotifOk).catch(() => {});
  }, []);
  useEffect(() => {
    refreshRequired();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') refreshRequired(); });
    return () => sub.remove();
  }, [refreshRequired, resumeTick]);
  const vehicleMissing = role === 'driver' && !servicesEnabled
    && (!profile.vehicleModel?.trim() || !profile.plateNumber?.trim());
  const notifSatisfied = notifOk || notifDismissed;
  const requiredCount = (locOk ? 0 : 1) + (notifSatisfied ? 0 : 1) + (vehicleMissing ? 1 : 0);

  // One-step Accept: when the peer accepts our proposal the deal confirms with
  // only their contact attached. Auto-reply once with OUR contact so both sides
  // have each other's — no second human "Confirm" tap. (The acceptor already
  // sent theirs, so `ourContact` is set there and this won't fire for them.)
  const buildContact = (intent: Intent, weInitiated: boolean): string => {
    const iAmDriver = intent.content.schema.startsWith('rideshare') && weInitiated;
    const parts = [profile.name, profile.phone];
    if (iAmDriver && profile.vehicleModel?.trim() && profile.plateNumber?.trim()) {
      parts.push(`🚗 ${profile.vehicleModel.trim()} • ${profile.plateNumber.trim()}`);
    }
    return parts.filter(Boolean).join(' · ') || (client?.pubkey.slice(0, 12) ?? '');
  };
  const buildContactFor = (n: Negotiation): string => buildContact(n.intent, n.weInitiated);

  // Wallet experiment: our accepts carry a receive address so the counterparty
  // gets a Pay button. Resolved lazily at accept time (the callback boots the
  // wallet only then); client.resolvePayAddress caps the wait at 8s.
  useEffect(() => {
    if (!client) return;
    client.getPayAddress = experimentalWallet
      ? async () => (await activeWalletProvider(walletNwcUrl))?.address() ?? null
      : undefined;
    // HODL escrow needs the Breez HTLC surface (NWC has none).
    client.getEscrowWallet = experimentalWallet
      ? async () => {
          const p = await activeWalletProvider(walletNwcUrl);
          if (!p?.createHoldInvoice || !p.claimHtlc) return null;
          return { createHoldInvoice: p.createHoldInvoice.bind(p), claimHtlc: p.claimHtlc.bind(p) };
        }
      : undefined;
  }, [client, experimentalWallet, walletNwcUrl]);
  // Receipts/last-seen toggles feed the client (it sends/omits acks accordingly).
  useEffect(() => {
    client?.setChatPrefs({ receipts: chatReceipts, lastSeen: chatShowLastSeen });
  }, [client, chatReceipts, chatShowLastSeen]);

  // Call manager — created per client; torn down (hang up) on client swap.
  useEffect(() => {
    if (!client) return;
    const mgr = new CallManager({
      send: (peer, env) => client.sendCallSignal(peer, env),
      prefs: () => callPrefsRef.current,
      turnEndpoint: () => 'https://turn.freeport.network',
      onState: setCallState,
      onStreams: (local, remote) => setCallStreams({ local, remote }),
      onMissed: (peer, direction, video) => {
        const icon = video ? '📹 ' : '📞 ';
        client.chatLocalNotice(peer, direction === 'incoming' ? 'in' : 'out',
          direction === 'incoming'
            ? icon + (video ? t('Missed video call') : t('Missed call'))
            : icon + t('No answer'));
        if (direction === 'incoming' && AppState.currentState !== 'active' && !pushOnRef.current) {
          notify('Freeport', t('Missed call'), { tab: 'messages' });
        }
      },
      onIncomingCall: (peer, video) => {
        // Foreground: the ringing overlay + tone already handle it. Backgrounded:
        // fire a high-priority local notification so the user can tap in and
        // answer before the ring times out. Fired even when server push is on —
        // the content-blind server can only say "New message"; this one knows
        // it's a call and who's calling. (Killed-app ringing needs CallKit/VoIP.)
        if (AppState.currentState === 'active') return;
        const name = client.profiles.get(peer)?.name?.trim() || npubFromHex(peer).slice(0, 12) + '…';
        notify(t('Incoming call'), (video ? '📹 ' : '📞 ') + t('{name} is calling — tap to answer', { name }), { tab: 'messages' });
      },
    });
    callManagerRef.current = mgr;
    client.onCallSignal = (from, env) => {
      // Ring only while alerts are live (mirrors chat's resume-mute window).
      if (env.type === 'call.offer' && AppState.currentState === 'active' && Date.now() >= alertsMutedUntil.current) eventAlert();
      mgr.handleSignal(from, env);
    };
    return () => {
      mgr.hangup();
      callManagerRef.current = null;
      setCallState({ phase: 'idle' });
    };
  }, [client]);

  // The reputation/badge layer matches peers against the group ids WE joined —
  // keep that set on the client in sync with the local membership list.
  useEffect(() => { if (client) client.myGroupGids = joinedGroupGids(joinedGroups); }, [client, joinedGroups]);

  // Consume a /g/<payload> from the web URL after the join sheet closes, so a
  // reload doesn't re-open it (mirrors the /i/<code> consume in resolveChatInvite).
  const clearGroupPath = React.useCallback(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if (!/\/g\/[A-Za-z0-9_-]+/.test(window.location.pathname)) return;
    try { window.history.replaceState(null, '', '/' + window.location.search); } catch { /* best-effort */ }
  }, []);

  // Opened invite links (web #hash now; native deep links via Linking). Handles
  // BOTH chat invites (/i/<code>) and group-import links (/g/<payload>).
  useEffect(() => {
    const handle = (url: string) => {
      const code = parseInviteLink(url);
      if (code) { setPendingInviteCode(code); return; }
      const payload = parseGroupLink(url);
      if (payload) { const inv = decodeGroupInvite(payload); if (inv) setResolvedGroup(inv); }
    };
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const onHash = () => handle(window.location.href);
      window.addEventListener('hashchange', onHash);
      return () => window.removeEventListener('hashchange', onHash);
    }
    Linking.getInitialURL().then((u) => { if (u) handle(u); }).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => handle(e.url));
    return () => sub.remove();
  }, []);

  // Resolve the code → inviter pubkey (relays do the lookup; the hash
  // commitment inside resolveChatInvite discards forged/hijacked codes).
  useEffect(() => {
    if (!client || !pendingInviteCode) return;
    let cancelled = false;
    client.resolveChatInvite(pendingInviteCode).then((r) => {
      if (cancelled) return;
      setPendingInviteCode(null);
      // Consume the invite from the URL so a reload doesn't re-open the sheet —
      // clear the legacy #invite= fragment and/or the /i/<code> path.
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const onInvitePath = /\/i\/[a-z2-7]{6,16}\b/.test(window.location.pathname);
        if (window.location.hash.includes('invite=') || onInvitePath) {
          const path = onInvitePath ? '/' : window.location.pathname;
          try { window.history.replaceState(null, '', path + window.location.search); } catch { /* best-effort */ }
        }
      }
      if (r) setResolvedInvite(r);
      else uiAlert(t('Invite not found'), t('This invite link has expired or was revoked.'));
    });
    return () => { cancelled = true; };
  }, [client, pendingInviteCode]);

  // The confirm back-flow / poke healer (auto-reply with our contact) — see hook.
  useContactHandshake(client, negos, profile, buildContactFor, resumeTick);

  // Zappability: publish our lightning address as kind:0 `lud16` so others'
  // clients can zap our posts (NIP-57). Resolved only while the Wallet tab is
  // open — the wallet boots there anyway; never at app start.
  useEffect(() => {
    if (tab !== 'wallet' || !experimentalWallet || !client) return;
    let cancelled = false;
    (async () => {
      try {
        const provider = await activeWalletProvider(walletNwcUrl);
        const la = await provider?.lightningAddress?.();
        // NWC fallback: its address() IS a lud16; Breez's is a Spark address.
        const fallback = !la ? await provider?.address?.() : null;
        const addr = la?.address ?? (fallback?.includes('@') ? fallback : null);
        if (cancelled || !addr || profile.lud16 === addr) return;
        const p = { ...profile, lud16: addr };
        setProfile(p);
        await saveProfile(p);
        client.publishProfile(p).catch(() => {});
      } catch { /* wallet not ready — retry next visit */ }
    })();
    return () => { cancelled = true; };
  }, [tab, experimentalWallet, walletNwcUrl, client]);

  // A pure passenger only posts ride requests and waits for drivers — Browse
  // (where you pick listings) is noise. Show it for drivers, or once the
  // Service/Product vertical is on. Switch away if the active tab vanishes.
  const showBrowse = role !== 'passenger' || servicesEnabled;
  // A pure rideshare Driver only browses/responds — they never post, so hide
  // Post for them. A Provider (Service/Product on) still posts offerings.
  const showPost = role !== 'driver' || servicesEnabled;
  // Drivers/providers live in Browse (pick listings) → put it first, before Post.
  const base: Tab[] = role === 'driver'
    ? ['browse', 'messages', 'post', 'settings']
    : ['post', 'messages', 'browse', 'settings'];
  const visibleTabs: Tab[] = base.filter(
    (t) => (t !== 'browse' || showBrowse) && (t !== 'post' || showPost),
  );
  // With BOTH features on, the wallet lives inside the Apps tab as a tile —
  // no separate bottom-bar slot (the wallet SCREEN still opens via setTab).
  const walletInApps = experimentalWallet && experimentalMiniApps;
  // Experimental wallet: its tab slots in directly left of Settings.
  if (experimentalWallet && !walletInApps) visibleTabs.splice(visibleTabs.indexOf('settings'), 0, 'wallet');
  // Mini-apps: a dedicated "Apps" tab, also just left of Settings.
  if (experimentalMiniApps) visibleTabs.splice(visibleTabs.indexOf('settings'), 0, 'apps');
  // Bottom-bar highlight: the wallet screen belongs to the Apps tab when the
  // wallet lives there (it has no bar slot of its own in that mode).
  const barTab: Tab = walletInApps && tab === 'wallet' ? 'apps' : tab;
  // Guided-tour steps per rideshare role (Customer/Provider get no tour). Each
  // step highlights a tab; a `wheel` step stays on Post and instead demos the
  // amount wheel. The passenger flow inserts a dedicated wheel/pricing step
  // right after the Post step.
  type TourStep = { tab: Tab; wheel?: boolean; completed?: boolean; final?: boolean; highlightProfile?: boolean; text: string };
  // Closing note shown to everyone: Freeport has no operator, so safety is a
  // shared responsibility. Inspiring sign-off rather than another tab pointer.
  const tourFinalStep: TourStep = { tab: 'settings', final: true, text: 'Freeport has no company in the middle. You are Freeport — and we rely on you to keep it safe. If someone’s details, like a licence plate or phone number, don’t match, don’t go through with the deal. Report them instead.' };
  const tourSteps: TourStep[] = role === 'driver'
    ? [
        { tab: 'browse', text: 'Tap here to find rides, negotiate, or accept a ride.' },
        { tab: 'messages', text: 'When you have a deal, tap here to chat, negotiate, or cancel the ride.' },
        { tab: 'messages', completed: true, text: 'Tap here to see your completed rides and rate karma scores.' },
        { tab: 'settings', highlightProfile: true, text: "Open Settings, then Profile to edit your details. Back up your identity so you don't lose your karma when you switch devices." },
        tourFinalStep,
      ]
    : [
        { tab: 'post', text: 'Tap here to book a ride. Unlike traditional ride-hailing, you set your own price (with an estimator) and negotiate with the driver. After booking, check back now and then — there are no push notifications.' },
        { tab: 'post', wheel: true, text: 'Set your price by spinning the wheel. Tap the amount to type it manually. Drag to 0 to let the driver offer a price.' },
        { tab: 'messages', text: 'When you have a deal, tap here to chat, negotiate, or cancel the ride.' },
        { tab: 'messages', completed: true, text: 'Tap here to see your completed rides and rate karma scores.' },
        { tab: 'settings', highlightProfile: true, text: "Open Settings, then Profile to edit your details. Back up your identity so you don't lose your karma when you switch devices." },
        tourFinalStep,
      ];
  const curTourStep: TourStep | null = tourStep != null ? tourSteps[tourStep] : null;
  // The tab currently being highlighted by the tour (null when the tour is idle
  // or on the final note, which highlights nothing).
  const tourTab: Tab | null = curTourStep && !curTourStep.final ? curTourStep.tab : null;
  // Advance the tour to a step: switch to that tab and move the glow.
  const goToTourStep = (n: number) => {
    setTourStep(n);
    const stp = tourSteps[n];
    setTab(stp.tab);
    // The Completed step highlights the Completed view; the plain Messages step
    // shows Active.
    if (stp.tab === 'messages') setMessagesView(stp.completed ? 'completed' : 'active');
    // The Profile-row glow is driven by the live tour step (see the
    // profileHighlight prop below), so nothing to trigger here.
  };
  // On the dedicated wheel/pricing step, demo the amount wheel (glow + slide
  // right → back to 0) once the Post tab has rendered the form + wheel.
  useEffect(() => {
    if (!curTourStep?.wheel) return;
    const h = setTimeout(() => triggerWheelDemo(), 500);
    return () => clearTimeout(h);
  }, [tourStep]);
  // Run the glow pulse only while the tour is active; stop the loop when it ends.
  const tourActive = tourStep != null;
  useEffect(() => {
    if (!tourActive) { tourGlow.setValue(0); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(tourGlow, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        Animated.timing(tourGlow, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [tourActive, tourGlow]);
  const roleText =
    role === 'passenger' ? (servicesEnabled ? t('Customer') : t('Passenger'))
    : role === 'driver' ? (servicesEnabled ? t('Provider') : t('Driver'))
    : '';
  // Monochrome vector icons (Ionicons), researched per role — not tied to the
  // old emoji: buyer = person/shopping-bag, driver = car, provider = storefront.
  const roleIcon: IoniconName =
    role === 'passenger' ? 'person-outline' // Customer (services on) uses the same icon as Passenger
    : role === 'driver' ? (servicesEnabled ? 'storefront-outline' : 'car-outline')
    : 'person-outline';
  useEffect(() => {
    if (tab === 'browse' && !showBrowse) setTab('post');
    else if (tab === 'post' && !showPost) setTab('browse');
  }, [tab, showBrowse, showPost]);

  // Auto-subscribe a freshly created/restored account to the default
  // notification server. Runs once, only after onboarding, when init has
  // produced the client (so the pubkey exists). Uses the prefs default
  // endpoint; empty filters = DM pings only. Denied/unreachable → silently
  // stays off, Settings still shows the manual toggle.
  useEffect(() => {
    if (!client || !autoPushPending.current) return;
    autoPushPending.current = false;
    (async () => {
      try {
        if (!pushSupported()) return;
        const prefs = await loadPrefs();
        const endpoint = (prefs.notifyEndpoint || '').trim();
        if (endpoint) await enablePush(client.pubkey, endpoint);
      } catch { /* best-effort: user can enable in Settings */ }
    })();
  }, [client]);

  const finishOnboarding = () => {
    setOnboarding(false);
    autoPushPending.current = true; // subscribe to the default notifier once init yields a client
    setInitVersion((v) => v + 1); // re-run init now that a key exists
    pendingGlowId.current = null; // onboarding has no rating panel to glow
    setShowFireworks(true); // celebrate joining (fireworks play over the main UI)
    // First run only, and only for rideshare Passenger/Driver (not Customer/
    // Provider): kick off the guided coach-mark tour. Delay ~600ms so the first
    // card doesn't visually fight the fireworks burst. The fireworks overlay is
    // pointerEvents:none, so it never blocks the tour's Next/Skip buttons.
    if (!guidanceSeen.current && !servicesEnabled && (role === 'passenger' || role === 'driver')) {
      if (tourTimer.current) clearTimeout(tourTimer.current);
      tourTimer.current = setTimeout(() => { goToTourStep(0); }, 600);
    }
  };

  // Passkey sign-in tail (manual button or the Welcome auto-prompt): store
  // the derived key, pull settings back from the relay sync, enter the app.
  const completePasskeySignIn = async (sk: Uint8Array) => {
    await restoreBackupText(nsecEncode(sk), ''); // same path as a bare-nsec restore
    try { await restoreSettingsSync(sk); } catch { /* fresh account */ }
    await savePrefs({ backupDone: true }).catch(() => {}); // the passkey IS the backup
    finishOnboarding();
  };

  // First launch: choose to create a new account or restore from a backup file.
  if (onboarding) {
    return (
      <View nativeID="freeport-shell" style={s.appShell}>
        <SafeAreaView style={s.root} edges={['top','left','right']}>
          <StatusBar style={effectiveTheme === 'light' ? 'dark' : 'light'} />
          <Onboarding
            onCreate={async (chosenRole, chosenServices, name, phone, vehicleModel, plateNumber) => {
              // The passkey flow stores the derived key BEFORE this step —
              // reuse it instead of minting a fresh one.
              const sk = (await loadKey()) ?? (await createKey());
              // The chooser decides the lane: Customer/Provider start with the
              // Service/Product UI on; Passenger/Driver start rideshare-only. Set it
              // explicitly so a prior account's state on this device doesn't carry over.
              setServicesEnabled(chosenServices);
              await savePrefs({ role: chosenRole, servicesEnabled: chosenServices }); // merge-save keeps other fields
              setRole(chosenRole);
              // Persist the profile entered at onboarding; phone defaults to masked.
              const norm = normalizePhone(phone.trim());
              const prof: UserProfile = {
                // Generate a unique avatar from the new key so the account isn't blank.
                name: name.trim(), picture: defaultAvatarUrl(npubOf(sk)), about: '', gallery: [],
                phone: norm.valid ? norm.e164 : phone.trim(), phoneDisplay: 'full', link: '',
                vehicleModel, plateNumber, plateDisplay: 'masked',
              };
              await saveProfile(prof);
              setProfile(prof);
              // Fire-and-forget: back the fresh key up to the user's cloud
              // (iCloud Keychain / Google Block Store) so a new device restores it
              // automatically. Don't block the UI; ignore errors.
              if (cloudAvailable()) {
                (async () => {
                  const k = await loadKey();
                  if (k && await cloudSave(await buildCloudBundle(k))) await savePrefs({ backupDone: true });
                })().catch(() => {});
              }
            }}
            onFinish={finishOnboarding}
            onRestore={async (text, passphrase) => {
              const sk = await restoreBackupText(text, passphrase); // throws on bad file/passphrase
              // Old backups can predate the avatar — pull what the network
              // already knows for any field the bundle left empty.
              try { await fillMissingProfileFromRelays(sk); } catch { /* offline — local copy stands */ }
              await savePrefs({ backupDone: true }).catch(() => {}); // restored FROM a backup — one exists
              finishOnboarding();
            }}
            onPasskeyCreate={async () => {
              const sk = await createPasskeyIdentity(t('Freeport account'));
              await restoreNsec(nsecEncode(sk)); // store; onCreate reuses it
              await savePrefs({ backupDone: true }).catch(() => {}); // the passkey IS the backup
            }}
            onPasskeySignIn={async () => {
              await completePasskeySignIn(await signInWithPasskey());
            }}
            onPasskeyAutoSignIn={completePasskeySignIn}
            onCloudRestore={async () => {
              const data = await cloudRestore();
              if (!data) return false; // no backup found
              const sk = await restoreFromBundleText(data); // restores key + settings + saved addresses
              try { await fillMissingProfileFromRelays(sk); } catch { /* offline — local copy stands */ }
              await savePrefs({ backupDone: true }).catch(() => {}); // restored FROM the cloud backup
              finishOnboarding();
              return true;
            }}
            language={language}
            onLanguageChange={changeLanguage}
            location={location}
            onLocationChange={(loc) => {
              setLocation(loc);
              savePrefs({ location: loc, locationManual: true }).catch(() => {});
            }}
          />
        </SafeAreaView>
        {showFireworks && <Fireworks onDone={onFireworksDone} />}
      </View>
    );
  }

  return (
    <View nativeID="freeport-shell" style={s.appShell}>
    <SafeAreaView style={s.root} edges={['top','left','right']}>
      <StatusBar style={effectiveTheme === 'light' ? 'dark' : 'light'} />
      {/* Web: a newer deploy is live — prompt the user to reload into it. */}
      <Modal visible={webUpdate.available} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={s.sortBackdrop}>
          <View style={s.sortSheet}>
            <Text style={s.sectionTitle}>{t('Update is available')}</Text>
            <Text style={s.dim}>{t('A new version of Freeport is ready. Update now to get the latest features and fixes.')}</Text>
            <Pressable style={[s.btnAccept, { marginTop: 16 }]} onPress={() => webUpdate.apply()}>
              <Text style={s.btnText}>{t('Update')}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Animated.View style={[s.titleBar, { paddingTop: anim.titlePadT, paddingBottom: anim.titlePadB }]}>
        <Animated.Image source={require('./assets/favicon.png')} style={{ width: anim.logo, height: anim.logo, borderRadius: anim.logoR }} />
        <View style={s.headerTitleWrap}>
          <Animated.Text style={[s.header, { fontSize: anim.titleFont }]} numberOfLines={1}>Freeport</Animated.Text>
          <View style={s.headerStatus}>
            <StatusDot
              blink={updating}
              pulsing={!(netStatus === 'online' && netSteady) || outboxPending > 0}
              color={updating || outboxPending > 0 ? palette.warn : netStatus === 'online' ? palette.success : netStatus === 'offline' ? palette.danger : palette.warn}
            />
            <Animated.Text
              style={[s.headerSub, { opacity: anim.subOpacity, maxWidth: anim.subWidth, flexShrink: 0, overflow: 'hidden' }]}
              numberOfLines={1}
            >{updating ? t('Updating…')
              : outboxPending > 0 ? t('Sending {n}…').replace('{n}', String(outboxPending))
              : netStatus === 'online' ? t('Connected')
              : netStatus === 'offline' ? t('No network') : t('Connecting…')}</Animated.Text>
            {location.country ? (
              <Text style={s.headerFlag} numberOfLines={1}>{flagEmoji(location.country)}</Text>
            ) : null}
          </View>
        </View>
        {roleText ? (
          <Pressable style={s.headerRoleWrap} onPress={() => setTab('settings')} hitSlop={8}>
            <Ionicons name={roleIcon} size={16} color={palette.text2} />
            <Text style={s.headerRoleText}>{roleText}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
      {tab === 'browse' && <MarketTab intents={intents} client={client} netStatus={netStatus} servicesEnabled={servicesEnabled} location={location} myContact={(i) => buildContact(i, true)} doneListingKeys={doneListingKeys} distanceUnitPref={distanceUnit} defaultCategory={browseCategory} defaultSubcategory={browseSubcategory} maxDistance={browseMaxDistance} onScroll={onContentScroll} walletEnabled={experimentalWallet} onZap={(i) => setZapTarget(i)} products={products} shopMarket={SERVICE_MARKET} shopCurrency={defaultCurrency} onChatSeller={(pubkey) => {
        // Conversational checkout: a chat request to the seller. Implies the
        // Chat experiment (same consent model as opening an invite link).
        client?.chatInvite(pubkey, profile.name || undefined).catch(() => {});
        setMessagesView('active');
        setTab('messages');
      }} />}
      {tab === 'post' && <PostTab draft={postDraft} onDraftConsumed={() => setPostDraft(null)} client={client} profile={profile} myIntents={myIntents} negos={negos} servicesEnabled={servicesEnabled} defaultCurrency={defaultCurrency} location={location} role={role} browseCategory={browseCategory} browseSubcategory={browseSubcategory} onScroll={onContentScroll} />}
      {tab === 'messages' && <DealsTab client={client} negos={negos} setNegos={setNegos} profile={profile} onScroll={onContentScroll} view={messagesView} onViewChange={setMessagesView} expiredNotices={expiredNotices} onDismissExpired={dismissExpired} glowDealId={glowDealId} glowCompleted={curTourStep?.completed === true} role={role} country={location.country} walletEnabled={experimentalWallet} onRepost={(n) => { setPostDraft(repostDraft(n.intent)); setTab('post'); }} onPayDeal={(n) => { const f = dealFiat(n.terms?.payment, n.intent.content.market, location.country); setWalletPrefill({ mode: 'send', dest: n.theirPayAddress ?? '', hint: n.terms?.payment, fiatAmount: f?.amount, fiatCurrency: f?.currency }); setTab('wallet'); }} onReceiveDeal={(n) => { const f = dealFiat(n.terms?.payment, n.intent.content.market, location.country); setWalletPrefill({ mode: 'receive', fiatAmount: f?.amount, fiatCurrency: f?.currency, memo: 'Freeport deal' }); setTab('wallet'); }} sendLocationOnDeal={sendLocationOnDeal} customMessage={customMessage} blockedPubkeys={blocked} onToggleBlock={toggleBlock} chatEnabled={experimentalChat} conversations={conversations} chatReceiptsOn={chatReceipts} onStartCall={chatCallsEnabled && callsSupported() ? (peer, video) => callManagerRef.current?.startCall(peer, video) : undefined} onPayFriend={(peer, payAddress) => { setWalletPrefill({ mode: 'send', dest: payAddress }); setTab('wallet'); }} escrows={escrows} onPayEscrowInvoice={(invoice) => { setWalletPrefill({ mode: 'send', dest: invoice, memo: 'Escrow' }); setTab('wallet'); }} onAcceptChatInvite={(peer) => {
        // Same consent model as opening an invite link: answering YES to a
        // chat request implies wanting the feature.
        client?.chatAccept(peer, profile.name || undefined).catch(() => {});
      }} chatTranslateTo={chatTranslate && translateToggleVisible(experimentalLlm) ? (language || systemLanguage()) : undefined} />}
      {tab === 'wallet' && (
        <WalletTab
          unit={walletUnit}
          onUnitChange={(u) => { setWalletUnit(u); savePrefs({ walletUnit: u }).catch(() => {}); }}
          localCurrency={currencyForCountry(location.country)}
          contacts={walletContacts(negos)}
          prefill={walletPrefill}
          onPrefillConsumed={() => setWalletPrefill(null)}
          nwcUrl={walletNwcUrl}
          onNwcUrlChange={(url) => {
            setWalletNwcUrl(url);
            savePrefs({ walletNwcUrl: url }).catch(() => {});
          }}
          onScroll={onContentScroll}
        />
      )}
      {tab === 'apps' && (
        <AppsTab
          signerRef={signerRef}
          walletEnabled={experimentalWallet}
          walletNwcUrl={walletNwcUrl}
          onOpenWallet={walletInApps ? () => setTab('wallet') : null}
          onScroll={onContentScroll}
        />
      )}
      {tab === 'settings' && (
        <SettingsTab
          npub={npub}
          signerRef={signerRef}
          profile={profile}
          client={client}
          onOpenFeedback={() => { setMessagesView('completed'); setTab('messages'); }}
          onReplayTour={() => goToTourStep(0)}
          experimentalWallet={experimentalWallet}
          onExperimentalWalletChange={(v) => {
            setExperimentalWallet(v);
            savePrefs({ experimentalWallet: v }).catch(() => {});
          }}
          experimentalChat={experimentalChat}
          chatShowLastSeen={chatShowLastSeen}
          onChatShowLastSeenChange={(v) => {
            setChatShowLastSeen(v);
            savePrefs({ chatShowLastSeen: v }).catch(() => {});
          }}
          chatReceipts={chatReceipts}
          onChatReceiptsChange={(v) => {
            setChatReceipts(v);
            savePrefs({ chatReceipts: v }).catch(() => {});
          }}
          chatCallsEnabled={chatCallsEnabled}
          onChatCallsEnabledChange={(v) => {
            setChatCallsEnabled(v);
            savePrefs({ chatCallsEnabled: v }).catch(() => {});
          }}
          chatCallsTurn={chatCallsTurn}
          onChatCallsTurnChange={(v) => {
            setChatCallsTurn(v);
            savePrefs({ chatCallsTurn: v }).catch(() => {});
          }}
          chatTranslate={chatTranslate}
          onChatTranslateChange={(v) => {
            setChatTranslate(v);
            savePrefs({ chatTranslate: v }).catch(() => {});
          }}
          experimentalLlm={experimentalLlm}
          onExperimentalLlmChange={(v) => {
            setExperimentalLlm(v);
            savePrefs({ experimentalLlm: v }).catch(() => {});
          }}
          experimentalMiniApps={experimentalMiniApps}
          onExperimentalMiniAppsChange={(v) => {
            setExperimentalMiniApps(v);
            savePrefs({ experimentalMiniApps: v }).catch(() => {});
          }}
          requiredLocOk={locOk}
          requiredNotifOk={notifSatisfied}
          openBackupSignal={openBackupSignal}
          profileHighlight={curTourStep?.highlightProfile === true}
          onBackupDone={() => setBackupBanner(false)}
          onDismissNotif={dismissNotif}
          onRequiredRefresh={refreshRequired}
          onProfileChange={async (p) => {
            setProfile(p);
            await saveProfile(p);
            client?.publishProfile(p).catch(() => {});
          }}
          onRestore={() => {
            resetIntents();
            setNegos([]);
            setConversations([]);
            setProducts([]);
            setClient(null);
            setInitVersion((v) => v + 1);
          }}
          servicesEnabled={servicesEnabled}
          onServicesEnabledChange={(v) => {
            setServicesEnabled(v);
            savePrefs({ servicesEnabled: v, location, useNip07, theme }).catch(() => {});
          }}
          location={location}
          onLocationChange={(loc) => {
            setLocation(loc);
            savePrefs({ servicesEnabled, location: loc, locationManual: true, useNip07, theme }).catch(() => {});
          }}
          useNip07={useNip07}
          onUseNip07Change={(v) => {
            setUseNip07(v);
            savePrefs({ servicesEnabled, location, useNip07: v, theme }).catch(() => {});
            // Re-initialise with the new signer
            resetIntents(); setNegos([]); setClient(null); setInitVersion((x) => x + 1);
          }}
          theme={theme}
          onThemeChange={(t) => {
            setThemeState(t); // effective-theme resolver swaps the palette + re-renders
            savePrefs({ theme: t }).catch(() => {});
          }}
          distanceUnit={distanceUnit}
          onDistanceUnitChange={(u) => {
            setDistanceUnit(u);
            savePrefs({ distanceUnit: u }).catch(() => {});
          }}
          sendLocationOnDeal={sendLocationOnDeal}
          onSendLocationOnDealChange={(v) => {
            setSendLocationOnDeal(v);
            savePrefs({ sendLocationOnDeal: v }).catch(() => {});
          }}
          customMessage={customMessage}
          onCustomMessageChange={(v) => {
            setCustomMessage(v);
            savePrefs({ customMessage: v }).catch(() => {});
          }}
          autoSendCustomMessage={autoSendCustomMessage}
          onAutoSendCustomMessageChange={(v) => {
            setAutoSendCustomMessage(v);
            savePrefs({ autoSendCustomMessage: v }).catch(() => {});
          }}
          telemetryEnabled={telemetryOn}
          onTelemetryChange={(v) => {
            setTelemetryOn(v);
            setTelemetryEnabled(v);
            savePrefs({ telemetryEnabled: v }).catch(() => {});
          }}
          browseCategory={browseCategory}
          browseSubcategory={browseSubcategory}
          browseAlertSound={browseAlertSound}
          browseAlertNotify={browseAlertNotify}
          browseMaxDistance={browseMaxDistance}
          onBrowsePrefChange={(p) => {
            if (p.browseCategory !== undefined) setBrowseCategory(p.browseCategory);
            if (p.browseSubcategory !== undefined) setBrowseSubcategory(p.browseSubcategory);
            if (p.browseAlertSound !== undefined) setBrowseAlertSound(p.browseAlertSound);
            if (p.browseAlertNotify !== undefined) setBrowseAlertNotify(p.browseAlertNotify);
            if (p.browseMaxDistance !== undefined) setBrowseMaxDistance(p.browseMaxDistance);
            savePrefs(p).catch(() => {});
          }}
          joinedGroups={joinedGroups}
          onCreateGroupInvite={() => setShowGroupInvite(true)}
          onOpenGroupMembers={(g) => setGroupMembersFor(g)}
          role={role}
          onRoleChange={(r) => {
            setRole(r);
            savePrefs({ role: r }).catch(() => {});
          }}
          language={language}
          onLanguageChange={changeLanguage}
          fareConfig={fareConfig}
          fareDefaults={defaultFareConfig(defaultCurrency, location.country)}
          fareCurrency={defaultCurrency}
          onFareConfigChange={(cfg) => {
            setFareConfigState(cfg);
            setFareConfig(cfg); // live: estimator uses it immediately
            savePrefs({ fareConfig: cfg }).catch(() => {});
          }}
          onSignOut={async () => {
            // Erase the identity and return to the create/restore screen.
            await clearKey();
            await MobileClient.clearStoredNegotiations(); // don't leak deals to the next account
            // Clear per-account System-notice state so the next account starts clean.
            await Promise.all([kvSet('freeport.expiredLog', '[]'), kvSet('freeport.expiredSeen', '[]'), kvSet('freeport.rated', '[]'), kvSet('freeport.ratingSkipped', '[]')]).catch(() => {});
            setExpiredLog([]); setExpiredSeen(new Set());
            // Reset custom fare coefficients so the next account starts on defaults.
            setFareConfig(null); setFareConfigState(null);
            // Reset the backup-reminder state too: the NEXT account on this
            // device starts un-backed-up and must be nagged afresh.
            await savePrefs({ role: '', fareConfig: null, backupDone: false, backupReminderDismissedAt: 0, ...(useNip07 ? { useNip07: false } : {}) }).catch(() => {});
            const empty: UserProfile = { name: '', picture: '', about: '', gallery: [], phone: '', phoneDisplay: 'full', link: '', vehicleModel: '', plateNumber: '', plateDisplay: 'masked' };
            await saveProfile(empty).catch(() => {});
            if (useNip07) setUseNip07(false);
            setRole('');
            setProfile(empty);
            setNpub('');
            resetIntents(); setNegos([]); setMyIntents([]); setConversations([]); setEscrows([]);
            setClient(null);
            signerRef.current = null;
            setTab('post');
            setOnboarding(true);
          }}
          onDeleteAccount={async () => {
            // Permanent account deletion. Best-effort NETWORK cleanup first (needs
            // the key): withdraw my live posts and blank my public profile so
            // others stop seeing me, then remove off-device copies.
            try {
              if (client) {
                for (const i of myIntents) { try { await client.withdrawIntent(i); } catch {} }
                const blank: UserProfile = { name: '', picture: '', about: '', gallery: [], phone: '', phoneDisplay: 'full', link: '', vehicleModel: '', plateNumber: '', plateDisplay: 'masked' };
                try { await client.publishProfile(blank); } catch {}
              }
            } catch {}
            try { await cloudClear(); } catch {}                       // delete cloud backup of the key
            try { const p = await loadPrefs(); await disablePush(client?.pubkey ?? '', (p.notifyEndpoint || '').trim()); } catch {} // unsubscribe push
            await kvSet('freeport.pushOn', '0').catch(() => {});
            // Erase EVERYTHING on this device (key, profile, settings, posts, deals…).
            await wipeAllLocalData();
            resetMiniAppFirewall(); // drop in-memory mini-app grants with the store
            setFareConfig(null); setFareConfigState(null);
            if (useNip07) setUseNip07(false);
            const empty: UserProfile = { name: '', picture: '', about: '', gallery: [], phone: '', phoneDisplay: 'full', link: '', vehicleModel: '', plateNumber: '', plateDisplay: 'masked' };
            setRole(''); setProfile(empty); setNpub('');
            resetIntents(); setNegos([]); setMyIntents([]); setConversations([]);
            setExpiredLog([]); setExpiredSeen(new Set());
            setClient(null); signerRef.current = null;
            setTab('post'); setOnboarding(true);
          }}
          onScroll={onContentScroll}
        />
      )}
      {callState.phase !== 'idle' && (() => {
        const peer = callState.peer ?? '';
        const conv = conversations.find((c) => c.peer === peer);
        const name = conv ? chatDisplayName(conv, client) : (client?.profiles.get(peer)?.name || peer.slice(0, 12));
        const avatar = client?.profiles.get(peer)?.picture || (peer ? peerAvatarUrl(npubFromHex(peer)) : undefined);
        const mgr = callManagerRef.current;
        return (
          <CallOverlay
            state={callState}
            localStream={callStreams.local}
            remoteStream={callStreams.remote}
            peerName={name}
            peerAvatar={avatar}
            onAccept={() => mgr?.acceptCall()}
            onDecline={() => mgr?.declineCall()}
            onHangup={() => mgr?.hangup()}
            onToggleMute={() => mgr?.toggleMute()}
            onToggleCamera={() => mgr?.toggleCamera()}
            onToggleScreenShare={() => mgr?.toggleScreenShare()}
            onDismiss={() => mgr?.dismissEnded()}
          />
        );
      })()}
      {zapTarget && (
        <ZapSheet
          client={client}
          signer={signerRef.current}
          lud16={client?.profiles.get(zapTarget.pubkey)?.lud16 ?? ''}
          toPubkey={zapTarget.pubkey}
          eventId={zapTarget.id}
          onInvoice={(pr) => {
            setZapTarget(null);
            setWalletPrefill({ mode: 'send', dest: pr, memo: 'Zap' });
            setTab('wallet');
          }}
          onClose={() => setZapTarget(null)}
        />
      )}
      {showConcierge && (
        <ConciergeSheet
          ctx={{ servicesEnabled, defaultCurrency }}
          lang={language || systemLanguage()}
          onDraft={(draft) => {
            setShowConcierge(false);
            setPostDraft(draft); // PostTab prefills exactly like a Repost
            setTab('post');
          }}
          onClose={() => setShowConcierge(false)}
        />
      )}
      {/* Concierge entry: a sparkle FAB on the Post tab, only when the
          on-device model is actually available (probe + Apple Intelligence). */}
      {experimentalLlm && conciergeOk && tab === 'post' && (
        <DraggableFab
          storageKey="concierge"
          onPress={() => setShowConcierge(true)}
          accessibilityLabel={t('Describe what you need')}
          anchor={{ end: 18, bottom: insets.bottom + 76 }}
          style={{
            width: 50, height: 50, borderRadius: 25,
            backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center',
            shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 6,
          }}
        >
          <Ionicons name="sparkles" size={24} color="white" />
        </DraggableFab>
      )}
      {resolvedInvite && (
        <InviteResolvedSheet
          client={client}
          invite={resolvedInvite}
          myName={profile.name || undefined}
          onDone={(sent) => {
            setResolvedInvite(null);
            if (!sent) return;
            // Sending an invite implies the user wants the feature.
            setMessagesView('active');
            setTab('messages');
          }}
        />
      )}
      {/* Group import: admin "Create group invite" sheet. */}
      {showGroupInvite && (
        <GroupInviteSheet client={client} onClose={() => setShowGroupInvite(false)} />
      )}
      {/* Group import: admin members list + one-tap vouch. */}
      {groupMembersFor && (
        <GroupMembersSheet client={client} group={groupMembersFor} onClose={() => setGroupMembersFor(null)} />
      )}
      {/* Group import: member join screen (from an opened /g/<payload> link). */}
      {resolvedGroup && (
        <GroupJoinSheet
          client={client}
          invite={resolvedGroup}
          onClose={() => {
            setResolvedGroup(null);
            clearGroupPath();
          }}
          onJoin={async (invite) => {
            const d = invite.descriptor;
            // (b) configure Browse to the group's market — live + persisted.
            const patch = groupPrefsPatch(d);
            if (patch.servicesEnabled !== undefined) setServicesEnabled(patch.servicesEnabled);
            if (patch.browseCategory !== undefined) setBrowseCategory(patch.browseCategory);
            if (patch.browseSubcategory !== undefined) setBrowseSubcategory(patch.browseSubcategory);
            await savePrefs(patch);
            // (c) record membership locally.
            const group: JoinedGroup = {
              gid: invite.gid,
              name: d.name,
              admin: invite.admin,
              category: d.category,
              subcategory: d.subcategory,
              topics: d.topics,
              joinedAt: Date.now(),
            };
            const next = await recordGroupJoin(group);
            setJoinedGroups(next);
            if (client) client.myGroupGids = joinedGroupGids(next);
            // (a) publish the signed join attestation (trust seeding).
            client?.publishGroupJoin(invite).catch(() => {});
            setResolvedGroup(null);
            clearGroupPath();
            setTab('browse');
          }}
        />
      )}
      {/* Key-backup reminder: slim, dismissable, sits just above the tab bar.
          Tapping it opens Settings with the Account & Backup section expanded. */}
      {backupBanner && (
        <Pressable
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.warnBg, borderTopWidth: 1, borderTopColor: palette.border, paddingHorizontal: 14, paddingVertical: 9 }}
          onPress={() => { setOpenBackupSignal((n) => n + 1); setTab('settings'); }}
          accessibilityRole="button"
          accessibilityLabel={t('Back up your account — without it, losing this device loses your identity')}
        >
          <Ionicons name="key-outline" size={16} color={palette.warn} />
          <Text style={{ color: palette.warn, fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={2}>
            {t('Back up your account — without it, losing this device loses your identity')}
          </Text>
          <Pressable onPress={dismissBackupBanner} hitSlop={10} accessibilityLabel={t('Dismiss')}>
            <Ionicons name="close" size={16} color={palette.warn} />
          </Pressable>
        </Pressable>
      )}
      <View style={[s.tabbar, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
        {visibleTabs.map((tk) => {
          const tabName = t(tk === 'post' && role === 'passenger' ? 'Request' : tk === 'browse' ? 'Browse' : tk === 'messages' ? 'Messages' : tk === 'settings' ? 'Settings' : tk === 'wallet' ? 'Wallet' : tk === 'apps' ? 'Apps' : 'Post');
          const badge = tk === 'messages' ? pendingCount : tk === 'settings' ? requiredCount : 0;
          return (
          <Pressable
            key={tk}
            onPress={() => (tk === 'messages' ? openMessages() : setTab(tk))}
            style={[s.tab, barTab === tk && s.tabActive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: barTab === tk }}
            accessibilityLabel={badge > 0 ? t('{name}, {n} new', { name: tabName, n: badge }) : tabName}
          >
            <Animated.View style={{ alignSelf: 'stretch', alignItems: 'center', paddingVertical: anim.tabPad }}>
              <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                {tourTab === tk && (
                  <Animated.View
                    pointerEvents="none"
                    style={{
                      position: 'absolute', width: 40, height: 40, borderRadius: 20,
                      backgroundColor: palette.accent,
                      opacity: tourGlow.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.4] }),
                      transform: [{ scale: tourGlow.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.25] }) }],
                    }}
                  />
                )}
                <Ionicons
                  name={TAB_ICONS[tk][barTab === tk ? 1 : 0]}
                  size={20}
                  color={barTab === tk ? palette.accent : palette.dim}
                />
                {tk === 'messages' && pendingCount > 0 && (
                  <View style={s.badge}><Text style={s.badgeText}>{pendingCount}</Text></View>
                )}
                {tk === 'settings' && requiredCount > 0 && (
                  <View style={s.badge}><Text style={s.badgeText}>{requiredCount}</Text></View>
                )}
              </View>
              <Animated.View style={{ height: anim.labelH, opacity: anim.labelOpacity, overflow: 'hidden', justifyContent: 'center' }}>
                <Text style={[s.tabText, barTab === tk && s.tabTextActive]}>{tabName}</Text>
              </Animated.View>
            </Animated.View>
          </Pressable>
          );
        })}
      </View>
      {curTourStep && tourStep != null && curTourStep.final && (
        <View style={s.tourFinalBackdrop} pointerEvents="auto">
          <View style={s.tourFinalCard}>
            <Image source={require('./assets/favicon.png')} style={s.tourFinalLogo} />
            <View style={s.tourFinalHead}>
              <Ionicons name="heart" size={15} color={palette.accent} />
              <Text style={s.tourFinalKicker}>{t('A friendly reminder')}</Text>
            </View>
            <Text style={s.tourFinalBody}>{t(curTourStep.text)}</Text>
            <Text style={s.tourFinalWelcome}>{t('Welcome to Freeport.')}</Text>
            <Pressable style={s.tourFinalBtn} onPress={endTour}>
              <Text style={s.tourFinalBtnText}>{t("Let's go")}</Text>
            </Pressable>
          </View>
        </View>
      )}
      {curTourStep && tourStep != null && !curTourStep.final && (
        <View
          pointerEvents="box-none"
          style={[s.tourOverlay,
            // Place the card near what it points at: just under the Active/
            // Archived toggle for the Completed step (which sits below the root
            // keyword-filter input — ~46px — so the card clears it), high for the
            // wheel step (so the wheel below stays visible), otherwise above the
            // bottom tab bar.
            curTourStep.completed ? { top: insets.top + 154 }
              : curTourStep.wheel ? { top: insets.top + 56 }
              : { bottom: insets.bottom + 72 }]}
        >
          <View style={s.tourCard}>
            <View style={s.tourCardHead}>
              <Ionicons name="sparkles" size={16} color={palette.accent} />
              <Text style={s.tourStepIndicator}>{`${tourStep + 1}/${tourSteps.length}`}</Text>
            </View>
            <Text style={s.tourText}>{t(curTourStep.text)}</Text>
            <View style={s.tourBtnRow}>
              <Pressable onPress={endTour} hitSlop={8}>
                <Text style={s.tourSkip}>{t('Skip')}</Text>
              </Pressable>
              <Pressable
                style={s.tourNextBtn}
                onPress={() => {
                  if (tourStep + 1 >= tourSteps.length) endTour();
                  else goToTourStep(tourStep + 1);
                }}
              >
                <Text style={s.tourNextText}>{t(tourStep + 1 >= tourSteps.length ? 'Done' : 'Next')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
    {showFireworks && <Fireworks onDone={onFireworksDone} />}
    </View>
  );
}

