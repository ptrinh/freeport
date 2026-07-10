import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { s, palette } from '../../ui/theme';
import { qrDataUrl } from '../../wallet/qr';
import type { WalletProvider } from '../../wallet';

type Tab = 'lightning' | 'spark' | 'bitcoin';

/**
 * Receive flow as a bottom sheet: tabs per payment rail (what the active
 * provider supports), QR + copyable string, and an optional specific-amount
 * Lightning invoice.
 */
export function ReceiveSheet({
  visible,
  provider,
  onClose,
}: {
  visible: boolean;
  provider: WalletProvider | null;
  onClose: () => void;
}) {
  const isBreez = provider?.kind === 'breez-spark';
  const tabs: Tab[] = isBreez ? ['lightning', 'spark', 'bitcoin'] : ['lightning'];
  const [tab, setTab] = useState<Tab>('lightning');
  const [value, setValue] = useState('');       // the QR payload for the active tab
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  // Lightning specific-amount form
  const [askAmount, setAskAmount] = useState(!isBreez); // NWC invoices need an amount
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');

  useEffect(() => {
    if (!visible) return;
    setTab('lightning'); setValue(''); setError(''); setCopied(false);
    setAskAmount(provider?.kind !== 'breez-spark'); setAmount(''); setMemo('');
  }, [visible, provider]);

  // Static payloads per tab: Spark address / on-chain address / (breez)
  // an any-amount Lightning invoice.
  useEffect(() => {
    if (!visible || !provider) return;
    let dead = false;
    const load = async () => {
      setLoading(true); setError(''); setValue(''); setCopied(false);
      try {
        let v: string | null = null;
        if (tab === 'spark') v = await provider.address();
        else if (tab === 'bitcoin') v = await provider.receiveOnchain();
        else if (tab === 'lightning' && provider.kind === 'breez-spark' && !askAmount) {
          v = (await provider.receive(0, undefined)).invoice; // any-amount invoice
        }
        if (!dead) { if (v) setValue(v); else if (tab !== 'lightning') setError(t('Not available for this wallet')); }
      } catch (e) {
        if (!dead) setError(e instanceof Error ? e.message : t('Could not reach the wallet'));
      } finally { if (!dead) setLoading(false); }
    };
    void load();
    return () => { dead = true; };
  }, [visible, provider, tab, askAmount]);

  const createInvoice = async () => {
    if (!provider) return;
    const sats = parseInt(amount, 10);
    if (!Number.isFinite(sats) || sats <= 0) { setError(t('Enter an amount in sats')); return; }
    setLoading(true); setError('');
    try {
      const inv = await provider.receive(sats, memo.trim() || undefined);
      setValue(inv.invoice); setAskAmount(false); setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not reach the wallet'));
    } finally { setLoading(false); }
  };

  const copy = async () => {
    try {
      if (Platform.OS === 'web' && (navigator as any)?.clipboard) {
        await (navigator as any).clipboard.writeText(value);
        setCopied(true);
      } else {
        await Share.share({ message: value });
      }
    } catch { /* ignore */ }
  };
  const share = async () => { try { await Share.share({ message: value }); } catch { /* ignore */ } };

  const TAB_LABEL: Record<Tab, string> = { lightning: 'Lightning', spark: 'Spark', bitcoin: 'Bitcoin' };
  const TAB_ICON: Record<Tab, any> = { lightning: 'flash', spark: 'sparkles-outline', bitcoin: 'logo-bitcoin' };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ backgroundColor: palette.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingBottom: 26 }}>
        <View style={{ alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: palette.border, marginTop: 8 }} />
        <View style={[s.row, { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }]}>
          <Ionicons name="arrow-down" size={16} color={palette.accent} style={{ marginEnd: 8 }} />
          <Text style={{ color: palette.text, fontSize: 18, fontWeight: '800', flex: 1 }}>{t('Receive')}</Text>
          <Pressable hitSlop={10} onPress={onClose}><Ionicons name="close" size={20} color={palette.dim} /></Pressable>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
          {tabs.length > 1 && (
            <View style={[s.row, { backgroundColor: palette.card, borderRadius: 12, padding: 4, gap: 4 }]}>
              {tabs.map((tk) => (
                <Pressable key={tk} onPress={() => setTab(tk)} style={{ flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center', backgroundColor: tab === tk ? palette.accent : 'transparent' }}>
                  <View style={[s.row, { gap: 6 }]}>
                    <Ionicons name={TAB_ICON[tk]} size={13} color={tab === tk ? 'white' : palette.dim} />
                    <Text style={{ color: tab === tk ? 'white' : palette.dim, fontWeight: '700', fontSize: 13 }}>{TAB_LABEL[tk]}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {tab === 'lightning' && askAmount ? (
            <>
              <TextInput
                style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 12, minHeight: 48, color: palette.text, fontSize: 22, fontWeight: '700' }}
                value={amount}
                onChangeText={setAmount}
                placeholder={t('Amount (sats)')}
                placeholderTextColor={palette.placeholder}
                keyboardType="numeric"
              />
              <TextInput
                style={{ borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 12, minHeight: 44, color: palette.text }}
                value={memo}
                onChangeText={setMemo}
                placeholder={t('Description (optional)')}
                placeholderTextColor={palette.placeholder}
              />
              {!!error && <Text style={[s.dim, { color: palette.danger }]}>{error}</Text>}
              <Pressable onPress={createInvoice} disabled={loading} style={[s.btnAccept, loading && { opacity: 0.6 }]}>
                {loading ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Create invoice')}</Text>}
              </Pressable>
            </>
          ) : loading ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}><ActivityIndicator color={palette.accent} /></View>
          ) : value ? (
            <View style={{ alignItems: 'center', gap: 12 }}>
              <View style={{ backgroundColor: 'white', borderRadius: 14, padding: 8 }}>
                <Image source={{ uri: qrDataUrl(value.toUpperCase().startsWith('LN') ? value.toUpperCase() : value) }} style={{ width: 230, height: 230 }} />
              </View>
              <Text selectable style={[s.codeText, { textAlign: 'center' }]} numberOfLines={2}>
                {value.length > 60 ? value.slice(0, 30) + '…' + value.slice(-26) : value}
              </Text>
              <View style={[s.row, { gap: 8 }]}>
                <Pressable onPress={copy} style={[s.btnAccept, { paddingHorizontal: 18 }]}>
                  <View style={[s.row, { gap: 6 }]}>
                    <Ionicons name="copy-outline" size={14} color="white" />
                    <Text style={s.btnText}>{copied ? t('Copied') : t('Copy')}</Text>
                  </View>
                </Pressable>
                <Pressable onPress={share} style={[s.btnGhost, { paddingHorizontal: 18 }]}>
                  <View style={[s.row, { gap: 6 }]}>
                    <Ionicons name="share-social-outline" size={14} color={palette.text2} />
                    <Text style={s.btnGhostText}>{t('Share')}</Text>
                  </View>
                </Pressable>
              </View>
              {tab === 'lightning' && (
                <Pressable hitSlop={8} onPress={() => { setAskAmount(true); setValue(''); setError(''); }}>
                  <Text style={s.cancelLink}>{t('Create invoice with specific amount')} →</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <Text style={[s.dim, { color: error ? palette.danger : palette.dim, textAlign: 'center', paddingVertical: 24 }]}>
              {error || t('Not available for this wallet')}
            </Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
