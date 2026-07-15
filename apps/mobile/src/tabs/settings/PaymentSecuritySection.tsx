import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { s, palette } from '../../ui/theme';
import { loadPrefs, savePrefs } from '../../prefs';
import { payAuthAvailable } from '../../payAuth';

/**
 * Payment security — the Face ID / passkey gate on payments (src/payAuth.ts).
 * Self-contained: reads/writes prefs directly rather than threading two more
 * props through App.tsx; the gate itself also reads prefs at pay time, so
 * there is no in-memory state elsewhere to keep in sync.
 */
function PaymentSecuritySection() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState('');
  const [available, setAvailable] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const p = await loadPrefs();
        if (dead) return;
        setEnabled(p.payAuthRequired);
        setThreshold(p.payAuthThresholdSats > 0 ? String(p.payAuthThresholdSats) : '');
      } finally { if (!dead) setLoaded(true); }
      payAuthAvailable().then((v) => { if (!dead) setAvailable(v); }).catch(() => {});
    })();
    return () => { dead = true; };
  }, []);

  const toggle = () => {
    const v = !enabled;
    setEnabled(v);
    void savePrefs({ payAuthRequired: v });
  };

  const commitThreshold = (raw: string) => {
    // Digits only — sats are integers; anything unparsable falls back to 0
    // ("every payment"), never to silently disabling the gate.
    const n = parseInt(raw.replace(/[^\d]/g, ''), 10);
    const sats = Number.isFinite(n) && n > 0 ? n : 0;
    setThreshold(sats > 0 ? String(sats) : '');
    void savePrefs({ payAuthThresholdSats: sats });
  };

  const authName = Platform.OS === 'web' ? t('passkey') : t('Face ID / biometrics');

  return (
    <>
      <Pressable style={s.collapseHeader} onPress={() => setOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <Ionicons name="finger-print-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t('Payment security')}</Text>
        </View>
        <Text style={s.collapseChevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && loaded && (
        <>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: enabled }}
            style={s.toggleRow}
            onPress={toggle}
          >
            <Ionicons name="lock-closed-outline" size={20} color={palette.text2} style={{ marginEnd: 10 }} />
            <View style={{ flex: 1, marginEnd: 12 }}>
              <Text style={s.toggleTitle}>{t('Require authentication to pay')}</Text>
              <Text style={s.dim}>{t('Confirm with {auth} before any payment — from the wallet or a mini-app.').replace('{auth}', authName)}</Text>
            </View>
            <View style={[s.switchTrack, enabled && s.switchTrackOn]}>
              <View style={[s.switchThumb, enabled && s.switchThumbOn]} />
            </View>
          </Pressable>
          {!available && (
            <Text style={[s.dim, { marginTop: 4 }]}>
              {Platform.OS === 'web'
                ? t('No passkey on this browser yet — the check is skipped until you add one.')
                : t('No screen lock set up on this device — the check is skipped until you add one.')}
            </Text>
          )}
          {enabled && (
            <View style={[s.toggleRow, { alignItems: 'center' }]}>
              <View style={{ flex: 1, marginEnd: 12 }}>
                <Text style={s.toggleTitle}>{t('Only for payments over')}</Text>
                <Text style={s.dim}>{t('Leave empty to confirm every payment. Unknown amounts always ask.')}</Text>
              </View>
              <TextInput
                style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 40, minWidth: 110, color: palette.text, textAlign: 'right' }}
                value={threshold}
                onChangeText={setThreshold}
                onBlur={() => commitThreshold(threshold)}
                onSubmitEditing={() => commitThreshold(threshold)}
                placeholder={`0 ${t('sats')}`}
                placeholderTextColor={palette.placeholder}
                keyboardType="number-pad"
                inputMode="numeric"
              />
            </View>
          )}
        </>
      )}
    </>
  );
}

export { PaymentSecuritySection };
