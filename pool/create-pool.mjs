#!/usr/bin/env node
// Create the studio's SPL stake pool with the BUILD-PLAN settings. Idempotent: every step
// checks the chain first, so re-running after a flaky RPC simply resumes.
//
//   node create-pool.mjs                                  # devnet, 2 auto-picked validators
//   node create-pool.mjs --validators <vote1>,<vote2>     # choose validators
//   node create-pool.mjs --seed-extra-sol 1.01            # leave extra SOL in the reserve
//   node create-pool.mjs --dry-run                        # print the plan only
//
// Mainnet with a Squads multisig manager (see README "Mainnet runbook"):
//   POOL_ALLOW_MAINNET=yes node create-pool.mjs --cluster mainnet --manager <SQUADS_VAULT>
// creates everything that doesn't need the manager's signature, prints the manager-signed
// instructions as JSON for a Squads transaction, and exits; re-run after executing them.
import {
  PublicKey, SystemProgram, StakeProgram, Authorized, Lockup,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, MINT_SIZE,
  createInitializeMint2Instruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';
import {
  parseArgs, loadContext, saveConfig, loadKeypair, assertSendAllowed, lamportsToSol, solToLamports,
  feeToString, explorerAddr, toJson, pk, base58,
} from './lib/env.mjs';
import {
  STAKE_POOL_PROGRAM_ID_DEVNET, STAKE_POOL_PROGRAM_ID_MAINNET, STAKE_POOL_SPACE, STAKE_ACCOUNT_SPACE,
  FEE_TYPE, FUNDING_TYPE, fee, validatorListSpace, findWithdrawAuthority, findValidatorStake, findMetadata,
  initialize, setFee, setFundingAuthority, createTokenMetadata, addValidatorToPool, depositSol,
} from './lib/ix.mjs';
import { decodeStakePool } from './lib/state.mjs';
import { sendTx } from './lib/tx.mjs';
import { loadState, isStale, buildUpdateInstructions, quoteDepositSol } from './lib/pool-ops.mjs';

// ---- BUILD-PLAN "Pool settings" ----
const SETTINGS = {
  epochFee: fee(1, 1), // 100% of rewards to the manager
  withdrawalFee: fee(3, 1000), // Initialize applies this to BOTH SOL and stake withdrawals…
  stakeWithdrawalFee: fee(0, 100), // …so stake withdrawals are set back to 0 (takes effect after 2 epoch boundaries)
  depositFee: fee(0, 0), // SOL and stake deposits: none
  referralFee: 0,
  maxValidators: 4,
  name: 'Isabella Ocean Pass',
  symbol: 'OCEAN',
  uri: 'https://isabella.app/ocean-pass.json', // placeholder; upload metadata/ocean-pass.json for mainnet
};

const args = parseArgs();
const ctx = loadContext(args, { requireConfig: false });
const dry = !!args['dry-run'];
const conn = ctx.connection;
if (!dry) await assertSendAllowed(ctx);
const cfg = ctx.config ?? {};

const programId = pk(args['program-id'] ?? cfg.programId ?? (ctx.cluster === 'mainnet' ? STAKE_POOL_PROGRAM_ID_MAINNET : STAKE_POOL_PROGRAM_ID_DEVNET));
const progAcc = await conn.getAccountInfo(programId);
if (!progAcc?.executable) throw new Error(`stake-pool program ${programId.toBase58()} is not deployed on ${ctx.cluster}`);

const payer = loadKeypair(ctx, 'payer');
const staker = loadKeypair(ctx, 'staker');
const managerKp = args.manager ? null : loadKeypair(ctx, 'manager');
const manager = args.manager ? pk(args.manager) : managerKp.publicKey;
const kpOrCfg = (role, key) => { const kp = loadKeypair(ctx, role, { optional: true }); if (kp) return kp; if (cfg[key]) return { publicKey: pk(cfg[key]), missing: true }; throw new Error(`need keypair ${role} or ${key} in config`); };
const poolKp = kpOrCfg('pool', 'pool');
const listKp = kpOrCfg('validator-list', 'validatorList');
const reserveKp = kpOrCfg('reserve', 'reserve');
const mintKp = kpOrCfg('mint', 'mint');
const pool = poolKp.publicKey, validatorList = listKp.publicKey, reserve = reserveKp.publicKey, mint = mintKp.publicKey;
const withdrawAuthority = findWithdrawAuthority(programId, pool);
const managerFeeAccount = getAssociatedTokenAddressSync(mint, manager, true, TOKEN_PROGRAM_ID);
const squadsMode = !managerKp;
const managerSigner = managerKp ? [managerKp] : [];
const squadsIxs = [];
const sigs = {};

console.log(`cluster ${ctx.cluster}  program ${programId.toBase58()}  pool ${pool.toBase58()}`);
console.log(`manager ${manager.toBase58()}${squadsMode ? ' (external signer: Squads vault)' : ''}  staker ${staker.publicKey.toBase58()}  payer ${payer.publicKey.toBase58()}`);
if (dry) console.log('DRY RUN: nothing will be sent');

const stakeRent = BigInt(await conn.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SPACE));
const minDelegationRpc = BigInt((await conn.getStakeMinimumDelegation()).value);

