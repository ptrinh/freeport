/**
 * NIP-13 proof-of-work mining — WEB.
 *
 * Mines with a WebAssembly SHA-256 (hash-wasm) instead of the pure-JS hasher in
 * nostr-tools, which is markedly faster per hash, and runs the loop in yielding
 * chunks so the main thread stays responsive even at higher difficulty. The
 * WASM is inlined (base64) inside hash-wasm, so no .wasm asset/bundler config is
 * needed. Falls back to the JS miner if WebAssembly is unavailable.
 *
 * The id we compute here matches nostr-tools' getEventHash exactly (same NIP-01
 * serialization), so the appended `nonce` tag is valid PoW that survives signing.
 */
import { minePow as minePowJs } from 'nostr-tools/nip13';
import { createSHA256, type IHasher } from 'hash-wasm';
import type { MineTemplate } from './pow';

let hasherPromise: Promise<IHasher> | null = null;
function getHasher(): Promise<IHasher> {
  if (!hasherPromise) hasherPromise = createSHA256();
  return hasherPromise;
}

// NIP-01 canonical serialization (must match nostr-tools getEventHash).
function serialize(e: MineTemplate): string {
  return JSON.stringify([0, e.pubkey, e.created_at, e.kind, e.tags, e.content]);
}

// Leading zero bits of a hex digest — matches nostr-tools getPow.
function leadingZeroBits(hex: string): number {
  let n = 0;
  for (let i = 0; i < hex.length; i++) {
    const nib = parseInt(hex[i], 16);
    if (nib === 0) { n += 4; continue; }
    n += Math.clz32(nib) - 28; // leading zeros within this 4-bit nibble
    break;
  }
  return n;
}

const CHUNK = 20000; // hashes mined between UI yields

export async function minePowAsync<T extends MineTemplate>(template: T, difficulty: number): Promise<T> {
  if (!difficulty || difficulty <= 0) return template;
  let hasher: IHasher;
  try { hasher = await getHasher(); }
  catch { return minePowJs(template as any, difficulty) as unknown as T; } // no WASM → JS fallback

  const evt = template;
  const tag = ['nonce', '0', String(difficulty)];
  evt.tags = [...evt.tags, tag];
  let count = 0;
  for (;;) {
    for (let i = 0; i < CHUNK; i++) {
      tag[1] = String(++count);
      hasher.init();
      hasher.update(serialize(evt));
      const hex = hasher.digest('hex');
      if (leadingZeroBits(hex) >= difficulty) { evt.id = hex; return evt; }
    }
    await new Promise<void>((r) => setTimeout(r, 0)); // yield so the UI stays live
  }
}
