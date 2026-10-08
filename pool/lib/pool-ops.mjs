// Higher-level pool operations shared by the scripts: state loading, the per-epoch update,
// rebalancing, withdraw-source selection and readiness checks. All rules mirror
// program@v2.1.0 processor.rs; line references are to that file.
import { PublicKey, StakeProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { pk } from './env.mjs';
import {
  MAX_VALIDATORS_TO_UPDATE, MINIMUM_ACTIVE_STAKE, STAKE_ACCOUNT_SPACE, STAKE_POOL_PROGRAM_ID_DEVNET,
  findWithdrawAuthority, findValidatorStake, findTransientStake, findEphemeralStake,
  updateValidatorListBalance, updateStakePoolBalance, cleanupRemovedValidatorEntries,
  increaseValidatorStake, increaseAdditionalValidatorStake,
  decreaseValidatorStakeWithReserve, decreaseAdditionalValidatorStake,
} from './ix.mjs';
import { fetchPoolState, stakeMetaRent, U64_MAX } from './state.mjs';

// ---------- addresses ----------
export function poolAddresses(config) {
  const programId = pk(config.programId);
  const pool = pk(config.pool);
  return {
    programId,
    pool,
    withdrawAuthority: findWithdrawAuthority(programId, pool),
    validatorList: pk(config.validatorList),
    reserve: pk(config.reserve),
    mint: pk(config.mint),
    managerFeeAccount: pk(config.managerFeeAccount),
    tokenProgramId: config.tokenProgram ? pk(config.tokenProgram) : TOKEN_PROGRAM_ID,
  };
}

export function validatorAccounts(programId, poolAddr, v) {
  return {
    validatorStake: findValidatorStake(programId, v.voteAccount, poolAddr, v.validatorSeedSuffix),
    transientStake: findTransientStake(programId, v.voteAccount, poolAddr, v.transientSeedSuffix),
  };
}

// ---------- math (state.rs L158-L266) ----------
export function applyFee(f, amount) { // Fee::apply — rounds UP
  const n = BigInt(f.numerator), d = BigInt(f.denominator), a = BigInt(amount);
  if (d === 0n) return 0n;
  return (a * n + d - 1n) / d;
}
export function calcPoolTokensForDeposit(pool, lamports) {
  if (pool.totalLamports === 0n || pool.poolTokenSupply === 0n) return BigInt(lamports);
  return (BigInt(lamports) * pool.poolTokenSupply) / pool.totalLamports;
}
export function calcLamportsWithdrawAmount(pool, poolTokens) {
  const num = BigInt(poolTokens) * pool.totalLamports;
  const den = pool.poolTokenSupply;
  if (num < den || den === 0n) return 0n;
  return num / den;
}
export function lamportsPerPoolToken(pool) { // rounded up, per smallest token unit
  if (pool.poolTokenSupply === 0n) return 1n; // a pool that is initialized but not yet seeded: tokens are minted 1:1
  return (pool.totalLamports + pool.poolTokenSupply - 1n) / pool.poolTokenSupply;
}
export function solPerToken(pool) {
  if (pool.poolTokenSupply === 0n) return 1;
  return Number(pool.totalLamports * 1_000_000_000_000n / pool.poolTokenSupply) / 1e12;
}
// Expected SOL out for a SOL withdrawal (processor.rs L3202-L3220)
export function quoteWithdrawSol(pool, poolTokens, { isManagerFeeAccount = false } = {}) {
  const feeTokens = isManagerFeeAccount ? 0n : applyFee(pool.solWithdrawalFee, poolTokens);
  return { feeTokens, lamports: calcLamportsWithdrawAmount(pool, BigInt(poolTokens) - feeTokens) };
}
// Expected stake out for a stake withdrawal (processor.rs L2861-L2876)
export function quoteWithdrawStake(pool, poolTokens, { isManagerFeeAccount = false } = {}) {
  const feeTokens = isManagerFeeAccount ? 0n : applyFee(pool.stakeWithdrawalFee, poolTokens);
  return { feeTokens, lamports: calcLamportsWithdrawAmount(pool, BigInt(poolTokens) - feeTokens) };
}
export function quoteDepositSol(pool, lamports) {
  const minted = calcPoolTokensForDeposit(pool, lamports);
  const feeTokens = applyFee(pool.solDepositFee, minted);
  return { tokens: minted - feeTokens, feeTokens };
}

// ---------- full state ----------
export async function loadState(ctx) {
  const a = poolAddresses(ctx.config);
  const [st, epochInfo, stakeRent, minDelegationRpc] = await Promise.all([
    fetchPoolState(ctx.connection, a.programId, a.pool),
    ctx.connection.getEpochInfo('confirmed'),
    ctx.connection.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SPACE),
    ctx.connection.getStakeMinimumDelegation({ commitment: 'confirmed' }).then((r) => BigInt(r.value ?? r)),
  ]);
  if (!st) throw new Error(`stake pool ${a.pool.toBase58()} not found`);
  const minDelegation = minDelegationRpc > MINIMUM_ACTIVE_STAKE ? minDelegationRpc : MINIMUM_ACTIVE_STAKE; // lib.rs minimum_delegation()
  const rent = BigInt(stakeRent);
  // The minimums the PROGRAM uses: v2.1.0 (mainnet) reads the Rent sysvar; v2.0.x (devnet DPoo1)
  // reads each stake account's meta.rent_exempt_reserve, which stake v5 freezes at the legacy
  // 2,282,880. Using the program's own numbers keeps headroom maths exact and the reserve above
  // the floor below which v2.0.x UpdateStakePoolBalance fails (checked_sub -> CalculationFailure).
  const mode = rentMode(ctx.config, a.programId);
  const reserveMeta = stakeMetaRent(st.reserveAccount.data) ?? rent;
  const floor = mode === 'meta' ? reserveMeta : rent;
  return {
    ...st,
    addresses: a,
    epochInfo,
    epoch: BigInt(epochInfo.epoch),
    rentMode: mode,
    stakeRent: rent, // what new stake accounts (validator, transient, ephemeral) are funded with
    reserveRent: floor, // the reserve minimum the program enforces / subtracts
    minDelegation,
    requiredValidatorLamports: floor + minDelegation, // minimum_stake_lamports() as the program computes it
  };
}

