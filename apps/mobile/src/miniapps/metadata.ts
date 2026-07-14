/**
 * Add-app metadata probe — establish that a URL is a mini-app and pull out a
 * display title + icon so every launcher tile has both (the Apps grid
 * requires them).
 *
 * Primary source: the app's MANIFEST, `freeport.json` resolved against the
 * launch URL directory (per-app, so several apps can share an origin):
 *
 *   { "name": "eSIM Demo Shop", "icon": "icon.png",
 *     "permissions": ["getPublicKey", "freeport.paySpark"] }
 *
 * A manifest present and valid ⇒ `verified: true`. No manifest ⇒ fall back to
 * mining the page HTML for <title>/<link rel=…icon…> and mark unverified —
 * the add flow warns but may still allow (no gatekeeper). Verification is a
 * LABEL, not a security boundary: a hostile page can serve a perfect
 * manifest; the firewall remains the real defense.
 *
 * All responses are UNTRUSTED text — parsed, never rendered or executed. On
 * web these fetches are CORS-blocked unless the app allows it (our published
 * demos do); callers fall back to hostname + /favicon.ico.
 */
import { BRIDGE_METHODS } from './firewall';

export interface AppMeta {
  title: string | null;
  icon: string | null;
  /** True when a valid freeport.json manifest was found at the app URL. */
  verified: boolean;
  /** Bridge methods the manifest declares it may use (informational). */
  permissions: string[];
}

const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 512 * 1024;

/** Best icon first: apple-touch-icon beats favicon (bigger, tile-shaped). */
function pickIcon(html: string, baseUrl: string): string | null {
  const links = html.match(/<link\b[^>]*>/gi) ?? [];
  let touch: string | null = null;
  let plain: string | null = null;
  for (const tag of links) {
    const rel = /rel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (!/\bicon\b|apple-touch-icon/.test(rel)) continue;
    const href = /href\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href) continue;
    let abs: string;
    try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
    if (!abs.startsWith('https://')) continue;
    if (rel.includes('apple-touch-icon')) { touch = touch ?? abs; } else { plain = plain ?? abs; }
  }
  return touch ?? plain;
}

function pickTitle(html: string): string | null {
  const m = /<title[^>]*>([^<]{1,300})/i.exec(html);
  if (!m) return null;
  const title = m[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
  return title ? title.slice(0, 60) : null;
}

async function fetchText(url: string, accept: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: accept } });
    if (!res.ok) return null;
    return (await res.text()).slice(0, MAX_HTML_BYTES);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The manifest URL for a launch URL: `freeport.json` next to the app page. */
export function manifestUrl(launchUrl: string): string | null {
  try {
    const u = new URL('freeport.json', launchUrl);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function parseManifest(text: string, base: string): AppMeta | null {
  let m: unknown;
  try { m = JSON.parse(text); } catch { return null; }
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>;
  const name = typeof o.name === 'string' ? o.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  if (!name) return null; // name is the one hard requirement
  let icon: string | null = null;
  if (typeof o.icon === 'string' && o.icon) {
    try {
      const u = new URL(o.icon, base);
      if (u.protocol === 'https:') icon = u.toString();
    } catch { /* bad icon → tile falls back */ }
  }
  const permissions = Array.isArray(o.permissions)
    ? o.permissions.filter((p): p is string => (BRIDGE_METHODS as readonly string[]).includes(p as string))
    : [];
  return { title: name, icon, verified: true, permissions };
}

/** Probe an app URL: manifest first (⇒ verified), HTML fallback (⇒ not).
 *  Never throws — worst case {title:null, icon:null, verified:false}. */
export async function fetchAppMeta(url: string): Promise<AppMeta> {
  const mUrl = manifestUrl(url);
  if (mUrl) {
    const text = await fetchText(mUrl, 'application/json');
    if (text) {
      const meta = parseManifest(text, mUrl);
      if (meta) return meta;
    }
  }
  const html = await fetchText(url, 'text/html');
  if (!html) return { title: null, icon: null, verified: false, permissions: [] };
  return { title: pickTitle(html), icon: pickIcon(html, url), verified: false, permissions: [] };
}
