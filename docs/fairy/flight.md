## Fairy Flight (added 10 Oct 2026)
The flagship of the Fairy world (`docs/FAIRY.md`): the big centre button on the fairy title. Folder `web/games/flight/`, save key `game.flight.save`, tests in `test/games/flight/`, DevTools port 9491. Ages 3–8.

- **How it plays:**
  - A side view. The forest scrolls from right to left at the level's speed. Isabella the Fairy flies on the left third of the screen.
  - A finger anywhere on the screen is where she flies: she eases toward its height (and a little toward its x, within a band of the left third). With no finger she drifts gently toward the middle height.
  - Closed flower buds stand on the ground, on toadstools, on tree tops and on clouds, at different heights. They glow and twinkle so they can be seen from afar.
  - When she passes within the **dust radius** of a bud her wand sprinkles fairy dust and the bud blooms over about half a second. Every plant brought to life pays one gold coin, which flies up to the coin row (one ring per plant).
  - Grumpy **ground critters** (snail, hedgehog, toad) trundle along; grumpy **sky bugs** (beetle, wasp, moth) fly straight, in a sine wave, in a slow circle or (from level 13) weaving. Touching one is a bonk.
  - A **golden key** hangs halfway along each course (taken by flying through it). The course ends at the **treasure chest**: with the key it bursts open with coins (+10). Without it she lands beside the chest, the key floats over to her anyway after a moment, and the chest opens. Nothing can be failed.
  - A hint hand shows the finger-slide to a first-time player (level 1 until the first bloom) and after a quiet spell (Easy 6 s, Medium 10 s, Hard 16 s).
