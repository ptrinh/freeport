import React, { useEffect, useRef, useState } from 'react';
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
import { translateMessage } from '../../concierge/translate';

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
  tick,
  quote,
  reactions,
  onLongPress,
  translateTo,
  msgKey,
}: {
  text: string;
  dir: 'in' | 'out';
  onZoom: (uri: string) => void;
  /** WhatsApp-style receipt on outbound bubbles (friend chat, receipts on). */
  tick?: 'sent' | 'delivered' | 'read' | null;
  /** Quoted snapshot of the message this replies to (friend chat). */
  quote?: string;
  /** Emoji reactions, one per side (friend chat). */
  reactions?: { emoji: string; dir: 'in' | 'out' }[];
  /** Friend chat: opens the react/reply action row. */
  onLongPress?: () => void;
  /** On-device auto-translate target for INBOUND text (null result = show as-is). */
  translateTo?: string;
  /** Stable id for the translation cache. */
  msgKey?: string;
}) {
  // Translated inbound text: main line = translation, original small + dim
  // below (the familiar chat-app pattern). Media/trip links are never touched.
  const plainText = !isAudioMsg(text) && !isImageMsg(text) && !isTripMsg(text);
  const [translated, setTranslated] = useState<string | null>(null);
  useEffect(() => {
    setTranslated(null);
    if (!translateTo || dir !== 'in' || !plainText) return;
    let cancelled = false;
    translateMessage(text, msgKey ?? text.slice(0, 40), translateTo)
      .then((tr) => { if (!cancelled) setTranslated(tr); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [text, translateTo, dir]);
  return (
    <Pressable onLongPress={onLongPress} delayLongPress={350} disabled={!onLongPress}>
    <View style={[s.chatBubble, dir === 'out' ? s.chatOut : s.chatIn]}>
      {quote ? (
        <View style={{ borderStartWidth: 3, borderStartColor: dir === 'out' ? 'rgba(245,247,250,0.6)' : palette.accent, paddingStart: 8, marginBottom: 4, opacity: 0.85 }}>
          <Text style={[s.chatBubbleText, dir === 'out' ? s.chatTextOut : s.chatTextIn, { fontSize: 12 }]} numberOfLines={2}>{quote}</Text>
        </View>
      ) : null}
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
        : translated
        ? <>
            <Text style={[s.chatBubbleText, dir === 'out' ? s.chatTextOut : s.chatTextIn]}>{translated}</Text>
            <Text style={[s.chatBubbleText, dir === 'out' ? s.chatTextOut : s.chatTextIn, { fontSize: 11, opacity: 0.55, marginTop: 3 }]}>{text}</Text>
          </>
        : <Text style={[s.chatBubbleText, dir === 'out' ? s.chatTextOut : s.chatTextIn]}>{text}</Text>}
      {dir === 'out' && tick ? (
        <View style={{ alignSelf: 'flex-end', marginTop: 2 }}>
          <Ionicons
            name={tick === 'sent' ? 'checkmark' : 'checkmark-done'}
            size={13}
            color={tick === 'read' ? '#4ade80' : 'rgba(245,247,250,0.75)'}
          />
        </View>
      ) : null}
    </View>
    {reactions && reactions.length > 0 ? (
      <View style={{ flexDirection: 'row', gap: 4, alignSelf: dir === 'out' ? 'flex-end' : 'flex-start', marginTop: -6, marginBottom: 4, marginHorizontal: 6 }}>
        {reactions.map((r) => (
          <Text key={r.dir} style={{ fontSize: 13, backgroundColor: palette.card, borderRadius: 10, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden' }}>{r.emoji}</Text>
        ))}
      </View>
    ) : null}
    </Pressable>
  );
});

/** Reaction palette shown on long-press (friend chat). */
const REACT_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

/**
 * The transport-agnostic chat surface: message list (collapsed preview),
 * quick replies, text/photo/voice input, image viewer. Used by both the deal
 * chat (ChatThread, bound to a Negotiation) and the friend chat (bound to a
 * Conversation) — keep it free of either model.
 */
export function ChatCore({ messages, onSend, quickReplies, emptyHint, tickFor, title, onReact, translateTo, fullHeight = false }: {
  messages: { dir: 'in' | 'out'; text: string; ts: number; id?: string; quote?: string; reactions?: { emoji: string; dir: 'in' | 'out' }[] }[];
  onSend: (text: string, opts?: { replyTo?: string; quote?: string }) => Promise<void>;
  /** Grab-style one-tap replies rendered above the input ("I am here ✅", …). */
  quickReplies?: { label: string; text: string }[];
  emptyHint?: string;
  /** Receipt tick for an outbound message ts (friend chat with receipts on). */
  tickFor?: (ts: number) => 'sent' | 'delivered' | 'read';
  /** Optional heading inside the box (the deal chat shows "Chat"). */
  title?: string;
  /** Friend chat: enables long-press react + reply (targets need message ids). */
  onReact?: (targetId: string, emoji: string) => void;
  /** On-device auto-translate target language for inbound messages. */
  translateTo?: string;
  /** Full-screen layout (friend chat): messages in their own flex-1 scroll
   *  area pinned to the bottom, composer fixed at the screen's bottom edge —
   *  long conversations must never push the input off-screen. */
  fullHeight?: boolean;
}) {
  const [text, setText] = useState('');
  // Long-press action row target + the message being replied to.
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; quote: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recording, setRecording] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [showAllMsgs, setShowAllMsgs] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const msgs = messages;
  // Deal-card mode keeps the thread compact (tap to reveal); full-screen mode
  // shows everything — the list scrolls, the composer never moves.
  const CHAT_PREVIEW = 5;
  const collapsedMsgs = !fullHeight && !showAllMsgs && msgs.length > CHAT_PREVIEW;
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
      await onSend(msg, replyingTo ? { replyTo: replyingTo.id, quote: replyingTo.quote } : undefined);
      setText('');
      setReplyingTo(null);
    } catch (e) {
      uiAlert(t('Could not send'), e instanceof Error ? e.message : undefined);
    } finally {
      setSending(false);
      // Keep the cursor in the box so the next message needs no extra tap.
      inputRef.current?.focus();
    }
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

  const messagesBlock = (
    <>
      {msgs.length === 0 ? (
        <Text style={s.dim}>{emptyHint ?? t("Send a message to coordinate the pickup.")}</Text>
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
            <React.Fragment key={m.id ?? `${m.ts}-${m.dir}-${i}`}>
              <ChatBubble
                text={m.text} dir={m.dir} onZoom={setViewerUri}
                tick={m.dir === 'out' ? tickFor?.(m.ts) : null}
                quote={m.quote} reactions={m.reactions}
                onLongPress={onReact && m.id ? () => setActionsFor(actionsFor === m.id ? null : m.id!) : undefined}
                translateTo={translateTo}
                msgKey={m.id ?? `${m.ts}-${m.dir}`}
              />
              {actionsFor === m.id && onReact && m.id ? (
                <View style={[s.row, { gap: 6, alignSelf: m.dir === 'out' ? 'flex-end' : 'flex-start', marginBottom: 6, flexWrap: 'wrap' }]}>
                  {REACT_EMOJIS.map((e) => (
                    <Pressable key={e} onPress={() => { onReact(m.id!, e); setActionsFor(null); }} hitSlop={4}
                      style={{ backgroundColor: palette.card, borderRadius: 14, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 6, paddingVertical: 3 }}>
                      <Text style={{ fontSize: 16 }}>{e}</Text>
                    </Pressable>
                  ))}
                  <Pressable onPress={() => { setReplyingTo({ id: m.id!, quote: m.text.slice(0, 80) }); setActionsFor(null); }} hitSlop={4}
                    style={{ backgroundColor: palette.card, borderRadius: 14, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 8, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="arrow-undo-outline" size={13} color={palette.text2} />
                    <Text style={{ color: palette.text2, fontSize: 12 }}>{t('Reply')}</Text>
                  </Pressable>
                </View>
              ) : null}
            </React.Fragment>
          ))}
        </>
      )}
    </>
  );

  const composer = (
    <>
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
      {replyingTo ? (
        <View style={[s.row, { marginTop: 8, backgroundColor: palette.card, borderRadius: 8, borderWidth: 1, borderColor: palette.border, padding: 6, gap: 6 }]}>
          <Ionicons name="arrow-undo" size={14} color={palette.accent} />
          <Text style={[s.dim, { flex: 1 }]} numberOfLines={1}>{replyingTo.quote}</Text>
          <Pressable onPress={() => setReplyingTo(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Cancel')}>
            <Ionicons name="close-circle" size={16} color={palette.dim} />
          </Pressable>
        </View>
      ) : null}
      <View style={[s.row, { marginTop: 8 }]}>
        <TextInput
          ref={inputRef}
          style={[s.input, { flex: 1 }]}
          value={text}
          onChangeText={setText}
          placeholder={t("Message…")}
          placeholderTextColor={palette.placeholder}
          onSubmitEditing={send}
          returnKeyType="send"
          blurOnSubmit={false}
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
    </>
  );

  const viewer = (
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
  );

  if (fullHeight) {
    return (
      <View style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 12, flexGrow: 1, justifyContent: 'flex-end' }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {messagesBlock}
        </ScrollView>
        <View style={{ paddingHorizontal: 12, paddingBottom: 10 }}>{composer}</View>
        {viewer}
      </View>
    );
  }

  return (
    <View style={s.chatBox}>
      {title ? <Text style={s.chatTitle}>{title}</Text> : null}
      {messagesBlock}
      {composer}
      {viewer}
    </View>
  );
}

/** Free-text chat for a confirmed deal — the Negotiation-bound wrapper. */
export function ChatThread({ nego, onSend, quickReplies, translateTo }: {
  nego: Negotiation;
  onSend: (text: string) => Promise<void>;
  quickReplies?: { label: string; text: string }[];
  translateTo?: string;
}) {
  return <ChatCore title={t('Chat')} messages={nego.messages ?? []} onSend={onSend} quickReplies={quickReplies} translateTo={translateTo} />;
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
