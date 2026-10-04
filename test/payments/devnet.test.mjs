// Devnet end-to-end through the real browser scripts and a Contract 1 bridge emulator:
//   stake -> unlocked; exitInstant -> SOL back + locked; stake + exitSlow -> deactivating stake account;
//   pendingSlowExits/claimSlow; buy(SOL) -> purchase found via the reference after the cache is cleared;
//   buy(devnet "USDC") with a second buyer.
// Needs ~1.3 devnet SOL in tools/keys/test-payer.json (~1.06 of it stays locked for one epoch in the
// slow-exit stake account, claimable afterwards). The public faucet limits each IP per day, so fund the
// printed address by hand; AIRDROP=1 makes one faucet request first.
//   cd tools && node --test ../test/payments/devnet.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as H from './harness.mjs';

H.installBrowserGlobals();
const L = H.loadBundle();
const { web3, splToken } = L;
const conn = new web3.Connection(H.DEVNET_RPC, 'confirmed');
const payer = H.keypair('test-payer');
const merchant = H.keypair('test-merchant');
const buyer2 = H.keypair('test-buyer-2');
const NEED = Number(process.env.DEVNET_NEED_SOL || 1.3) * 1e9;
const links = [];
const note = (t, label, sig) => { const l = `${label}: ${H.explorer(sig)}`; links.push(l); t.diagnostic(l); };

const bridge = H.makeBridge({ keypair: payer });
let app, pool, funded = false, skipWhy = '';

before(async () => {
  const bal = await H.fund(conn, payer.publicKey, NEED);
  funded = bal >= NEED;
  if (!funded) skipWhy = `test payer ${payer.publicKey.toBase58()} has ${bal / 1e9} SOL, needs ${NEED / 1e9}. Send it devnet SOL and re-run (AIRDROP=1 tries the faucet once).`;
  pool = await H.findTestPool(conn);
  if (!pool) skipWhy = skipWhy || 'no suitable devnet stake pool found';
  const rate = pool ? pool.rate : 1;
  app = H.loadApp({
    bridge,
    config: {
      stake: { pool: pool ? pool.pool.toBase58() : '', mint: pool ? pool.s.poolMint.toBase58() : '', programId: pool ? pool.program : '', depositSol: 1.05, unlockThreshold: Math.floor((0.99 / rate) * 1e6) / 1e6 },
      merchant: { wallet: merchant.publicKey.toBase58(), usdcMint: '', usdcAta: '' },
    },
  });
});

const need = (t) => { if (skipWhy) { t.skip(skipWhy); return false; } return true; };
async function waitFinal(sig) {
  for (let i = 0; i < 60; i++) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st && st.confirmationStatus === 'finalized') return true;
    await H.sleep(1500);
  }
  return false;
}

test('setup: funded test payer and an existing devnet stake pool', async (t) => {
  if (!pool) { t.skip('no suitable devnet stake pool found'); return; }
  t.diagnostic(`pool ${pool.pool.toBase58()} (program ${pool.program}), ${(pool.total / 1e9).toFixed(1)} SOL, ${pool.rate.toFixed(6)} SOL/token, reserve ${(pool.reserveLamports / 1e9).toFixed(1)} SOL; threshold scaled to ${app.cfg.stake.unlockThreshold} tokens`);
  t.diagnostic(`payer ${payer.publicKey.toBase58()} balance ${(await conn.getBalance(payer.publicKey)) / 1e9} SOL`);
  if (!need(t)) return;
  assert.equal(await app.Wallet.connect(), payer.publicKey.toBase58());
});

test('stake(): DepositSol lands and entitlement sees tokens >= threshold', async (t) => {
  if (!need(t)) return;
  const { Pay, Ent } = app;
  const r = await Pay.stake();
  if (r.alreadyStaked) t.diagnostic('wallet already held pool tokens from an earlier run: ' + r.poolTokens);
  else { assert.ok(r.signature); note(t, 'stake (DepositSol)', r.signature); }
  const s = await Ent.refresh();
  assert.equal(s.unlocked, true, JSON.stringify(s));
  assert.equal(s.via, 'stake');
  assert.ok(s.tokens >= app.cfg.stake.unlockThreshold, 'tokens ' + s.tokens);
  t.diagnostic(`unlocked via stake with ${s.tokens} pool tokens`);
});

