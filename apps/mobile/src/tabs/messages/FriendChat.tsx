/**
 * Friend chat (experimental) — the deal-independent 1:1 chat UI:
 *   - FriendChatSection: WhatsApp-style rows (avatar · name · last message ·
 *     time) + pending invite requests with Accept/Reject, shown at the top of
 *     the Messages tab when the Chat experiment is on.
 *   - FriendChatModal: the conversation screen (reuses ChatCore) with
 *     archive + block actions and last-seen in the header.
 *   - InviteSheet: your shareable QR + link (/i/<code>) with copy/share
 *     and a "Generate new invite link" rotation.
 *   - ChatFab: the floating + button that opens the InviteSheet.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { t, tn } from '../../i18n';
import { MobileClient } from '../../client';
import { type Conversation, unreadCount, tickFor, lastMessageTs } from '../../conversations';
import { npubFromHex } from '../../identity';
import { defaultAvatarUrl } from '../../profile';
import { qrDataUrl } from '../../wallet/qr';
import { webBase } from '../../webBase';
import { fmtClock } from '../../ui/format';
import { s, palette } from '../../ui/theme';
import { CachedImage } from '../../ui/cachedImage';
import { confirmAsync } from '../../ui/alerts';
import { PeerLinkIcon } from '../../ui/peerLink';
import { copyText, clipboardAvailable } from '../../ui/clipboard';
import { parseInviteLink } from '@freeport/protocol';
import { ScanSheet, scanSupported } from '../wallet/ScanSheet';
import { ChatCore, SAFE_ATTACH_EXTENSIONS, isAudioMsg, isImageMsg, isTripMsg, isDocMsg, isLocationMsg, locationMsg, docMsgName } from './Chat';
import { matchesKeywords } from '../../browseFilter';
import { DraggableFab } from '../../ui/DraggableFab';
import { SwipeableRow } from '../../ui/SwipeableRow';
import { uploadFile, UploadError } from '../../upload';
import { getCurrentCoords } from '../../geo';

/** Display name: their invite/accept name → kind:0 profile → npub prefix. */
export function chatDisplayName(conv: Conversation, client: MobileClient | null): string {
  const prof = client?.profiles.get(conv.peer);
  return (prof?.name || conv.name || npubFromHex(conv.peer).slice(0, 12) + '…').trim();
}

function avatarUri(conv: Conversation, client: MobileClient | null): string {
  return client?.profiles.get(conv.peer)?.picture || defaultAvatarUrl(npubFromHex(conv.peer));
}

/** Row timestamp: clock for today, short date otherwise. */
function fmtRowTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return fmtClock(d);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** "npub1e…6yq8" — enough to spot an imposter reusing a friend's name. */
function shortNpub(peerHex: string): string {
  const np = npubFromHex(peerHex);
  return np.slice(0, 6) + '…' + np.slice(-4);
}

function lastLine(conv: Conversation): string {
  const m = conv.messages[conv.messages.length - 1];
  if (!m) return t('Say hello 👋');
  const prefix = m.dir === 'out' ? t('You') + ': ' : '';
  // Media messages are URLs on the wire — show a friendly label, not the link.
  const body = isAudioMsg(m.text) ? '🎙 ' + t('Voice memo')
    : isImageMsg(m.text) ? '📷 ' + t('Photo')
    : isTripMsg(m.text) ? '📍 ' + t('Live location')
    : isLocationMsg(m.text) ? '📍 ' + t('Shared location')
    : isDocMsg(m.text) ? '📄 ' + docMsgName(m.text)
    : m.text;
  return prefix + (body.length > 60 ? body.slice(0, 57) + '…' : body);
}

function Avatar({ uri, size = 44 }: { uri: string; size?: number }) {
  return <CachedImage uri={uri} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.chipBg }} recyclingKey={uri} />;
}

// ─── Conversation list ───────────────────────────────────────────────────────

