import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { t } from '../i18n';
import { hasNip07, type Signer } from '../signer';
import { maskPhone, maskPlate, type UserProfile, type PhoneDisplay } from '../profile';
import { MobileClient } from '../client';
import { loadPrefs, savePrefs, type UserLocation } from '../prefs';
import { getStoredNsec } from '../identity';
import { backupToFile, buildCloudBundle } from '../backup';
import { cloudAvailable, cloudSave, cloudRestore, cloudName } from '../cloudBackup';
import { kvSet } from '../kv';
import { uploadImage, UploadError } from '../upload';
import { normalizePhone, detectDialCode, dialForCountry } from '../phone';
import { requestLocationPermission, effectiveUnit } from '../maps';
import { requestNotifications } from '../notify';
import { pushSupported, enablePush, updatePush, disablePush, pushStatus, type PushStatus, type PushFilters } from '../push';
import { requestTelegramLink, telegramLinkStatus } from '../telegramLink';
import { LANGUAGE_CODES, languageLabel } from '../language';
import { SERVICE_CATEGORIES, RIDESHARE_CATEGORY, DEFAULT_RIDESHARE_SUBCATEGORY, categoryIcon, subcategoryIcon, subcategoriesFor } from '../categories';
import { browseTopic } from '../topics';
import { type FareConfig } from '../pricing';
import { COUNTRIES, currencySymbol, flagEmoji, levelsOf, statesOf, citiesOf, type Currency } from '../locations';
import { versionLabel, checkForUpdate, applyUpdate, getTrack, setTrack, trackSupported, type UpdateTrack } from '../updates';
import { isTauri, hostStart, hostStop, hostStatus, type HostStatus } from '../desktopHost';
import { s, palette } from '../ui/theme';
import { isIOSWeb, isStandalonePWA, shortNpub } from '../ui/format';
import { uiAlert, confirmAsync } from '../ui/alerts';
import { Field, SelectField, ImagePickerField, NumberField, QuickLocationSearch } from '../ui/fields';
import { SelfStats } from './MessagesTab';

// Country codes sorted A–Z by name, plus a code→name lookup, for the Location picker.
const COUNTRY_CODES_AZ: string[] = [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name)).map((c) => c.code);
const COUNTRY_NAME: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name]));

// ─── Key tab ─────────────────────────────────────────────────────────────────

/** Desktop-only: run a built-in HTTP server that serves the Freeport web app
 *  (this same bundle) on a chosen port, so anyone on the LAN can open it in a
 *  browser — a zero-infra way to share/self-host Freeport. Rendered only when
 *  isTauri(). The Rust side lives in apps/desktop/src-tauri. */
