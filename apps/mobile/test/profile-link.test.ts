import { describe, it, expect, vi } from 'vitest';

// profile.ts imports these at module top; stub them so this unit test can load
// the pure link-validation helpers without pulling in native/relay deps.
vi.mock('../src/kv', () => ({ kvGet: vi.fn(), kvSet: vi.fn(), kvDelete: vi.fn() }));
vi.mock('../src/cloudSync', () => ({ scheduleCloudSync: vi.fn() }));
vi.mock('nostr-tools/pool', () => ({ SimplePool: class { publish() { return []; } close() {} } }));

import { httpsLinkOrNull, linkHost } from '../src/profile';

describe('httpsLinkOrNull', () => {
  it('accepts and normalizes https links', () => {
    expect(httpsLinkOrNull('https://idcert.com/verify/abc')).toBe('https://idcert.com/verify/abc');
    expect(httpsLinkOrNull('  https://example.com  ')).toBe('https://example.com/');
  });

  it('rejects non-https schemes (peer URLs are untrusted)', () => {
    expect(httpsLinkOrNull('http://idcert.com')).toBeNull();
    expect(httpsLinkOrNull('javascript:alert(1)')).toBeNull();
    expect(httpsLinkOrNull('data:text/html,x')).toBeNull();
    expect(httpsLinkOrNull('ftp://example.com')).toBeNull();
  });

  it('rejects userinfo tricks, empty, over-long, and unparseable input', () => {
    expect(httpsLinkOrNull('https://user:pass@evil.com')).toBeNull();
    expect(httpsLinkOrNull('')).toBeNull();
    expect(httpsLinkOrNull('   ')).toBeNull();
    expect(httpsLinkOrNull('not a url')).toBeNull();
    expect(httpsLinkOrNull('https://' + 'a'.repeat(2000) + '.com')).toBeNull();
    expect(httpsLinkOrNull(undefined)).toBeNull();
    expect(httpsLinkOrNull(null)).toBeNull();
  });

  it('normalizes an uppercase HTTPS scheme (scheme is case-insensitive)', () => {
    expect(httpsLinkOrNull('HTTPS://Example.COM')).toBe('https://example.com/');
  });

  it('converts an IDN/unicode host to its punycode form', () => {
    expect(httpsLinkOrNull('https://münchen.de/x')).toBe('https://xn--mnchen-3ya.de/x');
  });

  it('strips surrounding whitespace including tabs and newlines', () => {
    expect(httpsLinkOrNull('\thttps://example.com\n')).toBe('https://example.com/');
  });

  it('accepts a link exactly at the 1024-char boundary, rejects one past it', () => {
    const base = 'https://a.com/';
    const at = base + 'a'.repeat(1024 - base.length); // length === 1024
    expect(at.length).toBe(1024);
    expect(httpsLinkOrNull(at)).toBe(at);
    expect(httpsLinkOrNull(at + 'a')).toBeNull(); // length 1025
  });
});

describe('linkHost', () => {
  it('returns the hostname of a valid https link', () => {
    expect(linkHost('https://idcert.com/verify/abc')).toBe('idcert.com');
  });

  it('returns the punycode hostname for an IDN link', () => {
    expect(linkHost('https://münchen.de')).toBe('xn--mnchen-3ya.de');
  });

  it('returns null for anything not a valid https link', () => {
    expect(linkHost('http://idcert.com')).toBeNull();
    expect(linkHost('')).toBeNull();
  });
});
