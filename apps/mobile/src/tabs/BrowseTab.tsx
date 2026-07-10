import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { type Intent, type ProposedTerms } from '@freeport/protocol';
import { AreaMap } from '../Map';
import { t, tn } from '../i18n';
import { MobileClient } from '../client';
import { type UserLocation } from '../prefs';
import { locQuery, locRefSeed, locRefStore, locRefHas, userGeohashSeed, userGeohashStore } from '../localityRef';
import { passesDistance, passesCategory, matchesKeywords } from '../browseFilter';
import { searchableText } from '../deals';
import { geohashToCoords, coordsToGeohash, getCurrentCoords, detectCoordsIP, geohashForPlace, routeUrl, placeUrl, placeParam, distanceKmBetweenGeohashes, formatDistance, effectiveUnit } from '../maps';
import { SERVICE_CATEGORIES, RIDESHARE_CATEGORY, DEFAULT_RIDESHARE_SUBCATEGORY, VEHICLE_ICONS, categoryIcon, subcategoryIcon, subcategoriesFor } from '../categories';
import { reverseRaw } from '../nominatim';
import { COUNTRIES, currencyForMarket, offerCurrency, fmtMoney, type Currency } from '../locations';
import { dirIcon } from '../rtl';
import { maskPhone, isDisplayablePhone } from '../profile';
import { getPow } from 'nostr-tools/nip13';
import { s, palette } from '../ui/theme';
import { defaultIntentTime, timeToWindow, parsePayment, fmtWindow, extractPhone, myPostTitle, primaryGeohash } from '../ui/format';
import { uiAlert, openMaps } from '../ui/alerts';
import { Row, DurationField, TimeField, PaymentField, Field } from '../ui/fields';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
const COUNTRY_NAME: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name]));
const fmtPayment = fmtMoney;

