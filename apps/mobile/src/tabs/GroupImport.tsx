/**
 * Group import — community onboarding UI.
 *
 *   - GroupInviteSheet: the admin creates a signed community invite (name +
 *     market), producing a link + QR + share button + a copy-ready blurb.
 *   - GroupJoinSheet: a member opening a /g/<payload> link — group name, admin
 *     identity, what joining does, and a single Join button.
 *   - GroupMembersSheet: the admin's list of members who joined, with a one-tap
 *     vouch per member.
 *
 * Mirrors the FriendChat InviteSheet / InviteResolvedSheet patterns.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Event } from 'nostr-tools/pure';
import {
  makeGroupDescriptor,
  groupLink,
  type GroupInvite,
} from '@freeport/protocol';
import { t } from '../i18n';
import { MobileClient } from '../client';
import { webBase } from '../webBase';
import { qrDataUrl } from '../wallet/qr';
import { copyText, clipboardAvailable } from '../ui/clipboard';
import { Field, SelectField } from '../ui/fields';
import { SERVICE_CATEGORIES, RIDESHARE_CATEGORY, categoryIcon, subcategoryIcon, subcategoriesFor } from '../categories';
import { npubFromHex } from '../identity';
import { shortNpub } from '../ui/format';
import { defaultAvatarUrl } from '../profile';
import { PeerLinkIcon } from '../ui/peerLink';
import { uiAlert } from '../ui/alerts';
import { s, palette } from '../ui/theme';
import type { JoinedGroup } from '../groups';

const CATEGORY_OPTIONS = [RIDESHARE_CATEGORY, ...SERVICE_CATEGORIES];

/** A copy-ready blurb the admin can paste into their group chat. */
function shareBlurb(name: string, link: string): string {
  return (
    t("Come join {name} on Freeport — a peer-to-peer marketplace with no company in the middle, no fees, and no one who can shut us down. Open this link and you'll land right in our market:", { name }) +
    '\n\n' + link
  );
}

// ─── Admin: create a group invite ────────────────────────────────────────────

