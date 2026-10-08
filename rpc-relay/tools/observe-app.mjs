// Records which JSON-RPC methods the store app's REAL scripts call, flow by flow.
//
// It loads web/vendor/solana.js, config.js, wallet.js, entitlement.js and payments.js exactly as the
// WebView does (through test/payments/harness.mjs), points config.rpcUrl at a logging proxy on
// 127.0.0.1 that forwards to the cluster, and runs each parent flow. Two independent recorders:
//   - the proxy (server side): every request body it receives, and any WebSocket upgrade attempt;
//   - a fetch wrapper and a WebSocket constructor wrapper (client side), which also see the test
//     wallet's own traffic (a real wallet sends through its own RPC, never through ours).
// The wallet here is an emulator of the Android bridge that signs with a local devnet key and sends
// straight to devnet, the way Seed Vault does.
//
//   node rpc-relay/tools/observe-app.mjs --wallet /abs/path/key.json                 devnet flows, via the proxy
//   node rpc-relay/tools/observe-app.mjs --wallet key.json --rpc http://127.0.0.1:8787 --flows boot,stake,recheck,exit-instant
//                                                                                    straight at a relay (no proxy)
//   node rpc-relay/tools/observe-app.mjs --mainnet                                   read-only mainnet: token list + Jupiter dry runs
//   --out file.json   write the recording          --ws-control   also prove the WebSocket detector fires
// Devnet flows spend real devnet SOL: about 0.11 for a full run (0.1 of it is the devnet "pay once").
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import * as H from '../../test/payments/harness.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback = null) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const MAINNET = !!opt('mainnet');
const CLUSTER_RPC = MAINNET ? H.MAINNET_RPC : H.DEVNET_RPC;
const DIRECT = opt('rpc');
const OUT = opt('out');

// ---------------------------------------------------------------- recorders
let label = 'load';
const record = { server: {}, client: {}, wallet: {}, statuses: {}, wsUpgrades: 0, wsConstructed: [], batches: 0, durations: {} };
const bump = (bucket, method) => { const b = (record[bucket][label] ||= {}); b[method] = (b[method] || 0) + 1; };
function methodsOf(text, countBatch) {
  try {
    const body = JSON.parse(text);
    if (Array.isArray(body)) { if (countBatch) record.batches++; return body.map((x) => String(x && x.method)); }
    return [String(body && body.method)];
  } catch (e) { return ['<unparsed>']; }
}

const RealWebSocket = globalThis.WebSocket;
globalThis.WebSocket = class extends RealWebSocket {
  constructor(url, ...rest) { record.wsConstructed.push(label + ' ' + String(url)); super(url, ...rest); }
};

const realFetch = globalThis.fetch;
let appRpc = null; // set once the proxy is listening
let inFlight = 0, lastActivity = 0;
globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : input.url;
  const isApp = appRpc && url.replace(/\/$/, '') === appRpc.replace(/\/$/, '');
  const isRpcPost = init && init.method === 'POST' && typeof init.body === 'string' && /"jsonrpc"/.test(init.body);
  if (!isApp) {
    if (isRpcPost) for (const m of methodsOf(init.body)) bump('wallet', m);
    return realFetch(input, init);
  }
  const at = label; // count at request time, under the flow that asked
  for (const m of methodsOf(init.body, true)) bump('client', m);
  inFlight++;
  try {
    const res = await realFetch(input, init);
    if (res.status !== 200) { const s = (record.statuses[at] ||= {}); s[res.status] = (s[res.status] || 0) + 1; }
    return res;
  } finally { inFlight--; lastActivity = Date.now(); }
};

function startProxy(upstream) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks).toString('utf8');
      if (req.method === 'POST') for (const m of methodsOf(body)) bump('server', m);
      try {
        const headers = { 'content-type': req.headers['content-type'] || 'application/json' };
        if (req.headers['solana-client']) headers['solana-client'] = req.headers['solana-client'];
        const up = await realFetch(upstream, { method: req.method, headers, body: req.method === 'POST' ? body : undefined });
        const text = await up.text();
        res.writeHead(up.status, { 'content-type': up.headers.get('content-type') || 'application/json' });
        res.end(text);
      } catch (e) {
        res.writeHead(502, { 'content-type': 'text/plain' });
        res.end('proxy: upstream unreachable');
      }
    });
  });
  server.on('upgrade', (req, socket) => { record.wsUpgrades++; socket.destroy(); });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

