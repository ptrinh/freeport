import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { type Negotiation, type ProposedTerms } from '@freeport/protocol';
import { t } from '../../i18n';
import { uploadImage, uploadFile, UploadError } from '../../upload';
import { startRecording, stopRecording, playAudio } from '../../voice';
import { defaultIntentTime, timeToWindow, parsePayment, fmtPayment } from '../../ui/format';
import { currencyForMarket, type Currency } from '../../locations';
import { s, palette } from '../../ui/theme';
import { uiAlert } from '../../ui/alerts';
import { Field, ReadonlyField, DurationField, TimeField, PaymentField } from '../../ui/fields';

/**
 * Header connectivity indicator: a solid colored core wrapped in a soft halo
 * that continuously expands and fades (a "glow" pulse) so the status reads at a
 * glance. Color reflects online (green) / offline (red) / connecting (amber).
 */
/** Free-text chat for a confirmed deal — coordinate pickup, share details. */
/** A chat message that is just an uploaded image URL renders as an image. */
export function isImageMsg(t: string): boolean {
  if (!/^https?:\/\//i.test(t)) return false;
  if (isAudioMsg(t)) return false; // audio/voice URLs (also hosted on nostr.build) are not images
  return /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(t) || /nostr\.build|image\.nostr|imgur|i\.ibb/i.test(t);
}

/** A chat message that is an uploaded audio URL renders as a play button. */
export function isAudioMsg(t: string): boolean {
  if (!/^https?:\/\//i.test(t)) return false;
  return /\.(m4a|mp3|webm|ogg|caf|mp4|wav|aac)(\?|$)/i.test(t);
}

/** A live-location share link (".../#t=<key>") renders as a tap-to-track button. */
export function isTripMsg(t: string): boolean {
  return /^https?:\/\/\S+#t=[A-Za-z0-9\-_]+/.test(t.trim());
}

/** A single voice-memo bubble with a tap-to-play button. */
function VoiceMessage({ url, dir }: { url: string; dir: 'in' | 'out' }) {
  const [playing, setPlaying] = useState(false);
  const play = async () => {
    setPlaying(true);
    try { await playAudio(url); } catch {} finally { setPlaying(false); }
  };
  // Outgoing bubbles are accent-filled; the default text/accent colors are low
  // contrast on them in light mode — use the light "out" color there.
  const outColor = dir === 'out' ? '#f5f7fa' : undefined;
  return (
    <Pressable style={s.voiceMsg} onPress={play}>
      <Ionicons name={playing ? 'volume-high' : 'play'} size={18} color={outColor ?? palette.accent} />
      <Text style={[s.voiceMsgText, dir === 'out' && s.chatTextOut]}>{t("Voice memo")}</Text>
    </Pressable>
  );
}

// Memoised so typing in the message box (which re-renders ChatThread on every
// keystroke) doesn't re-render the whole chat history. Each bubble only
// re-renders if its own message or the zoom handler changes.
const ChatBubble = React.memo(function ChatBubble({
  text,
  dir,
  onZoom,
}: {
  text: string;
  dir: 'in' | 'out';
  onZoom: (uri: string) => void;
}) {
  return (
    <View style={[s.chatBubble, dir === 'out' ? s.chatOut : s.chatIn]}>
      {isAudioMsg(text)
        ? <VoiceMessage url={text} dir={dir} />
        : isImageMsg(text)
        ? <Pressable onPress={() => onZoom(text)}>
            <Image source={{ uri: text }} style={s.chatImage} resizeMode="cover" />
          </Pressable>
        : isTripMsg(text)
        ? <Pressable style={s.trackMsg} onPress={() => Linking.openURL(text.trim())}>
            {/* On an outgoing (accent-filled) bubble the link color equals the
                bubble color in light mode — use the light "out" text color so it
                stays legible on both sides. */}
            <Ionicons name="navigate" size={16} color={dir === 'out' ? '#f5f7fa' : palette.link} />
            <Text style={[s.trackMsgText, dir === 'out' && s.chatTextOut]}>{t('Track live location')}</Text>
          </Pressable>
        : <Text style={[s.chatBubbleText, dir === 'out' ? s.chatTextOut : s.chatTextIn]}>{text}</Text>}
    </View>
  );
});

export function ChatThread({ nego, onSend, quickReplies }: {
  nego: Negotiation;
  onSend: (text: string) => Promise<void>;
  /** Grab-style one-tap replies rendered above the input ("I am here ✅", …). */
  quickReplies?: { label: string; text: string }[];
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [showAllMsgs, setShowAllMsgs] = useState(false);
  const msgs = nego.messages ?? [];
  // Keep the thread compact: show only the most recent few, with a tap to reveal
  // the rest. Otherwise a long conversation pushes the input box far down the card.
  const CHAT_PREVIEW = 5;
  const collapsedMsgs = !showAllMsgs && msgs.length > CHAT_PREVIEW;
  const shownMsgs = collapsedMsgs ? msgs.slice(-CHAT_PREVIEW) : msgs;

  const toggleRecord = async () => {
    if (recording) {
      setRecording(false);
      setUploading(true);
      try {
        const clip = await stopRecording();
        if (clip) {
          const url = await uploadFile(clip.data, clip.name, clip.mime);
          await onSend(url); // rendered as a voice memo on both sides
        }
      } catch (e) {
        Alert.alert('Voice memo failed', e instanceof UploadError ? e.message : (e as Error).message || 'Try again.');
      } finally { setUploading(false); }
    } else {
      try {
        await startRecording();
        setRecording(true);
      } catch (e) {
        Alert.alert('Cannot record', (e as Error).message || 'Microphone unavailable.');
      }
    }
  };

  const send = async () => {
    const msg = text.trim();
    if (!msg) return;
    setSending(true);
    try {
      await onSend(msg);
      setText('');
    } catch (e) {
      uiAlert(t('Could not send'), e instanceof Error ? e.message : undefined);
    } finally { setSending(false); }
  };

  const attach = async () => {
    // System photo picker — no media permission needed (Play-policy compliant).
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const url = await uploadImage(result.assets[0]);
      await onSend(url); // sent as a chat message; rendered as an image on the other side
    } catch (e) {
      Alert.alert('Upload failed', e instanceof UploadError ? e.message : 'Try again.');
    } finally { setUploading(false); }
  };

  return (
    <View style={s.chatBox}>
      <Text style={s.chatTitle}>{t("Chat")}</Text>
      {msgs.length === 0 ? (
        <Text style={s.dim}>{t("Send a message to coordinate the pickup.")}</Text>
      ) : (
        <>
          {collapsedMsgs && (
            <Pressable onPress={() => setShowAllMsgs(true)} style={s.chatExpand} hitSlop={6}>
              <Text style={s.chatExpandText}>{t("Show earlier messages")} ({msgs.length - CHAT_PREVIEW})</Text>
            </Pressable>
          )}
          {shownMsgs.map((m, i) => (
            // Stable per-message key. Index keys made React reuse the memoised
            // bubble at a given slot when the array grew (new send / inbound DM /
            // FlatList clipping its card), which mis-reconciled and visually
            // duplicated the last bubble — and the constant tear-down/rebuild
            // thrashed layout while scrolling. ts is epoch *seconds* so two quick
            // messages can share one; disambiguate with dir + index.
            <ChatBubble key={m.id ?? `${m.ts}-${m.dir}-${i}`} text={m.text} dir={m.dir} onZoom={setViewerUri} />
          ))}
        </>
      )}
      {quickReplies && quickReplies.length > 0 && (
        <View style={[s.row, { marginTop: 8, gap: 6, flexWrap: 'wrap' }]}>
          {quickReplies.map((q) => (
            <Pressable
              key={q.label}
              disabled={sending}
              onPress={async () => {
                setSending(true);
                try { await onSend(q.text); }
                catch (e) { uiAlert(t('Could not send'), e instanceof Error ? e.message : undefined); }
                finally { setSending(false); }
              }}
              style={[s.quickReplyChip, sending && { opacity: 0.6 }]}
            >
              <Text style={s.quickReplyChipText} numberOfLines={1}>{q.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={[s.row, { marginTop: 8 }]}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          value={text}
          onChangeText={setText}
          placeholder={t("Message…")}
          placeholderTextColor={palette.placeholder}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable style={[s.chatAttach, uploading && { opacity: 0.6 }]} onPress={attach} disabled={uploading || recording} accessibilityRole="button" accessibilityLabel={t('Attach photo')}>
          {uploading ? <ActivityIndicator color="#93c5fd" /> : <Ionicons name="image" size={18} color="#93c5fd" />}
        </Pressable>
        <Pressable style={[s.chatAttach, recording && s.chatAttachRec]} onPress={toggleRecord} disabled={uploading} accessibilityRole="button" accessibilityLabel={recording ? t('Stop recording') : t('Record voice memo')}>
          <Ionicons name={recording ? 'stop' : 'mic'} size={18} color={recording ? '#fff' : '#93c5fd'} />
        </Pressable>
        <Pressable style={[s.pinBtn, sending && { opacity: 0.6 }]} onPress={send} disabled={sending} accessibilityRole="button" accessibilityLabel={t('Send message')}>
          {sending ? <ActivityIndicator color="white" /> : <Ionicons name="send" size={18} color="white" />}
        </Pressable>
      </View>
      <Modal visible={!!viewerUri} transparent animationType="fade" onRequestClose={() => setViewerUri(null)}>
        <View style={s.imgViewerBackdrop}>
          <ScrollView
            style={s.imgViewerScroll}
            contentContainerStyle={s.imgViewerContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            centerContent
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
          >
            {viewerUri ? <Image source={{ uri: viewerUri }} style={s.imgViewerImage} resizeMode="contain" /> : null}
          </ScrollView>
          <Pressable style={s.imgViewerClose} onPress={() => setViewerUri(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('Close image')}>
            <Ionicons name="close" size={26} color="#fff" />
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

export function CounterEditor({
  nego,
  onSend,
  onCancel,
}: {
  nego: Negotiation;
  onSend: (terms: ProposedTerms) => Promise<void>;
  onCancel: () => void;
}) {
  const isRide = nego.intent.content.schema.startsWith('rideshare');
  const existing = nego.terms ?? {};
  const existingWindow = existing.window;
  // Same market-derived default as RespondEditor: counters on unpriced threads
  // follow the intent's market currency, not a hardcoded one.
  const existingPay = parsePayment(existing.payment, currencyForMarket(nego.intent.content.market, 'USD'));
  const existingDur = existing.duration_minutes ?? 60;
  const [time, setTime] = useState<Date>(() =>
    existingWindow ? new Date(existingWindow.start * 1000) : defaultIntentTime(),
  );
  const [flexible, setFlexible] = useState(!existingWindow);
  const [payAmount, setPayAmount] = useState(existingPay.amount);
  const [payCurrency, setPayCurrency] = useState<Currency>(existingPay.currency);
  // Ride route is locked to the original request — display only, never edited.
  const ridePayload = nego.intent.content.payload as any;
  const routeFrom = String(existing.from ?? ridePayload?.from?.name ?? '');
  const routeTo = String(existing.to ?? ridePayload?.to?.name ?? '');
  const [location, setLocation] = useState(existing.location ?? '');
  const [service, setService] = useState(existing.service ?? '');
  const [durHours, setDurHours] = useState(Math.floor(existingDur / 60));
  const [durMinutes, setDurMinutes] = useState(existingDur % 60);
  const [note, setNote] = useState(existing.note ?? '');

  const send = async () => {
    const terms: ProposedTerms = {
      window: timeToWindow(time, flexible),
      payment: payAmount > 0 ? fmtPayment(payAmount, payCurrency) : undefined,
      note: note || undefined,
    };
    if (isRide) {
      // Route stays as the original request's — preserve it, don't let a counter change it.
      if (routeFrom) terms.from = routeFrom;
      if (routeTo) terms.to = routeTo;
    } else {
      if (location) terms.location = location;
      if (service) terms.service = service;
      const dur = durHours * 60 + durMinutes;
      if (dur > 0) terms.duration_minutes = dur;
    }
    try {
      await onSend(terms);
    } catch (e) {
      uiAlert(t('Could not send'), e instanceof Error ? e.message : undefined);
    }
  };

  return (
    <View style={s.counterBox}>
      <Text style={s.sectionTitle}>{t("Your counter-offer")}</Text>
      {isRide ? (
        <>
          {/* Route is fixed by the original request — you negotiate time/price,
              not where the ride goes. Shown read-only. */}
          <ReadonlyField label={t("From")} value={routeFrom} />
          <ReadonlyField label={t("To")} value={routeTo} />
        </>
      ) : (
        <>
          <Field label={t("Location")} value={location} onChange={setLocation} placeholder={t("leave blank to keep")} />
          <Field label={t("Service")} value={service} onChange={setService} placeholder={t("leave blank to keep")} />
          <DurationField hours={durHours} minutes={durMinutes} onChange={(h, m) => { setDurHours(h); setDurMinutes(m); }} />
        </>
      )}
      <TimeField time={time} onChange={setTime} flexible={flexible} onFlexible={setFlexible} />
      <PaymentField amount={payAmount} currency={payCurrency} onChange={(a, c) => { setPayAmount(a); setPayCurrency(c); }} />
      <Field label={t("Note")} value={note} onChange={setNote} placeholder={t("optional note")} />
      <View style={s.btnRow}>
        <Pressable style={s.btnAccept} onPress={send}><Text style={s.btnText}>{t("Send counter")}</Text></Pressable>
        <Pressable style={s.btnDecline} onPress={onCancel}><Text style={s.btnText}>{t("Cancel")}</Text></Pressable>
      </View>
    </View>
  );
}

/** Report-a-problem sheet: pick a reason, Submit → negative karma on the deal. */
export function ReportModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string) => void }) {
  const REASONS = [
    'Could not contact',
    'Incorrect phone number/vehicle details',
    'No-show / didn’t appear',
    'Cancelled last minute',
    'Not as agreed',
    'Other',
  ];
  const [reason, setReason] = useState(REASONS[0]);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.sortBackdrop} onPress={onClose}>
        <Pressable style={s.sortSheet} onPress={() => {}}>
          <Text style={s.sectionTitle}>{t("Report a problem")}</Text>
          <Text style={s.dim}>{t("Submitting records a negative karma (−1) tied to this deal.")}</Text>
          <View style={{ marginTop: 10 }}>
            {REASONS.map((r) => (
              <Pressable key={r} style={s.reportReason} onPress={() => setReason(r)}>
                <View style={[s.radio, reason === r && s.radioOn]}>
                  {reason === r && <View style={s.radioDot} />}
                </View>
                <Text style={s.reportReasonText}>{t(r)}</Text>
              </Pressable>
            ))}
          </View>
          <View style={s.btnRow}>
            <Pressable style={[s.btnDecline, { flex: 1 }]} onPress={onClose}>
              <Text style={s.btnText}>{t("Cancel")}</Text>
            </Pressable>
            <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={() => onSubmit(reason)}>
              <Text style={s.btnText}>{t("Submit")}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
