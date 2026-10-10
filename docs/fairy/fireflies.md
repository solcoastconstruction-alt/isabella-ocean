## Firefly Numbers (added 10 Oct 2026)
Part of the Fairy world (`docs/FAIRY.md`, which holds the common frame this game follows). Folder `web/games/fireflies/`,
save key `game.fireflies.save`, tests in `test/games/fireflies/`, DevTools port 9494. It is an educational counting game,
gently: the numerals 1 to 10 with dots to count, then simple adding, then (on Hard) taking away.

- **How it plays:**
  - A moonlit glade. 8 to 14 fireflies drift slowly about in soft curves. Isabella the Fairy hovers at the left holding a big glass jar.
  - The jar's label shows the **target** as a big numeral AND the same number of dots in a row of empty circles, so a child who cannot read numerals yet can count the dots.
  - Tap a firefly: it flies into the jar with a chime, one dot on the label lights, and a big numeral inside the jar counts up (1, 2, 3 ...) with a "pop" note that rises in pitch.
  - When the jar holds its number it glows, the cork drops in, the flower beside the jar blooms, a gold coin flies to the coin row, and a fresh jar with a new number arrives. The finished flower joins the garden along the grass.
  - Each level is a set of jars. When all are full the treasure chest rises and bursts with coins.
- **Adding (Medium World 2 and Hard):** the label shows the groups, for example "3 + 2": numerals with a plus sign, and under them a row of 3 dots, a plus, a row of 2 dots. The jar fills to 5. A sum of three groups ("2 + 3 + 4") has two plus signs. Each group has its own colour, numeral and dots alike.
- **Taking away (Hard from level 16):** the jar starts with fireflies already in it. The label shows "7 - 3" with 7 dots, the last 3 crossed out. The child **taps the jar** to let one firefly out at a time, and each tap dims one crossed dot, until the 4 that remain stand for the answer.
  - A tap on a firefly outside the jar in that round does nothing but a gentle shake.
  - The jar never goes below one: a take-away always leaves at least one in, and from a jar of five or more, at least two go and two stay.
- **Overfill:** one tap too many (a tap on a firefly after the jar is full, while it celebrates) makes the jar hiccup. That firefly flutters back out with a comic wobble and rejoins the others. Nothing else happens; it only costs a star. This teaches stopping at the number. In a take-away, one tap too many on the jar is the same hiccup.
- **Stars:** 3 for no overfills, 2 for one or two, 1 for finishing. Never for speed. Coins: 1 for each full jar, +5 from the chest, saved the moment they are earned.
- **Hint hand:** shows the first tap on a level the child has not yet won, and after a quiet spell taps a firefly (the jar, in a take-away). Quiet spell: 7 s on Easy, 10 s on Medium, 14 s on Hard.
- **Menu:** the game's name, a mode picker of three picture buttons (a wand with one, two or three sparkles), ten levels a page on two pages (World 1, World 2) with arrows and page dots. Levels open one at a time per mode; World 2 opens when level 10 of that mode is done.
- **Kid UX:** no reading anywhere in play (numerals and dots are the point), no timers, no words. A firefly's tap zone is a circle 104 world units across (19.3vh), drawn as a soft glow ring around it, even though the firefly itself is small. The jar is a tap target of 36vh.
- **Backdrops (FairyArt themes):** World 1 uses the bluebell wood (1), the waterfall glade (2) and moonlit night (6); World 2 uses blue sky (4), sunset gold (5), moonlit night (6) and the rainbow sky (7). Daytime skies get a dusk tint so the glowing fireflies show.

### Levels
Every level is a fixed list of jars (rounds), made from a seed by `roundsOf(mode, level)` in `logic.js` and frozen by fingerprint: 60 fingerprints, one per mode and level, in `test/games/fireflies/fingerprints.json`. One jar in every level always reaches the level's biggest number, and the same jar never comes twice running.

- **Fireflies at once:** never fewer than 8 or more than 14, always more than any jar needs. A caught firefly is replaced after 0.9 s.
- **Drift** is in world units a second on a 540-tall screen: 22 (about 12 s to cross) at Easy 1, up to 78 (about 7 s) at Hard 20.
- **Closest pass** is the least distance between two fireflies' centres. It is never under 104, which is twice the tap zone's radius, so two zones never overlap and a tap always means exactly one firefly. Easy keeps wide berths (146 down to 122); Hard passes tight (120 down to 104).
- **Jar kinds:** number (just count), a + b, a + b + c, a - b (take-away). "Numbers on a jar" is the smallest and biggest number a jar can hold (for a take-away, the number it starts with).

**Easy**

