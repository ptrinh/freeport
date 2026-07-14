/**
 * HODL-escrow section on a confirmed deal card. Trust-minimized: the buyer's
 * funds lock at the seller's wallet but can't be settled until the buyer
 * releases the preimage — and auto-refund if they never do. No custodian.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../../i18n';
import { s, palette } from '../../ui/theme';
import { uiAlert, confirmAsync } from '../../ui/alerts';
import type { EscrowState } from '../../client';

export function EscrowSection({ escrow, isBuyer, paymentHint, onRequest, onAccept, onRelease, onRetryClaim, onPayInvoice }: {
  escrow?: EscrowState;
  isBuyer: boolean;
  /** The deal's agreed price string (e.g. "S$7.50") — shown as a reference. */
  paymentHint?: string;
  onRequest: (sats: number) => Promise<void>;
  onAccept: () => Promise<void>;
  onRelease: () => Promise<void>;
  onRetryClaim: () => Promise<void>;
  onPayInvoice: (invoice: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [sats, setSats] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); }
    catch (e) { uiAlert(t('Could not send'), e instanceof Error ? e.message : undefined); }
    finally { setBusy(false); }
  };

  // ── Buyer ──────────────────────────────────────────────────────────────────
  if (isBuyer) {
    if (!escrow) {
      if (!editing) {
        return (
          <Pressable style={s.mapLink} onPress={() => setEditing(true)} hitSlop={6}>
            <Text style={s.mapLinkText}>{'🔒 ' + t('Pay with escrow')}</Text>
          </Pressable>
        );
      }
      return (
        <View style={s.counterBox}>
          <Text style={s.sectionTitle}>{'🔒 ' + t('Pay with escrow')}</Text>
          <Text style={s.dim}>{t('Your sats lock at the seller side but only settle when YOU release them on delivery — otherwise they auto-refund after 24 hours.')}</Text>
          <View style={[s.row, { gap: 8, marginTop: 8, alignItems: 'center' }]}>
            <TextInput
              style={[s.input, { flex: 1 }]}
              value={sats}
              onChangeText={setSats}
              keyboardType="number-pad"
              placeholder={paymentHint ? `${t('Amount in sats')} (${paymentHint})` : t('Amount in sats')}
              placeholderTextColor={palette.placeholder}
            />
            <Pressable
              style={s.btnAccept}
              disabled={busy}
              onPress={() => {
                const n = Math.round(Number(sats));
                if (!Number.isFinite(n) || n <= 0) { uiAlert(t('Enter a valid price')); return; }
                run(() => onRequest(n)).then(() => setEditing(false));
              }}
            >
              {busy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Request')}</Text>}
            </Pressable>
          </View>
        </View>
      );
    }
    if (escrow.status === 'requested') {
      return <Text style={s.dim}>{'🔒 ' + t('Escrow requested — waiting for the seller to create the hold invoice…')}</Text>;
    }
    if (escrow.status === 'invoiced') {
      return (
        <View style={{ gap: 8 }}>
          <Pressable style={s.btnAccept} onPress={() => onPayInvoice(escrow.invoice!)}>
            <Text style={s.btnText}>{'🔒⚡ ' + t('Pay escrow invoice')} · {escrow.amountSats.toLocaleString()} sats</Text>
          </Pressable>
          <Pressable
            style={s.btnCounter}
            disabled={busy}
            onPress={async () => {
              const ok = await confirmAsync(
                t('Release escrow?'),
                t('Only release after you received what you paid for — this settles the payment to the seller and cannot be undone.'),
                t('Release'),
              );
              if (ok) run(onRelease);
            }}
          >
            <Text style={s.btnText}>{'🔓 ' + t('Release escrow')}</Text>
          </Pressable>
          <Text style={s.dim}>{t('Funds stay locked until you release them; unreleased funds auto-refund after 24 hours.')}</Text>
        </View>
      );
    }
    return <Text style={s.dim}>{'🔓 ' + t('Escrow released — the payment settles to the seller.')}</Text>;
  }

  // ── Seller ─────────────────────────────────────────────────────────────────
  if (!escrow) return null;
  if (escrow.status === 'requested') {
    return (
      <View style={s.counterBox}>
        <Text style={s.sectionTitle}>{'🔒 ' + t('Escrow requested')}</Text>
        <Text style={s.dim}>{t('The buyer wants to lock {sats} sats in escrow. Funds settle to you when they release on delivery.', { sats: escrow.amountSats.toLocaleString() })}</Text>
        <Pressable style={[s.btnAccept, { marginTop: 8 }]} disabled={busy} onPress={() => run(onAccept)}>
          {busy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Create hold invoice')}</Text>}
        </Pressable>
      </View>
    );
  }
  if (escrow.status === 'invoiced' || escrow.status === 'released') {
    return <Text style={s.dim}>{'🔒 ' + t('Hold invoice sent — funds lock when the buyer pays and settle automatically when they release.')}</Text>;
  }
  if (escrow.status === 'claim_failed') {
    return (
      <View style={{ gap: 6 }}>
        <Text style={[s.dim, { color: palette.warn }]}>{'⚠️ ' + t('Settling failed — the buyer may not have paid yet.')}</Text>
        <Pressable style={s.btnCounter} disabled={busy} onPress={() => run(onRetryClaim)}>
          {busy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Retry settling')}</Text>}
        </Pressable>
      </View>
    );
  }
  return (
    <View style={[s.row, { gap: 6, alignItems: 'center' }]}>
      <Ionicons name="lock-open" size={14} color={palette.success} />
      <Text style={{ color: palette.success }}>{t('Escrow settled')} · {escrow.amountSats.toLocaleString()} sats</Text>
    </View>
  );
}
