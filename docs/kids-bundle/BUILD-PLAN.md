# Build plan: stake-to-play and pay-once for Isabella (CLOCK IN hackathon, due 8 Oct 2026)

The coordinator (main chat) owns this file and merges every branch. Each agent works in its own git worktree, edits ONLY the files it owns, commits on its branch, and never pushes.

## What we are building
- **Free:** World 1 (levels 1–10) of Isabella.
- **Unlock World 2 (levels 11–20) either way:**
  1. **Stake 1 SOL:** the parent deposits ~1.01 SOL into OUR SPL stake pool. Its fee on rewards is 100%, so the studio receives all staking rewards and never holds the SOL. The parent keeps ~1 pool token in their wallet. The game stays unlocked while the wallet holds ≥0.99 pool tokens.
     - **Exit instantly:** WithdrawSol from the reserve, with a 0.3% fee.
     - **Exit free, ~2 days:** WithdrawStake to the parent's own stake account, deactivate, then claim.
     - The game locks again the moment the tokens leave.
  2. **Pay US$15 once:** in any Jupiter-verified token, swapped so that exactly 15 USDC lands in the studio's USDC account (Jupiter ExactOut with a destination token account). If no ExactOut route exists, use an ExactIn swap plus an exact USDC transfer, all in one transaction.
     - **Devnet:** a direct SOL or devnet-USDC transfer stands in for Jupiter.
- **Two Android build flavors:**
  - `family`: her current app (`app.isabella.mermaid`); everything unlocked, no wallet.
  - `store`: the paywall and wallet build (`app.isabella.mermaid.seeker`).
- **Devnet for the hackathon demo.** Mainnet comes later, and the user creates the mainnet pool with his own keys.
- **Two extra ocean games** as standalone pages under `web/games/<id>/`. The coordinator wires them into a hub afterwards.

