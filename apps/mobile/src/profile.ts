/**
 * Nostr user profile — NIP-01 kind:0.
 *
 * The profile is stored locally in SecureStore and published to relays as a
 * kind:0 replaceable event. Counterparties fetch it via:
 *   REQ [{"kinds":[0],"authors":["<pubkey>"]}]
 *
 * Fields follow the NIP-01 / NIP-24 metadata spec so any Nostr client can
 * render them. We add nothing proprietary.
 */
import { kvGet, kvSet } from './kv';
import { scheduleCloudSync } from './cloudSync';
import { SimplePool } from 'nostr-tools/pool';
import type { Signer } from './signer';

const STORE_KEY = 'freeport.profile';

export type PhoneDisplay = 'masked' | 'full';

export interface UserProfile {
  name: string;
  picture: string;  // NIP-01 avatar URL
  about: string;
  gallery: string[]; // extra profile photos (stored in kind:0 as custom field)
  /** Full phone number — kept in SecureStore only. What gets published depends on phoneDisplay. */
  phone: string;
  phoneDisplay: PhoneDisplay;
  /** Optional user-set profile link (e.g. an ID/licence verification page).
   *  MUST be https — peer URLs are untrusted, so we never publish or open a
   *  non-https value. Published as a custom `link` field. */
  link: string;
  /** Lightning address (lud16) — auto-filled from the wallet when it's on, so
   *  others can zap this user's posts (NIP-57). Published as `lud16`. */
  lud16?: string;
  /** Driver's vehicle model (e.g. "Toyota Vios — white"). Published publicly. */
  vehicleModel: string;
  /** Driver's full licence-plate number — kept on device; full value shared via DM at deal time. */
  plateNumber: string;
  /** How the plate is published in the public profile: 'masked' shows only the last 3 chars. */
  plateDisplay: PhoneDisplay;
}

const EMPTY: UserProfile = { name: '', picture: '', about: '', gallery: [], phone: '', phoneDisplay: 'full', link: '', vehicleModel: '', plateNumber: '', plateDisplay: 'masked' };

/**
 * Validate + normalize a user/peer profile link. Returns a canonical https URL,
 * or null for anything else — http, other schemes, userinfo tricks, over-long or
 * unparseable input. Used on BOTH ends: we validate before publishing our own
 * link, and re-validate any peer-supplied value before opening it (never trust
 * stored/received data). Mirrors the mini-app firewall's https-only discipline.
 */
