// Sending transactions: simulate first (readable errors), send, confirm, retry on expiry.
import { ComputeBudgetProgram, Transaction } from '@solana/web3.js';
import { explorerTx, sleep } from './env.mjs';

// error.rs enum StakePoolError @ program@v2.1.0, in order (custom error code = index).
export const STAKE_POOL_ERRORS = [
  'AlreadyInUse', 'InvalidProgramAddress', 'InvalidState', 'CalculationFailure', 'FeeTooHigh',
  'WrongAccountMint', 'WrongManager', 'SignatureMissing', 'InvalidValidatorStakeList', 'InvalidFeeAccount',
  'WrongPoolMint', 'WrongStakeStake', 'UserStakeNotActive', 'ValidatorAlreadyAdded', 'ValidatorNotFound',
  'InvalidStakeAccountAddress', 'StakeListOutOfDate', 'StakeListAndPoolOutOfDate', 'UnknownValidatorStakeAccount',
  'WrongMintingAuthority', 'UnexpectedValidatorListAccountSize', 'WrongStaker', 'NonZeroPoolTokenSupply',
  'StakeLamportsNotEqualToMinimum', 'IncorrectDepositVoteAddress', 'IncorrectWithdrawVoteAddress',
  'InvalidMintFreezeAuthority', 'FeeIncreaseTooHigh', 'WithdrawalTooSmall', 'DepositTooSmall',
  'InvalidStakeDepositAuthority', 'InvalidSolDepositAuthority', 'InvalidPreferredValidator',
  'TransientAccountInUse', 'InvalidSolWithdrawAuthority', 'SolWithdrawalTooLarge', 'InvalidMetadataAccount',
  'UnsupportedMintExtension', 'UnsupportedFeeAccountExtension', 'ExceededSlippage', 'IncorrectMintDecimals',
  'ReserveDepleted', 'MissingRequiredSysvar', 'EpochRewardDistributionInProgress', 'TooManyValidatorsInPool',
];
export const ERR_EPOCH_REWARDS_IN_PROGRESS = 43; // 0x2b
export const ERR_POOL_OUT_OF_DATE = 17; // 0x11

export class TxError extends Error {
  constructor(message, { err, logs, customCode, instructionIndex } = {}) {
    super(message);
    this.err = err; this.logs = logs || []; this.customCode = customCode; this.instructionIndex = instructionIndex;
  }
}

export function customCodeOf(err) {
  const ie = err && err.InstructionError;
  if (!ie) return {};
  const [index, detail] = ie;
  if (detail && typeof detail === 'object' && 'Custom' in detail) return { instructionIndex: index, customCode: detail.Custom };
  return { instructionIndex: index };
}

function describe(err, logs, instructions) {
  const { instructionIndex, customCode } = customCodeOf(err);
  let text = JSON.stringify(err);
  if (customCode !== undefined && instructionIndex !== undefined) {
    const prog = instructions[instructionIndex]?.programId?.toBase58?.() ?? '?';
    const name = STAKE_POOL_ERRORS[customCode];
    text += ` (instruction ${instructionIndex} program ${prog}: custom 0x${customCode.toString(16)}${name ? ' = StakePoolError::' + name + ' if this is the stake-pool program' : ''})`;
  }
  const tail = (logs || []).slice(-14).map((l) => '    ' + l).join('\n');
  return `${text}${tail ? '\n  logs:\n' + tail : ''}`;
}

function dedupeSigners(signers) {
  const seen = new Set();
  return signers.filter((s) => { const k = s.publicKey.toBase58(); if (seen.has(k)) return false; seen.add(k); return true; });
}

// instructions: TransactionInstruction[]; signers[0] pays fees unless feePayer is given.
export async function sendTx(ctx, { label, instructions, signers, feePayer, computeUnits, maxAttempts = 4, quiet = false }) {
  const conn = ctx.connection;
  const all = [];
  if (computeUnits) all.push(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
  const micro = Number((process.env.POOL_PRIORITY_MICROLAMPORTS || '').trim() || 0);
  if (micro > 0) all.push(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: micro }));
  const offset = all.length;
  all.push(...instructions);
  const uniq = dedupeSigners(signers);
  const payer = feePayer ?? uniq[0].publicKey;

  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
    const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight }).add(...all);
    tx.sign(...uniq);

    const sim = await conn.simulateTransaction(tx);
    if (sim.value.err) {
      const msg = describe(sim.value.err, sim.value.logs, all);
      const { customCode, instructionIndex } = customCodeOf(sim.value.err);
      const e = new TxError(`${label}: simulation failed: ${msg}`, { err: sim.value.err, logs: sim.value.logs, customCode, instructionIndex: instructionIndex !== undefined ? instructionIndex - offset : undefined });
      if (JSON.stringify(sim.value.err).includes('BlockhashNotFound') && attempt < maxAttempts) { lastErr = e; await sleep(1500); continue; }
      throw e;
    }

    const raw = tx.serialize();
    let signature;
    try {
      signature = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 5 });
    } catch (e) {
      lastErr = e; await sleep(2000 * attempt); continue;
    }
    try {
      const res = await conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
      if (res.value.err) {
        const status = await conn.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
        const logs = status?.meta?.logMessages;
        const { customCode, instructionIndex } = customCodeOf(res.value.err);
        throw new TxError(`${label}: transaction ${signature} failed: ${describe(res.value.err, logs, all)}`, { err: res.value.err, logs, customCode, instructionIndex: instructionIndex !== undefined ? instructionIndex - offset : undefined });
      }
      if (!quiet) console.log(`  OK  ${label}\n      ${explorerTx(ctx, signature)}`);
      return signature;
    } catch (e) {
      if (e instanceof TxError) throw e;
      // expiry or timeout: did it land anyway?
      const st = await conn.getSignatureStatus(signature, { searchTransactionHistory: true }).catch(() => null);
      if (st?.value && !st.value.err && st.value.confirmationStatus) {
        if (!quiet) console.log(`  OK  ${label} (confirmed late)\n      ${explorerTx(ctx, signature)}`);
        return signature;
      }
      lastErr = e;
      console.log(`  ..  ${label}: attempt ${attempt} not confirmed (${e.message?.slice(0, 120)}), retrying`);
      await sleep(2000 * attempt);
    }
  }
  throw lastErr ?? new Error(`${label}: failed after ${maxAttempts} attempts`);
}

// Simulate only (used for "is this stake account withdrawable yet?" checks); no signatures needed.
export async function simulateOk(ctx, instructions, feePayer) {
  const { blockhash, lastValidBlockHeight } = await ctx.connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight }).add(...instructions);
  const sim = await ctx.connection.simulateTransaction(tx);
  return { ok: !sim.value.err, err: sim.value.err, logs: sim.value.logs };
}
