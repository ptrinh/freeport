/**
 * UI language list + system-locale detection for the Settings language picker.
 *
 * Dependency-free and cross-platform: the device locale comes from the browser
 * (`navigator.language`) on web, or the Hermes `Intl` engine on native. Only
 * the language code is stored in prefs; '' means "follow the system".
 *
 * NOTE: this is the language *setting* only — actual string translation
 * (i18n of the UI copy) is a separate, larger effort not wired up here.
 */

export interface Language {
  code: string;   // BCP-47 primary subtag, e.g. 'en', 'vi', 'zh'
  name: string;   // English name
  native: string; // endonym, shown in the picker
}

/**
 * Supported UI languages, sorted A–Z by English name for scannability in the
 * picker. Covers the national languages of the supported countries (Uber/Grab/
 * Bolt/inDrive markets) so the device language matches for ≥90% of the list.
 */
/**
 * RTL languages (ar, he, fa, ur) are NOT offered even though their catalogs
 * exist: the app has no RTL layout support (no I18nManager wiring, physical
 * left/right styles throughout), so they'd render translated strings in
 * mirrored-wrong LTR layouts. Re-add them here once RTL is done properly.
 */
export const LANGUAGES: Language[] = [
  { code: 'af', name: 'Afrikaans', native: 'Afrikaans' },
  { code: 'sq', name: 'Albanian', native: 'Shqip' },
  { code: 'am', name: 'Amharic', native: 'አማርኛ' },
  { code: 'hy', name: 'Armenian', native: 'Հայերեն' },
  { code: 'az', name: 'Azerbaijani', native: 'Azərbaycan' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'bg', name: 'Bulgarian', native: 'Български' },
  { code: 'my', name: 'Burmese', native: 'မြန်မာ' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'en', name: 'English', native: 'English' },
  { code: 'et', name: 'Estonian', native: 'Eesti' },
  { code: 'fil', name: 'Filipino', native: 'Filipino' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'ka', name: 'Georgian', native: 'ქართული' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'kk', name: 'Kazakh', native: 'Қазақша' },
  { code: 'km', name: 'Khmer', native: 'ខ្មែរ' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'lo', name: 'Lao', native: 'ລາວ' },
  { code: 'lv', name: 'Latvian', native: 'Latviešu' },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
  { code: 'mk', name: 'Macedonian', native: 'Македонски' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'sr', name: 'Serbian', native: 'Српски' },
  { code: 'si', name: 'Sinhala', native: 'සිංහල' },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina' },
  { code: 'sl', name: 'Slovenian', native: 'Slovenščina' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'uz', name: 'Uzbek', native: 'Oʻzbekcha' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
];

export const LANGUAGE_CODES: string[] = LANGUAGES.map((l) => l.code);
const NATIVE_NAME: Record<string, string> = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.native]));

/** Native name for a code (e.g. 'vi' → 'Tiếng Việt'); falls back to the code itself. */
export function languageLabel(code: string): string {
  return NATIVE_NAME[code] ?? code;
}

/** Raw device locale, e.g. "vi-VN" / "en-US". Best-effort across web + native. */
function detectLocale(): string {
  try {
    const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav?.language) return String(nav.language);
    if (nav?.languages?.length) return String(nav.languages[0]);
  } catch {}
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {}
  return 'en';
}

/**
 * The device's language as one of our supported codes, defaulting to 'en' when
 * the system language isn't in the list. This is the default for a fresh user.
 */
export function systemLanguage(): string {
  const primary = detectLocale().toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_CODES.includes(primary) ? primary : 'en';
}

/**
 * The device's region as an ISO 3166-1 alpha-2 code, e.g. 'VN' from "vi-VN",
 * 'CN' from "zh-Hans-CN". '' when the locale has no region subtag. Used as a
 * best-effort fallback (e.g. default currency) before the user sets a location
 * and when GPS/IP detection comes back empty.
 */
export function systemCountry(): string {
  const region = detectLocale().split(/[-_]/).slice(1).find((p) => /^[A-Za-z]{2}$/.test(p));
  return region ? region.toUpperCase() : '';
}
