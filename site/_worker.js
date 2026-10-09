// Cloudflare Pages worker for the whole site. Two addresses serve these files:
//   isabellaocean-app.pages.dev   the hackathon address: everything, including the devnet test APK
//   isabellaocean.app             the product's own domain, which the dApp Store build presents to wallets
// The product domain is what a wallet classifies when the store build asks it to sign (it is the app's
// Mobile Wallet Adapter identity). So it serves the product as it ships: no test APK, no sideload
// link, no devnet or "in testing" wording, and a real 404 for paths that are not part of the site
// (Pages would otherwise answer every unknown path with the home page). The pages.dev address is left
// exactly as the hackathon judges were given it. This file is not served.
const STORE_HOSTS = new Set(['isabellaocean.app', 'www.isabellaocean.app']);

// What the product domain serves; everything else is 404. Keep in step with site/.
const STORE_PATHS = new Set(['/', '/index.html', '/privacy', '/privacy.html', '/terms', '/terms.html',
  '/icon.png', '/icon.svg', '/style.css', '/ocean-pass.json', '/isabella-ocean-deck.pdf',
  '/.well-known/assetlinks.json',
  // The App Store build's own pages. They stand alone: nothing on them links to the rest of the site.
  '/apple/privacy', '/apple/privacy.html', '/apple/terms', '/apple/terms.html', '/apple/support', '/apple/support.html']);
const STORE_PREFIXES = ['/img/'];

// Devnet-only passages, removed from the product domain's pages. test/site/worker.test.mjs checks that
// each one matches its page in site/ exactly once, so a reworded page fails the test instead of
// leaking devnet wording to the product domain.
export const STORE_REMOVALS = [
  { page: 'index.html', re: /\s*<p id="devnet-apk">[\s\S]*?<\/p>/ },               // the sideload link
  { page: 'index.html', re: /\s*<p class="note">[\s\S]*?<\/p>/ },                  // "in testing on devnet"
  { page: 'terms.html', re: /\s*<h2>Testing period<\/h2>\s*<p>[\s\S]*?<\/p>/ },   // the terms' testing section
];

export function isStorePath(pathname) {
  return STORE_PATHS.has(pathname) || STORE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function rewriteStoreHtml(html) {
  let out = html;
  for (const { re } of STORE_REMOVALS) out = out.replace(re, '');
  return out;
}

const notFound = () => new Response('Not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!STORE_HOSTS.has(url.hostname)) return env.ASSETS.fetch(request);
    if (!isStorePath(url.pathname)) return notFound();
    const response = await env.ASSETS.fetch(request);
    if (!(response.headers.get('content-type') || '').includes('text/html')) return response;
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(rewriteStoreHtml(await response.text()), { status: response.status, headers });
  },
};
