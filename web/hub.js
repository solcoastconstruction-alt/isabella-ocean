/* Isabella Ocean — the hub: which games the title screen and the "+" (more games) screen show.
 *
 * THE GAME LIST is the one place a game is wired in. One line per game, and every line says which
 * WORLD it belongs to: 'ocean' or 'fairy'. The title shows one world at a time (the round rainbow
 * button in its corner flips it, and the choice is remembered), and the order of a world's lines is
 * the order on screen:
 *   - OCEAN: the first two ocean lines sit on the title, one each side of Isabella's big Play button;
 *     every ocean line after those sits behind the "+" button, on the more-games screen.
 *     Isabella herself is not a line: her Play button (#playBtn in index.html) is the big one in the
 *     middle.
 *   - FAIRY: the first fairy line IS the big button in the middle (it takes Play's place, same size
 *     and position); the next two sit beside it (the second on its left, the third on its right);
 *     every fairy line after those sits behind the "+" button.
 *
 * To add a game:
 *   1. put its picture, a <symbol id="i-...">, beside the others in index.html;
 *   2. add one line to GAMES below, with its world. A new line at the end of its world's lines goes
 *      behind that world's "+".
 * To change which games are on the title: move lines within a world. The top two ocean lines and the
 *   top three fairy lines are on the title.
 *   (Tests name the title's games on purpose, so a slip is caught: ON_TITLE in test/hub/hub.test.js,
 *   the ocean pair and the fairy triple, and the family baseline in test/paywall/drive.js. Change
 *   them to match.)
 *
 * A line:
 *   id      unique; also names the button, #<id>Btn
 *   page    the game's page, relative to index.html
 *   symbol  the id of its <symbol>
 *   label   for screen readers only (kids never need to read)
 *   color   optional button colour: blue, teal, pink, purple, green, coral or indigo
 *   world   'ocean' or 'fairy' (a line without one is an ocean line)
 */
