/**
 * Friend chat (peer-to-peer, deal-independent) — protocol pieces:
 *
 *  - Invite codes: short shareable codes that resolve to a pubkey via relays
 *    (no directory service). The code commits to the inviter's pubkey so a
 *    third party can't hijack it by republishing the same d-tag (see
 *    KIND_CHAT_INVITE in constants.ts).
 *  - Chat envelopes: JSON messages inside encrypted DMs (`chat.*`), parsed
 *    before the negotiation envelope family. Keyed purely on the sender
 *    pubkey — a conversation IS the peer, there is no thread id.
 *
 * Transport is NIP-04 today behind the client's send/watch seam; swapping to
 * NIP-17 gift wrap changes the wire format only, nothing here.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { CHAT_ACCEPT, CHAT_ACK, CHAT_INVITE, CHAT_MSG, CHAT_REACT, CHAT_REJECT, CHAT_TTL, SCHEMA_VERSION, type ChatMsgType } from './constants.js';

/** Base32 (lowercase, no padding) — URL/QR-friendly, unambiguous casing. */
const B32 = 'abcdefghijklmnopqrstuvwxyz234567';

/** Invite-code length: 10 chars × 5 bits = 50 bits of the commitment hash. */
export const INVITE_CODE_LENGTH = 10;

