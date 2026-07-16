/* eslint-disable @typescript-eslint/no-explicit-any -- Web Speech API (webkitSpeechRecognition) has no lib.dom types in this config */
/**
 * Concierge input sheet: describe what you need in plain language → the
 * on-device model drafts the Post form. The human always reviews and posts —
 * the concierge never publishes on its own.
 */
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../i18n';
import { s, palette } from '../ui/theme';
import { draftIntent, type ConciergeContext } from './model';
import type { RepostDraft } from '../deals';

/** Browser speech recognition (Chrome, Safari incl. iOS). Feature-detected;
 *  native apps already have dictation on the OS keyboard's mic key. */
function speechRecognizer(): (new () => any) | null {
  const g = globalThis as any;
  const Rec = g.SpeechRecognition ?? g.webkitSpeechRecognition;
  return typeof Rec === 'function' ? Rec : null;
}

export function ConciergeSheet({ ctx, lang, onDraft, onClose }: {
  ctx: ConciergeContext;
  /** Dictation language (the UI language). */
  lang?: string;
  onDraft: (draft: RepostDraft) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const Rec = speechRecognizer();

  const toggleSpeech = () => {
    if (listening) {
      try { recRef.current?.stop(); } catch { /* already stopped */ }
      return;
    }
    if (!Rec) return;
    try {
      const r = new Rec();
      r.lang = lang || 'en';
      r.interimResults = true;
      r.continuous = false;
      r.onresult = (e: any) => {
        let out = '';
        for (const res of e.results) out += res[0]?.transcript ?? '';
        setText(out.trim());
      };
      r.onend = () => setListening(false);
      r.onerror = () => setListening(false);
      recRef.current = r;
      setListening(true);
      r.start();
    } catch {
      setListening(false);
    }
  };

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
          <View style={{ marginTop: 10 }}>
            <TextInput
              style={[s.input, { height: 80, textAlignVertical: 'top', paddingEnd: Rec ? 40 : undefined }]}
              value={text}
              onChangeText={setText}
              multiline
              autoFocus
              placeholder={t('e.g. "Ride to the airport at 5pm, under $12"')}
              placeholderTextColor={palette.placeholder}
            />
            {Rec ? (
              <Pressable
                onPress={toggleSpeech}
                hitSlop={8}
                accessibilityRole="button" accessibilityLabel={t('Speak instead of typing')}
                style={{ position: 'absolute', end: 10, top: 10 }}
              >
                <Ionicons name={listening ? 'stop-circle' : 'mic-outline'} size={22} color={listening ? palette.danger : palette.text2} />
              </Pressable>
            ) : null}
          </View>
          {listening ? (
            <Text style={[s.dim, { marginTop: 6, fontSize: 11 }]}>{t("Voice input uses your browser's dictation.")}</Text>
          ) : null}
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
