#!/usr/bin/env node
// Read-only snapshot of the pool. No keys needed.
//   node status.mjs [--cluster devnet] [--json]
import { getMint, getAccount } from '@solana/spl-token';
import { parseArgs, loadContext, assertCluster, lamportsToSol, feeToString, explorerAddr, toJson } from './lib/env.mjs';
import { loadState, epochTiming, solPerToken, maxStakeWithdrawal, loadTransientStates, readCommissions, validatorAccounts, isStale, calcLamportsWithdrawAmount } from './lib/pool-ops.mjs';
import { fetchMetadata, fetchStakeAccount, U64_MAX } from './lib/state.mjs';

const args = parseArgs();
const ctx = loadContext(args);
await assertCluster(ctx);
const s = await loadState(ctx);
const p = s.pool;
const a = s.addresses;
const [timing, mint, feeAcc, meta, transients, comm] = await Promise.all([
  epochTiming(ctx),
  getMint(ctx.connection, a.mint, 'confirmed'),
  getAccount(ctx.connection, p.managerFeeAccount, 'confirmed').catch(() => null),
  fetchMetadata(ctx.connection, a.mint),
  loadTransientStates(ctx, s),
  readCommissions(ctx, s.list.validators.map((v) => v.voteAccount)),
]);
const stakeAccts = await Promise.all(s.list.validators.map((v) => fetchStakeAccount(ctx.connection, validatorAccounts(a.programId, a.pool, v).validatorStake)));

const pending = (f) => (f ? ` -> ${feeToString(f.fee)} after ${f.boundariesLeft} more epoch boundar${f.boundariesLeft === 1 ? 'y' : 'ies'}` : '');
const reserveLiquid = s.reserveLamports > s.reserveRent ? s.reserveLamports - s.reserveRent : 0n;
const mx = maxStakeWithdrawal(s);
const stale = isStale(s);
const stakeState = (st) => {
  if (!st) return 'missing';
  if (st.type !== 'delegated') return st.type;
  if (st.deactivationEpoch !== U64_MAX) return `deactivating since ${st.deactivationEpoch}`;
  return st.activationEpoch >= s.epoch ? `activating (from epoch ${st.activationEpoch})` : `active since ${st.activationEpoch}`;
};

const out = {
  cluster: ctx.cluster,
  programId: a.programId.toBase58(),
  pool: a.pool.toBase58(),
  epoch: { ...timing },
  lastUpdateEpoch: p.lastUpdateEpoch,
  needsUpdate: stale.poolStale || stale.staleValidators.length > 0,
  totalLamports: p.totalLamports,
  poolTokenSupply: p.poolTokenSupply,
  mintSupply: mint.supply,
  solPerToken: solPerToken(p),
  reserve: { address: a.reserve.toBase58(), lamports: s.reserveLamports, rent: s.reserveRent, liquid: reserveLiquid },
  validators: s.list.validators.map((v, i) => ({
    index: v.index,
    vote: v.voteAccount.toBase58(),
    commission: comm.commissions.get(v.voteAccount.toBase58()) ?? null,
    delinquent: comm.delinquent.has(v.voteAccount.toBase58()),
    status: v.statusName,
    activeStakeLamports: v.activeStakeLamports,
    transientStakeLamports: v.transientStakeLamports,
    lastUpdateEpoch: v.lastUpdateEpoch,
    stakeAccount: validatorAccounts(a.programId, a.pool, v).validatorStake.toBase58(),
    stakeAccountState: stakeState(stakeAccts[i]),
    transient: transients.get(v.voteAccount.toBase58()) ?? null,
  })),
  maxValidators: s.list.maxValidators,
  fees: {
    epoch: p.epochFee, nextEpoch: p.nextEpochFee,
    solWithdrawal: p.solWithdrawalFee, nextSolWithdrawal: p.nextSolWithdrawalFee,
    stakeWithdrawal: p.stakeWithdrawalFee, nextStakeWithdrawal: p.nextStakeWithdrawalFee,
    solDeposit: p.solDepositFee, stakeDeposit: p.stakeDepositFee,
    solReferralPct: p.solReferralFee, stakeReferralPct: p.stakeReferralFee,
  },
  authorities: {
    manager: p.manager.toBase58(), staker: p.staker.toBase58(),
    stakeDepositAuthority: p.stakeDepositAuthority.toBase58(),
    stakeDepositRestricted: p.stakeDepositAuthority.equals(p.manager),
    solDepositAuthority: p.solDepositAuthority?.toBase58() ?? null,
    solWithdrawAuthority: p.solWithdrawAuthority?.toBase58() ?? null,
    preferredDepositValidator: p.preferredDepositValidator?.toBase58() ?? null,
    preferredWithdrawValidator: p.preferredWithdrawValidator?.toBase58() ?? null,
  },
  managerFeeAccount: { address: p.managerFeeAccount.toBase58(), tokens: feeAcc?.amount ?? null, solValue: feeAcc ? calcLamportsWithdrawAmount(p, feeAcc.amount) : null },
  metadata: meta ? { address: meta.address.toBase58(), name: meta.name, symbol: meta.symbol, uri: meta.uri, updateAuthority: meta.updateAuthority.toBase58() } : null,
  limits: { minDelegation: s.minDelegation, stakeRent: s.stakeRent, perValidatorMinimum: s.requiredValidatorLamports, largestInstantExit: reserveLiquid, largestStakeWithdrawal: mx },
  lastEpoch: { poolTokenSupply: p.lastEpochPoolTokenSupply, totalLamports: p.lastEpochTotalLamports },
};

