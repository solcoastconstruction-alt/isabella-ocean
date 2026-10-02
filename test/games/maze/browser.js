// Coral Maze in headless Chrome at the Seeker's landscape sizes (915x412 and 800x360 CSS px, DPR 2.625, touch).
//   node test/games/maze/browser.js [outDir] [chromeProfileDir]
//   (defaults: $TMPDIR/coral-maze-shots and $TMPDIR/chrome-maze; DevTools port 9454)
// At each size: a fresh save opens on the level select (bubbles, padlocks, two pages, 19vh targets, nothing
// overlapping); levels 1, 10 and 20 are played to the open sea on the solver's way, move by move through
// __mazeDebug.move (each glide scheduled for the tick the solver chose, so the patrols are where it expects);
// stars are saved and the next level unlocks; the home button and Android back go to ../../index.html.
// Then, at 915x412, real fingers through Input.dispatchTouchEvent: whole levels by swipes and by taps, a sloppy
// diagonal, a bump into a wall; the hint after a quiet spell; the mute switch shared with the main game's save
// (only its `muted` field changes, and an unreadable save is never overwritten); window.IsabellaStore; the frame
// rate. No console errors, exceptions or failed loads anywhere.
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');

const REPO = path.resolve(__dirname, '../../..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'coral-maze-shots'));
const PROFILE = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'chrome-maze'));
const PORT = 9454, DPR = 2.625;
const GAME = '/web/games/maze/index.html';

