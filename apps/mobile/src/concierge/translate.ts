/**
 * In-chat auto-translate — ON-DEVICE only, riding the same Apple Foundation
 * Models layer as the concierge (roadmap: "a cloud API must be explicit
 * opt-in — it leaks message content"; we go further and ship no cloud path).
 * Inbound messages are translated into the user's UI language; the bubble
 * shows the translation with the original small and dim underneath.
 *
 * Returns null whenever there is nothing useful to show: model missing/not
 * ready, message already in the target language, junk output. Callers render
 * the original untouched in every null case — translation is best-effort
 * decoration, never a gate.
 */
import { Platform } from 'react-native';
import { conciergeModulePresent } from './model';

/** Per-device, per-language memo — translations are derived data, never
 *  persisted with the message. Bounded, oldest-inserted evicted first. */
const cache = new Map<string, string | null>();
const CACHE_MAX = 500;

/** One session at a time: the native session is global, so translations run
 *  through a serial chain (a concurrent configureSession would clobber it). */
let chain: Promise<unknown> = Promise.resolve();

/** Chrome 138+ desktop ships on-device Translator + LanguageDetector APIs —
 *  purpose-built translation models (small per-pair packs), a better fit for
 *  chat than an LLM. Feature-detected; absent on mobile browsers/Safari. */
export function webTranslatorSupported(): boolean {
  const g = globalThis as any;
  return typeof g.Translator?.create === 'function' && typeof g.LanguageDetector?.create === 'function';
}

/** Sync gate for UI (settings row visibility). */
export function translateSupported(): boolean {
  return Platform.OS === 'web' ? webTranslatorSupported() : conciergeModulePresent();
}

// Web: one detector + one translator per language pair, created lazily.
// Creating a translator may download that pair's language pack — only ever
// triggered after the user turned the toggle on.
let detectorPromise: Promise<any> | null = null;
const webTranslators = new Map<string, Promise<any | null>>();

async function translateWeb(text: string, targetLang: string): Promise<string | null> {
  const g = globalThis as any;
  try {
    detectorPromise ??= g.LanguageDetector.create();
    const detector = await detectorPromise;
    const [best] = (await detector.detect(text)) ?? [];
    const source: string | undefined = best?.detectedLanguage;
    // Low-confidence detection (emoji, numbers, very short text) → leave as-is.
    if (!source || source === targetLang || (best?.confidence ?? 0) < 0.5) return null;
    const key = `${source}>${targetLang}`;
    if (!webTranslators.has(key)) {
      webTranslators.set(key, (async () => {
        const avail = await g.Translator.availability({ sourceLanguage: source, targetLanguage: targetLang });
        if (avail === 'unavailable') return null;
        return g.Translator.create({ sourceLanguage: source, targetLanguage: targetLang });
      })().catch(() => null));
    }
    const translator = await webTranslators.get(key)!;
    if (!translator) return null;
    const out = String((await translator.translate(text)) ?? '').trim();
    return out && out !== text.trim() ? out : null;
  } catch {
    return null;
  }
}

export async function translateMessage(text: string, key: string, targetLang: string): Promise<string | null> {
  if (!translateSupported() || !text.trim() || !targetLang) return null;
  const ck = `${key}|${targetLang}`;
  if (cache.has(ck)) return cache.get(ck)!;
  const run = async (): Promise<string | null> => {
    if (Platform.OS === 'web') return translateWeb(text, targetLang);
    try {
      const m = await import('react-native-apple-llm');
      if ((await m.isFoundationModelsEnabled()) !== 'available') return null;
      let langName = targetLang;
      try { langName = new Intl.DisplayNames(['en'], { type: 'language' }).of(targetLang) ?? targetLang; } catch { /* rare ICU gaps */ }
      await m.configureSession({
        instructions:
          `You translate one chat message into ${langName}. ` +
          'Keep the tone and any emoji; translate nothing inside URLs or numbers. ' +
          `If the message is already ${langName}, set already_in_target to true.`,
      });
      const out = await m.generateStructuredOutput({
        structure: {
          already_in_target: { type: 'boolean', description: `true when the message is already ${langName}` },
          translation: { type: 'string', description: `the message translated into ${langName}` },
        },
        prompt: text.trim(),
      });
      if (out?.already_in_target) return null;
      const tr = typeof out?.translation === 'string' ? out.translation.trim() : '';
      // A "translation" identical to the source is the model telling us the
      // language already matched — don't render a duplicate line.
      return tr && tr !== text.trim() ? tr : null;
    } catch {
      return null;
    }
  };
  // Serialize behind whatever is in flight (success or failure).
  const result = await (chain = chain.then(run, run));
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(ck, result as string | null);
  return result as string | null;
}

/** Test hook. */
export function __clearTranslationCache(): void {
  cache.clear();
  detectorPromise = null;
  webTranslators.clear();
}
