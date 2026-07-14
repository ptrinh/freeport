/**
 * Backup bundle encryption: with a passphrase the ENTIRE bundle is encrypted
 * (v2 envelope), so the wallet-connect (NWC) credential and phone number are
 * protected — not just the nsec. Without a passphrase the bundle is the
 * plaintext v1 form the user opted into.
 */
import { describe, it, expect, vi } from 'vitest';

// identity.ts pulls RN-only shims transitively; stub them for the node runner.
vi.mock('react-native-get-random-values', () => ({}));
vi.mock('../src/kv', () => {
  const store = new Map<string, string>();
  return {
    kvGet: vi.fn(async (k: string) => store.get(k) ?? null),
    kvSet: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    kvDelete: vi.fn(async (k: string) => { store.delete(k); }),
    profileId: () => '', storagePrefix: () => '', storageKey: (k: string) => k,
  };
});

import { generateSecretKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';
import { finalizeBackupBundle, parseBackupBundle, bundleNeedsPassphrase } from '../src/identity';

const NWC = 'nostr+walletconnect://cafe?secret=deadbeefdeadbeef';
const PHONE = '+6591234567';

function inner() {
  const sk = generateSecretKey();
  return {
    sk,
    obj: { key: nip19.nsecEncode(sk), prefs: { walletNwcUrl: NWC }, profile: { phone: PHONE } },
  };
}

describe('backup bundle encryption', () => {
  it('no passphrase → plaintext v1; secrets are in the clear (opted out)', () => {
    const { obj } = inner();
    const text = finalizeBackupBundle(obj, '');
    expect(text).toContain('deadbeef');
    expect(bundleNeedsPassphrase(text)).toBe(false);
  });

  it('passphrase → v2 envelope; NWC secret, phone, and nsec are NOT in the file', () => {
    const { sk, obj } = inner();
    const text = finalizeBackupBundle(obj, 'hunter2');
    expect(text).not.toContain('deadbeef');       // NWC secret
    expect(text).not.toContain('91234567');        // phone digits
    expect(text).not.toContain(nip19.nsecEncode(sk)); // key
    expect(bundleNeedsPassphrase(text)).toBe(true);
  });

  it('round-trips with the correct passphrase', async () => {
    const { sk, obj } = inner();
    const text = finalizeBackupBundle(obj, 'hunter2');
    const out = await parseBackupBundle(text, 'hunter2');
    expect(nip19.nsecEncode(out.sk)).toBe(nip19.nsecEncode(sk));
    expect((out.prefs as any).walletNwcUrl).toBe(NWC);
    expect((out.profile as any).phone).toBe(PHONE);
  });

  it('a wrong passphrase throws (never falls through to a misleading error)', async () => {
    const { obj } = inner();
    const text = finalizeBackupBundle(obj, 'hunter2');
    await expect(parseBackupBundle(text, 'wrong')).rejects.toThrow(/passphrase/i);
  });

  it('a v2 file with no passphrase asks for one', async () => {
    const { obj } = inner();
    const text = finalizeBackupBundle(obj, 'hunter2');
    await expect(parseBackupBundle(text, '')).rejects.toThrow(/encrypted/i);
  });

  it('still restores a legacy plaintext v1 bundle', async () => {
    const { sk, obj } = inner();
    const text = finalizeBackupBundle(obj, ''); // v1
    const out = await parseBackupBundle(text, '');
    expect(nip19.nsecEncode(out.sk)).toBe(nip19.nsecEncode(sk));
    expect((out.prefs as any).walletNwcUrl).toBe(NWC);
  });
});
