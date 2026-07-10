import { describe, it, expect } from 'vitest';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { deriveWalletMnemonic } from '../src/wallet/seed';
import { mapSparkPayments } from '../src/wallet/breezMap';

describe('deriveWalletMnemonic', () => {
  const sk = new Uint8Array(32).fill(7);

  it('produces a valid 24-word BIP-39 mnemonic', () => {
    const m = deriveWalletMnemonic(sk);
    expect(m.split(' ')).toHaveLength(24);
    expect(validateMnemonic(m, wordlist)).toBe(true);
  });

  it('is deterministic — same key, same wallet', () => {
    expect(deriveWalletMnemonic(sk)).toBe(deriveWalletMnemonic(new Uint8Array(32).fill(7)));
  });

  it('differs for a different key', () => {
    expect(deriveWalletMnemonic(new Uint8Array(32).fill(8))).not.toBe(deriveWalletMnemonic(sk));
  });

  it('is domain-separated — not a plain hash of the key bytes', () => {
    // sanity: the mnemonic entropy must not equal sha256(sk) without the tag
    const { sha256 } = require('@noble/hashes/sha2.js');
    const { entropyToMnemonic } = require('@scure/bip39');
    expect(deriveWalletMnemonic(sk)).not.toBe(entropyToMnemonic(sha256(sk), wordlist));
  });
});

describe('mapSparkPayments', () => {
  it('maps direction, sats, settlement and lightning descriptions', () => {
    const txs = mapSparkPayments([
      { paymentType: 'receive', status: 'completed', amount: 1500n, timestamp: 1700000000, details: { type: 'lightning', description: 'coffee' } },
      { paymentType: 'send', status: 'pending', amount: 42, timestamp: 1700000100, details: { type: 'spark' } },
    ]);
    expect(txs).toEqual([
      { direction: 'in', sats: 1500, description: 'coffee', ts: 1700000000, settled: true },
      { direction: 'out', sats: 42, description: undefined, ts: 1700000100, settled: false },
    ]);
  });

  it('drops failed payments and empty descriptions', () => {
    const txs = mapSparkPayments([
      { paymentType: 'send', status: 'failed', amount: 10n, timestamp: 1 },
      { paymentType: 'receive', status: 'completed', amount: 5n, timestamp: 2, details: { type: 'lightning', description: '' } },
    ]);
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({ direction: 'in', sats: 5, description: undefined, settled: true });
  });
});
