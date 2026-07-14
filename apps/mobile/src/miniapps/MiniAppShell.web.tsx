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
import { s, palette } from '../ui/theme';
import type { Signer } from '../signer';
import type { MiniAppFirewall, MiniAppRecord } from './firewall';
import { MiniAppBridge, type ApprovalRequest, type ApprovalResult, type BridgeContext } from './bridge';
import { persistFirewall } from './store';
import { makeBridgeWallet } from './walletAdapter';
import { ApprovalDialog } from './ApprovalDialog';
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

  const bridge = useMemo(() => new MiniAppBridge({
    firewall,
    signer,
    wallet: makeBridgeWallet(getWallet),
    context,
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
          <Pressable onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={palette.text} />
          </Pressable>
        </View>
        {React.createElement('iframe', {
          ref: frameRef,
          src: app.url || app.origin,
          // No popups, no top navigation, no modals — scripts + forms only.
          sandbox: 'allow-scripts allow-same-origin allow-forms',
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