let fails = 0, checks = 0;
function check(ok, what, detail) {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const srv = await serve(REPO);
  const base = `http://127.0.0.1:${srv.port}`;
  const chrome = await launch({ port: PORT, profile: PROFILE, width: 915, height: 412 });
  let page;
  try {
    page = await openPage(PORT);
    const P = page;
    const st = () => P.eval('__mazeDebug.state');
    const shot = async (name) => { const f = await P.shot(path.join(OUT, name + '.png')); console.log(`        shot ${f}`); };
    const rectOf = (sel) => P.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, vis: getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' }; })()`);
    const tapEl = async (sel) => { const r = await rectOf(sel); await P.tap(r.x + r.w / 2, r.y + r.h / 2); };
    const savedRaw = () => P.eval(`localStorage.getItem('isabella.maze')`);
    const resting = () => P.waitFor('(() => { const s = __mazeDebug.state; return s.phase === "win" || (s.phase === "play" && s.resting && !s.queued); })()', 15000, 'Isabella to rest');
    // The solver's way out from where she is, each glide scheduled for its tick (so patrols are where it expects).
    async function playSolver(n, label) {
      await P.waitFor(`__mazeDebug.state.level === ${n}`, 4000);
      await sleep(250);
      const sol = await P.eval('__mazeDebug.solve()');
      for (const s of sol.steps) await P.eval(`__mazeDebug.move(${JSON.stringify(s.dir)}, ${s.at})`);
      await P.waitFor('__mazeDebug.state.screen === "results"', 60000, `level ${n} results`);
      await P.waitFor('document.querySelectorAll("#bigStars svg.pop").length === 3', 4000, 'the stars to pop');
      const s = await st();
      check(s.won && s.moves === sol.par && s.optimal === sol.par && s.resultsStars === 3,
        `${label}: level ${n} played on the solver's way through __mazeDebug.move: out in ${s.moves} moves (par ${s.optimal}), 3 stars`, { moves: s.moves, par: sol.par, stars: s.resultsStars });
      return s;
    }

    for (const [W, H] of [[915, 412], [800, 360]]) {
      const tag = `${W}x${H}`;
      console.log(`\n${tag} CSS px at DPR ${DPR} (DevTools port ${PORT}, profile ${PROFILE})`);
      await P.viewport(W, H, DPR);
      await P.goto(base + GAME);
      await P.eval('localStorage.clear()');
      await P.goto(base + GAME);
      await sleep(500);
      let s = await st();
      check(s.screen === 'levels' && JSON.stringify(s.save) === JSON.stringify({ unlocked: 1, stars: new Array(20).fill(0) }), `${tag}: opens on the level select with a fresh save`);
      check(s.dpr === 2.5, `${tag}: canvas DPR capped at 2.5 (device ${DPR})`, s.dpr);
      const vh = H / 100;
      const sizes = {};
      for (const sel of ['.lvl', '#homeBtn', '#soundBtn', '#pgNext']) { const r = await rectOf(sel); sizes[sel] = +(Math.min(r.w, r.h) / vh).toFixed(1); }
      check(Object.values(sizes).every((v) => v >= 19), `${tag}: level bubbles, home, sound and page buttons are at least 19vh`, sizes);
      check((await P.eval(`document.querySelectorAll('.lvl').length`)) === 10 && (await P.eval(`document.querySelectorAll('.lvl.locked').length`)) === 9, `${tag}: page 1 shows 10 bubbles, 9 with padlocks`);
      const ov = await P.eval(`(() => { const ids = ['title', 'grid', 'homeBtn', 'soundBtn', 'pgNext', 'pgDots'], r = ids.map((i) => document.getElementById(i).getBoundingClientRect());
        r.push(document.querySelector('.pill').getBoundingClientRect()); ids.push('pill');
        const out = []; for (let i = 0; i < r.length; i++) { const a = r[i];
          if (a.left < 0 || a.top < 0 || a.right > innerWidth + 0.5 || a.bottom > innerHeight + 0.5) out.push(ids[i] + ' off screen');
          for (let j = i + 1; j < r.length; j++) { const b = r[j]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(ids[i] + '/' + ids[j]); } }
        return out; })()`);
      check(ov.length === 0, `${tag}: title, grid, star count, home, sound, page arrow and dots do not overlap or leave the screen`, ov);
      await shot(`${tag}-01-levels`);
      await tapEl('.lvl[data-level="2"]');
      await sleep(150);
      check((await st()).screen === 'levels' && (await P.eval(`document.querySelector('.lvl[data-level="2"]').classList.contains('shake')`)), `${tag}: a padlocked level only wiggles`);

      // ---- level 1 ----
      await tapEl('.lvl[data-level="1"]');
      s = await playSolver(1, tag);
      const res = {};
      for (const sel of ['#resLevels', '#resReplay', '#resNext']) { const r = await rectOf(sel); res[sel] = +(Math.min(r.w, r.h) / vh).toFixed(1); }
      check(Object.values(res).every((v) => v >= 19), `${tag}: results buttons are at least 19vh`, res);
      await shot(`${tag}-02-level1-results`);
      let sv = JSON.parse(await savedRaw());
      check(sv.stars[0] === 3 && sv.unlocked === 2, `${tag}: saved under isabella.maze: level 1 = 3 stars, level 2 unlocked`, sv);
      await tapEl('#resLevels');
      await sleep(300);
      check(!(await P.eval(`document.querySelector('.lvl[data-level="2"]').classList.contains('locked')`)) && (await P.eval(`document.querySelector('.lvl[data-level="3"]').classList.contains('locked')`)), `${tag}: level 2 now open on the level select, level 3 still padlocked`);

      // ---- level 10 (started directly: it is still padlocked for a fresh save) ----
      await P.eval('__mazeDebug.start(10)');
      s = await playSolver(10, tag);
      sv = JSON.parse(await savedRaw());
      check(sv.stars[9] === 3 && sv.unlocked === 11, `${tag}: level 10 saved with 3 stars and level 11 unlocked`, sv);
      await tapEl('#resLevels');
      await sleep(300);
      check((await st()).page === 1 && !(await P.eval(`document.querySelector('.lvl[data-level="11"]').classList.contains('locked')`)) && (await P.eval(`document.querySelector('.lvl[data-level="12"]').classList.contains('locked')`)), `${tag}: back on page 2, level 11 open and level 12 padlocked`);
      await shot(`${tag}-03-levels-page2`);
      await tapEl('#pgPrev');
      await sleep(250);
      check((await st()).page === 0 && (await P.eval(`document.querySelector('.lvl[data-level="10"] .st svg use').getAttribute('fill')`)) === '#ffd23f', `${tag}: the page arrow goes back to page 1, where level 10 shows its stars`);

      // ---- level 20 ----
      await P.eval('__mazeDebug.start(20)');
      await P.eval('__mazeDebug.resetPerf()');
      await sleep(2500);
      const perf = await P.eval('__mazeDebug.perf()');
      s = await playSolver(20, tag);
      sv = JSON.parse(await savedRaw());
      check(sv.stars[19] === 3 && sv.unlocked === 20 && s.crown === true, `${tag}: level 20 saved with 3 stars, and Isabella has her crown`, { stars: sv.stars[19], unlocked: sv.unlocked, crown: s.crown });
      check((await rectOf('#resCrown')).vis && !(await rectOf('#resNext')).vis, `${tag}: the last level's results show the crown and no "next" button`);
      console.log(`        frame stats, level 20 in the dark (headless, ${Math.round(W * 2.5)}x${Math.round(H * 2.5)} canvas): ${JSON.stringify(perf, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v))}`);
      check(perf.fps > 50 && perf.drawP95Ms < 10, `${tag}: level 20 draws at over 50 fps with p95 draw time under 10 ms`, { fps: +perf.fps.toFixed(1), p95: +perf.drawP95Ms.toFixed(2) });
      await shot(`${tag}-04-level20-results`);

      // ---- home ----
      await tapEl('#homeBtn');
      await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the home button to reach the hub');
      check(true, `${tag}: the home button goes to ../../index.html (the hub)`);
    }

    // ================= real fingers (915x412) =================
    console.log('\nreal touch input through Input.dispatchTouchEvent (915x412)');
    await P.viewport(915, 412, DPR);
    await P.goto(base + GAME);
    await sleep(400);
    // Swipe from Isabella in the plan's direction, 16vh long, then wait for her to rest.
    const swipeDir = async (dir, len, slant) => {
      const p = await P.eval('__mazeDebug.isabellaCss()'), d = 412 * (len || 0.16), k = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }[dir];
      const sx = slant || 0;   // a sloppy finger: drift sideways by this fraction of the length
      await P.swipe(p.x, p.y, p.x + k[0] * d + k[1] * d * sx, p.y + k[1] * d + k[0] * d * sx, 6, 16);
    };
    async function playBySwipes(n, slantEvery) {
      await P.eval(`__mazeDebug.start(${n})`);
      await sleep(1000);
      const sol = await P.eval('__mazeDebug.solve()');
      let i = 0;
      for (const step of sol.steps) {
        await swipeDir(step.dir, 0.16, slantEvery && i % slantEvery === 1 ? 0.6 : 0);
        await resting();
        i++;
      }
      await P.waitFor('__mazeDebug.state.phase === "win"', 5000, `level ${n} won by swipes`);
      return { s: await st(), par: sol.par };
    }
    let t = await playBySwipes(1, 0);
    check(t.s.won && t.s.moves === t.par, `level 1 played with real touch swipes: out to the open sea in ${t.s.moves} swipes (par ${t.par})`);
    await P.waitFor('__mazeDebug.state.screen === "results"', 6000);
    t = await playBySwipes(6, 2);
    check(t.s.won && t.s.moves === t.par, `level 6 (key and gate) played with real touch swipes, every other one a sloppy diagonal: out in ${t.s.moves} (par ${t.par})`);
    await P.waitFor('__mazeDebug.state.screen === "results"', 6000);
    await shot('touch-01-level6-swiped-results');

    // a whole level by tapping spots along her tunnel (the end of each of the solver's glides)
    await P.eval('__mazeDebug.start(3)');
    await sleep(1000);
    let sol = await P.eval('__mazeDebug.solve()');
    for (const step of sol.steps) {
      const target = step.cells[step.cells.length - 1], c = await P.eval(`__mazeDebug.cellCss(${target})`);
      await P.tap(c.x, c.y);
      await resting();
    }
    t = { s: await st() };
    check(t.s.won && t.s.moves === sol.par, `level 3 played with real taps on the spot to swim to: out in ${t.s.moves} taps (par ${sol.par})`);
    await P.waitFor('__mazeDebug.state.screen === "results"', 6000);

    // a tap far along a straight tunnel passes side openings in one move; a swipe would stop at each
    await P.eval('__mazeDebug.start(8)');
    await sleep(1000);
    const far = await P.eval(`(() => { for (const d of ['up', 'right', 'down', 'left']) { const run = __mazeDebug.tapRun(d); if (run.length >= 2) return { d, cell: run[run.length - 1], n: run.length }; } return null; })()`);
    if (far) {
      const before = await st(), c = await P.eval(`__mazeDebug.cellCss(${far.cell})`);
      await P.tap(c.x, c.y);
      await resting();
      const after = await st();
      check(after.pos.cell === far.cell && after.moves === before.moves + 1, `a tap ${far.n} cells along the tunnel goes straight there in one move`, { from: before.pos.cell, to: after.pos.cell, target: far.cell });
    }

    // swiping into a wall: a little bump, no move counted; a diagonal whose bigger part is a wall uses the smaller part
    await P.eval('__mazeDebug.start(1)');
    await sleep(1000);
    const walls = await P.eval(`(() => { const lv = MazeLogic.build(1), st = MazeLogic.newState(lv), out = [];
      for (let d = 0; d < 4; d++) out.push(MazeLogic.canPass(lv, st, lv.start, d)); return out; })()`);
    const blocked = ['up', 'right', 'down', 'left'].filter((d, i) => !walls[i]), open = ['up', 'right', 'down', 'left'].filter((d, i) => walls[i]);
    let before = await st();
    await swipeDir(blocked[0], 0.16, 0);
    await sleep(500);
    let after = await st();
    check(after.pos.cell === before.pos.cell && after.moves === before.moves, `a swipe into a wall (${blocked[0]}) only bumps: no move, no penalty`, { moves: after.moves });
    // a diagonal: mostly toward a wall, partly toward an open way
    const perp = { up: ['left', 'right'], down: ['left', 'right'], left: ['up', 'down'], right: ['up', 'down'] };
    const pair = blocked.map((b) => [b, perp[b].find((o) => open.includes(o))]).find((x) => x[1]);
    if (pair) {
      const p = await P.eval('__mazeDebug.isabellaCss()'), k = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] }, d = 412 * 0.16;
      const vx = k[pair[0]][0] * d + k[pair[1]][0] * d * 0.7, vy = k[pair[0]][1] * d + k[pair[1]][1] * d * 0.7;
      await P.swipe(p.x, p.y, p.x + vx, p.y + vy, 6, 16);
      await resting();
      after = await st();
      check(after.moves === before.moves + 1 && after.pos.cell !== before.pos.cell, `a sloppy diagonal (mostly ${pair[0]}, a wall; partly ${pair[1]}, open) swims ${pair[1]}`, { from: before.pos.cell, to: after.pos.cell });
    }

    // ================= the hint =================
    console.log('\nthe hint');
    await P.eval('__mazeDebug.start(5)');
    await sleep(1200);
    check((await st()).hint === null, 'no hint while she is still finding her way');
    await P.eval('__mazeDebug.idle(25)');
    await P.waitFor('__mazeDebug.state.hint !== null', 4000, 'the hint trail after 20 s without progress');
    const hint = (await st()).hint;
    sol = await P.eval('__mazeDebug.solve()');
    check(hint.dir === sol.steps[0].dir && hint.cells.length >= 2, `after 20 s with no headway a trail shows the next glide (${hint.dir}, ${hint.cells.length - 1} cells), the solver's own first move`);
    await sleep(600);
    await shot('hint-01-level5-trail');
    await swipeDir(hint.dir, 0.16, 0);
    await resting();
    check((await st()).hint === null, 'the trail goes away once she swims');

    // ================= sound: shared with the main game's save, carefully =================
    console.log('\nthe mute switch (shared with isabella.save)');
    const herSave = JSON.stringify({ unlocked: 20, stars: new Array(20).fill(3), gold: 5271, muted: false, played: true, crown: true });
    await P.eval(`localStorage.setItem('isabella.save', ${JSON.stringify(herSave)})`);
    await P.goto(base + GAME);
    await sleep(400);
    check((await st()).crown === true, 'Isabella wears her crown when the main game says she earned it');
    await tapEl('#soundBtn');
    await sleep(150);
    let main = JSON.parse(await P.eval(`localStorage.getItem('isabella.save')`));
    const exp = JSON.parse(herSave);
    check(main.muted === true && (await st()).muted === true && JSON.stringify(Object.assign({}, main, { muted: false })) === herSave && (await P.eval(`document.querySelector('#soundBtn use').getAttribute('href')`)) === '#i-mute',
      'the sound switch mutes and writes muted:true into isabella.save, every other field untouched', main);
    await tapEl('#soundBtn');
    await sleep(150);
    check((await P.eval(`localStorage.getItem('isabella.save')`)) === herSave && (await st()).muted === false, 'switching back leaves isabella.save byte-for-byte as it was', exp.gold);
    await P.eval(`localStorage.setItem('isabella.save', '{not json')`);
    await P.goto(base + GAME);
    await sleep(300);
    await tapEl('#soundBtn');
    await sleep(150);
    check((await P.eval(`localStorage.getItem('isabella.save')`)) === '{not json' && (await st()).muted === true, 'an unreadable isabella.save is never overwritten (the switch still mutes this visit)');
    await P.eval(`localStorage.removeItem('isabella.save')`);

    // ================= inside the Android app: window.IsabellaStore =================
    console.log('\nwith window.IsabellaStore (as in the Android app)');
    const lsBefore = await savedRaw();
    const { identifier } = await P.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__fakeStore = { 'isabella.save': JSON.stringify({ muted: true, unlocked: 3 }), 'isabella.maze': JSON.stringify({ unlocked: 2, stars: [2] }) };
               window.IsabellaStore = { get: (k) => (k in window.__fakeStore ? window.__fakeStore[k] : null), set: (k, v) => { window.__fakeStore[k] = String(v); } };`,
    });
    await P.goto(base + GAME);
    await sleep(300);
    let s = await st();
    check(s.muted === true && s.save.unlocked === 2 && s.save.stars[0] === 2, 'progress and mute come from IsabellaStore, not localStorage', { muted: s.muted, unlocked: s.save.unlocked });
    await tapEl('.lvl[data-level="2"]');
    s = await playSolver(2, 'IsabellaStore');
    const fake = JSON.parse(await P.eval(`window.__fakeStore['isabella.maze']`));
    check(fake.stars[1] === 3 && fake.unlocked === 3 && (await savedRaw()) === lsBefore, 'the save is written to IsabellaStore under isabella.maze; localStorage left alone', fake);
    check((await st()).gain === 0, 'muted for real: master gain 0 once sound has started');
    await P.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

    // grown-ups: hold the title for 4 seconds to open every level
    await P.goto(base + GAME);
    await sleep(300);
    const tr = await rectOf('#title');
    await P.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tr.x + tr.w / 2, y: tr.y + tr.h / 2, id: 1 }] });
    await sleep(4300);
    await P.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
    check((await st()).save.unlocked === 20, 'holding the title for 4 s opens every level (stars untouched)');

    // held upright, the page asks to turn the phone
    await P.viewport(412, 915, DPR);
    await sleep(200);
    check((await P.eval(`getComputedStyle(document.getElementById('rotate')).display`)) === 'flex', 'portrait shows the turn-the-phone picture');
    await P.viewport(915, 412, DPR);

    // Android back: straight to the hub, from the middle of a level
    await P.eval('__mazeDebug.start(4)');
    await sleep(600);
    const back = await P.eval('window.__back()');
    await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the back button to reach the hub');
    check(back === true, 'window.__back() returns true and goes to ../../index.html');

    console.log('');
    check(page.errors.length === 0, 'no console errors, exceptions or failed loads on any page', page.errors);
  } catch (e) {
    fails++;
    console.log('  FAIL ' + (e.stack || e));
    if (page) console.log('  page errors: ' + JSON.stringify(page.errors));
    if (page) try { await page.shot(path.join(OUT, 'zz-failure.png')); } catch (e2) { /* ignore */ }
  } finally {
    if (page) page.close();
    await chrome.close();
    await srv.close();
  }
  console.log(`\n${checks - fails}/${checks} checks passed${fails ? `, ${fails} FAILED` : ''}. Screenshots in ${OUT}`);
  process.exit(fails ? 1 : 0);
})();
