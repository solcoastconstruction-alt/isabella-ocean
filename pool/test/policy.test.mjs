// Offline tests for the withdraw-source picker and the crank's rebalance planner, on synthetic
// pool states. Rules mirror program@v2.1.0 processor.rs process_withdraw_stake and the
// Increase/Decrease checks. Run: node test/policy.test.mjs
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { STAKE_POOL_PROGRAM_ID_DEVNET as PID } from '../lib/ix.mjs';
import { pickWithdrawSource, planRebalance, maxStakeWithdrawal, bandValidators } from '../lib/pool-ops.mjs';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`); };
const SOL = 1_000_000_000n;
const sol = (x) => BigInt(Math.round(x * 1e9));
const RENT = 1_666_240n;
const MIN = RENT + SOL; // validator minimum: rent + 1 SOL minimum delegation
const k = () => Keypair.generate().publicKey;

function mk({ reserve = 0n, validators = [], epoch = 10n }) {
  const vs = validators.map((v, i) => ({
    index: i, voteAccount: v.vote ?? k(), activeStakeLamports: v.active ?? MIN, transientStakeLamports: v.transient ?? 0n,
    transientSeedSuffix: v.seed ?? 0n, validatorSeedSuffix: 0, status: 0, statusName: v.status ?? 'Active', lastUpdateEpoch: epoch,
  }));
  const total = reserve + vs.reduce((s, v) => s + v.activeStakeLamports + v.transientStakeLamports, 0n);
  return {
    pool: { totalLamports: total, poolTokenSupply: total, preferredWithdrawValidator: null },
    list: { validators: vs },
    reserveLamports: RENT + reserve, reserveRent: RENT, stakeRent: RENT, minDelegation: SOL, requiredValidatorLamports: MIN, epoch,
    addresses: { programId: PID, pool: k(), reserve: k(), withdrawAuthority: k(), validatorList: k(), mint: k(), managerFeeAccount: k() },
  };
}
const W = sol(1.01); // one family's stake exit

// ---------- withdraw source ----------
t('all validators at minimum: stake exit comes undelegated from the reserve', () => {
  const r = pickWithdrawSource(mk({ reserve: sol(1.2), validators: [{}, {}] }), W);
  assert.equal(r.ok, true); assert.equal(r.kind, 'reserve'); assert.equal(r.delegated, false);
});
t('reserve route also serves exits below 1 SOL (undelegated split needs only rent)', () => {
  assert.equal(pickWithdrawSource(mk({ reserve: sol(1.2), validators: [{}] }), sol(0.3)).kind, 'reserve');
});
t('trap zone: a validator 0.9 SOL above minimum closes the reserve but cannot give 1.01', () => {
  const r = pickWithdrawSource(mk({ reserve: sol(5), validators: [{ active: MIN + sol(0.9) }, {}] }), W);
  assert.equal(r.ok, false); assert.equal(r.blocked, true);
});
t('validator 2.5 SOL above minimum serves a 1.01 exit as delegated stake', () => {
  const r = pickWithdrawSource(mk({ reserve: 0n, validators: [{ active: MIN + sol(2.5) }, {}] }), W);
  assert.equal(r.ok, true); assert.equal(r.kind, 'active'); assert.equal(r.delegated, true);
});
t('from a validator, exits must be ≥ 1 SOL (minimum delegation of the split)', () => {
  assert.equal(pickWithdrawSource(mk({ validators: [{ active: MIN + sol(3) }] }), sol(0.5)).ok, false);
});
t('a small transient blocks stake exits for the epoch', () => {
  const r = pickWithdrawSource(mk({ reserve: sol(3), validators: [{ transient: sol(1.01) + RENT }, {}] }), W);
  assert.equal(r.ok, false); assert.equal(r.blocked, true);
});
t('a transient ≥ exit + minimum serves the exit (delegated, activating)', () => {
  const r = pickWithdrawSource(mk({ validators: [{ transient: W + MIN }, {}] }), W);
  assert.equal(r.ok, true); assert.equal(r.kind, 'transient');
});
t('a transient of exactly 1 SOL + rent does not close the reserve route', () => {
  assert.equal(pickWithdrawSource(mk({ reserve: sol(2), validators: [{ transient: MIN }] }), W).kind, 'reserve');
});
t('maxStakeWithdrawal reports 0 in the trap zone and the headroom otherwise', () => {
  assert.equal(maxStakeWithdrawal(mk({ validators: [{ active: MIN + sol(0.9) }] })).lamports, 0n);
  assert.equal(maxStakeWithdrawal(mk({ validators: [{ active: MIN + sol(2.5) }] })).lamports, sol(2.5));
});

// ---------- rebalance planner (whole deposits, one primary, no band) ----------
const BUF = sol(1.05);
const D = sol(1.01);
const cm = (pairs) => new Map(pairs.map(([v, c]) => [v.toBase58(), c]));
t('excess smaller than one deposit (+ transient rent): keep it liquid', () => {
  const p = planRebalance(mk({ reserve: sol(2.0), validators: [{}, {}] }), new Map(), { bufferLamports: BUF, depositLamports: D });
  assert.equal(p.action, 'none'); assert.match(p.reason, /deposit/);
});
t('fresh pool: stakes as many whole deposits as the excess allows into the primary', () => {
  const p = planRebalance(mk({ reserve: sol(3.1), validators: [{}, {}] }), new Map(), { bufferLamports: BUF, depositLamports: D });
  assert.equal(p.action, 'increase'); assert.equal(p.lamports, 2n * D); assert.equal(p.transientSeed, 1n);
});
t('primary = lowest commission; the other validator is never increased', () => {
  const a = k(), b = k();
  const p = planRebalance(mk({ reserve: sol(5), validators: [{ vote: a, active: MIN + sol(3) }, { vote: b }] }), new Map(), { bufferLamports: BUF, depositLamports: D, commissions: cm([[a, 10], [b, 0]]) });
  assert.ok(p.validator.voteAccount.equals(b)); assert.ok(p.primary.equals(b));
});
t('equal commission: the validator already holding the most is primary', () => {
  const a = k(), b = k();
  const p = planRebalance(mk({ reserve: sol(5), validators: [{ vote: a }, { vote: b, active: MIN + sol(2.02) }] }), new Map(), { bufferLamports: BUF, depositLamports: D });
  assert.ok(p.validator.voteAccount.equals(b));
});
t('explicit primary wins', () => {
  const a = k(), b = k();
  const p = planRebalance(mk({ reserve: sol(5), validators: [{ vote: a }, { vote: b }] }), new Map(), { bufferLamports: BUF, depositLamports: D, primary: a.toBase58() });
  assert.ok(p.validator.voteAccount.equals(a));
});
t('dust repair: 0.00303 SOL left by a 0.3%-fee exit is topped up to exactly one deposit', () => {
  const st = mk({ reserve: BUF + RENT + sol(1.0183), validators: [{ active: MIN + sol(0.00303) }, {}] });
  const p = planRebalance(st, new Map(), { bufferLamports: BUF, depositLamports: D });
  assert.equal(p.action, 'increase'); assert.equal(p.lamports, D - sol(0.00303));
  assert.equal((sol(0.00303) + p.lamports) % D, 0n);
});
t('odd remainder: headroom 0.5 needs a 1.52 SOL move to reach two whole deposits', () => {
  const v = [{ active: MIN + sol(0.5) }, {}];
  assert.equal(planRebalance(mk({ reserve: BUF + RENT + sol(1.3), validators: v }), new Map(), { bufferLamports: BUF, depositLamports: D }).action, 'none');
  const p = planRebalance(mk({ reserve: BUF + RENT + sol(1.6), validators: v }), new Map(), { bufferLamports: BUF, depositLamports: D });
  assert.equal(p.lamports, 2n * D - sol(0.5));
});
t('activating transient this epoch: IncreaseAdditional sized so next epoch lands on whole deposits', () => {
  const a = k();
  const st = mk({ reserve: BUF + RENT + sol(1.5), validators: [{ vote: a, transient: D + RENT, seed: 4n }] });
  const p = planRebalance(st, new Map([[a.toBase58(), { deactivating: false, activationEpoch: st.epoch, lamports: D + RENT }]]), { bufferLamports: BUF, depositLamports: D });
  assert.equal(p.action, 'increaseAdditional'); assert.equal(p.transientSeed, 4n); assert.equal(p.lamports, D);
});
t('primary with a deactivating transient: wait for next epoch', () => {
  const a = k();
  const st = mk({ reserve: sol(5), validators: [{ vote: a, active: MIN + sol(3), transient: sol(1) }] });
  const p = planRebalance(st, new Map([[a.toBase58(), { deactivating: true, deactivationEpoch: st.epoch, lamports: sol(1) }]]), { bufferLamports: BUF, depositLamports: D });
  assert.equal(p.action, 'none');
});
t('decrease from the primary keeps whole deposits: 3 deposits -> 2', () => {
  const p = planRebalance(mk({ reserve: sol(0.2), validators: [{ active: MIN + 3n * D }, {}] }), new Map(), { bufferLamports: BUF, depositLamports: D });
  assert.equal(p.action, 'decrease'); assert.equal(p.lamports, D);
});
t('decrease that cannot keep a whole deposit lands the primary exactly at its minimum', () => {
  const p = planRebalance(mk({ reserve: sol(0.2), validators: [{ active: MIN + sol(1.5) }, {}] }), new Map(), { bufferLamports: BUF, depositLamports: D });
  assert.equal(p.action, 'decrease'); assert.equal(p.lamports, sol(1.5));
});
t('headroom under 1 SOL cannot be decreased (and is reported as band elsewhere)', () => {
  assert.equal(planRebalance(mk({ reserve: sol(0.2), validators: [{ active: MIN + sol(0.5) }, {}] }), new Map(), { bufferLamports: BUF, depositLamports: D }).action, 'none');
});
t('a secondary above its minimum is brought back to exactly its minimum first', () => {
  const a = k(), b = k();
  const p = planRebalance(mk({ reserve: sol(0.2), validators: [{ vote: a, active: MIN + 3n * D }, { vote: b, active: MIN + sol(2) }] }), new Map(), { bufferLamports: BUF, depositLamports: D, commissions: cm([[a, 0], [b, 5]]) });
  assert.ok(p.validator.voteAccount.equals(b)); assert.equal(p.lamports, sol(2));
});
t('hysteresis: a small gap under the buffer does not trigger a 1 SOL unstake', () => {
  const p = planRebalance(mk({ reserve: sol(1.044), validators: [{ active: MIN + D }, {}] }), new Map(), { bufferLamports: BUF, depositLamports: D });
  assert.equal(p.action, 'none'); assert.match(p.reason, /buffer band/);
});
t('reserve short but a deactivating transient already covers it: wait', () => {
  const a = k();
  const st = mk({ reserve: sol(0.2), validators: [{ vote: a, active: MIN + sol(3), transient: sol(1) }] });
  const p = planRebalance(st, new Map([[a.toBase58(), { deactivating: true, deactivationEpoch: st.epoch, lamports: sol(1) }]]), { bufferLamports: BUF, depositLamports: D });
  assert.equal(p.action, 'none');
});
t('never plans DecreaseAdditional (the stake program cannot merge deactivating stake)', () => {
  const a = k();
  const st = mk({ reserve: sol(0.1), validators: [{ vote: a, active: MIN + sol(5), transient: sol(1) }] });
  const p = planRebalance(st, new Map([[a.toBase58(), { deactivating: true, deactivationEpoch: st.epoch, lamports: sol(0.1) }]]), { bufferLamports: sol(3), depositLamports: D });
  assert.notEqual(p.action, 'decreaseAdditional');
});
t('band detection: headroom strictly between 0 and one deposit', () => {
  const st = mk({ validators: [{ active: MIN }, { active: MIN + sol(0.5) }, { active: MIN + D }, { active: MIN + sol(0.00303) }] });
  assert.deepEqual(bandValidators(st, D).map((v) => v.index), [1, 3]);
});
t('scenario: one deposit staked into the primary serves one deposit-sized exit, then the reserve takes over', () => {
  const st = mk({ reserve: sol(1.05), validators: [{ active: MIN + D }, {}] });
  const first = pickWithdrawSource(st, D);
  assert.equal(first.kind, 'active');
  const after = mk({ reserve: sol(1.05), validators: [{ active: MIN }, {}] }); // the exit takes exactly one deposit
  assert.equal(pickWithdrawSource(after, D).kind, 'reserve');
});

console.log(`\n${passed} tests passed`);
