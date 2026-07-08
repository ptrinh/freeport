/**
 * Freeport — P2P marketplace client.
 * Tabs: Market · Post · Deals · Key
 */
import React, { useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Easing,
  FlatList,
  findNodeHandle,
  Image,
  KeyboardAvoidingView,
  PanResponder,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AreaMap, PickerMap } from './src/Map';
import { t, tn, setI18nLang, getI18nLang, ensureI18nLang, onI18nLoaded } from './src/i18n';
import { TimeSpinner } from './src/TimeSpinner';
import { Picker } from '@react-native-picker/picker';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { StatusBar } from 'expo-status-bar';
import {
  DEMO_MARKET,
  DEMO_SCHEMA,
  SERVICE_MARKET,
  SERVICE_SCHEMA,
  KIND_KARMA,
  geohashPrefixes,
  MSG_COUNTER,
  MSG_ACCEPT,
  MSG_CHAT,
  type Intent,
  type Negotiation,
  type ProposedTerms,
} from '@freeport/protocol';
import { loadKey, createKey, clearKey, wipeAllLocalData, npubFromHex, npubOf, getStoredNsec, bundleNeedsPassphrase } from './src/identity';
import { backupToFile, pickBackupText, restoreBackupText, buildCloudBundle, restoreFromBundleText } from './src/backup';
import { cloudAvailable, cloudSave, cloudRestore, cloudClear, cloudName } from './src/cloudBackup';
import { LocalSigner, Nip07Signer, hasNip07, type Signer } from './src/signer';
import { karmaLabel, type KarmaScore } from './src/karma';
import { query } from './src/query';
import { fetchReputation } from './src/reputation';
import { kvGet, kvSet } from './src/kv';
import { MobileClient } from './src/client';
import { wheelTick, eventAlert } from './src/haptics';
import { onWheelDemo, triggerWheelDemo } from './src/wheelDemo';
import { Fireworks } from './src/Fireworks';
import { installDebugApi, registerDebugClient } from './src/debug';
import { initNotifications, notify, notificationGranted, requestNotifications, onNotificationTap } from './src/notify';
import { beginBackgroundTask, endBackgroundTask } from './src/backgroundTask';
import { uploadImage, uploadFile, UploadError } from './src/upload';
import { startRecording, stopRecording, playAudio } from './src/voice';
import { loadAddressBook, addRecent, togglePinned, isPinned, type AddressBook } from './src/addressbook';
import { loadProfile, saveProfile, maskPhone, maskPlate, isDisplayablePhone, defaultAvatarUrl, type UserProfile, type PhoneDisplay } from './src/profile';
import { normalizePhone, detectDialCode, dialForCountry } from './src/phone';
import { routeUrl, placeUrl, placeParam, dirUrl, appleMapsScheme, geohashForPlace, geohashToCoords, coordsToGeohash, getCurrentCoords, forwardGeocode, locationGranted, requestLocationPermission, reverseGeocode, detectRawLocationGPS, detectRawLocationIP, detectCoordsIP, distanceKmBetweenGeohashes, formatDistance, suggest } from './src/maps';
import { parseAmountWithK } from './src/money';
import { negoIsDone, messagesViewForNewActivity, searchableText } from './src/deals';
import { initTelemetry, setTelemetryEnabled, trackEvent } from './src/telemetry';
import { loadPrefs, savePrefs, type Prefs, type UserLocation } from './src/prefs';
import { LANGUAGE_CODES, languageLabel, systemLanguage, systemCountry } from './src/language';
import { SERVICE_CATEGORIES, SERVICE_SUBCATEGORIES, RIDESHARE_CATEGORY, RIDESHARE_SUBCATEGORIES, DEFAULT_RIDESHARE_SUBCATEGORY, VEHICLE_ICONS, VEHICLE_SEATERS, CATEGORY_ICONS, SUBCATEGORY_ICONS, categoryIcon, subcategoryIcon, categoryOf, subcategoryOf, subcategoriesFor } from './src/categories';
import { intentTopics, browseTopic } from './src/topics';
import { applySideBackdrop } from './src/sideBackdrop';
import { suggestPrice, estimateFare, setFareConfig, defaultFareConfig, type PriceSuggestion, type FareConfig } from './src/pricing';
import { pushSupported, enablePush, updatePush, disablePush, pushStatus, type PushStatus, type PushFilters } from './src/push';
import { pushUnavailableForOnboarding } from './src/pushAvailability';
import { scrollNodeIntoView, type ScrollableNode } from './src/scrollToNode';
import { requestTelegramLink, telegramLinkStatus } from './src/telegramLink';
import { createTripSession, tripLink, tripSecret, restoreTripSession, decodeTripHash, publishTripLocation, subscribeTrip, type TripStatic, type TripSession, type TripView, type TripUpdate } from './src/livetrip';
import { webBase } from './src/webBase';
import { versionLabel, checkForUpdate, applyUpdate, useUpdateState, getTrack, applyTrack, setTrack, trackSupported, reloadApp, type UpdateTrack } from './src/updates';
import { initLayoutDirection, applyLayoutDirection, dirIcon } from './src/rtl';
import { useWebUpdateAvailable } from './src/webUpdate';
import { SimplePool } from 'nostr-tools/pool';
import { getPow } from 'nostr-tools/nip13';
import { COUNTRIES, statesOf, citiesOf, currencyForCountry, currencyFractionDigits, currencySymbol, fmtMoney, matchLocation, levelsOf, flagEmoji, searchLocations, type Currency } from './src/locations';

// Country codes sorted A–Z by name, plus a code→name lookup, for the Location picker.
const COUNTRY_CODES_AZ: string[] = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.code);
const COUNTRY_NAME: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name]));

