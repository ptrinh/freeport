/**
 * Mini-app shell (NATIVE) — the hardened WebView that hosts a third-party
 * mini-app. The web build swaps in MiniAppShell.web.tsx (cross-origin iframe +
 * postMessage SDK) via Metro platform resolution.
 *
 * Hardening posture:
 *  - shim injected into the MAIN FRAME ONLY, before content loads
 *  - one incognito WebView per app: no shared cookies/storage across apps
 *  - navigation locked to the registered origin; anything else opens in the
 *    system browser instead of inheriting the bridge
 *  - popups/new-windows disabled; http/file/data URLs never load
 *  - every bridge response is escape-encoded before injectJavaScript
 */
import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Linking, Modal, Platform, Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { s, palette } from '../ui/theme';
import type { Signer } from '../signer';
import type { MiniAppFirewall, MiniAppRecord } from './firewall';
import { MiniAppBridge, encodeResponseJs, type ApprovalRequest, type ApprovalResult } from './bridge';
import { MINIAPP_SHIM } from './shim';
import { persistFirewall } from './store';
import { makeBridgeWallet } from './walletAdapter';
import { ApprovalDialog } from './ApprovalDialog';
import type { WalletProvider } from '../wallet';

function sameOrigin(url: string, origin: string): boolean {
  try { return new URL(url).origin === origin; } catch { return false; }
}

export function MiniAppShell({
  app,
  firewall,
  signer,
  getWallet,
  onClose,
}: {
  app: MiniAppRecord;
  firewall: MiniAppFirewall;
  signer: Signer;
  /** Resolved lazily so the wallet only spins up when a mini-app asks for it.
   *  null = wallet feature off → webln calls fail cleanly. */
  getWallet: (() => Promise<WalletProvider | null>) | null;
  onClose: () => void;
}) {
  const webRef = useRef<WebView>(null);
  const [approval, setApproval] = useState<{ req: ApprovalRequest; resolve: (r: ApprovalResult) => void } | null>(null);
  // Approval dialogs show ONE at a time; concurrent asks queue behind each
  // other (the firewall's ask-flood cap bounds the queue at 3). Without this,
  // a second ask would overwrite the first dialog and strand its promise.
  const approvalChain = useRef<Promise<unknown>>(Promise.resolve());

  const bridge = useMemo(() => {
    return new MiniAppBridge({
      firewall,
      signer,
      wallet: makeBridgeWallet(getWallet),
      persist: persistFirewall,
      approve: (req) => {
        const turn = approvalChain.current.then(
          () => new Promise<ApprovalResult>((resolve) => setApproval({ req, resolve })),
        );
        approvalChain.current = turn.catch(() => {});
        return turn;
      },
    }, app.origin);
  }, [app.origin, firewall, signer, getWallet]);

  const onMessage = useCallback(async (e: { nativeEvent: { data: string } }) => {
    const res = await bridge.handleMessage(e.nativeEvent.data);
    if (res) webRef.current?.injectJavaScript(encodeResponseJs(res));
  }, [bridge]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 54 : 12, paddingBottom: 10, paddingHorizontal: 12, gap: 10, backgroundColor: palette.card }}>
          <Ionicons name="apps-outline" size={18} color={palette.text2} />
          <View style={{ flex: 1 }}>
            <Text style={s.toggleTitle} numberOfLines={1}>{app.name || app.origin}</Text>
            <Text style={[s.dim, { marginTop: 0 }]} numberOfLines={1}>{app.origin.replace('https://', '')}</Text>
          </View>
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={palette.text} />
          </Pressable>
        </View>
        <WebView
          ref={webRef}
          source={{ uri: app.url || app.origin }}
          style={{ flex: 1 }}
          // Security posture — see module docblock before touching any of these.
          injectedJavaScriptBeforeContentLoaded={MINIAPP_SHIM}
          injectedJavaScriptForMainFrameOnly
          originWhitelist={['https://*']}
          incognito
          setSupportMultipleWindows={false}
          allowFileAccess={false}
          allowFileAccessFromFileURLs={false}
          allowUniversalAccessFromFileURLs={false}
          onMessage={onMessage}
          onNavigationStateChange={(nav) => bridge.setOrigin(nav.url)}
          onShouldStartLoadWithRequest={(req) => {
            if (sameOrigin(req.url, app.origin)) return true;
            // Foreign origins never load inside the shell (they'd sit next to
            // the bridge); hand them to the system browser instead.
            if (/^https?:/.test(req.url)) void Linking.openURL(req.url).catch(() => {});
            return false;
          }}
        />
      </View>
      {approval ? (
        <ApprovalDialog
          req={approval.req}
          onDone={(r) => { approval.resolve(r); setApproval(null); }}
        />
      ) : null}
    </Modal>
  );
}
