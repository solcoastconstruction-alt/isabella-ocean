// The title screen ("hub") and its "+" (more games) screen, in headless Chrome with real touch input
// through the DevTools protocol (Input.dispatchTouchEvent, port 9454).
//   node test/hub/hub.test.js [--web <dir>] [--out <screenshots dir>] [--profile <chrome profile dir>]
//
// At 915x412 (the Seeker) and 800x360, in both flavors, with and without "Add to Home screen":
//   - the title shows a game, Isabella's big Play button, a game, then "+"; Play is the biggest, every
//     button is at least 19vh, and nothing overlaps the sound, coin, Add-to-Home or Grown-ups controls;
//   - "+" opens the more-games screen; every game opens and comes back; the back button and
//     window.__back (Android's back) close it;
//   - the list in web/hub.js is the only wiring: the two recipes written there (move a line; add a
//     symbol and a line) are carried out on a copy of hub.js and the screens follow;
//   - the "+" screen holds 1 to 18 games (six dummy lines make eight; dummies exist only in this test);
//   - Isabella's own title: Play, the 4-second hold on the logo, the coin count, the sound button.
// The Fairy world (docs/FAIRY.md): the same checks, at the same two sizes in both flavors, for the second world
//   - the round world button sits in the bottom-right corner of the title, at least 19vh, and overlaps nothing;
//   - tapping it flips the title to the fairy world ("Isabella the Fairy", the flagship game as the big middle
//     button, one game each side, "+") and tapping again returns; the world is remembered across a reload;
//   - the fairy "+" screen holds the rest of the fairy list; back and window.__back close it to the fairy title;
//   - every fairy game opens from where it sits and comes back to the fairy title. A fairy game whose page is
//     missing FAILS here (it is never skipped), so a run after the games are merged is a real check;
//   - the title's canvas draws the sea in the ocean world and the meadow in the fairy world (also behind "+");
//   - the two recipes work for a fairy line too (move one: the title follows; add one: it goes behind the fairy "+").
// Layout only at 1335x600 and 1024x768, in both worlds. Exits 1 on any failed check or JavaScript exception.
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { launch, sleep } = require('../paywall/cdp.js');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(__dirname, '../..');
const WEB = path.resolve(arg('web', path.join(ROOT, 'web')));
const OUT = path.resolve(arg('out', path.join(ROOT, '.local/shots')));
const PROFILE = path.resolve(arg('profile', path.join(ROOT, '.local/chrome-hub')));
const VARIANTS = path.join(path.dirname(PROFILE), 'hub-variants');
const PORT = 9454;

// The owner's choice for the title, named on purpose so a slip in hub.js is caught:
//   ocean: these two games beside Isabella's Play button, the rest behind "+";
//   fairy: the first is the big middle button, the next two sit beside it (second on the left, third on the right),
//   and the rest are behind "+" (FAIRY_MORE).
const ON_TITLE = ['pop', 'maze'];
const FAIRY_ON_TITLE = ['flight', 'slide', 'hop'];
const FAIRY_MORE = ['fireflies', 'petals', 'potions'];
const FAIRY_FLAGSHIP_SYMBOL = '#i-flight';
const SAVE = { unlocked: 1, stars: [], gold: 137, muted: false, played: false };
const COLORS = ['blue', 'teal', 'pink', 'purple', 'green', 'coral', 'indigo'];

let cdp, pass = 0, fail = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (ok) pass++; else fail++; return !!ok; };
// A step that throws (a button that is covered, a page that never loads) is a failed check, not a crash.
async function attempt(what, fn) {
  try { return await fn(); } catch (e) { check(false, `${what}: ${String(e.message).split('\n')[0]}`); return null; }
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const url = (web, page) => pathToFileURL(path.join(web, page)).href;

// ---- the page ----
// `world` is the remembered world the page starts in ('ocean' unless a test says 'fairy'): the profile's
// localStorage lives on between pages, so every test sets it, and only the reload test leaves it alone.
async function open(web, { family = false, pin = false, save = SAVE, world = 'ocean' } = {}) {
  const src = `try { localStorage.setItem('isabella.save', ${JSON.stringify(JSON.stringify(save))}); localStorage.setItem('hub.world', ${JSON.stringify(world)}); } catch (e) {}`
    + (family ? "window.IsabellaFlavor = 'family';" : '')
    // The Android app's bridge (both flavors have it): the launcher can pin, and the icon isn't there yet.
    + (pin ? 'window.__pinCalls = 0; window.IsabellaApp = { canPin: () => true, isPinned: () => false, pinToHome() { window.__pinCalls++; } };' : '');
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
  await cdp.navigate(url(web, 'index.html'));
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await title();
}
// Load the page again exactly as the app would on its next start: nothing is set first.
async function reload(web, { family = false } = {}) {
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: family ? "window.IsabellaFlavor = 'family';" : '' });   // only the flavor: the page's own saved state is what is being tested
  await cdp.navigate(url(web, 'index.html'));
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await title();
}
async function title() {
  await cdp.waitFor("window.__dbg && __dbg.mode === 'title'", 8000, 'the title screen');
  await sleep(250);
}
const viewport = (w, h) => cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
// One finger down on the middle of the element and up again. Fails if anything covers it.
async function touch(selector, ms = 50) {
  const { x, y } = await cdp.center(selector);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 }] });
  await sleep(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(80);
}
const stored = () => cdp.eval("JSON.parse(localStorage.getItem('isabella.save') || 'null')");
const mode = () => cdp.eval('__dbg.mode');
async function openMore() {
  await touch('#moreBtn');
  await cdp.waitFor("__dbg.mode === 'more'", 3000, 'the "+" screen');
  await sleep(150);
}

