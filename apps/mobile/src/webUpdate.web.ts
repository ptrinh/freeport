/**
 * Web "a newer deploy is live" detection.
 *
 * The service worker uses skipWaiting + clients.claim and does NOT cache the app
 * bundle (Expo serves content-hashed JS via Cloudflare), so the SW "waiting"
 * lifecycle never fires for a content deploy. The reliable signal is instead the
 * content-hashed entry-bundle filename in index.html: it changes whenever code
 * changes, so a fetched index.html whose entry hash differs from the running
 * page's means a newer deploy is available.
 *
 * `useWebUpdateAvailable()` polls (on an interval + on tab refocus) and flips
 * `available` once; `apply()` reloads into the new deploy.
 */
import { useEffect, useRef, useState } from 'react';
import { applyUpdate } from './updates';

// Sorted, de-duped list of the content-hashed entry bundles referenced by an
// HTML document — our deploy fingerprint. Returns null if none are found (e.g.
// a dev server that doesn't emit hashed bundles), which disables detection.
function markerFromHtml(html: string): string | null {
  const m = html.match(/\/_expo\/static\/js\/[^"'\s)]+?\.js/g);
  if (!m) return null;
  return Array.from(new Set(m)).sort().join('|');
}

function markerFromDom(): string | null {
  if (typeof document === 'undefined') return null;
  const srcs = Array.from(document.scripts)
    .map((s) => s.src)
    .filter((s) => s.includes('/_expo/static/js/'))
    .map((s) => { try { return new URL(s).pathname; } catch { return s; } });
  if (!srcs.length) return null;
  return Array.from(new Set(srcs)).sort().join('|');
}

export function useWebUpdateAvailable(): { available: boolean; apply: () => void } {
  const [available, setAvailable] = useState(false);
  const loaded = useRef<string | null>(null);
  const availRef = useRef(false);
  availRef.current = available;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return;
    loaded.current = markerFromDom();
    if (!loaded.current) return; // can't fingerprint this build → no detection

    let cancelled = false;
    const check = async () => {
      if (cancelled || availRef.current) return;
      try {
        const res = await fetch('/index.html', { cache: 'no-store' });
        if (!res.ok) return;
        const fresh = markerFromHtml(await res.text());
        if (fresh && fresh !== loaded.current) setAvailable(true);
      } catch { /* offline / transient — try again next tick */ }
    };

    const id = setInterval(check, 120_000); // every 2 min
    const onFocus = () => { if (document.visibilityState !== 'hidden') check(); };
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    const first = setTimeout(check, 15_000); // not instantly on load
    return () => {
      cancelled = true;
      clearInterval(id);
      clearTimeout(first);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  return { available, apply: () => { applyUpdate(); } };
}