if (args.json) { console.log(toJson(out)); process.exit(0); }

const L = (k, v) => console.log(`${k.padEnd(22)}${v}`);
const sym = meta?.symbol || 'pool tokens';
console.log(`${meta?.name ?? 'stake pool'} (${ctx.cluster})`);
L('program', out.programId);
L('pool', `${out.pool}  ${explorerAddr(ctx, out.pool)}`);
L('mint', `${a.mint.toBase58()}  (${meta ? `${meta.symbol}, metadata ${meta.address.toBase58()}` : 'no metadata'})`);
L('epoch', `${timing.epoch}  ${timing.progressPct}% done, ~${timing.slotMs} ms slots, epoch ≈ ${timing.epochHours} h, next boundary ≈ ${timing.nextEpochAt}`);
L('last update', `epoch ${p.lastUpdateEpoch}${out.needsUpdate ? '  (STALE: run crank.mjs; deposits/withdrawals fail with 0x11 until updated)' : '  (current)'}`);
L('total lamports', `${lamportsToSol(p.totalLamports)} SOL`);
L('token supply', `${lamportsToSol(p.poolTokenSupply)} ${sym} (mint says ${lamportsToSol(mint.supply)})`);
L('SOL per token', out.solPerToken.toFixed(9));
L('reserve', `${lamportsToSol(reserveLiquid)} SOL liquid + ${lamportsToSol(s.reserveRent)} rent  (largest instant exit ${lamportsToSol(reserveLiquid)} SOL)`);
L('validators', `${s.list.validators.length}/${s.list.maxValidators}  (each must keep ≥ ${lamportsToSol(s.requiredValidatorLamports)} SOL)`);
for (const v of out.validators) {
  console.log(`  #${v.index} ${v.vote}  commission ${v.commission ?? '?'}%${v.delinquent ? ' DELINQUENT' : ''}  ${v.status}`);
  console.log(`      active ${lamportsToSol(v.activeStakeLamports)} SOL, transient ${lamportsToSol(v.transientStakeLamports)} SOL${v.transient ? ` (${v.transient.deactivating ? 'deactivating' : `activating from ${v.transient.activationEpoch}`})` : ''}, updated epoch ${v.lastUpdateEpoch}`);
  console.log(`      stake account ${v.stakeAccount}: ${v.stakeAccountState}`);
}
L('fee on rewards', `${feeToString(p.epochFee)}${pending(p.nextEpochFee)}`);
L('SOL withdrawal fee', `${feeToString(p.solWithdrawalFee)}${pending(p.nextSolWithdrawalFee)}`);
L('stake withdrawal fee', `${feeToString(p.stakeWithdrawalFee)}${pending(p.nextStakeWithdrawalFee)}`);
L('deposit fees', `SOL ${feeToString(p.solDepositFee)}, stake ${feeToString(p.stakeDepositFee)}; referral SOL ${p.solReferralFee}% stake ${p.stakeReferralFee}%`);
L('manager', p.manager.toBase58());
L('staker', p.staker.toBase58());
L('stake deposits', out.authorities.stakeDepositRestricted ? `manager only (${p.stakeDepositAuthority.toBase58()}): leech trick blocked` : `OPEN via ${p.stakeDepositAuthority.toBase58()}`);
L('SOL deposits', p.solDepositAuthority ? `restricted to ${p.solDepositAuthority.toBase58()}` : 'anyone');
L('SOL withdrawals', p.solWithdrawAuthority ? `restricted to ${p.solWithdrawAuthority.toBase58()}` : 'anyone');
L('manager fee account', `${p.managerFeeAccount.toBase58()}  ${feeAcc ? `${lamportsToSol(feeAcc.amount)} ${sym} ≈ ${lamportsToSol(out.managerFeeAccount.solValue)} SOL` : 'missing'}`);
L('largest stake exit', `${lamportsToSol(mx.lamports)} SOL from ${mx.from}${mx.lamports === 0n ? '  (stake exits blocked right now; instant exit still works)' : ''}`);
if (meta) L('metadata uri', meta.uri);
