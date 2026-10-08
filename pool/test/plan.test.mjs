// Offline tests for the phone-manager plan files: the decoder the phone page uses
// (android/app/src/debug/assets/pool-plan.js, evaluated unchanged by lib/plan.mjs) and the plan checks.
// 1. Decoding is checked against hex vectors written out by hand from program@v2.1.0 instruction.rs
//    (Borsh: u8 variant, LE ints, Fee = {den, num}), not only against our own encoders.
// 2. Every instruction a plan can carry is built with lib/ix.mjs and must describe itself correctly.
// 3. The plan rules: cluster named in the file, mainnet opt-in, one signer, Initialize alone and first,
//    nothing undecoded.
// Run: node test/plan.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as ixs from '../lib/ix.mjs';
import { BorshWriter } from '../lib/borsh.mjs';
import { decodeStakePool } from '../lib/state.mjs';
import { CLUSTERS } from '../lib/env.mjs';
import { PoolPlan as P, ixToJson, buildPlan, planText, fingerprintOf, describePlan, CHAIN } from '../lib/plan.mjs';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`); };
const hex = (b) => Buffer.from(b).toString('hex');
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return hex(b); };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return hex(b); };
const str = (s) => u32(Buffer.byteLength(s)) + hex(Buffer.from(s, 'utf8'));
const k = () => Keypair.generate().publicKey;
const DEV = ixs.STAKE_POOL_PROGRAM_ID_DEVNET, MAIN = ixs.STAKE_POOL_PROGRAM_ID_MAINNET;
const params = (d) => Object.fromEntries(d.params);
const flags = (d) => d.accounts.map((a) => `${a.isSigner ? 's' : ''}${a.isWritable ? 'w' : ''}` || 'r');

// One pool's worth of addresses, and the four manager instructions create-pool.mjs prints.
const A = { stakePool: k(), manager: k(), staker: k(), withdrawAuthority: k(), validatorList: k(), reserveStake: k(), poolMint: k(), managerFeeAccount: k(), feeOwner: k() };
const build = (programId = DEV) => ({
  init: ixs.initialize({ programId, ...A, tokenProgramId: TOKEN_PROGRAM_ID, epochFee: ixs.fee(1, 1), withdrawalFee: ixs.fee(3, 1000), depositFee: ixs.fee(0, 0), referralFee: 0, maxValidators: 4 }),
  setFee: ixs.setFee({ programId, stakePool: A.stakePool, manager: A.manager, feeType: ixs.FEE_TYPE.StakeWithdrawal, value: ixs.fee(0, 100) }),
  setAuth: ixs.setFundingAuthority({ programId, stakePool: A.stakePool, manager: A.manager, newAuthority: A.manager, fundingType: ixs.FUNDING_TYPE.StakeDeposit }),
  meta: ixs.createTokenMetadata({ programId, stakePool: A.stakePool, manager: A.manager, withdrawAuthority: A.withdrawAuthority, poolMint: A.poolMint, payer: A.manager, name: 'Isabella Ocean Pass', symbol: 'OCEAN', uri: 'https://isabellaocean-app.pages.dev/ocean-pass.json' }),
  collect: ixs.withdrawSol({ programId, stakePool: A.stakePool, withdrawAuthority: A.withdrawAuthority, userTransferAuthority: A.feeOwner, poolTokensFrom: A.managerFeeAccount, reserveStake: A.reserveStake, lamportsTo: A.feeOwner, managerFeeAccount: A.managerFeeAccount, poolMint: A.poolMint, tokenProgramId: TOKEN_PROGRAM_ID, poolTokens: 10_000_000n, minimumLamportsOut: 10_000_000n }),
});
const I = build();
const describe = (instruction, cluster = 'devnet') => P.describeInstruction(ixToJson('x', instruction), cluster);
const withData = (instruction, dataHex) => ({ ...ixToJson('x', instruction), dataHex, dataBase58: undefined });

// ---------- 1. bytes ----------
t('base58 agrees with web3.js both ways, including leading zero bytes', () => {
  for (let i = 0; i < 20; i++) {
    const key = k();
    assert.equal(P.b58encode(key.toBytes()), key.toBase58());
    assert.equal(hex(P.b58decode(key.toBase58())), hex(key.toBytes()));
  }
  assert.equal(P.b58encode(new Uint8Array(32)), PublicKey.default.toBase58());
  assert.equal(hex(P.b58decode('11111111111111111111111111111111')), '00'.repeat(32));
  assert.equal(P.b58encode(Uint8Array.from([0, 0, 1])), '112');
  assert.throws(() => P.b58decode('0OIl'));
  assert.ok(P.isPubkey(TOKEN_PROGRAM_ID.toBase58()));
  assert.ok(!P.isPubkey('abc') && !P.isPubkey(''));
});

t('base64url agrees with Node for every length mod 3, and rejects other alphabets', () => {
  for (let n = 0; n < 40; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n * 11 + 250) & 255);
    const enc = P.b64urlEncode(bytes);
    assert.equal(enc, Buffer.from(bytes).toString('base64url'));
    assert.equal(hex(P.b64urlDecode(enc)), hex(bytes));
  }
  assert.throws(() => P.b64urlDecode('ab+/'));
  assert.throws(() => P.b64urlDecode('a'));
});

t('fee and amount wording uses no float maths', () => {
  assert.equal(P.feeText({ numerator: 1n, denominator: 1n }), '1/1 = 100%');
  assert.equal(P.feeText({ numerator: 3n, denominator: 1000n }), '3/1000 = 0.3%');
  assert.equal(P.feeText({ numerator: 0n, denominator: 100n }), '0/100 = 0%');
  assert.equal(P.feeText({ numerator: 0n, denominator: 0n }), '0/0 = 0%');
  assert.equal(P.feeText({ numerator: 1n, denominator: 3n }), '1/3 = 33.333333%');
  assert.match(P.feeText({ numerator: 3n, denominator: 1n }), /MORE THAN 100%/);
  assert.equal(P.amount9(10_000_000n), '0.010000000');
  assert.equal(P.amount9(1_010_000_000n), '1.010000000');
  assert.equal(P.amount9(2n ** 64n - 1n), '18446744073.709551615');
});

t('fingerprint is the first 8 bytes of the file\'s sha256, in groups of four', () => {
  const bytes = Buffer.from('{"a":1}\n');
  const want = createHash('sha256').update(bytes).digest('hex').slice(0, 16).toUpperCase().match(/.{4}/g).join(' ');
  assert.equal(fingerprintOf(bytes), want);
  assert.match(fingerprintOf(bytes), /^[0-9A-F]{4}( [0-9A-F]{4}){3}$/);
  assert.notEqual(fingerprintOf(Buffer.from('{"a":1}')), want); // one byte less is another file
});

// ---------- 2. hand-written vectors -> words ----------
t('Initialize vector: epoch 1/1, withdrawal 3/1000, deposit 0/0, referral 0, max 4', () => {
  const data = '00' + u64(1) + u64(1) + u64(1000) + u64(3) + u64(0) + u64(0) + '00' + u32(4);
  const d = P.describeInstruction(withData(I.init, data), 'devnet');
  assert.ok(d.decoded, d.problems.join('; '));
  assert.equal(d.name, 'Initialize');
  assert.deepEqual(params(d), {
    'Fee on rewards (epoch fee)': '1/1 = 100%',
    'Withdrawal fee (SOL and stake)': '3/1000 = 0.3%',
    'Deposit fee (SOL and stake)': '0/0 = 0%',
    'Referral share of deposit fees': '0%',
    'Most validators the pool can hold': '4',
  });
});

t('Fee is denominator FIRST: 1000 then 3 reads as 3/1000, and 3 then 1000 reads as an invalid 1000/3', () => {
  const swapped = '00' + u64(1) + u64(1) + u64(3) + u64(1000) + u64(0) + u64(0) + '00' + u32(4);
  const d = P.describeInstruction(withData(I.init, swapped), 'devnet');
  assert.match(params(d)['Withdrawal fee (SOL and stake)'], /^1000\/3 = MORE THAN 100%/);
});

t('SetFee vectors: [12, type, den, num]; referral types carry a u8', () => {
  const sf = (data) => params(P.describeInstruction(withData(I.setFee, data), 'devnet'));
  assert.deepEqual(sf('0c03' + u64(100) + u64(0)), { 'Which fee': 'StakeWithdrawal: fee on stake withdrawals (the free exit)', 'New value': '0/100 = 0%' });
  assert.equal(sf('0c02' + u64(1) + u64(1))['New value'], '1/1 = 100%');
  assert.match(sf('0c06' + u64(1000) + u64(3))['Which fee'], /^SolWithdrawal/);
  assert.equal(sf('0c06' + u64(1000) + u64(3))['New value'], '3/1000 = 0.3%');
  assert.deepEqual(sf('0c0005'), { 'Which fee': 'SolReferral: share of the SOL deposit fee paid to a referrer', 'New value': '5%' });
  assert.ok(!P.describeInstruction(withData(I.setFee, '0c07' + u64(1) + u64(1)), 'devnet').decoded); // no such fee type
});

t('SetFundingAuthority vector [15, 0] names the new authority, or says NONE without one', () => {
  const d = describe(I.setAuth);
  assert.equal(hex(I.setAuth.data), '0f00');
  assert.match(params(d)['Which authority'], /^StakeDeposit/);
  assert.equal(params(d)['New authority'], A.manager.toBase58());
  const none = describe(ixs.setFundingAuthority({ programId: DEV, stakePool: A.stakePool, manager: A.manager, newAuthority: null, fundingType: ixs.FUNDING_TYPE.SolWithdraw }));
  assert.ok(none.decoded);
  assert.match(params(none)['Which authority'], /^SolWithdraw/);
  assert.match(params(none)['New authority'], /^NONE/);
});

t('CreateTokenMetadata vector [17] + three Borsh strings', () => {
  const data = '11' + str('Isabella Ocean Pass') + str('OCEAN') + str('https://isabellaocean-app.pages.dev/ocean-pass.json');
  assert.equal(hex(I.meta.data), data);
  assert.deepEqual(params(describe(I.meta)), { 'Token name': 'Isabella Ocean Pass', 'Token symbol': 'OCEAN', 'Metadata URI': 'https://isabellaocean-app.pages.dev/ocean-pass.json' });
});

t('WithdrawSol [16, tokens] and WithdrawSolWithSlippage [26, tokens, min]; a fee collection is recognised', () => {
  const plain = P.describeInstruction(withData(I.collect, '10' + u64(10_000_000n)), 'devnet');
  assert.equal(plain.name, 'WithdrawSol');
  assert.equal(plain.managerSigned, false); // the manager never signs a withdrawal
  assert.equal(params(plain)['Pool tokens to burn'], '0.010000000 OCEAN');
  const d = describe(I.collect);
  assert.equal(hex(I.collect.data), '1a' + u64(10_000_000n) + u64(10_000_000n));
  assert.equal(d.name, 'WithdrawSolWithSlippage');
  assert.equal(params(d)['At least this much SOL must come out'], '0.010000000 SOL');
  assert.match(params(d)['Withdrawal fee'], /^none/);
  assert.equal(d.feeCollection, true);
  assert.equal(d.accounts[2].role, 'owner of the tokens being burned');
  assert.equal(d.accounts[2].pubkey, A.feeOwner.toBase58()); // the fee owner signs; the manager is not in this instruction at all
  assert.ok(!d.accounts.some((a) => a.pubkey === A.manager.toBase58()));
  const parent = describe(ixs.withdrawSol({ programId: DEV, stakePool: A.stakePool, withdrawAuthority: A.withdrawAuthority, userTransferAuthority: A.feeOwner, poolTokensFrom: k(), reserveStake: A.reserveStake, lamportsTo: A.feeOwner, managerFeeAccount: A.managerFeeAccount, poolMint: A.poolMint, tokenProgramId: TOKEN_PROGRAM_ID, poolTokens: 5n }));
  assert.equal(parent.feeCollection, false);
  assert.match(params(parent)['Withdrawal fee'], /NOT a fee collection/);
});

// ---------- 3. every plan instruction describes itself; accounts keep their roles and flags ----------
t('Initialize accounts: roles in instruction.rs order, manager the only signer', () => {
  const d = describe(I.init);
  assert.ok(d.decoded, d.problems.join('; '));
  assert.deepEqual(flags(d), ['w', 's', 'r', 'r', 'w', 'r', 'w', 'w', 'r']);
  assert.deepEqual(d.accounts.map((a) => a.pubkey), [A.stakePool, A.manager, A.staker, A.withdrawAuthority, A.validatorList, A.reserveStake, A.poolMint, A.managerFeeAccount, TOKEN_PROGRAM_ID].map((x) => x.toBase58()));
  assert.equal(d.accounts[1].role, 'manager');
  assert.equal(d.accounts[7].role, 'manager fee account');
  assert.equal(d.accounts[8].known, 'SPL Token program');
  assert.ok(!d.managerSigned); // Initialize is guarded by its own rule (alone, first), not by the manager check
});

t('manager-signed instructions are marked, permissionless ones are not', () => {
  for (const i of [I.setFee, I.setAuth, I.meta]) assert.equal(describe(i).managerSigned, true);
  assert.equal(describe(I.collect).managerSigned, false);
  const upd = describe(ixs.updateStakePoolBalance({ programId: DEV, ...A, tokenProgramId: TOKEN_PROGRAM_ID }));
  assert.ok(upd.decoded && upd.permissionless && !upd.managerSigned);
  const list = describe(ixs.updateValidatorListBalance({ programId: DEV, ...A, pairs: [[k(), k()], [k(), k()]], startIndex: 0, noMerge: false }));
  assert.ok(list.decoded, list.problems.join('; '));
  assert.equal(list.accounts.length, 11);
  assert.ok(describe(ixs.cleanupRemovedValidatorEntries({ programId: DEV, ...A })).decoded);
  const sm = describe(ixs.setManager({ programId: DEV, stakePool: A.stakePool, manager: A.manager, newManager: k(), newManagerFeeAccount: k() }));
  assert.ok(sm.decoded && sm.managerSigned);
  assert.ok(describe(ixs.setStaker({ programId: DEV, stakePool: A.stakePool, authority: A.manager, newStaker: k() })).managerSigned);
});

t('anything not known byte for byte is NOT decoded, and says why', () => {
  // a stake-pool instruction the page does not carry (DepositSol = 14)
  const dep = describe(ixs.depositSol({ programId: DEV, stakePool: A.stakePool, withdrawAuthority: A.withdrawAuthority, reserveStake: A.reserveStake, lamportsFrom: A.manager, poolTokensTo: k(), managerFeeAccount: A.managerFeeAccount, poolMint: A.poolMint, tokenProgramId: TOKEN_PROGRAM_ID, lamports: 1n }));
  assert.ok(!dep.decoded && /not one this page knows/.test(dep.problems[0]));
  // the right bytes for the wrong program, or for the other cluster's program
  assert.ok(!describe(build(TOKEN_PROGRAM_ID).setFee).decoded);
  assert.ok(!describe(build(MAIN).setFee, 'devnet').decoded);
  assert.ok(describe(build(MAIN).setFee, 'mainnet').decoded);
  // trailing bytes, and data cut short
  assert.match(P.describeInstruction(withData(I.setFee, hex(I.setFee.data) + '00'), 'devnet').problems[0], /extra byte/);
  assert.match(P.describeInstruction(withData(I.init, hex(I.init.data).slice(0, -2)), 'devnet').problems[0], /too short/);
  assert.ok(!P.describeInstruction(withData(I.init, 'zz'), 'devnet').decoded);
  // the manager not marked as a signer, or a read-only account marked writable
  const j = ixToJson('x', I.setFee); j.accounts[1].isSigner = false;
  assert.match(P.describeInstruction(j, 'devnet').problems[0], /manager: the file says read-only but SetFee needs signer/);
  const j2 = ixToJson('x', I.init); j2.accounts[5].isWritable = true;
  assert.ok(!P.describeInstruction(j2, 'devnet').decoded);
  // too few accounts, too many accounts
  const j3 = ixToJson('x', I.init); j3.accounts.pop();
  assert.ok(!P.describeInstruction(j3, 'devnet').decoded);
  const j4 = ixToJson('x', I.setFee); j4.accounts.push({ pubkey: k().toBase58(), isSigner: false, isWritable: true });
  assert.ok(!P.describeInstruction(j4, 'devnet').decoded);
  // dataBase58 that is not the same bytes as dataHex
  const j5 = ixToJson('x', I.setFee); j5.dataBase58 = ixToJson('x', I.setAuth).dataBase58;
  assert.match(P.describeInstruction(j5, 'devnet').problems[0], /disagree/);
});

// ---------- 4. the plan file ----------
const ctx = (cluster) => ({ cluster, rpcUrl: CLUSTERS[cluster].rpcUrl });
const createSteps = (X = I) => [
  { title: 'Initialize the pool (alone, first)', instructions: [{ label: 'Initialize', instruction: X.init }] },
  { title: 'Manager settings', instructions: [{ label: 'SetFee', instruction: X.setFee }, { label: 'SetFundingAuthority', instruction: X.setAuth }, { label: 'CreateTokenMetadata', instruction: X.meta }] },
];
const devPlan = () => buildPlan(ctx('devnet'), { kind: 'create-pool', signer: A.manager, steps: createSteps() });
const errorsOf = (mutate) => { const p = JSON.parse(planText(devPlan())); mutate(p); return P.checkPlan(p).errors.join('\n'); };

t('a devnet create-pool plan passes, names its cluster and chain, and round-trips through its own text', () => {
  const plan = devPlan();
  assert.equal(plan.cluster, 'devnet');
  assert.equal(plan.chain, 'solana:devnet');
  assert.equal(plan.genesisHash, CLUSTERS.devnet.genesisHash);
  assert.equal(plan.allowMainnet, undefined);
  const check = P.checkPlan(JSON.parse(planText(plan)));
  assert.deepEqual(check.errors, []);
  assert.equal(check.clusterInfo.label, 'DEVNET');
  assert.deepEqual(check.steps.map((s) => s.instructions.map((d) => d.name)), [['Initialize'], ['SetFee', 'SetFundingAuthority', 'CreateTokenMetadata']]);
  assert.deepEqual(check.steps[0].initialize, { pool: A.stakePool.toBase58(), manager: A.manager.toBase58(), staker: A.staker.toBase58(), managerFeeAccount: A.managerFeeAccount.toBase58() });
  assert.equal(check.steps[1].managerSigned, true);
  assert.deepEqual(check.steps[1].pools, [A.stakePool.toBase58()]);
  const text = describePlan(check, { fingerprint: 'AAAA BBBB CCCC DDDD' });
  assert.match(text, /^DEVNET {3}fingerprint AAAA BBBB CCCC DDDD/);
  assert.match(text, /Withdrawal fee \(SOL and stake\): 3\/1000 = 0\.3%/);
  assert.match(text, new RegExp(`manager: ${A.manager.toBase58()}  SIGNER`));
});

t('the cluster is never guessed: a plan without one, or with another word, is refused', () => {
  assert.match(errorsOf((p) => { delete p.cluster; }), /does not name its cluster/);
  assert.match(errorsOf((p) => { p.cluster = 'testnet'; }), /does not name its cluster/);
  assert.equal(P.checkPlan(JSON.parse(planText(devPlan()).replace('"cluster": "devnet"', '"cluster": "Mainnet"'))).clusterInfo, null);
  assert.match(errorsOf((p) => { p.genesisHash = CLUSTERS.mainnet.genesisHash; }), /genesis hash is not DEVNET/);
  assert.match(errorsOf((p) => { p.chain = 'solana:mainnet'; }), /wallet chain is not solana:devnet/);
  assert.match(errorsOf((p) => { p.rpcUrl = 'http://example.test'; }), /no https RPC/);
  assert.match(errorsOf((p) => { p.format = 'something/2'; }), /unknown plan format/);
  assert.match(P.checkPlan(null).errors[0], /not a JSON object/);
});

t('mainnet needs the opt-in on the Mac (POOL_ALLOW_MAINNET=yes), and the plan carries it', () => {
  const M = build(MAIN);
  const before = process.env.POOL_ALLOW_MAINNET;
  delete process.env.POOL_ALLOW_MAINNET;
  assert.throws(() => buildPlan(ctx('mainnet'), { kind: 'create-pool', signer: A.manager, steps: createSteps(M) }), /POOL_ALLOW_MAINNET=yes/);
  process.env.POOL_ALLOW_MAINNET = 'true'; // only the exact word counts
  assert.throws(() => buildPlan(ctx('mainnet'), { kind: 'create-pool', signer: A.manager, steps: createSteps(M) }), /POOL_ALLOW_MAINNET=yes/);
  process.env.POOL_ALLOW_MAINNET = 'yes';
  const plan = buildPlan(ctx('mainnet'), { kind: 'create-pool', signer: A.manager, steps: createSteps(M) });
  if (before === undefined) delete process.env.POOL_ALLOW_MAINNET; else process.env.POOL_ALLOW_MAINNET = before;
  assert.equal(plan.allowMainnet, 'yes');
  assert.equal(plan.chain, CHAIN.mainnet);
  const check = P.checkPlan(plan);
  assert.deepEqual(check.errors, []);
  assert.equal(check.clusterInfo.label, 'MAINNET');
  // the phone refuses the same plan with the opt-in removed, and a devnet plan relabelled as mainnet
  const stripped = { ...plan }; delete stripped.allowMainnet;
  assert.match(P.checkPlan(stripped).errors.join('\n'), /MAINNET plan made without POOL_ALLOW_MAINNET=yes/);
  const relabelled = { ...devPlan(), cluster: 'mainnet', chain: CHAIN.mainnet, genesisHash: CLUSTERS.mainnet.genesisHash, allowMainnet: 'yes' };
  assert.match(P.checkPlan(relabelled).errors.join('\n'), /not the MAINNET stake-pool program/);
  assert.match(errorsOf((p) => { p.allowMainnet = 'yes'; }), /allowMainnet is set on a plan that is not mainnet/);
});

t('one signer only: an instruction that needs any other signature is refused', () => {
  assert.throws(() => buildPlan(ctx('devnet'), { kind: 'create-pool', signer: A.feeOwner, steps: createSteps() }), /needs a signature from/);
  // a fee collection is signed by the fee owner, so a plan for the manager cannot carry it
  assert.throws(() => buildPlan(ctx('devnet'), { kind: 'collect-fees', signer: A.manager, steps: [{ title: 'c', instructions: [{ label: 'c', instruction: I.collect }] }] }), /owner of the tokens being burned/);
  const ok = buildPlan(ctx('devnet'), { kind: 'collect-fees', signer: A.feeOwner, steps: [{ title: 'c', instructions: [{ label: 'c', instruction: I.collect }] }] });
  const check = P.checkPlan(ok);
  assert.ok(check.ok && !check.steps[0].managerSigned && !check.steps[0].initialize);
  assert.match(errorsOf((p) => { p.signer = 'nope'; }), /does not name the account that must sign/);
});

t('Initialize must be alone in its transaction and must be the first step', () => {
  const s = createSteps();
  assert.throws(() => buildPlan(ctx('devnet'), { kind: 'x', signer: A.manager, steps: [{ title: 'all', instructions: [...s[0].instructions, ...s[1].instructions] }] }), /Initialize must be alone/);
  assert.throws(() => buildPlan(ctx('devnet'), { kind: 'x', signer: A.manager, steps: [s[1], s[0]] }), /Initialize must be the first step/);
  assert.throws(() => buildPlan(ctx('devnet'), { kind: 'x', signer: A.manager, steps: [s[0], s[0]] }), /Initialize must be the first step/);
  assert.ok(P.checkPlan(buildPlan(ctx('devnet'), { kind: 'x', signer: A.manager, steps: [s[1]] })).ok); // resumed after Initialize
});

t('a plan with anything undecoded, empty, or about two pools is refused', () => {
  assert.match(errorsOf((p) => { p.steps[1].instructions[0].programId = TOKEN_PROGRAM_ID.toBase58(); }), /not the DEVNET stake-pool program/);
  assert.match(errorsOf((p) => { p.steps[1].instructions[0].dataHex = '0e' + u64(1); delete p.steps[1].instructions[0].dataBase58; }), /not one this page knows/);
  assert.match(errorsOf((p) => { p.steps[1].instructions = []; }), /step 2 has no instructions/);
  assert.match(errorsOf((p) => { p.steps = []; }), /no steps/);
  assert.match(errorsOf((p) => { p.steps[1].instructions[0].accounts[0].pubkey = k().toBase58(); }), /more than one stake pool/);
  assert.match(errorsOf((p) => { p.steps[1].instructions[2].dataHex = p.steps[1].instructions[2].dataHex.slice(0, -4); }), /disagree/);
});

t('readPoolHead agrees with the full StakePool decoder on the fields the phone checks', () => {
  const f = { manager: k(), staker: k(), dep: k(), list: k(), reserve: k(), mint: k(), feeAcc: k() };
  const buf = Buffer.concat([new BorshWriter().u8(1).pubkey(f.manager).pubkey(f.staker).pubkey(f.dep).u8(254).pubkey(f.list).pubkey(f.reserve).pubkey(f.mint).pubkey(f.feeAcc).pubkey(TOKEN_PROGRAM_ID)
    .u64(1n).u64(1n).u64(1172).u64(0).u64(0).pubkey(k()).fee(ixs.fee(1, 1)).u8(0).u8(0).u8(0).fee(ixs.fee(0, 0)).fee(ixs.fee(3, 1000)).u8(0).u8(0).u8(0).fee(ixs.fee(0, 0)).u8(0).u8(0).fee(ixs.fee(3, 1000)).u8(0).u64(0).u64(0)
    .done(), Buffer.alloc(120)]);
  const full = decodeStakePool(buf), head = P.readPoolHead(new Uint8Array(buf));
  assert.equal(head.accountType, 1);
  assert.equal(head.manager, full.manager.toBase58());
  assert.equal(head.staker, full.staker.toBase58());
  assert.equal(head.stakeDepositAuthority, full.stakeDepositAuthority.toBase58());
  assert.equal(head.validatorList, full.validatorList.toBase58());
  assert.equal(head.reserveStake, full.reserveStake.toBase58());
  assert.equal(head.poolMint, full.poolMint.toBase58());
  assert.equal(head.managerFeeAccount, full.managerFeeAccount.toBase58());
  assert.equal(P.readPoolHead(new Uint8Array(611)).accountType, 0); // a created, not yet initialized pool account
  assert.equal(P.readPoolHead(new Uint8Array(0)).accountType, -1);
});

console.log(`\n${passed} passed`);
