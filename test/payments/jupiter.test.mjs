// Jupiter, READ-ONLY on mainnet (nothing is signed or sent):
//  1. ExactOut quote SOL -> 15 USDC (Metis /swap/v1/quote).
//  2. IsabellaPay.buy(SOL, { dryRun:true }) composes the real payment transaction to a DUMMY merchant;
//     decode it (lookup tables resolved from mainnet) and check its structure.
//  3. The fallback route (Swap V2 /build ExactIn + exact USDC transfer), forced, decoded.
//  4. Proof by simulation: the same composer with a public funded wallet as payer and its own USDC
//     account as "merchant"; simulateTransaction (sigVerify:false) shows exactly 15 USDC arriving.
// Keyless api.jup.ag works at 0.5 req/s (JUP_API_KEY=... raises it). If Jupiter is unreachable, the
// structural checks run on the recorded fixture in fixtures/jupiter-exactout.json (RECORD=1 refreshes it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, 'fixtures');
const RECORD = process.env.RECORD === '1';
H.installBrowserGlobals();
const L = H.loadBundle();
const { web3, splToken } = L;
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const SOL = 'So11111111111111111111111111111111111111112';
const NAMES = {
  ComputeBudget111111111111111111111111111111: 'ComputeBudget',
  '11111111111111111111111111111111': 'System',
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'Token',
  ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL: 'AssociatedToken',
  JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4: 'Jupiter v6',
};
const seedKey = (s) => web3.Keypair.fromSeed(createHash('sha256').update(s).digest()).publicKey;
const dummyParent = seedKey('isabella dummy parent (never funded)');
const dummyMerchant = seedKey('isabella dummy merchant (never funded)');
const dummyAta = splToken.getAssociatedTokenAddressSync(new web3.PublicKey(USDC), dummyMerchant, true);
// A public exchange hot wallet with SOL and an initialized USDC account: used ONLY as the fee payer of
// a read-only simulation (no signature exists, nothing is sent).
const FUNDED = new web3.PublicKey(process.env.SIM_WALLET || '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9');
const FUNDED_ATA = splToken.getAssociatedTokenAddressSync(new web3.PublicKey(USDC), FUNDED, true);

let bridgeKey = dummyParent.toBase58();
const bridge = {
  available: () => 'true',
  savedPublicKey: () => bridgeKey,
  connect(id) { setTimeout(() => window.__walletResult(id, JSON.stringify({ ok: true, publicKey: bridgeKey })), 1); },
  signAndSend(id) { setTimeout(() => window.__walletResult(id, JSON.stringify({ ok: false, error: 'read-only test: never signs', cancelled: true })), 1); },
  disconnect() {},
};
const { cfg, Wallet, Ent, Pay } = H.loadApp({
  bridge,
  config: {
    cluster: 'mainnet-beta', chain: 'solana:mainnet', rpcUrl: H.MAINNET_RPC,
    merchant: { wallet: dummyMerchant.toBase58(), usdcMint: USDC, usdcAta: dummyAta.toBase58() },
    jupiter: { apiKey: process.env.JUP_API_KEY || '' },
  },
});
const conn = Wallet.connection();

async function decode(b64) {
  const tx = web3.VersionedTransaction.deserialize(L.Buffer.from(b64, 'base64'));
  const alts = [];
  for (const l of tx.message.addressTableLookups) {
    const r = await conn.getAddressLookupTable(l.accountKey);
    assert.ok(r.value, 'lookup table ' + l.accountKey.toBase58() + ' exists on mainnet');
    alts.push(r.value);
  }
  const msg = web3.TransactionMessage.decompile(tx.message, { addressLookupTableAccounts: alts });
  const keys = tx.message.getAccountKeys({ addressLookupTableAccounts: alts });
  return { tx, msg, keys };
}
function summarize(msg) {
  return msg.instructions.map((ix, i) => {
    const program = ix.programId.toBase58();
    return { i, program: NAMES[program] || program, accounts: ix.keys.length, dataBytes: ix.data.length };
  });
}
function liveUnavailable(e) { return (e && e.code === 'offline') || ['JUPITER_ERROR', 'JUPITER_KEY', 'RPC_ERROR'].includes(e && e.reason) || /fetch failed|429|ENOTFOUND/.test(String(e && e.message)); }
const pause = () => H.sleep(2200); // keyless Jupiter: 0.5 requests/s