// 'meta' for program versions that read meta.rent_exempt_reserve (v2.0.x, the devnet DPoo1… build),
// 'rent' for v2.1.0+ (mainnet SPoo1…). Override with "rentMode" in the cluster config.
export function rentMode(config, programId) {
  if (config?.rentMode === 'meta' || config?.rentMode === 'rent') return config.rentMode;
  return programId.equals(STAKE_POOL_PROGRAM_ID_DEVNET) ? 'meta' : 'rent';
}

// Total the program would compute in UpdateStakePoolBalance (L2223-L2236)
export function expectedTotalLamports(state) {
  let t = state.reserveLamports > state.reserveRent ? state.reserveLamports - state.reserveRent : 0n;
  for (const v of state.list.validators) t += v.activeStakeLamports + v.transientStakeLamports;
  return t;
}

export function isStale(state) {
  const staleValidators = state.list.validators.filter((v) => v.lastUpdateEpoch < state.epoch);
  return {
    poolStale: state.pool.lastUpdateEpoch < state.epoch,
    staleValidators,
    totalsDrift: expectedTotalLamports(state) !== state.pool.totalLamports,
  };
}

// The permissionless update (instruction.rs update_stake_pool L1651-L1700), grouped into
// transactions: one UpdateValidatorListBalance per ≤4 validators, then
// UpdateStakePoolBalance + CleanupRemovedValidatorEntries. Anyone may send these (no signer
// other than the fee payer) — the app can prepend them when the crank is late.
export function buildUpdateInstructions(state, { onlyStale = true, noMerge = false } = {}) {
  const a = state.addresses;
  const listIxs = [];
  const vs = state.list.validators;
  for (let start = 0; start < vs.length; start += MAX_VALIDATORS_TO_UPDATE) {
    const chunk = vs.slice(start, start + MAX_VALIDATORS_TO_UPDATE);
    if (onlyStale && chunk.every((v) => v.lastUpdateEpoch >= state.epoch)) continue;
    listIxs.push(updateValidatorListBalance({
      programId: a.programId, stakePool: a.pool, withdrawAuthority: a.withdrawAuthority,
      validatorList: a.validatorList, reserveStake: a.reserve, startIndex: start, noMerge,
      pairs: chunk.map((v) => { const x = validatorAccounts(a.programId, a.pool, v); return [x.validatorStake, x.transientStake]; }),
    }));
  }
  const finalIxs = [
    updateStakePoolBalance({
      programId: a.programId, stakePool: a.pool, withdrawAuthority: a.withdrawAuthority,
      validatorList: a.validatorList, reserveStake: a.reserve, managerFeeAccount: a.managerFeeAccount,
      poolMint: a.mint, tokenProgramId: state.pool.tokenProgramId,
    }),
    cleanupRemovedValidatorEntries({ programId: a.programId, stakePool: a.pool, validatorList: a.validatorList }),
  ];
  return { listIxs, finalIxs };
}

