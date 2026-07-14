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
import { uploadImage, UploadError } from '../upload';
import { normalizePhone, detectDialCode, dialForCountry } from '../phone';
import { requestLocationPermission, effectiveUnit } from '../maps';
import { requestNotifications } from '../notify';
import { pushSupported } from '../push';
import { LANGUAGE_CODES, languageLabel } from '../language';
import { SERVICE_CATEGORIES, RIDESHARE_CATEGORY, DEFAULT_RIDESHARE_SUBCATEGORY, categoryIcon, subcategoryIcon, subcategoriesFor } from '../categories';
import { type FareConfig } from '../pricing';
import { COUNTRY_NAME, COUNTRY_CODES_AZ, flagEmoji, levelsOf, statesOf, citiesOf, type Currency } from '../locations';
import { isTauri } from '../desktopHost';
import { s, palette } from '../ui/theme';
import { dirIcon } from '../rtl';
import { isIOSWeb, isStandalonePWA, shortNpub } from '../ui/format';
import { uiAlert } from '../ui/alerts';
import { Field, SelectField, ImagePickerField, NumberField, QuickLocationSearch } from '../ui/fields';
import { defaultCustomMessage } from '../quickReplies';
import { SelfStats } from './MessagesTab';
import { DesktopHostPanel } from './settings/DesktopHostPanel';
import { NotificationsSection } from './settings/NotificationsSection';
import { FareEstimator } from './settings/FareEstimator';
import { AboutSection } from './settings/AboutSection';
import { ExperimentalSection } from './settings/ExperimentalSection';
import { ChatSection } from './settings/ChatSection';
import { callsSupported } from '../calls/webrtc';
import { conciergeModulePresent } from '../concierge/model';
import { MiniAppsSection } from '../miniapps/MiniAppsSection';
import { loadFirewall } from '../miniapps/store';
import type { MiniAppFirewall, MiniAppRecord } from '../miniapps/firewall';
import { activeWalletProvider } from '../wallet';

// Loaded on demand: react-native-webview only exists in 1.6.0+ binaries, so the
// shell must never be evaluated at startup on an older runtime.
const MiniAppShellLazy = React.lazy(() =>
  import('../miniapps/MiniAppShell').then((m) => ({ default: m.MiniAppShell })),
);

