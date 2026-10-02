// Instruction builders for the SPL stake-pool program, encoded by hand from
// https://github.com/solana-program/stake-pool/blob/program%40v2.1.0/program/src/instruction.rs
// (enum StakePoolInstruction, Borsh, u8 variant index) and state.rs (Fee, FeeType).
// Account lists mirror the Rust builder functions of the same name in that file.
//
// Why not just the JS SDK? @solana/spl-stake-pool@1.1.8 hardcodes the mainnet program id
// (SPoo1…) in every builder, has no Initialize / SetFee / SetFundingAuthority / slippage
// variants, and its ValidatorList layout predates validator_seed_suffix. Every builder here
// takes `programId` explicitly so the same code drives devnet (DPoo1…) and mainnet (SPoo1…).
import {
  PublicKey,
  SystemProgram,
  StakeProgram,
  TransactionInstruction,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_STAKE_HISTORY_PUBKEY,
  STAKE_CONFIG_ID,
} from '@solana/web3.js';
import { BorshWriter, toU64 } from './borsh.mjs';

export const STAKE_POOL_PROGRAM_ID_MAINNET = new PublicKey('SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy');
export const STAKE_POOL_PROGRAM_ID_DEVNET = new PublicKey('DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib');
export const METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

// enum StakePoolInstruction, in declaration order (instruction.rs L52-L736 @ v2.1.0).
export const IX = Object.freeze({
  Initialize: 0,
  AddValidatorToPool: 1,
  RemoveValidatorFromPool: 2,
  DecreaseValidatorStake: 3, // deprecated
  IncreaseValidatorStake: 4,
  SetPreferredValidator: 5,
  UpdateValidatorListBalance: 6,
  UpdateStakePoolBalance: 7,
  CleanupRemovedValidatorEntries: 8,
  DepositStake: 9,
  WithdrawStake: 10,
  SetManager: 11,
  SetFee: 12,
  SetStaker: 13,
  DepositSol: 14,
  SetFundingAuthority: 15,
  WithdrawSol: 16,
  CreateTokenMetadata: 17,
  UpdateTokenMetadata: 18,
  IncreaseAdditionalValidatorStake: 19,
  DecreaseAdditionalValidatorStake: 20,
  DecreaseValidatorStakeWithReserve: 21,
  Redelegate: 22, // deprecated, never enabled
  DepositStakeWithSlippage: 23,
  WithdrawStakeWithSlippage: 24,
  DepositSolWithSlippage: 25,
  WithdrawSolWithSlippage: 26,
});

// state.rs enum FeeType (L1028-L1043).
export const FEE_TYPE = Object.freeze({
  SolReferral: 0, // u8 percent
  StakeReferral: 1, // u8 percent
  Epoch: 2, // Fee
  StakeWithdrawal: 3, // Fee
  SolDeposit: 4, // Fee
  StakeDeposit: 5, // Fee
  SolWithdrawal: 6, // Fee
});

// instruction.rs enum FundingType (L40-L47).
export const FUNDING_TYPE = Object.freeze({ StakeDeposit: 0, SolDeposit: 1, SolWithdraw: 2 });

// lib.rs constants @ v2.1.0
export const MINIMUM_ACTIVE_STAKE = 1_000_000n;
export const MAX_VALIDATORS_TO_UPDATE = 4; // v2.0.x had 5; 4 is safe for both
export const STAKE_ACCOUNT_SPACE = 200; // size_of::<StakeStateV2>()

// Account sizes for creation (get_packed_len). StakePool = 611 bytes; ValidatorList =
// 5 (header) + 4 (vec len) + 73 * max_validators.
export const STAKE_POOL_SPACE = 611;
export const VALIDATOR_STAKE_INFO_LEN = 73;
export const validatorListSpace = (maxValidators) => 5 + 4 + VALIDATOR_STAKE_INFO_LEN * maxValidators;