// ---- measuring: every visible button and control, in CSS px ----
const MEASURE = `(() => {
  const vis = (el) => !!el && el.getClientRects().length > 0;
  const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const btn = (b) => Object.assign({ id: b.id, game: b.dataset.game || null, label: b.getAttribute('aria-label') || '', text: b.textContent.trim(), sym: (b.querySelector('use') || document.createElement('i')).getAttribute('href') }, box(b));
  const one = (sel) => { const el = document.querySelector(sel); return vis(el) ? box(el) : null; };
  return {
    W: innerWidth, H: innerHeight, scrollW: document.documentElement.scrollWidth, mode: __dbg.mode,
    row: [...document.querySelectorAll('#games button')].filter(vis).map(btn),
    grid: [...document.querySelectorAll('#moreGrid button')].filter(vis).map(btn),
    back: one('#moreBack'), sound: one('#soundBtn'), coins: one('#title .gold'), logo: one('#logo'), pin: one('#pinBtn'), grownups: one('#parentBtn'), world: one('#worldBtn'),
    logoText: document.getElementById('logo').innerText.replace(/\\s+/g, " ").trim(), worldLabel: document.getElementById('worldBtn').getAttribute('aria-label'), worldSym: document.querySelector('#worldBtn use').getAttribute('href'),
    bodyFairy: document.body.classList.contains('fairy'), hubWorld: IsabellaHub.getWorld(),
    buttons: [...document.querySelectorAll('button')].filter(vis).map((b) => b.id || b.className),
  };
})()`;
const measure = () => cdp.eval(MEASURE);
const vh = (b, m) => (Math.min(b.w, b.h) / m.H) * 100;
const inside = (b, m) => b.l >= -0.5 && b.t >= -0.5 && b.r <= m.W + 0.5 && b.b <= m.H + 0.5;
const hit = (a, b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5;
function overlaps(named) {
  const out = [];
  for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) if (hit(named[i][1], named[j][1])) out.push(`${named[i][0]} over ${named[j][0]}`);
  return out;
}

// The title. Ocean: [game] [PLAY] [game] [+]. Fairy (`fairy: true`, `games` = the fairy list's first three): [2nd game]
// [1st game, big] [3rd game] [+] with Isabella's Play out of the way. And the other controls around them, which now
// include the world button in the bottom-right corner.
async function checkTitle(tag, games, { family = false, pin = false, fairy = false } = {}) {
  const m = await measure();
  const bigId = fairy ? `${games[0].id}Btn` : 'playBtn';
  const want = fairy ? [`${games[1].id}Btn`, bigId, `${games[2].id}Btn`, 'moreBtn'] : [`${games[0].id}Btn`, bigId, `${games[1].id}Btn`, 'moreBtn'];
  const row = [...m.row].sort((a, b) => a.l - b.l), ids = row.map((b) => b.id);
  const others = ['soundBtn', 'worldBtn'].concat(pin ? ['pinBtn'] : [], family ? [] : ['parentBtn']);
  check(same(ids, want) && row.filter((b) => b.game).length === (fairy ? 3 : 2) && same([...m.buttons].sort(), [...want, ...others].sort()),
    `${tag}: the title shows three game buttons and "+", left to right ${ids.join(', ')}; no other button but ${others.join(', ')}`);
  const big = row.find((b) => b.id === bigId), sizes = row.map((b) => vh(b, m));
  const mid = big && row.length === 4 && Math.abs((big.l + big.r) / 2 - (row[0].l + row[2].r) / 2) < 1 && m.logo && Math.abs((big.l + big.r) / 2 - (m.logo.l + m.logo.r) / 2) < 1;
  check(!!big && row.every((b) => b === big || (big.w > b.w + 1 && big.h > b.h + 1)) && sizes.every((s) => s >= 19) && mid,
    `${tag}: ${fairy ? 'the flagship game' : 'Play'} is the biggest, in the middle of the three and under the logo; every button is at least 19vh (${sizes.map((s) => s.toFixed(1)).join(' / ')} vh)`);
  const named = row.map((b) => [b.id, b]).concat(['sound', 'coins', 'logo', 'pin', 'grownups', 'world'].filter((k) => m[k]).map((k) => [k, m[k]]));
  const off = named.filter(([, b]) => !inside(b, m)).map(([n]) => n), over = overlaps(named);
  check(named.length === 4 + 4 + (pin ? 1 : 0) + (family ? 0 : 1) && !off.length && !over.length && m.scrollW <= m.W,
    `${tag}: ${named.map(([n]) => n).join(', ')}: all on screen, none overlapping${off.length ? `; off screen: ${off.join(', ')}` : ''}${over.length ? `; overlapping: ${over.join(', ')}` : ''}`);
  check(row.length > 0 && row.every((b) => b.label && !b.text), `${tag}: no reading: each is a picture with an aria label (${row.map((b) => b.label).join(', ')})`);
  // The world button: in the bottom-right corner, a full 19vh to press, and it says (to a screen reader) where it goes.
  const w = m.world, corner = !!w && w.r >= m.W * 0.9 && w.b >= m.H * 0.9 && w.l >= m.W * 0.7 && w.t >= m.H * 0.6;
  check(corner && vh(w, m) >= 18.95,
    `${tag}: the world button is in the bottom-right corner at ${w ? vh(w, m).toFixed(1) : '?'}vh (${w ? `${Math.round(w.l)},${Math.round(w.t)} to ${Math.round(w.r)},${Math.round(w.b)} of ${m.W}x${m.H}` : 'not shown'})`);
  // The words of the logo, the world's class, and what the button offers, all agree with the world the row shows.
  const wantWorld = fairy ? 'fairy' : 'ocean';
  check(m.hubWorld === wantWorld && m.bodyFairy === fairy && m.logoText === (fairy ? 'Isabella the Fairy' : 'Isabella the Mermaid')
    && m.worldLabel === (fairy ? 'Ocean world' : 'Fairy world') && m.worldSym === (fairy ? '#i-wave' : '#i-rainbow'),
    `${tag}: the ${wantWorld} world: logo "${m.logoText}", the button offers "${m.worldLabel}" (${m.worldSym})`);
  if (fairy) check(big && big.sym === `#${games[0].symbol}` && (games[0].id !== FAIRY_ON_TITLE[0] || big.sym === FAIRY_FLAGSHIP_SYMBOL), `${tag}: the big middle button wears the first fairy game's picture (${big ? big.sym : 'missing'})`);
  else check(big && big.sym === '#i-play', `${tag}: the big middle button is still Isabella's Play (${big ? big.sym : 'missing'})`);
}

