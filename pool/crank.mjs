#!/usr/bin/env node
// Idempotent per-epoch job. Safe to run as often as you like (GitHub runs it every 6 h).
//  1. Update: UpdateValidatorListBalance + UpdateStakePoolBalance + cleanup, only if something
//     is stale; retries while the start-of-epoch reward payout is in progress (0x2b).
//     This is where the 100% epoch fee is minted to the manager fee account.
//  2. Rebalance (staker), built around the 1 SOL minimum (see lib/pool-ops.mjs planRebalance):
//     - keep a reserve buffer liquid for instant exits;
//     - stake the excess into ONE primary validator, in whole deposits (k x 1.01 SOL), so its
//       headroom above the minimum is always a whole number of deposit-sized stake exits;
//       other validators stay at their minimum;
//     - if the reserve falls well below the buffer, unstake so a validator lands exactly at its
//       minimum or keeps ≥ one deposit above it (never in the band that blocks stake exits).
//
//   node crank.mjs                       # devnet, keys from pool/keys/devnet
//   node crank.mjs --dry-run             # show what it would do
//   node crank.mjs --buffer-sol 2 --buffer-pct 5 --deposit-sol 1.01 --primary <vote> --no-rebalance --force-update
//
// Env (CI): POOL_CLUSTER, POOL_RPC_URL, POOL_CONFIG, POOL_STAKER_KEYPAIR (JSON array),
// POOL_CRANK_PAYER_KEYPAIR (optional; otherwise the staker pays fees), RESERVE_BUFFER_SOL,
// RESERVE_BUFFER_PCT, POOL_DEPOSIT_SOL, POOL_PRIMARY_VALIDATOR, POOL_ALLOW_MAINNET=yes (mainnet
// only), POOL_PRIORITY_MICROLAMPORTS.
// Exit codes: 0 ok, 75 reward payout still running after --max-wait-min (retry later), 1 error.
import { parseArgs, loadContext, loadKeypair, assertSendAllowed, assertCluster, lamportsToSol, solToLamports, env } from './lib/env.mjs';
import { runUpdate, runRebalance, RewardsInProgressError } from './lib/crank-core.mjs';
import { loadState, epochTiming, solPerToken, maxStakeWithdrawal } from './lib/pool-ops.mjs';

const args = parseArgs();
const ctx = loadContext(args);
const dryRun = !!args['dry-run'];
const t0 = Date.now();

try {
  if (dryRun) await assertCluster(ctx); else await assertSendAllowed(ctx);
  const staker = loadKeypair(ctx, 'staker', { optional: true });
  const payer = loadKeypair(ctx, 'crank-payer', { optional: true }) ?? staker ?? loadKeypair(ctx, 'payer', { optional: dryRun });
  const timing = await epochTiming(ctx);
  console.log(`crank ${new Date().toISOString()} cluster ${ctx.cluster} pool ${ctx.config.pool}`);
  console.log(`epoch ${timing.epoch} ${timing.progressPct}% (${timing.slotIndex}/${timing.slotsInEpoch} slots, ~${timing.slotMs} ms/slot, next epoch ~${timing.nextEpochAt})`);
  console.log(`fee payer ${payer ? payer.publicKey.toBase58() : 'none (dry run)'}${staker ? `, staker ${staker.publicKey.toBase58()}` : ', no staker key (update only)'}`);

  // 1. update
  let state;
  if (dryRun) {
    state = await loadState(ctx);
    const stale = state.pool.lastUpdateEpoch < state.epoch || state.list.validators.some((v) => v.lastUpdateEpoch < state.epoch);
    console.log(`update [dry-run]: ${stale ? 'would run the per-epoch update' : 'pool already current'}`);
  } else {
    ({ state } = await runUpdate(ctx, payer, { force: !!args['force-update'], maxWaitMin: Number(args['max-wait-min'] ?? 20) }));
  }

  // 2. rebalance
  if (args['no-rebalance']) console.log('rebalance: skipped (--no-rebalance)');
  else if (!staker) console.log('rebalance: skipped (no staker key; set POOL_STAKER_KEYPAIR)');
  else if (dryRun && state.pool.lastUpdateEpoch < state.epoch) console.log('rebalance [dry-run]: pool must be updated first');
  else {
    const crankCfg = ctx.config.crank ?? {};
    const bufferSol = String(args['buffer-sol'] ?? env('RESERVE_BUFFER_SOL') ?? crankCfg.reserveBufferSol ?? '1.05');
    const bufferPct = Number(args['buffer-pct'] ?? env('RESERVE_BUFFER_PCT') ?? crankCfg.reserveBufferPct ?? 0);
    const abs = solToLamports(bufferSol);
    const pct = (state.pool.totalLamports * BigInt(Math.round(bufferPct * 100))) / 10_000n;
    const bufferLamports = abs > pct ? abs : pct;
    const depositLamports = solToLamports(String(args['deposit-sol'] ?? env('POOL_DEPOSIT_SOL') ?? crankCfg.depositSol ?? '1.01'));
    const primary = args.primary ?? args.target ?? env('POOL_PRIMARY_VALIDATOR') ?? crankCfg.primaryValidator;
    const minChunk = args['min-chunk-sol'] ? solToLamports(String(args['min-chunk-sol'])) : undefined;
    await runRebalance(ctx, staker, payer, { bufferLamports, depositLamports, minChunk, primary: primary ? String(primary) : undefined, dryRun });
  }

  // summary
  const s = await loadState(ctx);
  const mx = maxStakeWithdrawal(s);
  console.log(`summary: total ${lamportsToSol(s.pool.totalLamports)} SOL, supply ${lamportsToSol(s.pool.poolTokenSupply)} OCEAN, SOL/token ${solPerToken(s.pool).toFixed(9)}, reserve ${lamportsToSol(s.reserveLamports - s.reserveRent)} SOL liquid, largest stake withdrawal now ${lamportsToSol(mx.lamports)} SOL (${mx.from}); ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  if (e instanceof RewardsInProgressError) { console.error(e.message); process.exit(75); }
  console.error(`crank failed: ${e.stack || e.message}`);
  process.exit(1);
}
