# The iOS app (App Store build)

A third build of the same game, for iPhone and iPad. It wraps the same `web/` folder as the Android
apps in a plain Swift app with one web view: no framework, no third-party code, no network use.
World 2 (levels 11–20) is unlocked by **one Apple in-app purchase**. There is no wallet, no staking
and no chain code anywhere in it.

| | |
|---|---|
| Project | `ios/IsabellaOcean.xcodeproj` (one scheme, `IsabellaOcean`) |
| Bundle id | `app.isabellaocean.mobile` (his yes on 9 Oct; not registered with Apple yet, and permanent once it is) |
| Name on the device | Isabella Ocean |
| Version | 1.0 (1) |
| Devices | iPhone and iPad, landscape only, iOS 16.4 or later (a code for a one-time purchase needs 16.3) |
| Team | `4LU8AK735T` (his existing Apple Developer account), automatic signing |
| In-app purchase | `app.isabellaocean.mobile.world2`, non-consumable ("World 2"), Family Sharing on (his yes on 9 Oct) |
| Category | Kids Category (his yes on 9 Oct; the age band is still to choose) |
| Flavor | `window.IsabellaFlavor = 'appstore'` |

## What ships inside: `scripts/assemble-web.sh`
The app does not pack `web/` as it is. A Run Script build phase runs
`scripts/assemble-web.sh appstore <app>/web` on **every** build, so a build can never pack a stale
or a wrong copy. The script:
1. copies `web/`;
2. deletes `vendor/solana.js`, `wallet.js`, `payments.js`, `entitlement.js` and `paymock.js`;
3. lays `web-iap/config.js` and `web-iap/paywall.js` over it and writes `flavor.js`;
4. removes the four dead `<script>` tags, the comment that lists them and the `i-stake` icon from
   `index.html` (each anchor must be found exactly once, or the build fails);
5. **searches the result for wallet and chain wording** (`solana`, `wallet`, `usdc`, `jupiter`,
   `stake`, `devnet`, `mainnet`, `blockchain`, `dapp`, `pages.dev`, `mockpay`) and fails the build on
   any hit. The same search must find those words in `web/`, which proves it is looking.

It is POSIX `sh` with tools from `/usr/bin` only, because Xcode's build environment has no Homebrew.
The `play` flavor is accepted too, for the Google Play build later.

`web/` itself is untouched, so the Android builds are exactly as they were.

## The page's side: `web-iap/`
| File | Job |
|---|---|
| `web-iap/paywall.js` | Replaces `web/paywall.js`. The same `window.Paywall` that `app.js` already uses, the same parent gate (hold 3 s, then a multiplication) and the same screens' HTML and CSS from `index.html`. The unlock screen offers "Unlock for <the store's price>", "Restore purchase" and "Redeem a code"; the grown-ups' screen shows the status, Restore purchase, Redeem a code (until World 2 is owned), Privacy policy and Terms. |
| `web-iap/config.js` | Replaces `web/config.js`: the flavor and `freeLevels`. No price: the paywall shows the store's own localized price. |
| `web-iap/flavor.js` | Documentation only; the script writes the real one. |

The gate code in `web-iap/paywall.js` is a copy of the gate in `web/paywall.js`. A change to one
gate needs making in the other.

**The contract with the app, `window.IsabellaBilling`** (the Play build will offer the same):
- `state()` → `{ owned, price, ready }`, at once;
- `buy()` → `{ status: 'purchased' | 'pending' | 'cancelled' }`;
- `restore()`, `refresh()`;
- `redeem()`, optional: opens the store's own "redeem a code" sheet. The buttons show only if it exists;
- `onChange(fn)`;
- failures reject with `.code` `offline`, `unavailable` or `failed`, and the paywall has a sentence for each.

