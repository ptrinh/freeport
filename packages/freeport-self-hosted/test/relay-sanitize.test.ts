/**
 * sanitizeRelays SSRF guard — a per-call relay override must not be usable to
 * open sockets to loopback / private / link-local / cloud-metadata hosts, in
 * any of the encodings an attacker might reach for.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeRelays } from '../src/relays.js';

describe('sanitizeRelays', () => {
  it('passes through public wss/ws relays (dedup, trailing slash trimmed)', () => {
    expect(sanitizeRelays(['wss://relay.damus.io/', 'wss://relay.damus.io'])).toEqual(['wss://relay.damus.io']);
    expect(sanitizeRelays(undefined)).toBeUndefined();
    expect(sanitizeRelays([])).toBeUndefined();
  });

  it('rejects non-ws(s) schemes', () => {
    expect(() => sanitizeRelays(['http://relay.example'])).toThrow();
    expect(() => sanitizeRelays(['file:///etc/passwd'])).toThrow();
  });

  it.each([
    ['localhost', 'ws://localhost:4444'],
    ['loopback v4', 'ws://127.0.0.1'],
    ['unspecified v4', 'ws://0.0.0.0'],
    ['private 10/8', 'ws://10.1.2.3'],
    ['private 192.168', 'ws://192.168.0.1'],
    ['private 172.16', 'ws://172.16.5.5'],
    ['link-local / metadata', 'ws://169.254.169.254'],
    ['.local mDNS', 'ws://printer.local'],
    ['.internal', 'ws://db.internal'],
    ['bare-integer v4 (2130706433=127.0.0.1)', 'ws://2130706433'],
    ['hex v4', 'ws://0x7f000001'],
    ['IPv6 loopback', 'ws://[::1]'],
    ['IPv6 ULA fd00', 'ws://[fd00::1]'],
    ['IPv6 link-local fe80', 'ws://[fe80::1]'],
    ['IPv4-mapped private', 'ws://[::ffff:169.254.169.254]'],
  ])('blocks %s', (_label, url) => {
    expect(() => sanitizeRelays([url])).toThrow(/not allowed|Invalid/);
  });
});
