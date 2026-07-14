/**
 * AI concierge: the probe gate (never import the native module when absent —
 * crash class #13/#14) and the pure parse→draft mapper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let modulePresent = true;
let availability = 'available';
const imported = vi.fn();
const generated = vi.fn(async () => ({ kind: 'ride', from: 'Orchard', to: 'Changi Airport', price: 12, currency: '', note: 'at 5pm' }));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  TurboModuleRegistry: { get: (name: string) => (modulePresent && name === 'AppleLLMModule' ? {} : null) },
}));
vi.mock('react-native-apple-llm', () => {
  imported();
  if (!modulePresent) throw new Error("TurboModuleRegistry.getEnforcing: 'AppleLLMModule' could not be found");
  return {
    isFoundationModelsEnabled: async () => availability,
    configureSession: vi.fn(async () => true),
    generateStructuredOutput: generated,
    resetSession: vi.fn(async () => true),
  };
});

import { conciergeAvailability, conciergeModulePresent, draftIntent, parseToDraft } from '../src/concierge/model';

const CTX = { servicesEnabled: true, defaultCurrency: 'SGD' };

beforeEach(() => { modulePresent = true; availability = 'available'; imported.mockClear(); });

describe('probe gate', () => {
  it('module absent → unsupported WITHOUT importing the package', async () => {
    modulePresent = false;
    expect(conciergeModulePresent()).toBe(false);
    expect(await conciergeAvailability()).toBe('unsupported');
    expect(imported).not.toHaveBeenCalled(); // the #13/#14 regression guard
  });

  it('maps Apple Intelligence states', async () => {
    expect(await conciergeAvailability()).toBe('available');
    availability = 'appleIntelligenceNotEnabled';
    expect(await conciergeAvailability()).toBe('not_enabled');
    availability = 'modelNotReady';
    expect(await conciergeAvailability()).toBe('model_not_ready');
    availability = 'unavailable';
    expect(await conciergeAvailability()).toBe('unsupported');
  });
});

describe('parseToDraft', () => {
  it('ride: maps from/to/price/note, default currency', () => {
    const d = parseToDraft({ kind: 'ride', from: 'Orchard', to: 'Changi', price: 12, note: 'at 5pm' }, CTX)!;
    expect(d.schema).toBe('rideshare/1');
    expect(d.from).toBe('Orchard');
    expect(d.to).toBe('Changi');
    expect(d.payment).toBe('SGD 12');
    expect(d.note).toBe('at 5pm');
  });

  it('service: maps service/location; respects an explicit currency', () => {
    const d = parseToDraft({ kind: 'service', service: 'plumber', location: 'Hougang', price: 80, currency: 'USD' }, CTX)!;
    expect(d.schema).toBe('service/1');
    expect(d.service).toBe('plumber');
    expect(d.payment).toBe('USD 80');
  });

  it('never invents: empty parses and services-off return null', () => {
    expect(parseToDraft({}, CTX)).toBeNull();
    expect(parseToDraft({ kind: 'ride', note: 'hmm' }, CTX)).toBeNull();
    expect(parseToDraft({ kind: 'service', service: 'plumber' }, { ...CTX, servicesEnabled: false })).toBeNull();
    // price 0 = not mentioned → no payment field
    expect(parseToDraft({ kind: 'ride', to: 'Changi', price: 0 }, CTX)!.payment).toBeUndefined();
  });

  it('mislabeled kind heals: "service" with only a destination is a ride', () => {
    const d = parseToDraft({ kind: 'service', to: 'Changi' }, CTX)!;
    expect(d.schema).toBe('rideshare/1');
  });
});

describe('draftIntent', () => {
  it('end-to-end with the mocked model', async () => {
    const d = await draftIntent('ride to the airport at 5pm under $12', CTX);
    expect(d?.schema).toBe('rideshare/1');
    expect(d?.to).toBe('Changi Airport');
    expect(d?.payment).toBe('SGD 12');
  });

  it('garbage model output → null (human never sees a junk draft)', async () => {
    generated.mockResolvedValueOnce({} as any);
    expect(await draftIntent('???', CTX)).toBeNull();
  });
});
