import React, { useEffect, useRef, useState } from 'react';
import {
  Linking,
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { isTauri } from '../desktopHost';
import { t } from '../i18n';
import { loadPrefs, type UserLocation } from '../prefs';
import { cloudAvailable, cloudRestore, cloudName } from '../cloudBackup';
import { pickBackupText } from '../backup';
import { bundleNeedsPassphrase } from '../identity';
import { dialForCountry, detectDialCode, normalizePhone } from '../phone';
import { pushStatus } from '../push';
import { pushUnavailableForOnboarding } from '../pushAvailability';
import { LANGUAGE_CODES, languageLabel } from '../language';
import { COUNTRY_NAME, COUNTRY_CODES_AZ, statesOf, citiesOf, levelsOf, flagEmoji } from '../locations';
import { s, palette } from '../ui/theme';
import { passkeySupported } from '../passkey';
import { uiAlert } from '../ui/alerts';
import { SelectField, RoleGroupHeader, Field, QuickLocationSearch } from '../ui/fields';

// ─── Onboarding (first launch) ────────────────────────────────────────────────

/** Collapsible role-group header (RIDESHARING / SERVICE-PRODUCT). An icon chip
 *  + press feedback make the row read as tappable (plain text headers were
 *  getting missed), and the chevron rotates in sync with the accordion. */
export function Onboarding({
  onCreate,
  onFinish,
  onRestore,
  onPasskeyCreate,
  onPasskeySignIn,
  onCloudRestore,
  language,
  onLanguageChange,
  location,
  onLocationChange,
}: {
  onCreate: (role: 'passenger' | 'driver', services: boolean, name: string, phone: string, vehicleModel: string, plateNumber: string) => Promise<void>;
  onFinish: () => void;
  onRestore: (text: string, passphrase: string) => Promise<void>;
  /** Register a passkey and stage the derived key; the normal create flow continues after. */
  onPasskeyCreate: () => Promise<void>;
  /** Re-derive an account from an existing (synced) passkey and finish onboarding. */
  onPasskeySignIn: () => Promise<void>;
  onCloudRestore: () => Promise<boolean>;
  language: string;
  onLanguageChange: (l: string) => void;
  location: UserLocation;
  onLocationChange: (loc: UserLocation) => void;
}) {
  const [step, setStep] = useState<'choose' | 'role' | 'location' | 'welcome'>('choose');
  const [busy, setBusy] = useState<'create' | 'restore' | 'cloud' | 'passkey' | 'passkeyIn' | null>(null);
  const [passkeyOk, setPasskeyOk] = useState(false);
  const [passkeyErr, setPasskeyErr] = useState('');
  useEffect(() => { passkeySupported().then(setPasskeyOk).catch(() => {}); }, []);
  const passkeyErrText = (e: unknown) => {
    const m = e instanceof Error ? e.message : '';
    if (m === 'passkey-no-prf') return t('This passkey provider does not support key derivation (PRF). Try a platform passkey (Face ID / fingerprint).');
    if (/NotAllowed|abort/i.test(m)) return ''; // user cancelled — not an error
    return t('Passkey failed. You can still create a normal account.');
  };
  const passkeyCreate = async () => {
    setBusy('passkey'); setPasskeyErr('');
    try { await onPasskeyCreate(); setStep('role'); }
    catch (e) { setPasskeyErr(passkeyErrText(e)); }
    finally { setBusy(null); }
  };
  const passkeySignIn = async () => {
    setBusy('passkeyIn'); setPasskeyErr('');
    try { await onPasskeySignIn(); }
    catch (e) { setPasskeyErr(passkeyErrText(e)); }
    finally { setBusy(null); }
  };
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
  // Animate the accordion swap: the closing group collapses while the opening
  // one expands+fades in a single motion (no-op on web, instant there).
  const toggleGroup = (g: 'ride' | 'svc') => {
    LayoutAnimation.configureNext({
      duration: 240,
      create: { type: 'easeInEaseOut', property: 'opacity' },
      update: { type: 'easeInEaseOut' },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
    });
    setOpenGroup(g);
  };
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
        <Image source={require('../../assets/favicon.png')} style={{ width: 84, height: 84, borderRadius: 20, alignSelf: 'center', marginBottom: 14 }} />
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
          {passkeyOk && (
            <>
              <Pressable style={[s.btnCounter, { marginTop: 12 }, busy === 'passkey' && { opacity: 0.6 }]} onPress={passkeyCreate} disabled={busy !== null}>
                {busy === 'passkey' ? <ActivityIndicator color="white" /> : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                    <Ionicons name="finger-print" size={16} color="white" />
                    <Text style={s.btnText}>{t('Create with passkey')}</Text>
                  </View>
                )}
              </Pressable>
              <Pressable style={[s.btnTextOnly, { marginTop: 8, alignItems: 'center' }]} onPress={passkeySignIn} disabled={busy !== null}>
                {busy === 'passkeyIn' ? <ActivityIndicator color={palette.dim} /> : (
                  <Text style={[s.dim, { textDecorationLine: 'underline' }]}>{t('Sign in with passkey')}</Text>
                )}
              </Pressable>
              {!!passkeyErr && <Text style={[s.dim, { color: palette.danger, textAlign: 'center', marginTop: 6 }]}>{passkeyErr}</Text>}
            </>
          )}
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
          {/* Web visitors: nudge toward the native app (not shown in the Tauri
              desktop shell — that IS an installed app). */}
          {Platform.OS === 'web' && !isTauri() && (
            <Pressable style={{ marginTop: 22, alignItems: 'center' }} hitSlop={8}
              onPress={() => Linking.openURL('https://freeport.network/intro')}>
              <Text style={[s.dim, { textDecorationLine: 'underline' }]}>
                {t('Install the native app for the best experience')}
              </Text>
            </Pressable>
          )}
        </>
      ) : step === 'role' ? (
        <>
          <Text style={s.sectionTitle}>{t("I'm mainly a…")}</Text>

          <RoleGroupHeader
            icon="car-sport-outline"
            label={t("Ridesharing")}
            note={t("Basic user interface")}
            open={openGroup === 'ride'}
            onPress={() => toggleGroup('ride')}
            disabled={busy !== null}
          />
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

          <RoleGroupHeader
            icon="storefront-outline"
            label={t("Service/Product")}
            note={t("Advanced user interface")}
            open={openGroup === 'svc'}
            onPress={() => toggleGroup('svc')}
            disabled={busy !== null}
            style={{ marginTop: 16 }}
          />
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
