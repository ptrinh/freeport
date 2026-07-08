/**
 * Regression tests for GlitchTip issue 4: "NetworkError: A network error
 * occurred." (DOMException code 19) as an UNHANDLED rejection on web.
 * pushManager.subscribe() rejects with exactly that where the browser's push
 * service is unreachable (e.g. FCM blocked country-wide — the event came from
 * an Iranian IP). enablePush must never reject: every failure resolves to a
 * PushStatus so callers (Settings toggle, post-onboarding auto-subscribe)
 * can't leak unhandled rejections.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { enablePush, pushSupported } from '../src/push.web';

/** DOMException NetworkError exactly as browsers reject with. */
const networkError = () => Object.assign(new Error('A network error occurred.'), { name: 'NetworkError', code: 19 });

function stubBrowser(over: {
  permission?: string;
  subscribe?: () => Promise<unknown>;
  ready?: Promise<unknown>;
  fetchFn?: typeof fetch;
} = {}) {
  const subscribe = over.subscribe ?? (async () => ({ toJSON: () => ({ endpoint: 'https://push.example/x' }) }));
  const reg = {
    pushManager: {
      getSubscription: async () => null,
      subscribe,
    },
  };
  vi.stubGlobal('window', { PushManager: function PushManager() {} });
  vi.stubGlobal('navigator', { serviceWorker: { ready: over.ready ?? Promise.resolve(reg) } });
  vi.stubGlobal('Notification', {
    permission: 'default',
    requestPermission: async () => over.permission ?? 'granted',
  });
  vi.stubGlobal('fetch', over.fetchFn ?? (async (url: any) => {
    if (String(url).endsWith('/vapidPublicKey')) {
      return { ok: true, json: async () => ({ publicKey: 'BArandomkey' }) } as any;
    }
    return { ok: true, json: async () => ({}) } as any;
  }));
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('web enablePush never rejects (GlitchTip issue 4)', () => {
  it('push service unreachable — subscribe() rejects DOMException NetworkError → resolves "error"', async () => {
    stubBrowser({ subscribe: () => Promise.reject(networkError()) });
    await expect(enablePush('ab'.repeat(32), 'https://nostr-mcp.trinh.uk')).resolves.toBe('error');
  });

  it('service worker never becomes ready (rejects) → resolves "error"', async () => {
    stubBrowser({ ready: Promise.reject(networkError()) });
    await expect(enablePush('ab'.repeat(32), 'https://nostr-mcp.trinh.uk')).resolves.toBe('error');
  });

  it('notifier /subscribe unreachable (fetch throws) → resolves "error"', async () => {
    stubBrowser({
      fetchFn: (async (url: any) => {
        if (String(url).endsWith('/vapidPublicKey')) {
          return { ok: true, json: async () => ({ publicKey: 'BArandomkey' }) } as any;
        }
        throw networkError(); // POST /subscribe
      }) as any,
    });
    await expect(enablePush('ab'.repeat(32), 'https://nostr-mcp.trinh.uk')).resolves.toBe('error');
  });

  it('permission denied → "denied" (no subscribe attempted)', async () => {
    const subscribe = vi.fn();
    stubBrowser({ permission: 'denied', subscribe });
    await expect(enablePush('ab'.repeat(32), 'https://nostr-mcp.trinh.uk')).resolves.toBe('denied');
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('happy path still returns "on"', async () => {
    stubBrowser();
    await expect(enablePush('ab'.repeat(32), 'https://nostr-mcp.trinh.uk')).resolves.toBe('on');
  });

  it('unsupported platform (no stubs) → "unsupported"', async () => {
    vi.unstubAllGlobals();
    expect(pushSupported()).toBe(false);
    await expect(enablePush('ab'.repeat(32), 'https://nostr-mcp.trinh.uk')).resolves.toBe('unsupported');
  });
});
