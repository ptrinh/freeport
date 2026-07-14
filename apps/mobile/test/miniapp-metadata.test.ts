/**
 * Add-app metadata probe — manifest-first (verified), HTML fallback
 * (unverified). The fetch layer is mocked; responses are hostile until
 * proven otherwise.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAppMeta, manifestUrl, sameOriginAsShell } from '../src/miniapps/metadata';

const APP = 'https://shop.example/store/';

function mockFetch(routes: Record<string, string | number>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const hit = routes[String(url)];
    if (hit === undefined || typeof hit === 'number') {
      return { ok: false, status: hit ?? 404, text: async () => '' } as Response;
    }
    return { ok: true, status: 200, text: async () => hit } as unknown as Response;
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('sameOriginAsShell', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('no shell origin (native / node) → always false', () => {
    expect(sameOriginAsShell('https://apps.freeport.network/esim-store/')).toBe(false);
  });

  it('on web, flags an app served from the shell origin', () => {
    vi.stubGlobal('location', { origin: 'https://freeport.network' });
    expect(sameOriginAsShell('https://freeport.network/esim-store/')).toBe(true);
    expect(sameOriginAsShell('https://apps.freeport.network/esim-store/')).toBe(false);
    expect(sameOriginAsShell('not a url')).toBe(false);
  });
});

describe('manifestUrl', () => {
  it('resolves next to the app page, per-app not per-origin', () => {
    expect(manifestUrl('https://shop.example/store/')).toBe('https://shop.example/store/freeport.json');
    expect(manifestUrl('https://shop.example')).toBe('https://shop.example/freeport.json');
    expect(manifestUrl('not a url')).toBeNull();
  });

  it('treats a slashless, extensionless path as a directory (…/esim-store)', () => {
    // Bug: bare new URL() dropped the last segment → root freeport.json.
    expect(manifestUrl('https://apps.freeport.network/esim-store')).toBe('https://apps.freeport.network/esim-store/freeport.json');
    expect(manifestUrl('https://apps.freeport.network/esim-store/')).toBe('https://apps.freeport.network/esim-store/freeport.json');
    // A real file path resolves the manifest as its sibling.
    expect(manifestUrl('https://shop.example/store/index.html')).toBe('https://shop.example/store/freeport.json');
  });
});

describe('fetchAppMeta', () => {
  it('valid manifest ⇒ verified, with icon resolved and permissions filtered', async () => {
    mockFetch({
      [`${APP}freeport.json`]: JSON.stringify({
        name: '  eSIM   Shop  ',
        icon: 'icon.png',
        permissions: ['freeport.paySpark', 'evil.method', 'getPublicKey', 42],
      }),
    });
    const m = await fetchAppMeta(APP);
    expect(m).toEqual({
      title: 'eSIM Shop',
      icon: 'https://shop.example/store/icon.png',
      verified: true,
      permissions: ['freeport.paySpark', 'getPublicKey'], // unknown/junk dropped
    });
  });

  it('manifest without a name is rejected → falls back to HTML, unverified', async () => {
    mockFetch({
      [`${APP}freeport.json`]: JSON.stringify({ icon: 'icon.png' }),
      [APP]: '<html><head><title>Some Site</title></head></html>',
    });
    const m = await fetchAppMeta(APP);
    expect(m.verified).toBe(false);
    expect(m.title).toBe('Some Site');
  });

  it('non-https manifest icon is dropped, manifest still verifies', async () => {
    mockFetch({
      [`${APP}freeport.json`]: JSON.stringify({ name: 'X', icon: 'javascript:alert(1)' }),
    });
    const m = await fetchAppMeta(APP);
    expect(m.verified).toBe(true);
    expect(m.icon).toBeNull();
  });

  it('no manifest, no page ⇒ nulls, unverified — never throws', async () => {
    mockFetch({});
    const m = await fetchAppMeta(APP);
    expect(m).toEqual({ title: null, icon: null, verified: false, permissions: [] });
  });

  it('oversized/hostile manifest name is clamped', async () => {
    mockFetch({
      [`${APP}freeport.json`]: JSON.stringify({ name: 'A'.repeat(500) }),
    });
    const m = await fetchAppMeta(APP);
    expect(m.title!.length).toBe(60);
  });
});
