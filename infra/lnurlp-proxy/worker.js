/**
 * LNURL-pay proxy — keeps lightning addresses on the apex domain.
 *
 * user@freeport.network resolves via GET /.well-known/lnurlp/<user>, but the
 * apex serves the web app from Cloudflare Pages and can't CNAME to Breez's
 * hosted LNURL server (breez.tips). This worker forwards those requests
 * upstream instead. The original host rides along as X-Forwarded-Host since
 * a cross-zone fetch can't preserve the Host header.
 */
export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/.well-known/lnurlp/')) {
      return new Response('not found', { status: 404 });
    }
    const upstream = new URL('https://breez.tips' + url.pathname + url.search);
    const resp = await fetch(upstream, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-forwarded-host': url.hostname,
        'user-agent': 'freeport-lnurlp-proxy',
      },
    });
    const headers = new Headers();
    headers.set('content-type', resp.headers.get('content-type') ?? 'application/json');
    headers.set('access-control-allow-origin', '*');
    headers.set('cache-control', 'no-store');
    return new Response(resp.body, { status: resp.status, headers });
  },
};
