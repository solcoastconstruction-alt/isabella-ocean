## Potion Colours (Isabella the Fairy, added 10 Oct 2026)
Folder `web/games/potions/`, save key `game.potions.save`, DevTools port 9496, tests in `test/games/potions/`.
Part of the Fairy world (`docs/FAIRY.md`): Easy, Medium and Hard, twenty levels on two pages, stars, the chest.

- **How it plays:**
  - A toadstool table in the forest with a round cauldron on it. Isabella the Fairy hovers beside it with her wand.
    A grey, closed flower stands on the other side; its thought bubble holds a big round swatch of the colour it wants.
  - Bottles of paint stand along the bottom, each one colour: red, yellow, blue; white and black join later.
  - The child **drags** a bottle over the cauldron (a big grab radius, a magnetic snap) or just **taps** it. It tips
    and pours, the cauldron fills a little and the liquid swirls. On the last bottle of the mix the colours blend.
  - **A match:** Isabella waves her wand, a drop of potion flies to the flower, the flower blooms in exactly that colour,
    butterflies come, a coin flies to the coin count.
  - **A wrong mix:** the cauldron burps a soft cloud of the wrong colour, the flower tilts its head, the cauldron
    empties with a gurgle and the bottles refill. Nothing is lost but a star.
  - **Undo:** a tap on the cauldron takes back the last pour (that bottle hops home) any time before the mix is finished.
    A bottle already in the cauldron shakes a little if tapped again.
  - **Rounds:** 5 a level in World 1, 6 in World 2. After the last round the treasure chest rises and bursts with coins.
  - **Stars:** 3 for no wrong mixes, 2 for one or two, 1 for finishing. Never for speed. Coins: 1 for each bloom
    (saved the moment it blooms) and the chest pays 5 (Easy), 8 (Medium) or 12 (Hard).
  - **Hints:** after a quiet spell (8 s Easy, 15 s Medium, 25 s Hard) a hand taps the first bottle still needed, or the
    cauldron if a wrong bottle is in it. The very first round ever shows it after 3.5 s. Easy levels 1-3 also show the needed
    colours as small dots in the thought bubble.
  - **Nothing to read:** no words on a child's screen, no timers, touch targets at least 19vh (bottles 23vh, cauldron
    34vh, flower and bubble about 26vh).
- **The mixing table** (the single source of truth, `TABLE` in `logic.js`). The order of the bottles never matters. The
  swatch in the bubble, the liquid in the cauldron, the drop and the bloom all use the same colour. Names are for this
  document only. `test/games/potions/verify.js` reads this table and compares it with the code.

| Bottles | Colour | Name |
|---|---|---|
| red | #e53935 | red |
| yellow | #ffd600 | yellow |
| blue | #1e6ff0 | blue |
| white | #ffffff | white |
| black | #2b2b33 | black |
| red + yellow | #ff8a00 | orange |
| yellow + blue | #2fb344 | green |
| red + blue | #8e3fd0 | purple |
| red + white | #ff9ec4 | pink |
| blue + white | #8fd3ff | light blue |
| yellow + white | #fff3a8 | pale yellow |
| red + black | #7a1630 | maroon |
| blue + black | #14246b | navy |
| yellow + black | #9a9a10 | olive |
| white + black | #9a9aa8 | grey |
| red + yellow + blue | #8b5a2b | brown |
| red + yellow + white | #ffb38a | peach |
| red + blue + white | #c9a6ff | lavender |
| yellow + blue + white | #a8f0c8 | mint |
| red + yellow + black | #c2410c | rust |
| red + blue + black | #6a2c8a | plum |
| yellow + blue + black | #1f7a3a | forest green |
| red + white + black | #b5656f | dusty rose |
| yellow + white + black | #c2b280 | khaki |
| blue + white + black | #5b73b0 | slate blue |

- **Every target has exactly one recipe.** In every round the flower's colour can be made by exactly one set of the
  bottles on the table. The dealer checks this and re-rolls; `verify.js` checks it again with a separate brute-force
  enumerator over all subsets of the bottles on the table, using the table above as read from this file. All 25 colours
  are at least 54 apart in RGB (checked at 50), so a swatch is never ambiguous.