// What is wrong with the "+" screen as measured (nothing, if it is a tidy grid that fits).
function moreProblems(m) {
  const out = [], g = m.grid;
  if (!g.length || !m.back) return ['nothing to measure'];
  const small = g.filter((b) => vh(b, m) < 18.95).length;
  if (small) out.push(`${small} under 19vh (${Math.min(...g.map((b) => vh(b, m))).toFixed(1)}vh)`);
  if (vh(m.back, m) < 18.95) out.push(`back button ${vh(m.back, m).toFixed(1)}vh`);
  const named = g.map((b) => [b.id, b]).concat([['back', m.back]]);
  const off = named.filter(([, b]) => !inside(b, m)).map(([n]) => n);
  if (off.length) out.push(`off screen: ${off.join(', ')}`);
  const over = overlaps(named);
  if (over.length) out.push(`overlapping: ${over.slice(0, 3).join(', ')}`);
  if (m.scrollW > m.W) out.push('sideways scroll');
  if (g.some((b) => Math.abs(b.w - g[0].w) > 0.5 || Math.abs(b.h - b.w) > 0.5)) out.push('buttons differ in size');
  const rows = [];
  for (const b of g) { const r = rows.find((x) => Math.abs(x[0].t - b.t) < 1); if (r) r.push(b); else rows.push([b]); }
  if (rows.some((r) => Math.abs((Math.min(...r.map((b) => b.l)) + Math.max(...r.map((b) => b.r))) / 2 - m.W / 2) > 1)) out.push('a row is off centre');
  if (rows.some((r, i) => (i < rows.length - 1 ? r.length !== rows[0].length : r.length > rows[0].length))) out.push(`ragged rows (${rows.map((r) => r.length).join('+')})`);
  return out;
}
const shape = (m) => {
  const tops = [...new Set(m.grid.map((b) => Math.round(b.t)))];
  return `${tops.map((t) => m.grid.filter((b) => Math.round(b.t) === t).length).join('+')} at ${m.grid.length ? vh(m.grid[0], m).toFixed(1) : '?'}vh`;
};
async function checkMore(tag, ids) {
  const m = await measure();
  const reading = [...m.grid].sort((a, b) => (Math.abs(a.t - b.t) > 1 ? a.t - b.t : a.l - b.l)).map((b) => b.game);
  check(m.mode === 'more' && same(reading, ids) && same(m.buttons, ['moreBack', ...ids.map((id) => `${id}Btn`)]),
    `${tag}: the "+" screen shows ${ids.length} games in the list's order (${reading.slice(0, 4).join(', ')}${reading.length > 4 ? ', …' : ''}) and a back button; nothing else`);
  const bad = moreProblems(m);
  check(!bad.length && m.grid.every((b) => b.label && !b.text),
    `${tag}: a tidy grid, ${shape(m)}; back button ${m.back ? vh(m.back, m).toFixed(1) : '?'}vh; nothing overlaps or leaves the screen${bad.length ? `; ${bad.join('; ')}` : ''}`);
  return m;
}

// Press a game's button with a finger; its page must load; Android's back must return to the title.
async function playAndReturn(tag, web, g, { viaMore, wiped, world = 'ocean' } = {}) {
  // A game whose page is not there is a failure, never a skip: the list promises it.
  if (!fs.existsSync(path.join(web, g.page))) { check(false, `${tag}: ${g.label}: its page ${g.page} is missing`); return; }
  await attempt(`${tag}: ${g.label}`, async () => {
    if (viaMore) await openMore();
    if (wiped) await cdp.eval("localStorage.removeItem('isabella.save'); 1");
    await touch(`#${g.id}Btn`);
    const want = url(web, g.page);
    await cdp.waitFor(`location.href === ${JSON.stringify(want)} && document.readyState === 'complete' && typeof window.__back === 'function'`, 8000, `${g.page} to load`);
    await sleep(400);
    if (wiped) {
      const s = await stored();
      check(!!s && s.gold === SAVE.gold, `${tag}: Isabella's save is written before leaving for ${g.label} (gold ${s ? s.gold : 'missing'})`);
    }
    const handled = await cdp.eval('window.__back()');
    await title();
    const here = await cdp.eval('location.href'), back = await cdp.eval('__dbg.world');
    check(handled === true && here === url(web, 'index.html') && back === world,
      `${tag}: ${g.label} opens from ${viaMore ? 'the "+" screen' : 'the title'} (${g.page}) and back returns to the ${world} title${back === world ? '' : ` (it opened on the ${back} world)`}`);
  });
}

