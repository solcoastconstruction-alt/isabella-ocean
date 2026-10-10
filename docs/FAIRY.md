# The Fairy world (Isabella the Fairy)

Asked for on 10 Oct 2026 (the owner's child's request). A second world beside the ocean: the same Isabella, but
a fairy with rainbow wings, in an enchanted forest of clouds, waterfalls and rainbows. Six new
games, each with Easy, Medium and Hard modes and two worlds of levels (World 1: the Meadow,
World 2: the Cloud Tops), difficulty rising through both. Everything in this file is the contract
the game builders follow; `docs/GAMES.md` (kid UX rules, "Adding a game") still applies in full.

## The look
- **Isabella the Fairy** is the mermaid's twin: the same face, skin `#f7cdb0`, brown hair `#6b3a1f`
  with `#9a5f38` highlights, the same eyes, cheeks and smile. In place of the tail: legs with little
  pointed slippers, a short flared dress in the rainbow (`#ff4d6d #ff9f43 #ffd93d #5ad17a #4cc9f0
  #6c63ff #c86bfa`, the same RAINBOW as `web/render.js`), and two pairs of translucent wings tinted
  with the rainbow that beat while she flies. A small daisy in her hair where the starfish clip was.
  She carries a star-tipped wand that leaves fairy dust (small 4-point sparkles) behind it.
- **The forest:** soft greens and golds, big friendly trees, toadstools, bluebells and daisies,
  a waterfall glade, fluffy clouds you can stand on, and rainbows. Dawn pinks in the Meadow (World 1),
  blue sky, cloud tops and sunset gold in the Cloud Tops (World 2). Night scenes have fireflies.
  Nothing is dark or scary; grumpy bugs are cartoon-grumpy like the ocean's grumpy creatures.
- **Shared drawing code:** `web/fairy/fairy.js` (`window.FairyArt`). Every fairy game draws
  Isabella, the backdrops, clouds, rainbows, flowers, coins, keys and chests through it, so the six
  games look like one world. Game-specific things (a particular enemy, a slide track) are drawn in
  the game's own `art.js`. Sound helpers are copied per game, as the ocean games do.

## The games
| Game | Folder | What it is | Educational thread |
|---|---|---|---|
| Fairy Flight (flagship) | `web/games/flight/` | Fly from plant to plant, sprinkle dust, plants bloom; dodge ground enemies and sky bugs; a coin per plant | — |
| Rainbow Slide | `web/games/slide/` | Slide down a rainbow, steer left and right round clouds, follow the coins, collect the key, open the chest | — |
| Toadstool Hop | `web/games/hop/` | Hop across toadstools and lily pads over the waterfall, timing each hop | — |
| Firefly Numbers | `web/games/fireflies/` | Catch fireflies into a jar until the number on the jar is reached; Hard adds two numbers | counting, numerals 1–10, simple addition |
| Petal Patterns | `web/games/petals/` | A row of flowers follows a pattern; pick the flower that comes next | patterns and sequences |
| Potion Colours | `web/games/potions/` | Mix two colours to make the colour the flower asks for | colour mixing |

## The common frame (every fairy game)
1. **Menu screen:** the game's name (parents read it, kids do not need to), the home button top left,
   a **mode picker** of three picture buttons, left to right: one sparkle, two sparkles, three sparkles
   on a wand (Easy, Medium, Hard). The last mode played is remembered and shown pressed.
2. **Level map:** 20 levels, ten a page. Page 1 "World 1" (the Meadow), page 2 "World 2" (the Cloud
   Tops), with the same page arrows and dots as Isabella's own level map. Levels open one at a time
   **per mode**. World 2 opens when level 10 of that mode is finished. Up to 3 stars per level per
   mode, never for speed.
3. **Every level ends with the treasure chest** bursting with coins. Where a key fits the game (Slide,
   Hop, Flight) the key opens the chest. Coins go into the save the moment they are earned.
