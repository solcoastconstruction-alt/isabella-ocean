# The stake pool

Our own pool on Solana's standard **SPL Stake Pool** program. Parents deposit SOL and get OCEAN pool
tokens. The pool stakes the SOL with validators. Its **epoch fee is 100% of rewards**, so the studio
(the pool manager) earns the yield while parents keep their principal. The deep reference is
`pool/README.md`: how it works, every command, the mainnet runbook, risks, and how the hand-encoded
instructions were validated.

## Settings
| Setting | Value |
|---|---|
| Epoch fee (on rewards) | 100% |
| SOL withdrawal fee (instant exit) | 0.3% |
| Stake withdrawal fee (free exit) | 0 |
| Deposit fees | 0 |
| Stake deposit authority | the manager. This blocks the "leech" trick of depositing stake accounts to skim rewards. SOL deposits stay open to everyone. |
| Token | "Isabella Ocean Pass" (OCEAN) |

Fee changes take effect only after 2 epoch boundaries; the program enforces this.

## Devnet deployment (live since 2 Oct 2026)
| Item | Address |
|---|---|
| Program | `DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib` (SPL stake pool v2.0.x on devnet; `SPoo1…` on devnet is an old 2023 build) |
| Pool | `D5k3bxRYCWizSToy7C3WzQoPBXYNAUZ78Lo2vvFR9q7a` |
| Mint (OCEAN) | `Fm2VtHvAdzAFz7XbD9gNWbrnnqhEqkCEoZVyVyxFS7TT` |
| Reserve | `6VJJwviBbfa9WNNNSmK8aR1UpGNuhwZSgwtPUuqTm4Ud` |
| Validator list | `ANX2oxjGduXwgDE5SmVM2o9NWDfTbHDMeE8mBuXwNEaM` |
| Manager | `Ga9LMAoVmGdTNHk8SXy2ZHEReEfcEHdagm8hV177UZs7` |
| Staker | `4SVrSXhrS3CFYTetjMCZeqMt7TdKyc9fqn84pBHRpRx5` |

All public addresses are in `pool/devnet.json`; the keys are in gitignored `pool/keys/devnet/`.

- **Devnet quirks:**
  - legacy rent is handled with `rentMode: "meta"`;
  - devnet epochs are ~32 hours (250 ms slots).
- **Token metadata URI:** currently `https://isabella.app/ocean-pass.json`, a domain we don't own. Point it at our site before mainnet (TODO.md).

## Crank rules (`pool/crank.mjs`)
- After each epoch boundary the pool needs the permissionless update. The app also prepends it to any parent transaction.
- New deposits are staked as whole-deposit increases into one primary validator.
- No validator is ever left between its minimum stake and minimum + 1.01 SOL, so a parent's free exit always has stake to come from.
- A reserve buffer is kept liquid for instant exits (1.05 SOL on devnet).
- **GitHub Actions** (`.github/workflows/pool-crank.yml`) runs the crank every 6 hours.
  - **No repo secrets are set, so today the job does nothing.** It exits with "nothing to run" until a key is set. The app's own transactions still prepend the update, so devnet keeps working.
  - It needs `POOL_STAKER_KEYPAIR` (or `POOL_CRANK_PAYER_KEYPAIR` for update only) before it does anything.
  - Mainnet also needs `POOL_CLUSTER=mainnet`, `POOL_ALLOW_MAINNET=yes`, a private `POOL_RPC_URL`, and `pool/mainnet.json`.

## Commands (from `pool/`)
| Command | Does |
|---|---|
| `node status.mjs` | Pool state, the fee and reserve, the validators |
| `node crank.mjs` | Update, then stake new deposits per the rules above |
| `node collect-fees.mjs` | Collect the manager's fee tokens |
| `node smoke.mjs` | End to end with a throwaway parent: deposit, instant exit, deposit, free exit |
| `node smoke.mjs --fee-test 0.01` | Proves the 100% fee mints to the manager |
| `node smoke.mjs --primary-exit-check` | Two phases across an epoch: a free exit must come from the primary validator's active stake |
| `node smoke.mjs --claim --parent keys/devnet/<parent>.json` | Claims ready stake accounts |

## Evidence so far
- **2 Oct:** created the pool. Deposit 1.01 SOL → 1.010000000 OCEAN, with SOL per token at 1.000000000.
  - The instant exit charged 0.3%; the free exit and the 100%-fee reserve test landed; fees were collected.
- **3 Oct, primary-exit check phase 2: passed.** The free exit came from active stake (1.0086 SOL, `source: active`).
  - The exit stake account `GHeb75yraqDXnXMw1UpSAZBpdECjDc9ia9SNksmHxrut` can be withdrawn from epoch 1174 (~4 Oct 00:30 UTC). Claim it then (TODO.md).

## Mainnet
The owner creates the mainnet pool with **his own keys**, by the runbook in `pool/README.md` (about 2 SOL
seed, under 0.001 SOL a month to run, a crank job every epoch). No mainnet transactions are made
without him. Afterwards, update `web/config.js` (PAYMENTS.md) and set the crank secrets above.
