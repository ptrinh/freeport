/**
 * Zap sheet — pick an amount, get the NIP-57 invoice, hand it to the wallet's
 * Send flow. The receipt (kind 9735) is published by the RECEIVER's LNURL
 * server once the invoice settles, so totals stay verifiable network-wide.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { t } from '../i18n';
import { s, palette } from './theme';
import { MobileClient } from '../client';
import { zapInvoice } from '../zaps';
import type { Signer } from '../signer';

const AMOUNTS = [21, 210, 2100, 21000];

export function ZapSheet({ client, signer, lud16, toPubkey, eventId, onInvoice, onClose }: {
  client: MobileClient | null;
  signer: Signer | null;
  lud16: string;
  toPubkey: string;
  /** The post being zapped (rides on the receipt's e-tag). */
  eventId?: string;
  /** Bolt11 ready — open the wallet Send flow with it. */
  onInvoice: (pr: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const zap = async (amountSat: number) => {
    if (!client || !signer || busy != null) return;
    setBusy(amountSat);
    setFailed(false);
    try {
      const res = await zapInvoice(signer, { lud16, toPubkey, eventId, amountSat, relays: client.relays });
      if (res?.pr) onInvoice(res.pr);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.sortBackdrop} onPress={onClose}>
        <Pressable style={s.sortSheet} onPress={() => {}}>
          <Text style={s.sectionTitle}>{'⚡ ' + t('Zap')}</Text>
          <Text style={s.dim}>{t('Tip sats to {name} — a public thank-you on this post.', { name: lud16 })}</Text>
          <View style={[s.btnRow, { marginTop: 14, flexWrap: 'wrap' }]}>
            {AMOUNTS.map((a) => (
              <Pressable key={a} style={[s.btnAccept, { flexGrow: 1, minWidth: 70 }]} disabled={busy != null} onPress={() => zap(a)}>
                {busy === a ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{a.toLocaleString()}</Text>}
              </Pressable>
            ))}
          </View>
          {failed ? (
            <Text style={[s.dim, { marginTop: 10, color: palette.danger }]}>{t('Could not connect. Check your internet and try again.')}</Text>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
