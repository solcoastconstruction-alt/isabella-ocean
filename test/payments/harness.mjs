// Loads the real browser scripts (web/vendor/solana.js, config.js, wallet.js, entitlement.js, payments.js)
// into this Node process with a minimal window/document/localStorage, so the tests exercise the
// exact code the WebView runs. Also: a Contract 1 bridge emulator (window.IsabellaWallet) that signs
// with a local devnet keypair, and helpers for keys, funding and explorer links.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(here, '../..');
export const WEB = process.env.PAYMENTS_WEB_DIR || resolve(ROOT, 'web'); // mutation runs point this at a mutated copy
export const KEYS = resolve(ROOT, 'tools/keys');
export const DEVNET_RPC = process.env.DEVNET_RPC || 'https://api.devnet.solana.com';
export const MAINNET_RPC = process.env.MAINNET_RPC || 'https://api.mainnet-beta.solana.com';
export const explorer = (sig, cluster = 'devnet') => `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
export const explorerAddr = (a, cluster = 'devnet') => `https://explorer.solana.com/address/${a}?cluster=${cluster}`;

function run(file) {
  vm.runInThisContext(readFileSync(file, 'utf8'), { filename: file });
}

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}

/** A fresh browser-ish global environment. Call once per test file (node --test isolates files). */
export function installBrowserGlobals({ search = '', store = null } = {}) {
  const g = globalThis;
  const define = (name, value) => Object.defineProperty(g, name, { value, configurable: true, writable: true });
  define('window', g);
  define('self', g);
  define('location', { search, href: 'file:///android_asset/index.html' + search });
  const ls = new Map();
  define('localStorage', {
    getItem: (k) => (ls.has(k) ? ls.get(k) : null),
    setItem: (k, v) => { ls.set(k, String(v)); },
    removeItem: (k) => { ls.delete(k); },
    clear: () => ls.clear(),
    _map: ls,
  });
  const winListeners = new Map();
  define('addEventListener', (t, f) => { if (!winListeners.has(t)) winListeners.set(t, new Set()); winListeners.get(t).add(f); });
  define('removeEventListener', (t, f) => { if (winListeners.has(t)) winListeners.get(t).delete(f); });
  const docListeners = new Map();
  define('document', {
    visibilityState: 'visible',
    addEventListener(t, f) { if (!docListeners.has(t)) docListeners.set(t, new Set()); docListeners.get(t).add(f); },
    removeEventListener(t, f) { if (docListeners.has(t)) docListeners.get(t).delete(f); },
    _fire(t) { for (const f of docListeners.get(t) || []) f({ type: t }); },
    _count(t) { return (docListeners.get(t) || new Set()).size; },
  });
  if (store) define('IsabellaStore', store);
  return g;
}

/** Load the bundle only (window.SolanaLib). */
export function loadBundle() {
  run(resolve(WEB, 'vendor/solana.js'));
  return globalThis.SolanaLib;
}

/** Load config.js (+ overrides), then wallet.js, entitlement.js, payments.js, in index.html order. */
export function loadApp({ config = {}, bridge = null } = {}) {
  if (bridge) Object.defineProperty(globalThis, 'IsabellaWallet', { value: bridge, configurable: true, writable: true });
  run(resolve(WEB, 'config.js'));
  deepMerge(globalThis.IsabellaConfig, config);
  run(resolve(WEB, 'wallet.js'));
  run(resolve(WEB, 'entitlement.js'));
  run(resolve(WEB, 'payments.js'));
  return { cfg: globalThis.IsabellaConfig, Wallet: globalThis.Wallet, Ent: globalThis.IsabellaEntitlement, Pay: globalThis.IsabellaPay };
}

/** Read or create a devnet keypair under tools/keys (gitignored). */
export function keypair(name) {
  const L = globalThis.SolanaLib;
  mkdirSync(KEYS, { recursive: true });
  const file = resolve(KEYS, name + '.json');
  if (existsSync(file)) return L.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, 'utf8'))));
  const kp = L.web3.Keypair.generate();
  writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

/**
 * Contract 1 emulator: window.IsabellaWallet backed by a local keypair. Results arrive later through
 * window.__walletResult(id, json) like the Java bridge's evaluateJavascript. `jsonAsObject` passes the
 * result as an object literal instead of a JSON string (the bridge may do either).
 */
