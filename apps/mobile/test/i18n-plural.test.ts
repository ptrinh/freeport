import { describe, it, expect, afterEach } from 'vitest';
import { t, tn, setI18nLang, ensureI18nLang } from '../src/i18n';

afterEach(() => setI18nLang('en'));

describe('tn plurals', () => {
  it('splits one/other in English', () => {
    expect(tn(1, '{n} day', '{n} days')).toBe('1 day');
    expect(tn(3, '{n} day', '{n} days')).toBe('3 days');
    expect(tn(0, '{n} day', '{n} days')).toBe('0 days');
  });

  it('uses Russian few/many/one categories', async () => {
    setI18nLang('ru');
    await ensureI18nLang('ru');
    expect(tn(1, '{n} day', '{n} days')).toBe('1 день');
    expect(tn(3, '{n} day', '{n} days')).toBe('3 дня');    // few
    expect(tn(5, '{n} day', '{n} days')).toBe('5 дней');   // many
    expect(tn(21, '{n} day', '{n} days')).toBe('21 день'); // 21 → one again
  });

  it('falls back to the language plural when no singular entry exists', async () => {
    setI18nLang('vi');
    await ensureI18nLang('vi');
    // Vietnamese has no singular entry — the plural translation is correct for n=1.
    expect(tn(1, '{n} day', '{n} days')).toBe('1 ngày');
    expect(tn(9, '{n} day', '{n} days')).toBe('9 ngày');
  });

  it('falls back to English pair when the language has no entries at all', () => {
    expect(tn(1, '{n} widget', '{n} widgets')).toBe('1 widget');
    expect(tn(2, '{n} widget', '{n} widgets')).toBe('2 widgets');
  });

  it('passes extra vars through', () => {
    expect(tn(4, '{vehicle} · {n} seater', '{vehicle} · {n} seaters', { vehicle: 'Car' })).toBe('Car · 4 seaters');
  });

  it('t() interpolation still works', () => {
    expect(t('Sending {n}…', { n: 2 })).toBe('Sending 2…');
  });
});
