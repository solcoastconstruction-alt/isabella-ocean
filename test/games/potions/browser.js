// Potion Colours in headless Chrome, driven like fingers: real touch taps and drags through the DevTools protocol.
//   node test/games/potions/browser.js [screenshotDir] [chromeProfileDir] [--only=seeker|phone] [--bail]
//   (defaults: <tmp>/potions-shots and <repo>/.local/chrome-potions; DevTools port 9496, its own throwaway profile)
//   POTIONS_WEB=<dir> runs it against another copy of the web folder (to prove the checks catch an injected defect).
// Runs twice, each with a fresh save: 915x412 at DPR 2.625 (the Seeker) and 800x360 at DPR 3 (a 20:9 phone). Each time:
//   the level map: the three modes and ten levels a page, both pages, touch targets, nothing overlapping, padlocks;
//   Easy level 1 played to the treasure chest with real DRAGS and real TAPS (3 stars, coins, save, results);
//   a wrong mix and the burp; an undo (while pouring and while mixing); the snap by mode; the hint; the dots;
//   a Hard three-bottle round (reached through the __dbg hooks, then real touches); the swatch, the liquid and the bloom
//   read back from the canvas pixels are one colour; the save across a reload; home and window.__back.
// Once, at the Seeker size: IsabellaStore, mute (isabella.save is only read), held upright, frame cost, the 4 s hold.
// Exits 1 on any failed check or any console error, warning or exception.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const WEB = path.resolve(process.env.POTIONS_WEB || path.join(ROOT, 'web'));
const PAGE = 'file://' + path.join(WEB, 'games/potions/index.html');
const HUB = 'file://' + path.join(WEB, 'index.html');
const L = require(path.join(WEB, 'games/potions/logic.js'));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ONLY = ((process.argv.find((a) => a.startsWith('--only=')) || '').split('=')[1]) || '';
const OUT = path.resolve(args[0] || path.join(os.tmpdir(), 'potions-shots'));
const PROFILE = path.resolve(args[1] || path.join(ROOT, '.local/chrome-potions'));
const PORT = 9496;
const SAVE_KEY = 'game.potions.save';

