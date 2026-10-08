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
| Manager fee account | An OCEAN token account. The 100% reward fee and the 0.3% instant-exit fee are paid into it. By default the manager owns it; `--fee-owner` gives it to another wallet (see [who signs what](#who-signs-what)) |

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
npm test                    # offline tests: byte layouts (25), crank policy (27), phone plans (20)
node keys.mjs               # generate devnet keypairs into keys/devnet/ (gitignored, mode 600); never overwrites
node airdrop.mjs --sol 5    # devnet faucet with retry/backoff (rate-limited per IP; https://faucet.solana.com is the fallback)
node create-pool.mjs        # create pool + fees + funding authority + metadata + seed + 2 validators; idempotent, resumable
node create-pool.mjs --dry-run
node status.mjs             # read-only snapshot (add --json)
node crank.mjs              # per-epoch update + rebalance; idempotent (add --dry-run, --no-rebalance, --force-update)
node collect-fees.mjs       # fee owner: fee tokens -> SOL via WithdrawSol, no fee (add --amount, --to, --print-only, --plan-out)
node phone-plan.mjs show plans/x.json                    # what a plan file does, in plain words
node phone-plan.mjs push plans/x.json --serial <serial>  # open it on a phone's debug build for signing
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

Key roles: **payer** (pays rent and fees, seeds the pool, funds the smoke-test parent), **manager** (fees, authorities, metadata; a Squads vault or a phone wallet account on mainnet), **fee owner** (the wallet that owns the manager fee account and so collects the fees; the manager unless `--fee-owner` names another), **staker** (adds validators, moves stake; the crank's key), and one-shot keys for **pool**, **validator-list**, **reserve** and **mint** (they sign only at creation).

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
8. **Collect fees.** Run `node collect-fees.mjs --cluster mainnet --print-only`, then execute the printed instruction in Squads. It burns the vault's fee tokens for SOL with no fee. Note that this SOL comes out of the instant-exit reserve: the crank refills it from stake one epoch later. (Squads can only do this when the vault owns the fee account, which is the default.)
9. **App.** Point `web/config.js` `stake.programId/pool/mint` at the mainnet addresses.
10. **If the studio disappears,** parents can still exit without the app: anyone can run the update, and `WithdrawSol` or `WithdrawStake` need only the parent's wallet. Publish these exit steps somewhere that does not depend on the app.

### Phone manager

The variant the owner chose on 5 Oct 2026: the **manager is an ordinary account in the wallet on his phone** (the Seed Vault Wallet, signing over Mobile Wallet Adapter), and the **manager fee account belongs to a second account, the revenue wallet**. No Squads. It replaces steps 1, 4, 5 and 8 above; steps 2, 3, 6, 7, 9 and 10 are the same.

#### Who signs what

Checked against the program source (`program@v2.1.0`, `processor.rs` and `state.rs`) and then on devnet:

| Action | Must sign | Why |
|---|---|---|
| `Initialize` | the **manager**, nobody else | `process_initialize` returns `SignatureMissing` unless the manager signed (L667-L670). The fee account is only checked by `check_manager_fee_info` (called at L799; `state.rs` L295-L316): owned by the token program, initialized, its mint is the pool mint, no unsupported extensions. **Who owns the token account is not checked, and that wallet does not sign.** |
| `SetFee`, `SetFundingAuthority`, `CreateTokenMetadata` | the **manager** | `check_manager`. `CreateTokenMetadata` also needs a payer signature for about 0.016 SOL of rent; the plan makes the manager the payer. |
| Collecting fees (`WithdrawSol` from the fee account) | the **fee owner** (the revenue wallet), nobody else | `process_withdraw_sol` (from L3149) never looks at the manager. It burns the tokens with a token-program `Burn` whose authority is the "user transfer authority" account (L3246-L3252), and the token program accepts only the token account's owner or a delegate. No fee is charged because the tokens come from the fee account itself (L3205-L3209). |
| Changing the manager or the fee account later (`SetManager`) | the **old and the new manager** | `process_set_manager` (L3447-L3473). The new fee account's owner does not sign. |

What follows for the two-wallet plan:
- **The revenue wallet collects by itself.** The manager account is not needed and cannot do it: on devnet the same instruction signed by the manager fails in the token program with `owner does not match` (0x4).
- **The collected SOL goes to the revenue wallet** unless `--to` names another address.
- **The manager can still redirect future fees** by sending `SetManager` with a different fee account. Fee tokens already in the revenue wallet's account stay there.
- **If the pool ever gets a SOL withdraw authority** (`SetFundingAuthority SolWithdraw`), that authority must sign every `WithdrawSol` as well, including fee collections. This pool leaves it unset.
- **The revenue wallet could also just keep the OCEAN.** It is an ordinary token account; fee tokens keep their SOL value in the pool until they are collected.

#### The signing page

`pool-manager.html` is a page inside the store app's **debug** build (`android/app/src/debug/assets/`, next to `wallet-test.html`). It uses the app's own wallet bridge (`window.IsabellaWallet`, `web/wallet.js`), the code the game's payments already run on. Release builds do not pack it (check with `unzip -l <apk> | grep pool-`), and they ignore the intent extras that open it.

- **Getting the plan onto the phone:** `node phone-plan.mjs push <plan> --serial <adb serial>` starts the debug build, or on mainnet the **owner build** (`scripts/sign-release.sh --owner`, docs/ANDROID.md: release-signed, presents the product domain, which the wallet approves where it refuses the debug build's pages.dev identity), on that one device with the plan's bytes in an intent extra. Nothing is typed or pasted, and nothing is written to the phone. `--serial` is required. The page also has a paste box as a fallback.
- **Fingerprint:** the Mac prints a 16-character fingerprint of the plan file (the first 8 bytes of its SHA-256) and the page shows the fingerprint of what it received. **Compare them.** Any app on the phone can open this page with a plan of its own, so the fingerprint is what proves the plan on screen is yours.
- **Cluster:** read from the plan file and shown as the big label, DEVNET (green) or MAINNET (red). There is no default. The page checks the RPC's genesis hash before it connects, and asks the wallet for that chain.
- **Mainnet opt-in:** `create-pool.mjs`, `collect-fees.mjs` and `phone-plan.mjs push` all refuse mainnet without `POOL_ALLOW_MAINNET=yes`; the plan records it, the page refuses a mainnet plan without it, and the page then also wants the word MAINNET typed.
- **What it shows before the wallet can open:** every instruction, with its program, its name, its decoded values (fees as fractions and percentages, token names, amounts) and every account with its role and SIGNER / WRITABLE marks. An instruction the page cannot decode byte for byte blocks the whole plan (`pool/test/plan.test.mjs`).
- **One account signs.** The connected account must be the one the plan names; any other account is refused. It also pays the network fee.
- **Each transaction is simulated first**, and the wallet opens only after the simulation passes and the person presses "Sign in the wallet".
- **`Initialize` goes alone and first.** After it confirms, the page reads the pool account and continues only if the manager is the connected account and the fee account and staker are the plan's. Before any other manager instruction it reads the manager again. If someone else got there first it stops and says to abandon the pool.
- **Afterwards press Disconnect.** The page shares the app's saved wallet authorization with the game.

#### Steps (devnet dry run; mainnet differences in the last column)

| # | Do this | On mainnet |
|---|---|---|
| 1 | In the Seed Vault Wallet, have two accounts: **manager** and **revenue**. Note both addresses. For devnet put the wallet on Devnet (Settings → tap the version number about 7 times → Developer mode → Devnet) and send the manager about 0.03 devnet SOL (`tools/keys/devbank/send.js`). | Leave the wallet on mainnet. The manager needs about 0.03 SOL. The revenue wallet needs a little SOL for fees when it collects. |
| 2 | The phone has the store app's **debug** build with this page (`adb install -r android/app/build/outputs/apk/store/debug/app-store-debug.apk`; it updates in place and keeps saves, see `docs/ANDROID.md`). | The same debug build; it is the only build with the page. A release-signed build of the same package cannot be replaced by it, so use a phone that still has the debug-signed app. |
| 3 | New keys and a new config for this pool, so the live devnet pool is untouched: `export POOL_KEYS_DIR=keys/devnet-dry-run POOL_CONFIG=devnet-dry-run.json`, then `node keys.mjs --roles payer,staker,pool,validator-list,reserve,mint`. Fund the payer (about 0.1 SOL with no validators, 2.1 SOL with two). | Runbook step 2: `node keys.mjs --cluster mainnet --roles payer,staker,pool,validator-list,reserve,mint`. |
| 4 | **Phase 1:** `node create-pool.mjs --manager <MANAGER> --fee-owner <REVENUE> --plan-out plans/create.json`. It creates the accounts and the revenue wallet's OCEAN account, writes the plan and prints its fingerprint. | Add `POOL_ALLOW_MAINNET=yes POOL_RPC_URL=<private rpc>` in front and `--cluster mainnet --metadata-uri <URI>`. The plan file then holds the RPC address: keep it private (`pool/plans/` is gitignored). |
| 5 | **At once:** `node phone-plan.mjs push plans/create.json --serial <serial>`. On the phone: check DEVNET and the fingerprint, read the summary, Connect and choose the **manager** account, then for transaction 1 press "Check the chain and simulate" and "Sign in the wallet". Wait for "Checked on chain: the pool is initialized, its manager is the connected account". Do the same for transaction 2. | `POOL_ALLOW_MAINNET=yes` in front. The label is MAINNET in red and the page wants MAINNET typed. Until `Initialize` lands anyone could initialize the empty pool account with their own manager, so do not leave a gap after step 4. If the page says STOP, abandon the pool and start again from step 3. |
| 6 | Press Disconnect. On the Mac, `node status.mjs` must show your manager, fees 100% and 0.3%, "stake deposits: manager only", the metadata, and your fee account. | The same, with `--cluster mainnet`. |
| 7 | **Phase 2:** the phase 1 command again, plus `--validators <a>,<b> --seed-extra-sol <buffer>` (or `--validator-count 0` to skip validators in a dry run). | Runbook step 6. |
| 8 | **Collect fees**, when there are some: `node collect-fees.mjs --plan-out plans/collect.json`, then `node phone-plan.mjs push plans/collect.json --serial <serial>`. On the phone, Connect and choose the **revenue** account, simulate, sign. If the manager account is still connected the page refuses it: press Disconnect and connect again. | `POOL_ALLOW_MAINNET=yes` and `--cluster mainnet` on both commands. The pool must be up to date for the epoch first; the script sends the permissionless update itself when it has a payer key, otherwise run `node crank.mjs --no-rebalance`. |

If a step fails half way (a wallet that goes quiet, a transaction that expires), run the script from step 4 or 8 again. It reads the chain, leaves out what is already done, and writes a fresh plan.

#### Devnet rehearsal (5 Oct 2026, emulator + Solana Mobile's test wallet)

A separate pool, [`devnet-phone-rehearsal.json`](devnet-phone-rehearsal.json): `AdqDPgeuvk3Zu4o7QwxLtsWjSJiMAryji5pfgeYD9Qck`. Manager `Fe4U9C…ViiG` and fee owner `5WqtFq…311t` were two builds of the test wallet, each with its own key. It has no validators (they are not needed to rehearse the manager steps) and 0.05 SOL in the reserve.

| What | Signed by | Transaction |
|---|---|---|
| `Initialize` (through the page) | manager, in the wallet | `3eeaBh7zDuJBLNb1zw9mGG9hXBSAsnihXqdUfgAqogu2sm118HNLrGqEvKZJBrJcGGt6buXjuYZiFVsxUgiYNM1T` |
| `SetFee` + `SetFundingAuthority` + `CreateTokenMetadata` (through the page) | manager, in the wallet | `3wb1BnBiXF4WNuxwJD6Du9vQ42gZhsxbyCDYv2JJpGYGBgqCxW6NvtuAPbrUSVi7tQpRWCsc6LyHft8e9hYJ2Vir` |
| 0.01 SOL of stand-in rewards into the reserve, then the update: 0.01 OCEAN minted to the fee account | payer key (Mac) | `4EZMZiVV…BGmMU`, `zdd39QdU…D2m6Pd` |
| Fee collection, 0.01 OCEAN → 0.01 SOL (through the page) | fee owner, in the wallet | `3sn32P1Nk8ZVypjVa4Uivf2JQrgfy31bhkDqfo9XuLcgsEXQayhaPfAjowiZCJXYTHz9kyBy1nHcysjr4tXff9jQ` |

#### Dry run on the owner's real Seeker (5 Oct 2026, Seed Vault Wallet, devnet)

A second separate pool, [`devnet-dry-run.json`](devnet-dry-run.json): `7SydaT6g1p16JXfuHAZwoYyf4f3thB6r75A5zSxFk4tA`, manager `AKzq…MS21` and fee owner `4Jb1…PMHq`, the two Seed Vault accounts chosen for mainnet. No validators, 0.05 SOL in the reserve.

| What | Signed by (read back from the chain) | Transaction |
|---|---|---|
| `Initialize` | the manager account alone | `4gu6vP77t9zNuuFdUkGRAGGsan182UMYhg3DjUiDJjrFPtMjcSLWGxXT9JkcwdQWiPFgBEPfgg9iugBcGQxqdPWQ` |
| `SetFee` + `SetFundingAuthority` + `CreateTokenMetadata` | the manager account alone | `129RiCtsNZLKjFpRbx4Vo7wQt5AEwDWQbvkqBWTjK4PgJRyFWmwCnKoi3mfdfU5rvjA16AiwJMJL8tMDpuHLSAmy` |
| Fee collection, 0.01 OCEAN → 0.01 SOL | the fee owner alone | `rWD25ngMPv9cPXpVeCwhvS7vnuThFit6hcrdCbmciFXHT25ZCgRCvF4A4n33QfKGqSeeTxYqWwzkNuZNwwCSALS` |

Learned on the phone:
- **"Scam site detected. We blocked the transaction" means the wallet is on the wrong network.** With the Seed Vault Wallet on mainnet, a devnet transaction from our (already authorised) identity got that hard block, with only a Close button, even for a memo. With the wallet on Devnet the same build and identity signed normally. A never-seen identity got the clearer "Network mismatch" instead. Check the wallet's network first.
- **Switching between the two accounts works:** Disconnect on the page, change the active account in the wallet, Connect again.
- **The crank key (staker) pays for the update,** so it needs a little SOL before `crank.mjs` or `collect-fees.mjs` can bring the pool up to date.
- `status.mjs` used to crash on a pool that was initialized but not yet seeded; fixed the same day.

Not rehearsed: anything on mainnet, including the page's MAINNET gate with a real wallet.

## Risks

From appendix B, plus what this build found:
- **The code can change under us.** A third-party 6-of-10 Squads multisig controls upgrades to the canonical program, and there were two urgent security releases in 7 months.
- **Losses are never recovered.** With a 100% fee, any drop in pool value stays with parents. The studio can only make them whole by burning its own fee tokens.
- **Slashing is not live** (SIMD-0212 is still under discussion).
- **A stolen manager key** could block instant exits (by setting a SOL-withdraw authority) and set 100% deposit fees at once. The app passes a minimum tokens-out on every deposit. Withdrawal-fee increases are capped at 1.5× per change (plus +0.5 percentage points on v2.1.0) and wait 2 epoch boundaries, so pushing withdrawals from 0 to 100% takes ~408 epochs. A multisig manager spreads this risk; the phone manager ([above](#phone-manager)) rests it on one seed phrase and one device.
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
