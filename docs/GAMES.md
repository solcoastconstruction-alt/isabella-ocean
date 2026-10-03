# The games

Five ocean games share one app. Each is plain HTML5 canvas with no libraries; all the art and sound
are made in code. The title screen ("hub", `web/index.html`) shows them as five picture buttons.

| Game | Folder | Ages | Levels | In the store app (Isabella Ocean) | Save key | Tests |
|---|---|---|---|---|---|---|
| Bubble Party | `web/games/pop/` | 3–5 | 10 | all free | `game.pop.save` | `test/games/pop/` |
| Isabella the Mermaid | `web/` (`core.js`, `render.js`, `audio.js`, `app.js`) | 5–8 | 20 | levels 1–10 free; 11–20 unlock (see PAYMENTS.md) | `isabella.save` | `test/verify.js` |
| Shell Match | `web/games/match/` | 5–8 | 6 | all free | `game.match.save` | `test/games/match/` |
| Coral Maze | `web/games/maze/` | 5–8+ | 20 Easy + 20 Hard | all free | `isabella.maze` | `test/games/maze/` |
| Sea Words | `web/games/words/` | 5–8 | endless (easy, medium, hard) | all free | `game.words.save` | `test/games/words/` |

In the family app everything is unlocked. Saves go through `window.IsabellaStore`, which is Android
SharedPreferences (file `isabella`), or `localStorage` in a browser. Sound on or off is one shared
setting, `muted` in `isabella.save`.

## Kid UX rules (every game)
- **Reading:** kids never need to read. Parent screens may use text.
- **Touch targets:** at least ~19vh, about 2 cm on the Seeker.
- **No dark patterns:** no timers, nagging or ads. Mistakes are gentle.
- **Parent gate:** anything involving money, a wallet or a link sits behind it. Hold for 3 seconds, then solve a 2-digit multiplication.

## Isabella the Mermaid (the main game)
- **How it plays:**
  - Isabella swims through the sea following your finger, dodges creatures, finds the key, and opens a treasure chest full of coins.
  - She has 3 hearts, with checkpoints along the way.
- **Two worlds of 10 levels:**
  - World 2 adds sliding gates, spinning urchin wheels, slow winch anchors, fish schools, eel rows, jelly walls and long tunnels.
  - Beating level 20 earns her a crown.
- **Engine:**
  - Every obstacle is a pure function of the level's time `t`, so a checkpoint restart just sets `t` back.
  - The world is 540 units tall, and the device pixel ratio is capped at 2.5.
- **Frozen levels:** levels 1–10 are fingerprint-frozen (sha1 hashes in `test/verify.js`). They must never change.
- **World 2 layouts:** levels 11–20 come from seeds that `test/tune.js` chose so difficulty climbs.
- **Proof:** `test/verify.js` proves every level can be finished. It runs a sweep over (time, height) at 60% swim speed, plus an autopilot through the real `Game.step()`.
- **Ownership:** steering and feel are the owner's call. A steering change was reverted because the child preferred the original.

## Bubble Party (redesigned 3 Oct 2026 to the owner's design)
- **How it plays:**
  - Bubbles float up carrying sea creatures.
  - The child drags each bubble down onto the matching creature's icon on the sand, for example a turtle onto the turtle icon. That saves it.
- **Counting and coins:**
  - The 1–10 tray counts the creatures saved.
  - Every 10 saved make a gold coin.
  - When the level's coins are in, a treasure chest rises from the sand and bursts with coins.
- **Grumpy creatures:**
  - From level 3: a purple urchin, a sulky eel and a chubby shark, all cartoon-grumpy and never scary.
  - Dropping one on the sand costs a coin, never going below 0.
  - Left alone, they float away. Tapping one pops it harmlessly.
- **Forgiving:**
  - A wrong drop bounces back up.
  - Missed bubbles just float off, with no penalty.
  - A big grab radius and a magnetic snap near the right icon.
  - Level 1 shows a hand demonstrating the drag.
- **Stars:** 3 for no grumpy drops, 2 for one or two, 1 for more.

| Level | Coins (saves) | Icons | Speed | Bubbles at once | Grumpy share |
|---|---|---|---|---|---|
| 1 | 3 (30) | 2 | 32 | 3 | 0 |
| 2 | 3 (30) | 2 | 34 | 3 | 0 |
| 3 | 4 (40) | 3 | 36 | 3 | 12% (urchin) |
| 4 | 5 (50) | 3 | 38 | 4 | 15% |
| 5 | 5 (50) | 4 | 41 | 4 | 18% (+ eel) |
| 6 | 6 (60) | 4 | 44 | 4 | 20% |
| 7 | 7 (70) | 5 | 47 | 5 | 22% (+ shark) |
| 8 | 8 (80) | 5 | 50 | 5 | 25% |
| 9 | 9 (90) | 6 | 53 | 5 | 27% |
| 10 | 10 (100) | 7 | 56 | 6 | 30% |

Speed is in world units per second on a 540-tall screen: about 11 s to cross at level 1, about 6 s at level 10.

- **Code:** the rules and the old-save conversion live in `logic.js`, so Node can test them.
- **Old saves:** the converter keeps lifetime totals, and level progress starts at level 1. It was checked against a real old save.
- **Not yet watched:** nobody has played it on a real phone yet. Watch a child play level 1 and tune the pace.

## Shell Match
- Memory matching: open the shells, find the pairs.
- 6 levels, with up to 3 stars each (18 stars in all).
- Holding the title for 4 seconds opens every level. This is a test shortcut.

