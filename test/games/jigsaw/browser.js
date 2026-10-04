// Sea Jigsaw in headless Chrome, driven like fingers: real touch drags through the DevTools protocol.
//   node test/games/jigsaw/browser.js [screenshotDir] [chromeProfileDir]
//   (defaults: <repo>/.local/shots and <repo>/.local/chrome-jigsaw; DevTools port 9481, its own throwaway profile)
// Runs twice, each with a fresh save: 915x412 at DPR 2.625 (the Seeker) and 800x360 at DPR 3 (a 20:9 phone).
//   level select and the three sizes by touch -> Easy 1 by touch: the hand, a wrong drop that stays put, the magnetic
//   snap, a tap, back to the tray, the picture button, every piece dragged home -> the key, the chest, the coins,
//   the results card -> Easy 2 open, still open after a reload -> Medium 1 and Hard 1 solved piece by piece with real
//   drags -> the bonus coins draining -> a half-done puzzle kept over a reload -> home goes to ../../index.html.
// Once, at the Seeker size: all thirty puzzles (the right picture on the board, every piece the right bit of it,
// nothing under 19vh), the thirty pictures measured (all different, no big flat areas), two fingers at once,
// window.IsabellaStore, mute, held upright, a resize, frame rate, the title-screen symbol.
// Exits 1 on any failed check or any console error, warning or exception.
// For bite.js (which breaks copies of the game on purpose and checks these checks notice):
//   JIGSAW_DIR=<dir> tests another copy of the game; JIGSAW_QUICK=1 skips the second screen size;
//   JIGSAW_PART=suite | more runs only the play-through, or only the once-only checks; JIGSAW_BAIL=1 stops at the first failure.
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const DIR = process.env.JIGSAW_DIR ? path.resolve(process.env.JIGSAW_DIR) : path.join(ROOT, 'web/games/jigsaw');
const QUICK = !!process.env.JIGSAW_QUICK, PART = process.env.JIGSAW_PART || '', BAIL = !!process.env.JIGSAW_BAIL;
const PAGE = 'file://' + path.join(DIR, 'index.html');
const HUB = 'file://' + path.resolve(DIR, '../../index.html');
const SHEET = 'file://' + path.join(__dirname, 'sheet.html') + '?game=' + encodeURIComponent('file://' + DIR);
const OUT = path.resolve(process.argv[2] || path.join(ROOT, '.local/shots'));
const PROFILE = path.resolve(process.argv[3] || path.join(ROOT, '.local/chrome-jigsaw'));
const PORT = 9481;
const L = require(path.join(DIR, 'logic.js'));

