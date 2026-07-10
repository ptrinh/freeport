import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { t } from '../../i18n';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { s, palette } from '../../ui/theme';

/**
 * Experimental features — early, opt-in, OFF by default. Each toggle only
 * gates UI; nothing here changes protocol behavior. Current entries:
 *  - Wallet: the self-custodial BTC/stablecoin wallet (Breez SDK Spark /
 *    NWC — see docs/ROADMAP.md). The toggle lands ahead of the feature so
 *    the pref exists across surfaces before the wallet UI ships.
 */
function ExperimentalSection({
  walletEnabled,
  onWalletEnabledChange,
  servicesEnabled,
  onServicesEnabledChange,
}: {
  walletEnabled: boolean;
  onWalletEnabledChange: (v: boolean) => void;
  servicesEnabled: boolean;
  onServicesEnabledChange: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable style={s.collapseHeader} onPress={() => setOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <MaterialCommunityIcons name="flask-outline" size={20} color={palette.text2} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t('Experimental')}</Text>
        </View>
        <Text style={s.collapseChevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && (
        <>
          <Text style={s.dim}>{t('Early features that may change or break. Off by default.')}</Text>
          {/* Service/Product vertical — moved here from Features: it's still
              an early vertical (rideshare is the proven one). Same pref, no
              behavior change. */}
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: servicesEnabled }}
            style={s.toggleRow}
            onPress={() => onServicesEnabledChange(!servicesEnabled)}
          >
            <Ionicons name="storefront-outline" size={20} color={palette.text2} style={{ marginEnd: 10 }} />
            <View style={{ flex: 1, marginEnd: 12 }}>
              <Text style={s.toggleTitle}>{t('Service / Product marketplace')}</Text>
              <Text style={s.dim}>{t('Buy and sell products & services beyond rideshare. Turn off for a leaner UI.')}</Text>
            </View>
            <View style={[s.switchTrack, servicesEnabled && s.switchTrackOn]}>
              <View style={[s.switchThumb, servicesEnabled && s.switchThumbOn]} />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: walletEnabled }}
            style={s.toggleRow}
            onPress={() => onWalletEnabledChange(!walletEnabled)}
          >
            <Ionicons name="wallet-outline" size={20} color={palette.text2} style={{ marginEnd: 10 }} />
            <View style={{ flex: 1, marginEnd: 12 }}>
              <Text style={s.toggleTitle}>{t('Wallet')}</Text>
              <Text style={s.dim}>{t('Self-custodial Bitcoin & stablecoin wallet — coming soon.')}</Text>
            </View>
            <View style={[s.switchTrack, walletEnabled && s.switchTrackOn]}>
              <View style={[s.switchThumb, walletEnabled && s.switchThumbOn]} />
            </View>
          </Pressable>
        </>
      )}
    </>
  );
}

export { ExperimentalSection };
