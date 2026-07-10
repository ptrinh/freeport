/**
 * Built-in wallet seed — derived from the user's Nostr key.
 *
 * entropy = SHA-256("freeport-wallet-v1" || sk) → 24-word BIP-39 mnemonic.
 * Deterministic, so restoring the Freeport account (nsec/ncryptsec backup)
 * restores the wallet too — one backup covers both. Domain-separated so the
 * raw signing key is never reused as wallet key material. The flip side is
 * inherent to determinism: whoever holds the nsec can re-derive the wallet.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const DOMAIN_TAG = 'freeport-wallet-v1';

export function deriveWalletMnemonic(sk: Uint8Array): string {
  const tag = new TextEncoder().encode(DOMAIN_TAG);
  const input = new Uint8Array(tag.length + sk.length);
  input.set(tag, 0);
  input.set(sk, tag.length);
  return entropyToMnemonic(sha256(input), wordlist);
}
