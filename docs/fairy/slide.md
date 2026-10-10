# Rainbow Slide (added 10 Oct 2026)

Part of the Fairy world (`docs/FAIRY.md`, which holds the common frame: menu with a mode picker, 20 levels on two
pages, stars, chest, save shape). Folder `web/games/slide/`, tests in `test/games/slide/`, save key `game.slide.save`,
DevTools port 9492. The owner's child asked for it: "slide down a rainbow and turn left or right to dodge clouds, follow the
path to collect coins and a key to unlock treasure; different backdrops and courses; the rainbow can move in curves and
even loop the loop."

## How it plays
- **The view:** the same behind-the-back view as Splash Dash. Isabella the Fairy sits and slides away from the player down a wide
  rainbow ribbon that winds left and right through the sky, over waterfalls and treetops (World 1) or cloud tops (World 2).
  She always slides forward at the course's speed; steering moves her across the ribbon's width.
- **Clouds:** fluffy clouds sit on the ribbon; from course 9 some have a cross face, and from course 13 grumpy ones drift in from
  the rim toward the middle (never across the lane, so there is always a way past). Hitting one is a soft "poof": she wobbles,
  drops to half speed and picks up again within a second or two, and may spill one coin (not on Easy). A cloud never stops her.
- **Coins and the key:** gold coins lie along a lane that is always clear, so they show the safe way. The key hangs on the lane in
  the second half (somewhere between 58% and 75% of the way). The chest waits at the end of the ribbon on a big cloud: with the
  key it bursts open at once; without it the key floats down to her after a moment and it opens anyway. Nothing can be failed.
- **Rainbow arches:** a rainbow arch stands across the ribbon about every 15 seconds at Medium speed. Each is a checkpoint; passing
  one makes a shower of sparkles. Nothing is ever laid near an arch.
- **Loop-the-loop:** some courses carry a loop (a full vertical loop, 840 units of ribbon round). The ribbon curls up over her head
  and the sky turns right round. Loops have no clouds, give a shower of sparkles all the way round, and carry eight extra coins.
- **Steering:** a finger held on the screen to her left or right (always works; she slides to the finger and settles under it), or
  tilt as Splash Dash does (`devicemotion`, the same `TILT` model: left side down steers left, full steer at 20° of lean). Also
  `window.__steer(x)` / `window.__tilt(...)` for a native bridge, and the arrow keys in a desktop browser. A finger beats the tilt
  while it is down. `window.__dbg` (hold the coin counter 3 s, or `?dbg=1`) shows which input is steering.
- **The look:** all drawing goes through the shared `FairyArt` (`web/fairy/fairy.js`): the skies, Isabella (pose `slide`), clouds, rainbow
  arches (`drawRainbow`), trees, flowers, mushrooms, waterfalls, coins, the key and the chest. Only the winding perspective ribbon,
  the loop, the particles, the progress bar and the hint pictures are drawn in `art.js`. `FairyArt.drawRainbowRibbon` has one fixed
  width, so it draws the title screen's swoosh but not the play ribbon, which has to narrow into the distance.

## The three modes (the same course, scaled)
| | Easy (one sparkle) | Medium (two) | Hard (three) |
|---|---|---|---|
| Speed | ×0.8 | as designed | ×1.25 |
| Ribbon width | ×1.22 | as designed | ×0.84 |
| Clouds | ×0.6 chance of partners and floaters, room beside the lane ×1.25, gaps ×1.35 | as designed | ×1.4, room ×0.85, gaps ×0.75 |
| Spilled coin on a poof | no | one | one |
| The rim | invisible rails: she cannot leave the ribbon | she is bumped back with a wobble | she slips off: a little cloud floats her down to the last arch (or the start), coins and key kept |

The winds of the ribbon, the loops, the arches and the key are the same in every mode; only speed, width and the clouds change. A
poof, or the moment of grace (1.6 s) after coming back, never makes her slip: near the rim it is only a bump back.

## The twenty courses
Each new thing is the first thing met on its course. Times and speeds are at Medium; width is the ribbon's full width.

| Course | Backdrop | Time | Speed | Width | Loops | New |
|---|---|---|---|---|---|---|
| 1 | Dawn meadow | 50 s | 250 | 580 | | single clouds |
| 2 | Dawn meadow | 53 s | 254 | 576 | | pairs to slide between |
| 3 | Bluebell wood | 56 s | 258 | 572 | | rows of clouds with one way through |
| 4 | Bluebell wood | 58 s | 263 | 568 | | slaloms |
| 5 | Bluebell wood | 61 s | 267 | 562 | | S-bends round big clouds |
| 6 | Waterfall glade | 64 s | 271 | 558 | 1 | the first loop |
| 7 | Waterfall glade | 67 s | 275 | 554 | | |
| 8 | Sunny meadow | 69 s | 279 | 550 | 1 | |
| 9 | Sunny meadow | 72 s | 284 | 546 | | grumpy faces on some clouds |
| 10 | Sunny meadow | 75 s | 288 | 542 | 1 | |
| 11 | Blue sky | 70 s | 292 | 536 | | World 2 (Cloud Tops): a step tighter than course 10 |
| 12 | Blue sky | 73 s | 296 | 532 | 1 | |
| 13 | Sunset gold | 76 s | 301 | 528 | | grumpy clouds that drift in from the rim |
| 14 | Sunset gold | 78 s | 305 | 524 | 1 | |
| 15 | Sunset gold | 81 s | 309 | 490 | | a narrower ribbon |
| 16 | Moonlit night | 84 s | 313 | 474 | 1 | two drifters, one from each side |
| 17 | Moonlit night | 87 s | 317 | 458 | 2 | two loops |
| 18 | Rainbow sky | 89 s | 322 | 442 | 2 | |
| 19 | Rainbow sky | 92 s | 326 | 426 | 2 | |
| 20 | Rainbow sky | 95 s | 330 | 410 | 2 | |

