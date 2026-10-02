// Offline byte-layout tests for the hand-encoded stake-pool instructions and decoders.
// 1. Instructions the JS SDK lacks are checked against hex vectors written out by hand from
//    program@v2.1.0 instruction.rs / state.rs (Borsh: u8 variant, LE ints, Fee = {den, num}).
// 2. Instructions the SDK has are checked byte-for-byte (data AND account metas) against
//    @solana/spl-stake-pool@1.1.8, with the program id swapped in.
// 3. The StakePool decoder is checked against the SDK's StakePoolLayout on the same bytes.
// Run: node test/encoding.test.mjs
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { StakePoolInstruction, StakePoolLayout, ValidatorListLayout } from '@solana/spl-stake-pool';
import * as ixs from '../lib/ix.mjs';
import { BorshWriter } from '../lib/borsh.mjs';
import { decodeStakePool, decodeValidatorList } from '../lib/state.mjs';

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log(`ok - ${name}`); };
const hex = (b) => Buffer.from(b).toString('hex');
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return hex(b); };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return hex(b); };
const str = (s) => u32(Buffer.byteLength(s)) + hex(Buffer.from(s, 'utf8'));
const k = () => Keypair.generate().publicKey;
const PID = ixs.STAKE_POOL_PROGRAM_ID_DEVNET;

// ---------- 1. hand-written vectors ----------
t('Initialize: epoch 1/1, withdrawal 3/1000, deposit 0/0, referral 0, max 4', () => {
  const data = ixs.encode.initialize({ epochFee: ixs.fee(1, 1), withdrawalFee: ixs.fee(3, 1000), depositFee: ixs.fee(0, 0), referralFee: 0, maxValidators: 4 });
  const want = '00' + u64(1) + u64(1) + u64(1000) + u64(3) + u64(0) + u64(0) + '00' + u32(4);
  assert.equal(hex(data), want);
  assert.equal(data.length, 54);
  // spot-check the denominator-first order: bytes 17..24 are the withdrawal DENOMINATOR (1000 = 0x03e8)
  assert.equal(hex(data.subarray(17, 25)), 'e803000000000000');
});

t('SetFee StakeWithdrawal 0/100 = [12, 3, den, num]', () => {
  const data = ixs.encode.setFee(ixs.FEE_TYPE.StakeWithdrawal, ixs.fee(0, 100));
  assert.equal(hex(data), '0c' + '03' + u64(100) + u64(0));
});

t('SetFee Epoch 1/1 and SolWithdrawal 3/1000', () => {
  assert.equal(hex(ixs.encode.setFee(ixs.FEE_TYPE.Epoch, ixs.fee(1, 1))), '0c02' + u64(1) + u64(1));
  assert.equal(hex(ixs.encode.setFee(ixs.FEE_TYPE.SolWithdrawal, ixs.fee(3, 1000))), '0c06' + u64(1000) + u64(3));
});

t('SetFee SolReferral 0 is a u8 payload', () => {
  assert.equal(hex(ixs.encode.setFee(ixs.FEE_TYPE.SolReferral, 0)), '0c0000');
});

t('SetFundingAuthority StakeDeposit = [15, 0]; accounts pool(w), manager(s), new authority(r)', () => {
  const pool = k(), manager = k(), auth = k();
  const i = ixs.setFundingAuthority({ programId: PID, stakePool: pool, manager, newAuthority: auth, fundingType: ixs.FUNDING_TYPE.StakeDeposit });
  assert.equal(hex(i.data), '0f00');
  assert.deepEqual(i.keys.map((m) => [m.pubkey.toBase58(), m.isSigner, m.isWritable]), [[pool.toBase58(), false, true], [manager.toBase58(), true, false], [auth.toBase58(), false, false]]);
  assert.equal(hex(ixs.encode.setFundingAuthority(ixs.FUNDING_TYPE.SolWithdraw)), '0f02');
});

