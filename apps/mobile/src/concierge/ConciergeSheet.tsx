/**
 * Concierge input sheet: describe what you need in plain language → the
 * on-device model drafts the Post form. The human always reviews and posts —
 * the concierge never publishes on its own.
 */
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';
import { s, palette } from '../ui/theme';
import { draftIntent, type ConciergeContext } from './model';
import type { RepostDraft } from '../deals';

export function ConciergeSheet({ ctx, onDraft, onClose }: {
  ctx: ConciergeContext;
  onDraft: (draft: RepostDraft) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const draft = await draftIntent(text, ctx);
      if (draft) onDraft(draft);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.sortBackdrop} onPress={onClose}>
        <Pressable style={s.sortSheet} onPress={() => {}}>
          <View style={[s.row, { gap: 6 }]}>
            <Ionicons name="sparkles" size={16} color={palette.accent} />
            <Text style={s.sectionTitle}>{t('Describe what you need')}</Text>
          </View>
          <Text style={s.dim}>{t('On-device AI — your request never leaves this phone.')}</Text>
          <TextInput
            style={[s.input, { marginTop: 10, height: 80, textAlignVertical: 'top' }]}
            value={text}
            onChangeText={setText}
            multiline
            autoFocus
            placeholder={t('e.g. "Ride to the airport at 5pm, under $12"')}
            placeholderTextColor={palette.placeholder}
          />
          {failed ? (
            <Text style={[s.dim, { marginTop: 8, color: palette.danger }]}>{t('Could not draft that — try rephrasing.')}</Text>
          ) : null}
          <Pressable style={[s.btnAccept, { marginTop: 12 }]} onPress={run} disabled={busy || !text.trim()}>
            {busy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{'✨ ' + t('Draft my post')}</Text>}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