4. **Difficulty:** World 1 levels 1–10 climb gently; World 2 levels 11–20 start a step above World 1's
   end and climb again. Mode changes the pace, density and help (Easy: slower, bigger gaps, hints
   sooner, nothing can be failed; Hard: faster, tighter, hints later). Easy of any level stays finishable
   by a 3-year-old; Hard 20 should take a competent 8-year-old a few tries.
5. **Forgiving:** no timers shown, no lives lost in Easy; mistakes are a wobble or a bounce, never a
   buzzer; a hint hand appears after a quiet spell. Where a level can be failed (Medium/Hard of the
   action games) it restarts at a checkpoint, coins kept.
6. **Save:** `game.<id>.save` =
   `{ v: 1, mode: 'easy'|'medium'|'hard', unlocked: { easy: 1, medium: 1, hard: 1 }, stars: { easy: [], medium: [], hard: [] }, coins: 0, ... }`
   through `IsabellaStore` (or `localStorage`), plus whatever the game needs. Sound follows `muted` in
   `isabella.save`, read only.
7. **Screen:** landscape, world 540 units tall, DPR capped at 2.5, touch targets ≥ 19vh, squarer
   screens (iPad) get their own sizing where a height-sized layout would collide. No reading needed
   anywhere a child plays. No words about money, wallets or chains anywhere (`scripts/assemble-web.sh`
   fails the iOS build on them).
8. **Files and tests:** as `docs/GAMES.md` "Adding a game": `index.html`, `game.js`, `logic.js`
   (pure rules, runs in Node), `art.js`, `sound.js`, `hub-symbol.svg`; tests in `test/games/<id>/`:
   `verify.js` (levels proven and frozen by fingerprint, difficulty rising through 1–20 in every mode),
   `browser.js` (real touch at 915×412 and 800×360), `soak.js`, and a defect-injection script.
   Each game has its own DevTools port (below).

| Game | Save key | DevTools port |
|---|---|---|
| flight | `game.flight.save` | 9491 |
| slide | `game.slide.save` | 9492 |
| hop | `game.hop.save` | 9493 |
| fireflies | `game.fireflies.save` | 9494 |
| petals | `game.petals.save` | 9495 |
| potions | `game.potions.save` | 9496 |
| (fairy art sheet) | — | 9490 |

## The hub: two worlds on one title
A rainbow button in the bottom-right corner of the title flips the title between the two worlds.
- **Ocean (as today):** Bubble Party, Isabella's big Play, Coral Maze, "+", the sea backdrop.
- **Fairy:** the forest backdrop with Isabella the Fairy flying across, the logo "Isabella / the
  Fairy", Fairy Flight as the big centre button, Rainbow Slide and Toadstool Hop beside it, "+" with
  Firefly Numbers, Petal Patterns and Potion Colours behind it.
- One list still drives it: each line in `GAMES` (`web/hub.js`) gains `world: 'ocean' | 'fairy'`.
  In the fairy world the first fairy line is the big centre button, the next two sit beside it,
  the rest go behind "+". The chosen world is remembered (`hub.world`) and the app opens on it.
- The store app's grown-ups button, the sound button, Add to Home screen and the coin count stay
  where they are in both worlds. All fairy games are free in both flavors.

## Status
- 10 Oct 2026: designed; being built by agents in worktrees from this file.
- 10 Oct 2026: the hub is wired (`world` on every `GAMES` line, the corner world button, the fairy title and its meadow backdrop, the remembered world; `test/hub/hub.test.js` 521/521). Every hub symbol is the game's own `hub-symbol.svg`.
- 10 Oct 2026 (evening): all six games merged onto `main`, each built by a Sonnet agent in a worktree from this file. On `main`: Fairy Flight verify 69/69, browser 104/104; Rainbow Slide 1952/1952, 155/155; Toadstool Hop 32/32, 105/105; Firefly Numbers 61/61, 117/117; Petal Patterns 44/44, 108/108; Potion Colours 45/45, 129/129; hub 521/521; paywall 97/97; Isabella 20/20; `assemble-web.sh appstore` clean (93 files). Soak and defect-injection runs were on each game's branch. Each game's own doc is `docs/fairy/<id>.md`. No child has played any of them and no sound has been heard.
