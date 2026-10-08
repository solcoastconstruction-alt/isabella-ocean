// The allow-list must equal what the app calls. This test derives the app's side from the app itself:
//   1. sweep every script under web/ (not the vendored library) for calls to @solana/web3.js Connection methods;
//   2. turn each Connection method into its JSON-RPC method by CALLING it on the bundled library
//      (web/vendor/solana.js) with a recording fetch, so the mapping comes from the library, not from memory;
//   3. require: that set == ALLOWED_METHODS, apart from the methods refused on purpose below;
//   4. run the app's real modules against the recording fetch and push every request body they produce
//      through the relay: none may be refused;
//   5. the live recording (observed-methods.json, from tools/observe-app.mjs) holds nothing off the list;
//   6. nothing in the app subscribes (a subscription opens a WebSocket, which the relay does not carry).
// A Connection method the app starts calling that this file does not know FAILS the test, by design.
// Run: node rpc-relay/test/app-methods.test.mjs   (RELAY_SRC / PAYMENTS_WEB_DIR point at mutated copies)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as H from '../../test/payments/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.RELAY_SRC || resolve(here, '../src/index.js');
const { createRelay, ALLOWED_METHODS } = await import(pathToFileURL(SRC).href);
const ALLOWED = new Set(ALLOWED_METHODS);

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

/** JSON-RPC methods the app's code can emit that the relay refuses on purpose, and why. */
const REFUSED_ON_PURPOSE = {
  sendTransaction: 'only the desktop dev wallet sends (web/wallet.js mockSignAndSend: no Android bridge, devnet, ?devwallet=1); on the phone the wallet app sends',
};
/** Library helpers the app calls that only build bytes and never touch the network. Anything else must be looked at. */
const PURE_HELPERS = new Set(['getAssociatedTokenAddressSync', 'createAssociatedTokenAccountIdempotentInstruction', 'createCloseAccountInstruction',
  'createTransferCheckedInstruction', 'StakePoolLayout', 'ASSOCIATED_TOKEN_PROGRAM_ID']);

// A WebSocket detector, installed before the library loads.
const sockets = [];
const RealWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends RealWebSocket { constructor(url, ...rest) { sockets.push(String(url)); super(url, ...rest); } };
const quiet = console.error; // web3.js reports socket errors for the control below through console.error

H.installBrowserGlobals({ search: '?devwallet=1' }); // even with the dev-wallet switch on, a bridge must win
const L = H.loadBundle();
const { web3 } = L;
const pk = web3.Keypair.generate().publicKey;
const sig = L.bs58.encode(new Uint8Array(64).fill(7));

// ---- the recording fetch ----
const recorded = []; // { method, body }
const recorder = async (url, init) => {
  const body = JSON.parse(init.body);
  for (const c of Array.isArray(body) ? body : [body]) recorded.push({ method: c.method, body: init.body, batch: Array.isArray(body) });
  const answer = (c) => ({ jsonrpc: '2.0', id: c.id, error: { code: -32000, message: 'recorded' } });
  return new Response(JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)), { status: 200, headers: { 'content-type': 'application/json' } });
};
const recConn = () => new web3.Connection('http://recorder.invalid', { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: recorder });

// ---- 1. sweep the app's scripts ----
function scripts(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { if (name !== 'vendor') out.push(...scripts(full)); } else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}
const files = scripts(H.WEB);
const proto = web3.Connection.prototype;
const instance = recConn(); // some methods (getBlockHeight) are per-instance functions, not on the prototype
const connectionMethods = new Set(
  Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor' && typeof Object.getOwnPropertyDescriptor(proto, n).value === 'function')
    .concat(Object.getOwnPropertyNames(instance).filter((n) => typeof instance[n] === 'function'))
    .filter((n) => !n.startsWith('_')));