// ---------- transient stake states ----------
export async function loadTransientStates(ctx, state) {
  const a = state.addresses;
  const out = new Map();
  const withTransient = state.list.validators.filter((v) => v.transientStakeLamports > 0n);
  if (!withTransient.length) return out;
  const addrs = withTransient.map((v) => validatorAccounts(a.programId, a.pool, v).transientStake);
  const infos = await Promise.all(addrs.map((x) => ctx.connection.getParsedAccountInfo(x, 'confirmed')));
  withTransient.forEach((v, i) => {
    const d = infos[i].value?.data?.parsed;
    const dl = d?.info?.stake?.delegation;
    const deactivationEpoch = dl ? BigInt(dl.deactivationEpoch) : null;
    out.set(v.voteAccount.toBase58(), {
      address: addrs[i],
      type: d?.type ?? 'missing',
      lamports: BigInt(infos[i].value?.lamports ?? 0),
      activationEpoch: dl ? BigInt(dl.activationEpoch) : null,
      deactivationEpoch,
      deactivating: deactivationEpoch !== null && deactivationEpoch !== U64_MAX,
    });
  });
  return out;
}

// ---------- rebalance planning ----------
// The 1 SOL minimum makes stake exits all-or-nothing per validator (processor.rs
// process_withdraw_stake): if ANY validator holds more than its minimum (rent + 1 SOL), a stake
// exit must split from a validator AND leave that validator at ≥ its minimum. So a validator
// whose headroom (lamports above its minimum) is between 0 and one deposit (1.01 SOL) blocks
// every deposit-sized stake exit: the reserve is closed and no validator can pay ("the band").
// Policy:
//  - Concentrate staked SOL in ONE primary validator (lowest commission, then largest); every
//    other validator stays at its minimum.
//  - Increases bring the primary's next-epoch headroom to a whole number of deposits
//    (k × deposit), with k as large as the excess above the buffer allows, at least 1 SOL per
//    move. This also repairs the dust that 0.3%-fee stake exits leave behind.
//  - Decreases land a validator exactly at its minimum or at ≥ minimum + one deposit.
//  - Unstake only when the reserve is well below the buffer (hysteresis), since every move is
//    ≥ 1 SOL.
//  - While every validator is exactly at its minimum, stake exits are served from the reserve as
//    undelegated stake (free and claimable at once). Accepted.
export function choosePrimary(state, commissions = new Map(), primary) {
  const active = state.list.validators.filter((v) => v.statusName === 'Active');
  if (primary) return active.find((v) => v.voteAccount.toBase58() === String(primary)) ?? null;
  return [...active].sort((x, y) => {
    const cx = commissions.get(x.voteAccount.toBase58()) ?? 100, cy = commissions.get(y.voteAccount.toBase58()) ?? 100;
    if (cx !== cy) return cx - cy; // every reward is ours: lowest commission first
    const sx = x.activeStakeLamports + x.transientStakeLamports, sy = y.activeStakeLamports + y.transientStakeLamports;
    return sy > sx ? 1 : sy < sx ? -1 : 0; // then the one already holding the most
  })[0] ?? null;
}

export function headroomOf(state, v) {
  return v.activeStakeLamports > state.requiredValidatorLamports ? v.activeStakeLamports - state.requiredValidatorLamports : 0n;
}

// Validators whose headroom sits in the band (0, deposit): they block deposit-sized stake exits.
export function bandValidators(state, depositLamports) {
  const tol = lamportsPerPoolToken(state.pool);
  return state.list.validators.filter((v) => v.statusName === 'Active').filter((v) => {
    const h = headroomOf(state, v);
    return h > tol && h < depositLamports;
  });
}

