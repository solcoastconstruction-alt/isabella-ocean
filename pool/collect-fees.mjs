#!/usr/bin/env node
// Turn the manager fee account's pool tokens into SOL with WithdrawSol. Burning from the
// manager fee account pays no withdrawal fee (processor.rs L3205-L3213).
//
//   node collect-fees.mjs                  # all fee tokens -> SOL in the manager's wallet
//   node collect-fees.mjs --amount 0.25    # only this many OCEAN
//   node collect-fees.mjs --to <address>   # send the SOL to another system account
//   node collect-fees.mjs --print-only     # print the instruction (e.g. for a Squads proposal)
//
// Note: the SOL comes out of the reserve, i.e. the instant-exit buffer. Reward fees accrue in
// validator stake accounts, so after collecting, the crank refills the reserve from stake
// (one epoch later). Collect when the reserve has room, or keep the buffer generous.
import { getAccount } from '@solana/spl-token';
import { parseArgs, loadContext, loadKeypair, assertSendAllowed, assertCluster, lamportsToSol, solToLamports, toJson, pk, base58 } from './lib/env.mjs';
import { withdrawSol } from './lib/ix.mjs';
import { sendTx } from './lib/tx.mjs';
import { runUpdate } from './lib/crank-core.mjs';
import { loadState, isStale, quoteWithdrawSol } from './lib/pool-ops.mjs';

const args = parseArgs();
const ctx = loadContext(args);
const printOnly = !!args['print-only'];
if (printOnly) await assertCluster(ctx); else await assertSendAllowed(ctx);

const manager = printOnly ? null : loadKeypair(ctx, 'manager', { optional: true });
if (!printOnly && !manager) throw new Error('manager keypair not available (mainnet: use --print-only and execute through Squads)');
const payer = loadKeypair(ctx, 'payer', { optional: true }) ?? manager;

let s = await loadState(ctx);
if (isStale(s).poolStale) {
  if (printOnly) console.log('note: pool is stale; prepend the update (node crank.mjs --no-rebalance) before executing');
  else ({ state: s } = await runUpdate(ctx, payer));
}
const p = s.pool;
const feeAcc = await getAccount(ctx.connection, p.managerFeeAccount, 'confirmed');
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
const to = args.to ? pk(args.to) : p.manager;
const a = s.addresses;
const ix = withdrawSol({
  programId: a.programId, stakePool: a.pool, withdrawAuthority: a.withdrawAuthority, userTransferAuthority: p.manager,
  poolTokensFrom: p.managerFeeAccount, reserveStake: a.reserve, lamportsTo: to, managerFeeAccount: p.managerFeeAccount,
  poolMint: a.mint, tokenProgramId: p.tokenProgramId, poolTokens: tokens, minimumLamportsOut: q.lamports,
});
console.log(`collect ${lamportsToSol(tokens)} OCEAN -> ${lamportsToSol(q.lamports)} SOL to ${to.toBase58()} (no fee: burning from the manager fee account)`);

if (printOnly) {
  console.log(toJson({ programId: ix.programId.toBase58(), accounts: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner, isWritable: k.isWritable })), dataBase58: base58(ix.data), dataHex: Buffer.from(ix.data).toString('hex') }));
  process.exit(0);
}
const before = BigInt(await ctx.connection.getBalance(to, 'confirmed'));
await sendTx(ctx, { label: 'WithdrawSol from the manager fee account', instructions: [ix], signers: [payer, manager] });
const after = BigInt(await ctx.connection.getBalance(to, 'confirmed'));
console.log(`destination balance ${lamportsToSol(before)} -> ${lamportsToSol(after)} SOL`);