// A copy of the web folder with some files rewritten (everything else is a link to the real file):
// how the test carries out hub.js's two recipes without shipping anything.
function variant(name, edits) {
  const dir = path.join(VARIANTS, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(WEB)) {
    if (edits[f]) fs.writeFileSync(path.join(dir, f), edits[f](fs.readFileSync(path.join(WEB, f), 'utf8')));
    else fs.symlinkSync(path.join(WEB, f), path.join(dir, f));
  }
  return dir;
}
// The lines of the game list in hub.js, as written.
const LINE = /^[ \t]*\{ id: '[^']+',.*\},[ \t]*\n/gm;
const dummyLine = (i, world = 'ocean') => `    { id: 'dummy${i}', page: 'games/pop/index.html', symbol: 'i-dummy', label: 'Dummy ${i}', world: '${world}' },\n`;
// A world's own lines, as written (the file lists ocean first, then fairy).
const worldLines = (s, w) => (s.match(LINE) || []).filter((l) => l.includes(`world: '${w}'`));
const DUMMY_SYMBOL = '<symbol id="i-dummy" viewBox="0 0 24 24"><path d="M12 2l3 7 7 1-5 5 1 7-6-4-6 4 1-7-5-5 7-1z" fill="#fff"/></symbol>';
const withSymbol = (html) => html.replace('</defs>', `  ${DUMMY_SYMBOL}\n  </defs>`);