// ---------- program-derived addresses (lib.rs L91-L163) ----------
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(toU64(n)); return b; };

export function findWithdrawAuthority(programId, pool) {
  return PublicKey.findProgramAddressSync([pool.toBuffer(), Buffer.from('withdraw')], programId)[0];
}
export function findDepositAuthority(programId, pool) {
  return PublicKey.findProgramAddressSync([pool.toBuffer(), Buffer.from('deposit')], programId)[0];
}
// seed: Option<NonZeroU32>; 0 means None (no seed bytes)
export function findValidatorStake(programId, vote, pool, seed = 0) {
  const seeds = [vote.toBuffer(), pool.toBuffer()];
  if (seed) seeds.push(u32le(seed));
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}
export function findTransientStake(programId, vote, pool, seed) {
  return PublicKey.findProgramAddressSync([Buffer.from('transient'), vote.toBuffer(), pool.toBuffer(), u64le(seed)], programId)[0];
}
export function findEphemeralStake(programId, pool, seed) {
  return PublicKey.findProgramAddressSync([Buffer.from('ephemeral'), pool.toBuffer(), u64le(seed)], programId)[0];
}
// inline_mpl_token_metadata.rs pda::find_metadata_account
export function findMetadata(mint) {
  return PublicKey.findProgramAddressSync([Buffer.from('metadata'), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], METADATA_PROGRAM_ID)[0];
}

// ---------- helpers ----------
const w = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
const r = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
const s = (pubkey) => ({ pubkey, isSigner: true, isWritable: false });
const sw = (pubkey) => ({ pubkey, isSigner: true, isWritable: true });
const ix = (programId, keys, data) => new TransactionInstruction({ programId, keys, data });

export function fee(numerator, denominator) {
  return { numerator: toU64(numerator), denominator: toU64(denominator) };
}

// ---------- data encoders (exported for byte-level tests) ----------
export const encode = {
  initialize: ({ epochFee, withdrawalFee, depositFee, referralFee, maxValidators }) =>
    new BorshWriter().u8(IX.Initialize).fee(epochFee).fee(withdrawalFee).fee(depositFee).u8(referralFee).u32(maxValidators).done(),
  addValidatorToPool: (seed) => new BorshWriter().u8(IX.AddValidatorToPool).u32(seed).done(),
  increaseValidatorStake: (lamports, transientSeed) => new BorshWriter().u8(IX.IncreaseValidatorStake).u64(lamports).u64(transientSeed).done(),
  increaseAdditionalValidatorStake: (lamports, transientSeed, ephemeralSeed) =>
    new BorshWriter().u8(IX.IncreaseAdditionalValidatorStake).u64(lamports).u64(transientSeed).u64(ephemeralSeed).done(),
  decreaseValidatorStakeWithReserve: (lamports, transientSeed) =>
    new BorshWriter().u8(IX.DecreaseValidatorStakeWithReserve).u64(lamports).u64(transientSeed).done(),
  decreaseAdditionalValidatorStake: (lamports, transientSeed, ephemeralSeed) =>
    new BorshWriter().u8(IX.DecreaseAdditionalValidatorStake).u64(lamports).u64(transientSeed).u64(ephemeralSeed).done(),
  updateValidatorListBalance: (startIndex, noMerge) => new BorshWriter().u8(IX.UpdateValidatorListBalance).u32(startIndex).bool(noMerge).done(),
  updateStakePoolBalance: () => Buffer.from([IX.UpdateStakePoolBalance]),
  cleanupRemovedValidatorEntries: () => Buffer.from([IX.CleanupRemovedValidatorEntries]),
  withdrawStake: (poolTokens) => new BorshWriter().u8(IX.WithdrawStake).u64(poolTokens).done(),
  withdrawStakeWithSlippage: (poolTokens, minLamportsOut) => new BorshWriter().u8(IX.WithdrawStakeWithSlippage).u64(poolTokens).u64(minLamportsOut).done(),
  depositSol: (lamports) => new BorshWriter().u8(IX.DepositSol).u64(lamports).done(),
  depositSolWithSlippage: (lamports, minPoolTokensOut) => new BorshWriter().u8(IX.DepositSolWithSlippage).u64(lamports).u64(minPoolTokensOut).done(),
  withdrawSol: (poolTokens) => new BorshWriter().u8(IX.WithdrawSol).u64(poolTokens).done(),
  withdrawSolWithSlippage: (poolTokens, minLamportsOut) => new BorshWriter().u8(IX.WithdrawSolWithSlippage).u64(poolTokens).u64(minLamportsOut).done(),
  // SetFee { fee: FeeType } -> [12, variant, payload]
  setFee: (feeType, value) => {
    const wr = new BorshWriter().u8(IX.SetFee).u8(feeType);
    if (feeType === FEE_TYPE.SolReferral || feeType === FEE_TYPE.StakeReferral) wr.u8(value);
    else wr.fee(value);
    return wr.done();
  },
  setFundingAuthority: (fundingType) => new BorshWriter().u8(IX.SetFundingAuthority).u8(fundingType).done(),
  setManager: () => Buffer.from([IX.SetManager]),
  setStaker: () => Buffer.from([IX.SetStaker]),
  createTokenMetadata: (name, symbol, uri) => new BorshWriter().u8(IX.CreateTokenMetadata).string(name).string(symbol).string(uri).done(),
  updateTokenMetadata: (name, symbol, uri) => new BorshWriter().u8(IX.UpdateTokenMetadata).string(name).string(symbol).string(uri).done(),
};

