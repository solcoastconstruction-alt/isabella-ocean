## Toadstool Hop (added 10 Oct 2026, one of the six Fairy games: `docs/FAIRY.md`)
- **How it plays:**
  - A side view of a waterfall glade. A river runs across the bottom, a cliff with a waterfall stands behind it, and a line of platforms goes off to the right.
  - Isabella the Fairy stands on the first one. A tap anywhere makes her hop to the NEXT platform, aimed at where that platform will be when she lands (a hop takes half a second: an arc, wings fluttering, fairy dust behind her wand).
  - The view scrolls to keep her in the left third of the screen.
  - The last hop lands on a mossy bank beside the treasure chest. With the key it bursts open (+10 coins); without it, the key floats over after a moment and it opens anyway.
- **The platforms:**
  - **Toadstools** stand still. **Lily pads** drift gently left and right. **Little clouds** float up and down (from level 15 gusts also nudge them sideways).
  - Each position is a pure function of the time, so a splash restart just carries on and the verifier can ask "what would a tap do at time t?" for any t.
  - Coins sit on platforms (taken by landing). Butterflies float over gaps (taken by hopping through them; each is worth a coin). A key waits on a plain platform in the second half.
- **The splash and the frog:**
  - A hop is good when the distance to the near edge of the next platform is within her reach (less when she must go up). Moving platforms are sometimes too far. She then falls short into the water.
  - A friendly cartoon frog pops up with her on its head, she sees dizzy stars, and it boosts her back onto the platform she left. Nothing is lost on Easy.
  - On Medium and Hard one coin drifts away (never below 0).
  - A tap during a hop is ignored; a tap just after landing waits until she has stepped to the middle (0.2 s).
- **Two ways on (Hard, levels 11–20):** some gaps offer two platforms, a near low one and a far high one. A tap on the left half of the screen hops to the near one, the right half to the far one, which holds a bonus coin or a butterfly. Dotted arcs show both ways. On Easy and Medium the choice is shown but a tap anywhere takes the near one.
- **Modes (the picker on the level screen: a wand with one, two or three sparkles):**
  - **Easy:** platforms 1.5 toadstools wide, drift at 0.7 speed, a hop closed for well under half the time, the next platform glows when a tap would work, hand after 4 s of quiet, nothing lost.
  - **Medium:** platforms 1.2 wide, the design speed, the glow, hand after 6 s, one coin lost to a splash.
  - **Hard:** platforms 0.95 wide, 1.3 times faster and a little further, no glow, hand after 8 s, one coin lost, the choice by half.
- **Stars:** 3 for no splash, 2 for one or two, 1 for reaching the chest. Never for speed.
- **Levels:** 20, ten to a page (World 1 the Meadow, World 2 the Cloud Tops), opened one at a time per mode. Level 11 of a mode opens when level 10 of that mode is done. World 1 uses skies 0–3 and has 12–24 platforms, toadstools only on 1–2, lily pads from 3, clouds from 6. World 2 uses skies 4–7, has 24–40 platforms, longer hops, the choices from 11 and the gusts from 15. Every level is a real course built from a seed (`SEEDS` in `logic.js`, picked by `test/games/hop/tune.js`), frozen by fingerprint, and each of its three modes has its own platform sizes, speeds and gaps.
- **How a gap is made:** each gap is as long as keeps its hop closed for a chosen share of the time (the "closed share", measured over a minute every 50 ms), with an open window long enough to catch and a closed one never too long. A moving platform repeats in whole beats, so a minute of scanning shows every moment.

