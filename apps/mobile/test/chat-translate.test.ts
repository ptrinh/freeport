/** On-device chat translation: probe gate, caching, same-language skip. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let modulePresent = true;
let availability = 'available';
const generated = vi.fn(async () => ({ already_in_target: false, translation: 'xin chào' }));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  TurboModuleRegistry: { get: (name: string) => (modulePresent && name === 'AppleLLMModule' ? {} : null) },
}));
vi.mock('react-native-apple-llm', () => ({
  isFoundationModelsEnabled: async () => availability,
  configureSession: vi.fn(async () => true),
  generateStructuredOutput: generated,
  resetSession: vi.fn(async () => true),
}));

import { translateMessage, translateSupported, __clearTranslationCache } from '../src/concierge/translate';

beforeEach(() => {
  modulePresent = true;
  availability = 'available';
  generated.mockClear();
  __clearTranslationCache();
});

describe('translateMessage', () => {
  it('translates and caches per (message, language)', async () => {
    expect(await translateMessage('hello', 'm1', 'vi')).toBe('xin chào');
    expect(await translateMessage('hello', 'm1', 'vi')).toBe('xin chào');
    expect(generated).toHaveBeenCalledTimes(1); // second hit served from cache
    await translateMessage('hello', 'm1', 'fr'); // different target → new call
    expect(generated).toHaveBeenCalledTimes(2);
  });

  it('already-in-target and echoed output → null (no duplicate line shown)', async () => {
    generated.mockResolvedValueOnce({ already_in_target: true, translation: '' } as any);
    expect(await translateMessage('xin chào', 'm2', 'vi')).toBeNull();
    generated.mockResolvedValueOnce({ already_in_target: false, translation: 'same text' } as any);
    expect(await translateMessage('same text', 'm3', 'vi')).toBeNull();
    // Nulls cache too — the model isn't re-asked on every render.
    expect(await translateMessage('xin chào', 'm2', 'vi')).toBeNull();
    expect(generated).toHaveBeenCalledTimes(2);
  });

  it('gates: module absent / model not ready / empty input → null', async () => {
    modulePresent = false;
    expect(translateSupported()).toBe(false);
    expect(await translateMessage('hello', 'm4', 'vi')).toBeNull();
    modulePresent = true;
    availability = 'modelNotReady';
    expect(await translateMessage('hello', 'm5', 'vi')).toBeNull();
    availability = 'available';
    expect(await translateMessage('   ', 'm6', 'vi')).toBeNull();
    expect(await translateMessage('hello', 'm7', '')).toBeNull();
  });

  it('model errors degrade to null (original always renders)', async () => {
    generated.mockRejectedValueOnce(new Error('boom'));
    expect(await translateMessage('hello', 'm8', 'vi')).toBeNull();
  });
});
