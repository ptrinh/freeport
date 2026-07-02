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

function interpolate(s: string, vars?: Record<string, string | number>): string {
  if (vars) {
    for (const k in vars) s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
  }
  return s;
}

/**
 * Translate an English source string. `{name}`-style placeholders are filled
 * from `vars`. Unknown strings / not-yet-loaded languages return the English
 * source as-is.
 */
export function t(en: string, vars?: Record<string, string | number>): string {
  return interpolate((lang !== 'en' && catalogs[lang]?.[en]) || en, vars);
}

/**
 * Plural-aware translate. English needs only two forms (`enOne`/`enOther`),
 * but many languages need more (Russian few/many, Czech few, …), so the
 * plural CATEGORY for `n` comes from the active language's own rules
 * (Intl.PluralRules), and catalogs may carry per-category entries keyed as
 * `"<enOther>|<category>"`, e.g.:
 *
 *   "{n} days":      "{n} дней",   // fallback ("many"/other)
 *   "{n} day":       "{n} день",   // used when the category is "one"
 *   "{n} days|few":  "{n} дня",    // n = 2..4
 *
 * Lookup order: `<enOther>|<category>` → base entry (`enOne` for category
 * "one", else `enOther`) → the English pair. `{n}` is auto-filled.
 */
export function tn(n: number, enOne: string, enOther: string, vars?: Record<string, string | number>): string {
  let cat = n === 1 ? 'one' : 'other';
  try { cat = new Intl.PluralRules(lang).select(n); } catch { /* keep the naive split */ }
  const c = lang !== 'en' ? catalogs[lang] : undefined;
  // For "one", fall back to the language's plural entry before English: in
  // many languages the noun doesn't inflect after a numeral, and a translated
  // plural beats an English singular in every language.
  const s =
    c?.[`${enOther}|${cat}`] ??
    (cat === 'one' ? (c?.[enOne] ?? c?.[enOther]) : c?.[enOther]) ??
    (cat === 'one' ? enOne : enOther);
  return interpolate(s, { n, ...(vars ?? {}) });
}
