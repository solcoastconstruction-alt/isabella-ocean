# Testing

Run from the repo root. Browser tests drive headless Chrome over the DevTools protocol with real
touch or mouse input, each on its own port. Two tests that share a port must not run at the same time.

| Command | Checks | Last result | Port |
|---|---|---|---|
| `node test/verify.js` | Isabella: all 20 levels finishable; levels 1–10 byte-identical (frozen) | 20/20 | – |
| `node test/hub/hub.test.js` | Title screen: 5 game buttons ≥19vh, fit at 800×360, each opens and comes back | 16/16 | 9454 |
| `node test/paywall/drive.js` | Paywall, parent gate, grown-ups screen; family baseline unchanged | 96/96 | 9450 |
| `cd tools && npm test` | Payments: unit tests, devnet simulation, Jupiter read-only | 39 pass, 9 skipped | – |
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
| `node test/e2e/emulator-flow.js` | The full parent flow on the emulator with real devnet transactions | 9/9 | 9460 |

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
- **Before releasing,** run every suite on the merged `main`, not only on the agent's branch.