| Level | Backdrop | Jars | Jar kinds | Numbers on a jar | Fireflies | Drift | Closest pass |
|---|---|---|---|---|---|---|---|
| 1 | bluebell wood | 3 | 3 number | 1-3 | 8 | 22 | 146 |
| 2 | bluebell wood | 3 | 3 number | 1-3 | 8 | 23.5 | 145 |
| 3 | bluebell wood | 3 | 3 number | 1-4 | 8 | 25 | 143 |
| 4 | waterfall glade | 4 | 4 number | 1-4 | 8 | 26.5 | 142 |
| 5 | waterfall glade | 4 | 4 number | 1-5 | 8 | 28 | 141 |
| 6 | waterfall glade | 4 | 4 number | 1-5 | 8 | 29.5 | 140 |
| 7 | moonlit night | 4 | 4 number | 1-5 | 8 | 31 | 138 |
| 8 | moonlit night | 5 | 5 number | 1-6 | 8 | 32.5 | 137 |
| 9 | moonlit night | 5 | 5 number | 1-6 | 8 | 34 | 136 |
| 10 | moonlit night | 5 | 5 number | 1-6 | 8 | 35.5 | 135 |
| 11 | blue sky | 5 | 5 number | 1-7 | 9 | 37 | 133 |
| 12 | blue sky | 5 | 5 number | 1-7 | 9 | 38.5 | 132 |
| 13 | sunset gold | 5 | 5 number | 1-8 | 10 | 40 | 131 |
| 14 | sunset gold | 5 | 5 number | 1-8 | 10 | 41.5 | 130 |
| 15 | sunset gold | 6 | 6 number | 1-8 | 10 | 43 | 128 |
| 16 | moonlit night | 6 | 6 number | 1-9 | 11 | 44.5 | 127 |
| 17 | moonlit night | 6 | 6 number | 1-9 | 11 | 46 | 126 |
| 18 | moonlit night | 6 | 6 number | 1-10 | 12 | 47.5 | 125 |
| 19 | rainbow sky | 6 | 6 number | 1-10 | 12 | 49 | 123 |
| 20 | rainbow sky | 6 | 6 number | 1-10 | 12 | 50.5 | 122 |

**Medium**

| Level | Backdrop | Jars | Jar kinds | Numbers on a jar | Fireflies | Drift | Closest pass |
|---|---|---|---|---|---|---|---|
| 1 | bluebell wood | 4 | 4 number | 1-5 | 9 | 28 | 134 |
| 2 | bluebell wood | 4 | 4 number | 1-5 | 9 | 29.9 | 133 |
| 3 | bluebell wood | 4 | 4 number | 1-6 | 9 | 31.8 | 131 |
| 4 | waterfall glade | 5 | 5 number | 1-6 | 9 | 33.7 | 130 |
| 5 | waterfall glade | 5 | 5 number | 1-7 | 9 | 35.6 | 129 |
| 6 | waterfall glade | 5 | 5 number | 1-7 | 9 | 37.5 | 128 |
| 7 | moonlit night | 5 | 5 number | 1-8 | 10 | 39.4 | 126 |
| 8 | moonlit night | 6 | 6 number | 1-9 | 11 | 41.3 | 125 |
| 9 | moonlit night | 6 | 6 number | 1-9 | 11 | 43.2 | 124 |
| 10 | moonlit night | 6 | 6 number | 1-10 | 12 | 45.1 | 123 |
| 11 | blue sky | 6 | 1 number, 5 a + b | 3-10 | 13 | 47 | 121 |
| 12 | blue sky | 6 | 6 a + b | 3-10 | 13 | 48.9 | 120 |
| 13 | sunset gold | 6 | 6 a + b | 4-10 | 13 | 50.8 | 119 |
| 14 | sunset gold | 6 | 6 a + b | 4-10 | 13 | 52.7 | 118 |
| 15 | sunset gold | 6 | 6 a + b | 5-10 | 13 | 54.6 | 116 |
| 16 | moonlit night | 7 | 5 a + b, 2 a + b + c | 5-10 | 13 | 56.5 | 115 |
| 17 | moonlit night | 7 | 4 a + b, 3 a + b + c | 5-10 | 13 | 58.4 | 114 |
| 18 | moonlit night | 7 | 4 a + b, 3 a + b + c | 5-10 | 13 | 60.3 | 113 |
| 19 | rainbow sky | 7 | 3 a + b, 4 a + b + c | 6-10 | 13 | 62.2 | 111 |
| 20 | rainbow sky | 7 | 3 a + b, 4 a + b + c | 6-10 | 13 | 64.1 | 110 |

**Hard**

