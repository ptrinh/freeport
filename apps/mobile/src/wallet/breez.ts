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
import type { WalletBalance, WalletCapabilities, WalletInvoice, WalletProvider, WalletTx } from './types';

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

async function loadSdk(mnemonic: string): Promise<any> {
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
    return await mod.connect({
      config,
      seed: { type: 'mnemonic', mnemonic, passphrase: undefined },
      storageDir: 'freeport-wallet',
    });
  }
  // Native: TurboModule — throws on binaries that don't include it yet.
  const mod: any = await import('@breeztech/breez-sdk-spark-react-native');
  await mod.uniffiInitAsync?.();
  const FS: any = await import('expo-file-system/legacy');
  const dir = String(FS.documentDirectory || '').replace(/^file:\/\//, '') + 'breez';
  const config = mod.defaultConfig(mod.Network.Mainnet);
  config.apiKey = API_KEY;
  const seed = new mod.Seed.Mnemonic({ mnemonic, passphrase: undefined });
  return await mod.connect({ config, seed, storageDir: dir });
}

export class BreezSparkProvider implements WalletProvider {
  readonly kind = 'breez-spark' as const;

  constructor(private sdk: any) {}

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
      paymentMethod: {
        type: 'bolt11Invoice',
        description: description ?? '',
        amountSats: Math.max(0, Math.round(sats)),
        expirySecs: 3600,
      },
    });
    if (!r?.paymentRequest) throw new Error('wallet returned no invoice');
    return { invoice: r.paymentRequest, sats };
  }

  async address(): Promise<string | null> {
    const r = await this.sdk.receivePayment({ paymentMethod: { type: 'sparkAddress' } });
    return r?.paymentRequest || null;
  }

  async pay(destination: string, sats?: number): Promise<{ preimage?: string }> {
    const input = destination.trim();
    const isBolt11 = /^ln(bc|tbs|tb|bcrt)/i.test(input);
    if (!isBolt11 && (!sats || sats <= 0)) throw new Error('amount-required');
    // The SDK's parser handles bolt11 / lightning address / Spark address.
    const prepared = await this.sdk.prepareSendPayment({
      paymentRequest: { type: 'input', input },
      ...(isBolt11 ? {} : { amount: BigInt(Math.round(sats!)) }),
    });
    const r = await this.sdk.sendPayment({
      prepareResponse: prepared,
      ...(isBolt11 ? { options: { type: 'bolt11Invoice', preferSpark: false, completionTimeoutSecs: 30 } } : {}),
    });
    if (r?.payment?.status === 'failed') throw new Error('payment failed');
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
  const sdk = await loadSdk(mnemonic);
  return new BreezSparkProvider(sdk);
}