test('ExactOut quote: SOL -> exactly 15 USDC (Metis /swap/v1/quote, keyless)', async (t) => {
  const url = cfg.jupiter.apiBase + '/swap/v1/quote?inputMint=' + SOL + '&outputMint=' + USDC +
    '&amount=15000000&swapMode=ExactOut&slippageBps=50&restrictIntermediateTokens=true&instructionVersion=V2';
  const headers = cfg.jupiter.apiKey ? { 'x-api-key': cfg.jupiter.apiKey } : {};
  let r;
  try { r = await fetch(url, { headers }); } catch (e) { t.skip('Jupiter unreachable: ' + e.message); return; }
  if (r.status === 401 || r.status === 403) { t.skip('Jupiter now requires an API key (HTTP ' + r.status + '): set JUP_API_KEY'); return; }
  assert.equal(r.status, 200);
  const q = await r.json();
  assert.equal(q.swapMode, 'ExactOut');
  assert.equal(q.outAmount, '15000000');
  assert.ok(BigInt(q.otherAmountThreshold) >= BigInt(q.inAmount), 'max input includes slippage');
  const labels = q.routePlan.map((p) => p.swapInfo.label);
  assert.ok(labels.length > 0);
  // The payments doc lists Orca Whirlpool, Raydium CLMM and Raydium CPMM for ExactOut; the live API has
  // also returned PancakeSwap (CLMM) routes, so the label is reported, not asserted.
  t.diagnostic(`quote: ${Number(q.inAmount) / 1e9} SOL (max ${Number(q.otherAmountThreshold) / 1e9}) -> 15 USDC via ${labels.join(' + ')}, impact ${q.priceImpactPct}`);
  await pause();
});