const isSubscription = (n) => /^on[A-Z]/.test(n) || /Listener$/.test(n) || n === 'confirmTransaction';
const calls = new Map(); // Connection method -> Set(file)
const helpers = new Map();
let sendAndConfirm = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8'); // comments included: a commented-out call counts too, which errs on the safe side
  const rel = relative(H.WEB, file);
  for (const m of src.matchAll(/\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    if (connectionMethods.has(m[1])) { if (!calls.has(m[1])) calls.set(m[1], new Set()); calls.get(m[1]).add(rel); }
  }
  for (const m of src.matchAll(/\b(?:splToken|splStakePool)\s*\.\s*([A-Za-z_$][\w$]*)/g)) { if (!helpers.has(m[1])) helpers.set(m[1], new Set()); helpers.get(m[1]).add(rel); }
  if (/sendAndConfirm/.test(src)) sendAndConfirm.push(rel);
}

// ---- 2. Connection method -> JSON-RPC method, by running the library ----
const tx = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: pk, recentBlockhash: pk.toBase58(), instructions: [web3.SystemProgram.transfer({ fromPubkey: pk, toPubkey: pk, lamports: 1 })] }).compileToV0Message());
const SAMPLE_ARGS = {
  getAccountInfo: [pk, 'confirmed'],
  getAddressLookupTable: [pk],
  getBalance: [pk, 'confirmed'],
  getBlockHeight: ['confirmed'],
  getEpochInfo: ['confirmed'],
  getLatestBlockhash: ['confirmed'],
  getMinimumBalanceForRentExemption: [165],
  getMultipleAccountsInfo: [[pk, pk], 'confirmed'],
  getParsedTokenAccountsByOwner: [pk, { mint: pk }, 'confirmed'],
  getProgramAccounts: [web3.StakeProgram.programId, { commitment: 'confirmed', filters: [{ dataSize: web3.StakeProgram.space }, { memcmp: { offset: 44, bytes: pk.toBase58() } }] }],
  getRecentPerformanceSamples: [4],
  getSignatureStatuses: [[sig], { searchTransactionHistory: true }],
  getSignaturesForAddress: [pk, { limit: 100 }, 'finalized'],
  getStakeMinimumDelegation: ['confirmed'],
  getTokenAccountBalance: [pk, 'confirmed'],
  getTransaction: [sig, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }],
  simulateTransaction: [tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }],
  sendRawTransaction: [tx.serialize(), { preflightCommitment: 'confirmed', maxRetries: 5 }],
};
const rpcOf = new Map(); // Connection method -> [rpc methods]
const bodiesFromLibrary = [];
async function mapMethod(name) {
  const before = recorded.length;
  const warn = console.warn; console.warn = () => {}; // the library warns about the recorder's error answers
  try { await recConn()[name](...SAMPLE_ARGS[name]); } catch (e) { /* the recorder answers every call with an error */ } finally { console.warn = warn; }
  const mine = recorded.slice(before);
  rpcOf.set(name, Array.from(new Set(mine.map((r) => r.method))));
  bodiesFromLibrary.push(...mine);
}

