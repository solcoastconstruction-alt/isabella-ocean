#!/usr/bin/env node
// End-to-end DEVNET tests with a throwaway "parent" wallet, doing exactly what the app does.
// The parent's wallet is the only signer of every parent transaction (the exit stake account is
// created with createAccountWithSeed), as it will be under Mobile Wallet Adapter.
//
// Default flow:
//   1. DepositSol 1.01 SOL                      -> ≈1.01 OCEAN
//   2. WithdrawSol (instant exit), all tokens   -> SOL back minus the 0.3% fee
//   3. DepositSol 1.01 SOL again
//   4. WithdrawStake (free exit), all tokens    -> a new stake account owned by the parent,
//      deactivated in the same transaction      -> report when it can be withdrawn (claimed)
//   node smoke.mjs                                  # new parent funded from the payer
//   node smoke.mjs --rebalance-before-stake-exit    # let the staker stake the reserve excess (whole
//                                                   # deposits, buffer 0) before step 4
//   node smoke.mjs --fee-test 0.01                  # also prove the 100% fee mints to the manager
//   node smoke.mjs --deposit-sol 1.01 --keep        # keep the parent's leftover SOL
//
// Primary-exit check (two phases, across an epoch boundary):
//   node smoke.mjs --primary-exit-check   # phase 1: a parent deposits 1.01, the staker stakes exactly
//                                         # that deposit into the primary validator
//   node smoke.mjs --primary-exit-check   # phase 2 (next epoch): update merges it; the parent's 1.01
//                                         # slow exit must come from the primary's active stake
//
// Later: node smoke.mjs --claim --parent keys/devnet/parent-<ts>.json   (claim ready stake accounts)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair, PublicKey, SystemProgram, StakeProgram } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createCloseAccountInstruction, getAccount,
} from '@solana/spl-token';
import { parseArgs, loadContext, loadKeypair, assertSendAllowed, lamportsToSol, solToLamports, writeKeypair, explorerTx, toJson, sleep } from './lib/env.mjs';
import { depositSol, withdrawSol, withdrawStake } from './lib/ix.mjs';
import { sendTx, simulateOk } from './lib/tx.mjs';
import { runUpdate, runRebalance } from './lib/crank-core.mjs';
import {
  loadState, solPerToken, quoteDepositSol, quoteWithdrawSol, quoteWithdrawStake, pickWithdrawSource,
  epochTiming, withdrawAllIx, maxStakeWithdrawal, headroomOf,
} from './lib/pool-ops.mjs';
import { fetchStakeAccount, U64_MAX } from './lib/state.mjs';

const args = parseArgs();
const ctx = loadContext(args);
if (ctx.cluster !== 'devnet') throw new Error('smoke.mjs is devnet-only');
await assertSendAllowed(ctx);
const conn = ctx.connection;
const payer = loadKeypair(ctx, 'payer');
const evidence = { signatures: {}, numbers: {} };
const log = (...a) => console.log(...a);
const tol = (x) => (x * 9_999n) / 10_000n; // 0.01% slippage tolerance on quotes
const checkFile = join(ctx.keysDir, 'primary-exit-check.json');
const depositLamports = solToLamports(String(args['deposit-sol'] ?? '1.01'));

// ---------- parent wallet ----------
let parent, parentFile;
const savedCheck = args['primary-exit-check'] && existsSync(checkFile) ? JSON.parse(readFileSync(checkFile, 'utf8')) : null;
const parentArg = args.parent ?? savedCheck?.parentFile;
if (parentArg) { parentFile = String(parentArg); parent = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(parentFile, 'utf8')))); }
else { parent = Keypair.generate(); parentFile = join(ctx.keysDir, `parent-${Date.now()}.json`); writeKeypair(parentFile, parent); }
log(`parent ${parent.publicKey.toBase58()}  (key: ${parentFile})`);

