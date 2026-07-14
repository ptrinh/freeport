/**
 * Add-app metadata probe — fetch the app page and pull out a display title
 * and icon so every launcher tile has both (the Apps grid requires them).
 *
 * The response is UNTRUSTED text: it is only regex-mined for <title> and
 * <link rel=…icon…> and never rendered or executed. On web the fetch is
 * usually CORS-blocked — callers fall back to hostname + /favicon.ico.
 */

export interface AppMeta {
  title: string | null;
  icon: string | null;
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

/** Fetch title + icon for an app URL. Never throws — {null, null} on failure. */
export async function fetchAppMeta(url: string): Promise<AppMeta> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'text/html' } });
      if (!res.ok) return { title: null, icon: null };
      const html = (await res.text()).slice(0, MAX_HTML_BYTES);
      return { title: pickTitle(html), icon: pickIcon(html, res.url || url) };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { title: null, icon: null };
  }
}
