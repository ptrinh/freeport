/**
 * NIP-13 proof-of-work mining for outgoing events (anti-spam + ranking weight).
 *
 * This native variant uses nostr-tools' pure-JS miner: Hermes has no
 * WebAssembly, and the difficulties we mine (≤12 bits) finish in well under a
 * millisecond synchronously. The WEB build swaps in pow.web.ts, which mines with
 * a WebAssembly SHA-256 (hash-wasm) in yielding chunks so the UI never freezes —
 * letting the browser app sustain higher difficulty smoothly.
 *
 * The mined `nonce` tag survives signing: finalizeEvent recomputes the SAME id
 * from the tags, so the published event keeps its proof-of-work.
 */
import { minePow } from 'nostr-tools/nip13';

export interface MineTemplate {
  pubkey: string;
  kind: number;
  created_at: number;
  tags: string[][];
  content: string;
  id?: string;
}

/** Mine `template` to at least `difficulty` leading zero bits. Async so the web
 *  build can yield to the UI; native resolves synchronously under the hood. */
export async function minePowAsync<T extends MineTemplate>(template: T, difficulty: number): Promise<T> {
  if (!difficulty || difficulty <= 0) return template;
  return minePow(template as any, difficulty) as unknown as T;
}
