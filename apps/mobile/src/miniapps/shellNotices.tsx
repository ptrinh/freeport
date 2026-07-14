/**
 * Shared shell UI for mini-app liveness/verification signals.
 *
 * HELLO is the one-shot liveness ping both shells listen for: the native shim
 * sends it when page JS first touches window.nostr/webln/freeport; the web
 * SDK sends it when it picks up the handshake port. It carries no authority —
 * its only effect is hiding the "not a mini-app" notice.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';
import { s } from '../ui/theme';

export const HELLO = '__fp_hello';

/** How long a page gets to show mini-app behavior before the notice shows. */
const HELLO_GRACE_MS = 6000;

/** Amber "Unverified" chip for the shell header (no manifest at add time). */
export function UnverifiedChip() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: 'rgba(245,158,11,.5)', backgroundColor: 'rgba(245,158,11,.12)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Ionicons name="warning-outline" size={11} color="#f59e0b" />
      <Text style={{ color: '#f59e0b', fontSize: 11.5, fontWeight: '600' }}>{t('Unverified')}</Text>
    </View>
  );
}

/**
 * Dismissible notice shown when the page never pings HELLO within the grace
 * window — it probably isn't a Freeport mini-app at all. `alive` flips true on
 * the first ping (also retroactively hides the notice).
 */
export function NotMiniAppNotice({ alive }: { alive: boolean }) {
  const [due, setDue] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setDue(true), HELLO_GRACE_MS);
    return () => clearTimeout(id);
  }, []);
  if (alive || !due || dismissed) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: 'rgba(245,158,11,.14)', borderBottomWidth: 1, borderBottomColor: 'rgba(245,158,11,.4)' }}>
      <Ionicons name="alert-circle-outline" size={16} color="#f59e0b" />
      <Text style={[s.dim, { color: '#f59e0b', flex: 1 }]}>
        {t("This page hasn't used any Freeport features — it may not be a mini-app.")}
      </Text>
      <Pressable hitSlop={8} onPress={() => setDismissed(true)}>
        <Ionicons name="close" size={16} color="#f59e0b" />
      </Pressable>
    </View>
  );
}
