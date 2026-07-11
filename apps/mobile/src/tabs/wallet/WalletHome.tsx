import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { s, palette } from '../../ui/theme';
import type { TokenBalanceInfo, WalletTx } from '../../wallet';
import { totalFiat, formatFiat, effectiveUnit, buildAssetPills } from '../../wallet/portfolio';

/**
 * Glow-style wallet home (adapted from breez/glow-web, MIT): centered balance
 * with a sats/USD unit chip, payment history below, Send/Receive bar pinned
 * at the bottom.
 */
export function WalletHome({
  balanceSats,
  tokens = [],
  usdRate,
  localRate,
  localCurrency,
  unit,
  onToggleUnit,
  txs,
  refreshing,
  onRefresh,
  walletLabel,
  onSend,
  onScan,
  onReceive,
  footer,
  onScroll,
}: {
  balanceSats: number | null;
  /** Stablecoin balances shown under the BTC balance (nonzero only). */
  tokens?: TokenBalanceInfo[];
  usdRate: number | null;
  /** BTC price in the user's local currency (null when unknown / same as USD). */
  localRate: number | null;
  localCurrency: string;
  unit: 'sats' | 'usd' | 'local';
  onToggleUnit: () => void;
  txs: WalletTx[];
  refreshing: boolean;
  onRefresh: () => void;
  walletLabel: string;
  onSend: () => void;
  /** Middle QR button — omitted when the platform can't scan. */
  onScan?: () => void;
  onReceive: () => void;
  footer?: React.ReactNode;
  onScroll?: (e: any) => void;
}) {
  // Fiat modes total the whole portfolio (BTC + USD-pegged stablecoins);
  // sats mode stays BTC-only — summing tokens into sats would mislead.
  // 'local' degrades to USD (then sats) when rates are missing, so a
  // USD-market user still opens on a fiat number instead of raw sats.
  const effUnit = effectiveUnit(unit, usdRate, localRate);
  const fiatValue = (() => {
    if (effUnit === 'sats') return null;
    const total = totalFiat(effUnit, balanceSats, tokens, usdRate, localRate);
    return total == null ? null : formatFiat(total, effUnit === 'usd' ? 'USD' : localCurrency);
  })();
  const fmtTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        {/* Balance header */}
        {/* The whole header (label + chip + amount) is one tap target — the
            tiny chip alone was fiddly to hit. Refresh stays its own button. */}
        <View style={{ alignItems: 'center', paddingTop: 26, paddingBottom: 22 }}>
          <Pressable onPress={onToggleUnit} disabled={usdRate == null} style={{ alignItems: 'center' }} hitSlop={10}>
            <View style={[s.row, { gap: 8 }]}>
              <Text style={{ color: palette.dim, fontSize: 12, letterSpacing: 2 }}>{t('BALANCE')}</Text>
              <View style={{ backgroundColor: palette.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 }}>
                <Text style={{ color: palette.dim, fontSize: 11, letterSpacing: 2 }}>
                  {(effUnit === 'usd' ? 'USD' : effUnit === 'local' ? localCurrency : 'SATS') + ' \u21cc'}
                </Text>
              </View>
              <Pressable hitSlop={8} onPress={onRefresh}>
                {refreshing
                  ? <ActivityIndicator size="small" color={palette.dim} />
                  : <Ionicons name="refresh" size={13} color={palette.dim} />}
              </Pressable>
            </View>
            <Text style={{ color: palette.text, fontSize: 46, fontWeight: '800', marginTop: 6 }} numberOfLines={1} adjustsFontSizeToFit>
              {balanceSats == null ? '…' : fiatValue ?? balanceSats.toLocaleString()}
            </Text>
          </Pressable>
          <Text style={{ color: palette.dim, fontSize: 12, marginTop: 2 }}>{walletLabel}</Text>
          {(() => {
            // One pill per asset with a balance: BTC in sats first, then each
            // stablecoin. Zero balances stay hidden; two decimals max.
            const pills = buildAssetPills(balanceSats, tokens);
            return pills.length > 0 ? (
              <View style={[s.row, { gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' }]}>
                {pills.map((p) => (
                  <View key={p.key} style={{ backgroundColor: palette.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 }}>
                    <Text style={{ color: palette.text2, fontSize: 13, fontWeight: '700' }}>{p.label}</Text>
                  </View>
                ))}
              </View>
            ) : null;
          })()}
        </View>

        {/* Payment history */}
        {txs.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 32 }}>
            <View style={{ width: 92, height: 92, borderRadius: 22, backgroundColor: palette.card, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="wallet-outline" size={40} color={palette.dim} />
            </View>
            <Text style={{ color: palette.text, fontSize: 18, fontWeight: '700', marginTop: 18 }}>{t('No payments yet')}</Text>
            <Text style={{ color: palette.dim, fontSize: 13, textAlign: 'center', marginTop: 8, lineHeight: 19 }}>
              {t('Your payment history will appear here once you send or receive your first payment.')}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 14 }}>
            {txs.map((tx, i) => (
              <View key={i} style={[s.row, { paddingVertical: 12, borderBottomWidth: i === txs.length - 1 ? 0 : 1, borderBottomColor: palette.border }]}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: palette.card, alignItems: 'center', justifyContent: 'center', marginEnd: 12 }}>
                  <Ionicons
                    name={tx.direction === 'in' ? 'arrow-down' : 'arrow-up'}
                    size={16}
                    color={tx.direction === 'in' ? palette.success : palette.text2}
                  />
                </View>
                <View style={{ flex: 1, marginEnd: 8 }}>
                  <Text style={s.toggleTitle} numberOfLines={1}>
                    {tx.description || (tx.direction === 'in' ? t('Received') : t('Sent'))}
                  </Text>
                  <Text style={s.dim}>{fmtTime(tx.ts)}{tx.settled ? '' : ' · ' + t('pending')}</Text>
                </View>
                <Text style={{ fontWeight: '700', color: tx.direction === 'in' ? palette.success : palette.text2 }}>
                  {(tx.direction === 'in' ? '+' : '−') + (tx.token
                    ? `${tx.token.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${tx.token.ticker}`
                    : tx.sats.toLocaleString())}
                </Text>
              </View>
            ))}
          </View>
        )}
        {footer}
      </ScrollView>

      {/* Send / Receive bar */}
      <View style={[s.row, { gap: 10, paddingHorizontal: 12, paddingBottom: 10, paddingTop: 6 }]}>
        <Pressable onPress={onSend} style={{ flex: 1, height: 52, borderRadius: 14, backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center' }}>
          <View style={[s.row, { gap: 8 }]}>
            <Ionicons name="paper-plane" size={17} color="white" />
            <Text style={{ color: 'white', fontWeight: '800', fontSize: 16 }}>{t('Send')}</Text>
          </View>
        </Pressable>
        {onScan && (
          <Pressable onPress={onScan} style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: palette.card, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="qr-code" size={20} color={palette.text2} />
          </Pressable>
        )}
        <Pressable onPress={onReceive} style={{ flex: 1, height: 52, borderRadius: 14, backgroundColor: palette.accentBtn, alignItems: 'center', justifyContent: 'center' }}>
          <View style={[s.row, { gap: 8 }]}>
            <Ionicons name="add-circle" size={17} color="white" />
            <Text style={{ color: 'white', fontWeight: '800', fontSize: 16 }}>{t('Receive')}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}
