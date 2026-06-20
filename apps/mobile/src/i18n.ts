/**
 * Lightweight i18n. The ENGLISH source string is itself the lookup key
 * (gettext-style): `t('Create new account')` returns the active language's
 * translation, or the English string unchanged when there's no catalog/entry.
 * That makes every not-yet-loaded language fall back to English for free.
 *
 * Catalogs are split for bundle size: a few high-traffic languages (see
 * ./locales EAGER) are bundled up front; the rest are CODE-SPLIT and fetched
 * on demand the first time they're selected. Because t() is synchronous, an
 * on-demand language renders in English for the brief moment between selection
 * and the catalog resolving — `ensureI18nLang` loads it and notifies listeners
 * (App subscribes via `onI18nLoaded`) so the tree re-renders once it's ready.
 */
import { EAGER, LOADERS } from './locales';

type Catalog = Record<string, string>;

const catalogs: Record<string, Catalog> = { ...EAGER };
const loading: Record<string, Promise<void>> = {};
const listeners = new Set<() => void>();
let lang = 'en';

/**
 * Ensure the catalog for `code` is loaded. Resolves immediately for English,
 * already-loaded, or eager languages; otherwise fetches the code-split chunk
 * once (memoized) and notifies listeners so the UI re-renders with it.
 */
export function ensureI18nLang(code: string): Promise<void> {
  code = code || 'en';
  if (code === 'en' || catalogs[code]) return Promise.resolve();
  const loader = LOADERS[code];
  if (!loader) return Promise.resolve();
  if (!loading[code]) {
    loading[code] = loader()
      .then((m) => {
        catalogs[code] = m.default ?? (m as unknown as Catalog);
        listeners.forEach((fn) => fn());
      })
      .catch(() => {
        // Load failed (offline / bad chunk) — leave it; t() falls back to English.
        delete loading[code];
      });
  }
  return loading[code];
}

/** Subscribe to catalog-load events (for re-render). Returns an unsubscribe fn. */
export function onI18nLoaded(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Switch the active language. Pass a BCP-47 primary subtag, e.g. 'vi'. */
export function setI18nLang(code: string): void {
  lang = code || 'en';
  void ensureI18nLang(lang);
}

export function getI18nLang(): string {
  return lang;
}

/** True when `code` is the source language, already loaded, or loadable on demand. */
export function hasCatalog(code: string): boolean {
  return code === 'en' || !!catalogs[code] || !!LOADERS[code];
}

/**
 * Translate an English source string. `{name}`-style placeholders are filled
 * from `vars`. Unknown strings / not-yet-loaded languages return the English
 * source as-is.
 */
export function t(en: string, vars?: Record<string, string | number>): string {
  let s = (lang !== 'en' && catalogs[lang]?.[en]) || en;
  if (vars) {
    for (const k in vars) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
  }
  return s;
}
