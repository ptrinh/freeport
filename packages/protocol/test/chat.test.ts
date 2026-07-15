import { describe, it, expect } from 'vitest';
import {
  inviteCodeFor,
  mintInviteCode,
  verifyInviteCode,
  parseInviteLink,
  parseChatEnvelope,
  makeChatInvite,
  makeChatAccept,
  makeChatReject,
  makeChatMsg,
  makeChatAck,
  parseNegotiationMessage,
  INVITE_CODE_LENGTH,
  CHAT_MSG,
} from '../src/index.js';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);

describe('invite code commitment', () => {
  it('mints a deterministic, verifiable code', () => {
    const { code, nonce } = mintInviteCode(PK_A);
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect(code).toMatch(/^[a-z2-7]+$/); // base32, QR/URL-friendly
    expect(inviteCodeFor(PK_A, nonce)).toBe(code);
    expect(verifyInviteCode(code, PK_A, nonce)).toBe(true);
  });

  it('rejects a hijack: same code + nonce under a DIFFERENT pubkey', () => {
    // The attack the commitment exists for — an attacker watches relays,
    // republishes the victim's d-tag (code) + nonce under their own key.
    const { code, nonce } = mintInviteCode(PK_A);
    expect(verifyInviteCode(code, PK_B, nonce)).toBe(false);
  });

  it('rejects a swapped nonce and malformed inputs', () => {
    const a = mintInviteCode(PK_A);
    const b = mintInviteCode(PK_A);
    expect(verifyInviteCode(a.code, PK_A, b.nonce)).toBe(false);
    expect(verifyInviteCode('short', PK_A, a.nonce)).toBe(false);
    expect(verifyInviteCode(a.code, 'not-hex', a.nonce)).toBe(false);
    expect(verifyInviteCode(a.code, PK_A, 'zz')).toBe(false);
  });

  it('two mints for the same pubkey produce different codes (fresh nonce)', () => {
    expect(mintInviteCode(PK_A).code).not.toBe(mintInviteCode(PK_A).code);
  });

  it('parses invite links and hashes', () => {
    const { code } = mintInviteCode(PK_A);
    expect(parseInviteLink(`https://freeport.network/#invite=${code}`)).toBe(code);
    expect(parseInviteLink(`#invite=${code}`)).toBe(code);
    // Path form (Universal Links / App Links), incl. a native custom-scheme URL.
    expect(parseInviteLink(`https://freeport.network/i/${code}`)).toBe(code);
    expect(parseInviteLink(`freeport://freeport.network/i/${code}`)).toBe(code);
    expect(parseInviteLink('#t=abcdef')).toBeNull();
    expect(parseInviteLink('https://freeport.network/introduction')).toBeNull();
    expect(parseInviteLink('')).toBeNull();
  });
});

describe('chat envelopes', () => {
  it('round-trips every type', () => {
    for (const env of [
      makeChatInvite('Phil'),
      makeChatAccept(),
      makeChatReject(),
      makeChatMsg('hello'),
      makeChatAck('read', 123, 456),
    ]) {
      const parsed = parseChatEnvelope(JSON.stringify(env));
      expect(parsed).toEqual(env);
    }
  });

  it('rejects junk, empty messages and bad acks', () => {
    expect(parseChatEnvelope('not json')).toBeNull();
    expect(parseChatEnvelope('{}')).toBeNull();
    expect(parseChatEnvelope(JSON.stringify({ v: 1, type: CHAT_MSG, text: '  ', ts: 1 }))).toBeNull();
    expect(parseChatEnvelope(JSON.stringify({ v: 1, type: 'chat.ack', ack: 'nope', ts: 1 }))).toBeNull();
    expect(parseChatEnvelope(JSON.stringify({ v: 99, type: CHAT_MSG, text: 'x', ts: 1 }))).toBeNull();
  });

  it('the two envelope families never cross-parse', () => {
    // A chat envelope must not be mistaken for a negotiation message (it
    // would land in pendingMsgs forever) and vice versa.
    const chat = JSON.stringify(makeChatMsg('hi'));
    expect(parseNegotiationMessage(chat)).toBeNull();
    const nego = JSON.stringify({ v: 1, type: 'negotiate.chat', nego: 'n', intent_id: 'i', intent_d: 'd', market: 'm', text: 'hi', ts: 1 });
    expect(parseChatEnvelope(nego)).toBeNull();
  });
});
