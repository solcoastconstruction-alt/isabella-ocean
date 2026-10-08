// The store release build's mainnet config (android/app/src/storeRelease/assets/config.js) against
// the devnet web/config.js and pool/mainnet.json. Offline: it reads three files and derives one address.
//   cd tools && node --test ../test/payments/mainnet-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from './harness.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// MAINNET_CONFIG_FILE points a mutation run at a broken copy.
const MAINNET_FILE = process.env.MAINNET_CONFIG_FILE || resolve(ROOT, 'android/app/src/storeRelease/assets/config.js');

function load(file) {
  const win = {};
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: win });
  return win.IsabellaConfig;
}
const dev = load(resolve(H.WEB, 'config.js'));
const main = load(MAINNET_FILE);
const pool = JSON.parse(fs.readFileSync(resolve(ROOT, 'pool/mainnet.json'), 'utf8'));

/** Every leaf as "a.b.c" → value. */
function leaves(o, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') leaves(v, prefix + k + '.', out);
    else out.set(prefix + k, v);
  }
  return out;
}

// The only leaves allowed to differ between the two networks. Anything else (price, thresholds,
// free levels, timings) must be equal, so a change to web/config.js cannot silently miss the store build.
const NETWORK_KEYS = ['cluster', 'chain', 'rpcUrl', 'stake.programId', 'stake.pool', 'stake.mint', 'merchant.wallet', 'merchant.usdcMint', 'merchant.usdcAta'];

test('both configs loaded and have the same keys', () => {
  const d = leaves(dev), m = leaves(main);
  assert.ok(d.size >= 20, 'the sweep found the devnet leaves (' + d.size + ')');
  assert.deepEqual([...m.keys()].sort(), [...d.keys()].sort());
});

test('only the network keys differ, and every one of them does', () => {
  const d = leaves(dev), m = leaves(main);
  for (const k of NETWORK_KEYS) assert.ok(d.has(k), 'unknown network key ' + k);
  for (const [k, v] of d) {
    if (NETWORK_KEYS.includes(k)) assert.notEqual(m.get(k), v, k + ' still holds the devnet value');
    else assert.deepEqual(m.get(k), v, k + ' differs from web/config.js');
  }
});

test('mainnet network and relay', () => {
  assert.equal(main.cluster, 'mainnet-beta');
  assert.equal(main.chain, 'solana:mainnet');
  assert.equal(main.rpcUrl, 'https://rpc.isabellaocean.app');
  assert.equal(main.merchant.usdcMint, 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
});

test('pool addresses are pool/mainnet.json', () => {
  assert.equal(pool.cluster, 'mainnet');
  assert.equal(main.stake.programId, pool.programId);
  assert.equal(main.stake.pool, pool.pool);
  assert.equal(main.stake.mint, pool.mint);
  assert.equal(main.merchant.wallet, pool.feeOwner, 'one wallet receives the fees and the purchases');
  assert.equal(main.stake.depositSol, Number(pool.crank.depositSol));
});

test('the USDC account is the merchant wallet\'s own associated account', () => {
  const { web3, splToken } = H.loadBundle();
  const ata = splToken.getAssociatedTokenAddressSync(new web3.PublicKey(main.merchant.usdcMint), new web3.PublicKey(main.merchant.wallet));
  assert.equal(main.merchant.usdcAta, ata.toBase58());
});

test('sign-release.sh can read the cluster from this file', () => {
  const m = fs.readFileSync(MAINNET_FILE, 'utf8').match(/^ *cluster: '([^']*)'/m);
  assert.equal(m && m[1], 'mainnet-beta');
});