function DesktopHostPanel() {
  const [portText, setPortText] = useState('1988');
  const [withNotify, setWithNotify] = useState(false);
  const [tgToken, setTgToken] = useState('');
  const [tgPass, setTgPass] = useState('');
  const [tgOpen, setTgOpen] = useState(false);
  const [status, setStatus] = useState<HostStatus>({ running: false, port: 0, notify: false, telegram: false, notify_available: false, urls: [], relay_urls: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { hostStatus().then(setStatus).catch(() => {}); }, []);

  const toggle = async () => {
    setError(null);
    setBusy(true);
    try {
      if (status.running) {
        setStatus(await hostStop());
      } else {
        const port = parseInt(portText.trim(), 10);
        if (!Number.isFinite(port) || port < 1024 || port > 65535) {
          setError(t('Enter a port between 1024 and 65535.'));
          return;
        }
        const useNotify = withNotify && status.notify_available;
        setStatus(await hostStart(port, useNotify, useNotify ? tgToken : '', useNotify ? tgPass : ''));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ marginTop: 22 }}>
      <Text style={s.sectionTitle}>{t('Host Freeport for others')}</Text>
      <Text style={[s.dim, { marginTop: 4 }]}>{t('Serve this app on your network so anyone nearby can open it in a browser — no install, no store. The shared app still connects directly to the public relays.')}</Text>

      {!status.running ? (
        <>
          <View style={{ marginTop: 12 }}>
            <Field label={t('Port')} value={portText} onChange={setPortText} placeholder="1988" keyboardType="number-pad" />
          </View>
          {status.notify_available && (
            <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }} onPress={() => setWithNotify((v) => !v)}>
              <Ionicons name={withNotify ? 'checkbox' : 'square-outline'} size={22} color={withNotify ? palette.accent : palette.text3} />
              <View style={{ flex: 1 }}>
                <Text style={s.toggleTitle}>{t('Also host notifications, MCP + a relay')}</Text>
                <Text style={[s.dim, { fontSize: 12 }]}>{t('Runs the push notifier, MCP endpoint and a Nostr relay too — a full node. Best on an always-on machine.')}</Text>
              </View>
            </Pressable>
          )}
          {status.notify_available && withNotify && (
            <View style={{ marginTop: 10, marginStart: 32 }}>
              <Pressable style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} onPress={() => setTgOpen((v) => !v)}>
                <Ionicons name={tgOpen ? 'chevron-down' : 'chevron-forward'} size={16} color={palette.text3} />
                <Text style={s.dim}>{t('Telegram bridge (optional)')}</Text>
              </Pressable>
              {tgOpen && (
                <View style={{ marginTop: 8 }}>
                  <Field label={t('Telegram bot token')} value={tgToken} onChange={setTgToken} placeholder="123456:AA…" secure />
                  <Text style={[s.dim, { fontSize: 12, marginTop: 4 }]}>{t('From @BotFather. Relays a market feed into groups and sends content-blind pings.')}</Text>
                  <View style={{ marginTop: 10 }}>
                    <Field label={t('Guest-mode passphrase (advanced)')} value={tgPass} onChange={setTgPass} placeholder={t('leave empty to keep guest mode off')} secure />
                  </View>
                  <Text style={[s.fieldError, { fontSize: 12, marginTop: 4 }]}>{t('Guest mode is custodial: your node holds an encrypted key for each Telegram user who posts. Only enable if you accept that responsibility.')}</Text>
                </View>
              )}
            </View>
          )}
          <Pressable style={[s.btnAccept, { marginTop: 8 }, busy && { opacity: 0.6 }]} disabled={busy} onPress={toggle}>
            {busy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Start hosting')}</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <Text style={[s.dim, { marginTop: 12 }]}>{t('Hosting on port {port}. Share one of these links (same Wi-Fi/network):', { port: String(status.port) })}</Text>
          <View style={s.codeBox}>
            <Text style={s.codeText} selectable>{(status.urls.length ? status.urls : [t('No network address found — are you online?')]).join('\n')}</Text>
          </View>
          {status.notify && status.urls[0] && (
            <Text style={[s.dim, { marginTop: 6, fontSize: 12 }]}>{t('Notification + MCP server on too — set the Notification service URL to {url}', { url: status.urls[0] })}</Text>
          )}
          {status.notify && status.relay_urls.length > 0 && (
            <>
              <Text style={[s.dim, { marginTop: 8 }]}>{t('Relay running — add to the app’s relay list:')}</Text>
              <View style={s.codeBox}>
                <Text style={s.codeText} selectable>{status.relay_urls.join('\n')}</Text>
              </View>
            </>
          )}
          {status.telegram && <Text style={[s.dim, { marginTop: 6, fontSize: 12 }]}>{'🤖 ' + t('Telegram bridge active.')}</Text>}
          <Text style={[s.dim, { marginTop: 6, fontSize: 12 }]}>{t('Your OS firewall may ask to allow incoming connections the first time.')}</Text>
          <Pressable style={[s.btnCounter, { marginTop: 8 }, busy && { opacity: 0.6 }]} disabled={busy} onPress={toggle}>
            {busy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Stop hosting')}</Text>}
          </Pressable>
        </>
      )}
      {error && <Text style={[s.fieldError, { marginTop: 8 }]}>{error}</Text>}
    </View>
  );
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
  const browseUnit = effectiveUnit(distanceUnit, location.country);
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
      const savedPath = await backupToFile(secretKey, ''); // plain nsec — no password
      // Desktop save-dialog path: confirm where it landed (web/native have
      // their own download/share-sheet feedback).
      if (savedPath) Alert.alert(t('Account exported'), savedPath);
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

      {/* Desktop only: host the Freeport web app on the LAN for others.
          Inside Features and NOT gated by pushSupported() (which is false in
          the desktop WebView) so it always shows on desktop. */}
      {isTauri() && <DesktopHostPanel />}
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
              <Field label={t("Notification service URL")} value={notifyEndpoint} onChange={setNotifyEndpoint} placeholder="https://mcp.freeport.network" />
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
            <Pressable hitSlop={6} onPress={() => Linking.openURL('mailto:hi@freeport.network')}>
              <Text style={s.link}>hi@freeport.network</Text>
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

export { SettingsTab };