export function planRebalance(state, transients, { bufferLamports, depositLamports = 1_010_000_000n, minChunk, commissions = new Map(), primary, target } = {}) {
  const D = BigInt(depositLamports);
  const min = minChunk && minChunk > state.minDelegation ? minChunk : state.minDelegation;
  const reserveAvail = state.reserveLamports > state.reserveRent ? state.reserveLamports - state.reserveRent : 0n;
  let inbound = 0n;
  for (const t of transients.values()) if (t.deactivating) inbound += t.lamports;
  const P = choosePrimary(state, commissions, primary ?? target);
  const base = { reserveAvail, inbound, bufferLamports, minChunk: min, depositLamports: D, primary: P?.voteAccount ?? null };
  if (!P) return { ...base, action: 'none', reason: primary ? `primary ${primary} is not an active validator in the pool` : 'no active validators' };

  // ---- stake the excess into the primary ----
  if (reserveAvail > bufferLamports) {
    const room = reserveAvail - bufferLamports - state.stakeRent; // the transient's rent also comes out of the reserve
    const tP = transients.get(P.voteAccount.toBase58());
    if (P.transientStakeLamports > 0n && !(tP && !tP.deactivating && tP.activationEpoch === state.epoch)) {
      // IncreaseAdditional only accepts a transient that started activating THIS epoch
      return { ...base, action: 'none', reason: 'the primary has a transient stake that cannot be added to this epoch; retry next epoch' };
    }
    // headroom the primary will have next epoch, once an activating transient has merged (its rent returns to the reserve)
    const pending = P.transientStakeLamports > 0n ? P.transientStakeLamports - state.stakeRent : 0n;
    const hNext = headroomOf(state, P) + pending;
    const d = hNext % D; // dust that would sit in the band after the last exit
    let k = 1n;
    while (k * D - d < min) k++;
    const maxK = room >= 0n ? (room + d) / D : 0n;
    if (maxK < k) return { ...base, action: 'none', reason: `excess ${reserveAvail - bufferLamports} lamports is less than ${k} deposit(s) of ${D} (+ rent) needed for a whole-deposit move` };
    const lamports = maxK * D - d;
    const hasTransient = P.transientStakeLamports > 0n;
    return {
      ...base, action: hasTransient ? 'increaseAdditional' : 'increase', validator: P, lamports,
      transientSeed: hasTransient ? P.transientSeedSuffix : P.transientSeedSuffix + 1n,
      reason: `reserve has ${reserveAvail - bufferLamports} lamports above the buffer; primary headroom ${hNext} -> ${hNext + lamports} (${maxK + hNext / D} deposits)`,
    };
  }

  // ---- unstake when the reserve is well below the buffer ----
  // Hysteresis: a decrease moves at least 1 SOL, so only unstake when the reserve is below the
  // buffer by more than half a chunk or half the buffer (whichever is less).
  const halfBuf = bufferLamports / 2n, halfChunk = min / 2n;
  const lowWater = bufferLamports - (halfBuf < halfChunk ? halfBuf : halfChunk);
  if (reserveAvail + inbound < lowWater) {
    const deficit = bufferLamports - reserveAvail - inbound;
    if (reserveAvail < state.stakeRent) return { ...base, action: 'none', reason: `reserve short by ${deficit} but cannot fund a transient account's rent (${state.stakeRent})` };
    const want = deficit > min ? deficit : min;
    // Only validators with no transient: DecreaseAdditionalValidatorStake has to Merge two
    // deactivating stake accounts, which the stake program refuses while they still have
    // effective stake (StakeError::MergeTransientStake, seen in a devnet simulation).
    const opts = [];
    for (const v of state.list.validators.filter((x) => x.statusName === 'Active' && x.transientStakeLamports === 0n)) {
      const h = headroomOf(state, v);
      if (h < min) continue; // cannot move less than 1 SOL
      if (v !== P) { opts.push({ v, lamports: h, rank: 0 }); continue; } // secondaries go back to exactly their minimum
      const m = (want + D - 1n) / D; // whole deposits
      if (h >= (m + 1n) * D) opts.push({ v, lamports: m * D, rank: 1 }); // primary keeps ≥ one deposit of headroom
      else opts.push({ v, lamports: h, rank: 2 }); // or lands exactly at its minimum
    }
    if (!opts.length) return { ...base, action: 'none', reason: `reserve short by ${deficit} lamports but no validator holds ≥ ${min} lamports above its minimum` };
    opts.sort((x, y) => x.rank - y.rank);
    const { v, lamports } = opts[0];
    return {
      ...base, action: 'decrease', validator: v, lamports,
      transientSeed: v.transientSeedSuffix + 1n,
      reason: `reserve short of the buffer by ${deficit} lamports (after ${inbound} already returning); ${v === P ? 'primary' : 'secondary'} headroom ${headroomOf(state, v)} -> ${headroomOf(state, v) - lamports}`,
    };
  }
  return { ...base, action: 'none', reason: `reserve within the buffer band (unstakes only below ${lowWater} lamports)` };
}

