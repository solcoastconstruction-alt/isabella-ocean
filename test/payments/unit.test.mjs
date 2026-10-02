// Offline unit tests (no network): bundle surface, reference key, pool math, decoders, the wallet
// bridge wrapper and dev-mock gating, and the entitlement rules with a mocked clock and failing RPC.
//   cd tools && node --test ../test/payments/unit.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as H from './harness.mjs';

H.installBrowserGlobals();
const L = H.loadBundle();
const { web3 } = L;
const parent = web3.Keypair.fromSeed(new Uint8Array(32).fill(7));
const PARENT = parent.publicKey.toBase58();
const MINT = web3.Keypair.fromSeed(new Uint8Array(32).fill(9)).publicKey.toBase58();
const MERCHANT = web3.Keypair.fromSeed(new Uint8Array(32).fill(11)).publicKey.toBase58();

// A scriptable fake RPC for the entitlement rules.
const fake = {
  fail: false, tokens: 0n, decimals: 9, signatures: [], txs: new Map(), calls: 0,
  async getParsedTokenAccountsByOwner() {
    this.calls++;
    if (this.fail) throw new Error('fetch failed (offline)');
    return { value: this.tokens > 0n ? [{ account: { data: { parsed: { info: { tokenAmount: { amount: String(this.tokens), decimals: this.decimals } } } } } }] : [] };
  },
  async getSignaturesForAddress() { this.calls++; if (this.fail) throw new Error('fetch failed (offline)'); return this.signatures; },
  async getTransaction(sig) { this.calls++; if (this.fail) throw new Error('fetch failed (offline)'); return this.txs.get(sig) || null; },
};

const bridge = H.makeBridge({ keypair: parent, jsonAsObject: false });
const { cfg, Wallet, Ent, Pay } = H.loadApp({
  bridge,
  config: { stake: { pool: '', mint: MINT, unlockThreshold: 0.99 }, merchant: { wallet: MERCHANT, usdcMint: '', usdcAta: '' } },
});
Wallet.connection = () => fake;
let now = Date.UTC(2026, 9, 2, 0, 0, 0);
Ent._env.now = () => now;
const HOUR = 3600 * 1000;

test('bundle exposes web3, splStakePool, splToken (+ Buffer, bs58, sha256)', () => {
  for (const k of ['web3', 'splStakePool', 'splToken', 'Buffer', 'bs58', 'sha256']) assert.ok(L[k], k);
  assert.equal(typeof L.web3.Connection, 'function');
  assert.equal(typeof L.splStakePool.StakePoolLayout.decode, 'function');
  assert.equal(typeof L.splToken.createTransferCheckedInstruction, 'function');
});

test('reference key = sha256("isabella-purchase-v1" + wallet) as a public key', () => {
  const expected = new web3.PublicKey(createHash('sha256').update('isabella-purchase-v1' + PARENT).digest()).toBase58();
  assert.equal(Ent.referenceFor(PARENT), expected);
  assert.notEqual(Ent.referenceFor(PARENT), Ent.referenceFor(MERCHANT));
});

test('pool math matches the program (deposit rounds down, fees round up)', () => {
  const fee = (n, d) => ({ numerator: { toString: () => String(n) }, denominator: { toString: () => String(d) } });
  const p = { total: 1044599218n * 1000n, supply: 1000000000n * 1000n, s: { solDepositFee: fee(8, 10000) } };
  const lamports = 1010000000n;
  const minted = (lamports * p.supply) / p.total;
  const depositFee = (minted * 8n + 10000n - 1n) / 10000n;
  assert.equal(Pay._internals.tokensForDeposit(p, lamports), minted - depositFee);
  const tokens = 966000000n;
  const wfee = (tokens * 3n + 1000n - 1n) / 1000n;
  assert.equal(Pay._internals.lamportsForWithdraw(p, tokens, fee(3, 1000), false), ((tokens - wfee) * p.total) / p.supply);
  assert.equal(Pay._internals.lamportsForWithdraw(p, tokens, fee(3, 1000), true), (tokens * p.total) / p.supply);
  // an empty pool mints 1:1
  assert.equal(Pay._internals.tokensForDeposit({ total: 0n, supply: 0n, s: { solDepositFee: fee(0, 0) } }, 5n), 5n);
});

