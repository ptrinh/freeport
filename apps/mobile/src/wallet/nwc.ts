/**
 * Nostr Wallet Connect (NIP-47) provider — bring-your-own wallet.
 *
 * The user pastes a connection string from their wallet (Alby Hub, coinos,
 * Primal…): `nostr+walletconnect://<walletPubkey>?relay=<wss url>&secret=<hex>`.
 * Requests are kind-23194 events NIP-04-encrypted to the wallet's pubkey and
 * signed with the connection's own secret key (NOT the user's Freeport key —
 * the wallet connection is a separate, revocable identity). Responses come
 * back as kind-23195 events tagged with the request id.
 */
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey, type Event } from 'nostr-tools/pure';
import { encrypt as nip04Encrypt, decrypt as nip04Decrypt } from 'nostr-tools/nip04';
import type { ParsedDest, WalletBalance, WalletCapabilities, WalletInvoice, WalletProvider, WalletTx } from './types';
import { isLightningAddress, lnurlPayInvoice } from './lnurl';
import { bolt11Sats } from './bolt11';

const REQUEST_KIND = 23194;
const RESPONSE_KIND = 23195;
const TIMEOUT_MS = 30_000;

export interface NwcConnection {
  walletPubkey: string; // hex
  relays: string[];     // at least one wss url
  secret: string;       // hex 32-byte key (the connection identity)
  lud16?: string;
}

/** Parse a `nostr+walletconnect://` string. Returns null when malformed. */
export function parseNwcUrl(raw: string): NwcConnection | null {
  const s = (raw || '').trim();
  const m = s.match(/^nostr\+?walletconnect:\/\/([0-9a-fA-F]{64})\?(.*)$/) ||
            s.match(/^nostrwalletconnect:\/\/([0-9a-fA-F]{64})\?(.*)$/);
  if (!m) return null;
  const params = new URLSearchParams(m[2]);
  const relays = params.getAll('relay').filter((r) => /^wss?:\/\//.test(r));
  const secret = params.get('secret') ?? '';
  if (!relays.length || !/^[0-9a-fA-F]{64}$/.test(secret)) return null;
  return {
    walletPubkey: m[1].toLowerCase(),
    relays,
    secret: secret.toLowerCase(),
    lud16: params.get('lud16') ?? undefined,
  };
}

const hexToBytes = (hex: string): Uint8Array =>
  new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));

export class NwcProvider implements WalletProvider {
  readonly kind = 'nwc' as const;
  private pool = new SimplePool();
  private sk: Uint8Array;
  private pk: string;

  constructor(private conn: NwcConnection) {
    this.sk = hexToBytes(conn.secret);
    this.pk = getPublicKey(this.sk);
  }

  capabilities(): WalletCapabilities {
    return { lightning: true, stablecoin: false, transactions: true };
  }

  /** One NIP-47 request/response round-trip. */
  private async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const content = await nip04Encrypt(this.sk, this.conn.walletPubkey, JSON.stringify({ method, params }));
    const ev = finalizeEvent({
      kind: REQUEST_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', this.conn.walletPubkey]],
      content,
    }, this.sk);

    return new Promise<T>((resolve, reject) => {
      let done = false;
      const finish = (fn: () => void) => { if (!done) { done = true; clearTimeout(timer); sub.close(); fn(); } };
      const timer = setTimeout(() => finish(() => reject(new Error('wallet timeout'))), TIMEOUT_MS);
      // Subscribe for the response BEFORE publishing so a fast wallet can't
      // answer into the void.
      const sub = this.pool.subscribeMany(this.conn.relays, {
        kinds: [RESPONSE_KIND], authors: [this.conn.walletPubkey], '#e': [ev.id],
      } as any, {
        onevent: async (resp: Event) => {
          try {
            const plain = await nip04Decrypt(this.sk, this.conn.walletPubkey, resp.content);
            const body = JSON.parse(plain) as { result_type: string; error?: { code: string; message: string } | null; result?: T };
            if (body.error) finish(() => reject(new Error(body.error!.message || body.error!.code)));
            else finish(() => resolve(body.result as T));
          } catch (e) {
            finish(() => reject(e instanceof Error ? e : new Error('bad wallet response')));
          }
        },
      });
      Promise.allSettled(this.pool.publish(this.conn.relays, ev)).then((rs) => {
        if (!rs.some((r) => r.status === 'fulfilled')) finish(() => reject(new Error('no relay accepted the request')));
      });
    });
  }

  async info(): Promise<{ alias?: string }> {
    try {
      const r = await this.rpc<{ alias?: string }>('get_info');
      return { alias: r?.alias };
    } catch {
      return {}; // optional — some wallets don't implement get_info
    }
  }

  async balance(): Promise<WalletBalance> {
    const r = await this.rpc<{ balance: number }>('get_balance');
    return { sats: Math.floor((r?.balance ?? 0) / 1000) }; // msat → sat
  }

  async receive(sats: number, description?: string): Promise<WalletInvoice> {
    const r = await this.rpc<{ invoice: string }>('make_invoice', {
      amount: Math.max(0, Math.round(sats)) * 1000, // sat → msat
      ...(description ? { description } : {}),
    });
    if (!r?.invoice) throw new Error('wallet returned no invoice');
    return { invoice: r.invoice, sats };
  }

  async address(): Promise<string | null> {
    return this.conn.lud16 ?? null;
  }

  async parse(input: string): Promise<ParsedDest> {
    const raw = input.trim();
    if (/^(lightning:)?ln(bc|tbs|tb|bcrt)/i.test(raw)) {
      const inv = raw.replace(/^lightning:/i, '');
      return { kind: 'bolt11', raw: inv, sats: bolt11Sats(inv) };
    }
    if (isLightningAddress(raw)) return { kind: 'lightningAddress', raw };
    if (/^lnurl1/i.test(raw)) return { kind: 'lnurlPay', raw };
    return { kind: 'unknown', raw };
  }

  async fiatRate(_coin: string): Promise<number | null> {
    return null; // NIP-47 has no rate feed
  }

  async receiveOnchain(): Promise<string | null> {
    return null;
  }

  async pay(destination: string, sats?: number): Promise<{ preimage?: string }> {
    let invoice = destination.trim();
    if (!/^ln/i.test(invoice)) {
      // NWC speaks bolt11 only. A lightning address resolves to one; anything
      // else (e.g. a Spark address) is out of reach for this wallet.
      if (!isLightningAddress(invoice)) throw new Error('unsupported-address');
      if (!sats || sats <= 0) throw new Error('amount-required');
      invoice = await lnurlPayInvoice(invoice, sats);
    }
    const r = await this.rpc<{ preimage?: string }>('pay_invoice', { invoice });
    return { preimage: r?.preimage };
  }

  async transactions(limit = 20): Promise<WalletTx[]> {
    try {
      const r = await this.rpc<{ transactions: Array<{ type: string; amount: number; description?: string; settled_at?: number; created_at: number }> }>(
        'list_transactions', { limit },
      );
      return (r?.transactions ?? []).map((tx) => ({
        direction: tx.type === 'incoming' ? 'in' as const : 'out' as const,
        sats: Math.floor((tx.amount ?? 0) / 1000),
        description: tx.description || undefined,
        ts: tx.settled_at || tx.created_at,
        settled: !!tx.settled_at,
      }));
    } catch {
      return []; // optional method — degrade to no history
    }
  }

  close(): void {
    try { this.pool.close(this.conn.relays); } catch { /* ignore */ }
  }
}