function SettingsTab({
  npub,
  signerRef,
  profile,
  client,
  onOpenFeedback,
  onReplayTour,
  experimentalWallet,
  onExperimentalWalletChange,
  experimentalChat,
  chatShowLastSeen,
  onChatShowLastSeenChange,
  chatReceipts,
  onChatReceiptsChange,
  chatCallsEnabled,
  onChatCallsEnabledChange,
  chatCallsTurn,
  onChatCallsTurnChange,
  chatTranslate,
  onChatTranslateChange,
  experimentalLlm,
  onExperimentalLlmChange,
  experimentalMiniApps,
  onExperimentalMiniAppsChange,
  walletNwcUrl,
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
  customMessage,
  autoSendCustomMessage,
  onCustomMessageChange,
  onAutoSendCustomMessageChange,
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
  experimentalWallet: boolean;
  onExperimentalWalletChange: (v: boolean) => void;
  experimentalChat: boolean;
  chatShowLastSeen: boolean;
  onChatShowLastSeenChange: (v: boolean) => void;
  chatReceipts: boolean;
  onChatReceiptsChange: (v: boolean) => void;
  chatCallsEnabled: boolean;
  onChatCallsEnabledChange: (v: boolean) => void;
  chatCallsTurn: boolean;
  onChatCallsTurnChange: (v: boolean) => void;
  chatTranslate: boolean;
  onChatTranslateChange: (v: boolean) => void;
  experimentalLlm: boolean;
  onExperimentalLlmChange: (v: boolean) => void;
  experimentalMiniApps: boolean;
  onExperimentalMiniAppsChange: (v: boolean) => void;
  /** Stored NWC url ('' = built-in wallet) — mini-apps resolve their WebLN wallet with it. */
  walletNwcUrl: string;
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
  customMessage: string;
  autoSendCustomMessage: boolean;
  onCustomMessageChange: (v: string) => void;
  onAutoSendCustomMessageChange: (v: boolean) => void;
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
  // Mini-apps: the firewall loads once the feature is on; the shell opens per app.
  const [miniAppFw, setMiniAppFw] = useState<MiniAppFirewall | null>(null);
  const [openMiniApp, setOpenMiniApp] = useState<MiniAppRecord | null>(null);
  useEffect(() => {
    if (experimentalMiniApps && Platform.OS !== 'web' && !miniAppFw) {
      void loadFirewall().then(setMiniAppFw).catch(() => {});
    }
  }, [experimentalMiniApps, miniAppFw]);
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
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      {/* Web visitors: one quiet line pointing at the native apps. Hidden in
          the Tauri desktop shell (that IS an installed app). */}
      {Platform.OS === 'web' && !isTauri() && (
        <Pressable
          style={[s.row, { gap: 8, paddingVertical: 10, alignItems: 'center' }]}
          onPress={() => Linking.openURL('https://freeport.network/intro')}
          accessibilityRole="link"
        >
          <Ionicons name="phone-portrait-outline" size={16} color={palette.link} />
          <Text style={[s.link, { fontSize: 13, flex: 1 }]}>{t('Install the native app for the best experience')}</Text>
          <Ionicons name={dirIcon('chevron-forward', 'chevron-back')} size={14} color={palette.dim} />
        </Pressable>
      )}
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

      {/* Quick-reply custom message: shown as a one-tap chip in deal chats,
          optionally auto-sent on deal confirmation. The placeholder suggests
          the country's common instant P2P rail (Zelle/PayNow/…, else cash). */}
      <Field
        label={t("Custom message")}
        value={customMessage}
        onChange={onCustomMessageChange}
        placeholder={defaultCustomMessage(location.country)}
        multiline
      />
      <Text style={s.dim}>{t("One-tap reply in deal chats — e.g. your payment details.")}</Text>
      <Pressable accessibilityRole="switch" accessibilityState={{ checked: autoSendCustomMessage }} style={s.toggleRow} onPress={() => onAutoSendCustomMessageChange(!autoSendCustomMessage)}>
        <View style={{ flex: 1, marginEnd: 12 }}>
          <Text style={s.toggleTitle}>{t("Auto-send custom message")}</Text>
          <Text style={s.dim}>{t("Send it into the chat automatically whenever a deal is confirmed.")}</Text>
        </View>
        <View style={[s.switchTrack, autoSendCustomMessage && s.switchTrackOn]}>
          <View style={[s.switchThumb, autoSendCustomMessage && s.switchThumbOn]} />
        </View>
      </Pressable>

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
        <NotificationsSection
          client={client}
          location={location}
          servicesEnabled={servicesEnabled}
          browseAlertNotify={browseAlertNotify}
          browseCat={browseCat}
          browseEffSub={browseEffSub}
        />
      )}

      {/* Fare Estimator — user-tunable coefficients for the ride-fare estimate */}
      <FareEstimator
        fareConfig={fareConfig}
        fareDefaults={fareDefaults}
        fareCurrency={fareCurrency}
        onFareConfigChange={onFareConfigChange}
      />

      {/* About — version, low-key update check, credits & feedback. Collapsed
          by default like the other Settings sections. The OTA update flow lives
          here as a small "Check now" link (native gets a real OTA swap; web just
          hard-reloads to the newest deploy). */}
      <ExperimentalSection
        walletEnabled={experimentalWallet}
        onWalletEnabledChange={onExperimentalWalletChange}
        servicesEnabled={servicesEnabled}
        onServicesEnabledChange={onServicesEnabledChange}
        llmEnabled={experimentalLlm}
        onLlmEnabledChange={onExperimentalLlmChange}
        llmSupported={conciergeModulePresent()}
        miniAppsEnabled={experimentalMiniApps}
        onMiniAppsEnabledChange={onExperimentalMiniAppsChange}
      />

      {/* Mini-apps registry — native-only shell for NIP-07/WebLN web apps. */}
      {experimentalMiniApps && Platform.OS !== 'web' && miniAppFw ? (
        <MiniAppsSection firewall={miniAppFw} onOpenApp={setOpenMiniApp} />
      ) : null}
      {openMiniApp && miniAppFw && signerRef.current ? (
        <React.Suspense fallback={null}>
          <MiniAppShellLazy
            app={openMiniApp}
            firewall={miniAppFw}
            signer={signerRef.current}
            getWallet={experimentalWallet ? () => activeWalletProvider(walletNwcUrl) : null}
            onClose={() => setOpenMiniApp(null)}
          />
        </React.Suspense>
      ) : null}

      {/* Chat settings — chat is a core feature now, section always shows. */}
      {experimentalChat && (
        <ChatSection
          showLastSeen={chatShowLastSeen}
          onShowLastSeenChange={onChatShowLastSeenChange}
          receipts={chatReceipts}
          onReceiptsChange={onChatReceiptsChange}
          callsEnabled={chatCallsEnabled}
          onCallsEnabledChange={onChatCallsEnabledChange}
          callsTurn={chatCallsTurn}
          onCallsTurnChange={onChatCallsTurnChange}
          callsSupported={callsSupported()}
          translate={chatTranslate}
          onTranslateChange={onChatTranslateChange}
          llmEnabled={experimentalLlm}
        />
      )}

      <AboutSection onReplayTour={onReplayTour} />

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
