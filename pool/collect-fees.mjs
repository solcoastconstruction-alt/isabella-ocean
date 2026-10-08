#!/usr/bin/env node
// Turn the manager fee account's pool tokens into SOL with WithdrawSol. Burning from the
// manager fee account pays no withdrawal fee (processor.rs L3205-L3213).
//
// WHO SIGNS: the wallet that owns the fee token account, and nobody else. WithdrawSol never checks
// the manager (processor.rs process_withdraw_sol); it burns the tokens with a token-program Burn
// whose authority is the "user transfer authority" account, and the token program accepts only the
// token account's owner (or a delegate). So when the pool was created with --fee-owner, the fee owner
// (the revenue wallet) signs this, not the manager. The owner is read from the chain.
//
//   node collect-fees.mjs                  # all fee tokens -> SOL in the fee owner's wallet
//   node collect-fees.mjs --amount 0.25    # only this many OCEAN
//   node collect-fees.mjs --to <address>   # send the SOL to another system account
//   node collect-fees.mjs --print-only     # print the instruction (e.g. for a Squads proposal)
//   node collect-fees.mjs --plan-out plans/collect.json   # write a plan for the phone wallet that owns
//                                                         # the fee account (README "Phone manager")
//
// Note: the SOL comes out of the reserve, i.e. the instant-exit buffer. Reward fees accrue in
// validator stake accounts, so after collecting, the crank refills the reserve from stake
// (one epoch later). Collect when the reserve has room, or keep the buffer generous.
import { getAccount } from '@solana/spl-token';
import { parseArgs, loadContext, loadKeypair, assertSendAllowed, assertCluster, lamportsToSol, solToLamports, toJson, pk } from './lib/env.mjs';
import { withdrawSol } from './lib/ix.mjs';
import { sendTx } from './lib/tx.mjs';
import { ixToJson, buildPlan, writePlan } from './lib/plan.mjs';
import { runUpdate } from './lib/crank-core.mjs';
import { loadState, isStale, quoteWithdrawSol } from './lib/pool-ops.mjs';

const args = parseArgs();
const ctx = loadContext(args);
const planOut = args['plan-out'];
if (planOut === true) throw new Error('--plan-out needs a file name');
const printOnly = !!args['print-only'];
const external = printOnly || !!planOut; // someone else signs: nothing here needs the owner's key
if (printOnly && !planOut) await assertCluster(ctx); else await assertSendAllowed(ctx); // a plan is meant to be sent

let s = await loadState(ctx);
const feeOwner = (await getAccount(ctx.connection, s.pool.managerFeeAccount, 'confirmed')).owner; // the only signature WithdrawSol needs (see the top of this file)
const ownedByManager = feeOwner.equals(s.pool.manager);
let authority = null;
if (!external) {
  authority = [loadKeypair(ctx, 'fee-owner', { optional: true }), loadKeypair(ctx, 'manager', { optional: true })].find((k) => k && k.publicKey.equals(feeOwner)) ?? null;
  if (!authority) throw new Error(`no keypair here for ${feeOwner.toBase58()}, the wallet that owns the manager fee account${ownedByManager ? ' (the manager)' : ' (not the manager)'}. Use --plan-out for a phone wallet, or --print-only for Squads.`);
}
const payer = loadKeypair(ctx, 'payer', { optional: true }) ?? authority;

if (isStale(s).poolStale) {
  if (!external) ({ state: s } = await runUpdate(ctx, payer));
  else if (planOut && payer) ({ state: s } = await runUpdate(ctx, payer)); // permissionless; any funded key may send it
  else if (planOut) throw new Error('the pool is stale for this epoch: run `node crank.mjs --no-rebalance` first, then make the plan again');
  else console.log('note: pool is stale; prepend the update (node crank.mjs --no-rebalance) before executing');
}
const p = s.pool;
const feeAcc = await getAccount(ctx.connection, p.managerFeeAccount, 'confirmed'); // after the update: it mints the fee
let tokens = args.amount ? solToLamports(String(args.amount)) : feeAcc.amount;
if (tokens > feeAcc.amount) throw new Error(`fee account holds only ${lamportsToSol(feeAcc.amount)} OCEAN`);
if (tokens === 0n) { console.log('manager fee account is empty; nothing to collect'); process.exit(0); }

const liquid = s.reserveLamports - s.reserveRent;
let q = quoteWithdrawSol(p, tokens, { isManagerFeeAccount: true });
if (q.lamports > liquid) {
  const maxTokens = (liquid * p.poolTokenSupply) / p.totalLamports;
  console.log(`reserve has only ${lamportsToSol(liquid)} SOL liquid; collecting ${lamportsToSol(maxTokens)} of ${lamportsToSol(tokens)} OCEAN now (run again after the crank refills the reserve)`);
  tokens = maxTokens;
  q = quoteWithdrawSol(p, tokens, { isManagerFeeAccount: true });
  if (tokens === 0n) process.exit(0);
}
const to = args.to ? pk(args.to) : feeOwner;
const a = s.addresses;
const ix = withdrawSol({
  programId: a.programId, stakePool: a.pool, withdrawAuthority: a.withdrawAuthority, userTransferAuthority: feeOwner,
  poolTokensFrom: p.managerFeeAccount, reserveStake: a.reserve, lamportsTo: to, managerFeeAccount: p.managerFeeAccount,
  poolMint: a.mint, tokenProgramId: p.tokenProgramId, poolTokens: tokens, minimumLamportsOut: q.lamports,
});
console.log(`collect ${lamportsToSol(tokens)} OCEAN -> ${lamportsToSol(q.lamports)} SOL to ${to.toBase58()} (no fee: burning from the manager fee account)`);
console.log(`signed by ${feeOwner.toBase58()}, the wallet that owns the fee account${ownedByManager ? ' (the manager)' : ' (NOT the manager: the manager does not sign this)'}`);
if (p.solWithdrawAuthority) console.log(`WARNING: the pool has a SOL withdraw authority (${p.solWithdrawAuthority.toBase58()}); it would have to sign as well, and this instruction does not include it`);

if (external) {
  const label = `WithdrawSol: collect ${lamportsToSol(tokens)} OCEAN of fees as ${lamportsToSol(q.lamports)} SOL to ${to.toBase58()}`;
  const { label: _l, ...printed } = ixToJson(label, ix);
  console.log(toJson(printed));
  if (planOut) {
    const plan = buildPlan(ctx, { kind: 'collect-fees', signer: feeOwner, steps: [{ title: 'Collect the pool fees', instructions: [{ label, instruction: ix }] }], note: `pool ${a.pool.toBase58()}; fee account ${p.managerFeeAccount.toBase58()}` });
    const w = writePlan(planOut, plan);
    console.log(`\nPlan for the phone wallet that owns the fee account: ${w.file}\n  cluster ${ctx.cluster.toUpperCase()}   fingerprint ${w.fingerprint}   signer ${feeOwner.toBase58()}`);
    console.log(`  send it to the phone:  node phone-plan.mjs push ${planOut} --serial <adb serial>`);
  }
  process.exit(0);
}
const before = BigInt(await ctx.connection.getBalance(to, 'confirmed'));
await sendTx(ctx, { label: 'WithdrawSol from the manager fee account', instructions: [ix], signers: [payer, authority] });
const after = BigInt(await ctx.connection.getBalance(to, 'confirmed'));
console.log(`destination balance ${lamportsToSol(before)} -> ${lamportsToSol(after)} SOL`);