t('CreateTokenMetadata = [17] + 3 Borsh strings', () => {
  const data = ixs.encode.createTokenMetadata('Isabella Ocean Pass', 'OCEAN', 'https://isabella.app/ocean-pass.json');
  assert.equal(hex(data), '11' + str('Isabella Ocean Pass') + str('OCEAN') + str('https://isabella.app/ocean-pass.json'));
});

t('DepositSolWithSlippage = [25, lamports, min]; WithdrawSolWithSlippage = [26, tokens, min]; WithdrawStakeWithSlippage = [24, tokens, min]', () => {
  assert.equal(hex(ixs.encode.depositSolWithSlippage(1_010_000_000n, 1_009_000_000n)), '19' + u64(1_010_000_000n) + u64(1_009_000_000n));
  assert.equal(hex(ixs.encode.withdrawSolWithSlippage(5n, 4n)), '1a' + u64(5) + u64(4));
  assert.equal(hex(ixs.encode.withdrawStakeWithSlippage(5n, 4n)), '18' + u64(5) + u64(4));
});

t('Initialize account metas follow instruction.rs initialize()', () => {
  const p = { programId: PID, stakePool: k(), manager: k(), staker: k(), withdrawAuthority: k(), validatorList: k(), reserveStake: k(), poolMint: k(), managerFeeAccount: k(), tokenProgramId: TOKEN_PROGRAM_ID, epochFee: ixs.fee(1, 1), withdrawalFee: ixs.fee(3, 1000), depositFee: ixs.fee(0, 0), referralFee: 0, maxValidators: 4 };
  const i = ixs.initialize(p);
  const flags = i.keys.map((m) => `${m.isSigner ? 's' : ''}${m.isWritable ? 'w' : ''}` || 'r');
  assert.deepEqual(flags, ['w', 's', 'r', 'r', 'w', 'r', 'w', 'w', 'r']);
  assert.ok(i.programId.equals(PID));
});

t('u64 guard rejects unsafe JS numbers and negatives', () => {
  assert.throws(() => new BorshWriter().u64(2 ** 60));
  assert.throws(() => new BorshWriter().u64(-1));
  assert.equal(hex(new BorshWriter().u64(2n ** 64n - 1n).done()), 'ffffffffffffffff');
});

t('validator list size for max 4 validators is 301 bytes', () => {
  assert.equal(ixs.validatorListSpace(4), 301);
});

// ---------- 2. cross-check against @solana/spl-stake-pool@1.1.8 ----------
function sameIx(mine, sdk, { ignoreTrailing = 0, writableDiffs = [] } = {}) {
  assert.equal(hex(mine.data), hex(sdk.data), 'data bytes');
  const sdkKeys = ignoreTrailing ? sdk.keys.slice(0, sdk.keys.length - ignoreTrailing) : sdk.keys;
  assert.equal(mine.keys.length, sdkKeys.length, 'account count');
  mine.keys.forEach((m, i) => {
    assert.ok(m.pubkey.equals(sdkKeys[i].pubkey), `account ${i} pubkey`);
    assert.equal(m.isSigner, sdkKeys[i].isSigner, `account ${i} signer`);
    if (!writableDiffs.includes(i)) assert.equal(m.isWritable, sdkKeys[i].isWritable, `account ${i} writable`);
  });
}
const A = { stakePool: k(), staker: k(), withdrawAuthority: k(), validatorList: k(), reserveStake: k(), validatorStake: k(), transientStake: k(), validatorVote: k(), ephemeralStake: k(), managerFeeAccount: k(), poolMint: k() };

