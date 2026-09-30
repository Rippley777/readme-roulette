/** Cloudflare owns the public hostname; Azure receives its registered origin hostname. */
export default {
  async fetch(request, env) {
    const incoming = new URL(request.url);
    const publicUrl = new URL(env.PUBLIC_URL);
    if (incoming.hostname !== publicUrl.hostname) return new Response('Not found', { status: 404 });
    if (incoming.protocol !== 'https:') {
      incoming.protocol = 'https:';
      return Response.redirect(incoming.toString(), 308);
    }
    const origin = new URL(env.AZURE_ORIGIN);
    const target = new URL(incoming);
    target.protocol = origin.protocol;
    target.host = origin.host;
    const upstream = new Request(target, request);
    upstream.headers.set('Host', origin.host);
    upstream.headers.set('X-Forwarded-Host', publicUrl.host);
    upstream.headers.set('X-Forwarded-Proto', 'https');
    // Keep the browser's Origin for CSRF checks. Keep OAuth redirects and cookies intact.
    // Never follow GitHub redirects server-side or cache personalized API responses.
    return fetch(upstream, { redirect: 'manual', cf: { cacheTtl: 0, cacheEverything: false } });
  },
};
