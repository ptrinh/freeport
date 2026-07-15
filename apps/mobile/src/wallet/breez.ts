/**
 * Breez SDK Spark provider — the built-in self-custodial wallet (default).
 *
 * Everything here is LAZY: the SDK (11MB WASM on web, a native TurboModule on
 * iOS/Android) is only loaded when the user actually opens the Wallet tab
 * with no NWC wallet configured. On binaries that don't carry the native
 * module yet (pre-Breez store builds running this code via OTA) the dynamic
 * import throws, we return null, and the UI falls back to the
 * "coming in a future app update" card — nothing crashes.
 *
 * Web specifics: the SDK's wasm-bindgen glue resolves its .wasm via
 * `import.meta.url`, which Metro can't turn into a servable URL. We instead
 * copy the .wasm to /public at install time (scripts/copy-breez-wasm.mjs),
 * fetch + compile it ourselves and hand the module to initSync().
 *
 * The wallet seed is derived from the Nostr key (see seed.ts) — restoring the
 * account restores the wallet.
 */
import { Platform } from 'react-native';
import { loadKey } from '../identity';
import { deriveWalletMnemonic } from './seed';
import { mapSparkPayments } from './breezMap';
import { importBreezNative } from './breezNative';
import {
  bitcoinAddressMethod, bolt11ReceiveMethod, bolt11SendOptions, inputPaymentRequest,
  paymentFailed, sparkAddressMethod, sparkInvoiceMethod, variantDetails, variantOf,
} from './breezShapes';
import { toBaseUnits, fromBaseUnits } from './tokens';
import type { ParsedDest, TokenBalanceInfo, WalletBalance, WalletCapabilities, WalletInvoice, WalletProvider, WalletTx } from './types';

const API_KEY = process.env.EXPO_PUBLIC_BREEZ_API_KEY || '';
const WASM_URL = '/breez_sdk_spark_wasm_bg.wasm';
// The offline single-file build can't serve the wasm from file:// — fetch it
// from the canonical host instead (CORS-open, see deploy-web.sh _headers) and
// keep a copy in IndexedDB so the wallet still works fully offline afterwards.
const REMOTE_WASM_URL = 'https://freeport.network/breez_sdk_spark_wasm_bg.wasm';
const WASM_CACHE_DB = 'freeport-wallet-wasm';

async function fetchWasm(url: string): Promise<ArrayBuffer | null> {
  try {
    const r = await fetch(url);
    return r.ok ? await r.arrayBuffer() : null;
  } catch { return null; }
}

function wasmCache(mode: 'get' | 'put', bytes?: ArrayBuffer): Promise<ArrayBuffer | null> {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(WASM_CACHE_DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('files');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('files', mode === 'get' ? 'readonly' : 'readwrite');
        const store = tx.objectStore('files');
        if (mode === 'get') {
          const req = store.get('wasm');
          req.onsuccess = () => resolve(req.result instanceof ArrayBuffer ? req.result : null);
          req.onerror = () => resolve(null);
        } else {
          store.put(bytes!, 'wasm');
          tx.oncomplete = () => resolve(null);
          tx.onerror = () => resolve(null);
        }
      };
    } catch { resolve(null); }
  });
}

/** Same-origin asset → canonical host (cached to IndexedDB) → offline cache. */
async function loadWasmBytes(): Promise<ArrayBuffer> {
  let bytes = await fetchWasm(WASM_URL);
  if (!bytes) {
    bytes = await fetchWasm(REMOTE_WASM_URL);
    if (bytes) void wasmCache('put', bytes);
    else bytes = await wasmCache('get');
  }
  if (!bytes) throw new Error('wallet wasm unavailable');
  return bytes;
}

/** Returns the connected SDK plus, on native, the module namespace `M` that
 *  holds the generated uniffi enum classes (null on web — see breezShapes). */
