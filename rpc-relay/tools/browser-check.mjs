// A real browser against a running relay: headless Chrome loads test/payments/smoke.html from file://
// (the same kind of origin as the WebView's file:///android_asset/…), the page's config.rpcUrl is
// pointed at the relay IN THE PAGE ONLY, and the app's own scripts make their calls. This is the check
// Node cannot do: CORS. A file:// page sends "Origin: null" and a preflight for every JSON POST.
//
//   node rpc-relay/tools/browser-check.mjs [http://127.0.0.1:8787]      (needs `wrangler dev` running)
// Uses DevTools port 9462 and its own throwaway Chrome profile.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RELAY = process.argv[2] || 'http://127.0.0.1:8787';
const PORT = 9462;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const profile = mkdtempSync(join(tmpdir(), 'isabella-relay-chrome-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
let failed = 0;
const check = (ok, what) => { console.log((ok ? 'ok   - ' : 'FAIL - ') + what); if (!ok) failed++; };
try {
  let version = null;
  for (let i = 0; i < 60 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch (e) { await sleep(250); } }
  if (!version) throw new Error('Chrome did not answer on port ' + PORT);
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.addEventListener('open', ok); ws.addEventListener('error', no); });
  let id = 0; const pending = new Map(); const events = [];
  ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } else if (m.method) events.push(m); });
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => { const n = ++id; pending.set(n, (m) => (m.error ? no(new Error(m.error.message)) : ok(m.result))); ws.send(JSON.stringify({ id: n, method, params, sessionId })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  for (const d of ['Runtime', 'Page', 'Network', 'Log']) await send(d + '.enable', {}, sessionId);
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Page.navigate', { url: pathToFileURL(resolve(root, 'test/payments/smoke.html')).href + '?devwallet=1' }, sessionId);
  for (let i = 0; i < 40 && !(await evaluate('window.smokeReady === true').catch(() => false)); i++) await sleep(250);

  check(await evaluate('location.protocol') === 'file:', 'the page is served from file://');
  check(await evaluate('self.origin') === 'null', 'its origin is "null" (so Origin cannot identify the app)');
  await evaluate(`IsabellaConfig.rpcUrl = ${JSON.stringify(RELAY)}; true`); // before the first Wallet.connection()
  await evaluate('Wallet.connect()');
  const st = await evaluate('IsabellaEntitlement.refresh().then((s) => ({ offline: s.offline, lastError: s.lastError, wallet: s.wallet }))');
  check(st.offline === false && st.lastError === null, 'entitlement check through the relay from the page: ' + JSON.stringify(st));
  const tokens = await evaluate('IsabellaPay.payableTokens().then((l) => l.map((t) => t.symbol + ":" + t.balance)).catch((e) => "ERR " + e.message)');
  check(Array.isArray(tokens) && tokens[0] === 'SOL:0', 'payable-token list through the relay: ' + JSON.stringify(tokens));
  const refused = await evaluate(`fetch(${JSON.stringify(RELAY)}, { method: 'POST', headers: { 'content-type': 'application/json', 'solana-client': 'js/test' }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'sendTransaction', params: ['AA=='] }) }).then(async (r) => r.status + ' ' + (await r.text()))`);
  check(/^403 .*Method not allowed/.test(refused), 'a refused method is readable by the page (CORS headers on errors too): ' + refused);

  const reqs = events.filter((e) => e.method === 'Network.requestWillBeSent' && e.params.request.url.startsWith(RELAY));
  const preflights = reqs.filter((e) => e.params.request.method === 'OPTIONS').length;
  const posts = reqs.filter((e) => e.params.request.method === 'POST');
  const origins = new Set(events.filter((e) => e.method === 'Network.requestWillBeSentExtraInfo').map((e) => e.params.headers.Origin || e.params.headers.origin).filter(Boolean));
  const sockets = events.filter((e) => e.method === 'Network.webSocketCreated').map((e) => e.params.url);
  const consoleErrors = events.filter((e) => (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') || e.method === 'Runtime.exceptionThrown').map((e) => (e.params.entry ? e.params.entry.text : 'exception'));
  check(posts.length >= 4, `${posts.length} JSON-RPC POSTs reached the relay from the page`);
  check(preflights > 0 && origins.has('null') && origins.size === 1, `${preflights} CORS preflights seen by DevTools; Origin header(s) sent: ${JSON.stringify(Array.from(origins))}`);
  check(sockets.length === 0, 'the page opened no WebSocket: ' + JSON.stringify(sockets));
  check(consoleErrors.filter((t) => !/403/.test(t)).length === 0, 'no console errors (CORS failures show up here): ' + JSON.stringify(consoleErrors));
  await send('Browser.close').catch(() => {});
} catch (e) {
  console.log('FAIL - ' + e.message); failed++;
} finally {
  chrome.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* Chrome still letting go */ }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
