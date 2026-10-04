// Splash Dash in headless Chrome at the Seeker's landscape sizes (915x412 and 800x360 CSS px, DPR 2.625, touch).
//   node test/games/dash/browser.js [outDir] [chromeProfileDir]
//   (defaults: <repo>/.local/shots and <repo>/.local/chrome-dash; DevTools port 9482)
//   DASH_ROOT=<a copy of the repo's web/ tree> serves that copy instead (mutate.js uses this)
// At each size: a fresh save opens on the level select (bubbles, padlocks, two pages, 19vh targets, nothing
// overlapping or off the screen); a course opened by a finger on its bubble shows the speed button (at least
// 19vh, at the side, clear of where she swims) and the coin counter; screenshots of an early, a middle and a late
// course at slow and at boosted speed, a bump, a leap, the finish line and the chest; a course finished to the
// chest, the stars, the save.
// Then, at 915x412, real fingers through Input.dispatchTouchEvent:
//   - steering: a finger held right of her, dragged left of her, then left in one place (she swims to it);
//   - the speed button with a second finger: the speed climbs steadily to the top, lets go and eases back;
//     a cancelled touch, a lost window and the finish line all let go of it too;
//   - a bump: a splash, down to slow, one coin spilled, and she swims on;
//   - kelp, and a leap off a wave ramp into the coins in the air;
//   - a whole course with one finger steering and one on the button: the finish, the chest, the stars;
// the tilt path: sensor events made in the page for both ways round of the phone, then REAL sensor events from
// Chrome's own sensor pipeline (devicemotion through the DevTools sensor overrides, deviceorientation through the
// DeviceOrientation override), window.__steer and window.__tilt as a native bridge would call them, and the
// window.__dbg readout; saving and reloading, stars that never go down, the mute switch shared with the main
// game's save, window.IsabellaStore, broken saves, the grown-ups' unlock, portrait, home and Android back, and the
// frame rate. No console errors, exceptions or failed loads anywhere.
'use strict';
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');
const { pose, orientation } = require('./phone.js');

const REPO = path.resolve(__dirname, '../../..');
const ROOT = path.resolve(process.env.DASH_ROOT || REPO);
const OUT = path.resolve(process.argv[2] || path.join(REPO, '.local/shots'));
const PROFILE = path.resolve(process.argv[3] || path.join(REPO, '.local/chrome-dash'));
const PORT = 9482, DPR = 2.625;
const GAME = '/web/games/dash/index.html';
const L = require(path.join(ROOT, 'web/games/dash/logic.js'));
const PILOT_SRC = fs.readFileSync(path.join(__dirname, 'pilot.js'), 'utf8');
const zeros = () => new Array(20).fill(0);
const FRESH = { unlocked: 1, stars: zeros(), best: zeros(), coins: 0, boosted: false };

// Put into every page: the model child (pilot.js) to steer while screenshots are taken or a finger follows it, and
// ways to make sensor events.
const HELPERS = `
window.__pilotOn = (mode, bridge) => {
  const PP = DashPilot.makePilot(DashLogic), run = __dashDebug.run, p = new PP.Pilot(run, mode || 'slow', 1);
  window.__pilot = p; clearInterval(window.__pilotT);
  let last = performance.now();
  window.__pilotT = setInterval(() => {
    if (__dashDebug.run !== run || run.phase !== 'play') { clearInterval(window.__pilotT); return; }
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    p.step(dt);
    if (bridge) __steer(p.steer);
  }, 16);
  return true;
};
window.__pilotOff = () => { clearInterval(window.__pilotT); return true; };
window.__openWater = () => { const lv = __dashDebug.run.lev; lv.buckets = []; lv.kelpBuckets = []; lv.ramps.length = 0; return true; };
window.__motion = (x, y, z) => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: x == null ? null : { x, y, z }, interval: 16 }));
window.__feed = (v, n, noise) => new Promise((res) => {
  let i = 0; const q = noise == null ? 0.03 : noise;
  const t = setInterval(() => { __motion(v[0] + q * Math.sin(i * 1.7), v[1] + q * Math.cos(i * 2.3), v[2] + q * Math.sin(i * 0.9)); if (++i >= n) { clearInterval(t); res(i); } }, 16);
});
true`;