| Level | Sky | Platforms (main + far) | Toadstools / pads / clouds | Drift (pad, cloud; speed) | Choices | Gusts | Cost E / M / H |
|---|---|---|---|---|---|---|---|
| 1 | Dawn meadow | 12 | 10 / 0 / 0 | -, -; - | - | - | 24 / 28 / 32 |
| 2 | Dawn meadow | 13 | 11 / 0 / 0 | -, -; - | - | - | 27 / 32 / 36 |
| 3 | Dawn meadow | 14 | 10 / 2 / 0 | 16, -; 0.7 | - | - | 36 / 44 / 50 |
| 4 | Bluebell wood | 15 | 10 / 3 / 0 | 19, -; 0.76 | - | - | 42 / 52 / 59 |
| 5 | Bluebell wood | 17 | 12 / 3 / 0 | 22, -; 0.82 | - | - | 48 / 59 / 68 |
| 6 | Waterfall glade | 18 | 10 / 3 / 3 | 25, 18; 0.88 | - | - | 57 / 74 / 85 |
| 7 | Waterfall glade | 19 | 11 / 3 / 3 | 28, 20.5; 0.94 | - | - | 69 / 87 / 102 |
| 8 | Waterfall glade | 21 | 12 / 4 / 3 | 31, 23; 1 | - | - | 77 / 99 / 116 |
| 9 | Sunny meadow | 22 | 10 / 4 / 6 | 34, 25.5; 1.06 | - | - | 86 / 115 / 136 |
| 10 | Sunny meadow | 24 | 11 / 6 / 5 | 37, 28; 1.12 | - | - | 103 / 136 / 162 |
| 11 | Blue sky | 23 + 2 | 9 / 6 / 6 | 46, 34; 1.3 | 2 | - | 109 / 153 / 205 |
| 12 | Blue sky | 24 + 2 | 10 / 5 / 7 | 47.6, 35.8; 1.356 | 2 | - | 119 / 165 / 223 |
| 13 | Blue sky | 25 + 2 | 8 / 4 / 11 | 49.1, 37.6; 1.411 | 2 | - | 128 / 179 / 240 |
| 14 | Sunset gold | 26 + 3 | 9 / 6 / 9 | 50.7, 39.3; 1.467 | 3 | - | 134 / 189 / 259 |
| 15 | Sunset gold | 27 + 4 | 10 / 7 / 8 | 52.2, 41.1; 1.522 | 4 | 18 | 146 / 202 / 279 |
| 16 | Moonlit night | 27 + 4 | 5 / 7 / 13 | 53.8, 42.9; 1.578 | 4 | 22 | 150 / 211 / 302 |
| 17 | Moonlit night | 28 + 4 | 8 / 8 / 10 | 55.3, 44.7; 1.633 | 4 | 26 | 160 / 225 / 322 |
| 18 | Moonlit night | 29 + 4 | 10 / 5 / 12 | 56.9, 46.4; 1.689 | 4 | 30 | 170 / 243 / 346 |
| 19 | Rainbow sky | 30 + 5 | 6 / 14 / 8 | 58.4, 48.2; 1.744 | 5 | 34 | 178 / 254 / 376 |
| 20 | Rainbow sky | 31 + 5 | 3 / 7 / 19 | 60, 50; 1.8 | 5 | 38 | 193 / 280 / 407 |

Platforms in the main line count the bank she starts on and the bank by the chest; "+" is the extra far platforms of the choices. Drift is how far a pad (sideways) and a cloud (up and down) moves each way, in world units, and its speed in radians a second, as on Medium; Easy drifts 0.8 as far and 0.7 as fast, Hard 1.15 as far and 1.3 as fast. The cost is the fixed difficulty function below, for Easy / Medium / Hard.

The cost is the fixed function in `logic.js` (hop windows, distance against reach, drift speed, narrow landings, platform count); `verify.js` asserts it rises 1→10 and 11→20, that 11 costs more than 10 and that Easy < Medium < Hard on every level.

- **Forgiving:** no timers shown, no words, no lives. A level cannot be failed and nothing is lost by waiting. After a quiet spell a hand taps. A child tapping at random still reaches every chest.
- **Save:** `game.hop.save` = `{ v: 1, mode, unlocked: {easy, medium, hard}, stars: {easy: [20], medium: [20], hard: [20]}, coins, chests, hops, splashes, runs }`. `runs` keeps where a half-played level stood and what she had taken (`"easy:4"`), so leaving a level and coming back resumes it. Sound follows `muted` in `isabella.save` (read only). Holding the title for 4 seconds opens every level of the mode (grown-ups).
- **Files:** `web/games/hop/` (`index.html`, `game.js`, `logic.js`, `art.js`, `sound.js`, `hub-symbol.svg` with `<symbol id="i-hop">`), drawing through `web/fairy/fairy.js` (Isabella, skies, waterfall, trees, toadstools, lily pads, clouds, coins, key, butterflies, chest); only the frog, the backdrop layers, the splash and the particles are drawn in `art.js`. DevTools port 9493.
- **Proof (`test/games/hop/`):**
  - `verify.js` freezes the level table and all 60 courses by fingerprint; checks every coin, butterfly and the key sits on a platform or over a gap, that nothing drifts into its neighbour, and that moving platforms repeat in whole beats. A search over tap times (a grid of 50 ms) finds a splash-free way through every course in every mode that collects every coin, butterfly and the key, and replays it through the real `Run` for 3 stars; the far platforms of every choice can be taken the same way. Model children through the real `Run.step()`: one with a 300 ms reaction who waits for a safe moment, a hasty one, a random tapper and a toddler all reach every chest. Also the cost function, the splash and the coin rules, stars, the chest, the choice, resume and the save.
  - `browser.js` plays with real touch at 915×412 and 800×360: both pages, the mode picker, a full Easy level 1 to the chest, a splash (Medium and Easy), the Hard choice, a resume after a reload, the save, home and `window.__back`, and a screenshot of every sky.
  - `soak.js` plays about three minutes of random taps and checks nothing piles up and memory stays flat.
  - `defects.js` breaks copies of the game on purpose (one text swapped for another) and shows each caught: it prints `N injected, N caught`.
- **Not yet watched:** no child has played it and the sound is unheard. Watch a child play Easy level 1 and tune the pace; Hard 20 should take a competent 8-year-old a few tries (the proof only shows that it can be done).