test('validator list decoder reads seeds, status and vote account', () => {
  const vote = web3.Keypair.generate().publicKey;
  const d = L.Buffer.alloc(9 + 73);
  d[0] = 2; d.writeUInt32LE(4, 1); d.writeUInt32LE(1, 5);
  d.writeBigUInt64LE(5000000000n, 9); d.writeBigUInt64LE(7n, 17); d.writeBigUInt64LE(1172n, 25);
  d.writeBigUInt64LE(3n, 33); d.writeUInt32LE(0, 41); d.writeUInt32LE(2, 45); d[49] = 0; vote.toBuffer().copy(d, 50);
  const [v] = Pay._internals.decodeValidatorList(d);
  assert.equal(v.active, 5000000000n); assert.equal(v.transient, 7n); assert.equal(v.lastUpdateEpoch, 1172n);
  assert.equal(v.transientSeed, 3n); assert.equal(v.validatorSeed, 2); assert.equal(v.status, 0); assert.ok(v.vote.equals(vote));
});

test('stake account parser and cooldown follow the stake program', () => {
  const d = L.Buffer.alloc(200);
  d.writeUInt32LE(2, 0);
  parent.publicKey.toBuffer().copy(d, 12); parent.publicKey.toBuffer().copy(d, 44);
  web3.Keypair.generate().publicKey.toBuffer().copy(d, 124);
  d.writeBigUInt64LE(1000000000n, 156); d.writeBigUInt64LE(500n, 164); d.writeBigUInt64LE(1172n, 172);
  const s = Pay._internals.parseStakeAccount(d);
  assert.equal(s.state, 2); assert.ok(s.meta.withdrawer.equals(parent.publicKey)); assert.equal(s.delegation.deactivationEpoch, 1172n);
  const fx = Pay._internals.effectiveAfterDeactivation;
  const history = new Map([[1172n, { effective: 400000000000000000n, deactivating: 2000000000000000n }]]);
  assert.equal(fx(1000000000n, 1172n, 1172n, history), 1000000000n, 'still effective during the deactivation epoch');
  assert.equal(fx(1000000000n, 1172n, 1173n, history), 0n, 'fully cooled down one epoch later when cluster cooldown is light');
  const busy = new Map([[1172n, { effective: 1000000000n * 100n, deactivating: 1000000000n * 50n }], [1173n, { effective: 1000000000n * 100n, deactivating: 1000000000n * 50n }]]);
  assert.ok(fx(1000000000n, 1172n, 1173n, busy) > 0n, 'rate-limited when much of the cluster deactivates at once');
});

test('simulation errors become parent-readable codes', () => {
  const ex = Pay._internals.explainFailure;
  assert.equal(ex('InsufficientFundsForFee', [], [])[0], 'INSUFFICIENT_SOL');
  assert.equal(ex({ InstructionError: [1, { Custom: 17 }] }, [], ['x', 'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy'])[0], 'POOL_STALE');
  assert.equal(ex({ InstructionError: [0, { Custom: 35 }] }, [], ['DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib'])[0], 'RESERVE_LOW');
  assert.equal(ex({ InstructionError: [0, { Custom: 1 }] }, [], ['11111111111111111111111111111111'])[0], 'INSUFFICIENT_SOL');
  assert.equal(ex({ InstructionError: [2, { Custom: 6001 }] }, [], [])[0], 'SLIPPAGE');
});

// A separate wallet.js instance in its own window object (for gating and bridge-behaviour checks).
const walletCode = (await import('node:fs')).readFileSync(H.WEB + '/wallet.js', 'utf8');
const vm = await import('node:vm');
function walletIn({ search = '', cluster = 'devnet', withBridge = false, bridgeObj = null }) {
  const win = { IsabellaConfig: { cluster, chain: 'solana:' + cluster, rpcUrl: H.DEVNET_RPC }, SolanaLib: L, location: { search },
    localStorage: globalThis.localStorage, console };
  if (bridgeObj) win.IsabellaWallet = bridgeObj;
  else if (withBridge) win.IsabellaWallet = H.makeBridge({ keypair: parent });
  win.window = win;
  vm.runInNewContext(walletCode, Object.assign(win, { setTimeout, clearTimeout, Uint8Array, JSON, String, Array, Map, Set, Promise, Error, Object }));
  return win;
}

