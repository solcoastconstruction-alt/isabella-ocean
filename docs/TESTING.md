# Testing

Run from the repo root. Browser tests drive headless Chrome over the DevTools protocol with real
touch or mouse input, each on its own port. Two tests that share a port must not run at the same time.

| Command | Checks | Last result | Port |
|---|---|---|---|
| `node test/verify.js` | Isabella: all 20 levels finishable; levels 1–10 byte-identical (frozen) | 20/20 | – |
| `node test/hub/hub.test.js` | Title screen (a game, Play, a game, "+") and the more-games screen, at 915×412 and 800×360 in both flavors: buttons ≥19vh, nothing overlapping, every game opens and comes back; the two recipes in `web/hub.js` carried out on a copy | 142/142 | 9454 |
| `node test/paywall/drive.js` | Paywall, parent gate, grown-ups screen; family baseline unchanged | 96/96 | 9450 |
| `cd tools && npm test` | Payments: unit tests (including the price as exactly 4,990,000 USDC base units), devnet simulation, Jupiter read-only, the mainnet config against the devnet one | 48 pass, 9 skipped (5 Oct) | – |
| `node rpc-relay/test/relay.test.mjs` | RPC relay guards: allow-list, body and batch caps, CORS, rate limit, no provider URL in any answer (RPC-RELAY.md) | 29/29 (5 Oct) | – |
| `node rpc-relay/test/app-methods.test.mjs` | The relay's allow-list equals the RPC methods the app's scripts call; no send, no subscription | 10/10 (5 Oct) | – |
| `node rpc-relay/test/mutants.mjs` | Breaks copies of the relay and the app on purpose (about a minute) | 45/45 caught (5 Oct) | – |
| `cd ios && xcodebuild test -project IsabellaOcean.xcodeproj -scheme IsabellaOcean -destination 'platform=iOS Simulator,name=Isabella iPhone' -derivedDataPath ../.local/ios-build` | The iOS app, inside the Simulator against Xcode's local App Store: what the build packed (no wallet or chain code), saves across page changes, the gate, buying, a refund, Ask to Buy, a failed purchase, a remembered purchase, Restore (IOS.md) | 13/13 on iPhone 17 Pro and on iPad A16 (9 Oct; the first 11 passed six runs in a row); three defects put into `Billing.swift` on purpose were each caught | – |
| `sh scripts/assemble-web.sh appstore .local/tmp/web-appstore` | Assembles the App Store web bundle and fails if any wallet or chain wording is left in it | 55 files, clean (9 Oct) | – |
| `node --test test/games/match/logic.test.js` | Shell Match rules | 10/10 | – |
| `node test/games/pop/verify.js` | Bubble Party rules, level table, old-save conversion | 25/25 | – |
| `node test/games/pop/browser.js` | Bubble Party with real touch drags | 86/86 | 9455 |
| `node test/games/pop/soak.js` | ~3 minutes of random play: no errors or leaks | pass | 9455 |
| `node test/games/maze/verify.js` | Coral Maze: all 40 levels (Easy + Hard) solvable, trap-free, frozen, rising; every Hard level harder than Easy 20 (~50 s; `--easy` for a 1 s run) | 40/40 | – |
| `node test/games/maze/browser.js` | Coral Maze with real touch: the mode picker, Hard scrolling, saves | 115/115 | 9454 |
| `node test/games/maze/soak.js` (or `… hard`) | ~3 minutes of random play | pass | 9454 |
| `node test/games/words/verify.js` | Sea Words: 13,000 puzzles; placement, modes, no rude words, fresh vs seeded | 69/69 | – |
| `node test/games/words/browser.js` | Sea Words with real touch drags in all modes | 86/86 | 9457 |
| `node test/games/words/soak.js` | ~3 minutes of random play | pass | 9457 |
| `node test/games/blocks/verify.js` | Treasure Blocks: shapes, turns, row clearing, coins, the fair bag, the save; model players reach the row goal in every mode on every seed (about a minute; `--quick` for a few seconds) | 118/118 | – |
| `node test/games/blocks/browser.js` | Treasure Blocks with real touch: buttons and gestures in all three modes | 150/150 | 9484 |
| `node test/games/blocks/soak.js` | ~3 minutes of random play | pass (on its branch) | 9484 |
| `node test/games/blocks/mutants.js` | Breaks copies of Treasure Blocks on purpose; every defect must be caught (about 20 minutes; `--rules` for 3) | 34/34 caught (on its branch) | 9484 |
| `node test/games/jigsaw/verify.js` | Sea Jigsaw: 30 puzzles, every cut tiles its picture, coins and bonus, saves; table, cuts and pictures frozen | 34/34 | – |
| `node test/games/jigsaw/browser.js` | Sea Jigsaw with real touch drags in all three modes; all 30 puzzles on screen | 145/145 | 9481 |
| `node test/games/jigsaw/soak.js` | ~3 minutes of random play | pass (on its branch) | 9481 |
| `node test/games/jigsaw/bite.js` | Breaks copies of Sea Jigsaw on purpose (about 20 minutes; `verify` for 1) | 25/25 caught (on its branch) | 9481 |
| `node test/games/jigsaw/sheet.js` | Saves a contact sheet of the 30 pictures and their cuts (pictures to look at, not a pass/fail test) | – | 9481 |
| `node test/games/dash/verify.js` | Splash Dash: all 20 courses frozen, a clean line at slow and full speed, every coin reachable, a model child never bumps; the tilt maths (about a minute) | 446/446 | – |
| `node test/games/dash/browser.js` | Splash Dash with real touch and Chrome's sensor events: steering, the speed button, bumps, leaps, the chest | 161/161 | 9482 |
| `node test/games/dash/soak.js` | ~3 minutes of random play across all 20 courses | pass (on its branch) | 9482 |
| `node test/games/dash/mutate.js` | Breaks copies of Splash Dash on purpose (about half an hour) | 37/37 caught (on its branch) | 9482 |
| `node test/games/catch/verify.js` | Sea Catch: 10 levels frozen and rising, fair spacing, a bonk-free path always exists, model players reach every chest (about 40 s) | 46/46 | – |
| `node test/games/catch/browser.js` | Sea Catch with real touch drags | 101/101 | 9483 |
| `node test/games/catch/soak.js` | ~3 minutes of random play | pass (on its branch) | 9483 |
| `node test/games/catch/defects.js` | Breaks copies of Sea Catch on purpose (`rules` for the quick ones) | 34/34 caught (on its branch) | 9483 |
| `node test/e2e/emulator-flow.js` | The full parent flow on the emulator with real devnet transactions | 9/9 | 9460 |

Results are from `main` on 4 Oct 2026 (app version 2.4). "On its branch" means the game's building
agent ran it before the merge and it has not been re-run on `main`.

## End to end on the emulator
- **Needs:** the store debug build, a fakewallet funded with ≥1.2 devnet SOL that has never bought World 2, and the app's DevTools socket forwarded to :9460 (ANDROID.md).
- **Flow:** stake → World 2 opens → instant exit → locks → pay once → opens.
- **Safety:** it refuses to run on anything but an emulator.

## The pool
`cd pool && node smoke.mjs` (POOL.md) runs the pool end to end on devnet with throwaway wallets.

## Habits that caught real bugs
- **Prove the levels instead of eyeballing them:** solvers and fingerprints for Isabella and the maze.
- **Test with real touch input,** not just the debug hooks:
  - the maze's sloppy swipes;
  - Bubble Party's drags, which caught a counting bug.
- **Make sure the checks bite:** both game agents broke copies of their code on purpose (11 and 15 defects), and every defect was caught.
  - The four games added on 4 Oct each keep this as a script (`mutants.js`, `bite.js`, `mutate.js`, `defects.js`): 34, 25, 37 and 34 defects, all caught.
- **Before releasing,** run every suite on the merged `main`, not only on the agent's branch.