function persist(extra = {}) {
  const config = {
    cluster: ctx.cluster,
    rpcUrl: cfg.rpcUrl ?? ctx.rpcUrl,
    programId: programId.toBase58(),
    pool: pool.toBase58(),
    validatorList: validatorList.toBase58(),
    reserve: reserve.toBase58(),
    mint: mint.toBase58(),
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    withdrawAuthority: withdrawAuthority.toBase58(),
    managerFeeAccount: managerFeeAccount.toBase58(),
    manager: manager.toBase58(),
    staker: staker.publicKey.toBase58(),
    metadata: findMetadata(mint).toBase58(),
    ...cfg.validators ? { validators: cfg.validators } : {},
    settings: {
      epochFee: '1/1 (100% of rewards)',
      solWithdrawalFee: '3/1000 (0.3%)',
      stakeWithdrawalFee: '0 (set to 0/100 after Initialize; live after 2 epoch boundaries)',
      depositFees: '0',
      maxValidators: SETTINGS.maxValidators,
      stakeDepositAuthority: 'manager (blocks the stake-deposit "leech" trick); SOL deposits stay permissionless',
      tokenName: SETTINGS.name, tokenSymbol: SETTINGS.symbol, tokenUri: args['metadata-uri'] ?? SETTINGS.uri,
    },
    crank: cfg.crank ?? { reserveBufferSol: ctx.cluster === 'devnet' ? '1.05' : '2', reserveBufferPct: 0, depositSol: '1.01' },
    ...cfg.createdEpoch ? { createdEpoch: cfg.createdEpoch, createdAt: cfg.createdAt } : {},
    ...extra,
  };
  Object.assign(cfg, config);
  if (!dry) saveConfig(ctx, cfg);
}

async function send(label, instructions, signers) {
  if (dry) { console.log(`  [dry] ${label}: ${instructions.length} instruction(s)`); return null; }
  return sendTx(ctx, { label, instructions, signers: [payer, ...signers] });
}

function forSquads(label, instruction) {
  squadsIxs.push({
    label,
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map((m) => ({ pubkey: m.pubkey.toBase58(), isSigner: m.isSigner, isWritable: m.isWritable })),
    dataBase58: base58(instruction.data),
    dataHex: Buffer.from(instruction.data).toString('hex'),
  });
}

