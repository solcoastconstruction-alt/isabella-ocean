# Payments: stake-to-play and pay once

The store app (Isabella Ocean) unlocks Isabella's World 2 (levels 11–20) in one of two ways, both
behind the parent gate:

1. **Stake 1 SOL, get it back any time.**
   - The parent deposits 1.01 SOL into our stake pool (POOL.md), and their wallet receives about 1.01 OCEAN pool tokens.
   - While the wallet holds at least 0.99 OCEAN, World 2 is open.
   - The pool keeps 100% of the staking rewards; that is the price.
   - Exit instantly (0.3% fee), or for free in about 2 days, then claim. Either way World 2 locks again.
2. **Pay US$4.99 once,** in any Jupiter-verified token (the price was US$15 until 4 Oct 2026).
   - On mainnet, Jupiter swaps it so exactly 4.99 USDC reaches our account.
   - On devnet, the demo sends 0.1 SOL to the merchant wallet instead, or 4.99 devnet USDC.
   - A purchase never expires, and it can be restored after a reinstall.

We never hold a parent's SOL; the pool program does, and only OCEAN holders can withdraw it.

## What the parent sees
- **Unlock screen** (`pwPay`): Stake 1 SOL or Pay US$4.99 once, with the plain-English terms beside each.
  - Tokens without enough balance are greyed out.
  - Every cost is shown before the wallet opens.
- **Grown-ups screen** (`pwManage`):
  - the status (Staked ✓ or Purchased ✓) and the connected wallet;
  - "Get my SOL back now (−0.3%)" and "Get my SOL back free (~2 days)", plus Claim when ready;
  - Restore purchase and Disconnect wallet;
  - Privacy and Terms links, which open the website in a browser.

## Files
| File | Job |
|---|---|
| `web/paywall.js` | All parent-facing screens: the gate, unlock, grown-ups, confirms, the celebration. Errors are classified by an exact `.code`. |
| `web/entitlement.js` | Decides whether World 2 is open, and caches the answer (see the rules below). |
| `web/payments.js` | Builds, simulates and sends transactions: stake, exitInstant, exitSlow, claim, buy, payableTokens. |
| `web/wallet.js` | The JS side of the wallet bridge: `Wallet.connect()`, `Wallet.publicKey`, `signAndSend`. `?devwallet=1` signs with a local devnet key, for browsers. |
| `web/config.js` | Cluster, RPC, pool and mint addresses, merchant wallet and USDC account, price, thresholds. Devnet. |
| `android/app/src/storeRelease/assets/config.js` | The same file for mainnet. It replaces `web/config.js` in the store release build only (see "Devnet to mainnet"). |
| `web/vendor/solana.js` | A bundled `@solana/web3.js` and SPL token, built by `tools/bundle.mjs`. |
| `web/paymock.js` | A mock wallet and payments, for browser tests of the paywall. |
| `android/app/src/store/java/.../WalletBridge.java` | Mobile Wallet Adapter (MWA) on Android, exposed to the page as `window.IsabellaWallet`. |
| `android/app/src/store/java/.../WalletKeepAlive.java` | A short foreground service that runs while a wallet request is open. |

## Entitlement rules
- **Stake unlock:** the wallet holds at least `unlockThreshold` (0.99) OCEAN.
  - The app re-checks on chain every few minutes and on resume.
  - If it can't check for 24 hours (offline), World 2 locks until it can. Uninstalling or moving tokens can't keep it open.
- **Purchase unlock:**
  - Each purchase transaction carries a reference key, `sha256("isabella-purchase-v1" + wallet)`.
  - The app finds it again with `getSignaturesForAddress`, so Restore works after a reinstall.
  - Purchases never lapse offline.
  - **What counts as a purchase:** a finalized, successful transaction that carries the reference key and raises the merchant's USDC account by at least the price, or, on devnet only, the merchant wallet by at least `devnetPriceSol` (0.1 SOL).
  - **Earlier purchases still count.** The test is "at least today's price", so a 15 USDC purchase made before the price fell to US$4.99 is still a purchase, and so is every 0.1 SOL devnet purchase. Raising the price later would stop smaller old purchases from counting.
- **Family flavor:** always unlocked, and it never touches the network.

