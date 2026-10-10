# Petal Patterns (Fairy world, `web/games/petals/`)

An educational pattern-and-sequence puzzle for ages 3-8: *what comes next?* One of the six Fairy games
(`docs/FAIRY.md` is the contract: menu with the mode picker, 20 levels on two pages, stars, the chest, the
save shape, the port). Save key `game.petals.save`, DevTools port 9495.

## How it plays
- **The meadow.** A row of flower pots stands on a shelf. Each pot holds a flower of a kind (daisy, tulip,
  bluebell, sunflower, rose, lily) in a colour (the seven rainbow colours), big or small. The row follows a pattern.
  The last pot is empty, with a soft glowing "?" bud over it.
- **The tray.** Below the row, 2, 3 or 4 plates each hold one choice flower. The child taps the one that comes next.
- **Right.** Isabella the Fairy flies that flower over with a sprinkle of dust and plants it. The whole row closes
  to buds and blooms again in a wave, left to right; butterflies come; a gold coin flies up to the corner.
- **Wrong.** The plate wobbles, the flower shakes its head (the petals droop and recover) and the plate fades to
  half for a moment. Nothing is lost and nothing is said. Tapping a plate that is still faded is not counted again.
- **Odd one out** (Hard 18-20 only). The tray is hidden: one pot in the row breaks the pattern and the child taps
  *that pot*. It is put right (the right flower goes in), then the row blooms.
- **Rounds.** A level is 5 rounds (6 on World 2). After the last one the treasure chest rises and bursts
  with coins, then the results card (stars, levels, replay, next).
- **Stars.** 3 for no wrong taps, 2 for one or two, 1 for finishing. Never for speed. **Coins:** 1 a round, 5 from
  the chest, in the save the moment they are earned.
- **Hints.** After a quiet spell (any tap starts it again) a hint hand hovers over the right flower (or the odd
  pot): **Easy 8 s, Medium 15 s, Hard 25 s.** Easy also lifts the pots of one repeating unit together, once, as a nudge.
- **Kid UX.** No word is needed anywhere a child plays (the "?" is the only glyph in a round; level numbers and the
  coin count are on the grown-ups' map). No timers shown. Touch targets are at least 19vh (plates, odd-round
  pots, level bubbles, mode buttons, arrows, results buttons). Landscape only, with the rotate overlay as Sea Catch.
  On a squarer screen (iPad) an odd-one-out row zig-zags so every pot stays a full 19vh target.

## Modes
| Mode | Choices | Periods shown before the "?" | Attributes varying | Hint | Odd one out | Staircase |
|---|---|---|---|---|---|---|
| Easy (one sparkle) | 2 | 2 (a unit of 3 shows 6) | exactly one per round | 8 s | no | from level 18 |
| Medium (two) | 3 | 2.5 (rounded up; a unit of 3 shows 8) | what the level says | 15 s | no | from level 16 |
| Hard (three) | 4 | 3 (at most 12 pots) | all the level allows, size from 13 | 25 s | levels 18-20 | from level 16 |

Rows always show at least two full periods before the "?" (every varying attribute fits its own cycle twice).
On a screen too narrow for a long row the pots and flowers shrink; they are not touch targets in a normal round.

## The pattern table
Families: `AB`, `ABB`, `AAB`, `ABC`, `AABB`, `ABAC`, `ABCD` (a repeating unit of 2-4 flowers), `GROW` (a staircase) and `ODD`
(one pot does not fit). Each varying attribute follows a cycle: `ABC` on colour means red, blue, green, red, blue, green...
A flower is a (colour, kind, size) triple. Attributes: colour (7), kind (6), size (small/big, Hard only).

| Level | What varies (Medium) | Families a round may use (Medium) | Colours / kinds drawn on | How near the wrong choices are |
|---|---|---|---|---|
| 1 | colour | AB | 4 / - | anything |
| 2 | colour | AB | 4 | the flower before the "?" is one of them |
| 3 | colour | AB, ABB, AAB | 4 | as 2 |
| 4 | kind | AB, ABB, AAB | 4 | + a flower that borrows from the row |
| 5 | kind | + ABC | 5 | as 4 |
| 6 | kind | same | 5 | + near misses |
| 7 | colour **and** kind together | AB, ABB, AAB, ABC | 5 / 5 | near misses (a colour from one flower, a kind from another) |
| 8 | colour and kind together | same | 6 / 5 | as 7 |
| 9 | colour and kind together | + AABB | 6 / 6 | as 7 |
| 10 | colour and kind together | same | 7 / 6 | more near misses |
| 11 | colour and kind together | ABB, AAB, ABC, AABB, **ABCD** | 7 / 6 | more near misses |
| 12 | colour and kind together | + **ABAC** | 7 / 6 | as 11 |
| 13 | colour and kind together (+ size on Hard) | same | 7 / 6 | every wrong choice a near miss |
| 14 | colour and kind **independently** (colour AB..ABC, kind AB/ABC/AABB) | per attribute | 7 / 6 | as 13 |
| 15 | independently (+ ABAC on kind; size AB on Hard) | per attribute | 7 / 6 | as 13 |
| 16 | independently; **staircase** rounds (A, AB, ABC, ...) from here (Medium/Hard) | per attribute + GROW | 7 / 6 | as 13 |
| 17 | independently; ABCD on both; size AB/ABB/AAB on Hard | per attribute + GROW | 7 / 6 | as 13 |
| 18 | independently; **odd one out** on Hard (2 of 6 rounds) | per attribute + GROW (+ ODD on Hard) | 7 / 6 | as 13 |
| 19 | as 18 (3 odd rounds on Hard) | wider lists | 7 / 6 | as 13 |
| 20 | as 19; size also AABB on Hard | all | 7 / 6 | as 13 |

