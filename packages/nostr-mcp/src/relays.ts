/**
 * Per-call relay override validation. Lets a caller target specific relays,
 * while guarding against abuse: only ws/wss schemes, a small cap on fan-out
 * (each extra relay is another upstream socket), and a block on loopback /
 * private / link-local hosts so the override can't be used to probe internal
 * services (basic SSRF guard).
 */
const MAX_RELAYS = Number(process.env.MAX_RELAYS ?? 10);

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '::1' || h.endsWith('.local')) return true;
  if (h === '0.0.0.0') return true;
  // IPv4 private / loopback / link-local / cloud-metadata ranges.
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local + 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
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
