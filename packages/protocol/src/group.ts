/**
 * Group import — community onboarding.
 *
 * The unit of onboarding is a whole community, not an individual. A group admin
 * (e.g. the moderator of a Facebook/Zalo drivers' group) creates ONE signed
 * invite that carries the group name + market configuration, and shares it as a
 * link/QR. Everyone who opens it lands in the same market with the shared trust
 * that already existed off-platform.
 *
 * Design (mirrors the chat-invite forgery model, but self-contained):
 *   - The admin signs a KIND_GROUP_INVITE nostr event whose content is the
 *     group descriptor JSON. The event `id` is sha256 over the serialized event
 *     (pubkey ‖ created_at ‖ kind ‖ tags ‖ content), so it is a HASH COMMITMENT
 *     to the admin's key AND the descriptor. That id is the immutable group id.
 *   - The WHOLE signed event is base64url-encoded into a path-form share link
 *     (…/g/<payload>), so a recipient verifies the admin signature and the group
 *     id entirely from the link — no relay lookup, nothing to hijack.
 *   - A member's join attestation (KIND_GROUP_JOIN) embeds the same signed event,
 *     so a THIRD party can verify two members belong to the same admin-signed
 *     group without ever having seen the link.
 *
 * Everything here is pure: signing happens in the app layer (which owns the
 * Signer); this module builds descriptors and verifies/decodes what comes back.
 */
import { verifyEvent, type Event } from 'nostr-tools/pure';
import { KIND_GROUP_INVITE, SCHEMA_VERSION } from './constants.js';

// Group descriptor is attacker-visible public data (it rides in a link anyone
// can open), so every field is length-bounded and validated defensively.
export const GROUP_NAME_MAX = 80;
export const GROUP_CATEGORY_MAX = 40;
export const GROUP_TOPIC_MAX = 40;
export const GROUP_TOPICS_MAX = 8;

/** The market a group onboards into, plus its human name. */
export interface GroupDescriptor {
  v: number;
  /** Community name shown on the join screen. */
  name: string;
  /** Marketplace category (e.g. "Ridesharing" or a service category). */
  category: string;
  /** Marketplace subcategory (optional). */
  subcategory?: string;
  /** Freeform region/topic tags (optional). */
  topics?: string[];
}

/** A verified group invite: the descriptor plus who signed it and its id. */
export interface GroupInvite {
  /** Immutable group id = the signed event id (hash commitment). */
  gid: string;
  /** Admin pubkey (hex) — the event author. */
  admin: string;
  descriptor: GroupDescriptor;
  /** The admin-signed event, kept so a member can re-embed it in an attestation. */
  ev: Event;
}

const HEX64 = /^[0-9a-f]{64}$/;
const nowSec = () => Math.floor(Date.now() / 1000);

function boundedString(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null;
  const s = x.trim();
  if (!s || s.length > max) return null;
  return s;
}

/** Build (and validate) a group descriptor for the admin to sign. Returns null
 *  if any field is out of bounds — callers surface that to the admin. */
export function makeGroupDescriptor(input: {
  name: string;
  category: string;
  subcategory?: string;
  topics?: string[];
}): GroupDescriptor | null {
  const name = boundedString(input.name, GROUP_NAME_MAX);
  const category = boundedString(input.category, GROUP_CATEGORY_MAX);
  if (!name || !category) return null;
  const descriptor: GroupDescriptor = { v: SCHEMA_VERSION, name, category };
  if (input.subcategory != null && input.subcategory !== '') {
    const sub = boundedString(input.subcategory, GROUP_CATEGORY_MAX);
    if (!sub) return null;
    descriptor.subcategory = sub;
  }
  if (input.topics && input.topics.length) {
    if (input.topics.length > GROUP_TOPICS_MAX) return null;
    const topics: string[] = [];
    for (const raw of input.topics) {
      const tp = boundedString(raw, GROUP_TOPIC_MAX);
      if (!tp) return null;
      topics.push(tp);
    }
    descriptor.topics = topics;
  }
  return descriptor;
}

/** Strict validation of a decoded descriptor (untrusted, from a link). */
export function validateGroupDescriptor(x: unknown): GroupDescriptor | null {
  if (typeof x !== 'object' || x === null) return null;
  const d = x as Record<string, unknown>;
  if (d.v !== SCHEMA_VERSION) return null;
  const name = boundedString(d.name, GROUP_NAME_MAX);
  const category = boundedString(d.category, GROUP_CATEGORY_MAX);
  if (!name || !category) return null;
  const out: GroupDescriptor = { v: SCHEMA_VERSION, name, category };
  if (d.subcategory !== undefined) {
    const sub = boundedString(d.subcategory, GROUP_CATEGORY_MAX);
    if (!sub) return null;
    out.subcategory = sub;
  }
  if (d.topics !== undefined) {
    if (!Array.isArray(d.topics) || d.topics.length > GROUP_TOPICS_MAX) return null;
    const topics: string[] = [];
    for (const raw of d.topics) {
      const tp = boundedString(raw, GROUP_TOPIC_MAX);
      if (!tp) return null;
      topics.push(tp);
    }
    out.topics = topics;
  }
  return out;
}