test('exitInstant(): WithdrawSol returns SOL and locks at once', async (t) => {
  if (!need(t)) return;
  const { Pay, Ent } = app;
  const before = await conn.getBalance(payer.publicKey, 'confirmed');
  const r = await Pay.exitInstant();
  assert.ok(r.signature && r.solOut > 1);
  note(t, 'instant exit (WithdrawSol)', r.signature);
  assert.equal(Ent.status().unlocked, false, 'locked immediately');
  const after = await conn.getBalance(payer.publicKey, 'confirmed');
  t.diagnostic(`solOut ${r.solOut} SOL; wallet +${(after - before) / 1e9} SOL (incl. token-account rent back, minus fee)`);
  assert.ok(after - before > r.solOut * 1e9 - 0.01e9);
  const s = await Ent.refresh({ ignoreHold: true });
  assert.equal(s.unlocked, false);
  assert.equal(s.tokens, 0);
});

test('exitSlow(): WithdrawStake to a parent-owned stake account + Deactivate in one transaction', async (t) => {
  if (!need(t)) return;
  const { Pay, Ent } = app;
  const st = await Pay.stake();
  if (st.signature) note(t, 'stake again', st.signature);
  assert.equal((await Ent.refresh()).unlocked, true);
  const r = await Pay.exitSlow();
  note(t, 'slow exit (WithdrawStake + Deactivate)', r.signature);
  assert.equal(Ent.status().unlocked, false, 'locked immediately');
  const ai = await conn.getAccountInfo(new web3.PublicKey(r.stakeAccount), 'confirmed');
  assert.ok(ai && ai.owner.equals(web3.StakeProgram.programId), 'a stake account');
  const parsed = Pay._internals.parseStakeAccount(ai.data);
  const { epoch } = await conn.getEpochInfo('confirmed');
  assert.ok(parsed.meta.staker.equals(payer.publicKey) && parsed.meta.withdrawer.equals(payer.publicKey), 'authorities = the parent');
  assert.equal(r.deactivating, true);
  assert.equal(parsed.delegation.deactivationEpoch, BigInt(epoch), 'deactivating this epoch');
  assert.ok(parsed.delegation.stake >= 1000000000n, 'at least the 1 SOL minimum delegation');
  t.diagnostic(`stake account ${H.explorerAddr(r.stakeAccount)}: ${Number(parsed.delegation.stake) / 1e9} SOL deactivating in epoch ${epoch}, readyAt ${new Date(r.readyAt).toISOString()}`);
});

test('pendingSlowExits() lists it as not ready; claimSlow() withdraws ready (inactive) accounts', async (t) => {
  if (!need(t)) return;
  const { Pay } = app;
  const list = await Pay.pendingSlowExits();
  const pending = list.filter((x) => !x.ready);
  assert.ok(pending.length >= 1, JSON.stringify(list));
  assert.ok(pending.every((x) => x.readyAt > Date.now()));
  t.diagnostic('pending: ' + JSON.stringify(list.map((x) => ({ a: x.stakeAccount.slice(0, 8), sol: x.sol, ready: x.ready, readyAt: new Date(x.readyAt).toISOString() }))));
  // An inactive (undelegated) stake account the parent controls is "ready": exactly what a slow exit
  // becomes after cooldown. Make one now so the claim path runs without waiting an epoch.
  const seed = 'isabella-test-claim';
  const stakeKey = await web3.PublicKey.createWithSeed(payer.publicKey, seed, web3.StakeProgram.programId);
  if (!(await conn.getAccountInfo(stakeKey))) {
    const rent = await conn.getMinimumBalanceForRentExemption(web3.StakeProgram.space);
    const tx = web3.StakeProgram.createAccountWithSeed({
      fromPubkey: payer.publicKey, stakePubkey: stakeKey, basePubkey: payer.publicKey, seed,
      authorized: new web3.Authorized(payer.publicKey, payer.publicKey), lamports: rent + 0.01e9,
    });
    note(t, 'test setup: inactive stake account', await web3.sendAndConfirmTransaction(conn, tx, [payer], { commitment: 'confirmed' }));
  }
  const ready = (await Pay.pendingSlowExits()).filter((x) => x.ready);
  assert.ok(ready.some((x) => x.stakeAccount === stakeKey.toBase58()), 'the inactive account is ready');
  bridge.quietAfterNextSend = true; // the wallet sends, then never answers (Contract 1 maybeSubmitted)
  const r = await Pay.claimSlow();
  note(t, 'claim (stake Withdraw; wallet went quiet, found on-chain)', r.signature);
  assert.ok(r.claimed >= 1);
  assert.equal(await conn.getAccountInfo(stakeKey, 'confirmed'), null, 'withdrawn in full and closed');
  t.diagnostic(`claimed ${r.sol} SOL from ${r.claimed} account(s); the deactivating exit stays until the next epoch`);
});