t('AddValidatorToPool matches SDK', () => {
  const sdk = StakePoolInstruction.addValidatorToPool({ ...A, seed: 0 });
  sameIx(ixs.addValidatorToPool({ ...A, programId: PID, seed: 0 }), sdk);
});
t('IncreaseValidatorStake matches SDK', () => {
  const sdk = StakePoolInstruction.increaseValidatorStake({ ...A, lamports: 1_234_567_890, transientStakeSeed: 7 });
  sameIx(ixs.increaseValidatorStake({ ...A, programId: PID, lamports: 1_234_567_890n, transientStakeSeed: 7n }), sdk);
});
t('IncreaseAdditionalValidatorStake matches SDK', () => {
  const sdk = StakePoolInstruction.increaseAdditionalValidatorStake({ ...A, lamports: 2_000_000_000, transientStakeSeed: 3, ephemeralStakeSeed: 0 });
  sameIx(ixs.increaseAdditionalValidatorStake({ ...A, programId: PID, lamports: 2_000_000_000n, transientStakeSeed: 3n, ephemeralStakeSeed: 0n }), sdk);
});
t('DecreaseValidatorStakeWithReserve matches SDK', () => {
  const sdk = StakePoolInstruction.decreaseValidatorStakeWithReserve({ ...A, lamports: 1_000_000_000, transientStakeSeed: 9 });
  sameIx(ixs.decreaseValidatorStakeWithReserve({ ...A, programId: PID, lamports: 1_000_000_000n, transientStakeSeed: 9n }), sdk);
});
t('DecreaseAdditionalValidatorStake matches SDK', () => {
  const sdk = StakePoolInstruction.decreaseAdditionalValidatorStake({ ...A, lamports: 1_000_000_000, transientStakeSeed: 9, ephemeralStakeSeed: 0 });
  sameIx(ixs.decreaseAdditionalValidatorStake({ ...A, programId: PID, lamports: 1_000_000_000n, transientStakeSeed: 9n, ephemeralStakeSeed: 0n }), sdk);
});
t('UpdateValidatorListBalance matches SDK', () => {
  const pairs = [[k(), k()], [k(), k()]];
  const sdk = StakePoolInstruction.updateValidatorListBalance({ ...A, validatorAndTransientStakePairs: pairs.flat(), startIndex: 0, noMerge: false });
  sameIx(ixs.updateValidatorListBalance({ ...A, programId: PID, pairs, startIndex: 0, noMerge: false }), sdk);
});
t('UpdateStakePoolBalance matches SDK', () => {
  const sdk = StakePoolInstruction.updateStakePoolBalance({ ...A });
  sameIx(ixs.updateStakePoolBalance({ ...A, programId: PID, tokenProgramId: TOKEN_PROGRAM_ID }), sdk);
});
t('CleanupRemovedValidatorEntries matches SDK (Rust builder marks the pool writable, SDK read-only)', () => {
  const sdk = StakePoolInstruction.cleanupRemovedValidatorEntries({ ...A });
  sameIx(ixs.cleanupRemovedValidatorEntries({ ...A, programId: PID }), sdk, { writableDiffs: [0] });
});
t('DepositSol matches SDK', () => {
  const p = { ...A, fundingAccount: k(), destinationPoolAccount: k(), referralPoolAccount: k(), lamports: 1_010_000_000 };
  const sdk = StakePoolInstruction.depositSol(p);
  sameIx(ixs.depositSol({ programId: PID, stakePool: A.stakePool, withdrawAuthority: A.withdrawAuthority, reserveStake: A.reserveStake, lamportsFrom: p.fundingAccount, poolTokensTo: p.destinationPoolAccount, managerFeeAccount: A.managerFeeAccount, referrerPoolTokensAccount: p.referralPoolAccount, poolMint: A.poolMint, tokenProgramId: TOKEN_PROGRAM_ID, lamports: 1_010_000_000n }), sdk);
});
t('WithdrawSol matches SDK', () => {
  const p = { ...A, sourcePoolAccount: k(), sourceTransferAuthority: k(), destinationSystemAccount: k(), poolTokens: 1_000_000_000 };
  const sdk = StakePoolInstruction.withdrawSol(p);
  sameIx(ixs.withdrawSol({ programId: PID, stakePool: A.stakePool, withdrawAuthority: A.withdrawAuthority, userTransferAuthority: p.sourceTransferAuthority, poolTokensFrom: p.sourcePoolAccount, reserveStake: A.reserveStake, lamportsTo: p.destinationSystemAccount, managerFeeAccount: A.managerFeeAccount, poolMint: A.poolMint, tokenProgramId: TOKEN_PROGRAM_ID, poolTokens: 1_000_000_000n }), sdk);
});
t('WithdrawStake matches SDK', () => {
  const p = { ...A, destinationStake: k(), destinationStakeAuthority: k(), sourceTransferAuthority: k(), sourcePoolAccount: k(), poolTokens: 1_010_000_000 };
  const sdk = StakePoolInstruction.withdrawStake(p);
  sameIx(ixs.withdrawStake({ programId: PID, stakePool: A.stakePool, validatorList: A.validatorList, withdrawAuthority: A.withdrawAuthority, stakeToSplit: A.validatorStake, stakeToReceive: p.destinationStake, userStakeAuthority: p.destinationStakeAuthority, userTransferAuthority: p.sourceTransferAuthority, userPoolTokenAccount: p.sourcePoolAccount, managerFeeAccount: A.managerFeeAccount, poolMint: A.poolMint, tokenProgramId: TOKEN_PROGRAM_ID, poolTokens: 1_010_000_000n }), sdk);
});
t('CreateTokenMetadata data matches SDK; SDK appends a legacy rent sysvar the v2 processor ignores', () => {
  const manager = k(), payer = k();
  const sdk = StakePoolInstruction.createTokenMetadata({ stakePool: A.stakePool, manager, tokenMetadata: ixs.findMetadata(A.poolMint), withdrawAuthority: A.withdrawAuthority, poolMint: A.poolMint, payer, name: 'Isabella Ocean Pass', symbol: 'OCEAN', uri: 'https://isabella.app/ocean-pass.json' });
  sameIx(ixs.createTokenMetadata({ programId: PID, stakePool: A.stakePool, manager, withdrawAuthority: A.withdrawAuthority, poolMint: A.poolMint, payer, name: 'Isabella Ocean Pass', symbol: 'OCEAN', uri: 'https://isabella.app/ocean-pass.json' }), sdk, { ignoreTrailing: 1 });
});

