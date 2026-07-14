/**
 * AI feature gating — the exact rule the user specified, per platform:
 *   Settings → Chat → "Translate messages" is visible iff Chat is on (UI) AND
 *   (a DEDICATED translator exists  ← no Local LLM AI switch needed
 *    OR the Local LLM AI switch is on AND an LLM translator exists).
 * Plus: provider routing never touches the wrong module, and the Android
 * Gemini Nano probe never imports the package when the module is absent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// One mutable platform/module state, consumed by all mocks.
const state = {
  os: 'android' as string,
  mlkitTranslate: true,
  mlkitIdentify: true,
  geminiNano: true,
  appleLlm: false,
};

const geminiImported = vi.fn();
const geminiGenerate = vi.fn(async () =>
  '```json\n{"kind":"ride","from":"Ben Thanh","to":"Tan Son Nhat","price":150000,"currency":"VND","note":"7pm"}\n```');
const mlkitTranslateCall = vi.fn(async () => 'xin chào');
const mlkitIdentifyCall = vi.fn(async () => 'en');
const appleImported = vi.fn();

vi.mock('react-native', () => ({
  Platform: { get OS() { return state.os; } },
  NativeModules: {
    get TranslateText() { return state.mlkitTranslate ? {} : undefined; },
    get IdentifyLanguages() { return state.mlkitIdentify ? {} : undefined; },
  },
  TurboModuleRegistry: {
    get: (name: string) => {
      if (name === 'GeminiNano') return state.geminiNano ? {} : null;
      if (name === 'AppleLLMModule') return state.appleLlm ? {} : null;
      return null;
    },
  },
}));
vi.mock('@react-native-ml-kit/translate-text', () => ({ default: { translate: mlkitTranslateCall } }));
vi.mock('@react-native-ml-kit/identify-languages', () => ({ default: { identify: mlkitIdentifyCall } }));
vi.mock('react-native-gemini-nano', () => {
  geminiImported();
  if (!state.geminiNano) throw new Error("getEnforcing: 'GeminiNano' could not be found");
  return { isAvailable: async () => true, generateText: geminiGenerate };
});
vi.mock('react-native-apple-llm', () => {
  appleImported();
  return { isFoundationModelsEnabled: async () => 'available', configureSession: vi.fn(), generateStructuredOutput: vi.fn(), resetSession: vi.fn(async () => true) };
});

import {
  translateToggleVisible,
  translateSupported,
  nonLlmTranslatorSupported,
  translateMessage,
  __clearTranslationCache,
} from '../src/concierge/translate';
import { conciergeModulePresent, conciergeAvailability, draftIntent } from '../src/concierge/model';

const CTX = { servicesEnabled: true, defaultCurrency: 'VND' };

beforeEach(() => {
  Object.assign(state, { os: 'android', mlkitTranslate: true, mlkitIdentify: true, geminiNano: true, appleLlm: false });
  geminiImported.mockClear();
  appleImported.mockClear();
  mlkitTranslateCall.mockClear();
  mlkitIdentifyCall.mockClear();
  __clearTranslationCache();
  delete (globalThis as any).Translator;
  delete (globalThis as any).LanguageDetector;
  delete (globalThis as any).LanguageModel;
});

describe('translate row gating (translateToggleVisible)', () => {
  it('Android + ML Kit: visible WITHOUT the Local LLM AI switch', () => {
    expect(nonLlmTranslatorSupported()).toBe(true);
    expect(translateToggleVisible(false)).toBe(true);
    expect(translateToggleVisible(true)).toBe(true);
  });

  it('Android without ML Kit (old binary): hidden regardless of the switch', () => {
    state.mlkitTranslate = false;
    expect(translateToggleVisible(false)).toBe(false);
    // LLM switch does NOT resurrect it: Gemini Nano is not a translator here.
    expect(translateToggleVisible(true)).toBe(false);
  });

  it('iOS + Apple FM: needs the Local LLM AI switch (it IS an LLM)', () => {
    state.os = 'ios';
    state.appleLlm = true;
    expect(nonLlmTranslatorSupported()).toBe(false);
    expect(translateToggleVisible(false)).toBe(false);
    expect(translateToggleVisible(true)).toBe(true);
  });

  it('web + Translator API: visible without the switch; bare web: hidden', () => {
    state.os = 'web';
    expect(translateToggleVisible(true)).toBe(false); // no APIs at all
    (globalThis as any).Translator = { create: () => {} };
    (globalThis as any).LanguageDetector = { create: () => {} };
    expect(translateToggleVisible(false)).toBe(true);
  });
});

describe('provider routing', () => {
  it('Android routes to ML Kit and never imports the LLM packages', async () => {
    const out = await translateMessage('hello', 'k1', 'vi');
    expect(out).toBe('xin chào');
    expect(mlkitIdentifyCall).toHaveBeenCalledWith('hello');
    expect(mlkitTranslateCall).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello', sourceLanguage: 'en', targetLanguage: 'vi', downloadModelIfNeeded: true,
    }));
    expect(appleImported).not.toHaveBeenCalled();
    expect(geminiImported).not.toHaveBeenCalled();
  });

  it('Android: same/unknown language → null (no translate call)', async () => {
    mlkitIdentifyCall.mockResolvedValueOnce('vi');
    expect(await translateMessage('xin chào', 'k2', 'vi')).toBeNull();
    mlkitIdentifyCall.mockResolvedValueOnce('und');
    expect(await translateMessage('???', 'k3', 'vi')).toBeNull();
    expect(mlkitTranslateCall).not.toHaveBeenCalled();
  });

  it('translateSupported is false when either ML Kit module is missing', () => {
    state.mlkitIdentify = false;
    expect(translateSupported()).toBe(false);
  });
});

describe('Android concierge (Gemini Nano)', () => {
  it('probe gates the import — module absent means NO import (crash class #13)', async () => {
    state.geminiNano = false;
    expect(conciergeModulePresent()).toBe(false);
    expect(await conciergeAvailability()).toBe('unsupported');
    expect(geminiImported).not.toHaveBeenCalled();
  });

  it('module present → available, and draftIntent parses fenced JSON output', async () => {
    expect(conciergeModulePresent()).toBe(true);
    expect(await conciergeAvailability()).toBe('available');
    const draft = await draftIntent('xe ra sân bay 7h tối, 150k', CTX);
    expect(draft?.schema).toBe('rideshare/1');
    expect(draft?.to).toBe('Tan Son Nhat');
    expect(draft?.payment).toBe('VND 150000');
  });

  it('non-JSON model output → null (human never sees junk)', async () => {
    geminiGenerate.mockResolvedValueOnce('I cannot help with that.');
    expect(await draftIntent('???', CTX)).toBeNull();
  });
});
