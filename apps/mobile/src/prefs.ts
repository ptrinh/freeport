/**
 * Local UI preferences — not published, device-only. Distinct from the Nostr
 * profile (which is public kind:0). Lives in SecureStore alongside it.
 */
import { kvGet, kvSet } from './kv';
import { scheduleCloudSync } from './cloudSync';
import type { FareConfig } from './pricing';

const STORE_KEY = 'freeport.prefs';

export interface UserLocation {
  country: string; // ISO 3166-1 alpha-2, '' if unset
  state: string;
  city: string;
}

export interface Prefs {
  /** Show the Service/Product vertical (Post option + market listings). Off by default for a leaner UI. */
  servicesEnabled: boolean;
  /** Home location — drives default payment currency. Device-only, not published. */
  location: UserLocation;
  /** True once the user has explicitly chosen their location (onboarding confirm
   *  or Settings). Launch auto-detect only fills/refines an UNset location — it
   *  must never overwrite a deliberate pick with a coarse IP result. */
  locationManual: boolean;
  /** Use a NIP-07 browser extension to sign (web) instead of a local key. */
  useNip07: boolean;
  /** UI theme. 'system' follows the OS appearance. */
  theme: 'system' | 'dark' | 'light';
  /** Default role chosen at onboarding (rideshare framing). '' = unset. */
  role: 'passenger' | 'driver' | '';
  /** UI language (BCP-47 primary subtag, e.g. 'en', 'vi'). '' = follow system. */
  language: string;
  /** Custom fare-estimator coefficients. null = use built-in defaults. */
  fareConfig: FareConfig | null;
  /** Web Push: URL of the content-blind notification sender. Defaults to the
   *  hosted Freeport notifier; users can point it at their own self-hosted one. */
  notifyEndpoint: string;
  /** Android: keep a foreground service alive to receive messages while backgrounded. */
  backgroundService: boolean;
  /** Road-distance unit. 'auto' = km everywhere except a US location (miles); 'km'/'mi' force it. */
  distanceUnit: 'auto' | 'km' | 'mi';
  /** Browse default category (Driver/Provider). '' = unset → falls back to Ridesharing. */
  browseCategory: string;
  /** Browse default subcategory. '' = unset → falls back to the default vehicle / first subcat. */
  browseSubcategory: string;
  /** Experimental: show the in-app wallet UI (Breez Spark / NWC). Off by default. */
  experimentalWallet: boolean;
  /** NWC connection string for the bring-your-own wallet ('' = not connected).
   *  Device-only, never published — treat like a credential. */
  walletNwcUrl: string;
  /** Balance display unit in the Wallet tab. Defaults to the user's local
   *  currency; falls back to sats whenever no rate is available. */
  walletUnit: 'sats' | 'usd' | 'local';
  /** Play a sound when a new post lands in the default browse subcategory. */
  browseAlertSound: boolean;
  /** Send a notification when a new post lands in the default browse subcategory. */
  browseAlertNotify: boolean;
  /** Max distance for Browse results, in the active distance unit (km/mi). Default 100. */
  browseMaxDistance: number;
  /** Auto-share your live location to the other party while a deal is active
   *  (until it completes). On by default. */
  sendLocationOnDeal: boolean;
  /** One-tap quick reply in deal chats — typically the user's preferred
   *  payment method + handle. '' = unset (chip hidden, nothing auto-sent). */
  customMessage: string;
  /** Auto-send the custom message into the chat when a deal is confirmed.
   *  Off by default. */
  autoSendCustomMessage: boolean;
  /** Send anonymous crash reports + usage analytics to the self-hosted
   *  GlitchTip/Aptabase. Scrubbed of all identity/contact/location/content.
   *  On by default; opt out in Settings. */
  telemetryEnabled: boolean;
  /** Experimental: friend chat (invite-based 1:1 chat, deal-independent). */
  experimentalChat: boolean;
  /** Chat: share your last-seen with accepted contacts (reciprocal). Off by default. */
  chatShowLastSeen: boolean;
  /** Chat: delivery/read receipts (reciprocal ticks). Off by default. */
  chatReceipts: boolean;
  /** Chat: 1:1 audio/video calls (WebRTC). Off = no call buttons AND incoming
   *  call invites are declined automatically. */
  chatCallsEnabled: boolean;
  /** Chat: relay calls through TURN when a direct connection fails. Off =
   *  direct-only (better IP privacy vs the relay; those calls just fail). */
  chatCallsTurn: boolean;
  /** Chat: auto-translate inbound messages ON-DEVICE into the UI language
   *  (Apple Foundation Models). Nothing leaves the phone. Off by default. */
  chatTranslate: boolean;
  /** Experimental: master switch for ALL on-device AI features (concierge,
   *  chat translate). Off by default; nothing AI-related renders without it. */
  experimentalLlm: boolean;
}

const DEFAULTS: Prefs = {
  servicesEnabled: false,
  experimentalWallet: false,
  walletNwcUrl: '',
  walletUnit: 'local',
  location: { country: '', state: '', city: '' },
  locationManual: false,
  useNip07: false,
  theme: 'system',
  role: '',
  language: '',
  fareConfig: null,
  notifyEndpoint: 'https://mcp.freeport.network',
  backgroundService: false,
  distanceUnit: 'auto',
  browseCategory: '',
  browseSubcategory: '',
  browseAlertSound: false,
  browseAlertNotify: false,
  browseMaxDistance: 100,
  sendLocationOnDeal: true,
  customMessage: '',
  autoSendCustomMessage: false,
  telemetryEnabled: true,
  experimentalChat: false,
  chatShowLastSeen: false,
  chatReceipts: false,
  chatCallsEnabled: false,
  chatCallsTurn: false,
  chatTranslate: false,
  experimentalLlm: false,
};

/** Public-instance hostnames we've renamed. Installs that saved one of these
 *  follow the rename (same server, new canonical name — mcp.freeport.network);
 *  a custom self-hosted URL is never touched. Exported for tests. */
export function migrateNotifyEndpoint(stored: unknown): string | undefined {
  const v = String(stored ?? '').trim().replace(/\/+$/, '');
  if (!v) return undefined;
  return v === 'https://nostr-mcp.trinh.uk' ? DEFAULTS.notifyEndpoint : v;
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await kvGet(STORE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const notifyEndpoint = migrateNotifyEndpoint(parsed.notifyEndpoint) ?? DEFAULTS.notifyEndpoint;
    return { ...DEFAULTS, ...parsed, notifyEndpoint, location: { ...DEFAULTS.location, ...parsed.location } };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * Merge-save: callers may pass a subset of fields; unspecified ones keep their
 * stored value. This keeps fields a call site doesn't know about (e.g. `role`)
 * from being clobbered.
 */
export async function savePrefs(prefs: Partial<Prefs>): Promise<void> {
  const cur = await loadPrefs();
  await kvSet(STORE_KEY, JSON.stringify({ ...cur, ...prefs }));
  scheduleCloudSync(); // keep the cloud backup in sync with settings changes
}
