import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';

type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
import { Picker } from '@react-native-picker/picker';
import * as ImagePicker from 'expo-image-picker';
import { TimeSpinner } from '../TimeSpinner';
import { t } from '../i18n';
import { currencySymbol, searchLocations, type Currency } from '../locations';
import { type PriceSuggestion } from '../pricing';
import { wheelTick } from '../haptics';
import { onWheelDemo } from '../wheelDemo';
import { uploadImage, UploadError } from '../upload';
import { roundTo15, fmtClock, dayLabel, stepFor, snapToStep, symbolIsSuffix, compactAmount, formatAmountInput, fmtPayment } from './format';
import { s, palette } from './theme';

export type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function RoleGroupHeader({ icon, label, note, open, onPress, disabled, style }: {
  icon: IoniconName;
  label: string;
  note: string;
  open: boolean;
  onPress: () => void;
  disabled?: boolean;
  style?: object;
}) {
  const spin = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(spin, { toValue: open ? 1 : 0, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [open, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  return (
    <Pressable
      style={({ pressed }) => [s.roleGroupHeader, style, pressed && { opacity: 0.65 }]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
    >
      <View style={[s.roleGroupIcon, open && s.roleGroupIconOn]}>
        <Ionicons name={icon} size={20} color={open ? palette.accent : palette.text3} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.roleGroupLabel}>{label}</Text>
        <Text style={s.roleGroupNote}>{note}</Text>
      </View>
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Ionicons name="chevron-down" size={20} color={open ? palette.accent : palette.text3} />
      </Animated.View>
    </Pressable>
  );
}

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
            {glyph(o) ? <MaterialCommunityIcons name={glyph(o) as MCIName} size={20} color={o === value ? palette.accent : palette.text3} style={{ marginEnd: 10 }} /> : null}
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
          {glyph(value) ? <MaterialCommunityIcons name={glyph(value) as MCIName} size={18} color={palette.text2} style={{ marginEnd: 8 }} /> : null}
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
  placeholder?: string; multiline?: boolean; keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType']; secure?: boolean;
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
        onFocus={(e) => {
          setFocused(true);
          onFocus?.();
          // Web: the OS keyboard overlays the page and can hide a low field.
          // Scroll it to the middle once the keyboard/viewport has settled.
          if (Platform.OS === 'web') {
            const el = e?.target as unknown as { scrollIntoView?: (o: object) => void } | undefined;
            const siv = el?.scrollIntoView?.bind(el);
            if (siv) setTimeout(() => siv({ block: 'center', behavior: 'smooth' }), 300);
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
        onFocus={(e) => {
          if (Platform.OS === 'web') {
            const el = e?.target as unknown as { scrollIntoView?: (o: object) => void } | undefined;
            const siv = el?.scrollIntoView?.bind(el);
            if (siv) setTimeout(() => siv({ block: 'center', behavior: 'smooth' }), 300);
          }
        }}
        keyboardType="numeric"
        placeholderTextColor={palette.placeholder}
      />
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

// ─── Time / Duration / Payment inputs ────────────────────────────────────────

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

  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const onScroll = (e: { nativeEvent: { contentOffset: { x: number } } }) => {
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
  const scrollNode = () => (scroller.current as unknown as { getScrollableNode?: () => HTMLElement } | null)?.getScrollableNode?.();
  const webDrag = Platform.OS === 'web' ? {
    onMouseDown: (e: { clientX: number }) => { const n = scrollNode(); if (!n) return; drag.current = { active: true, startX: e.clientX, startScroll: n.scrollLeft }; },
    onMouseMove: (e: { clientX: number }) => { if (!drag.current.active) return; const n = scrollNode(); if (n) n.scrollLeft = drag.current.startScroll - (e.clientX - drag.current.startX); },
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
          Platform.OS === 'web' ? ({ cursor: 'grab' } as unknown as Record<string, unknown>) : null,
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
          onScrollBeginDrag={() => { interacting.current = true; clearTimeout(snapTimer.current ?? undefined); }}
          onScrollEndDrag={() => { clearTimeout(snapTimer.current ?? undefined); snapTimer.current = setTimeout(settle, 90); }}
          onMomentumScrollBegin={() => clearTimeout(snapTimer.current ?? undefined)}
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
            {t('💡 Typical asking {median} · most {low}–{high} · n={n}', {
              median: fmtPayment(snapToStep(suggestion.median, currency), currency),
              low: fmtPayment(snapToStep(suggestion.p25, currency), currency),
              high: fmtPayment(snapToStep(suggestion.p75, currency), currency),
              n: suggestion.n,
            })}
            {suggestion.scope === 'widened' ? ` (${t('wider area')})` : ''}
            {` · ${t('tap to use')}`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

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

export {
  RoleGroupHeader,
  QuickLocationSearch,
  WaitingBar,
  SlideToConfirm,
  SystemNotice,
  StatusDot,
  SelectField,
  Field,
  ReadonlyField,
  NumberField,
  SideToggle,
  PostButton,
  ImagePickerField,
  Row,
  TimeField,
  DurationField,
  AmountWheel,
  PaymentField,
};