let s = await loadState(ctx);
const a = s.addresses;
const ata = getAssociatedTokenAddressSync(a.mint, parent.publicKey, false, TOKEN_PROGRAM_ID);
const tokenBalance = async () => { try { return (await getAccount(conn, ata, 'confirmed')).amount; } catch { return 0n; } };
const solBalance = async () => BigInt(await conn.getBalance(parent.publicKey, 'confirmed'));

async function parentStakeAccounts() {
  // StakeStateV2: 4-byte tag, 8-byte rent_exempt_reserve, staker (32), withdrawer (32) -> withdrawer at offset 44
  const accs = await conn.getProgramAccounts(StakeProgram.programId, { filters: [{ dataSize: 200 }, { memcmp: { offset: 44, bytes: parent.publicKey.toBase58() } }] });
  return Promise.all(accs.map((x) => fetchStakeAccount(conn, x.pubkey)));
}

async function claimReady(label = 'claim') {
  const out = [];
  for (const st of await parentStakeAccounts()) {
    const sim = await simulateOk(ctx, [withdrawAllIx(st.address, parent.publicKey, st.lamports)], parent.publicKey);
    if (!sim.ok) { log(`  stake account ${st.address.toBase58()} (${lamportsToSol(st.lamports)} SOL) not withdrawable yet`); continue; }
    out.push(await sendTx(ctx, { label: `${label}: withdraw ${lamportsToSol(st.lamports)} SOL from stake account ${st.address.toBase58()}`, instructions: [withdrawAllIx(st.address, parent.publicKey, st.lamports)], signers: [parent] }));
  }
  return out;
}

async function fundParent(lamports) {
  const have = await solBalance();
  if (have >= lamports) return null;
  return sendTx(ctx, { label: `fund parent with ${lamportsToSol(lamports - have)} SOL from the payer`, instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: parent.publicKey, lamports: Number(lamports - have) })], signers: [payer] });
}

