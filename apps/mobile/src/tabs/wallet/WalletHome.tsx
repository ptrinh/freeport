import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { s, palette } from '../../ui/theme';
import type { WalletTx } from '../../wallet';

/**
 * Glow-style wallet home (adapted from breez/glow-web, MIT): centered balance
 * with a sats/USD unit chip, payment history below, Send/Receive bar pinned
 * at the bottom.
 */
export function WalletHome({
  balanceSats,
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
  onReceive,
  footer,
  onScroll,
}: {
  balanceSats: number | null;
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
  onReceive: () => void;
  footer?: React.ReactNode;
  onScroll?: (e: any) => void;
}) {
  const fiatFmt = (rate: number, code: string) => {
    const v = (balanceSats! / 1e8) * rate;
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: code === 'USD' ? 2 : 0 }).format(v);
    } catch {
      return `${v.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${code}`;
    }
  };
  const fiatValue = balanceSats == null ? null
    : unit === 'usd' && usdRate ? fiatFmt(usdRate, 'USD')
    : unit === 'local' && localRate ? fiatFmt(localRate, localCurrency)
    : null;
  const fmtTime = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} onScroll={onScroll} scrollEventThrottle={16} showsVerticalScrollIndicator={false}>
        {/* Balance header */}
        <View style={{ alignItems: 'center', paddingTop: 26, paddingBottom: 22 }}>
          <View style={[s.row, { gap: 8 }]}>
            <Text style={{ color: palette.dim, fontSize: 12, letterSpacing: 2 }}>{t('BALANCE')}</Text>
            <Pressable
              hitSlop={8}
              onPress={onToggleUnit}
              disabled={usdRate == null}
              style={{ backgroundColor: palette.card, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 }}
            >
              <Text style={{ color: palette.dim, fontSize: 11, letterSpacing: 2 }}>
                {(unit === 'usd' && usdRate != null ? 'USD' : unit === 'local' && localRate != null ? localCurrency : 'SATS') + ' \u21cc'}
              </Text>
            </Pressable>
            <Pressable hitSlop={8} onPress={onRefresh}>
              {refreshing
                ? <ActivityIndicator size="small" color={palette.dim} />
                : <Ionicons name="refresh" size={13} color={palette.dim} />}
            </Pressable>
          </View>
          <Text style={{ color: palette.text, fontSize: 46, fontWeight: '800', marginTop: 6 }} numberOfLines={1} adjustsFontSizeToFit>
            {balanceSats == null ? '…' : fiatValue ?? balanceSats.toLocaleString()}
          </Text>
          <Text style={{ color: palette.dim, fontSize: 12, marginTop: 2 }}>{walletLabel}</Text>
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
                  {(tx.direction === 'in' ? '+' : '−') + tx.sats.toLocaleString()}
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
            <Ionicons name="arrow-up" size={17} color="white" />
            <Text style={{ color: 'white', fontWeight: '800', fontSize: 16 }}>{t('Send')}</Text>
          </View>
        </Pressable>
        <Pressable onPress={onReceive} style={{ flex: 1, height: 52, borderRadius: 14, backgroundColor: palette.accentBtn, alignItems: 'center', justifyContent: 'center' }}>
          <View style={[s.row, { gap: 8 }]}>
            <Ionicons name="arrow-down" size={17} color="white" />
            <Text style={{ color: 'white', fontWeight: '800', fontSize: 16 }}>{t('Receive')}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}