type Tab = 'post' | 'messages' | 'browse' | 'settings';
type PostType = 'rideshare' | 'service';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
// [inactive (outline), active (filled)] per tab
const TAB_ICONS: Record<Tab, [IoniconName, IoniconName]> = {
  post: ['add-circle-outline', 'add-circle'],
  messages: ['chatbubbles-outline', 'chatbubbles'],
  browse: ['compass-outline', 'compass'],
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

// iOS Safari has no per-site permission icon in the address bar; once a site is
// denied, getCurrentPosition/Notification.requestPermission never re-prompt and
// the OS-level toggle can't override it. Recovery differs by context, so detect
// iOS-web and whether we're running as an installed (Home Screen) PWA.
function isIOSWeb(): boolean {
  return Platform.OS === 'web' && typeof navigator !== 'undefined' && /iP(hone|ad|od)/.test(navigator.userAgent || '');
}
function isStandalonePWA(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  try {
    return (navigator as any).standalone === true
      || (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches);
  } catch { return false; }
}

// Open a Google-Maps link. On an installed iOS PWA, opening the maps WEBSITE
// (https://www.google.com/maps/...) renders inside a system in-app browser that
// the PWA cannot dismiss — it lingers on top after the user returns (the stuck
// "internal browser" screen). A URL *scheme* hands off to a native app instead
// (exactly like tel: links do), so it app-switches and comes back cleanly. Use
// the Apple Maps scheme (always present on iOS) only in that case; native apps,
// Android, and desktop web get the https link as-is.
function openMaps(httpsUrl: string): void {
  if (isIOSWeb() && isStandalonePWA()) {
    const scheme = appleMapsScheme(httpsUrl);
    if (scheme) { window.location.href = scheme; return; }
  }
  Linking.openURL(httpsUrl).catch(() => {});
}

// Alert.alert is a no-op on react-native-web, so any user-facing message in a
// web code path must fall back to the browser's own dialog.
function uiAlert(title: string, body?: string): void {
  if (Platform.OS === 'web') {
    try { (globalThis as any).alert?.(body ? `${title}\n\n${body}` : title); } catch { /* best-effort */ }
  } else {
    Alert.alert(title, body);
  }
}

// Run a deal action and SURFACE a failure instead of swallowing it. Relay
// outages never reject (the client outbox queues and retries those) — a
// rejection here is a real state error (e.g. the deal changed underneath the
// tap) that the user must see, or their card silently diverges from reality.
function runDealAction(p: Promise<unknown> | undefined, failTitle: string): void {
  p?.catch((e) => uiAlert(failTitle, e instanceof Error ? e.message : undefined));
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
  const [negos, setNegos] = useState<Negotiation[]>([]);
  const [profile, setProfile] = useState<UserProfile>({ name: '', picture: '', about: '', gallery: [], phone: '', phoneDisplay: 'full', externalLink: '', vehicleModel: '', plateNumber: '', plateDisplay: 'masked' });
  const [servicesEnabled, setServicesEnabled] = useState(false);
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
  // Install the window.freeport debug API on web (no-op on native), so it's
  // available even on the onboarding screen before a client exists.
  useEffect(() => { installDebugApi(); }, []);
  // Ask for notification permission + set up the Android channel once (native only;
  // web is a no-op and uses PWA push instead).
  useEffect(() => { initNotifications(); }, []);

  // iOS has no foreground service, so once it suspends the app (~seconds after
  // backgrounding) the relay socket dies and no more alerts arrive. If the user
  // has a live post waiting for offers, warn them just before that suspension so
  // they know to keep the app open / check back. Fires shortly after backgrounding
  // (our proxy for the suspension signal, which managed RN can't observe directly)
  // and is cancelled if they return. Throttled to avoid repeat nags.
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
        (i) => !(i.content.payload as any)?.withdrawn
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

  // Bumped whenever the app returns to the foreground. Drives re-subscription
  // of the relay feeds so missed events (offers, messages) backfill on resume.
  const [resumeTick, setResumeTick] = useState(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      // Re-open any sockets the OS killed while we were backgrounded, then
      // nudge the feeds to re-subscribe (fresh REQ → backfills the gap).
      client?.reconnect().catch(() => {});
      setResumeTick((n) => n + 1);
    });
    return () => sub.remove();
  }, [client]);

  // Live relay connectivity for the header status pill.
  const [netStatus, setNetStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');
  // Signed DMs waiting for a relay (offline sends). Surfaced in the status pill
  // so a "Confirmed" card the counterparty hasn't received yet is never silent.
  const [outboxPending, setOutboxPending] = useState(0);
  const { updating } = useUpdateState();
  const webUpdate = useWebUpdateAvailable();
  useEffect(() => {
    if (!client) { setNetStatus('connecting'); return; }
    let everUp = false;
    let t0 = Date.now();
    // Exponential backoff between reconnect dials while offline: redialing all
    // relays every 2.5s drains the battery on a dead network. Resets the
    // moment a socket comes back (and on resume, since this effect re-runs).
    let nextDialAt = 0;
    let dialDelay = 2500;
    const tick = () => {
      const n = client.connectedRelayCount();
      if (n > 0) { everUp = true; dialDelay = 2500; nextDialAt = 0; setNetStatus('online'); }
      else {
        // No live socket: surface offline and actively try to re-open it,
        // rather than sitting on a stale "No network" forever.
        setNetStatus(everUp || Date.now() - t0 > 5000 ? 'offline' : 'connecting');
        if (Date.now() >= nextDialAt) {
          nextDialAt = Date.now() + dialDelay;
          dialDelay = Math.min(dialDelay * 2, 60_000);
          client.reconnect().catch(() => {});
        }
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    // Re-arm the connecting grace window on resume so a brief reconnect after
    // returning to the foreground doesn't flash "No network".
    t0 = Date.now(); everUp = false;
    return () => clearInterval(id);
  }, [client, resumeTick]);

  // Settle the StatusDot to a static dot once the connection has been 'online'
  // continuously for 5s — keeps the pulse/glow only while connecting/offline or
  // during the first few seconds of being connected (reduces idle UI noise).
  const [netSteady, setNetSteady] = useState(false);
  useEffect(() => {
    if (netStatus !== 'online') { setNetSteady(false); return; }
    const id = setTimeout(() => setNetSteady(true), 5000);
    return () => clearTimeout(id);
  }, [netStatus]);

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
  // Resolve the distance unit: 'auto' → miles only for a US location, km elsewhere.
  const effectiveDistanceUnit: 'km' | 'mi' =
    distanceUnit === 'auto' ? (location.country === 'US' ? 'mi' : 'km') : distanceUnit;
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
      setLocation(p.location);
      setUseNip07(p.useNip07);
      setThemeState(p.theme); // palette applied by the effective-theme resolver above
      setDistanceUnit(p.distanceUnit);
      setBrowseCategory(p.browseCategory);
      setBrowseSubcategory(p.browseSubcategory);
      setBrowseAlertSound(p.browseAlertSound);
      setBrowseAlertNotify(p.browseAlertNotify);
      setBrowseMaxDistance(p.browseMaxDistance);
      setSendLocationOnDeal(p.sendLocationOnDeal);
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

  // Deep-link on notification tap. Native: a tapped local/push notification
  // (incl. cold start). Web: the service worker postMessages an open client.
  useEffect(() => {
    const go = (t: unknown) => {
      if (t === 'messages' || t === 'browse' || t === 'post' || t === 'settings') {
        deepLinkedRef.current = true;
        if (t === 'messages') { const v = pickMessagesViewRef.current(); if (v) setMessagesView(v); }
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
        const isNewLive = !cur && feedReady.current && i.createdAt >= Math.floor(Date.now() / 1000) - 120;
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
      c.onOutboxChange = (n) => setOutboxPending(n);
      // Local notification for a new inbound DM. Only when backgrounded — the
      // in-app Messages badge already covers the foreground. Content-blind body.
      c.onIncomingMessage = (_nego, msg) => {
        if (AppState.currentState === 'active') { eventAlert(); return; } // in-app sound+haptic
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
    resetIntents();
    const markets = servicesEnabled ? [DEMO_MARKET, SERVICE_MARKET] : [DEMO_MARKET];
    const unsub = client.watchMarket(markets);
    return unsub;
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
  const unreadChats = tab === 'messages'
    ? 0
    : negos.reduce((n, g) => n + (g.messages?.filter((m) => m.dir === 'in' && m.ts > chatSeenTs).length ?? 0), 0);

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
  const unreadDeals = tab === 'messages'
    ? 0
    : negos.filter((n) => n.state === 'confirmed' && n.updatedAt > chatSeenTs).length;

  const pendingCount = negos.filter(
    (n) => n.state === 'open' && n.termsBy === 'them' || n.state === 'accepted_by_them',
  ).length + expiredNotices.length + unreadChats + unreadDeals;

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
  // Auto-send our contact back exactly ONCE per deal. The guard is persisted to
  // kv (not just an in-memory ref) so an app reload / OTA update doesn't re-send,
  // and we deliberately do NOT un-guard on a publish error — accept() commits our
  // contact locally and best-effort-publishes to the relays; re-firing on every
  // transient failure or reload re-publishes the same DM (new event id) and spams
  // the other party with "New message". Send once; if it truly failed, the user
  // can message manually.
  const autoContactSent = useRef<Set<string>>(new Set());
  const [autoContactReady, setAutoContactReady] = useState(false);
  useEffect(() => {
    kvGet('freeport.autoContactSent')
      .then((v) => { try { if (v) for (const id of JSON.parse(v) as string[]) autoContactSent.current.add(id); } catch { /* ignore */ } })
      .finally(() => setAutoContactReady(true));
  }, []);
  useEffect(() => {
    if (!client || !autoContactReady) return;
    for (const n of negos) {
      if (n.state === 'confirmed' && n.theirContact && !n.ourContact && !autoContactSent.current.has(n.id)) {
        autoContactSent.current.add(n.id);
        kvSet('freeport.autoContactSent', JSON.stringify([...autoContactSent.current])).catch(() => {});
        client.accept(n.id, buildContactFor(n)).catch(() => {});
      }
    }
  }, [negos, client, profile, autoContactReady]);

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
  // Guided-tour steps per rideshare role (Customer/Provider get no tour). Each
  // step highlights a tab; a `wheel` step stays on Post and instead demos the
  // amount wheel. The passenger flow inserts a dedicated wheel/pricing step
  // right after the Post step.
  type TourStep = { tab: Tab; wheel?: boolean; completed?: boolean; final?: boolean; text: string };
  // Closing note shown to everyone: Freeport has no operator, so safety is a
  // shared responsibility. Inspiring sign-off rather than another tab pointer.
  const tourFinalStep: TourStep = { tab: 'settings', final: true, text: 'Freeport has no company in the middle. You are Freeport — and we rely on you to keep it safe. If someone’s details, like a licence plate or phone number, don’t match, don’t go through with the deal. Report them instead.' };
  const tourSteps: TourStep[] = role === 'driver'
    ? [
        { tab: 'browse', text: 'Tap here to find rides, negotiate, or accept a ride.' },
        { tab: 'messages', text: 'When you have a deal, tap here to chat, negotiate, or cancel the ride.' },
        { tab: 'messages', completed: true, text: 'Tap here to see your completed rides and rate karma scores.' },
        { tab: 'settings', text: "Edit your details here. Back up your identity so you don't lose your karma when you switch devices." },
        tourFinalStep,
      ]
    : [
        { tab: 'post', text: 'Tap here to book a ride. Unlike traditional ride-hailing, you set your own price (with an estimator) and negotiate with the driver. After booking, check back now and then — there are no push notifications.' },
        { tab: 'post', wheel: true, text: 'Set your price by spinning the wheel. Tap the amount to type it manually. Drag to 0 to let the driver offer a price.' },
        { tab: 'messages', text: 'When you have a deal, tap here to chat, negotiate, or cancel the ride.' },
        { tab: 'messages', completed: true, text: 'Tap here to see your completed rides and rate karma scores.' },
        { tab: 'settings', text: "Edit your details here. Back up your identity so you don't lose your karma when you switch devices." },
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

  // First launch: choose to create a new account or restore from a backup file.
  if (onboarding) {
    return (
      <View nativeID="freeport-shell" style={s.appShell}>
        <SafeAreaView style={s.root} edges={['top','left','right']}>
          <StatusBar style={effectiveTheme === 'light' ? 'dark' : 'light'} />
          <Onboarding
            onCreate={async (chosenRole, chosenServices, name, phone, vehicleModel, plateNumber) => {
              const sk = await createKey();
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
                phone: norm.valid ? norm.e164 : phone.trim(), phoneDisplay: 'full', externalLink: '',
                vehicleModel, plateNumber, plateDisplay: 'masked',
              };
              await saveProfile(prof);
              setProfile(prof);
              // Fire-and-forget: back the fresh key up to the user's cloud
              // (iCloud Keychain / Google Block Store) so a new device restores it
              // automatically. Don't block the UI; ignore errors.
              if (cloudAvailable()) {
                (async () => { const k = await loadKey(); if (k) await cloudSave(await buildCloudBundle(k)); })().catch(() => {});
              }
            }}
            onFinish={finishOnboarding}
            onRestore={async (text, passphrase) => {
              await restoreBackupText(text, passphrase); // throws on bad file/passphrase
              finishOnboarding();
            }}
            onCloudRestore={async () => {
              const data = await cloudRestore();
              if (!data) return false; // no backup found
              await restoreFromBundleText(data); // restores key + settings + saved addresses
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
      {tab === 'browse' && <MarketTab intents={intents} client={client} servicesEnabled={servicesEnabled} location={location} myContact={(i) => buildContact(i, true)} doneListingKeys={doneListingKeys} distanceUnit={effectiveDistanceUnit} defaultCategory={browseCategory} defaultSubcategory={browseSubcategory} maxDistance={browseMaxDistance} onScroll={onContentScroll} />}
      {tab === 'post' && <PostTab client={client} profile={profile} myIntents={myIntents} negos={negos} servicesEnabled={servicesEnabled} defaultCurrency={defaultCurrency} location={location} role={role} browseCategory={browseCategory} browseSubcategory={browseSubcategory} onScroll={onContentScroll} />}
      {tab === 'messages' && <DealsTab client={client} negos={negos} setNegos={setNegos} profile={profile} onScroll={onContentScroll} view={messagesView} onViewChange={setMessagesView} expiredNotices={expiredNotices} onDismissExpired={dismissExpired} glowDealId={glowDealId} glowCompleted={curTourStep?.completed === true} role={role} sendLocationOnDeal={sendLocationOnDeal} blockedPubkeys={blocked} onToggleBlock={toggleBlock} />}
      {tab === 'settings' && (
        <SettingsTab
          npub={npub}
          signerRef={signerRef}
          profile={profile}
          client={client}
          onOpenFeedback={() => { setMessagesView('completed'); setTab('messages'); }}
          onReplayTour={() => goToTourStep(0)}
          requiredLocOk={locOk}
          requiredNotifOk={notifSatisfied}
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
            await Promise.all([kvSet('freeport.expiredLog', '[]'), kvSet('freeport.expiredSeen', '[]'), kvSet('freeport.rated', '[]')]).catch(() => {});
            setExpiredLog([]); setExpiredSeen(new Set());
            // Reset custom fare coefficients so the next account starts on defaults.
            setFareConfig(null); setFareConfigState(null);
            await savePrefs({ role: '', fareConfig: null, ...(useNip07 ? { useNip07: false } : {}) }).catch(() => {});
            const empty: UserProfile = { name: '', picture: '', about: '', gallery: [], phone: '', phoneDisplay: 'full', externalLink: '', vehicleModel: '', plateNumber: '', plateDisplay: 'masked' };
            await saveProfile(empty).catch(() => {});
            if (useNip07) setUseNip07(false);
            setRole('');
            setProfile(empty);
            setNpub('');
            resetIntents(); setNegos([]); setMyIntents([]);
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
                const blank: UserProfile = { name: '', picture: '', about: '', gallery: [], phone: '', phoneDisplay: 'full', externalLink: '', vehicleModel: '', plateNumber: '', plateDisplay: 'masked' };
                try { await client.publishProfile(blank); } catch {}
              }
            } catch {}
            try { await cloudClear(); } catch {}                       // delete cloud backup of the key
            try { const p = await loadPrefs(); await disablePush(client?.pubkey ?? '', (p.notifyEndpoint || '').trim()); } catch {} // unsubscribe push
            await kvSet('freeport.pushOn', '0').catch(() => {});
            // Erase EVERYTHING on this device (key, profile, settings, posts, deals…).
            await wipeAllLocalData();
            setFareConfig(null); setFareConfigState(null);
            if (useNip07) setUseNip07(false);
            const empty: UserProfile = { name: '', picture: '', about: '', gallery: [], phone: '', phoneDisplay: 'full', externalLink: '', vehicleModel: '', plateNumber: '', plateDisplay: 'masked' };
            setRole(''); setProfile(empty); setNpub('');
            resetIntents(); setNegos([]); setMyIntents([]);
            setExpiredLog([]); setExpiredSeen(new Set());
            setClient(null); signerRef.current = null;
            setTab('post'); setOnboarding(true);
          }}
          onScroll={onContentScroll}
        />
      )}
      <View style={[s.tabbar, { paddingBottom: insets.bottom }]}>
        {visibleTabs.map((tk) => (
          <Pressable key={tk} onPress={() => (tk === 'messages' ? openMessages() : setTab(tk))} style={[s.tab, tab === tk && s.tabActive]}>
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
                  name={TAB_ICONS[tk][tab === tk ? 1 : 0]}
                  size={20}
                  color={tab === tk ? palette.accent : palette.dim}
                />
                {tk === 'messages' && pendingCount > 0 && (
                  <View style={s.badge}><Text style={s.badgeText}>{pendingCount}</Text></View>
                )}
                {tk === 'settings' && requiredCount > 0 && (
                  <View style={s.badge}><Text style={s.badgeText}>{requiredCount}</Text></View>
                )}
              </View>
              <Animated.View style={{ height: anim.labelH, opacity: anim.labelOpacity, overflow: 'hidden', justifyContent: 'center' }}>
                <Text style={[s.tabText, tab === tk && s.tabTextActive]}>{t(tk === 'post' && role === 'passenger' ? 'Request' : tk === 'browse' ? 'Browse' : tk === 'messages' ? 'Messages' : tk === 'settings' ? 'Settings' : 'Post')}</Text>
              </Animated.View>
            </Animated.View>
          </Pressable>
        ))}
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
            // Place the card near what it points at: just under the top toggle
            // for the Completed step, high for the wheel step (so the wheel below
            // stays visible), otherwise above the bottom tab bar.
            curTourStep.completed ? { top: insets.top + 108 }
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

// ─── Onboarding (first launch) ────────────────────────────────────────────────

function Onboarding({
  onCreate,
  onFinish,
  onRestore,
  onCloudRestore,
  language,
  onLanguageChange,
  location,
  onLocationChange,
}: {
  onCreate: (role: 'passenger' | 'driver', services: boolean, name: string, phone: string, vehicleModel: string, plateNumber: string) => Promise<void>;
  onFinish: () => void;
  onRestore: (text: string, passphrase: string) => Promise<void>;
  onCloudRestore: () => Promise<boolean>;
  language: string;
  onLanguageChange: (l: string) => void;
  location: UserLocation;
  onLocationChange: (loc: UserLocation) => void;
}) {
  const [step, setStep] = useState<'choose' | 'role' | 'location' | 'welcome'>('choose');
  const [busy, setBusy] = useState<'create' | 'restore' | 'cloud' | null>(null);
  // Only offer cloud restore when a backup actually EXISTS on this device's
  // iCloud Keychain (iOS) / Google Block Store (Android). Both reads are silent
  // (no account picker), so we check at load and hide the button otherwise —
  // showing it with no backup dead-ends on "No cloud backup found", which
  // confused Play review and real new users. `null` = still checking → hidden.
  const [cloudHasBackup, setCloudHasBackup] = useState<boolean | null>(null);
  // Will the post-onboarding auto-subscribe to the notifier be able to work?
  // Known-dead cases bring back the "keep the app open" welcome point, since
  // for those users it is still true: platform can't push (e.g. web outside an
  // installed PWA), permission already denied, or the notification server
  // isn't responding (GET /health, CORS-open, 5s cap). Checked here (mounts on
  // the first screen) so the answer settles before the welcome step renders.
  const [pushUnavailable, setPushUnavailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    pushUnavailableForOnboarding({
      status: pushStatus,
      endpoint: async () => (await loadPrefs()).notifyEndpoint,
    }).then((v) => { if (!cancelled) setPushUnavailable(v); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    if (!cloudAvailable()) { setCloudHasBackup(false); return; }
    cloudRestore()
      .then((v) => { if (!cancelled) setCloudHasBackup(!!v); })
      .catch(() => { if (!cancelled) setCloudHasBackup(false); });
    return () => { cancelled = true; };
  }, []);
  const showCloud = cloudAvailable() && cloudHasBackup === true;
  // Logo + title animate into place when the welcome screen mounts (picking up
  // from the HTML splash, which shows the same logo/title): fade + rise + a
  // gentle scale-down, so it reads as the splash mark settling into the app.
  const brandIn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(brandIn, { toValue: 1, duration: 620, delay: 60, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [brandIn]);
  const brandStyle = {
    opacity: brandIn,
    transform: [
      { translateY: brandIn.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) },
      { scale: brandIn.interpolate({ inputRange: [0, 1], outputRange: [1.12, 1] }) },
    ],
  };
  // The chooser is 4-way (two product lanes). The app's internals are still
  // (role × servicesEnabled): provider-side = driver, customer-side = passenger;
  // Service/Product UI = services. Vehicle is required only for a rideshare Driver.
  const [picked, setPicked] = useState<'passenger' | 'driver' | 'customer' | 'provider' | null>(null);
  // Accordion: exactly one role group is expanded at a time. Ridesharing is open
  // by default (Service/Product, the advanced vertical, starts collapsed); opening
  // one collapses the other. Defaults to Service/Product if a role there is picked.
  const [openGroup, setOpenGroup] = useState<'ride' | 'svc'>(
    picked === 'customer' || picked === 'provider' ? 'svc' : 'ride',
  );
  const role: 'passenger' | 'driver' | null =
    picked == null ? null : (picked === 'driver' || picked === 'provider') ? 'driver' : 'passenger';
  const services = picked === 'customer' || picked === 'provider';
  const vehicleRequired = picked === 'driver';
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const dialCode = useRef('+84');
  const autoFilledDial = useRef('');
  const scrollRef = useRef<ScrollView>(null);
  // Android doesn't auto-scroll a focused input above the keyboard; nudge the
  // low fields (Vehicle Model / Plate) into view when they get focus.
  const revealLowField = () => { setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150); };

  // Prefill the phone field with the user's country dial code, derived from the
  // location we detected via GPS or IP (e.g. VN → "+84 "). The detected country
  // (location.country) is preferred; if it isn't one of our markets we fall back
  // to an IP calling-code lookup. If the country can't be determined at all, the
  // field is left blank — we never default to a prefix like +1. Only overwrites
  // an empty field or a previously auto-filled prefix, never what the user typed.
  useEffect(() => {
    let cancelled = false;
    const prefill = (dial: string | null | undefined) => {
      if (cancelled || !dial) return;
      setPhone((p) => {
        const cur = p.trim();
        if (cur !== '' && cur !== autoFilledDial.current.trim()) return p; // user typed — leave it
        dialCode.current = dial;
        autoFilledDial.current = dial + ' ';
        return dial + ' ';
      });
    };
    const known = dialForCountry(location.country);
    if (known) prefill(known);
    else detectDialCode().then(prefill); // null when undetermined → no prefill
    return () => { cancelled = true; };
  }, [location.country]);

  // An encrypted (ncryptsec) backup needs its passphrase; the file is held
  // here while the passphrase field is shown, then restored on confirm.
  const [pendingRestore, setPendingRestore] = useState<string | null>(null);
  const [restorePass, setRestorePass] = useState('');

  const restore = async () => {
    setBusy('restore');
    try {
      const text = await pickBackupText();
      if (!text) return; // user cancelled the picker
      if (bundleNeedsPassphrase(text)) {
        setPendingRestore(text); // ask for the passphrase first
        return;
      }
      await onRestore(text, '');
    } catch (e: any) {
      uiAlert(t('Restore failed'), e?.message ?? t('Invalid backup file.'));
    } finally {
      setBusy(null);
    }
  };

  const restoreWithPassphrase = async () => {
    if (!pendingRestore) return;
    setBusy('restore');
    try {
      await onRestore(pendingRestore, restorePass);
      setPendingRestore(null);
      setRestorePass('');
    } catch (e: any) {
      uiAlert(t('Restore failed'), e?.message ?? t('Wrong passphrase?'));
    } finally {
      setBusy(null);
    }
  };

  const cloudRestoreNow = async () => {
    setBusy('cloud');
    try {
      const found = await onCloudRestore();
      if (!found) Alert.alert(t('No cloud backup found.'));
    } catch (e: any) {
      Alert.alert('Restore failed', e?.message ?? 'Invalid backup.');
    } finally {
      setBusy(null);
    }
  };

  // On blur: normalize + format, surface an error if the number is invalid.
  const normalizePhoneField = () => {
    const raw = phone.trim();
    if (!raw || raw === dialCode.current) { setPhoneError(null); return; }
    const r = normalizePhone(raw, dialCode.current);
    if (r.valid) { setPhone(r.formatted); setPhoneError(null); }
    else setPhoneError(r.error ?? 'Invalid phone number');
  };

  // Phone is required AND must be a valid number (same rule as Settings).
  const phoneTrim = phone.trim();
  const phoneEntered = phoneTrim !== '' && phoneTrim !== dialCode.current;
  const phoneValid = phoneEntered && normalizePhone(phoneTrim, dialCode.current).valid;
  // A rideshare Driver must register their vehicle up front — required to take
  // rides. A Provider (services/goods) needs no vehicle.
  const vehicleOk = !vehicleRequired || (vehicleModel.trim().length > 0 && plateNumber.trim().length > 0);
  const canContinue = !!picked && name.trim().length > 0 && phoneValid && vehicleOk;

  // Kick account creation (key gen + profile publish) off in the background the
  // moment the user reaches the final welcome screen — that screen has no Back
  // and inputs are already validated, so the work is safe to start early. By the
  // time the welcome animation plays out and the user taps Start, it's usually
  // already done, so Start feels instant.
  const prepRef = useRef<Promise<void> | null>(null);
  const startPrep = () => {
    if (!prepRef.current && role) {
      prepRef.current = onCreate(role, services, name, phone, vehicleModel.trim(), plateNumber.trim());
    }
  };
  const finishCreate = async () => {
    if (!role) return;
    setBusy('create');
    try {
      startPrep();                 // defensive: ensure prep ran even if not pre-started
      await prepRef.current;       // resolves immediately if already finished
      onFinish();
    } catch (e: any) {
      prepRef.current = null;      // allow a retry on failure
      Alert.alert(t('Could not create account'), e?.message ?? '');
    } finally {
      setBusy(null);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
    <ScrollView ref={scrollRef} contentContainerStyle={[s.pad, { flexGrow: 1, justifyContent: 'center', paddingBottom: 96 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Animated.View style={brandStyle}>
        <Image source={require('./assets/favicon.png')} style={{ width: 84, height: 84, borderRadius: 20, alignSelf: 'center', marginBottom: 14 }} />
        <Text style={[s.header, { textAlign: 'center', fontSize: 26 }]}>Freeport</Text>
        <Text style={[s.dim, { textAlign: 'center', marginBottom: 16 }]}>{t("decentralised marketplace")}</Text>
      </Animated.View>

      {/* Language picker up front, so users can read onboarding in their own language. */}
      <View style={{ alignSelf: 'center', minWidth: 220, maxWidth: 320, width: '100%', marginBottom: 22 }}>
        <SelectField value={language} options={LANGUAGE_CODES} onChange={onLanguageChange} labelFor={languageLabel} scroll />
      </View>

      {step === 'choose' ? (
        <>
          <Text style={s.sectionTitle}>{t("Welcome")}</Text>
          <Text style={s.dim}>{t("Your account is a key created on this device — no signup, no email. Back it up later so you can restore it on another device.")}</Text>
          <Pressable style={[s.btnAccept, { marginTop: 18 }]} onPress={() => setStep('role')} disabled={busy !== null}>
            <Text style={s.btnText}>{t("Create new account")}</Text>
          </Pressable>
          <Text style={[s.dim, { textAlign: 'center', marginVertical: 16 }]}>— or —</Text>
          {showCloud && (
            <Pressable style={[s.btnCounter, { marginBottom: 12 }, busy === 'cloud' && { opacity: 0.6 }]} onPress={cloudRestoreNow} disabled={busy !== null}>
              {busy === 'cloud' ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t("Restore account from {name}", { name: cloudName() })}</Text>}
            </Pressable>
          )}
          {pendingRestore ? (
            <>
              <Text style={[s.dim, { marginTop: 12 }]}>{t('This backup is encrypted — enter its passphrase.')}</Text>
              <TextInput
                style={s.input}
                value={restorePass}
                onChangeText={setRestorePass}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={t('Passphrase')}
                placeholderTextColor={palette.placeholder}
              />
              <Pressable style={[s.btnAccept, { marginTop: 8 }, busy === 'restore' && { opacity: 0.6 }]} onPress={restoreWithPassphrase} disabled={busy !== null || !restorePass}>
                {busy === 'restore' ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Restore')}</Text>}
              </Pressable>
              <Pressable style={s.btnTextOnly} onPress={() => { setPendingRestore(null); setRestorePass(''); }} disabled={busy !== null}>
                <Text style={s.dim}>{t('Cancel')}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={[s.btnCounter, { marginTop: 12 }, busy === 'restore' && { opacity: 0.6 }]} onPress={restore} disabled={busy !== null}>
              {busy === 'restore' ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t("Restore from backup file")}</Text>}
            </Pressable>
          )}
        </>
      ) : step === 'role' ? (
        <>
          <Text style={s.sectionTitle}>{t("I'm mainly a…")}</Text>

          <Pressable
            style={[s.row, { alignItems: 'center', justifyContent: 'space-between' }]}
            onPress={() => setOpenGroup('ride')}
            disabled={busy !== null}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.roleGroupLabel}>{t("Ridesharing")}</Text>
              <Text style={s.roleGroupNote}>{t("Basic user interface")}</Text>
            </View>
            <Ionicons name={openGroup === 'ride' ? 'chevron-up' : 'chevron-down'} size={20} color={palette.text3} />
          </Pressable>
          {openGroup === 'ride' && (
          <View style={{ gap: 10, marginTop: 4 }}>
            <Pressable
              style={[s.roleCard, picked === 'passenger' && s.roleCardOn]}
              onPress={() => setPicked('passenger')}
              disabled={busy !== null}
            >
              <Ionicons name="person-outline" size={26} color={picked === 'passenger' ? palette.accent : palette.text3} />
              <View style={{ flex: 1 }}>
                <Text style={s.roleCardTitle}>{t("Passenger")}</Text>
                <Text style={s.roleCardDesc}>{t("I'm requesting rides")}</Text>
              </View>
              {picked === 'passenger' && <Ionicons name="checkmark-circle" size={22} color={palette.accent} />}
            </Pressable>
            <Pressable
              style={[s.roleCard, picked === 'driver' && s.roleCardOn]}
              onPress={() => setPicked('driver')}
              disabled={busy !== null}
            >
              <Ionicons name="car-outline" size={26} color={picked === 'driver' ? palette.accent : palette.text3} />
              <View style={{ flex: 1 }}>
                <Text style={s.roleCardTitle}>{t("Driver")}</Text>
                <Text style={s.roleCardDesc}>{t("I'm offering rides")}</Text>
              </View>
              {picked === 'driver' && <Ionicons name="checkmark-circle" size={22} color={palette.accent} />}
            </Pressable>
          </View>
          )}

          <Pressable
            style={[s.row, { marginTop: 16, alignItems: 'center', justifyContent: 'space-between' }]}
            onPress={() => setOpenGroup('svc')}
            disabled={busy !== null}
          >
            <View style={{ flex: 1 }}>
              <Text style={s.roleGroupLabel}>{t("Service/Product")}</Text>
              <Text style={s.roleGroupNote}>{t("Advanced user interface")}</Text>
            </View>
            <Ionicons name={openGroup === 'svc' ? 'chevron-up' : 'chevron-down'} size={20} color={palette.text3} />
          </Pressable>
          {openGroup === 'svc' && (
          <View style={{ gap: 10, marginTop: 4 }}>
            <Pressable
              style={[s.roleCard, picked === 'customer' && s.roleCardOn]}
              onPress={() => setPicked('customer')}
              disabled={busy !== null}
            >
              <Ionicons name="bag-handle-outline" size={26} color={picked === 'customer' ? palette.accent : palette.text3} />
              <View style={{ flex: 1 }}>
                <Text style={s.roleCardTitle}>{t("Customer")}</Text>
                <Text style={s.roleCardDesc}>{t("I'm requesting services & products")}</Text>
              </View>
              {picked === 'customer' && <Ionicons name="checkmark-circle" size={22} color={palette.accent} />}
            </Pressable>
            <Pressable
              style={[s.roleCard, picked === 'provider' && s.roleCardOn]}
              onPress={() => setPicked('provider')}
              disabled={busy !== null}
            >
              <Ionicons name="storefront-outline" size={26} color={picked === 'provider' ? palette.accent : palette.text3} />
              <View style={{ flex: 1 }}>
                <Text style={s.roleCardTitle}>{t("Provider")}</Text>
                <Text style={s.roleCardDesc}>{t("I'm offering services & products")}</Text>
              </View>
              {picked === 'provider' && <Ionicons name="checkmark-circle" size={22} color={palette.accent} />}
            </Pressable>
          </View>
          )}

          <Field label={t("Display Name *")} value={name} onChange={setName} placeholder={t("How others see you")} />
          <Field
            label={t("Phone number *")}
            value={phone}
            onChange={(v) => { setPhone(v); setPhoneError(null); }}
            onBlur={normalizePhoneField}
            placeholder="+1 (555) 123-4567 or 5551234567"
            keyboardType="phone-pad"
          />
          {phoneError ? <Text style={s.fieldError}>{phoneError}</Text> : null}
          <Text style={s.dim}>{t("Shown to others masked (e.g. +1••••••6789). You can change visibility in Settings.")}</Text>

          {vehicleRequired && (
            <>
              <Text style={[s.label, { marginTop: 16, fontWeight: '700' }]}>{t("Vehicle Detail")}</Text>
              <Field label={`${t("Vehicle Model")} *`} value={vehicleModel} onChange={setVehicleModel} onFocus={revealLowField} placeholder={t("e.g. Toyota Vios — white")} />
              <Field label={`${t("Plate Number")} *`} value={plateNumber} onChange={setPlateNumber} onFocus={revealLowField} placeholder={t("e.g. ABC-1234")} />
              <Text style={s.dim}>⚠️ {t("Required to receive rides")}</Text>
            </>
          )}

          <Pressable
            style={[s.btnAccept, { marginTop: 18 }, !canContinue && { opacity: 0.5 }]}
            onPress={() => setStep('location')}
            disabled={!canContinue}
          >
            <Text style={s.btnText}>{t("Continue")}</Text>
          </Pressable>
          <Pressable style={[s.btnDecline, { marginTop: 12 }]} onPress={() => setStep('choose')} disabled={busy !== null}>
            <Text style={s.btnText}>{t("Back")}</Text>
          </Pressable>
        </>
      ) : step === 'location' ? (
        <>
          <Text style={s.sectionTitle}>{t("Confirm your location")}</Text>
          <Text style={s.dim}>{t("Auto-detected from your device. Adjust if it's wrong — it sets your default currency and the area you see posts for. Stays on this device.")}</Text>

          <View style={{ marginTop: 12 }}>
            <QuickLocationSearch onPick={(loc) => onLocationChange(loc)} />
          </View>

          <Text style={s.label}>{t("Country")}</Text>
          <SelectField
            value={location.country}
            options={COUNTRY_CODES_AZ}
            onChange={(c) => onLocationChange({ country: c, state: '', city: '' })}
            labelFor={(c) => `${flagEmoji(c)}  ${COUNTRY_NAME[c] ?? c}`}
            placeholder={t("Select country…")}
            scroll
          />

          {location.country && levelsOf(location.country) >= 2 ? (
            <>
              <Text style={s.label}>{t("State / Province")}</Text>
              <SelectField
                value={location.state}
                options={statesOf(location.country)}
                onChange={(st) => onLocationChange({ ...location, state: st, city: '' })}
                placeholder={t("Select state…")}
                scroll
              />
            </>
          ) : null}

          {location.country && location.state && levelsOf(location.country) >= 3 ? (
            <>
              <Text style={s.label}>{t("City")}</Text>
              <SelectField
                value={location.city}
                options={citiesOf(location.country, location.state)}
                onChange={(ci) => onLocationChange({ ...location, city: ci })}
                placeholder={t("Select city…")}
                scroll
              />
            </>
          ) : null}

          <Pressable
            style={[s.btnAccept, { marginTop: 18 }, (!location.country || busy !== null) && { opacity: 0.5 }]}
            onPress={() => { startPrep(); setStep('welcome'); }}
            disabled={!location.country || busy !== null}
          >
            <Text style={s.btnText}>{t("Continue")}</Text>
          </Pressable>
          <Pressable style={[s.btnDecline, { marginTop: 12 }]} onPress={() => setStep('role')} disabled={busy !== null}>
            <Text style={s.btnText}>{t("Back")}</Text>
          </Pressable>
        </>
      ) : (
        <OnboardingWelcome busy={busy === 'create'} onStart={finishCreate} pushUnavailable={pushUnavailable} />
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Final onboarding screen: the points fade/slide in one by one; the Start
// button only unlocks once the whole sequence has played (so the user reads it).
function OnboardingWelcome({ busy, onStart, pushUnavailable }: { busy: boolean; onStart: () => void; pushUnavailable?: boolean }) {
  // Frozen on first render: the anims array below is sized to it, so the list
  // must not change length mid-animation. pushUnavailable is settled by the
  // time this step mounts (checked when onboarding opened).
  const POINTS = useRef<{ icon: keyof typeof Ionicons.glyphMap; text: string }[]>([
    { icon: 'globe-outline', text: t("A true P2P marketplace on Nostr.") },
    // Without push (unsupported platform / permission already denied) missed
    // messages really do go unheld — keep the old advice for those users.
    ...(pushUnavailable ? [{ icon: 'phone-portrait-outline' as const, text: t("Keep the app open during a deal — there's no server to hold missed messages.") }] : []),
    { icon: 'shield-checkmark-outline', text: t("Your price. No commission. No censorship. No downtime.") },
    { icon: 'bug-outline', text: t("Please report any bugs to us.") },
  ]).current;
  // One Animated.Value per line (title + each point); 0 → 1 drives opacity + slide.
  const anims = useRef([0, ...POINTS.map(() => 0)].map(() => new Animated.Value(0))).current;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const seq = Animated.stagger(
      380,
      anims.map((a) =>
        Animated.timing(a, { toValue: 1, duration: 480, useNativeDriver: true }),
      ),
    );
    seq.start(({ finished }) => { if (finished) setReady(true); });
    return () => seq.stop();
  }, []);

  const row = (i: number, child: React.ReactNode) => (
    <Animated.View
      style={{
        opacity: anims[i],
        transform: [{ translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }}
    >
      {child}
    </Animated.View>
  );

  return (
    <>
      {row(0, <Text style={[s.sectionTitle, { textAlign: 'center', fontSize: 28, marginBottom: 18 }]}>{t("Welcome to Freeport")}</Text>)}
      <View style={{ gap: 20, marginTop: 8 }}>
        {POINTS.map((p, i) => row(i + 1, (
          <View style={{ flexDirection: 'row', gap: 14, alignItems: 'center' }}>
            <Ionicons name={p.icon} size={26} color={palette.accent} style={{ width: 30, textAlign: 'center' }} />
            <Text style={{ flex: 1, fontSize: 17, lineHeight: 24, color: palette.text2 }}>{p.text}</Text>
          </View>
        )))}
      </View>
      <Pressable
        style={[s.btnAccept, { marginTop: 28 }, (!ready || busy) && { opacity: 0.5 }]}
        onPress={onStart}
        disabled={!ready || busy}
      >
        {busy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{ready ? t("Start") : t("Please wait…")}</Text>}
      </Pressable>
    </>
  );
}

// ─── Market tab ──────────────────────────────────────────────────────────────

function MarketTab({
  intents,
  client,
  servicesEnabled,
  location,
  myContact,
  doneListingKeys,
  distanceUnit,
  defaultCategory,
  defaultSubcategory,
  maxDistance,
  onScroll,
}: {
  intents: Intent[];
  client: MobileClient | null;
  servicesEnabled: boolean;
  location: UserLocation;
  myContact: (intent: Intent) => string;
  doneListingKeys: Set<string>;
  distanceUnit: 'km' | 'mi';
  defaultCategory: string;
  defaultSubcategory: string;
  maxDistance: number;
  onScroll?: (e: any) => void;
}) {
  const country = location.country;
  const [mapOpenId, setMapOpenId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [respondedIds, setRespondedIds] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [sortPrefs, setSortPrefs] = useState<SortKey[]>(['best', 'none', 'none']);
  const [sortOpen, setSortOpen] = useState(false);
  const [userGeohash, setUserGeohash] = useState<string | null>(null);
  // Open Browse on the user's default category/subcategory (Driver/Provider
  // preference), falling back to Ridesharing when unset.
  const initCat = defaultCategory || RIDESHARE_CATEGORY;
  const initSub = defaultSubcategory || (initCat === RIDESHARE_CATEGORY ? DEFAULT_RIDESHARE_SUBCATEGORY : (subcategoriesFor(initCat)[0] ?? null));
  const [filterCat, setFilterCat] = useState(initCat);
  const [filterSub, setFilterSub] = useState<string | null>(initSub);
  const [drillCategory, setDrillCategory] = useState<string | null>(initCat);
  const PAGE_SIZE = 50;
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [cardViewerUri, setCardViewerUri] = useState<string | null>(null); // full-screen post image
  // Re-evaluate the feed every 30s so a post drops off as soon as it passes its
  // expiry / requested time — without waiting for an unrelated re-render.
  const [nowTick, setNowTick] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => { const id = setInterval(() => setNowTick(Math.floor(Date.now() / 1000)), 30_000); return () => clearInterval(id); }, []);

  useEffect(() => {
    // GPS first for the proximity geohash; fall back to coarse IP coords when
    // device location is denied/unavailable so "near me" still works.
    (async () => {
      const c = (await getCurrentCoords()) ?? (await detectCoordsIP());
      if (c) setUserGeohash(coordsToGeohash(c.latitude, c.longitude));
    })();
  }, []);

  // Locality reference: geocode the user's SELECTED location (Singapore, etc.)
  // as a fallback "where am I" point when the device gives us nothing.
  const [locRef, setLocRef] = useState<string | null>(null);
  useEffect(() => {
    if (!location.country) { setLocRef(null); return; }
    const q = [location.city, location.state, COUNTRY_NAME[location.country] ?? location.country].filter(Boolean).join(', ');
    let cancelled = false;
    geohashForPlace(q, '').then((gh) => { if (!cancelled) setLocRef(gh || null); });
    return () => { cancelled = true; };
  }, [location.country, location.state, location.city]);
  // Distance reference: prefer the PRECISE device point (GPS, else coarse IP) over
  // the selected-location geocode. The latter is only a region centroid when the
  // user picked country+state with no city — comparing that centroid against a
  // listing's exact pin yielded misleading distances (e.g. "31 km" between parties
  // in the same town). Region/market filtering still uses `location` separately.
  const ref = userGeohash ?? locRef;

  // Distance from the user's reference point to a post's geohash, computed once
  // per geohash and cached (rebuilt only when `ref` changes). Filter, sort, and
  // render all read from here, so a post's distance is never recomputed across
  // the O(n log n) sort, the 30s re-tick, or a keystroke. Pair with the decode
  // memo in maps.ts → distance access is effectively O(1) per post.
  const distKm = useMemo(() => {
    const cache = new Map<string, number | null>();
    return (gh?: string | null): number | null => {
      if (!ref || !gh) return null;
      let v = cache.get(gh);
      if (v === undefined) { v = distanceKmBetweenGeohashes(ref, gh); cache.set(gh, v); }
      return v;
    };
  }, [ref]);

  // Reset to the first page whenever the filter/sort changes
  useEffect(() => { setLimit(PAGE_SIZE); }, [keyword, filterCat, filterSub, servicesEnabled, sortPrefs]);

  const mine = (i: Intent) => client != null && i.pubkey === client.pubkey;
  // Defer the keyword so typing stays responsive: the expensive filter+sort
  // below recomputes at low priority off the deferred value while the input
  // updates immediately.
  const kw = useDeferredValue(keyword.trim().toLowerCase());

  // Filter + sort the whole feed. Memoised so it only recomputes when an input
  // that affects the result changes — not on unrelated re-renders (opening a
  // map, starting a respond, etc.). Keeps it smooth even at the 10k cap.
  const shown = useMemo(() => {
    // Drop posts that are no longer takeable: past their expiry, or whose
    // requested time has already passed. Client-side so it's consistent
    // regardless of whether relays honor the NIP-40 expiration tag.
    const live = intents.filter((i) => {
      if ((i.content.payload as any)?.withdrawn) return false; // deal closed → withdrawn
      if (i.content.expires_at < nowTick) return false;
      if (doneListingKeys.has(i.pubkey + '|' + i.d)) return false; // our deal on it is done (completed/cancelled)
      const start = i.content.window?.start;
      if (start && start < nowTick) return false;
      return true;
    });
    // Hide leftover service listings if the vertical is toggled off
    const visible = servicesEnabled ? live : live.filter((i) => !i.content.schema.startsWith('service'));
    // Category (+ optional subcategory) filter, only when Service/Product is on
    const byCategory = servicesEnabled
      ? visible.filter((i) => {
          const pl = i.content.payload as any;
          if (categoryOf(i.content.schema, pl) !== filterCat) return false;
          if (filterSub && subcategoryOf(i.content.schema, pl) !== filterSub) return false;
          return true;
        })
      : visible;
    // Locality: a ride is inherently local, so hide requests far from the user's
    // area (by their SELECTED location, falling back to GPS). Skipped when we have
    // no reference, or the post carries no pickup geohash — so discovery never
    // silently breaks. Services/goods aren't distance-bound, so they're exempt.
    const NEAR_KM = 200;
    const local = ref
      ? byCategory.filter((i) => {
          if (!i.content.schema.startsWith('rideshare')) return true;
          const gh = (i.content.payload as any)?.from?.geohash;
          if (!gh) return true;
          const km = distKm(gh);
          return km == null || km <= NEAR_KM;
        })
      : byCategory;
    // Max-distance preference: hide posts farther than the user's chosen radius
    // (in their distance unit). Posts without a location aren't hidden.
    const maxKm = distanceUnit === 'mi' ? maxDistance * 1.60934 : maxDistance;
    const withinMax = ref && maxDistance > 0
      ? local.filter((i) => {
          const pl = i.content.payload as any;
          const gh = i.content.schema.startsWith('rideshare') ? pl?.from?.geohash : pl?.location?.geohash;
          if (!gh) return true;
          const km = distKm(gh);
          return km == null || km <= maxKm;
        })
      : local;
    // Keyword filter across title, locations, payment, notes, and author name
    const filtered = kw ? withinMax.filter((i) => searchableText(i, client).includes(kw)) : withinMax;
    // Multi-level sort by the chosen first/second/third criteria
    return [...filtered].sort((a, b) => {
      for (const key of sortPrefs) {
        if (key === 'none') continue;
        const c = compareBy(key, a, b, client, ref, distKm);
        if (c !== 0) return c;
      }
      return 0;
    });
  }, [intents, servicesEnabled, filterCat, filterSub, kw, sortPrefs, ref, client, nowTick, doneListingKeys, maxDistance, distanceUnit, distKm]);

  const paged = shown.slice(0, limit);
  const hasMore = shown.length > paged.length;
  const activeSortKeys = sortPrefs.filter((k) => k !== 'none');
  // When the icon+label row wraps to 2 lines, collapse to icon-only to stay
  // compact. Reset to full whenever the active set changes (then re-measure),
  // and only ever transition full→icon-only so it never oscillates.
  const [sortIconOnly, setSortIconOnly] = useState(false);
  const sortSig = activeSortKeys.join(',');
  useEffect(() => { setSortIconOnly(false); }, [sortSig]);

  return (
    <View style={{ flex: 1 }}>
      <View style={s.searchBar}>
        <View style={s.searchInputWrap}>
          <Ionicons name="search" size={16} color={palette.dim} />
          <TextInput
            style={s.searchInput}
            value={keyword}
            onChangeText={setKeyword}
            placeholder={t("Filter by keyword")}
            placeholderTextColor={palette.placeholder}
            autoCapitalize="none"
          />
          {keyword ? (
            <Pressable onPress={() => setKeyword('')} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Clear search')}><Ionicons name="close-circle" size={16} color={palette.dim} /></Pressable>
          ) : null}
        </View>
        <Pressable style={s.sortBtn} onPress={() => setSortOpen(true)}>
          <Ionicons name="swap-vertical" size={16} color="#93c5fd" />
          {activeSortKeys.length ? (
            <View
              style={s.sortBtnContent}
              onLayout={(e) => { if (!sortIconOnly && e.nativeEvent.layout.height > 24) setSortIconOnly(true); }}
            >
              {activeSortKeys.map((k, i) => (
                <View key={k} style={s.sortChipItem}>
                  {i > 0 ? <Text style={s.sortBtnSep}>›</Text> : null}
                  <Ionicons name={SORT_ICON[k]} size={13} color="#93c5fd" />
                  {!sortIconOnly ? <Text style={s.sortBtnText}>{t(SORT_LABEL[k])}</Text> : null}
                </View>
              ))}
            </View>
          ) : (
            <Text style={s.sortBtnText}>{t("Sort")}</Text>
          )}
        </Pressable>
      </View>
      <SortModal
        visible={sortOpen}
        prefs={sortPrefs}
        onChange={setSortPrefs}
        onClose={() => setSortOpen(false)}
        nearbyDisabled={!ref}
      />
      {/* Category filter — only when the Service/Product vertical is enabled.
          Tapping a category with subcategories drills into them (with a Back). */}
      {servicesEnabled && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.catScroll}
          contentContainerStyle={s.catRow}
        >
          {drillCategory ? (
            <>
              <Pressable style={s.catBack} onPress={() => setDrillCategory(null)}>
                <Ionicons name={dirIcon('chevron-back', 'chevron-forward')} size={14} color={palette.chipBlueText} />
                <Text style={s.catBackText}>{t("Back")}</Text>
              </Pressable>
              {subcategoriesFor(drillCategory).map((sub) => (
                <Pressable
                  key={sub}
                  style={[s.catChip, s.catChipRow, filterSub === sub && s.catChipOn]}
                  onPress={() => setFilterSub(sub)}
                >
                  <MaterialCommunityIcons
                    name={subcategoryIcon(sub) as any}
                    size={14}
                    color={filterSub === sub ? 'white' : palette.chipText}
                    style={s.catChipIcon}
                  />
                  <Text style={[s.catChipText, filterSub === sub && s.catChipTextOn]}>{t(sub)}</Text>
                </Pressable>
              ))}
            </>
          ) : (
            [RIDESHARE_CATEGORY, ...SERVICE_CATEGORIES].map((c) => (
              <Pressable
                key={c}
                style={[s.catChip, s.catChipRow, filterCat === c && s.catChipOn]}
                onPress={() => {
                  setFilterCat(c);
                  const subs = subcategoriesFor(c);
                  // No "All" chip anymore — default to the first subcategory.
                  setFilterSub(subs.length ? subs[0] : null);
                  if (subs.length) setDrillCategory(c);
                }}
              >
                <MaterialCommunityIcons
                  name={categoryIcon(c) as any}
                  size={14}
                  color={filterCat === c ? 'white' : palette.chipText}
                  style={s.catChipIcon}
                />
                <Text style={[s.catChipText, filterCat === c && s.catChipTextOn]}>{t(c)}</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    <FlatList
      data={paged}
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      keyExtractor={(i) => i.id}
      contentContainerStyle={{ paddingVertical: 8 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      onEndReachedThreshold={0.5}
      onEndReached={() => { if (hasMore) setLimit((l) => l + PAGE_SIZE); }}
      removeClippedSubviews
      initialNumToRender={8}
      maxToRenderPerBatch={8}
      windowSize={7}
      updateCellsBatchingPeriod={50}
      ListEmptyComponent={
        <View style={s.emptyWrap}>
          <Ionicons name={kw ? 'search-outline' : 'radio-outline'} size={40} color={palette.dim} />
          <Text style={s.emptyText}>
            {kw ? t('No matches for your filter.') : t('Waiting for posts/requests on the network…')}
          </Text>
        </View>
      }
      ListFooterComponent={
        shown.length > 0 ? (
          <Text style={[s.dim, { textAlign: 'center', padding: 12 }]}>
            {hasMore ? t('Showing {n} of {m} — scroll for more', { n: paged.length, m: shown.length }) : tn(shown.length, '{n} result', '{n} results')}
          </Text>
        ) : null
      }
      renderItem={({ item }) => {
        const p = item.content.payload as Record<string, any>;
        const isRide = item.content.schema.startsWith('rideshare');
        const isSvc = item.content.schema.startsWith('service');
        return (
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.chip}>{isRide ? t('Rideshare') : isSvc ? t('Service/Product') : item.content.market}</Text>
              <Text style={[s.chip, item.content.side === 'offer' ? s.chipGreen : s.chipBlue]}>
                {t(item.content.side)}
              </Text>
              {isRide && p.category ? (
                <View style={s.vehicleChip}>
                  <MaterialCommunityIcons name={(VEHICLE_ICONS[p.category] ?? 'car') as any} size={13} color={palette.chipText} style={{ marginEnd: 4 }} />
                  <Text style={s.vehicleChipText}>{t(p.category)}</Text>
                </View>
              ) : p.category ? <Text style={s.chip}>{t(p.category)}</Text> : null}
              {(() => {
                // Distance from the user's area (selected location, else GPS) to pickup.
                if (!isRide || !ref || !p.from?.geohash) return null;
                const km = distKm(p.from.geohash);
                if (km == null) return null;
                return <Text style={[s.chip, s.distChip]}>📍 {formatDistance(km, country, distanceUnit)}</Text>;
              })()}
              {isSvc && p.subcategory ? <Text style={s.chip}>{t(p.subcategory)}</Text> : null}
              {mine(item) && <Text style={[s.chip, s.chipYou]}>{t("you")}</Text>}
            </View>
            {(() => {
              const prof = client?.profiles.get(item.pubkey);
              const rep = client?.reputations.get(item.pubkey);
              return (
                <View style={{ marginTop: 6 }}>
                  <View style={s.row}>
                    {prof?.picture
                      ? <Image source={{ uri: prof.picture }} style={s.authorAvatar} />
                      : <View style={[s.authorAvatar, s.avatarEmpty]} />}
                    <Text style={s.authorName}>{prof?.name || item.pubkey.slice(0, 10) + '…'}</Text>
                    {prof?.phone && isDisplayablePhone(prof.phone) ? (
                      (() => {
                        // Browse always shows a masked number — even when the poster
                        // publishes their full number to the network (so it feels less
                        // exposed). The full number is still readable at deal time.
                        const callable = extractPhone(prof.phone);
                        const shown = callable ? maskPhone(callable) : prof.phone;
                        return <Text style={s.authorPhone}>📱 {shown}</Text>;
                      })()
                    ) : null}
                    {rep?.newAccount && <Text style={s.newBadge}>{t("new account")}</Text>}
                  </View>
                  {(prof?.vehicleModel || prof?.plate) ? (
                    <Text style={s.authorVehicle}>🚗 {[prof.vehicleModel, prof.plate].filter(Boolean).join(' · ')}</Text>
                  ) : null}
                  {rep && rep.deals > 0 && (
                    <Text style={s.repLine}>
                      {rep.ratingCount > 0 ? `${rep.label} · ` : ''}
                      {t('{deals} deals · {partners} partners · {inNetwork} in your network', { deals: rep.deals, partners: rep.partners, inNetwork: rep.partnersInNetwork })}
                      {rep.verifiedBy > 0 ? ` · 📱 ${t('verified by {n}', { n: rep.verifiedBy })}` : ''}
                    </Text>
                  )}
                </View>
              );
            })()}
            <Text style={s.cardTitle}>{isRide ? myPostTitle(item) : item.content.title}</Text>
            {isRide && p.note ? <Row label={t("Note")} value={p.note} /> : null}
            {isSvc && (
              <>
                <Row label={t("Service")} value={p.service} />
                <Row label={t("Location")} value={p.location?.name} />
                {p.duration_minutes && <Row label={t("Duration")} value={`${p.duration_minutes} min`} />}
                {p.notes && <Row label={t("Notes")} value={p.notes} />}
              </>
            )}
            {p.payment ? <Text style={s.priceTag}>💵 {p.payment}</Text> : null}
            {!isRide && item.content.window && (
              <Row label={t("Time")} value={fmtWindow(item.content.window)} />
            )}
            {Array.isArray(p.images) && p.images.length > 0 && (
              <View style={s.imageGrid}>
                {(p.images as string[]).map((url: string) => (
                  <Pressable key={url} onPress={() => setCardViewerUri(url)}>
                    <Image source={{ uri: url }} style={s.imageThumb} />
                  </Pressable>
                ))}
              </View>
            )}
            {isRide && p.from?.name && p.to?.name && (
              <Pressable style={s.mapLink} onPress={() => openMaps(routeUrl(placeParam(p.from?.geohash, p.from.name), placeParam(p.to?.geohash, p.to.name)))}>
                <Text style={s.mapLinkText}>{'🗺 ' + t('View route in Google Maps')}</Text>
              </Pressable>
            )}
            {isSvc && p.location?.geohash && (
              <>
                <View style={s.btnRow}>
                  <Pressable
                    style={s.mapLink}
                    onPress={() => setMapOpenId(mapOpenId === item.id ? null : item.id)}
                  >
                    <Text style={s.mapLinkText}>{mapOpenId === item.id ? '▾ ' + t('Hide map') : '🗺 ' + t('Show area map')}</Text>
                  </Pressable>
                  <Pressable
                    style={s.mapLink}
                    onPress={() => openMaps(placeUrl(p.location?.name ?? '', p.location?.geohash))}
                  >
                    <Text style={s.mapLinkText}>{t("Open in Google Maps")}</Text>
                  </Pressable>
                </View>
                {mapOpenId === item.id && (
                  <ServiceAreaMap name={p.location?.name ?? ''} geohash={p.location.geohash} />
                )}
              </>
            )}
            <Text style={s.meta}>
              {item.pubkey.slice(0, 10)}… · expires {new Date(item.content.expires_at * 1000).toLocaleTimeString()}
            </Text>

            {/* Respond — open a negotiation with this poster. */}
            {(() => {
              const already = respondedIds.has(item.id) || client?.hasNegotiationFor(item) === true;
              if (already) {
                return <Text style={s.respondedText}>{'✓ ' + t('Responded — see Messages tab')}</Text>;
              }
              if (respondingId === item.id) {
                return (
                  <RespondEditor
                    intent={item}
                    onSend={async (terms, accepting) => {
                      // Unchanged time + amount → one-tap accept that confirms
                      // the deal outright (no offer round, no owner confirm).
                      // Otherwise it's a counter-offer the owner still accepts.
                      if (accepting) await client?.acceptIntent(item, terms, myContact(item));
                      else await client?.respond(item, terms, myContact(item));
                      setRespondedIds((prev) => new Set([...prev, item.id]));
                      setRespondingId(null);
                    }}
                    onCancel={() => setRespondingId(null)}
                  />
                );
              }
              return (
                <Pressable style={s.respondBtn} onPress={() => setRespondingId(item.id)}>
                  <Text style={s.respondBtnText}>
                    {mine(item) ? 'Respond (self-test)' : isRide ? t('Offer to take this ride') : t('Respond')}
                  </Text>
                </Pressable>
              );
            })()}
          </View>
        );
      }}
    />
    <Modal visible={!!cardViewerUri} transparent animationType="fade" onRequestClose={() => setCardViewerUri(null)}>
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
          {cardViewerUri ? <Image source={{ uri: cardViewerUri }} style={s.imgViewerImage} resizeMode="contain" /> : null}
        </ScrollView>
        <Pressable style={s.imgViewerClose} onPress={() => setCardViewerUri(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Close image')}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
      </View>
    </Modal>
    </View>
  );
}

type SortKey = 'none' | 'best' | 'nearby' | 'amount' | 'time' | 'karma';
const SORT_LABEL: Record<SortKey, string> = {
  none: 'None',
  best: 'Best',
  nearby: 'Nearby',
  amount: 'Amount',
  time: 'Time',
  karma: 'Karma',
};
/** Ionicon per sort key — compact icons + short labels in the Sort sheet. */
const SORT_ICON: Record<SortKey, IoniconName> = {
  none: 'remove-outline',
  best: 'sparkles-outline',
  nearby: 'location-outline',
  amount: 'cash-outline',
  time: 'time-outline',      // analog clock face
  karma: 'star-outline',
};
const SORT_CHOICES: SortKey[] = ['best', 'nearby', 'amount', 'time', 'karma'];

function primaryGeohash(i: Intent): string | undefined {
  const p = i.content.payload as Record<string, any>;
  return i.content.schema.startsWith('rideshare') ? p.from?.geohash : p.location?.geohash;
}

/** Comparator for one sort key. Sensible direction baked in per criterion. */
function compareBy(key: SortKey, a: Intent, b: Intent, client: MobileClient | null, userGeohash: string | null, distKm?: (gh?: string | null) => number | null): number {
  switch (key) {
    case 'best': { // composite: float reputable/verified/PoW'd posts above spam
      const now = Date.now() / 1000;
      const score = (i: Intent) => {
        const rep = client?.reputations.get(i.pubkey);
        const hoursAgo = (now - i.createdAt) / 3600;
        let pow = 0;
        try { pow = getPow(i.id); } catch {}
        return (rep?.score ?? 0) * 60        // avg karma (-1..2)
          + (rep?.partnersInNetwork ?? 0) * 40 // proven deals in your network
          + (rep?.verifiedBy ?? 0) * 20        // peer-verified contact
          + pow                                // anti-spam work
          - hoursAgo * 0.5;                    // mild recency
      };
      return score(b) - score(a);
    }
    case 'time': // newest first
      return b.createdAt - a.createdAt;
    case 'amount': { // highest first (cross-currency compared by raw magnitude)
      const amt = (i: Intent) => parsePayment((i.content.payload as any).payment, 'SGD').amount;
      return amt(b) - amt(a);
    }
    case 'karma': { // highest score first
      const sc = (i: Intent) => client?.reputations.get(i.pubkey)?.score ?? 0;
      return sc(b) - sc(a);
    }
    case 'nearby': { // closest first; unknown distance sinks to the bottom
      if (!userGeohash) return 0;
      const dist = (i: Intent) => {
        const gh = primaryGeohash(i);
        const d = distKm ? distKm(gh) : (gh ? distanceKmBetweenGeohashes(userGeohash, gh) : null);
        return d ?? Infinity;
      };
      return dist(a) - dist(b);
    }
    default:
      return 0;
  }
}

function SortModal({
  visible,
  prefs,
  onChange,
  onClose,
  nearbyDisabled,
}: {
  visible: boolean;
  prefs: SortKey[];
  onChange: (p: SortKey[]) => void;
  onClose: () => void;
  nearbyDisabled: boolean;
}) {
  const setLevel = (level: number, key: SortKey) => {
    const next = [...prefs];
    next[level] = key === next[level] ? 'none' : key; // tap again to clear
    onChange(next);
  };
  const tiers = ['First sort', 'Second sort', 'Third sort'];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.sortBackdrop} onPress={onClose}>
        <Pressable style={s.sortSheet} onPress={() => {}}>
          <Text style={s.sectionTitle}>{t("Sort preference")}</Text>
          <Text style={s.dim}>{t("Ties on the first sort fall through to the second, then the third.")}</Text>
          {tiers.map((tier, level) => (
            <View key={tier} style={{ marginTop: 14 }}>
              <Text style={s.label}>{tier}</Text>
              <View style={s.sortChips}>
                {SORT_CHOICES.map((key) => {
                  const selected = prefs[level] === key;
                  const disabled = key === 'nearby' && nearbyDisabled;
                  return (
                    <Pressable
                      key={key}
                      style={[s.sortChip, s.sortChipRow, selected && s.sortChipOn, disabled && { opacity: 0.4 }]}
                      onPress={() => !disabled && setLevel(level, key)}
                    >
                      <Ionicons
                        name={SORT_ICON[key]}
                        size={15}
                        color={selected ? '#fff' : palette.muted}
                      />
                      <Text style={[s.sortChipText, selected && s.sortChipTextOn]}>
                        {t(SORT_LABEL[key])}{key === 'nearby' && disabled ? ' (no GPS)' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
          <Pressable style={[s.btnAccept, { marginTop: 20 }]} onPress={onClose}>
            <Text style={s.btnText}>{t("Done")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Inline map for a service location: marker at the geohash center with a
 * 5km-radius circle. The geohash is only ~±0.6km precise — the circle honestly
 * communicates "somewhere in this area" rather than a false exact pin.
 */
function ServiceAreaMap({ name, geohash }: { name: string; geohash: string }) {
  const center = geohashToCoords(geohash);
  if (!center) return null;
  return <AreaMap center={center} radiusMeters={5000} style={s.map} />;
}

// ─── Post tab ────────────────────────────────────────────────────────────────

function PostTab({
  client,
  profile,
  myIntents,
  negos,
  servicesEnabled,
  defaultCurrency,
  location,
  role,
  browseCategory,
  browseSubcategory,
  onScroll,
}: {
  client: MobileClient | null;
  profile: UserProfile;
  myIntents: Intent[];
  negos: Negotiation[];
  servicesEnabled: boolean;
  defaultCurrency: Currency;
  location: UserLocation;
  role: 'passenger' | 'driver' | '';
  browseCategory?: string;
  browseSubcategory?: string;
  onScroll?: (e: any) => void;
}) {
  // Pre-select the post type + category from the user's Browse preference, so a
  // new post defaults to whatever they're set up to browse. A service category
  // opens the Service/Product form; anything else (incl. Ridesharing) stays on
  // Rideshare. The user can still switch — this is only the default.
  const browseIsService = !!browseCategory && SERVICE_CATEGORIES.includes(browseCategory);
  const [type, setType] = useState<PostType>(browseIsService ? 'service' : 'rideshare');
  // Force rideshare when the Service/Product vertical is disabled
  const activeType = servicesEnabled ? type : 'rideshare';
  // Animate the form in on the next line when switching segment (Rideshare ↔
  // Service/Product), so the choices ease in rather than snapping.
  const formAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    formAnim.setValue(0);
    Animated.timing(formAnim, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [type, formAnim]);
  // Right after a successful post, fold the form away and reveal My Requests so
  // the user sees their fresh listing instead of an empty form.
  const [formOpen, setFormOpen] = useState(true);
  const [postsOpen, setPostsOpen] = useState(true);
  const markPosted = () => { setFormOpen(false); setPostsOpen(true); };
  const formTitle = t(role === 'passenger' ? 'New Request' : 'New Post');
  const formScroll = useRef<ScrollView>(null);  // so a form can scroll a missing required field into view
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView ref={formScroll} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled" onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        {(() => {
          const nowSec = Math.floor(Date.now() / 1000);
          // Show only LIVE, still-open requests here. Drop:
          //  - withdrawn posts;
          //  - posts that have closed a confirmed deal — those are managed in
          //    Messages (Active while in progress, Completed when done) and can't
          //    be cancelled from here anyway, so leaving them lingered as an
          //    "open request" with no cancel button was confusing;
          //  - posts past their expiry / requested time (surface as a System
          //    notice in Messages instead). Re-evaluated on the minute tick.
          const posts = myIntents.filter((i) => {
            if ((i.content.payload as any)?.withdrawn) return false;
            const confirmed = negos.some((n) => n.intent.id === i.id && n.state === 'confirmed');
            if (confirmed) return false;
            const deadByTime = i.content.expires_at < nowSec || (!!i.content.window && i.content.window.start < nowSec);
            if (deadByTime) return false;
            return true;
          });
          if (posts.length === 0) return null;
          // Still waiting on at least one live post that hasn't closed a deal yet.
          const waiting = posts.some(
            (i) => i.content.expires_at >= nowSec && !negos.some((n) => n.intent.id === i.id && n.state === 'confirmed'),
          );
          return (
            <>
              {waiting && (
                <View style={{ marginBottom: 2 }}>
                  <WaitingBar />
                  <Text style={s.dim}>{t('Waiting for offers from Drivers/Providers… You will receive a message once someone accepts your offer.')}</Text>
                </View>
              )}
              <Pressable style={[s.collapseHeader, { marginTop: waiting ? 14 : 0 }]} onPress={() => setPostsOpen((v) => !v)}>
                <Text style={s.sectionTitle}>{t(role === 'passenger' ? 'My Requests' : 'My Posts')} ({posts.length})</Text>
                <Text style={s.collapseChevron}>{postsOpen ? '▾' : '▸'}</Text>
              </Pressable>
              {postsOpen && [...posts]
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((intent) => <MyPostCard key={intent.d} intent={intent} negos={negos} client={client} />)}
            </>
          );
        })()}

        <Pressable style={[s.collapseHeader, { marginTop: 28 }]} onPress={() => setFormOpen((v) => !v)}>
          <Text style={s.collapseTitle}>{formTitle}</Text>
          <Text style={s.collapseChevron}>{formOpen ? '▾' : '▸'}</Text>
        </Pressable>
        {formOpen && (
          <>
            {servicesEnabled && (
              <View style={s.segRow}>
                {(['rideshare', 'service'] as PostType[]).map((pt) => (
                  <Pressable key={pt} onPress={() => setType(pt)} style={[s.seg, type === pt && s.segActive]}>
                    <Ionicons
                      name={pt === 'rideshare' ? 'car-outline' : 'pricetags-outline'}
                      size={16}
                      color={type === pt ? palette.chipBlueText : palette.dim}
                      style={{ marginEnd: 6 }}
                    />
                    <Text style={[s.segText, type === pt && s.segTextActive]}>{t(pt === 'rideshare' ? 'Rideshare' : 'Service/Product')}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Animated.View style={{ opacity: formAnim, transform: [{ translateY: formAnim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
              {activeType === 'rideshare'
                ? <RideshareForm client={client} profile={profile} defaultCurrency={defaultCurrency} location={location} onPosted={markPosted} myIntents={myIntents} negos={negos} scrollRef={formScroll} />
                : <ServiceForm client={client} profile={profile} defaultCurrency={defaultCurrency} location={location} onPosted={markPosted} defaultCategory={browseIsService ? browseCategory : undefined} defaultSubcategory={browseIsService ? browseSubcategory : undefined} scrollRef={formScroll} />}
            </Animated.View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Trim a (often reverse-geocoded) place name to its leading components so ride
 * titles stay short — e.g. "123 Main St, Williamsburg, Brooklyn, New York"
 * → "123 Main St, Williamsburg". Already-short names pass through.
 */
function shortPlace(name: string, maxParts = 2): string {
  return name.split(',').map((s) => s.trim()).filter(Boolean).slice(0, maxParts).join(', ');
}

/**
 * Vehicle option label: the (unchanged) translated category name with its seat
 * count appended, e.g. "Compact Car · 4 seaters". Vehicles with no known
 * capacity (e.g. Others) render the plain name.
 */
function vehicleLabel(v: string): string {
  const n = VEHICLE_SEATERS[v];
  if (!n) return t(v);
  return tn(n, '{vehicle} · {n} seater', '{vehicle} · {n} seaters', { vehicle: t(v) });
}

/**
 * Title shown on ride cards (My Posts + Browse). Rides are rendered uniformly
 * as "📍<from> → <to> 🕓 <time>" derived from the payload — with the pickup
 * shortened to its leading components — so even older posts whose stored title
 * used the legacy/long format display the new short format. Non-ride posts keep
 * their stored title.
 */
function myPostTitle(intent: Intent): string {
  if (!intent.content.schema.startsWith('rideshare')) return intent.content.title;
  const p = intent.content.payload as Record<string, any>;
  const from = shortPlace(String(p.from?.name ?? '').trim());
  const to = String(p.to?.name ?? '').trim();
  if (!from && !to) return intent.content.title;
  const win = intent.content.window;
  const timeStr = win ? ' 🕓 ' + fmtClockTitle(new Date(win.start * 1000)) : '';
  return `📍${from}${to ? ' → ' + to : ''}${timeStr}`;
}

/** Indeterminate "running line" — a segment sliding across, to reassure the
 *  user that their post is live while they wait for offers. */
function WaitingBar() {
  const [w, setW] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!w) return;
    const anim = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
    );
    anim.start();
    return () => anim.stop();
  }, [w]);
  const fillW = Math.max(40, w * 0.35);
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-fillW, w] });
  return (
    <View style={s.waitTrack} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && <Animated.View style={[s.waitFill, { width: fillW, transform: [{ translateX }] }]} />}
    </View>
  );
}

function MyPostCard({ intent, negos, client }: { intent: Intent; negos: Negotiation[]; client: MobileClient | null }) {
  const now = Math.floor(Date.now() / 1000);
  const expired = intent.content.expires_at < now;
  const related = negos.filter((n) => n.intent.id === intent.id);
  const confirmed = related.filter((n) => n.state === 'confirmed').length;
  const active = related.filter((n) => n.state === 'open' || n.state.startsWith('accepted')).length;

  const minsLeft = Math.max(0, Math.round((intent.content.expires_at - now) / 60));
  const expiresIn = minsLeft >= 60 ? t('{h}h {m}m', { h: Math.floor(minsLeft / 60), m: minsLeft % 60 }) : t('{m}m', { m: minsLeft });

  // Passenger can cancel/delete a request that hasn't closed a deal. Two-tap
  // inline confirm (Alert is a no-op on react-native-web).
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const canCancel = confirmed === 0 && !expired && !(intent.content.payload as any)?.withdrawn;
  const doCancel = async () => {
    if (!client) return;
    setCancelling(true);
    try { await client.withdrawIntent(intent); } catch {} finally { setCancelling(false); setConfirming(false); }
  };

  return (
    <View style={[s.card, { marginHorizontal: 0 }]}>
      <View style={[s.row, { flexWrap: 'wrap' }]}>
        {/* Rideshare's type chip is dropped: the "Ridesharing" category chip below
            already says it. Service/Product keeps it (its category differs). */}
        {!intent.content.schema.startsWith('rideshare') && (
          <Text style={s.chip}>{t('Service/Product')}</Text>
        )}
        <Text style={[s.chip, intent.content.side === 'offer' ? s.chipGreen : s.chipBlue]}>
          {t(intent.content.side)}
        </Text>
        {(() => {
          const pl = intent.content.payload as any;
          const cat = categoryOf(intent.content.schema, pl);
          const sub = subcategoryOf(intent.content.schema, pl);
          return (
            <>
              {cat ? <Text style={s.chip}>{t(cat)}</Text> : null}
              {sub ? <Text style={s.chip}>{t(sub)}</Text> : null}
            </>
          );
        })()}
        {confirmed > 0
          ? <Text style={[s.chip, s.chipGreen]}>{t("deal confirmed")}</Text>
          : expired
            ? <Text style={[s.chip, s.chipRed]}>{t("expired")}</Text>
            : <Text style={[s.chip, s.chipGreen]}>{t('live · {time} left', { time: expiresIn })}</Text>}
      </View>
      <Text style={s.cardTitle}>{myPostTitle(intent)}</Text>
      <Text style={s.meta}>
        {related.length === 0
          ? t('No responses yet')
          : tn(related.length, '{n} response', '{n} responses') +
            (active > 0 ? t(' · {n} negotiating', { n: active }) : '') +
            (confirmed > 0 ? t(' · {n} confirmed', { n: confirmed }) : '') +
            t(' — see Messages tab')}
      </Text>
      {canCancel && (
        confirming ? (
          <View style={s.btnRow}>
            <Pressable style={[s.btnDecline, { flex: 1 }]} disabled={cancelling} onPress={() => { doCancel(); }}>
              {cancelling ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Confirm cancel')}</Text>}
            </Pressable>
            <Pressable style={[s.btnAccept, { flex: 1 }]} disabled={cancelling} onPress={() => setConfirming(false)}>
              <Text style={s.btnText}>{t('Keep request')}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable style={s.cancelBtn} hitSlop={8} onPress={() => setConfirming(true)}>
            <Text style={s.cancelBtnText}>{t('Cancel request')}</Text>
          </Pressable>
        )
      )}
    </View>
  );
}

// Wraps a required form field so it can be flagged when it blocks Publish:
// pulses a red outline (absolute overlay, so layout never shifts) and forwards
// its layout node so the form can scroll it into view.
const RequiredField = React.forwardRef<View, { active: boolean; nonce: number; children: React.ReactNode }>(
  ({ active, nonce, children }, ref) => {
    const glow = useRef(new Animated.Value(0)).current;
    useEffect(() => {
      if (!active) { glow.stopAnimation(); glow.setValue(0); return; }
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 480, useNativeDriver: false }),
          Animated.timing(glow, { toValue: 0, duration: 480, useNativeDriver: false }),
        ]),
        { iterations: 3 },
      );
      loop.start();
      return () => loop.stop();
    }, [active, nonce, glow]);
    return (
      <View ref={ref}>
        {children}
        <Animated.View
          pointerEvents="none"
          style={{ position: 'absolute', top: -3, left: -3, right: -3, bottom: -3, borderWidth: 2, borderColor: palette.danger, borderRadius: 14, opacity: glow }}
        />
      </View>
    );
  },
);

// Shared logic for "Publish blocked by a missing field": register a node per
// required field, then `focus(key)` scrolls it into view and flags it to pulse.
// On web Alert.alert is a no-op, so this visual cue is the only feedback there.
function useRequiredFields(scrollRef?: React.RefObject<ScrollView | null>) {
  const nodes = useRef<Record<string, View | null>>({});
  const [flag, setFlag] = useState<{ key: string; n: number }>({ key: '', n: 0 });
  const register = (key: string) => (node: View | null) => { nodes.current[key] = node; };
  const focus = (key: string) => {
    setFlag((f) => ({ key, n: f.n + 1 }));
    const node = nodes.current[key];
    if (!node) return;
    // Defer a tick so any just-opened section is laid out before measuring.
    // Platform split lives in scrollNodeIntoView (unit-tested): on web the ref
    // IS the DOM element and findNodeHandle THROWS (GlitchTip FREEPORT-1) —
    // it must only ever be called on the native path.
    setTimeout(() => {
      scrollNodeIntoView(node as unknown as ScrollableNode, scrollRef?.current ?? null, {
        isWeb: Platform.OS === 'web',
        findHandle: (sv) => findNodeHandle(sv as any),
      });
    }, 60);
  };
  return { register, focus, flag };
}

function RideshareForm({ client, profile, defaultCurrency, location, onPosted, myIntents, negos, scrollRef }: { client: MobileClient | null; profile: UserProfile; defaultCurrency: Currency; location: UserLocation; onPosted?: () => void; myIntents: Intent[]; negos: Negotiation[]; scrollRef?: React.RefObject<ScrollView | null> }) {
  // Rideshare is one-directional: passengers post ride requests; drivers pick
  // them from the market and respond. Drivers never post, so no offer side.
  const [from, setFrom] = useState('');
  const [fromGeohash, setFromGeohash] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [category, setCategory] = useState(DEFAULT_RIDESHARE_SUBCATEGORY);
  // Prefill from a Telegram "broadcast to Freeport" deep link (web only):
  // ?tab=post&from=…&to=… fills the route text (the user still pins the map to
  // set the geohash). Time/pax are left to the form — free-text "now" parsing
  // is unreliable and better chosen explicitly.
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.location) return;
    const q = new URLSearchParams(window.location.search);
    if (q.get('tab') !== 'post') return;
    const qf = q.get('from'); const qt = q.get('to');
    if (qf) setFrom(qf);
    if (qt) setTo(qt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [time, setTime] = useState<Date>(defaultIntentTime);
  const [flexible, setFlexible] = useState(false);
  const [payAmount, setPayAmount] = useState(0);
  const [payCurrency, setPayCurrency] = useState<Currency>(defaultCurrency);
  // There's no currency chooser — payment currency follows the user's country.
  // defaultCurrency can resolve AFTER this form mounts (location loads async),
  // so keep it in sync or early posts get stamped with the SGD fallback.
  useEffect(() => { setPayCurrency(defaultCurrency); }, [defaultCurrency]);
  const [note, setNote] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const [limitErr, setLimitErr] = useState('');
  // Destination coords (from an autocomplete pick) → lets us estimate the fare.
  const [toCoords, setToCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  // Home-location coords, so destination suggestions are biased to the user's
  // area even before a pickup is pinned.
  const [homeCoords, setHomeCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  useEffect(() => {
    const place = [location.city, location.state, COUNTRY_NAME[location.country] || location.country].filter(Boolean).join(', ');
    if (!place) { setHomeCoords(null); return; }
    let cancelled = false;
    geohashForPlace(place, '').then((gh) => { if (!cancelled) setHomeCoords(gh ? geohashToCoords(gh) : null); }).catch(() => {});
    return () => { cancelled = true; };
  }, [location.country, location.state, location.city]);
  // If the destination was typed (not picked from autocomplete), it has no
  // coords — forward-geocode it (debounced) so the fare estimate can compute
  // without the user having to select a suggestion.
  useEffect(() => {
    if (toCoords || !to.trim()) return;
    let cancelled = false;
    const h = setTimeout(() => {
      forwardGeocode(to.trim()).then((c) => { if (!cancelled && c) setToCoords(c); }).catch(() => {});
    }, 700);
    return () => { cancelled = true; clearTimeout(h); };
  }, [to, toCoords]);
  // Suggestion reference: the pinned pickup if set, else the home location.
  const toNear = useMemo(() => (fromGeohash ? geohashToCoords(fromGeohash) : homeCoords), [fromGeohash, homeCoords]);
  const priceSuggestion = useMemo(
    () => suggestPrice({ schemaPrefix: 'rideshare', category: RIDESHARE_CATEGORY, subcategory: category, currency: payCurrency }, client ? [...client.marketIntents.values()] : [], client?.reputations ?? new Map()),
    [client, category, payCurrency],
  );
  // Rough fare estimate from pickup→destination distance + vehicle (when both
  // endpoints are known and the currency has a baseline).
  const fareEstimate = useMemo(() => {
    // Origin: the pinned pickup, else fall back to the user's home location so an
    // estimate is still available before a pickup is dropped on the map.
    const originGh = fromGeohash ?? (homeCoords ? coordsToGeohash(homeCoords.latitude, homeCoords.longitude) : null);
    if (!originGh || !toCoords) return null;
    const km = distanceKmBetweenGeohashes(originGh, coordsToGeohash(toCoords.latitude, toCoords.longitude));
    if (km == null) return null;
    // Peak-hour surge keys off the chosen ride time + the user's country.
    const raw = estimateFare(km, category, payCurrency, flexible ? null : time, location.country);
    return raw == null ? null : snapToStep(raw, payCurrency);
  }, [fromGeohash, homeCoords, toCoords, category, payCurrency, time, flexible, location.country]);

  const req = useRequiredFields(scrollRef);

  const post = async () => {
    if (!client) return;
    // Inline error (not Alert.alert, which is a no-op on web/Home-Screen PWA) so
    // the missing field is reported on every platform; req.focus also scrolls to
    // and pulses the field.
    if (!fromGeohash) { req.focus('from'); setLimitErr(t('Tap “Pin location on map” to set where the ride starts.')); return; }
    if (!to.trim()) { req.focus('to'); setLimitErr(t('Destination (To) is required.')); return; }
    // Anti-spam caps on live ride requests (a request lingers in drivers' search
    // results, so unbounded posting — esp. flexible/long ones — is the abuse
    // vector). Count my own live, unconfirmed, not-withdrawn rideshare requests.
    const nowChk = Math.floor(Date.now() / 1000);
    const liveRides = myIntents.filter((i) =>
      i.content.schema.startsWith('rideshare') &&
      !(i.content.payload as any)?.withdrawn &&
      i.content.expires_at >= nowChk &&
      !(i.content.window && i.content.window.start < nowChk) &&
      !negos.some((n) => n.intent.id === i.id && n.state === 'confirmed'),
    );
    // "Long" = flexible (no fixed time) OR lingers more than 2 hours.
    const isLong = (i: Intent) => !i.content.window || (i.content.expires_at - nowChk) > 7200;
    const newIsLong = flexible || (Math.floor(time.getTime() / 1000) - nowChk) > 7200;
    if (liveRides.length >= 3) {
      setLimitErr(t('You can have at most 3 live ride requests at a time. Cancel one in My Requests first.'));
      Alert.alert(t('Too many requests'), t('You can have at most 3 live ride requests at a time. Cancel one in My Requests first.'));
      return;
    }
    if (newIsLong && liveRides.some(isLong)) {
      setLimitErr(t('You can have only 1 flexible or long (over 2 hours) ride request at a time. Cancel it, or pick a pickup time within 2 hours.'));
      Alert.alert(t('Too many open-ended requests'), t('You can have only 1 flexible or long (over 2 hours) ride request at a time. Cancel it, or pick a pickup time within 2 hours.'));
      return;
    }
    setLimitErr('');
    setPosting(true);
    try {
      const window = timeToWindow(time, flexible);
      // A fixed-time request is only useful until its pickup time, so it expires
      // then; a flexible request has no set time, so it stays live for 24h.
      const nowSec = Math.floor(Date.now() / 1000);
      const expiresAt = window && window.start > nowSec ? window.start : nowSec + 24 * 3600;
      const payment = payAmount > 0 ? fmtPayment(payAmount, payCurrency) : undefined;
      // From is always a pinned geohash; To is geocoded from typed text.
      const fromName = from.trim() || 'Pinned location';
      const [fromGh, toGh] = await Promise.all([
        Promise.resolve(fromGeohash),
        geohashForPlace(to, 'w21zgc'),
      ]);
      await client.postIntent({
        side: 'request',
        market: DEMO_MARKET,
        schema: DEMO_SCHEMA,
        title: `📍${shortPlace(fromName)} → ${to}${flexible ? '' : ' 🕓 ' + fmtClockTitle(time)}`,
        payload: { from: { name: fromName, geohash: fromGh }, to: { name: to, geohash: toGh }, category, payment, note: note.trim() || undefined, images: images.length ? images : undefined },
        window,
        flexMinutes: 30,
        expiresAt,
        geohashes: geohashPrefixes(fromGh.slice(0, 5)),
        topics: intentTopics(location, RIDESHARE_CATEGORY, category),
      }, profile);
      addRecent(to).catch(() => {}); // remember this destination for next time
      // Clear the content fields so a second tap can't re-post the same ride
      // (Alert is a no-op on web, so the cleared form is the "posted" signal).
      setTo(''); setNote(''); setImages([]);
      onPosted?.(); // collapse the form, reveal My Requests
      Alert.alert(t('Posted'), t('Your ride request is live.'));
    } catch (e: any) {
      Alert.alert(t('Not allowed'), e?.message ?? t('Could not post.'));
    } finally { setPosting(false); }
  };

  return (
    <>
      <RequiredField ref={req.register('from')} active={req.flag.key === 'from'} nonce={req.flag.n}>
        <LocationField
          label={t("From *")}
          address={from}
          geohash={fromGeohash}
          onChange={(a, g) => { setFrom(a); setFromGeohash(g); }}
          placeholder={t("e.g. Orchard Rd — or tap 📍 to pin")}
        />
      </RequiredField>
      <RequiredField ref={req.register('to')} active={req.flag.key === 'to'} nonce={req.flag.n}>
        <AddressBookField label={t("To *")} value={to} onChange={(v) => { setTo(v); setToCoords(null); }} placeholder={t("e.g. 123 Main Street")} near={toNear} country={location.country} onSelectCoords={setToCoords} />
      </RequiredField>
      <Text style={s.label}>{t("Vehicle")}</Text>
      <SelectField value={category} options={RIDESHARE_SUBCATEGORIES} onChange={setCategory} icons={VEHICLE_ICONS} labelFor={vehicleLabel} />
      <TimeField time={time} onChange={setTime} flexible={flexible} onFlexible={setFlexible} />
      <PaymentField amount={payAmount} currency={payCurrency} suggestion={priceSuggestion} fareEstimate={fareEstimate} onChange={(a, c) => { setPayAmount(a); setPayCurrency(c); }} />
      <Field label={t("Note")} value={note} onChange={setNote} placeholder={t("e.g. 2 bags, prefer non-smoking")} maxLength={100} multiline />
      <ImagePickerField images={images} onChange={setImages} />
      {!!limitErr && <Text style={s.fieldError}>{limitErr}</Text>}
      <PostButton onPress={post} loading={posting} label={t("Request a ride")} />
    </>
  );
}

function ServiceForm({ client, profile, defaultCurrency, location: userLocation, onPosted, defaultCategory, defaultSubcategory, scrollRef }: { client: MobileClient | null; profile: UserProfile; defaultCurrency: Currency; location: UserLocation; onPosted?: () => void; defaultCategory?: string; defaultSubcategory?: string; scrollRef?: React.RefObject<ScrollView | null> }) {
  // Service convention: the provider posts their offering; customers respond.
  // Seed Category/Subcategory from the user's Browse preference when it names a
  // real service category, falling back to the first category. Subcategory only
  // carries over if it's valid for the seeded category.
  const initialCat = defaultCategory && SERVICE_CATEGORIES.includes(defaultCategory) ? defaultCategory : SERVICE_CATEGORIES[0];
  const initialSub = defaultSubcategory && subcategoriesFor(initialCat).includes(defaultSubcategory)
    ? defaultSubcategory
    : (SERVICE_SUBCATEGORIES[initialCat][0] ?? '');
  const [side, setSide] = useState<'request' | 'offer'>('offer');
  const [postErr, setPostErr] = useState('');
  const [location, setLocation] = useState('');
  const [locationGeohash, setLocationGeohash] = useState<string | null>(null);
  const [service, setService] = useState('');
  const [category, setCategory] = useState(initialCat);
  const [subcategory, setSubcategory] = useState(initialSub);
  const [time, setTime] = useState<Date>(defaultIntentTime);
  // Provider offers default to flexible (a standing offer); customer requests
  // default to a specific time. Toggling side resets to that side's default.
  const [flexible, setFlexible] = useState(true);
  const [payAmount, setPayAmount] = useState(0);
  const [payCurrency, setPayCurrency] = useState<Currency>(defaultCurrency);
  // No currency chooser — keep in sync as defaultCurrency resolves (location
  // loads async), else early posts get the SGD fallback. See RideshareForm.
  useEffect(() => { setPayCurrency(defaultCurrency); }, [defaultCurrency]);
  const [durHours, setDurHours] = useState(1);
  const [durMinutes, setDurMinutes] = useState(0);
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [posting, setPosting] = useState(false);
  const priceSuggestion = useMemo(
    () => suggestPrice({ schemaPrefix: 'service', category, subcategory, currency: payCurrency, durationMin: durHours * 60 + durMinutes }, client ? [...client.marketIntents.values()] : [], client?.reputations ?? new Map()),
    [client, category, subcategory, payCurrency, durHours, durMinutes],
  );

  const req = useRequiredFields(scrollRef);

  const post = async () => {
    if (!client) return;
    // Inline error (not Alert.alert, which is a no-op on web/Home-Screen PWA) so
    // the missing field is reported on every platform; req.focus also scrolls to
    // and pulses the field.
    if (!locationGeohash) { req.focus('location'); setPostErr(t('Tap “Pin location on map” to set where this is.')); return; }
    if (!service.trim()) { req.focus('service'); setPostErr(t('Service / Product is required.')); return; }
    setPostErr('');
    setPosting(true);
    try {
      const window = timeToWindow(time, flexible);
      const nowSec = Math.floor(Date.now() / 1000);
      // Provider offers are standing — live for up to 30 days. Customer requests
      // are time-bound — they expire at the requested time, capped 7 days out.
      const expiresAt = side === 'offer'
        ? nowSec + 30 * 24 * 3600
        : Math.min(window && window.start > nowSec ? window.start : nowSec + 7 * 24 * 3600, nowSec + 7 * 24 * 3600);
      const payment = payAmount > 0 ? fmtPayment(payAmount, payCurrency) : undefined;
      const durationMin = durHours * 60 + durMinutes || undefined;
      const locName = location.trim() || 'Pinned location';
      await client.postIntent({
        side,
        market: SERVICE_MARKET,
        schema: SERVICE_SCHEMA,
        title: `${side === 'request' ? 'Need ' : ''}${service} at ${locName}${flexible ? '' : ' at ' + fmtClock(time)}`,
        payload: {
          location: { name: locName, geohash: locationGeohash },
          service,
          category,
          subcategory: subcategory || undefined,
          payment,
          duration_minutes: durationMin,
          notes: notes || undefined,
          images: images.length ? images : undefined,
        },
        window,
        flexMinutes: 30,
        expiresAt,
        geohashes: geohashPrefixes(locationGeohash.slice(0, 5)),
        topics: intentTopics(userLocation, category, subcategory),
      }, profile);
      // Clear content fields so a second tap can't re-post the same listing.
      setService(''); setNotes(''); setImages([]);
      onPosted?.(); // collapse the form, reveal My Posts
      Alert.alert(t('Posted'), side === 'offer' ? t('Your service offer is live.') : t('Your service request is live.'));
    } catch (e: any) {
      Alert.alert(t('Not allowed'), e?.message ?? t('Could not post.'));
    } finally { setPosting(false); }
  };

  return (
    <>
      <SideToggle side={side} onChange={(sd) => { setSide(sd); setFlexible(sd === 'offer'); }} requestLabel={t("I'm looking for")} offerLabel={t("I provide this")} />
      <RequiredField ref={req.register('location')} active={req.flag.key === 'location'} nonce={req.flag.n}>
        <LocationField
          label={t("Location *")}
          address={location}
          geohash={locationGeohash}
          onChange={(a, g) => { setLocation(a); setLocationGeohash(g); }}
          placeholder={t("e.g. Toa Payoh — or tap 📍 to pin")}
        />
      </RequiredField>
      <Text style={s.label}>{t("Category")}</Text>
      <SelectField
        value={category}
        options={SERVICE_CATEGORIES}
        iconFor={categoryIcon}
        labelFor={t}
        onChange={(c) => {
          setCategory(c);
          setSubcategory(subcategoriesFor(c)[0] ?? ''); // reset sub to first of new category
        }}
      />
      {subcategoriesFor(category).length > 0 && (
        <>
          <Text style={s.label}>{t("Subcategory")}</Text>
          <SelectField
            value={subcategory}
            options={subcategoriesFor(category)}
            iconFor={subcategoryIcon}
            labelFor={t}
            onChange={setSubcategory}
          />
        </>
      )}
      <RequiredField ref={req.register('service')} active={req.flag.key === 'service'} nonce={req.flag.n}>
        <Field label={t("Service / Product *")} value={service} onChange={setService} placeholder={t("e.g. Plumber, Homemade cakes")} />
      </RequiredField>
      <PaymentField amount={payAmount} currency={payCurrency} suggestion={priceSuggestion} onChange={(a, c) => { setPayAmount(a); setPayCurrency(c); }} />
      <TimeField time={time} onChange={setTime} flexible={flexible} onFlexible={setFlexible} />
      <DurationField hours={durHours} minutes={durMinutes} onChange={(h, m) => { setDurHours(h); setDurMinutes(m); }} />
      <Field label={t("Note")} value={notes} onChange={setNotes} placeholder={t("Any details…")} maxLength={100} multiline />
      <ImagePickerField images={images} onChange={setImages} label={t("Photos (optional)")} />
      {!!postErr && <Text style={s.fieldError}>{postErr}</Text>}
      <PostButton onPress={post} loading={posting} label={t("Publish")} />
    </>
  );
}

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
function SlideToConfirm({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const c = palette;
  const THUMB = 54;
  const x = useRef(new Animated.Value(0)).current;
  const maxRef = useRef(0);
  const doneRef = useRef(false);
  const pan = useRef(
    PanResponder.create({
      // The thumb owns the gesture from touch-down so the drag can't be stolen,
      // and we bias to horizontal so a vertical drift doesn't hand off to scroll.
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) >= Math.abs(g.dy),
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) >= Math.abs(g.dy) && Math.abs(g.dx) > 2,
      // Once dragging, do NOT surrender the responder to an ancestor
      // ScrollView/FlatList when the finger drifts vertically — that was what
      // froze the slide mid-track.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderMove: (_e, g) => {
        x.setValue(Math.min(maxRef.current, Math.max(0, g.dx)));
      },
      onPanResponderRelease: (_e, g) => {
        const max = maxRef.current;
        const nx = Math.min(max, Math.max(0, g.dx));
        if (max > 0 && nx >= max - 6 && !doneRef.current) {
          doneRef.current = true;
          Animated.timing(x, { toValue: max, duration: 100, useNativeDriver: false }).start(() => onConfirm());
        } else {
          Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
        }
      },
      // If the OS still force-terminates the gesture, snap back instead of freezing.
      onPanResponderTerminate: () => {
        if (!doneRef.current) Animated.spring(x, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
      },
    }),
  ).current;
  // Screen readers can't perform a drag gesture, so without this a blind
  // driver literally cannot mark a trip picked-up/completed. Expose the slider
  // as a button whose activate action (double-tap in VoiceOver/TalkBack)
  // confirms directly.
  const confirmAccessibly = () => {
    if (doneRef.current || maxRef.current <= 0) return;
    doneRef.current = true;
    Animated.timing(x, { toValue: maxRef.current, duration: 100, useNativeDriver: false }).start(() => onConfirm());
  };
  return (
    <View
      style={s.slideTrack}
      onLayout={(e) => { maxRef.current = Math.max(0, e.nativeEvent.layout.width - THUMB - 6); }}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('Double-tap to confirm')}
      onAccessibilityTap={confirmAccessibly}
      accessibilityActions={[{ name: 'activate' }]}
      onAccessibilityAction={(e) => { if (e.nativeEvent.actionName === 'activate') confirmAccessibly(); }}
    >
      <Text style={s.slideLabel} numberOfLines={1}>{label}</Text>
      <Animated.View style={[s.slideThumb, { transform: [{ translateX: x }] }]} {...pan.panHandlers}>
        <Ionicons name="chevron-forward" size={22} color="#fff" />
      </Animated.View>
    </View>
  );
}

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
function SystemNotice({ text, detail, onDismiss }: { text: string; detail?: string; onDismiss?: () => void }) {
  const c = palette;
  return (
    <View style={s.sysNotice}>
      <View style={s.sysIcon}><Ionicons name="notifications" size={16} color={c.accent} /></View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={s.sysSender}>{t('System')}</Text>
          {onDismiss ? (
            <Pressable onPress={onDismiss} hitSlop={8}><Ionicons name="close" size={16} color={c.muted} /></Pressable>
          ) : null}
        </View>
        <Text style={s.sysText}>{text}</Text>
        {detail ? <Text style={s.sysDetail} numberOfLines={2}>{detail}</Text> : null}
      </View>
    </View>
  );
}

function DealsTab({
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
      if (completedKw && !negoText(n).includes(completedKw)) return false;
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
/** Format an age in seconds as a short human string. */
function formatAge(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  if (d < 1) return t('today');
  if (d < 30) return t('{n}d', { n: d });
  if (d < 365) return t('{n}mo', { n: Math.floor(d / 30) });
  return t('{n}y', { n: Math.floor(d / 365) });
}

/** Compact self stats under the avatar: Karma · Completed deals · Account age.
 *  Tap → open Messages → Completed (feedback received). */
function SelfStats({ client, onPress }: { client: MobileClient; onPress: () => void }) {
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
  const existingPay = parsePayment(existing.payment, 'SGD');
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
function StatusDot({ color, blink, pulsing = true }: { color: string; blink?: boolean; pulsing?: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(1)).current;
  // The halo pulse runs while connecting/offline (or the first 5s online); once
  // the connection settles (pulsing=false) it stops so the dot sits static.
  useEffect(() => {
    if (!pulsing) { pulse.stopAnimation(); pulse.setValue(0); return; }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1600,
        easing: Easing.out(Easing.ease),
        useNativeDriver: Platform.OS !== 'web',
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, pulsing]);
  // Blink mode (e.g. "Updating"): the core fades in/out on a fast loop.
  useEffect(() => {
    if (!blink) { flash.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flash, { toValue: 0.2, duration: 450, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(flash, { toValue: 1, duration: 450, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [blink, flash]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
  return (
    <View style={s.statusDotWrap}>
      {!blink && pulsing && (
        <Animated.View
          pointerEvents="none"
          style={[s.statusHalo, { backgroundColor: color, opacity, transform: [{ scale }] }]}
        />
      )}
      <Animated.View style={[s.statusCore, { backgroundColor: color, shadowColor: color, opacity: flash }]} />
    </View>
  );
}

/**
 * Editor for responding to a market intent (e.g. a driver claiming a ride).
 * Pre-fills from the intent's own terms; the responder proposes price/time and
 * an optional note, opening the negotiation with this first offer.
 */
function RespondEditor({
  intent,
  onSend,
  onCancel,
}: {
  intent: Intent;
  onSend: (terms: ProposedTerms, accepting: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const isRide = intent.content.schema.startsWith('rideshare');
  const p = intent.content.payload as Record<string, any>;
  const intentWindow = intent.content.window;
  const intentPay = parsePayment(p.payment, 'SGD');
  const intentDur = p.duration_minutes ?? 60;
  const [time, setTime] = useState<Date>(() =>
    intentWindow ? new Date(intentWindow.start * 1000) : defaultIntentTime(),
  );
  const [flexible, setFlexible] = useState(!intentWindow);
  const [payAmount, setPayAmount] = useState(intentPay.amount);
  const [payCurrency, setPayCurrency] = useState<Currency>(intentPay.currency);
  const [durHours, setDurHours] = useState(Math.floor(intentDur / 60));
  const [durMinutes, setDurMinutes] = useState(intentDur % 60);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    const terms: ProposedTerms = {
      window: timeToWindow(time, flexible),
      payment: payAmount > 0 ? fmtPayment(payAmount, payCurrency) : undefined,
      note: note || undefined,
    };
    // Keep the route/scope from the intent so the proposal is concrete
    if (isRide) {
      if (p.from?.name) terms.from = p.from.name;
      if (p.to?.name) terms.to = p.to.name;
    } else {
      if (p.location?.name) terms.location = p.location.name;
      if (p.service) terms.service = p.service;
      const dur = durHours * 60 + durMinutes;
      if (dur > 0) terms.duration_minutes = dur;
    }
    setSending(true);
    try {
      await onSend(terms, accepting);
    } catch (e) {
      // Without this, a driver's offer can vanish silently and they wait for a
      // reply that was never sent.
      uiAlert(t('Could not send'), e instanceof Error ? e.message : undefined);
    } finally { setSending(false); }
  };

  // If the responder leaves the requested time AND amount exactly as posted,
  // they're taking the deal as-is rather than haggling — so the action reads
  // "Accept" instead of "Send offer" (the terms sent are identical regardless).
  const proposedWindow = timeToWindow(time, flexible);
  const timeUnchanged =
    (!proposedWindow && !intentWindow) ||
    (!!proposedWindow && !!intentWindow && proposedWindow.start === intentWindow.start);
  const amountUnchanged = payAmount === intentPay.amount && payCurrency === intentPay.currency;
  const accepting = timeUnchanged && amountUnchanged;

  return (
    <View style={s.counterBox}>
      <Text style={s.sectionTitle}>{isRide ? t('Offer to take this ride') : t('Respond with your offer')}</Text>
      {p.payment ? <Text style={s.dim}>Original asking: {p.payment} (prefilled below)</Text> : null}
      {!isRide && (
        <DurationField hours={durHours} minutes={durMinutes} onChange={(h, m) => { setDurHours(h); setDurMinutes(m); }} />
      )}
      <TimeField time={time} onChange={setTime} flexible={flexible} onFlexible={setFlexible} />
      <PaymentField amount={payAmount} currency={payCurrency} onChange={(a, c) => { setPayAmount(a); setPayCurrency(c); }} />
      <Field label={t("Note")} value={note} onChange={setNote} placeholder={t("optional message")} />
      <View style={s.btnRow}>
        <Pressable style={[s.btnAccept, sending && { opacity: 0.6 }]} onPress={send} disabled={sending}>
          {sending ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{accepting ? t("Accept") : t("Send offer")}</Text>}
        </Pressable>
        <Pressable style={s.btnDecline} onPress={onCancel}><Text style={s.btnText}>{t("Cancel")}</Text></Pressable>
      </View>
    </View>
  );
}

/** Free-text chat for a confirmed deal — coordinate pickup, share details. */
/** A chat message that is just an uploaded image URL renders as an image. */
function isImageMsg(t: string): boolean {
  if (!/^https?:\/\//i.test(t)) return false;
  if (isAudioMsg(t)) return false; // audio/voice URLs (also hosted on nostr.build) are not images
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(t) || /nostr\.build|image\.nostr|imgur|i\.ibb/i.test(t);
}

/** A chat message that is an uploaded audio URL renders as a play button. */
function isAudioMsg(t: string): boolean {
  if (!/^https?:\/\//i.test(t)) return false;
  return /\.(m4a|mp3|webm|ogg|caf|mp4|wav|aac)(\?|$)/i.test(t);
}

/** A live-location share link (".../#t=<key>") renders as a tap-to-track button. */
function isTripMsg(t: string): boolean {
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

// ─── Key tab ─────────────────────────────────────────────────────────────────

/**
 * Cross-platform confirm. React Native's Alert with buttons is a no-op on
 * react-native-web, so a button's onPress never fires there — use window.confirm
 * on web and Alert on native. Resolves true when the user confirms.
 */
function confirmAsync(title: string, message: string, confirmLabel: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: t('Cancel'), style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
}

function SettingsTab({
  npub,
  signerRef,
  profile,
  client,
  onOpenFeedback,
  onReplayTour,
  requiredLocOk,
  requiredNotifOk,
  onDismissNotif,
  onRequiredRefresh,
  onProfileChange,
  onRestore,
  servicesEnabled,
  onServicesEnabledChange,
  location,
  onLocationChange,
  useNip07,
  onUseNip07Change,
  theme,
  onThemeChange,
  distanceUnit,
  onDistanceUnitChange,
  sendLocationOnDeal,
  onSendLocationOnDealChange,
  telemetryEnabled,
  onTelemetryChange,
  browseCategory,
  browseSubcategory,
  browseAlertSound,
  browseAlertNotify,
  browseMaxDistance,
  onBrowsePrefChange,
  role,
  onRoleChange,
  language,
  onLanguageChange,
  fareConfig,
  fareDefaults,
  fareCurrency,
  onFareConfigChange,
  onSignOut,
  onDeleteAccount,
  onScroll,
}: {
  npub: string;
  signerRef: React.MutableRefObject<Signer | null>;
  profile: UserProfile;
  client: MobileClient | null;
  onOpenFeedback: () => void;
  onReplayTour: () => void;
  requiredLocOk: boolean;
  requiredNotifOk: boolean;
  onDismissNotif: () => void;
  onRequiredRefresh: (override?: { loc?: boolean; notif?: boolean }) => void;
  onProfileChange: (p: UserProfile) => Promise<void>;
  onRestore: () => void;
  servicesEnabled: boolean;
  onServicesEnabledChange: (v: boolean) => void;
  location: UserLocation;
  onLocationChange: (loc: UserLocation) => void;
  useNip07: boolean;
  onUseNip07Change: (v: boolean) => void;
  theme: 'system' | 'dark' | 'light';
  onThemeChange: (t: 'system' | 'dark' | 'light') => void;
  distanceUnit: 'auto' | 'km' | 'mi';
  onDistanceUnitChange: (u: 'auto' | 'km' | 'mi') => void;
  sendLocationOnDeal: boolean;
  onSendLocationOnDealChange: (v: boolean) => void;
  telemetryEnabled: boolean;
  onTelemetryChange: (v: boolean) => void;
  browseCategory: string;
  browseSubcategory: string;
  browseAlertSound: boolean;
  browseAlertNotify: boolean;
  browseMaxDistance: number;
  onBrowsePrefChange: (p: Partial<{ browseCategory: string; browseSubcategory: string; browseAlertSound: boolean; browseAlertNotify: boolean; browseMaxDistance: number }>) => void;
  role: 'passenger' | 'driver' | '';
  onRoleChange: (r: 'passenger' | 'driver') => void;
  language: string;
  onLanguageChange: (l: string) => void;
  fareConfig: FareConfig | null;
  fareDefaults: FareConfig;
  fareCurrency: Currency;
  onFareConfigChange: (cfg: FareConfig | null) => void;
  onSignOut: () => void | Promise<void>;
  onDeleteAccount: () => void | Promise<void>;
  onScroll?: (e: any) => void;
}) {
  const [name, setName] = useState(profile.name);
  const [about, setAbout] = useState(profile.about);
  const [picture, setPicture] = useState(profile.picture);
  const [gallery, setGallery] = useState<string[]>(profile.gallery ?? []);
  const [phone, setPhone] = useState(profile.phone);
  const [phoneDisplay, setPhoneDisplay] = useState<PhoneDisplay>(profile.phoneDisplay);
  const [externalLink, setExternalLink] = useState(profile.externalLink ?? '');
  const [vehicleModel, setVehicleModel] = useState(profile.vehicleModel ?? '');
  const [plateNumber, setPlateNumber] = useState(profile.plateNumber ?? '');
  const [plateDisplay, setPlateDisplay] = useState<PhoneDisplay>(profile.plateDisplay ?? 'masked');
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneWarnOpen, setPhoneWarnOpen] = useState(false);
  const isProvider = role === 'driver' && servicesEnabled;
  const isDriver = role === 'driver';
  // A Customer (passenger with services on) browses provider offers, so it gets
  // the same Browse preference as a Provider. Only a pure Passenger has none.
  const isCustomer = role === 'passenger' && servicesEnabled;
  const browsePicksCategory = isProvider || isCustomer;
  // Browse-preference helpers: a Driver is fixed to Ridesharing; a Provider or
  // Customer may pick any category. Subcategory options follow the chosen category.
  const browseCat = browsePicksCategory ? (browseCategory || RIDESHARE_CATEGORY) : RIDESHARE_CATEGORY;
  const browseCatOptions = [RIDESHARE_CATEGORY, ...SERVICE_CATEGORIES];
  const browseSubOptions = subcategoriesFor(browseCat);
  const browseEffSub = browseSubcategory && browseSubOptions.includes(browseSubcategory)
    ? browseSubcategory
    : (browseCat === RIDESHARE_CATEGORY ? DEFAULT_RIDESHARE_SUBCATEGORY : (browseSubOptions[0] ?? ''));
  const browseUnit = distanceUnit === 'auto' ? (location.country === 'US' ? 'mi' : 'km') : distanceUnit;
  const dialCode = useRef('+84');
  const autoFilledDial = useRef('');

  // Prefill the dial code from the user's detected country (GPS or IP), only
  // while the phone field is still empty/auto-filled. If the country can't be
  // determined, leave it blank — never default to a prefix like +1.
  React.useEffect(() => {
    let cancelled = false;
    const prefill = (dial: string | null | undefined) => {
      if (cancelled || !dial) return;
      setPhone((p) => {
        const cur = p.trim();
        if (cur !== '' && cur !== autoFilledDial.current.trim()) return p;
        dialCode.current = dial;
        autoFilledDial.current = dial + ' ';
        return dial + ' ';
      });
    };
    const known = dialForCountry(location.country);
    if (known) prefill(known);
    else detectDialCode().then(prefill);
    return () => { cancelled = true; };
  }, [location.country]);

  const normalizePhoneField = () => {
    const raw = phone.trim();
    // Untouched prefill or empty → treat as no phone
    if (!raw || raw === dialCode.current) { setPhone(''); setPhoneError(null); return null; }
    const r = normalizePhone(raw, dialCode.current);
    if (r.valid) {
      setPhone(r.formatted); // "5551234567" → "+1 555 123 4567"
      setPhoneError(null);
      return r.e164;
    }
    setPhoneError(r.error ?? 'Invalid phone number');
    return null;
  };
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  // Cloud backup (iCloud Keychain / Google Block Store). When available, it's
  // the default; "Back up to a file instead" switches to the file flow.
  const cloudOn = cloudAvailable();
  const [useFileBackup, setUseFileBackup] = useState(false);
  const [cloudStatus, setCloudStatus] = useState<string | null>(null);
  // Whether this device's key is already in the cloud — used to hide the
  // "back it up" reminder once it is. Checked on mount; set after a manual save.
  const [cloudBackedUp, setCloudBackedUp] = useState(false);
  React.useEffect(() => {
    if (!cloudOn) return;
    let cancelled = false;
    (async () => {
      try {
        // Cloud now stores a JSON bundle containing the nsec (legacy values are a
        // bare nsec). Either way, "backed up" = the cloud copy contains this key.
        const [saved, current] = await Promise.all([cloudRestore(), getStoredNsec()]);
        if (!cancelled) setCloudBackedUp(!!saved && !!current && saved.includes(current));
      } catch { /* leave false */ }
    })();
    return () => { cancelled = true; };
  }, [cloudOn]);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(true);
  const [locationOpen, setLocationOpen] = useState(false);
  const [featuresOpen, setFeaturesOpen] = useState(false);
  const [browsePrefsOpen, setBrowsePrefsOpen] = useState(false);
  // Vehicle Detail: expanded for a pure rideshare Driver (who needs it to take
  // rides), collapsed for a Provider (services vertical) where it's secondary.
  const [vehicleOpen, setVehicleOpen] = useState(!isProvider);
  // When the user switches INTO the Driver role without vehicle details on file,
  // expand + pulse the Vehicle Detail section so they notice they must fill it in.
  const [vehicleGlow, setVehicleGlow] = useState(false);
  const vehGlow = useRef(new Animated.Value(0)).current;
  const settingsScroll = useRef<ScrollView>(null);  // to scroll the Vehicle panel into view
  const vehicleY = useRef(0);                        // its y-offset inside the scroll (via onLayout)
  useEffect(() => {
    if (!vehicleGlow) { vehGlow.stopAnimation(); vehGlow.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(vehGlow, { toValue: 1, duration: 700, useNativeDriver: false }),
      Animated.timing(vehGlow, { toValue: 0, duration: 700, useNativeDriver: false }),
    ]));
    loop.start();
    const off = setTimeout(() => setVehicleGlow(false), 6000);
    return () => { loop.stop(); clearTimeout(off); };
  }, [vehicleGlow, vehGlow]);
  const switchRole = (r: 'passenger' | 'driver') => {
    if (r === 'driver' && !vehicleModel.trim()) {
      setVehicleOpen(true);
      setVehicleGlow(true);
      // Scroll the (now-expanded) Vehicle panel into view once it's laid out.
      setTimeout(() => settingsScroll.current?.scrollTo({ y: Math.max(0, vehicleY.current - 16), animated: true }), 420);
    }
    onRoleChange(r);
  };
  // "Required actions" — surfaced at the top of Settings when setup is incomplete.
  // Source of truth (loc/notif granted, count) lives in the parent so the bottom
  // Settings tab can show a matching badge; here we just render + act on it.
  const vehicleMissing = role === 'driver' && !servicesEnabled && (!vehicleModel.trim() || !plateNumber.trim());
  const grantLocation = async () => {
    let g = false; try { g = await requestLocationPermission(); } catch { /* ignore */ }
    // A `false` here means the OS/browser denied (the request itself prompts when
    // undetermined). Recovery differs by context — once denied, none of these
    // re-prompt, so we point the user to the right setting:
    //   • native      → the app's own iOS Settings page
    //   • iOS PWA      → iPhone Settings → Apps → Freeport → Location
    //   • iOS Safari   → page menu → Website Settings → Location (no address-bar icon)
    //   • desktop web  → the address-bar location icon
    if (!g) {
      if (Platform.OS !== 'web') {
        try { await Linking.openSettings(); } catch { /* ignore */ }
      } else if (isIOSWeb()) {
        // iOS Safari/PWA only deny location for the CURRENT page load — retrying
        // in the same session fails silently, but reloading re-shows the prompt.
        // (Verified in simulator: deny → reload → Allow restores location.)
        try {
          if ((globalThis as any).confirm?.(t('Location was blocked. Reload the page now and tap Allow when asked?'))) {
            (globalThis as any).location?.reload?.();
          }
        } catch { /* ignore */ }
      } else {
        // Desktop/Android web persist the denial per-site; only the browser's own
        // permission UI can undo it.
        uiAlert(t('Location is blocked'), t('Click the location icon in your browser’s address bar to allow it, then try again.'));
      }
    }
    onRequiredRefresh?.(g ? { loc: true } : undefined);
  };
  const enableNotif = async () => {
    // iOS Safari only exposes the Notification API when the app is installed to
    // the Home Screen, not in a regular tab — detect that and guide the user.
    if (Platform.OS === 'web' && typeof Notification === 'undefined') {
      uiAlert(t('Notifications unavailable'), t('To get notifications on iPhone, add Freeport to your Home Screen first (Share → Add to Home Screen), then open it from there.'));
      return;
    }
    let g = false; try { g = await requestNotifications(); } catch { /* ignore */ }
    if (!g) {
      if (Platform.OS !== 'web') { try { await Linking.openSettings(); } catch { /* ignore */ } }
      else if (isStandalonePWA()) uiAlert(t('Notifications are blocked'), t('Notifications are turned off for Freeport. Open iPhone Settings → Apps → Freeport → Notifications, allow them, then reopen Freeport.'));
      else uiAlert(t('Notifications are blocked'), t('Allow notifications for this site in your browser’s site settings, then try again.'));
    }
    onRequiredRefresh?.(g ? { notif: true } : undefined);
  };
  const fillVehicle = () => {
    setVehicleOpen(true);
    setVehicleGlow(true);
    setTimeout(() => settingsScroll.current?.scrollTo({ y: Math.max(0, vehicleY.current - 16), animated: true }), 200);
  };
  // Key loss is permanent (identity + karma). The backup UI lives inside the
  // collapsed "Account & Backup" section, so an un-backed-up key gets a spot
  // in the Required-actions box — the one place users actually look.
  const backupMissing = cloudOn && !cloudBackedUp;
  const hasRequiredActions = !requiredLocOk || !requiredNotifOk || vehicleMissing || backupMissing;
  const [fareOpen, setFareOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // On a mobile-browser web session (not the installed PWA / native app),
  // suggest the native app — shown as a passive notice in About.
  const nativeOS = useMemo<'ios' | 'android' | null>(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return null;
    const w: any = typeof window !== 'undefined' ? window : undefined;
    const standalone = !!(w?.matchMedia?.('(display-mode: standalone)')?.matches) || (navigator as any).standalone === true;
    if (standalone) return null;
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua) || ((navigator as any).platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    return null;
  }, []);
  // Web Push (PWA) — opt-in "new message" notifications via a content-blind sender.
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyHelpOpen, setNotifyHelpOpen] = useState(false);
  const [notifyEndpoint, setNotifyEndpoint] = useState('');
  const [pushState, setPushState] = useState<PushStatus>('off');
  const [pushBusy, setPushBusy] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);
  const [telegramBusy, setTelegramBusy] = useState(false);
  // Android background service toggle.
  const [updBusy, setUpdBusy] = useState(false);
  const [updMsg, setUpdMsg] = useState('');
  const [updTrack, setUpdTrack] = useState<UpdateTrack>('latest');
  const changeTrack = async (track: UpdateTrack) => {
    if (track === updTrack || updBusy) return;
    const ok = await confirmAsync(
      t('Switch update track?'),
      t('This downloads the selected release and restarts the app.'),
      t('Switch'),
    );
    if (!ok) return;
    setUpdBusy(true); setUpdMsg('');
    setUpdTrack(track);
    const r = await setTrack(track);
    if (r.outcome === 'updated') { setUpdMsg(t('Update found — restarting…')); await applyUpdate(); return; }
    setUpdMsg(r.outcome === 'up-to-date' ? t("You're on the latest version.") : t('Could not check for updates.'));
    setUpdBusy(false);
  };
  const checkUpdates = async () => {
    setUpdBusy(true); setUpdMsg('');
    const r = await checkForUpdate();
    if (r.outcome === 'updated') { setUpdMsg(t('Update found — restarting…')); await applyUpdate(); return; }
    setUpdMsg(
      r.outcome === 'up-to-date' ? t("You're on the latest version.")
        : r.outcome === 'unsupported' ? t('Updates aren\'t available in this build.')
        : t('Could not check for updates.')
    );
    setUpdBusy(false);
  };
  React.useEffect(() => {
    loadPrefs().then((p) => { setNotifyEndpoint(p.notifyEndpoint ?? ''); });
    pushStatus().then(setPushState);
    getTrack().then(setUpdTrack).catch(() => {});
  }, []);
  const myPubkeyHex = client?.pubkey ?? '';
  // Reflect whether Telegram is linked (best-effort; only if the server offers it).
  // Debounced so editing the Notification-service-URL field doesn't fire a
  // request per keystroke — it settles, then checks once.
  React.useEffect(() => {
    if (!notifyEndpoint.trim() || !myPubkeyHex) return;
    let cancelled = false;
    const id = setTimeout(() => {
      telegramLinkStatus(notifyEndpoint.trim(), myPubkeyHex).then((v) => { if (!cancelled) setTelegramLinked(v); });
    }, 600);
    return () => { cancelled = true; clearTimeout(id); };
  }, [notifyEndpoint, myPubkeyHex, telegramBusy]);
  // Intent-alert filters for push: only when the user opted into Browse alerts.
  // Topic mirrors what Browse subscribes to (area + default category/subcat), so
  // pushes track new posts in the slice they care about.
  const pushFilters = React.useMemo<PushFilters | undefined>(() => {
    if (!browseAlertNotify) return undefined;
    // Use the EFFECTIVE category/subcategory the Browse UI shows (browseCat/
    // browseEffSub), not the raw pref — otherwise an unset pref ('') fell back to
    // 'All' here while Browse showed Ridesharing, so the push topic was area-only
    // ("sg") and matched every category. This keeps the alert scoped to the slice
    // the user actually sees.
    const topic = browseTopic(location, {
      servicesEnabled,
      filterCat: browseCat,
      filterSub: browseEffSub || null,
    });
    return { topics: [topic] };
  }, [browseAlertNotify, location, servicesEnabled, browseCat, browseEffSub]);
  const togglePush = async () => {
    setPushBusy(true);
    try {
      await savePrefs({ notifyEndpoint: notifyEndpoint.trim() });
      if (pushState === 'on') {
        await disablePush(myPubkeyHex, notifyEndpoint.trim());
        setPushState('off');
        await kvSet('freeport.pushOn', '0').catch(() => {});
      } else {
        const st = await enablePush(myPubkeyHex, notifyEndpoint.trim(), pushFilters);
        setPushState(st);
        // Mark the server as the active notifier so the app skips its local
        // fallback notification (avoids a second alert when you open the app).
        await kvSet('freeport.pushOn', st === 'on' ? '1' : '0').catch(() => {});
      }
    } finally { setPushBusy(false); }
  };
  // Keep the sender's filters in sync when Browse-alert prefs change (cheap —
  // re-registers the existing subscription, no permission prompt / resubscribe).
  React.useEffect(() => {
    if (pushState === 'on' && notifyEndpoint.trim()) {
      void updatePush(myPubkeyHex, notifyEndpoint.trim(), pushFilters);
    }
  }, [pushFilters, pushState]);
  // Editor works off the active config; falls back to the built-in defaults
  // for the current currency/country until the user customizes.
  const fc = fareConfig ?? fareDefaults;
  const setFare = (patch: Partial<FareConfig>) =>
    onFareConfigChange({ ...fc, ...patch, vehicle: { ...fc.vehicle, ...(patch.vehicle ?? {}) } });
  const fareSym = currencySymbol(fareCurrency);
  const [backedUp, setBackedUp] = useState(false);

  // Sync when profile loads from storage after mount
  React.useEffect(() => {
    setName(profile.name);
    setAbout(profile.about);
    setPicture(profile.picture);
    setGallery(profile.gallery ?? []);
    setPhone(profile.phone);
    setPhoneDisplay(profile.phoneDisplay);
    setExternalLink(profile.externalLink ?? '');
    setVehicleModel(profile.vehicleModel ?? '');
    setPlateNumber(profile.plateNumber ?? '');
    setPlateDisplay(profile.plateDisplay ?? 'masked');
  }, [profile.name, profile.about, profile.picture, profile.gallery, profile.phone, profile.phoneDisplay, profile.externalLink, profile.vehicleModel, profile.plateNumber, profile.plateDisplay]);

  const pickAvatar = async () => {
    // System photo picker — no media permission needed (Play-policy compliant).
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const url = await uploadImage(result.assets[0]);
      setPicture(url);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof UploadError ? e.message : 'Try again.');
    } finally { setUploading(false); }
  };

  const doSave = async (e164: string) => {
    setSaving(true);
    try {
      await onProfileChange({
        name, picture, about, gallery, phone: e164, phoneDisplay,
        externalLink: isProvider ? externalLink.trim() : (profile.externalLink ?? ''),
        vehicleModel: isDriver ? vehicleModel.trim() : (profile.vehicleModel ?? ''),
        plateNumber: isDriver ? plateNumber.trim() : (profile.plateNumber ?? ''),
        plateDisplay: isDriver ? plateDisplay : (profile.plateDisplay ?? 'masked'),
      });
      uiAlert(t('Saved'), t('Profile published to relays.'));
    } catch (e: any) {
      uiAlert(t('Could not save'), e?.message ?? '');
    } finally { setSaving(false); }
  };

  const save = () => {
    let e164 = '';
    if (phone.trim() && phone.trim() !== dialCode.current) {
      const normalized = normalizePhoneField();
      if (!normalized) { uiAlert(t('Invalid phone number'), t('Fix the phone number or clear the field.')); return; }
      e164 = normalized;
    }
    doSave(e164);
  };

  const secretKey = signerRef.current?.secretKey ?? null;

  const doBackup = async () => {
    if (!secretKey) return;
    setBackingUp(true);
    try {
      await backupToFile(secretKey, ''); // plain nsec — no password
    } catch (e: any) {
      Alert.alert(t('Backup failed'), e?.message ?? 'Try again.');
    } finally { setBackingUp(false); }
  };

  const doCloudBackup = async () => {
    setBackingUp(true);
    setCloudStatus(null);
    try {
      // Save the full bundle (key + settings + saved addresses), like the file backup.
      const ok = secretKey ? await cloudSave(await buildCloudBundle(secretKey)) : false;
      setCloudBackedUp(ok);
      setCloudStatus(ok ? t('Saved to {name}.', { name: cloudName() }) : t('Backup failed'));
    } catch {
      setCloudStatus(t('Backup failed'));
    } finally { setBackingUp(false); }
  };

  // NOTE: restore-from-file lives only in onboarding ("sign out and choose
  // Restore on the welcome screen") — Settings deliberately has no restore
  // button, so there is no restore handler here.

  return (
    <ScrollView ref={settingsScroll} contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
      {hasRequiredActions && (
        <View style={s.requiredBox}>
          <Text style={s.requiredTitle}>{t("⚠️ Required actions")}</Text>
          {!requiredLocOk && (
            <Pressable style={s.requiredBtn} onPress={grantLocation}>
              <Text style={s.requiredBtnText}>{t("Grant location access")}</Text>
            </Pressable>
          )}
          {!requiredNotifOk && (
            <View style={s.requiredRow}>
              <Pressable style={[s.requiredBtn, { flex: 1 }]} onPress={enableNotif}>
                <Text style={s.requiredBtnText}>{t("Enable notifications")}</Text>
              </Pressable>
              <Pressable style={s.requiredDismiss} onPress={onDismissNotif} accessibilityLabel={t("Dismiss")}>
                <Text style={s.requiredDismissText}>✕</Text>
              </Pressable>
            </View>
          )}
          {vehicleMissing && (
            <Pressable style={s.requiredBtn} onPress={fillVehicle}>
              <Text style={s.requiredBtnText}>{t("Fill in vehicle information")}</Text>
            </Pressable>
          )}
          {backupMissing && (
            <Pressable
              style={s.requiredBtn}
              onPress={() => {
                setIdentityOpen(true);
                setTimeout(() => settingsScroll.current?.scrollToEnd({ animated: true }), 120);
              }}
            >
              <Text style={s.requiredBtnText}>{t("Back up your account — without it, losing this device loses your identity")}</Text>
            </Pressable>
          )}
        </View>
      )}
      <Pressable style={s.collapseHeader} onPress={() => setProfileOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <Ionicons name="person-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t("Profile")}</Text>
        </View>
        <Text style={s.collapseChevron}>{profileOpen ? '▾' : '▸'}</Text>
      </Pressable>
      {profileOpen && (
      <>
      {/* Avatar */}
      <View style={s.avatarRow}>
        <Pressable onPress={pickAvatar} disabled={uploading}>
          {picture
            ? <Image source={{ uri: picture }} style={s.avatar} />
            : <View style={[s.avatar, s.avatarEmpty]}><Text style={s.avatarPlaceholder}>{uploading ? '…' : '+'}</Text></View>
          }
          {uploading && <ActivityIndicator style={StyleSheet.absoluteFillObject} color="#3b82f6" />}
        </Pressable>
        <View style={{ flex: 1, marginStart: 14 }}>
          <Text style={s.label}>{t("Display Name")}</Text>
          <TextInput style={s.input} value={name} onChangeText={setName} placeholder={t("How others see you")} placeholderTextColor={palette.placeholder} autoCapitalize="words" />
        </View>
      </View>

      {client && <SelfStats client={client} onPress={onOpenFeedback} />}

      <Field label={t("About Me")} value={about} onChange={setAbout} placeholder={t("A short bio…")} multiline />

      {isProvider && (
        <Field
          label={t("External Link (optional)")}
          value={externalLink}
          onChange={setExternalLink}
          placeholder={t("https:// your website or social")}
          keyboardType="url"
        />
      )}

      <Field
        label={t("Phone number")}
        value={phone}
        onChange={(v) => { setPhone(v); setPhoneError(null); }}
        onBlur={normalizePhoneField}
        placeholder="+1 (555) 123-4567 or 5551234567"
        keyboardType="phone-pad"
      />
      {phoneError ? <Text style={s.fieldError}>{phoneError}</Text> : null}
      {phone.trim() && phone.trim() !== dialCode.current && !phoneError ? (
        <>
          <View style={s.segRow}>
            {(['masked', 'full'] as PhoneDisplay[]).map((mode) => (
              <Pressable key={mode} onPress={() => setPhoneDisplay(mode)} style={[s.seg, phoneDisplay === mode && s.segActive]}>
                <Ionicons
                  name={mode === 'masked' ? 'eye-off-outline' : 'eye-outline'}
                  size={15}
                  color={phoneDisplay === mode ? palette.chipBlueText : palette.dim}
                  style={{ marginEnd: 6 }}
                />
                <Text style={[s.segText, phoneDisplay === mode && s.segTextActive]}>
                  {mode === 'masked' ? t('Masked') : t('Full')}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.dim}>
            {phoneDisplay === 'masked'
              ? t('Public sees: {masked} — full number stays on this device and is shared via encrypted DM once a deal is confirmed.', { masked: maskPhone(phone.trim()) })
              : t('Your full number is published so others can reach you right after accepting — even while you are offline. Browse always shows it masked.')}
          </Text>
          {phoneDisplay === 'masked' ? (
            <Pressable onPress={() => setPhoneWarnOpen(true)} hitSlop={6}>
              <Text style={s.warnNote}>{t('⚠️ Others may not reach you instantly — tap to learn more')}</Text>
            </Pressable>
          ) : null}
          <Modal visible={phoneWarnOpen} transparent animationType="fade" onRequestClose={() => setPhoneWarnOpen(false)}>
            <Pressable style={s.sortBackdrop} onPress={() => setPhoneWarnOpen(false)}>
              <Pressable style={s.sortSheet} onPress={() => {}}>
                <Text style={s.sectionTitle}>{t('About masked numbers')}</Text>
                <Text style={[s.dim, { marginTop: 8 }]}>⚠️ {t('Freeport has no notification server, so others can only reach you by phone.')}</Text>
                <Text style={[s.dim, { marginTop: 8 }]}>{t('Masked hides your number from public posts — but your full number is still shared (encrypted) with anyone you negotiate with, so they can call you.')}</Text>
                <Text style={[s.dim, { marginTop: 8 }]}>{t('If you are offline you will not see their messages until you reopen the app, so keep checking back.')}</Text>
                <Pressable style={[s.btnAccept, { marginTop: 16 }]} onPress={() => setPhoneWarnOpen(false)}>
                  <Text style={s.btnText}>{t('Close')}</Text>
                </Pressable>
              </Pressable>
            </Pressable>
          </Modal>
        </>
      ) : null}

      {isDriver && (
        <Animated.View
          onLayout={(e) => { vehicleY.current = e.nativeEvent.layout.y; }}
          style={vehicleGlow ? {
            borderRadius: 12, borderWidth: 2, padding: 6, marginTop: 4,
            borderColor: vehGlow.interpolate({ inputRange: [0, 1], outputRange: ['rgba(251,191,36,0.45)', 'rgba(251,191,36,1)'] }),
            backgroundColor: vehGlow.interpolate({ inputRange: [0, 1], outputRange: ['rgba(251,191,36,0.04)', 'rgba(251,191,36,0.20)'] }),
            shadowColor: '#fbbf24', shadowOffset: { width: 0, height: 0 },
            shadowOpacity: vehGlow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.95] }),
            shadowRadius: vehGlow.interpolate({ inputRange: [0, 1], outputRange: [2, 16] }),
          } : undefined}
        >
          <Pressable style={s.collapseHeader} onPress={() => setVehicleOpen((v) => !v)}>
            <View style={s.collapseLeft}>
              <Ionicons name="car-outline" size={20} color={palette.text2} style={s.collapseIcon} />
              <Text style={s.collapseTitle}>{t("Vehicle Detail")}</Text>
            </View>
            <Text style={s.collapseChevron}>{vehicleOpen ? '▾' : '▸'}</Text>
          </Pressable>
          {vehicleOpen && (
            <>
              <Field
                label={t("Vehicle Model")}
                value={vehicleModel}
                onChange={setVehicleModel}
                placeholder={t("e.g. Toyota Vios — white")}
              />
              <Field
                label={t("Plate Number")}
                value={plateNumber}
                onChange={setPlateNumber}
                placeholder={t("e.g. ABC-1234")}
              />
              {plateNumber.trim() ? (
                <>
                  <View style={s.segRow}>
                    {(['masked', 'full'] as PhoneDisplay[]).map((mode) => (
                      <Pressable key={mode} onPress={() => setPlateDisplay(mode)} style={[s.seg, plateDisplay === mode && s.segActive]}>
                        <Text style={[s.segText, plateDisplay === mode && s.segTextActive]}>
                          {mode === 'masked' ? t('Masked') : t('Full')}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={s.dim}>
                    {plateDisplay === 'masked'
                      ? t('Public sees: {masked} — full plate stays on this device and is shared via encrypted DM once a deal is confirmed.', { masked: maskPlate(plateNumber.trim()) })
                      : t('⚠️ Public sees your full plate: {full} — permanently visible on relays.', { full: plateNumber.trim() })}
                  </Text>
                </>
              ) : null}
              <Text style={[s.dim, { marginTop: 10 }]}>⚠️ {t("Required to receive rides")}</Text>
            </>
          )}
        </Animated.View>
      )}

      <ImagePickerField images={gallery} onChange={setGallery} label={t("Vehicle / product / service photos (optional)")} />

      <Pressable style={[s.btnAccept, { marginTop: 20 }, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
        {saving ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t("Save & publish")}</Text>}
      </Pressable>
      </>
      )}

      {/* Location — drives default payment currency; device-only, not published */}
      <Pressable style={s.collapseHeader} onPress={() => setLocationOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <Ionicons name="location-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t("Location")}</Text>
        </View>
        <Text style={s.collapseChevron}>{locationOpen ? '▾' : '▸'}</Text>
      </Pressable>
      {locationOpen && (
      <>
      <Text style={s.dim}>{t("Your home area. Sets the default payment currency. Stays on this device.")}</Text>

      <QuickLocationSearch onPick={(loc) => onLocationChange(loc)} />

      <Text style={s.label}>{t("Country")}</Text>
      <SelectField
        value={location.country}
        options={COUNTRY_CODES_AZ}
        onChange={(c) => onLocationChange({ country: c, state: '', city: '' })}
        labelFor={(c) => `${flagEmoji(c)}  ${COUNTRY_NAME[c] ?? c}`}
        placeholder={t("Select country…")}
        scroll
      />

      {location.country && levelsOf(location.country) >= 2 ? (
        <>
          <Text style={s.label}>{t("State / Province")}</Text>
          <SelectField
            value={location.state}
            options={statesOf(location.country)}
            onChange={(st) => onLocationChange({ ...location, state: st, city: '' })}
            placeholder={t("Select state…")}
            scroll
          />
        </>
      ) : null}

      {location.country && location.state && levelsOf(location.country) >= 3 ? (
        <>
          <Text style={s.label}>{t("City")}</Text>
          <SelectField
            value={location.city}
            options={citiesOf(location.country, location.state)}
            onChange={(ci) => onLocationChange({ ...location, city: ci })}
            placeholder={t("Select city…")}
            scroll
          />
        </>
      ) : null}

      {/* Live-location sharing while a deal is active (auto-stops on completion). */}
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: sendLocationOnDeal }} style={s.toggleRow} onPress={() => onSendLocationOnDealChange(!sendLocationOnDeal)}>
        <View style={{ flex: 1, marginEnd: 12 }}>
          <Text style={s.toggleTitle}>{t("Send location on active deal")}</Text>
          <Text style={s.dim}>{t("Share your live location with the other party while a deal is active. Sharing stops when the deal completes.")}</Text>
        </View>
        <View style={[s.switchTrack, sendLocationOnDeal && s.switchTrackOn]}>
          <View style={[s.switchThumb, sendLocationOnDeal && s.switchThumbOn]} />
        </View>
      </Pressable>

      {/* Anonymous diagnostics — scrubbed of all identity/contact/location/content. */}
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: telemetryEnabled }} style={s.toggleRow} onPress={() => onTelemetryChange(!telemetryEnabled)}>
        <View style={{ flex: 1, marginEnd: 12 }}>
          <Text style={s.toggleTitle}>{t("Share anonymous diagnostics")}</Text>
          <Text style={s.dim}>{t("Send anonymous crash reports and usage stats to help improve Freeport. Never your keys, contacts, location, or messages.")}</Text>
        </View>
        <View style={[s.switchTrack, telemetryEnabled && s.switchTrackOn]}>
          <View style={[s.switchThumb, telemetryEnabled && s.switchThumbOn]} />
        </View>
      </Pressable>
      </>
      )}

      {/* Features */}
      <Pressable style={s.collapseHeader} onPress={() => setFeaturesOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <Ionicons name="options-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t("Features")}</Text>
        </View>
        <Text style={s.collapseChevron}>{featuresOpen ? '▾' : '▸'}</Text>
      </Pressable>
      {featuresOpen && (
      <>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: servicesEnabled }} style={s.toggleRow} onPress={() => onServicesEnabledChange(!servicesEnabled)}>
        <View style={{ flex: 1, marginEnd: 12 }}>
          <Text style={s.toggleTitle}>{t("Service / Product marketplace")}</Text>
          <Text style={s.dim}>{t("Buy and sell products & services beyond rideshare. Turn off for a leaner UI.")}</Text>
        </View>
        <View style={[s.switchTrack, servicesEnabled && s.switchTrackOn]}>
          <View style={[s.switchThumb, servicesEnabled && s.switchThumbOn]} />
        </View>
      </Pressable>

      <Text style={[s.toggleTitle, { marginTop: 14 }]}>{t("Appearance")}</Text>
      <Text style={s.dim}>{t("Follow the system setting, or force a theme.")}</Text>
      <View style={[s.segRow, { marginTop: 8 }]}>
        {(['system', 'dark', 'light'] as const).map((mode) => (
          <Pressable key={mode} onPress={() => onThemeChange(mode)} style={[s.seg, theme === mode && s.segActive]}>
            <Ionicons
              name={mode === 'system' ? 'phone-portrait-outline' : mode === 'dark' ? 'moon-outline' : 'sunny-outline'}
              size={15}
              color={theme === mode ? palette.chipBlueText : palette.dim}
              style={{ marginEnd: 6 }}
            />
            <Text style={[s.segText, theme === mode && s.segTextActive]}>
              {mode === 'system' ? t('System') : mode === 'dark' ? t('Dark') : t('Light')}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[s.toggleTitle, { marginTop: 14 }]}>{t("Distance unit")}</Text>
      <View style={[s.segRow, { marginTop: 8 }]}>
        {(['auto', 'km', 'mi'] as const).map((u) => (
          <Pressable key={u} onPress={() => onDistanceUnitChange(u)} style={[s.seg, distanceUnit === u && s.segActive]}>
            <Text style={[s.segText, distanceUnit === u && s.segTextActive]}>
              {u === 'auto' ? t('Auto') : u === 'km' ? t('Kilometres') : t('Miles')}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[s.toggleTitle, { marginTop: 14 }]}>{t("I'm mainly a")}</Text>
      <Text style={s.dim}>{t("Your default role (set at sign-up).")}</Text>
      <View style={[s.segRow, { marginTop: 8 }]}>
        {(['passenger', 'driver'] as const).map((r) => (
          <Pressable key={r} onPress={() => switchRole(r)} style={[s.seg, role === r && s.segActive]}>
            <Ionicons
              name={r === 'passenger' ? 'person-outline' : 'car-outline'}
              size={15}
              color={role === r ? palette.chipBlueText : palette.dim}
              style={{ marginEnd: 6 }}
            />
            <Text style={[s.segText, role === r && s.segTextActive]}>
              {r === 'passenger' ? t('Passenger / Customer') : t('Driver / Provider')}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={[s.toggleTitle, { marginTop: 14 }]}>{t("Language")}</Text>
      <Text style={s.dim}>{t("Defaults to your device language.")}</Text>
      <View style={{ marginTop: 8 }}>
        <SelectField
          value={language}
          options={LANGUAGE_CODES}
          onChange={onLanguageChange}
          labelFor={languageLabel}
          placeholder={t("Select language…")}
          scroll
        />
      </View>
      </>
      )}

      {/* Browse — driver/provider/customer feed defaults: category, range, new-post alerts. */}
      {(isDriver || isCustomer) && (
        <>
          <Pressable style={s.collapseHeader} onPress={() => setBrowsePrefsOpen((v) => !v)}>
            <View style={s.collapseLeft}>
              <Ionicons name="search-outline" size={20} color={palette.text2} style={s.collapseIcon} />
              <Text style={s.collapseTitle}>{t("Browse")}</Text>
            </View>
            <Text style={s.collapseChevron}>{browsePrefsOpen ? '▾' : '▸'}</Text>
          </Pressable>
          {browsePrefsOpen && (
            <>
              <Text style={s.dim}>{t("Browse opens to this category, and only shows posts within your range.")}</Text>
              {browsePicksCategory ? (
                <>
                  <Text style={[s.toggleTitle, { marginTop: 10, fontWeight: '600' }]}>{t("Category")}</Text>
                  <SelectField
                    value={browseCat}
                    options={browseCatOptions}
                    onChange={(c) => onBrowsePrefChange({ browseCategory: c, browseSubcategory: subcategoriesFor(c)[0] ?? '' })}
                    iconFor={(c) => categoryIcon(c)}
                    labelFor={(c) => t(c)}
                    scroll
                  />
                </>
              ) : (
                <Text style={[s.dim, { marginTop: 8 }]}>{t("Category")}: {t("Ridesharing")}</Text>
              )}
              <Text style={[s.toggleTitle, { marginTop: 10, fontWeight: '600' }]}>{t("Subcategory")}</Text>
              <SelectField
                value={browseEffSub}
                options={browseSubOptions}
                onChange={(sub) => onBrowsePrefChange({ browseCategory: browsePicksCategory ? browseCat : '', browseSubcategory: sub })}
                iconFor={(sub) => subcategoryIcon(sub)}
                labelFor={(sub) => t(sub)}
                scroll
              />
              <View style={{ marginTop: 10 }}>
                <NumberField
                  label={`${t("Max distance")} (${browseUnit})`}
                  value={browseMaxDistance}
                  onCommit={(n) => onBrowsePrefChange({ browseMaxDistance: Math.max(1, Math.round(n)) })}
                />
              </View>
              <Pressable accessibilityRole="switch" accessibilityState={{ checked: browseAlertSound }} style={s.toggleRow} onPress={() => onBrowsePrefChange({ browseAlertSound: !browseAlertSound })}>
                <View style={{ flex: 1, marginEnd: 12 }}>
                  <Text style={s.toggleTitle}>{t("Sound on new matching post")}</Text>
                  <Text style={s.dim}>{t("Play a sound when a new post appears in your subcategory.")}</Text>
                </View>
                <View style={[s.switchTrack, browseAlertSound && s.switchTrackOn]}>
                  <View style={[s.switchThumb, browseAlertSound && s.switchThumbOn]} />
                </View>
              </Pressable>
              <Pressable accessibilityRole="switch" accessibilityState={{ checked: browseAlertNotify }} style={s.toggleRow} onPress={() => onBrowsePrefChange({ browseAlertNotify: !browseAlertNotify })}>
                <View style={{ flex: 1, marginEnd: 12 }}>
                  <Text style={s.toggleTitle}>{t("Notify on new matching post")}</Text>
                  <Text style={s.dim}>{t("Send a notification when a new post appears in your subcategory.")}</Text>
                </View>
                <View style={[s.switchTrack, browseAlertNotify && s.switchTrackOn]}>
                  <View style={[s.switchThumb, browseAlertNotify && s.switchThumbOn]} />
                </View>
              </Pressable>
            </>
          )}
        </>
      )}

      {/* Notifications — remote push (when the app is closed) via a content-blind
          sender. Web PWA uses Web Push; native (iOS/Android) uses Expo Push. */}
      {pushSupported() && (
        <>
          <Pressable style={s.collapseHeader} onPress={() => setNotifyOpen((v) => !v)}>
            <View style={s.collapseLeft}>
              <Ionicons name="notifications-outline" size={20} color={palette.text2} style={s.collapseIcon} />
              <Text style={s.collapseTitle}>{t("Notifications")}</Text>
            </View>
            <Text style={s.collapseChevron}>{notifyOpen ? '▾' : '▸'}</Text>
          </Pressable>
          {notifyOpen && (
            <>
              <Text style={s.dim}>{Platform.OS === 'web'
                ? t("Get notified about new messages and nearby posts, even when the app is closed. On iOS, add Freeport to your Home Screen first. Delivered by a content-blind sender you set below — it never sees your messages.")
                : t("Get notified about new messages and nearby posts, even when the app is closed. Delivered by a content-blind sender you set below — it never sees your messages.")}</Text>
              <Pressable onPress={() => setNotifyHelpOpen(true)} hitSlop={6} style={{ marginTop: 6 }}>
                <Text style={{ color: palette.link, fontWeight: '600' }}>{'ⓘ ' + t("What's a notification server?")}</Text>
              </Pressable>
              <Field label={t("Notification service URL")} value={notifyEndpoint} onChange={setNotifyEndpoint} placeholder="https://nostr-mcp.trinh.uk" />
              <Text style={s.dim}>{t("Leave the default to use the public sender, or point to your own self-hosted one.")}</Text>
              <Pressable
                style={[s.btnAccept, { marginTop: 4 }, (pushBusy || !notifyEndpoint.trim() || !myPubkeyHex) && { opacity: 0.6 }]}
                disabled={pushBusy || !notifyEndpoint.trim() || !myPubkeyHex}
                onPress={() => { togglePush(); }}
              >
                {pushBusy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{pushState === 'on' ? t("Disable notifications") : t("Enable notifications")}</Text>}
              </Pressable>
              {pushState === 'on' && <Text style={s.dim}>{t("Notifications enabled.")}</Text>}
              {pushState === 'denied' && <Text style={s.fieldError}>{t("Notifications are blocked — enable them in your device/browser settings.")}</Text>}
              {pushState === 'error' && <Text style={s.fieldError}>{t("Couldn't reach the notification service — check the URL.")}</Text>}

              {/* Telegram: content-blind activity pings via the same server. Useful
                  where push is flaky (iOS PWA) or the user just prefers Telegram. */}
              <Text style={[s.toggleTitle, { marginTop: 16 }]}>{t("Telegram alerts")}</Text>
              <Text style={s.dim}>{telegramLinked
                ? t("Telegram is linked. Send /stop to the bot to unlink.")
                : t("Get the same content-blind alerts as a Telegram message. Opens the bot to link your account.")}</Text>
              <Pressable
                style={[s.btnCounter, { marginTop: 6 }, (telegramBusy || !notifyEndpoint.trim() || !myPubkeyHex) && { opacity: 0.6 }]}
                disabled={telegramBusy || !notifyEndpoint.trim() || !myPubkeyHex}
                onPress={async () => {
                  setTelegramBusy(true);
                  const ok = await requestTelegramLink(notifyEndpoint.trim(), myPubkeyHex);
                  if (!ok) uiAlert(t("Telegram alerts unavailable"), t("This notification server doesn't offer Telegram alerts."));
                  setTelegramBusy(false);
                }}
              >
                {telegramBusy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{telegramLinked ? t("Re-link Telegram") : t("Link Telegram")}</Text>}
              </Pressable>
            </>
          )}
        </>
      )}

      {/* "What's a notification server?" explainer + self-host instructions. */}
      <Modal visible={notifyHelpOpen} transparent animationType="fade" onRequestClose={() => setNotifyHelpOpen(false)}>
        <Pressable style={s.sortBackdrop} onPress={() => setNotifyHelpOpen(false)}>
          <Pressable style={s.sortSheet} onPress={() => {}}>
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              <Text style={s.sectionTitle}>{t("What's a notification server?")}</Text>
              <Text style={[s.dim, { marginTop: 4 }]}>{t("Freeport has no central server. To alert you when the app is closed, a small notification server watches the public relays for events addressed to you and forwards a push to your device.")}</Text>
              <Text style={[s.dim, { marginTop: 10 }]}>{t("It is content-blind: your messages are end-to-end encrypted, so it only knows that something arrived for you — never what it says.")}</Text>
              <Text style={[s.dim, { marginTop: 10 }]}>{t("Use the public one (the default URL), or run your own in one command and point the URL above at it:")}</Text>
              <View style={s.codeBox}>
                <Text style={s.codeText} selectable>{'git clone https://github.com/ptrinh/freeport.git\ncd freeport/packages/nostr-mcp\ndocker compose up -d'}</Text>
              </View>
              <Text style={[s.dim, { marginTop: 10 }]}>{t("Then set the URL above to your server (for example http://your-host:8788). On Umbrel, install it from the Freeport community app store.")}</Text>
              <Pressable style={[s.mapLink, { marginTop: 12 }]} onPress={() => Linking.openURL('https://github.com/ptrinh/freeport/tree/main/packages/nostr-mcp')}>
                <Text style={s.mapLinkText}>{'🔗 ' + t("Self-hosting guide on GitHub")}</Text>
              </Pressable>
              <Pressable style={[s.btnAccept, { marginTop: 12 }]} onPress={() => setNotifyHelpOpen(false)}>
                <Text style={s.btnText}>{t("Got it")}</Text>
              </Pressable>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Fare Estimator — user-tunable coefficients for the ride-fare estimate */}
      <Pressable style={s.collapseHeader} onPress={() => setFareOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <Ionicons name="calculator-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t("Fare Estimator")}</Text>
        </View>
        <Text style={s.collapseChevron}>{fareOpen ? '▾' : '▸'}</Text>
      </Pressable>
      {fareOpen && (
        <>
          <Text style={s.dim}>{t("Adjust the coefficients used to estimate ride fares.")}</Text>
          <NumberField label={`${t("Base fare")} (${fareSym})`} value={fc.base} onCommit={(n) => setFare({ base: n })} />
          <NumberField label={`${t("Per kilometer")} (${fareSym})`} value={fc.perKm} onCommit={(n) => setFare({ perKm: n })} />
          <NumberField label={`${t("Road distance factor")} (×)`} value={fc.roadFactor} onCommit={(n) => setFare({ roadFactor: n })} />
          <Text style={[s.label, { marginTop: 6 }]}>{t("Vehicle multipliers")} (×)</Text>
          {(['Motorbike', 'Compact Car', 'Large Car', 'Luxury Car'] as const).map((v) => (
            <NumberField key={v} label={t(v)} value={fc.vehicle[v] ?? 1} onCommit={(n) => setFare({ vehicle: { [v]: n } })} />
          ))}
          <NumberField label={`${t("Peak-hour surge")} (+)`} value={fc.peakSurge} onCommit={(n) => setFare({ peakSurge: n })} />
          <NumberField label={`${t("Late-night factor")} (×)`} value={fc.nightFactor} onCommit={(n) => setFare({ nightFactor: n })} />
          {fareConfig && (
            <Pressable style={[s.btnDecline, { marginTop: 12 }]} onPress={() => onFareConfigChange(null)}>
              <Text style={s.btnText}>{t("Reset to defaults")}</Text>
            </Pressable>
          )}
        </>
      )}

      {/* About — version, low-key update check, credits & feedback. Collapsed
          by default like the other Settings sections. The OTA update flow lives
          here as a small "Check now" link (native gets a real OTA swap; web just
          hard-reloads to the newest deploy). */}
      <Pressable style={s.collapseHeader} onPress={() => setAboutOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <Ionicons name="information-circle-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t("About")}</Text>
        </View>
        <Text style={s.collapseChevron}>{aboutOpen ? '▾' : '▸'}</Text>
      </Pressable>
      {aboutOpen && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
            <Text style={s.mono}>{versionLabel()}</Text>
            <Pressable hitSlop={8} disabled={updBusy} onPress={() => { checkUpdates(); }}>
              {updBusy
                ? <ActivityIndicator size="small" color={palette.accent} />
                : <Text style={[s.link, { fontSize: 13 }]}>{t('Check now')}</Text>}
            </Pressable>
          </View>
          {!!updMsg && <Text style={s.dim}>{updMsg}</Text>}
          {trackSupported() && (
            <View style={{ marginTop: 12 }}>
              <Text style={s.label}>{t('Update track')}</Text>
              <View style={s.segRow}>
                {(['latest', 'stable'] as UpdateTrack[]).map((tk) => (
                  <Pressable key={tk} disabled={updBusy} onPress={() => { changeTrack(tk); }} style={[s.seg, updTrack === tk && s.segActive]}>
                    <Ionicons
                      name={tk === 'latest' ? 'rocket-outline' : 'shield-checkmark-outline'}
                      size={15}
                      color={updTrack === tk ? palette.chipBlueText : palette.dim}
                      style={{ marginEnd: 6 }}
                    />
                    <Text style={[s.segText, updTrack === tk && s.segTextActive]}>{t(tk === 'latest' ? 'Latest' : 'Stable')}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={s.dim}>{t('Latest receives updates first. Stable stays one release behind for extra safety.')}</Text>
            </View>
          )}
          {nativeOS && (
            <Text style={[s.dim, { marginTop: 8 }]}>
              📱 {nativeOS === 'ios' ? t('Use the iOS app for the best experience.') : t('Use the Android app for the best experience.')}
            </Text>
          )}
          <Pressable style={[s.btnDecline, { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }]} onPress={() => onReplayTour()}>
            <Ionicons name="help-circle-outline" size={16} color="white" />
            <Text style={s.btnText}>{t('Replay guided tour')}</Text>
          </Pressable>
          <Text style={[s.dim, { marginTop: 10 }]}>© Phil T</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
            <Text style={s.dim}>{t('Feedback')}: </Text>
            <Pressable hitSlop={6} onPress={() => Linking.openURL('mailto:freeport@trinh.uk')}>
              <Text style={s.link}>freeport@trinh.uk</Text>
            </Pressable>
          </View>
        </>
      )}

      {/* Identity — collapsed by default; tap header to expand */}
      <Pressable style={s.collapseHeader} onPress={() => setIdentityOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <Ionicons name="key-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t("Account & Backup")}</Text>
        </View>
        <Text style={s.collapseChevron}>{identityOpen ? '▾' : '▸'}</Text>
      </Pressable>
      {identityOpen && (
        <>
          <Text selectable style={s.mono}>Nostr Key: {shortNpub(npub)}</Text>
          {cloudOn && cloudBackedUp && (
            <Text style={[s.dim, { color: palette.success, marginTop: 2 }]}>✓ {t('Account is synced to {name}.', { name: cloudName() })}</Text>
          )}
          {useNip07 ? (
            <>
              <Text style={s.dim}>{t("Signing with a NIP-07 browser extension. Your private key stays in the extension and never enters this site.")}</Text>
              {hasNip07() && (
                <Pressable style={[s.btnDecline, { marginTop: 12 }]} onPress={() => onUseNip07Change(false)}>
                  <Text style={s.btnText}>{t("Switch to a local key")}</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              {/* Cloud auto-syncs on native (the "synced" line above). "Export
                  Account" always writes a portable file — same as the web app. */}
              {!(cloudOn && cloudBackedUp) && (
                <Text style={s.dim}>{t("Your account is the above Nostr key — export it so you can restore it on any device.")}</Text>
              )}
              <Pressable
                style={[s.btnAccept, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, (backingUp || !secretKey) && { opacity: 0.6 }]}
                onPress={doBackup}
                disabled={backingUp || !secretKey}
              >
                {backingUp ? <ActivityIndicator color="white" /> : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={16} color="white" />
                    <Text style={s.btnText}>{t("Export Account")}</Text>
                  </>
                )}
              </Pressable>
              <Text style={s.dim}>{t("To restore on another device, sign out and choose Restore on the welcome screen.")}</Text>
              {hasNip07() && (
                <>
                  <Text style={[s.dim, { marginTop: 14 }]}>{t("On the web, a signer extension (Alby, nos2x) keeps your key out of the browser — safer than storing it here.")}</Text>
                  <Pressable style={[s.btnAccept, { marginTop: 8 }]} onPress={() => onUseNip07Change(true)}>
                    <Text style={s.btnText}>{t("Connect browser extension (NIP-07)")}</Text>
                  </Pressable>
                </>
              )}
            </>
          )}

          {/* Sign out — wipes the identity from this device; needs a backup first */}
          <Pressable style={[s.btnDecline, { marginTop: 16, backgroundColor: '#7f1d1d', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }]} onPress={() => { setBackedUp(false); setSignOutOpen(true); }}>
            <Ionicons name="log-out-outline" size={16} color="white" />
            <Text style={s.btnText}>{t("Sign out")}</Text>
          </Pressable>

          <Modal visible={signOutOpen} transparent animationType="fade" onRequestClose={() => setSignOutOpen(false)}>
            <Pressable style={s.sortBackdrop} onPress={() => setSignOutOpen(false)}>
              <Pressable style={s.sortSheet} onPress={() => {}}>
                <Text style={s.sectionTitle}>{t("Sign out")}</Text>
                {signerRef.current?.secretKey ? (
                  <>
                    <Text style={s.dim}>{t("This erases your identity from this device. Without a backup file you CANNOT restore it — your key, profile and reputation are gone for good. Back it up first (Backup Identity above), then confirm.")}</Text>
                    <Pressable style={s.checkRow} onPress={() => setBackedUp((v) => !v)}>
                      <View style={[s.checkbox, backedUp && s.checkboxOn]}>{backedUp && <Text style={s.checkboxTick}>✓</Text>}</View>
                      <Text style={s.checkLabel}>{t("I have backed up my identity")}</Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={s.dim}>{t("You sign with a browser extension — signing out just disconnects it here. You can reconnect any time.")}</Text>
                )}
                <View style={s.btnRow}>
                  <Pressable style={[s.btnDecline, { flex: 1 }]} onPress={() => setSignOutOpen(false)}>
                    <Text style={s.btnText}>{t("Cancel")}</Text>
                  </Pressable>
                  <Pressable
                    style={[s.btnAccept, { flex: 1, backgroundColor: '#b91c1c' }, (!!signerRef.current?.secretKey && !backedUp) && { opacity: 0.5 }]}
                    disabled={!!signerRef.current?.secretKey && !backedUp}
                    onPress={() => { setSignOutOpen(false); setBackedUp(false); onSignOut(); }}
                  >
                    <Text style={s.btnText}>{t("Sign out")}</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </Modal>

          {/* Delete account — permanently erases the identity + all data (Apple
              Guideline 5.1.1(v)). Distinct from Sign out; no backup gate. */}
          <Text style={[s.dim, { marginTop: 20 }]}>{t("Permanently delete your account and all of its data from this device. This is different from signing out and cannot be undone.")}</Text>
          <Pressable style={[s.btnDecline, { marginTop: 8, backgroundColor: '#b91c1c', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }]} onPress={() => { setDeleteConfirm(false); setDeleteOpen(true); }}>
            <Ionicons name="trash-outline" size={16} color="white" />
            <Text style={s.btnText}>{t("Delete account")}</Text>
          </Pressable>

          <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => { if (!deleting) setDeleteOpen(false); }}>
            <Pressable style={s.sortBackdrop} onPress={() => { if (!deleting) setDeleteOpen(false); }}>
              <Pressable style={s.sortSheet} onPress={() => {}}>
                <Text style={s.sectionTitle}>{t("Delete account")}</Text>
                <Text style={s.dim}>{t("This permanently deletes your account. Your identity key, profile, posts, messages, reputation and settings are erased from this device, your cloud backup is removed, and your public listings are withdrawn. This cannot be undone and your account cannot be recovered.")}</Text>
                <Pressable style={s.checkRow} onPress={() => setDeleteConfirm((v) => !v)}>
                  <View style={[s.checkbox, deleteConfirm && s.checkboxOn]}>{deleteConfirm && <Text style={s.checkboxTick}>✓</Text>}</View>
                  <Text style={s.checkLabel}>{t("I understand this permanently deletes my account and cannot be undone")}</Text>
                </Pressable>
                <View style={s.btnRow}>
                  <Pressable style={[s.btnDecline, { flex: 1 }]} disabled={deleting} onPress={() => setDeleteOpen(false)}>
                    <Text style={s.btnText}>{t("Cancel")}</Text>
                  </Pressable>
                  <Pressable
                    style={[s.btnAccept, { flex: 1, backgroundColor: '#b91c1c' }, (!deleteConfirm || deleting) && { opacity: 0.5 }]}
                    disabled={!deleteConfirm || deleting}
                    onPress={async () => { setDeleting(true); try { await onDeleteAccount(); } finally { setDeleting(false); setDeleteOpen(false); } }}
                  >
                    {deleting ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t("Delete account")}</Text>}
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        </>
      )}
    </ScrollView>
  );
}

// ─── Shared components ───────────────────────────────────────────────────────

/** Compact dropdown: input-height row showing the value; tap opens a sheet of options. */
// Quick location search — a single box that fuzzy-matches across every
// country/state/city so users don't have to drill the three dropdowns. Typing
// "Broo" suggests e.g. "Brooklyn"; picking one fills country/state/city at once.
// Lives alongside the dropdowns (both ways work).
function QuickLocationSearch({ onPick }: { onPick: (loc: { country: string; state: string; city: string }) => void }) {
  const [q, setQ] = useState('');
  const [focused, setFocused] = useState(false);
  const sugs = q.trim().length >= 2 ? searchLocations(q.trim(), 8) : [];
  return (
    <View style={{ marginBottom: 4, zIndex: 5 }}>
      <Text style={s.label}>{t("Quick location search")}</Text>
      <TextInput
        style={s.input}
        value={q}
        onChangeText={setQ}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)} // let a tap land first
        placeholder={t("Type a country, state or city…")}
        placeholderTextColor={palette.placeholder}
        autoCapitalize="words"
        autoCorrect={false}
      />
      {focused && sugs.length > 0 && (
        <View style={s.suggestBox}>
          {sugs.map((sg, i) => (
            <Pressable
              key={`${sg.label}-${i}`}
              style={[s.suggestRow, i > 0 && s.suggestRowDiv]}
              onPress={() => { onPick({ country: sg.country, state: sg.state, city: sg.city }); setQ(''); setFocused(false); }}
            >
              <Text style={s.suggestText} numberOfLines={1}>{sg.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function SelectField({ value, options, onChange, icons, iconFor, labelFor, placeholder, scroll }: { value: string; options: string[]; onChange: (v: string) => void; icons?: Record<string, string>; iconFor?: (v: string) => string; labelFor?: (v: string) => string; placeholder?: string; scroll?: boolean }) {
  const [open, setOpen] = useState(false);
  // iconFor (function, always resolves) takes precedence over the icons map (may miss keys).
  const glyph = (v: string): string | undefined => iconFor ? iconFor(v) : icons?.[v];
  // labelFor maps a value to its display text (e.g. country code → "🇺🇸  United States").
  const labelOf = (v: string): string => (labelFor ? labelFor(v) : v);
  const rows = (
    <>
      {options.map((o) => (
        <Pressable key={o} style={s.selectOption} onPress={() => { onChange(o); setOpen(false); }}>
          <View style={s.row}>
            {glyph(o) ? <MaterialCommunityIcons name={glyph(o) as any} size={20} color={o === value ? palette.accent : palette.text3} style={{ marginEnd: 10 }} /> : null}
            <Text style={[s.selectOptionText, o === value && s.selectOptionOn]}>{labelOf(o)}</Text>
          </View>
          {o === value && <Ionicons name="checkmark" size={18} color={palette.accent} />}
        </Pressable>
      ))}
    </>
  );
  return (
    <>
      <Pressable style={s.selectField} onPress={() => setOpen(true)}>
        <View style={s.row}>
          {glyph(value) ? <MaterialCommunityIcons name={glyph(value) as any} size={18} color={palette.text2} style={{ marginEnd: 8 }} /> : null}
          <Text style={[s.selectValue, !value && { color: palette.placeholder }]}>{value ? labelOf(value) : (placeholder ?? 'Select…')}</Text>
        </View>
        <Ionicons name="chevron-down" size={16} color={palette.text3} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.sortBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.sortSheet} onPress={() => {}}>
            {scroll ? <ScrollView style={{ maxHeight: 380 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>{rows}</ScrollView> : rows}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function Field({
  label, value, onChange, placeholder = '', multiline = false, keyboardType = 'default', secure = false, onBlur, onFocus, maxLength,
}: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; multiline?: boolean; keyboardType?: any; secure?: boolean;
  onBlur?: () => void; onFocus?: () => void; maxLength?: number;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <>
      <View style={s.fieldLabelRow}>
        <Text style={s.label}>{t(label)}</Text>
        {maxLength ? <Text style={s.charCount}>{value.length}/{maxLength}</Text> : null}
      </View>
      <TextInput
        style={[s.input, multiline && { height: 80, textAlignVertical: 'top' }, focused && s.inputFocused]}
        value={value}
        onChangeText={onChange}
        onFocus={(e: any) => {
          setFocused(true);
          onFocus?.();
          // Web: the OS keyboard overlays the page and can hide a low field.
          // Scroll it to the middle once the keyboard/viewport has settled.
          if (Platform.OS === 'web') {
            const el = e?.target;
            if (el?.scrollIntoView) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
          }
        }}
        onBlur={() => { setFocused(false); onBlur?.(); }}
        placeholder={placeholder}
        placeholderTextColor={palette.placeholder}
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secure}
        maxLength={maxLength}
        autoCapitalize="none"
      />
    </>
  );
}

// A labelled, non-editable value styled like an input — for terms that are fixed
// by the original listing and must not change during negotiation (e.g. a ride's
// pickup/destination).
function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <View style={s.fieldLabelRow}>
        <Text style={s.label}>{t(label)}</Text>
      </View>
      <View style={[s.input, { justifyContent: 'center', minHeight: 44 }]}>
        <Text style={{ color: palette.text2, fontSize: 15 }} numberOfLines={1}>{value || '—'}</Text>
      </View>
    </>
  );
}

/** Numeric input that holds raw text while editing (so decimals like "1.15"
 *  type cleanly) and commits a parsed, non-negative number on blur. */
function NumberField({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return (
    <>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={s.input}
        value={text}
        onChangeText={setText}
        onBlur={() => { const n = parseFloat(text.replace(',', '.')); onCommit(Number.isFinite(n) && n >= 0 ? n : value); }}
        onFocus={(e: any) => {
          if (Platform.OS === 'web') {
            const el = e?.target;
            if (el?.scrollIntoView) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
          }
        }}
        keyboardType="numeric"
        placeholderTextColor={palette.placeholder}
      />
    </>
  );
}

/**
 * GPS-first location field. The user MUST pin a point on the map first
 * (defaults to current GPS); the address is then reverse-geocoded and
 * auto-filled. The address stays editable, but a geohash is always present
 * once set, so the post carries real coordinates.
 */
/**
 * Text field with an address-book popup: tap the book icon to pick from pinned
 * favourites + recent destinations, or pin the current value. Used for the
 * rideshare "To" field. Recents are auto-recorded on post.
 */
function AddressBookField({
  label,
  value,
  onChange,
  placeholder = '',
  near,
  country,
  onSelectCoords,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** Reference point (pickup, else home) — prioritizes nearby suggestions. */
  near?: { latitude: number; longitude: number } | null;
  /** ISO country code — restricts autocomplete to the user's selected area. */
  country?: string | null;
  /** Called with the chosen place's coordinates when picked from a suggestion. */
  onSelectCoords?: (c: { latitude: number; longitude: number }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [book, setBook] = useState<AddressBook>({ recent: [], pinned: [] });
  const [sugs, setSugs] = useState<{ label: string; latitude: number; longitude: number }[]>([]);
  const [focused, setFocused] = useState(false);
  const pickedRef = useRef('');

  const refresh = () => { loadAddressBook().then(setBook); };
  useEffect(() => { refresh(); }, []);

  // Debounced autocomplete while typing. Suggestions are biased toward the
  // pickup (`near`) and returned in the local language by ./nominatim.
  useEffect(() => {
    const q = value.trim();
    if (!focused || q.length < 3 || q === pickedRef.current) { setSugs([]); return; }
    const id = setTimeout(() => {
      suggest(q, near ?? null, country).then(setSugs).catch(() => setSugs([]));
    }, 400);
    return () => clearTimeout(id);
  }, [value, focused, near, country]);

  const openSheet = () => { refresh(); setOpen(true); };
  const pick = (a: string) => {
    pickedRef.current = a; // don't re-trigger autocomplete on the filled value
    onChange(a);
    setOpen(false);
    // Address-book entries are plain text — geocode the pick so the fare
    // estimator (which needs destination coords) works just like a suggestion tap.
    if (onSelectCoords) {
      geohashForPlace(a, '')
        .then((gh) => { const c = gh ? geohashToCoords(gh) : null; if (c) onSelectCoords(c); })
        .catch(() => {});
    }
  };
  const pin = (a: string) => { togglePinned(a).then(setBook); };

  const cur = value.trim();
  const canPinCurrent = cur.length > 0 && !isPinned(book, cur);
  const hasAny = book.pinned.length > 0 || book.recent.length > 0;

  const row = (a: string) => (
    <View key={a} style={s.abRow}>
      <Pressable style={{ flex: 1 }} onPress={() => pick(a)}>
        <Text style={s.abText} numberOfLines={1}>{a}</Text>
      </Pressable>
      <Pressable hitSlop={8} onPress={() => pin(a)}>
        <Ionicons name={isPinned(book, a) ? 'star' : 'star-outline'} size={18} color={isPinned(book, a) ? '#fbbf24' : palette.dim} />
      </Pressable>
    </View>
  );

  return (
    <>
      <Text style={s.label}>{t(label)}</Text>
      <View style={s.row}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)} // let a suggestion tap land first
          placeholder={placeholder}
          placeholderTextColor={palette.placeholder}
          autoCapitalize="words"
        />
        <Pressable style={s.addrBtn} onPress={openSheet} accessibilityRole="button" accessibilityLabel={t('Open address book')}>
          <Ionicons name="book-outline" size={20} color={palette.link} />
        </Pressable>
      </View>
      {focused && sugs.length > 0 && (
        <View style={s.suggestBox}>
          {sugs.map((sg, i) => (
            <Pressable
              key={`${sg.label}-${i}`}
              style={[s.suggestRow, i > 0 && s.suggestRowDiv]}
              onPress={() => { pickedRef.current = sg.label; onChange(sg.label); onSelectCoords?.({ latitude: sg.latitude, longitude: sg.longitude }); setSugs([]); setFocused(false); }}
            >
              <Ionicons name="location-outline" size={15} color={palette.dim} style={{ marginEnd: 8 }} />
              <Text style={s.suggestText} numberOfLines={1}>{sg.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.sortBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={s.sortSheet} onPress={() => {}}>
            <Text style={s.sectionTitle}>{t("Address book")}</Text>
            {canPinCurrent && (
              <Pressable style={[s.btnAccept, { marginTop: 8 }]} onPress={() => pin(cur)}>
                <Text style={s.btnText}>★ Pin “{cur.length > 28 ? cur.slice(0, 28) + '…' : cur}”</Text>
              </Pressable>
            )}
            {book.pinned.length > 0 && (
              <>
                <Text style={s.label}>{t("Pinned")}</Text>
                {book.pinned.map(row)}
              </>
            )}
            {book.recent.length > 0 && (
              <>
                <Text style={s.label}>{t("Recent")}</Text>
                {book.recent.map(row)}
              </>
            )}
            {!hasAny && (
              <Text style={[s.dim, { marginTop: 8 }]}>{t("No saved addresses yet. Post a ride to build recents, or type an address and pin it.")}</Text>
            )}
            <Pressable style={[s.btnDecline, { marginTop: 16 }]} onPress={() => setOpen(false)}>
              <Text style={s.btnText}>{t("Close")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function LocationField({
  label,
  address,
  geohash,
  onChange,
  placeholder = '',
}: {
  label: string;
  address: string;
  geohash: string | null;
  onChange: (address: string, geohash: string | null) => void;
  placeholder?: string;
}) {
  // Captured here (outside the Modal) because react-native-safe-area-context
  // does NOT propagate into a <Modal>; inside it the inset reads 0 and the bar
  // hides under the status bar/notch, making "Done" untappable.
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [region, setRegion] = useState<{ latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const centerRef = useRef<{ latitude: number; longitude: number } | null>(null);

  const openPicker = async () => {
    setOpen(true);
    setLocating(true);
    let coords = await getCurrentCoords();
    if (!coords && geohash) coords = geohashToCoords(geohash);
    const c = coords ?? { latitude: 1.3521, longitude: 103.8198 }; // Singapore fallback
    centerRef.current = c;
    setRegion({ ...c, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    setLocating(false);
  };

  const confirm = async () => {
    const c = centerRef.current;
    if (!c) { setOpen(false); return; }
    setResolving(true);
    const gh = coordsToGeohash(c.latitude, c.longitude);
    const addr = await reverseGeocode(c.latitude, c.longitude);
    setResolving(false);
    onChange(addr || address, gh); // autofill if reverse worked, else keep typed text
    setOpen(false);
  };

  return (
    <>
      <Text style={s.label}>{t(label)}</Text>
      {geohash ? (
        // Pinned: show the auto-filled, still-editable address + re-pin link
        <>
          <View style={s.row}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={address}
              onChangeText={(t) => onChange(t, geohash)}
              placeholder={t("Address (auto-filled, editable)")}
              placeholderTextColor={palette.placeholder}
              autoCapitalize="words"
            />
            <Pressable style={s.pinBtn} onPress={openPicker}>
              <Ionicons name="location" size={20} color="white" />
            </Pressable>
          </View>
          <Text style={s.pinnedHint}>{t('📍 Pinned on map · tap the pin to change')}</Text>
        </>
      ) : (
        // Not pinned yet: pinning is required first
        <Pressable style={s.pinPrompt} onPress={openPicker}>
          <Ionicons name="location" size={18} color="white" />
          <Text style={s.pinPromptText}>{t("Pin location on map")}</Text>
        </Pressable>
      )}

      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={s.mapModal}>
          <View style={[s.mapModalBar, { paddingTop: insets.top + 12 }]}>
            <Pressable onPress={() => setOpen(false)} hitSlop={8}><Text style={s.mapModalCancel}>{t("Cancel")}</Text></Pressable>
            <Text style={s.mapModalTitle}>{t("Drag map to pin location")}</Text>
            <Pressable onPress={confirm} disabled={resolving || locating} hitSlop={8}>
              <Text style={[s.mapModalDone, (resolving || locating) && { opacity: 0.5 }]}>
                {resolving ? '…' : t('Done')}
              </Text>
            </Pressable>
          </View>
          <View style={{ flex: 1 }}>
            {region && (
              <PickerMap
                style={{ flex: 1 }}
                initial={{ latitude: region.latitude, longitude: region.longitude }}
                onCenterChange={(c) => { centerRef.current = c; }}
              />
            )}
            {/* Fixed center pin — the map moves under it */}
            <View pointerEvents="none" style={s.mapCenterPin}>
              <Ionicons name="location-sharp" size={40} color="#ef4444" />
            </View>
            {locating && (
              <View style={s.mapLocating}>
                <ActivityIndicator color="#3b82f6" />
                <Text style={s.dim}>  Finding your location…</Text>
              </View>
            )}
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

function SideToggle({
  side,
  onChange,
  requestLabel,
  offerLabel,
}: {
  side: 'request' | 'offer';
  onChange: (s: 'request' | 'offer') => void;
  requestLabel: string;
  offerLabel: string;
}) {
  return (
    <View style={[s.segRow, { marginTop: 14 }]}>
      {([['request', requestLabel], ['offer', offerLabel]] as const).map(([value, label]) => (
        <Pressable key={value} onPress={() => onChange(value)} style={[s.seg, side === value && s.segActive]}>
          <Ionicons
            name={value === 'request' ? 'search-outline' : 'pricetag-outline'}
            size={15}
            color={side === value ? palette.chipBlueText : palette.dim}
            style={{ marginEnd: 6 }}
          />
          <Text style={[s.segText, side === value && s.segTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function PostButton({ onPress, loading = false, label = 'Publish' }: { onPress: () => void; loading?: boolean; label?: string }) {
  return (
    <Pressable style={[s.btnAccept, { marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 }, loading && { opacity: 0.6 }]} onPress={onPress} disabled={loading}>
      {loading ? <ActivityIndicator color="white" /> : (
        <>
          <Ionicons name="paper-plane-outline" size={16} color="white" />
          <Text style={s.btnText}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

function ImagePickerField({
  images,
  onChange,
  label = 'Photos (optional)',
}: {
  images: string[];
  onChange: (urls: string[]) => void;
  label?: string;
}) {
  const [uploading, setUploading] = useState(false);

  const pick = async () => {
    // System photo picker — no media permission needed (Play-policy compliant).
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: 4,
    });
    if (result.canceled || !result.assets.length) return;
    setUploading(true);
    try {
      const urls = await Promise.all(result.assets.map((a) => uploadImage(a)));
      onChange([...images, ...urls]);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof UploadError ? e.message : 'Try again.');
    } finally {
      setUploading(false);
    }
  };

  const remove = (url: string) => onChange(images.filter((u) => u !== url));

  return (
    <View style={{ marginTop: 16 }}>
      <Text style={s.label}>{t(label)}</Text>
      <View style={s.imageGrid}>
        {images.map((url) => (
          <View key={url} style={s.imageThumbWrap}>
            <Image source={{ uri: url }} style={s.imageThumb} />
            <Pressable style={s.imageRemove} onPress={() => remove(url)}>
              <Text style={s.imageRemoveText}>✕</Text>
            </Pressable>
          </View>
        ))}
        {images.length < 4 && (
          <Pressable style={s.imageAdd} onPress={pick} disabled={uploading}>
            {uploading
              ? <ActivityIndicator color={palette.dim} />
              : (
                <>
                  <Ionicons name="image-outline" size={20} color={palette.dim} style={{ marginBottom: 2 }} />
                  <Text style={s.imageAddText}>{images.length === 0 ? t('+ Add photos') : '+'}</Text>
                </>
              )
            }
          </Pressable>
        )}
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={s.rowValue}>{value}</Text>
    </View>
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

// ─── Time / Duration / Payment inputs ────────────────────────────────────────

/** Round to the nearest 15-minute mark. */
function roundTo15(d: Date): Date {
  const step = 15 * 60 * 1000;
  return new Date(Math.round(d.getTime() / step) * step);
}

/** Default intent time: now + 30 min on the 15-minute grid (e.g. 2:15 PM). */
function defaultIntentTime(): Date {
  return roundTo15(new Date(Date.now() + 30 * 60 * 1000));
}

function fmtClock(d: Date): string {
  try {
    return new Intl.DateTimeFormat(getI18nLang(), { hour: 'numeric', minute: '2-digit' }).format(d);
  } catch {
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  }
}

/** Clock time for a title, with a day suffix when it isn't today ("6:00 PM Tomorrow"). */
function fmtClockTitle(d: Date): string {
  const clock = fmtClock(d);
  const hint = dayHint(d);
  if (hint === 'today') return clock;
  if (hint === 'tomorrow') return `${clock} ${t('Tomorrow')}`;
  return `${clock} ${hint}`;
}

/** Day bucket as a stable token ('today'/'tomorrow') or a locale-formatted date. */
function dayHint(d: Date): string {
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'today';
  const tomorrow = new Date(today.getTime() + 86400000);
  if (d.toDateString() === tomorrow.toDateString()) return 'tomorrow';
  return d.toLocaleDateString(getI18nLang());
}

/** Translated day label for display (today/Tomorrow/date). */
function dayLabel(d: Date): string {
  const h = dayHint(d);
  return h === 'today' ? t('today') : h === 'tomorrow' ? t('Tomorrow') : h;
}

function timeToWindow(time: Date, flexible: boolean): { start: number; end: number } | undefined {
  if (flexible) return undefined;
  const start = Math.floor(time.getTime() / 1000);
  return { start, end: start + 15 * 60 };
}

function TimeField({
  time,
  onChange,
  flexible,
  onFlexible,
}: {
  time: Date;
  onChange: (d: Date) => void;
  flexible: boolean;
  onFlexible: (f: boolean) => void;
}) {
  const [showPicker, setShowPicker] = useState(false);

  // The picker now carries a date too, so honour the full chosen date+time.
  // A selection in the past is bumped to the next 15-min slot from now.
  const applyPicked = (picked: Date) => {
    const d = roundTo15(picked);
    onChange(d.getTime() < Date.now() ? roundTo15(new Date(Date.now() + 15 * 60 * 1000)) : d);
  };

  const shift = (mins: number) => {
    const d = new Date(time.getTime() + mins * 60 * 1000);
    if (d.getTime() > Date.now()) onChange(d);
  };

  return (
    <View style={{ marginTop: 12 }}>
      <Text style={s.label}>{t("Time")}</Text>
      <View style={[s.row, flexible && { opacity: 0.35 }]}>
        <Pressable style={s.timeBtn} disabled={flexible} onPress={() => setShowPicker((v) => !v)}>
          <Text style={s.timeBtnText}>{fmtClock(time)}</Text>
          <Text style={s.timeBtnHint}>{dayLabel(time)}</Text>
        </Pressable>
        <Pressable style={s.stepBtn} disabled={flexible} onPress={() => shift(-15)}>
          <Text style={s.stepBtnText}>−15m</Text>
        </Pressable>
        <Pressable style={s.stepBtn} disabled={flexible} onPress={() => shift(15)}>
          <Text style={s.stepBtnText}>+15m</Text>
        </Pressable>
      </View>
      <TimeSpinner
        value={time}
        visible={showPicker && !flexible}
        onPick={applyPicked}
        onClose={() => setShowPicker(false)}
      />
      <Pressable style={s.checkRow} onPress={() => onFlexible(!flexible)}>
        <View style={[s.checkbox, flexible && s.checkboxOn]}>
          {flexible && <Text style={s.checkboxTick}>✓</Text>}
        </View>
        <Text style={s.checkLabel}>{t("Flexible time")}</Text>
      </Pressable>
    </View>
  );
}

const DURATION_HOURS = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const DURATION_MINUTES = [0, 15, 30, 45];

function DurationField({
  hours,
  minutes,
  onChange,
}: {
  hours: number;
  minutes: number;
  onChange: (h: number, m: number) => void;
}) {
  return (
    <View style={{ marginTop: 12 }}>
      <Text style={s.label}>{t("Duration")}</Text>
      <View style={s.wheelRow}>
        <Picker
          style={s.wheel}
          itemStyle={s.wheelItem}
          selectedValue={hours}
          onValueChange={(h) => onChange(h, minutes)}
          dropdownIconColor="#e8edf2"
        >
          {DURATION_HOURS.map((h) => (
            <Picker.Item key={h} label={`${h} h`} value={h} color={palette.text} />
          ))}
        </Picker>
        <Picker
          style={s.wheel}
          itemStyle={s.wheelItem}
          selectedValue={minutes}
          onValueChange={(m) => onChange(hours, m)}
          dropdownIconColor="#e8edf2"
        >
          {DURATION_MINUTES.map((m) => (
            <Picker.Item key={m} label={`${m} min`} value={m} color={palette.text} />
          ))}
        </Picker>
      </View>
    </View>
  );
}

/** Input snapping step: VND 5000, other zero-decimal currencies 1000, else 0.5. */
function stepFor(currency: Currency): number {
  if (currency === 'VND') return 5000;
  return currencyFractionDigits(currency) === 0 ? 1000 : 0.5;
}

function snapToStep(amount: number, currency: Currency): number {
  const step = stepFor(currency);
  return Math.max(0, Math.round(amount / step) * step);
}

const fmtPayment = fmtMoney;

/**
 * Parse a number out of a money string formatted in ANY locale. `fmtMoney`
 * localises decimals — Vietnamese writes 5.50 as "5,50" and 1234.50 as
 * "1.234,50", English as "5.50" / "1,234.50" — so a fixed dot-only parse turned
 * a VI "5,50" counter into 550. Treat the rightmost '.'/',' as the decimal
 * point, unless it's followed by a 3-digit group (then it's thousands, no
 * decimal). Currency symbols and stray marks are ignored.
 */
/** Best-effort parse of a payment string back into amount+currency (for counter-offers). */
function parsePayment(str: string | undefined, fallbackCurrency: Currency): { amount: number; currency: Currency } {
  if (!str) return { amount: 0, currency: fallbackCurrency };
  // Currency is fixed by each user's locale, so the offer's own currency
  // (fallbackCurrency) is the right frame; we only special-case VND's distinct
  // formatting since its amounts have no decimals and use dot grouping.
  const currency: Currency = /₫|đ|vnd/i.test(str) ? 'VND' : fallbackCurrency;
  const amount = parseAmountWithK(str, currencyFractionDigits(currency));
  return { amount: snapToStep(amount, currency), currency };
}

/** Some locales conventionally write the currency mark after the number
 * (e.g. Vietnamese "10.000₫"), unlike the leading "$10" form. */
function symbolIsSuffix(currency: Currency): boolean {
  return currency === 'VND';
}

/** Compact label for a wheel's major (10×) tick, e.g. 50000 → "50k", 5 → "5". */
function compactAmount(n: number, currency: Currency): string {
  if (currencyFractionDigits(currency) === 0) {
    if (n >= 1000) {
      const k = n / 1000;
      return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
    }
    return String(n);
  }
  return String(n);
}

/**
 * Format a raw amount string for the editable readout with thin-grouped
 * thousands (e.g. "70000" → "70 000"), keeping a single decimal point for
 * fractional currencies. Spaces are non-digits, so `commit()`'s digit-stripping
 * parses it back unchanged.
 */
function formatAmountInput(raw: string, currency: Currency): string {
  if (currencyFractionDigits(currency) === 0) {
    const digits = raw.replace(/\D/g, '');
    return digits ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : '';
  }
  let cleaned = raw.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot !== -1) cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
  const [intPart, decPart] = cleaned.split('.');
  const grouped = (intPart || '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decPart !== undefined ? `${grouped}.${decPart}` : grouped;
}

/**
 * Horizontal wheel (ruler) picker — SwiftUI "custom horizontal wheel" style.
 * A scrollable strip of detents one `step` apart: every 10× step is a tall,
 * labelled major tick; every 5× a medium tick. The fixed centre indicator marks
 * the selected value, and each detent passing the centre fires `wheelTick()`
 * (haptic on Android, vibration + click on web) for a physical-wheel feel.
 * Values beyond the wheel's range are still reachable by typing in the readout.
 */
function AmountWheel({ amount, currency, onChange }: {
  amount: number;
  currency: Currency;
  onChange: (n: number) => void;
}) {
  const step = stepFor(currency);
  const TICK = 14;   // px between adjacent detents
  const MAJOR = 10;  // every 10th detent → tall + labelled
  const MID = 5;     // every 5th detent → medium tick
  // Accelerating detents: each detent is worth 1× basic step until the value
  // passes 200× basic, then 10× per detent, then 20× per detent past 2000× basic.
  // So big prices are reachable in a few turns (e.g. VND past 1,000,000 jumps by
  // 50,000; past 10,000,000 by 100,000) without thousands of tiny detents.
  const IDX_A = 200;                                              // detents at 1× step
  const VAL_A = IDX_A * step;                                     // value where 10× begins (200×)
  const VAL_B = 2000 * step;                                      // value where 20× begins (2000×)
  const IDX_B = IDX_A + Math.round((VAL_B - VAL_A) / (10 * step)); // detent where 20× begins
  const idxToValue = (i: number): number => {
    if (i <= IDX_A) return i * step;
    if (i <= IDX_B) return VAL_A + (i - IDX_A) * 10 * step;
    return VAL_B + (i - IDX_B) * 20 * step;
  };
  // Hard cap on rendered detents. The ruler is a plain (non-virtualized)
  // ScrollView, so an absurd typed amount (e.g. 999,999,999,999) would otherwise
  // map to millions of detents and freeze the app building that many Views.
  // At 4000 detents the wheel reaches ~362M VND; larger typed amounts still show
  // in the readout and commit fine — the wheel just can't scroll all the way to
  // them (clamps to the cap). MAX_IDX must stay > IDX_B.
  const MAX_IDX = 4000;
  const valueToIdx = (v: number): number => {
    if (v <= 0) return 0;
    if (v <= VAL_A) return Math.min(MAX_IDX, Math.round(v / step));
    if (v <= VAL_B) return Math.min(MAX_IDX, IDX_A + Math.round((v - VAL_A) / (10 * step)));
    return Math.min(MAX_IDX, IDX_B + Math.round((v - VAL_B) / (20 * step)));
  };
  // No hard ceiling: the ruler starts a few hundred detents wide and grows as the
  // user scrolls toward its end, so the max amount is effectively unlimited (min
  // stays 0). Only the rendered window grows, on demand.
  const [w, setW] = useState(0);
  const [maxIdx, setMaxIdx] = useState(() => Math.min(MAX_IDX, Math.max(400, valueToIdx(amount || 0) + 200)));
  const scroller = useRef<ScrollView>(null);
  const idxRef = useRef(Math.max(0, valueToIdx(amount)));
  // The ScrollView mounts at offset 0 even when `amount` is prefilled, so the
  // very first layout MUST scroll to the prefilled detent — otherwise the wheel
  // sits at 0 while the readout shows the real value, and the first touch snaps
  // it back to 0. Track whether that initial alignment has happened.
  const didAlign = useRef(false);

  // True while the user is actively dragging/flicking — so the external re-align
  // effect below never yanks the scroll position out from under a live gesture.
  const interacting = useRef(false);
  // True briefly during a programmatic re-align scroll. When `amount` exceeds the
  // wheel's max (a huge typed value), the wheel can't scroll that far, so its
  // scroll lands at the content end and onScroll would otherwise fire onChange
  // with that smaller value — overwriting the typed amount. Skip onScroll then.
  const realigning = useRef(false);
  // Re-align when `amount` is driven from outside (fare/suggestion tap, reset,
  // or typing) without re-emitting onChange. Grow the ruler first if needed.
  useEffect(() => {
    const idx = Math.max(0, valueToIdx(amount));
    setMaxIdx((m) => Math.min(MAX_IDX, idx + 200 > m ? idx + 200 : m));
    if (!interacting.current && w > 0 && (idx !== idxRef.current || !didAlign.current)) {
      const first = !didAlign.current;
      idxRef.current = idx;
      didAlign.current = true;
      const go = () => {
        realigning.current = true;
        scroller.current?.scrollTo({ x: idx * TICK, animated: false });
        setTimeout(() => { realigning.current = false; }, 150);
      };
      // Defer the very first alignment a frame — iOS can ignore a scrollTo issued
      // before the ScrollView's content finishes its initial layout.
      if (first) requestAnimationFrame(go); else go();
    }
  }, [amount, w, step]);

  const snapTimer = useRef<any>(null);
  const settling = useRef(false);
  // Snap to the exact nearest detent and commit the final value once. We do NOT
  // use snapToInterval — it fights the momentum near a detent boundary, flipping
  // the value back and forth for a second or two ("jitter between two numbers").
  // Instead we let native deceleration run smooth, then align on scroll-end.
  // The animated scrollTo below itself emits onMomentumScrollEnd on iOS, which
  // would re-enter settle() in an endless loop that freezes the wheel — so guard
  // re-entrancy and clear it after the align animation finishes.
  const settle = () => {
    interacting.current = false;
    if (settling.current) return;
    settling.current = true;
    const idx = idxRef.current;
    scroller.current?.scrollTo({ x: idx * TICK, animated: true });
    onChange(idxToValue(idx));
    setTimeout(() => { settling.current = false; }, 320);
  };
  const onScroll = (e: any) => {
    if (realigning.current) return; // programmatic re-align — must not overwrite a typed value
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.max(0, Math.round(x / TICK));
    // Extend the ruler ahead of the user as they approach its current end,
    // bounded by MAX_IDX so the (non-virtualized) ScrollView can't blow up.
    if (idx > maxIdx - 80) setMaxIdx((m) => Math.min(MAX_IDX, Math.max(m, idx + 400)));
    if (idx !== idxRef.current) {
      idxRef.current = idx;
      wheelTick();                 // detents click past during the momentum coast too
      onChange(idxToValue(idx));   // value spins live; accelerates past 200×/2000× basic
    }
  };

  // Guided-tour demo: glow the wheel, slide it right a few detents then back to 0,
  // and show a guidance caption — so the user sees it's scrubbable. Triggered from
  // the tour's Post step. Ends at 0 (the Request form is fresh during the tour),
  // so it leaves the amount as it was.
  const [demoActive, setDemoActive] = useState(false);
  const demoGlow = useRef(new Animated.Value(0)).current;
  useEffect(() => onWheelDemo(() => {
    setDemoActive(true);
    const right = Math.min(maxIdx, idxRef.current + 14);
    const slide = (x: number) => scroller.current?.scrollTo({ x, animated: true });
    slide(right * TICK);                                  // first slide fires immediately
    setTimeout(() => slide(0), 1300);                     // ~5s total: right → 0 → right → 0
    setTimeout(() => slide(right * TICK), 2600);
    setTimeout(() => slide(0), 3900);
    setTimeout(() => setDemoActive(false), 5000);
  }), [maxIdx, step]);
  useEffect(() => {
    if (!demoActive) { demoGlow.stopAnimation(); demoGlow.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(demoGlow, { toValue: 1, duration: 600, useNativeDriver: false }),
      Animated.timing(demoGlow, { toValue: 0, duration: 600, useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [demoActive, demoGlow]);

  // Desktop: let the mouse click-drag scrub the wheel (a plain ScrollView only
  // pans via touch/trackpad on web). Dragging sets scrollLeft directly; the
  // native onScroll above then updates the value + fires the detent tick.
  const drag = useRef({ active: false, startX: 0, startScroll: 0 });
  const scrollNode = () => (scroller.current as any)?.getScrollableNode?.() as HTMLElement | undefined;
  const webDrag = Platform.OS === 'web' ? {
    onMouseDown: (e: any) => { const n = scrollNode(); if (!n) return; drag.current = { active: true, startX: e.clientX, startScroll: n.scrollLeft }; },
    onMouseMove: (e: any) => { if (!drag.current.active) return; const n = scrollNode(); if (n) n.scrollLeft = drag.current.startScroll - (e.clientX - drag.current.startX); },
    onMouseUp: () => { drag.current.active = false; },
    onMouseLeave: () => { drag.current.active = false; },
  } : {};

  // Memoized so a per-detent value change mid-scroll doesn't rebuild ~400 Views
  // on every frame — that re-render storm was making iOS drop the scroll gesture
  // and freeze the wheel after a few turns. Only rebuilds when the ruler grows
  // or the currency/step changes.
  const ticks = useMemo(() => {
    const out = [];
    for (let i = 0; i <= maxIdx; i++) {
      const major = i % MAJOR === 0;
      const mid = !major && i % MID === 0;
      out.push(
        <View key={i} style={s.wheelCell}>
          {major ? <Text style={s.wheelTickLabel}>{compactAmount(idxToValue(i), currency)}</Text> : null}
          <View style={[s.wheelTick, major ? s.wheelTickMajor : mid ? s.wheelTickMid : null]} />
        </View>,
      );
    }
    return out;
  }, [maxIdx, currency, step]);

  return (
    <>
      <Animated.View
        style={[
          s.wheelWrap,
          Platform.OS === 'web' ? ({ cursor: 'grab' } as any) : null,
          demoActive ? {
            borderRadius: 10, borderWidth: 1.5,
            borderColor: demoGlow.interpolate({ inputRange: [0, 1], outputRange: ['rgba(251,191,36,0)', 'rgba(251,191,36,1)'] }),
          } : null,
        ]}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        {...webDrag}
      >
        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="normal"
          scrollEventThrottle={16}
          onScroll={onScroll}
          onScrollBeginDrag={() => { interacting.current = true; clearTimeout(snapTimer.current); }}
          onScrollEndDrag={() => { clearTimeout(snapTimer.current); snapTimer.current = setTimeout(settle, 90); }}
          onMomentumScrollBegin={() => clearTimeout(snapTimer.current)}
          onMomentumScrollEnd={settle}
          contentContainerStyle={{ paddingHorizontal: Math.max(0, (w - TICK) / 2), alignItems: 'flex-end' }}
        >
          {ticks}
        </ScrollView>
        <View pointerEvents="none" style={s.wheelCenter}>
          <View style={s.wheelCenterTri} />
          <View style={s.wheelCenterLine} />
        </View>
      </Animated.View>
    </>
  );
}

function PaymentField({
  amount,
  currency,
  onChange,
  suggestion,
  fareEstimate,
}: {
  amount: number;
  currency: Currency;
  /** Currency is fixed by locale (no chooser); onChange always reports it back unchanged. */
  onChange: (amount: number, currency: Currency) => void;
  suggestion?: PriceSuggestion | null;
  /** Rideshare fare estimate, if any — surfaced as a one-tap "copy" button. */
  fareEstimate?: number | null;
}) {
  const sym = currencySymbol(currency);
  const suffix = symbolIsSuffix(currency);
  const [text, setText] = useState(amount > 0 ? formatAmountInput(String(amount), currency) : '');
  const [editing, setEditing] = useState(false);
  // Reflect amount changes driven from outside the field — tapping the fare
  // estimate / price suggestion, or scrubbing the wheel — so the readout updates
  // (but don't fight the user while they're typing).
  useEffect(() => { if (!editing) setText(amount > 0 ? formatAmountInput(String(amount), currency) : ''); }, [amount, editing, currency]);

  const commit = (raw: string, cur: Currency) => {
    const n = cur === 'VND' ? parseInt(raw.replace(/\D/g, ''), 10) || 0 : parseFloat(raw.replace(/[^\d.]/g, '')) || 0;
    const snapped = snapToStep(n, cur);
    onChange(snapped, cur);
    setText(snapped > 0 ? String(snapped) : '');
  };

  return (
    <View style={{ marginTop: 12 }}>
      <Text style={s.label}>{t("Payment: Cash or Instant Transfer")}</Text>
      {/* Big, tappable readout (tap to type a precise/large amount).
          Symbol sits after the number for suffix-style locales (e.g. VND). */}
      <View style={s.amountReadout}>
        <Text style={s.amountReadoutLabel}>{t('Amount')}</Text>
        {!suffix && <Text style={s.amountReadoutSym}>{sym}</Text>}
        {/* Underlined + pencil so it reads as an editable field (tap to type). */}
        <View style={s.amountReadoutField}>
          <TextInput
            style={s.amountReadoutInput}
            value={text}
            onFocus={() => setEditing(true)}
            onChangeText={(v) => setText(formatAmountInput(v, currency))}
            onBlur={() => { setEditing(false); commit(text, currency); }}
            placeholder="0"
            placeholderTextColor={palette.placeholder}
            keyboardType="numeric"
          />
        </View>
        {suffix && <Text style={[s.amountReadoutSym, { marginEnd: 0, marginStart: 6 }]}>{sym}</Text>}
        <MaterialCommunityIcons name="pencil" size={18} color={palette.accent} style={{ marginStart: 8 }} />
      </View>
      {/* Horizontal wheel picker */}
      <AmountWheel amount={amount} currency={currency} onChange={(n) => { onChange(n, currency); }} />
      {amount === 0 && (
        <Text style={s.dim}>{t('Optional — steps of {step}', { step: fmtPayment(stepFor(currency), currency) })}</Text>
      )}
      {/* One-tap copy of a suggested amount — prefers the rideshare fare estimate,
          falls back to the market "typical asking" median. The amount is edited
          inline via the readout field above (tap the underlined number). */}
      {(() => {
        const copyVal = (fareEstimate != null && fareEstimate > 0) ? fareEstimate : (suggestion?.median ?? null);
        const snapped = copyVal != null && copyVal > 0 ? snapToStep(copyVal, currency) : null;
        if (snapped == null) return null;
        return (
          <View style={s.amountBtnRow}>
            <Pressable style={[s.amountBtn, { flex: 1 }]} onPress={() => onChange(snapped, currency)}>
              <Text style={s.amountBtnText} numberOfLines={1}>{t('Use estimate {amount}', { amount: fmtPayment(snapped, currency) })}</Text>
            </Pressable>
          </View>
        );
      })()}
      {suggestion && (
        <Pressable style={{ marginTop: 4, paddingVertical: 8, alignSelf: 'flex-start' }} hitSlop={10} onPress={() => onChange(snapToStep(suggestion.median, currency), currency)}>
          <Text style={s.mapLinkText}>
            {t('\ud83d\udca1 Typical asking {median} \u00b7 most {low}\u2013{high} \u00b7 n={n}', {
              median: fmtPayment(snapToStep(suggestion.median, currency), currency),
              low: fmtPayment(snapToStep(suggestion.p25, currency), currency),
              high: fmtPayment(snapToStep(suggestion.p75, currency), currency),
              n: suggestion.n,
            })}
            {suggestion.scope === 'widened' ? ` (${t('wider area')})` : ''}
            {` \u00b7 ${t('tap to use')}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** "npub1hewi3…xyzaerh2n" → "npub1he...aerh2n" */
function shortNpub(npub: string): string {
  if (npub.length <= 16) return npub;
  return `${npub.slice(0, 7)}...${npub.slice(-6)}`;
}

function fmtWindow(w: { start: number; end: number }): string {
  const lang = getI18nLang();
  return `${new Date(w.start * 1000).toLocaleString(lang)} → ${new Date(w.end * 1000).toLocaleTimeString(lang)}`;
}

/** Extract a callable full phone number from a string; null if masked/missing. */
function extractPhone(strInput?: string): string | null {
  if (!strInput) return null;
  const m = strInput.match(/\+?\d[\d\s().-]{6,}\d/);
  if (!m) return null;
  const digits = m[0].replace(/[^\d+]/g, '');
  return /^\+?\d{8,15}$/.test(digits) ? digits : null;
}

/** A "·"-joined contact string with the phone part removed — used when a Call
 *  button already shows the number, so it isn't repeated on the contact line. */
function contactWithoutPhone(contact?: string, phone?: string | null): string {
  const c = (contact ?? '').trim();
  if (!c) return '—';
  const digits = (phone ?? '').replace(/\D/g, '');
  const parts = c.split('·').map((s) => s.trim()).filter(Boolean)
    .filter((part) => !(digits.length >= 6 && part.replace(/\D/g, '').includes(digits)));
  return parts.join(' · ') || '—';
}

// English label (= i18n key) for a negotiation state chip; t()'d at the call site
// so the chip never shows the raw machine state (e.g. "confirmed", "open").
function stateLabel(state: string): string {
  switch (state) {
    case 'open': return 'Open';
    case 'accepted_by_them': return 'Offer accepted';
    case 'confirmed': return 'Confirmed';
    case 'cancelled': return 'Cancelled';
    case 'expired': return 'Expired';
    case 'cancel_requested': return 'Cancellation requested';
    default: return state.replace(/_/g, ' ');
  }
}

function stateColor(state: string) {
  if (state === 'confirmed') return s.chipGreen;
  if (state === 'cancelled' || state === 'expired') return s.chipRed;
  if (state === 'cancel_requested') return s.chipYou;
  if (state.startsWith('accepted')) return s.chipBlue;
  return {};
}

// ─── Styles ──────────────────────────────────────────────────────────────────

interface Palette {
  appBg: string; bg: string; card: string; panel: string; inset: string;
  border: string; borderStrong: string; accentBorder: string;
  text: string; text2: string; text3: string; muted: string; dim: string; dim2: string; placeholder: string;
  chipBg: string; chipText: string; chipBlueBg: string; chipBlueText: string;
  accent: string; accentBtn: string; link: string; linkSoft: string; overlay: string;
  // Status colors (theme-aware so they read well on both dark and light surfaces)
  successBg: string; success: string; dangerBg: string; danger: string; warnBg: string; warn: string;
  shadow: string; shadowOpacity: number;
}

const DARK: Palette = {
  appBg: '#06080c', bg: '#0a0d12', card: '#111827', panel: '#0d1520', inset: '#1a2030',
  border: '#1e2a3a', borderStrong: '#2d3d50', accentBorder: '#1e3a5f',
  text: '#e8edf2', text2: '#c9d5e0', text3: '#8b97a6', muted: '#6b7a8e', dim: '#4b5a6e', dim2: '#3d4d5e', placeholder: '#4b5563',
  chipBg: '#1e2a3a', chipText: '#8b97a6', chipBlueBg: '#1e3a5f', chipBlueText: '#93c5fd',
  accent: '#3b82f6', accentBtn: '#1d4ed8', link: '#60a5fa', linkSoft: '#93c5fd', overlay: '#111827cc',
  successBg: '#064e3b', success: '#6ee7b7', dangerBg: '#450a0a', danger: '#fca5a5', warnBg: '#3b2f0a', warn: '#fbbf24',
  shadow: '#000000', shadowOpacity: 0.0,
};

const LIGHT: Palette = {
  appBg: '#e5e8ec', bg: '#f5f7fa', card: '#ffffff', panel: '#f1f5f9', inset: '#e2e8f0',
  border: '#d8dee6', borderStrong: '#cbd5e1', accentBorder: '#bcd2f0',
  text: '#0f1722', text2: '#1f2937', text3: '#475569', muted: '#64748b', dim: '#94a3b8', dim2: '#94a3b8', placeholder: '#94a3b8',
  chipBg: '#e2e8f0', chipText: '#475569', chipBlueBg: '#dbeafe', chipBlueText: '#1d4ed8',
  accent: '#3b82f6', accentBtn: '#1d4ed8', link: '#1d4ed8', linkSoft: '#1d4ed8', overlay: '#ffffffcc',
  successBg: '#dcfce7', success: '#15803d', dangerBg: '#fee2e2', danger: '#b91c1c', warnBg: '#fef3c7', warn: '#b45309',
  shadow: '#0f172a', shadowOpacity: 0.07,
};

function makeStyles(c: Palette) {
  return StyleSheet.create({
    // On web/desktop, center the app as a phone-width column instead of stretching
    // edge-to-edge; on native it's a transparent full-screen passthrough.
    appShell: Platform.OS === 'web'
      ? { flex: 1, backgroundColor: c.appBg, alignItems: 'center' }
      : { flex: 1 },
    root: { flex: 1, width: '100%', maxWidth: Platform.OS === 'web' ? 480 : undefined, backgroundColor: c.bg },
    titleBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: c.inset },
    titleBarCompact: { paddingTop: 3, paddingBottom: 3 },
    headerLogo: { width: 26, height: 26, borderRadius: 6 },
    headerLogoSmall: { width: 13, height: 13, borderRadius: 3 },
    headerCompact: { fontSize: 14 },
    header: { color: c.text, fontSize: 20, fontWeight: '800', letterSpacing: 0.5 },
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
    headerSub: { color: c.dim, fontSize: 11 },
    headerStatus: { flexDirection: 'row', alignItems: 'center', gap: 4, marginStart: 8 },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusDotWrap: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
    statusHalo: { position: 'absolute', width: 10, height: 10, borderRadius: 5 },
    statusCore: {
      width: 9, height: 9, borderRadius: 5,
      shadowOpacity: 0.9, shadowRadius: 4, shadowOffset: { width: 0, height: 0 }, elevation: 4,
    },
    headerFlag: { fontSize: 13 },
    headerRoleWrap: { marginStart: 'auto', flexDirection: 'row', alignItems: 'center', gap: 5 },
    headerRoleText: { color: c.text2, fontSize: 13, fontWeight: '700' },
    roleBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    sectionTitle: { color: c.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3, marginTop: 16, marginBottom: 4 },
    tabbar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.inset, backgroundColor: c.bg },
    tab: { flex: 1, alignItems: 'center' },
    tabCompact: { paddingVertical: 6 },
    selectField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.card, borderRadius: 8, borderWidth: 1, borderColor: c.border, paddingHorizontal: 12, paddingVertical: 12, marginTop: 4 },
    selectValue: { color: c.text, fontSize: 15 },
    selectOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
    selectOptionText: { color: c.text2, fontSize: 15 },
    selectOptionOn: { color: c.text, fontWeight: '700' },
    tabActive: { borderTopWidth: 2, borderTopColor: c.accent },
    tabText: { color: c.dim, fontSize: 11, textTransform: 'capitalize', marginTop: 2 },
    tabTextActive: { color: c.text, fontWeight: '600' },
    // Guided-tour coach-mark, anchored just above the tab bar (high zIndex so it
    // sits over the tab content). pointerEvents:box-none on the wrapper lets taps
    // pass through everywhere except the card itself.
    tourOverlay: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 16, zIndex: 50 },
    tourCard: { backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.accentBorder, padding: 16, maxWidth: 420, width: '100%', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 12 },
    tourCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    tourStepIndicator: { color: c.text3, fontSize: 12, fontWeight: '600' },
    tourText: { color: c.text, fontSize: 15, lineHeight: 21 },
    tourBtnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
    tourSkip: { color: c.text3, fontSize: 14, fontWeight: '600' },
    tourNextBtn: { backgroundColor: c.accentBtn, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 20, alignItems: 'center' },
    tourNextText: { color: 'white', fontWeight: '700', fontSize: 14 },
    // Closing note — a centered, full-screen card (not a tab pointer).
    tourFinalBackdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: c.overlay, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, zIndex: 60 },
    tourFinalCard: { backgroundColor: c.card, borderRadius: 22, borderWidth: 1, borderColor: c.accentBorder, paddingVertical: 26, paddingHorizontal: 24, maxWidth: 380, width: '100%', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 18 },
    tourFinalLogo: { width: 60, height: 60, borderRadius: 15, marginBottom: 16 },
    tourFinalHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
    tourFinalKicker: { color: c.accent, fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
    tourFinalBody: { color: c.text2, fontSize: 15.5, lineHeight: 23, textAlign: 'center' },
    tourFinalWelcome: { color: c.text, fontSize: 19, fontWeight: '800', textAlign: 'center', marginTop: 18 },
    tourFinalBtn: { backgroundColor: c.accentBtn, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 36, alignItems: 'center', marginTop: 22, alignSelf: 'stretch' },
    tourFinalBtnText: { color: 'white', fontWeight: '700', fontSize: 15.5 },
    badge: { position: 'absolute', top: -6, end: -12, backgroundColor: '#ef4444', borderRadius: 8, minWidth: 16, height: 16, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
    badgeText: { color: 'white', fontSize: 10, fontWeight: '700' },
    card: { backgroundColor: c.card, marginHorizontal: 12, marginVertical: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: c.border, shadowColor: c.shadow, shadowOpacity: c.shadowOpacity, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: c.shadowOpacity ? 2 : 0 },
    cardHighlight: { borderColor: c.accent },
    cardTitle: { color: c.text, fontWeight: '700', fontSize: 17, letterSpacing: -0.2, marginTop: 6, marginBottom: 4 },
    meta: { color: c.dim2, fontSize: 11, marginTop: 4 },
    dim: { color: c.dim, fontSize: 13 },
    pad: { padding: 16, paddingBottom: 40 },
    label: { color: c.muted, fontSize: 12, marginTop: 12, marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 },
    fieldLabelRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
    charCount: { color: c.dim, fontSize: 11, marginBottom: 3 },
    input: { backgroundColor: c.card, color: c.text, borderRadius: 8, padding: 11, borderWidth: 1, borderColor: c.border, fontSize: 15 },
    mono: { color: c.link, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 12, marginVertical: 8 },
    row: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
    rowLabel: { color: c.dim, fontSize: 12, width: 70 },
    rowValue: { color: c.text2, fontSize: 13, flex: 1 },
    btnRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
    btnAccept: { backgroundColor: c.accentBtn, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
    btnCounter: { backgroundColor: '#065f46', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
    btnDecline: { backgroundColor: '#374151', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
    btnText: { color: 'white', fontWeight: '600', fontSize: 14 },
    // Button system for the negotiation row: one filled primary + ghost + text-danger
    btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: c.accent, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
    btnGhostText: { color: c.accent, fontWeight: '600', fontSize: 14 },
    btnTextOnly: { paddingVertical: 10, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
    btnTextDanger: { color: c.danger, fontWeight: '600', fontSize: 14 },
    // Cautionary outline button (e.g. "incorrect plate/phone") — reads as a
    // warning, not a primary action.
    btnDangerOutline: { backgroundColor: c.dangerBg, borderWidth: 1, borderColor: c.danger, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center' },
    btnDangerOutlineText: { color: c.danger, fontWeight: '700', fontSize: 14 },
    inputFocused: { borderColor: c.accent },
    emptyWrap: { alignItems: 'center', justifyContent: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 10 },
    emptyText: { color: c.dim, fontSize: 14, textAlign: 'center' },
    priceTag: { color: c.text, fontSize: 16, fontWeight: '700', marginTop: 4 },
    roleGroupLabel: { color: c.text2, fontSize: 12, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 8 },
    roleGroupNote: { color: c.muted, fontSize: 12, marginTop: 1, marginBottom: 4 },
    roleCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: c.card, borderRadius: 14, borderWidth: 1, borderColor: c.border, padding: 16 },
    roleCardOn: { borderColor: c.accent, backgroundColor: c.chipBlueBg },
    roleCardTitle: { color: c.text, fontSize: 16, fontWeight: '700' },
    roleCardDesc: { color: c.muted, fontSize: 13, marginTop: 2 },
    chip: { backgroundColor: c.chipBg, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4, fontSize: 12, color: c.chipText, marginEnd: 6, marginBottom: 4 },
    vehicleChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.chipBg, borderRadius: 6, paddingHorizontal: 9, paddingVertical: 4, marginEnd: 6, marginBottom: 4 },
    vehicleChipText: { fontSize: 12, color: c.chipText },
    distChip: { backgroundColor: c.chipBlueBg, color: c.chipBlueText },
    chipGreen: { backgroundColor: c.successBg, color: c.success },
    chipBlue: { backgroundColor: c.chipBlueBg, color: c.chipBlueText },
    chipRed: { backgroundColor: c.dangerBg, color: c.danger },
    chipYou: { backgroundColor: c.warnBg, color: c.warn },
    noteBox: { backgroundColor: c.panel, borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: c.border },
    noteLabel: { color: c.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
    noteText: { color: c.text, fontSize: 14 },
    termsBox: { backgroundColor: c.panel, borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: c.border },
    termsTitle: { color: c.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
    chatBox: { marginTop: 10, padding: 10, backgroundColor: c.panel, borderRadius: 10, borderWidth: 1, borderColor: c.border },
    chatTitle: { color: c.dim, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
    chatExpand: { alignSelf: 'center', paddingVertical: 5, paddingHorizontal: 12, marginBottom: 4, borderRadius: 999, backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    chatExpandText: { color: c.accent, fontSize: 12, fontWeight: '600' },
    trackMsg: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    trackMsgText: { color: c.link, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
    // Outlined/secondary so it reads as a utility (open Maps) and never sits as a
    // second solid-blue block right above the primary "Picked up" action.
    navBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: c.card, borderWidth: 1, borderColor: c.accentBorder, borderRadius: 8, paddingVertical: 10, marginTop: 8, marginBottom: 8 },
    slideTrack: { height: 54, borderRadius: 12, backgroundColor: c.panel, borderWidth: 1, borderColor: c.accentBorder, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', marginTop: 8 },
    slideLabel: { color: c.link, fontWeight: '700', fontSize: 15 },
    slideThumb: { position: 'absolute', left: 3, top: 3, bottom: 3, width: 54, borderRadius: 9, backgroundColor: c.accentBtn, alignItems: 'center', justifyContent: 'center' },
    navBtnText: { color: c.link, fontWeight: '700' },
    chatBubble: { maxWidth: '85%', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginVertical: 3 },
    chatOut: { backgroundColor: c.accentBtn, alignSelf: 'flex-end' },
    chatIn: { backgroundColor: c.chipBg, alignSelf: 'flex-start' },
    chatBubbleText: { fontSize: 14 },
    // Theme-aware per bubble: the "out" bubble is a dark-blue button in both
    // themes (light text); the "in" bubble is the chip background, so it must use
    // the theme text colour — otherwise a hardcoded light colour made the
    // incoming (e.g. Driver's) text invisible in light theme on native.
    chatTextOut: { color: '#f5f7fa' },
    chatTextIn: { color: c.text },
    dealBanner: { backgroundColor: c.successBg, borderRadius: 10, padding: 10, marginTop: 8 },
    pendingBanner: { backgroundColor: c.warnBg, borderRadius: 10, padding: 10, marginTop: 8 },
    pendingText: { color: c.warn, fontWeight: '700' },
    pendingSub: { color: c.warn, fontSize: 13, marginTop: 2, opacity: 0.9 },
    stageLine: { color: c.text2, fontSize: 13, fontWeight: '600', marginTop: 10, marginBottom: 6 },
    cancelLink: { color: c.danger, fontSize: 12, marginTop: 10, textAlign: 'center' },
    blockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 10, marginTop: 6, marginBottom: 2 },
    blockBtnText: { color: c.danger, fontSize: 12, fontWeight: '600' },
    cancelBtn: { marginTop: 12, borderWidth: 1, borderColor: '#ef4444', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16, alignItems: 'center', alignSelf: 'stretch' },
    cancelBtnText: { color: '#ef4444', fontWeight: '700', fontSize: 14 },
    cancelBox: { marginTop: 10, padding: 10, backgroundColor: c.panel, borderRadius: 8, borderWidth: 1, borderColor: c.accentBorder },
    cancelBoxText: { color: c.text2, fontSize: 13, marginTop: 8 },
    dealText: { color: c.success, fontWeight: '700' },
    dealContact: { color: c.success, fontSize: 13, marginTop: 2 },
    callLink: { color: c.link, textDecorationLine: 'underline' },
    callBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: c.accentBtn, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14, marginTop: 8 },
    callBtnText: { color: 'white', fontSize: 13, fontWeight: '600' },
    reportLink: { color: c.danger, fontSize: 12, fontWeight: '600' },
    reportReason: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9 },
    reportReasonText: { color: c.text2, fontSize: 14, marginStart: 10 },
    radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: c.borderStrong, alignItems: 'center', justifyContent: 'center' },
    radioOn: { borderColor: c.accent },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.accent },
    chatImage: { width: 160, height: 160, borderRadius: 8, marginVertical: 3 },
    imgViewerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' },
    imgViewerScroll: { flex: 1 },
    imgViewerContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
    imgViewerImage: { width: '100%', height: '100%', flex: 1, alignSelf: 'stretch' },
    imgViewerClose: { position: 'absolute', top: 44, end: 20, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)' },
    chatAttach: { backgroundColor: c.chipBg, borderRadius: 8, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', marginStart: 8 },
    chatAttachRec: { backgroundColor: c.danger },
    voiceMsg: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 4 },
    voiceMsgText: { color: c.text, fontSize: 14, marginStart: 8 },
    addrBtn: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', marginStart: 8 },
    abRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
    abText: { color: c.text2, fontSize: 14 },
    suggestBox: { marginTop: 4, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 8, overflow: 'hidden' },
    suggestRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 11 },
    suggestRowDiv: { borderTopWidth: 1, borderTopColor: c.border },
    suggestText: { color: c.text2, fontSize: 14, flex: 1 },
    counterBox: { marginTop: 12, padding: 12, backgroundColor: c.panel, borderRadius: 10, borderWidth: 1, borderColor: c.accentBorder },
    authorAvatar: { width: 22, height: 22, borderRadius: 11, backgroundColor: c.inset, marginEnd: 6 },
    authorName: { color: c.dim, fontSize: 12 },
    avatarRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
    statsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, padding: 12, backgroundColor: c.panel, borderRadius: 10, borderWidth: 1, borderColor: c.border },
    statBox: { flex: 1, alignItems: 'center' },
    statValue: { color: c.text, fontSize: 14, fontWeight: '700' },
    statLabel: { color: c.dim, fontSize: 10, marginTop: 2, textAlign: 'center' },
    avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: c.inset },
    avatarEmpty: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.border, borderStyle: 'dashed' },
    avatarPlaceholder: { color: c.dim, fontSize: 28 },
    imageGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    imageThumbWrap: { position: 'relative' },
    imageThumb: { width: 80, height: 80, borderRadius: 8, backgroundColor: c.inset },
    imageRemove: { position: 'absolute', top: -6, end: -6, backgroundColor: '#374151', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
    imageRemoveText: { color: 'white', fontSize: 10, fontWeight: '700' },
    imageAdd: { width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderColor: c.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
    imageAddText: { color: c.dim, fontSize: 13, textAlign: 'center' },
    segRow: { flexDirection: 'row', marginTop: 8, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
    seg: { flex: 1, flexDirection: 'row', paddingVertical: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card },
    segActive: { backgroundColor: c.chipBlueBg },
    segText: { color: c.dim, fontWeight: '600' },
    segTextActive: { color: c.chipBlueText },
    karmaLabel: { color: c.warn, fontSize: 11, marginStart: 6 },
    authorPhone: { color: c.dim, fontSize: 11, marginStart: 6 },
    authorVehicle: { color: c.text3, fontSize: 12, marginTop: 3 },
    waitTrack: { height: 3, borderRadius: 2, backgroundColor: c.inset, overflow: 'hidden', marginBottom: 8 },
    waitFill: { height: 3, borderRadius: 2, backgroundColor: c.accent },
    sysNotice: { flexDirection: 'row', gap: 10, marginHorizontal: 12, marginTop: 10, padding: 12, backgroundColor: c.panel, borderWidth: 1, borderColor: c.accentBorder, borderRadius: 12 },
    sysIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: c.inset, alignItems: 'center', justifyContent: 'center' },
    sysSender: { color: c.accent, fontWeight: '700', fontSize: 13 },
    sysText: { color: c.text2, fontSize: 13, marginTop: 2 },
    sysDetail: { color: c.text3, fontSize: 12, marginTop: 4 },
    repLine: { color: c.warn, fontSize: 11, marginTop: 3, marginStart: 28 },
    newBadge: { backgroundColor: c.warnBg, color: c.warn, fontSize: 10, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, marginStart: 6, overflow: 'hidden' },
    checkRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
    checkbox: { width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
    checkboxOn: { backgroundColor: c.accentBtn, borderColor: c.accent },
    checkboxTick: { color: 'white', fontSize: 12, fontWeight: '700' },
    checkLabel: { color: c.text2, fontSize: 13, marginStart: 8, flex: 1 },
    fieldError: { color: c.danger, fontSize: 12, marginTop: 4 },
    warnNote: { color: c.warn, fontSize: 12, marginTop: 6 },
    requiredBox: { backgroundColor: c.warnBg, borderRadius: 12, borderWidth: 1, borderColor: c.warn, padding: 12, marginBottom: 16, gap: 8 },
    requiredTitle: { color: c.warn, fontSize: 15, fontWeight: '800', marginBottom: 2 },
    requiredBtn: { backgroundColor: c.accentBtn, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    requiredBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    requiredRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    requiredDismiss: { width: 38, alignSelf: 'stretch', borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: c.card, borderWidth: 1, borderColor: c.border },
    requiredDismissText: { color: c.text2, fontSize: 14, fontWeight: '700' },
    collapseHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, marginTop: 12, borderTopWidth: 1, borderTopColor: c.border },
    collapseLeft: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
    collapseIcon: { marginEnd: 12, width: 22, textAlign: 'center' },
    collapseTitle: { color: c.text, fontSize: 18, fontWeight: '700', letterSpacing: 0.2 },
    searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
    searchInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: c.card, borderRadius: 8, borderWidth: 1, borderColor: c.border, paddingHorizontal: 10 },
    searchInput: { flex: 1, color: c.text, fontSize: 14, paddingVertical: 9 },
    sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.panel, borderRadius: 8, borderWidth: 1, borderColor: c.accentBorder, paddingHorizontal: 10, paddingVertical: 9, maxWidth: 150 },
    sortBtnText: { color: c.linkSoft, fontSize: 12, fontWeight: '600', marginStart: 3 },
    sortBtnContent: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', flexShrink: 1 },
    sortChipItem: { flexDirection: 'row', alignItems: 'center' },
    sortBtnSep: { color: c.linkSoft, fontSize: 12, fontWeight: '600', marginHorizontal: 3 },
    catScroll: { flexGrow: 0, flexShrink: 0 },
    catRow: { paddingHorizontal: 12, paddingBottom: 6, gap: 8, flexDirection: 'row', alignItems: 'center' },
    catBack: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: c.panel, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: c.accentBorder },
    catBackText: { color: c.chipBlueText, fontSize: 12, fontWeight: '600' },
    catChip: { backgroundColor: c.card, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: c.border },
    catChipRow: { flexDirection: 'row', alignItems: 'center' },
    catChipIcon: { marginEnd: 5 },
    catChipOn: { backgroundColor: c.accentBtn, borderColor: c.accent },
    catChipText: { color: c.chipText, fontSize: 12 },
    catChipTextOn: { color: 'white', fontWeight: '600' },
    sortBackdrop: { flex: 1, backgroundColor: '#000000aa', justifyContent: 'flex-end' },
    sortSheet: { backgroundColor: c.bg, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, borderTopWidth: 1, borderColor: c.border },
    sortChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
    sortChip: { backgroundColor: c.chipBg, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: c.borderStrong },
    sortChipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    sortChipOn: { backgroundColor: c.accentBtn, borderColor: c.accent },
    sortChipText: { color: c.muted, fontSize: 13 },
    sortChipTextOn: { color: 'white', fontWeight: '600' },
    pinBtn: { backgroundColor: c.accentBtn, borderRadius: 8, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', marginStart: 8 },
    pinnedHint: { color: c.success, fontSize: 12, marginTop: 4 },
    pinPrompt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.accentBtn, borderRadius: 8, paddingVertical: 12, marginTop: 4 },
    pinPromptText: { color: 'white', fontWeight: '600', fontSize: 14 },
    mapModal: { flex: 1, backgroundColor: c.bg },
    mapModalBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.inset },
    mapModalTitle: { color: c.text, fontSize: 14, fontWeight: '600' },
    mapModalCancel: { color: c.text3, fontSize: 15 },
    mapModalDone: { color: c.link, fontSize: 15, fontWeight: '700' },
    mapCenterPin: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', marginBottom: 40, zIndex: 1000, elevation: 1000 },
    mapLocating: { position: 'absolute', top: 16, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', backgroundColor: c.overlay, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
    pickerBox: { backgroundColor: c.card, borderRadius: 8, borderWidth: 1, borderColor: c.border, marginTop: 4, overflow: 'hidden' },
    pickerField: { color: c.text, backgroundColor: c.card, borderWidth: 0, height: Platform.OS === 'ios' ? 150 : 52 },
    pickerItem: { color: c.text, fontSize: 16, height: 150 },
    toggleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
    toggleTitle: { color: c.text, fontSize: 14, fontWeight: '600', marginBottom: 2 },
    switchTrack: { width: 46, height: 28, borderRadius: 14, backgroundColor: c.chipBg, padding: 3, justifyContent: 'center' },
    switchTrackOn: { backgroundColor: c.accentBtn },
    switchThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: c.muted },
    switchThumbOn: { backgroundColor: 'white', alignSelf: 'flex-end' },
    collapseChevron: { color: c.text3, fontSize: 18, fontWeight: '700' },
    map: { height: 160, borderRadius: 10, marginTop: 8, overflow: 'hidden' },
    timeBtn: { flex: 1, backgroundColor: c.card, borderRadius: 8, padding: 11, borderWidth: 1, borderColor: c.border, flexDirection: 'row', alignItems: 'baseline' },
    timeBtnText: { color: c.text, fontSize: 16, fontWeight: '600' },
    timeBtnHint: { color: c.dim, fontSize: 12, marginStart: 8 },
    stepBtn: { backgroundColor: c.chipBg, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14, marginStart: 8, alignItems: 'center', justifyContent: 'center' },
    stepBtnText: { color: c.chipBlueText, fontSize: 14, fontWeight: '700' },
    wheelRow: { flexDirection: 'row', backgroundColor: c.card, borderRadius: 8, borderWidth: 1, borderColor: c.border, overflow: 'hidden' },
    wheel: { flex: 1, color: c.text, backgroundColor: c.card, borderWidth: 0, height: Platform.OS === 'ios' ? 130 : 50 },
    wheelItem: { color: c.text, fontSize: 17, height: 130 },
    amountField: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginStart: 8 },
    amountSymbol: { color: c.text3, fontSize: 15, fontWeight: '700', marginEnd: 4 },
    amountInputInner: { color: c.text, fontSize: 15, textAlign: 'center', padding: 0, minWidth: 60 },
    curChip: { backgroundColor: c.card, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: c.border, marginEnd: 8 },
    curChipActive: { backgroundColor: c.chipBlueBg, borderColor: c.accent },
    curChipText: { color: c.dim, fontSize: 14, fontWeight: '700' },
    curChipTextActive: { color: c.chipBlueText },
    amountInput: { flex: 1, marginStart: 8, textAlign: 'center' },
    // Amount readout + horizontal wheel picker
    // Bounded + centered so on wide (web/desktop) viewports the field underline
    // doesn't stretch full-width and push the "Amount" label off the left edge.
    // Hug content + center (do NOT set width:'100%' — with justifyContent center
    // that leaves free space the underlined field expands into, shoving the
    // "Amount" label and currency symbol out to the two edges). maxWidth caps it
    // on wide/desktop viewports; the value field shrinks if it ever overflows.
    amountReadout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 6, alignSelf: 'center', maxWidth: 360 },
    amountReadoutLabel: { color: c.text3, fontSize: 13, fontWeight: '600', marginEnd: 8, flexShrink: 0 },
    amountReadoutField: { borderBottomWidth: 2, borderBottomColor: c.accentBorder, flexShrink: 1 },
    amountReadoutSym: { color: c.text3, fontSize: 20, fontWeight: '700', marginEnd: 6, flexShrink: 0 },
    amountReadoutInput: { color: c.text, fontSize: 30, fontWeight: '800', textAlign: 'center', padding: 0, minWidth: 80, letterSpacing: 0.5 },
    amountBtnRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
    amountBtn: { flex: 1, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: c.accentBorder, backgroundColor: c.panel, alignItems: 'center' },
    amountBtnText: { color: c.link, fontSize: 13, fontWeight: '600' },
    wheelWrap: { height: 60, marginTop: 6, justifyContent: 'flex-end' },
    wheelCell: { width: 14, alignItems: 'center', justifyContent: 'flex-end', height: 52 },
    wheelTick: { width: 2, height: 12, backgroundColor: c.dim, borderRadius: 1 },
    wheelTickMid: { height: 18, backgroundColor: c.text3 },
    wheelTickMajor: { width: 2.5, height: 26, backgroundColor: c.text2 },
    // Absolutely positioned + single-line so a label like "300k" overflows the
    // 14px tick cell (centered over the tick) instead of wrapping to two lines.
    wheelTickLabel: { position: 'absolute', top: 0, left: -19, width: 52, textAlign: 'center', color: c.text2, fontSize: 11, fontWeight: '700' },
    wheelCenter: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'flex-end' },
    wheelCenterLine: { width: 3, height: 32, borderRadius: 2, backgroundColor: c.link },
    wheelCenterTri: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: c.link, marginBottom: 1 },
    mapLink: { marginTop: 8, alignSelf: 'flex-start', backgroundColor: c.panel, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: c.accentBorder },
    mapLinkText: { color: c.link, fontSize: 12, fontWeight: '600' },
    codeBox: { marginTop: 10, backgroundColor: c.panel, borderRadius: 8, borderWidth: 1, borderColor: c.border, padding: 10 },
    codeText: { color: c.text2, fontSize: 12.5, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', lineHeight: 19 },
    link: { color: c.link, fontWeight: '600' },
    respondBtn: { marginTop: 10, backgroundColor: c.accentBtn, borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
    respondBtnText: { color: 'white', fontWeight: '600', fontSize: 14 },
    respondedText: { color: c.success, fontSize: 12, marginTop: 10, fontWeight: '600' },
    rateBtn: { marginTop: 8, alignSelf: 'flex-start', backgroundColor: c.chipBlueBg, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
    rateBtnText: { color: c.chipBlueText, fontSize: 12, fontWeight: '600' },
    ratedText: { color: c.dim, fontSize: 12, marginTop: 6 },
    karmaBtns: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
    karmaBtn: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: c.chipBg, borderWidth: 1, borderColor: c.borderStrong },
    karmaBtnActive: { backgroundColor: c.accentBtn, borderColor: c.accent },
    karmaBtnText: { color: c.muted, fontSize: 13 },
    karmaBtnTextActive: { color: 'white', fontWeight: '600' },
  });
}

let s = makeStyles(DARK);
/** Active palette — for inline JSX colors (e.g. Picker.Item) that can't read `s`. */
let palette: Palette = DARK;
/** Swap the active palette; caller must trigger a re-render afterwards. */
function applyTheme(mode: 'dark' | 'light') {
  palette = mode === 'light' ? LIGHT : DARK;
  s = makeStyles(palette);
}
