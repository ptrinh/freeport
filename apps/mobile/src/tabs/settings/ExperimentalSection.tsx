import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { t } from '../../i18n';
import { s } from '../../ui/theme';
import { FlaskIcon } from '../../ui/FlaskIcon';

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
}: {
  walletEnabled: boolean;
  onWalletEnabledChange: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable style={s.collapseHeader} onPress={() => setOpen((v) => !v)}>
        <View style={s.collapseLeft}>
          <FlaskIcon size={20} style={s.collapseIcon} />
          <Text style={s.collapseTitle}>{t('Experimental')}</Text>
        </View>
        <Text style={s.collapseChevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && (
        <>
          <Text style={s.dim}>{t('Early features that may change or break. Off by default.')}</Text>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: walletEnabled }}
            style={s.toggleRow}
            onPress={() => onWalletEnabledChange(!walletEnabled)}
          >
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
