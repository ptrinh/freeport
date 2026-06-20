/**
 * Signing abstraction so the app works with either a locally-stored key
 * (native + web fallback) or a NIP-07 browser extension (Alby, nos2x) where
 * the private key never enters the site.
 */
import { finalizeEvent, getPublicKey, type Event, type EventTemplate } from 'nostr-tools/pure';
import * as nip04 from 'nostr-tools/nip04';

export interface Signer {
  readonly pubkey: string;
  signEvent(template: EventTemplate): Promise<Event>;
  nip04Encrypt(peer: string, plaintext: string): Promise<string>;
  nip04Decrypt(peer: string, ciphertext: string): Promise<string>;
  /** The raw secret key — present only for the local signer (enables backup). */
  readonly secretKey: Uint8Array | null;
}

/** Local key signer — holds the secret key in memory. */
export class LocalSigner implements Signer {
  readonly pubkey: string;
  constructor(private sk: Uint8Array) {
    this.pubkey = getPublicKey(sk);
  }
  get secretKey(): Uint8Array { return this.sk; }
  async signEvent(t: EventTemplate): Promise<Event> {
    return finalizeEvent(t, this.sk);
  }
  async nip04Encrypt(peer: string, plaintext: string): Promise<string> {
    return nip04.encrypt(this.sk, peer, plaintext);
  }
  async nip04Decrypt(peer: string, ciphertext: string): Promise<string> {
    return nip04.decrypt(this.sk, peer, ciphertext);
  }
}

/** Minimal shape of a NIP-07 provider on `window.nostr`. */
interface Nip07Provider {
  getPublicKey(): Promise<string>;
  signEvent(event: EventTemplate & { pubkey: string }): Promise<Event>;
  nip04?: {
    encrypt(pubkey: string, plaintext: string): Promise<string>;
    decrypt(pubkey: string, ciphertext: string): Promise<string>;
  };
}

function getProvider(): Nip07Provider | null {
  return (globalThis as any)?.nostr ?? null;
}

/** True if a NIP-07 extension is present (web only). */
export function hasNip07(): boolean {
  return !!getProvider();
}

/** NIP-07 signer — delegates to the browser extension; no secret key in-app. */
export class Nip07Signer implements Signer {
  private constructor(readonly pubkey: string, private provider: Nip07Provider) {}
  readonly secretKey = null;

  static async connect(): Promise<Nip07Signer> {
    const provider = getProvider();
    if (!provider) throw new Error('No NIP-07 extension found.');
    const pubkey = await provider.getPublicKey();
    if (!pubkey) throw new Error('Extension did not return a public key.');
    return new Nip07Signer(pubkey, provider);
  }

  async signEvent(t: EventTemplate): Promise<Event> {
    return this.provider.signEvent({ ...t, pubkey: this.pubkey });
  }
  async nip04Encrypt(peer: string, plaintext: string): Promise<string> {
    if (!this.provider.nip04) throw new Error('Extension does not support NIP-04 encryption.');
    return this.provider.nip04.encrypt(peer, plaintext);
  }
  async nip04Decrypt(peer: string, ciphertext: string): Promise<string> {
    if (!this.provider.nip04) throw new Error('Extension does not support NIP-04 decryption.');
    return this.provider.nip04.decrypt(peer, ciphertext);
  }
}
