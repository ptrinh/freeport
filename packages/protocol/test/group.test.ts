import { describe, it, expect } from 'vitest';
import { finalizeEvent, generateSecretKey, getPublicKey, type Event } from 'nostr-tools/pure';
import {
  makeGroupDescriptor,
  validateGroupDescriptor,
  encodeGroupPayload,
  groupLink,
  parseGroupLink,
  decodeGroupInvite,
  verifyGroupEvent,
  makeGroupJoinContent,
  parseGroupJoin,
  matchSameGroup,
  type GroupInvite,
  KIND_GROUP_INVITE,
  GROUP_NAME_MAX,
} from '../src/index.js';

const adminSk = generateSecretKey();
const adminPk = getPublicKey(adminSk);
const otherSk = generateSecretKey();

/** Sign a group-invite event the way the app's client does. */
function signInvite(sk: Uint8Array, descriptor: unknown, opts?: { kind?: number }): Event {
  return finalizeEvent(
    {
      kind: opts?.kind ?? KIND_GROUP_INVITE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'nonce-' + Math.random().toString(36).slice(2)]],
      content: JSON.stringify(descriptor),
    },
    sk,
  );
}

describe('group descriptor validation', () => {
  it('accepts a well-formed descriptor and drops empty optional fields', () => {
    const d = makeGroupDescriptor({ name: '  Hanoi Drivers  ', category: 'Ridesharing', subcategory: '' });
    expect(d).toEqual({ v: 1, name: 'Hanoi Drivers', category: 'Ridesharing' });
  });

  it('carries subcategory + topics when present', () => {
    const d = makeGroupDescriptor({ name: 'Cleaners', category: 'Home Services', subcategory: 'Cleaning', topics: ['district-1'] });
    expect(d).toEqual({ v: 1, name: 'Cleaners', category: 'Home Services', subcategory: 'Cleaning', topics: ['district-1'] });
  });

  it('rejects out-of-bounds fields', () => {
    expect(makeGroupDescriptor({ name: '', category: 'X' })).toBeNull();
    expect(makeGroupDescriptor({ name: 'x'.repeat(GROUP_NAME_MAX + 1), category: 'X' })).toBeNull();
    expect(makeGroupDescriptor({ name: 'ok', category: '' })).toBeNull();
    expect(makeGroupDescriptor({ name: 'ok', category: 'X', topics: Array(20).fill('t') })).toBeNull();
  });

  it('validateGroupDescriptor rejects junk and wrong version', () => {
    expect(validateGroupDescriptor(null)).toBeNull();
    expect(validateGroupDescriptor({ name: 'x', category: 'y' })).toBeNull(); // missing v
    expect(validateGroupDescriptor({ v: 99, name: 'x', category: 'y' })).toBeNull();
    expect(validateGroupDescriptor({ v: 1, name: 'x', category: 'y', topics: 'nope' })).toBeNull();
  });
});

describe('group invite link round-trip', () => {
  it('encodes and decodes a signed invite, exposing gid + admin', () => {
    const descriptor = makeGroupDescriptor({ name: 'Hà Nội Tài xế', category: 'Ridesharing' })!; // Unicode name
    const ev = signInvite(adminSk, descriptor);
    const link = groupLink('https://freeport.network', ev);
    expect(link).toContain('/g/');
    const payload = parseGroupLink(link);
    expect(payload).toBeTruthy();
    const invite = decodeGroupInvite(payload!);
    expect(invite).not.toBeNull();
    expect(invite!.gid).toBe(ev.id);
    expect(invite!.admin).toBe(adminPk);
    expect(invite!.descriptor.name).toBe('Hà Nội Tài xế');
  });

  it('parses the native custom-scheme path form', () => {
    const ev = signInvite(adminSk, makeGroupDescriptor({ name: 'G', category: 'Ridesharing' })!);
    const payload = encodeGroupPayload(ev);
    expect(parseGroupLink(`freeport://freeport.network/g/${payload}`)).toBe(payload);
    expect(parseGroupLink('https://freeport.network/i/abcdef')).toBeNull();
    expect(parseGroupLink('')).toBeNull();
  });
});

describe('group invite tamper rejection', () => {
  it('rejects a payload with the descriptor changed after signing', () => {
    const ev = signInvite(adminSk, makeGroupDescriptor({ name: 'Real', category: 'Ridesharing' })!);
    // Attacker rewrites the content but keeps the original id/sig → id mismatch.
    const forged = { ...ev, content: JSON.stringify({ v: 1, name: 'Hijacked', category: 'Crypto' }) };
    expect(verifyGroupEvent(forged)).toBeNull();
  });

  it('rejects a wrong kind and a malformed event', () => {
    const wrongKind = signInvite(adminSk, makeGroupDescriptor({ name: 'G', category: 'Ridesharing' })!, { kind: 1 });
    expect(verifyGroupEvent(wrongKind)).toBeNull();
    expect(verifyGroupEvent({ id: 'x', pubkey: 'y' })).toBeNull();
    expect(decodeGroupInvite('not-base64url!!')).toBeNull();
    expect(decodeGroupInvite('e30')).toBeNull(); // b64url of "{}"
  });
});

describe('group-join attestation', () => {
  function invite(sk: Uint8Array, name = 'Group'): GroupInvite {
    const ev = signInvite(sk, makeGroupDescriptor({ name, category: 'Ridesharing' })!);
    return verifyGroupEvent(ev)!;
  }

  it('round-trips a join attestation and re-verifies the embedded admin signature', () => {
    const inv = invite(adminSk);
    const parsed = parseGroupJoin(makeGroupJoinContent(inv));
    expect(parsed).not.toBeNull();
    expect(parsed!.gid).toBe(inv.gid);
    expect(parsed!.admin).toBe(adminPk);
  });

  it('rejects a join whose declared gid was swapped (forgery guard)', () => {
    const inv = invite(adminSk);
    const content = JSON.parse(makeGroupJoinContent(inv));
    content.gid = 'f'.repeat(64); // lie about the group id
    expect(parseGroupJoin(JSON.stringify(content))).toBeNull();
  });

  it('rejects a join embedding an unsigned/forged group event', () => {
    const inv = invite(adminSk);
    const content = JSON.parse(makeGroupJoinContent(inv));
    content.group.content = JSON.stringify({ v: 1, name: 'Fake', category: 'Crypto' });
    expect(parseGroupJoin(JSON.stringify(content))).toBeNull();
  });
});

describe('same-group matching', () => {
  it('returns the shared group name when gids intersect', () => {
    const mine = signInvite(adminSk, makeGroupDescriptor({ name: 'Drivers', category: 'Ridesharing' })!);
    const inv = verifyGroupEvent(mine)!;
    const myGids = new Set([inv.gid]);
    expect(matchSameGroup(myGids, [inv])).toBe('Drivers');
  });

  it('returns null when there is no overlap', () => {
    const a = verifyGroupEvent(signInvite(adminSk, makeGroupDescriptor({ name: 'A', category: 'Ridesharing' })!))!;
    const b = verifyGroupEvent(signInvite(otherSk, makeGroupDescriptor({ name: 'B', category: 'Ridesharing' })!))!;
    expect(matchSameGroup(new Set([a.gid]), [b])).toBeNull();
  });
});