test('dry-run buy(SOL) composes the ExactOut payment to a dummy merchant; decoded', async (t) => {
  let r;
  try { r = await Pay.buy(SOL, { dryRun: true }); } catch (e) {
    if (!liveUnavailable(e)) throw e;
    const file = resolve(FIXTURES, 'jupiter-exactout.json');
    if (!existsSync(file)) throw e;
    t.diagnostic('live Jupiter unavailable (' + e.message + '); structural checks on the recorded fixture');
    r = JSON.parse(readFileSync(file, 'utf8')).result;
  }
  assert.equal(r.route, 'exactOut');
  assert.ok(r.size <= 1232, 'fits in a packet: ' + r.size + ' bytes');
  const { tx, msg, keys } = await decode(r.transaction);
  assert.ok(msg.payerKey.equals(dummyParent), 'fee payer = the parent');
  assert.ok(tx.signatures.every((s) => s.every((b) => b === 0)), 'unsigned (the wallet signs)');
  assert.equal(NAMES[msg.instructions[0].programId.toBase58()], 'ComputeBudget');
  assert.equal(msg.instructions[0].data[0], 2, 'first instruction sets the compute-unit limit');
  const swap = msg.instructions.find((ix) => NAMES[ix.programId.toBase58()] === 'Jupiter v6');
  assert.ok(swap, 'has the Jupiter swap instruction');
  const dest = swap.keys.find((k) => k.pubkey.equals(dummyAta));
  assert.ok(dest && dest.isWritable, 'swap writes to the merchant USDC account (destinationTokenAccount)');
  const last = msg.instructions[msg.instructions.length - 1];
  const close = msg.instructions[msg.instructions.length - 2];
  const parentUsdc = splToken.getAssociatedTokenAddressSync(new web3.PublicKey(USDC), dummyParent, true);
  assert.equal(r.refundsTokenAccount, true, 'the parent has no USDC account, so the one the route creates is closed again');
  assert.ok(NAMES[close.programId.toBase58()] === 'Token' && close.data[0] === 9 && close.keys[0].pubkey.equals(parentUsdc), 'CloseAccount(parent USDC) refunds the rent');
  assert.equal(NAMES[last.programId.toBase58()], 'System');
  assert.ok(last.keys[0].pubkey.equals(dummyParent) && last.keys[1].pubkey.equals(dummyMerchant), '0-lamport reference transfer to the merchant');
  assert.equal(L.Buffer.from(last.data).readBigUInt64LE(4), 0n, '0 lamports');
  const ref = last.keys[2];
  assert.equal(ref.pubkey.toBase58(), Ent.referenceFor(dummyParent.toBase58()), 'carries the reference key');
  assert.equal(ref.isSigner, false); assert.equal(ref.isWritable, false);
  const refIndex = keys.staticAccountKeys.findIndex((k) => k.equals(ref.pubkey));
  assert.ok(refIndex >= 0, 'reference is a static key, so getSignaturesForAddress(reference) indexes it');
  t.diagnostic('decoded: ' + JSON.stringify(summarize(msg)));
  t.diagnostic(`size ${r.size} B, ${keys.staticAccountKeys.length} static keys + ${keys.accountKeysFromLookups ? keys.accountKeysFromLookups.writable.length + keys.accountKeysFromLookups.readonly.length : 0} from ${tx.message.addressTableLookups.length} lookup tables; quote ${JSON.stringify(r.quote)}`);
  t.diagnostic('simulation with the unfunded dummy payer (expected to fail): ' + JSON.stringify(r.simulation && r.simulation.err));
  if (RECORD) {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(resolve(FIXTURES, 'jupiter-exactout.json'), JSON.stringify({ recordedAt: new Date().toISOString(), dummyParent: dummyParent.toBase58(), dummyMerchant: dummyMerchant.toBase58(), dummyAta: dummyAta.toBase58(), result: r, decoded: summarize(msg) }, null, 1));
  }
  await pause();
});

test('fallback: Swap V2 /build ExactIn into the payer\'s USDC + an exact 15 USDC transfer; decoded', async (t) => {
  let r;
  try { r = await Pay.buy(SOL, { dryRun: true, forceRoute: 'exactIn+transfer' }); } catch (e) {
    if (liveUnavailable(e)) { t.skip('live Jupiter unavailable: ' + e.message); return; }
    throw e;
  }
  assert.equal(r.route, 'exactIn+transfer');
  assert.ok(BigInt(r.quote.otherAmountThreshold) >= 15000000n, 'minimum output still covers 15 USDC');
  assert.ok(r.size <= 1232);
  const { msg } = await decode(r.transaction);
  const last = msg.instructions[msg.instructions.length - 1];
  assert.equal(NAMES[last.programId.toBase58()], 'Token');
  const data = L.Buffer.from(last.data);
  assert.equal(data[0], 12, 'TransferChecked');
  assert.equal(data.readBigUInt64LE(1), 15000000n, 'exactly 15 USDC');
  assert.equal(data[9], 6, 'USDC decimals');
  const payerUsdc = splToken.getAssociatedTokenAddressSync(new web3.PublicKey(USDC), dummyParent, true);
  assert.ok(last.keys[0].pubkey.equals(payerUsdc) && last.keys[2].pubkey.equals(dummyAta), 'payer USDC -> merchant USDC');
  assert.equal(last.keys[last.keys.length - 1].pubkey.toBase58(), Ent.referenceFor(dummyParent.toBase58()), 'reference appended (read-only)');
  t.diagnostic(`fallback: ${Number(r.quote.inAmount) / 1e9} SOL in, min out ${Number(r.quote.otherAmountThreshold) / 1e6} USDC, ${r.size} B; ` + JSON.stringify(summarize(msg)));
  await pause();
});

