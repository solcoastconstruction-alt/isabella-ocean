// Browser smoke test: headless Chrome (remote debugging port 9453, its own --user-data-dir) loads
// test/payments/smoke.html from file:// like the Android WebView loads file:///android_asset, with no
// console errors; then a devnet stake round-trip through the ?devwallet=1 dev wallet:
// connect -> stake -> unlocked -> exitInstant -> locked. The dev wallet is funded from
// tools/keys/test-payer.json and its leftover SOL is sent back at the end.
//   SMOKE_USER_DATA_DIR=/path/in/scratchpad node --test ../test/payments/smoke.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as H from './harness.mjs';

const PORT = 9453;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const USER_DATA = process.env.SMOKE_USER_DATA_DIR || resolve(tmpdir(), 'isabella-payments-chrome-9453');

H.installBrowserGlobals();
const L = H.loadBundle();
const { web3 } = L;
const conn = new web3.Connection(H.DEVNET_RPC, 'confirmed');
const payer = H.keypair('test-payer');

// ---- a minimal Chrome DevTools Protocol client over Node's global WebSocket ----
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: ok, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else ok(msg.result);
      } else if (msg.method) for (const h of this.handlers) h(msg);
    });
  }
  static open(url) {
    return new Promise((ok, fail) => { const ws = new WebSocket(url); ws.addEventListener('open', () => ok(new CDP(ws))); ws.addEventListener('error', fail); });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((ok, reject) => this.pending.set(id, { resolve: ok, reject }));
  }
  on(fn) { this.handlers.push(fn); }
  close() { try { this.ws.close(); } catch (e) { /* closing anyway */ } }
}

let chrome, cdp, session, problems = [], logs = [];
async function evaluate(expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text);
  }
  return r.result.value;
}
// Run an async snippet in the page; errors come back as { error, code } instead of rejecting.
const inPage = (body) => evaluate(`(async () => { try { return await (async () => { ${body} })(); } catch (e) { return { error: e.message, code: e.code || null, reason: e.reason || null }; } })()`);

