/* Isabella Ocean — the hub: which games the title screen and the "+" (more games) screen show.
 *
 * THE GAME LIST is the one place a game is wired in. One line per game, and the order of the lines
 * is the order on screen:
 *   - the first two lines sit on the title, one each side of Isabella's big Play button;
 *   - every line after those sits behind the "+" button, on the more-games screen.
 * Isabella herself is not a line: her Play button (#playBtn in index.html) is always the big one
 * in the middle.
 *
 * To add a game:
 *   1. put its picture, a <symbol id="i-...">, beside the others in index.html;
 *   2. add one line to GAMES below.
 * To change which games are on the title: move lines. The top two are on the title.
 *   (Two tests name the title's two games on purpose, so a slip is caught: ON_TITLE in
 *   test/hub/hub.test.js and the family baseline in test/paywall/drive.js. Change them to match.)
 *
 * A line:
 *   id      unique; also names the button, #<id>Btn
 *   page    the game's page, relative to index.html
 *   symbol  the id of its <symbol>
 *   label   for screen readers only (kids never need to read)
 *   color   optional button colour: blue, teal, pink, purple, green, coral or indigo
 */
(function () {
  'use strict';
  const GAMES = [
    { id: 'pop',   page: 'games/pop/index.html',   symbol: 'i-bubble', label: 'Bubble Party', color: 'blue' },
    { id: 'maze',  page: 'games/maze/index.html',  symbol: 'i-maze',   label: 'Coral Maze',   color: 'teal' },
    { id: 'match', page: 'games/match/index.html', symbol: 'i-shell',  label: 'Shell Match',  color: 'pink' },
    { id: 'words', page: 'games/words/index.html', symbol: 'i-words',  label: 'Sea Words',    color: 'purple' },
  ];

  const ON_TITLE = 2;   // games beside the Play button; the rest go behind "+"
  const COLORS = ['blue', 'teal', 'pink', 'purple', 'green', 'coral', 'indigo'];
  const SVG = 'http://www.w3.org/2000/svg';
  const $ = (id) => document.getElementById(id);

  function button(g, i) {
    const b = document.createElement('button');
    b.id = `${g.id}Btn`;
    b.className = `btn game ${COLORS.includes(g.color) ? g.color : COLORS[i % COLORS.length]}`;
    b.dataset.game = g.id;
    b.setAttribute('aria-label', g.label);
    const svg = document.createElementNS(SVG, 'svg'), use = document.createElementNS(SVG, 'use');
    svg.setAttribute('viewBox', '0 0 24 24');
    use.setAttribute('href', `#${g.symbol}`);
    svg.appendChild(use);
    b.appendChild(svg);
    return b;
  }

  // Draw both screens from GAMES. Safe to call again after the list changes.
  function build() {
    const row = $('games'), play = $('playBtn'), grid = $('moreGrid');
    for (const old of document.querySelectorAll('[data-game]')) old.remove();
    GAMES.forEach((g, i) => {
      const b = button(g, i);
      if (i === 0) row.insertBefore(b, play);
      else if (i < ON_TITLE) row.insertBefore(b, $('moreBtn'));
      else grid.appendChild(b);
    });
    $('moreBtn').hidden = GAMES.length <= ON_TITLE;   // nothing behind it: no "+"
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

  window.IsabellaHub = { GAMES, ON_TITLE, build, layout, gameOf };
  build();
  window.addEventListener('resize', layout);
})();
