// Devnet, READ-ONLY: every IsabellaPay flow built by the real browser code and checked against the real
// devnet programs by simulation, acting as existing devnet wallets that already hold what each flow needs
// (SOL, pool tokens). Nothing is signed or sent: the bridge records the unsigned transaction at the wallet
// prompt and answers "cancelled". Reaching the prompt already means payments.js's own pre-sign simulation
// passed (it throws a mapped error otherwise); the captured transaction is re-simulated here for logs.
// Covers both devnet stake-pool programs: DPoo1… (current build) and SPoo1… (2023 build, no *WithSlippage).
//   cd tools && node --test ../test/payments/devnet-sim.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as H from './harness.mjs';

H.installBrowserGlobals();
const L = H.loadBundle();
const { web3 } = L;
const conn = new web3.Connection(H.DEVNET_RPC, 'confirmed');

// Public devnet wallets found with getProgramAccounts(Token, mint filter): they hold 1-20 SOL worth of
// each pool's token plus SOL for fees. Override with SIM_HOLDER_DPOO / SIM_HOLDER_SPOO if they move.
const CASES = [
  { name: 'DPoo1 (Jito devnet pool)', pool: 'JitoY5pcAxWX6iyP2QdFwTznGb8A99PRCUCVVxB46WZ', holder: process.env.SIM_HOLDER_DPOO || '99fLq9KCt99p4LPVbemfNGu7XEzmqQ6WUMPHKjCLviTG', slippage: true },
  { name: 'SPoo1 (devnet bSOL pool)', pool: 'azFVdHtAJN8BX3sbGAYkXvtdjdrT5U6rj9rovvUFos9', holder: process.env.SIM_HOLDER_SPOO || '9C4qkVmyn79SgFnhHgeB2NDnA6xM1ZJDmRuopUQYYPEF', slippage: false },
];

let holderKey = CASES[0].holder;
let captured = [];
let answer = { ok: false, error: 'simulation-only test', cancelled: true };
const bridge = {
  available: () => 'true',
  savedPublicKey: () => holderKey,
  connect(id) { setTimeout(() => window.__walletResult(id, JSON.stringify({ ok: true, publicKey: holderKey })), 1); },
  signAndSend(id, chain, txsJson) {
    captured.push(...JSON.parse(txsJson));
    setTimeout(() => window.__walletResult(id, JSON.stringify(answer)), 1);
  },
  disconnect() {},
};
const { cfg, Wallet, Pay } = H.loadApp({ bridge, config: { merchant: { wallet: 'Bz4nxwANVhtuNxE6YUfvY3DAtywtX2jBC5mQj2Cdvwee' } } });

async function usePool(c) {
  const ai = await conn.getAccountInfo(new web3.PublicKey(c.pool));
  const s = L.splStakePool.StakePoolLayout.decode(ai.data);
  cfg.stake.pool = c.pool;
  cfg.stake.mint = s.poolMint.toBase58();
  cfg.stake.programId = ai.owner.toBase58();
  holderKey = c.holder;
  Wallet.disconnect();
  await Wallet.connect();
  return { s, programId: ai.owner.toBase58(), epochOk: Number(s.lastUpdateEpoch.toString()) === (await conn.getEpochInfo()).epoch };
}

/** Run a flow to the wallet prompt; return the captured transaction re-simulated. */
async function toPrompt(fn) {
  captured = [];
  let err = null;
  try { await fn(); } catch (e) { err = e; }
  assert.ok(err && err.code === 'cancelled' && err.reason === 'CANCELLED', 'reached the wallet prompt (its own simulation passed); got ' + (err ? err.code + '/' + err.reason + ' ' + err.message : 'no error'));
  assert.equal(captured.length, 1);
  const tx = web3.VersionedTransaction.deserialize(L.Buffer.from(captured[0], 'base64'));
  assert.ok(tx.signatures.every((s) => s.every((b) => b === 0)), 'unsigned');
  assert.equal(tx.message.staticAccountKeys[0].toBase58(), holderKey, 'fee payer = the wallet');
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' });
  assert.equal(sim.value.err, null, (sim.value.logs || []).slice(-4).join(' | '));
  return { tx, logs: sim.value.logs || [], units: sim.value.unitsConsumed, bytes: L.Buffer.from(captured[0], 'base64').length };
}
const said = (logs, re) => logs.some((l) => re.test(l));