// ---------------------------------------------------------------- the wallet emulator (Contract 1)
function makeWallet(kp, walletRpc) {
  let saved = kp ? kp.publicKey.toBase58() : '';
  const reply = (id, obj) => setTimeout(() => globalThis.window.__walletResult(id, JSON.stringify(obj)), 5);
  const w = {
    mode: 'send', // 'send' | 'cancel' (the parent says no) | 'quiet' (sends, then never answers: maybeSubmitted)
    readOnlyKey: null,
    available: () => 'true',
    savedPublicKey: () => w.readOnlyKey || saved,
    connect(id) { reply(id, { ok: true, publicKey: w.readOnlyKey || saved, walletLabel: 'Observer wallet' }); },
    signAndSend(id, chain, txsJson) {
      (async () => {
        if (w.mode === 'cancel' || !kp) { reply(id, { ok: false, error: 'User rejected the request', cancelled: true }); return; }
        const L = globalThis.SolanaLib;
        const conn = new L.web3.Connection(walletRpc, 'confirmed');
        const sigs = [];
        for (const b64 of JSON.parse(txsJson)) {
          const tx = L.web3.VersionedTransaction.deserialize(L.Buffer.from(b64, 'base64'));
          tx.sign([kp]);
          sigs.push(await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed', maxRetries: 5 }));
        }
        if (w.mode === 'quiet') { w.mode = 'send'; reply(id, { ok: false, maybeSubmitted: true, timeout: true }); return; }
        reply(id, { ok: true, signatures: sigs });
      })().catch((e) => reply(id, { ok: false, error: e.message }));
    },
    disconnect() {},
  };
  return w;
}

// ---------------------------------------------------------------- run
H.installBrowserGlobals();
const L = H.loadBundle();
const { web3 } = L;
const walletFile = opt('wallet');
const kp = walletFile ? web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletFile, 'utf8')))) : null;
if (!MAINNET && !kp) { console.error('devnet flows need --wallet <keypair.json>'); process.exit(2); }

const proxy = DIRECT ? null : await startProxy(CLUSTER_RPC);
appRpc = DIRECT || `http://127.0.0.1:${proxy.address().port}`;
const wallet = makeWallet(kp, CLUSTER_RPC);

// Mainnet runs are read-only: a public funded address stands in for the parent (nothing can be signed:
// there is no key), and its own USDC account stands in for the merchant, as test/payments/jupiter.test.mjs does.
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const FUNDED = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
let config = { rpcUrl: appRpc };
if (MAINNET) {
  wallet.readOnlyKey = FUNDED;
  const ata = L.splToken.getAssociatedTokenAddressSync(new web3.PublicKey(USDC), new web3.PublicKey(FUNDED), true).toBase58();
  config = { rpcUrl: appRpc, cluster: 'mainnet-beta', chain: 'solana:mainnet', merchant: { wallet: FUNDED, usdcMint: USDC, usdcAta: ata } };
}
const { cfg, Wallet, Ent, Pay } = H.loadApp({ bridge: wallet, config });
const direct = new web3.Connection(CLUSTER_RPC, 'confirmed'); // the observer's own reads (recorded under "wallet")
const results = {};
// A flow has ended when the app has made no request for 1.5 s (un-awaited refreshes and polls included).
const settle = async () => { do { await H.sleep(250); } while (inFlight > 0 || Date.now() - lastActivity < 1500); };

async function flow(name, fn) {
  label = name;
  const t0 = Date.now();
  let outcome;
  try { outcome = await fn(); } catch (e) { outcome = { error: e.message, code: e.code || null, reason: e.reason || null }; }
  await settle();
  record.durations[name] = Date.now() - t0;
  results[name] = outcome;
  const calls = Object.values(record.client[name] || {}).reduce((a, b) => a + b, 0);
  console.log(`${name.padEnd(22)} ${String(calls).padStart(3)} calls  ${String(record.durations[name]).padStart(6)} ms  ${JSON.stringify(outcome, (k, v) => (typeof v === 'bigint' ? String(v) : v)).slice(0, 260)}`);
  label = 'between';
  return outcome;
}
async function untilFinalized(signature) {
  for (let i = 0; i < 80; i++) {
    const st = (await direct.getSignatureStatuses([signature]).catch(() => ({ value: [null] }))).value[0];
    if (st && st.confirmationStatus === 'finalized') return true;
    await H.sleep(1500);
  }
  return false;
}