// ---------- A. reserve stake account, pool mint, manager fee account ----------
{
  const [resAcc, mintAcc, feeAcc] = await conn.getMultipleAccountsInfo([reserve, mint, managerFeeAccount]);
  const ixs = [], signers = [];
  if (!resAcc) {
    if (reserveKp.missing) throw new Error('reserve keypair missing');
    ixs.push(...StakeProgram.createAccount({
      fromPubkey: payer.publicKey, stakePubkey: reserve,
      authorized: new Authorized(withdrawAuthority, withdrawAuthority), lockup: new Lockup(0, 0, PublicKey.default),
      lamports: Number(stakeRent),
    }).instructions);
    signers.push(reserveKp);
  }
  if (!mintAcc) {
    if (mintKp.missing) throw new Error('mint keypair missing');
    ixs.push(SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: mint, lamports: await conn.getMinimumBalanceForRentExemption(MINT_SIZE), space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }));
    ixs.push(createInitializeMint2Instruction(mint, 9, withdrawAuthority, null, TOKEN_PROGRAM_ID)); // no freeze authority (processor.rs L787)
    signers.push(mintKp);
  }
  if (!feeAcc) ixs.push(createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, managerFeeAccount, manager, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID));
  if (ixs.length) sigs.setupAccounts = await send('create reserve stake account, pool mint (9 decimals, no freeze authority) and manager fee account', ixs, signers);
  else console.log('  --  reserve, mint and manager fee account already exist');
}

// ---------- B. Initialize ----------
let poolState = null;
{
  const acc = await conn.getAccountInfo(pool);
  poolState = acc && acc.owner.equals(programId) ? decodeStakePool(acc.data) : null;
  if (poolState?.accountType === 1) {
    console.log('  --  pool already initialized');
    if (!poolState.manager.equals(manager)) throw new Error(`pool manager is ${poolState.manager.toBase58()}, not ${manager.toBase58()}`);
  } else {
    const ixs = [], signers = [];
    const listAcc = await conn.getAccountInfo(validatorList);
    if (!acc) {
      if (poolKp.missing) throw new Error('pool keypair missing');
      ixs.push(SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: pool, lamports: await conn.getMinimumBalanceForRentExemption(STAKE_POOL_SPACE), space: STAKE_POOL_SPACE, programId }));
      signers.push(poolKp);
    }
    if (!listAcc) {
      if (listKp.missing) throw new Error('validator-list keypair missing');
      const space = validatorListSpace(SETTINGS.maxValidators);
      ixs.push(SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: validatorList, lamports: await conn.getMinimumBalanceForRentExemption(space), space, programId }));
      signers.push(listKp);
    }
    const init = initialize({
      programId, stakePool: pool, manager, staker: staker.publicKey, withdrawAuthority, validatorList,
      reserveStake: reserve, poolMint: mint, managerFeeAccount, tokenProgramId: TOKEN_PROGRAM_ID,
      epochFee: SETTINGS.epochFee, withdrawalFee: SETTINGS.withdrawalFee, depositFee: SETTINGS.depositFee,
      referralFee: SETTINGS.referralFee, maxValidators: SETTINGS.maxValidators,
    });
    if (squadsMode) {
      if (ixs.length) sigs.createPoolAccounts = await send('create pool + validator list accounts (owned by the stake-pool program)', ixs, signers);
      forSquads('Initialize (epoch fee 1/1, withdrawal fee 3/1000, deposit fee 0, max 4 validators)', init);
    } else {
      sigs.initialize = await send(`Initialize pool: epoch fee ${feeToString(SETTINGS.epochFee)}, withdrawal fee ${feeToString(SETTINGS.withdrawalFee)}, deposit fee 0, max ${SETTINGS.maxValidators} validators`, [...ixs, init], [...signers, ...managerSigner]);
      const epoch = (await conn.getEpochInfo()).epoch;
      persist({ createdEpoch: epoch, createdAt: new Date().toISOString() });
    }
  }
}