export function httpsLinkOrNull(input: string | undefined | null): string | null {
  if (typeof input !== 'string' || !input.trim() || input.length > 1024) return null;
  let u: URL;
  try { u = new URL(input.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
  return u.toString();
}

/** Hostname of a validated https link, for showing the user where a tap leads. */
export function linkHost(input: string | undefined | null): string | null {
  const safe = httpsLinkOrNull(input);
  if (!safe) return null;
  try { return new URL(safe).hostname; } catch { return null; }
}

/**
 * A deterministic default avatar for a fresh account, so new users aren't a
 * blank circle. Seeded by the account's own key (the tail varies per key, as
 * requested) → a stable, unique generated image. Uses DiceBear's key-free PNG
 * endpoint so it renders in <Image> on both native and web, and is a plain URL
 * we can publish straight into the kind:0 `picture` field.
 */
export function defaultAvatarUrl(keySeed: string): string {
  const seed = encodeURIComponent(keySeed);
  return `https://api.dicebear.com/9.x/thumbs/png?seed=${seed}`;
}

/** "+15551234567" → "+15•••••4567". Keeps + and ~2 leading digits, last 4 digits. */
export function maskPhone(phone: string): string {
  const p = phone.replace(/[^\d+]/g, '');
  if (p.length < 8) return p.replace(/\d(?=\d{4})/g, '•');
  const head = p.startsWith('+') ? p.slice(0, 3) : p.slice(0, 2);
  const tail = p.slice(-4);
  return head + '•'.repeat(p.length - head.length - tail.length) + tail;
}

/**
 * "ABC-1234" → "•••-•234": masks every alphanumeric except the last 3,
 * keeping separators (-, ., space) in place. Special chars don't count toward
 * the 3 revealed characters. Too-short plates (≤3 alnum) are left as-is.
 */
export function maskPlate(plate: string): string {
  const isAlnum = (ch: string) => /[a-z0-9]/i.test(ch);
  const total = [...plate].filter(isAlnum).length;
  if (total <= 3) return plate;
  let seen = 0;
  return [...plate]
    .map((ch) => {
      if (!isAlnum(ch)) return ch;
      seen++;
      return seen > total - 3 ? ch : '•';
    })
    .join('');
}

/**
 * Accept only a full number or a canonical mask for display. Degenerate
 * self-published masks like "+1•••9" (too few revealed digits, wrong shape)
 * are rejected — they can never pass the contact_masked cross-check anyway,
 * so rendering them would only lend fake visual credibility.
 */
export function isDisplayablePhone(phone: string): boolean {
  const p = phone.replace(/[\s.-]/g, '').replace(/[xX*]/g, '•');
  if (/^\+?\d{8,15}$/.test(p)) return true;   // full number
  return /^\+?\d{1,3}•{2,12}\d{4}$/.test(p);  // canonical mask: head + bullets + last 4
}

export async function loadProfile(): Promise<UserProfile> {
  try {
    const raw = await kvGet(STORE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    const merged: UserProfile = { ...EMPTY, ...parsed, gallery: parsed.gallery ?? [] };
    // Migrate the retired "External link" field: if the user hasn't set a `link`
    // yet but has a legacy externalLink/website value that passes https
    // validation, carry it over so their next save republishes it as `link`.
    // A non-https legacy value is intentionally left behind (it can't be safely
    // published or opened, and is no longer editable in the UI).
    if (!merged.link) {
      const legacy = httpsLinkOrNull(parsed.externalLink ?? parsed.website);
      if (legacy) merged.link = legacy;
    }
    // Drop the retired field so it's no longer persisted or published.
    delete (merged as { externalLink?: string }).externalLink;
    return merged;
  } catch {
    return { ...EMPTY };
  }
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await kvSet(STORE_KEY, JSON.stringify(profile));
  scheduleCloudSync(); // keep the cloud backup in sync with profile changes
}

/**
 * Publish kind:0 to the given relays. Replaces any prior profile event from
 * this keypair — relays keep only the latest replaceable event per pubkey+kind.
 * Returns the relay URLs that accepted the event.
 */
export async function publishProfile(
  signer: Signer,
  profile: UserProfile,
  relays: string[],
): Promise<string[]> {
  const content: Record<string, unknown> = {};
  if (profile.name) content.name = profile.name;
  if (profile.picture) content.picture = profile.picture;
  if (profile.about) content.about = profile.about;
  if (profile.gallery?.length) content.gallery = profile.gallery;
  // Only ever publish a valid https link; a non-https value is dropped, not shared.
  // (The retired `website`/External-link field is no longer written.)
  if (profile.link) {
    const safeLink = httpsLinkOrNull(profile.link);
    if (safeLink) content.link = safeLink;
  }
  if (profile.lud16) content.lud16 = profile.lud16.trim();
  // Masking happens HERE, before publish — relays never see the full number
  // unless the user explicitly opted into 'full'.
  if (profile.phone) {
    content.phone = profile.phoneDisplay === 'full' ? profile.phone : maskPhone(profile.phone);
  }
  // Vehicle model is public as-is; the plate is masked (last 3 chars) unless the
  // driver opts into 'full'. The full plate still travels via encrypted DM at deal time.
  if (profile.vehicleModel) content.vehicle_model = profile.vehicleModel;
  if (profile.plateNumber) {
    content.plate = profile.plateDisplay === 'full' ? profile.plateNumber : maskPlate(profile.plateNumber);
  }

  const ev = await signer.signEvent({
    kind: 0,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
    content: JSON.stringify(content),
  });

  const pool = new SimplePool();
  const results = await Promise.allSettled(pool.publish(relays, ev));
  pool.close(relays);
  return results
    .map((r, i) => (r.status === 'fulfilled' ? relays[i] : null))
    .filter((r): r is string => r !== null);
}