export function makeBridge({ keypair: initial, rpcUrl = DEVNET_RPC, label = 'Node test wallet', jsonAsObject = false, onSign = null, signer = true } = {}) {
  let saved = '';
  let kp = initial;
  const calls = [];
  const reply = (id, obj) => setTimeout(() => globalThis.window.__walletResult(id, jsonAsObject ? obj : JSON.stringify(obj)), 5);
  const bridgeObj = {
    calls,
    quietAfterNextSend: false,
    available() { calls.push(['available']); return 'true'; },
    connect(id, chain) {
      calls.push(['connect', id, chain]);
      saved = kp.publicKey.toBase58();
      reply(id, { ok: true, publicKey: saved, walletLabel: label });
    },
    signAndSend(id, chain, txsJson) {
      calls.push(['signAndSend', id, chain]);
      (async () => {
        const L = globalThis.SolanaLib;
        const b64s = JSON.parse(txsJson);
        const txs = b64s.map((b) => L.web3.VersionedTransaction.deserialize(L.Buffer.from(b, 'base64')));
        for (const tx of txs) {
          if (!tx.message.staticAccountKeys[0].equals(kp.publicKey)) throw new Error('fee payer is not the connected wallet');
          if (tx.signatures.some((s) => s.some((b) => b !== 0))) throw new Error('received a pre-signed transaction; Contract 1 sends unsigned ones');
        }
        if (onSign) onSign(txs);
        if (!signer) { reply(id, { ok: false, error: 'User rejected the request', cancelled: true }); return; }
        const conn = new L.web3.Connection(rpcUrl, 'confirmed');
        const sigs = [];
        for (const tx of txs) {
          tx.sign([kp]);
          sigs.push(await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed', maxRetries: 5 }));
        }
        if (bridgeObj.quietAfterNextSend) { // like a wallet that sent but never answered: Contract 1's maybeSubmitted
          bridgeObj.quietAfterNextSend = false;
          reply(id, { ok: false, maybeSubmitted: true, timeout: true });
          return;
        }
        reply(id, { ok: true, signatures: sigs });
      })().catch((e) => reply(id, { ok: false, error: e.message }));
    },
    disconnect(chain) { calls.push(['disconnect', chain]); saved = ''; },
    savedPublicKey(chain) { return saved; },
    /** Test helper: the "wallet app" now holds a different account (call Wallet.disconnect/connect after). */
    useKeypair(next) { kp = next; },
  };
  return bridgeObj;
}

/**
 * Resolves the balance in lamports. With AIRDROP=1 it first makes ONE faucet request if short: the public
 * devnet faucet limits each IP per day, so tests never loop on it (fund the payer by hand instead).
 */
export async function fund(conn, pubkey, wantLamports) {
  let bal = await conn.getBalance(pubkey, 'confirmed');
  if (bal < wantLamports && process.env.AIRDROP === '1') {
    try {
      const sig = await conn.requestAirdrop(pubkey, Math.min(2e9, wantLamports - bal + 1e8));
      await conn.confirmTransaction(sig, 'confirmed');
    } catch (e) { /* rate-limited: report the balance as it is */ }
    bal = await conn.getBalance(pubkey, 'confirmed');
  }
  return bal;
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Find an existing third-party devnet stake pool to test against (ours is not visible from this branch):
 * getProgramAccounts on both devnet stake-pool programs, then keep pools that are updated this epoch,
 * open to anyone (no SOL deposit/withdraw authority), classic SPL token, fees <= 1%, a reserve that can
 * pay instant exits, and a validator with enough active stake to serve a >= 1 SOL slow exit. Small pools
 * (< 50 SOL) are skipped so we never disturb a pool someone is still setting up. POOL=<address> overrides.
 */
export async function findTestPool(conn, { prefer = process.env.POOL_PROGRAM || '' } = {}) {
  const L = globalThis.SolanaLib;
  const { web3, splStakePool, bs58 } = L;
  const { epoch } = await conn.getEpochInfo();
  const programs = ['DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib', 'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy'];
  const fee = (f) => (Number(f.denominator.toString()) ? Number(f.numerator.toString()) / Number(f.denominator.toString()) : 0);
  const candidates = [];
  for (const program of programs) {
    const accs = process.env.POOL
      ? [{ pubkey: new web3.PublicKey(process.env.POOL), account: await conn.getAccountInfo(new web3.PublicKey(process.env.POOL)) }].filter((a) => a.account && a.account.owner.toBase58() === program)
      : await conn.getProgramAccounts(new web3.PublicKey(program), { filters: [{ memcmp: { offset: 0, bytes: bs58.encode(L.Buffer.from([1])) } }] });
    for (const a of accs) {
      let s;
      try { s = splStakePool.StakePoolLayout.decode(a.account.data); } catch (e) { continue; }
      const total = Number(s.totalLamports.toString());
      if (s.solDepositAuthority || s.solWithdrawAuthority) continue;
      if (Number(s.lastUpdateEpoch.toString()) !== epoch) continue;
      if (s.tokenProgramId.toBase58() !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') continue;
      if (fee(s.solDepositFee) > 0.01 || fee(s.solWithdrawalFee) > 0.01 || fee(s.stakeWithdrawalFee) > 0.01) continue;
      if (!process.env.POOL && total < 50e9) continue;
      candidates.push({ program, pool: a.pubkey, s, total });
    }
  }
  const infos = await conn.getMultipleAccountsInfo(candidates.flatMap((c) => [c.s.reserveStake, c.s.validatorList]));
  const usable = [];
  candidates.forEach((c, i) => {
    const reserve = infos[2 * i], list = infos[2 * i + 1];
    if (!reserve || !list) return;
    const n = list.data.readUInt32LE(5);
    let maxActive = 0;
    for (let j = 0; j < n; j++) { const o = 9 + j * 73; if (list.data[o + 40] === 0) maxActive = Math.max(maxActive, Number(list.data.readBigUInt64LE(o))); }
    if (reserve.lamports < 5e9 || maxActive < 5e9) return;
    usable.push(Object.assign(c, { reserveLamports: reserve.lamports, maxActive, rate: c.total / Number(c.s.poolTokenSupply.toString()) }));
  });
  usable.sort((a, b) => ((b.program === prefer) - (a.program === prefer)) || (b.program.startsWith('DPoo') - a.program.startsWith('DPoo')) || (b.reserveLamports - a.reserveLamports));
  return usable[0] || null;
}
