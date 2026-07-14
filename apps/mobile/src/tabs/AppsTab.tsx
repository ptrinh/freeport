/**
 * Apps tab — the mini-app launcher, shown as a dedicated bottom-tab when the
 * Mini-apps feature is enabled. Hosts the registry (add by URL/QR, list,
 * revoke) and opens the hardened shell per app. Native uses the WebView shell;
 * web uses the sandboxed-iframe shell (Metro platform resolution on the lazy
 * import).
 */
import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';
import { s, palette } from '../ui/theme';
import type { Signer } from '../signer';
import { MiniAppsSection } from '../miniapps/MiniAppsSection';
import { loadFirewall } from '../miniapps/store';
import { makeBridgeContext } from '../miniapps/context';
import type { MiniAppFirewall, MiniAppRecord } from '../miniapps/firewall';
import { activeWalletProvider } from '../wallet';

const MiniAppShellLazy = React.lazy(() =>
  import('../miniapps/MiniAppShell').then((m) => ({ default: m.MiniAppShell })),
);

export function AppsTab({
  signerRef,
  walletEnabled,
  walletNwcUrl,
  onScroll,
}: {
  signerRef: React.MutableRefObject<Signer | null>;
  walletEnabled: boolean;
  walletNwcUrl: string;
  onScroll?: (e: { nativeEvent: { contentOffset: { y: number } } }) => void;
}) {
  const [fw, setFw] = useState<MiniAppFirewall | null>(null);
  const [open, setOpen] = useState<MiniAppRecord | null>(null);
  useEffect(() => { void loadFirewall().then(setFw).catch(() => {}); }, []);

  const getWallet = walletEnabled ? () => activeWalletProvider(walletNwcUrl) : null;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 40 }} onScroll={onScroll} scrollEventThrottle={16}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Ionicons name="apps-outline" size={22} color={palette.text} />
        <Text style={[s.collapseTitle, { fontSize: 18 }]}>{t('Apps')}</Text>
      </View>
      {fw ? (
        <MiniAppsSection firewall={fw} onOpenApp={setOpen} defaultOpen />
      ) : (
        <Text style={s.dim}>{t('Loading…')}</Text>
      )}
      {open && fw && signerRef.current ? (
        <React.Suspense fallback={null}>
          <MiniAppShellLazy
            app={open}
            firewall={fw}
            signer={signerRef.current}
            getWallet={getWallet}
            context={makeBridgeContext(getWallet)}
            onClose={() => setOpen(null)}
          />
        </React.Suspense>
      ) : null}
    </ScrollView>
  );
}