- **Menu:** the name, home, three mode buttons (a wand with one, two or three sparkles = Easy, Medium, Hard; the last one played is shown pressed and remembered), then 20 levels on two pages (World 1 the Meadow, World 2 the Cloud Tops) with page arrows and dots. Levels open one at a time per mode; World 2 opens when level 10 of that mode is finished. Holding the world name for 4 seconds opens every level of the current mode (a grown-ups' shortcut).
- **Modes** scale the same course (the plants and the key are identical in all three):

  | Mode | Scroll speed | Dust radius | Enemies | Bonk |
  |---|---|---|---|---|
  | Easy | ×0.8 | 118 (wide) | every other one (half), critters ×0.7, bugs ×0.8 | nothing is lost |
  | Medium | as designed | 86 | as designed | one coin drifts away (never below 0) |
  | Hard | ×1.25 | 62 (tight) | half as many again (two critters where Medium has none, on levels 1–2), bugs ×1.3 | as Medium |

  Units are world units on a 540-tall screen. At Medium level 1, Isabella's column crosses a screen in about 12 s.
- **Levels:** 20 courses generated from seeds (`LEVELS` in `logic.js`) and frozen by fingerprint. Course length is at Medium speed; the scroll speed in the table is units a second.

| Level | Forest | Course | Scroll speed (Easy / Medium / Hard) | Plants | Enemies (Easy / Medium / Hard) | New |
|---|---|---|---|---|---|---|
| 1 | Dawn meadow | 40 s | 80 / 100 / 125 | 6 | 0 / 0 / 2 | plants on the ground and on toadstools |
| 2 | Dawn meadow | 42 s | 83 / 104 / 130 | 7 | 0 / 0 / 2 | |
| 3 | Dawn meadow | 44 s | 86 / 108 / 135 | 8 | 1 / 2 / 3 | plants on tree tops; critters (snails) |
| 4 | Bluebell wood | 46 s | 90 / 112 / 140 | 9 | 1 / 2 / 3 | hedgehogs |
| 5 | Bluebell wood | 48 s | 93 / 116 / 145 | 10 | 2 / 4 / 6 | bugs, flying straight |
| 6 | Waterfall glade | 50 s | 96 / 120 / 150 | 11 | 3 / 5 / 8 | toads |
| 7 | Waterfall glade | 52 s | 100 / 125 / 156 | 12 | 4 / 7 / 11 | plants on clouds; bugs in a sine wave |
| 8 | Waterfall glade | 55 s | 104 / 130 / 163 | 13 | 4 / 8 / 12 | |
| 9 | Sunny meadow | 57 s | 108 / 135 / 169 | 14 | 5 / 9 / 14 | bugs in a slow circle |
| 10 | Sunny meadow | 60 s | 112 / 140 / 175 | 15 | 5 / 10 / 15 | |
| 11 | Blue sky | 55 s | 116 / 145 / 181 | 14 | 6 / 12 / 18 | World 2; two critters together; plants higher and lower |
| 12 | Blue sky | 57 s | 120 / 150 / 188 | 15 | 7 / 13 / 20 | |
| 13 | Blue sky | 59 s | 124 / 155 / 194 | 16 | 8 / 15 / 23 | bugs that weave |
| 14 | Sunset gold | 61 s | 128 / 160 / 200 | 17 | 8 / 16 / 24 | |
| 15 | Sunset gold | 64 s | 132 / 165 / 206 | 18 | 9 / 18 / 27 | moving clouds carry plants (40% of the cloud plants) |
| 16 | Sunset gold | 67 s | 136 / 170 / 213 | 19 | 10 / 19 / 29 | |
| 17 | Moonlit night | 70 s | 140 / 175 / 219 | 20 | 11 / 21 / 32 | more clouds move (60%) |
| 18 | Moonlit night | 73 s | 144 / 180 / 225 | 21 | 11 / 22 / 33 | |
| 19 | Rainbow sky | 76 s | 148 / 185 / 231 | 22 | 12 / 24 / 36 | most clouds move (80%) |
| 20 | Rainbow sky | 80 s | 152 / 190 / 238 | 24 | 13 / 26 / 39 | |

  Easy takes about a quarter longer than Medium (the same course, scrolled slower); Hard about a fifth less.
- **Stars:** 3 when every plant bloomed, 2 for two thirds or more, 1 for finishing. Never for speed.
- **Forgiving:**
  - No timers, no lives, nothing to fail. A bonk is a wobble, dizzy stars and a 1.5 s shield in which nothing else can bonk her, plus a small bump away from the enemy.
  - On Easy a bonk costs nothing. On Medium and Hard it takes one coin of the run's coins, never below 0 (the coin wobbles out of the row and drifts away).
  - A bud only needs her to pass within the dust radius, and the radius is measured from her middle.
  - The chest always opens: a missed key floats over to her.
  - A tap on Isabella at the chest is a twirl and a giggle.
- **Save:** `game.flight.save` = `{ v: 1, mode, unlocked: { easy, medium, hard }, stars: { easy: [20], medium: [20], hard: [20] }, coins, plants, chests, bonks }` through `IsabellaStore` (or `localStorage`). Coins go into the save the moment they are earned or lost; stars and the unlocked level are written the moment the chest opens. A course left half done is not resumed (it is a minute long). Sound follows `muted` in `isabella.save`, read only. `window.__back()` goes from a course to the level map, and from the map home; the home button goes home.
- **Code:** the rules, the level table, the course generator and the save are in `logic.js` (pure, run by Node). The drawing is in `art.js` through the shared `web/fairy/fairy.js` (Isabella, skies, clouds, trees, toadstools, flowers, critters, bugs, coins, key, chest); the forest is three cached strips and a ground tile that slide past, so a frame is cheap. Sound is in `sound.js` (copied from Sea Catch).
- **Proof** (`test/games/flight/`):
  - `verify.js` freezes the level table and all **60 courses** (20 levels × 3 modes) by sha1 (`fingerprints.json`; rewrite with `--write-fingerprints` only on purpose). A **sweep** over (time, height) at 60% of her vertical speed finds, in every course in every mode, a way that blooms every plant and takes the key without touching an enemy, so 3 stars are always reachable with care; the sweep is shown to bite (nothing passes without movement, an unreachable plant or a wall of enemies fails it). A **model child** who sees only 1.5 s ahead and reacts late (0.35 s) finishes every course, never bonks on Easy and gets 3 stars there; a very young child with no finger, or one resting at the top or the bottom, reaches every chest. **Difficulty** by a fixed cost function (enemies per second × their speed / the mean gap between them, plus the plants' demands at the mode's dust radius) rises 1→10 and 11→20, level 11 is above 10 and Easy < Medium < Hard on every level. It also checks the rules: bloom radius per mode, one coin per plant, bonks (shield, coin floor, none lost on Easy), stars, key and chest timing, the easing, the save.
  - `browser.js` (915×412 and 800×360, real CDP touch): both pages of the level map and the mode picker (each target ≥ 19vh, nothing overlapping), Easy level 1 flown to the chest with a real finger following the sweep's path, a bonk on Easy and Medium, the save, home, `window.__back`, `window.__pause`, mute, the Android store, held upright, every forest on screen.
  - `soak.js` (about 3 minutes of random play, then 50 trips through the map and 8 chests in a row) checks for errors, leaks and that the coin row always matches the coins won.
  - `defects.js` breaks copies of the game on purpose (30 rule defects, 21 browser defects, 1 leak: 52 in all) and shows each is caught.
  - `tune.js` picked the seeds in the level table: a seed is good when the sweep finds a way with room to spare in every mode and the model child never bonks on Easy.
- **Departures and choices:** Hard adds two critters on levels 1–2 (Medium has none there). Plants on a tree stand on the tree's crown. The chest and the key do not appear in the coin row's count (the row has one ring per plant).
- **Not yet watched:** no child has played it and the sound is unheard. The speeds, the dust radii and Hard's enemy counts are first guesses: watch a child play Easy 1 and Medium 3, and an 8-year-old play Hard in World 2.
