# The games

Nine ocean games share one app. Each is plain HTML5 canvas with no libraries; all the art and sound
are made in code. The title screen ("hub", `web/index.html`) shows three of them as picture buttons
(Bubble Party, Isabella, Coral Maze) and a "+" button that opens a second screen with the other six.
One list, `GAMES` in `web/hub.js`, decides which game sits where.

| Game | Folder | Ages | Levels | In the store app (Isabella Ocean) | Save key | Tests |
|---|---|---|---|---|---|---|
| Bubble Party | `web/games/pop/` | 3–5 | 10 | all free | `game.pop.save` | `test/games/pop/` |
| Isabella the Mermaid | `web/` (`core.js`, `render.js`, `audio.js`, `app.js`) | 5–8 | 20 | levels 1–10 free; 11–20 unlock (see PAYMENTS.md) | `isabella.save` | `test/verify.js` |
| Shell Match | `web/games/match/` | 5–8 | 6 | all free | `game.match.save` | `test/games/match/` |
| Coral Maze | `web/games/maze/` | 5–8+ | 20 Easy + 20 Hard | all free | `isabella.maze` | `test/games/maze/` |
| Sea Words | `web/games/words/` | 5–8 | endless (easy, medium, hard) | all free | `game.words.save` | `test/games/words/` |
| Treasure Blocks | `web/games/blocks/` | 5–8+ | endless (Easy, Medium, Hard) | all free | `game.blocks.save` | `test/games/blocks/` |
| Sea Jigsaw | `web/games/jigsaw/` | 3–8 | 30 (10 Easy, 10 Medium, 10 Hard) | all free | `game.jigsaw.save` | `test/games/jigsaw/` |
| Splash Dash | `web/games/dash/` | 5–8 | 20 | all free | `game.dash.save` | `test/games/dash/` |
| Sea Catch | `web/games/catch/` | 3–8 | 10 | all free | `game.catch.save` | `test/games/catch/` |

The last four were merged on 4 Oct 2026 (app version 2.4). Their ages are estimates: no child has
played any of the four yet, and nobody has listened to their sound.

In the family app everything is unlocked. Saves go through `window.IsabellaStore`, which is Android
SharedPreferences (file `isabella`), or `localStorage` in a browser. Sound on or off is one shared
setting, `muted` in `isabella.save`.

## Kid UX rules (every game)
- **Reading:** kids never need to read. Parent screens may use text.
- **Touch targets:** at least ~19vh, about 2 cm on the Seeker.
- **No dark patterns:** no timers, nagging or ads. Mistakes are gentle.
  - **The one exception:** Sea Jigsaw gives bonus coins for finishing sooner. The owner asked for this. It only ever adds coins; nothing is lost and no puzzle can be failed.
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

## Treasure Blocks (added 4 Oct 2026)
- **How it plays:**
  - Sea blocks sink into a well. Behind the well is a picture of Isabella, hidden by mist.
  - The child slides and turns each piece as it sinks. A row filled from wall to wall sparkles away, and everything above settles down.
  - Each row cleared pays a gold coin and clears a band of mist from the picture.
  - Each round has a row goal. Reaching it brings a key that opens the treasure chest. "Keep going" starts the next round in the same well.
- **Controls:**
  - four big buttons: left, right, turn and drop. A held left or right button keeps sliding;
  - or straight on the well: drag sideways to slide, tap to turn, pull down to drop.
  - An outline shows where the piece will land.
- **Modes:**

  | Mode | Well | Row goal | One cell takes | Pieces | When the blocks reach the top |
  |---|---|---|---|---|---|
  | Easy | 6×9 | 6 | 1.0 s | 4 shapes of 1–3 blocks | a wave washes the bottom 4 rows away and play goes on |
  | Medium | 7×11 | 8 | 0.7 s | 11 shapes of 1–4 blocks | the round ends, coins kept |
  | Hard | 8×13 | 10 | 0.6 s, quickening to 0.22 s | 13 shapes of 1–5 blocks | the round ends, coins kept |

