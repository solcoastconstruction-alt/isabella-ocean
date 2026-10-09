// The site worker: the product domain (isabellaocean.app) must serve the product as it ships, with no
// devnet wording, no sideload APK and real 404s, while the pages.dev address stays untouched for the
// hackathon judges. Run: node --test test/site/worker.test.mjs (also part of `cd tools && npm test`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../site');
const source = readFileSync(path.join(site, '_worker.js'), 'utf8');
const worker = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const { STORE_REMOVALS, isStorePath, rewriteStoreHtml } = worker;
const page = (name) => readFileSync(path.join(site, name), 'utf8');
const DEVNET_WORDS = /devnet|test network|in testing|\.apk|sideload/i;

test('every removal matches its page in site/ exactly once', () => {
  assert.ok(STORE_REMOVALS.length >= 3, 'the removal list is not empty');
  for (const { page: name, re } of STORE_REMOVALS) {
    const hits = page(name).match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) || [];
    assert.equal(hits.length, 1, `${name}: ${re} matched ${hits.length} times, expected 1`);
  }
});

test('the product home page keeps the product and loses every devnet passage', () => {
  const html = rewriteStoreHtml(page('index.html'));
  assert.doesNotMatch(html, DEVNET_WORDS);
  assert.doesNotMatch(html, /id="devnet-apk"|class="note"/);
  for (const kept of ['US$4.99', 'href="privacy.html"', 'href="terms.html"', "Made for parents' peace of mind", '</html>']) {
    assert.ok(html.includes(kept), `home page lost: ${kept}`);
  }
});

test('the product terms lose the testing section and keep the rest', () => {
  const html = rewriteStoreHtml(page('terms.html'));
  assert.doesNotMatch(html, DEVNET_WORDS);
  assert.doesNotMatch(html, /Testing period/);
  for (const kept of ['Unlock option 2: pay once', 'No warranty', 'Contact', 'support@isabellaocean.app']) {
    assert.ok(html.includes(kept), `terms lost: ${kept}`);
  }
});

test('the privacy page has no devnet passage and passes through unchanged', () => {
  const html = page('privacy.html');
  assert.doesNotMatch(html, DEVNET_WORDS);
  assert.equal(rewriteStoreHtml(html), html);
});

test('the product domain serves only the site paths', () => {
  for (const ok of ['/', '/index.html', '/privacy', '/terms', '/terms.html', '/icon.png', '/style.css', '/ocean-pass.json', '/.well-known/assetlinks.json', '/img/any.png']) {
    assert.ok(isStorePath(ok), `${ok} should be served`);
  }
  for (const no of ['/isabella-ocean.apk', '/definitely-not-here', '/wp-admin', '/index.htm', '/.well-known/other', '/img', '/anything.apk']) {
    assert.ok(!isStorePath(no), `${no} should be 404`);
  }
});

// Injected defect: a page that gains devnet wording outside the known hooks must fail the sweep.
test('new devnet wording outside the known passages is caught', () => {
  const html = rewriteStoreHtml(page('index.html').replace('</main>', '<p>Still on devnet.</p></main>'));
  assert.match(html, DEVNET_WORDS);
});

const fakeAssets = {
  fetch: async (request) => {
    const { pathname } = new URL(request.url);
    if (pathname === '/isabella-ocean.apk') return new Response('APKBYTES', { headers: { 'content-type': 'application/vnd.android.package-archive' } });
    if (pathname === '/terms') return new Response(page('terms.html'), { headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '999' } });
    if (pathname === '/.well-known/assetlinks.json') return new Response(page('.well-known/assetlinks.json'), { headers: { 'content-type': 'application/json' } });
    // Pages answers every unknown path with the home page (no 404.html), so the fake does too.
    return new Response(page('index.html'), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  },
};
const get = (url) => worker.default.fetch(new Request(url), { ASSETS: fakeAssets });

