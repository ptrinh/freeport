import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';
import { s, palette } from '../ui/theme';
import { walletProviderFor, defaultWalletProvider, parseNwcUrl, type WalletProvider, type WalletTx } from '../wallet';
import { WalletHome } from './wallet/WalletHome';
import { SendSheet } from './wallet/SendSheet';
import { ReceiveSheet } from './wallet/ReceiveSheet';

/**
 * Wallet tab (Experimental) — Glow-style UI (adapted from breez/glow-web,
 * MIT) over the pluggable provider layer (src/wallet/):
 *  - Default: the built-in Breez-Spark wallet, lazy-loaded on first open.
 *  - Alternative: NWC (bring-your-own wallet), pure JS over nostr-tools.
 * A stored NWC url always wins over the built-in wallet. Amounts are sats.
 */
function WalletTab({
  nwcUrl,
  onNwcUrlChange,
  localCurrency = 'USD',
  contacts = [],
  prefill,
  onPrefillConsumed,
  onScroll,
}: {
  nwcUrl: string;
  onNwcUrlChange: (url: string) => void;
  /** ISO code of the user's local currency (from their selected country). */
  localCurrency?: string;
  /** Saved counterparties (from deals that shared a wallet address). */
  contacts?: Array<{ name: string; address: string }>;
  /** Deal Pay flow: destination (counterparty's address) + agreed-price hint. */
  prefill?: { dest: string; hint?: string } | null;
  onPrefillConsumed?: () => void;
  onScroll?: (e: any) => void;
}) {
  const provider = useRef<WalletProvider | null>(null);
  const [connected, setConnected] = useState(false);
  const [booting, setBooting] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [usdRate, setUsdRate] = useState<number | null>(null);
  const [localRate, setLocalRate] = useState<number | null>(null);
  const [unit, setUnit] = useState<'sats' | 'usd' | 'local'>('sats');
  const [txs, setTxs] = useState<WalletTx[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Sheets
  const [sendOpen, setSendOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendPrefill, setSendPrefill] = useState<{ dest: string; hint?: string } | null>(null);

  // NWC connect form (setup view / switch flow)
  const [urlDraft, setUrlDraft] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [showNwcForm, setShowNwcForm] = useState(false);

  const refresh = async (p: WalletProvider) => {
    setRefreshing(true);
    try {
      const wantLocal = localCurrency && localCurrency !== 'USD';
      const [b, list, usd, local] = await Promise.all([
        p.balance(), p.transactions(50), p.fiatRate('USD'),
        wantLocal ? p.fiatRate(localCurrency) : Promise.resolve(null),
      ]);
      setBalance(b.sats);
      setTxs(list);
      setUsdRate(usd);
      setLocalRate(local);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not reach the wallet'));
    } finally { setRefreshing(false); }
  };

  // (Re)build the provider whenever the stored connection changes. A stored
  // NWC url is used directly; otherwise the built-in wallet lazy-loads.
  useEffect(() => {
    let cancelled = false;
    provider.current?.close();
    provider.current = null;
    setConnected(false); setBalance(null); setTxs([]); setUsdRate(null); setError(''); setShowNwcForm(false);
    const boot = async () => {
      let p: WalletProvider | null = null;
      if (nwcUrl) {
        p = walletProviderFor(nwcUrl);
      } else {
        setBooting(true);
        p = await defaultWalletProvider();
      }
      if (cancelled) return;
      setBooting(false);
      if (!p) return;
      provider.current = p;
      setConnected(true);
      void refresh(p);
    };
    void boot();
    return () => { cancelled = true; provider.current?.close(); };
  }, [nwcUrl]);

  // Deal Pay flow → open Send prefilled once the tab has a provider.
  useEffect(() => {
    if (!prefill?.dest) return;
    setSendPrefill(prefill);
    setSendOpen(true);
    onPrefillConsumed?.();
  }, [prefill]);

  const connectNwc = async () => {
    setError('');
    if (!parseNwcUrl(urlDraft)) { setError(t('Invalid connection string')); return; }
    setConnecting(true);
    const probe = walletProviderFor(urlDraft)!;
    try {
      await probe.balance(); // proves the connection actually works
      probe.close();
      onNwcUrlChange(urlDraft.trim()); // persist; the effect rebuilds the provider
      setUrlDraft('');
    } catch (e) {
      probe.close();
      setError(e instanceof Error ? e.message : t('Could not reach the wallet'));
    } finally { setConnecting(false); }
  };

  const nwcForm = (
    <View style={s.card}>
      <View style={[s.row, { gap: 8 }]}>
        <Ionicons name="link-outline" size={20} color={palette.text2} />
        <Text style={s.cardTitle}>{t('Connect your own wallet')}</Text>
      </View>
      <Text style={s.dim}>{t('Paste a Nostr Wallet Connect (NWC) string from a wallet like Alby Hub, coinos or Primal. Freeport never sees your keys or funds.')}</Text>
      <TextInput
        style={[s.searchInput, { borderWidth: 1, borderColor: palette.border, borderRadius: 10, marginTop: 10, paddingHorizontal: 10, minHeight: 44, color: palette.text }]}
        value={urlDraft}
        onChangeText={setUrlDraft}
        placeholder="nostr+walletconnect://…"
        placeholderTextColor={palette.placeholder}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {!!error && <Text style={[s.dim, { color: palette.danger, marginTop: 6 }]}>{error}</Text>}
      <Pressable style={[s.btnAccept, { marginTop: 10 }, connecting && { opacity: 0.6 }]} onPress={connectNwc} disabled={connecting || !urlDraft.trim()}>
        {connecting ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Connect')}</Text>}
      </Pressable>
    </View>
  );

  if (booting) {
    return (
      // flex:1 keeps the tab content filling the viewport — without it the
      // bar below collapses up to mid-screen while the wallet boots.
      <View style={[s.pad, { flex: 1, alignItems: 'center', paddingTop: 48 }]}>
        <ActivityIndicator color={palette.dim} />
        <Text style={[s.dim, { marginTop: 12 }]}>{t('Starting the built-in wallet…')}</Text>
      </View>
    );
  }

  if (!connected) {
    return (
      <ScrollView contentContainerStyle={s.pad} onScroll={onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Built-in wallet (Breez Spark) — unavailable on this build. */}
        <View style={[s.card, { opacity: 0.65 }]}>
          <View style={[s.row, { gap: 8 }]}>
            <Ionicons name="wallet-outline" size={20} color={palette.text2} />
            <Text style={s.cardTitle}>{t('Built-in wallet')}</Text>
          </View>
          <Text style={s.dim}>{t('Self-custodial Bitcoin & stablecoin wallet — coming in a future app update.')}</Text>
        </View>
        {nwcForm}
      </ScrollView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <WalletHome
        balanceSats={balance}
        usdRate={usdRate}
        localRate={localRate}
        localCurrency={localCurrency}
        unit={unit}
        onToggleUnit={() => setUnit((u) =>
          u === 'sats' ? 'usd' : u === 'usd' && localRate != null ? 'local' : 'sats')}
        txs={txs}
        refreshing={refreshing}
        onRefresh={() => provider.current && refresh(provider.current)}
        walletLabel={provider.current?.kind === 'breez-spark' ? t('Built-in wallet') : t('Connected wallet')}
        onSend={() => { setSendPrefill(null); setSendOpen(true); }}
        onReceive={() => setReceiveOpen(true)}
        onScroll={onScroll}
        footer={
          <View style={{ alignItems: 'center', paddingTop: 18, gap: 10 }}>
            {!!error && <Text style={[s.dim, { color: palette.danger }]}>{error}</Text>}
            {provider.current?.kind === 'nwc' ? (
              <Pressable hitSlop={8} onPress={() => onNwcUrlChange('')}>
                <Text style={s.cancelLink}>{t('Disconnect wallet')}</Text>
              </Pressable>
            ) : showNwcForm ? (
              <View style={{ alignSelf: 'stretch', paddingHorizontal: 14 }}>{nwcForm}</View>
            ) : (
              <Pressable hitSlop={8} onPress={() => setShowNwcForm(true)}>
                <Text style={s.cancelLink}>{t('Use your own wallet (NWC) instead')}</Text>
              </Pressable>
            )}
          </View>
        }
      />
      <SendSheet
        visible={sendOpen}
        provider={provider.current}
        usdRate={usdRate}
        initialInput={sendPrefill?.dest}
        hint={sendPrefill?.hint}
        contacts={contacts}
        onClose={() => setSendOpen(false)}
        onPaid={() => provider.current && refresh(provider.current)}
      />
      <ReceiveSheet
        visible={receiveOpen}
        provider={provider.current}
        onClose={() => { setReceiveOpen(false); provider.current && refresh(provider.current); }}
      />
    </View>
  );
}

export { WalletTab };