- **Coins:** 1 for a row, 3 for two rows at once, 5 for three, 8 for four. They go into the save the moment they are earned, so leaving mid-round loses nothing.
- **Forgiving:**
  - Easy never ends.
  - A landed piece waits before it settles (0.9 s on Easy, 0.45 s on Hard), so a slow finger can still slide it.
  - Drop is ignored for a moment after a piece appears, so a double tap does not throw the next piece down.
- **Fresh every time:** each game is dealt from a new seed through a fair bag: every shape of the mode, shuffled, and never the same shape three times running.
- **Save:** `game.blocks.save` keeps the coins, rows cleared, games started, rounds finished per mode, the best game per mode and the last mode played. There are no levels to unlock.
- **Proof:**
  - `verify.js` checks the fourteen shapes, the walls and turns, the row clearing against a second model of the well, the coins, the bag and the save. Model players that only do what a finger can reach the row goal in every mode on every seed.
  - `browser.js` plays all three modes with real touches at both screen sizes.
  - `mutants.js` breaks copies of the game on purpose: 34 defects, all caught (run on the game's branch).
- **Not yet watched:** no child has played it and the sound is unheard. The sink speeds are a first guess.

## Sea Jigsaw (added 4 Oct 2026)
- **How it plays:**
  - 30 pictures, each cut into real jigsaw pieces with tabs. Pieces are never rotated.
  - Pieces wait in a tray on the right: 3 at a time on Easy, 8 on Medium and Hard. The rest come as places free up.
  - The child drags a piece out. Let go near its own place, it snaps home. Anywhere else on the board, it stays where it was put. Over the tray, it goes back.
  - The last piece home sends a golden key to the treasure chest, which bursts with coins.
- **Modes:**

  | Mode | Puzzles | Pieces | The empty board shows | Base coins | Each bonus coin | Hint after |
  |---|---|---|---|---|---|---|
  | Easy | 10 | 4–12 (2×2 to 4×3) | a faint ghost of the picture | 5 | 1 | 12 s |
  | Medium | 10 | 12–24 (4×3 to 6×4) | the piece outlines | 10 | 2 | 25 s |
  | Hard | 10 | 24–40 (6×4 to 8×5) | nothing | 15 | 3 | 45 s |

- **Unlocking:** each mode opens its puzzles one at a time. All three modes can be picked from the start.
- **Coins and the speed bonus:**
  - Finishing always gives the base coins.
  - Three bonus coins wait on screen and drift away one at a time as the puzzle goes on. The ones still there at the end are added.
  - The clock starts at the first touch. Bigger puzzles get longer: on the 4-piece Easy 1 the coins leave at 22, 34 and 50 s; on the 40-piece Hard 10 at 290, 450 and 650 s.
  - This is the owner's design and the stated exception to "never for speed" (see the kid UX rules).
- **Forgiving:**
  - No fail state, and no piece can be lost.
  - A generous magnetic snap, tighter on Hard.
  - On Easy and Medium a tap on a piece lights its place. A hand shows where a piece goes after a quiet spell.
  - A picture button shows the finished picture.
  - Hard deals the frame pieces first, then works inward, so a piece nearly always has a neighbour.
- **Save:** `game.jigsaw.save` keeps the coins, each mode's unlocked count and the most bonus coins kept per puzzle. A puzzle left half done is kept with its pieces and its clock.
- **Proof:**
  - `verify.js` checks the table (30 different pictures, piece counts rising, no piece under 19vh), that every cut tiles the picture exactly with one home per piece, the coin rules and the save. Fingerprints freeze the table, the cuts and the pictures.
  - `browser.js` solves puzzles piece by piece with real drags and checks all 30 on screen. `sheet.js` saves a contact sheet of the pictures.
  - `bite.js` breaks copies of the game on purpose: 25 defects, all caught (run on the game's branch).
- **Not yet watched:** no child has played it and the sound is unheard. The bonus times are a first guess.

## Splash Dash (added 4 Oct 2026)
- **How it plays:**
  - Isabella swims along the surface of the sea, away from the player, down a course to a finish line and a treasure chest.
  - She always swims forward. A speed button at the side makes her go faster while it is held, up to twice her slow speed.
  - Coins lie along a line that is always clear, so they show the safe way through.
  - Taken fast enough, a wave ramp throws her into the air, where more coins wait.
- **Steering:**
  - Tilt the phone like a steering wheel. About 20° of lean is full steer, with a small dead zone.
  - A finger held to her left or right also steers, and always works.
  - Tilt takes over only once real, changing sensor data arrives. It lets go if the phone lies on its side for more than about a second.
- **Courses:** 20, each a little longer than the last (about 70–92 s at slow speed, 35–47 s with the button held). Each new thing is the first thing met on its course:

  | Course | New |
  |---|---|
  | 1 | rocks |
  | 2 | wave ramps |
  | 3 | kelp, which slows her without a bump |
  | 4 | gates of two buoys |
  | 5 | driftwood logs |
  | 6 | lines of buoys with one way through |
  | 7 | boats at anchor |
  | 9 | a seagull on a raft |
  | 11 | drifting boats |
  | 13 | a slalom of buoys |
  | 14 | wave lines with a swaying gap |
  | 16 | two logs making an S-bend |
  | 17 | boats that drift across the lane |

  Later courses also have tighter gaps, a lane that wanders more and faster moving things.
- **Forgiving:**
  - A bump is a splash and a wobble. She drops to slow speed, may spill one coin, and swims on.
  - Nothing ends a course but the finish line. Steering straight ahead with eyes shut still reaches the chest.
- **Rewards:**
  - Stars count the coins kept, never time: 3 for 80% of the coins on the water, 2 for half, 1 for finishing. The coins in the air are extra.
  - The chest adds 10 coins.
  - Courses open one at a time. Holding the title for 4 seconds opens them all. This is a test shortcut.
- **Proof:**
  - `verify.js` freezes all 20 courses by fingerprint. For each it finds a clean line at slow speed and at full speed, whenever she arrives, and shows every coin is on such a line. A model child who sees only 2 s ahead and reacts late swims every course without a bump. It also checks the tilt maths against a separate model of the phone, both landscape ways round.
  - `browser.js` plays with real touches and real sensor events from Chrome.
  - `mutate.js` breaks copies of the game on purpose: 37 defects, all caught (run on the game's branch).
- **Checked on a real Seeker:** `devicemotion` fires inside the app's WebView at about 60 Hz with no permission call.
- **Not checked on a phone:** the steer direction. The code expects left side down to steer left. If a phone steers the wrong way, flip `TILT.SIGN` in `logic.js`.
- **Not yet watched:** no child has played it and the sound is unheard.

## Sea Catch (added 4 Oct 2026)
- **How it plays:**
  - Sea friends drift down in bubbles. Isabella swims left and right near the sand with a big shell on her head, easing toward the finger.
  - A friend that lands in the shell hops into the 1–10 tray. Every 10 make a gold coin.
  - A rare golden friend is a whole coin by itself.
  - When the level's coins are in, the treasure chest rises from the sand.
- **Grumpy things:**
  - From level 3: an urchin, then an old boot, an eel, a tin can and a shark.
  - One in the shell is a gentle bonk that costs a coin, never going below 0.
  - A grump only counts when it truly lands in the shell; friends have a much wider catch zone.
- **Forgiving:**
  - No timers and no lives. A missed friend costs nothing. A level cannot be failed.
  - After a bonk she is shielded for 1.5 s, the next 3 things are all friends, and grumps come less often from then on.
  - Two grumps close together always leave a gap to stand in, and a friend never arrives right beside a grump.
  - A hand shows the slide to a first-time player.
- **Stars:** 3 for no bonks, 2 for one or two, 1 for more. Never for speed.

| Level | Coins | Fall speed | Things at once | Grumpy share | New |
|---|---|---|---|---|---|
| 1 | 2 | 78 | 2 | 0 | |
| 2 | 3 | 86 | 2 | 0 | |
| 3 | 4 | 95 | 3 | 12% | urchin |
| 4 | 4 | 104 | 3 | 15% | boot |
| 5 | 5 | 114 | 3 | 18% | eel; things drift sideways |
| 6 | 5 | 124 | 4 | 20% | up to 2 grumps at once |
| 7 | 6 | 135 | 4 | 22% | tin can; things zig-zag |
| 8 | 7 | 146 | 4 | 25% | shark |
| 9 | 8 | 158 | 5 | 27% | |
| 10 | 10 | 170 | 5 | 30% | up to 3 grumps at once |

Speed is in world units per second on a 540-tall screen: about 5 s from the top to the shell at level 1, about 2.3 s at level 10.

- **Save:** `game.catch.save` keeps the unlocked level, the stars and the totals. A level left half done keeps its coins, tray and bonks.
- **Proof:**
  - `verify.js` freezes the level table by fingerprint and checks the spacing rules. A sweep finds a bonk-free path at a third of Isabella's speed, with every friend catchable on such a path. Model players through the real game step: a modest one wins every level with 3 stars, and a very young one who goes for everything still reaches every chest.
  - `browser.js` plays with real touch drags at both screen sizes.
  - `defects.js` breaks copies of the game on purpose: 34 defects, all caught (run on the game's branch).
- **Not yet watched:** no child has played it and the sound is unheard. Watch a child play level 1 and tune the pace.

## The hub (title screen)
- **Title screen, left to right:** Bubble Party, Isabella (the big Play button), Coral Maze, then "+".
- **More games ("+"):** Shell Match, Sea Words, Treasure Blocks, Sea Jigsaw, Splash Dash, Sea Catch, with a back button in the corner.
  - Buttons are pictures only, between 19vh and 30vh, in the fewest rows that give the biggest buttons.
  - On the Seeker that is one row for up to 4 games, two rows for up to 10 and three rows for up to 18.
- **One list drives both screens:** `GAMES` in `web/hub.js`, one line per game (`id`, `page`, `symbol`, `label`, `color`).
  - The first two lines sit on the title, one each side of Play. Every line after those sits behind "+".
  - Isabella is not in the list. Her Play button is written in `web/index.html` and is always the big one in the middle.
  - The icons are SVG `<symbol>`s in `web/index.html`.
  - `web/app.js` has one click handler for both screens; it opens the page of whichever game's button was pressed.
- **Two recipes** (also in the comment at the top of `web/hub.js`):
  - **Add a game:** put its `<symbol>` beside the others in `web/index.html`, then add one line to `GAMES`.
  - **Change which two games are on the title:** move lines; the top two are on the title. Then change `ON_TITLE` in `test/hub/hub.test.js` and the family baseline in `test/paywall/drive.js` to match. Both name the title's two games on purpose, so a slip is caught.
- **Coming back:** a game's home button loads `../../index.html`, which opens on the title, not on the more-games screen.
- **Back button:**
  - Android back calls `window.__back()`.
  - In a mini-game that returns to the hub.
  - On the more-games screen it returns to the title.
  - In Isabella it pauses or resumes a level, and steps back from other screens.
- **Inside the Android app, both flavors:** "Add to Home screen" shows on the title until the app is pinned.
- **Store app only:** the Grown-ups button opens the parent area.

## Adding a game (the contract the mini-games follow)
1. **Files:**
   - Everything goes in `web/games/<id>/` (an `index.html` plus its JS), with tests in `test/games/<id>/`.
   - No network, no external assets, no new npm dependencies.
2. **Navigation:** a home button goes to `../../index.html`. Also set `window.__back = () => { location.href = '../../index.html'; return true; }`.
3. **Saving:** save under its own key through `IsabellaStore`. Read sound on or off from `isabella.save` and change only that field.
4. **Tests:**
   - `verify.js` proves the levels (solvable, rising difficulty, fingerprints);
   - `browser.js` runs headless Chrome at 915×412 and 800×360 with real CDP touch input;
   - `soak.js` runs ~3 minutes of random play;
   - a defect-injection script breaks copies of the game on purpose and shows the tests catch each one.
   - Use your own DevTools port (TESTING.md).
5. **Wiring it in (coordinator):**
   - put the game's picture, a `<symbol id="i-...">`, beside the others in `web/index.html` (the four newest games each supply one as `hub-symbol.svg`);
   - add one line to `GAMES` in `web/hub.js`. A new line at the end goes behind "+";
   - run `node test/hub/hub.test.js`. It reads the list, so it needs no change unless the title's two games change.