export function buildRebalanceInstruction(state, plan, staker) {
  const a = state.addresses;
  const v = plan.validator;
  const validatorStake = findValidatorStake(a.programId, v.voteAccount, a.pool, v.validatorSeedSuffix);
  const transientStake = findTransientStake(a.programId, v.voteAccount, a.pool, plan.transientSeed);
  const common = { programId: a.programId, stakePool: a.pool, staker, withdrawAuthority: a.withdrawAuthority, validatorList: a.validatorList, reserveStake: a.reserve, validatorStake, transientStake, lamports: plan.lamports, transientStakeSeed: plan.transientSeed };
  const ephemeralStakeSeed = 0n;
  const ephemeralStake = findEphemeralStake(a.programId, a.pool, ephemeralStakeSeed);
  switch (plan.action) {
    case 'increase': return increaseValidatorStake({ ...common, validatorVote: v.voteAccount });
    case 'increaseAdditional': return increaseAdditionalValidatorStake({ ...common, validatorVote: v.voteAccount, ephemeralStake, ephemeralStakeSeed });
    case 'decrease': return decreaseValidatorStakeWithReserve(common);
    case 'decreaseAdditional': return decreaseAdditionalValidatorStake({ ...common, ephemeralStake, ephemeralStakeSeed });
    default: throw new Error(`no instruction for action ${plan.action}`);
  }
}

// ---------- stake withdrawal source (processor.rs L2888-L3058) ----------
// Returns where a WithdrawStake of `withdrawLamports` must split from, or why it can't.
export function pickWithdrawSource(state, withdrawLamports) {
  const a = state.addresses;
  const W = BigInt(withdrawLamports);
  const required = state.requiredValidatorLamports;
  const tol = lamportsPerPoolToken(state.pool);
  const minWithTol = required + tol;
  const vs = state.list.validators;
  const isActive = (v) => v.statusName === 'Active';
  const hasActive = vs.some((v) => isActive(v) && v.activeStakeLamports > minWithTol);
  const hasTransient = vs.some((v) => isActive(v) && v.transientStakeLamports > minWithTol);
  const delegatedMin = state.minDelegation; // a split of delegated stake must itself meet the minimum delegation

  const pref = state.pool.preferredWithdrawValidator;
  if (pref) {
    const pv = vs.find((v) => v.voteAccount.equals(pref));
    if (pv && pv.activeStakeLamports > minWithTol) {
      const x = validatorAccounts(a.programId, a.pool, pv);
      if (pv.activeStakeLamports - W < required || W < delegatedMin) return { ok: false, reason: `preferred withdraw validator ${pref.toBase58()} cannot serve ${W} lamports` };
      return { ok: true, kind: 'active', stakeAccount: x.validatorStake, vote: pv.voteAccount, delegated: true };
    }
  }
  if (hasActive) {
    if (W < delegatedMin) return { ok: false, reason: `stake withdrawals from validators must be at least ${delegatedMin} lamports` };
    const c = vs.filter((v) => isActive(v) && v.activeStakeLamports >= W + required).sort((x, y) => (y.activeStakeLamports > x.activeStakeLamports ? 1 : -1))[0];
    if (!c) {
      const best = vs.filter(isActive).reduce((m, v) => (v.activeStakeLamports > m ? v.activeStakeLamports : m), 0n);
      return { ok: false, blocked: true, reason: `a validator holds more than its minimum, so the reserve is closed to stake withdrawals, but no validator can give ${W} lamports and keep ${required} (largest holds ${best}). Use the instant exit or wait for the crank.` };
    }
    return { ok: true, kind: 'active', stakeAccount: validatorAccounts(a.programId, a.pool, c).validatorStake, vote: c.voteAccount, delegated: true };
  }
  if (hasTransient) {
    if (W < delegatedMin) return { ok: false, reason: `stake withdrawals from transient stake must be at least ${delegatedMin} lamports` };
    const c = vs.filter((v) => isActive(v) && v.transientStakeLamports >= W + required).sort((x, y) => (y.transientStakeLamports > x.transientStakeLamports ? 1 : -1))[0];
    if (!c) return { ok: false, blocked: true, reason: `only transient stake is withdrawable and none can give ${W} lamports while keeping ${required}. Use the instant exit or wait an epoch.` };
    return { ok: true, kind: 'transient', stakeAccount: validatorAccounts(a.programId, a.pool, c).transientStake, vote: c.voteAccount, delegated: true };
  }
  // every validator is at its minimum: the reserve (undelegated stake, instantly withdrawable)
  if (state.reserveLamports >= W + state.reserveRent) return { ok: true, kind: 'reserve', stakeAccount: a.reserve, vote: null, delegated: false };
  // …or take a whole validator stake account (removes that validator)
  const whole = vs.find((v) => isActive(v) && v.transientStakeLamports === 0n && W >= v.activeStakeLamports && W <= v.activeStakeLamports + tol);
  if (whole) return { ok: true, kind: 'validatorRemoval', stakeAccount: validatorAccounts(a.programId, a.pool, whole).validatorStake, vote: whole.voteAccount, delegated: true };
  return { ok: false, reason: `reserve holds ${state.reserveLamports - state.reserveRent} lamports, less than ${W}` };
}