await t('the sweep found the app\'s RPC calls', async () => {
  assert.ok(files.length >= 8, `swept ${files.length} scripts under ${H.WEB}`);
  assert.ok(calls.size >= 15, `found ${calls.size} Connection methods in use: ${Array.from(calls.keys()).sort().join(', ')}`);
  for (const f of ['entitlement.js', 'payments.js', 'wallet.js']) assert.ok(Array.from(calls.values()).some((s) => s.has(f)), 'found calls in ' + f);
});
await t('every Connection method the app calls is one this test knows how to run', async () => {
  const unknown = Array.from(calls.keys()).filter((n) => !SAMPLE_ARGS[n]);
  assert.deepEqual(unknown, [], `the app now calls Connection.${unknown.join(', Connection.')}: add sample arguments here, then decide whether the relay should allow it (rpc-relay/src/index.js ALLOWED_METHODS)`);
  for (const name of calls.keys()) await mapMethod(name);
  for (const [name, rpc] of rpcOf) assert.ok(rpc.length >= 1, `Connection.${name} sent a request (${rpc})`);
});
await t('the allow-list is exactly what the app calls', async () => {
  const appCalls = new Map(); // rpc method -> where from
  for (const [name, rpc] of rpcOf) for (const r of rpc) appCalls.set(r, (appCalls.get(r) || []).concat(`${name} in ${Array.from(calls.get(name)).join(', ')}`));
  const offList = Array.from(appCalls.keys()).filter((r) => !ALLOWED.has(r) && !REFUSED_ON_PURPOSE[r]);
  assert.deepEqual(offList, [], offList.map((r) => `the app calls ${r} (${appCalls.get(r).join('; ')}) and the relay would refuse it`).join('\n'));
  const unused = ALLOWED_METHODS.filter((r) => !appCalls.has(r));
  assert.deepEqual(unused, [], `on the allow-list but not called by the app: ${unused.join(', ')}`);
  for (const r of Object.keys(REFUSED_ON_PURPOSE)) assert.ok(!ALLOWED.has(r), r + ' is refused on purpose and must stay off the list');
  console.log('     ' + Array.from(appCalls.keys()).sort().map((r) => `${ALLOWED.has(r) ? '+' : '-'} ${r}  <-  ${appCalls.get(r).join('; ')}`).join('\n     '));
});
await t('the only app-side send is the desktop dev wallet, and a bridge switches it off', async () => {
  assert.deepEqual(Array.from(calls.get('sendRawTransaction') || []), ['wallet.js']);
  assert.ok(!calls.has('sendTransaction') && !calls.has('sendEncodedTransaction') && !calls.has('requestAirdrop'));
  assert.deepEqual(sendAndConfirm, [], 'no sendAndConfirm helpers (they send, and they subscribe)');
});
await t('the app subscribes to nothing (a subscription would open a WebSocket)', async () => {
  const subs = Array.from(calls.keys()).filter(isSubscription);
  assert.deepEqual(subs, [], `the app calls ${subs.join(', ')}: that opens a WebSocket, which the relay does not carry`);
  assert.ok(Array.from(connectionMethods).filter(isSubscription).length >= 8, 'the subscription pattern matches the library\'s own methods');
});
await t('library helpers the app uses are the known byte-builders', async () => {
  assert.ok(helpers.size >= 4, `found ${helpers.size} helpers`);
  const unknown = Array.from(helpers.keys()).filter((n) => !PURE_HELPERS.has(n));
  assert.deepEqual(unknown, [], `new spl helper(s) ${unknown.join(', ')}: check whether they call the RPC, then list them here`);
});