(function () {
  'use strict';
  const GAMES = [
    { id: 'pop',   page: 'games/pop/index.html',   symbol: 'i-bubble', label: 'Bubble Party', color: 'blue', world: 'ocean' },
    { id: 'maze',  page: 'games/maze/index.html',  symbol: 'i-maze',   label: 'Coral Maze',   color: 'teal', world: 'ocean' },
    { id: 'match', page: 'games/match/index.html', symbol: 'i-shell',  label: 'Shell Match',  color: 'pink', world: 'ocean' },
    { id: 'words', page: 'games/words/index.html', symbol: 'i-words',  label: 'Sea Words',    color: 'purple', world: 'ocean' },
    { id: 'blocks', page: 'games/blocks/index.html', symbol: 'i-blocks', label: 'Treasure Blocks', color: 'coral', world: 'ocean' },
    { id: 'jigsaw', page: 'games/jigsaw/index.html', symbol: 'i-jigsaw', label: 'Sea Jigsaw', color: 'green', world: 'ocean' },
    { id: 'dash', page: 'games/dash/index.html', symbol: 'i-dash', label: 'Splash Dash', color: 'indigo', world: 'ocean' },
    { id: 'catch', page: 'games/catch/index.html', symbol: 'i-catch', label: 'Sea Catch', color: 'teal', world: 'ocean' },
    { id: 'flight', page: 'games/flight/index.html', symbol: 'i-flight', label: 'Fairy Flight', color: 'green', world: 'fairy' },
    { id: 'slide', page: 'games/slide/index.html', symbol: 'i-slide', label: 'Rainbow Slide', color: 'pink', world: 'fairy' },
    { id: 'hop', page: 'games/hop/index.html', symbol: 'i-hop', label: 'Toadstool Hop', color: 'teal', world: 'fairy' },
    { id: 'fireflies', page: 'games/fireflies/index.html', symbol: 'i-fireflies', label: 'Firefly Numbers', color: 'indigo', world: 'fairy' },
    { id: 'petals', page: 'games/petals/index.html', symbol: 'i-petals', label: 'Petal Patterns', color: 'green', world: 'fairy' },
    { id: 'potions', page: 'games/potions/index.html', symbol: 'i-potions', label: 'Potion Colours', color: 'purple', world: 'fairy' },
  ];

  // Games on the title in each world; the rest of that world's lines go behind "+".
  // (Ocean: one each side of Play. Fairy: the big middle button and one each side of it.)
  const ON_TITLE = { ocean: 2, fairy: 3 };
  const WORLDS = ['ocean', 'fairy'];
  const COLORS = ['blue', 'teal', 'pink', 'purple', 'green', 'coral', 'indigo'];
  const SVG = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);

  // ---- which world the title is showing; remembered like app.js remembers Isabella's save ----
  const KEY = 'hub.world';
  const store = {
    get(k) {
      try { if (window.IsabellaStore) return window.IsabellaStore.get(k); } catch (e) { /* fall through */ }
      try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    set(k, v) {
      try { if (window.IsabellaStore) { window.IsabellaStore.set(k, v); return; } } catch (e) { /* fall through */ }
      try { localStorage.setItem(k, v); } catch (e) { /* nothing to do */ }
    },
  };
  let world = 'ocean';
  try { const w = store.get(KEY); if (WORLDS.includes(w)) world = w; } catch (e) { /* the ocean */ }
  const worldOf = (g) => (g.world === 'fairy' ? 'fairy' : 'ocean');
  const lines = (w) => GAMES.filter((g) => worldOf(g) === (w || world));

  function button(g, i, big) {
    const b = document.createElement('button');
    b.id = `${g.id}Btn`;
    b.className = `btn game${big ? ' big' : ''} ${COLORS.includes(g.color) ? g.color : COLORS[i % COLORS.length]}`;
    b.dataset.game = g.id;
    b.setAttribute('aria-label', g.label);
    const svg = document.createElementNS(SVG, 'svg'), use = document.createElementNS(SVG, 'use');
    svg.setAttribute('viewBox', '0 0 24 24');
    use.setAttribute('href', `#${g.symbol}`);
    svg.appendChild(use);
    b.appendChild(svg);
    return b;
  }

  // Draw both screens from GAMES, for the current world. Safe to call again after the list changes.
  function build() {
    const row = $('games'), play = $('playBtn'), grid = $('moreGrid');
    const mine = lines(), onTitle = ON_TITLE[world];
    for (const old of document.querySelectorAll('[data-game]')) old.remove();
    // Ocean: [line 0] [Play] [line 1] [+].  Fairy: [line 1] [line 0, big] [line 2] [+], with Play out of the way.
    play.hidden = world === 'fairy';
    mine.forEach((g, i) => {
      if (world === 'fairy') {
        if (i === 0) row.insertBefore(button(g, i, true), play);
        else if (i === 1) row.insertBefore(button(g, i), row.querySelector('[data-game]'));
        else if (i < onTitle) row.insertBefore(button(g, i), $('moreBtn'));
        else grid.appendChild(button(g, i));
      } else if (i === 0) row.insertBefore(button(g, i), play);
      else if (i < onTitle) row.insertBefore(button(g, i), $('moreBtn'));
      else grid.appendChild(button(g, i));
    });
    $('moreBtn').hidden = mine.length <= onTitle;   // nothing behind it: no "+"
    // The corner button always shows where it takes you: the rainbow in the ocean, a wave in the fairy world.
    const wb = $('worldBtn');
    if (wb) {
      wb.setAttribute('aria-label', world === 'fairy' ? 'Ocean world' : 'Fairy world');
      wb.querySelector('use').setAttribute('href', world === 'fairy' ? '#i-wave' : '#i-rainbow');
    }
    layout();
  }

  // The more-games screen: the fewest rows that give the biggest buttons, between 19vh (the
  // smallest a child's finger gets) and 30vh, clear of the back button in the corner. On the
  // Seeker's 20:9 that is one row up to 4 games, two rows up to 10, three rows up to 18.
  const MIN = 19, MAX = 30, GAP = 5;
  function layout() {
    const grid = $('moreGrid'), n = grid.children.length;
    if (!n || !innerHeight) return;
    const vw = innerWidth / innerHeight;                  // 1vw, in vh
    const w = 100 * vw - 2 * (5 * vw + 20 + 4), h = 84;   // room, in vh: both corners kept free
    let best = { size: 0, cols: n };
    for (let rows = 1; rows <= n; rows++) {
      const cols = Math.ceil(n / rows);
      const size = Math.min(MAX, (w - (cols - 1) * GAP) / cols, (h - (rows - 1) * GAP) / rows);
      if (size > best.size + 0.01) best = { size, cols };
    }
    const size = Math.max(MIN, Math.floor(best.size * 10) / 10);
    grid.style.setProperty('--size', `${size}vh`);
    grid.style.width = `${best.cols * size + (best.cols - 1) * GAP}vh`;
  }

  // The game whose button was pressed (or null): app.js decides what a press does.
  function gameOf(el) {
    const b = el && el.closest ? el.closest('[data-game]') : null;
    return (b && GAMES.find((g) => g.id === b.dataset.game)) || null;
  }

  function getWorld() { return world; }
  // Flip the title to a world: both screens are drawn again, and the choice is remembered.
  function setWorld(w) {
    if (!WORLDS.includes(w)) return world;
    world = w;
    store.set(KEY, w);
    document.body.classList.toggle('fairy', w === 'fairy');
    build();
    return world;
  }

  window.IsabellaHub = { GAMES, ON_TITLE, WORLDS, build, layout, gameOf, getWorld, setWorld };
  document.body.classList.toggle('fairy', world === 'fairy');
  build();
  window.addEventListener('resize', layout);
})();