test('Wallet wraps Contract 1: numeric ids, JSON-string or object results, cancellations', async () => {
  assert.equal(Wallet.available(), true);
  assert.equal(Wallet.isDevMock, false, 'never the mock when a bridge exists');
  const pk = await Wallet.connect();
  assert.equal(pk, PARENT);
  assert.equal(Wallet.publicKey, PARENT);
  const connectCall = bridge.calls.find((c) => c[0] === 'connect');
  assert.equal(typeof connectCall[1], 'number');
  assert.equal(connectCall[2], 'solana:devnet');
  window.__walletResult('999001', { ok: true }); // unknown ids are ignored without throwing

  // A bridge that answers with an object literal (not a JSON string) and a string id, then cancels.
  const calls = [];
  const objBridge = {
    available: () => true, savedPublicKey: () => null, disconnect: () => {},
    connect(id, chain) { calls.push(['connect', id, chain]); setTimeout(() => win.__walletResult(String(id), { ok: true, publicKey: PARENT, walletLabel: 'Obj' }), 1); },
    signAndSend(id, chain, txsJson) {
      calls.push(['signAndSend', id, chain, JSON.parse(txsJson)]);
      setTimeout(() => win.__walletResult(id, JSON.stringify({ ok: false, error: 'User rejected', cancelled: true })), 1);
    },
  };
  const win = walletIn({ bridgeObj: objBridge });
  assert.equal(win.Wallet.publicKey, null, 'savedPublicKey null means not connected');
  assert.equal(await win.Wallet.connect(), PARENT);
  const tx = new web3.Transaction({ feePayer: parent.publicKey, blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 })
    .add(web3.SystemProgram.transfer({ fromPubkey: parent.publicKey, toPubkey: parent.publicKey, lamports: 0 }));
  await assert.rejects(win.Wallet.signAndSend([tx]), (e) => e.code === 'cancelled' && e.cancelled === true && e.reason === 'CANCELLED');
  const sent = calls.find((c) => c[0] === 'signAndSend')[3];
  assert.equal(sent.length, 1);
  const decoded = web3.VersionedTransaction.deserialize(L.Buffer.from(sent[0], 'base64'));
  assert.ok(decoded.message.staticAccountKeys[0].equals(parent.publicKey), 'fee payer = connected wallet');
  assert.ok(decoded.signatures.every((s) => s.every((b) => b === 0)), 'sent unsigned (base64), as Contract 1 says');

  // no wallet installed: available() is the string "false"
  const none = walletIn({ bridgeObj: Object.assign({}, objBridge, { available: () => 'false' }) });
  assert.equal(none.Wallet.available(), false);
  await assert.rejects(none.Wallet.connect(), (e) => e.code === 'no-wallet' && e.reason === 'NO_WALLET');
});

test('Wallet maps the bridge\'s result fields onto the paywall error codes', async () => {
  const OTHER = web3.Keypair.generate().publicKey.toBase58();
  let reply = null;
  const b = {
    available: () => 'true', savedPublicKey: () => PARENT, disconnect: () => {},
    connect(id) { setTimeout(() => w.__walletResult(id, JSON.stringify(reply)), 1); },
    signAndSend(id) { setTimeout(() => w.__walletResult(id, JSON.stringify(reply)), 1); },
  };
  const w = walletIn({ bridgeObj: b });
  assert.equal(w.Wallet.publicKey, PARENT, 'restored from savedPublicKey(chain) on load');
  const tx = new web3.Transaction({ feePayer: parent.publicKey, blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 })
    .add(web3.SystemProgram.transfer({ fromPubkey: parent.publicKey, toPubkey: parent.publicKey, lamports: 0 }));
  const cases = [
    [{ ok: false, noWallet: true }, 'no-wallet', 'NO_WALLET'],
    [{ ok: false, cancelled: true, error: 'declined' }, 'cancelled', 'CANCELLED'],
    [{ ok: false, timeout: true }, 'failed', 'WALLET_TIMEOUT'],
    [{ ok: false, unsupportedChain: true }, 'failed', 'UNSUPPORTED_CHAIN'],
    [{ ok: false, maybeSubmitted: true, timeout: true }, 'failed', 'MAYBE_SUBMITTED'],
    [{ ok: false, error: 'Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.' }, 'funds', 'INSUFFICIENT_SOL'],
    [{ ok: false, error: 'insufficient lamports 5000, need 1010000000' }, 'funds', 'INSUFFICIENT_SOL'],
    [{ ok: false, error: 'Network request failed' }, 'offline', 'OFFLINE'],
    [{ ok: false, error: 'wallet error -1: unable to resolve host api.devnet.solana.com' }, 'offline', 'OFFLINE'],
    [{ ok: false, error: 'the wallet signed but the network did not accept the transaction', signatures: ['x'] }, 'failed', 'NOT_SUBMITTED'],
    [{ ok: false, error: 'busy: another wallet request is still open' }, 'failed', 'WALLET_BUSY'],
    [{ ok: false, error: 'Something odd' }, 'failed', 'WALLET_ERROR'],
  ];
  for (const [r, code, reason] of cases) {
    reply = r;
    await assert.rejects(w.Wallet.signAndSend([tx]), (e) => e.code === code && e.reason === reason && typeof e.message === 'string' && e.message.length > 0, JSON.stringify(r));
  }
  reply = { ok: false, maybeSubmitted: true };
  await assert.rejects(w.Wallet.signAndSend([tx]), (e) => e.maybeSubmitted === true);
  reply = { ok: true, signatures: ['sigA'], publicKey: OTHER };
  assert.deepEqual(await w.Wallet.signAndSend([tx]), ['sigA']);
  assert.equal(w.Wallet.publicKey, OTHER, 'a changed account from the bridge updates Wallet.publicKey');
});

