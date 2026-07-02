/**
 * Prohibited-content screening — the marketplace's self-policing. Applies on
 * POST (refuse to publish) and on RECEIVE (hide from the feed); most relevant
 * to service/product listings, which carry free-text service + notes fields.
 */
import { describe, it, expect } from 'vitest';
import { screenIntent, screenIntentContent } from '../src/index.js';

describe('screenIntent', () => {
  it('allows a normal service listing', () => {
    expect(screenIntent('Home Services', 'Leaky tap repair', 'Fix kitchen sink').allowed).toBe(true);
  });

  it('blocks an injected banned category even with innocent text', () => {
    const v = screenIntent('Weapons', 'Collectible display item');
    expect(v.allowed).toBe(false);
    expect(v.rule).toBe('category');
  });

  it('matches denylist terms word-boundary aware ("method" is not "meth")', () => {
    expect(screenIntent(undefined, 'Cleaning method consultation').allowed).toBe(true);
    expect(screenIntent(undefined, 'selling meth').allowed).toBe(false);
  });

  it('is case- and accent-insensitive', () => {
    expect(screenIntent(undefined, 'Premium COCAÍNE delivery').allowed).toBe(false);
  });
});

describe('screenIntentContent — scans every text field of a service payload', () => {
  const base = { service: 'Cleaning', category: 'Home Services', location: { name: 'Old Quarter' } };

  it('allows a clean payload', () => {
    expect(screenIntentContent('service/1', 'House cleaning', base).allowed).toBe(true);
  });

  it.each([
    ['service field', { ...base, service: 'fentanyl supply' }],
    ['notes field', { ...base, notes: 'also selling fentanyl' }],
    ['location name', { ...base, location: { name: 'fentanyl pickup point' } }],
    ['subcategory', { ...base, subcategory: 'fentanyl' }],
  ])('catches a denylist term in the %s', (_where, payload) => {
    const v = screenIntentContent('service/1', 'House cleaning', payload as Record<string, unknown>);
    expect(v.allowed).toBe(false);
    expect(v.rule).toBe('drugs');
  });
});