// Largest single stake withdrawal possible right now (lamports), and from where.
export function maxStakeWithdrawal(state) {
  const required = state.requiredValidatorLamports;
  const tol = lamportsPerPoolToken(state.pool);
  const vs = state.list.validators.filter((v) => v.statusName === 'Active');
  const hasActive = vs.some((v) => v.activeStakeLamports > required + tol);
  const hasTransient = vs.some((v) => v.transientStakeLamports > required + tol);
  const okSize = (x) => (x >= state.minDelegation ? x : 0n);
  if (hasActive) return { from: 'validator', lamports: okSize(vs.reduce((m, v) => { const h = v.activeStakeLamports - required; return h > m ? h : m; }, 0n)) };
  if (hasTransient) return { from: 'transient', lamports: okSize(vs.reduce((m, v) => { const h = v.transientStakeLamports - required; return h > m ? h : m; }, 0n)) };
  return { from: 'reserve (undelegated)', lamports: state.reserveLamports > state.reserveRent ? state.reserveLamports - state.reserveRent : 0n };
}

// ---------- epoch timing ----------
export async function epochTiming(ctx) {
  const [info, samples] = await Promise.all([
    ctx.connection.getEpochInfo('confirmed'),
    ctx.connection.getRecentPerformanceSamples(30).catch(() => []),
  ]);
  const slots = samples.reduce((s, x) => s + x.numSlots, 0);
  const secs = samples.reduce((s, x) => s + x.samplePeriodSecs, 0);
  const slotSec = slots > 0 ? secs / slots : 0.4;
  const left = info.slotsInEpoch - info.slotIndex;
  const secondsLeft = Math.round(left * slotSec);
  return {
    epoch: info.epoch, slotIndex: info.slotIndex, slotsInEpoch: info.slotsInEpoch,
    progressPct: Math.round((info.slotIndex / info.slotsInEpoch) * 10000) / 100,
    slotMs: Math.round(slotSec * 1000), epochHours: Math.round((info.slotsInEpoch * slotSec) / 360) / 10,
    secondsLeft, nextEpochAt: new Date(Date.now() + secondsLeft * 1000).toISOString(),
  };
}

// Is a parent's stake account withdrawable now? Asks the cluster by simulating a full
// withdraw (no signature needed), instead of re-implementing warmup/cooldown maths.
export function withdrawAllIx(stakeAccount, authority, lamports) {
  return StakeProgram.withdraw({ stakePubkey: stakeAccount, authorizedPubkey: authority, toPubkey: authority, lamports: Number(lamports) }).instructions[0];
}

export async function readCommissions(ctx, votes) {
  const res = await ctx.connection.getVoteAccounts('confirmed');
  const all = [...res.current, ...res.delinquent];
  const m = new Map();
  for (const v of votes) {
    const k = v instanceof PublicKey ? v.toBase58() : String(v);
    const hit = all.find((x) => x.votePubkey === k);
    if (hit) m.set(k, hit.commission);
  }
  return { commissions: m, delinquent: new Set(res.delinquent.map((x) => x.votePubkey)) };
}