## Transactions
- **Every transaction is simulated before the wallet is asked to sign,** so most failures show before any approval.
- **Pool update:** after an epoch boundary the pool needs its permissionless update, and the app prepends it automatically.
- **Error codes** shown to parents: `cancelled`, `no-wallet`, `funds`, `offline`, `failed`, each with a plain message.
- **Network retries:**
  - `NETWORK_RE` retries transient errors three times, including "408 Request Time-out" from the public RPC (fixed 3 Oct).
  - Program errors fail at once.
- **The price in base units:** `priceUsd` (4.99) is turned into USDC base units by `IsabellaEntitlement.priceUnits(6)`, which reads the decimal digits and never multiplies a float: exactly 4,990,000. The ExactOut quote, the fallback transfer, the devnet USDC transfer and the purchase check all use that one function.
- **Jupiter (mainnet):**
  - Metis Swap v1 ExactOut, with `destinationTokenAccount` set to our USDC account.
  - Without an API key the limit is 0.5 requests per second.
  - ExactOut routes only exist on some AMMs; otherwise it falls back to ExactIn plus an exact USDC transfer in one transaction.

## The wallet bridge (Android)
- **Library:** MWA Java client 2.2.0.
- **App identity:** "Isabella Ocean", `https://isabellaocean-app.pages.dev`, icon `icon.png`.
  - Wallets verify the identity against the site's `/.well-known/assetlinks.json`, matched by package name and signing certificate (SITE.md).
- **Chain:** the bridge sends `chain: "solana:devnet"` on every authorize and reauthorize. The Seed Vault Wallet otherwise defaults to mainnet.
- **Stored auth:** auth tokens and the public key live in SharedPreferences `isabella-wallet`, under `<chain>.authToken`, `<chain>.publicKey` and `<chain>.walletLabel`.
- **Async results:** the bridge answers through `window.__walletResult(id, json)`. One request runs at a time; a second gets "busy".
- **Why `WalletKeepAlive` exists:**
  - Android freezes a backgrounded app about 70 s after the wallet opens, and the wallet's answer is then lost.
  - The service (`shortService`, up to 3 minutes) keeps the app awake only while a request is open.
  - A 94 s approval was verified on the emulator.

## Verified on real hardware
- **3 Oct 2026, the owner's Seeker:** the Seed Vault Wallet (1.17.0) connected on `solana:devnet` through this bridge. It was then used for the whole flow, stake and unlock, and it "worked flawlessly".
  - To put Seed Vault on devnet: Settings → tap the version number about 7 times → Developer mode → Devnet.
- **Emulator:** the full loop (stake, play, instant exit, pay once) ran with four confirmed devnet transactions (DEMO.md).

## Devnet to mainnet: the store release build's own `config.js`
- **Where (5 Oct):** `android/app/src/storeRelease/assets/config.js`. Gradle's `storeRelease` source set wins over `web/` when assets are merged, so only the store flavor's release build is on mainnet. Every debug build (the judges' APK) and the family app keep the devnet `web/config.js`.
- **Checked by reading the built APKs (5 Oct):** store release = `mainnet-beta` and the relay, no debug pages; store debug and family release = `devnet`.
- **Kept in step by `test/payments/mainnet-config.test.mjs`** (part of `cd tools && npm test`): the two files have the same keys; only the nine network values differ, and each of them does; the pool addresses equal `pool/mainnet.json`; the USDC account is derived from the merchant wallet. Change a price or a threshold in one file only and it fails.
- **Values:** the relay `https://rpc.isabellaocean.app`; pool `HoG8qP3n…7Pnk` and mint `Bz3AAGDB…obabi`; merchant = the revenue wallet `4Jb1…PMHq` and its USDC account `DDD9P9ke…ZYXP` (read on chain 5 Oct: exists, owned by that wallet). **The pool is not initialized yet**, so a mainnet build shows World 2 locked and cannot stake until it is.

What differs from `web/config.js`:
- **Network:**
  - `cluster: 'mainnet-beta'`, `chain: 'solana:mainnet'`;
  - a private `rpcUrl` (the public endpoint is "not for production").
- **Stake pool:**
  - `stake.programId`: the mainnet SPL stake pool `SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`;
  - the mainnet `pool` and `mint`, from `pool/mainnet.json` once the pool exists.
- **Merchant:**
  - `merchant.wallet` and `merchant.usdcAta`, an existing USDC account;
  - `merchant.usdcMint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.
- **Jupiter:** optionally, a `jupiter.apiKey` for headroom.
