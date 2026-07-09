/**
 * Regression: share links (live-trip #t=…, deep links) must point at a PUBLIC
 * web origin a recipient can actually open. The desktop shell serves the app
 * from `tauri://localhost`, and the "Host Freeport for others" LAN feature from
 * http://<private-ip>:<port> — neither is openable by others, so those must
 * fall back to the configured public base (freeport.network). A real public
 * domain (incl. a fork's own) is used as-is. (Bug: link came out as
 * "tauri://localhost/#t=…".)
 */
import { describe, it, expect, vi } from 'vitest';
// webBase.ts imports react-native (Flow source) + expo-constants — stub them so
// the pure resolveWebBase() can be imported in a plain Node test.
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
import { resolveWebBase } from '../src/webBase';

const pick = (origin: string) => {
  try {
    const u = new URL(origin);
    return resolveWebBase(origin, u.protocol, u.hostname);
  } catch {
    return resolveWebBase(origin, undefined, undefined);
  }
};

describe('resolveWebBase — public origin only', () => {
  it('desktop shell tauri://localhost → null (use configured base)', () => {
    expect(pick('tauri://localhost')).toBeNull();
  });

  it('LAN self-host IPs → null', () => {
    expect(pick('http://192.168.1.16:1988')).toBeNull();
    expect(pick('http://10.0.0.5:3000')).toBeNull();
    expect(pick('http://172.16.5.5:8080')).toBeNull();
    expect(pick('http://172.31.255.1:1988')).toBeNull();
  });

  it('localhost / loopback / .local → null', () => {
    expect(pick('http://localhost:8081')).toBeNull();
    expect(pick('http://127.0.0.1:19006')).toBeNull();
    expect(pick('http://mymac.local:1988')).toBeNull();
  });

  it('real public https origins → used as-is', () => {
    expect(pick('https://freeport.network')).toBe('https://freeport.network');
    expect(pick('https://freeport-dj7.pages.dev')).toBe('https://freeport-dj7.pages.dev');
    expect(pick('https://a-fork.example.com')).toBe('https://a-fork.example.com');
  });

  it('public IP ranges adjacent to private blocks are treated as public', () => {
    // 172.15 and 172.32 are OUTSIDE the 172.16–172.31 private range.
    expect(pick('https://172.15.0.1')).toBe('https://172.15.0.1');
    expect(pick('https://172.32.0.1')).toBe('https://172.32.0.1');
  });

  it('non-http protocols and empty origins → null', () => {
    expect(pick('file:///Users/x/index.html')).toBeNull();
    expect(resolveWebBase('', 'https:', 'freeport.network')).toBeNull();
    expect(resolveWebBase(undefined, undefined, undefined)).toBeNull();
  });

  it('strips a trailing slash from the chosen origin', () => {
    expect(resolveWebBase('https://freeport.network/', 'https:', 'freeport.network')).toBe('https://freeport.network');
  });
});