(async () => {
  // Another test's Chrome on this port would be driven by mistake (Coral Maze's tests share 9454).
  const busy = await fetch(`http://127.0.0.1:${PORT}/json/version`).then(() => true, () => false);
  if (busy) { console.error(`DevTools port ${PORT} is in use: another browser test is running. Try again when it has finished.`); process.exit(1); }
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  cdp = await launch({ port: PORT, profile: PROFILE, width: 915, height: 412 });
  const errors = [];
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  cdp.on('Runtime.exceptionThrown', (p) => errors.push((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text));
  const shot = async (name) => console.log('      shot', path.relative(ROOT, await cdp.shot(path.join(OUT, `${name}.png`))));

  // ---- the list itself ----
  console.log('\n# The game list (web/hub.js)');
  await viewport(915, 412);
  await open(WEB);
  const ALL = await cdp.eval('IsabellaHub.GAMES.map((g) => ({ id: g.id, page: g.page, symbol: g.symbol, label: g.label, color: g.color || null, world: g.world || null }))');
  const GAMES = ALL.filter((g) => g.world === 'ocean'), FAIRY = ALL.filter((g) => g.world === 'fairy');
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8'), appJs = fs.readFileSync(path.join(WEB, 'app.js'), 'utf8');
  const hubJs = fs.readFileSync(path.join(WEB, 'hub.js'), 'utf8'), lines = hubJs.match(LINE) || [];
  check(GAMES.length >= 4 && lines.length === ALL.length && GAMES.length + FAIRY.length === ALL.length && same(GAMES.slice(0, 2).map((g) => g.id), ON_TITLE),
    `the list has ${ALL.length} games, one line each, each in the ocean or the fairy world (${GAMES.length} + ${FAIRY.length}); the first two ocean games (${GAMES.slice(0, 2).map((g) => g.label).join(', ')}) are the ocean title's`);
  check(same(FAIRY.slice(0, 3).map((g) => g.id), FAIRY_ON_TITLE) && same(FAIRY.slice(3).map((g) => g.id), FAIRY_MORE),
    `the fairy list: ${FAIRY.slice(0, 3).map((g) => g.label).join(', ')} are the fairy title's (the first is the big middle button); ${FAIRY.slice(3).map((g) => g.label).join(', ')} are behind its "+"`);
  const flaws = [];
  for (const g of ALL) {
    if (!/^[a-z][a-z0-9]*$/.test(g.id || '') || ALL.filter((x) => x.id === g.id).length !== 1) flaws.push(`${g.id}: id missing, odd or used twice`);
    if (!g.page || !fs.existsSync(path.join(WEB, g.page))) flaws.push(`${g.id}: no page at ${g.page}`);
    if (!g.symbol || !html.includes(`<symbol id="${g.symbol}"`)) flaws.push(`${g.id}: no <symbol id="${g.symbol}"> in index.html`);
    if (!g.label || !String(g.label).trim()) flaws.push(`${g.id}: no label`);
    if (g.color && !COLORS.includes(g.color)) flaws.push(`${g.id}: unknown colour ${g.color}`);
  }
  check(!flaws.length, `every line has a unique id, a page that exists, a <symbol> that exists, a label and a known colour${flaws.length ? `: ${flaws.join('; ')}` : ''}`);
  // Hand-wiring would be a game's page named outside the list, or a game-sized button written into
  // index.html (it has two of its own: "+" and the back button).
  const strays = [html, appJs].map((s) => (s.match(/games\/[\w-]+\/index\.html/g) || []).length);
  const written = (html.match(/<button[^>]*class="[^"]*\bgame\b/g) || []).length;
  check(strays[0] === 0 && strays[1] === 0 && written === 2,
    `the list is the only wiring: index.html and app.js name no game page (${strays.join(' and ')} found), and index.html writes no game button itself (${written} game-sized buttons: "+" and back)`);
  const titleGames = GAMES.slice(0, 2), moreGames = GAMES.slice(2), fairyTitle = FAIRY.slice(0, 3), fairyMore = FAIRY.slice(3);

  // ---- every size, both flavors ----
  for (const [w, h] of [[915, 412], [800, 360]]) {
    const at = `${w}x${h}`;
    console.log(`\n# ${at}: the title in both flavors`);
    await viewport(w, h);
    for (const family of [false, true]) {
      for (const pin of [true, false]) {
        for (const fairy of [false, true]) {
          const tag = `${at} ${fairy ? 'fairy ' : ''}${family ? 'family' : 'store'}${pin ? ' + Add to Home' : ''}`;
          await open(WEB, { family, pin, world: fairy ? 'fairy' : 'ocean' });
          await checkTitle(tag, fairy ? fairyTitle : titleGames, { family, pin, fairy });
          await shot(`title-${fairy ? 'fairy-' : ''}${family ? 'family' : 'store'}${pin ? '-pin' : ''}-${at}`);
        }
      }
    }

    console.log(`\n# ${at}: Isabella's own title (store flavor, in the Android app)`);
    await open(WEB, { pin: true });
    check((await cdp.eval("document.getElementById('goldTotal').textContent")) === String(SAVE.gold), `${at}: the coin count shows her ${SAVE.gold} coins`);
    await attempt(`${at}: the sound button`, async () => {
      await touch('#soundBtn');
      const off = [(await stored()).muted, await cdp.eval("document.querySelector('#soundBtn use').getAttribute('href')")];
      await touch('#soundBtn');
      const on = [(await stored()).muted, await cdp.eval("document.querySelector('#soundBtn use').getAttribute('href')")];
      check(off[0] === true && off[1] === '#i-mute' && on[0] === false && on[1] === '#i-sound', `${at}: the sound button mutes and unmutes, and saves it (${off.join(' ')} then ${on.join(' ')})`);
    });
    await attempt(`${at}: Add to Home screen`, async () => {
      await touch('#pinBtn');
      check((await cdp.eval('window.__pinCalls')) === 1 && (await cdp.eval("getComputedStyle(document.getElementById('pinHint')).display")) === 'block', `${at}: "Add to Home screen" still asks the launcher and shows its hint`);
    });
    await attempt(`${at}: Grown-ups`, async () => {
      await touch('#parentBtn');
      const gate = await cdp.eval("document.getElementById('pwGate').classList.contains('on')");
      const handled = await cdp.eval('window.__back()');
      check(gate && handled === true && !(await cdp.eval("document.getElementById('pwGate').classList.contains('on')")) && (await mode()) === 'title', `${at}: the Grown-ups button still opens the parent gate, and back closes it`);
    });
    await attempt(`${at}: Play`, async () => {
      await touch('#playBtn');
      await cdp.waitFor("__dbg.mode === 'levels'", 3000, 'the levels');
      const world = await cdp.eval("document.getElementById('worldName').textContent");
      await touch('#levelsHome');
      check(world === 'World 1' && (await mode()) === 'title', `${at}: the big Play button opens Isabella's levels (${world}), and home comes back`);
    });

    console.log(`\n# ${at}: the "+" screen`);
    await open(WEB);
    await attempt(`${at}: "+"`, async () => {
      await openMore();
      await checkMore(`${at}`, moreGames.map((g) => g.id));
      await sleep(400);
      await shot(`more-${moreGames.length}-${at}`);
      await touch('#moreBack');
      check((await mode()) === 'title' && same((await measure()).row.map((b) => b.id), [`${titleGames[0].id}Btn`, 'playBtn', `${titleGames[1].id}Btn`, 'moreBtn']), `${at}: the back button closes the "+" screen: the title is back`);
      await openMore();
      const handled = await cdp.eval('window.__back()');
      const closed = await mode();
      const again = await cdp.eval('window.__back()');
      check(handled === true && closed === 'title' && again === false, `${at}: Android's back (window.__back) closes the "+" screen and says so; on the title it is not handled (${handled}, ${closed}, ${again})`);
    });

    console.log(`\n# ${at}: the world button: the ocean title and the fairy title`);
    for (const family of [false, true]) {
      await attempt(`${at}: the world button (${family ? 'family' : 'store'})`, async () => {
        const tag = `${at} ${family ? 'family' : 'store'}`;
        await open(WEB, { family });
        await checkTitle(`${tag} ocean`, titleGames, { family });
        await touch('#worldBtn');
        await cdp.waitFor("__dbg.world === 'fairy'", 3000, 'the fairy world');
        await sleep(200);
        await checkTitle(`${tag}: after tapping the world button`, fairyTitle, { family, fairy: true });
        check((await cdp.eval("localStorage.getItem('hub.world')")) === 'fairy', `${tag}: the fairy world is remembered (hub.world)`);
        await shot(`world-fairy-${family ? 'family' : 'store'}-${at}`);
        await touch('#worldBtn');
        await cdp.waitFor("__dbg.world === 'ocean'", 3000, 'the ocean world');
        await sleep(200);
        await checkTitle(`${tag}: after tapping it again`, titleGames, { family });
        check((await cdp.eval("localStorage.getItem('hub.world')")) === 'ocean', `${tag}: the ocean world is remembered again`);
        // Remembered across a reload: the app starts on the world it was left in.
        await touch('#worldBtn');
        await cdp.waitFor("__dbg.world === 'fairy'", 3000, 'the fairy world');
        await reload(WEB, { family });
        await checkTitle(`${tag}: after a reload in the fairy world`, fairyTitle, { family, fairy: true });
        await touch('#worldBtn');
        await cdp.waitFor("__dbg.world === 'ocean'", 3000, 'the ocean world');
        await reload(WEB, { family });
        await checkTitle(`${tag}: after a reload in the ocean world`, titleGames, { family });
        // The debug hooks, and a world that does not exist changes nothing.
        const dbg = [await cdp.eval("__dbg.setWorld('fairy')"), await cdp.eval('__dbg.world'), await cdp.eval("__dbg.setWorld('nonsense')"), await cdp.eval('__dbg.world'), await cdp.eval("__dbg.setWorld('ocean')")];
        check(same(dbg, ['fairy', 'fairy', 'fairy', 'fairy', 'ocean']) && same((await measure()).row.map((b) => b.id), [`${titleGames[0].id}Btn`, 'playBtn', `${titleGames[1].id}Btn`, 'moreBtn']),
          `${tag}: __dbg.setWorld flips the world, __dbg.world reads it, an unknown world changes nothing (${dbg.join(', ')})`);
      });
    }

    console.log(`\n# ${at}: the fairy "+" screen`);
    await open(WEB, { world: 'fairy' });
    await attempt(`${at}: fairy "+"`, async () => {
      const fairyRow = [`${fairyTitle[1].id}Btn`, `${fairyTitle[0].id}Btn`, `${fairyTitle[2].id}Btn`, 'moreBtn'];
      await openMore();
      await checkMore(`${at} fairy`, fairyMore.map((g) => g.id));
      await sleep(400);
      await shot(`more-fairy-${fairyMore.length}-${at}`);
      await touch('#moreBack');
      check((await mode()) === 'title' && (await cdp.eval('__dbg.world')) === 'fairy' && same((await measure()).row.map((b) => b.id), fairyRow), `${at}: the back button closes the fairy "+" screen: the fairy title is back`);
      await openMore();
      const handled = await cdp.eval('window.__back()');
      const closed = await mode();
      const again = await cdp.eval('window.__back()');
      check(handled === true && closed === 'title' && again === false && (await cdp.eval('__dbg.world')) === 'fairy' && same((await measure()).row.map((b) => b.id), fairyRow),
        `${at}: Android's back (window.__back) closes the fairy "+" screen to the fairy title; on the title it is not handled (${handled}, ${closed}, ${again})`);
    });

    console.log(`\n# ${at}: the title's backdrop follows the world`);
    await attempt(`${at}: the backdrop`, async () => {
      await open(WEB);
      await cdp.eval(`(() => { window.__draws = { sea: 0, meadow: 0 }; const R = IsabellaRender, a = R.drawAttract, f = R.drawFairyAttract;
        R.drawAttract = function () { window.__draws.sea++; return a.apply(this, arguments); };
        R.drawFairyAttract = function () { window.__draws.meadow++; return f.apply(this, arguments); }; return 1; })()`);
      const drawn = async () => { await cdp.eval('window.__draws.sea = window.__draws.meadow = 0'); await sleep(500); return cdp.eval('({ sea: window.__draws.sea, meadow: window.__draws.meadow })'); };
      const seen = [];
      seen.push(['ocean title', await drawn()]);
      await touch('#worldBtn'); await cdp.waitFor("__dbg.world === 'fairy'", 3000, 'the fairy world');
      seen.push(['fairy title', await drawn()]);
      await openMore();
      seen.push(['fairy "+"', await drawn()]);
      await touch('#moreBack'); await touch('#worldBtn'); await cdp.waitFor("__dbg.world === 'ocean'", 3000, 'the ocean world');
      await openMore();
      seen.push(['ocean "+"', await drawn()]);
      const ok = (name, sea) => { const d = seen.find((x) => x[0] === name)[1]; return sea ? d.sea > 5 && d.meadow === 0 : d.meadow > 5 && d.sea === 0; };
      check(ok('ocean title', true) && ok('fairy title', false) && ok('fairy "+"', false) && ok('ocean "+"', true),
        `${at}: the sea is drawn behind the ocean title and its "+", the meadow behind the fairy title and its "+" (${seen.map(([n, d]) => `${n}: sea ${d.sea} meadow ${d.meadow}`).join('; ')})`);
    });

    console.log(`\n# ${at}: every game opens and comes back`);
    await open(WEB);
    for (const [i, g] of GAMES.entries()) await playAndReturn(at, WEB, g, { viaMore: i >= 2, wiped: i === 0 || i === 2 });
    await open(WEB, { world: 'fairy' });
    for (const [i, g] of FAIRY.entries()) await playAndReturn(`${at} fairy`, WEB, g, { viaMore: i >= 3, world: 'fairy' });

    console.log(`\n# ${at}: the recipes in hub.js, carried out on a copy`);
    await attempt(`${at}: move a line`, async () => {
      // "To change which games are on the title: move lines." The last ocean line goes to the top of the ocean lines.
      const moved = variant('moved', { 'hub.js': (s) => { const l = worldLines(s, 'ocean'); return s.replace(l[l.length - 1], '').replace(l[0], l[l.length - 1] + l[0]); } });
      const order = [GAMES[GAMES.length - 1], ...GAMES.slice(0, -1)];
      await open(moved);
      check(same(await cdp.eval("IsabellaHub.GAMES.filter((g) => g.world === 'ocean').map((g) => g.id)"), order.map((g) => g.id)), `${at}: moved ${order[0].label}'s line to the top of the ocean list (${order.map((g) => g.id).join(', ')})`);
      await checkTitle(`${at} line moved`, order.slice(0, 2));
      await playAndReturn(`${at} line moved`, moved, order[0]);
      await openMore();
      await checkMore(`${at} line moved`, order.slice(2).map((g) => g.id));
    });
    await attempt(`${at}: move a fairy line`, async () => {
      // The same recipe in the fairy world: the last fairy line goes to the top, so it becomes the big middle button.
      const moved = variant('fairymoved', { 'hub.js': (s) => { const l = worldLines(s, 'fairy'); return s.replace(l[l.length - 1], '').replace(l[0], l[l.length - 1] + l[0]); } });
      const order = [FAIRY[FAIRY.length - 1], ...FAIRY.slice(0, -1)];
      await open(moved, { world: 'fairy' });
      check(same(await cdp.eval("IsabellaHub.GAMES.filter((g) => g.world === 'fairy').map((g) => g.id)"), order.map((g) => g.id)), `${at}: moved ${order[0].label}'s line to the top of the fairy list (${order.map((g) => g.id).join(', ')})`);
      await checkTitle(`${at} fairy line moved`, order.slice(0, 3), { fairy: true });
      await playAndReturn(`${at} fairy line moved`, moved, order[0], { world: 'fairy' });
      await openMore();
      await checkMore(`${at} fairy line moved`, order.slice(3).map((g) => g.id));
    });
    await attempt(`${at}: add a game`, async () => {
      // "To add a game: put its <symbol> in index.html; add one line." Then five more, to make eight behind "+".
      const one = variant('added', { 'index.html': withSymbol, 'hub.js': (s) => { const l = worldLines(s, 'ocean'); return s.replace(l[l.length - 1], l[l.length - 1] + dummyLine(1)); } });
      const dummy = { id: 'dummy1', page: 'games/pop/index.html', label: 'Dummy 1' };
      await open(one);
      await checkTitle(`${at} one game added`, titleGames);
      await openMore();
      await checkMore(`${at} one game added`, [...moreGames.map((g) => g.id), 'dummy1']);
      await touch('#moreBack');
      await playAndReturn(`${at} one game added`, one, dummy, { viaMore: true });

      const six = variant('six', { 'index.html': withSymbol, 'hub.js': (s) => { const l = worldLines(s, 'ocean'); return s.replace(l[l.length - 1], l[l.length - 1] + [1, 2, 3, 4, 5, 6].map((i) => dummyLine(i)).join('')); } });
      await open(six);
      await checkTitle(`${at} six dummy games`, titleGames);
      await openMore();
      await checkMore(`${at} six dummy games`, [...moreGames.map((g) => g.id), 'dummy1', 'dummy2', 'dummy3', 'dummy4', 'dummy5', 'dummy6']);
      await sleep(400);
      await shot(`more-${moreGames.length + 6}-${at}`);
      await touch('#moreBack');
      await playAndReturn(`${at} six dummy games`, six, { id: 'dummy6', page: 'games/pop/index.html', label: 'Dummy 6' }, { viaMore: true });
    });
    await attempt(`${at}: add a fairy game`, async () => {
      // A new fairy line at the end of the fairy lines goes behind the fairy "+", and the ocean is untouched.
      const one = variant('fairyadded', { 'index.html': withSymbol, 'hub.js': (s) => { const l = worldLines(s, 'fairy'); return s.replace(l[l.length - 1], l[l.length - 1] + dummyLine(1, 'fairy')); } });
      const dummy = { id: 'dummy1', page: 'games/pop/index.html', label: 'Dummy 1' };
      await open(one, { world: 'fairy' });
      await checkTitle(`${at} one fairy game added`, fairyTitle, { fairy: true });
      await openMore();
      await checkMore(`${at} one fairy game added`, [...fairyMore.map((g) => g.id), 'dummy1']);
      await touch('#moreBack');
      await playAndReturn(`${at} one fairy game added`, one, dummy, { viaMore: true, world: 'fairy' });
      await cdp.eval("__dbg.setWorld('ocean')");
      await checkTitle(`${at} one fairy game added: the ocean title is as before`, titleGames);
      await openMore();
      await checkMore(`${at} one fairy game added: the ocean "+" is as before`, moreGames.map((g) => g.id));
    });

    console.log(`\n# ${at}: how many games the "+" screen holds`);
    for (const wd of ['ocean', 'fairy']) {
      await attempt(`${at}: capacity (${wd})`, async () => {
        await open(WEB, { world: wd });
        await openMore();
        const kept = wd === 'fairy' ? FAIRY_ON_TITLE.length : ON_TITLE.length, label = wd === 'fairy' ? 'fairy ' : '';
        // Dummies in the page only: n games behind "+", measured for real each time.
        const withN = async (n) => {
          await cdp.eval(`(() => { const H = IsabellaHub; H.GAMES.splice(0, H.GAMES.length, ...H.GAMES.filter((g) => g.world === '${wd}').slice(0, H.ON_TITLE.${wd}));
            for (let i = 0; i < ${n}; i++) H.GAMES.push({ id: 'd' + i, page: 'games/pop/index.html', symbol: 'i-star', label: 'Dummy ' + i, world: '${wd}' });
            H.build(); return 1; })()`);
          return measure();
        };
        const bad = [], shapes = [];
        for (let n = 1; n <= 18; n++) {
          const m = await withN(n), p = moreProblems(m);
          if (m.grid.length !== n) p.push(`${m.grid.length} buttons drawn`);
          if (p.length) bad.push(`${n}: ${p.join('; ')}`);
          shapes.push(`${n}: ${shape(m)}`);
          if (n === 6) { await sleep(300); await shot(`more-${label.trim() ? 'fairy-' : ''}6-${at}`); }
        }
        check(!bad.length, `${at}: the ${label}"+" screen holds every count from 1 to 18, each button at least 19vh, a tidy grid clear of the back button${bad.length ? `\n      ${bad.join('\n      ')}` : ''}`);
        console.log(`      ${shapes.join(' | ')}`);
        const over = moreProblems(await withN(40));
        check(over.length > 0, `${at}: anchor: 40 ${label}games do not fit, and the same check says so (${over.join('; ')})`);
        await withN(0);
        const m = await measure();
        check(m.mode === 'more' && m.grid.length === 0 && (await cdp.eval("document.getElementById('moreBtn').hidden")) === true, `${at}: with only ${kept} ${label}games in the list there is no "+"`);
      });
    }

    console.log(`\n# ${at}: hold the "Isabella the Mermaid" title for 4 seconds (${w === 915 ? 'store' : 'family'} flavor)`);
    await attempt(`${at}: the logo hold`, async () => {
      await open(WEB, { family: w !== 915 });
      await touch('#logo', 1500);
      const short = (await stored()).unlocked;
      await touch('#logo', 4400);
      const long = (await stored()).unlocked;
      await touch('#playBtn');
      await cdp.waitFor("__dbg.mode === 'levels'", 3000, 'the levels');
      const world = await cdp.eval("document.getElementById('worldName').textContent");
      check(short === 1 && long === 20 && world === 'World 2', `${at}: 1.5 s does nothing (level ${short}); 4 s opens all 20 levels (${long}) and Play goes to ${world}`);
    });
  }

  // ---- other shapes of screen: layout only, in both worlds ----
  // At 4:3 "Add to Home screen" is left out: there its pill and the logo's box have always met by
  // 0.3vh (the same before the "+" button existed), and 4:3 is not a phone.
  for (const [w, h, pin] of [[1335, 600, true], [1024, 768, false]]) {
    const at = `${w}x${h}`;
    console.log(`\n# ${at}: layout`);
    await viewport(w, h);
    await attempt(`${at}: layout`, async () => {
      await open(WEB, { pin });
      await checkTitle(`${at} store${pin ? ' + Add to Home' : ''}`, titleGames, { pin });
      await shot(`title-store${pin ? '-pin' : ''}-${at}`);
      await openMore();
      await checkMore(at, moreGames.map((g) => g.id));
      await cdp.eval("(() => { const H = IsabellaHub; for (let i = 0; i < 6; i++) H.GAMES.push({ id: 'd' + i, page: 'games/pop/index.html', symbol: 'i-star', label: 'Dummy ' + i, world: 'ocean' }); H.build(); return 1; })()");
      await checkMore(`${at} six dummy games`, [...moreGames.map((g) => g.id), 'd0', 'd1', 'd2', 'd3', 'd4', 'd5']);
      await sleep(300);
      await shot(`more-${moreGames.length + 6}-${at}`);
    });
    await attempt(`${at}: fairy layout`, async () => {
      await open(WEB, { pin, world: 'fairy' });
      await checkTitle(`${at} fairy store${pin ? ' + Add to Home' : ''}`, fairyTitle, { pin, fairy: true });
      await shot(`title-fairy-store${pin ? '-pin' : ''}-${at}`);
      await openMore();
      await checkMore(`${at} fairy`, fairyMore.map((g) => g.id));
      await cdp.eval("(() => { const H = IsabellaHub; for (let i = 0; i < 6; i++) H.GAMES.push({ id: 'd' + i, page: 'games/pop/index.html', symbol: 'i-star', label: 'Dummy ' + i, world: 'fairy' }); H.build(); return 1; })()");
      await checkMore(`${at} fairy, six dummy games`, [...fairyMore.map((g) => g.id), 'd0', 'd1', 'd2', 'd3', 'd4', 'd5']);
      await sleep(300);
      await shot(`more-fairy-${fairyMore.length + 6}-${at}`);
    });
  }

  // ---- Isabella the Fairy keeps to her own lane: she must never cross a game button ----
  // The fairy backdrop flies her along the upper band of the screen, or along the bottom on screens squarer than
  // 16:10. Her place is read from the drawing call itself (FairyArt.drawFairy) over a whole crossing, at every
  // size, and compared with the real rectangles of the big button, the games beside it and "+".
  console.log('\n# the fairy flies clear of the game buttons');
  for (const [w, h] of [[915, 412], [800, 360], [1335, 600], [1024, 768]]) {
    await attempt(`${w}x${h}: the fairy's lane`, async () => {
      await viewport(w, h);
      await open(WEB, { world: 'fairy' });
      const r = await cdp.eval(`(() => {
        const F = FairyArt, R = IsabellaRender, calls = [], real = F.drawFairy;
        F.drawFairy = function (ctx, x, y, time, o) { calls.push([x, y, (o && o.scale) || 1]); return real.apply(this, arguments); };
        for (let t = 0; t < 60; t += 0.25) R.drawFairyAttract(t, 0.016);
        F.drawFairy = real;
        const k = innerHeight / 540, half = 56;   // 540 world units tall; the sprite with wings and hair reaches about 56 units from her waist
        const boxes = [...document.querySelectorAll('#games button')].filter((b) => b.getClientRects().length).map((b) => { const q = b.getBoundingClientRect(); return [b.id, q.left, q.top, q.right, q.bottom]; });
        const hits = [];
        for (const [x, y, sc] of calls) for (const [id, l, t, rr, b] of boxes) {
          if (x * k - half * sc * k < rr && x * k + half * sc * k > l && y * k - half * sc * k < b && y * k + half * sc * k > t) hits.push(id + '@' + Math.round(x));
        }
        const ys = calls.map((c) => c[1] * k);
        const lane = [0, Math.min(...calls.map((c) => c[1])) * k - 5, innerWidth, Math.max(...calls.map((c) => c[1])) * k + 5];
        const anchor = calls.filter(([x, y, sc]) => x * k - half * sc * k < lane[2] && x * k + half * sc * k > lane[0] && y * k - half * sc * k < lane[3] && y * k + half * sc * k > lane[1]).length;
        return { anchor, n: calls.length, boxes: boxes.length, hits: [...new Set(hits)], minY: Math.min(...ys) / innerHeight, maxY: Math.max(...ys) / innerHeight, xs: [Math.min(...calls.map((c) => c[0])), Math.max(...calls.map((c) => c[0]))] };
      })()`);
      check(r.n > 100 && r.boxes === 4 && !r.hits.length,
        `${w}x${h}: over ${r.n} sampled frames the fairy (${w / h <= 1.6 ? 'bottom' : 'upper'} lane, ${(r.minY * 100).toFixed(0)}% to ${(r.maxY * 100).toFixed(0)}% of the height) never reaches the ${r.boxes} game buttons${r.hits.length ? `; reaches: ${r.hits.join(', ')}` : ''}`);
      check(r.xs[0] < 0 && r.xs[1] > (w * 540) / h, `${w}x${h}: she flies the whole width, left to right (x from ${Math.round(r.xs[0])} to ${Math.round(r.xs[1])} units of ${Math.round((w * 540) / h)})`);
      check(r.anchor > 0, `${w}x${h}: anchor: the same test does see her cross a box laid along her own lane (${r.anchor} frames)`);
    });
  }

  check(errors.length === 0, `no JavaScript exceptions on any page${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await cdp.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