test('dev mock is gated: no bridge AND devnet AND ?devwallet=1', async () => {
  const walletOnly = (o) => walletIn(o).Wallet;
  assert.equal(walletOnly({ search: '', cluster: 'devnet' }).isDevMock, false);
  assert.equal(walletOnly({ search: '?devwallet=1', cluster: 'mainnet-beta' }).isDevMock, false);
  assert.equal(walletOnly({ search: '?devwallet=1', cluster: 'devnet', withBridge: true }).isDevMock, false);
  assert.equal(walletOnly({ search: '?devwallet=10', cluster: 'devnet' }).isDevMock, false);
  assert.equal(walletOnly({ search: '', cluster: 'devnet' }).available(), false, 'no bridge, no mock: no wallet');
  const mock = walletOnly({ search: '?x=2&devwallet=1', cluster: 'devnet' });
  assert.equal(mock.isDevMock, true);
  assert.equal(mock.available(), true);
  const pk = await mock.connect();
  assert.ok(globalThis.localStorage.getItem('isabella.devwallet'), 'keypair kept in localStorage');
  const again = walletOnly({ search: '?devwallet=1', cluster: 'devnet' });
  assert.equal(again.publicKey, pk, 'same key after a reload');
  globalThis.localStorage.removeItem('isabella.devwallet');
  globalThis.localStorage.removeItem('isabella.devwallet.connected');
});

test('entitlement: stake unlock, 24 h offline grace with a failing RPC, then lock', async () => {
  localStorage.removeItem(Ent.STORE_KEY);
  const seen = [];
  const off = Ent.onChange((s) => seen.push(s.unlocked + ':' + s.via));
  fake.fail = false; fake.tokens = 990000000n; // exactly 0.99 tokens
  let s = await Ent.refresh();
  assert.equal(s.unlocked, true); assert.equal(s.via, 'stake'); assert.equal(s.wallet, PARENT);
  assert.equal(s.offlineUntil, now + 24 * HOUR); assert.equal(s.offline, false);
  const checkedAt = s.checkedAt;
  // offline for 23 h: the failed check keeps the last result
  fake.fail = true; now += 23 * HOUR;
  s = await Ent.refresh();
  assert.equal(s.unlocked, true); assert.equal(s.checkedAt, checkedAt); assert.match(s.lastError, /offline/);
  assert.equal(s.offline, true, 'status().offline: the last check failed');
  assert.equal(s.offlineUntil, checkedAt + 24 * HOUR, 'offlineUntil = checkedAt + offlineGraceHours');
  // 25 h after the last good check: locked until a successful check
  now += 2 * HOUR;
  s = await Ent.refresh();
  assert.equal(s.unlocked, false); assert.equal(s.via, null); assert.equal(s.offline, true);
  assert.equal(Ent.status().unlocked, false, 'status() agrees without any network');
  // back online with tokens: unlocked again, new window
  fake.fail = false;
  s = await Ent.refresh();
  assert.equal(s.unlocked, true); assert.equal(s.offlineUntil, now + 24 * HOUR); assert.equal(s.offline, false);
  // one lamport-unit under the threshold locks
  fake.tokens = 989999999n;
  s = await Ent.refresh();
  assert.equal(s.unlocked, false);
  off();
  assert.deepEqual(seen, ['true:stake', 'false:null', 'true:stake', 'false:null']);
});