before(async () => {
  mkdirSync(USER_DATA, { recursive: true });
  chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DATA}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' });
  let version = null;
  for (let i = 0; i < 60 && !version; i++) {
    try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch (e) { await H.sleep(250); }
  }
  assert.ok(version, 'Chrome answered on port ' + PORT);
  cdp = await CDP.open(version.webSocketDebuggerUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }));
  cdp.on((m) => {
    if (m.sessionId !== session) return;
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + (m.params.exceptionDetails.exception ? m.params.exceptionDetails.exception.description : m.params.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map((a) => (a.value !== undefined ? a.value : a.description)).join(' ');
      logs.push(m.params.type + ': ' + text);
      if (m.params.type === 'error' || m.params.type === 'assert') problems.push('console.' + m.params.type + ': ' + text);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') problems.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  });
  await cdp.send('Runtime.enable', {}, session);
  await cdp.send('Log.enable', {}, session);
  await cdp.send('Page.enable', {}, session);
});

after(async () => {
  if (cdp) { try { await cdp.send('Browser.close'); } catch (e) { /* already gone */ } cdp.close(); }
  if (chrome) chrome.kill();
});

let pool = null;
test('smoke.html loads the payments scripts from file:// with no console errors', async (t) => {
  pool = await H.findTestPool(conn);
  const q = new URLSearchParams({ devwallet: '1' });
  if (pool) {
    q.set('pool', pool.pool.toBase58()); q.set('mint', pool.s.poolMint.toBase58()); q.set('programId', pool.program);
    q.set('threshold', String(Math.floor((0.99 / pool.rate) * 1e6) / 1e6)); q.set('deposit', '1.01');
  }
  const url = pathToFileURL(resolve(H.ROOT, 'test/payments/smoke.html')).href + '?' + q.toString();
  const loaded = new Promise((ok) => cdp.on((m) => { if (m.sessionId === session && m.method === 'Page.loadEventFired') ok(); }));
  await cdp.send('Page.navigate', { url }, session);
  await loaded;
  assert.equal(await evaluate('window.smokeReady === true'), true);
  assert.deepEqual(await evaluate('Object.keys(window.SolanaLib).sort()'), ['Buffer', 'bs58', 'sha256', 'splStakePool', 'splToken', 'web3']);
  assert.equal(await evaluate('Wallet.isDevMock'), true);
  assert.equal(await evaluate('location.protocol'), 'file:');
  const pk = await inPage('return await Wallet.connect();');
  assert.match(String(pk), /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  const tokens = await inPage('return await IsabellaPay.payableTokens();');
  assert.equal(tokens[0].symbol, 'SOL', JSON.stringify(tokens));
  const st = await inPage('return await IsabellaEntitlement.refresh();');
  assert.equal(st.wallet, pk);
  assert.deepEqual(problems, [], 'no console errors or exceptions');
  t.diagnostic(`Chrome ${(await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).Browser}, dev wallet ${pk}, pool ${pool ? pool.pool.toBase58() : 'none'}`);
});

test('devwallet devnet round-trip in the browser: stake -> unlocked -> exitInstant -> locked', async (t) => {
  if (!pool) { t.skip('no suitable devnet stake pool found'); return; }
  const pk = new web3.PublicKey(await inPage('return Wallet.publicKey;'));
  const want = 1.03e9;
  let bal = await conn.getBalance(pk, 'confirmed');
  if (bal < want) {
    const payerBal = await conn.getBalance(payer.publicKey, 'confirmed');
    if (payerBal < want - bal + 0.01e9) { t.skip(`dev wallet ${pk.toBase58()} needs ${(want - bal) / 1e9} SOL and the test payer ${payer.publicKey.toBase58()} has ${payerBal / 1e9}: devnet faucet refused; fund either and re-run`); return; }
    const sig = await web3.sendAndConfirmTransaction(conn, new web3.Transaction().add(web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: pk, lamports: want - bal })), [payer], { commitment: 'confirmed' });
    t.diagnostic('funded dev wallet: ' + H.explorer(sig));
    bal = await conn.getBalance(pk, 'confirmed');
  }
  const staked = await inPage('return await IsabellaPay.stake();');
  assert.ok(!staked.error, JSON.stringify(staked));
  if (staked.signature) t.diagnostic('browser stake: ' + H.explorer(staked.signature));
  const s1 = await inPage('return await IsabellaEntitlement.refresh();');
  assert.equal(s1.unlocked, true, JSON.stringify(s1));
  assert.equal(s1.via, 'stake');
  const exit = await inPage('const r = await IsabellaPay.exitInstant(); return Object.assign(r, { statusNow: IsabellaEntitlement.status() });');
  assert.ok(!exit.error, JSON.stringify(exit));
  t.diagnostic('browser instant exit: ' + H.explorer(exit.signature) + ' solOut ' + exit.solOut);
  assert.equal(exit.statusNow.unlocked, false, 'locked the moment the tokens left');
  const s2 = await inPage('return await IsabellaEntitlement.refresh({ ignoreHold: true });');
  assert.equal(s2.unlocked, false);
  // send the dev wallet's SOL back to the test payer
  const back = await inPage(`
    const { web3 } = SolanaLib; const c = Wallet.connection(); const me = new web3.PublicKey(Wallet.publicKey);
    const bal = await c.getBalance(me, 'confirmed'); const keep = 5000;
    if (bal <= keep) return null;
    const { blockhash, lastValidBlockHeight } = await c.getLatestBlockhash('confirmed');
    const tx = new web3.Transaction({ feePayer: me, blockhash, lastValidBlockHeight }).add(web3.SystemProgram.transfer({ fromPubkey: me, toPubkey: new web3.PublicKey('${payer.publicKey.toBase58()}'), lamports: bal - keep }));
    const [sig] = await Wallet.signAndSend([tx]);
    return sig;`);
  if (back && !back.error) t.diagnostic('returned dev wallet SOL: ' + H.explorer(back));
  assert.deepEqual(problems, [], 'no console errors or exceptions during the round-trip');
});
