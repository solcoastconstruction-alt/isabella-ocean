// Crank building blocks shared by crank.mjs and smoke.mjs.
import { getAccount } from '@solana/spl-token';
import { lamportsToSol, sleep } from './env.mjs';
import { sendTx, ERR_EPOCH_REWARDS_IN_PROGRESS } from './tx.mjs';
import {
  loadState, isStale, buildUpdateInstructions, loadTransientStates, planRebalance,
  buildRebalanceInstruction, readCommissions, expectedTotalLamports, solPerToken, bandValidators, headroomOf,
} from './pool-ops.mjs';

const isRewardsInProgress = (e) => e?.customCode === ERR_EPOCH_REWARDS_IN_PROGRESS
  || (e?.logs || []).some((l) => /Epoch reward distribution is currently in progress/i.test(l));

export class RewardsInProgressError extends Error {}

async function feeBalance(ctx, state) {
  try { return (await getAccount(ctx.connection, state.addresses.managerFeeAccount, 'confirmed')).amount; } catch { return null; }
}

// Per-epoch update: UpdateValidatorListBalance (≤4 validators per instruction), then
// UpdateStakePoolBalance + CleanupRemovedValidatorEntries. Permissionless: `payer` only pays
// the fee. Skips when nothing is stale. Retries while the epoch's rewards are being paid out.
export async function runUpdate(ctx, payer, { force = false, maxWaitMin = 20, log = console.log } = {}) {
  let state = await loadState(ctx);
  const st = isStale(state);
  if (!force && !st.poolStale && !st.staleValidators.length && !st.totalsDrift) {
    log(`update: pool already current for epoch ${state.epoch} (nothing to do)`);
    return { state, before: state, skipped: true, sigs: [] };
  }
  log(`update: pool last updated in epoch ${state.pool.lastUpdateEpoch}, now ${state.epoch}; ${st.staleValidators.length} stale validator entr${st.staleValidators.length === 1 ? 'y' : 'ies'}${st.totalsDrift ? `; reserve+validators total ${expectedTotalLamports(state)} ≠ recorded ${state.pool.totalLamports}` : ''}`);
  const before = state;
  const feeBefore = await feeBalance(ctx, state);
  const sigs = [];
  const deadline = Date.now() + maxWaitMin * 60_000;
  let delay = 15_000;
  for (;;) {
    try {
      const u = buildUpdateInstructions(state, { onlyStale: !force });
      for (const i of u.listIxs) {
        sigs.push(await sendTx(ctx, { label: `UpdateValidatorListBalance (start ${i.data.readUInt32LE(1)})`, instructions: [i], signers: [payer], computeUnits: 600_000 }));
      }
      sigs.push(await sendTx(ctx, { label: 'UpdateStakePoolBalance + CleanupRemovedValidatorEntries', instructions: u.finalIxs, signers: [payer], computeUnits: 300_000 }));
      break;
    } catch (e) {
      if (!isRewardsInProgress(e)) throw e;
      if (Date.now() > deadline) throw new RewardsInProgressError(`epoch ${state.epoch} rewards are still being distributed after ${maxWaitMin} min; retry later`);
      log(`update: epoch rewards are being distributed (StakePoolError 0x2b); retrying in ${Math.round(delay / 1000)}s`);
      await sleep(delay);
      delay = Math.min(Math.round(delay * 1.5), 120_000);
      state = await loadState(ctx);
    }
  }
  state = await loadState(ctx);
  const feeAfter = await feeBalance(ctx, state);
  const minted = feeBefore !== null && feeAfter !== null ? feeAfter - feeBefore : null;
  const rewards = state.pool.totalLamports - before.pool.totalLamports;
  log(`update: total ${lamportsToSol(before.pool.totalLamports)} -> ${lamportsToSol(state.pool.totalLamports)} SOL (${rewards >= 0n ? '+' : ''}${lamportsToSol(rewards)}), supply ${lamportsToSol(before.pool.poolTokenSupply)} -> ${lamportsToSol(state.pool.poolTokenSupply)} OCEAN, SOL/token ${solPerToken(before.pool).toFixed(9)} -> ${solPerToken(state.pool).toFixed(9)}`);
  if (minted !== null) log(`update: manager fee account ${minted > 0n ? 'received' : 'received no'} fee tokens${minted > 0n ? ` (+${lamportsToSol(minted)} OCEAN)` : ''}`);
  return { state, before, skipped: false, sigs, feeMinted: minted, rewardLamports: rewards };
}

// Rebalance toward the reserve buffer (needs the staker's signature).
export async function runRebalance(ctx, staker, payer, { bufferLamports, depositLamports, minChunk, primary, dryRun = false, log = console.log } = {}) {
  const state = await loadState(ctx);
  if (isStale(state).poolStale) throw new Error(`pool not updated for epoch ${state.epoch}; run the update first`);
  if (!state.pool.staker.equals(staker.publicKey)) throw new Error(`staker key ${staker.publicKey.toBase58()} is not the pool staker ${state.pool.staker.toBase58()}`);
  const transients = await loadTransientStates(ctx, state);
  const { commissions, delinquent } = await readCommissions(ctx, state.list.validators.map((v) => v.voteAccount));
  for (const v of state.list.validators) if (delinquent.has(v.voteAccount.toBase58())) log(`WARNING: validator ${v.voteAccount.toBase58()} is delinquent (consider removing it)`);
  const plan = planRebalance(state, transients, { bufferLamports, depositLamports, minChunk, commissions, primary });
  for (const v of bandValidators(state, plan.depositLamports)) log(`WARNING: validator ${v.voteAccount.toBase58()} holds ${lamportsToSol(headroomOf(state, v))} SOL above its minimum, less than one deposit: deposit-sized stake exits are blocked until it is topped up to a whole deposit or brought back to its minimum`);
  log(`rebalance: reserve ${lamportsToSol(plan.reserveAvail)} SOL available (+${lamportsToSol(plan.inbound)} returning), buffer ${lamportsToSol(plan.bufferLamports)} SOL, deposit ${lamportsToSol(plan.depositLamports)} SOL, primary ${plan.primary?.toBase58() ?? 'none'}`);
  if (plan.action === 'none') { log(`rebalance: nothing to do (${plan.reason})`); return { plan, state }; }
  const verb = plan.action.startsWith('increase') ? 'stake' : 'unstake';
  const label = `${plan.action === 'increase' ? 'IncreaseValidatorStake' : plan.action === 'increaseAdditional' ? 'IncreaseAdditionalValidatorStake' : plan.action === 'decrease' ? 'DecreaseValidatorStakeWithReserve' : 'DecreaseAdditionalValidatorStake'}: ${verb} ${lamportsToSol(plan.lamports)} SOL ${verb === 'stake' ? 'to' : 'from'} ${plan.validator.voteAccount.toBase58()} (transient seed ${plan.transientSeed})`;
  log(`rebalance: ${plan.reason}`);
  if (dryRun) { log(`rebalance [dry-run]: would send ${label}`); return { plan, state }; }
  const ix = buildRebalanceInstruction(state, plan, staker.publicKey);
  const sig = await sendTx(ctx, { label, instructions: [ix], signers: [payer, staker], computeUnits: 400_000 });
  return { plan, state: await loadState(ctx), sig };
}