const results = [], shots = [], problems = [];
let chrome = null;   // killed on every exit path so the port is never left busy
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(typeof detail === 'string' ? detail : JSON.stringify(detail)) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail != null ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
  if (!ok && BAIL) { const e = new Error('stopped at the first failure'); e.bail = true; throw e; }
}
const openSave = (extra) => JSON.stringify(Object.assign({ v: 1, mode: 'easy', coins: 0, solved: 0, runs: {},
  easy: { unlocked: 10, best: new Array(10).fill(-1) }, medium: { unlocked: 10, best: new Array(10).fill(-1) }, hard: { unlocked: 10, best: new Array(10).fill(-1) } }, extra || {}));

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
  const D = (expr) => ev(`window.__jigsawDebug.${expr}`);
  const st = () => D('state()');
  async function go(url, label) { where = label; const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url }); await loaded; await sleep(400); }
  async function reload() { const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.reload', { ignoreCache: true }); await loaded; await sleep(400); }
  // Open the game with storage set up by `js`. It runs as the new page starts, AFTER the old page has gone:
  // a page writes its save as it closes (pagehide), so storage changed while it is open would be overwritten.
  async function loadWith(js) {
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { ${js} } catch (e) {} })();` });
    await go(PAGE, 'jigsaw');
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
  // a picture of one moment: the game's clock is held still while the picture is taken
  async function still(name) { await D('timeScale(0)'); await sleep(60); await shot(name); await D('timeScale(1)'); }
  async function waitFor(fn, ms, every) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(every || 60); }
    return null;
  }
  const settle = (pred, ms) => waitFor(async () => { const s = await st(); return pred(s) ? s : null; }, ms || 8000, 60);
  const pt = (x, y, id) => ({ x, y, id: id || 1, radiusX: 10, radiusY: 10, force: 1 });
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  async function touchTap(x, y) { await touch('touchStart', [pt(x, y)]); await touch('touchEnd', []); }
  async function tapEl(sel) {
    const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await touchTap(r.x, r.y);
  }
  // one finger down on `a`, sliding to `b` over `steps` moves (60 Hz), then up; `beforeEnd` runs with the finger still down
  async function touchDrag(a, b, o) {
    o = o || {};
    const steps = o.steps || 10;
    await touch('touchStart', [pt(a.x, a.y)]);
    await sleep(25);
    for (let i = 1; i <= steps; i++) { const u = i / steps; await touch('touchMove', [pt(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u)]); await sleep(16); }
    if (o.beforeEnd) await o.beforeEnd();
    await touch('touchEnd', []);
  }
  const piece = async (id) => (await st()).pieces[id];
  // a piece a finger can take now: in the tray (and arrived), or lying loose on the board
  async function nextPiece(want) {
    return waitFor(async () => { const s = await st(); return s.pieces.find((q) => (q.st === 'tray' || q.st === 'loose') && q.ready && (!want || want(q))) || null; }, 3000, 40);
  }
  // drag pieces home one at a time with real touches until `count` more are home (or the puzzle is done)
  async function solveByTouch(count, each) {
    let done = 0;
    const misses = [];
    while (done < count) {
      const s0 = await st();
      if (s0.phase !== 'play') break;
      const q = await nextPiece();
      if (!q) { misses.push('no piece to take'); break; }
      await touchDrag({ x: q.cx, y: q.cy }, { x: q.hcx, y: q.hcy }, { steps: 8 });
      const s1 = await settle((v) => v.homeCount > s0.homeCount, 1200);
      if (s1 && s1.pieces[q.id].rule === 'home') done++; else { misses.push(`piece ${q.id}`); if (misses.length > 4) break; }
      if (each) await each(done);
    }
    return { done, misses };
  }
  const vh = (px) => +((px / HT) * 100).toFixed(1);
  const inside = (r, m) => r.left >= -(m || 0.5) && r.top >= -(m || 0.5) && r.right <= W + (m || 0.5) && r.bottom <= HT + (m || 0.5);
  const rectOf = (sel) => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })()`);
  const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  async function suite(w, h, dpr, tag) {
    console.log(`\n=== ${w}x${h} @ DPR ${dpr} ===`);
    await viewport(w, h, dpr);
    await loadWith('localStorage.clear()');
    await sleep(500);
    let s = await st();
    check(`${tag}: opens on the level select with a fresh save, on Easy`, s.screen === 'levels' && s.mode === 'easy' && s.unlocked.easy === 1 && s.coins === 0 && s.solved === 0, `screen ${s.screen}, mode ${s.mode}, coins ${s.coins}`);
    check(`${tag}: canvas fills the screen with DPR capped at 2.5`, s.dpr === 2.5 && s.canvas[0] === Math.round(w * 2.5) && s.canvas[1] === Math.round(h * 2.5), `dpr ${s.dpr}, canvas ${s.canvas}`);
    const ui = await ev(`(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; }, q = (s) => r(document.querySelector(s));
      const lv = [...document.querySelectorAll('.lvl')];
      return { n: lv.length, locked: lv.filter((b) => b.classList.contains('locked')).length, next: lv.filter((b) => b.classList.contains('next')).map((b) => b.dataset.n).join(),
        pics: lv.map((b) => r(b.querySelector('.pic'))), title: q('#title'), pill: q('.pill'), home: q('#homeBtn'), sound: q('#soundBtn'), modes: ['easy', 'medium', 'hard'].map((m) => q('#mode-' + m)),
        on: [...document.querySelectorAll('.mode.on')].map((b) => b.dataset.mode).join(), grid: q('#grid'),
        painted: lv.map((b) => { const c = b.querySelector('canvas'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; let lo = 255, hi = 0; for (let i = 0; i < d.length; i += 97 * 4) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); } return hi - lo; }) }; })()`);
    const all = [ui.title, ui.pill, ui.home, ui.sound, ui.grid].concat(ui.modes, ui.pics);
    const clash = [];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { if (all[i] === ui.grid && j >= 5 + 3) continue; if (overlap(all[i], all[j])) clash.push([i, j]); }
    const picVh = Math.min(...ui.pics.map((r) => Math.min(r.width, r.height)));
    check(`${tag}: ten puzzle pictures (2 to 10 padlocked, 1 bobbing), each at least 19vh; the three sizes, home and sound at least 19vh; nothing overlapping or off screen`,
      ui.n === 10 && ui.locked === 9 && ui.next === '1' && ui.on === 'easy' && vh(picVh) >= 19 && ui.modes.every((r) => vh(Math.min(r.width, r.height)) >= 19) && vh(Math.min(ui.home.width, ui.home.height)) >= 19
        && vh(Math.min(ui.sound.width, ui.sound.height)) >= 19 && clash.length === 0 && all.every((r) => inside(r)),
      `pictures ${vh(ui.pics[0].width)} x ${vh(ui.pics[0].height)} vh, modes ${vh(ui.modes[0].width)} vh, clashes ${JSON.stringify(clash)}`);
    check(`${tag}: every picture on the level select is really painted (not a blank box)`, ui.painted.every((v) => v > 60), ui.painted.join(','));
    await shot(`${tag}-01-level-select-easy`);

    await tapEl('.lvl[data-n="2"]');
    await sleep(120);
    check(`${tag}: a padlocked puzzle only wiggles`, (await st()).screen === 'levels' && (await ev(`document.querySelector('.lvl[data-n="2"]').classList.contains('shake')`)));

    // ---------- the three sizes, picked by touch ----------
    await tapEl('#mode-medium'); await sleep(250);
    let lv = await ev(`({ mode: window.__jigsawDebug.state().mode, on: [...document.querySelectorAll('.mode.on')].map((b) => b.dataset.mode).join(), ids: [...document.querySelectorAll('.lvl')].map((b) => b.dataset.id).join() })`);
    check(`${tag}: a tap on the middle size shows Medium's ten puzzles`, lv.mode === 'medium' && lv.on === 'medium' && lv.ids === 'm1,m2,m3,m4,m5,m6,m7,m8,m9,m10', lv);
    await shot(`${tag}-02-level-select-medium`);
    await tapEl('#mode-hard'); await sleep(250);
    lv = await ev(`({ mode: window.__jigsawDebug.state().mode, on: [...document.querySelectorAll('.mode.on')].map((b) => b.dataset.mode).join(), ids: [...document.querySelectorAll('.lvl')].map((b) => b.dataset.id).join(), saved: JSON.parse(window.__jigsawDebug.saved()).mode })`);
    check(`${tag}: ...and the big size shows Hard's ten, and the choice is saved`, lv.mode === 'hard' && lv.on === 'hard' && lv.ids.startsWith('h1,h2') && lv.saved === 'hard', lv);
    await shot(`${tag}-03-level-select-hard`);
    await tapEl('#mode-easy'); await sleep(250);

    // ---------- Easy 1 by touch ----------
    await tapEl('.lvl[data-n="1"]');
    s = await settle((q) => q.screen === 'play' && q.puzzle === 'e1', 3000);
    check(`${tag}: a tap on puzzle 1 starts it`, !!s, s && s.puzzle);
    s = await settle((q) => q.pieces.filter((v) => v.st === 'tray' && v.ready).length === 3, 3000);
    const btn = { home: await rectOf('#homeBtn'), grid: await rectOf('#gridBtn'), eye: await rectOf('#eyeBtn') };
    const trayP = s.pieces.filter((q) => q.st === 'tray');
    check(`${tag}: Easy 1: four pieces, three waiting in the tray and one behind them; the board shows a faint ghost of the picture`,
      s.n === 4 && trayP.length === 3 && s.waiting === 1 && s.guide === 'ghost' && s.homeCount === 0, `tray ${trayP.length}, waiting ${s.waiting}, guide ${s.guide}`);
    check(`${tag}: the board and the tray are on screen, clear of each other and of the buttons`,
      inside(s.board, 4) && inside(s.tray, 1) && s.board.right <= s.tray.left && [btn.home, btn.grid, btn.eye].every((b) => b.right <= s.board.left + 1 && inside(b)) && !overlap(btn.home, btn.grid) && !overlap(btn.grid, btn.eye),
      `board ${s.board.left.toFixed(0)}..${s.board.right.toFixed(0)}, tray ${s.tray.left.toFixed(0)}..${s.tray.right.toFixed(0)}, buttons to ${btn.home.right.toFixed(0)}`);
    check(`${tag}: everything a finger takes hold of is at least 19vh: a tray piece, a piece on the board, home, puzzles, the picture button`,
      trayP.every((q) => vh(Math.min(q.gw, q.gh)) >= 19) && vh(Math.min(s.cell.w, s.cell.h)) >= 19 && Object.values(btn).every((b) => vh(Math.min(b.width, b.height)) >= 19),
      `tray piece ${vh(trayP[0].gw)} x ${vh(trayP[0].gh)} vh, piece on the board ${vh(s.cell.w)} x ${vh(s.cell.h)} vh, buttons ${vh(btn.home.width)} vh`);
    check(`${tag}: the clock has not started and all three bonus coins are there`, s.started === false && s.t === 0 && s.bonus === 3 && s.bonusShown === 3, `t ${s.t}`);
    s = await settle((q) => q.hint != null, 4000);
    check(`${tag}: before the first piece is home, a hand shows a piece being carried to its place`, !!s, s && `hand on piece ${s.hint}`);
    await sleep(900);
    await still(`${tag}-04-easy1-the-hand-shows-the-drag`);

    // ---------- a wrong drop just stays where it was put ----------
    const c0 = await D('counters');
    let a = await nextPiece();
    const wrongAt = { x: a.hcx + (a.hcx > s.board.left + s.board.width / 2 ? -1 : 1) * s.board.width * 0.42, y: a.hcy + (a.hcy > s.board.top + s.board.height / 2 ? -1 : 1) * s.board.height * 0.3 };
    await touchDrag({ x: a.cx, y: a.cy }, wrongAt, { steps: 10, beforeEnd: () => still(`${tag}-05-easy1-a-piece-in-the-finger`) });
    await sleep(350);
    s = await st();
    let a1 = s.pieces[a.id];
    check(`${tag}: a piece dropped in the wrong place stays where it was put: not home, nothing lost, no penalty`,
      a1.st === 'loose' && a1.rule === 'loose' && s.homeCount === 0 && Math.hypot(a1.cx - wrongAt.x, a1.cy - wrongAt.y) < 34 && s.bonus === 3,
      `piece ${a.id} is ${a1.st} ${Math.hypot(a1.cx - wrongAt.x, a1.cy - wrongAt.y).toFixed(0)} px from the finger`);
    check(`${tag}: ...its tray slot is filled by the piece that was waiting, and the clock has started`, s.pieces.filter((q) => q.rule === 'tray').length === 3 && s.waiting === 0 && s.started === true, `tray ${s.pieces.filter((q) => q.rule === 'tray').length}, waiting ${s.waiting}`);
    check(`${tag}: the drag arrived as a touch pointer`, ((await D('counters')).pointerTypes.touch || 0) > (c0.pointerTypes.touch || 0), JSON.stringify((await D('counters')).pointerTypes));
    await still(`${tag}-06-easy1-a-wrong-drop-stays-put`);

    // ---------- the magnetic snap ----------
    // let go just outside the snap radius: it stays; just inside (well away from the exact spot): it goes home
    const ang = Math.atan2(a1.cy - a1.hcy, a1.cx - a1.hcx);
    const out = { x: a1.hcx + Math.cos(ang) * s.snapR * 1.25, y: a1.hcy + Math.sin(ang) * s.snapR * 1.25 };
    await touchDrag({ x: a1.cx, y: a1.cy }, out, { steps: 10 });
    await sleep(300);
    s = await st(); a1 = s.pieces[a.id];
    check(`${tag}: let go just outside the snap (1.25 x its radius of ${s.snapR.toFixed(0)} px): the piece stays there`, a1.st === 'loose' && s.homeCount === 0, `${a1.st}, ${Math.hypot(a1.cx - a1.hcx, a1.cy - a1.hcy).toFixed(0)} px from home`);
    const near = { x: a1.hcx + Math.cos(ang) * s.snapR * 0.8, y: a1.hcy + Math.sin(ang) * s.snapR * 0.8 };
    let lit = null;
    await touchDrag({ x: a1.cx, y: a1.cy }, near, { steps: 10, beforeEnd: async () => { await sleep(250); lit = await st(); } });
    s = await settle((q) => q.pieces[a.id].st === 'home', 1500);
    check(`${tag}: held ${(0.8 * (lit ? lit.snapR : 0)).toFixed(0)} px from its place (inside the snap) the place lights up to say "let go"`, !!lit && lit.magnet.join() === String(a.id), lit && `lit for piece ${lit.magnet}`);
    check(`${tag}: ...and let go there the piece glides home and clicks in`, !!s && s.homeCount === 1 && s.pieces[a.id].rule === 'home' && Math.hypot(s.pieces[a.id].cx - s.pieces[a.id].hcx, s.pieces[a.id].cy - s.pieces[a.id].hcy) < 1,
      s ? `home ${s.homeCount}` : 'never arrived');
    const sparkle = await waitFor(async () => (await st()).parts > 6, 800, 20);
    check(`${tag}: ...with a sparkle`, !!sparkle, `particles`);
    await sleep(120);
    await still(`${tag}-07-easy1-snapped-home`);
    let bc = await D('boardCheck()');
    check(`${tag}: the piece on the board is exactly its part of the picture, in the right place (the others' places are not)`, bc.pieces[a.id] < 1.5 && bc.pieces.filter((v) => v > 6).length === 3, bc.pieces.join(', '));

    // ---------- a tap, and putting a piece back ----------
    let b = await nextPiece((q) => q.st === 'tray');
    await touchTap(b.cx, b.cy); await sleep(150);
    s = await st();
    check(`${tag}: a tap on a piece does not move it: it wiggles and its place lights up`, s.pieces[b.id].st === 'tray' && s.flash === b.id && s.homeCount === 1 && (await D('counters')).taps >= 1, `flash ${s.flash}`);
    await still(`${tag}-08-easy1-a-tap-lights-its-place`);
    await touchDrag({ x: b.cx, y: b.cy }, { x: s.board.left + s.board.width * 0.5, y: s.board.top + s.board.height * 0.85 }, { steps: 8 });
    await sleep(200);
    const loose1 = await piece(b.id);
    await touchDrag({ x: loose1.cx, y: loose1.cy }, { x: s.tray.left + s.tray.width / 2, y: s.tray.top + s.tray.height * 0.6 }, { steps: 8 });
    await sleep(350);
    s = await st();
    check(`${tag}: a piece carried back over the tray goes back into the tray`, loose1.st === 'loose' && s.pieces[b.id].st === 'tray' && s.pieces[b.id].rule === 'tray' && s.pieces[b.id].slot >= 0 && s.loose.length === 0, `was ${loose1.st}, now ${s.pieces[b.id].st} in slot ${s.pieces[b.id].slot}`);

    // ---------- the picture button ----------
    await tapEl('#eyeBtn');
    s = await settle((q) => q.peek > 0.9, 1500);
    check(`${tag}: the picture button shows the finished picture over the board`, !!s && s.peekOn, s && `peek ${s.peek.toFixed(2)}`);
    await still(`${tag}-09-easy1-the-picture-button`);
    await touchTap(s.board.left + s.board.width / 2, s.board.top + 30);
    s = await settle((q) => q.peek < 0.05, 1500);
    check(`${tag}: ...and the next touch puts it away (nothing is picked up by that touch)`, !!s && !s.peekOn && s.held === 0 && s.homeCount === 1, s && `peek ${s.peek.toFixed(2)}`);
    await tapEl('#eyeBtn'); await sleep(200);
    await D('timeScale(6)');
    s = await settle((q) => !q.peekOn && q.peek < 0.05, 2500);
    await D('timeScale(1)');
    check(`${tag}: ...or it goes away by itself after a few seconds`, !!s, s && `peek ${s.peek.toFixed(2)}`);

    // ---------- the rest of Easy 1, piece by piece ----------
    const t0 = (await st()).t;
    const r1 = await solveByTouch(3);
    s = await st();
    check(`${tag}: every piece of Easy 1 dragged home with a real touch finishes the puzzle`, r1.done === 3 && r1.misses.length === 0 && s.done && s.homeCount === 4, `${r1.done} more home; misses ${JSON.stringify(r1.misses)}`);
    check(`${tag}: finishing saves at once: 5 base coins + 3 bonus coins kept = 8, puzzle 2 open, best bonus 3`, s.won && s.won.total === 8 && s.won.base === 5 && s.won.bonus === 3 && s.coins === 8 && s.unlocked.easy === 2 && s.best[0] === 3 && s.t > t0,
      s.won && `won ${JSON.stringify(s.won)}, coins ${s.coins}, t ${s.t.toFixed(1)} s`);
    s = await settle((q) => q.winT != null && q.winT >= 0.82, 3000);
    await still(`${tag}-10-the-finished-picture`);
    bc = await D('boardCheck()');
    check(`${tag}: the finished board is the picture: every piece is the right bit in the right place, only the seams differ`, bc.pieces.every((v) => v < 1.5) && bc.share > 0.002 && bc.share < 0.1, `seams ${(bc.share * 100).toFixed(1)}% of the board; worst piece ${Math.max(...bc.pieces)}`);
    s = await settle((q) => q.key && q.winT >= 1.5, 3000);
    check(`${tag}: a golden key pops out of the middle of the picture`, !!s && Math.abs(s.key.cx - (s.board.left + s.board.width / 2)) < 20 && s.key.sc > 2 && s.chestUp > 0.9, s && `key at ${s.key.cx.toFixed(0)}, ${s.key.cy.toFixed(0)}; chest up ${s.chestUp.toFixed(2)}`);
    await still(`${tag}-11-the-key`);
    s = await settle((q) => q.key && q.key.u > 0.45 && q.key.u < 0.9, 3000, 15);
    check(`${tag}: ...and flies to the treasure chest`, !!s && s.key.cx > s.board.left + s.board.width * 0.6, s && `key at ${s.key.cx.toFixed(0)} px, ${(s.key.u * 100).toFixed(0)}% of the way`);
    await still(`${tag}-12-the-key-flies-to-the-chest`);
    s = await settle((q) => q.chestOpen > 0.95 && q.gold > 20, 4000);
    check(`${tag}: the chest opens and bursts with gold coins`, !!s && s.key === null, s && `chest open ${s.chestOpen.toFixed(2)}, ${s.gold} coins in the air`);
    await sleep(150);
    await still(`${tag}-13-the-chest-bursts-with-coins`);
    s = await settle((q) => q.tally === 8 && q.hudBonus === 0, 6000);
    check(`${tag}: the coins are counted: the 5 base coins, then each of the 3 bonus coins flies down and is added`, !!s, s ? `counted ${s.tally}` : `counted ${(await st()).tally}`);
    s = await settle((q) => q.results, 4000);
    await waitFor(() => ev(`document.querySelectorAll('#resLoot svg.pop').length === 4`), 3000);
    await sleep(350);
    const card = await ev(`(() => { const r = (e) => { const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
      return { key: document.querySelectorAll('#resLoot svg.keyl').length, coins: document.querySelectorAll('#resLoot svg.bonus').length, text: document.getElementById('resCoins').textContent,
        card: r(document.getElementById('resCard')), buttons: ['resLevels', 'resReplay', 'resNext'].map((id) => r(document.getElementById(id))), next: getComputedStyle(document.getElementById('resNext')).display }; })()`);
    check(`${tag}: results: the key, three bonus coins and +8; three buttons, each at least 19vh, all on screen`, !!s && card.key === 1 && card.coins === 3 && card.text === '+8' && card.next !== 'none' && inside(card.card, 1) && card.buttons.every((r) => vh(Math.min(r.width, r.height)) >= 19 && inside(r)),
      `key ${card.key}, coins ${card.coins}, "${card.text}", buttons ${card.buttons.map((r) => vh(r.width)).join('/')} vh`);
    await shot(`${tag}-14-results`);
    const saved1 = JSON.parse(await D('saved()'));
    check(`${tag}: saved: 8 coins, Easy 2 open, the finished run cleared`, saved1.v === 1 && saved1.coins === 8 && saved1.solved === 1 && saved1.easy.unlocked === 2 && saved1.easy.best[0] === 3 && Object.keys(saved1.runs).length === 0, JSON.stringify({ coins: saved1.coins, easy: saved1.easy.unlocked, runs: saved1.runs }));

    await tapEl('#resLevels');
    await sleep(400);
    const grid = () => ev(`(() => { const b = (n) => document.querySelector('.lvl[data-n="' + n + '"]'); return { screen: window.__jigsawDebug.state().screen, done1: b(1).classList.contains('done'), coins1: b(1).querySelectorAll('.st svg').length,
      key1: getComputedStyle(b(1).querySelector('.keyb')).display, l2locked: b(2).classList.contains('locked'), l2next: b(2).classList.contains('next'), l3locked: b(3).classList.contains('locked'), pill: document.getElementById('coinCount').textContent }; })()`);
    lv = await grid();
    check(`${tag}: the level select shows puzzle 1 done (a key and its 3 coins), puzzle 2 open and bobbing, 8 coins in the purse`, lv.screen === 'levels' && lv.done1 && lv.coins1 === 3 && lv.key1 !== 'none' && !lv.l2locked && lv.l2next && lv.l3locked && lv.pill === '8', lv);
    await shot(`${tag}-15-level-select-puzzle-2-open`);
    await reload(); await sleep(500);
    lv = await grid();
    check(`${tag}: after a reload puzzle 2 is still open and the coins are still there`, lv.done1 && lv.coins1 === 3 && !lv.l2locked && lv.pill === '8', lv);

    // ---------- Medium 1: twelve pieces, outlines on the board, every one dragged by a real touch ----------
    await tapEl('#mode-medium'); await sleep(250);
    await tapEl('.lvl[data-n="1"]');
    s = await settle((q) => q.screen === 'play' && q.puzzle === 'm1' && q.pieces.filter((v) => v.st === 'tray' && v.ready).length === 8, 4000);
    check(`${tag}: Medium 1: twelve pieces, eight in the tray, the board shows the outlines of the pieces`, !!s && s.n === 12 && s.waiting === 4 && s.guide === 'outline' && s.pieces.filter((q) => q.st === 'tray').every((q) => vh(Math.min(q.gw, q.gh)) >= 19),
      s && `waiting ${s.waiting}, guide ${s.guide}, tray piece ${vh(s.pieces.find((q) => q.st === 'tray').gw)} x ${vh(s.pieces.find((q) => q.st === 'tray').gh)} vh`);
    let rm = await solveByTouch(4);
    await sleep(250);
    await still(`${tag}-16-medium1-early`);
    rm = await solveByTouch(12);
    s = await st();
    check(`${tag}: Medium 1 solved piece by piece with real drags: 10 base coins + 3 bonus coins x 2 = 16`, rm.misses.length === 0 && s.done && s.won && s.won.total === 16 && s.unlocked.medium === 2, `misses ${JSON.stringify(rm.misses)}, won ${JSON.stringify(s.won)}`);
    await settle((q) => q.pieces.every((v) => v.st === 'home'), 1500);
    bc = await D('boardCheck()');
    check(`${tag}: ...and its finished board is the picture`, bc.pieces.every((v) => v < 1.5) && bc.share < 0.16, `seams ${(bc.share * 100).toFixed(1)}%; worst piece ${Math.max(...bc.pieces)}`);
    s = await settle((q) => q.results, 14000);
    check(`${tag}: ...and its celebration reaches the results card with all 16 coins counted`, !!s && s.tally === 16, s && `counted ${s.tally}`);

    // ---------- Hard 1: twenty-four pieces, nothing on the board, the frame first ----------
    await D("goLevels('hard')"); await sleep(250);
    await tapEl('.lvl[data-n="1"]');
    s = await settle((q) => q.screen === 'play' && q.puzzle === 'h1' && q.pieces.filter((v) => v.st === 'tray' && v.ready).length === 8, 4000);
    const ringOf = (id) => { const c = id % 6, r = Math.floor(id / 6); return Math.min(c, r, 5 - c, 3 - r); };
    check(`${tag}: Hard 1: twenty-four pieces, nothing shown on the board, and the first pieces dealt are all from the frame`, !!s && s.n === 24 && s.guide === 'none' && s.slots.every((id) => ringOf(id) === 0), s && `guide ${s.guide}, first tray ${s.slots.join(',')}`);
    await still(`${tag}-17-hard1-start`);
    const q0 = await nextPiece();
    await touchTap(q0.cx, q0.cy); await sleep(150);
    s = await st();
    check(`${tag}: on Hard a tap does not show where a piece goes`, s.flash === null && s.pieces[q0.id].st === 'tray', `flash ${s.flash}`);
    let rh = await solveByTouch(9);
    await sleep(250);
    await still(`${tag}-18-hard1-early`);
    rh = await solveByTouch(24);
    s = await st();
    check(`${tag}: Hard 1 solved piece by piece with real drags: 15 base coins + 3 bonus coins x 3 = 24`, rh.misses.length === 0 && s.done && s.won && s.won.total === 24 && s.unlocked.hard === 2, `misses ${JSON.stringify(rh.misses)}, won ${JSON.stringify(s.won)}`);
    s = await settle((q) => q.results, 16000);
    check(`${tag}: ...and all 24 coins are counted before the results card`, !!s && s.tally === 24, s && `counted ${s.tally}`);
    await waitFor(() => ev(`document.querySelectorAll('#resLoot svg.pop').length === 4`), 3000);
    await sleep(350);
    await shot(`${tag}-19-hard1-results`);

    // ---------- the bonus coins drain as time passes: no countdown, no message, and the base is still given ----------
    await D("start('easy', 2, true)");
    s = await settle((q) => q.puzzle === 'e2' && q.pieces.filter((v) => v.st === 'tray' && v.ready).length === 3, 4000);
    await sleep(1200);
    s = await st();
    check(`${tag}: before the first touch the clock stands still`, s.t === 0 && !s.started && s.bonus === 3, `t ${s.t}`);
    const T = s.bonusTimes;
    let p2 = await nextPiece();
    await touchDrag({ x: p2.cx, y: p2.cy }, { x: p2.hcx, y: p2.hcy }, { steps: 8 });
    await D(`addTime(${T[0] - 1.2})`);
    s = await st();
    const before = { bonus: s.bonus, shown: s.bonusShown, t: s.t };
    s = await settle((q) => q.bonus === 2 && q.leaving === 1, 4000, 30);
    check(`${tag}: at ${T[0]} s the first bonus coin drifts away like a bubble (it was still there a second before)`, before.bonus === 3 && before.shown === 3 && !!s && s.bonusShown === 2 && s.t >= T[0], s && `t ${s.t.toFixed(1)}, bonus ${s.bonus}, drifting ${s.leaving}`);
    await sleep(500);
    await still(`${tag}-20-a-bonus-coin-drifts-away`);
    const dom = await ev(`document.body.innerText.replace(/\\s+/g, ' ').trim()`);
    check(`${tag}: no countdown and no words in the page while playing`, dom === '', `visible text: "${dom.slice(0, 40)}"`);
    await D(`addTime(${T[2] - T[0] + 5})`);
    s = await settle((q) => q.bonus === 0 && q.bonusShown === 0, 3000);
    check(`${tag}: after ${T[2]} s all three have gone`, !!s, s && `bonus ${s.bonus}`);
    await solveByTouch(4);
    s = await st();
    check(`${tag}: a slow finish is still a finish: the 5 base coins, the next puzzle open, and no bonus`, s.done && s.won && s.won.total === 5 && s.won.bonus === 0 && s.unlocked.easy === 3 && s.best[1] === 0, s.won && `won ${JSON.stringify(s.won)}`);
    s = await settle((q) => q.results, 12000);
    await waitFor(() => ev(`document.querySelectorAll('#resLoot svg.pop').length === 1`), 3000);
    await sleep(350);
    const slow = await ev(`({ key: document.querySelectorAll('#resLoot svg.keyl').length, coins: document.querySelectorAll('#resLoot svg.bonus').length, empty: document.querySelectorAll('#resLoot .empty, #resLoot [data-empty]').length, text: document.getElementById('resCoins').textContent })`);
    check(`${tag}: ...and its results card shows the key and +5, with no empty places for the coins that went`, !!s && s.tally === 5 && slow.key === 1 && slow.coins === 0 && slow.empty === 0 && slow.text === '+5', slow);
    await shot(`${tag}-21-results-after-a-slow-finish`);

    // ---------- a half-done puzzle is kept ----------
    await tapEl('#resNext');
    s = await settle((q) => q.screen === 'play' && q.puzzle === 'e3' && q.pieces.filter((v) => v.st === 'tray' && v.ready).length === 3, 4000);
    check(`${tag}: the next button starts the next puzzle`, !!s, s && s.puzzle);
    await solveByTouch(2);
    await D('addTime(12.5)');
    const half = await st();
    const homeIds = half.pieces.filter((q) => q.rule === 'home').map((q) => q.id);
    await tapEl('#gridBtn'); await sleep(350);
    s = await st();
    const kept = JSON.parse(await D('saved()')).runs.e3;
    check(`${tag}: the puzzles button goes back to the level select, and the half-done puzzle is saved`, s.screen === 'levels' && s.runs.join() === 'e3' && kept && kept.home.join() === homeIds.join() && kept.t >= half.t && kept.t < half.t + 3, `runs ${s.runs}, saved ${JSON.stringify(kept)}`);
    await reload(); await sleep(500);
    await tapEl('.lvl[data-n="3"]');
    s = await settle((q) => q.screen === 'play' && q.puzzle === 'e3' && q.pieces.filter((v) => v.st === 'tray' && v.ready).length === 3, 4000);
    await sleep(700);
    s = await st();
    check(`${tag}: after a reload the half-done puzzle comes back with its 2 pieces home and its clock at ${kept.t} s, waiting for the first touch`, s.homeCount === 2 && s.pieces.filter((q) => q.st === 'home').map((q) => q.id).join() === homeIds.join() && s.t === kept.t && !s.started && s.n - 2 === s.pieces.filter((q) => q.rule === 'tray' || q.rule === 'bag').length,
      `home ${s.pieces.filter((q) => q.st === 'home').map((q) => q.id)}, t ${s.t.toFixed(1)}, started ${s.started}`);
    bc = await D('boardCheck()');
    check(`${tag}: ...and those two pieces are drawn in their places`, homeIds.every((id) => bc.pieces[id] < 1.5) && bc.pieces.filter((v) => v > 6).length === 4, bc.pieces.join(', '));
    await still(`${tag}-22-easy3-resumed`);

    // ---------- an early and a late puzzle of each size, mid-play ----------
    for (const [m, n, k] of [['easy', 10, 7], ['medium', 10, 15], ['hard', 10, 26]]) {
      await loadWith(`localStorage.setItem('game.jigsaw.save', ${JSON.stringify(openSave())})`);
      await D(`start('${m}', ${n}, true)`);
      await settle((q) => q.pieces.some((v) => v.st === 'tray' && v.ready), 3000);
      await D(`solve(${k})`);
      await sleep(500);
      // a few pieces lying loose on the board, and one in a finger
      for (let i = 0; i < (m === 'easy' ? 1 : 3); i++) { const q = await nextPiece((v) => v.st === 'tray'); if (q) await D(`drop(${q.id}, 'board')`); }
      await sleep(700);
      s = await st();
      const q = await nextPiece((v) => v.st === 'tray');
      check(`${tag}: ${m} ${n} mid-play: ${s.n} pieces, ${s.homeCount} home, pieces at least 19vh, tray slots at least 19vh, board and tray on screen`,
        s.homeCount === k && vh(Math.min(s.cell.w, s.cell.h)) >= 19 && s.pieces.filter((v) => v.st === 'tray').every((v) => vh(Math.min(v.gw, v.gh)) >= 19) && inside(s.board, 4) && inside(s.tray, 1),
        `piece ${vh(s.cell.w)} x ${vh(s.cell.h)} vh, tray slot ${q ? vh(q.gw) + ' x ' + vh(q.gh) : '-'} vh, seen in the tray at ${vh(s.trayPiece.w)} x ${vh(s.trayPiece.h)} vh`);
      if (q) await touchDrag({ x: q.cx, y: q.cy }, { x: s.board.left + s.board.width * 0.52, y: s.board.top + s.board.height * 0.5 }, { steps: 8, beforeEnd: () => still(`${tag}-23-${m}${n}-late`) });
    }

    // ---------- home and back ----------
    where = 'hub';
    let loaded = cdp.once('Page.loadEventFired');
    await tapEl('#homeBtn');
    await loaded; await sleep(300);
    let href = await ev('location.href');
    check(`${tag}: the home button opens ../../index.html`, href === HUB, href.replace('file://' + ROOT, ''));
    await go(PAGE, 'jigsaw'); await sleep(300);
    where = 'hub';
    loaded = cdp.once('Page.loadEventFired');
    const ret = await ev('window.__back()');
    await loaded; await sleep(300);
    href = await ev('location.href');
    check(`${tag}: window.__back() returns true and opens ../../index.html`, ret === true && href === HUB, href.replace('file://' + ROOT, ''));
    await go(PAGE, 'jigsaw');
  }

  // ======================= the two phone sizes =======================
  if (PART !== 'more') {
    await suite(915, 412, 2.625, 'seeker');
    if (!QUICK) await suite(800, 360, 3, 'phone800');
  }
  if (PART !== 'suite') await more();

  // ======================= once, at the Seeker size =======================
  async function more() {
  console.log('\n=== more, at 915x412 ===');
  await viewport(915, 412, 2.625);

  // ---------- the thirty pictures, measured ----------
  await go(SHEET, 'sheet');
  await viewport(1874, 1002, 1);
  await waitFor(() => ev('!!(window.__sheet && window.__sheet.ready)'), 5000);
  await sleep(300);
  let r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1874, height: 1002, scale: 1 } });
  fs.writeFileSync(path.join(OUT, 'contact-sheet.png'), Buffer.from(r.data, 'base64')); shots.push(path.join(OUT, 'contact-sheet.png'));
  const M = await ev('window.__sheet.metrics()'), THUMBS = await ev('window.__sheet.thumbs()');
  await go(SHEET + '&cuts=1', 'sheet'); await sleep(300);
  r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1874, height: 1002, scale: 1 } });
  fs.writeFileSync(path.join(OUT, 'contact-sheet-cuts.png'), Buffer.from(r.data, 'base64')); shots.push(path.join(OUT, 'contact-sheet-cuts.png'));
  await viewport(915, 412, 2.625);
  check('the thirty pictures are thirty different pictures (the hashes of the rendered canvases all differ)', M.distinctHashes === 30 && M.rows.length === 30, `${M.distinctHashes} different hashes`);
  check('...and different to look at: even the two most alike differ plainly as 16 x 10 thumbnails', M.closest.d >= 14, `the closest pair is ${M.closest.a} and ${M.closest.b}: mean colour difference ${M.closest.d} of 255`);
  const flattest = M.rows.slice().sort((p, q) => q.flatShare - p.flatShare)[0], barest = M.rows.slice().sort((p, q) => p.least - q.least)[0];
  check('no picture has a large flat area: the biggest empty square in any picture is smaller than three quarters of one of its own pieces', M.rows.every((v) => v.flatShare <= 0.75),
    `the flattest is ${flattest.id} (${flattest.pic}): an empty square ${flattest.flatUnits} units across, ${flattest.flatShare} of a piece`);
  check('every piece of every puzzle has something to go by: at least 2.5% of its own square is a strong edge', M.rows.every((v) => v.least >= 0.025),
    `the barest piece is in ${barest.id} (${barest.pic}) at ${barest.leastAt}: ${(barest.least * 100).toFixed(1)}%`);
  fs.writeFileSync(path.join(OUT, 'pictures.json'), JSON.stringify(M, null, 2));

  // ---------- all thirty puzzles in the game ----------
  await loadWith(`localStorage.clear(); localStorage.setItem('game.jigsaw.save', ${JSON.stringify(openSave())})`);
  await sleep(300);
  const thumbDiff = (a, b) => a.reduce((n, v, i) => n + Math.abs(v - b[i]), 0) / a.length;
  const table = [];
  for (const p of L.PUZZLES) {
    await D(`start('${p.mode}', ${p.n}, true)`);
    await sleep(120);
    const s0 = await st(), b0 = await D('boardCheck()');
    const mine = thumbDiff(b0.thumb, THUMBS[p.id]), nearest = L.PUZZLES.map((q) => [q.id, thumbDiff(b0.thumb, THUMBS[q.id])]).sort((x, y) => x[1] - y[1])[0][0];
    const done = await D(`solve(${p.pieces})`);
    await sleep(260);
    const s1 = await st(), b1 = await D('boardCheck()');
    const seam = (2 * (p.cw + p.ch) * 5.2) / (p.cw * p.ch);   // about how much of a piece its drawn edge covers
    const ok = s0.puzzle === p.id && s0.n === p.pieces && s0.asset === p.id && vh(Math.min(s0.cell.w, s0.cell.h)) >= 19 && s0.pieces.filter((q) => q.st === 'tray').every((q) => vh(Math.min(q.gw, q.gh)) >= 19)
      && mine < 6 && nearest === p.id && b0.pieces.filter((v) => v > 4).length >= p.pieces * 0.9
      && done === p.pieces && s1.done && b1.pieces.every((v) => v < 1.5) && b1.share > 0.001 && b1.share < seam
      && s1.won.total === L.MODES[p.mode].base + 3 * L.MODES[p.mode].bonusEach;
    table.push({ id: p.id, ok, pieces: p.pieces, cellVh: `${vh(s0.cell.w)}x${vh(s0.cell.h)}`, picture: +mine.toFixed(1), nearest, worst: Math.max(...b1.pieces), seams: +(b1.share * 100).toFixed(1), coins: s1.won && s1.won.total });
  }
  const badP = table.filter((t) => !t.ok);
  check('all thirty puzzles: the board shows that puzzle\'s own picture, every piece put home is exactly its bit of it, nothing is under 19vh, and a quick finish pays base + 3 bonus',
    badP.length === 0, badP.length ? JSON.stringify(badP) : `pieces ${table.map((t) => t.pieces).join(',')}; smallest piece ${table.map((t) => t.cellVh).sort()[0]} vh; worst piece difference ${Math.max(...table.map((t) => t.worst))}`);
  await D('goLevels()'); await sleep(300);
  const lvAll = await ev(`({ done: document.querySelectorAll('.lvl.done').length, locked: document.querySelectorAll('.lvl.locked').length, coins: document.querySelectorAll('.lvl .st svg').length, pill: document.getElementById('coinCount').textContent })`);
  check('with every puzzle finished the level select shows ten keys and thirty coins, and the purse holds 10 x 8 + 10 x 16 + 10 x 24 = 480', lvAll.done === 10 && lvAll.locked === 0 && lvAll.coins === 30 && lvAll.pill === '480', lvAll);
  await shot('levels-all-done-easy');
  await D("goLevels('hard')"); await sleep(300);
  await shot('levels-all-done-hard');

  // ---------- two fingers at once ----------
  await D("start('medium', 3, true)");
  let s = await settle((q) => q.pieces.filter((v) => v.st === 'tray' && v.ready).length === 8, 3000);
  const two = s.pieces.filter((q) => q.st === 'tray').slice(0, 2);
  await touch('touchStart', [pt(two[0].cx, two[0].cy, 1), pt(two[1].cx, two[1].cy, 2)]);
  for (let i = 1; i <= 10; i++) { const u = i / 10; await touch('touchMove', two.map((q, k) => pt(q.cx + (q.hcx - q.cx) * u, q.cy + (q.hcy - q.cy) * u, k + 1))); await sleep(16); }
  const mid = await st();
  await touch('touchEnd', []);
  s = await settle((q) => q.homeCount === 2, 1500);
  check('two fingers can carry two pieces home at once', mid.held === 2 && !!s && two.every((q) => s.pieces[q.id].rule === 'home'), `held ${mid.held}, home ${s ? s.homeCount : '?'}`);

  // ---------- the hand helps a child who is stuck ----------
  await D("start('hard', 2, true)");
  await settle((q) => q.pieces.filter((v) => v.st === 'tray' && v.ready).length === 8, 3000);
  await sleep(1500);
  s = await st();
  const noHint = s.hint === null;
  await D('idle(46)');
  s = await settle((q) => q.hint != null, 2000);
  check('no hand on Hard at the start; after 45 s with no piece going home, the hand shows where one goes', noHint && !!s, s ? `hand on piece ${s.hint}` : 'no hand');
  await still('hard2-the-hand-after-a-long-wait');

  // ---------- the title, held for 4 seconds, opens every puzzle (a grown-up's shortcut) ----------
  await loadWith('localStorage.clear()');
  await sleep(300);
  const tr = await rectOf('#title');
  await touch('touchStart', [pt(tr.left + tr.width / 2, tr.top + tr.height / 2)]);
  await sleep(4300);
  await touch('touchEnd', []);
  await sleep(250);
  s = await st();
  check('holding the title for 4 seconds opens every puzzle in all three sizes', s.unlocked.easy === 10 && s.unlocked.medium === 10 && s.unlocked.hard === 10 && (await ev(`document.querySelectorAll('.lvl.locked').length`)) === 0, JSON.stringify(s.unlocked));

  // ---------- inside the Android app: window.IsabellaStore ----------
  const stored = openSave({ coins: 77, mode: 'medium' });
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source:
    `(() => { const m = new Map([['isabella.save', JSON.stringify({ unlocked: 7, muted: true, crown: true })], ['game.jigsaw.save', ${JSON.stringify(stored)}]]);
      window.__fakeStore = m; window.IsabellaStore = { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); } }; })();` });
  await reload(); await sleep(500);
  const localBefore = await ev(`localStorage.getItem('game.jigsaw.save')`);
  s = await st();
  check('IsabellaStore: the save and the mute setting are read from the app store', s.coins === 77 && s.mode === 'medium' && s.muted === true, `coins ${s.coins}, mode ${s.mode}, muted ${s.muted}`);
  await D("start('easy', 1, true)"); await sleep(200); await D('solve(4)'); await sleep(200);
  const inStore = JSON.parse(await ev(`window.__fakeStore.get('game.jigsaw.save')`));
  check('IsabellaStore: saves go to the app store, not localStorage', inStore.coins === 85 && (await ev(`localStorage.getItem('game.jigsaw.save')`)) === localBefore, `store coins ${inStore.coins}`);
  await D('goLevels()'); await sleep(200);
  await tapEl('#soundBtn'); await sleep(150);
  const main = JSON.parse(await ev(`window.__fakeStore.get('isabella.save')`));
  check('the sound button changes only `muted` in isabella.save and leaves the rest of the main game\'s save alone', main.muted === false && main.unlocked === 7 && main.crown === true && Object.keys(main).length === 3, JSON.stringify(main));
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

  // ---------- sound follows the main game's mute switch ----------
  await loadWith(`localStorage.clear(); localStorage.setItem('isabella.save', JSON.stringify({ unlocked: 3, muted: true }))`);
  await sleep(400);
  await tapEl('.lvl[data-n="1"]'); await sleep(300);
  s = await st();
  check('muted when isabella.save says so (no audio started at all)', s.muted === true && s.audio === 'none', `muted ${s.muted}, audio ${s.audio}`);
  await loadWith(`localStorage.setItem('isabella.save', JSON.stringify({ unlocked: 3, muted: false }))`);
  await sleep(400);
  const audioBefore = (await st()).audio;
  await tapEl('.lvl[data-n="1"]'); await sleep(400);
  s = await st();
  check('not muted: sound waits for a gesture, then runs after the first tap', audioBefore === 'none' && s.muted === false && s.audio === 'running' && s.gain > 0.5, `before ${audioBefore}, after ${s.audio}, gain ${s.gain}`);
  await ev(`localStorage.removeItem('isabella.save')`);

  // ---------- held upright the game waits behind a turn-the-phone picture ----------
  await loadWith(`localStorage.clear(); localStorage.setItem('game.jigsaw.save', ${JSON.stringify(openSave())})`);
  await D("start('medium', 2, true)");
  s = await settle((q) => q.pieces.filter((v) => v.st === 'tray' && v.ready).length === 8, 3000);
  await D('solve(3)'); await sleep(300);
  const before = await st();
  await viewport(412, 915, 2.625);
  await sleep(400);
  const up = await ev(`getComputedStyle(document.getElementById('rotate')).display`);
  const cu0 = await D('counters');
  await touchTap(200, 400); await sleep(100);
  check('held upright: a turn-the-phone picture covers the game and touches do nothing', up === 'flex' && (await D('counters')).grabs === cu0.grabs && (await D('counters')).downs === cu0.downs, `rotate ${up}`);
  // ---------- a different screen size mid-puzzle: everything is laid out and cut again ----------
  await viewport(800, 360, 3);
  await sleep(500);
  s = await st();
  const bcR = await D('boardCheck()');
  check('a change of screen size mid-puzzle keeps the puzzle: the same pieces home (redrawn at the new size), the tray inside the screen', s.homeCount === 3 && s.puzzle === 'm2' && inside(s.board, 4) && inside(s.tray, 1)
    && s.pieces.filter((q) => q.rule === 'home').every((q) => bcR.pieces[q.id] < 1.5) && s.pieces.filter((q) => q.st === 'tray').every((q) => q.cx > s.tray.left && q.cx < s.tray.right) && s.canvas[0] === 2000,
    `home ${s.homeCount}, canvas ${s.canvas}, board ${s.board.width.toFixed(0)} px wide (was ${before.board.width.toFixed(0)})`);
  const rz = await solveByTouch(2);
  check('...and it still plays', rz.done === 2 && rz.misses.length === 0, JSON.stringify(rz));
  // a squarer screen (16:10 tablet shape): the board shrinks to leave room for the tray
  await viewport(960, 600, 2);
  await sleep(500);
  s = await st();
  check('on a squarer screen the board shrinks so the tray still fits, and it still plays', inside(s.board, 4) && inside(s.tray, 1) && s.board.right <= s.tray.left && s.boardScale < 1 && s.homeCount === 5 && (await solveByTouch(1)).done === 1,
    `board scale ${s.boardScale.toFixed(2)}, tray ${s.tray.width.toFixed(0)} px wide`);
  await still('squarer-screen-960x600');
  await D('goLevels()'); await sleep(300);
  const sq = await ev(`(() => { const r = (id) => document.querySelector(id).getBoundingClientRect(), g = r('#grid'), h = r('#homeBtn'), p = r('.pill'), t = r('#title'), m = r('#mode-hard'), sd = r('#soundBtn');
    return { gridIn: g.left >= 0 && g.right <= innerWidth && g.bottom <= innerHeight, clearOfHome: g.left >= h.right - 1 && g.left >= sd.right - 1, titleClearOfPill: t.left >= h.right - 2 && m.right <= p.left + 2 }; })()`);
  check('...and its level select still fits', sq.gridIn && sq.clearOfHome && sq.titleClearOfPill, sq);
  await shot('squarer-screen-960x600-level-select');
  await viewport(915, 412, 2.625);
  await sleep(400);

  // ---------- the title-screen symbol ----------
  const sym = fs.readFileSync(path.join(DIR, 'hub-symbol.svg'), 'utf8').match(/<symbol id=[\s\S]*<\/symbol>/);
  const hubHtml = fs.readFileSync(path.join(ROOT, 'web/index.html'), 'utf8');
  const hubSym = (id) => (hubHtml.match(new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`)) || [''])[0];
  await ev(`(() => { const d = document.createElement('div'); d.id = 'symTest'; d.style.cssText = 'position:fixed;inset:0;z-index:50;background:#1f8fc0;display:flex;gap:4vh;align-items:center;justify-content:center';
    d.innerHTML = '<svg width="0" height="0" style="position:absolute"><defs>' + ${JSON.stringify((sym ? sym[0] : '') + hubSym('i-maze') + hubSym('i-words') + hubSym('i-shell'))} + '</defs></svg>'
      + ['i-shell:#ff6fb0', 'i-maze:#2ec4a6', 'i-words:#b46cf0', 'i-jigsaw:#ff9f43'].map((v) => { const [id, c] = v.split(':'); return '<div class="btn" style="width:20vh;height:20vh;background:radial-gradient(circle at 35% 28%, #fff, ' + c + ' 55%, ' + c + ')"><svg viewBox="0 0 24 24" style="width:68%;height:68%;filter:none"><use href="#' + id + '"/></svg></div>'; }).join('');
    document.body.appendChild(d); })()`);
  await sleep(200);
  const symBox = await ev(`(() => { const s = document.getElementById('i-jigsaw'); if (!s) return null; const u = document.querySelector('#symTest use[href="#i-jigsaw"]').getBoundingClientRect(); return { paths: s.querySelectorAll('path').length, viewBox: s.getAttribute('viewBox'), w: u.width, h: u.height }; })()`);
  check('hub-symbol.svg holds one <symbol id="i-jigsaw"> on the 24 x 24 grid the other game symbols use, and it draws', !!sym && !!symBox && symBox.viewBox === '0 0 24 24' && symBox.paths >= 1 && symBox.w > 20 && (fs.readFileSync(path.join(DIR, 'hub-symbol.svg'), 'utf8').match(/<symbol/g) || []).length === 1, symBox);
  await shot('hub-symbol-beside-the-others');
  await ev(`document.getElementById('symTest').remove()`);

  // ---------- frame rate: Hard 10, a full tray and twenty pieces lying on the board ----------
  await D("start('hard', 10, true)");
  await settle((q) => q.pieces.filter((v) => v.st === 'tray' && v.ready).length === 8, 3000);
  await D('solve(8)'); await sleep(400);
  for (let i = 0; i < 20; i++) { const q = await nextPiece((v) => v.st === 'tray'); if (q) await D(`drop(${q.id}, 'board')`); await sleep(110); }
  await sleep(1200);
  s = await st();
  const fpsExpr = `new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res({ frames: n, secs: (performance.now() - t0) / 1000 }); }; requestAnimationFrame(f); })`;
  await D('resetPerf()');
  const fps = await ev(fpsExpr), perf = await D('perf()');
  check('frame rate on Hard 10 with 8 pieces in the tray and 20 lying on the board', s.loose.length === 20 && fps.frames / fps.secs >= 55, `${(fps.frames / fps.secs).toFixed(1)} fps; game update+draw avg ${perf.avgMs.toFixed(2)} ms, p95 ${perf.p95Ms.toFixed(2)} ms; ${s.loose.length} loose`);
  await still('hard10-twenty-loose-pieces');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await D('resetPerf()');
  const fps4 = await ev(fpsExpr), perf4 = await D('perf()');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  check('frame rate with the CPU slowed 4x (a modest phone)', fps4.frames / fps4.secs >= 45, `${(fps4.frames / fps4.secs).toFixed(1)} fps; game work p95 ${perf4.p95Ms.toFixed(2)} ms`);
  const tStart = Date.now();
  await D("start('hard', 9, true)");
  const startMs = await ev(`(() => { const t0 = performance.now(); window.__jigsawDebug.start('hard', 10, true); return performance.now() - t0; })()`);
  check('starting the biggest puzzle (painting the picture and cutting 40 pieces out of it) takes well under a second', startMs < 700, `${startMs.toFixed(0)} ms (${Date.now() - tStart} ms with the round trip)`);
  const cache = (await st()).caches;
  check('only one puzzle\'s pictures are ever kept: 40 pieces, and every canvas made is either in use or freed', cache.sprites === 40 && cache.live <= 2 + 40 * 2 + 30 + cache.glow + 2 && cache.back <= 1, JSON.stringify(cache));
  }

  // ---------- no errors ----------
  const mine = problems.filter((p) => p.where === 'jigsaw' || p.where === 'sheet');
  check('no console errors, warnings or exceptions on the game page', mine.length === 0, mine.length ? JSON.stringify(mine.slice(0, 5)) : 'none');

  const failed = results.filter((v) => !v.ok);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), page: PAGE.replace('file://' + ROOT, ''), results, problems, shots: shots.map((f) => path.basename(f)) }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed. Screenshots in ${OUT}`);
  cdp.close(); cdp.proc.kill();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  if (chrome) chrome.kill();
  if (e && e.bail) { console.log(`\n${results.filter((v) => v.ok).length}/${results.length} browser checks passed before stopping at the first failure.`); process.exit(1); }
  console.error('browser test crashed:', e); process.exit(2);
});
