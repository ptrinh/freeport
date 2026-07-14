/**
 * The mini-app approval dialog — shared by the native shell (WebView) and the
 * web shell (iframe). Rendered by the SHELL, never by the mini-app: on native
 * it's an OS modal above the WebView; on web it lives in the parent DOM, which
 * a cross-origin iframe cannot draw over.
 *
 * The Allow buttons arm only after a short delay (Firefox-style) so a page
 * cannot bait a double-tap/click onto the exact spot where Allow appears.
 */
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';
import { s, palette } from '../ui/theme';
import type { ApprovalRequest, ApprovalResult } from './bridge';

const ARM_DELAY_MS = 600;

/** Human line for the approval dialog, per ask reason. */
function askTitle(req: ApprovalRequest): string {
  switch (req.reason) {
    case 'pubkey': case 'wallet-info': return t('wants to know your public key');
    case 'kind-sensitive': case 'kind-unlisted': return t('wants to sign an event as you');
    case 'encrypt-peer': return t('wants to encrypt a message');
    case 'decrypt-peer': return t('wants to READ an encrypted message');
    case 'read-balance': return t('wants to read your wallet balance');
    case 'read-location': return t('wants to read your location');
    case 'save-file': return t('wants to save a file to your device');
    default: return t('wants to send a payment');
  }
}

export function ApprovalDialog({ req, onDone }: { req: ApprovalRequest; onDone: (r: ApprovalResult) => void }) {
  const grantable = ['pubkey', 'wallet-info', 'kind-unlisted', 'encrypt-peer', 'decrypt-peer', 'read-balance', 'read-location'].includes(req.reason);
  const isPayment = req.method === 'webln.sendPayment' || req.method === 'freeport.paySpark';
  const sensitive = req.reason === 'kind-sensitive' || req.reason === 'decrypt-peer';
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setArmed(true), ARM_DELAY_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onDone({ ok: false })}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 24 }}>
        {/* Cap the sheet on wide screens (desktop web) — full-bleed otherwise. */}
        <View style={[s.card, { marginHorizontal: 0, width: '100%', maxWidth: 440, alignSelf: 'center' }]}>
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
          {req.fileName ? <Text style={s.dim} numberOfLines={1}>{t('File')}: {req.fileName}</Text> : null}
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
            <Pressable disabled={!armed} style={[s.btnAccept, { flex: 1, opacity: armed ? 1 : 0.45 }]} onPress={() => onDone({ ok: true })}>
              <Text style={s.btnText}>{t('Allow once')}</Text>
            </Pressable>
          </View>
          {grantable ? (
            <Pressable disabled={!armed} style={{ marginTop: 12, alignItems: 'center', opacity: armed ? 1 : 0.45 }} onPress={() => onDone({ ok: true, remember: true })}>
              <Text style={[s.dim, { textDecorationLine: 'underline' }]}>{t('Always allow for this app')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}