test('entitlement: revokeLocal locks at once and holds off a racing refresh', async () => {
  fake.fail = false; fake.tokens = 2000000000n;
  assert.equal((await Ent.refresh()).unlocked, true);
  const s = Ent.revokeLocal();
  assert.equal(s.unlocked, false);
  assert.equal((await Ent.refresh()).unlocked, false, 'tokens still visible during the hold do not re-unlock');
  assert.equal((await Ent.refresh({ ignoreHold: true })).unlocked, true, 'an exit that failed can restore it');
  now += 4 * 60 * 1000;
  assert.equal((await Ent.refresh()).unlocked, true, 'the hold ends after a few minutes');
});

test('entitlement: a purchase found through the reference survives a cleared cache', async () => {
  fake.tokens = 0n;
  const reference = Ent.referenceFor(PARENT);
  const keys = [PARENT, MERCHANT, reference, '11111111111111111111111111111111'].map((k) => new web3.PublicKey(k));
  const tx = {
    blockTime: 1, meta: { err: null, preBalances: [5e9, 1e9, 0, 1], postBalances: [4.9e9, 1.1e9, 0, 1], preTokenBalances: [], postTokenBalances: [], loadedAddresses: { writable: [], readonly: [] } },
    transaction: { message: { getAccountKeys: () => ({ length: keys.length, get: (i) => keys[i] }) } },
  };
  fake.signatures = [{ signature: 'sigPurchase', err: null }];
  fake.txs.set('sigPurchase', tx);
  localStorage.removeItem(Ent.STORE_KEY); // "reinstall"
  assert.equal(Ent.status().unlocked, false);
  const s = await Ent.refresh();
  assert.equal(s.unlocked, true); assert.equal(s.via, 'purchase'); assert.equal(s.purchase, 'sigPurchase');
  // a purchase is permanent: it stays unlocked through a long offline stretch (decided at integration;
  // only the stake unlock needs re-checking within offlineGraceHours)
  const savedNow = now;
  fake.fail = true; now += 72 * HOUR;
  const offline = await Ent.refresh();
  assert.equal(offline.unlocked, true, 'still unlocked 72 h offline'); assert.equal(offline.via, 'purchase'); assert.equal(offline.offline, true);
  fake.fail = false; now = savedNow;
  // a purchase is kept through revokeLocal (exits only concern the stake)
  assert.equal(Ent.revokeLocal().unlocked, true);
  assert.equal(Ent.revokeLocal({ all: true }).unlocked, false);
  // too small a payment is not a purchase
  tx.meta.postBalances = [4.95e9, 1.05e9, 0, 1];
  fake.txs.set('sigPurchase', tx);
  localStorage.removeItem(Ent.STORE_KEY);
  assert.equal((await Ent.refresh()).unlocked, false);
  fake.signatures = [];
});

test('entitlement: a different wallet does not inherit the cache; family is always unlocked', async () => {
  fake.tokens = 2000000000n;
  await Ent.refresh();
  const other = web3.Keypair.generate().publicKey.toBase58();
  const cache = JSON.parse(localStorage.getItem(Ent.STORE_KEY));
  cache.wallet = other; // as if checked for another wallet
  localStorage.setItem(Ent.STORE_KEY, JSON.stringify(cache));
  assert.equal(Ent.status().unlocked, false);
  cfg.flavor = 'family';
  try {
    const callsBefore = fake.calls;
    assert.deepEqual(Ent.status(), { unlocked: true, via: 'family', wallet: null, checkedAt: null, offlineUntil: null, offline: false });
    assert.equal((await Ent.refresh()).via, 'family');
    assert.equal(fake.calls, callsBefore, 'family flavor never touches the network');
  } finally { cfg.flavor = 'store'; }
});

