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
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { s, palette } from '../ui/theme';
import type { Signer } from '../signer';
import type { MiniAppFirewall, MiniAppRecord } from './firewall';
import { MiniAppBridge, encodeResponseJs, type ApprovalRequest, type ApprovalResult, type BridgeContext } from './bridge';
import { MINIAPP_SHIM } from './shim';
import { persistFirewall } from './store';
import { makeBridgeWallet } from './walletAdapter';
import { ApprovalDialog } from './ApprovalDialog';
import { NotMiniAppNotice, UnverifiedChip, HELLO, useVerifiedProbe } from './shellNotices';
import type { WalletProvider } from '../wallet';

function sameOrigin(url: string, origin: string): boolean {
  try { return new URL(url).origin === origin; } catch { return false; }
}

/** Fresh per-shell secret tying bridge RPC to the main frame (see shim.ts). */
function makeSessionToken(): string {
  const b = new Uint8Array(16);
  (globalThis.crypto as Crypto | undefined)?.getRandomValues?.(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function MiniAppShell({
  app,
  firewall,
  signer,
  getWallet,
  context,
  onClose,
}: {
  app: MiniAppRecord;
  firewall: MiniAppFirewall;
  signer: Signer;
  /** Resolved lazily so the wallet only spins up when a mini-app asks for it.
   *  null = wallet feature off → webln calls fail cleanly. */
  getWallet: (() => Promise<WalletProvider | null>) | null;
  /** Read-signal provider (balance/reputation/location); null disables reads. */
  context?: BridgeContext | null;
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
      context,
      saveFile: async ({ name, mimeType, dataBase64 }) => {
        // Sanitize the filename to a leaf name, then write to the cache dir and
        // hand it to the OS share sheet (the user picks the destination).
        const safe = name.replace(/[^\w.() -]/g, '_').slice(0, 100) || 'file';
        const uri = FileSystem.cacheDirectory + safe;
        await FileSystem.writeAsStringAsync(uri, dataBase64, { encoding: FileSystem.EncodingType.Base64 });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType, UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined });
      },
      persist: persistFirewall,
      approve: (req) => {
        const turn = approvalChain.current.then(
          () => new Promise<ApprovalResult>((resolve) => setApproval({ req, resolve })),
        );
        approvalChain.current = turn.catch(() => {});
        return turn;
      },
    }, app.origin);
  }, [app.origin, firewall, signer, getWallet, context]);

  // Liveness: flips when the shim reports the page touched the mini-app API.
  const [alive, setAlive] = useState(false);
  // Re-probe the manifest on open so a late-added manifest clears Unverified;
  // a verified app never needs the liveness banner.
  const verified = useVerifiedProbe(app, firewall);
  const token = useMemo(() => makeSessionToken(), []);
  const onMessage = useCallback(async (e: { nativeEvent: { data: string } }) => {
    if (e.nativeEvent.data === HELLO) { setAlive(true); return; }
    setAlive(true); // any real bridge traffic counts too
    const res = await bridge.handleMessage(e.nativeEvent.data, token);
    if (res) webRef.current?.injectJavaScript(encodeResponseJs(res));
  }, [bridge, token]);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: Platform.OS === 'ios' ? 54 : 12, paddingBottom: 10, paddingHorizontal: 12, gap: 10, backgroundColor: palette.card }}>
          <Ionicons name="apps-outline" size={18} color={palette.text2} />
          <View style={{ flex: 1 }}>
            <Text style={s.toggleTitle} numberOfLines={1}>{app.name || app.origin}</Text>
            <Text style={[s.dim, { marginTop: 0 }]} numberOfLines={1}>{app.origin.replace('https://', '')}</Text>
          </View>
          {verified ? null : <UnverifiedChip />}
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={palette.text} />
          </Pressable>
        </View>
        {verified ? null : <NotMiniAppNotice alive={alive} />}
        <WebView
          ref={webRef}
          source={{ uri: app.url || app.origin }}
          style={{ flex: 1 }}
          // Security posture — see module docblock before touching any of these.
          // The token statement is prepended (not interpolated into the shim)
          // and, like the shim, lands in the main frame only — so sub-iframes
          // can't read it and their forged bridge calls are rejected.
          injectedJavaScriptBeforeContentLoaded={`window.__fpT=${JSON.stringify(token)};${MINIAPP_SHIM}`}
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
