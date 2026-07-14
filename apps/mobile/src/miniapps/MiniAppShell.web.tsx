/**
 * Mini-app shell (WEB) — hosts the mini-app in a sandboxed CROSS-ORIGIN
 * iframe. The browser's same-origin policy is the wall here: the iframe can't
 * touch the parent (keys, wallet, DOM), and this shell never trusts anything
 * the frame sends.
 *
 * Transport is a MessageChannel handshake instead of injection (you cannot
 * inject into a cross-origin frame): on every iframe load the shell mints a
 * fresh channel and hands port2 to the frame with targetOrigin pinned to the
 * registered app origin — a frame navigated anywhere else simply never
 * receives a port. The mini-app side is packages/miniapp-sdk/freeport-sdk.js,
 * which is deliberately NOT part of the TCB: everything it relays is
 * re-validated by the same firewall the native shell uses.
 *
 * The approval dialog renders in the PARENT DOM (a cross-origin iframe cannot
 * draw over it) with delayed-arm Allow buttons against bait-click timing.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';
import { s, palette } from '../ui/theme';
import type { Signer } from '../signer';
import type { MiniAppFirewall, MiniAppRecord } from './firewall';
import { MiniAppBridge, type ApprovalRequest, type ApprovalResult, type BridgeContext } from './bridge';
import { persistFirewall } from './store';
import { makeBridgeWallet } from './walletAdapter';
import { ApprovalDialog } from './ApprovalDialog';
import { NotMiniAppNotice, UnverifiedChip, HELLO, useVerifiedProbe } from './shellNotices';
import { sameOriginAsShell } from './metadata';
import type { WalletProvider } from '../wallet';

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
  getWallet: (() => Promise<WalletProvider | null>) | null;
  context?: BridgeContext | null;
  onClose: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const portRef = useRef<MessagePort | null>(null);
  const [approval, setApproval] = useState<{ req: ApprovalRequest; resolve: (r: ApprovalResult) => void } | null>(null);
  const approvalChain = useRef<Promise<unknown>>(Promise.resolve());
  // Liveness: flips when the SDK acks the handshake (or any bridge traffic).
  const [alive, setAlive] = useState(false);
  // Re-probe the manifest on open so an app that shipped one after being added
  // stops showing Unverified. A verified (manifest-declared) app is a mini-app
  // by definition, so it never needs the liveness heuristic banner.
  const verified = useVerifiedProbe(app, firewall);

  const bridge = useMemo(() => new MiniAppBridge({
    firewall,
    signer,
    wallet: makeBridgeWallet(getWallet),
    context,
    saveFile: async ({ name, mimeType, dataBase64 }) => {
      // Parent-document download (the iframe is sandboxed; the parent is not).
      const bin = atob(dataBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      const a = document.createElement('a');
      a.href = url; a.download = name.replace(/[^\w.() -]/g, '_').slice(0, 100) || 'file';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
    persist: persistFirewall,
    approve: (req) => {
      const turn = approvalChain.current.then(
        () => new Promise<ApprovalResult>((resolve) => setApproval({ req, resolve })),
      );
      approvalChain.current = turn.catch(() => {});
      return turn;
    },
  }, app.origin), [app.origin, firewall, signer, getWallet, context]);

  useEffect(() => () => { portRef.current?.close(); portRef.current = null; }, []);

  const connect = () => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    portRef.current?.close();
    const ch = new MessageChannel();
    portRef.current = ch.port1;
    ch.port1.onmessage = async (ev: MessageEvent) => {
      if (typeof ev.data !== 'string') return;
      if (ev.data === HELLO) { setAlive(true); return; } // SDK picked up the port
      setAlive(true); // any real bridge traffic counts too
      // This port exists only inside a document served from app.origin (the
      // handshake below pins targetOrigin), so requests on it carry that
      // origin's authority — a navigated-away frame never gets a port at all.
      bridge.setOrigin(app.origin);
      const res = await bridge.handleMessage(ev.data);
      if (res) portRef.current?.postMessage(res);
    };
    ch.port1.start?.();
    // If the frame is NOT on app.origin, this throws away the port silently —
    // exactly what we want.
    win.postMessage({ __fp: 'connect', shell: 'freeport-web' }, app.origin, [ch.port2]);
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: palette.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 12, paddingBottom: 10, paddingHorizontal: 12, gap: 10, backgroundColor: palette.card }}>
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
        {sameOriginAsShell(app.url || app.origin) ? (
          // A same-origin app can't be isolated by the sandbox iframe (it would
          // share this document's storage, incl. the key). Refuse to load it
          // rather than expose the key — even for a previously-added app.
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 }}>
            <Ionicons name="shield-half-outline" size={40} color={palette.text2} />
            <Text style={[s.toggleTitle, { textAlign: 'center' }]}>{t("Can't run this app in the web app")}</Text>
            <Text style={[s.dim, { textAlign: 'center' }]}>
              {t("It's hosted on Freeport's own domain, which the web sandbox can't isolate. Open it in the Freeport mobile app instead.")}
            </Text>
          </View>
        ) : React.createElement('iframe', {
          ref: frameRef,
          src: app.url || app.origin,
          // No popups, no top navigation, no modals — scripts + forms +
          // downloads only (downloads let a mini-app's own <a download> work;
          // the bridge saveFile still routes through the parent regardless).
          sandbox: 'allow-scripts allow-same-origin allow-forms allow-downloads',
          allow: '',
          referrerPolicy: 'no-referrer',
          style: { border: 0, flex: 1, width: '100%', height: '100%', backgroundColor: '#fff' },
          onLoad: connect,
        })}
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
