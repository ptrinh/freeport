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
 *
 * Coming-soon rows (ship-ahead policy, docs/ROADMAP.md): roadmap features are
 * shown here disabled before they exist, so users see what's next. When a
 * feature ships via OTA its row becomes a live toggle like Wallet's.
 */

/** A visible-but-disabled row for a feature that hasn't shipped yet. */
function ComingSoonRow({ icon, title, desc }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; desc: string }) {
  return (
    <View accessibilityRole="switch" accessibilityState={{ checked: false, disabled: true }} style={[s.toggleRow, { opacity: 0.45 }]}>
      <Ionicons name={icon} size={20} color={palette.text2} style={{ marginEnd: 10 }} />
      <View style={{ flex: 1, marginEnd: 12 }}>
        <Text style={s.toggleTitle}>{title}</Text>
        <Text style={s.dim}>{desc}</Text>
      </View>
      <View style={s.switchTrack}>
        <View style={s.switchThumb} />
      </View>
    </View>
  );
}
function ExperimentalSection({
  walletEnabled,
  onWalletEnabledChange,
  servicesEnabled,
  onServicesEnabledChange,
  llmEnabled,
  onLlmEnabledChange,
  llmSupported = true,
  miniAppsEnabled,
  onMiniAppsEnabledChange,
  flat = false,
}: {
  walletEnabled: boolean;
  onWalletEnabledChange: (v: boolean) => void;
  servicesEnabled: boolean;
  onServicesEnabledChange: (v: boolean) => void;
  llmEnabled: boolean;
  onLlmEnabledChange: (v: boolean) => void;
  /** Device has an on-device model layer (Apple FM / Gemini Nano / Prompt API). */
  llmSupported?: boolean;
  miniAppsEnabled: boolean;
  onMiniAppsEnabledChange: (v: boolean) => void;
  /** Rendered inside the Features subscreen — drop the accordion header, always expanded. */
  flat?: boolean;
}) {
  const [accOpen, setAccOpen] = useState(false);
  const open = flat || accOpen;

  return (
    <>
      {!flat && (
        <Pressable style={s.collapseHeader} onPress={() => setAccOpen((v) => !v)}>
          <View style={s.collapseLeft}>
            <MaterialCommunityIcons name="flask-outline" size={20} color={palette.text2} style={s.collapseIcon} />
            <Text style={s.collapseTitle}>{t('Features')}</Text>
          </View>
          <Text style={s.collapseChevron}>{accOpen ? '▾' : '▸'}</Text>
        </Pressable>
      )}
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
          {llmSupported ? (
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: llmEnabled }}
              style={s.toggleRow}
              onPress={() => onLlmEnabledChange(!llmEnabled)}
            >
              <Ionicons name="sparkles-outline" size={20} color={palette.text2} style={{ marginEnd: 10 }} />
              <View style={{ flex: 1, marginEnd: 12 }}>
                <Text style={s.toggleTitle}>{t('Local LLM AI')}</Text>
                <Text style={s.dim}>{t('On-device AI features (post drafting, chat translation). Runs entirely on this device — nothing is sent anywhere.')}</Text>
              </View>
              <View style={[s.switchTrack, llmEnabled && s.switchTrackOn]}>
                <View style={[s.switchThumb, llmEnabled && s.switchThumbOn]} />
              </View>
            </Pressable>
          ) : (
            <View accessibilityRole="switch" accessibilityState={{ checked: false, disabled: true }} style={[s.toggleRow, { opacity: 0.45 }]}>
              <Ionicons name="sparkles-outline" size={20} color={palette.text2} style={{ marginEnd: 10 }} />
              <View style={{ flex: 1, marginEnd: 12 }}>
                <Text style={s.toggleTitle}>{t('Local LLM AI')}</Text>
                <Text style={s.dim}>{t('Device not supported')}</Text>
              </View>
              <View style={s.switchTrack}><View style={s.switchThumb} /></View>
            </View>
          )}
          {/* Calls shipped — the toggle lives under Settings → Chat (with the
              TURN fallback + IP note), per the roadmap spec. */}
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: miniAppsEnabled }}
            style={s.toggleRow}
            onPress={() => onMiniAppsEnabledChange(!miniAppsEnabled)}
          >
            <Ionicons name="apps-outline" size={20} color={palette.text2} style={{ marginEnd: 10 }} />
            <View style={{ flex: 1, marginEnd: 12 }}>
              <Text style={s.toggleTitle}>{t('Mini-apps')}</Text>
              <Text style={s.dim}>{t('Web apps that use your Freeport identity & wallet. Sandboxed — every sensitive action needs your approval.')}</Text>
            </View>
            <View style={[s.switchTrack, miniAppsEnabled && s.switchTrackOn]}>
              <View style={[s.switchThumb, miniAppsEnabled && s.switchThumbOn]} />
            </View>
          </Pressable>
          {/* Zaps shipped — the ⚡ chip lives on Browse cards (wallet on). */}
        </>
      )}
    </>
  );
}

export { ExperimentalSection };
