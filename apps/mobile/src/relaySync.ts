/**
 * Settings sync over relays — what makes passkey sign-in feel like a login.
 *
 * The passkey re-derives the KEY on a new device, but profile/prefs/address
 * book were device-local, so a fresh sign-in landed on an empty profile. Now
 * every settings change (already debounced through scheduleCloudSync) also
 * publishes a kind-30078 replaceable event (NIP-78 app data, d=freeport-sync)
 * whose content is the same extras bundle the file/cloud backups carry —
 * minus the key — NIP-44-encrypted to ourselves. Sign-in fetches + decrypts
 * it, then falls back to the public kind:0 profile when no sync event exists.
 *
 * The NWC wallet connection string rides along inside prefs; it's a
 * credential, which is why the payload is encrypted rather than plain NIP-78.
 */
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { DEFAULT_RELAYS } from '@freeport/protocol';
import { loadProfile, saveProfile, type UserProfile } from './profile';
import { loadPrefs, savePrefs } from './prefs';
import { loadAddressBook, replaceAddressBook } from './addressbook';

const SYNC_KIND = 30078;
const SYNC_D = 'freeport-sync-v1';

const selfKey = (sk: Uint8Array) => nip44.getConversationKey(sk, getPublicKey(sk));

/** Publish the current settings as an encrypted replaceable event. */
export async function publishSettingsSync(sk: Uint8Array, relays: string[] = DEFAULT_RELAYS, pool?: SimplePool): Promise<void> {
  const payload = JSON.stringify({
    v: 1,
    profile: await loadProfile(),
    prefs: await loadPrefs(),
    addressBook: await loadAddressBook(),
  });
  const ev = finalizeEvent({
    kind: SYNC_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['d', SYNC_D]],
    content: nip44.encrypt(payload, selfKey(sk)),
  }, sk);
  const p = pool ?? new SimplePool();
  try {
    await Promise.any(p.publish(relays, ev));
  } finally {
    if (!pool) p.close(relays);
  }
}

/**
 * Fill profile fields a restore left EMPTY from what the network already
 * knows (sync bundle first, then the public kind:0). File/cloud bundles can
 * predate the avatar — name and phone restore but the picture is missing
 * (user report). Never overwrites fields the bundle did carry.
 */
export async function fillMissingProfileFromRelays(sk: Uint8Array, relays: string[] = DEFAULT_RELAYS): Promise<void> {
  const current = await loadProfile();
  if (current.picture && current.name && current.about && current.gallery.length) return;
  const pk = getPublicKey(sk);
  const pool = new SimplePool();
  try {
    let remote: Partial<UserProfile> | null = null;
    const ev = await pool.get(relays, { kinds: [SYNC_KIND], authors: [pk], '#d': [SYNC_D] }).catch(() => null);
    if (ev?.content) {
      try { remote = JSON.parse(nip44.decrypt(ev.content, selfKey(sk)))?.profile ?? null; } catch { /* fall through */ }
    }
    if (!remote) {
      const meta = await pool.get(relays, { kinds: [0], authors: [pk] }).catch(() => null);
      if (meta?.content) {
        try {
          const k0 = JSON.parse(meta.content);
          remote = { name: k0.name, picture: k0.picture, about: k0.about, gallery: Array.isArray(k0.gallery) ? k0.gallery : undefined };
        } catch { /* unusable */ }
      }
    }
    if (!remote) return;
    await saveProfile({
      ...current,
      name: current.name || (remote.name ?? ''),
      picture: current.picture || (remote.picture ?? ''),
      about: current.about || (remote.about ?? ''),
      gallery: current.gallery.length ? current.gallery : (remote.gallery ?? []),
    });
  } finally {
    pool.close(relays);
  }
}

/**
 * Pull settings for a freshly signed-in key. Applies the encrypted sync
 * bundle when one exists; otherwise falls back to the public kind:0 profile
 * so at least the visible identity survives. Best-effort: resolves false
 * when nothing was found (fresh account or all relays unreachable).
 */
export async function restoreSettingsSync(sk: Uint8Array, relays: string[] = DEFAULT_RELAYS): Promise<boolean> {
  const pk = getPublicKey(sk);
  const pool = new SimplePool();
  try {
    const ev = await pool.get(relays, { kinds: [SYNC_KIND], authors: [pk], '#d': [SYNC_D] }).catch(() => null);
    if (ev?.content) {
      try {
        const bundle = JSON.parse(nip44.decrypt(ev.content, selfKey(sk)));
        if (bundle?.profile && typeof bundle.profile === 'object') await saveProfile(bundle.profile as UserProfile);
        if (bundle?.prefs && typeof bundle.prefs === 'object') await savePrefs(bundle.prefs);
        if (bundle?.addressBook && typeof bundle.addressBook === 'object') await replaceAddressBook(bundle.addressBook);
        return true;
      } catch { /* wrong key / corrupt — fall through to kind:0 */ }
    }
    const meta = await pool.get(relays, { kinds: [0], authors: [pk] }).catch(() => null);
    if (meta?.content) {
      try {
        const k0 = JSON.parse(meta.content);
        const current = await loadProfile();
        await saveProfile({
          ...current,
          name: k0.name ?? current.name,
          picture: k0.picture ?? current.picture,
          about: k0.about ?? current.about,
          gallery: Array.isArray(k0.gallery) ? k0.gallery : current.gallery,
        });
        return true;
      } catch { /* unusable kind:0 */ }
    }
    return false;
  } finally {
    pool.close(relays);
  }
}
