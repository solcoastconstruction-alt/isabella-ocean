# Isabella stake pool (`pool/`)

The studio's own [SPL stake pool](https://github.com/solana-program/stake-pool). A parent deposits about 1.01 SOL and gets about 1.01 **OCEAN** (the "Isabella Ocean Pass" pool token). The pool stakes that SOL with validators. The pool's **fee on rewards is 100%**, so every staking reward is minted as new OCEAN to the studio's manager fee account. The OCEAN token stays at about 1.0 SOL, and the parent's SOL is always theirs to take back.

Background research, with source links: [`docs/kids-bundle/appendix-b-own-stake-pool.md`](../docs/kids-bundle/appendix-b-own-stake-pool.md). Settings: [`docs/kids-bundle/BUILD-PLAN.md`](../docs/kids-bundle/BUILD-PLAN.md).

> **Devnet only so far.** Every address below is a devnet address. The mainnet pool is created later by the owner with his own keys and funds (see the [runbook](#mainnet-runbook)). The scripts refuse to send mainnet transactions unless `POOL_ALLOW_MAINNET=yes` is set, and they check the RPC's genesis hash against the configured cluster before sending anything.

## Contents
- [How it works](#how-it-works)
- [Devnet deployment](#devnet-deployment)
- [Commands](#commands)
- [For the app (payments integration)](#for-the-app-payments-integration)
- [Mainnet runbook](#mainnet-runbook)
- [Risks](#risks)
- [How the hand-encoded instructions were validated](#how-the-hand-encoded-instructions-were-validated)

## How it works

| Piece | What it is |
|---|---|
| Stake pool account | The pool's state: fees, authorities, total lamports, token supply |
| Reserve stake account | Undelegated SOL. Deposits land here, and instant exits (`WithdrawSol`) are paid from here |
| Validator stake accounts | One per validator, each holding at least 1 SOL + rent (the 1 SOL minimum delegation since stake program v5) |
| Transient stake accounts | Stake moving between the reserve and a validator. It merges at the next epoch's update |
| Pool mint (OCEAN) | 9 decimals, mint authority = the pool's withdraw-authority PDA, no freeze authority |
| Manager fee account | The manager's OCEAN account. The 100% reward fee and the 0.3% instant-exit fee are paid into it |

**Settings** (fixed at creation, per the BUILD-PLAN):

| Setting | Value | Note |
|---|---|---|
| Fee on rewards (epoch fee) | 1/1 = 100% | Minted to the manager at every update |
| SOL withdrawal fee (instant exit) | 3/1000 = 0.3% | Paid in OCEAN to the manager. The SOL stays in the reserve |
| Stake withdrawal fee (free exit) | 0 | `Initialize` has a single withdrawal fee for SOL **and** stake, so the pool is created at 0.3% for both and then `SetFee StakeWithdrawal 0/100` is sent. Withdrawal-fee changes only take effect after **2 epoch boundaries**, so stake exits cost 0.3% for the pool's first ~2 epochs |
| Deposit fees | 0 | |
| Stake-deposit authority | the manager | Only the manager may deposit stake accounts. This blocks the fee-dodging "leech" trick. SOL deposits stay open to everyone |
| Max validators | 4 | Fits a single `UpdateValidatorListBalance` |
| Token metadata | `Isabella Ocean Pass` / `OCEAN` | Metaplex metadata created through the pool program. The URI is a placeholder on devnet |

**Every epoch**, someone has to send the permissionless update: `UpdateValidatorListBalance` (merges transients and counts rewards), then `UpdateStakePoolBalance` (mints the 100% fee and applies pending fee changes), then `CleanupRemovedValidatorEntries`. Until that happens, deposits and withdrawals fail with `0x11` (`StakeListAndPoolOutOfDate`). During the few minutes when the epoch's rewards are being paid out, the update fails with `0x2b` (`EpochRewardDistributionInProgress`), and the crank retries. `crank.mjs` does all of this, and a GitHub Action runs it every 6 hours.

**What the 1 SOL minimum does to exits** (from `process_withdraw_stake`, program v2.1.0, same logic in v2.0.x):
1. **Instant exit** (`WithdrawSol`) works for any amount the reserve holds, minus the 0.3% fee.
2. **Free exit** (`WithdrawStake`) must split at least 1 SOL of delegated stake. If **any** validator holds more than its minimum (rent + 1 SOL ≈ 1.0017 SOL), the exit must come from a validator, and that validator must keep at least its minimum afterwards.
   - So a validator whose *headroom* (lamports above its minimum) is between 0 and one deposit (1.01 SOL) blocks every 1.01 SOL slow exit. The reserve is closed and no validator can pay. This is **the band**.
   - When an exit is blocked, the app reports `SLOW_UNAVAILABLE` and points the parent to the instant exit.
   - `status.mjs` prints "largest stake exit", and the crank warns about validators in the band.
3. **While every validator sits exactly at its minimum**, the program pays slow exits from the **reserve** as *undelegated* stake, which can be claimed at once and costs no fee. **Accepted:** the stake-withdrawal fee stays 0, so the free exit stays free.
4. A delegated exit is deactivated in the same transaction and is claimable after the next epoch boundary: ~28 h epochs on devnet (234 ms slots), ~32 h on mainnet. If the stake was activated and deactivated in the same epoch (for example, split from a transient the crank created that epoch), it is claimable at once.

**Rebalancing** (`crank.mjs`, `planRebalance` in `lib/pool-ops.mjs`) is built so that no validator is ever left in the band:
- **Buffer.** Keep a **reserve buffer** liquid for instant exits: devnet 1.05 SOL, mainnet 2 SOL, or `RESERVE_BUFFER_PCT` of the pool if that is larger.
- **One primary validator** holds all staked SOL. It is the lowest-commission validator (ties go to the one already holding the most), or whatever `--primary` / `POOL_PRIMARY_VALIDATOR` names. Every other validator stays at its minimum.
- **Increases come in whole deposits.** The excess above the buffer is staked into the primary so that its next-epoch headroom is a whole number of deposits (k × 1.01 SOL, `--deposit-sol`), with k as large as the excess allows.
  - Each 1.01 SOL slow exit then takes exactly one deposit and leaves the primary at the next whole number, or at exactly its minimum.
  - A move tops up any dust first. For example, the 0.003 SOL left by an exit during the 0.3% stake-fee period becomes a 1.00697 SOL move.
  - The move must be at least 1 SOL, so a remainder of r needs k × 1.01 − r ≥ 1.
- **Decreases land at the minimum or keep a whole deposit.** They only happen when the reserve falls well below the buffer (by more than half a chunk or half the buffer); small gaps are left alone, because every move is ≥ 1 SOL. Secondaries go back to exactly their minimum. The primary gives whole deposits and keeps at least one, or else lands exactly at its minimum.
- **One move per validator per epoch.** `DecreaseAdditionalValidatorStake` would have to merge two deactivating stake accounts, which the stake program refuses while they still have effective stake (`MergeTransientStake`, seen in a devnet simulation).
- **Activating transients.** In the epoch a stake move is made, the stake sits in an activating transient. If the primary was at its minimum and only one deposit was moved, the transient closes the reserve but is too small to pay a 1.01 exit, so slow exits are blocked until the next epoch's update merges it. `smoke.mjs --primary-exit-check` checks the merged case across that boundary.

## Devnet deployment

Created 2 Oct 2026, epoch 1172. Public addresses live in [`devnet.json`](devnet.json), which the scripts read.

| Account | Address |
|---|---|
| Pool | [`D5k3bxRYCWizSToy7C3WzQoPBXYNAUZ78Lo2vvFR9q7a`](https://explorer.solana.com/address/D5k3bxRYCWizSToy7C3WzQoPBXYNAUZ78Lo2vvFR9q7a?cluster=devnet) |
| Mint (OCEAN, 9 decimals) | `Fm2VtHvAdzAFz7XbD9gNWbrnnqhEqkCEoZVyVyxFS7TT` |
| Reserve | `6VJJwviBbfa9WNNNSmK8aR1UpGNuhwZSgwtPUuqTm4Ud` |
| Validator list | `ANX2oxjGduXwgDE5SmVM2o9NWDfTbHDMeE8mBuXwNEaM` |
| Withdraw authority (PDA) | `63rAwzgKQ7P5CSHVtQi6Gasu3wVKhChmzxA2H2A5ssRD` |
| Manager fee account | `9LMkFnDWnsHU1SxXanacXRp1HZKs6jDE5UAcnreVvgC2` |
| Manager / staker | `Ga9LMAoVmGdTNHk8SXy2ZHEReEfcEHdagm8hV177UZs7` / `4SVrSXhrS3CFYTetjMCZeqMt7TdKyc9fqn84pBHRpRx5` |
| Validators | primary `APsEUZJjrb58KCS6z7rJJAmXB76b9bfAigjDzG242xhr` (0%); `FwR3PbjS5iyqzLiLugrBqKSa5EKZ4vK9SKs7eQXtT59f` (10%) |

Program: **`DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib`**. This is the devnet stake-pool program; its binary was deployed on 21 Jan 2026 and its log strings show v2.0.x code.
- **Legacy-rent quirk on devnet:** stake program v5 stamps a frozen, legacy `rent_exempt_reserve` of 2,282,880 lamports into every stake account's meta. Accounts actually need the current rent, 1,666,240, and delegations are computed with it.
- **How v2.0.x reacts:** v2.0.x reads the meta value, so on this pool:
  - the reserve minimum is 2,282,880 (the reserve was topped up by 616,640 lamports before `Initialize`, or `Initialize` fails with `CalculationFailure`);
  - a validator's minimum is 1.00228288 SOL, while `AddValidatorToPool` funds it with 1.00166624;
  - `UpdateStakePoolBalance` fails if the reserve ever drops below 2,282,880.
- **How the scripts handle it:** they use the program's own numbers (`"rentMode": "meta"` in `devnet.json`), so headroom maths stays exact and the crank keeps the reserve above that floor.
- **Mainnet is not affected:** v2.1.0 uses the Rent sysvar (`"rentMode": "rent"`).
- **Mainnet runs v2.1.0** (`SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`, byte-identical to the [v2.1.0 release asset](https://github.com/solana-program/stake-pool/releases/tag/program%40v2.1.0), trimmed sha256 `8df58bc9…`).
- **The differences that matter here:** v2.1.0 adds a +0.5 percentage-point cap on each withdrawal-fee increase, updates 4 instead of 5 validators per instruction, and reads rent from the Rent sysvar.
- **Instruction layouts are identical.**
- The `SPoo1…` program on devnet is a February 2023 pre-v1 build. It has no CreateTokenMetadata, no slippage variants and no 1 SOL-minimum logic, so it is not used.

## Commands

Requirements: Node ≥ 20. Run everything from `pool/`. Nothing here needs the Solana CLI or Rust.

```bash
npm ci                      # @solana/web3.js 1.98.4, @solana/spl-token 0.4.9, @solana/spl-stake-pool 1.1.8 (pinned)
npm test                    # offline byte-layout tests (25)
node keys.mjs               # generate devnet keypairs into keys/devnet/ (gitignored, mode 600); never overwrites
node airdrop.mjs --sol 5    # devnet faucet with retry/backoff (rate-limited per IP; https://faucet.solana.com is the fallback)
node create-pool.mjs        # create pool + fees + funding authority + metadata + seed + 2 validators; idempotent, resumable
node create-pool.mjs --dry-run
node status.mjs             # read-only snapshot (add --json)
node crank.mjs              # per-epoch update + rebalance; idempotent (add --dry-run, --no-rebalance, --force-update)
node collect-fees.mjs       # manager: fee tokens -> SOL via WithdrawSol, no fee (add --amount, --to, --print-only)
node smoke.mjs              # end-to-end parent test on devnet (add --fee-test 0.01, --rebalance-before-stake-exit)
node smoke.mjs --primary-exit-check   # phase 1: one 1.01 deposit staked into the primary; run again after
                                      # the next epoch boundary for phase 2: the 1.01 slow exit must come
                                      # from the primary's active stake (WithdrawStake + Deactivate)
node smoke.mjs --claim --parent keys/devnet/parent-<ts>.json   # claim a parent's ready stake accounts later
```

| Env variable | Used by | Meaning |
|---|---|---|
| `POOL_CLUSTER` | all | `devnet` (default) or `mainnet` |
| `POOL_RPC_URL` | all | RPC endpoint (default: public endpoint for the cluster) |
| `POOL_CONFIG` | all | config path (default `pool/<cluster>.json`) |
| `POOL_KEYS_DIR` | all | keypair folder (default `pool/keys/<cluster>`) |
| `POOL_<ROLE>_KEYPAIR` | all | a keypair as a JSON array instead of a file, e.g. `POOL_STAKER_KEYPAIR`, `POOL_PAYER_KEYPAIR`, `POOL_CRANK_PAYER_KEYPAIR` |
| `POOL_ALLOW_MAINNET=yes` | senders | required before any mainnet transaction |
| `RESERVE_BUFFER_SOL`, `RESERVE_BUFFER_PCT` | crank | reserve buffer: the larger of an absolute amount and a % of the pool |
| `POOL_DEPOSIT_SOL` | crank | deposit size the stake moves are whole multiples of (default 1.01) |
| `POOL_PRIMARY_VALIDATOR` | crank | vote account of the primary validator (default: lowest commission) |
| `POOL_PRIORITY_MICROLAMPORTS` | senders | optional priority fee |

Key roles: **payer** (pays rent and fees, seeds the pool, funds the smoke-test parent), **manager** (fees, authorities, metadata; receives fee tokens; a Squads vault on mainnet), **staker** (adds validators, moves stake; the crank's key), and one-shot keys for **pool**, **validator-list**, **reserve** and **mint** (they sign only at creation).

**GitHub Action** (`.github/workflows/pool-crank.yml`): runs `crank.mjs` at minute 17 every 6 hours, plus on manual dispatch (with a dry-run option).
- **Devnet setup:** `gh secret set POOL_STAKER_KEYPAIR < pool/keys/devnet/staker.json`. Then fund the staker with about 0.05 SOL for fees.
- **Without a key secret** the job prints a notice and does nothing.
- **Mainnet** additionally needs the variables `POOL_CLUSTER=mainnet` and `POOL_ALLOW_MAINNET=yes`, a committed `pool/mainnet.json`, and ideally a private `POOL_RPC_URL`.
- **Note:** GitHub may delay scheduled runs, and disables them after 60 days without repository activity.

## For the app (payments integration)

All of this is implemented and exercised in `smoke.mjs` and `lib/`. Mirror it in `web/payments.js`.
- **Addresses:** `programId`, `pool`, `mint`, `reserve`, `validatorList`, `managerFeeAccount` and `withdrawAuthority` come from `devnet.json`.
- **Stale pool:** if `pool.lastUpdateEpoch < currentEpoch`, deposits and withdrawals fail with `0x11`. Prepend the permissionless update instructions (`buildUpdateInstructions` in `lib/pool-ops.mjs`). With 6-hourly cranking, the pool can be stale for up to ~6 h after each ~28–32 h epoch boundary.
- **`stake()`:** create the ATA (idempotent), then `DepositSolWithSlippage` (instruction 25: `lamports`, `minimum_pool_tokens_out`). Pass a minimum so that a hostile fee change can't take the deposit. The parent is the only signer.
- **`exitInstant()`:** `WithdrawSolWithSlippage` (26) with all tokens. The parent is the user transfer authority. The fee is `ceil(tokens × 3/1000)` tokens.
- **`exitSlow()`:** one transaction:
  - `SystemProgram.createAccountWithSeed` (base = parent, seed `ocean-exit-<time>`, 200 bytes, rent-exempt lamports, owner = Stake program);
  - `WithdrawStakeWithSlippage` (24) from the source the program requires (`pickWithdrawSource`: validator with headroom, then transient, then reserve);
  - `StakeProgram.deactivate`, only when the source was delegated.

  The program makes the parent the new account's staker and withdrawer. If `pickWithdrawSource` reports `blocked`, offer the instant exit.
- **`pendingSlowExits()`:** `getProgramAccounts(Stake11111…, dataSize 200, memcmp offset 44 = parent)` (offset 44 is the withdrawer). `ready` = simulate `StakeProgram.withdraw` of the full balance (no signature needed).
- **`claimSlow()`:** `StakeProgram.withdraw` of the full balance to the parent.
- **Unlock rule:** OCEAN balance ≥ 0.99 (a 1.01 SOL deposit mints about 1.01).

## Mainnet runbook

For the owner, with his own keys and funds. **Not done by any agent.** Read [Risks](#risks) and get legal advice first (appendix E: ASIC INFO 225, AUSTRAC).

**Costs** (from this devnet build and mainnet rent as of 2 Oct 2026):

| Item | SOL |
|---|---|
| Rent for pool (611 B), validator list (301 B), reserve, mint, fee account | ≈ 0.010 |
| Token metadata account + Metaplex fee | ≈ 0.015 |
| Seed: 1 SOL + 0.00166624 rent per validator (locked in validator stake accounts; recoverable only by removing the validator) | 2.0033 for 2 |
| Transaction fees to create | < 0.001 |
| Running: 2–4 update transactions per epoch, plus rebalances | < 0.001 / month |
| Reserve buffer for instant exits (your choice; earns nothing) | e.g. 2 |

**Steps**
1. **Multisig manager.** Create a Squads multisig (https://app.squads.so) with your own devices as members, e.g. 2-of-3: phone wallet, hardware wallet, laptop. Its **vault address is the manager**. Send the vault about 0.05 SOL; it pays the metadata rent.
2. **Hot keys.** Generate everything except the manager:
   `node keys.mjs --cluster mainnet --roles payer,staker,pool,validator-list,reserve,mint`.
   - Fund the **payer** with about 2.1 SOL plus the buffer you want from your own wallet.
   - Fund the **staker** with about 0.05 SOL for crank fees.
   - Back up `keys/mainnet/` offline. The staker can move stake between validators but cannot withdraw anything.
3. **Metadata.** Fill in [`metadata/ocean-pass.json`](metadata/ocean-pass.json), upload it with the logo to Arweave or IPFS, and note the URI.
4. **Create, phase 1** (everything the manager doesn't sign):
   `POOL_ALLOW_MAINNET=yes POOL_RPC_URL=<private rpc> node create-pool.mjs --cluster mainnet --manager <VAULT> --metadata-uri <URI>`
   - This creates the reserve, the mint, the vault's OCEAN account, and the pool and validator-list accounts.
   - It prints the four manager instructions as JSON (program, accounts with signer/writable flags, data in base58 and hex): `Initialize`, `SetFee StakeWithdrawal 0/100`, `SetFundingAuthority StakeDeposit -> vault`, `CreateTokenMetadata`.
5. **Squads.**
   - Build a vault transaction from those instructions with the Squads transaction builder: `Initialize` alone first, then the other three.
   - Approve with your threshold, and execute.
   - Do it promptly: until `Initialize` runs, anyone could initialize the empty pool account with their own manager. If `node status.mjs --cluster mainnet` ever shows a manager that isn't your vault, abandon the pool and start again with new account keys.
6. **Create, phase 2.**
   - Re-run the same command with `--validators <primary>,<second> --seed-extra-sol <buffer>`. Pick 0%-commission, non-delinquent validators with good uptime (e.g. validators.app or stakewiz.com).
   - It seeds the reserve from the payer (1.00166624 SOL per validator, plus the buffer) and adds the validators (signed by the staker).
   - Set `crank.primaryValidator` in `mainnet.json` if the primary should not be chosen automatically (lowest commission).
   - Parents' deposits above the buffer are then staked into the primary in whole deposits by the crank.
   - Commit `pool/mainnet.json` (public addresses only).
7. **Crank.** In GitHub, set:
   - the secret `POOL_STAKER_KEYPAIR` (`cat pool/keys/mainnet/staker.json`) and the secret `POOL_RPC_URL`;
   - the variables `POOL_CLUSTER=mainnet`, `POOL_ALLOW_MAINNET=yes` and `RESERVE_BUFFER_SOL`.

   Run the workflow once with **dry run**, then for real.
8. **Collect fees.** Run `node collect-fees.mjs --cluster mainnet --print-only`, then execute the printed instruction in Squads. It burns the vault's fee tokens for SOL with no fee. Note that this SOL comes out of the instant-exit reserve: the crank refills it from stake one epoch later.
9. **App.** Point `web/config.js` `stake.programId/pool/mint` at the mainnet addresses.
10. **If the studio disappears,** parents can still exit without the app: anyone can run the update, and `WithdrawSol` or `WithdrawStake` need only the parent's wallet. Publish these exit steps somewhere that does not depend on the app.

## Risks

From appendix B, plus what this build found:
- **The code can change under us.** A third-party 6-of-10 Squads multisig controls upgrades to the canonical program, and there were two urgent security releases in 7 months.
- **Losses are never recovered.** With a 100% fee, any drop in pool value stays with parents. The studio can only make them whole by burning its own fee tokens.
- **Slashing is not live** (SIMD-0212 is still under discussion).
- **A stolen manager key** could block instant exits (by setting a SOL-withdraw authority) and set 100% deposit fees at once. The app passes a minimum tokens-out on every deposit. Withdrawal-fee increases are capped at 1.5× per change (plus +0.5 percentage points on v2.1.0) and wait 2 epoch boundaries, so pushing withdrawals from 0 to 100% takes ~408 epochs. The manager belongs on a multisig.
- **A leaked staker key** (it sits in GitHub secrets) can redelegate stake to a bad validator and lose the studio rewards. It cannot withdraw funds. Rotate it with `SetStaker` from the manager.
- **If the studio disappears,** parents can still update the pool and withdraw: every needed instruction is permissionless or parent-signed.
- **Parents carry SOL price risk.** SIMD-0550 (in review) would cut yield further.
- **Legal:** pooled staking may be a financial product (ASIC INFO 225), and AUSTRAC registration may be needed (appendix E). Get a lawyer before mainnet.
- **Slow exits can be blocked** (`SLOW_UNAVAILABLE`) when a validator's headroom is in the band (above 0 but below one deposit). This also happens for the rest of the epoch after the first one-deposit move into a primary that was at its minimum. The crank's whole-deposit policy avoids the band, but anything outside the crank's control can still land a validator there, and the instant exit always remains. See [How it works](#how-it-works) point 2.
- **Free reserve exits:** while all validators sit exactly at the minimum, slow exits come undelegated from the reserve, which is free and claimable at once. This is accepted; do not "fix" it with a stake-withdrawal fee. Staking whole deposits into the primary means slow exits normally come from validator stake.
- **The pool goes stale after each epoch boundary** until someone sends the update. The app should prepend the update itself.
- **Collecting fees drains the instant-exit reserve.** Reward fees accrue in stake, not in the reserve.
- `DecreaseAdditionalValidatorStake` cannot merge active deactivating stake (`MergeTransientStake`). The crank therefore makes at most one decrease per validator per epoch.
- **The devnet rehearsal ran on v2.0.x; mainnet is v2.1.0.**
  - On v2.0.x, stake v5's frozen legacy `rent_exempt_reserve` (2,282,880) makes the program's minimums 616,640 lamports higher than rent.
  - If the reserve ever falls below that floor, `UpdateStakePoolBalance` fails, and every deposit and withdrawal then fails with `0x11` until someone sends lamports to the reserve.
  - The scripts guard against this ("Devnet deployment" above).
  - Do not run a v2.0.x pool on mainnet.
- **`npm audit`** flags advisories in transitive web3.js v1 dependencies (`bigint-buffer`, `stream-json`). These scripts parse only responses from the configured RPC. Use a trusted RPC.

## How the hand-encoded instructions were validated

The JS SDK has no `Initialize`, `SetFee`, `SetFundingAuthority` or slippage variants, and hardcodes the mainnet program ID. Its `ValidatorList` layout is also stale (it predates `validator_seed_suffix`). So `lib/ix.mjs` and `lib/state.mjs` encode and decode everything themselves, from `program@v2.1.0` `instruction.rs` and `state.rs`. They were checked four ways:
1. **Hand-written byte vectors** (`npm test`) for `Initialize`, `SetFee`, `SetFundingAuthority`, `CreateTokenMetadata` and the slippage variants. Note that `Fee` is `{denominator, numerator}`, denominator first. Two injected defects (swapped fee fields, a wrong instruction index) were confirmed to fail the suite.
2. **Byte-for-byte comparison with the SDK** (data and account metas) for every instruction the SDK also has.
3. **Simulation against the deployed devnet program** (nothing signed or sent): update, SetFee, SetFundingAuthority, DepositSolWithSlippage, WithdrawSolWithSlippage, WithdrawStake + Deactivate, Increase(+Additional), AddValidatorToPool and CreateTokenMetadata all succeeded. Negative cases failed with the expected errors (FeeIncreaseTooHigh, ExceededSlippage, InsufficientDelegation, WrongManager).
4. **Real devnet transactions** (2 Oct 2026):
   - **Creation:** create, Initialize, SetFee, SetFundingAuthority, CreateTokenMetadata, seed, and AddValidatorToPool ×2.
   - **Parent flow:** DepositSolWithSlippage ×3, WithdrawSolWithSlippage (exactly the 0.3% fee), the whole-deposit IncreaseValidatorStake (2.02 SOL), WithdrawStakeWithSlippage + Deactivate in one parent-signed transaction, and the claim.
   - **Fees and liquidity:** the fee test (0.01 SOL of "rewards" minted exactly 0.01 OCEAN to the manager), IncreaseAdditionalValidatorStake (a dust repair to whole deposits), and WithdrawSol from the manager fee account.

   SOL per token stayed at 1.000000000 throughout. The decoded on-chain state matches the intended settings (`status.mjs`).