test('fetch: the product domain rewrites pages, 404s the APK and unknown paths, passes assets through', async () => {
  const home = await get('https://isabellaocean.app/');
  assert.equal(home.status, 200);
  assert.doesNotMatch(await home.text(), DEVNET_WORDS);
  assert.equal(home.headers.get('content-length'), null);
  const terms = await get('https://isabellaocean.app/terms');
  assert.doesNotMatch(await terms.text(), /Testing period/);
  assert.equal((await get('https://isabellaocean.app/isabella-ocean.apk')).status, 404);
  assert.equal((await get('https://isabellaocean.app/definitely-not-here')).status, 404);
  assert.equal((await get('https://www.isabellaocean.app/anything.apk')).status, 404);
  const links = await get('https://isabellaocean.app/.well-known/assetlinks.json');
  assert.equal(links.status, 200);
  assert.ok((await links.text()).includes('app.isabella.mermaid.seeker'));
});

test('fetch: the hackathon address is untouched, APK and devnet wording included', async () => {
  const home = await get('https://isabellaocean-app.pages.dev/');
  assert.equal(await home.text(), page('index.html'));
  const apk = await get('https://isabellaocean-app.pages.dev/isabella-ocean.apk');
  assert.equal(apk.status, 200);
  assert.equal(await apk.text(), 'APKBYTES');
  const junk = await get('https://isabellaocean-app.pages.dev/definitely-not-here');
  assert.equal(junk.status, 200);
});

// ---- The App Store build's pages (site/apple/): they stand alone ----
const APPLE_PAGES = ['apple/privacy.html', 'apple/terms.html', 'apple/support.html'];
const CHAIN_WORDS = /solana|seeker|wallet|\bSOL\b|usdc|stak(e|ed|ing)\b|crypto|blockchain|token|jupiter|dapp|android|google/i;

test('the product domain serves the App Store pages', () => {
  for (const ok of ['/apple/privacy', '/apple/privacy.html', '/apple/terms', '/apple/terms.html', '/apple/support', '/apple/support.html']) {
    assert.ok(isStorePath(ok), `${ok} should be served`);
  }
  for (const no of ['/apple', '/apple/', '/apple/index.html', '/apple/other']) assert.ok(!isStorePath(no), `${no} should be 404`);
});

test('the App Store pages say nothing about wallets or the chain, and pass through unchanged', () => {
  for (const name of APPLE_PAGES) {
    const html = page(name);
    assert.doesNotMatch(html, CHAIN_WORDS, name);
    assert.doesNotMatch(html, DEVNET_WORDS, name);
    assert.equal(rewriteStoreHtml(html), html, `${name} was rewritten`);
  }
  // The words are really looked for: the Seeker pages are full of them.
  assert.match(page('terms.html'), CHAIN_WORDS);
});

test('nothing on an App Store page leads to the rest of the site', () => {
  const local = new Set(['privacy.html', 'terms.html', 'support.html', '../icon.png', '../style.css']);
  const outside = ['https://www.apple.com/', 'https://reportaproblem.apple.com/', 'mailto:support@isabellaocean.app'];
  let links = 0;
  for (const name of APPLE_PAGES) {
    for (const [, href] of page(name).matchAll(/(?:href|src)="([^"]*)"/g)) {
      links += 1;
      assert.ok(local.has(href) || outside.some((prefix) => href.startsWith(prefix)), `${name} links to ${href}`);
    }
  }
  assert.ok(links >= 15, `only ${links} links were found: the sweep is not seeing the pages`);
});

test('the iOS app opens only those pages', () => {
  const root = path.resolve(site, '..');
  const paywall = readFileSync(path.join(root, 'web-iap/paywall.js'), 'utf8');
  assert.match(paywall, /const SITE = 'https:\/\/isabellaocean\.app\/apple\/';/);
  for (const [, tail] of paywall.matchAll(/\$\{SITE\}([a-z]+)/g)) assert.ok(APPLE_PAGES.includes(`apple/${tail}.html`), `the app links to ${tail}, which is not a page`);
  const native = readFileSync(path.join(root, 'ios/IsabellaOcean/GameViewController.swift'), 'utf8');
  assert.match(native, /static let sitePath = "\/apple\/"/);
});
