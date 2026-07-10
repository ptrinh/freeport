import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mutable fakes for the RN bits rtl.ts touches. Built via vi.hoisted so the
// hoisted vi.mock factory can reference them.
const rn = vi.hoisted(() => {
  const m: any = {
    I18nManager: {
      isRTL: false,
      allowRTL: vi.fn(),
      forceRTL: vi.fn((v: boolean) => { m.I18nManager.isRTL = v; }),
    },
    Platform: { OS: 'web' as string },
  };
  return m;
});
vi.mock('react-native', () => rn);

import { isRtlLang, applyLayoutDirection, initLayoutDirection, dirIcon, RTL_LANGS } from '../src/rtl';

// Minimal web env.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v); },
};
(globalThis as any).document = { documentElement: { dir: 'ltr' } };

beforeEach(() => {
  rn.I18nManager.isRTL = false;
  rn.Platform.OS = 'web';
  store.clear();
  (globalThis as any).document.documentElement.dir = 'ltr';
  vi.clearAllMocks();
});

describe('isRtlLang', () => {
  it('recognizes the four RTL languages and their region subtags', () => {
    for (const c of ['ar', 'he', 'fa', 'ur', 'ar-EG', 'he_IL', 'FA']) expect(isRtlLang(c)).toBe(true);
  });
  it('treats everything else as LTR', () => {
    for (const c of ['en', 'th', 'zh', 'ru', 'de', '', 'xx']) expect(isRtlLang(c)).toBe(false);
  });
  it('exposes exactly the four catalogs', () => {
    expect([...RTL_LANGS].sort()).toEqual(['ar', 'fa', 'he', 'ur']);
  });
});

describe('applyLayoutDirection', () => {
  it('flips to RTL and signals a reload when switching en→ar', () => {
    expect(applyLayoutDirection('ar')).toBe(true);
    expect(rn.I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(store.get('freeport.dir')).toBe('rtl');
    expect((globalThis as any).document.documentElement.dir).toBe('rtl');
  });

  it('is a no-op (no reload) when the direction is unchanged', () => {
    rn.I18nManager.isRTL = true; // already RTL
    expect(applyLayoutDirection('he')).toBe(false);
    expect(rn.I18nManager.forceRTL).not.toHaveBeenCalled();
    expect(store.get('freeport.dir')).toBe('rtl'); // hint still written
  });

  it('flips back to LTR when leaving an RTL language', () => {
    rn.I18nManager.isRTL = true;
    expect(applyLayoutDirection('en')).toBe(true);
    expect(rn.I18nManager.forceRTL).toHaveBeenCalledWith(false);
    expect(store.get('freeport.dir')).toBe('ltr');
  });

  it('does not signal a reload for an LTR→LTR change', () => {
    expect(applyLayoutDirection('fr')).toBe(false);
  });
});

describe('initLayoutDirection', () => {
  it('applies a persisted RTL hint on web before render', () => {
    store.set('freeport.dir', 'rtl');
    initLayoutDirection('en'); // system lang irrelevant once a hint exists
    expect(rn.I18nManager.isRTL).toBe(true);
    expect((globalThis as any).document.documentElement.dir).toBe('rtl');
  });

  it('falls back to the device language when no hint is stored', () => {
    initLayoutDirection('ar');
    expect(rn.I18nManager.isRTL).toBe(true);
  });

  it('is a no-op on native (forced flag persists across restarts)', () => {
    rn.Platform.OS = 'ios';
    initLayoutDirection('ar');
    expect(rn.I18nManager.forceRTL).not.toHaveBeenCalled();
    expect(rn.I18nManager.allowRTL).toHaveBeenCalledWith(true);
  });
});

describe('dirIcon', () => {
  it('returns the LTR variant under LTR and the RTL variant under RTL', () => {
    expect(dirIcon('chevron-forward', 'chevron-back')).toBe('chevron-forward');
    rn.I18nManager.isRTL = true;
    expect(dirIcon('chevron-forward', 'chevron-back')).toBe('chevron-back');
  });
});
