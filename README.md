# Isabella Ocean

**Isabella Ocean** is five ad-free ocean games for kids on the Solana Seeker, for ages about 3 to 8.
It began as one game built for a 6-year-old. Four of the games, plus World 1 of the main game,
*Isabella the Mermaid*, are free and play offline. A parent unlocks World 2 (levels 11–20) in one
of two ways:

- **Stake 1 SOL** into our own SPL stake pool. The parent keeps the OCEAN pool tokens and can take
  the SOL back any time. The pool's fee is 100% of the staking rewards; that is the price.
- **Pay US$15 once** in any Jupiter-verified token, SKR included, swapped so that exactly 15 USDC
  arrives.

There are no accounts, no ads, no tracking and no backend: the unlock is read from the chain. It
runs on devnet today (see [Status](#status)).

- **Demo video** (2:48), filmed on a real Seeker with the Seed Vault Wallet on devnet:
  <https://youtu.be/__YTxNECcDc>
- **Website:** <https://isabellaocean-app.pages.dev>
- **APK**, the devnet test build: <https://isabellaocean-app.pages.dev/isabella-ocean.apk>
- **Docs:** [`docs/`](docs/README.md), one page per topic: [games](docs/GAMES.md),
  [payments](docs/PAYMENTS.md), [stake pool](docs/POOL.md), [Android](docs/ANDROID.md),
  [website](docs/SITE.md), [demo](docs/DEMO.md), [testing](docs/TESTING.md)

## What's native and on-chain

The games are drawn on an HTML5 canvas in plain JavaScript, with no libraries; all the art and
sound are made in code. The APK carries them as assets and runs them full screen in an Android
WebView, so there is no web server and they play offline. Everything around them is native Android
or on Solana:

- **Mobile Wallet Adapter 2, in Java**
  ([`WalletBridge.java`](android/app/src/store/java/app/isabella/mermaid/WalletBridge.java)).
  MWA clientlib 2.2.0, exposed to the page as `window.IsabellaWallet`: authorize (silently with
  the saved token after the first time) and `signAndSendTransactions`. Tested on a real Seeker with
  the Seed Vault Wallet on devnet: connect, stake, instant exit and pay once, all in the demo video.
- **`WalletKeepAlive`**
  ([`WalletKeepAlive.java`](android/app/src/store/java/app/isabella/mermaid/WalletKeepAlive.java)).
  Android freezes a backgrounded app about 70 s after the wallet opens, and the wallet's answer is
  then lost. This foreground `shortService` keeps the app awake only while a wallet request is
  open, for up to about 3 minutes. A 94 s approval was verified on the emulator.
- **Two Android flavors** ([`android/app/build.gradle`](android/app/build.gradle)). `store` is
  Isabella Ocean (`app.isabella.mermaid.seeker`), with the paywall and the wallet; its only network
  traffic is Solana RPC and Jupiter. `family` (`app.isabella.mermaid`) has everything unlocked, no
  wallet code and no internet permission. Plain Java: no framework, no androidx.
- **Our own SPL stake pool** ([`pool/`](pool/README.md)), live on devnet since 2 Oct 2026
  (addresses below). Its instructions are hand-encoded, because the JS SDK lacks several, and were
  checked four ways: hand-written byte vectors, byte for byte against the SDK, simulation, and real
  devnet transactions. The app adds the pool's permissionless epoch update to a parent's
  transaction when it is due.
- **Jupiter ExactOut** ([`web/payments.js`](web/payments.js)). Pay once lists the Jupiter-verified
  tokens in the wallet (SKR is one) and builds a Metis Swap v1 ExactOut swap into our USDC account,
  so exactly 15 USDC arrives. With no ExactOut route it falls back to ExactIn plus an exact USDC
  transfer, in one transaction. This is the mainnet path, tested read-only against mainnet.
- **Entitlement from the chain, no backend** ([`web/entitlement.js`](web/entitlement.js)). Staked:
  World 2 is open while the wallet holds at least 0.99 OCEAN, re-checked every 5 minutes and on
  resume, and it locks after 24 h without a successful check. Paid: each payment carries a
  reference key, `sha256("isabella-purchase-v1" + wallet)`, that `getSignaturesForAddress` finds
  again, so Restore purchase works after a reinstall.
- **Deterministic level solvers** ([`test/`](test/)). In Isabella every obstacle is a pure function
  of time, so `test/verify.js` proves all 20 levels can be finished. `test/games/maze/verify.js`
  searches every state of all 40 Coral Maze levels and proves each one escapable, with no dead
  ends. Fingerprints freeze Isabella's World 1 and every maze level.

Every transaction is simulated before the wallet is asked to sign, so most failures show before
any approval.

**Devnet addresses** (from [`pool/devnet.json`](pool/devnet.json) and
[`web/config.js`](web/config.js)):

| Account | Address |
|---|---|
| SPL Stake Pool program (v2.0.x on devnet) | `DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib` |
| Pool | [`D5k3bxRYCWizSToy7C3WzQoPBXYNAUZ78Lo2vvFR9q7a`](https://explorer.solana.com/address/D5k3bxRYCWizSToy7C3WzQoPBXYNAUZ78Lo2vvFR9q7a?cluster=devnet) |
| OCEAN mint ("Isabella Ocean Pass", 9 decimals) | `Fm2VtHvAdzAFz7XbD9gNWbrnnqhEqkCEoZVyVyxFS7TT` |
| Reserve | `6VJJwviBbfa9WNNNSmK8aR1UpGNuhwZSgwtPUuqTm4Ud` |
| Validator list | `ANX2oxjGduXwgDE5SmVM2o9NWDfTbHDMeE8mBuXwNEaM` |
| Merchant wallet (devnet pay once) | `HoackNncWJbNE8nKRpz241SLbS64cbP4Lr4zHZ5H7J2x` |

Pool settings: the epoch fee is 100% of rewards, an instant exit costs 0.3%, and the free exit and
deposits cost nothing. Only the manager may deposit stake accounts, which blocks reward skimming;
SOL deposits stay open to everyone.

## The five games

| Game | Ages | What the child does | In Isabella Ocean |
|---|---|---|---|
| Bubble Party | 3–5 | Drags bubbles carrying sea creatures onto the matching creature; every 10 saved make a gold coin | 10 levels, free |
| Isabella the Mermaid | 5–8 | Steers Isabella through the sea with a finger, dodging creatures, to find the key and open the treasure chest | 20 levels: World 1 free, World 2 unlocks |
| Shell Match | 5–8 | Opens shells to find the matching pairs | 6 levels, free |
| Coral Maze | 5–8+ | Swipes Isabella through coral mazes with keys, gates, currents and patrols | 20 Easy + 20 Hard levels, free |
| Sea Words | 5–8 | Word searches where every word comes with its picture | Endless, in 3 modes, free |

Rules for every game: kids never need to read, touch targets are about 2 cm on the Seeker, there
are no timers, nagging or ads, and anything involving money or a wallet sits behind the parent
gate.

## Try it on a Seeker (devnet)

1. **Install the APK** (the devnet test build, linked above), allowing installs from your browser
   when Android asks. The free games and World 1 work offline.
2. **Switch the Seed Vault Wallet to devnet:** Settings → tap the version number about 7 times →
   Developer mode → Devnet.
3. **Get devnet SOL** for your wallet at [faucet.solana.com](https://faucet.solana.com) (it may ask
   you to sign in with GitHub). About 1.2 SOL covers staking plus a purchase.
4. **Unlock World 2:** tap Play, page across to World 2 and tap a level with a gold padlock →
   Grown-ups → hold for 3 seconds, then answer a multiplication → **Stake 1 SOL** or **Pay US$15
   once** → approve in the wallet.

What happens next:

- **Stake** deposits 1.01 SOL and mints about 1.01 OCEAN. World 2 opens once it confirms.
- **To get the SOL back,** use the Grown-ups button on the title screen: "Get my SOL back now"
  costs 0.3%, and "free" takes about 2 days and then a Claim. Either way World 2 locks again.
- **Pay once on devnet** sends 0.1 devnet SOL (or 15 devnet USDC) to the merchant wallet instead
  of swapping through Jupiter. A purchase never expires, and Restore purchase finds it after a
  reinstall.

## Build it yourself

You need JDK 17 or newer (Android Studio's bundled JBR works) and the Android SDK with platform 36,
found through `ANDROID_HOME` or `sdk.dir` in `android/local.properties`. The Gradle wrapper is in
the repo.

```bash
cd android
# macOS with Android Studio; elsewhere, point JAVA_HOME at any JDK 17+
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
./gradlew :app:assembleStoreDebug :app:assembleFamilyDebug
```

| Flavor | Package | APK |
|---|---|---|
| `store` (Isabella Ocean) | `app.isabella.mermaid.seeker` | `android/app/build/outputs/apk/store/debug/app-store-debug.apk` |
| `family` (offline, all unlocked) | `app.isabella.mermaid` | `android/app/build/outputs/apk/family/debug/app-family-debug.apk` |

Install over USB with `adb install -r <apk>`. The `-r` updates in place and keeps saved progress,
but only over a build signed with the same key: if you installed the downloaded APK, uninstall it
first.

There is no JavaScript build step. `web/` goes into the APK as it is, and the Solana libraries are
pre-bundled in `web/vendor/solana.js` (rebuild it with `cd tools && npm ci && npm run bundle`).

**Signing.** Debug builds are signed with the local debug key of the machine that builds them.
Wallets verify the app's identity (Isabella Ocean, `https://isabellaocean-app.pages.dev`) through
[`site/.well-known/assetlinks.json`](site/.well-known/assetlinks.json), which names the package and
our signing certificate. A debug APK you build yourself has a different certificate, so the wallet
shows it as unverified, but everything works.

## Run the tests

Run these from the repo root with Node 22 or newer. The browser tests drive headless Google Chrome
with real touch or mouse input. They look for Chrome at its macOS path, so elsewhere set `CHROME`
and `CHROME_BIN` to your Chrome binary. Every command, its port and its last result are in
[`docs/TESTING.md`](docs/TESTING.md).

| Command | What it proves |
|---|---|
| `node test/verify.js` | All 20 Isabella levels can be finished: a sweep over time and height at 60% swim speed, then an autopilot through the real game loop. Levels 1–10 are byte-identical to the originals. About a minute. |
| `node test/games/maze/verify.js` | All 40 Coral Maze levels, with every state searched (keys, gates, shells, patrol phase): each solvable, free of dead ends, frozen, and harder than the last. About 50 s; `--easy` takes 1 s. |
| `node test/games/words/verify.js` | 13,000 Sea Words puzzles: placement, the three modes, and no rude words in any direction. |
| `node test/games/pop/verify.js` | Bubble Party's rules, level table and old-save conversion. |
| `node --test test/games/match/logic.test.js` | Shell Match's rules. |
| `node test/hub/hub.test.js` | The title screen: five big buttons that fit at 800×360, each opening its game and coming back. |
| `node test/games/maze/browser.js` (and `pop`, `words`) | Each game played in headless Chrome with real touch input. |
| `cd tools && npm ci && npm test` | Payments: offline unit tests including the entitlement rules, every flow simulated against devnet, and Jupiter ExactOut on mainnet, all read-only. Tests that send devnet transactions skip until you fund the key they print. |
| `cd pool && npm ci && npm test` | The hand-encoded stake-pool instructions, byte for byte, and the crank's rebalancing rules. Offline. |
| `cd pool && node status.mjs` | A read-only snapshot of the live devnet pool: fees, reserve and validators. No keys needed. |
| `node test/e2e/emulator-flow.js` | The whole parent flow on an Android emulator with real devnet transactions: stake, World 2 opens, instant exit, it locks, pay once, it opens. Needs a funded test wallet, and refuses any device that isn't an emulator. |

## Repo layout

```
web/                   the games and parent screens (HTML5 canvas, plain JS), packed into the APK
  games/               Bubble Party, Shell Match, Coral Maze, Sea Words (Isabella is web/ itself)
  paywall.js           the parent gate, unlock and grown-ups screens
  entitlement.js       is World 2 open? Read from the chain
  payments.js          stake, exits, claim, and pay once through Jupiter
  wallet.js            the JS side of the wallet bridge
  config.js            cluster, pool, mint, merchant and price
android/               the native app in Java: a WebView shell with two flavors
  app/src/main/        MainActivity: saves, back button, home-screen pin, full screen
  app/src/store/       WalletBridge and WalletKeepAlive (store flavor only)
pool/                  our SPL stake pool: create, crank, status, smoke test, mainnet runbook
site/                  the website, with .well-known/assetlinks.json and the privacy and terms pages
test/                  level solvers, browser tests with real touch, payments, emulator end to end
tools/                 builds web/vendor/solana.js and runs the payments tests
docs/                  how everything works, one page per topic
.github/workflows/     pool-crank.yml: runs the pool crank every 6 hours once a key is set
```

## Status

- **Devnet today.** The app, the stake pool and the merchant wallet are all on devnet, where
  tokens have no value.
- **Mainnet next,** on the Solana dApp Store after the hackathon. The mainnet stake pool will be
  created with the owner's own keys, following the runbook in [`pool/README.md`](pool/README.md);
  mainnet runs SPL Stake Pool v2.1.0 (`SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy`). Then
  `web/config.js` switches to mainnet (the changes are listed in
  [`docs/PAYMENTS.md`](docs/PAYMENTS.md)), and a release key signs the app, with its certificate
  added to `assetlinks.json`.

---
Source published for the Solana Mobile CLOCK IN hackathon. All rights reserved.