// ---- 4. the real modules, then everything through the relay ----
const walletKey = web3.Keypair.generate().publicKey.toBase58();
const bridge = { available: () => 'true', savedPublicKey: () => walletKey, connect(id) { setTimeout(() => window.__walletResult(id, JSON.stringify({ ok: true, publicKey: walletKey })), 1); }, signAndSend(id) { setTimeout(() => window.__walletResult(id, JSON.stringify({ ok: false, cancelled: true, error: 'test' })), 1); }, disconnect() {} };
const app = H.loadApp({ bridge });
const bodiesFromApp = [];
await t('the app\'s real modules: one connection, to config.rpcUrl, no dev wallet when a bridge exists', async () => {
  assert.equal(app.Wallet.isDevMock, false, 'the dev wallet (the only sender) is off whenever the Android bridge exists');
  assert.equal(app.Wallet.connection().rpcEndpoint, app.cfg.rpcUrl);
  assert.equal(app.Wallet.connection(), app.Wallet.connection(), 'one shared connection');
  const c = recConn();
  app.Wallet.connection = () => c; // "Tests may replace this function" (web/wallet.js)
  const before = recorded.length;
  await app.Ent.refresh();
  await app.Pay.pendingSlowExits().catch(() => {});
  await app.Pay.payableTokens().catch(() => {});
  await app.Pay.stake().catch(() => {});
  await app.Pay.buy(app.cfg.merchant.usdcMint).catch(() => {});
  bodiesFromApp.push(...recorded.slice(before));
  const got = new Set(bodiesFromApp.map((b) => b.method));
  for (const m of ['getTokenAccountsByOwner', 'getSignaturesForAddress', 'getProgramAccounts', 'getBalance', 'getAccountInfo']) assert.ok(got.has(m), 'the real modules sent ' + m + ' (got ' + Array.from(got).join(', ') + ')');
  assert.ok(bodiesFromApp.every((b) => !b.batch), 'the app sends no batches');
});
await t('every request body the app and the library produce passes the relay; the send does not', async () => {
  let upstreamCalls = 0;
  const relay = createRelay(async (url, init) => { upstreamCalls++; const c = JSON.parse(init.body); return new Response(JSON.stringify({ jsonrpc: '2.0', id: c.id, result: null }), { status: 200 }); });
  const env = { UPSTREAM_RPC_URL: 'https://upstream.invalid/', RPC_LIMITER: { limit: async () => ({ success: true }) } };
  const all = bodiesFromLibrary.concat(bodiesFromApp);
  assert.ok(all.length >= 20, `checked ${all.length} request bodies`);
  let refused = 0;
  for (const b of all) {
    const res = await relay(new Request('https://rpc.isabellaocean.app/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: b.body }), env);
    if (REFUSED_ON_PURPOSE[b.method]) { assert.equal(res.status, 403, b.method + ' must be refused'); refused++; continue; }
    assert.equal(res.status, 200, `${b.method} was refused by the relay: ${await res.text()}\n${b.body.slice(0, 300)}`);
  }
  assert.equal(refused, 1);
  assert.equal(upstreamCalls, all.length - refused);
  const gpa = bodiesFromApp.find((b) => b.method === 'getProgramAccounts');
  assert.ok(gpa, 'the app\'s own getProgramAccounts request was among them');
});

// ---- 5. the live recording ----
await t('the live recording holds nothing off the list', async () => {
  const rec = JSON.parse(readFileSync(resolve(here, '../observed-methods.json'), 'utf8'));
  assert.ok(rec.methods.length >= 10 && rec.runs.length >= 2, 'the recording is not empty');
  const perRun = rec.runs.flatMap((r) => Object.values(r.flows).flatMap((f) => Object.keys(f)));
  assert.ok(perRun.length >= 50, 'the recording has per-flow counts');
  for (const m of new Set(rec.methods.concat(perRun))) assert.ok(ALLOWED.has(m), `the app was observed calling ${m}, which is not on the allow-list`);
  const codeOnly = ALLOWED_METHODS.filter((m) => !rec.methods.includes(m));
  console.log('     observed live: ' + rec.methods.length + ' of ' + ALLOWED_METHODS.length + (codeOnly.length ? '; on the list from code reading only: ' + codeOnly.join(', ') : ''));
  for (const r of rec.runs) { assert.equal(r.webSocketsConstructed, 0, r.what); assert.equal(r.batches, 0, r.what); }
});

// ---- 6. WebSockets ----
await t('none of the above opened a WebSocket; a real subscription does (the detector works)', async () => {
  assert.deepEqual(sockets, [], 'the app\'s modules constructed a WebSocket');
  console.error = () => {};
  const c = recConn();
  const id = c.onSlotChange(() => {});
  await H.sleep(300);
  assert.ok(sockets.length >= 1, 'a subscription constructs a WebSocket');
  c.removeSlotChangeListener(id).catch(() => {});
  console.error = quiet;
});

console.log(`\n${passed} passed`);
process.exit(0); // web3.js keeps retrying the control's socket