Later courses also have smaller gaps, less room beside the lane, more pairs and floaters, a lane that wanders more, and tighter
bends in the ribbon (World 2). At Easy a course takes 25% longer than at Medium, at Hard 20% less.

## Rewards and saving
- **Stars** count the coins kept, never time: 3 for 80% of the lane coins, 2 for half, 1 for reaching the chest. The coins in a loop are
  extra. The chest adds 10 coins. Coins go into the save the moment they are earned (a spilled coin comes back out), so leaving
  in the middle loses nothing; stars and the next course are saved at the finish line.
- **Levels open one at a time per mode**; World 2 opens when course 10 of that mode is finished. Holding the title for 4 seconds opens
  every course of the mode on show (a test shortcut).
- **Save:** `game.slide.save` = `{ v: 1, mode, unlocked: { easy, medium, hard }, stars: { easy: [20], ... }, best: { ...: [20] }, coins, taught }`
  through `IsabellaStore` (or `localStorage`). Sound follows `muted` in `isabella.save`: it is only read, never written (there is no
  sound button here; the hub has the switch).

## Proof
- `verify.js` freezes the level table and all 60 courses (20 per mode) by fingerprint. For each it checks the layout (clear sky at the start and
  the end, clouds clear of loops, arches and the key, the key on the lane, loops where the table says) and that a clean line exists at the course's
  speed: a sweep over (distance, position across the ribbon) at 60% of the steering speed, with the clock started at 17 different moments where clouds
  drift, at 70% speed too, and again from every arch she might be floated back to. Every coin and the key are on such a line, so 3 stars are always reachable. A
  model child who sees only 2 s ahead and reacts 0.3 s late (and a slower one) slides every course in every mode without a poof, takes the key and 3 stars, and
  never meets the rail or the rim. The difficulty score (one fixed cost function: open width, tight stretches, steering work, cloud rate, movers, room, speed,
  narrowness) rises 1→10, 11→20, course 11 is above course 10, and Easy < Medium < Hard in every course. Sliding straight ahead with eyes shut reaches the chest in
  every mode. Then the rules (rails, the bump, the slip and the checkpoint, the poof, loops, the key, both ways the chest opens, stars, the modes) and the tilt maths
  against a separate model of the phone, both landscape ways round.
- `browser.js` plays with real touches at 915×412 and 800×360 and with real sensor events from Chrome (`Emulation.setSensorOverride` for `devicemotion`,
  the DeviceOrientation override): both pages of the level select, the mode picker, a whole Easy course 1 with one finger steering to the chest, a poof, the
  key, the chest with and without the key, a loop, an arch, the fall to the arch on Hard, the save, home and `window.__back`.
- `soak.js` plays about three minutes of random play across the courses and modes, with a heap, DOM-node and listener check.
- `defects.js` breaks copies of the game on purpose (a coin in a drifter's way, a cloud on the lane, a loop with a cloud, a missing rail on Easy, a mode that does
  not scale, a checkpoint that does not restore, and more) and prints `N injected, N caught`.
- **Last results (10 Oct 2026, on the branch):** `verify.js` 1952/1952 (about 45 s); `browser.js` 155/155; `soak.js` pass (273 s: 60 courses played, 5 finishes, 10 loops, 26 arches, 4 slips on Hard brought back, 60 fps, heap +0.26 MB, no new DOM nodes or listeners); `defects.js` 45 injected, 45 caught (run in three batches after a stale search string stopped the first run).
- `tune.js` picks the seeds (`SEEDS` in `logic.js`) so the difficulty climbs; the fingerprints in `verify.js` freeze the result.

## Not checked on a phone
- **The tilt sign:** the code expects left side down to steer left. If a phone steers the wrong way, flip `TILT.SIGN` in `logic.js` (the model is Splash Dash's, whose
  `devicemotion` was seen firing at about 60 Hz on the Seeker with no permission call). Slide has not been run on the Seeker.
- **Isabella is drawn from the side** (FairyArt has side-view poses only), sitting and facing the way she is steering, on a ribbon seen from behind.
- **Not yet watched:** no child has played it and the sound is unheard. The speeds, the slip and the loop's feel are a first guess; watch a child play Easy 1 and tune.
