/**
 * Friend chat (experimental) — the deal-independent 1:1 chat UI:
 *   - FriendChatSection: WhatsApp-style rows (avatar · name · last message ·
 *     time) + pending invite requests with Accept/Reject, shown at the top of
 *     the Messages tab when the Chat experiment is on.
 *   - FriendChatModal: the conversation screen (reuses ChatCore) with
 *     archive + block actions and last-seen in the header.
 *   - InviteSheet: your shareable QR + link (#invite=<code>) with copy/share
 *     and a "Generate new invite link" rotation.
 *   - ChatFab: the floating + button that opens the InviteSheet.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t, tn } from '../../i18n';
import { MobileClient } from '../../client';
import { type Conversation, unreadCount, tickFor } from '../../conversations';
import { npubFromHex } from '../../identity';
import { defaultAvatarUrl } from '../../profile';
import { qrDataUrl } from '../../wallet/qr';
import { webBase } from '../../webBase';
import { fmtClock } from '../../ui/format';
import { s, palette } from '../../ui/theme';
import { confirmAsync } from '../../ui/alerts';
import { ChatCore } from './Chat';

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

function lastLine(conv: Conversation): string {
  const m = conv.messages[conv.messages.length - 1];
  if (!m) return t('Say hello 👋');
  const prefix = m.dir === 'out' ? t('You') + ': ' : '';
  return prefix + (m.text.length > 60 ? m.text.slice(0, 57) + '…' : m.text);
}

function Avatar({ uri, size = 44 }: { uri: string; size?: number }) {
  return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.chipBg }} />;
}

// ─── Conversation list ───────────────────────────────────────────────────────

export function FriendChatSection({ client, conversations, blockedPubkeys, onOpen, onAcceptInvite, chatEnabled = true }: {
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
}) {
  const [showArchived, setShowArchived] = useState(false);
  // Blocked peers: hide their PENDING invites (spam), but keep an already-
  // active chat visible — the unblock action lives in its header.
  const visible = conversations.filter((c) =>
    (c.state === 'active' || c.state === 'pending_out' || (c.state === 'pending_in' && !blockedPubkeys.has(c.peer))));
  if (visible.length === 0) return null;
  const pending = visible.filter((c) => c.state === 'pending_in').sort((a, b) => b.updatedAt - a.updatedAt);
  // Experiment off: incoming requests must still be visible/answerable —
  // otherwise an invite arrives into a hidden UI (user report).
  const live = chatEnabled ? visible.filter((c) => c.state !== 'pending_in' && !c.archived).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  const archived = chatEnabled ? visible.filter((c) => c.state !== 'pending_in' && c.archived).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  if (!chatEnabled && pending.length === 0) return null;

  return (
    <View style={{ marginHorizontal: 12, marginTop: 8 }}>
      <Text style={[s.sectionTitle, { marginBottom: 4 }]}>{t('Chats')}</Text>
      {pending.map((c) => (
        <View key={c.peer} style={[s.card, s.cardHighlight, { marginHorizontal: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
          <Avatar uri={avatarUri(c, client)} />
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle} numberOfLines={1}>{chatDisplayName(c, client)}</Text>
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
          <Pressable key={c.peer} style={[s.card, { marginHorizontal: 0, flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => onOpen(c.peer)}>
            <Avatar uri={avatarUri(c, client)} />
            <View style={{ flex: 1 }}>
              <Text style={s.cardTitle} numberOfLines={1}>{chatDisplayName(c, client)}</Text>
              <Text style={s.dim} numberOfLines={1}>
                {c.state === 'pending_out' ? t('Invite sent — waiting for accept') : lastLine(c)}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Text style={[s.dim, { fontSize: 11 }]}>{fmtRowTime(c.messages[c.messages.length - 1]?.ts ?? c.updatedAt)}</Text>
              {unread > 0 && (
                <View style={s.badge}><Text style={s.badgeText}>{unread}</Text></View>
              )}
            </View>
          </Pressable>
        );
      })}
      {archived.length > 0 && (
        <Pressable onPress={() => setShowArchived((v) => !v)} hitSlop={6} style={{ paddingVertical: 6 }}>
          <Text style={s.link}>
            {showArchived ? t('Hide archived chats') : tn(archived.length, 'Archived chats ({n})', 'Archived chats ({n})')}
          </Text>
        </Pressable>
      )}
      {showArchived && archived.map((c) => (
        <Pressable key={c.peer} style={[s.card, { marginHorizontal: 0, opacity: 0.7, flexDirection: 'row', alignItems: 'center', gap: 10 }]} onPress={() => onOpen(c.peer)}>
          <Avatar uri={avatarUri(c, client)} size={36} />
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle} numberOfLines={1}>{chatDisplayName(c, client)}</Text>
            <Text style={s.dim} numberOfLines={1}>{lastLine(c)}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

// ─── Conversation screen ─────────────────────────────────────────────────────

/** Disappearing-timer cycle: off → 24h → 7d → off. */
const TTL_STEPS = [0, 24 * 3600, 7 * 24 * 3600];

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
  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onClose}>
      <View style={[s.appShell, { flex: 1 }]}>
        <View style={[s.row, { padding: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: palette.border, alignItems: 'center' }]}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('Back')}>
            <Ionicons name="arrow-back" size={22} color={palette.text} />
          </Pressable>
          <Avatar uri={avatarUri(conv, client)} size={36} />
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle} numberOfLines={1}>{chatDisplayName(conv, client)}</Text>
            {online ? (
              <View style={[s.row, { gap: 4, alignItems: 'center' }]}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' }} />
                <Text style={[s.dim, { fontSize: 11, color: '#22c55e' }]}>{t('Online')}</Text>
              </View>
            ) : lastSeen ? (
              <Text style={[s.dim, { fontSize: 11 }]}>{t('Last seen {time}', { time: fmtRowTime(lastSeen) })}</Text>
            ) : null}
          </View>
          {walletEnabled && onPayFriend && conv.theirPay && conv.state === 'active' && !blocked ? (
            <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={t('Send payment')} onPress={() => onPayFriend(conv.peer, conv.theirPay!)}>
              <Ionicons name="flash-outline" size={20} color={palette.text2} />
            </Pressable>
          ) : null}
          {conv.state === 'active' ? (
            <Pressable
              hitSlop={8}
              accessibilityRole="button" accessibilityLabel={t('Disappearing messages')}
              onPress={() => {
                const cur = TTL_STEPS.indexOf(conv.disappearTtl ?? 0);
                const next = TTL_STEPS[(cur + 1) % TTL_STEPS.length];
                client?.chatSetTtl(conv.peer, next).catch(() => {});
              }}
            >
              <Ionicons name={conv.disappearTtl ? 'timer' : 'timer-outline'} size={20} color={conv.disappearTtl ? palette.accent : palette.text2} />
            </Pressable>
          ) : null}
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
          <Pressable
            hitSlop={8}
            accessibilityRole="button" accessibilityLabel={conv.archived ? t('Unarchive chat') : t('Archive chat')}
            onPress={() => { client?.chatSetArchived(conv.peer, !conv.archived); onClose(); }}
          >
            <Ionicons name={conv.archived ? 'archive' : 'archive-outline'} size={20} color={palette.text2} />
          </Pressable>
          <Pressable
            hitSlop={8}
            accessibilityRole="button" accessibilityLabel={blocked ? t('Unblock') : t('Block this person')}
            onPress={async () => {
              if (!blocked) {
                const ok = await confirmAsync(t('Block this person?'), t('You will not receive any more messages from them.'), t('Block'));
                if (!ok) return;
              }
              onToggleBlock(conv.peer);
              if (!blocked) onClose();
            }}
          >
            <Ionicons name={blocked ? 'ban' : 'ban-outline'} size={20} color={palette.danger} />
          </Pressable>
        </View>
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
              {'⏱ ' + (conv.disappearTtl >= 7 * 24 * 3600
                ? t('New messages disappear after 7 days')
                : t('New messages disappear after 24 hours'))}
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
          />
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Invite popup + FAB ──────────────────────────────────────────────────────