- **Modes:**
  - **Easy:** fewer bottles on the table (3 or 4 in World 1; World 2 needs all five), two-bottle mixes only (levels 1-3 may
    ask for a single bottle, so the first rounds always succeed), the dots in the bubble on levels 1-3, a bigger snap (105
    units beyond the cauldron's edge), hint after 8 s.
  - **Medium:** as designed: snap 70, hint after 15 s, no dots.
  - **Hard:** every bottle of the level, three-bottle mixes, snap 49, hint after 25 s.
- **Levels:** World 1 (the Meadow, 1-10): 1-3 the three primaries and their mixes; 4-6 white joins (pinks and pastels);
  7-10 black joins on Medium and Hard (Easy keeps four bottles). World 2 (the Cloud Tops, 11-20): five bottles always;
  three-bottle mixes from 11 on Hard and 14 on Medium (they take the last rounds of a level); from 16 at least two bottles on
  the table are never needed (decoys); from 18 Hard asks two flowers in a row in the last rounds (the second appears after the
  first blooms, the cauldron is rinsed between, and both recipes together use at most three bottles). Each cell: bottles on
  the table; recipe sizes round by round (`3+2` = a flower asking a three-bottle mix, then a second one asking two bottles);
  how many different mixes the level may ask for.

| Level | Rounds | Easy | Medium | Hard |
|---|---|---|---|---|
| 1 | 5 | 3 bottles; 1 2 1 2 2; pool 2; dots | 3 bottles; 2 2 2 2 2; pool 2 | 3 bottles; 2 2 2 2 2; pool 2 |
| 2 | 5 | 3 bottles; 1 2 2 2 2; pool 3; dots | 3 bottles; 2 2 2 2 2; pool 3 | 3 bottles; 2 2 2 2 2; pool 3 |
| 3 | 5 | 3 bottles; 2 2 2 2 2; pool 3; dots | 3 bottles; 2 2 2 2 2; pool 3 | 3 bottles; 2 2 2 2 2; pool 3 |
| 4 | 5 | 4 bottles; 2 2 2 2 2; pool 3 | 4 bottles; 2 2 2 2 2; pool 4 | 4 bottles; 2 2 2 2 2; pool 4 |
| 5 | 5 | 4 bottles; 2 2 2 2 2; pool 4 | 4 bottles; 2 2 2 2 2; pool 6 | 4 bottles; 2 2 2 2 2; pool 6 |
| 6 | 5 | 4 bottles; 2 2 2 2 2; pool 6 | 4 bottles; 2 2 2 2 2; pool 6 | 4 bottles; 2 2 2 2 2; pool 6 |
| 7 | 5 | 4 bottles; 2 2 2 2 2; pool 6 | 5 bottles; 2 2 2 2 2; pool 6 | 5 bottles; 2 2 2 2 2; pool 6 |
| 8 | 5 | 4 bottles; 2 2 2 2 2; pool 6 | 5 bottles; 2 2 2 2 2; pool 9 | 5 bottles; 2 2 2 2 2; pool 9 |
| 9 | 5 | 4 bottles; 2 2 2 2 2; pool 6 | 5 bottles; 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 2; pool 10 |
| 10 | 5 | 4 bottles; 2 2 2 2 2; pool 6 | 5 bottles; 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 2; pool 10 |
| 11 | 6 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 2 3; pool 14 |
| 12 | 6 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 2 3; pool 14 |
| 13 | 6 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 3 3; pool 20 |
| 14 | 6 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 2 3; pool 14 | 5 bottles; 2 2 2 2 3 3; pool 20 |
| 15 | 6 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 2 3; pool 14 | 5 bottles; 2 2 2 3 3 3; pool 20 |
| 16 | 6 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 3 3; pool 20 | 5 bottles; 2 2 2 3 3 3; pool 20 |
| 17 | 6 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 3 3; pool 20 | 5 bottles; 2 2 3 3 3 3; pool 20 |
| 18 | 6 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 2 3 3; pool 20 | 5 bottles; 2 2 3 3 3+2 3+2; pool 20 |
| 19 | 6 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 3 3 3; pool 20 | 5 bottles; 2 3 3 3+2 3+2 3+2; pool 20 |
| 20 | 6 | 5 bottles; 2 2 2 2 2 2; pool 10 | 5 bottles; 2 2 2 3 3 3; pool 20 | 5 bottles; 2 3 3+2 3+2 3+2 3+2; pool 20 |

- **Departure from the brief, Easy in World 2:** the brief says Easy has 3-4 bottles and also that World 2 has five bottles
  always (Easy stays two-bottle with all five). The level rule wins: Easy World 2 has five bottles.
- **Rounds are frozen:** each round of each level and mode is dealt from a seed and frozen by fingerprint (60 of them, in
  `test/games/potions/fingerprints.json`), so a level cannot drift unnoticed.
- **Difficulty rises:** bottles, pours per round, mixes asked, decoys and flowers per round never fall from level 1 to 10 or
  from 11 to 20; level 11 is above level 10 and Easy < Medium < Hard on every level (`verify.js` computes one score from
  them). Within a world some levels share a setting (for example Medium 1-3 or Easy 6-10); the step comes at the bands.
- **Screen:** landscape only (a rotate overlay when upright), world 540 units tall, pixel ratio capped at 2.5. The level
  map has the three modes (a wand with one, two or three sparkles) along the top, ten levels a page, page arrows and dots
  along the bottom. Holding the title for 4 seconds opens every level of the mode shown (a grown-ups shortcut, as in the
  other games); on tablets the title is hidden to make room, so the shortcut needs a phone-shaped screen.
- **Save:** `game.potions.save` = `{ v: 1, mode, unlocked: { easy, medium, hard }, stars: { easy: [20], medium: [20], hard: [20] },
  coins, chests, blooms, wrongs }`, through `IsabellaStore` (or `localStorage`). Levels open one at a time per mode; World 2
  opens when level 10 of that mode is finished. Sound follows `muted` in `isabella.save` (read only, never written).
- **Code:** `logic.js` (the table, the dealer, `Run`, saving), `art.js` (the cauldron, bottles, flower, bubble and sparkles;
  Isabella, skies, trees, coins, butterflies and the chest come from `web/fairy/fairy.js`), `sound.js`, `game.js`,
  `index.html`, `hub-symbol.svg` (`#i-potions`).
- **Tests:** `node test/games/potions/verify.js` (rules, table, recipes, difficulty, fingerprints, saves),
  `browser.js` (real touch at 915x412 and 800x360), `soak.js` (about 3 minutes of random play), `defects.js` (breaks copies of
  the game on purpose).
- **Not yet watched:** no child has played it and the sound is unheard. The pour and mix timings are a first guess.