async function deposit(step) {
  s = await loadState(ctx);
  const q = quoteDepositSol(s.pool, depositLamports);
  const t0 = await tokenBalance();
  const sig = await sendTx(ctx, {
    label: `${step}: DepositSolWithSlippage ${lamportsToSol(depositLamports)} SOL (min ${lamportsToSol(tol(q.tokens))} OCEAN)`,
    instructions: [
      createAssociatedTokenAccountIdempotentInstruction(parent.publicKey, ata, parent.publicKey, a.mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
      depositSol({ programId: a.programId, stakePool: a.pool, withdrawAuthority: a.withdrawAuthority, reserveStake: a.reserve, lamportsFrom: parent.publicKey, poolTokensTo: ata, managerFeeAccount: a.managerFeeAccount, poolMint: a.mint, tokenProgramId: s.pool.tokenProgramId, lamports: depositLamports, minimumPoolTokensOut: tol(q.tokens) }),
    ],
    signers: [parent],
  });
  const got = (await tokenBalance()) - t0;
  log(`      received ${lamportsToSol(got)} OCEAN for ${lamportsToSol(depositLamports)} SOL (quote ${lamportsToSol(q.tokens)})`);
  if (got !== q.tokens) throw new Error(`deposit minted ${got}, quote said ${q.tokens}`);
  return { sig, tokens: got };
}

// WithdrawStake of all the parent's tokens to a new seed-derived stake account (+ Deactivate when
// the stake is delegated), in ONE transaction signed only by the parent.
async function stakeExit(label, { expectKind, expectVote } = {}) {
  s = await loadState(ctx);
  const tokens = await tokenBalance();
  const q = quoteWithdrawStake(s.pool, tokens);
  const src = pickWithdrawSource(s, q.lamports);
  log(`\n${label}: stake exit of ${lamportsToSol(tokens)} OCEAN = ${lamportsToSol(q.lamports)} SOL of stake (stake withdrawal fee ${lamportsToSol(q.feeTokens)} OCEAN); largest possible now ${lamportsToSol(maxStakeWithdrawal(s).lamports)} SOL`);
  if (!src.ok) { log(`      BLOCKED: ${src.reason}`); return { blocked: src.reason }; }
  log(`      source: ${src.kind} ${src.stakeAccount.toBase58()}${src.vote ? ` (validator ${src.vote.toBase58()})` : ''}`);
  if (expectKind && src.kind !== expectKind) throw new Error(`expected the exit to come from ${expectKind}, the program requires ${src.kind}`);
  if (expectVote && !(src.vote && src.vote.equals(new PublicKey(expectVote)))) throw new Error(`expected the exit to come from validator ${expectVote}`);
  const seed = `ocean-exit-${Date.now().toString(36)}`;
  const exitStake = await PublicKey.createWithSeed(parent.publicKey, seed, StakeProgram.programId);
  const ixs = [
    SystemProgram.createAccountWithSeed({ fromPubkey: parent.publicKey, basePubkey: parent.publicKey, seed, newAccountPubkey: exitStake, lamports: Number(s.stakeRent), space: 200, programId: StakeProgram.programId }),
    withdrawStake({ programId: a.programId, stakePool: a.pool, validatorList: a.validatorList, withdrawAuthority: a.withdrawAuthority, stakeToSplit: src.stakeAccount, stakeToReceive: exitStake, userStakeAuthority: parent.publicKey, userTransferAuthority: parent.publicKey, userPoolTokenAccount: ata, managerFeeAccount: a.managerFeeAccount, poolMint: a.mint, tokenProgramId: s.pool.tokenProgramId, poolTokens: tokens, minimumLamportsOut: tol(q.lamports) }),
  ];
  if (src.delegated) ixs.push(StakeProgram.deactivate({ stakePubkey: exitStake, authorizedPubkey: parent.publicKey }).instructions[0]);
  const sig = await sendTx(ctx, { label: `${label}: WithdrawStakeWithSlippage to ${exitStake.toBase58()}${src.delegated ? ' + Deactivate (same transaction)' : ' (undelegated, nothing to deactivate)'}`, instructions: ixs, signers: [parent] });
  const st = await fetchStakeAccount(conn, exitStake);
  const timing = await epochTiming(ctx);
  log(`      stake account ${exitStake.toBase58()}: ${st.type}, ${lamportsToSol(st.lamports)} SOL${st.voter ? `, delegated to ${st.voter.toBase58()}, activation epoch ${st.activationEpoch}, deactivation epoch ${st.deactivationEpoch === U64_MAX ? 'none' : st.deactivationEpoch}` : ''}; withdrawer ${st.withdrawer.toBase58()}`);
  if (!st.withdrawer.equals(parent.publicKey) || !st.staker.equals(parent.publicKey)) throw new Error('exit stake account is not owned by the parent');
  const sim = await simulateOk(ctx, [withdrawAllIx(exitStake, parent.publicKey, st.lamports)], parent.publicKey);
  let ready;
  if (sim.ok) {
    ready = { now: true, why: st.type !== 'delegated' ? 'undelegated stake split from the reserve' : (st.activationEpoch === st.deactivationEpoch ? 'activated and deactivated in the same epoch, so it never became effective' : 'cooldown finished') };
  } else {
    const readyEpoch = st.deactivationEpoch + 1n;
    ready = { now: false, readyFromEpoch: readyEpoch, eta: timing.nextEpochAt, why: `cooling down: withdrawable once epoch ${readyEpoch} starts (~${timing.nextEpochAt}, about ${Math.round(timing.secondsLeft / 3600)} h) if the cluster-wide cooldown allows (normally yes)` };
  }
  log(`      READY: ${ready.now ? 'now' : 'not yet'} (${ready.why})`);
  return { sig, exitStake, seed, src, st, ready };
}

async function finish(keepSolLamports = 0n) {
  if (!args.keep) {
    if ((await tokenBalance()) === 0n && (await conn.getAccountInfo(ata))) {
      evidence.signatures.closeTokenAccount = await sendTx(ctx, { label: 'close the parent\'s empty OCEAN account (rent back to the parent)', instructions: [createCloseAccountInstruction(ata, parent.publicKey, parent.publicKey, [], TOKEN_PROGRAM_ID)], signers: [parent] });
    }
    await sleep(1000);
    const bal = await solBalance();
    const give = bal - 5_000n - keepSolLamports;
    if (give > 10_000n) evidence.signatures.refund = await sendTx(ctx, { label: `refund ${lamportsToSol(give)} SOL to the payer`, instructions: [SystemProgram.transfer({ fromPubkey: parent.publicKey, toPubkey: payer.publicKey, lamports: Number(give) })], signers: [parent] });
    const pendingStake = (await parentStakeAccounts()).length;
    if (pendingStake) log(`parent still owns ${pendingStake} stake account(s); claim later with: node smoke.mjs --claim --parent ${parentFile}`);
  }
  log('\nevidence:');
  for (const [k, v] of Object.entries(evidence.signatures)) if (v) log(`  ${k.padEnd(28)} ${explorerTx(ctx, v)}`);
  log(toJson({ numbers: evidence.numbers, exitStake: evidence.exitStake }));
}

// ======================= --claim =======================
if (args.claim) {
  if (!args.parent) throw new Error('--claim needs --parent <keyfile>');
  const sigs = await claimReady();
  log(sigs.length ? `claimed ${sigs.length} stake account(s)` : 'nothing ready to claim');
  process.exit(0);
}

const ataRent = BigInt(await conn.getMinimumBalanceForRentExemption(165));

// ======================= --primary-exit-check =======================
if (args['primary-exit-check']) {
  const staker = loadKeypair(ctx, 'staker');
  if (!savedCheck) {
    // ---- phase 1: one deposit, staked into the primary ----
    evidence.signatures.fundParent = await fundParent(depositLamports + ataRent + s.stakeRent + 50_000_000n);
    ({ state: s } = await runUpdate(ctx, payer));
    const d = await deposit('primary-check 1');
    evidence.signatures.deposit = d.sig;
    s = await loadState(ctx);
    // buffer = whatever the reserve held before this deposit, so exactly this one deposit (+ the transient's rent) is excess
    const reserveAvail = s.reserveLamports - s.reserveRent;
    const bufferLamports = reserveAvail > depositLamports + s.stakeRent ? reserveAvail - depositLamports - s.stakeRent : 0n;
    const r = await runRebalance(ctx, staker, payer, { bufferLamports, depositLamports });
    if (!r.sig) throw new Error(`the crank did not stake the deposit: ${r.plan.reason}`);
    evidence.signatures.stakeIntoPrimary = r.sig;
    const timing = await epochTiming(ctx);
    const saved = { parentFile, parent: parent.publicKey.toBase58(), stakedEpoch: timing.epoch, primary: r.plan.validator.voteAccount.toBase58(), lamportsStaked: r.plan.lamports.toString(), stakeSig: r.sig, depositSig: d.sig };
    writeFileSync(checkFile, JSON.stringify(saved, null, 2), { mode: 0o600 });
    log(`\nphase 1 done: ${lamportsToSol(r.plan.lamports)} SOL staked into primary ${saved.primary} in epoch ${timing.epoch}.`);
    log(`It merges into the primary's active stake at the next epoch's update. Run phase 2 after epoch ${timing.epoch + 1} starts (~${timing.nextEpochAt}):`);
    log('  node smoke.mjs --primary-exit-check');
    await finish(20_000_000n); // keep 0.02 SOL in the parent for phase 2 fees and the exit account's rent
    process.exit(0);
  }
  // ---- phase 2: the slow exit must come from the primary's active stake ----
  const timing = await epochTiming(ctx);
  if (timing.epoch <= savedCheck.stakedEpoch) {
    log(`too early: the stake went in during epoch ${savedCheck.stakedEpoch} and merges at the next epoch's update; run phase 2 after ~${timing.nextEpochAt}`);
    process.exit(4);
  }
  ({ state: s } = await runUpdate(ctx, payer));
  const P = s.list.validators.find((v) => v.voteAccount.toBase58() === savedCheck.primary);
  log(`primary ${savedCheck.primary}: active ${lamportsToSol(P.activeStakeLamports)} SOL, headroom ${lamportsToSol(headroomOf(s, P))} SOL, transient ${lamportsToSol(P.transientStakeLamports)} SOL`);
  const ex = await stakeExit('primary-check 2', { expectKind: 'active', expectVote: savedCheck.primary });
  if (ex.blocked) throw new Error(`slow exit blocked: ${ex.blocked}`);
  evidence.signatures.withdrawStakeAndDeactivate = ex.sig;
  evidence.exitStake = { address: ex.exitStake, seed: ex.seed, source: ex.src.kind, lamports: ex.st.lamports, ready: ex.ready };
  writeFileSync(checkFile, JSON.stringify({ ...savedCheck, phase2: { epoch: timing.epoch, sig: ex.sig, exitStake: ex.exitStake.toBase58(), ready: ex.ready } }, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2), { mode: 0o600 });
  log(`\nprimary-exit check PASSED: the 1.01 slow exit came from the primary's active stake and was deactivated.`);
  await finish(5_000_000n);
  process.exit(0);
}

// ======================= default flow =======================
evidence.signatures.fundParent = await fundParent(depositLamports + depositLamports / 100n + ataRent + s.stakeRent + 50_000n);
// the app should do this too when the crank is late: the update is permissionless
({ state: s } = await runUpdate(ctx, payer));
const before = { totalLamports: s.pool.totalLamports, supply: s.pool.poolTokenSupply, solPerToken: solPerToken(s.pool) };
log(`\nBEFORE: total ${lamportsToSol(before.totalLamports)} SOL, supply ${lamportsToSol(before.supply)} OCEAN, SOL/token ${before.solPerToken.toFixed(9)}`);

// 1. deposit
const d1 = await deposit('1');
evidence.signatures.deposit1 = d1.sig;
evidence.numbers.deposit1Tokens = d1.tokens;

// 2. instant exit
{
  s = await loadState(ctx);
  const tokens = await tokenBalance();
  const q = quoteWithdrawSol(s.pool, tokens);
  const sol0 = await solBalance();
  const sig = await sendTx(ctx, {
    label: `2: WithdrawSolWithSlippage ${lamportsToSol(tokens)} OCEAN (instant exit, fee ${lamportsToSol(q.feeTokens)} OCEAN)`,
    instructions: [withdrawSol({ programId: a.programId, stakePool: a.pool, withdrawAuthority: a.withdrawAuthority, userTransferAuthority: parent.publicKey, poolTokensFrom: ata, reserveStake: a.reserve, lamportsTo: parent.publicKey, managerFeeAccount: a.managerFeeAccount, poolMint: a.mint, tokenProgramId: s.pool.tokenProgramId, poolTokens: tokens, minimumLamportsOut: tol(q.lamports) })],
    signers: [parent],
  });
  let tx = null;
  for (let i = 0; i < 10 && !tx; i++) { tx = await conn.getTransaction(sig, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }); if (!tx) await sleep(1500); }
  const received = (await solBalance()) - sol0 + BigInt(tx.meta.fee);
  const value = (tokens * s.pool.totalLamports) / s.pool.poolTokenSupply;
  const feePct = Number((value - received) * 1_000_000n / value) / 10_000;
  log(`      got ${lamportsToSol(received)} SOL back for ${lamportsToSol(tokens)} OCEAN worth ${lamportsToSol(value)} SOL: fee ${feePct}% (tx fee ${tx.meta.fee} lamports excluded)`);
  if (received !== q.lamports) throw new Error(`withdraw paid ${received}, quote said ${q.lamports}`);
  evidence.signatures.instantWithdraw = sig;
  evidence.numbers.instantWithdraw = { tokens, receivedLamports: received, feeTokens: q.feeTokens, feePct };
}

