// Fairy Flight in headless Chrome, driven like a finger: real touch events through the DevTools protocol.
//   node test/games/flight/browser.js [screenshotDir] [chromeProfileDir] [--only=seeker|phone800|more]
//   (defaults: <repo>/.local/shots-flight and <repo>/.local/chrome-flight; DevTools port 9491, its own throwaway profile)
//   FLIGHT_WEB=<dir> runs it against another copy of the web folder (to prove the checks catch an injected defect).
// Runs twice, each with a fresh save: 915x412 at DPR 2.625 (the Seeker) and 800x360 at DPR 3 (a 20:9 phone).
//   level map: both pages (World 1, World 2 padlocked), the mode picker by touch (and remembered), every target 19vh or more,
//   nothing overlapping -> Easy level 1 played to the chest with a real finger: a hand shows the slide, the finger flies her,
//   plants bloom and pay coins that fly to the coin row, the key is taken, the chest bursts open, 3 stars, the save is written,
//   level 2 opens (and stays open after a reload) -> a bonk on Easy (nothing lost) and on Medium (one coin, never below 0)
//   -> home button, window.__back, window.__pause.
// Once, at the Seeker size: every forest mid-play (screenshots), the Android store, mute, held upright, frame rate, hold-to-open.
// Exits 1 on any failed check or any console error, warning or exception.
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp');
const { sweep } = require('./sweep');

const ROOT = path.resolve(__dirname, '../../..');
const WEB = path.resolve(process.env.FLIGHT_WEB || path.join(ROOT, 'web'));
const PAGE = 'file://' + path.join(WEB, 'games/flight/index.html');
const HUB = 'file://' + path.join(WEB, 'index.html');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const OUT = path.resolve(args[0] || path.join(ROOT, '.local/shots-flight'));
const PROFILE = path.resolve(args[1] || path.join(ROOT, '.local/chrome-flight'));
const PORT = 9491;
const L = require(path.join(WEB, 'games/flight/logic.js'));