/** Bottom-sheet menu row — shared look with the in-chat burger menu. */
function sheetRow(icon: React.ComponentProps<typeof Ionicons>['name'], label: string, onPress: () => void, danger = false) {
  return (
    <Pressable
      key={label}
      style={[s.row, { paddingVertical: 12, gap: 12, alignItems: 'center' }]}
      onPress={onPress}
      accessibilityRole="button" accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={danger ? palette.danger : palette.text2} />
      <Text style={{ color: danger ? palette.danger : palette.text, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}

export function FriendChatSection({ client, conversations, blockedPubkeys, onOpen, onAcceptInvite, chatEnabled = true, archivedView = false, filterKeyword = '', onToggleBlock }: {
  client: MobileClient | null;
  conversations: Conversation[];
  blockedPubkeys: Set<string>;
  onOpen: (peer: string) => void;
  /** Accepting an invite while the Chat experiment is off also enables it
   *  (same consent model as opening an invite link). */
  onAcceptInvite?: (peer: string) => void;
  /** When the experiment is off, only PENDING requests render — the rest of
   *  the chat UI stays behind the toggle. */
  chatEnabled?: boolean;
  /** Archived tab: show ONLY archived chats (no pending requests). */
  archivedView?: boolean;
  /** Comma-separated keyword filter (matches name + message text). */
  filterKeyword?: string;
  /** Enables Block/Unblock in the swipe "More" sheet. */
  onToggleBlock?: (pubkey: string) => void;
}) {
  // Swipe state: at most one row open (WhatsApp behavior) + the "More" sheet.
  const openRowClose = useRef<(() => void) | null>(null);
  const rowOpened = (close: () => void) => {
    if (openRowClose.current && openRowClose.current !== close) openRowClose.current();
    openRowClose.current = close;
  };
  const [morePeer, setMorePeer] = useState<string | null>(null);
  const deleteConv = async (peer: string) => {
    const ok = await confirmAsync(
      t('Delete conversation?'),
      t('Removes this chat and its messages from this device only. If they message or invite you again, a new request appears.'),
      t('Delete'),
    );
    if (ok) client?.chatDeleteConversation(peer);
  };
  // Blocked peers: hide their PENDING invites (spam), but keep an already-
  // active chat visible — the unblock action lives in its header.
  const kw = filterKeyword.trim().toLowerCase();
  const convText = (c: Conversation) =>
    (chatDisplayName(c, client) + ' ' + c.messages.map((m) => m.text).join(' ')).toLowerCase();
  const visible = conversations.filter((c) =>
    (c.state === 'active' || c.state === 'pending_out' || (c.state === 'pending_in' && !blockedPubkeys.has(c.peer)))
    && (!kw || matchesKeywords(convText(c), kw)));
  if (visible.length === 0) return null;
  const pending = archivedView ? [] : visible.filter((c) => c.state === 'pending_in').sort((a, b) => lastMessageTs(b) - lastMessageTs(a));
  // Experiment off: incoming requests must still be visible/answerable —
  // otherwise an invite arrives into a hidden UI (user report).
  const live = chatEnabled
    ? visible.filter((c) => c.state !== 'pending_in' && (archivedView ? c.archived : !c.archived)).sort((a, b) => lastMessageTs(b) - lastMessageTs(a))
    : [];
  if (!chatEnabled && pending.length === 0) return null;
  if (archivedView && live.length === 0) return null;

  return (
    <View style={{ marginHorizontal: 12, marginTop: 8 }}>
      <Text style={[s.sectionTitle, { marginBottom: 4 }]}>{t('Chats')}</Text>
      {pending.map((c) => (
        <View key={c.peer} style={[s.card, s.cardHighlight, { marginHorizontal: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
          <Avatar uri={avatarUri(c, client)} />
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle} numberOfLines={1}>{chatDisplayName(c, client)}</Text>
            <Text style={[s.dim, { fontSize: 10 }]} numberOfLines={1}>{shortNpub(c.peer)}</Text>
            <Text style={s.dim}>{t('wants to chat with you')}</Text>
          </View>
          <Pressable
            style={[s.btnAccept, { paddingHorizontal: 14 }]}
            onPress={() => (onAcceptInvite ? onAcceptInvite(c.peer) : client?.chatAccept(c.peer).catch(() => {}))}
            accessibilityRole="button" accessibilityLabel={t('Accept')}
          >
            <Text style={s.btnText}>{t('Accept')}</Text>
          </Pressable>
          <Pressable
            style={[s.btnDecline, { paddingHorizontal: 14 }]}
            onPress={() => client?.chatReject(c.peer).catch(() => {})}
            accessibilityRole="button" accessibilityLabel={t('Reject')}
          >
            <Text style={s.btnText}>{t('Reject')}</Text>
          </Pressable>
        </View>
      ))}
      {live.map((c) => {
        const unread = unreadCount(c);
        return (
          <SwipeableRow
            key={c.peer}
            onOpenRow={rowOpened}
            leftAction={{ icon: 'trash-outline', label: t('Delete'), color: '#dc2626', onPress: () => { deleteConv(c.peer); } }}
            rightActions={[
              {
                icon: c.archived ? 'archive' : 'archive-outline',
                label: c.archived ? t('Unarchive') : t('Archive'),
                color: '#2563eb',
                onPress: () => client?.chatSetArchived(c.peer, !c.archived),
              },
              { icon: 'ellipsis-horizontal', label: t('More'), color: '#6b7280', onPress: () => setMorePeer(c.peer) },
            ]}
          >
          <Pressable style={[s.card, { marginHorizontal: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => onOpen(c.peer)}>
            <Avatar uri={avatarUri(c, client)} />
            <View style={{ flex: 1 }}>
              <View style={[s.row, { alignItems: 'baseline', gap: 6 }]}>
                <Text style={[s.cardTitle, { flexShrink: 1 }]} numberOfLines={1}>{chatDisplayName(c, client)}</Text>
                <Text style={[s.dim, { fontSize: 10 }]} numberOfLines={1}>{shortNpub(c.peer)}</Text>
              </View>
              <Text style={s.dim} numberOfLines={1}>
                {c.state === 'pending_out' ? t('Invite sent — waiting for accept') : lastLine(c)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                {c.muted && <Ionicons name="notifications-off-outline" size={13} color={palette.dim} accessibilityLabel={t('Muted')} />}
                <Text style={[s.dim, { fontSize: 11 }]}>{fmtRowTime(c.messages[c.messages.length - 1]?.ts ?? c.updatedAt)}</Text>
              </View>
              {unread > 0 && (
                <View style={s.badge}><Text style={s.badgeText}>{unread}</Text></View>
              )}
            </View>
          </Pressable>
          </SwipeableRow>
        );
      })}
      {(() => {
        // "More" sheet from a swiped row — the same actions as the in-chat
        // burger menu, minus the ones that need the thread open.
        const c = morePeer ? conversations.find((x) => x.peer === morePeer) : null;
        if (!c) return null;
        const closeSheet = () => setMorePeer(null);
        const ttlLabel = c.disappearTtl ? (TTL_LABELS[c.disappearTtl] ?? '24h') : t('Off');
        const isBlocked = blockedPubkeys.has(c.peer);
        return (
          <Modal visible transparent animationType="fade" onRequestClose={closeSheet}>
            <Pressable style={s.sortBackdrop} onPress={closeSheet}>
              <Pressable style={s.sortSheet} onPress={() => {}}>
                {sheetRow('chatbubble-ellipses-outline', t('Open chat'), () => { closeSheet(); onOpen(c.peer); })}
                {c.state === 'active'
                  ? sheetRow('timer-outline', `${t('Disappearing messages')}: ${ttlLabel}`, () => {
                      const cur = TTL_STEPS.indexOf(c.disappearTtl ?? 0);
                      client?.chatSetTtl(c.peer, TTL_STEPS[(cur + 1) % TTL_STEPS.length]).catch(() => {});
                    })
                  : null}
                {sheetRow(c.muted ? 'notifications-outline' : 'notifications-off-outline', c.muted ? t('Unmute') : t('Mute'), () => {
                  closeSheet();
                  client?.chatSetMuted(c.peer, !c.muted);
                })}
                {sheetRow(c.archived ? 'archive' : 'archive-outline', c.archived ? t('Unarchive chat') : t('Archive chat'), () => {
                  closeSheet();
                  client?.chatSetArchived(c.peer, !c.archived);
                })}
                {c.messages.length > 0
                  ? sheetRow('remove-circle-outline', t('Clear conversation'), async () => {
                      closeSheet();
                      const ok = await confirmAsync(t('Clear conversation?'), t('Removes all messages on this device only — the other person keeps their copy.'), t('Clear'));
                      if (ok) client?.chatClearMessages(c.peer);
                    })
                  : null}
                {sheetRow('trash-outline', t('Delete conversation'), () => { closeSheet(); deleteConv(c.peer); }, true)}
                {onToggleBlock
                  ? sheetRow(isBlocked ? 'ban' : 'ban-outline', isBlocked ? t('Unblock') : t('Block this person'), async () => {
                      closeSheet();
                      if (!isBlocked) {
                        const ok = await confirmAsync(t('Block this person?'), t('You will not receive any more messages from them.'), t('Block'));
                        if (!ok) return;
                      }
                      onToggleBlock(c.peer);
                    }, !isBlocked)
                  : null}
              </Pressable>
            </Pressable>
          </Modal>
        );
      })()}
    </View>
  );
}

// ─── Conversation screen ─────────────────────────────────────────────────────

/** Disappearing-timer cycle: off → 5m → 1h → 24h → 7d → 4w → off. */
const TTL_STEPS = [0, 5 * 60, 3600, 24 * 3600, 7 * 24 * 3600, 28 * 24 * 3600];
const TTL_LABELS: Record<number, string> = { 0: '', [5 * 60]: '5m', [3600]: '1h', [24 * 3600]: '24h', [7 * 24 * 3600]: '7d', [28 * 24 * 3600]: '4w' };

function disappearCaption(ttl: number): string {
  if (ttl >= 28 * 24 * 3600) return t('New messages disappear after 4 weeks');
  if (ttl >= 7 * 24 * 3600) return t('New messages disappear after 7 days');
  if (ttl >= 24 * 3600) return t('New messages disappear after 24 hours');
  if (ttl >= 3600) return t('New messages disappear after 1 hour');
  return t('New messages disappear after 5 minutes');
}

export function FriendChatModal({ client, conv, receiptsOn, blocked, onToggleBlock, onClose, onStartCall, walletEnabled = false, onPayFriend, translateTo }: {
  client: MobileClient | null;
  conv: Conversation;
  /** Receipts toggle (Settings → Chat) — reciprocal: off = no ticks shown either. */
  receiptsOn: boolean;
  blocked: boolean;
  onToggleBlock: (pubkey: string) => void;
  onClose: () => void;
  /** Present when calls are enabled + supported and the conversation is active. */
  onStartCall?: (peer: string, video: boolean) => void;
  /** In-chat payments: ⚡ opens the wallet Send flow prefilled for this friend. */
  walletEnabled?: boolean;
  onPayFriend?: (peer: string, payAddress: string) => void;
  /** On-device auto-translate target for inbound messages. */
  translateTo?: string;
}) {
  // Full-screen <Modal> renders outside the app's SafeAreaProvider padding, so
  // apply the top inset here or the header sits under the notch/status bar and
  // becomes untappable on iOS (user report).
  const insets = useSafeAreaInsets();
  // Opening the thread reads it — advances the local mark and (receipts on)
  // tells the peer. Re-run as new messages arrive while the thread is open.
  useEffect(() => {
    client?.markChatRead(conv.peer);
  }, [client, conv.peer, conv.messages.length]);

  // Presence: ping on open + every 2 min while the thread stays open (gated
  // on the "Show last seen" toggle inside the client), and tick every 30s so
  // the peer's "Online" state can expire visually.
  const [, presenceTick] = useState(0);
  useEffect(() => {
    client?.chatPresencePing(conv.peer);
    const ping = setInterval(() => client?.chatPresencePing(conv.peer), 120_000);
    const tick = setInterval(() => presenceTick((n) => n + 1), 30_000);
    return () => { clearInterval(ping); clearInterval(tick); };
  }, [client, conv.peer]);

  const lastSeen = conv.theirLastSeen;
  const online = !!lastSeen && Date.now() / 1000 - lastSeen < 180;
  const [menuOpen, setMenuOpen] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  /** File attachments: allowlisted extensions only (see SAFE_ATTACH_EXTENSIONS
   *  — no js/html/svg/executables), uploaded like voice memos, sent as a URL
   *  message that renders as a file chip. */
  const attachFile = async () => {
    setMenuOpen(false);
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    const ext = (a.name?.split('.').pop() ?? '').toLowerCase();
    if (!SAFE_ATTACH_EXTENSIONS.includes(ext)) {
      Alert.alert(t('Attach file'), t('This file type is not allowed for safety reasons.'));
      return;
    }
    setAttaching(true);
    try {
      const url = await uploadFile((a as { file?: File }).file ?? a.uri, a.name ?? `file.${ext}`, a.mimeType ?? 'application/octet-stream');
      await client?.chatSend(conv.peer, url);
    } catch (e) {
      Alert.alert('Upload failed', e instanceof UploadError ? e.message : 'Try again.');
    } finally {
      setAttaching(false);
    }
  };

  /** One-shot current position → a plain maps pin message. */
  const shareLocation = async () => {
    setMenuOpen(false);
    const pos = await getCurrentCoords();
    if (!pos) {
      Alert.alert(t('Share current location'), t('Could not get your location — check the location permission.'));
      return;
    }
    await client?.chatSend(conv.peer, locationMsg(pos.latitude, pos.longitude)).catch(() => {});
  };

  const ttlLabel = conv.disappearTtl ? (TTL_LABELS[conv.disappearTtl] ?? '24h') : t('Off');
  const menuRow = (icon: React.ComponentProps<typeof Ionicons>['name'], label: string, onPress: () => void, danger = false) => (
    <Pressable
      key={label}
      style={[s.row, { paddingVertical: 12, gap: 12, alignItems: 'center' }]}
      onPress={onPress}
      accessibilityRole="button" accessibilityLabel={label}
    >
      <Ionicons name={icon} size={20} color={danger ? palette.danger : palette.text2} />
      <Text style={{ color: danger ? palette.danger : palette.text, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onClose}>
      {/* Same shell + centered phone-width column as the main app — RN-web
          modals portal outside #freeport-shell, so without this the content
          shrink-wrapped narrow and lost the side backdrop (user report). */}
      <View nativeID="freeport-shell-modal" style={s.appShell}>
        <View style={[s.root, { paddingTop: insets.top }]}>
        {/* Compact header: name + tight presence line, ONLY call/video icons
            inline, everything else behind the burger menu (user request). */}
        <View style={[s.row, { paddingHorizontal: 12, paddingVertical: 7, gap: 8, borderBottomWidth: 1, borderBottomColor: palette.border, alignItems: 'center' }]}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Back')}>
            <Ionicons name="arrow-back" size={22} color={palette.text} />
          </Pressable>
          <Avatar uri={avatarUri(conv, client)} size={32} />
          <View style={{ flexShrink: 1 }}>
            <View style={[s.row, { alignItems: 'baseline', gap: 6 }]}>
              <Text style={[s.cardTitle, { flexShrink: 1 }]} numberOfLines={1}>{chatDisplayName(conv, client)}</Text>
              <PeerLinkIcon link={client?.profiles.get(conv.peer)?.link} />
              <Text style={[s.dim, { fontSize: 10 }]} numberOfLines={1}>{shortNpub(conv.peer)}</Text>
            </View>
            {online ? (
              <View style={[s.row, { gap: 3, alignItems: 'center', marginTop: 1 }]}>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: '#22c55e' }} />
                <Text style={{ fontSize: 10, color: '#22c55e' }}>{t('Online')}</Text>
              </View>
            ) : lastSeen ? (
              <Text style={[s.dim, { fontSize: 10, marginTop: 1 }]}>{t('Last seen {time}', { time: fmtRowTime(lastSeen) })}</Text>
            ) : null}
          </View>
          {/* Icons pinned RIGHT; the back/avatar/name group stays left. */}
          <View style={[s.row, { gap: 16, alignItems: 'center', marginStart: 'auto' }]}>
            {onStartCall && conv.state === 'active' && !blocked ? (
              <>
                <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Voice call')} onPress={() => onStartCall(conv.peer, false)}>
                  <Ionicons name="call-outline" size={20} color={palette.text2} />
                </Pressable>
                <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Video call')} onPress={() => onStartCall(conv.peer, true)}>
                  <Ionicons name="videocam-outline" size={20} color={palette.text2} />
                </Pressable>
              </>
            ) : null}
            <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Menu')} onPress={() => setMenuOpen(true)}>
              <Ionicons name="ellipsis-vertical" size={20} color={palette.text2} />
            </Pressable>
          </View>
        </View>
        {searchOpen ? (
          <View style={[s.row, { paddingHorizontal: 12, paddingVertical: 6, gap: 8, alignItems: 'center', borderBottomWidth: 1, borderBottomColor: palette.border }]}>
            <Ionicons name="search" size={16} color={palette.dim} />
            <TextInput
              style={[s.input, { flex: 1, paddingVertical: 6 }]}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus
              placeholder={t('Search')}
              placeholderTextColor={palette.placeholder}
              autoCapitalize="none"
            />
            <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Close')} onPress={() => { setSearchOpen(false); setSearchQuery(''); }}>
              <Ionicons name="close" size={18} color={palette.text2} />
            </Pressable>
          </View>
        ) : null}
        {attaching ? (
          <View style={[s.row, { justifyContent: 'center', paddingVertical: 6, gap: 8 }]}>
            <ActivityIndicator color={palette.accent} />
            <Text style={s.dim}>{t('Attach file')}…</Text>
          </View>
        ) : null}
        {menuOpen && (
          <Modal visible transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
            <Pressable style={s.sortBackdrop} onPress={() => setMenuOpen(false)}>
              <Pressable style={s.sortSheet} onPress={() => {}}>
                {menuRow('search-outline', t('Search'), () => { setMenuOpen(false); setSearchOpen(true); })}
                {conv.state === 'active' && !blocked ? menuRow('add-circle-outline', t('Attach file'), attachFile) : null}
                {conv.state === 'active' && !blocked ? menuRow('location-outline', t('Share current location'), shareLocation) : null}
                {walletEnabled && onPayFriend && conv.theirPay && conv.state === 'active' && !blocked
                  ? menuRow('flash-outline', t('Send payment'), () => { setMenuOpen(false); onPayFriend(conv.peer, conv.theirPay!); })
                  : null}
                {conv.state === 'active'
                  ? menuRow('timer-outline', `${t('Disappearing messages')}: ${ttlLabel}`, () => {
                      const cur = TTL_STEPS.indexOf(conv.disappearTtl ?? 0);
                      client?.chatSetTtl(conv.peer, TTL_STEPS[(cur + 1) % TTL_STEPS.length]).catch(() => {});
                    })
                  : null}
                {menuRow(conv.muted ? 'notifications-outline' : 'notifications-off-outline', conv.muted ? t('Unmute') : t('Mute'), () => {
                  setMenuOpen(false);
                  client?.chatSetMuted(conv.peer, !conv.muted);
                })}
                {menuRow(conv.archived ? 'archive' : 'archive-outline', conv.archived ? t('Unarchive chat') : t('Archive chat'), () => {
                  setMenuOpen(false);
                  client?.chatSetArchived(conv.peer, !conv.archived);
                  onClose();
                })}
                {conv.messages.length > 0
                  ? menuRow('remove-circle-outline', t('Clear conversation'), async () => {
                      setMenuOpen(false);
                      const ok = await confirmAsync(t('Clear conversation?'), t('Removes all messages on this device only — the other person keeps their copy.'), t('Clear'));
                      if (ok) client?.chatClearMessages(conv.peer);
                    })
                  : null}
                {menuRow('trash-outline', t('Delete conversation'), async () => {
                  setMenuOpen(false);
                  const ok = await confirmAsync(t('Delete conversation?'), t('Removes this chat and its messages from this device only. If they message or invite you again, a new request appears.'), t('Delete'));
                  if (!ok) return;
                  client?.chatDeleteConversation(conv.peer);
                  onClose();
                }, true)}
                {menuRow(blocked ? 'ban' : 'ban-outline', blocked ? t('Unblock') : t('Block this person'), async () => {
                  setMenuOpen(false);
                  if (!blocked) {
                    const ok = await confirmAsync(t('Block this person?'), t('You will not receive any more messages from them.'), t('Block'));
                    if (!ok) return;
                  }
                  onToggleBlock(conv.peer);
                  if (!blocked) onClose();
                }, !blocked)}
              </Pressable>
            </Pressable>
          </Modal>
        )}
        {/* Full-height thread: messages scroll in their own area, the
            composer stays pinned to the bottom, and the KeyboardAvoidingView
            lifts it above the keyboard (user report: long chats pushed the
            input off-screen; the keyboard covered it). */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          {blocked && (
            <Text style={[s.dim, { margin: 12, marginBottom: 0 }]}>{t('You blocked this person — they cannot message you.')}</Text>
          )}
          {conv.disappearTtl ? (
            <Text style={[s.dim, { marginTop: 8, textAlign: 'center' }]}>
              {'⏱ ' + disappearCaption(conv.disappearTtl)}
            </Text>
          ) : null}
          <ChatCore
            fullHeight
            messages={conv.messages}
            onSend={(txt, opts) => client?.chatSend(conv.peer, txt, opts) ?? Promise.resolve()}
            emptyHint={t('Say hello 👋')}
            tickFor={receiptsOn ? (ts) => tickFor(conv, ts) : undefined}
            onReact={(id, emoji) => client?.chatReact(conv.peer, id, emoji).catch(() => {})}
            translateTo={translateTo}
            filterQuery={searchOpen ? searchQuery : ''}
            onCallBack={onStartCall && conv.state === 'active' && !blocked ? (video) => onStartCall(conv.peer, video) : undefined}
          />
        </KeyboardAvoidingView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Invite popup + FAB ──────────────────────────────────────────────────────

export function InviteSheet({ client, myName, onClose, onScanCode }: {
  client: MobileClient | null;
  myName?: string;
  onClose: () => void;
  /** A friend's invite code, scanned from their QR — routed to the same
   *  resolve/consent flow as an opened /i/<code> link. */
  onScanCode?: (code: string) => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState('');
  // Scan button only where a camera path exists (web getUserMedia, or a native
  // binary that linked expo-camera). Same probe the wallet Scan uses.
  const [canScan, setCanScan] = useState(false);
  useEffect(() => { scanSupported().then(setCanScan).catch(() => {}); }, []);
  const onScanned = (value: string) => {
    const scanned = parseInviteLink(value);
    if (!scanned) { setScanErr(t("That QR isn't a Freeport invite.")); return; }
    if (scanned === code) { setScanErr(t("That's your own invite QR.")); return; }
    setScanning(false);
    onClose();
    onScanCode?.(scanned);
  };

  useEffect(() => {
    let cancelled = false;
    client?.publishChatInvite(myName)
      .then((r) => { if (!cancelled) setCode(r.code); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [client]);

  // Path form (…/i/<code>) so an installed native app can deep-link it via
  // Universal Links / App Links; it still opens the web app when there's no app.
  const link = code ? `${webBase()}/i/${code}` : '';
  // Do we have a real clipboard (web, or a binary that pre-linked expo-clipboard)?
  // Until we know, assume yes on web / no on native so the label starts honest.
  const [canCopy, setCanCopy] = useState(Platform.OS === 'web');
  useEffect(() => { clipboardAvailable().then(setCanCopy).catch(() => {}); }, []);
  const copy = async () => {
    if (!link) return;
    const wrote = await copyText(link, () => {
      // No clipboard module → OS share sheet. It must NOT be presented while
      // this <Modal> is on screen: on iOS that wedges touch handling and the
      // whole app freezes (user report). Dismiss first, then share.
      onClose();
      setTimeout(() => { Share.share({ message: link }).catch(() => {}); }, 350);
    });
    if (wrote) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };
  const rotate = async () => {
    if (!client || busy) return;
    const ok = await confirmAsync(
      t('Generate new invite link?'),
      t('Your current link and QR stop working. Anyone you already chat with is unaffected.'),
      t('Generate'),
    );
    if (!ok) return;
    setBusy(true);
    setCode(null);
    try { setCode((await client.rotateChatInvite(myName)).code); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.sortBackdrop} onPress={onClose}>
        <Pressable style={s.sortSheet} onPress={() => {}}>
          <Text style={s.sectionTitle}>{t('Add a friend')}</Text>
          <Text style={s.dim}>{t('Share this QR or link. When they open it, they can send you a chat invite.')}</Text>
          {code ? (
            <>
              <View style={{ alignItems: 'center', marginVertical: 14 }}>
                <Image source={{ uri: qrDataUrl(link) }} style={{ width: 200, height: 200, borderRadius: 8 }} />
              </View>
              <Text style={[s.dim, { textAlign: 'center' }]} numberOfLines={1}>{link}</Text>
              <View style={[s.btnRow, { marginTop: 12 }]}>
                <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={copy}>
                  <View style={[s.row, { gap: 6, justifyContent: 'center' }]}>
                    <Ionicons name={canCopy ? 'copy-outline' : 'share-outline'} size={14} color="white" />
                    <Text style={s.btnText}>{copied ? t('Copied') : canCopy ? t('Copy link') : t('Share link')}</Text>
                  </View>
                </Pressable>
                <Pressable style={[s.btnGhost, { flex: 1 }]} onPress={rotate} disabled={busy}>
                  <Text style={s.btnGhostText}>{t('Generate new invite link')}</Text>
                </Pressable>
              </View>
              {canScan && (
                <>
                  <Text style={[s.dim, { textAlign: 'center', marginTop: 14 }]}>{t('Have a friend’s QR instead?')}</Text>
                  <Pressable style={[s.btnGhost, { marginTop: 8 }]} onPress={() => { setScanErr(''); setScanning(true); }}>
                    <View style={[s.row, { gap: 6, justifyContent: 'center' }]}>
                      <Ionicons name="qr-code-outline" size={14} color={palette.text2} />
                      <Text style={s.btnGhostText}>{t('Scan a friend’s QR')}</Text>
                    </View>
                  </Pressable>
                  {!!scanErr && <Text style={[s.dim, { color: palette.danger, textAlign: 'center', marginTop: 6 }]}>{scanErr}</Text>}
                </>
              )}
            </>
          ) : failed ? (
            <Text style={[s.dim, { marginVertical: 16 }]}>{t('Could not connect. Check your internet and try again.')}</Text>
          ) : (
            <View style={{ alignItems: 'center', marginVertical: 24 }}><ActivityIndicator color={palette.accent} /></View>
          )}
        </Pressable>
      </Pressable>
      <ScanSheet visible={scanning} onClose={() => setScanning(false)} onCode={onScanned} />
    </Modal>
  );
}

/** Floating + button, bottom-right, above the tab bar (it lives inside the
 *  tab's content area, so it can never cover the bottom menu). */
export function ChatFab({ onPress }: { onPress: () => void }) {
  return (
    <DraggableFab
      storageKey="chat-add"
      onPress={onPress}
      accessibilityLabel={t('Add a friend')}
      style={{
        width: 54, height: 54, borderRadius: 27,
        backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 6,
      }}
    >
      <Ionicons name="add" size={30} color="white" />
    </DraggableFab>
  );
}

// ─── Incoming invite-link screen ─────────────────────────────────────────────

/** Shown after the app resolved an opened #invite=<code> link. */
export function InviteResolvedSheet({ client, invite, myName, onDone }: {
  client: MobileClient | null;
  invite: { pubkey: string; name?: string };
  myName?: string;
  onDone: (sent: boolean) => void;
}) {
  const [sending, setSending] = useState(false);
  const self = invite.pubkey === client?.pubkey;
  const label = (invite.name || npubFromHex(invite.pubkey).slice(0, 12) + '…').trim();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => onDone(false)}>
      <Pressable style={s.sortBackdrop} onPress={() => onDone(false)}>
        <Pressable style={s.sortSheet} onPress={() => {}}>
          <Text style={s.sectionTitle}>{t('Chat invite')}</Text>
          <View style={{ alignItems: 'center', marginVertical: 12, gap: 8 }}>
            <Avatar uri={client?.profiles.get(invite.pubkey)?.picture || defaultAvatarUrl(npubFromHex(invite.pubkey))} size={64} />
            <Text style={s.cardTitle}>{label}</Text>
          </View>
          {self ? (
            <Text style={[s.dim, { textAlign: 'center' }]}>{t('This is your own invite link.')}</Text>
          ) : (
            <>
              <Text style={[s.dim, { textAlign: 'center' }]}>{t('Send a chat invite? They can accept or reject it.')}</Text>
              <Pressable
                style={[s.btnAccept, { marginTop: 14 }]}
                disabled={sending}
                onPress={async () => {
                  setSending(true);
                  try { await client?.chatInvite(invite.pubkey, myName); onDone(true); }
                  catch { setSending(false); }
                }}
              >
                {sending ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Send Chat Invite')}</Text>}
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