/** Re-simulate (read-only) and return the destination's USDC delta and the post-state of `watch` accounts. */
async function simulateDelta(b64, destination, watch = []) {
  const { keys } = await decode(b64);
  const all = [...keys.staticAccountKeys, ...(keys.accountKeysFromLookups ? [...keys.accountKeysFromLookups.writable, ...keys.accountKeysFromLookups.readonly] : [])].map((k) => k.toBase58());
  const res = await fetch(H.MAINNET_RPC, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'simulateTransaction', params: [b64, { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed', accounts: { encoding: 'base64', addresses: watch } }] }),
  }).then((x) => x.json());
  assert.ok(res.result, 'simulateTransaction answered: ' + JSON.stringify(res.error));
  const v = res.result.value;
  assert.equal(v.err, null, 'simulates cleanly: ' + JSON.stringify(v.err) + ' ' + (v.logs || []).slice(-3).join(' | '));
  const i = all.indexOf(destination);
  const pre = (v.preTokenBalances || []).find((b) => b.accountIndex === i);
  const post = (v.postTokenBalances || []).find((b) => b.accountIndex === i);
  assert.ok(post, 'simulation reports the destination token balance');
  return { delivered: BigInt(post.uiTokenAmount.amount) - BigInt(pre ? pre.uiTokenAmount.amount : '0'), units: v.unitsConsumed, accounts: v.accounts || [] };
}
async function payAs(payer, merchantWallet, merchantAta) {
  bridgeKey = payer.toBase58();
  Wallet.disconnect();
  await Wallet.connect();
  cfg.merchant.wallet = merchantWallet.toBase58();
  cfg.merchant.usdcAta = merchantAta.toBase58();
  return Pay.buy(SOL, { dryRun: true });
}

test('proof by simulation: a funded payer\'s ExactOut payment delivers exactly 15 USDC (read-only)', async (t) => {
  let r;
  try { r = await payAs(FUNDED, FUNDED, FUNDED_ATA); } catch (e) {
    if (liveUnavailable(e)) { t.skip('live Jupiter/RPC unavailable: ' + e.message); return; }
    throw e;
  }
  assert.equal(r.route, 'exactOut');
  assert.equal(r.simulation.err, null, 'the composer\'s own simulation passed');
  const { delivered, units } = await simulateDelta(r.transaction, FUNDED_ATA.toBase58());
  assert.equal(delivered, 15000000n, 'exactly 15.000000 USDC lands in the destination token account');
  t.diagnostic(`simulated: ${units} CU, +${Number(delivered) / 1e6} USDC at ${FUNDED_ATA.toBase58()} for ${Number(r.quote.inAmount) / 1e9} SOL (payer ${FUNDED.toBase58()}, signature-free)`);
  await pause();
});

test('proof by simulation: a payer with no USDC account gets the route\'s token-account rent back', async (t) => {
  const payer = new web3.PublicKey(process.env.SIM_WALLET_NO_USDC || 'DRpbCBMxVnDK7maPM5tGv6MvB3v1sRMC86PZ8okm21hy');
  const payerUsdc = splToken.getAssociatedTokenAddressSync(new web3.PublicKey(USDC), payer, true);
  if (await conn.getAccountInfo(payerUsdc)) { t.skip('the chosen payer now has a USDC account; set SIM_WALLET_NO_USDC'); return; }
  let r;
  try { r = await payAs(payer, FUNDED, FUNDED_ATA); } catch (e) {
    if (liveUnavailable(e)) { t.skip('live Jupiter/RPC unavailable: ' + e.message); return; }
    throw e;
  }
  assert.equal(r.refundsTokenAccount, true);
  const { delivered, units, accounts } = await simulateDelta(r.transaction, FUNDED_ATA.toBase58(), [payerUsdc.toBase58()]);
  assert.equal(delivered, 15000000n, 'exactly 15 USDC to the merchant');
  const after = accounts[0];
  assert.ok(after === null || (after.lamports === 0 && after.owner === '11111111111111111111111111111111'), 'the payer\'s temporary USDC account is closed again (rent refunded): ' + JSON.stringify(after));
  t.diagnostic(`simulated: ${units} CU, +15 USDC to the merchant, payer USDC account closed in the same transaction`);
  await pause();
});

test('purchase verifier reads real mainnet transactions (v0 with lookup tables), as refresh() will', async (t) => {
  const saved = Object.assign({}, cfg.merchant);
  try {
    // A known v0 Jupiter swap with a lookup table that credited 20.927499 USDC (2 Oct 2026), then live ones.
    const known = [{ signature: '2smpUvrmNpdCbNYbYGiCmtvj1PdNRAbj2uCe491j11cbpKzQbM3VQbcByoixz2KK1YUjmdiNdQGLijvr9WB44mxu', err: null }];
    const live = await conn.getSignaturesForAddress(new web3.PublicKey('JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'), { limit: 40 }, 'finalized').catch(() => []);
    for (const s of known.concat(live).filter((x) => !x.err)) {
      const tx = await conn.getTransaction(s.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }).catch(() => null);
      if (!tx || tx.version !== 0 || !tx.transaction.message.addressTableLookups.length) continue;
      const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
      const pre = tx.meta.preTokenBalances || [];
      for (const pb of tx.meta.postTokenBalances || []) {
        const before = pre.find((x) => x.accountIndex === pb.accountIndex);
        const delta = pb.mint === USDC ? BigInt(pb.uiTokenAmount.amount) - BigInt(before ? before.uiTokenAmount.amount : '0') : 0n;
        if (delta < 15000000n) continue;
        cfg.merchant.wallet = ''; // match by the token account alone
        cfg.merchant.usdcAta = keys.get(pb.accountIndex).toBase58();
        const payer = keys.get(0).toBase58(); // stands in for the reference key (any static key works)
        const v = Ent.verifyPurchaseTransaction(tx, payer);
        assert.equal(v && v.kind, 'usdc');
        assert.equal(v.amount, Number(delta) / 1e6);
        assert.equal(Ent.verifyPurchaseTransaction(tx, web3.Keypair.generate().publicKey.toBase58()), null, 'a transaction without the reference key is not a purchase');
        cfg.priceUsd = Number(delta) / 1e6 + 0.01;
        assert.equal(Ent.verifyPurchaseTransaction(tx, payer), null, 'less than the price is not a purchase');
        cfg.priceUsd = 15;
        t.diagnostic(`v0 tx ${s.signature.slice(0, 16)}… (${tx.transaction.message.addressTableLookups.length} lookup table): +${Number(delta) / 1e6} USDC recognised`);
        return;
      }
    }
    t.skip('no v0 USDC credit >= 15 in the latest 40 Jupiter transactions');
  } finally { Object.assign(cfg.merchant, saved); cfg.priceUsd = 15; }
});

test('payableTokens() on mainnet: verified tokens with prices from the Tokens API', async (t) => {
  bridgeKey = dummyParent.toBase58();
  Wallet.disconnect();
  await Wallet.connect();
  let list;
  try { list = await Pay.payableTokens(); } catch (e) {
    if (liveUnavailable(e)) { t.skip('live Jupiter/RPC unavailable: ' + e.message); return; }
    throw e;
  }
  const solRow = list.find((x) => x.mint === SOL);
  const usdcRow = list.find((x) => x.mint === USDC);
  assert.ok(solRow && usdcRow, 'SOL and USDC listed');
  assert.equal(usdcRow.amountNeeded, 15);
  assert.ok(solRow.amountNeeded > 0 && solRow.amountNeeded < 15, 'SOL amount priced: ' + solRow.amountNeeded);
  for (const x of list) assert.match(x.logo, /^data:image\/svg\+xml,/, 'logos are data: URIs, never remote URLs');
  t.diagnostic(JSON.stringify(list.map((x) => ({ symbol: x.symbol, amountNeeded: x.amountNeeded, balance: x.balance, enough: x.enough }))));
});
