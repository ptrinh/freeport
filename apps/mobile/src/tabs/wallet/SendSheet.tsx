import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { s, palette } from '../../ui/theme';
import type { ParsedDest, WalletProvider } from '../../wallet';

type Step = 'input' | 'amount' | 'confirm' | 'paying' | 'done' | 'error';

/**
 * Send flow as a bottom sheet: one free-form destination field (invoice,
 * on-chain, Spark or lightning address), Paste helper, then amount when the
 * destination doesn't carry one, then confirm → pay.
 */
export function SendSheet({
  visible,
  provider,
  usdRate,
  initialInput,
  hint,
  onClose,
  onPaid,
}: {
  visible: boolean;
  provider: WalletProvider | null;
  usdRate: number | null;
  initialInput?: string;
  hint?: string;
  onClose: () => void;
  onPaid: () => void;
}) {
  const [step, setStep] = useState<Step>('input');
  const [input, setInput] = useState('');
  const [dest, setDest] = useState<ParsedDest | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setStep('input'); setInput(initialInput ?? ''); setDest(null); setAmount(''); setError(''); setBusy(false);
    }
  }, [visible, initialInput]);

  const paste = async () => {
    try {
      if (Platform.OS === 'web' && (navigator as any)?.clipboard?.readText) {
        setInput(await (navigator as any).clipboard.readText());
      }
    } catch { /* permission denied — user types instead */ }
  };

  const cont = async () => {
    if (!provider || !input.trim()) return;
    setBusy(true); setError('');
    try {
      const d = await provider.parse(input);
      if (d.kind === 'unknown') { setError(t("Couldn't recognize this destination")); return; }
      setDest(d);
      const needsAmount = d.kind !== 'bolt11' || d.sats == null;
      setStep(needsAmount ? 'amount' : 'confirm');
    } catch {
      setError(t("Couldn't recognize this destination"));
    } finally { setBusy(false); }
  };

  const sats = dest?.kind === 'bolt11' && dest.sats != null ? dest.sats : parseInt(amount, 10);
  const usd = Number.isFinite(sats) && usdRate ? (sats / 1e8) * usdRate : null;

  const pay = async () => {
    if (!provider || !dest) return;
    setStep('paying'); setError('');
    try {
      await provider.pay(dest.raw, dest.kind === 'bolt11' && dest.sats != null ? undefined : sats);
      setStep('done');
      onPaid();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setError(
        msg === 'unsupported-address' ? t("This wallet can't pay this type of address")
        : msg === 'amount-required' ? t('Enter an amount in sats')
        : msg || t('Payment failed'));
      setStep('error');
    }
  };

  const DEST_LABELS: Record<ParsedDest['kind'], string> = {
    bolt11: t('Lightning invoice'),
    lightningAddress: t('Lightning address'),
    lnurlPay: 'LNURL',
    bitcoinAddress: t('Bitcoin address'),
    sparkAddress: t('Spark address'),
    unknown: '',
  };
  const destLabel = dest ? DEST_LABELS[dest.kind] : '';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ backgroundColor: palette.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 26 }}>
        <View style={{ alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: palette.border, marginTop: 8 }} />
        <View style={[s.row, { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }]}>
          <Ionicons name="arrow-up" size={16} color={palette.accent} style={{ marginEnd: 8 }} />
          <Text style={{ color: palette.text, fontSize: 18, fontWeight: '800', flex: 1 }}>{t('Send')}</Text>
          <Pressable hitSlop={10} onPress={onClose}><Ionicons name="close" size={20} color={palette.dim} /></Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
          {step === 'input' && (
            <>
              <TextInput
                style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 12, minHeight: 84, color: palette.text, textAlignVertical: 'top', fontFamily: Platform.OS === 'web' ? 'monospace' : undefined }}
                multiline
                value={input}
                onChangeText={(v) => { setInput(v); setError(''); }}
                placeholder={'lnbc… / bc1… / sp1… / user@domain.com'}
                placeholderTextColor={palette.placeholder}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {!!hint && <Text style={s.dim}>{t('Agreed price')}: {hint}</Text>}
              {Platform.OS === 'web' && (
                <Pressable onPress={paste} style={[s.btnGhost, { alignSelf: 'stretch' }]}>
                  <View style={[s.row, { gap: 6, justifyContent: 'center' }]}>
                    <Ionicons name="clipboard-outline" size={14} color={palette.text2} />
                    <Text style={s.btnGhostText}>{t('Paste')}</Text>
                  </View>
                </Pressable>
              )}
              {!!error && <Text style={[s.dim, { color: palette.danger }]}>{error}</Text>}
              <Pressable onPress={cont} disabled={busy || !input.trim()} style={[s.btnAccept, (busy || !input.trim()) && { opacity: 0.5 }]}>
                {busy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Continue')}</Text>}
              </Pressable>
            </>
          )}

          {step === 'amount' && dest && (
            <>
              <Text style={s.dim}>{destLabel} · {dest.raw.length > 34 ? dest.raw.slice(0, 17) + '…' + dest.raw.slice(-14) : dest.raw}</Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 12, minHeight: 48, color: palette.text, fontSize: 22, fontWeight: '700' }}
                value={amount}
                onChangeText={setAmount}
                placeholder={t('Amount (sats)')}
                placeholderTextColor={palette.placeholder}
                keyboardType="numeric"
                autoFocus
              />
              {usd != null && <Text style={s.dim}>≈ ${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>}
              {!!error && <Text style={[s.dim, { color: palette.danger }]}>{error}</Text>}
              <Pressable
                onPress={() => { if (!Number.isFinite(sats) || sats <= 0) { setError(t('Enter an amount in sats')); return; } setStep('confirm'); }}
                style={[s.btnAccept, !amount.trim() && { opacity: 0.5 }]}
                disabled={!amount.trim()}
              >
                <Text style={s.btnText}>{t('Continue')}</Text>
              </Pressable>
            </>
          )}

          {step === 'confirm' && dest && (
            <>
              <View style={[s.card, { gap: 6 }]}>
                <Text style={{ color: palette.text, fontSize: 30, fontWeight: '800', textAlign: 'center' }}>{Number(sats).toLocaleString()} sats</Text>
                {usd != null && <Text style={[s.dim, { textAlign: 'center' }]}>≈ ${usd.toLocaleString(undefined, { maximumFractionDigits: 2 })}</Text>}
                <Text style={[s.dim, { textAlign: 'center' }]} numberOfLines={2}>
                  {destLabel} · {dest.raw.length > 44 ? dest.raw.slice(0, 22) + '…' + dest.raw.slice(-18) : dest.raw}
                </Text>
                {dest.kind === 'bolt11' && dest.description ? <Text style={[s.dim, { textAlign: 'center' }]}>“{dest.description}”</Text> : null}
              </View>
              <Pressable onPress={pay} style={s.btnAccept}>
                <Text style={s.btnText}>{t('Pay')}</Text>
              </Pressable>
            </>
          )}

          {step === 'paying' && (
            <View style={{ alignItems: 'center', paddingVertical: 26, gap: 12 }}>
              <ActivityIndicator color={palette.accent} />
              <Text style={s.dim}>{t('Sending payment…')}</Text>
            </View>
          )}

          {step === 'done' && (
            <View style={{ alignItems: 'center', paddingVertical: 22, gap: 10 }}>
              <Ionicons name="checkmark-circle" size={52} color={palette.success} />
              <Text style={{ color: palette.text, fontSize: 18, fontWeight: '700' }}>{t('Paid')}</Text>
              <Pressable onPress={onClose} style={[s.btnAccept, { alignSelf: 'stretch' }]}>
                <Text style={s.btnText}>{t('Done')}</Text>
              </Pressable>
            </View>
          )}

          {step === 'error' && (
            <View style={{ alignItems: 'center', paddingVertical: 18, gap: 10 }}>
              <Ionicons name="alert-circle" size={48} color={palette.danger} />
              <Text style={[s.dim, { color: palette.danger, textAlign: 'center' }]}>{error}</Text>
              <Pressable onPress={() => setStep(dest ? 'confirm' : 'input')} style={[s.btnGhost, { alignSelf: 'stretch' }]}>
                <Text style={s.btnGhostText}>{t('Try again')}</Text>
              </Pressable>
              <Pressable onPress={onClose} hitSlop={8}><Text style={s.cancelLink}>{t('Close')}</Text></Pressable>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