## The app's side: `ios/IsabellaOcean/`
| File | Job |
|---|---|
| `GameViewController.swift` | The one full-screen web view. Loads `isabella://app/index.html`, refuses every other address, hides the status bar and the home indicator, grants the motion sensors to the game's own pages (Splash Dash's tilt) without a system prompt. |
| `BundleSchemeHandler.swift` | Serves the `web` folder at `isabella://app/…`. A path outside the folder is a 404. |
| `bridge.js` | Put in front of every page before its own scripts: `IsabellaStore` (saves), `IsabellaBilling`, `IsabellaApp.openUrl`. |
| `Billing.swift` | The purchase, through StoreKit 2. |
| `Info.plist`, `PrivacyInfo.xcprivacy` | Landscape only, full screen, no encryption declared; the privacy manifest declares UserDefaults (reason CA92.1) and nothing collected. |
| `Simulator.entitlements` | `get-task-allow`, for Simulator debug builds only (see "Testing"). |

- **Saves** live in UserDefaults under `isabella.saves`. The web view itself keeps nothing
  (`websiteDataStore = .nonPersistent()`). Each page starts with the saves as they were when it was
  asked for, so a save written just before leaving a page is there on the next one.
- **Links out:** only `https://isabellaocean.app/apple/…` (this build's own Privacy, Terms and Support
  pages, SITE.md), opened in Safari, and only from the grown-ups' screens, which sit behind the gate.
- **Sound** is Web Audio, which iOS treats as "ambient": the ring/silent switch mutes it.

### How ownership is decided (`Billing.swift`)
1. **A signed transaction is the evidence.** One that is not revoked opens World 2; one that is
   revoked (a refund) locks it. It can arrive as the result of a purchase, as an update from the
   store (Ask to Buy approved, a refund, a purchase on another device), or as the answer to "what is
   the latest transaction for this product?" (asked at launch, on coming back to the app, on the
   grown-ups' screen and after Restore).
2. **"No transaction" is not evidence against one already seen.** Straight after a purchase the store
   can answer "none" for a moment. So once a valid transaction has been seen in this run, only a
   revocation takes World 2 away.
3. **On a fresh launch** nothing has been seen yet, so "none" means locked. But if the last run ended
   unlocked, the store is asked a second time 2 seconds later before World 2 is taken away.
4. An unverified transaction unlocks nothing.

The last answer is kept in UserDefaults so the padlocks are right on the first frame.

### Codes: gifting World 2
He wants to give World 2 to some people. Apple's way, and the only way its rules allow (an app may
not unlock content with codes of its own, guideline 3.1.1), is an **offer code** with a "Free
Offer" price, made in App Store Connect. The old in-app-purchase promo codes were retired on
26 March 2026. Sources and the step-by-step list: `.local/reports/8-apple-promo-and-offer-codes.md`.

- **In the app:** "Redeem a code" calls `AppStore.presentOfferCodeRedeemSheet(in:)`, Apple's own
  sheet. A redeemed code then arrives like any purchase, as a transaction from the store, sometimes
  a moment after the sheet has closed; the grown-ups' screen celebrates when it does.
- **Real codes can only be made once the app is live and World 2 is approved.** Sandbox codes
  (10 to 10,000) can be made before, and are how this is tested on a real device.
- **Two kinds.** One-time codes come in batches of at least 500, last up to 6 months, and each has
  its own link. A custom code is one word he chooses with a limit on how many people may use it; it
  works only through its link or the in-app button, not the App Store's own Redeem screen.
- Each person can redeem one code per offer. Customers need iOS 16.3.
- `presentOfferCodeRedeemSheet(in:)` is deprecated from iOS 27 in favour of a version that returns
  the transaction. It still works; change it when the project moves to the Xcode 27 SDK.
- **Not tested for real:** the Simulator cannot redeem a code with Xcode 26.6. The tests stand in
  for the sheet's three endings (closed, store unreachable, redeemed).

## Testing
```bash
cd ios && xcodebuild test -project IsabellaOcean.xcodeproj -scheme IsabellaOcean \
  -destination 'platform=iOS Simulator,name=Isabella iPhone' -derivedDataPath ../.local/ios-build
```
`IsabellaOceanTests/BillingFlowTests.swift` runs inside the real app: the real pages in the real web
view, the real bridge and the real `Billing`, against Xcode's local App Store
(`IsabellaOceanTests/Products.storekit`, US$4.99). Nothing is tapped: the tests press the page's own
buttons from JavaScript and read the page back. 13 checks: what the build packed, the flavor and
bridge, only the game's pages load, saves across six page changes, the gate, buying, a refund, Ask to
Buy, a failed purchase and its retry, a remembered purchase against one and two empty answers,
Restore, and a code redeemed from each of the two screens.

