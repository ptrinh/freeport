import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';
import { s, palette } from '../ui/theme';
import { walletProviderFor, defaultWalletProvider, parseNwcUrl, type WalletProvider, type WalletTx } from '../wallet';

/**
 * Wallet tab (Experimental). Providers are pluggable (src/wallet/):
 *  - Default: the built-in Breez-Spark wallet, lazy-loaded on first open
 *    (WASM on web; native module on iOS/Android — old binaries fall back to
 *    a "coming in a future app update" card).
 *  - Alternative: NWC (bring-your-own wallet), pure JS over nostr-tools.
 * A stored NWC url always wins over the built-in wallet. Amounts are sats.
 */
function WalletTab({
  nwcUrl,
  onNwcUrlChange,
  onScroll,
}: {
  nwcUrl: string;
  onNwcUrlChange: (url: string) => void;
  onScroll?: (e: any) => void;
}) {
  const provider = useRef<WalletProvider | null>(null);
  const [connected, setConnected] = useState(false);
  const [alias, setAlias] = useState<string | undefined>(undefined);
  const [balance, setBalance] = useState<number | null>(null);
  const [txs, setTxs] = useState<WalletTx[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'boot' | 'connect' | 'invoice' | 'pay' | 'refresh' | null>(null);
  const [showNwcForm, setShowNwcForm] = useState(false);

  // Setup form
  const [urlDraft, setUrlDraft] = useState('');
  // Receive
  const [recvAmount, setRecvAmount] = useState('');
  const [recvMemo, setRecvMemo] = useState('');
  const [invoice, setInvoice] = useState('');
  const [copied, setCopied] = useState(false);
  // Send
  const [payDraft, setPayDraft] = useState('');
  const [payResult, setPayResult] = useState<'ok' | 'fail' | null>(null);

  const refresh = async (p: WalletProvider) => {
    setBusy('refresh');
    try {
      const [b, list] = await Promise.all([p.balance(), p.transactions(20)]);
      setBalance(b.sats);
      setTxs(list);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not reach the wallet'));
    } finally { setBusy(null); }
  };

  // (Re)build the provider whenever the stored connection changes. A stored
  // NWC url is used directly; otherwise the built-in wallet lazy-loads.
  useEffect(() => {
    let cancelled = false;
    provider.current?.close();
    provider.current = null;
    setConnected(false); setBalance(null); setTxs([]); setAlias(undefined); setError(''); setShowNwcForm(false);
    const boot = async () => {
      let p: WalletProvider | null = null;
      if (nwcUrl) {
        p = walletProviderFor(nwcUrl);
      } else {
        setBusy('boot');
        p = await defaultWalletProvider();
      }
      if (cancelled) return;
      setBusy(null);
      if (!p) return;
      provider.current = p;
      setConnected(true);
      if (p.kind === 'nwc') p.info().then((i) => { if (!cancelled) setAlias(i.alias); }).catch(() => {});
      void refresh(p);
    };
    void boot();
    return () => { cancelled = true; provider.current?.close(); };
  }, [nwcUrl]);

  const connect = async () => {
    setError('');
    const conn = parseNwcUrl(urlDraft);
    if (!conn) { setError(t('Invalid connection string')); return; }
    setBusy('connect');
    const probe = walletProviderFor(urlDraft)!;
    try {
      await probe.balance(); // proves the connection actually works
      probe.close();
      onNwcUrlChange(urlDraft.trim()); // persist; the effect rebuilds the provider
      setUrlDraft('');
    } catch (e) {
      probe.close();
      setError(e instanceof Error ? e.message : t('Could not reach the wallet'));
    } finally { setBusy(null); }
  };

  const makeInvoice = async () => {
    const p = provider.current; if (!p) return;
    const sats = parseInt(recvAmount, 10);
    if (!Number.isFinite(sats) || sats <= 0) { setError(t('Enter an amount in sats')); return; }
    setBusy('invoice'); setError(''); setInvoice(''); setCopied(false);
    try {
      const inv = await p.receive(sats, recvMemo.trim() || undefined);
      setInvoice(inv.invoice);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not reach the wallet'));
    } finally { setBusy(null); }
  };

  const copyInvoice = async () => {
    // Web: clipboard API. Native: the system share sheet (expo-clipboard is a
    // native module the current binaries don't carry, so it can't ride OTA).
    try {
      if (Platform.OS === 'web' && (navigator as any)?.clipboard) {
        await (navigator as any).clipboard.writeText(invoice);
        setCopied(true);
      } else {
        await Share.share({ message: invoice });
      }
    } catch { /* ignore */ }
  };

  const payInvoice = async () => {
    const p = provider.current; if (!p || !payDraft.trim()) return;
    setBusy('pay'); setError(''); setPayResult(null);
    try {
      await p.pay(payDraft);
      setPayResult('ok');
      setPayDraft('');
      void refresh(p);
    } catch (e) {
      setPayResult('fail');
      setError(e instanceof Error ? e.message : t('Payment failed'));
    } finally { setBusy(null); }
  };

  const fmtTime = (ts: number) => new Date(ts * 1000).toLocaleString();

  if (busy === 'boot') {
    return (
      <View style={[s.pad, { alignItems: 'center', paddingTop: 48 }]}>
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

        {/* Bring-your-own via NWC — works today. */}
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
          <Pressable style={[s.btnAccept, { marginTop: 10 }, busy === 'connect' && { opacity: 0.6 }]} onPress={connect} disabled={busy !== null || !urlDraft.trim()}>
            {busy === 'connect' ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Connect')}</Text>}
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.pad} onScroll={onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      {/* Balance */}
      <View style={s.card}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Text style={s.dim}>{provider.current?.kind === 'breez-spark' ? t('Built-in wallet') : alias || t('Connected wallet')}</Text>
          <Pressable hitSlop={8} onPress={() => provider.current && refresh(provider.current)}>
            {busy === 'refresh' ? <ActivityIndicator size="small" color={palette.dim} /> : <Ionicons name="refresh" size={16} color={palette.dim} />}
          </Pressable>
        </View>
        <Text style={[s.cardTitle, { fontSize: 28, marginTop: 4 }]}>
          {balance == null ? '…' : `${balance.toLocaleString()} sats`}
        </Text>
        {!!error && <Text style={[s.dim, { color: palette.danger, marginTop: 4 }]}>{error}</Text>}
      </View>

      {/* Receive */}
      <View style={s.card}>
        <Text style={s.cardTitle}>{t('Receive')}</Text>
        <View style={[s.row, { gap: 8, marginTop: 8 }]}>
          <TextInput
            style={[{ flex: 1, borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 44, color: palette.text }]}
            value={recvAmount}
            onChangeText={setRecvAmount}
            placeholder={t('Amount (sats)')}
            placeholderTextColor={palette.placeholder}
            keyboardType="numeric"
          />
          <TextInput
            style={[{ flex: 1, borderWidth: 1, borderColor: palette.border, borderRadius: 10, paddingHorizontal: 10, minHeight: 44, color: palette.text }]}
            value={recvMemo}
            onChangeText={setRecvMemo}
            placeholder={t('Description (optional)')}
            placeholderTextColor={palette.placeholder}
          />
        </View>
        <Pressable style={[s.btnAccept, { marginTop: 10 }, busy === 'invoice' && { opacity: 0.6 }]} onPress={makeInvoice} disabled={busy !== null}>
          {busy === 'invoice' ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Create invoice')}</Text>}
        </Pressable>
        {!!invoice && (
          <>
            <Text selectable style={[s.codeText, { marginTop: 10 }]} numberOfLines={3}>{invoice}</Text>
            <Pressable style={[s.btnGhost, { marginTop: 8 }]} onPress={copyInvoice}>
              <Text style={s.btnGhostText}>{copied ? t('Copied') : t('Copy')}</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Send */}
      <View style={s.card}>
        <Text style={s.cardTitle}>{t('Send')}</Text>
        <TextInput
          style={[{ borderWidth: 1, borderColor: palette.border, borderRadius: 10, marginTop: 8, paddingHorizontal: 10, minHeight: 44, color: palette.text }]}
          value={payDraft}
          onChangeText={(v) => { setPayDraft(v); setPayResult(null); }}
          placeholder={t('Paste a Lightning invoice')}
          placeholderTextColor={palette.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Pressable style={[s.btnAccept, { marginTop: 10 }, busy === 'pay' && { opacity: 0.6 }]} onPress={payInvoice} disabled={busy !== null || !payDraft.trim()}>
          {busy === 'pay' ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Pay')}</Text>}
        </Pressable>
        {payResult === 'ok' && <Text style={[s.dim, { color: palette.success, marginTop: 6 }]}>{'✓ ' + t('Paid')}</Text>}
      </View>

      {/* History */}
      {txs.length > 0 && (
        <View style={s.card}>
          <Text style={s.cardTitle}>{t('Recent activity')}</Text>
          {txs.map((tx, i) => (
            <View key={i} style={[s.row, { justifyContent: 'space-between', marginTop: 8 }]}>
              <View style={{ flex: 1, marginEnd: 8 }}>
                <Text style={s.toggleTitle} numberOfLines={1}>{tx.description || (tx.direction === 'in' ? t('Received') : t('Sent'))}</Text>
                <Text style={s.dim}>{fmtTime(tx.ts)}{tx.settled ? '' : ' · ' + t('pending')}</Text>
              </View>
              <Text style={[s.toggleTitle, { color: tx.direction === 'in' ? palette.success : palette.text2 }]}>
                {(tx.direction === 'in' ? '+' : '−') + tx.sats.toLocaleString()}
              </Text>
            </View>
          ))}
        </View>
      )}

      {provider.current?.kind === 'nwc' ? (
        <Pressable hitSlop={8} style={{ marginTop: 8, alignItems: 'center' }} onPress={() => onNwcUrlChange('')}>
          <Text style={s.cancelLink}>{t('Disconnect wallet')}</Text>
        </Pressable>
      ) : showNwcForm ? (
        <View style={s.card}>
          <Text style={s.cardTitle}>{t('Connect your own wallet')}</Text>
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
          <Pressable style={[s.btnAccept, { marginTop: 10 }, busy === 'connect' && { opacity: 0.6 }]} onPress={connect} disabled={busy !== null || !urlDraft.trim()}>
            {busy === 'connect' ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Connect')}</Text>}
          </Pressable>
        </View>
      ) : (
        <Pressable hitSlop={8} style={{ marginTop: 8, alignItems: 'center' }} onPress={() => setShowNwcForm(true)}>
          <Text style={s.cancelLink}>{t('Use your own wallet (NWC) instead')}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

export { WalletTab };