async function loadSdk(mnemonic: string): Promise<{ sdk: any; M: any | null }> {
  if (Platform.OS === 'web') {
    const mod: any = await import('@breeztech/breez-sdk-spark/web');
    // The package's default init() would re-do this via import.meta.url;
    // replicate its two steps (IndexedDB storage hook + wasm init) manually.
    try {
      // @ts-expect-error — the /storage subpath ships no type declarations
      const storage: any = await import('@breeztech/breez-sdk-spark/storage');
      (globalThis as any).createDefaultStorage = storage.createDefaultStorage;
    } catch { /* SDK warns and uses its fallback */ }
    // Async instantiation (via the patched default init) — Chrome forbids
    // synchronous WebAssembly.Instance above 8MB on the main thread.
    await mod.default({ module_or_path: await loadWasmBytes() });
    const config = mod.defaultConfig('mainnet');
    config.apiKey = API_KEY;
    config.lnurlDomain = 'freeport.network';
    const sdk = await mod.connect({
      config,
      seed: { type: 'mnemonic', mnemonic, passphrase: undefined },
      storageDir: 'freeport-wallet',
    });
    return { sdk, M: null };
  }
  // Native: guarded — importing the package on a binary without the
  // TurboModule hard-crashes the app (see breezNative.ts).
  const mod: any = await importBreezNative();
  if (!mod) throw new Error('wallet-unavailable-in-binary');
  await mod.uniffiInitAsync?.();
  const FS: any = await import('expo-file-system/legacy');
  const dir = String(FS.documentDirectory || '').replace(/^file:\/\//, '') + 'breez';
  const config = mod.defaultConfig(mod.Network.Mainnet);
  config.apiKey = API_KEY;
    config.lnurlDomain = 'freeport.network';
  const seed = new mod.Seed.Mnemonic({ mnemonic, passphrase: undefined });
  return { sdk: await mod.connect({ config, seed, storageDir: dir }), M: mod };
}

export class BreezSparkProvider implements WalletProvider {
  readonly kind = 'breez-spark' as const;

  /** `M` = native uniffi enum namespace, null on web (see breezShapes.ts). */
  constructor(private sdk: any, private M: any | null = null) {}

  capabilities(): WalletCapabilities {
    return { lightning: true, stablecoin: true, transactions: true };
  }

  async info(): Promise<{ alias?: string }> {
    return {};
  }

  async balance(): Promise<WalletBalance> {
    const r = await this.sdk.getInfo({ ensureSynced: false });
    return { sats: Number(r?.balanceSats ?? 0) };
  }

  async receive(sats: number, description?: string): Promise<WalletInvoice> {
    const r = await this.sdk.receivePayment({
      paymentMethod: bolt11ReceiveMethod(this.M, sats, description ?? ''),
    });
    if (!r?.paymentRequest) throw new Error('wallet returned no invoice');
    return { invoice: r.paymentRequest, sats };
  }

  async address(): Promise<string | null> {
    const r = await this.sdk.receivePayment({ paymentMethod: sparkAddressMethod(this.M) });
    return r?.paymentRequest || null;
  }

  async pay(destination: string, sats?: number): Promise<{ preimage?: string }> {
    const input = destination.trim();
    const isBolt11 = /^ln(bc|tbs|tb|bcrt)/i.test(input);
    if (!isBolt11 && (!sats || sats <= 0)) throw new Error('amount-required');

    // Lightning addresses (user@domain) and LNURL-pay are NOT valid
    // SendPaymentMethods: prepareSendPayment only accepts bolt11 / Bitcoin /
    // Spark, and rejects these two with the SDK's verbatim
    // "Unsupported payment method". They must resolve to a bolt11 invoice
    // through the dedicated LNURL-pay flow (prepareLnurlPay → lnurlPay).
    if (!isBolt11) {
      const parsed = await this.sdk.parse(input);
      const variant = variantOf(parsed);
      if (variant === 'lightningaddress' || variant === 'lnurlpay') {
        const details = variantDetails(parsed);
        // lightningAddress wraps the LNURL details in `payRequest`; a bare
        // lnurlPay *is* those details.
        const payRequest = variant === 'lightningaddress' ? details?.payRequest : details;
        const prepared = await this.sdk.prepareLnurlPay({ amount: BigInt(Math.round(sats!)), payRequest });
        const r = await this.sdk.lnurlPay({ prepareResponse: prepared });
        if (paymentFailed(r?.payment?.status)) throw new Error('payment failed');
        return {};
      }
    }

    // bolt11 / Bitcoin address / Spark address → SendPayment.
    const prepared = await this.sdk.prepareSendPayment({
      paymentRequest: inputPaymentRequest(this.M, input),
      ...(isBolt11 ? {} : { amount: BigInt(Math.round(sats!)) }),
    });
    const r = await this.sdk.sendPayment({
      prepareResponse: prepared,
      ...(isBolt11 ? { options: bolt11SendOptions(this.M) } : {}),
    });
    if (paymentFailed(r?.payment?.status)) throw new Error('payment failed');
    return {};
  }

  async transactions(limit = 20): Promise<WalletTx[]> {
    try {
      const r = await this.sdk.listPayments({ limit, sortAscending: false });
      return mapSparkPayments(r?.payments ?? []);
    } catch {
      return [];
    }
  }

  async tokenBalances(): Promise<TokenBalanceInfo[]> {
    try {
      const info = await this.sdk.getInfo({ ensureSynced: false });
      const out: TokenBalanceInfo[] = [];
      const entries: Iterable<[string, any]> =
        info?.tokenBalances instanceof Map ? info.tokenBalances.entries() : Object.entries(info?.tokenBalances ?? {});
      for (const [, tb] of entries) {
        const md = tb?.tokenMetadata;
        if (!md) continue;
        out.push({
          id: md.identifier,
          ticker: md.ticker || md.name || 'TOKEN',
          name: md.name || md.ticker || 'Token',
          decimals: Number(md.decimals ?? 0),
          amount: fromBaseUnits(tb.balance ?? 0n, Number(md.decimals ?? 0)),
        });
      }
      return out;
    } catch { return []; }
  }

  async receiveToken(token: TokenBalanceInfo, amount: number | string, description?: string): Promise<WalletInvoice> {
    const r = await this.sdk.receivePayment({
      paymentMethod: sparkInvoiceMethod(this.M, token.id, toBaseUnits(amount, token.decimals), description),
    });
    if (!r?.paymentRequest) throw new Error('wallet returned no invoice');
    return { invoice: r.paymentRequest, sats: 0 };
  }

  async payToken(destination: string, token: TokenBalanceInfo, amount: number | string): Promise<{ preimage?: string }> {
    const prepared = await this.sdk.prepareSendPayment({
      paymentRequest: inputPaymentRequest(this.M, destination.trim()),
      amount: toBaseUnits(amount, token.decimals),
      tokenIdentifier: token.id,
    });
    const r = await this.sdk.sendPayment({ prepareResponse: prepared });
    if (paymentFailed(r?.payment?.status)) throw new Error('payment failed');
    return {};
  }

  async parse(input: string): Promise<ParsedDest> {
    const raw = input.trim();
    try {
      const r = await this.sdk.parse(raw);
      // variantOf/variantDetails bridge WASM ({type, …fields}) and native
      // uniffi (tag + inner[0]) result shapes.
      const d = variantDetails(r);
      switch (variantOf(r)) {
        case 'bolt11invoice':
          return { kind: 'bolt11', raw, sats: d?.amountMsat != null ? Math.floor(Number(d.amountMsat) / 1000) : null, description: d?.description || undefined };
        case 'lightningaddress': return { kind: 'lightningAddress', raw };
        case 'lnurlpay': return { kind: 'lnurlPay', raw };
        case 'bitcoinaddress': return { kind: 'bitcoinAddress', raw };
        case 'bip21': return { kind: 'bitcoinAddress', raw };
        case 'sparkaddress':
        case 'sparkinvoice': return { kind: 'sparkAddress', raw };
        default: return { kind: 'unknown', raw };
      }
    } catch {
      return { kind: 'unknown', raw };
    }
  }

  private rateCache: { at: number; rates: Map<string, number> } | null = null;
  async fiatRate(coin: string): Promise<number | null> {
    if (!this.rateCache || Date.now() - this.rateCache.at > 60_000) {
      try {
        // listFiatRates lives on BreezSdk (fetchFiatRates is the FiatService
        // interface — not exposed on the SDK object itself).
        const resp = await this.sdk.listFiatRates();
        const rates: Array<{ coin: string; value: number }> = resp?.rates ?? resp ?? [];
        this.rateCache = { at: Date.now(), rates: new Map(rates.map((r) => [r.coin?.toUpperCase(), r.value])) };
      } catch { return null; }
    }
    return this.rateCache.rates.get(coin.toUpperCase()) ?? null;
  }

  async receiveOnchain(): Promise<string | null> {
    const r = await this.sdk.receivePayment({ paymentMethod: bitcoinAddressMethod(this.M) });
    return r?.paymentRequest || null;
  }

  async lightningAddress(): Promise<{ address: string; lnurl?: string } | null> {
    try {
      const info = await this.sdk.getLightningAddress();
      return info?.lightningAddress ? { address: info.lightningAddress, lnurl: info.lnurl?.bech32 } : null;
    } catch { return null; }
  }

  /** HODL invoice: bolt11 on an EXTERNAL payment hash — the payment stays
   *  unsettled (locked) until claimHtlc is called with the preimage, and
   *  auto-refunds the payer once the invoice expires. */
  async createHoldInvoice(sats: number, description: string, paymentHashHex: string, expirySecs: number): Promise<string> {
    const r = await this.sdk.receivePayment({
      paymentMethod: bolt11ReceiveMethod(this.M, sats, description, { paymentHash: paymentHashHex, expirySecs }),
    });
    if (!r?.paymentRequest) throw new Error('wallet returned no invoice');
    return r.paymentRequest;
  }

  async claimHtlc(preimageHex: string): Promise<void> {
    await this.sdk.claimHtlcPayment({ preimage: preimageHex });
  }

  async registerLightningAddress(username: string): Promise<{ address: string; lnurl?: string }> {
    const info = await this.sdk.registerLightningAddress({ username, description: 'Freeport' });
    return { address: info.lightningAddress, lnurl: info.lnurl?.bech32 };
  }

  async checkUsername(username: string): Promise<boolean> {
    try { return !!(await this.sdk.checkLightningAddressAvailable({ username })); }
    catch { return false; }
  }

  /** The built-in wallet stays connected for the app's lifetime (it keeps
   *  syncing in the background); tab unmounts don't tear it down. */
  close(): void {}
}

/** True when a Breez API key was baked into this build. */
export function breezConfigured(): boolean {
  return !!API_KEY;
}

export async function connectBreez(): Promise<WalletProvider | null> {
  if (!API_KEY) return null;
  const sk = await loadKey();
  if (!sk) return null;
  const mnemonic = deriveWalletMnemonic(sk);
  const { sdk, M } = await loadSdk(mnemonic);
  return new BreezSparkProvider(sdk, M);
}