// ---------- instruction builders (accounts per instruction.rs @ v2.1.0) ----------

// initialize() L739-L784
export function initialize(p) {
  const keys = [
    w(p.stakePool),
    s(p.manager),
    r(p.staker),
    r(p.withdrawAuthority),
    w(p.validatorList),
    r(p.reserveStake),
    w(p.poolMint),
    w(p.managerFeeAccount),
    r(p.tokenProgramId),
  ];
  if (p.depositAuthority) keys.push(s(p.depositAuthority));
  return ix(p.programId, keys, encode.initialize(p));
}

// add_validator_to_pool() L788-L824
export function addValidatorToPool(p) {
  return ix(p.programId, [
    w(p.stakePool),
    s(p.staker),
    w(p.reserveStake),
    r(p.withdrawAuthority),
    w(p.validatorList),
    w(p.validatorStake),
    r(p.validatorVote),
    r(SYSVAR_RENT_PUBKEY),
    r(SYSVAR_CLOCK_PUBKEY),
    r(SYSVAR_STAKE_HISTORY_PUBKEY),
    r(STAKE_CONFIG_ID),
    r(SystemProgram.programId),
    r(StakeProgram.programId),
  ], encode.addValidatorToPool(p.seed ?? 0));
}

// increase_validator_stake() L976-L1015
export function increaseValidatorStake(p) {
  return ix(p.programId, [
    r(p.stakePool),
    s(p.staker),
    r(p.withdrawAuthority),
    w(p.validatorList),
    w(p.reserveStake),
    w(p.transientStake),
    r(p.validatorStake),
    r(p.validatorVote),
    r(SYSVAR_CLOCK_PUBKEY),
    r(SYSVAR_RENT_PUBKEY),
    r(SYSVAR_STAKE_HISTORY_PUBKEY),
    r(STAKE_CONFIG_ID),
    r(SystemProgram.programId),
    r(StakeProgram.programId),
  ], encode.increaseValidatorStake(p.lamports, p.transientStakeSeed));
}

