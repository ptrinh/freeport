import { describe, it, expect, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
import { getPublicKey } from 'nostr-tools/pure';
import { deriveSk } from '../src/passkey';
import { walletContacts } from '../src/deals';

describe('deriveSk (passkey PRF → account key)', () => {
  const prf = new Uint8Array(32).fill(42);

  it('is deterministic — same passkey, same account on every device', () => {
    expect(Buffer.from(deriveSk(prf)).toString('hex'))
      .toBe(Buffer.from(deriveSk(new Uint8Array(32).fill(42))).toString('hex'));
  });

  it('yields a valid secp256k1 key (usable as a Nostr identity)', () => {
    const sk = deriveSk(prf);
    expect(sk).toHaveLength(32);
    expect(getPublicKey(sk)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('different PRF outputs → different accounts', () => {
    expect(Buffer.from(deriveSk(new Uint8Array(32).fill(1))).toString('hex'))
      .not.toBe(Buffer.from(deriveSk(prf)).toString('hex'));
  });

  it('is domain-separated — not a bare hash of the PRF bytes', () => {
    const { sha256 } = require('@noble/hashes/sha2.js');
    expect(Buffer.from(deriveSk(prf)).toString('hex'))
      .not.toBe(Buffer.from(sha256(prf)).toString('hex'));
  });
});

describe('walletContacts (Send → Contacts source)', () => {
  const nego = (over: any) => ({
    state: 'confirmed', updatedAt: 100, theirContact: 'Anna Tran · +6512345678', theirPayAddress: 'sprt1qanna', ...over,
  });

  it('lists confirmed counterparties with addresses, newest first', () => {
    const out = walletContacts([
      nego({ updatedAt: 50, theirContact: 'Old Bob · +6011111111', theirPayAddress: 'bob@wallet.example' }),
      nego({ updatedAt: 200 }),
    ] as any);
    expect(out.map((c) => c.name)).toEqual(['Anna Tran', 'Old Bob']);
    expect(out[0].address).toBe('sprt1qanna');
  });

  it('dedupes by address and skips unconfirmed or address-less deals', () => {
    const out = walletContacts([
      nego({}),
      nego({ updatedAt: 300 }), // same address, newer — single entry
      nego({ state: 'open', theirPayAddress: 'sprt1qopen' }),
      nego({ theirPayAddress: undefined }),
    ] as any);
    expect(out).toHaveLength(1);
  });

  it('falls back to a truncated address when the contact has no name', () => {
    const out = walletContacts([nego({ theirContact: '' })] as any);
    expect(out[0].name.endsWith('…')).toBe(true);
  });
});
