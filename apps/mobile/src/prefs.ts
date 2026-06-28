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
  /** Play a sound when a new post lands in the default browse subcategory. */
  browseAlertSound: boolean;
  /** Send a notification when a new post lands in the default browse subcategory. */
  browseAlertNotify: boolean;
  /** Max distance for Browse results, in the active distance unit (km/mi). Default 100. */
  browseMaxDistance: number;
  /** Auto-share your live location to the other party while a deal is active
   *  (until it completes). On by default. */
  sendLocationOnDeal: boolean;
}

const DEFAULTS: Prefs = {
  servicesEnabled: false,
  location: { country: '', state: '', city: '' },
  locationManual: false,
  useNip07: false,
  theme: 'system',
  role: '',
  language: '',
  fareConfig: null,
  notifyEndpoint: 'https://nostr-mcp.trinh.uk',
  backgroundService: false,
  distanceUnit: 'auto',
  browseCategory: '',
  browseSubcategory: '',
  browseAlertSound: false,
  browseAlertNotify: false,
  browseMaxDistance: 100,
  sendLocationOnDeal: true,
};

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await kvGet(STORE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed, location: { ...DEFAULTS.location, ...parsed.location } };
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