const results = [], shots = [], problems = [];
let chrome = null;   // killed on every exit path so the port is never left busy
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail != null ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
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
  async function go(url, label) { where = label; const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url }); await loaded; await sleep(400); }
  async function reload() { const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.reload', { ignoreCache: true }); await loaded; await sleep(400); }
  // Open the game with storage set up by `js`. It runs as the new page starts, AFTER the old page has gone:
  // a page writes its save as it closes (pagehide), so storage changed while it is open would be overwritten.
  async function loadWith(js, url) {
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { ${js} } catch (e) {} })();` });
    await go(url || PAGE, 'flight');
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  async function shot(name) {
    // about 1200 px wide whatever the device pixel ratio
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 1200 / (W * DPR) } });
    const f = path.join(OUT, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    shots.push(f);
    return f;
  }
  async function waitFor(fn, ms, every) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(every || 100); }
    return null;
  }
  const settle = (pred, ms) => waitFor(async () => { const s = await st(); return pred(s) ? s : null; }, ms || 12000, 80);
  // ---- one real finger ----
  const pt = (x, y) => ({ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 });
  const finger = { down: false, x: 0, y: 0 };
  async function fingerDown(x, y) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(x, y)] }); finger.down = true; finger.x = x; finger.y = y; }
  async function fingerMoveTo(x, y) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(x, y)] }); finger.x = x; finger.y = y; }
  async function fingerMove(x, y, steps) {
    const x0 = finger.x, y0 = finger.y, n = steps || 8;
    for (let i = 1; i <= n; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(x0 + ((x - x0) * i) / n, y0 + ((y - y0) * i) / n)] }); await sleep(16); }
    finger.x = x; finger.y = y;
  }
  async function fingerUp() { if (finger.down) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); finger.down = false; }
  async function touchTap(x, y) { await fingerDown(x, y); await fingerUp(); }
  const rectOf = (sel) => ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height, l: b.left, t: b.top, r: b.right, b: b.bottom }; })()`);
  async function tapEl(sel) { const r = await rectOf(sel); await touchTap(r.x, r.y); }
  async function holdEl(sel, ms) { const r = await rectOf(sel); await fingerDown(r.x, r.y); await sleep(ms); await fingerUp(); }

  // Fly her along the sweep's path for a whole course, a real finger moving every ~30 ms, at game speed `ts`.
  // The finger leads her by the easing's lag. Returns the state at the end (results showing) or after `maxMs`.
  async function flyPath(level, mode, ts, o) {
    o = o || {};
    const c = L.buildCourse(level, mode), sw = sweep(L, c, { speed: 0.6, path: true });
    if (!sw.ok) throw new Error('no path for ' + mode + level);
    await D(`timeScale(${ts})`);
    const t0 = Date.now(), maxMs = o.maxMs || 150000;
    let s = await st(), iters = 0, moved = 0;
    const shotsAt = (o.shotsAt || []).slice();
    await fingerDown(W * 0.3, HT * (s.y / 540));
    while (Date.now() - t0 < maxMs) {
      s = await st();
      if (s.screen === 'results' || s.results) break;
      iters++;
      if (process.env.FLIGHT_DEBUG && iters % 100 === 0) console.log('iter', iters, 't', s.t.toFixed(1), JSON.stringify(await D('counters')), 'fingerDown', s.fingerDown, 'finger', JSON.stringify(s.finger));
      if (s.phase === 'play') {
        const lead = 0.16 + 0.04 * ts, k = Math.min(sw.ys.length - 1, Math.max(0, Math.round((s.t + lead) / sw.dt)));
        await fingerMoveTo(W * 0.3, sw.ys[k] * s.k); moved++;
      } else if (finger.down) { await fingerUp(); }
      if (shotsAt.length && s.t >= shotsAt[0].t) { const sh = shotsAt.shift(); await shot(sh.name); }
      await sleep(25);
    }
    await fingerUp();
    await D('timeScale(1)');
    s.iters = iters; s.moved = moved;
    return s;
  }

  async function suite(w, h, dpr, tag) {
    console.log(`\n=== ${w}x${h} @ DPR ${dpr} ===`);
    await viewport(w, h, dpr);
    await loadWith('localStorage.clear()');
    await sleep(500);
    let s = await st();
    check(`${tag}: opens on the level map with a fresh save, Medium picked`, s.screen === 'levels' && s.mode === 'medium' && s.unlocked === 1 && s.savedStars.every((v) => v === 0) && s.page === 0, `screen ${s.screen}, mode ${s.mode}, unlocked ${s.unlocked}`);
    check(`${tag}: the canvas fills the screen with the pixel ratio capped at 2.5`, s.dpr === 2.5 && s.canvas[0] === Math.round(w * 2.5) && s.canvas[1] === Math.round(h * 2.5), `dpr ${s.dpr}, canvas ${s.canvas}`);

    // ---------- the level map and its mode picker ----------
    const layout = () => ev(`(() => {
      const vh = innerHeight / 100, vis = (e) => getComputedStyle(e).visibility !== 'hidden' && e.getClientRects().length > 0, R = (e) => e.getBoundingClientRect();
      const boxes = {}, add = (k, e) => { if (e && vis(e)) boxes[k] = R(e); };
      add('home', document.getElementById('home')); add('title', document.getElementById('title')); add('pill', document.querySelector('.pill'));
      for (const m of ['easy', 'medium', 'hard']) add('mode-' + m, document.getElementById('mode-' + m));
      document.querySelectorAll('.lvl').forEach((b, i) => add('lvl' + i, b));
      add('prev', document.getElementById('pgPrev')); add('next', document.getElementById('pgNext')); add('world', document.getElementById('worldText')); add('dots', document.getElementById('pgDots'));
      const keys = Object.keys(boxes), bad = [];
      for (let i = 0; i < keys.length; i++) {
        const a = boxes[keys[i]];
        if (a.left < -0.5 || a.top < -0.5 || a.right > innerWidth + 0.5 || a.bottom > innerHeight + 0.5) bad.push(keys[i] + ' off the screen');
        for (let j = i + 1; j < keys.length; j++) { const b = boxes[keys[j]]; if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) bad.push(keys[i] + ' x ' + keys[j]); }
      }
      const small = keys.filter((k) => /^(home|mode-|lvl|prev|next)/.test(k) && Math.min(boxes[k].width, boxes[k].height) < 19 * vh - 0.6).map((k) => k + ' ' + (Math.min(boxes[k].width, boxes[k].height) / vh).toFixed(1) + 'vh');
      return { n: keys.length, bad, small, lvls: keys.filter((k) => /^lvl/.test(k)).length };
    })()`);
    let lay = await layout();
    check(`${tag}: page 1 of the level map: three modes, ten levels, home and the page arrow, each a 19vh target or more, nothing overlapping or off the screen`, lay.lvls === 10 && lay.bad.length === 0 && lay.small.length === 0, lay.bad.concat(lay.small).join('; ') || `${lay.n} things`);
    const ui = await ev(`({ locked: document.querySelectorAll('.lvl.locked').length, on: [...document.querySelectorAll('.mode')].filter((b) => b.classList.contains('on')).map((b) => b.dataset.mode), dots: [...document.getElementById('pgDots').children].map((d) => d.classList.contains('on')), prevHidden: getComputedStyle(document.getElementById('pgPrev')).visibility, world: document.getElementById('worldText').textContent })`);
    check(`${tag}: level 1 is open, 2-10 padlocked; Medium is shown pressed; the dots show page 1`, ui.locked === 9 && ui.on.join() === 'medium' && ui.dots.join() === 'true,false' && ui.prevHidden === 'hidden', JSON.stringify(ui));
    await shot(`${tag}-01-level-map-world-1`);
    await tapEl('.lvl[data-level="2"]'); await sleep(150);
    check(`${tag}: a padlocked level only wiggles`, (await st()).screen === 'levels' && (await ev(`document.querySelector('.lvl[data-level="2"]').classList.contains('shake')`)));

    // the mode picker, by touch
    await tapEl('#mode-easy'); await sleep(150);
    s = await st();
    let saved = JSON.parse(await D('saved()'));
    check(`${tag}: a tap on one sparkle picks Easy: it is shown pressed and remembered in the save`, s.mode === 'easy' && (await ev(`document.getElementById('mode-easy').classList.contains('on') && !document.getElementById('mode-medium').classList.contains('on')`)) && saved.mode === 'easy', `mode ${s.mode}, saved ${saved.mode}`);
    await tapEl('#mode-hard'); await sleep(120);
    s = await st(); saved = JSON.parse(await D('saved()'));
    check(`${tag}: three sparkles picks Hard`, s.mode === 'hard' && saved.mode === 'hard');
    await tapEl('#mode-medium'); await sleep(120);
    check(`${tag}: two sparkles picks Medium`, (await st()).mode === 'medium');
    await tapEl('#mode-easy'); await sleep(120);

    // page 2: World 2
    await tapEl('#pgNext'); await sleep(200);
    lay = await layout();
    const ui2 = await ev(`({ n: document.querySelectorAll('.lvl').length, first: document.querySelector('.lvl').dataset.level, last: [...document.querySelectorAll('.lvl')].pop().dataset.level, locked: document.querySelectorAll('.lvl.locked').length, dots: [...document.getElementById('pgDots').children].map((d) => d.classList.contains('on')), nextHidden: getComputedStyle(document.getElementById('pgNext')).visibility, prevShown: getComputedStyle(document.getElementById('pgPrev')).visibility, world: document.getElementById('worldText').textContent })`);
    check(`${tag}: page 2 is World 2 (levels 11-20, all padlocked until level 10 is done), with the dots on page 2 and the arrow back`, ui2.n === 10 && ui2.first === '11' && ui2.last === '20' && ui2.locked === 10 && ui2.dots.join() === 'false,true' && ui2.nextHidden === 'hidden' && ui2.prevShown === 'visible' && /World 2/.test(ui2.world) && (await st()).page === 1, JSON.stringify(ui2));
    check(`${tag}: page 2 is laid out cleanly too`, lay.lvls === 10 && lay.bad.length === 0 && lay.small.length === 0, lay.bad.concat(lay.small).join('; '));
    await shot(`${tag}-02-level-map-world-2`);
    await tapEl('.lvl[data-level="11"]'); await sleep(150);
    check(`${tag}: level 11 is padlocked`, (await st()).screen === 'levels');
    await tapEl('#pgPrev'); await sleep(200);
    check(`${tag}: the arrow takes her back to World 1`, (await st()).page === 0 && (await ev(`document.querySelector('.lvl').dataset.level`)) === '1');

    // ---------- Easy level 1 by touch, to the chest ----------
    await tapEl('.lvl[data-level="1"]');
    s = await settle((q) => q.screen === 'play' && q.level === 1, 3000);
    check(`${tag}: a tap on level 1 starts it on Easy: the forest scrolls at 80 units a second, plants and a key ahead, the dust radius wide`,
      !!s && s.mode === 'easy' && s.speed === 80 && s.total === 6 && s.dust === 118 && s.plants.length === 6 && s.key && s.nEnemies === 0, s && `speed ${s.speed}, ${s.total} plants, dust ${s.dust}`);
    const clickable = s.plants.every((p) => p.cx > -9999);
    // before she is touched: she drifts to the middle height, nothing blooms by itself, the hand shows the slide
    s = await settle((q) => q.hint != null, 5000);
    check(`${tag}: before the first bloom a hand shows the finger sliding up or down to the next bud`, !!s && s.hint === 0 && s.fingerDown === false, s && `hint for plant ${s.hint}`);
    await shot(`${tag}-03-level-1-the-hand-shows-the-slide`);
    const hud = await ev(`(() => { const s = window.__dbg.state(); return { VW: s.VW, k: s.k }; })()`);
    check(`${tag}: the canvas world is 540 tall and as wide as the screen's shape (${(w / h * 540).toFixed(0)} units)`, Math.abs(hud.VW - (w / h) * 540) < 1.5, `VW ${hud.VW.toFixed(1)}`);

    // the finger: she flies to its height (and a little toward its x)
    const y1 = h * 0.2, y2 = h * 0.8;
    await fingerDown(w * 0.4, y1);
    s = await settle((q) => Math.abs(q.yClient - y1) < 4, 2500);
    const s1 = s;
    check(`${tag}: a finger anywhere on the screen is where she flies: she eases to its height (top)`, !!s1 && s1.fingerDown, s1 ? `she is at ${s1.yClient.toFixed(0)} px, finger at ${y1.toFixed(0)}` : `at ${(await st()).yClient.toFixed(0)}`);
    await fingerMove(w * 0.4, y2, 10);
    s = await settle((q) => Math.abs(q.yClient - y2) < 4, 2500);
    check(`${tag}: ...and down again to the bottom of the screen`, !!s, s ? `she is at ${s.yClient.toFixed(0)} px, finger at ${y2.toFixed(0)}` : `at ${(await st()).yClient.toFixed(0)}`);
    await fingerMove(w * 0.95, y2, 6);
    await sleep(900);
    s = await st();
    check(`${tag}: a finger far to the right moves her only a little: she stays on the left third (x ${s.x.toFixed(0)} of ${s.VW.toFixed(0)})`, s.x <= L.PX_HI + 1 && s.x > L.PX_NOM && s.x < s.VW / 3, `x ${s.x.toFixed(1)}`);
    await fingerMove(w * 0.1, y1, 8);
    await sleep(900);
    s = await st();
    check(`${tag}: and a finger far to the left, no further than the left of the band`, s.x >= L.PX_LO - 1 && s.x < L.PX_NOM, `x ${s.x.toFixed(1)}`);
    await fingerMove(w * 0.3, h * 0.9, 8);
    await sleep(200);
    await fingerUp();
    await sleep(1200);
    const sLift = await st();
    await sleep(2500);
    const sLift2 = await st();
    check(`${tag}: with the finger lifted she drifts gently toward the middle height (and slowly)`, sLift.y > sLift2.y && Math.abs(sLift.y - sLift2.y) < L.REST_VMAX * 2.7 && sLift2.y < 440 && !sLift2.fingerDown, `y ${sLift.y.toFixed(0)} -> ${sLift2.y.toFixed(0)}`);

    // play the whole of level 1 along the sweep's path with a real finger
    const pre = JSON.parse(await D('saved()'));
    await D('start(1, "easy")');
    await sleep(200);
    const c0 = await D('counters');
    const end = await flyPath(1, 'easy', 2, { shotsAt: [{ t: 7, name: `${tag}-04-a-bud-blooms` }, { t: 22, name: `${tag}-05-the-key` }] });
    const c1 = await D('counters');
    s = await st();
    check(`${tag}: Easy level 1 flown to the end with a real finger: the chest opens, the results show 3 stars (every plant bloomed)`, s.screen === 'results' && s.done && s.stars === 3 && s.resultsStars === 3 && s.bloomed === 6 && s.opened && s.chestOpen > 0.99, `screen ${s.screen}, stars ${s.stars}, bloomed ${s.bloomed}/${s.total}, t ${s.t.toFixed(1)}`);
    check(`${tag}: every bloom paid a coin that flew up to the coin row (6), the key was taken on the way, nothing bonked, and the chest paid 10 more`,
      s.hudCoins === 6 && s.coins === 16 && s.keyGot && !s.keyFloat && s.bonks === 0 && c1.coinsLanded - c0.coinsLanded === 6 && c1.keys - c0.keys === 1 && s.owed === 0, `row ${s.hudCoins}, coins ${s.coins}, key ${s.keyGot}, bonks ${s.bonks}`);
    check(`${tag}: the touches were real touch pointers`, (c1.pointerTypes.touch || 0) >= 1 && !c1.pointerTypes.mouse && c1.moves - c0.moves > 20, JSON.stringify(c1.pointerTypes) + `, ${c1.moves - c0.moves} moves counted of ${end.moved} sent in ${end.iters} rounds`);
    await shot(`${tag}-06-the-chest-and-the-results`);
    saved = JSON.parse(await D('saved()'));
    check(`${tag}: the save was written the moment it was won: 3 stars on Easy 1, level 2 open on Easy only, 16 more coins, 6 more plants, a chest`,
      saved.v === 1 && saved.stars.easy[0] === 3 && saved.unlocked.easy === 2 && saved.unlocked.medium === 1 && saved.unlocked.hard === 1 && saved.mode === 'easy' && saved.coins - pre.coins === 16 && saved.plants - pre.plants === 6 && saved.chests === 1 && saved.stars.medium.every((v) => v === 0),
      JSON.stringify(saved).slice(0, 160));
    const ls = await ev(`localStorage.getItem('game.flight.save')`);
    check(`${tag}: the save lives under the key game.flight.save (and no other game's key was touched)`, !!ls && JSON.parse(ls).stars.easy[0] === 3 && (await ev(`['game.catch.save', 'game.pop.save', 'game.dash.save', 'isabella.save'].every((k) => localStorage.getItem(k) === null)`)), ls && ls.slice(0, 40));
    const rv = await ev(`(() => { const b = (id) => document.getElementById(id).getBoundingClientRect(), vh = innerHeight / 100; return ['resLevels', 'resReplay', 'resNext'].map((id) => Math.min(b(id).width, b(id).height) / vh); })()`);
    check(`${tag}: the results buttons (levels, again, next) are 19vh or more`, rv.every((v) => v >= 19 - 0.1), rv.map((v) => v.toFixed(1)).join(','));
    await reload();
    s = await st();
    check(`${tag}: after a reload, Easy remembers level 2 is open, with the star on level 1 (Medium still only level 1)`, s.mode === 'easy' && s.unlocked === 2 && s.savedStars[0] === 3 && s.unlockedAll.medium === 1, `mode ${s.mode}, unlocked ${s.unlocked}`);
    check(`${tag}: ...and the level map shows it: three stars on level 1, level 2 open`, (await ev(`document.querySelectorAll('.lvl[data-level="1"] .st svg use[fill="#ffd23f"]').length`)) === 3 && !(await ev(`document.querySelector('.lvl[data-level="2"]').classList.contains('locked')`)));
    // the results card's buttons, by touch
    await tapEl('.lvl[data-level="2"]'); await sleep(300);
    check(`${tag}: a tap on the open level 2 starts it`, (await st()).level === 2 && (await st()).screen === 'play');
    await D('toEnd(true)'); await D('timeScale(3)');
    s = await settle((q) => q.screen === 'results', 20000);
    await D('timeScale(1)');
    check(`${tag}: a course finished by the hook shows its results too, and level 3 is then open`, !!s && s.resultsStars === 3 && s.unlocked === 3, s && `unlocked ${s.unlocked}`);
    await tapEl('#resNext'); await sleep(250);
    check(`${tag}: the Next button starts level 3`, (await st()).level === 3 && (await st()).screen === 'play');
    await D('goLevels()'); await sleep(100);
    await tapEl('.lvl[data-level="2"]'); await sleep(200);
    await D('toEnd(false)'); await D('timeScale(3)');
    s = await settle((q) => q.screen === 'results', 20000);
    await D('timeScale(1)');
    check(`${tag}: finishing without bringing a single plant to life still opens the chest (1 star for finishing)`, !!s && s.done && s.resultsStars === 1 && s.opened, s && `stars ${s.resultsStars}`);
    await tapEl('#resReplay'); await sleep(250);
    check(`${tag}: Play again restarts the same level`, (await st()).level === 2 && (await st()).screen === 'play' && (await st()).bloomed === 0);

    // ---------- a bonk: Easy loses nothing, Medium loses one coin and never goes below 0 ----------
    await loadWith('localStorage.clear()');
    await D('start(3, "easy")');
    await sleep(200);
    await fingerDown(w * 0.3, h * 0.45);
    await D('toEnd(false)'); await D('advance(0.01)');
    // go back to the start of the course, bloom a plant by real flying, then get bonked
    await D('start(3, "easy")');
    let p0 = (await st()).plants[0];
    await fingerMoveTo(w * 0.3, p0.cy);
    s = await settle((q) => q.bloomed >= 1, 15000);
    await fingerUp();
    check(`${tag}: a real finger flown to the first bud brings it to life and pays a coin (the coin flies up to the row)`, !!s && s.bloomed === 1 && s.coins === 1, s && `bloomed ${s.bloomed}, coins ${s.coins}`);
    s = await settle((q) => q.hudCoins === 1, 4000);
    check(`${tag}: the coin lands in the row`, !!s && s.hudCoins === 1 && s.owed === 0);
    await D('bonkNow()'); await D('advance(0.05)');
    s = await st();
    await shot(`${tag}-07-a-bonk-dizzy-stars`);
    check(`${tag}: Easy: a bug bonks her (a wobble, dizzy stars, a 1.5 s shield) and costs nothing`, s.bonks === 1 && s.shield > 1.3 && s.dizzy > 1.3 && s.coins === 1 && s.hudCoins === 1 && s.lostCoins === 0, `bonks ${s.bonks}, shield ${s.shield.toFixed(2)}, coins ${s.coins}`);
    await loadWith('localStorage.clear()');
    await D('start(3, "medium")');
    p0 = (await st()).plants[0];
    await fingerDown(w * 0.3, p0.cy);
    s = await settle((q) => q.bloomed >= 1 && q.hudCoins === 1, 15000);
    await fingerUp();
    await D('bonkNow()'); await D('advance(0.05)');
    s = await st();
    check(`${tag}: Medium: a bonk takes one coin: it wobbles out of the row and drifts away (coins 1 -> 0)`, !!s && s.bonks === 1 && s.coins === 0 && s.hudCoins === 0 && s.lostCoins === 1 && s.coinsLost === 1, `bonks ${s.bonks}, coins ${s.coins}, row ${s.hudCoins}, lost on show ${s.lostCoins}`);
    await D('advance(1.7)');
    await D('bonkNow()'); await D('advance(0.05)');
    s = await st();
    check(`${tag}: a second bonk with no coins left: still 0, never below`, s.bonks === 2 && s.coins === 0 && s.hudCoins === 0 && s.coinsLost === 1, `bonks ${s.bonks}, coins ${s.coins}`);
    saved = JSON.parse(await D('saved()'));
    check(`${tag}: the save follows: the coin earned and the coin lost (0 coins), 2 bonks`, saved.coins === 0 && saved.bonks === 2 && saved.plants === 1, JSON.stringify(saved).slice(-90));

    // ---------- home and back ----------
    await D('start(1, "easy")');
    await ev('window.__pause()');
    const back1 = await ev('window.__back()');
    s = await st();
    check(`${tag}: window.__back() from a course returns to the level map (and says it handled it)`, back1 === true && s.screen === 'levels');
    const homeBox = await rectOf('#home');
    check(`${tag}: the home button is a 19vh target at the top left`, homeBox.w >= h * 0.19 - 0.6 && homeBox.l < 20 && homeBox.t < 20, `${homeBox.w.toFixed(0)}x${homeBox.h.toFixed(0)}`);
    await D('start(1, "easy")'); await sleep(150);
    const loaded = cdp.once('Page.loadEventFired');
    await tapEl('#home');
    await loaded; await sleep(300);
    check(`${tag}: the home button goes to the hub (../../index.html)`, (await ev('location.pathname')).endsWith('/web/index.html') || (await ev('location.pathname')).endsWith('/index.html') && !(await ev('location.pathname')).includes('/games/'), await ev('location.pathname'));
    await loadWith('localStorage.clear()');
    const loaded2 = cdp.once('Page.loadEventFired');
    const back2 = await ev('window.__back()');
    await loaded2; await sleep(300);
    check(`${tag}: window.__back() on the level map goes home`, back2 === true && !(await ev('location.pathname')).includes('/games/'), await ev('location.pathname'));
  }

  async function more() {
    console.log('\n=== more, at 915x412 ===');
    await viewport(915, 412, 2.625);
    const base = (await (async () => { await loadWith('localStorage.clear()'); return st(); })());
    // every forest in play (screenshots), with enemies and plants of every kind on screen
    await loadWith(`localStorage.setItem('game.flight.save', ${JSON.stringify(JSON.stringify({ v: 1, mode: 'medium', unlocked: { easy: 20, medium: 20, hard: 20 }, stars: { easy: [], medium: [], hard: [] } }))})`);
    for (const [n, m, secs] of [[1, 'medium', 6], [4, 'medium', 30], [6, 'medium', 28], [9, 'medium', 30], [11, 'medium', 32], [14, 'medium', 38], [17, 'hard', 40], [19, 'hard', 30], [20, 'hard', 30]]) {
      await D(`start(${n}, "${m}")`);
      await D(`advance(${secs})`);
      await sleep(250);
      const q = await st();
      await shot(`more-forest-level-${n}-${m}`);
      check(`level ${n} ${m} drawn in play at ${secs} s (theme ${q.theme}): no errors, ${q.nEnemies} enemies, ${q.total} plants`, q.screen === 'play' && q.theme === L.LEVELS[n - 1].theme);
    }
    // mute follows isabella.save, read only
    await loadWith(`localStorage.clear(); localStorage.setItem('isabella.save', '{"muted":true,"keep":1}')`);
    await D('start(1, "easy")'); await D('advance(2)'); await ev('window.__pause()');
    let s = await st();
    const iso = await ev(`localStorage.getItem('isabella.save')`);
    check('mute: sound follows the main game\'s setting (muted: true), and the game never writes isabella.save', s.muted === true && iso === '{"muted":true,"keep":1}', `muted ${s.muted}, isabella.save ${iso}`);
    await loadWith(`localStorage.clear(); localStorage.setItem('isabella.save', '{"muted":false}')`);
    s = await st();
    check('mute off: a main game that is not muted leaves this game on', s.muted === false);
    // the Android store: window.IsabellaStore
    await loadWith(`window.IsabellaStore = { data: { 'isabella.save': '{"muted":true}' }, sets: [], get(k) { return this.data[k] == null ? null : this.data[k]; }, set(k, v) { this.sets.push(k); this.data[k] = v; } }; localStorage.clear();`);
    await D('start(1, "easy")'); await D('toEnd(true)'); await D('timeScale(3)');
    await settle((q) => q.screen === 'results', 20000);
    await D('timeScale(1)');
    const store = await ev(`({ keys: [...new Set(window.IsabellaStore.sets)], saved: window.IsabellaStore.data['game.flight.save'], ls: localStorage.getItem('game.flight.save') })`);
    check('the Android store: the mute setting is read from it, the save goes through IsabellaStore under game.flight.save (not localStorage), and nothing else is written', (await st()).muted === true && store.keys.join() === 'game.flight.save' && JSON.parse(store.saved).stars.easy[0] === 3 && store.ls === null, JSON.stringify(store.keys));
    // held upright: the rotate overlay, and nothing runs
    await loadWith('localStorage.clear()');
    await D('start(1, "easy")'); await D('advance(1)');
    const t0 = (await st()).t;
    await viewport(412, 915, 2.625); await sleep(500);
    const rot = await ev(`getComputedStyle(document.getElementById('rotate')).display`);
    const t1 = (await st()).t; await sleep(500); const t2 = (await st()).t;
    check('held upright: the rotate overlay shows and the course does not move on', rot === 'flex' && t2 === t1, `overlay ${rot}, t ${t0.toFixed(2)} -> ${t1.toFixed(2)} -> ${t2.toFixed(2)}`);
    await viewport(915, 412, 2.625); await sleep(500);
    check('turned back to landscape: play carries on', (await st()).t > t2 + 0.1);
    // window.__pause and the page being hidden
    check('window.__pause exists and does not throw', (await ev('typeof window.__pause')) === 'function' && (await ev('(() => { window.__pause(); return true; })()')) === true);
    // frame rate
    await D('start(11, "hard")'); await D('resetPerf()'); await sleep(3000);
    const perf = await D('perf()');
    check('a busy Hard course draws smoothly: average frame cost under 12 ms in headless Chrome', perf.frames > 30 && perf.avgMs < 12, `${perf.frames} frames, avg ${perf.avgMs.toFixed(2)} ms, p95 ${perf.p95Ms.toFixed(2)} ms, max ${perf.maxMs.toFixed(1)} ms`);
    // hold the world name for 4 s to open every level in this mode
    await loadWith('localStorage.clear()');
    await tapEl('#mode-hard'); await sleep(100);
    await holdEl('#worldText', 4300); await sleep(300);
    s = await st();
    check('holding the world name for 4 seconds opens every level of that mode only (a grown-ups\' shortcut)', s.mode === 'hard' && s.unlocked === 20 && s.unlockedAll.easy === 1 && s.unlockedAll.medium === 1, JSON.stringify(s.unlockedAll));
    void base;
  }

  try {
    if (!ONLY || ONLY === 'seeker') await suite(915, 412, 2.625, 'seeker');
    if (!ONLY || ONLY === 'phone800') await suite(800, 360, 3, 'phone800');
    if (!ONLY || ONLY === 'more') await more();
  } catch (e) {
    check('the run finished without throwing', false, e.stack || e.message);
  }
  check('no console errors, warnings or exceptions anywhere', problems.length === 0, problems.slice(0, 3).map((p) => `[${p.where}] ${p.kind}: ${String(p.text).slice(0, 120)}`).join(' | '));
  try { await cdp.send('Browser.close'); } catch (e) { /* gone */ }
  try { chrome.kill(); } catch (e) { /* gone */ }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed, ${failed.length} failed; ${shots.length} screenshots in ${OUT}`);
  for (const f of failed) console.log('FAIL  ' + f.name + (f.detail ? '  (' + f.detail + ')' : ''));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); try { chrome && chrome.kill(); } catch (x) { /* gone */ } process.exit(1); });
