/* Isabella the Mermaid — window.IsabellaPay (Contract 2): stake-to-play, both exits, pay once.
 *
 *   stake()            DepositSol(config.stake.depositSol) into config.stake.pool          -> { signature, poolTokens }
 *   exitInstant()      WithdrawSol of ALL the wallet's pool tokens (pool's SOL-withdrawal fee) -> { signature, solOut }
 *   exitSlow()         WithdrawStake ALL tokens into a new stake account the parent controls, then
 *                      Deactivate in the same transaction                                -> { signature, stakeAccount, readyAt, sol, deactivating }
 *                      (deactivating:false when the pool paid it from its reserve: claimable at once)
 *   pendingSlowExits() -> [{ stakeAccount, lamports, sol, ready, readyAt, ours }]   (readyAt: ms timestamp estimate;
 *                      every deactivating/inactive stake account whose withdrawer is the parent; ours = made by exitSlow)
 *   claimSlow(opts)    withdraw the SOL from every ready one (max 8 per call; opts.onlyOurs limits it to
 *                      exitSlow's accounts)                                              -> { signature, lamports, sol, claimed, remaining }
 *   payableTokens()    -> [{ mint, symbol, logo, decimals, amountNeeded, balance, enough }]
 *   buy(mint)          pay config.priceUsd once                                         -> { signature, route } | { signature, alreadyOwned:true }
 *                      (mint: a mint address, or 'SOL'; buy(mint, { dryRun:true }) builds + simulates without signing)
 *
 * stake/exit/claim/buy resolve only after the transaction is confirmed and IsabellaEntitlement has been
 * refreshed, so status() already shows the result. buy() hands its confirmed signature to
 * IsabellaEntitlement.notePurchase() (refresh() accepts that one at 'confirmed'; the reinstall path finds
 * purchases at 'finalized'). exitInstant/exitSlow call IsabellaEntitlement.revokeLocal() the moment the
 * wallet sends. Every transaction is simulated before the wallet is asked to sign, so most failures
 * surface before a wallet prompt appears.
 *
 * Every method rejects with an Error whose .code is the paywall's set:
 *   'cancelled' (+ .cancelled = true) | 'no-wallet' | 'funds' | 'offline' | 'failed'
 * plus .reason (precise cause) and .message (a sentence a parent can read). Reasons:
 *   cancelled: CANCELLED.  no-wallet: NO_WALLET.  funds: INSUFFICIENT_SOL, INSUFFICIENT_FUNDS.
 *   offline: OFFLINE (RPC or Jupiter unreachable), TX_TIMEOUT.
 *   failed: NOT_CONFIGURED, NO_POOL_TOKENS, RESERVE_LOW, USE_INSTANT, SLOW_UNAVAILABLE, TOO_MANY_EXITS,
 *     NOTHING_TO_CLAIM, POOL_STALE, POOL_BUSY, POOL_RESTRICTED, SLIPPAGE, TOO_SMALL, UNSUPPORTED_TOKEN,
 *     NO_ROUTE, JUPITER_ERROR, JUPITER_KEY, TX_TOO_LARGE, TX_FAILED, TX_EXPIRED (approval slower than the
 *     ~35 s blockhash life; nothing sent), NOT_SENT (wallet went quiet and nothing landed), RPC_ERROR,
 *     UNSUPPORTED_CHAIN, WALLET_TIMEOUT, WALLET_ERROR.
 * When the bridge reports maybeSubmitted, the transaction is looked up on-chain (same fee payer and
 * blockhash) until its blockhash expires, and the call then succeeds or fails on what actually happened.
 *
 * Stake-pool instructions are built here with the pool account's own program id (devnet has two
 * stake-pool programs and @solana/spl-stake-pool 1.1.8 hard-codes the mainnet one) and without extra
 * signers, because the Android bridge sends unsigned transactions for the wallet to sign.
 */