const FLOWS = {
  // The saved key is restored at load with no network; app.js then calls startWatching() (web/paywall.js:551).
  async boot() { const stop = Ent.startWatching(); const s = await Ent.refresh(); stop(); return { unlocked: s.unlocked, via: s.via, offline: s.offline, lastError: s.lastError }; },
  async recheck() { const s = await Ent.refresh(); return { unlocked: s.unlocked, via: s.via, tokens: s.tokens, offline: s.offline, lastError: s.lastError }; },
  async connect() { return await Wallet.connect(); },
  async tokens() { return (await Pay.payableTokens()).map((t) => `${t.symbol}:${t.enough}`).join(' '); },
  async stake() { return await Pay.stake(); },
  async 'exit-slow-cancelled'() { wallet.mode = 'cancel'; try { return await Pay.exitSlow(); } finally { wallet.mode = 'send'; } },
  async 'pending-exits'() { return await Pay.pendingSlowExits(); },
  async claim() { return await Pay.claimSlow(); },
  async 'exit-instant'() { return await Pay.exitInstant(); },
  async 'exit-instant-quiet'() { wallet.mode = 'quiet'; try { return await Pay.exitInstant(); } finally { wallet.mode = 'send'; } },
  async 'buy-usdc-short'() { return await Pay.buy(cfg.merchant.usdcMint); },
  async 'buy-sol'() {
    const r = await Pay.buy('SOL');
    if (r && r.signature && !r.alreadyOwned) { await untilFinalized(r.signature); await H.sleep(4000); } // let waitFinalized's own polling end inside this label
    return r;
  },
  async restore() { localStorage.removeItem(Ent.STORE_KEY); const s = await Ent.refresh(); return { unlocked: s.unlocked, via: s.via, purchase: s.purchase, lastError: s.lastError }; },
  // ---- mainnet, read-only ----
  async 'mainnet-tokens'() { const list = await Pay.payableTokens(); return list.length + ' tokens: ' + list.slice(0, 6).map((t) => `${t.symbol}:${t.enough}`).join(' '); },
  async 'mainnet-buy-sol-dry'() { const r = await Pay.buy('SOL', { dryRun: true }); return { route: r.route, size: r.size, simErr: r.simulation && r.simulation.err, units: r.simulation && r.simulation.unitsConsumed }; },
  async 'mainnet-buy-fallback-dry'() { const r = await Pay.buy('SOL', { dryRun: true, forceRoute: 'exactIn+transfer' }); return { route: r.route, size: r.size, simErr: r.simulation && r.simulation.err }; },
  async 'mainnet-buy-usdc-dry'() { const r = await Pay.buy(USDC, { dryRun: true }); return { route: r.route, size: r.size, simErr: r.simulation && r.simulation.err }; },
  async 'mainnet-recheck'() { const s = await Ent.refresh(); return { unlocked: s.unlocked, via: s.via, lastError: s.lastError }; },
};
const DEFAULT = MAINNET
  ? ['connect', 'mainnet-recheck', 'mainnet-tokens', 'mainnet-buy-sol-dry', 'mainnet-buy-fallback-dry', 'mainnet-buy-usdc-dry']
  : ['connect', 'boot', 'recheck', 'tokens', 'stake', 'recheck', 'exit-slow-cancelled', 'pending-exits', 'claim', 'exit-instant-quiet', 'buy-usdc-short', 'buy-sol', 'restore', 'recheck'];
const chosen = typeof opt('flows') === 'string' ? opt('flows').split(',') : DEFAULT;

console.log(`app rpcUrl ${appRpc}${DIRECT ? ' (direct)' : ' -> proxy -> ' + CLUSTER_RPC}; wallet ${Wallet.publicKey}`);
const seen = {};
for (const name of chosen) {
  if (!FLOWS[name]) { console.error('unknown flow ' + name); process.exit(2); }
  seen[name] = (seen[name] || 0) + 1;
  const run = seen[name] > 1 ? `${name}#${seen[name]}` : name;
  FLOWS[run] = FLOWS[name];
  await flow(run, FLOWS[name]);
  if (MAINNET) await H.sleep(2200); // keyless Jupiter allows 0.5 requests/s
}

if (opt('ws-control')) { // the detector must fire when a subscription IS made
  label = 'ws-control';
  const before = record.wsConstructed.length;
  const c = new web3.Connection(appRpc, 'confirmed');
  const id = c.onSlotChange(() => {});
  await H.sleep(1500);
  try { await c.removeSlotChangeListener(id); } catch (e) { /* the socket never opened */ }
  console.log(`ws-control: a real subscription constructed ${record.wsConstructed.length - before} WebSocket(s)`);
  record.wsControl = record.wsConstructed.splice(before);
}

const all = new Set();
for (const bucket of ['server', 'client']) for (const f of Object.values(record[bucket])) for (const m of Object.keys(f)) all.add(m);
const summary = {
  when: new Date().toISOString(), cluster: MAINNET ? 'mainnet-beta' : 'devnet', via: DIRECT ? 'direct' : 'logging proxy',
  methods: Array.from(all).sort(), flows: record.client, serverSide: record.server, walletOwnRpc: record.wallet,
  non200: record.statuses, durationsMs: record.durations, batches: record.batches,
  webSocketsConstructedByApp: record.wsConstructed, webSocketUpgradesSeenByProxy: record.wsUpgrades, wsControl: record.wsControl || null,
};
console.log('\nmethods the app called: ' + summary.methods.join(', '));
console.log('batch requests: ' + record.batches + '; WebSockets constructed: ' + record.wsConstructed.length + '; upgrades at the proxy: ' + record.wsUpgrades);
console.log('non-200 answers: ' + JSON.stringify(record.statuses));
if (!DIRECT && JSON.stringify(record.server) !== JSON.stringify(record.client)) console.log('NOTE: the proxy and the fetch wrapper disagree\n' + JSON.stringify({ server: record.server, client: record.client }));
if (typeof OUT === 'string') writeFileSync(OUT, JSON.stringify(Object.assign(summary, { results }), (k, v) => (typeof v === 'bigint' ? String(v) : v), 2) + '\n');
if (proxy) proxy.close();
setTimeout(() => process.exit(0), 200);
