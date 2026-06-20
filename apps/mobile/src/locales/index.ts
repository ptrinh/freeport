/**
 * Translation catalog registry.
 *
 * English is the source language (keys are themselves English) — no catalog.
 * A few high-traffic languages are bundled EAGERLY (zh, vi, es, fr, de) so they
 * resolve on first paint. Every other supported language is CODE-SPLIT: its
 * catalog is fetched on demand the first time the user selects it (see i18n.ts
 * ensureI18nLang). This keeps the initial JS bundle small — only ~5 catalogs
 * ship up front instead of all ~56.
 */
import zh from './zh';
import vi from './vi';
import es from './es';
import fr from './fr';
import de from './de';

/** Bundled up front — available synchronously. */
export const EAGER: Record<string, Record<string, string>> = { zh, vi, es, fr, de };

/** Fetched on demand. Each loader resolves to that language's catalog module. */
export const LOADERS: Record<string, () => Promise<{ default: Record<string, string> }>> = {
  af: () => import('./af'),
  sq: () => import('./sq'),
  am: () => import('./am'),
  ar: () => import('./ar'),
  hy: () => import('./hy'),
  az: () => import('./az'),
  bn: () => import('./bn'),
  bg: () => import('./bg'),
  my: () => import('./my'),
  hr: () => import('./hr'),
  cs: () => import('./cs'),
  da: () => import('./da'),
  nl: () => import('./nl'),
  et: () => import('./et'),
  fil: () => import('./fil'),
  fi: () => import('./fi'),
  ka: () => import('./ka'),
  el: () => import('./el'),
  he: () => import('./he'),
  hi: () => import('./hi'),
  hu: () => import('./hu'),
  id: () => import('./id'),
  it: () => import('./it'),
  ja: () => import('./ja'),
  kk: () => import('./kk'),
  km: () => import('./km'),
  ko: () => import('./ko'),
  lo: () => import('./lo'),
  lv: () => import('./lv'),
  lt: () => import('./lt'),
  mk: () => import('./mk'),
  ms: () => import('./ms'),
  ne: () => import('./ne'),
  no: () => import('./no'),
  fa: () => import('./fa'),
  pl: () => import('./pl'),
  pt: () => import('./pt'),
  ro: () => import('./ro'),
  ru: () => import('./ru'),
  sr: () => import('./sr'),
  si: () => import('./si'),
  sk: () => import('./sk'),
  sl: () => import('./sl'),
  sw: () => import('./sw'),
  sv: () => import('./sv'),
  ta: () => import('./ta'),
  th: () => import('./th'),
  tr: () => import('./tr'),
  uk: () => import('./uk'),
  ur: () => import('./ur'),
  uz: () => import('./uz'),
};