`TEST_RUNNER_ISABELLA_SNAPSHOTS=/some/folder` in front of that command also saves pictures: nine of
the unlock path and thirteen of the first screen of every game (two more tests; skipped otherwise).

Two simulators were made for this alone, so no other project's simulator is touched: **Isabella
iPhone** (iPhone 17 Pro) and **Isabella iPad** (iPad A16), both iOS 26.5.

### The iPad pass (9 Oct 2026, 1180×820)
The whole game is sized by screen height, for wide phones. On an iPad's squarer screen:
- **Fixed:** the level map reached under the page arrows (the arrow covered half of level 5), and
  Sea Jigsaw's picture grid sat hard against the right edge. Both have a rule under
  `@media (max-aspect-ratio: 16/10)` in `web/index.html` and `web/games/jigsaw/index.html`. Every
  phone is wider than 16:10, so phones are untouched: `node test/hub/hub.test.js` is still 142/142
  and the computed sizes at 874×402 are the old ones.
- **Fine as they are:** Isabella in play and paused, the more-games screen, Coral Maze, Shell Match,
  Sea Words, Treasure Blocks, Splash Dash, the unlock and grown-ups' screens.
- **Left for him to judge:** on the title screen the swimming Isabella passes behind the game
  buttons; Bubble Party's and Sea Catch's level bubbles fill the width with a small margin (28 pt).
- Only each game's first screen was looked at, not the games in play.

### What we learned the hard way (9 Oct 2026, Xcode 26.6)
- **Xcode's local store refuses an app that is "not installed for development".** A Simulator build
  made from the command line carries no `get-task-allow`, the test session then fails every call with
  `SKInternalErrorDomain Code=3`, and the purchase falls through to the real sandbox, which puts up a
  "Sign in to Apple Account" box and hangs the run. The reason is only in the simulator's own log
  (`xcrun simctl spawn <id> log show … storekitd`). `Simulator.entitlements` fixes it; it applies to
  Debug builds for the Simulator only.
- **The local store lags.** For about 0.5 to 0.75 s after a verified purchase, `Transaction.latest`,
  `currentEntitlements` and `Transaction.all` all answer "nothing". Clearing transactions lags the
  same way. This is what rule 2 above is for; whether the real App Store lags is not known.
- **A simulated purchase failure sticks.** After `setSimulatedError(…, forAPI: purchase)`, every
  later purchase throws `StoreKitError.unknown` until the session is reset. A new `Product`, a 3 s
  wait and clearing transactions did not help.
- **The app must not ask the store before the test session exists,** or the first test waits about
  40 s for the sandbox to give up. Under test the app leaves `billing.start()` to the tests.

## Not proven yet
- **Nothing has run on a real iPhone or iPad.** Tilt steering, sound, the home-indicator and
  Dynamic Island edges, and the eight other games in play on an iPad all need his eyes.
- **A real code.** No offer code has been redeemed anywhere.
- **The real App Store.** Every purchase check above is against Xcode's local store. A real purchase,
  a real Restore (which asks for the Apple Account password) and a retry after a real failure need
  the product to exist in App Store Connect and a sandbox tester account.
- The gate's hold is driven by synthetic pointer events in the tests, not by a finger.

## What is left before submitting
His, in App Store Connect (the full list with sources: `.local/reports/6-app-store-and-play-requirements.md`):
the Paid Apps Agreement with tax and bank details, the Small Business Program, the app record and
bundle id, the in-app purchase, the Kids Category choice and age band, App Privacy answers.

Ours: **deploy the site** (his word): the app's Privacy and Terms links point at
`isabellaocean.app/apple/…`, pages that are written and tested but not live, so today those links
give a 404. The listing text is drafted in `listing/appstore-draft.md`; screenshots at Apple's
sizes; an Archive and upload.