test('entitlement: after Wallet.disconnect() status() and refresh() report locked', async () => {
  fake.fail = false; fake.tokens = 2000000000n;
  localStorage.removeItem(Ent.STORE_KEY);
  assert.equal((await Ent.refresh()).unlocked, true);
  Wallet.disconnect();
  try {
    assert.equal(Wallet.publicKey, null);
    assert.equal(Ent.status().unlocked, false);
    const callsBefore = fake.calls;
    const s = await Ent.refresh();
    assert.equal(s.unlocked, false); assert.equal(s.wallet, null);
    assert.equal(fake.calls, callsBefore, 'nothing to check without a wallet');
    assert.equal(Ent.revokeLocal().unlocked, false, 'revokeLocal is harmless when disconnected');
  } finally {
    assert.equal(await Wallet.connect(), PARENT);
  }
  assert.equal((await Ent.refresh()).unlocked, true, 'reconnecting the same wallet unlocks again');
  assert.deepEqual(Ent.revokeLocal(), Ent.revokeLocal(), 'revokeLocal is idempotent');
});

test('entitlement: refresh() settles within its timeout even if the RPC never answers', async () => {
  const saved = Wallet.connection;
  const savedTimeout = Ent._env.refreshTimeoutMs;
  Ent._env.refreshTimeoutMs = 200;
  const never = new Promise(() => {});
  Wallet.connection = () => ({ getParsedTokenAccountsByOwner: () => never, getSignaturesForAddress: () => never, getTransaction: () => never });
  try {
    const t0 = Date.now();
    const s = await Ent.refresh();
    assert.ok(Date.now() - t0 < 2000, 'settled after ' + (Date.now() - t0) + ' ms');
    assert.equal(s.offline, true);
    assert.match(s.lastError, /did not answer/);
  } finally { Wallet.connection = saved; Ent._env.refreshTimeoutMs = savedTimeout; }
});

test('entitlement: notePurchase() unlocks on a confirmed purchase before it is finalized', async () => {
  fake.fail = false; fake.tokens = 0n; fake.signatures = [];
  localStorage.removeItem(Ent.STORE_KEY);
  const reference = Ent.referenceFor(PARENT);
  const keys = [PARENT, MERCHANT, reference, '11111111111111111111111111111111'].map((k) => new web3.PublicKey(k));
  const tx = {
    blockTime: 1, meta: { err: null, preBalances: [5e9, 1e9, 0, 1], postBalances: [4.9e9, 1.1e9, 0, 1], preTokenBalances: [], postTokenBalances: [], loadedAddresses: { writable: [], readonly: [] } },
    transaction: { message: { getAccountKeys: () => ({ length: keys.length, get: (i) => keys[i] }) } },
  };
  const saved = fake.getTransaction;
  fake.getTransaction = async (sig, opts) => (sig === 'sigJustBought' && opts.commitment === 'confirmed' ? tx : null); // not finalized yet
  try {
    assert.equal((await Ent.refresh()).unlocked, false, 'the scan (finalized) does not see it yet');
    Ent.notePurchase('sigJustBought');
    const s = await Ent.refresh();
    assert.equal(s.unlocked, true); assert.equal(s.via, 'purchase'); assert.equal(s.purchase, 'sigJustBought');
  } finally { fake.getTransaction = saved; }
  localStorage.removeItem(Ent.STORE_KEY);
});

test('family flavor: the modules do nothing on load (no RPC, no timers) and stay unlocked', async () => {
  const fs = await import('node:fs');
  const calls = { fetch: 0, timers: 0 };
  const win = {
    IsabellaFlavor: 'family', SolanaLib: L, location: { search: '' }, console,
    localStorage: { getItem: () => { calls.storage = (calls.storage || 0) + 1; return null; }, setItem() {}, removeItem() {} },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    addEventListener() {}, removeEventListener() {},
    fetch: () => { calls.fetch++; return new Promise(() => {}); },
    setTimeout: () => { calls.timers++; return 0; }, setInterval: () => { calls.timers++; return 0; }, clearTimeout() {}, clearInterval() {},
    TextEncoder, Uint8Array, JSON, String, Array, Map, Set, Promise, Error, Object, Number, Math, BigInt, Date,
  };
  win.window = win;
  for (const f of ['config.js', 'wallet.js', 'entitlement.js', 'payments.js']) vm.runInNewContext(fs.readFileSync(H.WEB + '/' + f, 'utf8'), win);
  assert.equal(win.IsabellaConfig.flavor, 'family');
  assert.equal(win.Wallet.publicKey, null);
  assert.equal(win.IsabellaEntitlement.status().unlocked, true);
  win.IsabellaEntitlement.startWatching()();
  await win.IsabellaEntitlement.refresh();
  assert.deepEqual({ fetch: calls.fetch, timers: calls.timers, storage: calls.storage || 0 }, { fetch: 0, timers: 0, storage: 0 }, 'no RPC, no timers, not even a storage read');
});