// ---------- C/D/E. manager settings ----------
async function managerStep(label, instruction, extraSigners = []) {
  if (squadsMode) { forSquads(label, instruction); return null; }
  return send(label, [instruction], [...managerSigner, ...extraSigners]);
}
if (squadsMode && !(poolState?.accountType === 1)) {
  // pool not initialized yet: queue the manager settings behind Initialize in the same Squads batch
  forSquads('SetFee StakeWithdrawal 0/100', setFee({ programId, stakePool: pool, manager, feeType: FEE_TYPE.StakeWithdrawal, value: SETTINGS.stakeWithdrawalFee }));
  forSquads('SetFundingAuthority StakeDeposit -> manager', setFundingAuthority({ programId, stakePool: pool, manager, newAuthority: manager, fundingType: FUNDING_TYPE.StakeDeposit }));
  forSquads(`CreateTokenMetadata ${SETTINGS.name} / ${SETTINGS.symbol} (payer = vault; fund it with ~0.02 SOL first)`, createTokenMetadata({ programId, stakePool: pool, manager, withdrawAuthority, poolMint: mint, payer: manager, name: SETTINGS.name, symbol: SETTINGS.symbol, uri: String(args['metadata-uri'] ?? SETTINGS.uri) }));
} else if (!dry || poolState?.accountType === 1) {
  const acc = await conn.getAccountInfo(pool);
  const p = acc ? decodeStakePool(acc.data) : null;
  if (p?.accountType === 1) {
    // C. stake withdrawal fee -> 0 (SetFee for withdrawal fees needs the pool updated this epoch)
    const zeroNow = p.stakeWithdrawalFee.numerator === 0n;
    const zeroPending = p.nextStakeWithdrawalFee && p.nextStakeWithdrawalFee.fee.numerator === 0n;
    if (!zeroNow && !zeroPending) {
      const epoch = BigInt((await conn.getEpochInfo()).epoch);
      if (p.lastUpdateEpoch < epoch && !dry) {
        persist();
        const st = await loadState(ctx);
        const u = buildUpdateInstructions(st);
        for (const i of u.listIxs) await send('UpdateValidatorListBalance', [i], []);
        await send('UpdateStakePoolBalance + cleanup', u.finalIxs, []);
      }
      sigs.setStakeWithdrawalFee = await managerStep('SetFee StakeWithdrawal 0/100 (takes effect after 2 epoch boundaries)', setFee({ programId, stakePool: pool, manager, feeType: FEE_TYPE.StakeWithdrawal, value: SETTINGS.stakeWithdrawalFee }));
    } else console.log(`  --  stake withdrawal fee already ${zeroNow ? '0' : '0 (pending)'}`);
    // D. stake-deposit authority -> manager
    if (!p.stakeDepositAuthority.equals(manager)) {
      sigs.setStakeDepositAuthority = await managerStep('SetFundingAuthority StakeDeposit -> manager (only the manager may deposit stake accounts)', setFundingAuthority({ programId, stakePool: pool, manager, newAuthority: manager, fundingType: FUNDING_TYPE.StakeDeposit }));
    } else console.log('  --  stake deposit authority already the manager');
    // E. token metadata
    if (!(await conn.getAccountInfo(findMetadata(mint)))) {
      sigs.createMetadata = await managerStep(`CreateTokenMetadata "${SETTINGS.name}" / ${SETTINGS.symbol}`, createTokenMetadata({ programId, stakePool: pool, manager, withdrawAuthority, poolMint: mint, payer: squadsMode ? manager : payer.publicKey, name: SETTINGS.name, symbol: SETTINGS.symbol, uri: String(args['metadata-uri'] ?? SETTINGS.uri) }));
    } else console.log('  --  token metadata already exists');
  }
}

if (squadsIxs.length) {
  persist();
  console.log('\nManager-signed instructions for Squads (create one vault transaction with these, in order, then approve and execute):');
  console.log(toJson(squadsIxs));
  console.log('\nAfter Squads executes them, re-run this command to seed the pool and add validators.');
  process.exit(0);
}

// ---------- F/G. seed the reserve and add validators ----------
if (dry && !(await conn.getAccountInfo(pool))) { console.log('  [dry] then: seed deposit + AddValidatorToPool for each validator'); process.exit(0); }
persist();
let state = await loadState(ctx);
if (isStale(state).poolStale) {
  const u = buildUpdateInstructions(state);
  for (const i of u.listIxs) await send('UpdateValidatorListBalance', [i], []);
  await send('UpdateStakePoolBalance + cleanup', u.finalIxs, []);
  state = await loadState(ctx);
}