// 3. deposit again
const d2 = await deposit('3');
evidence.signatures.deposit2 = d2.sig;

// optional: the staker stakes the reserve excess (whole deposits) before the stake exit
if (args['rebalance-before-stake-exit']) {
  const staker = loadKeypair(ctx, 'staker');
  const r = await runRebalance(ctx, staker, payer, { bufferLamports: solToLamports(String(args['buffer-sol'] ?? '0')), depositLamports });
  if (r.sig) evidence.signatures.crankIncreaseStake = r.sig;
}

// 4. free exit: withdraw stake + deactivate
{
  const ex = await stakeExit('4');
  if (ex.blocked) { evidence.stakeExitBlocked = ex.blocked; log(toJson(evidence)); process.exit(3); }
  evidence.signatures.withdrawStakeAndDeactivate = ex.sig;
  evidence.exitStake = { address: ex.exitStake, seed: ex.seed, source: ex.src.kind, lamports: ex.st.lamports, ready: ex.ready };
  if (ex.ready.now && !args['no-claim']) {
    const c = await claimReady('5');
    if (c.length) evidence.signatures.claim = c[0];
  }
}

// optional: prove the 100% epoch fee without waiting for an epoch boundary.
// UpdateStakePoolBalance charges the epoch fee on ANY growth of the pool's lamports
// (processor.rs L2217-L2260), not only on staking rewards. Sending SOL straight into the reserve
// therefore stands in for rewards: at a 100% fee the manager must receive tokens worth exactly
// that amount and SOL/token must not move.
if (args['fee-test']) {
  const donation = solToLamports(String(args['fee-test']));
  s = await loadState(ctx);
  const feeAcc0 = (await getAccount(conn, a.managerFeeAccount, 'confirmed')).amount;
  const spt0 = solPerToken(s.pool);
  evidence.signatures.feeTestDonation = await sendTx(ctx, { label: `fee test: send ${lamportsToSol(donation)} SOL straight into the reserve (stands in for staking rewards)`, instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: a.reserve, lamports: Number(donation) })], signers: [payer] });
  const u = await runUpdate(ctx, payer);
  evidence.signatures.feeTestUpdate = u.sigs[u.sigs.length - 1];
  s = u.state;
  const feeAcc1 = (await getAccount(conn, a.managerFeeAccount, 'confirmed')).amount;
  const minted = feeAcc1 - feeAcc0;
  const mintedValue = (minted * s.pool.totalLamports) / s.pool.poolTokenSupply;
  log(`      fee test: manager fee account +${lamportsToSol(minted)} OCEAN worth ${lamportsToSol(mintedValue)} SOL for ${lamportsToSol(donation)} SOL of "rewards"; SOL/token ${spt0.toFixed(9)} -> ${solPerToken(s.pool).toFixed(9)}`);
  evidence.numbers.feeTest = { donation, minted, mintedValue, solPerTokenBefore: spt0, solPerTokenAfter: solPerToken(s.pool) };
  if (minted <= 0n) throw new Error('fee test: no fee tokens minted');
}

s = await loadState(ctx);
const after = { totalLamports: s.pool.totalLamports, supply: s.pool.poolTokenSupply, solPerToken: solPerToken(s.pool) };
log(`\nAFTER:  total ${lamportsToSol(after.totalLamports)} SOL, supply ${lamportsToSol(after.supply)} OCEAN, SOL/token ${after.solPerToken.toFixed(9)}`);
evidence.numbers.before = before; evidence.numbers.after = after;
await finish();