test('buy(SOL) on devnet: transfer + reference; refresh() finds it after the cache is cleared', async (t) => {
  if (!need(t)) return;
  const { Pay, Ent } = app;
  const r = await Pay.buy('SOL');
  if (r.alreadyOwned) t.diagnostic('this wallet already bought in an earlier run; buy() refused to charge twice');
  note(t, r.alreadyOwned ? 'purchase (earlier run)' : 'purchase (SOL transfer + reference)', r.signature);
  assert.equal(Ent.status().unlocked, true, 'unlocked as soon as buy() resolves (confirmed)');
  assert.equal(Ent.status().via, 'purchase');
  assert.ok(await waitFinal(r.signature), 'finalized');
  const tx = await conn.getTransaction(r.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  const keys = tx.transaction.message.getAccountKeys().staticAccountKeys.map((k) => k.toBase58());
  assert.ok(keys.includes(Ent.referenceFor(payer.publicKey.toBase58())), 'the reference key is in the transaction');
  localStorage.removeItem(Ent.STORE_KEY); // simulated reinstall
  assert.equal(Ent.status().unlocked, false);
  const s = await Ent.refresh();
  assert.equal(s.unlocked, true, JSON.stringify(s));
  assert.equal(s.via, 'purchase');
  assert.equal(s.purchase, r.signature);
  const again = await Pay.buy('SOL');
  assert.equal(again.alreadyOwned, true, 'a second buy() does not charge again');
});

test('buy(devnet USDC) with a second buyer: exact token transfer + reference', async (t) => {
  if (!need(t)) return;
  const { Pay, Ent, Wallet, cfg } = app;
  const mintFile = resolve(H.KEYS, 'test-usdc-mint.json');
  let mint;
  if (existsSync(mintFile)) mint = new web3.PublicKey(JSON.parse(readFileSync(mintFile, 'utf8')).mint);
  if (!mint || !(await conn.getAccountInfo(mint))) {
    mint = await splToken.createMint(conn, payer, payer.publicKey, null, 6); // stand-in for Circle's devnet USDC
    writeFileSync(mintFile, JSON.stringify({ mint: mint.toBase58() }));
  }
  const merchantAta = await splToken.getOrCreateAssociatedTokenAccount(conn, payer, mint, merchant.publicKey);
  const buyerAta = await splToken.getOrCreateAssociatedTokenAccount(conn, payer, mint, buyer2.publicKey);
  if (buyerAta.amount < 4990000n) await splToken.mintTo(conn, payer, mint, buyerAta.address, payer, 20000000n);
  if ((await conn.getBalance(buyer2.publicKey)) < 0.01e9) {
    await web3.sendAndConfirmTransaction(conn, new web3.Transaction().add(web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: buyer2.publicKey, lamports: 0.02e9 })), [payer]);
  }
  cfg.merchant.usdcMint = mint.toBase58();
  cfg.merchant.usdcAta = merchantAta.address.toBase58();
  bridge.useKeypair(buyer2);
  Wallet.disconnect();
  assert.equal(await Wallet.connect(), buyer2.publicKey.toBase58());
  const tokens = await Pay.payableTokens();
  assert.deepEqual(tokens.map((x) => x.symbol), ['SOL', 'USDC']);
  assert.equal(tokens[1].enough, true, JSON.stringify(tokens));
  const r = await Pay.buy(mint.toBase58());
  note(t, r.alreadyOwned ? 'USDC purchase (earlier run)' : 'purchase (devnet USDC stand-in)', r.signature);
  assert.equal(Ent.status().unlocked, true);
  assert.ok(await waitFinal(r.signature), 'finalized');
  localStorage.removeItem(Ent.STORE_KEY);
  const s = await Ent.refresh();
  assert.equal(s.unlocked, true); assert.equal(s.via, 'purchase');
  bridge.useKeypair(payer);
  Wallet.disconnect();
  await Wallet.connect();
});

test('summary', (t) => {
  if (links.length) t.diagnostic('explorer links:\n' + links.join('\n'));
  else t.skip(skipWhy || 'nothing ran');
});
