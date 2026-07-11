/**
 * LNURL proxy — keeps lightning addresses on the apex domain.
 *
 * user@freeport.network needs Breez's hosted LNURL server, but the apex
 * serves the web app from Cloudflare Pages and can't CNAME to breez.tips.
 * This worker forwards the LNURL routes upstream instead.
 *
 * Per Breez (Jesse, 2026-07-11): their server resolves the serving domain
 * from the HOST header, and these routes must all be forwarded (more may be
 * added later): /lnurlpay/*, /.well-known/lnurlp/*, /lnurlp/*, /verify/*.
 * freeport.network is whitelisted on their side. We attempt a true Host
 * override (honored for same-account fetches; silently rewritten otherwise)
 * and always include X-Forwarded-Host as the fallback signal.
 */
const UPSTREAM = 'https://breez.tips';
const PREFIXES = ['/lnurlpay/', '/.well-known/lnurlp/', '/lnurlp/', '/verify/'];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!PREFIXES.some((p) => url.pathname.startsWith(p))) {
      return new Response('not found', { status: 404 });
    }
    const upstream = new URL(UPSTREAM + url.pathname + url.search);
    const headers = new Headers(request.headers);
    headers.set('Host', url.hostname);              // domain resolution upstream
    headers.set('X-Forwarded-Host', url.hostname);  // fallback signal
    headers.delete('cf-connecting-ip');
    const resp = await fetch(upstream, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    });
    const out = new Headers(resp.headers);
    out.set('access-control-allow-origin', '*');
    out.set('cache-control', 'no-store');
    return new Response(resp.body, { status: resp.status, headers: out });
  },
};