// ─── base64url over UTF-8 (Unicode-safe group names) ─────────────────────────

function b64urlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode an admin-signed group event into the URL payload. */
export function encodeGroupPayload(ev: Event): string {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(ev)));
}

/** Build the shareable group-invite link in the path form native apps deep-link. */
export function groupLink(base: string, ev: Event): string {
  return `${base.replace(/\/$/, '')}/g/${encodeGroupPayload(ev)}`;
}

/**
 * Extract the group payload from a share link. Accepts the path form
 * ("…/g/<payload>", matchable by Universal Links / App Links and the native
 * custom scheme). Base64url alphabet only.
 */
export function parseGroupLink(urlOrPayload: string): string | null {
  const m = /\/g\/([A-Za-z0-9_-]+)/.exec(urlOrPayload || '');
  return m ? m[1] : null;
}

/**
 * Verify an admin-signed group event → GroupInvite. Rejects a wrong kind, a bad
 * signature/id, or an invalid descriptor. Shared by decodeGroupInvite (link)
 * and parseGroupJoin (attestation). Returns null on anything untrusted.
 */
export function verifyGroupEvent(ev: unknown): GroupInvite | null {
  if (typeof ev !== 'object' || ev === null) return null;
  const e = ev as Record<string, unknown>;
  if (
    typeof e.id !== 'string' || !HEX64.test(e.id) ||
    typeof e.pubkey !== 'string' || !HEX64.test(e.pubkey) ||
    typeof e.sig !== 'string' ||
    typeof e.content !== 'string' ||
    typeof e.created_at !== 'number' ||
    e.kind !== KIND_GROUP_INVITE ||
    !Array.isArray(e.tags)
  ) return null;
  // Rebuild a clean event from ONLY the known fields. nostr-tools' verifyEvent
  // trusts a cached Symbol(verified) if present; reconstructing drops it (and any
  // other stowaway props) so signature + id are always recomputed from scratch.
  const clean: Event = {
    id: e.id,
    pubkey: e.pubkey,
    created_at: e.created_at,
    kind: e.kind,
    tags: e.tags as string[][],
    content: e.content,
    sig: e.sig as string,
  };
  let ok = false;
  try {
    ok = verifyEvent(clean);
  } catch {
    return null;
  }
  if (!ok) return null;
  let descriptor: GroupDescriptor | null = null;
  try {
    descriptor = validateGroupDescriptor(JSON.parse(clean.content));
  } catch {
    return null;
  }
  if (!descriptor) return null;
  return { gid: clean.id, admin: clean.pubkey, descriptor, ev: clean };
}

/** Decode + verify a group-invite payload taken from a link. */
export function decodeGroupInvite(payload: string): GroupInvite | null {
  let json: string;
  try {
    json = new TextDecoder().decode(b64urlDecode(payload));
  } catch {
    return null;
  }
  let ev: unknown;
  try {
    ev = JSON.parse(json);
  } catch {
    return null;
  }
  return verifyGroupEvent(ev);
}

// ─── Join attestation (KIND_GROUP_JOIN content) ──────────────────────────────

/** The content of a member's join attestation event. */
export interface GroupJoinEnvelope {
  v: number;
  /** Group id — must equal the embedded event's id (forgery guard). */
  gid: string;
  /** The admin-signed group invite event, embedded for independent verification. */
  group: Event;
  ts: number;
}

/** Build the JSON content for a member's join attestation. */
export function makeGroupJoinContent(invite: GroupInvite): string {
  const env: GroupJoinEnvelope = { v: SCHEMA_VERSION, gid: invite.gid, group: invite.ev, ts: nowSec() };
  return JSON.stringify(env);
}

/**
 * Parse + verify a join attestation's content → the group it attests to.
 * Verifies the embedded admin signature AND that the declared gid matches the
 * recomputed event id (mismatch = tamper → reject). Returns null otherwise.
 */
export function parseGroupJoin(json: string): GroupInvite | null {
  let env: GroupJoinEnvelope;
  try {
    env = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof env !== 'object' || env === null) return null;
  if (env.v !== SCHEMA_VERSION) return null;
  if (typeof env.gid !== 'string' || !HEX64.test(env.gid)) return null;
  const invite = verifyGroupEvent(env.group);
  if (!invite) return null;
  if (invite.gid !== env.gid) return null; // declared id must match the signed id
  return invite;
}

/**
 * Same-group matching (the "Same group" badge). Given the group ids the VIEWER
 * has joined and a peer's verified join attestations, return the name of a
 * shared group (or null). Pure so the badge logic is unit-testable.
 */
export function matchSameGroup(myGids: Set<string>, peerGroups: GroupInvite[]): string | null {
  for (const g of peerGroups) {
    if (myGids.has(g.gid)) return g.descriptor.name;
  }
  return null;
}