test('every error message reads as its own .code under the paywall\'s keyword matching', async () => {
  // paywall.js now reads an exact .code first, but still falls back to these keyword regexes (code + message,
  // in this order) for anything else. Keep every message consistent with its code under that fallback, so a
  // 'funds' error whose text says "network" can never be shown as offline.
  const kindOf = (code, message) => {
    const s = `${code} ${message}`.toLowerCase();
    if (code === 'cancelled' || /cancel|declin|reject|denied|abort/.test(s)) return 'cancelled';
    if (/no-wallet|no_wallet|no wallet|not installed|wallet_not_found/.test(s)) return 'no-wallet';
    if (/offline|network|failed to fetch|timeout|timed out|unreachable/.test(s)) return 'offline';
    if (/funds|insufficient|not enough/.test(s)) return 'funds';
    return 'failed';
  };
  const codeOf = (reason) => ({ CANCELLED: 'cancelled', NO_WALLET: 'no-wallet', INSUFFICIENT_SOL: 'funds', INSUFFICIENT_FUNDS: 'funds', OFFLINE: 'offline', TX_TIMEOUT: 'offline' }[reason] || 'failed');
  const fs = await import('node:fs');
  let checked = 0;
  const wrong = [];
  for (const f of ['payments.js', 'wallet.js']) {
    const src = fs.readFileSync(H.WEB + '/' + f, 'utf8');
    // payError('R', ...), walletError('R', ...) and ['R', ...] pairs; collect the string literals up to the closing bracket
    for (const m of src.matchAll(/(?:payError\(|walletError\(|\[)\s*'([A-Z][A-Z_]+)'\s*,/g)) {
      let i = m.index + m[0].length, depth = 0, text = '';
      for (; i < src.length; i++) {
        const ch = src[i];
        if (ch === "'") { let j = i + 1, lit = ''; while (src[j] !== "'") { if (src[j] === '\\') { lit += src[j + 1]; j += 2; } else lit += src[j++]; } text += lit + ' '; i = j; continue; }
        if (ch === '(' || ch === '[' || ch === '{') depth++;
        if (ch === ')' || ch === ']' || ch === '}') { if (depth === 0) break; depth--; }
        if (ch === ',' && depth === 0) break; // the message argument ends here
      }
      if (!text.trim()) continue;
      checked++;
      const code = codeOf(m[1]);
      if (kindOf(code, text) !== code) wrong.push(`${f} ${m[1]} -> ${kindOf(code, text)}: ${text.trim()}`);
    }
  }
  assert.ok(checked >= 60, 'the sweep found the messages (' + checked + ')');
  assert.deepEqual(wrong, []);
});

test('payableTokens() logos are data: URIs, never remote URLs', async () => {
  Wallet.disconnect();
  try {
    cfg.merchant.usdcMint = MINT;
    const list = await Pay.payableTokens();
    assert.deepEqual(list.map((x) => x.symbol), ['SOL', 'USDC']);
    for (const x of list) assert.match(x.logo, /^data:image\/svg\+xml,/);
    assert.deepEqual(list.map((x) => typeof x.amountNeeded), ['number', 'number']);
  } finally { cfg.merchant.usdcMint = ''; await Wallet.connect(); }
});

test('entitlement: startWatching refreshes on resume and stops cleanly', async () => {
  fake.fail = false; fake.tokens = 2000000000n;
  const stop = Ent.startWatching();
  try {
    assert.equal(document._count('visibilitychange'), 1);
    await H.sleep(20);
    const before = fake.calls;
    document.visibilityState = 'hidden'; document._fire('visibilitychange');
    await H.sleep(20);
    assert.equal(fake.calls, before, 'no check while hidden');
    document.visibilityState = 'visible'; document._fire('visibilitychange');
    await H.sleep(20);
    assert.ok(fake.calls > before, 'checks again on resume');
  } finally {
    stop(); // always clear the timers, or a failed assertion keeps the test process alive
  }
  assert.equal(document._count('visibilitychange'), 0);
});