export function MarketTab({
  intents,
  client,
  servicesEnabled,
  location,
  myContact,
  doneListingKeys,
  distanceUnitPref,
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
  distanceUnitPref: 'auto' | 'km' | 'mi';
  defaultCategory: string;
  defaultSubcategory: string;
  maxDistance: number;
  onScroll?: (e: any) => void;
}) {
  const country = location.country;
  // Resolve the unit HERE from the raw preference + this tab's own location —
  // the same inputs and helper the Settings label uses — so Browse can never
  // show miles while Settings says km (user report).
  const distanceUnit = effectiveUnit(distanceUnitPref, country);
  const [mapOpenId, setMapOpenId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [respondedIds, setRespondedIds] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [sortPrefs, setSortPrefs] = useState<SortKey[]>(['best', 'none', 'none']);
  const [sortOpen, setSortOpen] = useState(false);
  const [userGeohash, setUserGeohash] = useState<string | null>(userGeohashSeed());
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
      if (c) { const gh = coordsToGeohash(c.latitude, c.longitude); userGeohashStore(gh); setUserGeohash(gh); }
    })();
  }, []);

  // Locality reference: geocode the user's SELECTED location (Singapore, etc.)
  // as a fallback "where am I" point when the device gives us nothing.
  // `locRefSettled` marks the geocode as finished (found or not): until then we
  // hold the feed back rather than render it unfiltered and yank far posts away
  // half a second later when the reference arrives (user-reported flicker).
  // Seeded from the localityRef module cache so a tab-switch remount renders
  // instantly instead of re-entering the "finding posts near you" state.
  const locQ = locQuery(location, (c) => COUNTRY_NAME[c] ?? c);
  const [locRef, setLocRef] = useState<string | null>(() => locRefSeed(locQ).gh);
  const [locRefSettled, setLocRefSettled] = useState(() => locRefSeed(locQ).settled);
  useEffect(() => {
    if (!locQ) { setLocRef(null); setLocRefSettled(true); return; }
    let cancelled = false;
    // Already seeded for this query → refresh silently in the background.
    if (!locRefHas(locQ)) setLocRefSettled(false);
    geohashForPlace(locQ, '')
      .then((gh) => { if (!cancelled) { setLocRef(gh || null); locRefStore(locQ, gh || null); } })
      .finally(() => { if (!cancelled) setLocRefSettled(true); });
    return () => { cancelled = true; };
  }, [locQ]);
  // Distance reference: prefer the PRECISE device point (GPS, else coarse IP) over
  // the selected-location geocode. The latter is only a region centroid when the
  // user picked country+state with no city — comparing that centroid against a
  // listing's exact pin yielded misleading distances (e.g. "31 km" between parties
  // in the same town). Region/market filtering still uses `location` separately.
  const ref = userGeohash ?? locRef;
  // Feed is "settling" while the user HAS a selected location but its geocode
  // hasn't resolved yet (and no device point either). Rendering during this
  // window would show far-away posts unfiltered, then hide them on resolve.
  const refSettling = !ref && !!location.country && !locRefSettled;

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
    // Category + subcategory filter (see browseFilter.ts) — the subcategory
    // (vehicle class) applies even with the Service/Product vertical off.
    const byCategory = visible.filter((i) =>
      passesCategory(i.content.schema, i.content.payload as any, servicesEnabled, filterCat, filterSub));
    // Distance filter (see src/browseFilter.ts): rides default to NEAR_KM, but
    // the user's explicit Max distance preference overrides it in BOTH
    // directions — raising it to 1000 km must actually show farther rides.
    // Skipped entirely without a reference point; posts without a geohash are
    // never hidden — so discovery never silently breaks.
    const withinMax = ref
      ? byCategory.filter((i) => {
          const pl = i.content.payload as any;
          const isRide = i.content.schema.startsWith('rideshare');
          const gh = isRide ? pl?.from?.geohash : pl?.location?.geohash;
          return passesDistance(isRide, gh ? distKm(gh) : null, maxDistance, distanceUnit);
        })
      : byCategory;
    // Keyword filter across title, locations, payment, notes, and author name
    const filtered = kw ? withinMax.filter((i) => matchesKeywords(searchableText(i, client), kw)) : withinMax;
    // Posts that exist but were hidden by the locality/max-distance filters —
    // surfaced in the empty state so a distance-filtered feed doesn't
    // masquerade as an empty network ("waiting for posts…" while posts exist).
    const hiddenFar = byCategory.length - withinMax.length;
    let nearestHiddenKm: number | null = null;
    if (hiddenFar > 0) {
      const kept = new Set(withinMax.map((i) => i.id));
      for (const i of byCategory) {
        if (kept.has(i.id)) continue;
        const pl = i.content.payload as any;
        const gh = i.content.schema.startsWith('rideshare') ? pl?.from?.geohash : pl?.location?.geohash;
        const km = distKm(gh);
        if (km != null && (nearestHiddenKm == null || km < nearestHiddenKm)) nearestHiddenKm = km;
      }
    }
    // Multi-level sort by the chosen first/second/third criteria
    const list = [...filtered].sort((a, b) => {
      for (const key of sortPrefs) {
        if (key === 'none') continue;
        const c = compareBy(key, a, b, client, ref, distKm);
        if (c !== 0) return c;
      }
      return 0;
    });
    return { list, hiddenFar, nearestHiddenKm };
  }, [intents, servicesEnabled, filterCat, filterSub, kw, sortPrefs, ref, client, nowTick, doneListingKeys, maxDistance, distanceUnit, distKm]);

  const paged = refSettling ? [] : shown.list.slice(0, limit);
  const hasMore = shown.list.length > paged.length;
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
      {/* Vehicle-class chips when the Service/Product vertical is OFF: the
          subcategory filter still applies (Settings default), so the user
          needs an in-feed way to switch it. */}
      {!servicesEnabled && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.catScroll}
          contentContainerStyle={s.catRow}
        >
          {subcategoriesFor(RIDESHARE_CATEGORY).map((sub) => (
            <Pressable
              key={sub}
              style={[s.catChip, s.catChipRow, filterSub === sub && s.catChipOn]}
              onPress={() => setFilterSub(filterSub === sub ? null : sub)}
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
        </ScrollView>
      )}
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
          <Ionicons
            name={kw ? 'search-outline' : refSettling ? 'locate-outline' : shown.hiddenFar > 0 ? 'compass-outline' : 'radio-outline'}
            size={40}
            color={palette.dim}
          />
          <Text style={s.emptyText}>
            {kw ? t('No matches for your filter.')
              : refSettling ? t('Finding posts near you…')
              : shown.hiddenFar > 0
                ? (shown.nearestHiddenKm != null
                    ? t('{n} posts are outside your area — the nearest is {dist} away.', { n: shown.hiddenFar, dist: formatDistance(shown.nearestHiddenKm, location.country || undefined, distanceUnit) })
                    : t('{n} posts are outside your area.', { n: shown.hiddenFar }))
                : t('Waiting for posts/requests on the network…')}
          </Text>
          {!kw && !refSettling && shown.hiddenFar > 0 ? (
            <Text style={[s.emptyText, { fontSize: 12, marginTop: 6 }]}>
              {t('Increase Max distance in Settings to see posts farther away.')}
            </Text>
          ) : null}
        </View>
      }
      ListFooterComponent={
        paged.length > 0 ? (
          <Text style={[s.dim, { textAlign: 'center', padding: 12 }]}>
            {hasMore ? t('Showing {n} of {m} — scroll for more', { n: paged.length, m: shown.list.length }) : tn(shown.list.length, '{n} result', '{n} results')}
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
              <Text style={s.label}>{t(tier)}</Text>
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
  // Unpriced posts default the offer to the POST's market currency (a Hanoi
  // ride → VND) — a Singaporean responding to a Hanoi post was getting SGD.
  const intentPay = parsePayment(p.payment, currencyForMarket(intent.content.market, 'USD'));
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

  // Unpriced ride: the market topic can carry the POSTER's selected country,
  // not the pickup's (a Vietnam pickup posted into an SG market showed S$).
  // Resolve the pickup geohash to its country (cached Nominatim lookup) and
  // switch the offer currency — unless the user already changed it.
  useEffect(() => {
    if (intentPay.amount > 0 || !isRide) return; // priced → poster's currency stands
    const gh = p.from?.geohash;
    const coords = gh ? geohashToCoords(gh) : null;
    if (!coords) return;
    let cancelled = false;
    (async () => {
      const raw = await reverseRaw(coords.latitude, coords.longitude);
      if (cancelled || !raw?.countryCode) return;
      const derived = offerCurrency(null, raw.countryCode, intent.content.market);
      setPayCurrency((cur) => (cur === intentPay.currency ? derived : cur));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
