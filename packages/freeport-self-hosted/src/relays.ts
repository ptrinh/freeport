/**
 * Per-call relay override validation. Lets a caller target specific relays,
 * while guarding against abuse: only ws/wss schemes, a small cap on fan-out
 * (each extra relay is another upstream socket), and a block on loopback /
 * private / link-local hosts so the override can't be used to probe internal
 * services (basic SSRF guard).
 */
const MAX_RELAYS = Number(process.env.MAX_RELAYS ?? 10);

/** Is this a private/loopback/link-local IPv4 in dotted-quad form? */
function isPrivateIPv4(h: string): boolean {
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a > 255 || b > 255) return true; // malformed → treat as unsafe
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (isPrivateIPv4(h)) return true;

  // Reject non-dotted-decimal IPv4 encodings outright — bare integer (2130706433),
  // hex (0x7f000001), octal (0177.0.0.1) — rather than trying to normalize them;
  // a legitimate relay host is never written this way.
  if (/^(0x[0-9a-f]+|\d{5,})$/.test(h)) return true;
  if (/^0\d/.test(h) && /^[0-9.]+$/.test(h)) return true; // leading-zero octal-ish

  // IPv6 loopback / unspecified / ULA (fc00::/7) / link-local (fe80::/10), and
  // IPv4-mapped/-compatible forms embedding a private v4 address.
  if (h === '::1' || h === '::' ) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h)) return true;          // ULA fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;            // link-local fe80::/10
  // IPv4-mapped/-compatible IPv6 — URL parsing normalizes the embedded v4 to
  // hex (::ffff:a9fe:a9fe), so just reject the whole mapped family; a relay is
  // never legitimately addressed this way.
  if (/^::(ffff:)?[0-9a-f.:]+$/.test(h) && h !== '::1') return true;

  return false;
}

/**
 * Returns a sanitized relay list, or undefined to fall back to the server's
 * default set. Throws on a clearly bad/abusive override.
 */
export function sanitizeRelays(input?: string[]): string[] | undefined {
  if (!input || input.length === 0) return undefined;
  if (input.length > MAX_RELAYS) {
    throw new Error(`Too many relays (max ${MAX_RELAYS}).`);
  }
  const out: string[] = [];
  for (const raw of input) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(`Invalid relay URL: ${raw}`);
    }
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') {
      throw new Error(`Relay must be ws:// or wss:// — got ${url.protocol}//`);
    }
    if (isPrivateHost(url.hostname)) {
      throw new Error(`Relay host not allowed: ${url.hostname}`);
    }
    out.push(url.toString().replace(/\/$/, ''));
  }
  return [...new Set(out)];
}