export function InviteSheet({ client, myName, onClose }: {
  client: MobileClient | null;
  myName?: string;
  onClose: () => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client?.publishChatInvite(myName)
      .then((r) => { if (!cancelled) setCode(r.code); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [client]);

  const link = code ? `${webBase()}/#invite=${code}` : '';
  const copy = async () => {
    if (!link) return;
    try {
      if (Platform.OS === 'web' && (navigator as any)?.clipboard) {
        await (navigator as any).clipboard.writeText(link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else await Share.share({ message: link });
    } catch { /* user dismissed the share sheet */ }
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
                    <Ionicons name="copy-outline" size={14} color="white" />
                    <Text style={s.btnText}>{copied ? t('Copied') : t('Copy link')}</Text>
                  </View>
                </Pressable>
                <Pressable style={[s.btnGhost, { flex: 1 }]} onPress={rotate} disabled={busy}>
                  <Text style={s.btnGhostText}>{t('Generate new invite link')}</Text>
                </Pressable>
              </View>
            </>
          ) : failed ? (
            <Text style={[s.dim, { marginVertical: 16 }]}>{t('Could not connect. Check your internet and try again.')}</Text>
          ) : (
            <View style={{ alignItems: 'center', marginVertical: 24 }}><ActivityIndicator color={palette.accent} /></View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Floating + button, bottom-right, above the tab bar (it lives inside the
 *  tab's content area, so it can never cover the bottom menu). */
export function ChatFab({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t('Add a friend')}
      style={{
        position: 'absolute', end: 18, bottom: 18,
        width: 54, height: 54, borderRadius: 27,
        backgroundColor: palette.accent, alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 5, elevation: 6,
      }}
    >
      <Ionicons name="add" size={30} color="white" />
    </Pressable>
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