// increase_additional_validator_stake() L1019-L1061
export function increaseAdditionalValidatorStake(p) {
  return ix(p.programId, [
    r(p.stakePool),
    s(p.staker),
    r(p.withdrawAuthority),
    w(p.validatorList),
    w(p.reserveStake),
    w(p.ephemeralStake),
    w(p.transientStake),
    r(p.validatorStake),
    r(p.validatorVote),
    r(SYSVAR_CLOCK_PUBKEY),
    r(SYSVAR_STAKE_HISTORY_PUBKEY),
    r(STAKE_CONFIG_ID),
    r(SystemProgram.programId),
    r(StakeProgram.programId),
  ], encode.increaseAdditionalValidatorStake(p.lamports, p.transientStakeSeed, p.ephemeralStakeSeed));
}

// decrease_validator_stake_with_reserve() L938-L972
export function decreaseValidatorStakeWithReserve(p) {
  return ix(p.programId, [
    r(p.stakePool),
    s(p.staker),
    r(p.withdrawAuthority),
    w(p.validatorList),
    w(p.reserveStake),
    w(p.validatorStake),
    w(p.transientStake),
    r(SYSVAR_CLOCK_PUBKEY),
    r(SYSVAR_STAKE_HISTORY_PUBKEY),
    r(SystemProgram.programId),
    r(StakeProgram.programId),
  ], encode.decreaseValidatorStakeWithReserve(p.lamports, p.transientStakeSeed));
}

// decrease_additional_validator_stake() L896-L934
export function decreaseAdditionalValidatorStake(p) {
  return ix(p.programId, [
    r(p.stakePool),
    s(p.staker),
    r(p.withdrawAuthority),
    w(p.validatorList),
    w(p.reserveStake),
    w(p.validatorStake),
    w(p.ephemeralStake),
    w(p.transientStake),
    r(SYSVAR_CLOCK_PUBKEY),
    r(SYSVAR_STAKE_HISTORY_PUBKEY),
    r(SystemProgram.programId),
    r(StakeProgram.programId),
  ], encode.decreaseAdditionalValidatorStake(p.lamports, p.transientStakeSeed, p.ephemeralStakeSeed));
}

// update_validator_list_balance_chunk() L1502-L1560; `pairs` = [[validatorStake, transientStake], …]
export function updateValidatorListBalance(p) {
  const keys = [
    r(p.stakePool),
    r(p.withdrawAuthority),
    w(p.validatorList),
    w(p.reserveStake),
    r(SYSVAR_CLOCK_PUBKEY),
    r(SYSVAR_STAKE_HISTORY_PUBKEY),
    r(StakeProgram.programId),
  ];
  for (const [validatorStake, transientStake] of p.pairs) keys.push(w(validatorStake), w(transientStake));
  return ix(p.programId, keys, encode.updateValidatorListBalance(p.startIndex, !!p.noMerge));
}

// update_stake_pool_balance() L1605-L1629
export function updateStakePoolBalance(p) {
  return ix(p.programId, [
    w(p.stakePool),
    r(p.withdrawAuthority),
    w(p.validatorList),
    r(p.reserveStake),
    w(p.managerFeeAccount),
    w(p.poolMint),
    r(p.tokenProgramId),
  ], encode.updateStakePoolBalance());
}

// cleanup_removed_validator_entries() L1633-L1647
export function cleanupRemovedValidatorEntries(p) {
  return ix(p.programId, [w(p.stakePool), w(p.validatorList)], encode.cleanupRemovedValidatorEntries());
}

// deposit_sol_internal() L2015-L2062 (without SOL deposit authority)
export function depositSol(p) {
  const keys = [
    w(p.stakePool),
    r(p.withdrawAuthority),
    w(p.reserveStake),
    sw(p.lamportsFrom),
    w(p.poolTokensTo),
    w(p.managerFeeAccount),
    w(p.referrerPoolTokensAccount ?? p.poolTokensTo),
    w(p.poolMint),
    r(SystemProgram.programId),
    r(p.tokenProgramId),
  ];
  if (p.solDepositAuthority) keys.push(s(p.solDepositAuthority));
  const data = p.minimumPoolTokensOut == null
    ? encode.depositSol(p.lamports)
    : encode.depositSolWithSlippage(p.lamports, p.minimumPoolTokensOut);
  return ix(p.programId, keys, data);
}

