/**
 * Mini-app shell — the hardened WebView that hosts a third-party mini-app,
 * plus the native approval dialog. Native-only (the web build has no way to
 * inject into a cross-origin frame — see docs/ROADMAP.md).
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
import { t } from '../i18n';
import { s, palette } from '../ui/theme';
import type { Signer } from '../signer';
import type { MiniAppFirewall, MiniAppRecord } from './firewall';
import { MiniAppBridge, encodeResponseJs, type ApprovalRequest, type ApprovalResult, type BridgeWallet } from './bridge';
import { MINIAPP_SHIM } from './shim';
import { persistFirewall } from './store';
import { bolt11Sats } from '../wallet/bolt11';
import type { WalletProvider } from '../wallet';

function sameOrigin(url: string, origin: string): boolean {
  try { return new URL(url).origin === origin; } catch { return false; }
}

/** Human line for the approval dialog, per ask reason. */
function askTitle(req: ApprovalRequest): string {
  switch (req.reason) {
    case 'pubkey': case 'wallet-info': return t('wants to know your public key');
    case 'kind-sensitive': case 'kind-unlisted': return t('wants to sign an event as you');
    case 'encrypt-peer': return t('wants to encrypt a message');
    case 'decrypt-peer': return t('wants to READ an encrypted message');
    default: return t('wants to send a payment');
  }
}

function ApprovalDialog({ req, onDone }: { req: ApprovalRequest; onDone: (r: ApprovalResult) => void }) {
  const grantable = ['pubkey', 'wallet-info', 'kind-unlisted', 'encrypt-peer', 'decrypt-peer'].includes(req.reason);
  const isPayment = req.method === 'webln.sendPayment' || req.method === 'freeport.paySpark';
  const sensitive = req.reason === 'kind-sensitive' || req.reason === 'decrypt-peer';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onDone({ ok: false })}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
        <View style={[s.card, { marginHorizontal: 0 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name={sensitive ? 'warning' : 'shield-checkmark-outline'} size={20} color={sensitive ? '#f59e0b' : palette.text2} />
            <Text style={[s.toggleTitle, { flex: 1 }]} numberOfLines={1}>{req.appName}</Text>
          </View>
          {/* The origin is the ground truth — always shown, never the app's claim. */}
          <Text style={s.dim} numberOfLines={1}>{req.origin}</Text>
          <Text style={[s.toggleTitle, { marginTop: 10 }]}>{askTitle(req)}</Text>
          {typeof req.kind === 'number' ? <Text style={s.dim}>{t('Event kind')}: {req.kind}</Text> : null}
          {req.contentPreview ? (
            <Text style={[s.mono, { maxHeight: 120 }]} numberOfLines={6}>{req.contentPreview}</Text>
          ) : null}
          {req.peer ? <Text style={s.dim} numberOfLines={1}>{t('Peer')}: {req.peer.slice(0, 12)}…{req.peer.slice(-6)}</Text> : null}
          {isPayment ? (
            <>
              <Text style={[s.toggleTitle, { fontSize: 22, marginTop: 6 }]}>
                {req.token ? `${req.token.amount} ${req.token.ticker}`
                  : typeof req.amountSats === 'number' ? `${req.amountSats.toLocaleString()} sats`
                  : t('Unknown amount')}
              </Text>
              {req.address ? (
                <Text style={s.dim} numberOfLines={1}>{t('To')}: {req.address.slice(0, 16)}…{req.address.slice(-8)}</Text>
              ) : null}
            </>
          ) : null}
          {sensitive ? (
            <Text style={[s.dim, { color: '#f59e0b' }]}>
              {req.reason === 'decrypt-peer'
                ? t('This exposes private messages with this contact to the mini-app.')
                : t('Signing this kind of event lets the app act as you in Freeport. Approve only if you fully trust it.')}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <Pressable style={[s.btnAccept, { flex: 1, backgroundColor: palette.inset }]} onPress={() => onDone({ ok: false })}>
              <Text style={[s.btnText, { color: palette.text }]}>{t('Deny')}</Text>
            </Pressable>
            <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={() => onDone({ ok: true })}>
              <Text style={s.btnText}>{t('Allow once')}</Text>
            </Pressable>
          </View>
          {grantable ? (
            <Pressable style={{ marginTop: 12, alignItems: 'center' }} onPress={() => onDone({ ok: true, remember: true })}>
              <Text style={[s.dim, { textDecorationLine: 'underline' }]}>{t('Always allow for this app')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
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
    const wallet: BridgeWallet | null = getWallet && {
      makeInvoice: async (sats, memo) => {
        const w = await getWallet();
        if (!w) throw new Error('no wallet');
        return (await w.receive(sats, memo)).invoice;
      },
      payInvoice: async (bolt11) => {
        const w = await getWallet();
        if (!w) throw new Error('no wallet');
        const r = await w.pay(bolt11);
        return { preimage: r.preimage ?? '' };
      },
      parseAmount: (bolt11) => bolt11Sats(bolt11),
      paySpark: async (address, opts) => {
        const w = await getWallet();
        if (!w) throw new Error('no wallet');
        if (opts.token) {
          const tok = (await w.tokenBalances()).find((x) => x.ticker.toUpperCase() === opts.token!.ticker.toUpperCase());
          if (!tok || !w.payToken) throw new Error('token unavailable');
          return w.payToken(address, tok, opts.token.amount);
        }
        return w.pay(address, opts.sats);
      },
    };
    return new MiniAppBridge({
      firewall,
      signer,
      wallet,
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