## Coral Maze (added 3 Oct 2026)
- **Goal:** help Isabella swim out of a coral maze to a treasure chest.
- **Controls:**
  - A swipe makes her glide to the next junction, Pac-Man style.
  - A sloppy diagonal takes the bigger direction, or the other one if the bigger is a wall.
  - A tap on a spot along her tunnel swims her straight there.
- **Mechanics by level:**
  - **1–3:** plain mazes.
  - **4–6:** keys and coral gates, matched by colour.
  - **7–10:** a patrolling jellyfish or pufferfish, plus checkpoint shells. A touch floats her back to her last shell. Keeping still is always safe.
  - **11–16:** one-way currents, two patrols, two keys.
  - **17–20:** dark water, where she lights only the tunnels near her.
- **Stars:** awarded for a short route, never for speed. A hint trail appears after 20 s without progress.
- **Proof:** `test/games/maze/verify.js` searches every state of every level, including keys, gates, the last shell and each patrol's phase. It proves each level escapable and free of dead ends, cross-checks par with a second search, and freezes the levels by fingerprint.
- **Hard mode** (added 3 Oct, after the 6-year-old finished all 20 Easy levels in minutes):
  - A fish/shark picker on the level select chooses Easy or Hard.
  - **20 Hard levels** on mazes 2–3 screens across (20×9 up to 29×13 cells). The view scrolls with Isabella, and tunnels stay a comfortable size.
  - **Harder to solve, not just longer:**
    - keys must be fetched in order, because each gate guards the pocket holding the next key;
    - the last gate sits near the exit, so the obvious route is locked;
    - one-way current rings and against-currents force planning;
    - patrols need timing;
    - dark water from Hard 14.
  - **Difficulty:** Hard 1 scores 88 against Easy 20's 60, rising to 284 at Hard 20.
  - **Play time:** a model player takes about 1.4 minutes on Hard 1 and about 7 on Hard 20. These are estimates; watch a real child.
  - **Hints** appear after 45 s in Hard.
  - **Save:** `isabella.maze` keeps Easy's `unlocked` and `stars` untouched and adds `hard` and `mode` beside them, so old saves need no conversion.

## Sea Words (added 3 Oct 2026)
- **How it plays:** a word search where every word comes with its picture. The child drags a line from a word's first letter to its last.
  - The line snaps to 8 directions and tolerates a wobble.
  - A correct find gets a tick and sparkle; a wrong line fades with no penalty.
- **Words (14):** SHELL, FISH, CRAB, STAR, TURTLE, WHALE, OCTOPUS, SEAHORSE, DOLPHIN, PEARL, CORAL, CHEST, COIN, KEY.
  - JELLYFISH and STARFISH are left out, because they contain FISH and STAR.
- **Modes:**

  | Mode | Words | Grid | Directions | Hint after |
  |---|---|---|---|---|
  | Easy | 1 picture and word | 5×5 (6×6 for TURTLE), big letters | across, down | 20 s |
  | Medium | 3–4 | 8×8 | forward, with diagonals | 40 s |
  | Hard | all 14 | 12×12 | all 8, including backwards | 40 s |

- **Fresh every time:** every puzzle is newly generated. Easy avoids its last 5 words.
- **Rewards:** Hard gives stars for finishing without hints, never for speed. Every finish ends with the treasure chest.
- **Rude-word guard:**
  - Filler letters are consonants only.
  - Every line, read both ways in all 8 directions, is checked against a 148-word blocklist (ROT13-encoded in `blocklist.js`). Any hit is re-rolled.
  - The test checks 13,000 puzzles with a separate scanner.

## The hub (title screen)
- **Buttons, left to right:** Bubble Party, Isabella (big Play button), Shell Match, Coral Maze, Sea Words. The row fits an 800×360 screen.
- **Wiring:**
  - each button has one line in `web/app.js`, e.g. `tap('mazeBtn', () => { persist(); location.href = 'games/maze/index.html'; })`;
  - the icons are SVG `<symbol>`s in `web/index.html`.
- **Back button:**
  - Android back calls `window.__back()`.
  - In a mini-game that returns to the hub.
  - In Isabella it pauses or resumes a level, and steps back from other screens.
- **Store app only:**
  - "Add to Home screen" shows on the title until the app is pinned.
  - The Grown-ups button opens the parent area.

## Adding a game (the contract the last three followed)
1. **Files:**
   - Everything goes in `web/games/<id>/` (an `index.html` plus its JS), with tests in `test/games/<id>/`.
   - No network, no external assets, no new npm dependencies.
2. **Navigation:** a home button goes to `../../index.html`. Also set `window.__back = () => { location.href = '../../index.html'; return true; }`.
3. **Saving:** save under its own key through `IsabellaStore`. Read sound on or off from `isabella.save` and change only that field.
4. **Tests:**
   - `verify.js` proves the levels (solvable, rising difficulty, fingerprints);
   - `browser.js` runs headless Chrome at 915×412 and 800×360 with real CDP touch input;
   - `soak.js` runs ~3 minutes of random play.
   - Use your own DevTools port (TESTING.md).
5. **Wiring it in (coordinator):**
   - add the hub button and symbol;
   - add the `tap(...)` line in `app.js`;
   - extend `test/hub/hub.test.js`;
   - update the family baseline's expected title buttons in `test/paywall/drive.js`.