for (const c of CASES) {
  test(`${c.name}: stake() DepositSol${c.slippage ? 'WithSlippage' : ' (old program: plain DepositSol fallback)'}`, async (t) => {
    const { epochOk, programId } = await usePool(c);
    if (!epochOk) { t.skip('pool not updated this epoch yet (its crank is late)'); return; }
    cfg.stake.unlockThreshold = 1e9; // this holder already has tokens; force a deposit
    const r = await toPrompt(() => Pay.stake());
    assert.ok(said(r.logs, c.slippage ? /Instruction: DepositSolWithSlippage/ : /Instruction: DepositSol$/), r.logs.join('\n'));
    assert.equal(Pay._internals.slippageSupport.get(programId), c.slippage ? undefined : false);
    t.diagnostic(`${r.bytes} B, ${r.units} CU; ${r.logs.filter((l) => /Instruction:/.test(l)).join(' / ')}`);
  });

  test(`${c.name}: exitInstant() WithdrawSol of all tokens + close the token account`, async (t) => {
    const { epochOk } = await usePool(c);
    if (!epochOk) { t.skip('pool not updated this epoch'); return; }
    cfg.stake.unlockThreshold = 0.99;
    const r = await toPrompt(() => Pay.exitInstant());
    assert.ok(said(r.logs, c.slippage ? /Instruction: WithdrawSolWithSlippage/ : /Instruction: WithdrawSol$/), r.logs.join('\n'));
    // (the devnet token program no longer logs instruction names, so check the compiled instruction)
    const close = r.tx.message.compiledInstructions.find((ix) => r.tx.message.staticAccountKeys[ix.programIdIndex].toBase58() === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    assert.ok(close && close.data[0] === 9, 'CloseAccount on the emptied token account (rent back to the parent)');
    t.diagnostic(`${r.bytes} B, ${r.units} CU; ${r.logs.filter((l) => /Instruction:/.test(l)).join(' / ')}`);
  });

  test(`${c.name}: exitSlow() createAccountWithSeed + WithdrawStake + Deactivate in one transaction`, async (t) => {
    const { epochOk } = await usePool(c);
    if (!epochOk) { t.skip('pool not updated this epoch'); return; }
    const r = await toPrompt(() => Pay.exitSlow());
    assert.ok(said(r.logs, c.slippage ? /Instruction: WithdrawStakeWithSlippage/ : /Instruction: WithdrawStake$/), r.logs.join('\n'));
    const programs = r.tx.message.compiledInstructions.map((ix) => r.tx.message.staticAccountKeys[ix.programIdIndex].toBase58());
    assert.deepEqual(programs.filter((p) => p === 'Stake11111111111111111111111111111111111111').length, 1, 'one stake-program instruction (Deactivate)');
    const deactivate = r.tx.message.compiledInstructions.find((ix) => r.tx.message.staticAccountKeys[ix.programIdIndex].toBase58() === 'Stake11111111111111111111111111111111111111');
    assert.equal(L.Buffer.from(deactivate.data).readUInt32LE(0), 5, 'StakeInstruction::Deactivate');
    t.diagnostic(`${r.bytes} B, ${r.units} CU; ${r.logs.filter((l) => /Instruction:/.test(l)).join(' / ')}`);
  });
}

test('stale pool with no validator stake: exits prepend the permissionless update; slow exit is paid from the reserve', async (t) => {
  // A long-abandoned devnet pool (its crank stopped): our code must run the update itself, and with no
  // validator stake the program pays a slow exit from the reserve (undelegated: no Deactivate, claimable at once).
  const poolKey = new web3.PublicKey(process.env.SIM_STALE_POOL || '4CJhau4aa4C6qLDj4kFbpt5mNm4cDbFE8ftweLudA3Pt');
  const ai = await conn.getAccountInfo(poolKey);
  if (!ai) { t.skip('pool gone'); return; }
  const s = L.splStakePool.StakePoolLayout.decode(ai.data);
  const rate = Number(s.totalLamports.toString()) / Number(s.poolTokenSupply.toString());
  const accs = await conn.getProgramAccounts(new web3.PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), { filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: s.poolMint.toBase58() } }], dataSlice: { offset: 32, length: 40 } });
  let holder = null;
  for (const a of accs.map((x) => ({ owner: new web3.PublicKey(x.account.data.subarray(0, 32)), amount: Number(x.account.data.readBigUInt64LE(32)) / 1e9 })).filter((h) => h.amount * rate >= 1.1).sort((x, y) => y.amount - x.amount).slice(0, 5)) {
    const oi = await conn.getAccountInfo(a.owner);
    if (oi && oi.owner.equals(web3.SystemProgram.programId) && oi.data.length === 0 && oi.lamports > 0.02e9) { holder = a.owner.toBase58(); break; }
  }
  if (!holder) { t.skip('no holder of that pool\'s token with SOL for fees'); return; }
  const stale = Number(s.lastUpdateEpoch.toString()) < (await conn.getEpochInfo()).epoch;
  await usePool({ pool: poolKey.toBase58(), holder });
  const slow = await toPrompt(() => Pay.exitSlow());
  const programs = slow.tx.message.compiledInstructions.map((ix) => slow.tx.message.staticAccountKeys[ix.programIdIndex].toBase58());
  assert.ok(!programs.includes('Stake11111111111111111111111111111111111111'), 'no Deactivate: the reserve split is not delegated');
  assert.ok(said(slow.logs, /Instruction: WithdrawStake/) && said(slow.logs, /Instruction: Split/));
  if (stale) assert.ok(said(slow.logs, /Instruction: UpdateStakePoolBalance/), 'update prepended');
  const instant = await toPrompt(() => Pay.exitInstant());
  if (stale) assert.ok(said(instant.logs, /Instruction: UpdateStakePoolBalance/), 'update prepended');
  t.diagnostic(`${stale ? 'stale' : 'up-to-date'} pool ${poolKey.toBase58().slice(0, 8)}…: slow exit ${slow.logs.filter((l) => /Instruction:/.test(l)).map((l) => l.replace('Program log: Instruction: ', '')).join(' / ')}`);
});

