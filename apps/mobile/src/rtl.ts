/**
 * Right-to-left layout support.
 *
 * Direction is a function of the ACTIVE language and must be applied before the
 * tree renders. React Native's `I18nManager.forceRTL` only takes effect after
 * an app restart on native (it writes a native flag read at view creation), and
 * react-native-web resets I18nManager on every page load — so:
 *
 *  - `initLayoutDirection()` runs at module load, before React renders. On web
 *    it reads a synchronous localStorage hint (or the device locale on first
 *    run) and applies the direction so the first paint is already correct. On
 *    native the forced flag persists across restarts, so this only ensures RTL
 *    is allowed.
 *  - `applyLayoutDirection(lang)` is called when the language changes; it
 *    returns true when the direction flipped and the caller must reload the app
 *    (via updates.reloadApp) for it to take hold.
 */
import { I18nManager, Platform } from 'react-native';

/** Languages written right-to-left that the app ships catalogs for. */
export const RTL_LANGS = new Set(['ar', 'he', 'fa', 'ur']);

/** Web-only synchronous hint, read at startup before react-native-web renders. */
const DIR_KEY = 'freeport.dir';

/** True when `code`'s primary subtag is a right-to-left language. */
export function isRtlLang(code: string): boolean {
  return RTL_LANGS.has((code || '').toLowerCase().split(/[-_]/)[0]);
}

/** The layout direction currently applied by the RN layout engine. */
export function isRTL(): boolean {
  return I18nManager.isRTL;
}

function setWebDir(rtl: boolean): void {
  if (Platform.OS !== 'web') return;
  try { localStorage.setItem(DIR_KEY, rtl ? 'rtl' : 'ltr'); } catch { /* private mode */ }
  try {
    if (typeof document !== 'undefined') document.documentElement.dir = rtl ? 'rtl' : 'ltr';
  } catch { /* no DOM */ }
}

/**
 * Apply the correct layout direction for `code`. Persists the web hint and sets
 * document.dir every time (so the next reload is correct). Returns true when the
 * direction CHANGED from what's currently applied — the caller must then reload
 * the app for the flip to take effect.
 */
export function applyLayoutDirection(code: string): boolean {
  const wantRtl = isRtlLang(code);
  try { I18nManager.allowRTL(true); } catch { /* ignore */ }
  setWebDir(wantRtl);
  if (I18nManager.isRTL === wantRtl) return false;
  try { I18nManager.forceRTL(wantRtl); } catch { /* ignore */ }
  return true;
}

/**
 * Set the layout direction as early as possible, before the tree renders.
 * Idempotent; safe to call once at module load.
 */
export function initLayoutDirection(systemLang: string): void {
  try { I18nManager.allowRTL(true); } catch { /* ignore */ }
  if (Platform.OS !== 'web') return; // native: the forced flag persists across restarts
  let hint: string | null = null;
  try { hint = localStorage.getItem(DIR_KEY); } catch { /* private mode */ }
  const wantRtl = hint ? hint === 'rtl' : isRtlLang(systemLang);
  setWebDir(wantRtl);
  if (I18nManager.isRTL !== wantRtl) {
    try { I18nManager.forceRTL(wantRtl); } catch { /* ignore */ }
  }
}

/** Pick the icon variant for the current direction (chevrons, arrows, send…). */
export function dirIcon<T extends string>(ltr: T, rtl: T): T {
  return I18nManager.isRTL ? rtl : ltr;
}