// ---------- 3. decoders vs SDK layouts ----------
t('StakePool decoder agrees with SDK StakePoolLayout on hand-built bytes', () => {
  const f = { manager: k(), staker: k(), dep: k(), list: k(), reserve: k(), mint: k(), feeAcc: k(), tokenProg: TOKEN_PROGRAM_ID, custodian: k(), solDep: k() };
  const wr = new BorshWriter()
    .u8(1).pubkey(f.manager).pubkey(f.staker).pubkey(f.dep).u8(254).pubkey(f.list).pubkey(f.reserve).pubkey(f.mint).pubkey(f.feeAcc).pubkey(f.tokenProg)
    .u64(3_013_000_000n).u64(3_012_000_000n).u64(1172)
    .u64(0).u64(0).pubkey(f.custodian) // lockup (i64 0 encodes the same as u64 0)
    .fee({ numerator: 1n, denominator: 1n })
    .u8(0) // next_epoch_fee None
    .u8(0).u8(0) // preferred validators None
    .fee({ numerator: 0n, denominator: 0n }) // stake deposit fee
    .fee({ numerator: 3n, denominator: 1000n }) // stake withdrawal fee
    .u8(2).fee({ numerator: 0n, denominator: 100n }) // next stake withdrawal fee: Two(0/100)
    .u8(0) // stake referral
    .u8(1).pubkey(f.solDep) // sol deposit authority Some
    .fee({ numerator: 0n, denominator: 0n }) // sol deposit fee
    .u8(0) // sol referral
    .u8(0) // sol withdraw authority None
    .fee({ numerator: 3n, denominator: 1000n }) // sol withdrawal fee
    .u8(0) // next sol withdrawal fee None
    .u64(11).u64(22);
  const buf = Buffer.concat([wr.done(), Buffer.alloc(80)]); // account is allocated larger than the Borsh payload
  const mine = decodeStakePool(buf);
  const sdk = StakePoolLayout.decode(buf);
  assert.ok(mine.manager.equals(sdk.manager) && mine.staker.equals(sdk.staker) && mine.stakeDepositAuthority.equals(sdk.stakeDepositAuthority));
  assert.equal(mine.stakeWithdrawBumpSeed, sdk.stakeWithdrawBumpSeed);
  assert.equal(mine.totalLamports.toString(), sdk.totalLamports.toString());
  assert.equal(mine.poolTokenSupply.toString(), sdk.poolTokenSupply.toString());
  assert.equal(mine.lastUpdateEpoch.toString(), sdk.lastUpdateEpoch.toString());
  assert.equal(mine.epochFee.numerator.toString(), sdk.epochFee.numerator.toString());
  assert.equal(mine.stakeWithdrawalFee.denominator.toString(), sdk.stakeWithdrawalFee.denominator.toString());
  assert.equal(mine.nextStakeWithdrawalFee.fee.denominator.toString(), sdk.nextStakeWithdrawalFee.denominator.toString());
  assert.equal(mine.nextStakeWithdrawalFee.boundariesLeft, 2);
  assert.ok(mine.solDepositAuthority.equals(sdk.solDepositAuthority));
  assert.equal(mine.solWithdrawalFee.numerator.toString(), sdk.solWithdrawalFee.numerator.toString());
  assert.equal(mine.lastEpochPoolTokenSupply.toString(), sdk.lastEpochPoolTokenSupply.toString());
  assert.equal(mine.lastEpochTotalLamports.toString(), sdk.lastEpochTotalLamports.toString());
});

