// Account decoders written from program@v2.1.0 state.rs (Borsh, sequential).
import { PublicKey } from '@solana/web3.js';
import { BorshReader } from './borsh.mjs';
import { VALIDATOR_STAKE_INFO_LEN, findMetadata } from './ix.mjs';

export const ACCOUNT_TYPE = ['Uninitialized', 'StakePool', 'ValidatorList'];
// state.rs enum StakeStatus (L577-L593)
export const STAKE_STATUS = ['Active', 'DeactivatingTransient', 'ReadyForRemoval', 'DeactivatingValidator', 'DeactivatingAll'];

// struct StakePool (state.rs L43-L157)
export function decodeStakePool(data) {
  const r = new BorshReader(data);
  const accountType = r.u8();
  if (accountType !== 1) return { accountType, accountTypeName: ACCOUNT_TYPE[accountType] ?? `?${accountType}` };
  const p = { accountType, accountTypeName: 'StakePool' };
  p.manager = r.pubkey();
  p.staker = r.pubkey();
  p.stakeDepositAuthority = r.pubkey();
  p.stakeWithdrawBumpSeed = r.u8();
  p.validatorList = r.pubkey();
  p.reserveStake = r.pubkey();
  p.poolMint = r.pubkey();
  p.managerFeeAccount = r.pubkey();
  p.tokenProgramId = r.pubkey();
  p.totalLamports = r.u64();
  p.poolTokenSupply = r.u64();
  p.lastUpdateEpoch = r.u64();
  p.lockup = { unixTimestamp: r.i64(), epoch: r.u64(), custodian: r.pubkey() };
  p.epochFee = r.fee();
  p.nextEpochFee = r.futureFee();
  p.preferredDepositValidator = r.optionPubkey();
  p.preferredWithdrawValidator = r.optionPubkey();
  p.stakeDepositFee = r.fee();
  p.stakeWithdrawalFee = r.fee();
  p.nextStakeWithdrawalFee = r.futureFee();
  p.stakeReferralFee = r.u8();
  p.solDepositAuthority = r.optionPubkey();
  p.solDepositFee = r.fee();
  p.solReferralFee = r.u8();
  p.solWithdrawAuthority = r.optionPubkey();
  p.solWithdrawalFee = r.fee();
  p.nextSolWithdrawalFee = r.futureFee();
  p.lastEpochPoolTokenSupply = r.u64();
  p.lastEpochTotalLamports = r.u64();
  p.decodedLength = r.o;
  return p;
}

// struct ValidatorList { header: ValidatorListHeader, validators: Vec<ValidatorStakeInfo> }
// ValidatorStakeInfo (state.rs L687-L719), 73 bytes, Pod little-endian:
//   active_stake_lamports u64, transient_stake_lamports u64, last_update_epoch u64,
//   transient_seed_suffix u64, unused u32, validator_seed_suffix u32, status u8, vote 32
export function decodeValidatorList(data) {
  const r = new BorshReader(data);
  const accountType = r.u8();
  const maxValidators = r.u32();
  const len = r.u32();
  const validators = [];
  for (let i = 0; i < len; i++) {
    const start = r.o;
    const v = {
      index: i,
      activeStakeLamports: r.u64(),
      transientStakeLamports: r.u64(),
      lastUpdateEpoch: r.u64(),
      transientSeedSuffix: r.u64(),
      unused: r.u32(),
      validatorSeedSuffix: r.u32(),
      status: r.u8(),
      voteAccount: r.pubkey(),
    };
    v.statusName = STAKE_STATUS[v.status] ?? `?${v.status}`;
    if (r.o - start !== VALIDATOR_STAKE_INFO_LEN) throw new Error('ValidatorStakeInfo size mismatch');
    validators.push(v);
  }
  return { accountType, accountTypeName: ACCOUNT_TYPE[accountType] ?? `?${accountType}`, maxValidators, validators };
}

// Metaplex Token Metadata account (key u8, update_authority, mint, Data{name,symbol,uri,…}).
// Strings are padded with NULs to fixed max lengths on creation.
export function decodeMetadata(data) {
  const r = new BorshReader(data);
  const key = r.u8();
  const updateAuthority = r.pubkey();
  const mint = r.pubkey();
  const clean = (s) => s.replace(/\0+$/g, '');
  const name = clean(r.string());
  const symbol = clean(r.string());
  const uri = clean(r.string());
  const sellerFeeBasisPoints = r.b.readUInt16LE(r.o);
  return { key, updateAuthority, mint, name, symbol, uri, sellerFeeBasisPoints };
}

// ---------- fetch helpers ----------
export async function fetchPoolState(connection, programId, poolAddress, commitment = 'confirmed') {
  const poolAcc = await connection.getAccountInfo(poolAddress, commitment);
  if (!poolAcc) return null;
  if (!poolAcc.owner.equals(programId)) throw new Error(`pool ${poolAddress.toBase58()} is owned by ${poolAcc.owner.toBase58()}, expected ${programId.toBase58()}`);
  const pool = decodeStakePool(poolAcc.data);
  if (pool.accountType !== 1) return { pool, poolAccount: poolAcc };
  const [listAcc, reserveAcc, mintAcc] = await connection.getMultipleAccountsInfo([pool.validatorList, pool.reserveStake, pool.poolMint], commitment);
  const list = decodeValidatorList(listAcc.data);
  return { pool, poolAccount: poolAcc, list, reserveLamports: BigInt(reserveAcc.lamports), reserveAccount: reserveAcc, mintAccount: mintAcc };
}

export async function fetchMetadata(connection, mint) {
  const acc = await connection.getAccountInfo(findMetadata(mint), 'confirmed');
  return acc ? { address: findMetadata(mint), ...decodeMetadata(acc.data) } : null;
}

// Parsed stake account (jsonParsed) -> compact object
export async function fetchStakeAccount(connection, address) {
  const res = await connection.getParsedAccountInfo(address, 'confirmed');
  if (!res.value) return null;
  const d = res.value.data;
  if (!d || !d.parsed) return { address, lamports: BigInt(res.value.lamports), type: 'unknown' };
  const info = d.parsed.info ?? {};
  const out = { address, lamports: BigInt(res.value.lamports), type: d.parsed.type };
  if (info.meta) {
    out.rentExemptReserve = BigInt(info.meta.rentExemptReserve);
    out.staker = new PublicKey(info.meta.authorized.staker);
    out.withdrawer = new PublicKey(info.meta.authorized.withdrawer);
  }
  if (info.stake) {
    const dl = info.stake.delegation;
    out.voter = new PublicKey(dl.voter);
    out.delegatedStake = BigInt(dl.stake);
    out.activationEpoch = BigInt(dl.activationEpoch);
    out.deactivationEpoch = BigInt(dl.deactivationEpoch);
  }
  return out;
}

export const U64_MAX = (1n << 64n) - 1n;