| Level | Backdrop | Jars | Jar kinds | Numbers on a jar | Fireflies | Drift | Closest pass |
|---|---|---|---|---|---|---|---|
| 1 | bluebell wood | 5 | 5 number | 2-6 | 10 | 36 | 120 |
| 2 | bluebell wood | 5 | 5 number | 2-7 | 10 | 38.2 | 119 |
| 3 | bluebell wood | 5 | 5 number | 2-8 | 11 | 40.4 | 118 |
| 4 | waterfall glade | 6 | 6 number | 2-9 | 12 | 42.6 | 117 |
| 5 | waterfall glade | 6 | 6 number | 2-10 | 13 | 44.8 | 117 |
| 6 | waterfall glade | 6 | 1 number, 5 a + b | 3-10 | 13 | 47 | 116 |
| 7 | moonlit night | 6 | 6 a + b | 4-10 | 13 | 49.2 | 115 |
| 8 | moonlit night | 7 | 7 a + b | 4-10 | 13 | 51.4 | 114 |
| 9 | moonlit night | 7 | 7 a + b | 5-10 | 13 | 53.6 | 113 |
| 10 | moonlit night | 7 | 7 a + b | 5-10 | 13 | 55.8 | 112 |
| 11 | blue sky | 7 | 7 a + b | 6-10 | 14 | 58 | 112 |
| 12 | blue sky | 7 | 7 a + b | 6-10 | 14 | 60.2 | 111 |
| 13 | sunset gold | 7 | 6 a + b, 1 a + b + c | 6-10 | 14 | 62.4 | 110 |
| 14 | sunset gold | 7 | 5 a + b, 2 a + b + c | 6-10 | 14 | 64.6 | 109 |
| 15 | sunset gold | 7 | 4 a + b, 3 a + b + c | 6-10 | 14 | 66.8 | 108 |
| 16 | moonlit night | 7 | 4 a + b, 2 a + b + c, 1 a - b | 6-10 (take-aways start here) | 14 | 69 | 107 |
| 17 | moonlit night | 7 | 3 a + b, 2 a + b + c, 2 a - b | 7-10 (take-aways start here) | 14 | 71.2 | 107 |
| 18 | moonlit night | 8 | 3 a + b, 3 a + b + c, 2 a - b | 7-10 (take-aways start here) | 14 | 73.4 | 106 |
| 19 | rainbow sky | 8 | 3 a - b, 3 a + b, 2 a + b + c | 7-10 (take-aways start here) | 14 | 75.6 | 105 |
| 20 | rainbow sky | 8 | 3 a + b + c, 3 a - b, 2 a + b | 7-10 (take-aways start here) | 14 | 77.8 | 104 |

### Code and files
- `index.html`, `game.js` (screens, touch, saving, the loop), `logic.js` (rules, levels, label model, the swarm, the save; runs in Node), `art.js`, `sound.js`, `hub-symbol.svg` (`<symbol id="i-fireflies">`).
- All the art that is shared (Isabella, the sky, trees, flowers, fireflies, coins, the hand, the chest) comes from `web/fairy/fairy.js`; the page loads it as `../../fairy/fairy.js`. The jar, the label, the coin row and the number pops are drawn in `art.js`.
- **The swarm** (`Swarm` in `logic.js`) is pure: each firefly flies a sine-wobbled curve, turns away from walls and from neighbours that are closing in, and a hard pass at the end of every step pushes any pair closer than the level's limit apart again. So the spacing rule always holds.
- **Squarer screens (iPad):** the fireflies' field is narrower, so fewer fireflies fit and the closest pass is brought down to 104 if needed; the spacing rule is never broken. The menu puts the name on its own line, the modes under it and the page arrows below the levels, every button still at least 19vh.
- **Debug hooks:** `window.__dbg` (`state()`, `start(mode, level, round)`, `unlock(mode, n)`, `tapFly(id)`, `tapJar()`, `goMenu()`, `timeScale(k)`). `?mode=hard&level=4` opens a level that is already unlocked. Holding the title for 4 seconds opens every level in every mode (a test shortcut).
- **Wiring into the hub (coordinator):** paste `hub-symbol.svg`'s `<symbol>` into `web/index.html`'s defs and add one line to `GAMES` in `web/hub.js` with `world: 'fairy'` (FAIRY.md). Nothing in this game touches those files.

### Proof
- `node test/games/fireflies/verify.js` (about 10 s): 61/61 checks: every round of all 60 levels (kinds, ranges, sums and take-aways that add up, never below 1), the label model against exact expected rows, the jar rules with model players on every level, 2,000 simulated seconds of drift on 18 levels plus squarer screens (the spacing rule never broken), difficulty rising in both worlds and Easy < Medium < Hard, 60 frozen fingerprints (10 Oct 2026).
- `node test/games/fireflies/browser.js` (about 3 minutes): 117/117 at 915x412 (Seeker), 800x360 and a 1024x768 iPad (menu, mode picker, both pages, Easy 1 through the chest, an overfill hiccup, the hint hand, a Hard sum and a sum of three, a take-away, all 60 levels opened, the save, mute, reload, upright, home and `window.__back`), 10 Oct 2026.
- `node test/games/fireflies/soak.js` (3 minutes): SOAK PASS (about 3.5 minutes of random touch across all three modes: no errors, nothing piling up, the spacing rule never broken in the real game, coins always matching, flat memory, 60 fps).
- `node test/games/fireflies/defects.js` breaks copies of the game on purpose: 51 injected, 51 caught (32 rule breaks for verify.js: counting that skips, an overfill accepted, wrong sums and signs, dots that do not match the numeral, a take-away going below its answer, fireflies overlapping, modes that do not scale, levels that drift, a bad save; 18 breaks for browser.js; 1 memory leak for soak.js). About 50 minutes.
- **Not yet watched:** no child has played it, the sound is unheard, and nothing has run on a real phone. The drift speeds, the hint delays and how long the jar celebrates before the next jar (1.75 s, during which a tap is an overfill) are first guesses: watch a child play Easy 1 and tune them.