async function pickValidators(count) {
  const res = await conn.getVoteAccounts('confirmed');
  const tip = Math.max(...res.current.map((v) => v.lastVote));
  return res.current
    .filter((v) => tip - v.lastVote < 300)
    .filter((v) => { const ec = v.epochCredits; return ec.length >= 2 && ec[ec.length - 2][1] - ec[ec.length - 2][2] > 0; })
    .sort((a, b) => a.commission - b.commission || b.activatedStake - a.activatedStake)
    .slice(0, count)
    .map((v) => ({ vote: v.votePubkey, commission: v.commission, activatedStakeSol: Math.round(v.activatedStake / 1e9) }));
}

const wanted = args.validators
  ? String(args.validators).split(',').map((v) => ({ vote: v.trim() }))
  : (cfg.validators?.length ? cfg.validators.map((v) => ({ vote: v.vote })) : await pickValidators(Number(args['validator-count'] ?? 2)));
const inList = new Set(state.list.validators.map((v) => v.voteAccount.toBase58()));
const toAdd = wanted.filter((v) => !inList.has(v.vote));
const perValidator = state.minDelegation + state.stakeRent; // processor.rs L981-L986
const extra = args['seed-extra-sol'] ? solToLamports(String(args['seed-extra-sol'])) : 0n;
const reserveAvail = state.reserveLamports - state.reserveRent;
const need = BigInt(toAdd.length) * perValidator + extra;
console.log(`validators: ${wanted.map((v) => v.vote).join(', ')}  (${toAdd.length} to add, ${lamportsToSol(perValidator)} SOL each from the reserve)`);

if (need > reserveAvail) {
  const lamports = need - reserveAvail;
  const seedAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_PROGRAM_ID);
  const q = quoteDepositSol(state.pool, lamports);
  sigs.seedDeposit = await send(`seed deposit ${lamportsToSol(lamports)} SOL from the payer (DepositSolWithSlippage, min ${lamportsToSol(q.tokens)} OCEAN)`, [
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, seedAta, payer.publicKey, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    depositSol({ programId, stakePool: pool, withdrawAuthority, reserveStake: reserve, lamportsFrom: payer.publicKey, poolTokensTo: seedAta, managerFeeAccount, poolMint: mint, tokenProgramId: TOKEN_PROGRAM_ID, lamports, minimumPoolTokensOut: q.tokens }),
  ], []);
  cfg.treasurySeedAccount = seedAta.toBase58();
}

sigs.addValidator = [];
for (const v of toAdd) {
  const vote = pk(v.vote);
  const validatorStake = findValidatorStake(programId, vote, pool, 0);
  sigs.addValidator.push(await send(`AddValidatorToPool ${v.vote} (stakes ${lamportsToSol(perValidator)} SOL from the reserve)`, [
    addValidatorToPool({ programId, stakePool: pool, staker: staker.publicKey, reserveStake: reserve, withdrawAuthority, validatorList, validatorStake, validatorVote: vote, seed: 0 }),
  ], [staker]));
}

// the crank uses the staker as its fee payer by default: give it a little SOL for fees
const stakerFee = solToLamports(String(args['staker-fee-sol'] ?? '0.05'));
if (stakerFee > 0n && BigInt(await conn.getBalance(staker.publicKey)) < stakerFee / 2n) {
  sigs.fundStaker = await send(`fund the staker with ${lamportsToSol(stakerFee)} SOL for crank fees`, [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: staker.publicKey, lamports: Number(stakerFee) })], []);
}

if (!dry) {
  state = await loadState(ctx);
  const comm = await conn.getVoteAccounts('confirmed');
  const all = [...comm.current, ...comm.delinquent];
  cfg.validators = state.list.validators.map((v) => ({
    vote: v.voteAccount.toBase58(),
    stakeAccount: findValidatorStake(programId, v.voteAccount, pool, v.validatorSeedSuffix).toBase58(),
    commission: all.find((x) => x.votePubkey === v.voteAccount.toBase58())?.commission ?? null,
  }));
  persist();
  console.log(`\nsaved ${ctx.configPath}`);
  console.log(`pool: ${explorerAddr(ctx, pool.toBase58())}`);
  console.log(`minimum delegation ${lamportsToSol(minDelegationRpc)} SOL, stake rent ${lamportsToSol(stakeRent)} SOL`);
  console.log('signatures:', toJson(sigs));
}
