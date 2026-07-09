/**
 * The public notification server was renamed nostr-mcp.trinh.uk →
 * mcp.freeport.network. Installs that saved the OLD default in prefs (anyone
 * who toggled push before the rename) must follow the rename automatically —
 * the Settings field otherwise keeps showing the old host forever. Custom
 * self-hosted URLs must never be rewritten.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/kv', () => ({
  kvGet: async () => null,
  kvSet: async () => {},
}));
// cloudSync transitively imports react-native (Flow syntax vitest can't parse).
vi.mock('../src/cloudSync', () => ({ scheduleCloudSync: () => {} }));

import { migrateNotifyEndpoint } from '../src/prefs';

const NEW = 'https://mcp.freeport.network';

describe('notifyEndpoint migration (old public instance → freeport.network)', () => {
  it('rewrites the legacy public-instance URL to the new canonical host', () => {
    expect(migrateNotifyEndpoint('https://nostr-mcp.trinh.uk')).toBe(NEW);
  });

  it('tolerates trailing slashes and whitespace on the stored value', () => {
    expect(migrateNotifyEndpoint('https://nostr-mcp.trinh.uk/')).toBe(NEW);
    expect(migrateNotifyEndpoint('  https://nostr-mcp.trinh.uk  ')).toBe(NEW);
  });

  it('leaves a custom self-hosted endpoint untouched', () => {
    expect(migrateNotifyEndpoint('https://notify.my-community.org')).toBe('https://notify.my-community.org');
    expect(migrateNotifyEndpoint('http://192.168.1.20:8788')).toBe('http://192.168.1.20:8788');
  });

  it('passes the new default through unchanged', () => {
    expect(migrateNotifyEndpoint(NEW)).toBe(NEW);
  });

  it('empty/missing stored value → undefined (caller falls back to the default)', () => {
    expect(migrateNotifyEndpoint('')).toBeUndefined();
    expect(migrateNotifyEndpoint(undefined)).toBeUndefined();
    expect(migrateNotifyEndpoint(null)).toBeUndefined();
  });
});
