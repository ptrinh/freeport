import { describe, it, expect } from 'vitest';
import { parseNwcUrl } from '../src/wallet/nwc';
import { walletProviderFor } from '../src/wallet';

const PK = 'b'.repeat(64);
const SECRET = 'c'.repeat(64);

describe('parseNwcUrl', () => {
  it('parses a standard connection string', () => {
    const c = parseNwcUrl(`nostr+walletconnect://${PK}?relay=wss://relay.getalby.com/v1&secret=${SECRET}`);
    expect(c).not.toBeNull();
    expect(c!.walletPubkey).toBe(PK);
    expect(c!.relays).toEqual(['wss://relay.getalby.com/v1']);
    expect(c!.secret).toBe(SECRET);
  });

  it('accepts the legacy nostrwalletconnect:// scheme', () => {
    const c = parseNwcUrl(`nostrwalletconnect://${PK}?relay=wss://r.example&secret=${SECRET}`);
    expect(c).not.toBeNull();
  });

  it('collects multiple relay params', () => {
    const c = parseNwcUrl(`nostr+walletconnect://${PK}?relay=wss://a.example&relay=wss://b.example&secret=${SECRET}`);
    expect(c!.relays).toEqual(['wss://a.example', 'wss://b.example']);
  });

  it('keeps lud16 when present', () => {
    const c = parseNwcUrl(`nostr+walletconnect://${PK}?relay=wss://a.example&secret=${SECRET}&lud16=user@getalby.com`);
    expect(c!.lud16).toBe('user@getalby.com');
  });

  it('lowercases pubkey and secret', () => {
    const c = parseNwcUrl(`nostr+walletconnect://${'B'.repeat(64)}?relay=wss://a.example&secret=${'C'.repeat(64)}`);
    expect(c!.walletPubkey).toBe(PK);
    expect(c!.secret).toBe(SECRET);
  });

  it('trims surrounding whitespace (paste artifacts)', () => {
    const c = parseNwcUrl(`  nostr+walletconnect://${PK}?relay=wss://a.example&secret=${SECRET}\n`);
    expect(c).not.toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseNwcUrl('')).toBeNull();
    expect(parseNwcUrl('not a url')).toBeNull();
    expect(parseNwcUrl(`nostr+walletconnect://${'z'.repeat(64)}?relay=wss://a&secret=${SECRET}`)).toBeNull(); // non-hex pubkey
    expect(parseNwcUrl(`nostr+walletconnect://${PK.slice(1)}?relay=wss://a&secret=${SECRET}`)).toBeNull(); // short pubkey
    expect(parseNwcUrl(`nostr+walletconnect://${PK}?secret=${SECRET}`)).toBeNull(); // no relay
    expect(parseNwcUrl(`nostr+walletconnect://${PK}?relay=https://a.example&secret=${SECRET}`)).toBeNull(); // non-ws relay
    expect(parseNwcUrl(`nostr+walletconnect://${PK}?relay=wss://a.example`)).toBeNull(); // no secret
    expect(parseNwcUrl(`nostr+walletconnect://${PK}?relay=wss://a.example&secret=nothex`)).toBeNull();
  });
});

describe('walletProviderFor', () => {
  it('builds an NWC provider from a valid string', () => {
    const p = walletProviderFor(`nostr+walletconnect://${PK}?relay=wss://a.example&secret=${SECRET}`);
    expect(p).not.toBeNull();
    expect(p!.kind).toBe('nwc');
    expect(p!.capabilities()).toEqual({ lightning: true, stablecoin: false, transactions: true });
    p!.close();
  });

  it('returns null for empty / invalid strings', () => {
    expect(walletProviderFor('')).toBeNull();
    expect(walletProviderFor('garbage')).toBeNull();
  });
});