test('buy(SOL) on devnet: transfer to the merchant carrying the reference key', async (t) => {
  await usePool(CASES[0]);
  const r = await toPrompt(() => Pay.buy('SOL'));
  const [ix] = r.tx.message.compiledInstructions;
  const keys = ix.accountKeyIndexes.map((i) => r.tx.message.staticAccountKeys[i].toBase58());
  assert.equal(keys[1], cfg.merchant.wallet);
  assert.equal(keys[2], window.IsabellaEntitlement.referenceFor(holderKey), 'reference appended (read-only)');
  assert.equal(L.Buffer.from(ix.data).readBigUInt64LE(4), 100000000n, '0.1 SOL demo price');
  assert.equal(r.tx.message.isAccountWritable(ix.accountKeyIndexes[2]), false);
  t.diagnostic(`${r.bytes} B, ${r.units} CU`);
});

test('a wallet that answers "Blockhash not found" (slow approval) surfaces as TX_EXPIRED', async () => {
  await usePool(CASES[0]);
  answer = { ok: false, error: 'Transaction simulation failed: Blockhash not found' };
  try {
    await assert.rejects(Pay.buy('SOL'), (e) => e.code === 'failed' && e.reason === 'TX_EXPIRED' && /try again/i.test(e.message));
  } finally {
    answer = { ok: false, error: 'simulation-only test', cancelled: true };
  }
});

test('a wallet that goes quiet mid-send (maybeSubmitted) is checked on-chain: nothing landed -> NOT_SENT', async (t) => {
  await usePool(CASES[0]);
  answer = { ok: false, maybeSubmitted: true, timeout: true };
  const t0 = Date.now();
  try {
    await assert.rejects(Pay.buy('SOL'), (e) => e.code === 'failed' && e.reason === 'NOT_SENT' && /nothing was spent/.test(e.message));
  } finally {
    answer = { ok: false, error: 'simulation-only test', cancelled: true };
  }
  t.diagnostic(`looked for the transaction on-chain until its blockhash expired: ${Math.round((Date.now() - t0) / 1000)} s`);
});

test('pendingSlowExits() finds stake accounts by withdrawer on public devnet RPC', async (t) => {
  // getProgramAccounts(Stake, withdrawer=memcmp) must work on the public endpoint, else only our seeds are found.
  const res = await conn.getProgramAccounts(web3.StakeProgram.programId, { filters: [{ dataSize: 200 }, { memcmp: { offset: 44, bytes: CASES[0].holder } }] });
  t.diagnostic(`getProgramAccounts(Stake, withdrawer=${CASES[0].holder.slice(0, 8)}…) answered with ${res.length} account(s)`);
  await usePool(CASES[0]);
  const list = await Pay.pendingSlowExits();
  assert.ok(Array.isArray(list));
  t.diagnostic('pendingSlowExits for that wallet: ' + JSON.stringify(list.map((x) => ({ a: x.stakeAccount.slice(0, 8), sol: x.sol, ready: x.ready }))));
});