t('ValidatorList decoder reads validator_seed_suffix the SDK layout mashes into transientSeedSuffixEnd', () => {
  const vote = k();
  const entry = Buffer.concat([
    Buffer.from(u64(1_001_666_240n), 'hex'), Buffer.from(u64(2_013_366_240n), 'hex'), Buffer.from(u64(1172), 'hex'), Buffer.from(u64(5), 'hex'),
    Buffer.from(u32(0), 'hex'), Buffer.from(u32(7), 'hex'), Buffer.from([0]), vote.toBuffer(),
  ]);
  assert.equal(entry.length, 73);
  const buf = Buffer.concat([Buffer.from([2]), Buffer.from(u32(4), 'hex'), Buffer.from(u32(1), 'hex'), entry, Buffer.alloc(73 * 3)]);
  const mine = decodeValidatorList(buf);
  assert.equal(mine.maxValidators, 4);
  assert.equal(mine.validators.length, 1);
  const v = mine.validators[0];
  assert.equal(v.activeStakeLamports, 1_001_666_240n);
  assert.equal(v.transientStakeLamports, 2_013_366_240n);
  assert.equal(v.transientSeedSuffix, 5n);
  assert.equal(v.validatorSeedSuffix, 7);
  assert.equal(v.statusName, 'Active');
  assert.ok(v.voteAccount.equals(vote));
  const sdk = ValidatorListLayout.decode(buf);
  assert.equal(sdk.validators[0].activeStakeLamports.toString(), '1001666240');
  assert.equal(sdk.validators[0].transientSeedSuffixStart.toString(), '5');
  assert.ok(sdk.validators[0].voteAccountAddress.equals(vote));
});

t('PDA seeds: validator stake with seed 0 equals seedless derivation', () => {
  const vote = k(), pool = k();
  const a = ixs.findValidatorStake(PID, vote, pool, 0);
  const b = PublicKey.findProgramAddressSync([vote.toBuffer(), pool.toBuffer()], PID)[0];
  assert.ok(a.equals(b));
});

console.log(`\n${passed} tests passed`);