Easy keeps one attribute per round, the families of the level (and of every level before it) up to a cost cap
(ABB/AAB from 3, ABC from 5, AABB from 9, ABCD from 11, ABAC from 12), 2 choices, and the staircase from 18.
Hard also meets the families of the next level on World 1, and the three attributes on World 2.
`logic.js` `RAW` is the table; `difficulty(level, mode)` turns it into one number the tests use.

- **Colour + kind together** (7-13): a flower is a colour-and-kind pair; A is a red daisy, B a blue tulip, and so on.
- **Independently** (14+): colour follows one family while kind follows another (colour `AB`, kind `ABC`).
- **Staircase:** the row is groups of 1, 2, 3 (4 on Hard) flowers, each group the start of the same run of
  different flowers: `A | A B | A B C | A B ?`. The pots stand on stone steps, each group a step higher with a gap
  between. The answer is always a flower already seen in the run (never a new one).
- **Odd one out:** AB rows of 8 pots, ABB/AAB/ABC rows of 9, so every slot is seen at least three times and
  the odd pot is clear. The odd flower differs in colour and/or kind from what belongs there.

## No ambiguity (the guard that matters most)
Every round has **exactly one right answer**.
1. The generator builds a round, then `analyse()` (the guard in `logic.js`) judges it: every periodic reading the
   shown row supports (each attribute alone, any period up to half the row) and the staircase reading must all
   predict the same next flower; exactly one choice is that flower; every wrong choice differs from it in colour or kind
   (never the same colour AND kind); no two choices share colour and kind; two full periods are shown. A round that
   fails is **re-rolled and counted**.
2. `test/games/petals/verify.js` does not trust that guard: it re-judges every round with a **separate brute-force
   solver** (units built by cycling the first p values of each attribute; staircases built from every ordering
   of the row's flowers; for odd-one-out every unit with exactly one exception, and "which pot, once replaced, makes the row
   perfectly periodic"). Fine-Wilf's theorem is why two full periods suffice: a row that repeats a unit of length P
   at least twice cannot also fit a different period of up to half its length with another next flower.
3. The colours are the seven rainbow colours; any two differ by an RGB distance of at least 55 (tested).

## Frozen rounds
Rounds come from a seed per level and mode (`seedFor(level, mode, variant)`), 60 sets in all, frozen by fingerprint in
`test/games/petals/fingerprints.json`. The first play of a level uses variant 0 (the frozen set); every replay uses the next
variant (a different set of rounds, still checked). The generator uses no `Math.random`.

## Drawing
- Isabella, skies, trees, grass, clouds, butterflies, coins, the chest and the hand come from `FairyArt`; the pots, shelf,
  stone steps, plates, the "?" bud and the particles are in `art.js`.
- **Coloured flowers.** `FairyArt.drawFlower` gives each kind one fixed colour, but a pattern needs every kind in every colour.
  `art.js` draws the flower through a thin wrapper that swaps that kind's own colours (the head and the darker shades made from
  it) for the colour asked for (a least-squares fit of each fill colour against the kind's bud and petal colours).
  If `FairyArt.drawFlower` ever takes the colour as an 8th argument, that is used instead. Each kind is also scaled to stand
  about 100 units tall, so a rose reads as big as a sunflower.
- The sunflower's outer ring stays gold; its inner ring carries the colour.
- No blur or shadow filters; DPR capped at 2.5 (`FairyArt.setupCanvas`); world 540 units tall.

## Save (`game.petals.save`)
`{ v: 1, mode, unlocked: { easy, medium, hard }, stars: { easy: [], medium: [], hard: [] }, coins, plays: {..}, chests, rounds }`
through `IsabellaStore` (or `localStorage`). `muted` is read from `isabella.save` and never written. Levels open one at a
time per mode; World 2 (level 11) opens when level 10 of that mode is finished. Holding the title for 4 seconds opens every
level of the current mode (a grown-ups' test shortcut, as in the other games).

## Proof
Results are from the building agent's branch, 10 Oct 2026 (not yet re-run on `main`).

| Command | Checks | Last result | Port |
|---|---|---|---|
| `node test/games/petals/verify.js` | the rules in Node: every frozen round and 2,000 random rounds per level and mode (120,000) and the replay variants judged by the separate solver; attributes allowed per level; the hint timers and the star rules; odd rounds have one odd pot; difficulty rises 1-10, 11-20, 11 > 10, Easy < Medium < Hard; saves; layout and 19vh touch targets; 60 fingerprints; the re-roll rate (`--quick` for 200 per level and mode) | 44/44 (13 s); re-rolls 0 of 121,320 rounds | - |
| `node test/games/petals/browser.js` | real CDP touch at 915x412 and 800x360 (and an iPad-shaped 1024x768): the mode picker, both pages, a full Easy level 1 to the chest, a wrong tap, the hint hand and the lifted unit, a Hard odd-one-out round, the save, home and `window.__back` | 108/108 | 9495 |
| `node test/games/petals/soak.js` | ~3 minutes of random taps across all modes: no errors, nothing piling up, coins exact, flat memory | pass (180 s, 76 right taps, all three modes, staircase and odd-one-out rounds) | 9495 |
| `node test/games/petals/defects.js` | breaks copies of the game on purpose; every defect must be caught (prints `N injected, N caught`; about 25 minutes) | 56 injected, 56 caught (30 rule, 25 browser, 1 leak) | 9495 |

## Not yet watched
No child has played it and the sound is unheard. The pace of the intro and the wave, the Easy hint wait and how
well a 3-year-old copes with 2-choice ABAC/ABCD rows (Easy 11+) are first guesses: watch a child play Easy 1, 7 and 11.