const results = [], problems = [];
// Chrome refuses to start sound without a tap; inside the Android app's WebView it needs none (that page is the 'app' run).
// And our own pixel read-back makes Chrome suggest a canvas hint.
// Chrome's autoplay note is not a defect: it comes from the fake Android store starting sound before a
// gesture, which the app's WebView allows and headless Chrome does not. It can be logged under any
// run label, so it is ignored wherever it appears.
const realProblems = () => problems.filter((p) => p.where !== 'blank' && !/AudioContext was not allowed/.test(p.text) && !/willReadFrequently/.test(p.text));
let chrome = null;
const BAIL = process.argv.includes('--bail');   // stop at the first failed check (the defect runs use it to save time)
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail != null ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
  if (BAIL && !ok) { try { chrome && chrome.kill(); } catch (e) { /* gone */ } process.exit(1); }
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(path.dirname(PROFILE), { recursive: true });
  const cdp = await launch({ port: PORT, profile: PROFILE, width: 915, height: 412 });
  chrome = cdp.proc;
  let where = 'blank';
  cdp.on((m) => {
    const p = m.params || {};
    if (m.method === 'Runtime.exceptionThrown') problems.push({ where, kind: 'exception', text: (p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text });
    if (m.method === 'Runtime.consoleAPICalled' && /^(error|warning|assert)$/.test(p.type)) problems.push({ where, kind: 'console.' + p.type, text: p.args.map((a) => (a.value != null ? a.value : a.description)).join(' ') });
    if (m.method === 'Log.entryAdded' && /^(error|warning)$/.test(p.entry.level)) problems.push({ where, kind: 'log.' + p.entry.level, text: p.entry.text + (p.entry.url ? ' ' + p.entry.url : '') });
  });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });

  let W = 915, HT = 412, DPR = 2.625;
  const viewport = async (w, h, dpr) => { W = w; HT = h; DPR = dpr; await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: true }); };
  const ev = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + expr.slice(0, 90) + ' :: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  const D = (expr) => ev(`window.__dbg.${expr}`);
  const st = () => D('state()');
  async function go(url, label) { where = label; const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url }); await loaded; await sleep(500); }
  async function reload() { const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.reload', { ignoreCache: true }); await loaded; await sleep(500); await waitFor(() => ev("!!window.__dbg && window.__dbg.state().screen === 'levels'"), 5000); }
  // Open the game with storage set up by `js`. It runs as the new page starts, AFTER the old page has gone:
  // a page writes its save as it closes (pagehide), so storage changed while it is open would be overwritten.
  async function loadWith(js, query, label) {
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { ${js} } catch (e) {} })();` });
    await go(PAGE + (query || ''), label || 'potions');
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  const fresh = (query) => loadWith('localStorage.clear();', query);
  async function shot(name) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 1200 / (W * DPR) } });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  }
  async function waitFor(fn, ms, every) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 8000)) { const v = await fn(); if (v) return v; await sleep(every || 60); }
    return null;
  }
  const pt = (x, y, id) => ({ x, y, id: id || 1, radiusX: 10, radiusY: 10, force: 1 });
  async function touchTap(x, y) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(x, y)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function tapEl(sel) {
    const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await touchTap(r.x, r.y);
  }
  async function touchDrag(a, b, o) {
    o = o || {};
    const steps = o.steps || 12;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(a.x, a.y)] });
    await sleep(30);
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u)] });
      await sleep(16);
    }
    if (o.beforeEnd) await o.beforeEnd();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  const rectOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, shown: getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' }; })()`);
  const overlap = (p, q) => p.x < q.r - 1 && q.x < p.r - 1 && p.y < q.b - 1 && q.y < p.b - 1;
  const bottleOf = (s, id) => s.bottles.find((b) => b.id === id);
  // pixels of the canvas at a world point: the colour of what is drawn there (read between frames)
  async function pixels(points) {
    const s = await st();
    return ev(`(() => { const c = document.getElementById('c'), x = c.getContext('2d'), s = ${s.scale}; return ${JSON.stringify(points)}.map((p) => { const d = x.getImageData(Math.round(p[0] * s), Math.round(p[1] * s), 1, 1).data; return [d[0], d[1], d[2]]; }); })()`);
  }
  async function pourReal(id, how, o) {
    const ok = await waitFor(async () => { const s = await st(), b = bottleOf(s, id); return s.screen === 'play' && s.phase === 'play' && s.rules.phase === 'filling' && !s.show && b.settled && !b.used && !s.active && s.queue === 0; }, 12000);
    if (!ok) throw new Error('bottle ' + id + ' never became ready');
    const s = await st(), b = bottleOf(s, id);
    if (how === 'tap') await touchTap(b.hcx, b.hcy);
    else await touchDrag({ x: b.hcx, y: b.hcy }, { x: s.cauldron.cx + (b.hcx < s.cauldron.cx ? -8 : 8), y: s.cauldron.cy - 20 }, o);
    return waitFor(async () => bottleOf(await st(), id).used, 3000);
  }
  // pour the whole recipe of the current flower with real touches (hows: 'tap' or 'drag' per bottle), then wait for the show to end
  async function solveFlower(hows, o) {
    const s0 = await st(), rec = s0.rules.recipe, r0 = s0.rules.r, f0 = s0.rules.f;
    for (let i = 0; i < rec.length; i++) { if (!(await pourReal(rec[i], hows[i % hows.length]))) throw new Error('pour not taken: ' + rec[i]); }
    if (o && o.during) await o.during();
    await waitFor(async () => (await st()).show, 12000);
    if (o && o.atShow) await o.atShow();
    return waitFor(async () => { const s = await st(); return !s.show && (s.phase !== 'play' || s.rules.r !== r0 || s.rules.f !== f0 || s.rules.done); }, 14000);
  }
  async function playLevelReal(hows) {
    let guard = 0, k = 0;
    while (guard++ < 30) {
      const s = await st();
      if (s.phase !== 'play') break;
      await solveFlower([hows[k % hows.length], hows[(k + 1) % hows.length]]); k++;
    }
  }

  const sizes = [{ tag: 'seeker', w: 915, h: 412, dpr: 2.625 }, { tag: 'phone', w: 800, h: 360, dpr: 3 }].filter((z) => !ONLY || z.tag === ONLY);
  for (const z of sizes) {
    const tag = z.tag;
    await viewport(z.w, z.h, z.dpr);
    await fresh();
    let s = await st();

    // ---------------- the level map ----------------
    check(`${tag}: opens on the level map, no console errors so far`, s.screen === 'levels' && realProblems().length === 0, `${s.screen}, ${realProblems().length} problems`);
    check(`${tag}: the canvas fills the screen at the capped pixel ratio`, s.canvas[0] === Math.round(z.w * Math.min(z.dpr, 2.5)) && s.canvas[1] === Math.round(z.h * Math.min(z.dpr, 2.5)), s.canvas);
    const modes = {};
    for (const m of L.MODES) modes[m] = await rectOf('#mode-' + m + ' .disc');
    const modeAreas = {};
    for (const m of L.MODES) modeAreas[m] = await rectOf('#mode-' + m);
    check(`${tag}: three mode buttons (a wand with one, two, three sparkles), each a touch target of at least 19vh`, L.MODES.every((m) => modeAreas[m] && modeAreas[m].w >= 0.19 * z.h - 1 && modeAreas[m].h >= 0.19 * z.h - 1), L.MODES.map((m) => Math.round(modeAreas[m].h)).join('/') + ' px');
    check(`${tag}: the mode picker shows the saved mode pressed (Easy on a fresh save) and sparkles 1, 2, 3`, await ev(`document.querySelector('#mode-easy').classList.contains('on') && !document.querySelector('#mode-medium').classList.contains('on') && !document.querySelector('#mode-hard').classList.contains('on') && ['easy','medium','hard'].every((m, i) => document.querySelector('#mode-' + m + ' svg').querySelectorAll('path[fill="#fff"], path[fill="#ffe9a8"]').length === i + 1)`));
    let lv = await ev(`[...document.querySelectorAll('.lvl')].map((e) => { const b = e.getBoundingClientRect(); return { n: +e.dataset.n, x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, locked: e.classList.contains('locked') }; })`);
    check(`${tag}: ten levels on page 1, numbered 1-10, only level 1 open`, lv.length === 10 && lv.every((e, i) => e.n === i + 1) && !lv[0].locked && lv.slice(1).every((e) => e.locked));
    check(`${tag}: every level bubble is a touch target of at least 19vh`, lv.every((e) => e.w >= 0.19 * z.h - 1 && e.h >= 0.19 * z.h - 1), Math.round(Math.min(...lv.map((e) => e.w))) + ' px, 19vh = ' + Math.round(0.19 * z.h));
    const home = await rectOf('#homeBtn'), pill = await rectOf('.pill'), prev = await rectOf('#pgPrev'), next = await rectOf('#pgNext');
    let clash = [];
    for (let i = 0; i < lv.length; i++) { for (let j = i + 1; j < lv.length; j++) if (overlap(lv[i], lv[j])) clash.push(`lvl${lv[i].n}/lvl${lv[j].n}`); for (const [nm, r] of Object.entries({ home, pill, mode1: modeAreas.easy, mode2: modeAreas.medium, mode3: modeAreas.hard, next })) if (r && overlap(lv[i], r)) clash.push(`lvl${lv[i].n}/${nm}`); }
    for (const [a, ra] of Object.entries({ home, pill })) for (const [b, rb] of Object.entries({ m1: modeAreas.easy, m2: modeAreas.medium, m3: modeAreas.hard })) if (overlap(ra, rb)) clash.push(`${a}/${b}`);
    check(`${tag}: nothing on the level map overlaps (levels, modes, home, coin count, arrows)`, clash.length === 0, clash.join(' '));
    check(`${tag}: everything fits on screen`, lv.every((e) => e.x >= 0 && e.r <= z.w && e.y >= 0 && e.b <= z.h) && next.r <= z.w && next.b <= z.h && pill.r <= z.w);
    check(`${tag}: the next-page arrow is a 19vh touch target and the back arrow is hidden on page 1`, next.w >= 0.19 * z.h - 1 && !prev.shown);
    await shot(`${tag}-levels-1`);
    // page 2
    await tapEl('#pgNext'); await sleep(250);
    s = await st();
    lv = await ev(`[...document.querySelectorAll('.lvl')].map((e) => ({ n: +e.dataset.n, locked: e.classList.contains('locked') }))`);
    check(`${tag}: page 2 is World 2: levels 11-20, all still locked on a fresh save, the dots and the cloud say page 2`, s.page === 1 && lv.length === 10 && lv.every((e, i) => e.n === 11 + i && e.locked)
      && await ev(`document.querySelectorAll('#pgDots span')[1].classList.contains('on') && document.querySelector('#worldIcon use').getAttribute('href') === '#i-cloud'`));
    await shot(`${tag}-levels-2`);
    await tapEl('.lvl[data-n="11"]'); await sleep(300);
    check(`${tag}: a padlocked level stays on the map (it shakes)`, (await st()).screen === 'levels' && await ev(`document.querySelector('.lvl[data-n="11"]').classList.contains('shake')`));
    await tapEl('#pgPrev'); await sleep(200);
    check(`${tag}: the back arrow returns to page 1`, (await st()).page === 0);
    // modes
    for (const m of ['hard', 'medium', 'easy']) {
      await tapEl('#mode-' + m); await sleep(150);
      s = await st();
      check(`${tag}: tapping ${m} shows ${m} pressed and remembers it in the save`, s.mode === m && await ev(`document.querySelector('#mode-${m}').classList.contains('on')`) && JSON.parse(await D('saved()')).mode === m);
    }
    await tapEl('#mode-medium'); await sleep(100); await tapEl('#mode-easy'); await sleep(100);

    // ---------------- Easy level 1 to the chest: real drags and real taps ----------------
    await tapEl('.lvl[data-n="1"]'); await sleep(400);
    s = await st();
    check(`${tag}: level 1 opens on a tap; Easy, 5 rounds, the first flower asks one bottle on its own`, s.screen === 'play' && s.level === 1 && s.mode === 'easy' && s.rules.nRounds === 5 && s.rules.recipe.length === 1, JSON.stringify(s.rules.recipe));
    check(`${tag}: three bottles on the shelf, the dots hint is on, the thought bubble is up, the rotate overlay is not`, s.bottles.length === 3 && s.dots === true && (await rectOf('#rotate')).shown === false);
    await waitFor(async () => (await st()).bottles.every((b) => b.settled) && (await st()).flowers[0].bub > 0.9, 4000);
    s = await st();
    const need = 0.19 * z.h;
    const bsp = Math.min(...s.bottles.slice(1).map((b, i) => Math.abs(b.hcx - s.bottles[i].hcx)));
    check(`${tag}: bottles, cauldron, flower and bubble are all touch targets of at least 19vh`, s.bottles.every((b) => b.cr * 2 >= need) && s.cauldron.cr * 2 >= need && s.flowers[0].cr * 2 >= need && s.flowers[0].br * 2 >= need,
      `bottle ${Math.round(s.bottles[0].cr * 2)}, cauldron ${Math.round(s.cauldron.cr * 2)}, flower ${Math.round(s.flowers[0].cr * 2)}, bubble ${Math.round(s.flowers[0].br * 2)} px; 19vh = ${Math.round(need)}`);
    check(`${tag}: the bottles stand clear of each other and inside the screen`, bsp >= s.bottles[0].cr * 1.6 && s.bottles.every((b) => b.hcx > 20 && b.hcx < z.w - 20 && b.hcy > 0 && b.hcy < z.h), `spacing ${Math.round(bsp)} px`);
    const hs = await rectOf('#homeBtn');
    check(`${tag}: the home button is clear of every bottle`, s.bottles.every((b) => Math.hypot(b.hcx - (hs.x + hs.w / 2), b.hcy - (hs.y + hs.h / 2)) > b.cr + hs.w / 2 - 10));
    await shot(`${tag}-play-start`);
    // the first round: a real DRAG of the one bottle
    const first = s.rules.recipe[0];
    const grabs0 = (await D('counters')).grabs;
    await solveFlower(['drag'], { atShow: async () => { await shot(`${tag}-bloom-mix`); } });
    s = await st();
    check(`${tag}: a real drag of the right bottle over the cauldron pours it and the first flower blooms (1 coin, round 2)`, s.rules.blooms === 1 && s.rules.coins === 1 && s.rules.r === 1 && (await D('counters')).grabs > grabs0 && s.rules.wrongs === 0, JSON.stringify({ blooms: s.rules.blooms, r: s.rules.r }));
    await waitFor(async () => (await st()).hud === 1, 3000);
    check(`${tag}: the coin flies up to the coin count (shown ${(await st()).hud}, earned ${s.rules.coins})`, (await st()).hud === 1);
    // round 2: real TAPS on both bottles of a two-bottle mix
    s = await st();
    const tapsBefore = (await D('counters')).taps;
    check(`${tag}: round 2 asks a two-bottle mix`, s.rules.recipe.length === 2, s.rules.recipe.join('+'));
    await solveFlower(['tap'], { during: async () => { await sleep(100); } });
    s = await st();
    check(`${tag}: two real taps pour two bottles and mix them: the flower blooms`, (await D('counters')).taps >= tapsBefore + 2 && s.rules.blooms === 2 && s.rules.r === 2, JSON.stringify({ blooms: s.rules.blooms, r: s.rules.r }));
    // the next rounds: a drag then a tap in each, to the chest
    await playLevelReal(['drag', 'tap']);
    await waitFor(async () => (await st()).chest, 8000);
    s = await st();
    check(`${tag}: after the last round the treasure chest rises`, s.chest === true && s.rules.done === true && s.rules.blooms === 5);
    await sleep(2200); await shot(`${tag}-chest`);
    await waitFor(async () => (await st()).results, 9000);
    s = await st();
    check(`${tag}: the results card shows 3 stars (no wrong mix), and the coins: 5 blooms + the Easy chest`, s.results && s.resultsStars === 3 && s.save.coins === 5 + L.CHEST_COINS.easy && (await ev(`document.getElementById('resCoins').textContent`)) === String(5 + L.CHEST_COINS.easy), `stars ${s.resultsStars}, coins ${s.save.coins}`);
    check(`${tag}: the save has 3 stars on Easy 1, Easy 2 unlocked, the other modes untouched`, s.save.stars.easy[0] === 3 && s.save.unlocked.easy === 2 && s.save.unlocked.medium === 1 && s.save.unlocked.hard === 1 && s.save.chests === 1, JSON.stringify(s.save.unlocked));
    const rb = [await rectOf('#resLevels'), await rectOf('#resReplay'), await rectOf('#resNext')];
    check(`${tag}: the three result buttons are touch targets of at least 19vh and do not overlap`, rb.every((r) => r.w >= need - 1) && !overlap(rb[0], rb[1]) && !overlap(rb[1], rb[2]));
    await shot(`${tag}-results`);
    // reload: progress is kept
    const raw = await D('saved()');
    await reload();
    s = await st();
    check(`${tag}: after a reload the save is back: Easy 2 open, 3 stars on Easy 1, coins kept, mode Easy`, s.save.unlocked.easy === 2 && s.save.stars.easy[0] === 3 && s.save.coins === 5 + L.CHEST_COINS.easy && s.mode === 'easy', JSON.stringify({ raw, now: s.save, mode: s.mode }));
    const shape = JSON.parse(raw);
    check(`${tag}: the save has the fairy shape (v 1, mode, unlocked and stars per mode, coins) under game.potions.save`, shape.v === 1 && ['easy', 'medium', 'hard'].every((m) => shape.stars[m].length === 20 && typeof shape.unlocked[m] === 'number') && typeof shape.coins === 'number' && shape.mode === 'easy' && (await ev(`localStorage.getItem('${SAVE_KEY}') !== null`)));
    // Easy level 2 now opens from the map
    await tapEl('.lvl[data-n="2"]'); await sleep(300);
    check(`${tag}: level 2 now opens from the map`, (await st()).level === 2);

    // ---------------- a wrong mix and the burp (Easy level 3: two-bottle mixes) ----------------
    await fresh('?level=1');   // a fresh save: level 1 only; the hooks open level 3
    await D("start(3, 'easy')"); await sleep(300);
    s = await st();
    const rec = s.rules.recipe, wrongId = s.rules.table.find((b) => !rec.includes(b));
    await waitFor(async () => (await st()).bottles.every((b) => b.settled), 3000);
    await pourReal(wrongId, 'tap');
    await pourReal(rec[0], 'tap');
    await waitFor(async () => (await st()).show === 'wrong', 8000);
    await sleep(350);
    s = await st();
    const expectWrong = L.mixColour([wrongId, rec[0]]);
    const [liq] = await pixels([[s.cauldron.x, s.cauldron.y - s.cauldron.r * 0.68 + 3]]);
    check(`${tag}: a wrong mix burps: show = wrong, a cloud of the wrong colour, the flower tilts its head, nothing is lost`, s.show === 'wrong' && s.parts > 3 && s.flowers[0].tilt < -0.05 && s.rules.coins === 0 && s.rules.blooms === 0, JSON.stringify({ tilt: +s.flowers[0].tilt.toFixed(2), parts: s.parts }));
    check(`${tag}: the liquid in the cauldron is the wrong mix's own colour (read from the canvas)`, dist(liq, rgb(expectWrong)) < 40, `${liq} vs ${expectWrong}`);
    await shot(`${tag}-burp`);
    await waitFor(async () => { const t = await st(); return !t.show && t.rules.phase === 'filling'; }, 6000);
    s = await st();
    check(`${tag}: after the burp the cauldron is empty, every bottle is back, the same flower waits, one wrong mix is counted`, s.rules.wrongs === 1 && s.rules.poured.length === 0 && s.cauldron.layers.length === 0 && s.bottles.every((b) => !b.used) && s.flowers[0].bloom === 0 && s.rules.r === 0);
    await solveFlower(['tap', 'tap']);
    s = await st();
    check(`${tag}: the right mix then blooms the very same flower`, s.rules.blooms === 1 && s.rules.r === 1 && s.rules.wrongs === 1);

    // ---------------- undo ----------------
    await D("start(3, 'easy')"); await sleep(300);
    await waitFor(async () => (await st()).bottles.every((b) => b.settled), 3000);
    s = await st();
    const r3 = s.rules.recipe;
    await pourReal(r3[0], 'drag');
    await waitFor(async () => { const t = await st(); return t.cauldron.layers.length === 1 && bottleOf(t, r3[0]).state === 'home'; }, 4000);
    s = await st();
    check(`${tag}: after one pour the bottle waits faded on the shelf and its colour is in the cauldron`, bottleOf(s, r3[0]).used && s.cauldron.layers.length === 1 && s.rules.poured.length === 1);
    await touchTap(s.cauldron.cx, s.cauldron.cy);
    await sleep(500);
    s = await st();
    check(`${tag}: a tap on the cauldron takes the pour back: the bottle hops home free again, the cauldron empties, nothing counted wrong`, s.rules.poured.length === 0 && !bottleOf(s, r3[0]).used && s.cauldron.layers.length === 0 && s.rules.wrongs === 0 && s.rules.undos === 1);
    // the bottle can be used again
    await pourReal(r3[0], 'tap');
    // undo in the middle of the pour of the last bottle (real time)
    const second = r3[1];
    await waitFor(async () => bottleOf(await st(), r3[0]).state === 'home' && (await st()).cauldron.layers.length === 1, 4000);
    await pourReal(second, 'tap');
    await sleep(500);
    s = await st();
    const midPour = bottleOf(s, second).state;
    await touchTap(s.cauldron.cx, s.cauldron.cy);
    await sleep(900);
    s = await st();
    check(`${tag}: a tap on the cauldron while the last bottle is still pouring (${midPour}) undoes that pour: the mix never completes and no wrong mix is counted`, s.rules.poured.length === 1 && s.rules.poured[0] === r3[0] && !bottleOf(s, second).used && s.rules.wrongs === 0 && s.show === null && s.rules.phase === 'filling');
    await pourReal(second, 'tap');
    await waitFor(async () => (await st()).mixT > 0.3, 6000);
    s = await st();
    await touchTap(s.cauldron.cx, s.cauldron.cy);
    await sleep(700);
    s = await st();
    check(`${tag}: a tap on the cauldron while the colours blend undoes the last pour before the mix completes`, s.rules.poured.length === 1 && s.show === null && s.rules.wrongs === 0 && s.rules.blooms === 0 && s.rules.undos === 3 && s.mixT < 0, JSON.stringify({ undos: s.rules.undos }));
    await touchTap(s.cauldron.cx, s.cauldron.cy); await sleep(300);
    s = await st();
    check(`${tag}: another tap takes the first pour back too: the cauldron is empty again`, s.rules.poured.length === 0 && s.rules.undos === 4 && s.cauldron.layers.length === 0);
    await touchTap(s.cauldron.cx, s.cauldron.cy); await sleep(300);
    check(`${tag}: a tap on an empty cauldron does nothing`, (await st()).rules.undos === 4 && (await st()).rules.poured.length === 0);
    // a bottle already in the cauldron does not pour twice
    await pourReal(r3[0], 'tap');
    await waitFor(async () => bottleOf(await st(), r3[0]).state === 'home', 4000);
    s = await st();
    const nopes0 = (await D('counters')).nopes;
    await touchTap(bottleOf(s, r3[0]).hcx, bottleOf(s, r3[0]).hcy); await sleep(200);
    s = await st();
    check(`${tag}: tapping a bottle that is already in the cauldron shakes it and pours nothing`, s.rules.poured.length === 1 && (await D('counters')).nopes === nopes0 + 1);

    // ---------------- drags: let go away from the cauldron, the snap by mode ----------------
    await D("start(1, 'easy')"); await sleep(300);
    await waitFor(async () => (await st()).bottles.every((b) => b.settled), 3000);
    s = await st();
    const b0 = s.bottles.find((b) => b.id === s.rules.recipe[0]);
    await touchDrag({ x: b0.hcx, y: b0.hcy }, { x: z.w * 0.1, y: z.h * 0.6 });   // let go out on the grass, far from the cauldron
    await sleep(500);
    s = await st();
    check(`${tag}: a bottle dragged and let go away from the cauldron glides home and pours nothing`, s.rules.poured.length === 0 && bottleOf(s, b0.id).state === 'home' && s.rules.pours === 0);
    const snaps = {};
    for (const m of ['easy', 'hard']) {
      await D(`start(1, '${m}')`); await sleep(300);
      await waitFor(async () => (await st()).bottles.every((b) => b.settled), 3000);
      s = await st();
      const rcp = s.rules.recipe[0], b = bottleOf(s, rcp), c = s.cauldron;
      // let go this far (world units) from the cauldron's centre: just inside Easy's snap, outside Hard's
      const R = c.r + 105 - 12, ang = Math.PI / 2 + (b.hcx < c.cx ? -0.3 : 0.3), tx = c.cx + (R * Math.cos(ang) * s.scale) / s.dpr, ty = c.cy + (R * Math.sin(ang) * s.scale) / s.dpr;
      await touchDrag({ x: b.hcx, y: b.hcy }, { x: tx, y: ty }, { steps: 14 });
      await sleep(300);
      s = await st();
      snaps[m] = s.rules.poured.length === 1;
      snaps[m + 'Info'] = { held: s.held, grabs: (await D('counters')).grabs, drops: (await D('counters')).drops, poured: s.rules.poured, target: [Math.round(tx), Math.round(ty)], bottle: [Math.round(b.hcx), Math.round(b.hcy)], states: s.bottles.map((x) => x.state).join(), show: s.show, ready: s.rules.phase };
      await sleep(1500);
    }
    check(`${tag}: the snap follows the mode: a bottle let go 93 units from the cauldron's edge pours on Easy and not on Hard`, snaps.easy === true && snaps.hard === false, JSON.stringify(snaps));
    const sn = {};
    for (const m of L.MODES) { await D(`start(1, '${m}')`); sn[m] = (await st()).snap; }
    check(`${tag}: the snap distances are Easy ${L.SNAP.easy} > Medium ${L.SNAP.medium} > Hard ${L.SNAP.hard}, as the game reports them`, sn.easy === L.SNAP.easy && sn.medium === L.SNAP.medium && sn.hard === L.SNAP.hard && sn.easy > sn.medium && sn.medium > sn.hard);

    // ---------------- the hint and the dots, by mode ----------------
    const hs2 = {};
    for (const [m, n] of [['easy', 1], ['medium', 1], ['hard', 1], ['easy', 4], ['medium', 7], ['easy', 7], ['hard', 11]]) { await D(`start(${n}, '${m}')`); const t = await st(); hs2[m + n] = { hint: t.hintDelay, dots: t.dots, bottles: t.bottles.length }; }
    check(`${tag}: hint delay 8 / 15 / 25 s by mode; the dots only on Easy 1-3`, hs2.easy1.hint === 8 && hs2.medium1.hint === 15 && hs2.hard1.hint === 25 && hs2.easy1.dots === true && hs2.medium1.dots === false && hs2.hard1.dots === false && hs2.easy4.dots === false, JSON.stringify(hs2));
    check(`${tag}: bottles on the table by mode: Easy 1 has 3, Easy 4 and 7 have 4, Medium 7 has 5, Hard 11 has 5`, hs2.easy1.bottles === 3 && hs2.easy4.bottles === 4 && hs2.easy7.bottles === 4 && hs2.medium7.bottles === 5 && hs2.hard11.bottles === 5);
    await D("start(3, 'easy')"); await sleep(400);
    await D('timeScale(12)');
    const hinted = await waitFor(async () => (await st()).hint, 3000, 80);
    await D('timeScale(1)');
    s = await st();
    check(`${tag}: after a quiet spell on Easy the hint hand points at the first bottle still needed`, hinted && hinted.kind === 'bottle' && s.rules.recipe.includes(hinted.id) && hinted.id === s.rules.table.find((b) => s.rules.recipe.includes(b)), JSON.stringify(hinted));
    await shot(`${tag}-hint`);
    await touchTap(5, z.h / 2); await sleep(80);
    check(`${tag}: a touch puts the hint away`, (await st()).hint === null);
    // a wrong bottle in the cauldron: the hint points at the cauldron (take it back)
    s = await st();
    const wb = s.rules.table.find((b) => !s.rules.recipe.includes(b));
    await pourReal(wb, 'tap');
    await waitFor(async () => bottleOf(await st(), wb).state === 'home', 4000);
    await D('timeScale(12)');
    const h2 = await waitFor(async () => (await st()).hint, 3000, 80);
    await D('timeScale(1)');
    check(`${tag}: with a wrong bottle in the cauldron the hint hand taps the cauldron (take it back)`, h2 && h2.kind === 'undo', JSON.stringify(h2));

    // ---------------- Easy level 1: the dots and the swatch ----------------
    await D("start(3, 'easy')"); await sleep(1500);
    s = await st();
    const sx = s.scale, flowerX = s.flowers[0].cx * s.dpr / sx;
    await shot(`${tag}-dots`);

    // ---------------- a Hard three-bottle round: the swatch, the liquid and the bloom are one colour ----------------
    await D("start(11, 'hard')"); await sleep(200);
    await D('timeScale(4)');
    // earlier rounds through the hooks (the same rule code as a tap), the three-bottle round with real touches
    let guard = 0;
    while (guard++ < 200) {
      s = await st();
      if (s.phase !== 'play' || s.rules.recipe.length === 3) break;
      if (!s.show && s.rules.phase === 'filling' && !s.active && s.queue === 0) { const need2 = s.rules.recipe.filter((id) => !s.rules.poured.includes(id)); if (need2.length) await D(`pour('${need2[0]}')`); }
      await sleep(80);
    }
    await D('timeScale(1)');
    s = await st();
    check(`${tag}: Hard level 11 reaches a round that asks a three-bottle mix (the last round), with five bottles on the shelf`, s.rules.recipe.length === 3 && s.rules.r === 5 && s.bottles.length === 5 && s.dots === false, s.rules.recipe.join('+'));
    await waitFor(async () => (await st()).flowers[0].bub > 0.9 && (await st()).bottles.every((bb) => bb.settled), 5000);
    s = await st();
    const want = s.rules.colour, fl0 = s.flowers[0];
    const [swatch] = await pixels([[(fl0.bx * s.dpr) / s.scale, (fl0.by * s.dpr) / s.scale]]);
    check(`${tag}: the swatch in the thought bubble is the colour the table makes for this recipe (read from the canvas)`, dist(swatch, rgb(want)) < 20 && want === L.mixColour(s.rules.recipe), `${swatch} vs ${want}`);
    const hows = ['drag', 'tap', 'drag'];
    for (let i = 0; i < 3; i++) await pourReal(s.rules.recipe[i], hows[i]);
    check(`${tag}: three real pours (drag, tap, drag) fill the mix`, (await st()).rules.poured.length === 3 && (await st()).rules.phase === 'mixing');
    await waitFor(async () => (await st()).show === 'bloom', 9000);
    await sleep(2200);
    s = await st();
    // the flower's head is 108*1.2 units above the ground; sample a ring of points around it
    const ground = 392, hy = ground - 129.6, hx = (s.flowers[0].cx * s.dpr) / s.scale;
    const ring = []; for (let k = 0; k < 16; k++) ring.push([hx + Math.cos(k / 16 * 6.283) * 33, hy + Math.sin(k / 16 * 6.283) * 33]);
    const petals = await pixels(ring);
    const liqPts = await pixels([-30, -12, 0, 12, 30].map((dx) => [s.cauldron.x + dx, s.cauldron.y - s.cauldron.r * 0.68 + 3]));
    const liq2 = liqPts.reduce((a, p) => (dist(p, rgb(want)) < dist(a, rgb(want)) ? p : a));
    const near = petals.filter((p) => dist(p, rgb(want)) < 12).length;
    check(`${tag}: the bloom is the swatch's colour (${near} of 16 points on the flower's petals read ${want} on the canvas) and the flower is open`, near >= 3 && s.flowers[0].bloom > 0.9, `${near}/16`);
    check(`${tag}: the liquid in the cauldron when the flower blooms is that same colour too`, dist(liq2, rgb(want)) < 40, `${liq2} vs ${want}; table colour ${s.cauldron.surface}`);
    await shot(`${tag}-hard-three`);
    await D('timeScale(4)');
    await waitFor(async () => (await st()).phase !== 'play' || (await st()).rules.done, 20000);
    await D('timeScale(1)');

    // ---------------- stars: wrong mixes cost stars through the whole game path ----------------
    await fresh();
    await D("start(1, 'easy')"); await D('timeScale(4)'); await sleep(200);
    guard = 0;
    let doneWrong = 0;
    while (guard++ < 400) {
      s = await st();
      if (s.phase !== 'play') break;
      if (!s.show && s.rules.phase === 'filling' && !s.active && s.queue === 0) {
        if (doneWrong < 2 && s.rules.recipe.length === 2) { const bad = s.rules.table.filter((b) => !s.rules.recipe.includes(b)); if (bad.length && s.rules.poured.length === 0) { await D(`pour('${bad[0]}')`); await D(`pour('${s.rules.recipe[0]}')`); doneWrong++; await sleep(200); continue; } }
        const need2 = s.rules.recipe.filter((id) => !s.rules.poured.includes(id)); if (need2.length) await D(`pour('${need2[0]}')`);
      }
      await sleep(70);
    }
    await waitFor(async () => (await st()).results, 15000);
    await D('timeScale(1)');
    s = await st();
    check(`${tag}: two wrong mixes then a finished level give 2 stars on the results card and in the save (wrongs counted: ${s.save.wrongs})`, s.results && s.resultsStars === 2 && s.save.stars.easy[0] === 2 && s.save.wrongs === 2 && s.rules.wrongs === 2, `stars ${s.resultsStars}`);
    // replay keeps the better result; next opens level 2
    await tapEl('#resReplay'); await sleep(300);
    s = await st();
    check(`${tag}: Play again restarts the level from round 1 with a fresh table`, s.level === 1 && s.rules.r === 0 && s.rules.coins === 0 && s.screen === 'play');

    // ---------------- home and back ----------------
    await tapEl('#gridBtn'); await sleep(300);
    check(`${tag}: the levels button returns to the map`, (await st()).screen === 'levels');
    await tapEl('.lvl[data-n="1"]'); await sleep(300);
    const nav = cdp.once('Page.frameNavigated', 5000).catch(() => null);
    await tapEl('#homeBtn');
    await nav; await sleep(300);
    const href1 = await ev('location.href');
    check(`${tag}: the home button opens ../../index.html`, href1 === HUB, href1.replace(WEB, ''));
    await go(PAGE, 'potions'); await sleep(200);
    const ret = await ev('window.__back()');
    await sleep(500);
    const href2 = await ev('location.href');
    check(`${tag}: window.__back() returns true and opens ../../index.html`, ret === true && href2 === HUB, href2.replace(WEB, ''));
    await go(PAGE, 'potions');
  }

  // ---------------- once: the app's storage, mute, upright, frame cost, the grown-ups' hold ----------------
  if (!ONLY || ONLY === 'seeker') {
    await viewport(915, 412, 2.625);
    await loadWith(`window.__store = {}; window.IsabellaStore = { get: (k) => (k in window.__store ? window.__store[k] : null), set: (k, v) => { window.__store[k] = v; } }; localStorage.clear();`, '', 'app');
    await D("start(3, 'easy')"); await D('timeScale(4)');
    let guard = 0;
    while (guard++ < 300) { const s = await st(); if (s.phase !== 'play') break; if (!s.show && s.rules.phase === 'filling' && !s.active && s.queue === 0) { const need = s.rules.recipe.filter((id) => !s.rules.poured.includes(id)); if (need.length) await D(`pour('${need[0]}')`); } await sleep(70); }
    await waitFor(async () => (await st()).results, 12000);
    await D('timeScale(1)');
    const stored = await ev(`window.__store['${SAVE_KEY}']`), ls = await ev(`localStorage.getItem('${SAVE_KEY}')`);
    check('IsabellaStore (the Android app): the save goes through window.IsabellaStore, not localStorage', !!stored && ls === null && JSON.parse(stored).stars.easy[2] === 3, stored && stored.slice(0, 60));

    await loadWith(`localStorage.clear(); localStorage.setItem('isabella.save', '{"muted":true,"gold":7}');`);
    let s = await st();
    check('mute: the sound is off when isabella.save says muted', s.muted === true && (s.gain === null || s.gain === 0 || s.audio === 'none'), JSON.stringify({ muted: s.muted, audio: s.audio }));
    await D("start(3, 'easy')"); await sleep(300);
    s = await st();
    await pourReal(s.rules.recipe[0], 'tap');
    await ev('window.__pause()'); await D('goLevels()'); await ev('window.__pause()');   // the game saves here, and when it is left
    const main = await ev(`localStorage.getItem('isabella.save')`);
    check('the game never writes isabella.save (read only)', main === '{"muted":true,"gold":7}', main);

    // held upright: the rotate overlay covers the screen and the game does not take touches
    await fresh();
    await D("start(3, 'easy')"); await sleep(1500);
    await viewport(412, 915, 2.625); await sleep(300);
    const rot = await rectOf('#rotate');
    s = await st();
    const pours0 = s.rules.pours;
    await touchTap(200, 600); await sleep(200);
    check('held upright: the rotate overlay is on and a tap does nothing', rot.shown && rot.w >= 410 && (await st()).rules.pours === pours0 && (await st()).bottles.every((b) => !b.used));
    await viewport(915, 412, 2.625); await sleep(300);
    check('turned back to landscape: the overlay goes', (await rectOf('#rotate')).shown === false);

    // frame cost over a stretch of play
    await fresh();
    await D("start(11, 'medium')"); await D('resetPerf()'); await sleep(200);
    await D('timeScale(2)');
    guard = 0;
    while (guard++ < 150) { const t = await st(); if (!t.show && t.rules.phase === 'filling' && !t.active && t.queue === 0) { const need = t.rules.recipe.filter((id) => !t.rules.poured.includes(id)); if (need.length) await D(`pour('${need[0]}')`); } await sleep(80); }
    await D('timeScale(1)');
    const perf = await D('perf()');
    check('frame cost stays small: mean under 12 ms, 95th percentile under 25 ms of JavaScript and drawing per frame (software renderer)', perf.avgMs < 12 && perf.p95Ms < 25, JSON.stringify({ avg: +perf.avgMs.toFixed(2), p95: +perf.p95Ms.toFixed(2), frames: perf.frames }));

    // grown-ups: hold the title for 4 seconds to open every level of the mode shown
    await fresh();
    const tt = await rectOf('#title');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(tt.x + tt.w / 2, tt.y + tt.h / 2)] });
    await sleep(4400);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(300);
    s = await st();
    check('holding the title for 4 seconds opens all 20 levels of the mode shown (and only that mode)', s.save.unlocked.easy === 20 && s.save.unlocked.medium === 1 && s.save.unlocked.hard === 1, JSON.stringify(s.save.unlocked));
    await tapEl('#mode-hard'); await sleep(200); await tapEl('#pgNext'); await sleep(200);
    check('a mode that was not opened still has its levels locked on page 2', (await ev(`[...document.querySelectorAll('.lvl')].every((e) => e.classList.contains('locked'))`)));
  }

  const bad = realProblems();
  check('no console errors, warnings or exceptions in any run', bad.length === 0, bad.slice(0, 3));
  const passed = results.filter((r) => r.ok).length, failed = results.length - passed;
  console.log(`\n${passed} passed, ${failed} failed`);
  cdp.close(); cdp.proc.kill();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('browser test crashed:', e); try { chrome && chrome.kill(); } catch (x) { /* gone */ } process.exit(2); });