(function () {
  'use strict';
  const cfg = window.IsabellaConfig || {};
  const L = window.SolanaLib;
  const { web3, splToken, splStakePool, Buffer } = L;
  const {
    PublicKey, SystemProgram, StakeProgram, Transaction, TransactionInstruction, TransactionMessage,
    VersionedTransaction, ComputeBudgetProgram, AddressLookupTableAccount,
    SYSVAR_CLOCK_PUBKEY, SYSVAR_STAKE_HISTORY_PUBKEY,
  } = web3;
  const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = splToken;

  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const KNOWN_POOL_PROGRAMS = ['SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy', 'DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib'];
  const U64_MAX = (1n << 64n) - 1n;
  const MINIMUM_ACTIVE_STAKE = 1000000n; // stake-pool program constant (lamports)
  const EXIT_SEED = 'isabella-exit-';
  const EXIT_SEEDS = 16;
  const PACKET_BYTES = 1232;
  const POOL_SLIPPAGE_PCT = 1n; // min-out tolerance on pool deposits and withdrawals
  const isMainnet = () => cfg.cluster === 'mainnet-beta' || cfg.cluster === 'mainnet';

  // Tests may set env.connection or replace Wallet.connection.
  const env = { connection: null, now: () => Date.now(), finalizeTimeoutMs: 90 * 1000 };
  const slippageSupport = new Map(); // program id -> false once a program rejects the *WithSlippage instructions

  // ---------------------------------------------------------------- small helpers
  // .code is the paywall's coarse set; .reason is the precise cause (see the header).
  const CODE_OF = { CANCELLED: 'cancelled', NO_WALLET: 'no-wallet', INSUFFICIENT_SOL: 'funds', INSUFFICIENT_FUNDS: 'funds', OFFLINE: 'offline', TX_TIMEOUT: 'offline' };
  function payError(reason, message, extra) {
    const e = new Error(message);
    e.reason = reason;
    e.code = CODE_OF[reason] || 'failed';
    if (reason === 'CANCELLED') e.cancelled = true;
    if (extra) Object.assign(e, extra);
    return e;
  }
  const NETWORK_RE = /fetch failed|failed to fetch|network|timed?[ -]?out|ECONNRESET|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket|\b(408|429|502|503|504)\b/i;   // 408 "Request Time-out": the public RPC's proxy gave up
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const sol = (lamports) => Number(lamports) / 1e9;
  const fmtSol = (lamports) => String(Math.round(sol(lamports) * 10000) / 10000);
  function conn() { return env.connection || window.Wallet.connection(); }
  function entitlement() { return window.IsabellaEntitlement; }
  async function ensureWallet() {
    if (!window.Wallet) throw payError('NO_WALLET', 'The wallet module is missing.');
    if (!window.Wallet.publicKey) await window.Wallet.connect();
    return new PublicKey(window.Wallet.publicKey);
  }
  function u32le(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; }
  function u64le(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n), 0); return b; }
  const W = (pubkey) => ({ pubkey, isSigner: false, isWritable: true });
  const R = (pubkey) => ({ pubkey, isSigner: false, isWritable: false });
  const S = (pubkey, writable) => ({ pubkey, isSigner: true, isWritable: !!writable });
  const pda = (seeds, programId) => PublicKey.findProgramAddressSync(seeds, programId)[0];
  /** An RPC read, retried twice on network hiccups (phones drop requests); never used for sends. */
  async function rpc(call, what) {
    let last = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await call(); } catch (e) {
        last = e;
        if (!NETWORK_RE.test(String(e && e.message))) break;
        await sleep(500 * (attempt + 1));
      }
    }
    const detail = (last && last.message) || String(last);
    if (NETWORK_RE.test(detail)) throw payError('OFFLINE', 'The phone could not reach the Solana network. Check the internet connection and try again.', { detail: what + ': ' + detail });
    throw payError('RPC_ERROR', 'Solana returned an error (' + what + '): ' + detail);
  }

  // ---------------------------------------------------------------- the stake pool
  async function loadPool(c) {
    const st = cfg.stake || {};
    if (!st.pool) throw payError('NOT_CONFIGURED', 'The stake pool address is not set in web/config.js yet.');
    const key = new PublicKey(st.pool);
    const ai = await rpc(() => c.getAccountInfo(key, 'confirmed'), 'pool');
    if (!ai) throw payError('NOT_CONFIGURED', 'The stake pool account does not exist on ' + cfg.cluster + '.');
    const programId = ai.owner;
    if (st.programId ? st.programId !== programId.toBase58() : !KNOWN_POOL_PROGRAMS.includes(programId.toBase58())) {
      throw payError('NOT_CONFIGURED', 'The configured stake pool is owned by ' + programId.toBase58() + ', not the expected stake-pool program.');
    }
    const s = splStakePool.StakePoolLayout.decode(ai.data);
    if (s.accountType !== 1) throw payError('NOT_CONFIGURED', 'The configured address is not a stake pool.');
    if (st.mint && st.mint !== s.poolMint.toBase58()) throw payError('NOT_CONFIGURED', 'stake.mint in web/config.js does not match the pool\'s token mint.');
    return {
      key, programId, s,
      withdrawAuthority: pda([key.toBuffer(), Buffer.from('withdraw')], programId),
      total: BigInt(s.totalLamports.toString()),
      supply: BigInt(s.poolTokenSupply.toString()),
      lastUpdateEpoch: BigInt(s.lastUpdateEpoch.toString()),
      mint: s.poolMint,
      tokenProgram: s.tokenProgramId,
    };
  }

  function feeOf(f) { return { num: BigInt(f.numerator.toString()), den: BigInt(f.denominator.toString()) }; }
  function applyFee(f, amount) { const { num, den } = feeOf(f); return den === 0n ? 0n : (amount * num + den - 1n) / den; } // rounds up, like the program
  function tokensForDeposit(p, lamports) {
    const minted = p.total === 0n || p.supply === 0n ? lamports : (lamports * p.supply) / p.total;
    return minted - applyFee(p.s.solDepositFee, minted);
  }
  function lamportsForWithdraw(p, tokens, fee, sourceIsFeeAccount) {
    const burnt = tokens - (sourceIsFeeAccount ? 0n : applyFee(fee, tokens));
    const num = burnt * p.total;
    return p.supply === 0n || num < p.supply ? 0n : num / p.supply;
  }
  const minusSlippage = (x) => (x * (100n - POOL_SLIPPAGE_PCT)) / 100n;

  function decodeValidatorList(data) {
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const n = dv.getUint32(5, true);
    const out = [];
    for (let i = 0; i < n; i++) {
      const o = 9 + i * 73;
      if (o + 73 > data.length) break;
      out.push({
        active: dv.getBigUint64(o, true),
        transient: dv.getBigUint64(o + 8, true),
        lastUpdateEpoch: dv.getBigUint64(o + 16, true),
        transientSeed: dv.getBigUint64(o + 24, true),
        validatorSeed: dv.getUint32(o + 36, true),
        status: data[o + 40], // 0 active, 1 deactivating transient, 2 ready for removal
        vote: new PublicKey(data.subarray(o + 41, o + 73)),
      });
    }
    return out;
  }

  async function loadValidatorList(c, p) {
    const ai = await rpc(() => c.getAccountInfo(p.s.validatorList, 'confirmed'), 'validator list');
    if (!ai) throw payError('NOT_CONFIGURED', 'The pool\'s validator list is missing.');
    return decodeValidatorList(ai.data).map((v) => Object.assign(v, {
      stakeAccount: pda([v.vote.toBuffer(), p.key.toBuffer()].concat(v.validatorSeed ? [u32le(v.validatorSeed)] : []), p.programId),
      transientAccount: pda([Buffer.from('transient'), v.vote.toBuffer(), p.key.toBuffer(), u64le(v.transientSeed)], p.programId),
    }));
  }

  // ---- stake-pool instructions (account order from program/src/instruction.rs, v2.1.0) ----
  function poolIx(p, keys, bytes) { return new TransactionInstruction({ programId: p.programId, keys, data: Buffer.from(bytes) }); }
  function amountData(tag, a, b) {
    const d = Buffer.alloc(b === undefined ? 9 : 17);
    d[0] = tag; d.writeBigUInt64LE(a, 1);
    if (b !== undefined) d.writeBigUInt64LE(b, 9);
    return d;
  }
  function depositSolIx(p, from, dest, lamports, minTokens, withSlippage) {
    return poolIx(p, [W(p.key), R(p.withdrawAuthority), W(p.s.reserveStake), S(from, true), W(dest), W(p.s.managerFeeAccount),
      W(dest), W(p.mint), R(SystemProgram.programId), R(p.tokenProgram)],
    withSlippage ? amountData(25, lamports, minTokens) : amountData(14, lamports));
  }
  function withdrawSolIx(p, owner, source, dest, tokens, minLamports, withSlippage) {
    return poolIx(p, [W(p.key), R(p.withdrawAuthority), S(owner), W(source), W(p.s.reserveStake), W(dest), W(p.s.managerFeeAccount),
      W(p.mint), R(SYSVAR_CLOCK_PUBKEY), R(SYSVAR_STAKE_HISTORY_PUBKEY), R(StakeProgram.programId), R(p.tokenProgram)],
    withSlippage ? amountData(26, tokens, minLamports) : amountData(16, tokens));
  }
  function withdrawStakeIx(p, splitFrom, splitTo, owner, source, tokens, minLamports, withSlippage) {
    return poolIx(p, [W(p.key), W(p.s.validatorList), R(p.withdrawAuthority), W(splitFrom), W(splitTo), R(owner), S(owner), W(source),
      W(p.s.managerFeeAccount), W(p.mint), R(SYSVAR_CLOCK_PUBKEY), R(p.tokenProgram), R(StakeProgram.programId)],
    withSlippage ? amountData(24, tokens, minLamports) : amountData(10, tokens));
  }
  function updateInstructions(p, list) {
    const ixs = [];
    for (let i = 0; i < list.length; i += 4) {
      const pairs = list.slice(i, i + 4).flatMap((v) => [W(v.stakeAccount), W(v.transientAccount)]);
      const d = Buffer.alloc(6); d[0] = 6; d.writeUInt32LE(i, 1); d[5] = 0;
      ixs.push(poolIx(p, [R(p.key), R(p.withdrawAuthority), W(p.s.validatorList), W(p.s.reserveStake), R(SYSVAR_CLOCK_PUBKEY),
        R(SYSVAR_STAKE_HISTORY_PUBKEY), R(StakeProgram.programId)].concat(pairs), d));
    }
    ixs.push(poolIx(p, [W(p.key), R(p.withdrawAuthority), W(p.s.validatorList), R(p.s.reserveStake), W(p.s.managerFeeAccount), W(p.mint), R(p.tokenProgram)], [7]));
    ixs.push(poolIx(p, [R(p.key), W(p.s.validatorList)], [8]));
    return ixs;
  }

  /** If the pool missed this epoch's update (the crank is late), prepend the permissionless update. */
  async function freshness(c, p) {
    const info = await rpc(() => c.getEpochInfo('confirmed'), 'epoch');
    if (p.lastUpdateEpoch >= BigInt(info.epoch)) return { epochInfo: info, updateIxs: [], list: null };
    const list = await loadValidatorList(c, p);
    if (list.length > 4) throw payError('POOL_STALE', 'The pool has not been updated for this epoch yet. Please try again in a few minutes.');
    return { epochInfo: info, updateIxs: updateInstructions(p, list), list };
  }

  async function poolTokenAccounts(c, owner, p) {
    const res = await rpc(() => c.getParsedTokenAccountsByOwner(owner, { mint: p.mint }, 'confirmed'), 'token accounts');
    return res.value.map(({ pubkey, account }) => {
      const ta = account.data.parsed.info.tokenAmount;
      return { pubkey, amount: BigInt(ta.amount), decimals: ta.decimals };
    }).filter((a) => a.amount > 0n).sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0));
  }
  async function mintDecimals(c, mint) {
    const ai = await rpc(() => c.getAccountInfo(mint, 'confirmed'), 'mint');
    if (!ai) throw payError('NOT_CONFIGURED', 'Token mint ' + mint.toBase58() + ' does not exist.');
    return { decimals: ai.data[44], tokenProgram: ai.owner };
  }
  function ataRentBytes(tokenProgram) { return tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? 170 : 165; }

  // ---------------------------------------------------------------- simulate, sign, confirm
  const POOL_ERRORS = {
    17: ['POOL_STALE', 'The pool has not been updated for this epoch yet. Please try again in a few minutes.'],
    23: ['SLOW_UNAVAILABLE', 'The pool cannot pay out a stake account of that size right now. Use the instant exit, or try again after the next epoch.'],
    28: ['TOO_SMALL', 'That withdrawal is too small for the pool.'],
    29: ['TOO_SMALL', 'That deposit is too small for the pool.'],
    31: ['POOL_RESTRICTED', 'This pool only accepts deposits from its own operator.'],
    34: ['POOL_RESTRICTED', 'This pool only allows instant exits by its own operator.'],
    35: ['RESERVE_LOW', 'The pool does not have enough SOL on hand for an instant exit right now. Use the free slow exit, or try again later.'],
    39: ['SLIPPAGE', 'The pool\'s price changed while you were deciding. Please try again.'],
    41: ['RESERVE_LOW', 'The pool does not have enough SOL on hand for an instant exit right now. Use the free slow exit, or try again later.'],
    43: ['POOL_BUSY', 'Solana is paying out this epoch\'s staking rewards. Please try again in a few minutes.'],
  };
  function explainFailure(err, logs, programs) {
    const text = (logs || []).join('\n');
    if (err === 'InsufficientFundsForFee' || err === 'AccountNotFound') return ['INSUFFICIENT_SOL', 'The wallet does not have enough SOL to pay the transaction fee.'];
    if (err && err.InsufficientFundsForRent) return ['INSUFFICIENT_SOL', 'The wallet does not have enough SOL to open the accounts this needs.'];
    if (err && err.InstructionError) {
      const [index, ie] = err.InstructionError;
      const program = programs[index] || '';
      if (ie && typeof ie === 'object' && 'Custom' in ie) {
        const n = ie.Custom;
        if (program === SystemProgram.programId.toBase58() && n === 1) return ['INSUFFICIENT_SOL', 'The wallet does not have enough SOL for this.'];
        if ((program === TOKEN_PROGRAM_ID.toBase58() || program === TOKEN_2022_PROGRAM_ID.toBase58()) && n === 1) return ['INSUFFICIENT_FUNDS', 'The wallet does not hold enough of that token.'];
        if (KNOWN_POOL_PROGRAMS.includes(program) || program === (cfg.stake && cfg.stake.programId)) { if (POOL_ERRORS[n]) return POOL_ERRORS[n]; }
        if (n === 6001 || /slippage/i.test(text)) return ['SLIPPAGE', 'The price moved while you were deciding. Please try again.'];
      }
    }
    if (/insufficient lamports|insufficient funds/i.test(text)) return ['INSUFFICIENT_SOL', 'The wallet does not have enough SOL for this.'];
    return ['TX_FAILED', 'Solana would not accept this transaction (' + JSON.stringify(err) + ').'];
  }
  function isUnknownInstruction(err, programs) {
    if (!err || !err.InstructionError) return false;
    const [index, ie] = err.InstructionError;
    return (ie === 'InvalidInstructionData' || ie === 'BorshIoError' || (ie && ie.BorshIoError !== undefined)) &&
      (KNOWN_POOL_PROGRAMS.includes(programs[index]) || programs[index] === (cfg.stake && cfg.stake.programId));
  }

  async function simulate(c, vtx) {
    const sim = await rpc(() => c.simulateTransaction(vtx, { sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }), 'simulate');
    return sim.value;
  }
  function failFromSimulation(value, programs) {
    const [code, message] = explainFailure(value.err, value.logs, programs);
    return payError(code, message, { err: value.err, logs: value.logs });
  }

  async function confirmSignature(c, signature, lastValidBlockHeight) {
    const started = env.now();
    for (let i = 0; ; i++) {
      let st = null;
      try { st = (await c.getSignatureStatuses([signature], { searchTransactionHistory: i > 0 && i % 10 === 0 })).value[0]; } catch (e) { /* keep polling */ }
      if (st && st.err) throw payError('TX_FAILED', 'Solana did not accept the transaction.', { signature, err: st.err });
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) return st;
      if (lastValidBlockHeight) {
        let height = 0;
        try { height = await c.getBlockHeight('confirmed'); } catch (e) { /* keep polling */ }
        if (height > lastValidBlockHeight) {
          const last = (await rpc(() => c.getSignatureStatuses([signature], { searchTransactionHistory: true }), 'status')).value[0];
          if (last && last.err) throw payError('TX_FAILED', 'Solana did not accept the transaction.', { signature, err: last.err });
          if (last && last.confirmationStatus) return last;
          throw payError('TX_EXPIRED', 'The transaction expired before it landed, so nothing was spent. Please try again.', { signature });
        }
      }
      if (env.now() - started > 120 * 1000) throw payError('TX_TIMEOUT', 'Still waiting for the network. Check again in a minute.', { signature });
      await sleep(1000);
    }
  }
  /**
   * Hand one transaction to the wallet. A blockhash lives ~150 blocks (about 35 s at today's slot times),
   * so a parent who takes longer in the wallet app gets a "blockhash not found" from the wallet: report
   * that as TX_EXPIRED (nothing was sent; just try again) rather than a generic wallet error.
   */
  async function walletSend(c, owner, tx, blockhash, lastValidBlockHeight) {
    try {
      const [signature] = await window.Wallet.signAndSend([tx]);
      return signature;
    } catch (e) {
      if (e && e.reason === 'WALLET_ERROR' && /blockhash|block height exceeded|expired/i.test(String(e.message))) {
        throw payError('TX_EXPIRED', 'The approval took longer than Solana allows (about 35 seconds), so nothing was sent. Please try again.', { cause: e.message });
      }
      if (e && e.maybeSubmitted) {
        // The wallet went quiet mid-send: look on-chain (until the blockhash expires) before saying anything.
        const sent = await findSentTransaction(c, owner, blockhash, lastValidBlockHeight);
        if (sent && !sent.err) return sent.signature;
        if (sent) throw payError('TX_FAILED', 'Solana did not accept the transaction.', { signature: sent.signature, err: sent.err });
        throw payError('NOT_SENT', 'The wallet stopped answering and the transaction never reached Solana, so nothing was spent. Please try again.');
      }
      throw e;
    }
  }

  /** Our transaction is the fee payer's one with our blockhash: find it, or null once that blockhash has expired. */
  async function findSentTransaction(c, owner, blockhash, lastValidBlockHeight) {
    const seen = new Set();
    for (;;) {
      const sigs = await c.getSignaturesForAddress(owner, { limit: 10 }, 'confirmed').catch(() => []);
      for (const s of sigs) {
        if (seen.has(s.signature)) continue;
        const tx = await c.getTransaction(s.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }).catch(() => null);
        if (!tx) continue;
        seen.add(s.signature);
        if (tx.transaction.message.recentBlockhash === blockhash) return { signature: s.signature, err: tx.meta ? tx.meta.err : null };
      }
      const height = await c.getBlockHeight('confirmed').catch(() => 0);
      if (height > lastValidBlockHeight + 10) return null;
      await sleep(2000);
    }
  }

  async function waitFinalized(c, signature) {
    const until = env.now() + env.finalizeTimeoutMs;
    while (env.now() < until) {
      try {
        const st = (await c.getSignatureStatuses([signature])).value[0];
        if (st && st.confirmationStatus === 'finalized') return true;
      } catch (e) { /* keep polling */ }
      await sleep(1500);
    }
    return false;
  }

  /**
   * Legacy transaction pipeline: build -> size check -> simulate -> wallet -> confirm.
   * build(withSlippage) returns the instruction list; it is rebuilt once without the *WithSlippage
   * pool instructions if the pool's program is too old to know them (devnet's SPoo1 build is).
   */
  async function runLegacy(c, owner, build, opts) {
    opts = opts || {};
    const { blockhash, lastValidBlockHeight } = await rpc(() => c.getLatestBlockhash('confirmed'), 'blockhash');
    const programKey = opts.programId ? opts.programId.toBase58() : null;
    let withSlippage = programKey ? slippageSupport.get(programKey) !== false : false;
    for (let attempt = 0; attempt < 2; attempt++) {
      const ixs = await build(withSlippage);
      const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(...ixs);
      const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      if (bytes.length > PACKET_BYTES) throw payError(opts.tooLargeCode || 'TX_TOO_LARGE', opts.tooLargeMessage || 'The transaction is too large.');
      const programs = ixs.map((ix) => ix.programId.toBase58());
      const value = await simulate(c, new VersionedTransaction(tx.compileMessage()));
      if (value.err && withSlippage && isUnknownInstruction(value.err, programs)) {
        slippageSupport.set(programKey, false);
        withSlippage = false;
        continue;
      }
      if (value.err) throw failFromSimulation(value, programs);
      const signature = await walletSend(c, owner, tx, blockhash, lastValidBlockHeight);
      if (opts.onSent) { try { opts.onSent(signature); } catch (e) { /* not ours */ } }
      await confirmSignature(c, signature, lastValidBlockHeight);
      return signature;
    }
    throw payError('TX_FAILED', 'Could not build a transaction this pool accepts.');
  }

  // ---------------------------------------------------------------- stake
  async function stake() {
    const c = conn();
    const owner = await ensureWallet();
    const p = await loadPool(c);
    if (p.s.solDepositAuthority) throw payError('POOL_RESTRICTED', 'This pool only accepts deposits from its own operator.');
    const accounts = await poolTokenAccounts(c, owner, p);
    const decimals = accounts.length ? accounts[0].decimals : (await mintDecimals(c, p.mint)).decimals;
    const held = accounts.reduce((a, x) => a + x.amount, 0n);
    const threshold = BigInt(Math.round(Number(cfg.stake.unlockThreshold) * 10 ** decimals));
    if (held >= threshold) {
      await entitlement().refresh({ ignoreHold: true });
      return { signature: null, alreadyStaked: true, poolTokens: Number(held) / 10 ** decimals };
    }
    const lamports = BigInt(Math.round(Number(cfg.stake.depositSol) * 1e9));
    const ata = splToken.getAssociatedTokenAddressSync(p.mint, owner, true, p.tokenProgram);
    const [fresh, ataInfo, balance] = await Promise.all([
      freshness(c, p), rpc(() => c.getAccountInfo(ata, 'confirmed'), 'token account'), rpc(() => c.getBalance(owner, 'confirmed'), 'balance'),
    ]);
    const ataRent = ataInfo ? 0n : BigInt(await rpc(() => c.getMinimumBalanceForRentExemption(ataRentBytes(p.tokenProgram)), 'rent'));
    const needed = lamports + ataRent + 20000n;
    if (BigInt(balance) < needed) {
      throw payError('INSUFFICIENT_SOL', 'Staking needs about ' + fmtSol(needed) + ' SOL; this wallet has ' + fmtSol(balance) + ' SOL.', { needed: sol(needed), balance: sol(balance) });
    }
    const expected = tokensForDeposit(p, lamports);
    if (expected <= 0n) throw payError('TOO_SMALL', 'That deposit is too small for the pool.');
    const signature = await runLegacy(c, owner, (withSlippage) => fresh.updateIxs.concat([
      splToken.createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, p.mint, p.tokenProgram),
      depositSolIx(p, owner, ata, lamports, minusSlippage(expected), withSlippage),
    ]), { programId: p.programId });
    await entitlement().refresh({ ignoreHold: true });
    return { signature, poolTokens: Number(expected) / 10 ** decimals, lamports: Number(lamports) };
  }

  // ---------------------------------------------------------------- exits
  async function exitInstant() {
    const c = conn();
    const owner = await ensureWallet();
    const p = await loadPool(c);
    if (p.s.solWithdrawAuthority) throw payError('POOL_RESTRICTED', 'This pool only allows instant exits by its own operator.');
    const accounts = await poolTokenAccounts(c, owner, p);
    if (!accounts.length) throw payError('NO_POOL_TOKENS', 'This wallet holds no pool tokens, so there is nothing to withdraw.');
    const [fresh, reserve] = await Promise.all([freshness(c, p), rpc(() => c.getAccountInfo(p.s.reserveStake, 'confirmed'), 'reserve')]);
    const reserveRent = BigInt(await rpc(() => c.getMinimumBalanceForRentExemption(reserve.data.length), 'rent'));
    const plan = accounts.map((a) => ({ a, out: lamportsForWithdraw(p, a.amount, p.s.solWithdrawalFee, a.pubkey.equals(p.s.managerFeeAccount)) }));
    const total = plan.reduce((x, y) => x + y.out, 0n);
    const available = BigInt(reserve.lamports) - reserveRent;
    if (total > available) {
      throw payError('RESERVE_LOW', 'The pool can pay out ' + fmtSol(available > 0n ? available : 0n) + ' SOL instantly right now and you need ' + fmtSol(total) + '. Use the free slow exit, or try again later.', { available: sol(available), needed: sol(total) });
    }
    let signature;
    try {
      signature = await runLegacy(c, owner, (withSlippage) => fresh.updateIxs.concat(plan.flatMap(({ a, out }) => [
        withdrawSolIx(p, owner, a.pubkey, owner, a.amount, minusSlippage(out), withSlippage),
        splToken.createCloseAccountInstruction(a.pubkey, owner, owner, [], p.tokenProgram), // rent back to the parent
      ])), { programId: p.programId, onSent: () => entitlement().revokeLocal() });
    } catch (e) {
      if (['TX_FAILED', 'TX_EXPIRED', 'NOT_SENT'].includes(e.reason)) entitlement().refresh({ ignoreHold: true });
      throw e;
    }
    entitlement().refresh();
    return { signature, solOut: sol(total) };
  }

  async function slotMs(c) {
    try {
      const samples = (await c.getRecentPerformanceSamples(4)).filter((s) => s.numSlots > 0);
      if (samples.length) return samples.reduce((a, s) => a + (s.samplePeriodSecs * 1000) / s.numSlots, 0) / samples.length;
    } catch (e) { /* use the default */ }
    return 400;
  }
  function timeOfEpoch(epochInfo, targetEpoch, msPerSlot) {
    const slots = (Number(targetEpoch) - epochInfo.epoch) * epochInfo.slotsInEpoch - epochInfo.slotIndex;
    return Math.round(env.now() + Math.max(0, slots) * msPerSlot);
  }
  async function exitAddresses(owner) {
    const out = [];
    for (let n = 0; n < EXIT_SEEDS; n++) {
      const seed = EXIT_SEED + n;
      out.push({ seed, address: await PublicKey.createWithSeed(owner, seed, StakeProgram.programId) });
    }
    return out;
  }

  async function exitSlow() {
    const c = conn();
    const owner = await ensureWallet();
    const p = await loadPool(c);
    const accounts = await poolTokenAccounts(c, owner, p);
    if (!accounts.length) throw payError('NO_POOL_TOKENS', 'This wallet holds no pool tokens, so there is nothing to withdraw.');
    const source = accounts[0]; // the largest token account (normally the only one)
    const fresh = await freshness(c, p);
    const [list, minDelegationRaw, rentStake, reserve, exits, msPerSlot] = await Promise.all([
      fresh.list ? fresh.list : loadValidatorList(c, p),
      c.getStakeMinimumDelegation('confirmed').then((r) => BigInt(r.value)).catch(() => 1000000000n),
      rpc(() => c.getMinimumBalanceForRentExemption(StakeProgram.space), 'rent').then(BigInt),
      rpc(() => c.getAccountInfo(p.s.reserveStake, 'confirmed'), 'reserve'),
      exitAddresses(owner),
      slotMs(c),
    ]);
    const out = lamportsForWithdraw(p, source.amount, p.s.stakeWithdrawalFee, source.pubkey.equals(p.s.managerFeeAccount));
    const minDelegation = minDelegationRaw > MINIMUM_ACTIVE_STAKE ? minDelegationRaw : MINIMUM_ACTIVE_STAKE;
    if (out < minDelegation) {
      throw payError('USE_INSTANT', 'Your pool tokens are worth ' + fmtSol(out) + ' SOL. A slow exit needs at least ' + fmtSol(minDelegation) + ' SOL (Solana\'s minimum stake), so please use the instant exit.', { worth: sol(out), minimum: sol(minDelegation) });
    }

    // Which pool account must pay this out? Mirrors process_withdraw_stake: an active validator account
    // if any has stake above the minimum, else transient stake, else the reserve.
    const required = rentStake + minDelegation;
    const perToken = p.supply === 0n ? 0n : (p.total + p.supply - 1n) / p.supply;
    const tolerance = required + perToken;
    const active = list.filter((v) => v.status === 0);
    const hasActive = active.some((v) => v.active > tolerance);
    const hasTransient = active.some((v) => v.transient > tolerance);
    let splitFrom, delegated;
    if (hasActive) {
      let candidates = active.filter((v) => v.active > tolerance);
      const preferred = p.s.preferredWithdrawValidatorVoteAddress;
      if (preferred) {
        const pv = candidates.find((v) => v.vote.equals(preferred));
        if (pv) candidates = [pv];
      }
      const infos = await rpc(() => c.getMultipleAccountsInfo(candidates.map((v) => v.stakeAccount), 'confirmed'), 'validator stake');
      let best = null;
      candidates.forEach((v, i) => {
        const lamports = infos[i] ? BigInt(infos[i].lamports) : 0n;
        if (lamports - out >= required && (!best || lamports > best.lamports)) best = { v, lamports };
      });
      if (!best) throw payError('SLOW_UNAVAILABLE', 'No single validator in the pool can pay out ' + fmtSol(out) + ' SOL as stake right now. Use the instant exit, or try again after the next epoch.');
      splitFrom = best.v.stakeAccount;
      delegated = true;
    } else if (hasTransient) {
      throw payError('SLOW_UNAVAILABLE', 'The pool is moving its stake this epoch. Try the slow exit again tomorrow, or use the instant exit.');
    } else {
      const reserveRent = BigInt(await rpc(() => c.getMinimumBalanceForRentExemption(reserve.data.length), 'rent'));
      if (BigInt(reserve.lamports) - out < reserveRent) throw payError('SLOW_UNAVAILABLE', 'The pool cannot pay out ' + fmtSol(out) + ' SOL right now. Please try again later.');
      splitFrom = p.s.reserveStake;
      delegated = false; // a split of the reserve is undelegated: claimable straight away
    }

    const infos = await rpc(() => c.getMultipleAccountsInfo(exits.map((x) => x.address), 'confirmed'), 'exit accounts');
    const free = exits.find((x, i) => !infos[i]);
    if (!free) throw payError('TOO_MANY_EXITS', 'Claim your earlier slow exits first.');

    let signature;
    try {
      signature = await runLegacy(c, owner, (withSlippage) => {
        const ixs = fresh.updateIxs.concat([
          SystemProgram.createAccountWithSeed({
            fromPubkey: owner, newAccountPubkey: free.address, basePubkey: owner, seed: free.seed,
            lamports: Number(rentStake), space: StakeProgram.space, programId: StakeProgram.programId,
          }),
          withdrawStakeIx(p, splitFrom, free.address, owner, source.pubkey, source.amount, minusSlippage(out), withSlippage),
        ]);
        if (delegated) ixs.push(StakeProgram.deactivate({ stakePubkey: free.address, authorizedPubkey: owner }).instructions[0]);
        ixs.push(splToken.createCloseAccountInstruction(source.pubkey, owner, owner, [], p.tokenProgram));
        return ixs;
      }, { programId: p.programId, onSent: () => entitlement().revokeLocal() });
    } catch (e) {
      if (['TX_FAILED', 'TX_EXPIRED', 'NOT_SENT'].includes(e.reason)) entitlement().refresh({ ignoreHold: true });
      throw e;
    }
    entitlement().refresh();
    const readyAt = delegated ? timeOfEpoch(fresh.epochInfo, fresh.epochInfo.epoch + 1, msPerSlot) : env.now();
    return { signature, stakeAccount: free.address.toBase58(), readyAt, sol: sol(out + rentStake), deactivating: delegated };
  }

  // ---- slow-exit bookkeeping ----
  function parseStakeAccount(data) {
    if (!data || data.length < 124) return null;
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const state = dv.getUint32(0, true); // 0 uninitialized, 1 initialized, 2 delegated, 3 rewards pool
    if (state !== 1 && state !== 2) return null;
    const meta = {
      staker: new PublicKey(data.subarray(12, 44)),
      withdrawer: new PublicKey(data.subarray(44, 76)),
      lockupUnix: dv.getBigInt64(76, true),
      lockupEpoch: dv.getBigUint64(84, true),
      custodian: new PublicKey(data.subarray(92, 124)),
    };
    if (state === 1 || data.length < 180) return { state, meta, delegation: null };
    return {
      state, meta,
      delegation: {
        voter: new PublicKey(data.subarray(124, 156)),
        stake: dv.getBigUint64(156, true),
        activationEpoch: dv.getBigUint64(164, true),
        deactivationEpoch: dv.getBigUint64(172, true),
      },
    };
  }

  async function loadStakeHistory(c) {
    const ai = await rpc(() => c.getAccountInfo(SYSVAR_STAKE_HISTORY_PUBKEY, 'confirmed'), 'stake history');
    const map = new Map();
    if (!ai) return map;
    const d = ai.data;
    const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const n = Number(dv.getBigUint64(0, true));
    for (let i = 0; i < n && 8 + i * 32 + 32 <= d.length; i++) {
      const o = 8 + i * 32;
      map.set(dv.getBigUint64(o, true), { effective: dv.getBigUint64(o + 8, true), deactivating: dv.getBigUint64(o + 24, true) });
    }
    return map;
  }

  /** Effective stake left at targetEpoch for stake deactivated at deactEpoch (Agave's cooldown, 9%/epoch). */
  function effectiveAfterDeactivation(stakeLamports, deactEpoch, targetEpoch, history) {
    if (targetEpoch <= deactEpoch) return stakeLamports;
    let prevEpoch = deactEpoch;
    let prev = history.get(deactEpoch);
    if (!prev) return 0n; // out of history: fully deactivated
    let current = stakeLamports;
    for (;;) {
      const epoch = prevEpoch + 1n;
      if (prev.deactivating === 0n) break;
      const weight = Number(current) / Number(prev.deactivating);
      const newly = BigInt(Math.max(1, Math.floor(weight * Number(prev.effective) * 0.09)));
      current = current > newly ? current - newly : 0n;
      if (current === 0n || epoch >= targetEpoch) break;
      const next = history.get(epoch);
      if (!next) break;
      prevEpoch = epoch;
      prev = next;
    }
    return current;
  }

  async function ownStakeAccounts(c, owner) {
    const found = new Map();
    try {
      const res = await c.getProgramAccounts(StakeProgram.programId, {
        commitment: 'confirmed',
        filters: [{ dataSize: StakeProgram.space }, { memcmp: { offset: 44, bytes: owner.toBase58() } }],
      });
      for (const r of res) found.set(r.pubkey.toBase58(), r.account);
    } catch (e) { /* some RPC providers refuse this query; our own exit accounts are still found below */ }
    const exits = await exitAddresses(owner);
    const infos = await rpc(() => c.getMultipleAccountsInfo(exits.map((x) => x.address), 'confirmed'), 'exit accounts');
    infos.forEach((ai, i) => { if (ai && ai.owner.equals(StakeProgram.programId)) found.set(exits[i].address.toBase58(), ai); });
    const ours = new Set(exits.map((x) => x.address.toBase58()));
    return Array.from(found.entries()).map(([k, account]) => ({ pubkey: new PublicKey(k), account, ours: ours.has(k) }));
  }

  async function pendingSlowExits() {
    if (!window.Wallet || !window.Wallet.publicKey) return [];
    const c = conn();
    const owner = new PublicKey(window.Wallet.publicKey);
    const [accounts, epochInfo, msPerSlot] = await Promise.all([ownStakeAccounts(c, owner), rpc(() => c.getEpochInfo('confirmed'), 'epoch'), slotMs(c)]);
    const epoch = BigInt(epochInfo.epoch);
    const nowSec = BigInt(Math.floor(env.now() / 1000));
    const parsed = accounts.map((a) => ({ a, s: parseStakeAccount(a.account.data) })).filter((x) => x.s && x.s.meta.withdrawer.equals(owner));
    const needHistory = parsed.some((x) => x.s.delegation && x.s.delegation.deactivationEpoch !== U64_MAX && epoch > x.s.delegation.deactivationEpoch);
    const history = needHistory ? await loadStakeHistory(c) : new Map();
    const out = [];
    for (const { a, s } of parsed) {
      const locked = (s.meta.lockupUnix > nowSec || s.meta.lockupEpoch > epoch) && !s.meta.custodian.equals(owner);
      if (locked) continue; // a lockup we cannot lift: not one of our exits
      const base = { stakeAccount: a.pubkey.toBase58(), lamports: a.account.lamports, sol: sol(a.account.lamports), ours: a.ours };
      const d = s.delegation;
      if (!d || d.activationEpoch === d.deactivationEpoch) { out.push(Object.assign(base, { ready: true, readyAt: env.now() })); continue; }
      if (d.deactivationEpoch === U64_MAX) continue; // still staking: the parent's own stake, not an exit
      if (epoch <= d.deactivationEpoch) { out.push(Object.assign(base, { ready: false, readyAt: timeOfEpoch(epochInfo, d.deactivationEpoch + 1n, msPerSlot) })); continue; }
      const left = effectiveAfterDeactivation(d.stake, d.deactivationEpoch, epoch, history);
      out.push(Object.assign(base, left === 0n ? { ready: true, readyAt: env.now() } : { ready: false, readyAt: timeOfEpoch(epochInfo, epoch + 1n, msPerSlot) }));
    }
    return out.sort((x, y) => x.readyAt - y.readyAt);
  }

  /** opts.onlyOurs: claim only stake accounts this app's exitSlow created (default: every inactive one). */
  async function claimSlow(opts) {
    const c = conn();
    const owner = await ensureWallet();
    const exits = (await pendingSlowExits()).filter((x) => !(opts && opts.onlyOurs) || x.ours);
    const ready = exits.filter((x) => x.ready);
    if (!ready.length) {
      const next = exits.length ? Math.min.apply(null, exits.map((x) => x.readyAt)) : null;
      throw payError('NOTHING_TO_CLAIM', next ? 'Your SOL is still unlocking. It should be ready around ' + new Date(next).toLocaleString() + '.' : 'There is nothing waiting to be claimed.', { nextReadyAt: next });
    }
    const batch = ready.slice(0, 8);
    const signature = await runLegacy(c, owner, () => batch.map((x) => StakeProgram.withdraw({
      stakePubkey: new PublicKey(x.stakeAccount), authorizedPubkey: owner, toPubkey: owner, lamports: x.lamports,
    }).instructions[0]));
    const lamports = batch.reduce((a, x) => a + x.lamports, 0);
    return { signature, lamports, sol: sol(lamports), solOut: sol(lamports), claimed: batch.length, remaining: ready.length - batch.length };
  }

  // ---------------------------------------------------------------- pay once
  // Logos are data: URIs (the paywall never loads remote images).
  const svgUri = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg);
  const LOGO_SOL = svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#9945ff"/><stop offset="1" stop-color="#14f195"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="#121212"/><g fill="url(#g)"><path d="M21 20h28l-6 6H15z"/><path d="M15 29h28l6 6H21z"/><path d="M21 38h28l-6 6H15z"/></g></svg>');
  const LOGO_USDC = svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#2775ca"/><circle cx="32" cy="32" r="21" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="44 22" transform="rotate(-25 32 32)"/><text x="32" y="42" font-family="sans-serif" font-size="27" font-weight="700" fill="#fff" text-anchor="middle">$</text></svg>');
  function logoFor(mint, symbol) {
    if (mint === SOL_MINT) return LOGO_SOL;
    if (mint === ((cfg.merchant && cfg.merchant.usdcMint) || '') || symbol === 'USDC') return LOGO_USDC;
    const text = String(symbol || '').replace(/[^A-Za-z0-9$]/g, '').slice(0, 4) || '?'; // also keeps the SVG well-formed
    return svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#5b6b7c"/><text x="32" y="' + (text.length > 3 ? 38 : 40) +
      '" font-family="sans-serif" font-size="' + (text.length > 3 ? 15 : 19) + '" font-weight="700" fill="#fff" text-anchor="middle">' + text + '</text></svg>');
  }

  function usdcUnits() { return entitlement().priceUnits(6); } // USDC has 6 decimals; exact base units (US$4.99 -> 4990000n), the same amount the purchase check requires
  function normalizeMint(mint) { return !mint || mint === 'SOL' ? SOL_MINT : String(mint); }
  function referenceMeta(reference) { return { pubkey: new PublicKey(reference), isSigner: false, isWritable: false }; }
  /** A 0-lamport transfer to the merchant that carries the read-only reference key (Solana Pay style). */
  function referenceIx(owner, reference) {
    const ix = SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(cfg.merchant.wallet), lamports: 0 });
    ix.keys.push(referenceMeta(reference));
    return ix;
  }

  async function jup(path, init) {
    const base = String((cfg.jupiter && cfg.jupiter.apiBase) || 'https://api.jup.ag').replace(/\/+$/, '');
    const headers = Object.assign({ Accept: 'application/json' }, (init && init.headers) || {});
    if (cfg.jupiter && cfg.jupiter.apiKey) headers['x-api-key'] = cfg.jupiter.apiKey;
    for (let attempt = 0; ; attempt++) {
      let r;
      try { r = await fetch(base + path, Object.assign({}, init || {}, { headers })); } catch (e) {
        throw payError('OFFLINE', 'The phone could not reach Jupiter (the swap service). Check the internet connection and try again.', { detail: (e && e.message) || String(e) });
      }
      if (r.status === 429 && attempt < 3) { await sleep(2100 * (attempt + 1)); continue; } // keyless limit: 0.5 requests/s
      const text = await r.text();
      let body = null;
      try { body = JSON.parse(text); } catch (e) { body = null; }
      if (r.status === 401 || r.status === 403) throw payError('JUPITER_KEY', 'Jupiter refused the request; set jupiter.apiKey in web/config.js.', { status: r.status });
      if (!r.ok) {
        const msg = (body && (body.error || body.message || body.errorCode)) || text.slice(0, 200);
        if (/route|liquidity|not tradable|ExactOut/i.test(String(msg))) throw payError('NO_ROUTE', 'No swap route: ' + msg, { status: r.status });
        throw payError('JUPITER_ERROR', 'Jupiter error ' + r.status + ': ' + msg, { status: r.status });
      }
      return body;
    }
  }
  function toIx(j) {
    return new TransactionInstruction({
      programId: new PublicKey(j.programId),
      keys: j.accounts.map((a) => ({ pubkey: new PublicKey(a.pubkey), isSigner: !!a.isSigner, isWritable: !!a.isWritable })),
      data: Buffer.from(j.data, 'base64'),
    });
  }
  function priceIxs(list) {
    // keep Jupiter's compute-unit PRICE; the LIMIT is set here after simulating
    return (list || []).map(toIx).filter((ix) => ix.data[0] === 3);
  }
  async function loadAlts(c, addresses) {
    const res = await Promise.all((addresses || []).map((a) => rpc(() => c.getAddressLookupTable(new PublicKey(a)), 'lookup table')));
    return res.map((r) => r.value).filter(Boolean);
  }
  function altsFromMap(map) {
    return Object.entries(map || {}).map(([key, addresses]) => new AddressLookupTableAccount({
      key: new PublicKey(key),
      state: { deactivationSlot: U64_MAX, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: addresses.map((a) => new PublicKey(a)) },
    }));
  }
  function quoteSummary(q) {
    return { inputMint: q.inputMint, inAmount: q.inAmount, outputMint: q.outputMint, outAmount: q.outAmount, otherAmountThreshold: q.otherAmountThreshold, swapMode: q.swapMode, slippageBps: q.slippageBps, priceImpactPct: q.priceImpactPct, labels: (q.routePlan || []).map((r) => r.swapInfo && r.swapInfo.label) };
  }

  /** Metis ExactOut: exactly priceUsd USDC lands in merchant.usdcAta (Orca Whirlpool, Raydium CLMM/CPMM routes only). */
  async function jupiterExactOut(c, owner, mint, reference, maxAccounts) {
    const m = cfg.merchant;
    const amount = usdcUnits();
    const qs = new URLSearchParams({
      inputMint: mint, outputMint: m.usdcMint, amount: String(amount), swapMode: 'ExactOut',
      slippageBps: String(cfg.slippageBps || 50), restrictIntermediateTokens: 'true', instructionVersion: 'V2',
    });
    if (maxAccounts) qs.set('maxAccounts', String(maxAccounts));
    const quote = await jup('/swap/v1/quote?' + qs.toString());
    if (!quote || quote.swapMode !== 'ExactOut' || String(quote.outAmount) !== String(amount)) throw payError('NO_ROUTE', 'Jupiter has no exact-output route for this token.');
    const si = await jup('/swap/v1/swap-instructions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quoteResponse: quote, userPublicKey: owner.toBase58(), destinationTokenAccount: m.usdcAta, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: false }),
    });
    if (!si || si.error || !si.swapInstruction) throw payError('JUPITER_ERROR', 'Jupiter could not build the swap: ' + ((si && si.error) || 'no instructions'));
    const ixs = (si.setupInstructions || []).map(toIx).concat([toIx(si.swapInstruction)]);
    if (si.cleanupInstruction) ixs.push(toIx(si.cleanupInstruction));
    for (const o of si.otherInstructions || []) ixs.push(toIx(o));
    const plain = ixs.concat([referenceIx(owner, reference)]);
    // The route passes the USDC through the payer's own USDC account, which Jupiter creates if missing
    // (~0.002 SOL rent). If it did not exist before, close it again at the end so the rent comes straight
    // back; if the close would fail (USDC left in it), finishV0 falls back to the plain transaction.
    const ownUsdc = splToken.getAssociatedTokenAddressSync(new PublicKey(m.usdcMint), owner, true, TOKEN_PROGRAM_ID);
    const creates = ixs.some((ix) => ix.programId.equals(splToken.ASSOCIATED_TOKEN_PROGRAM_ID) && ix.keys[1] && ix.keys[1].pubkey.equals(ownUsdc));
    const existed = creates ? !!(await rpc(() => c.getAccountInfo(ownUsdc, 'confirmed'), 'token account')) : true;
    const withClose = existed ? null : ixs.concat([splToken.createCloseAccountInstruction(ownUsdc, owner, owner, [], TOKEN_PROGRAM_ID), referenceIx(owner, reference)]);
    return {
      ixs: withClose || plain, fallbackIxs: withClose ? plain : null,
      price: priceIxs(si.computeBudgetInstructions), alts: await loadAlts(c, si.addressLookupTableAddresses), route: 'exactOut', quote: quoteSummary(quote),
    };
  }

  /** Fallback: Swap V2 /build (ExactIn only) into the payer's own USDC account, then an exact USDC transfer. */
  async function jupiterExactInPlusTransfer(c, owner, mint, reference, maxAccounts) {
    const m = cfg.merchant;
    const need = usdcUnits();
    const prices = await jup('/price/v3?ids=' + encodeURIComponent(mint));
    const info = prices && prices[mint];
    if (!info || !info.usdPrice) throw payError('NO_ROUTE', 'Jupiter has no price for this token.');
    const decimals = info.decimals != null ? info.decimals : (await mintDecimals(c, new PublicKey(mint))).decimals;
    let amountIn = BigInt(Math.ceil((Number(cfg.priceUsd) / info.usdPrice) * 1.02 * 10 ** decimals));
    let build = null;
    for (let i = 0; i < 3 && !build; i++) {
      const qs = new URLSearchParams({ inputMint: mint, outputMint: m.usdcMint, amount: String(amountIn), taker: owner.toBase58(), slippageBps: String(cfg.slippageBps || 50), maxAccounts: String(maxAccounts || 40) });
      const b = await jup('/swap/v2/build?' + qs.toString());
      const min = BigInt(b.otherAmountThreshold || '0');
      if (min >= need) build = b;
      else amountIn = (amountIn * need * 102n) / ((min > 0n ? min : 1n) * 100n) + 1n;
    }
    if (!build) throw payError('NO_ROUTE', 'Could not find a swap that yields ' + cfg.priceUsd + ' USDC.');
    const usdcMint = new PublicKey(m.usdcMint);
    const ownUsdc = splToken.getAssociatedTokenAddressSync(usdcMint, owner, true, TOKEN_PROGRAM_ID);
    const ixs = (build.setupInstructions || []).map(toIx).concat([toIx(build.swapInstruction)]);
    if (build.cleanupInstruction) ixs.push(toIx(build.cleanupInstruction));
    for (const o of build.otherInstructions || []) ixs.push(toIx(o));
    const pay = splToken.createTransferCheckedInstruction(ownUsdc, usdcMint, new PublicKey(m.usdcAta), owner, need, 6, [], TOKEN_PROGRAM_ID);
    pay.keys.push(referenceMeta(reference));
    ixs.push(pay);
    return { ixs, price: priceIxs(build.computeBudgetInstructions), alts: altsFromMap(build.addressesByLookupTableAddress), route: 'exactIn+transfer', quote: quoteSummary(build) };
  }

  /** Direct token transfer of priceUsd (USDC) to merchant.usdcAta, carrying the reference. */
  async function usdcTransferIx(c, owner, reference, skipChecks) {
    const m = cfg.merchant;
    const mint = new PublicKey(m.usdcMint);
    const merchantAta = new PublicKey(m.usdcAta);
    const { decimals, tokenProgram } = await mintDecimals(c, mint);
    const amount = entitlement().priceUnits(decimals);
    const source = splToken.getAssociatedTokenAddressSync(mint, owner, true, tokenProgram);
    if (!skipChecks) {
      const [bal, dest] = await Promise.all([c.getTokenAccountBalance(source, 'confirmed').catch(() => null), rpc(() => c.getAccountInfo(merchantAta, 'confirmed'), 'merchant')]);
      if (!dest) throw payError('NOT_CONFIGURED', 'The studio\'s USDC account (merchant.usdcAta) does not exist yet.');
      if (!bal || BigInt(bal.value.amount) < amount) throw payError('INSUFFICIENT_FUNDS', 'Paying needs ' + cfg.priceUsd + ' USDC; this wallet has ' + (bal ? bal.value.uiAmountString : '0') + '.');
    }
    const ix = splToken.createTransferCheckedInstruction(source, mint, merchantAta, owner, amount, decimals, [], tokenProgram);
    ix.keys.push(referenceMeta(reference));
    return ix;
  }

  /** v0 pipeline for Jupiter routes: size check, simulate for compute units, set the limit. */
  async function finishV0(c, owner, parts, dryRun) {
    const { blockhash, lastValidBlockHeight } = await rpc(() => c.getLatestBlockhash('confirmed'), 'blockhash');
    const make = (body, units) => {
      const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units })].concat(parts.price, body);
      const message = new TransactionMessage({ payerKey: owner, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(parts.alts);
      return { tx: new VersionedTransaction(message), programs: ixs.map((ix) => ix.programId.toBase58()) };
    };
    let body = parts.ixs;
    let built = make(body, 1400000);
    if (built.tx.serialize().length > PACKET_BYTES) throw payError('TX_TOO_LARGE', 'The swap transaction is too large.');
    let sim = await simulate(c, built.tx);
    if (sim.err && parts.fallbackIxs) { // e.g. the optional rent-refund close did not fit this route
      const alt = make(parts.fallbackIxs, 1400000);
      const altSim = await simulate(c, alt.tx);
      if (!altSim.err) { body = parts.fallbackIxs; built = alt; sim = altSim; }
    }
    if (sim.err && !dryRun) throw failFromSimulation(sim, built.programs);
    if (!sim.err && sim.unitsConsumed) built = make(body, Math.min(1400000, Math.ceil(sim.unitsConsumed * 1.2) + 1000));
    return { tx: built.tx, programs: built.programs, lastValidBlockHeight, refundsTokenAccount: body !== parts.fallbackIxs && !!parts.fallbackIxs, simulation: { err: sim.err, unitsConsumed: sim.unitsConsumed || null, logs: sim.logs || [] } };
  }

  async function planMainnet(c, owner, mint, reference, dryRun, forceRoute) {
    const m = cfg.merchant;
    if (mint === m.usdcMint) {
      const ix = await usdcTransferIx(c, owner, reference, dryRun);
      return Object.assign(await finishV0(c, owner, { ixs: [ix], price: [], alts: [] }, dryRun), { route: 'usdc' });
    }
    if (!dryRun && !(await rpc(() => c.getAccountInfo(new PublicKey(m.usdcAta), 'confirmed'), 'merchant'))) {
      throw payError('NOT_CONFIGURED', 'The studio\'s USDC account (merchant.usdcAta) does not exist yet.');
    }
    const fallbackOn = ['NO_ROUTE', 'JUPITER_ERROR', 'TX_TOO_LARGE', 'TX_FAILED', 'SLIPPAGE'];
    const routes = [[jupiterExactOut, [0, 40, 28]], [jupiterExactInPlusTransfer, [40, 28, 20]]];
    if (forceRoute === 'exactIn+transfer') routes.shift(); // tests: exercise the fallback on demand
    let lastError = null;
    for (const [compose, sizes] of routes) {
      for (const maxAccounts of sizes) {
        try {
          const parts = await compose(c, owner, mint, reference, maxAccounts);
          return Object.assign(await finishV0(c, owner, parts, dryRun), { route: parts.route, quote: parts.quote });
        } catch (e) {
          lastError = e;
          if (e.reason !== 'TX_TOO_LARGE') break;
        }
      }
      if (!fallbackOn.includes(lastError && lastError.reason)) throw lastError;
    }
    throw lastError || payError('NO_ROUTE', 'No way to pay with this token right now.');
  }

  async function planDevnet(c, owner, mint, reference) {
    const m = cfg.merchant;
    if (mint === SOL_MINT) {
      const ix = SystemProgram.transfer({ fromPubkey: owner, toPubkey: new PublicKey(m.wallet), lamports: Math.round(Number(cfg.devnetPriceSol || 0.1) * 1e9) });
      ix.keys.push(referenceMeta(reference));
      return { ixs: [ix], route: 'devnet-sol' };
    }
    if (m.usdcMint && m.usdcAta && mint === m.usdcMint) return { ixs: [await usdcTransferIx(c, owner, reference, false)], route: 'devnet-usdc' };
    throw payError('UNSUPPORTED_TOKEN', 'On devnet you can pay with SOL or devnet USDC.');
  }

  async function buy(mint, opts) {
    opts = opts || {};
    const m = cfg.merchant || {};
    if (!m.wallet || (isMainnet() && (!m.usdcMint || !m.usdcAta))) throw payError('NOT_CONFIGURED', 'The studio\'s payment accounts are not set in web/config.js yet.');
    const c = conn();
    const owner = await ensureWallet();
    const token = normalizeMint(mint);
    const reference = entitlement().referenceFor(owner.toBase58());
    if (!opts.dryRun) {
      const existing = await entitlement().findPurchase(owner.toBase58()).catch(() => null);
      if (existing) { await entitlement().refresh(); return { signature: existing.signature, alreadyOwned: true }; }
    }
    if (isMainnet()) {
      const plan = await planMainnet(c, owner, token, reference, !!opts.dryRun, opts.forceRoute);
      if (opts.dryRun) {
        return { dryRun: true, route: plan.route, quote: plan.quote || null, reference, size: plan.tx.serialize().length, refundsTokenAccount: plan.refundsTokenAccount, transaction: Buffer.from(plan.tx.serialize()).toString('base64'), simulation: plan.simulation };
      }
      const signature = await walletSend(c, owner, plan.tx, plan.tx.message.recentBlockhash, plan.lastValidBlockHeight);
      await confirmSignature(c, signature, plan.lastValidBlockHeight);
      return afterPurchase(c, signature, plan.route);
    }
    const plan = await planDevnet(c, owner, token, reference);
    if (opts.dryRun) return { dryRun: true, route: plan.route, reference, instructions: plan.ixs.length };
    const balance = await rpc(() => c.getBalance(owner, 'confirmed'), 'balance');
    const price = plan.route === 'devnet-sol' ? Math.round(Number(cfg.devnetPriceSol || 0.1) * 1e9) : 0;
    if (balance < price + 10000) throw payError('INSUFFICIENT_SOL', 'Paying needs about ' + fmtSol(price + 10000) + ' SOL; this wallet has ' + fmtSol(balance) + ' SOL.');
    const signature = await runLegacy(c, owner, () => plan.ixs);
    return afterPurchase(c, signature, plan.route);
  }

  /**
   * The purchase is confirmed: tell IsabellaEntitlement about it so refresh() unlocks right away (it checks
   * this one signature at 'confirmed'; the reinstall path still needs a finalized transfer), then let
   * finalization finish in the background and refresh once more.
   */
  async function afterPurchase(c, signature, route) {
    entitlement().notePurchase(signature);
    const s = await entitlement().refresh();
    waitFinalized(c, signature).then((done) => { if (done) entitlement().refresh(); });
    return { signature, route, unlocked: !!(s && s.unlocked) };
  }

  async function payableTokens() {
    const c = conn();
    const owner = window.Wallet && window.Wallet.publicKey ? new PublicKey(window.Wallet.publicKey) : null;
    const m = cfg.merchant || {};
    if (!isMainnet()) {
      const list = [{ mint: SOL_MINT, symbol: 'SOL', logo: LOGO_SOL, decimals: 9, amountNeeded: Number(cfg.devnetPriceSol || 0.1), balance: null, enough: null }];
      if (m.usdcMint) list.push({ mint: m.usdcMint, symbol: 'USDC', logo: LOGO_USDC, decimals: 6, amountNeeded: Number(cfg.priceUsd), balance: null, enough: null });
      if (owner) {
        const lamports = await rpc(() => c.getBalance(owner, 'confirmed'), 'balance');
        list[0].balance = sol(lamports);
        list[0].enough = lamports >= Math.round(list[0].amountNeeded * 1e9) + 10000;
        if (list[1]) {
          const res = await rpc(() => c.getParsedTokenAccountsByOwner(owner, { mint: new PublicKey(m.usdcMint) }, 'confirmed'), 'token accounts');
          const raw = res.value.reduce((a, x) => a + BigInt(x.account.data.parsed.info.tokenAmount.amount), 0n);
          list[1].balance = Number(raw) / 1e6;
          list[1].enough = raw >= usdcUnits();
        }
      }
      return list;
    }
    // mainnet: what the wallet holds, filtered to Jupiter-verified tokens, priced by Jupiter
    const held = new Map([[SOL_MINT, { raw: 0n, decimals: 9 }]]);
    if (owner) {
      held.get(SOL_MINT).raw = BigInt(await rpc(() => c.getBalance(owner, 'confirmed'), 'balance'));
      for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        const res = await rpc(() => c.getParsedTokenAccountsByOwner(owner, { programId }, 'confirmed'), 'token accounts');
        for (const { account } of res.value) {
          const info = account.data.parsed.info;
          const amt = BigInt(info.tokenAmount.amount);
          if (amt === 0n) continue;
          const prev = held.get(info.mint);
          held.set(info.mint, { raw: (prev ? prev.raw : 0n) + amt, decimals: info.tokenAmount.decimals });
        }
      }
    }
    if (!held.has(m.usdcMint)) held.set(m.usdcMint, { raw: 0n, decimals: 6 });
    const mints = [SOL_MINT, m.usdcMint].concat(Array.from(held.keys()).filter((k) => k !== SOL_MINT && k !== m.usdcMint)).slice(0, 100);
    const infos = [];
    for (let i = 0; i < mints.length; i += 50) { // Tokens API: search by up to 100 comma-separated mints; ask 50 at a time
      const part = await jup('/tokens/v2/search?query=' + encodeURIComponent(mints.slice(i, i + 50).join(',')));
      if (Array.isArray(part)) infos.push(...part);
    }
    const out = [];
    for (const t of infos) {
      if (!held.has(t.id)) continue;
      const verified = t.isVerified === true || (Array.isArray(t.tags) && t.tags.includes('verified'));
      if (!verified || !(t.usdPrice > 0)) continue;
      const h = held.get(t.id);
      const isUsdc = t.id === m.usdcMint;
      const unit = 10 ** t.decimals;
      const amountNeeded = isUsdc ? Number(cfg.priceUsd) : Math.ceil((Number(cfg.priceUsd) / t.usdPrice) * 1.01 * unit) / unit; // 1% for slippage
      const balance = Number(h.raw) / unit;
      const reserveSol = t.id === SOL_MINT ? 0.005 : 0; // fees and a possible token account
      const enough = isUsdc ? h.raw >= entitlement().priceUnits(t.decimals) : balance >= amountNeeded + reserveSol; // USDC is compared in base units
      out.push({ mint: t.id, symbol: t.symbol, logo: logoFor(t.id, t.symbol), decimals: t.decimals, usdPrice: t.usdPrice, amountNeeded, balance, enough });
    }
    const rank = (x) => (x.mint === SOL_MINT ? 2 : x.mint === m.usdcMint ? 1 : 0);
    return out.sort((a, b) => (b.enough - a.enough) || (rank(b) - rank(a)) || (b.balance * b.usdPrice - a.balance * a.usdPrice));
  }

  window.IsabellaPay = {
    stake, exitInstant, exitSlow, pendingSlowExits, claimSlow, payableTokens, buy,
    SOL_MINT,
    _env: env,
    _internals: {
      loadPool, loadValidatorList, decodeValidatorList, parseStakeAccount, effectiveAfterDeactivation, exitAddresses,
      tokensForDeposit, lamportsForWithdraw, explainFailure, slippageSupport, referenceIx,
    },
  };
})();