## Hard rules for every agent
1. **NEVER touch the Seeker phone** (the owner's personal device). Only the bridge agent uses a device, and only emulator `fz36`:
   - always pass `-s emulator-5554`;
   - check `getprop ro.boot.qemu` == 1 before every install.
2. **No mainnet transactions, accounts or funds.** Mainnet RPC is allowed only for read-only calls (quotes, account reads).
3. **No secrets in git.** Devnet keypairs live in gitignored folders (`pool/keys/`, `tools/keys/`). `node_modules/` is gitignored.
4. **Edit only the files you own** (table below). If you need a change elsewhere, describe it in your report; don't make it.
5. **Do not edit** `web/core.js`, `web/render.js` or `web/audio.js` (the level fingerprints in `test/verify.js` must stay green).
6. **Headless Chrome:** use your own `--remote-debugging-port` and your own `--user-data-dir` under the scratchpad.
   - Ports: paywall 9450, game-pop 9451, game-match 9452, payments 9453, bridge (WebView) 9460.
7. **Finish:** commit on your worktree branch (message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Report the branch, commit hash, what you verified (with evidence), and what is unfinished.

## Who owns what
| Agent | Owns (may create/edit) |
|---|---|
| pool | `pool/**`, `.github/workflows/pool-crank.yml` |
| bridge | `android/**` (incl. flavor assets `android/app/src/{family,store}/assets/flavor.js`, debug-only test page `android/app/src/debug/assets/wallet-test.html`) |
| payments | `web/config.js`, `web/wallet.js`, `web/payments.js`, `web/entitlement.js`, `web/vendor/**`, `tools/**`, `test/payments/**` |
| paywall | `web/index.html`, `web/app.js`, `web/paywall.js`, `web/flavor.js`, `web/paymock.js`, `test/paywall/**` |
| game-pop | `web/games/pop/**`, `test/games/pop/**` |
| game-match | `web/games/match/**`, `test/games/match/**` |

## Contract 1: Android bridge → `window.IsabellaWallet` (Java `@JavascriptInterface`)
- **Async results:** async calls return immediately. Java later calls `window.__walletResult(id, json)` on the UI thread via `evaluateJavascript`.
- **Chains:** `"solana:devnet"` | `"solana:mainnet"`.
- **Library:** Mobile Wallet Adapter, `com.solanamobile:mobile-wallet-adapter-clientlib:2.2.0` (pure Java), run off the UI thread.

| Method | Kind | Behaviour |
|---|---|---|
| `available()` | sync | `"true"` if an MWA wallet is installed |
| `connect(id, chain)` | async | MWA authorize. Identity name `Isabella the Mermaid`, uri `https://isabella.app` (placeholder), icon `favicon.ico`. Result: `{ok:true, publicKey:"<base58>", walletLabel}` or `{ok:false, error, cancelled}`. Persists auth token + public key per chain. |
| `signAndSend(id, chain, txsJson)` | async | `txsJson` = JSON array of base64 *unsigned* serialized transactions (legacy or v0); fee payer = the connected wallet. Re-authorizes with the saved token. Result: `{ok:true, signatures:["<base58>",…]}` or `{ok:false, error, cancelled}`. |
| `disconnect(chain)` | sync | Forget the token and key |
| `savedPublicKey(chain)` | sync | base58 or `""` |

## Contract 2: JS API (payments implements it; paywall consumes it; `web/paymock.js` mocks it)
```js
window.IsabellaConfig      // web/config.js — see Contract 3
window.Wallet = { available(), connect(), signAndSend(txs) /* -> signatures */, publicKey /* base58|null */, disconnect() }
window.IsabellaPay = {
  stake(),              // DepositSol(config.stake.depositSol) into config.stake.pool → {signature}
  exitInstant(),        // WithdrawSol of ALL the wallet's pool tokens (0.3% fee) → {signature, solOut}
  exitSlow(),           // WithdrawStake ALL tokens to a new stake account owned by the parent + deactivate → {signature, stakeAccount, readyAt}
  pendingSlowExits(),   // → [{stakeAccount, lamports, ready:bool, readyAt}]
  claimSlow(),          // withdraw SOL from the parent's ready (inactive) stake accounts → {signature}
  payableTokens(),      // → [{mint, symbol, logo, amountNeeded}] (devnet: SOL and devnet-USDC)
  buy(mint),            // one-off payment of config.priceUsd → {signature}
}
window.IsabellaEntitlement = {
  status(),     // sync from cache → {unlocked, via:'stake'|'purchase'|'family'|null, wallet, checkedAt, offlineUntil}
  refresh(),    // on-chain check, updates cache, resolves status()
  onChange(fn), startWatching() /* every config.recheckMinutes while visible + on resume */, revokeLocal(),
}
```
**Entitlement rules:**
- **Family flavor:** always unlocked.
- **Unlocked** means the last *successful* check found (pool tokens ≥ `config.stake.unlockThreshold`) OR a valid purchase, and `now < checkedAt + offlineGraceHours`.
- **Failed refresh (offline):** keep the last result until the grace window expires, then lock until a successful check.
- **Exit flows** call `revokeLocal()` immediately.
- **Finding a purchase:** each purchase transaction includes a read-only "reference" public key derived deterministically from the parent's wallet (sha256("isabella-purchase-v1" + wallet) → 32 bytes → public key). `refresh()` finds purchases with `getSignaturesForAddress(reference)` and verifies a finalized transfer of ≥ price to the merchant account. This works after a reinstall, with no database.

## Contract 3: `web/config.js` (devnet defaults; the payments agent fills real devnet addresses after integration)
```js
window.IsabellaConfig = {
  flavor: window.IsabellaFlavor || 'store',      // web/flavor.js sets 'store'; Android family flavor overrides with 'family'
  cluster: 'devnet', chain: 'solana:devnet', rpcUrl: 'https://api.devnet.solana.com',
  freeLevels: 10, priceUsd: 15,
  stake: { programId: '', pool: '', mint: '', depositSol: 1.01, unlockThreshold: 0.99, instantFeePct: 0.3 },
  merchant: { wallet: '', usdcMint: '', usdcAta: '' },
  jupiter: { apiBase: 'https://api.jup.ag', apiKey: '' },
  offlineGraceHours: 24, recheckMinutes: 5,
};
```
**Script order in `web/index.html`:** flavor.js, config.js, vendor/solana.js, wallet.js, entitlement.js, payments.js, core.js, render.js, audio.js, paywall.js, app.js.

## Pool settings (fixed at creation; fees can only rise slowly afterwards)
| Setting | Value |
|---|---|
| Fee on rewards (epoch fee) | 100% |
| SOL withdrawal fee | 0.3% |
| Stake withdrawal fee | 0 |
| Deposit fees | 0 |
| Stake-deposit authority | the manager (blocks the fee-dodging "leech" trick) |
| Max validators | 4 (start with 1–2 active zero-commission devnet validators) |
| Token metadata | name `Isabella Ocean Pass`, symbol `OCEAN` (devnet placeholder) |
| Crank | keep a reserve buffer for instant exits; stake the excess in ≥1 SOL chunks |
| Mainnet | manager key on a Squads multisig (runbook only) |

## Kid UX rules (paywall and games)
- **Kids never see wallet prompts.** Every purchase, wallet or link action sits behind a parent gate: hold 3 seconds, then answer a 2-digit multiplication on a number pad.
- **No reading for kids.** Parent screens may use text.
- **Comfortable targets:** touch targets at least ~19vh (about 2 cm on the Seeker).
- **No dark patterns:** no timers, nagging or ads.
- **Tell parents plainly:** they give up the staking rewards (~5% a year), their SOL's value still moves with SOL's price, and withdrawing locks World 2 again.