function toB32(bytes: Uint8Array, chars: number): string {
  let bits = 0;
  let acc = 0;
  let out = '';
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < chars) {
      out += B32[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
    if (out.length >= chars) break;
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** The commitment: base32(sha256(pubkey ‖ nonce))[:10]. Pubkey and nonce are hex. */
export function inviteCodeFor(pubkeyHex: string, nonceHex: string): string {
  const digest = sha256(hexToBytes(pubkeyHex + nonceHex));
  return toB32(digest, INVITE_CODE_LENGTH);
}

/** Mint a fresh invite: random 16-byte nonce → code committed to the pubkey. */
export function mintInviteCode(pubkeyHex: string): { code: string; nonce: string } {
  const rnd = new Uint8Array(16);
  globalThis.crypto.getRandomValues(rnd);
  const nonce = [...rnd].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { code: inviteCodeFor(pubkeyHex, nonce), nonce };
}

/**
 * Verify a resolved invite event: does this (author, nonce) actually hash to
 * the code we looked up? False = forgery (someone republished the code under
 * their own key) — discard the event.
 */
export function verifyInviteCode(code: string, pubkeyHex: string, nonceHex: string): boolean {
  if (typeof code !== 'string' || code.length !== INVITE_CODE_LENGTH) return false;
  if (!/^[0-9a-f]{64}$/.test(pubkeyHex) || !/^[0-9a-f]+$/.test(nonceHex)) return false;
  return inviteCodeFor(pubkeyHex, nonceHex) === code;
}

/** Extract an invite code from a share link's fragment ("…#invite=<code>"). */
export function parseInviteLink(urlOrHash: string): string | null {
  const m = /#invite=([a-z2-7]{6,16})\b/.exec(urlOrHash || '');
  return m ? m[1] : null;
}

// ─── Chat envelopes ──────────────────────────────────────────────────────────

export interface ChatEnvelope {
  v: number;
  type: ChatMsgType;
  /** Free text (chat.msg). */
  text?: string;
  /** Sender's display name (chat.invite / chat.accept) so the row has a label
   *  before the kind:0 profile loads. */
  name?: string;
  /** chat.ack: receipt level. */
  ack?: 'delivered' | 'read';
  /** chat.ack: everything the sender received/read up to this ts (inclusive). */
  up_to?: number;
  /** chat.ack: sender's last-seen ts — only sent when their "Show last seen"
   *  toggle is on; only ever flows to accepted contacts (the ack channel). */
  last_seen?: number;
  /** chat.invite / chat.accept: sender's lightning address (in-chat payments). */
  pay?: string;
  /** chat.invite / chat.accept: sender can speak NIP-17 gift wrap — when both
   *  sides flag it, post-handshake traffic (msg/react/ttl/ack + call.*)
   *  upgrades to kind-1059 wraps and relays stop seeing the social graph. */
  n17?: boolean;
  /** chat.msg: id of the message being replied to (its DM event id). */
  reply_to?: string;
  /** chat.msg: short snapshot of the quoted text (render without lookup). */
  quote?: string;
  /** chat.msg: disappearing-messages TTL (seconds from ts). Authoritative —
   *  the receiver expires by this, not by its own timer setting. */
  expires_in?: number;
  /** chat.react: DM event id of the target message. */
  target?: string;
  /** chat.react: the emoji ('' = remove my reaction). */
  emoji?: string;
  /** chat.ttl: per-conversation disappearing timer in seconds (0 = off). */
  seconds?: number;
  ts: number;
}

const nowSec = () => Math.floor(Date.now() / 1000);

export const makeChatInvite = (name?: string, pay?: string, n17?: boolean): ChatEnvelope =>
  ({ v: SCHEMA_VERSION, type: CHAT_INVITE, ...(name ? { name } : {}), ...(pay ? { pay } : {}), ...(n17 ? { n17 } : {}), ts: nowSec() });
export const makeChatAccept = (name?: string, pay?: string, n17?: boolean): ChatEnvelope =>
  ({ v: SCHEMA_VERSION, type: CHAT_ACCEPT, ...(name ? { name } : {}), ...(pay ? { pay } : {}), ...(n17 ? { n17 } : {}), ts: nowSec() });
export const makeChatReject = (): ChatEnvelope =>
  ({ v: SCHEMA_VERSION, type: CHAT_REJECT, ts: nowSec() });
export const makeChatMsg = (text: string, opts?: { replyTo?: string; quote?: string; expiresIn?: number }): ChatEnvelope =>
  ({ v: SCHEMA_VERSION, type: CHAT_MSG, text,
     ...(opts?.replyTo ? { reply_to: opts.replyTo, ...(opts.quote ? { quote: opts.quote.slice(0, 80) } : {}) } : {}),
     ...(opts?.expiresIn ? { expires_in: opts.expiresIn } : {}),
     ts: nowSec() });
export const makeChatReact = (target: string, emoji: string): ChatEnvelope =>
  ({ v: SCHEMA_VERSION, type: CHAT_REACT, target, emoji, ts: nowSec() });
export const makeChatTtl = (seconds: number): ChatEnvelope =>
  ({ v: SCHEMA_VERSION, type: CHAT_TTL, seconds, ts: nowSec() });
export const makeChatAck = (ack: 'delivered' | 'read', upTo: number, lastSeen?: number): ChatEnvelope =>
  ({ v: SCHEMA_VERSION, type: CHAT_ACK, ack, up_to: upTo, ...(lastSeen ? { last_seen: lastSeen } : {}), ts: nowSec() });

/**
 * Parse a decrypted DM as a chat envelope. Returns null for anything else
 * (negotiation envelopes, foreign DMs) — mirror of parseNegotiationMessage.
 */
export function parseChatEnvelope(json: string): ChatEnvelope | null {
  let msg: ChatEnvelope;
  try {
    msg = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof msg !== 'object' || msg === null) return null;
  if (msg.v !== SCHEMA_VERSION) return null;
  const VALID: ChatMsgType[] = [CHAT_INVITE, CHAT_ACCEPT, CHAT_REJECT, CHAT_MSG, CHAT_ACK, CHAT_REACT, CHAT_TTL];
  if (!VALID.includes(msg.type)) return null;
  if (typeof msg.ts !== 'number') return null;
  if (msg.type === CHAT_MSG && (typeof msg.text !== 'string' || !msg.text.trim())) return null;
  if (msg.type === CHAT_ACK && (msg.ack !== 'delivered' && msg.ack !== 'read')) return null;
  if (msg.type === CHAT_REACT && (typeof msg.target !== 'string' || !msg.target || typeof msg.emoji !== 'string')) return null;
  if (msg.type === CHAT_TTL && (typeof msg.seconds !== 'number' || msg.seconds < 0)) return null;
  return msg;
}
