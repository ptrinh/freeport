import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  findNodeHandle,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  DEMO_MARKET,
  DEMO_SCHEMA,
  SERVICE_MARKET,
  SERVICE_SCHEMA,
  geohashPrefixes,
  type Intent,
  type Negotiation,
} from '@freeport/protocol';
import { PickerMap } from '../Map';
import { t, tn } from '../i18n';
import { MobileClient } from '../client';
import { type UserLocation } from '../prefs';
import { type UserProfile } from '../profile';
import { loadAddressBook, addRecent, togglePinned, isPinned, type AddressBook } from '../addressbook';
import { SERVICE_CATEGORIES, SERVICE_SUBCATEGORIES, RIDESHARE_CATEGORY, RIDESHARE_SUBCATEGORIES, DEFAULT_RIDESHARE_SUBCATEGORY, VEHICLE_ICONS, categoryIcon, subcategoryIcon, categoryOf, subcategoryOf, subcategoriesFor } from '../categories';
import { geohashForPlace, geohashToCoords, coordsToGeohash, getCurrentCoords, forwardGeocode, reverseGeocode, distanceKmBetweenGeohashes, suggest } from '../maps';
import { intentTopics } from '../topics';
import { suggestPrice, estimateFare } from '../pricing';
import { COUNTRY_NAME, type Currency } from '../locations';
import { scrollNodeIntoView, type ScrollableNode } from '../scrollToNode';
import { s, palette } from '../ui/theme';
import { uiAlert } from '../ui/alerts';
import { defaultIntentTime, fmtClock, fmtClockTitle, timeToWindow, snapToStep, shortPlace, myPostTitle, vehicleLabel, fmtPayment, parsePayment } from '../ui/format';
import { Field, SelectField, SideToggle, PostButton, ImagePickerField, TimeField, DurationField, PaymentField, WaitingBar } from '../ui/fields';

type PostType = 'rideshare' | 'service';

// ─── Post tab ────────────────────────────────────────────────────────────────

export function PostTab({
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
  draft = null,
  onDraftConsumed,
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
  /** Repost: prefill the form from a completed post (time excluded). */
  draft?: import('../deals').RepostDraft | null;
  onDraftConsumed?: () => void;
  onScroll?: (e: any) => void;
}) {
  // Repost draft: land on the matching form type with it open.
  useEffect(() => {
    if (!draft) return;
    setType(draft.schema.startsWith('rideshare') ? 'rideshare' : 'service');
    setFormOpen(true);
  }, [draft]);

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
                ? <RideshareForm client={client} profile={profile} defaultCurrency={defaultCurrency} location={location} onPosted={markPosted} myIntents={myIntents} negos={negos} scrollRef={formScroll} draft={draft?.schema.startsWith('rideshare') ? draft : null} onDraftConsumed={onDraftConsumed} />
                : <ServiceForm client={client} profile={profile} defaultCurrency={defaultCurrency} location={location} onPosted={markPosted} defaultCategory={browseIsService ? browseCategory : undefined} defaultSubcategory={browseIsService ? browseSubcategory : undefined} scrollRef={formScroll} draft={draft && !draft.schema.startsWith('rideshare') ? draft : null} onDraftConsumed={onDraftConsumed} />}
            </Animated.View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Indeterminate "running line" — a segment sliding across, to reassure the
 *  user that their post is live while they wait for offers. */
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
    try {
      await client.withdrawIntent(intent);
    } catch (e) {
      // Surface it — a swallowed failure leaves the listing live while the UI
      // implies it was withdrawn.
      uiAlert(t('Could not withdraw'), e instanceof Error ? e.message : undefined);
    } finally { setCancelling(false); setConfirming(false); }
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

function RideshareForm({ client, profile, defaultCurrency, location, onPosted, myIntents, negos, scrollRef, draft, onDraftConsumed }: { client: MobileClient | null; profile: UserProfile; defaultCurrency: Currency; location: UserLocation; onPosted?: () => void; myIntents: Intent[]; negos: Negotiation[]; scrollRef?: React.RefObject<ScrollView | null>; draft?: import('../deals').RepostDraft | null; onDraftConsumed?: () => void }) {
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
  // Repost: copy everything from the completed post except the TIME (kept at
  // the form default — reposting a past departure would be born-expired).
  useEffect(() => {
    if (!draft) return;
    if (draft.from) setFrom(draft.from);
    setFromGeohash(draft.fromGeohash ?? null);
    if (draft.to) setTo(draft.to);
    if (draft.category) setCategory(draft.category);
    if (draft.payment) setPayAmount(parsePayment(draft.payment, defaultCurrency).amount);
    setNote(draft.note ?? '');
    setImages(draft.images ?? []);
    onDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
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
      uiAlert(t('Too many requests'), t('You can have at most 3 live ride requests at a time. Cancel one in My Requests first.'));
      return;
    }
    if (newIsLong && liveRides.some(isLong)) {
      setLimitErr(t('You can have only 1 flexible or long (over 2 hours) ride request at a time. Cancel it, or pick a pickup time within 2 hours.'));
      uiAlert(t('Too many open-ended requests'), t('You can have only 1 flexible or long (over 2 hours) ride request at a time. Cancel it, or pick a pickup time within 2 hours.'));
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
      uiAlert(t('Posted'), t('Your ride request is live.'));
    } catch (e: any) {
      uiAlert(t('Not allowed'), e?.message ?? t('Could not post.'));
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

function ServiceForm({ client, profile, defaultCurrency, location: userLocation, onPosted, defaultCategory, defaultSubcategory, scrollRef, draft, onDraftConsumed }: { client: MobileClient | null; profile: UserProfile; defaultCurrency: Currency; location: UserLocation; onPosted?: () => void; defaultCategory?: string; defaultSubcategory?: string; scrollRef?: React.RefObject<ScrollView | null>; draft?: import('../deals').RepostDraft | null; onDraftConsumed?: () => void }) {
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
  // Repost: copy everything from the completed post except the TIME.
  useEffect(() => {
    if (!draft) return;
    if (draft.location) setLocation(draft.location);
    setLocationGeohash(draft.locationGeohash ?? null);
    if (draft.service) setService(draft.service);
    if (draft.category) setCategory(draft.category);
    if (draft.subcategory) setSubcategory(draft.subcategory);
    if (draft.payment) setPayAmount(parsePayment(draft.payment, defaultCurrency).amount);
    if (draft.durationMinutes) { setDurHours(Math.floor(draft.durationMinutes / 60)); setDurMinutes(draft.durationMinutes % 60); }
    setNotes(draft.note ?? '');
    setImages(draft.images ?? []);
    onDraftConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
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
      uiAlert(t('Posted'), side === 'offer' ? t('Your service offer is live.') : t('Your service request is live.'));
    } catch (e: any) {
      uiAlert(t('Not allowed'), e?.message ?? t('Could not post.'));
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