// DASH_SECTIONS=fingers,tilt runs only those parts (mutate.js uses this); DASH_SIZES=915x412 only that size
const ONLY = (process.env.DASH_SECTIONS || '').split(',').filter(Boolean);
const want = (name) => !ONLY.length || ONLY.includes(name);
const SIZES = (process.env.DASH_SIZES || '915x412,800x360').split(',').map((z) => z.split('x').map(Number));
let fails = 0, checks = 0;
function check(ok, what, detail) {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return ok;
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const srv = await serve(ROOT);
  const base = `http://127.0.0.1:${srv.port}`;
  const chrome = await launch({ port: PORT, profile: PROFILE, width: 915, height: 412 });
  let page;
  try {
    page = await openPage(PORT);
    const P = page;
    const st = () => P.eval('__dashDebug.state');
    const shot = async (name) => { const f = await P.shot(path.join(OUT, name + '.png')); console.log(`        shot ${path.relative(REPO, f)}`); };
    const rectOf = (sel) => P.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, vis: getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' }; })()`);
    const centre = async (sel) => { const r = await rectOf(sel); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
    const tapEl = async (sel) => { const c = await centre(sel); await P.tap(c.x, c.y); };
    const savedRaw = () => P.eval(`localStorage.getItem('game.dash.save')`);
    const savedObj = async () => JSON.parse((await savedRaw()) || '{"stars":[],"best":[]}');   // (nothing saved: checks fail, they do not crash)
    const open = async (query) => { await P.goto(base + GAME + (query || '')); await P.eval(PILOT_SRC + ';' + HELPERS); await sleep(350); };
    const fresh = async () => { await P.goto(base + GAME); await P.eval('localStorage.clear()'); await open(); };
    const start = async (n) => { await P.eval(`__dashDebug.start(${n})`); await sleep(250); };
    const overlaps = (ids) => P.eval(`(() => { const ids = ${JSON.stringify(ids)}, r = ids.map((i) => document.querySelector(i).getBoundingClientRect()), out = [];
      for (let i = 0; i < r.length; i++) { const a = r[i];
        if (a.left < -0.5 || a.top < -0.5 || a.right > innerWidth + 0.5 || a.bottom > innerHeight + 0.5) out.push(ids[i] + ' off screen');
        for (let j = i + 1; j < r.length; j++) { const b = r[j]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(ids[i] + '/' + ids[j]); } }
      return out; })()`);
    // jump to just before the first thing of a kind on this course, on the clear lane
    const warpTo = (what, back) => P.eval(`(() => { const lv = __dashDebug.run.lev, w = ${JSON.stringify(what)};
      const o = typeof w === 'number' ? { s: w } : w === 'kelp' ? lv.kelp[0] : w === 'ramp' ? lv.ramps[0] : w === 'finish' ? { s: lv.len } : lv.obs.find((q) => q.k === w);
      if (!o) return null; const s = o.s - ${back || 0}; __dashDebug.warp(s, DashLogic.laneAt(lv, s)); return { s: o.s, x: o.x == null ? 0 : o.x, hx: o.hx || 0 }; })()`);
    // hold the speed button with a real finger for `ms`, the model child steering through the bridge
    const boostFor = async (ms) => {
      const g = await centre('#goBtn');
      await P.fingers('touchStart', [{ id: 2, x: g.x, y: g.y }]);
      await sleep(ms);
      return () => P.fingers('touchEnd', []);
    };
    // swim on to the chest and the results card (the model child steering, through window.__steer)
    const toResults = async (label) => {
      await P.waitFor('__dashDebug.state.phase === "done"', 20000, `${label}: the chest`);
      await P.waitFor('__dashDebug.state.screen === "results"', 8000, `${label}: the results card`);
      await P.waitFor('document.querySelectorAll("#bigStars svg.pop").length === 3', 4000, 'the stars to pop');
      return st();
    };

    const W = 915, H = 412, fy = H * 0.55;   // (the sections after the first all run at 915x412)
    let s, q;
    if (want('sizes')) {
    for (const [W, H] of SIZES) {
      const tag = `${W}x${H}`, vh = H / 100;
      console.log(`\n${tag} CSS px at DPR ${DPR} (DevTools port ${PORT}, profile ${path.relative(REPO, PROFILE)})`);
      await P.viewport(W, H, DPR);
      await fresh();
      let s = await st();
      check(s.screen === 'levels' && JSON.stringify(s.save) === JSON.stringify(FRESH), `${tag}: opens on the level select with a fresh save`, s.save);
      check(s.dpr === 2.5, `${tag}: canvas DPR capped at 2.5 (device ${DPR})`, s.dpr);
      const sizes = {};
      for (const sel of ['.lvl', '#homeBtn', '#soundBtn', '#pgNext']) { const r = await rectOf(sel); sizes[sel] = +(Math.min(r.w, r.h) / vh).toFixed(1); }
      check(Object.values(sizes).every((v) => v >= 19), `${tag}: level bubbles, home, sound and the page arrow are at least 19vh`, sizes);
      check((await P.eval(`document.querySelectorAll('.lvl').length`)) === 10 && (await P.eval(`document.querySelectorAll('.lvl.locked').length`)) === 9, `${tag}: page 1 shows 10 bubbles, 9 with padlocks`);
      let ov = await overlaps(['#title', '#grid', '#homeBtn', '#soundBtn', '#pgNext', '#pgDots', '#starPill', '#coinPill']);
      check(ov.length === 0, `${tag}: title, grid, star count, coin count, home, sound, page arrow and dots do not overlap or leave the screen`, ov);
      await sleep(900);
      await shot(`${tag}-01-levels`);
      await tapEl('.lvl[data-level="2"]');
      await sleep(150);
      check((await st()).screen === 'levels' && (await P.eval(`document.querySelector('.lvl[data-level="2"]').classList.contains('shake')`)), `${tag}: a padlocked course only wiggles`);
      await tapEl('#pgNext');
      await sleep(250);
      check((await st()).page === 1 && (await P.eval(`document.querySelectorAll('.lvl').length`)) === 10 && (await P.eval(`document.querySelector('.lvl').dataset.level`)) === '11', `${tag}: the page arrow shows courses 11 to 20`);
      await shot(`${tag}-02-levels-page2`);
      await tapEl('#pgPrev');
      await sleep(250);

      // ---- course 1, opened with a finger on its bubble ----
      await tapEl('.lvl[data-level="1"]');
      await P.waitFor('__dashDebug.state.screen === "play"', 3000, 'course 1 to start');
      await sleep(500);
      s = await st();
      check(s.level === 1 && s.phase === 'play' && s.v === L.V_SLOW && s.s > 0, `${tag}: a finger on bubble 1 starts course 1, and she is already swimming (slow speed ${L.V_SLOW})`, { v: s.v, s: s.s });
      const go = await rectOf('#goBtn'), hud = await rectOf('#hud'), home = await rectOf('#homeBtn');
      check(go.vis && Math.min(go.w, go.h) / vh >= 19, `${tag}: the speed button is ${(Math.min(go.w, go.h) / vh).toFixed(1)}vh (at least 19vh)`, go);
      check(go.x > W * 0.7 && go.x + go.w <= W + 0.5 && go.y + go.h <= H + 0.5, `${tag}: it sits at the right-hand side, all of it on the screen`, go);
      check(hud.vis && home.vis && (await overlaps(['#goBtn', '#hud', '#homeBtn'])).length === 0, `${tag}: speed button, coin counter and home button do not overlap`);
      check(s.her.x > W * 0.4 && s.her.x < W * 0.6 && s.her.y > H * 0.55 && s.her.y < H * 0.85, `${tag}: Isabella starts in the middle, in the lower part of the screen`, s.her);
      await sleep(900);
      check((await st()).hint === 'touch' && (await P.eval(`document.getElementById('goBtn').classList.contains('hint')`)), `${tag}: course 1 shows how to steer (a finger sliding, as no tilt sensor is live), and the speed button pulses`);
      await shot(`${tag}-03-course1-start-hint`);
      // as far right as she can go, she is still clear of the speed button
      await P.eval(`(__dashDebug.run.x = ${L.XMAX})`);
      await sleep(120);
      s = await st();
      check(s.her.x + 0.06 * W < go.x + 0.09 * go.w, `${tag}: at the far right of the course she is still left of the speed button`, { her: s.her.x, button: go.x });

      // ---- screenshots: an early, a middle and a late course, slow and boosted ----
      let n = 4;
      for (const [course, when] of [[2, 'early'], [10, 'middle'], [18, 'late']]) {
        await start(course);
        // (about a third of the way along, a little before something)
        const at = await P.eval(`(() => { const lv = __dashDebug.run.lev, o = lv.obs.find((q) => q.s > lv.len * 0.33) || lv.obs[0]; return o.s - 900; })()`);
        await warpTo(at);
        await P.eval(`__pilotOn('slow', true)`);
        await sleep(1300);
        s = await st();
        check(s.phase === 'play' && near(s.v, L.V_SLOW, 6) && s.bumps === 0, `${tag}: course ${course} (${when}) at slow speed`, { v: s.v, bumps: s.bumps });
        await shot(`${tag}-${String(n++).padStart(2, '0')}-course${course}-${when}-slow`);
        const lift = await boostFor(2700);
        s = await st();
        check(s.held && s.v > L.V_MAX - 15 && s.boost > 0.93, `${tag}: course ${course} (${when}) with the speed button held: top speed`, { v: s.v });
        await shot(`${tag}-${String(n++).padStart(2, '0')}-course${course}-${when}-boost`);
        await lift();
        await P.eval('__pilotOff()');
      }

      // ---- a leap ----
      await start(2);
      const ramp = await warpTo('ramp', 700);
      await P.eval(`__pilotOn('boost', true)`);
      let lift = await boostFor(100);
      await P.waitFor('__dashDebug.state.z > 60', 6000, 'the leap');
      await shot(`${tag}-10-leap`);
      await P.waitFor('__dashDebug.state.z === 0 && __dashDebug.state.leaps === 1', 3000, 'the landing');
      await lift();
      s = await st();
      check(s.leaps === 1 && s.picked >= 8 && s.bumps === 0, `${tag}: with the button held she leaps off the wave ramp and takes the coins in the air`, { leaps: s.leaps, picked: s.picked, ramp: ramp.s });
      await P.eval('__pilotOff()');

      // ---- a bump ----
      await start(1);
      await P.waitFor('__dashDebug.state.coins >= 5', 8000, 'the first five coins');
      const rock = await P.eval(`(() => { const o = __dashDebug.run.lev.obs[0]; __dashDebug.warp(o.s - 260, o.x); return { s: o.s, x: o.x, k: o.k }; })()`);
      const before = await st();
      await P.waitFor('__dashDebug.state.bumps === 1', 4000, 'the bump');
      s = await st();
      check(s.bumps === 1 && s.v <= L.V_BUMP + 25 && s.v > 0 && s.inv > 0, `${tag}: swimming into a rock is a bump: she drops to slow speed (${Math.round(s.v)}) but does not stop`, { v: s.v, rock });
      check(s.coins === before.coins - 1 && s.spilled === 1 && (await P.eval(`document.getElementById('coinCount').textContent`)) === String(s.coins), `${tag}: one coin spilled (${before.coins} -> ${s.coins}), and the counter shows it`);
      await sleep(130);
      await shot(`${tag}-11-bump`);
      await sleep(1500);
      const after = await st();
      check(after.phase === 'play' && after.s > rock.s + 100 && after.bumps === 1 && after.v > L.V_BUMP + 20, `${tag}: she swims on past the rock, picking her speed up again; no second bump, nothing lost but the coin`, { s: after.s, v: after.v, bumps: after.bumps });

      // ---- the finish: the line, the chest, the stars ----
      await start(1);
      await P.eval(`__pilotOn('slow', true)`);
      await P.waitFor('__dashDebug.state.coins >= 5', 8000, 'the first five coins');
      await warpTo('finish', 1300);
      await sleep(900);
      await shot(`${tag}-12-finish-line`);
      await P.waitFor('__dashDebug.state.phase !== "play"', 8000, 'the finish line');
      s = await st();
      check(s.phase === 'finish' && s.stars >= 1 && !(await rectOf('#goBtn')).vis, `${tag}: over the finish line: the stars are settled and the speed button goes away`, { stars: s.stars });
      let sv = (await savedObj());
      check(sv.stars[0] === s.stars && sv.unlocked === 2 && sv.coins === s.coins + 10 && sv.best[0] === s.coins, `${tag}: saved at the line under game.dash.save: her stars, course 2 open, her coins plus 10 from the chest`, sv);
      await P.waitFor('__dashDebug.state.phase === "done"', 20000, 'the chest');
      const doneAt = await st();
      check(near(doneAt.x, 0, 14) && doneAt.v === 0, `${tag}: she glides to the middle and stops at the treasure chest`, { x: doneAt.x });
      await P.waitFor('__dashDebug.state.party > 0.55', 5000, 'the party');
      s = await st();
      check(s.chestOpen > 0.9 && s.particles > 20, `${tag}: the chest bursts open with coins (${s.particles} of them in the air)`);
      await shot(`${tag}-13-chest`);
      s = await toResults(tag);
      const res = {};
      for (const sel of ['#resLevels', '#resReplay', '#resNext']) { const r = await rectOf(sel); res[sel] = +(Math.min(r.w, r.h) / vh).toFixed(1); }
      check(Object.values(res).every((v) => v >= 19), `${tag}: results buttons are at least 19vh`, res);
      const lit = await P.eval(`[...document.querySelectorAll('#bigStars svg use')].filter((u) => u.getAttribute('fill') === '#ffd23f').length`);
      check(lit === s.stars && (await P.eval(`document.getElementById('resCoins').textContent`)) === String(s.coins), `${tag}: the card shows her ${s.stars} star(s) and her ${s.coins} coins`, { lit });
      ov = await overlaps(['.card', '#homeBtn']);
      check(ov.length === 0, `${tag}: the results card is on the screen and clear of the home button`, ov);
      await shot(`${tag}-14-results`);
      await tapEl('#resLevels');
      await sleep(300);
      check((await st()).screen === 'levels' && !(await P.eval(`document.querySelector('.lvl[data-level="2"]').classList.contains('locked')`)) && (await P.eval(`document.querySelector('.lvl[data-level="3"]').classList.contains('locked')`))
        && (await P.eval(`document.getElementById('starCount').textContent`)) === `${s.stars}/60` && (await P.eval(`document.getElementById('coinTotal').textContent`)) === String(sv.coins),
      `${tag}: back on the level select: course 2 open, course 3 padlocked, ${s.stars}/60 stars, ${sv.coins} coins`);
      await shot(`${tag}-15-levels-after`);

      // ---- home ----
      await tapEl('#homeBtn');
      await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the home button to reach the hub');
      check(true, `${tag}: the home button goes to ../../index.html (the hub)`);
    }

    }
    if (want('fingers')) {
    await P.viewport(W, H, DPR);
    await fresh();
    // ================= real fingers (915x412) =================
    console.log('\nreal touch input through Input.dispatchTouchEvent (915x412)');
    await tapEl('.lvl[data-level="1"]');
    await P.waitFor('__dashDebug.state.screen === "play"', 3000);
    await P.eval('__openWater()');   // (the steering and button checks need open water: nothing to bump while they run)
    await sleep(300);
    s = await st();
    // a finger held to her right
    await P.fingers('touchStart', [{ id: 1, x: s.her.x + 220, y: fy }]);
    await sleep(450);
    let a = await st();
    check(a.input === 'touch' && a.touching && a.steer === 1 && a.x > 80 && a.vx > 0.8 * L.VX_MAX, 'a finger held to her right steers her right, at full steer', { input: a.input, steer: a.steer, x: a.x });
    // dragged to her left
    await P.fingers('touchMove', [{ id: 1, x: a.her.x - 220, y: fy }]);
    await sleep(600);
    let b = await st();
    check(b.input === 'touch' && b.steer === -1 && b.x < a.x - 60 && b.vx < 0, 'dragged to her left, she turns and swims left', { steer: b.steer, x: b.x, was: a.x });
    // left in one place: she swims to the finger and settles under it
    await P.fingers('touchMove', [{ id: 1, x: 300, y: fy }]);
    await sleep(2400);
    let c = await st();
    check(Math.abs(c.her.x - 300) < 12 && Math.abs(c.steer) < 0.25 && Math.abs(c.vx) < 60, 'with the finger left in one place she swims to it and settles under it', { her: c.her.x, steer: c.steer });
    await P.fingers('touchMove', [{ id: 1, x: 620, y: fy }]);
    await sleep(2600);
    c = await st();
    check(Math.abs(c.her.x - 620) < 12 && c.x > 0, 'and follows it across to the other side', { her: c.her.x, x: c.x });
    await P.fingers('touchEnd', []);
    await sleep(120);
    c = await st();
    check(c.input === 'none' && !c.touching && c.steer === 0, 'lifting the finger: straight ahead again (no tilt sensor here, so nothing steers)', { input: c.input, steer: c.steer });
    await sleep(500);
    check(Math.abs((await st()).vx) < 15, 'and she stops drifting sideways');

    // ---- the speed button, with a second finger while the first rests on the water ----
    await P.eval('__dashDebug.warp(600, 0)');
    await sleep(700);
    s = await st();
    const g = await centre('#goBtn');
    check(near(s.v, L.V_SLOW, 1) && !s.held && (await P.eval(`document.getElementById('goBtn').classList.contains('hint')`)), 'before the button: slow speed, and the button pulses (she has not found it yet)', s.v);
    await P.fingers('touchStart', [{ id: 1, x: s.her.x, y: fy }]);
    await P.fingers('touchStart', [{ id: 1, x: s.her.x, y: fy }, { id: 2, x: g.x, y: g.y }]);
    const t0 = (await st()).t;
    const up = (L.V_MAX - L.V_SLOW) / L.RAMP_UP;
    const samples = [];
    for (const wait of [500, 700, 700]) { await sleep(wait); const q = await st(); samples.push({ dt: q.t - t0, v: q.v, held: q.held, input: q.input }); }
    check(samples.every((q) => q.held && near(q.v, Math.min(L.V_MAX, L.V_SLOW + up * q.dt), 9)) && samples[0].v < samples[1].v && samples[1].v < samples[2].v && samples[2].v < L.V_MAX,
      `holding the speed button speeds her up gradually (${up} units/s each second): ${samples.map((q) => `${q.dt.toFixed(2)}s ${Math.round(q.v)}`).join(', ')}`, samples);
    check(samples.every((q) => q.input === 'touch'), 'the finger on the button does not steer; the finger on the water still does', samples.map((q) => q.input));
    await sleep(800);
    let top = await st();
    check(top.v === L.V_MAX && top.boost === 1 && top.held, `held for ${(top.t - t0).toFixed(1)}s she is at top speed (${L.V_MAX}), and no faster`, top.v);
    await sleep(500);
    top = await st();
    const ring = await P.eval(`+getComputedStyle(document.getElementById('goRing')).strokeDashoffset.replace('px', '')`);
    check(top.v === L.V_MAX && ring < 3 && (await P.eval(`document.getElementById('goBtn').classList.contains('down')`)) && !(await P.eval(`document.getElementById('goBtn').classList.contains('hint')`)), 'the ring round the button is full, the button is pressed in, and it has stopped pulsing', { ring });
    check((await savedObj()).boosted === true, 'that she has found the button is saved (it will not pulse again)');
    // let go of the button only (touchEnd names the finger that lifts; the other stays down)
    await P.fingers('touchEnd', [{ id: 2, x: g.x, y: g.y }]);
    await sleep(60);
    let rel = await st();
    const t1 = rel.t;
    check(!rel.held && rel.touching && rel.v < L.V_MAX && rel.v > L.V_MAX - 40 && !(await P.eval(`document.getElementById('goBtn').classList.contains('down')`)), 'letting go of the button: it is released at once, and she starts easing back (no jolt)', { held: rel.held, v: rel.v });
    const ease = [];
    for (const wait of [640, 700, 900]) { await sleep(wait); const q = await st(); ease.push({ dt: q.t - t1, v: q.v }); }
    check(ease.every((q) => q.v < L.V_MAX && q.v >= L.V_SLOW - 0.5) && near(ease[0].v, L.V_SLOW + (rel.v - L.V_SLOW) * Math.exp(-ease[0].dt / L.EASE_DOWN), 9) && ease[2].v < L.V_SLOW + 0.06 * (L.V_MAX - L.V_SLOW) && ease[0].v > ease[1].v && ease[1].v > ease[2].v,
      `she eases back to her slow swim: ${ease.map((q) => `${q.dt.toFixed(2)}s ${Math.round(q.v)}`).join(', ')}`, ease);
    await P.fingers('touchEnd', []);
    // a touch the system cancels lets go too
    await P.eval('__dashDebug.warp(600, 0)');
    await P.fingers('touchStart', [{ id: 2, x: g.x, y: g.y }]);
    await sleep(300);
    const heldBefore = (await st()).held;
    await P.fingers('touchCancel', []);
    await sleep(80);
    check(heldBefore && !(await st()).held, 'a cancelled touch lets go of the speed button');
    // and so does the window losing focus
    await P.fingers('touchStart', [{ id: 2, x: g.x, y: g.y }]);
    await sleep(200);
    const heldBefore2 = (await st()).held;
    await P.eval(`window.dispatchEvent(new Event('blur'))`);
    await sleep(60);
    check(heldBefore2 && !(await st()).held, 'the window losing focus lets go of the speed button');
    await P.fingers('touchEnd', []);
    await sleep(1200);
    check(near((await st()).v, L.V_SLOW, 25), 'left alone again she is back at her slow swim: she never stops', (await st()).v);

    // ---- kelp ----
    await start(3);
    const kelp = await P.eval(`(() => { const k = __dashDebug.run.lev.kelp[0]; __dashDebug.warp(k.s - 500, k.x); return k; })()`);
    const liftK = await boostFor(100);
    let minV = Infinity, sawBump = false, bumps0 = -1;
    for (let i = 0; i < 60; i++) {
      const q = await st();
      if (q.s > kelp.s - kelp.rs + 20 && q.s < kelp.s + kelp.rs - 20) { if (bumps0 < 0) bumps0 = q.bumps; minV = Math.min(minV, q.v); if (q.bumps > bumps0) sawBump = true; }
      if (q.s > kelp.s + kelp.rs + 60) break;
      await sleep(40);
    }
    await liftK();
    check(minV < L.V_SLOW && minV >= L.V_KELP - 1 && !sawBump, `kelp slows her even with the button held (down to ${Math.round(minV)}), and is no bump`, { minV });
    await shot('touch-01-kelp');

    }
    if (want('course')) {
    await P.viewport(W, H, DPR);
    await fresh();
    // ================= a whole course by finger: one steering, one on the button =================
    console.log('\ncourse 1 from start to chest with two real fingers (one steers along the model child\'s line, one holds the speed button)');
    await fresh();
    await tapEl('.lvl[data-level="1"]');
    await P.waitFor('__dashDebug.state.screen === "play"', 3000);
    await P.eval(`__pilotOn('boost', false)`);
    {
      const g2 = await centre('#goBtn'), full = Math.max(40, W * 0.09);
      let q = await st();
      await P.fingers('touchStart', [{ id: 1, x: q.her.x, y: fy }]);
      await P.fingers('touchStart', [{ id: 1, x: q.her.x, y: fy }, { id: 2, x: g2.x, y: g2.y }]);
      const t0w = Date.now();
      let moves = 0, maxV = 0, inputs = new Set();
      for (;;) {
        q = await P.eval(`(() => { const s = __dashDebug.state; return { phase: s.phase, her: s.her.x, steer: window.__pilot.steer, v: s.v, input: s.input, held: s.held }; })()`);
        if (q.phase !== 'play') break;
        maxV = Math.max(maxV, q.v); inputs.add(q.input);
        const x = Math.max(4, Math.min(W * 0.8, q.her + q.steer * full));
        await P.fingers('touchMove', [{ id: 1, x, y: fy }, { id: 2, x: g2.x, y: g2.y }]);
        moves++;
        if (Date.now() - t0w > 120000) throw new Error('course 1 by finger: no finish after 2 minutes');
        await sleep(25);
      }
      const secs = (Date.now() - t0w) / 1000;
      s = await st();
      check(s.phase !== 'play' && s.stars === 3 && s.coins >= 0.8 * s.ground, `course 1 swum with real fingers (${moves} finger moves, ${secs.toFixed(1)}s): over the line with ${s.coins}/${s.ground} coins, 3 stars`, { bumps: s.bumps, stars: s.stars });
      check(s.bumps <= 1, `the finger followed the model child's line cleanly (${s.bumps} bump${s.bumps === 1 ? '' : 's'})`);
      check(maxV === L.V_MAX && inputs.size === 1 && inputs.has('touch'), 'the button finger held top speed all the way, the other finger did all the steering', { maxV, inputs: [...inputs] });
      check(secs > 30 && secs < 50, `at full boost course 1 took ${secs.toFixed(1)}s (verify.js says ${'35–47'}s to the line)`);
      // the fingers are still down as she crosses the line: the button must let go by itself
      check(!s.held && !(await rectOf('#goBtn')).vis, 'crossing the line lets go of the speed button though the finger is still on it');
      await P.fingers('touchEnd', []);
      s = await toResults('course 1 by finger');
      check(s.results && s.stars === 3 && (await P.eval(`document.querySelectorAll('#bigStars svg use[fill="#ffd23f"]').length`)) === 3, 'the chest opens and the card shows 3 stars');
      const sv = (await savedObj());
      check(sv.stars[0] === 3 && sv.unlocked === 2 && sv.best[0] === s.coins && sv.coins === s.coins + 10, 'saved: course 1 = 3 stars, course 2 open, coins banked', sv);
      // reload: it is all still there
      await open();
      const s2 = await st();
      check(s2.screen === 'levels' && s2.save.stars[0] === 3 && s2.save.unlocked === 2 && s2.save.coins === sv.coins && (await P.eval(`document.querySelectorAll('.lvl[data-level="1"] .st svg use[fill="#ffd23f"]').length`)) === 3
        && (await P.eval(`document.getElementById('starCount').textContent`)) === '3/60', 'after a reload the stars, the open course and the coins are all still there', s2.save);
      // stars never go down: swim course 1 again badly (straight to the end, hardly a coin)
      await tapEl('.lvl[data-level="1"]');
      await P.waitFor('__dashDebug.state.screen === "play"', 3000);
      await P.eval(`__pilotOn('slow', true)`);
      await warpTo('finish', 300);
      s = await toResults('course 1 again');
      const sv2 = (await savedObj());
      check(s.stars === 1 && sv2.stars[0] === 3 && sv2.best[0] === sv.best[0] && sv2.coins === sv.coins + s.coins + 10, `a worse swim (${s.coins} coins, 1 star) shows 1 star on the card but never takes saved stars away; its coins are still banked`, sv2);
      // next and replay
      await tapEl('#resNext');
      await P.waitFor('__dashDebug.state.level === 2 && __dashDebug.state.screen === "play"', 3000, 'the next course');
      check(true, 'the "next" button starts course 2');
      await P.eval(`__pilotOn('slow', true)`);
      await warpTo('finish', 300);
      await toResults('course 2');
      await tapEl('#resReplay');
      const again = await P.waitFor('(() => { const s = __dashDebug.state; return s.level === 2 && s.screen === "play" && s.s < 400 ? { coins: s.coins, bumps: s.bumps, v: s.v } : null; })()', 3000, 'course 2 again');
      check(again.coins === 0 && again.bumps === 0, 'the "again" button starts the same course afresh', again);
    }

    }
    if (want('tilt')) {
    await P.viewport(W, H, DPR);
    await fresh();
    // ================= steering by leaning the phone =================
    console.log('\nthe tilt path: sensor events made in the page (devicemotion with accelerationIncludingGravity)');
    for (const angle of [90, 270]) {
      const way = angle === 90 ? 'angle 90 (top edge to the left)' : 'angle 270 (the other way round)';
      await P.viewport(W, H, DPR, angle);
      await open();
      await start(4);
      await P.eval('__openWater()');
      check((await P.eval('screen.orientation.angle')) === angle, `${way}: the page sees screen.orientation.angle = ${angle}`);
      s = await st();
      check(s.input === 'none' && !s.tiltLive, `${way}: before any sensor data, nothing steers`);
      // leaning right 15 degrees, the phone tipped back 30
      await P.eval(`__feed(${JSON.stringify(pose(angle, 15, 30))}, 40)`);
      let q = await st(), d = await P.eval('({ t: __dbg.tilt, s: __dbg.sensors, input: __dbg.input, steer: __dbg.steer })');
      const want = L.steerFromLean((Math.asin(Math.cos(Math.PI / 6) * Math.sin(Math.PI / 12)) * 180) / Math.PI);
      check(q.tiltLive && q.input === 'tilt' && near(q.steer, want, 0.05) && q.x > 40, `${way}: leaning the phone 15° to the right steers her right (steer ${q.steer.toFixed(2)}, expected ${want.toFixed(2)})`, { input: q.input, steer: q.steer, x: q.x });
      check(d.input === 'tilt' && d.t.live && d.t.source === 'motion' && near(d.t.lean, 12.95, 0.4) && d.s.angleUsed === angle && d.s.motionEvents >= 40 && near(d.t.x, pose(angle, 15, 30)[0], 0.1),
        `${way}: window.__dbg says tilt is steering and shows the sensor values (lean ${d.t.lean}°, up ${d.t.x}, ${d.t.y}, ${d.t.z})`, d);
      const xr = q.x;
      await P.eval(`__feed(${JSON.stringify(pose(angle, -15, 30))}, 50)`);
      q = await st();
      check(q.input === 'tilt' && near(q.steer, -want, 0.05) && q.x < xr - 40, `${way}: leaning left steers her left`, { steer: q.steer, x: q.x, was: xr });
      await P.eval(`__feed(${JSON.stringify(pose(angle, 1.5, 30))}, 30)`);
      q = await st();
      check(q.input === 'tilt' && Math.abs(q.steer) < 0.03, `${way}: held level (inside the dead zone) she swims straight`, q.steer);
      await P.eval(`__feed(${JSON.stringify(pose(angle, 30, 30))}, 45)`);
      q = await st();
      check(near(q.steer, 1, 0.02), `${way}: a big lean is full steer and no more`, q.steer);
      // a finger takes over while it is down, then tilt again
      await P.eval(`(window.__bg = __feed(${JSON.stringify(pose(angle, 15, 30))}, 90), 1)`);
      await sleep(250);
      q = await st();
      await P.fingers('touchStart', [{ id: 1, x: q.her.x - 200, y: fy }]);
      await sleep(300);
      const withFinger = await st();
      await P.fingers('touchEnd', []);
      await sleep(250);
      q = await st();
      check(withFinger.input === 'touch' && withFinger.steer === -1 && q.input === 'tilt' && q.steer > 0.4, `${way}: a finger on the water takes over from the tilt while it is down, and the tilt steers again when it lifts`, { during: withFinger.input, after: q.input });
      await P.eval('window.__bg');
      // the sensor going quiet: nothing steers
      await sleep(900);
      q = await st();
      check(q.input === 'none' && q.steer === 0 && !q.tiltLive, `${way}: when the samples stop, the tilt stops steering (straight ahead)`, { input: q.input, steer: q.steer });
    }
    await P.viewport(W, H, DPR, 90);
    await open();
    await start(4);
    await P.eval('__openWater()');
    // not real data: the same value over and over (an emulator), and events with nothing in them (a desktop browser)
    await P.eval(`__feed(${JSON.stringify(pose(90, 18, 30))}, 60, 0)`);
    q = await st();
    check(!q.tiltLive && q.input === 'none' && q.steer === 0 && Math.abs(q.x) < 1, 'sixty identical sensor samples (leaning right) do not take over: tilt needs real, changing data', { input: q.input, x: q.x });
    await P.eval('__dashDebug.resetTilt()');
    const nulls0 = await P.eval('__dbg.sensors.motionNull');
    await P.eval('for (let i = 0; i < 20; i++) __motion(null); 1');
    check((await P.eval('__dbg.sensors.motionNull')) === nulls0 + 20 && !(await st()).tiltLive && (await P.eval('__dbg.tilt.samples')) === 0, 'sensor events with no values in them are counted and ignored');
    // lying on her side with the phone (its right edge straight down): tilt lets go, and takes hold again held level
    await start(4);
    await P.eval('__openWater(); __dashDebug.resetTilt()');
    await P.eval(`__feed(${JSON.stringify(pose(90, 12, 30))}, 30)`);
    const upright = await st();
    await P.eval(`__feed(${JSON.stringify(pose(90, 85, 0))}, 130)`);
    q = await st();
    const side = await P.eval('__dbg.tilt');
    await P.eval(`__feed(${JSON.stringify(pose(90, 12, 30))}, 70)`);
    const againUp = await st();
    check(upright.input === 'tilt' && q.input === 'none' && q.steer === 0 && side.onItsSide && againUp.input === 'tilt' && againUp.steer > 0.3,
      'the phone on its side for two seconds (a child lying down) is not steering: tilt lets go, and takes hold again when held level', { upright: upright.input, onSide: q.input, again: againUp.input });
    // the hint on course 1 shows a rocking phone once the tilt is live
    await start(1);
    await P.eval('__openWater()');
    await sleep(700);
    const hint0 = (await st()).hint;
    await P.eval(`__feed(${JSON.stringify(pose(90, 0, 30))}, 40)`);
    q = await st();
    check(hint0 === 'touch' && q.hint === 'tilt', 'course 1\'s how-to-steer picture changes from a sliding finger to a rocking phone once the tilt sensor is live', { before: hint0, after: q.hint });
    await shot('tilt-01-course1-rocking-phone-hint');

    // devicemotion is the one that steers; deviceorientation (5 a second on the Seeker) only when devicemotion is silent
    await start(4);
    await P.eval('__openWater(); __dashDebug.resetTilt()');
    {
      const right = pose(90, 15, 30), left = orientation(pose(90, -15, 30));
      await P.eval(`(window.__bg = __feed(${JSON.stringify(right)}, 70), 1)`);
      await P.eval(`(async () => { for (let i = 0; i < 12; i++) { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: ${left.beta} + 0.1 * i, gamma: ${left.gamma} })); await new Promise((r) => setTimeout(r, 70)); } })()`);
      q = await st();
      const d = await P.eval('({ t: __dbg.tilt, s: __dbg.sensors })');
      check(q.input === 'tilt' && d.t.source === 'motion' && q.steer > 0.5 && d.s.orientationEvents >= 12, 'with both kinds of event arriving, devicemotion steers (right) and deviceorientation (saying left) is ignored', { source: d.t.source, steer: q.steer });
      await P.eval('window.__bg');
      await sleep(900);
      await P.eval(`(async () => { for (let i = 0; i < 14; i++) { window.dispatchEvent(new DeviceOrientationEvent('deviceorientation', { alpha: 0, beta: ${left.beta} + 0.1 * (i % 3), gamma: ${left.gamma} })); await new Promise((r) => setTimeout(r, 60)); } })()`);
      q = await st();
      const d2 = await P.eval('__dbg.tilt');
      check(q.input === 'tilt' && d2.source === 'orient' && q.steer < -0.5, 'with devicemotion silent, deviceorientation takes over (and steers left for a left lean)', { source: d2.source, steer: q.steer });
    }

    // ---- asking for the sensors: only if none have arrived a moment after the first touch, and never able to break the game ----
    await open();
    check((await P.eval('__dbg.sensors.permission')) === 'not asked / not asked' && (await P.eval('__dbg.sensors.asked')) === 0, 'the sensors are not asked for at start-up');
    await tapEl('.lvl[data-level="1"]');
    await sleep(400);
    check((await P.eval('__dbg.sensors.asked')) === 0, 'nor at the first touch itself');
    await sleep(1100);
    let perm = await P.eval('__dbg.sensors');
    check(perm.asked === 1 && /granted|not needed/.test(perm.permission), 'a second after the first touch, with no sensor data, DeviceMotionEvent.requestPermission is called once (Chrome says "granted")', perm.permission);
    await open();
    await P.eval(`__feed(${JSON.stringify(pose(90, 0, 30))}, 10)`);
    await tapEl('.lvl[data-level="1"]');
    await sleep(1500);
    perm = await P.eval('__dbg.sensors');
    check(perm.asked === 0 && perm.permission === 'not asked / not asked', 'with sensor data already arriving (as on the Seeker), it is never asked for', perm.permission);
    for (const [stub, what, want] of [
      [`() => Promise.reject(new DOMException('no', 'NotAllowedError'))`, 'a promise that rejects', /refused \(NotAllowedError\)/],
      [`() => { throw new TypeError('boom'); }`, 'a call that throws', /error \(TypeError\)/],
      [`() => Promise.resolve('denied')`, 'the answer "denied"', /denied/],
    ]) {
      const { identifier } = await P.send('Page.addScriptToEvaluateOnNewDocument', { source: `DeviceMotionEvent.requestPermission = ${stub}; DeviceOrientationEvent.requestPermission = ${stub};` });
      await open();
      await tapEl('.lvl[data-level="1"]');
      await sleep(1500);
      perm = await P.eval('__dbg.sensors');
      q = await st();
      await P.fingers('touchStart', [{ id: 1, x: q.her.x + 200, y: fy }]);
      await sleep(400);
      const q2 = await st();
      await P.fingers('touchEnd', []);
      check(perm.asked === 1 && want.test(perm.permission) && q2.screen === 'play' && q2.input === 'touch' && q2.x > q.x + 40 && page.errors.length === 0,
        `${what} from requestPermission cannot break the game: it is noted in the readout ("${perm.permission}") and a finger still steers`, { errors: page.errors });
      await P.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    }
    await open();

    }
    if (want('bridge')) {
    await P.viewport(W, H, DPR);
    await fresh();
    // ---- window.__steer and window.__tilt: what a native sensor bridge would call ----
    console.log('\nwindow.__steer and window.__tilt (a native sensor bridge), and the window.__dbg readout');
    await start(4);
    await P.eval('__openWater(); __dashDebug.resetTilt()');
    await sleep(200);
    let r1 = await P.eval(`__steer(1)`);
    for (let i = 0; i < 5; i++) { await sleep(80); await P.eval('__steer(1)'); }
    q = await st();
    check(r1 === 1 && q.input === 'bridge' && q.steer === 1 && q.x > 60 && (await P.eval('__dbg.input')) === 'bridge', 'window.__steer(1) steers her hard right (input "bridge")', { input: q.input, x: q.x });
    const xb = q.x;
    for (let i = 0; i < 6; i++) { await P.eval('__steer(-0.5)'); await sleep(80); }
    q = await st();
    check(q.steer === -0.5 && q.x < xb, 'window.__steer(-0.5) steers her left at half steer', { steer: q.steer, x: q.x });
    check((await P.eval('__steer(7)')) === 1 && (await P.eval('__steer(-7)')) === -1 && (await P.eval('__steer("nonsense")')) === 0 && (await P.eval('__steer(0.25)')) === 0.25, 'window.__steer clamps to -1..1 and treats nonsense as straight');
    await sleep(750);
    q = await st();
    check(q.input === 'none' && q.steer === 0, 'half a second after the bridge stops calling, its steer is dropped (straight ahead)', { input: q.input, steer: q.steer });
    // a finger still wins over the bridge
    await P.eval('__steer(1)');
    q = await st();
    await P.fingers('touchStart', [{ id: 1, x: q.her.x - 200, y: fy }]);
    await sleep(200);
    await P.eval('__steer(1)');
    await sleep(80);
    q = await st();
    await P.fingers('touchEnd', []);
    check(q.input === 'touch' && q.steer === -1, 'a finger on the water wins over the bridge while it is down');
    // raw accelerometer readings through window.__tilt, with the display's rotation
    await sleep(700);
    await P.eval('__dashDebug.resetTilt()');
    for (const [angle, lean] of [[90, 15], [270, 15], [90, -15]]) {
      await P.eval('__dashDebug.resetTilt()');
      const u = pose(angle, lean, 30);
      await P.eval(`(async () => { for (let i = 0; i < 30; i++) { __tilt(${u[0]} + 0.03 * Math.sin(i), ${u[1]}, ${u[2]} + 0.03 * Math.cos(i), ${angle}); await new Promise((r) => setTimeout(r, 16)); } })()`);
      q = await st();
      const d = await P.eval('__dbg.tilt');
      check(q.input === 'tilt' && d.source === 'bridge' && Math.sign(q.steer) === Math.sign(lean) && near(Math.abs(q.steer), 0.6, 0.06), `window.__tilt(ax, ay, az, ${angle}) with a ${lean}° lean steers ${lean > 0 ? 'right' : 'left'} (${q.steer.toFixed(2)})`, { input: q.input, steer: q.steer, source: d.source });
    }
    // the readout
    const dbg = await P.eval('({ input: __dbg.input, steer: __dbg.steer, boost: __dbg.boost, speed: __dbg.speed, tilt: __dbg.tilt, sensors: __dbg.sensors, text: __dbg.text() })');
    check(typeof dbg.input === 'string' && typeof dbg.steer === 'number' && dbg.boost === false && dbg.speed > 0 && ['live', 'source', 'samples', 'changes', 'x', 'y', 'z', 'lean', 'raw', 'value', 'ageMs'].every((k) => k in dbg.tilt)
      && ['motionEvents', 'motionNull', 'orientationEvents', 'angleReported', 'angleUsed', 'secureContext', 'hasMotion', 'asked', 'permission'].every((k) => k in dbg.sensors) && /input \w+/.test(dbg.text) && /lean/.test(dbg.text),
    'window.__dbg has the active input, the steer, the speed button, the last sensor values and the event counts', dbg.text.replace(/\n/g, ' | '));
    check((await P.eval(`getComputedStyle(document.getElementById('dbg')).display`)) === 'none', 'the on-screen readout is hidden in play');
    const hudC = await centre('#hud');
    await P.fingers('touchStart', [{ id: 3, x: hudC.x, y: hudC.y }]);
    await sleep(3300);
    await P.fingers('touchEnd', []);
    await sleep(400);
    check((await P.eval(`getComputedStyle(document.getElementById('dbg')).display`)) === 'block' && /input/.test(await P.eval(`document.getElementById('dbg').textContent`)), 'holding the coin counter for 3 seconds shows the readout on the screen (for checking the sensors on a phone)');
    await shot('tilt-02-readout-on-screen');
    await open('?dbg=1&level=1');
    check((await P.eval(`getComputedStyle(document.getElementById('dbg')).display`)) === 'block', '?dbg=1 shows it from the start');

    }
    if (want('real')) {
    await P.viewport(W, H, DPR);
    await fresh();
    // ---- REAL sensor events, from Chrome's own sensor pipeline ----
    console.log('\nreal sensor events from Chrome (DevTools sensor overrides): devicemotion, then deviceorientation');
    let realMotion = false;
    try {
      const types = ['accelerometer', 'linear-acceleration', 'gyroscope'];
      for (const type of types) await P.send('Emulation.setSensorOverrideEnabled', { enabled: true, type, metadata: { available: true, minimumFrequency: 1, maximumFrequency: 60 } });
      // (Chrome rounds what it hands to pages to 0.1 m/s^2, so the "noise" here is bigger than that)
      const feedReal = async (u, n) => {
        for (let i = 0; i < n; i++) {
          await P.send('Emulation.setSensorOverrideReadings', { type: 'accelerometer', reading: { xyz: { x: u[0], y: u[1], z: u[2] + (i % 2 ? 0.25 : -0.25) } } });
          await P.send('Emulation.setSensorOverrideReadings', { type: 'linear-acceleration', reading: { xyz: { x: 0, y: 0, z: i % 2 ? 0.2 : 0 } } });
          await P.send('Emulation.setSensorOverrideReadings', { type: 'gyroscope', reading: { xyz: { x: 0, y: 0, z: i % 2 ? 0.2 : 0 } } });
          await sleep(30);
        }
      };
      await feedReal(pose(90, 0, 30), 1);
      await open();
      await start(4);
      await P.eval('__openWater()');
      await feedReal(pose(90, 15, 30), 30);
      q = await st();
      let d = await P.eval('({ t: __dbg.tilt, s: __dbg.sensors })');
      realMotion = d.s.motionEvents > 20;
      check(realMotion && d.t.source === 'motion' && d.t.live && q.input === 'tilt' && q.steer > 0.45 && q.x > 40, `Chrome's own devicemotion events (${d.s.motionEvents} of them, none made by the page) steer her right for a 15° right lean`, { input: q.input, steer: q.steer, lean: d.t.lean, up: [d.t.x, d.t.y, d.t.z] });
      const xr = q.x;
      await feedReal(pose(90, -15, 30), 30);
      q = await st();
      check(q.input === 'tilt' && q.steer < -0.45 && q.x < xr - 30, 'and left for a left lean', { steer: q.steer, x: q.x });
      for (const type of types) await P.send('Emulation.setSensorOverrideEnabled', { enabled: false, type });
    } catch (e) { check(false, 'real devicemotion events through the DevTools sensor overrides', String(e.message || e)); }
    try {
      const o = orientation(pose(90, 15, 30));
      await P.send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: o.beta, gamma: o.gamma });
      await open();
      await start(4);
      await P.eval('__openWater()');
      for (let i = 0; i < 24; i++) { await P.send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: o.beta + (i % 2 ? 0.4 : -0.4), gamma: o.gamma }); await sleep(40); }
      q = await st();
      const d = await P.eval('({ t: __dbg.tilt, s: __dbg.sensors })');
      check(d.s.orientationEvents - d.s.orientationNull > 6 && d.t.source === 'orient' && q.input === 'tilt' && q.steer > 0.4 && q.x > 20, `Chrome's own deviceorientation events (beta ${o.beta.toFixed(1)}, gamma ${o.gamma.toFixed(1)}) steer her right for the same lean`, { input: q.input, steer: q.steer, lean: d.t.lean, events: d.s.orientationEvents });
      await P.send('DeviceOrientation.clearDeviceOrientationOverride');
    } catch (e) { check(false, 'real deviceorientation events through the DevTools override', String(e.message || e)); }

    }
    if (want('sound')) {
    await P.viewport(W, H, DPR);
    await fresh();
    // ================= sound: shared with the main game's save, carefully =================
    console.log('\nthe mute switch (shared with isabella.save)');
    const herSave = JSON.stringify({ unlocked: 20, stars: new Array(20).fill(3), gold: 5271, muted: false, played: true, crown: true });
    await P.eval(`localStorage.setItem('isabella.save', ${JSON.stringify(herSave)})`);
    await open();
    check((await st()).crown === true, 'Isabella wears her crown when the main game says she earned it');
    await tapEl('#soundBtn');
    await sleep(150);
    let main = JSON.parse(await P.eval(`localStorage.getItem('isabella.save')`));
    check(main.muted === true && (await st()).muted === true && JSON.stringify(Object.assign({}, main, { muted: false })) === herSave && (await P.eval(`document.querySelector('#soundBtn use').getAttribute('href')`)) === '#i-mute',
      'the sound switch mutes and writes muted:true into isabella.save, every other field untouched', main);
    await start(1);
    await sleep(300);
    check((await st()).gain === 0, 'muted for real: master gain 0 once sound has started');
    await P.eval('__dashDebug.levels()');
    await tapEl('#soundBtn');
    await sleep(150);
    check((await P.eval(`localStorage.getItem('isabella.save')`)) === herSave && (await st()).muted === false, 'switching back leaves isabella.save byte-for-byte as it was');
    await P.eval(`localStorage.setItem('isabella.save', '{not json')`);
    await open();
    await tapEl('#soundBtn');
    await sleep(150);
    check((await P.eval(`localStorage.getItem('isabella.save')`)) === '{not json' && (await st()).muted === true, 'an unreadable isabella.save is never overwritten (the switch still mutes this visit)');
    await P.eval(`localStorage.removeItem('isabella.save')`);

    }
    if (want('saves')) {
    await P.viewport(W, H, DPR);
    await fresh();
    // ================= saves =================
    console.log('\nsaves');
    for (const [bad, what] of [['{"unlocked":"x","stars":"nope","best":7,"coins":"lots"}', 'nonsense fields'], ['{"unlocked":99,"stars":[3,"3",9,-1],"coins":-5}', 'odd numbers'], ['[1,2,3]', 'an array'], ['{oops', 'not JSON']]) {
      await P.eval(`localStorage.setItem('game.dash.save', ${JSON.stringify(bad)})`);
      await open();
      const z = await st();
      const ok = z.save.unlocked >= 1 && z.save.unlocked <= 20 && z.save.stars.length === 20 && z.save.best.length === 20 && z.save.stars.every((v) => v >= 0 && v <= 3 && Number.isInteger(v)) && z.save.coins >= 0 && z.screen === 'levels';
      check(ok, `a save with ${what} still opens safely`, { unlocked: z.save.unlocked, stars: z.save.stars.slice(0, 4), coins: z.save.coins });
    }
    console.log('\nwith window.IsabellaStore (as in the Android app)');
    await P.eval(`localStorage.clear()`);
    const lsBefore = await savedRaw();
    const { identifier } = await P.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__fakeStore = { 'isabella.save': JSON.stringify({ muted: true, unlocked: 3 }), 'game.dash.save': JSON.stringify({ unlocked: 2, stars: [2], best: [40], coins: 123, boosted: true }) };
               window.IsabellaStore = { get: (k) => (k in window.__fakeStore ? window.__fakeStore[k] : null), set: (k, v) => { window.__fakeStore[k] = String(v); } };`,
    });
    await open();
    s = await st();
    check(s.muted === true && s.save.unlocked === 2 && s.save.stars[0] === 2 && s.save.coins === 123, 'progress and mute come from IsabellaStore, not localStorage', { muted: s.muted, unlocked: s.save.unlocked });
    await tapEl('.lvl[data-level="2"]');
    await P.waitFor('__dashDebug.state.screen === "play" && __dashDebug.state.level === 2', 3000);
    check(!(await P.eval(`document.getElementById('goBtn').classList.contains('hint')`)), 'the speed button does not pulse for a child who has already found it');
    await P.eval(`__pilotOn('slow', true)`);
    await warpTo('finish', 300);
    s = await toResults('IsabellaStore');
    const fake = JSON.parse(await P.eval(`window.__fakeStore['game.dash.save']`));
    check(fake.stars[0] === 2 && fake.stars[1] === s.stars && fake.unlocked === 3 && fake.coins === 123 + s.coins + 10 && (await savedRaw()) === lsBefore, 'the save is written to IsabellaStore under game.dash.save; localStorage left alone', fake);
    check(JSON.parse(await P.eval(`window.__fakeStore['isabella.save']`)).unlocked === 3, 'and the main game\'s save is not touched by playing');
    await P.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

    // grown-ups: hold the title for 4 seconds to open every course
    await P.eval(`localStorage.clear()`);
    await open();
    const tr = await rectOf('#title');
    await P.fingers('touchStart', [{ id: 1, x: tr.x + tr.w / 2, y: tr.y + tr.h / 2 }]);
    await sleep(4300);
    await P.fingers('touchEnd', []);
    await sleep(200);
    s = await st();
    check(s.save.unlocked === 20 && s.save.stars.every((v) => v === 0), 'holding the title for 4 s opens every course (stars untouched)');

    }
    if (want('last')) {
    await P.viewport(W, H, DPR);
    await fresh();
    // ---- the last course, and the frame rate ----
    await start(20);
    await P.eval(`__pilotOn('boost', true)`);
    const liftP = await boostFor(300);
    await P.eval('__dashDebug.resetPerf()');
    await sleep(4000);
    const perf = await P.eval('__dashDebug.perf()');
    await liftP();
    console.log(`        frame stats, course 20 at full boost (headless, ${Math.round(W * 2.5)}x${Math.round(H * 2.5)} canvas): ${JSON.stringify(perf, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v))}`);
    check(perf.fps > 50 && perf.drawP95Ms < 10, 'course 20 draws at over 50 fps with p95 draw time under 10 ms', { fps: +perf.fps.toFixed(1), p95: +perf.drawP95Ms.toFixed(2) });
    await warpTo('finish', 300);
    s = await toResults('course 20');
    check(!(await rectOf('#resNext')).vis && s.level === 20, 'the last course\'s results have no "next" button');
    await shot('last-01-course20-results');

    // held upright, the page asks to turn the phone
    await P.viewport(412, 915, DPR);
    await sleep(200);
    check((await P.eval(`getComputedStyle(document.getElementById('rotate')).display`)) === 'flex', 'portrait shows the turn-the-phone picture');
    await P.viewport(915, 412, DPR);

    // Android back: straight to the hub, from the middle of a course
    await open();
    await start(7);
    await sleep(500);
    const back = await P.eval('window.__back()');
    await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the back button to reach the hub');
    check(back === true, 'window.__back() returns true and goes to ../../index.html');
    await open();
    await start(12);
    await sleep(400);
    await tapEl('#homeBtn');
    await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the home button from a course');
    check(true, 'the home button leaves a course for the hub');

    }
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
  console.log(`\n${checks - fails}/${checks} checks passed${fails ? `, ${fails} FAILED` : ''}. Screenshots in ${path.relative(REPO, OUT) || OUT}`);
  process.exit(fails ? 1 : 0);
})();