// withdraw_sol_internal() L2315-L2364
export function withdrawSol(p) {
  const keys = [
    w(p.stakePool),
    r(p.withdrawAuthority),
    s(p.userTransferAuthority),
    w(p.poolTokensFrom),
    w(p.reserveStake),
    w(p.lamportsTo),
    w(p.managerFeeAccount),
    w(p.poolMint),
    r(SYSVAR_CLOCK_PUBKEY),
    r(SYSVAR_STAKE_HISTORY_PUBKEY),
    r(StakeProgram.programId),
    r(p.tokenProgramId),
  ];
  if (p.solWithdrawAuthority) keys.push(s(p.solWithdrawAuthority));
  const data = p.minimumLamportsOut == null
    ? encode.withdrawSol(p.poolTokens)
    : encode.withdrawSolWithSlippage(p.poolTokens, p.minimumLamportsOut);
  return ix(p.programId, keys, data);
}

// withdraw_stake_internal() L2196-L2244
export function withdrawStake(p) {
  const keys = [
    w(p.stakePool),
    w(p.validatorList),
    r(p.withdrawAuthority),
    w(p.stakeToSplit),
    w(p.stakeToReceive),
    r(p.userStakeAuthority),
    s(p.userTransferAuthority),
    w(p.userPoolTokenAccount),
    w(p.managerFeeAccount),
    w(p.poolMint),
    r(SYSVAR_CLOCK_PUBKEY),
    r(p.tokenProgramId),
    r(StakeProgram.programId),
  ];
  const data = p.minimumLamportsOut == null
    ? encode.withdrawStake(p.poolTokens)
    : encode.withdrawStakeWithSlippage(p.poolTokens, p.minimumLamportsOut);
  return ix(p.programId, keys, data);
}

// set_fee() L2522-L2537
export function setFee(p) {
  return ix(p.programId, [w(p.stakePool), s(p.manager)], encode.setFee(p.feeType, p.value));
}

// set_funding_authority() L2559-L2578; newAuthority null => unset (back to default)
export function setFundingAuthority(p) {
  const keys = [w(p.stakePool), s(p.manager)];
  if (p.newAuthority) keys.push(r(p.newAuthority));
  return ix(p.programId, keys, encode.setFundingAuthority(p.fundingType));
}

// set_manager() L2501-L2519 — both the current and the new manager must sign
export function setManager(p) {
  return ix(p.programId, [w(p.stakePool), s(p.manager), s(p.newManager), r(p.newManagerFeeAccount)], encode.setManager());
}

// set_staker() L2540-L2556 — manager or current staker signs
export function setStaker(p) {
  return ix(p.programId, [w(p.stakePool), s(p.authority), r(p.newStaker)], encode.setStaker());
}

// create_token_metadata() L2613-L2644 (8 accounts; the JS SDK appends a legacy rent sysvar)
export function createTokenMetadata(p) {
  return ix(p.programId, [
    r(p.stakePool),
    s(p.manager),
    r(p.withdrawAuthority),
    r(p.poolMint),
    sw(p.payer),
    w(findMetadata(p.poolMint)),
    r(METADATA_PROGRAM_ID),
    r(SystemProgram.programId),
  ], encode.createTokenMetadata(p.name, p.symbol, p.uri));
}

// update_token_metadata() L2582-L2609
export function updateTokenMetadata(p) {
  return ix(p.programId, [
    r(p.stakePool),
    s(p.manager),
    r(p.withdrawAuthority),
    w(findMetadata(p.poolMint)),
    r(METADATA_PROGRAM_ID),
  ], encode.updateTokenMetadata(p.name, p.symbol, p.uri));
}