export function GroupInviteSheet({ client, onClose }: {
  client: MobileClient | null;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState(RIDESHARE_CATEGORY);
  const [subcategory, setSubcategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [ev, setEv] = useState<Event | null>(null);
  const [copied, setCopied] = useState<'link' | 'blurb' | null>(null);
  const [canCopy, setCanCopy] = useState(false);

  useEffect(() => { clipboardAvailable().then(setCanCopy).catch(() => {}); }, []);

  const subs = subcategoriesFor(category);
  const link = ev ? groupLink(webBase(), ev) : '';
  const blurb = ev ? shareBlurb(name.trim(), link) : '';

  const create = async () => {
    if (!client || busy) return;
    const descriptor = makeGroupDescriptor({ name, category, subcategory: subcategory || undefined });
    if (!descriptor) { uiAlert(t('Check the details'), t('Enter a group name and market.')); return; }
    setBusy(true);
    try {
      setEv(await client.signGroupInvite(descriptor));
    } catch {
      uiAlert(t('Could not create invite'), t('Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const shareOrCopy = async (text: string, which: 'link' | 'blurb') => {
    const wrote = await copyText(text, () => {
      onClose();
      setTimeout(() => { Share.share({ message: text }).catch(() => {}); }, 350);
    });
    if (wrote) { setCopied(which); setTimeout(() => setCopied(null), 2000); }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.sortBackdrop} onPress={onClose}>
        <Pressable style={s.sortSheet} onPress={() => {}}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={s.sectionTitle}>{t('Create group invite')}</Text>
            <Text style={s.dim}>{t('Bring your whole community to Freeport with one link. Everyone who joins lands in the same market.')}</Text>
            {!ev ? (
              <>
                <Field label="Group name" value={name} onChange={setName} placeholder={t('e.g. Hanoi Drivers')} maxLength={80} />
                <Text style={s.label}>{t('Market')}</Text>
                <SelectField
                  value={category}
                  options={CATEGORY_OPTIONS}
                  onChange={(c) => { setCategory(c); setSubcategory(''); }}
                  iconFor={(c) => categoryIcon(c)}
                  labelFor={(c) => t(c)}
                  scroll
                />
                {subs.length > 0 ? (
                  <>
                    <Text style={s.label}>{t('Subcategory')}</Text>
                    <SelectField
                      value={subcategory}
                      options={subs}
                      onChange={setSubcategory}
                      iconFor={(sub) => subcategoryIcon(sub)}
                      labelFor={(sub) => t(sub)}
                      placeholder={t('Any')}
                      scroll
                    />
                  </>
                ) : null}
                <Pressable style={[s.btnAccept, { marginTop: 16 }]} onPress={create} disabled={busy}>
                  {busy ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Create group invite')}</Text>}
                </Pressable>
              </>
            ) : (
              <>
                <View style={{ alignItems: 'center', marginVertical: 14 }}>
                  <Image source={{ uri: qrDataUrl(link) }} style={{ width: 200, height: 200, borderRadius: 8 }} />
                </View>
                <Text style={[s.dim, { textAlign: 'center' }]} numberOfLines={1}>{link}</Text>
                <View style={[s.btnRow, { marginTop: 12 }]}>
                  <Pressable style={[s.btnAccept, { flex: 1 }]} onPress={() => shareOrCopy(link, 'link')}>
                    <View style={[s.row, { gap: 6, justifyContent: 'center' }]}>
                      <Ionicons name={canCopy ? 'copy-outline' : 'share-outline'} size={14} color="white" />
                      <Text style={s.btnText}>{copied === 'link' ? t('Copied') : canCopy ? t('Copy link') : t('Share link')}</Text>
                    </View>
                  </Pressable>
                  <Pressable style={[s.btnGhost, { flex: 1 }]} onPress={() => shareOrCopy(blurb, 'blurb')}>
                    <Text style={s.btnGhostText}>{copied === 'blurb' ? t('Copied') : t('Copy invite message')}</Text>
                  </Pressable>
                </View>
                <Text style={[s.dim, { marginTop: 14 }]}>{t('Share message')}</Text>
                <Text style={[s.dim, { marginTop: 4, fontStyle: 'italic' }]}>{blurb}</Text>
              </>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Member: join a group ────────────────────────────────────────────────────

export function GroupJoinSheet({ client, invite, onJoin, onClose }: {
  client: MobileClient | null;
  invite: GroupInvite;
  onJoin: (invite: GroupInvite) => Promise<void>;
  onClose: () => void;
}) {
  const [joining, setJoining] = useState(false);
  const d = invite.descriptor;
  const admin = invite.admin;
  const self = admin === client?.pubkey;
  const prof = client?.profiles.get(admin);
  const adminLabel = (prof?.name || shortNpub(npubFromHex(admin))).trim();
  const marketLabel = [t(d.category), d.subcategory ? t(d.subcategory) : null].filter(Boolean).join(' · ');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.sortBackdrop} onPress={onClose}>
        <Pressable style={s.sortSheet} onPress={() => {}}>
          <Text style={s.sectionTitle}>{t('Join community')}</Text>
          <View style={{ alignItems: 'center', marginVertical: 12, gap: 6 }}>
            <Image source={{ uri: prof?.picture || defaultAvatarUrl(npubFromHex(admin)) }} style={{ width: 56, height: 56, borderRadius: 28 }} />
            <Text style={s.cardTitle}>{d.name}</Text>
            <View style={[s.row, { gap: 4 }]}>
              <Text style={s.dim}>{t('Admin')}: {adminLabel}</Text>
              <PeerLinkIcon link={prof?.link} />
            </View>
            <Text style={s.dim}>{marketLabel}</Text>
          </View>
          {self ? (
            <Text style={[s.dim, { textAlign: 'center' }]}>{t('This is your own group invite.')}</Text>
          ) : (
            <>
              <Text style={[s.dim, { textAlign: 'center' }]}>
                {t('Joining opens Browse into this market and records your membership so people from this group are marked as such.')}
              </Text>
              <Pressable
                style={[s.btnAccept, { marginTop: 14 }]}
                disabled={joining}
                onPress={async () => {
                  setJoining(true);
                  try { await onJoin(invite); }
                  catch { setJoining(false); }
                }}
              >
                {joining ? <ActivityIndicator color="white" /> : <Text style={s.btnText}>{t('Join {name}', { name: d.name })}</Text>}
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ─── Admin: members list + one-tap vouch ─────────────────────────────────────

export function GroupMembersSheet({ client, group, onClose }: {
  client: MobileClient | null;
  group: JoinedGroup;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<{ pubkey: string; name?: string }[] | null>(null);
  const [vouched, setVouched] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    client?.fetchGroupMembers(group.gid)
      .then((m) => { if (!cancelled) setMembers(m); })
      .catch(() => { if (!cancelled) setMembers([]); });
    return () => { cancelled = true; };
  }, [client, group.gid]);

  const vouch = async (pubkey: string) => {
    if (!client || busy) return;
    setBusy(pubkey);
    try {
      await client.publishGroupVouch(pubkey, group.gid);
      setVouched((prev) => new Set(prev).add(pubkey));
    } catch {
      uiAlert(t('Could not vouch'), t('Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.sortBackdrop} onPress={onClose}>
        <Pressable style={s.sortSheet} onPress={() => {}}>
          <Text style={s.sectionTitle}>{group.name}</Text>
          <Text style={s.dim}>{t('Members who joined via your invite. Vouch to publicly endorse a member you trust.')}</Text>
          {members === null ? (
            <View style={{ alignItems: 'center', marginVertical: 24 }}><ActivityIndicator color={palette.accent} /></View>
          ) : members.length === 0 ? (
            <Text style={[s.dim, { marginVertical: 16 }]}>{t('No members have joined yet.')}</Text>
          ) : (
            <ScrollView style={{ maxHeight: 360, marginTop: 8 }}>
              {members.map((m) => {
                const label = (m.name || shortNpub(npubFromHex(m.pubkey))).trim();
                const done = vouched.has(m.pubkey);
                return (
                  <View key={m.pubkey} style={[s.row, { justifyContent: 'space-between', paddingVertical: 8 }]}>
                    <Text style={[s.cardTitle, { marginTop: 0, flex: 1 }]} numberOfLines={1}>{label}</Text>
                    <Pressable
                      style={[done ? s.btnGhost : s.btnAccept, { paddingVertical: 6, paddingHorizontal: 12 }]}
                      disabled={done || busy === m.pubkey}
                      onPress={() => vouch(m.pubkey)}
                    >
                      {busy === m.pubkey
                        ? <ActivityIndicator color={done ? palette.accent : 'white'} />
                        : <Text style={done ? s.btnGhostText : s.btnText}>{done ? t('Vouched') : t('Vouch')}</Text>}
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
