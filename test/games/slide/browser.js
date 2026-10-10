// Rainbow Slide in headless Chrome at the Seeker's landscape sizes (915x412 and 800x360 CSS px, DPR 2.625, touch).
//   node test/games/slide/browser.js [outDir] [chromeProfileDir]
//   (defaults: <repo>/.local/shots-slide and <repo>/.local/chrome-slide; DevTools port 9492)
//   SLIDE_ROOT=<a copy of the repo's web/ tree> serves that copy instead (defects.js uses this)
// At each size: a fresh save opens on the level select (bubbles, padlocks, two pages, the three modes, 19vh targets,
// nothing overlapping or off the screen); the mode picker (the last mode played stays pressed, each mode keeps its own
// courses open); a course opened by a finger on its bubble shows the coin counter and key; screenshots of an early, a middle
// and a late course in each mode, a poof, a loop-the-loop, a rainbow arch, the fall to the arch on Hard, the finish line and
// the chest; a course finished to the chest, the stars, the save.
// Then, at 915x412, real fingers through Input.dispatchTouchEvent:
//   - steering: a finger held right of her, dragged left of her, then left in one place (she slides to it);
//   - a poof (a cloud): a wobble, slower, one coin spilled on Medium and none on Easy; the rim on all three modes;
//   - the key and the chest, with and without the key; a whole Easy course 1 with one finger steering (the model child's line),
//     to the chest, the stars, the save, a reload, a worse slide never taking saved stars away;
// the tilt path: sensor events made in the page for both ways round of the phone, then REAL sensor events from Chrome's own
// sensor pipeline (devicemotion through the DevTools sensor overrides, deviceorientation through the DeviceOrientation
// override), window.__steer and window.__tilt as a native bridge would call them, and the window.__dbg readout; the saves
// (broken ones, window.IsabellaStore, the main game's mute switch read and never written), the grown-ups' unlock, portrait,
// home and Android back, and the frame rate. No console errors, exceptions or failed loads anywhere.
'use strict';
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');
const { pose, orientation } = require('./phone.js');

const REPO = path.resolve(__dirname, '../../..');
const ROOT = path.resolve(process.env.SLIDE_ROOT || REPO);
const OUT = path.resolve(process.argv[2] || path.join(REPO, '.local/shots-slide'));
const PROFILE = path.resolve(process.argv[3] || path.join(REPO, '.local/chrome-slide'));
const PORT = 9492, DPR = 2.625;
const GAME = '/web/games/slide/index.html';
const L = require(path.join(ROOT, 'web/games/slide/logic.js'));
const PILOT_SRC = fs.readFileSync(path.join(__dirname, 'pilot.js'), 'utf8');
const zeros = () => new Array(20).fill(0);
const FRESH = { v: 1, mode: 'easy', unlocked: { easy: 1, medium: 1, hard: 1 }, stars: { easy: zeros(), medium: zeros(), hard: zeros() }, best: { easy: zeros(), medium: zeros(), hard: zeros() }, coins: 0, taught: false };

// Put into every page: the model child (pilot.js) to steer while screenshots are taken or a finger follows it, and
// ways to make sensor events.
const HELPERS = `
window.__pilotOn = (mode, bridge) => {
  const PP = SlidePilot.makePilot(SlideLogic), run = __slideDebug.run, p = new PP.Pilot(run, mode || 'child', 1);
  window.__pilot = p; clearInterval(window.__pilotT);
  let last = performance.now();
  window.__pilotT = setInterval(() => {
    if (__slideDebug.run !== run || run.phase !== 'play') { clearInterval(window.__pilotT); return; }
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    p.step(dt);
    if (bridge) __steer(p.steer);
  }, 16);
  return true;
};
window.__pilotOff = () => { clearInterval(window.__pilotT); return true; };
window.__openSky = () => { __slideDebug.run.lev.buckets = []; return true; };
window.__motion = (x, y, z) => window.dispatchEvent(new DeviceMotionEvent('devicemotion', { accelerationIncludingGravity: x == null ? null : { x, y, z }, interval: 16 }));
window.__feed = (v, n, noise) => new Promise((res) => {
  let i = 0; const q = noise == null ? 0.03 : noise;
  const t = setInterval(() => { __motion(v[0] + q * Math.sin(i * 1.7), v[1] + q * Math.cos(i * 2.3), v[2] + q * Math.sin(i * 0.9)); if (++i >= n) { clearInterval(t); res(i); } }, 16);
});
true`;

// SLIDE_SECTIONS=fingers,tilt runs only those parts (defects.js uses this); SLIDE_SIZES=915x412 only that size
const ONLY = (process.env.SLIDE_SECTIONS || '').split(',').filter(Boolean);
const want = (name) => !ONLY.length || ONLY.includes(name);
const SIZES = (process.env.SLIDE_SIZES || '915x412,800x360').split(',').map((z) => z.split('x').map(Number));
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
    const st = () => P.eval('__slideDebug.state');
    const shot = async (name) => { const f = await P.shot(path.join(OUT, name + '.png')); console.log(`        shot ${path.relative(REPO, f)}`); };
    const rectOf = (sel) => P.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, vis: getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).display !== 'none' }; })()`);
    const centre = async (sel) => { const r = await rectOf(sel); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
    const tapEl = async (sel) => { const c = await centre(sel); await P.tap(c.x, c.y); };
    const savedRaw = () => P.eval(`localStorage.getItem('game.slide.save')`);
    const savedObj = async () => JSON.parse((await savedRaw()) || JSON.stringify(FRESH));   // (nothing saved: checks fail, they do not crash)
    const open = async (query) => { await P.goto(base + GAME + (query || '')); await P.eval(PILOT_SRC + ';' + HELPERS); await sleep(350); };
    const fresh = async () => { await P.goto(base + GAME); await P.eval('localStorage.clear()'); await open(); };
    const start = async (n, mode) => { await P.eval(`__slideDebug.start(${n}, ${mode ? JSON.stringify(mode) : 'null'})`); await sleep(250); };
    const overlaps = (ids) => P.eval(`(() => { const ids = ${JSON.stringify(ids)}, r = ids.map((i) => document.querySelector(i).getBoundingClientRect()), out = [];
      for (let i = 0; i < r.length; i++) { const a = r[i];
        if (a.left < -0.5 || a.top < -0.5 || a.right > innerWidth + 0.5 || a.bottom > innerHeight + 0.5) out.push(ids[i] + ' off screen');
        for (let j = i + 1; j < r.length; j++) { const b = r[j]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(ids[i] + '/' + ids[j]); } }
      return out; })()`);
    // jump to just before the first thing of a kind on this course, on the clear lane
    const warpTo = (what, back) => P.eval(`(() => { const lv = __slideDebug.run.lev, w = ${JSON.stringify(what)};
      const o = typeof w === 'number' ? { s: w } : w === 'finish' ? { s: lv.len } : w === 'key' ? lv.key : w === 'loop' ? { s: lv.loops[0].a } : w === 'arch' ? { s: lv.arches[0] }
        : w === 'cloud' ? lv.obs.find((q) => !q.amp && !q.extra && q.s > 1500 && lv.obs.filter((z) => z !== q && Math.abs(z.s - q.s) < 700).length === 0) : lv.obs.find((q) => q.k === w);
      if (!o) return null; const s = o.s - ${back || 0};
      // (a cloud: dead ahead of her; anything else: on the clear lane)
      __slideDebug.warp(s, w === 'cloud' ? o.x : SlideLogic.laneAt(lv, s)); return { s: o.s, x: o.x == null ? 0 : o.x, hx: o.hx || 0 }; })()`);
    // swim on to the chest and the results card (the model child steering, through window.__steer)
    const toResults = async (label) => {
      await P.waitFor('__slideDebug.state.phase === "done"', 30000, `${label}: the chest`);
      await P.waitFor('__slideDebug.state.screen === "results"', 9000, `${label}: the results card`);
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
      for (const sel of ['.lvl', '#homeBtn', '#mode-easy', '#mode-medium', '#mode-hard', '#pgNext']) { const r = await rectOf(sel); sizes[sel] = +(Math.min(r.w, r.h) / vh).toFixed(1); }
      check(Object.values(sizes).every((v) => v >= 19), `${tag}: level bubbles, home, the three mode buttons and the page arrow are at least 19vh`, sizes);
      check((await P.eval(`document.querySelectorAll('.lvl').length`)) === 10 && (await P.eval(`document.querySelectorAll('.lvl.locked').length`)) === 9, `${tag}: page 1 shows 10 bubbles, 9 with padlocks`);
      let ov = await overlaps(['#title', '#mode-easy', '#mode-medium', '#mode-hard', '#grid', '#homeBtn', '#pgNext', '#pgDots', '#starPill', '#coinPill']);
      check(ov.length === 0, `${tag}: title, the modes, grid, star count, coin count, home, page arrow and dots do not overlap or leave the screen`, ov);
      const mx = [];
      for (const m of ['easy', 'medium', 'hard']) mx.push((await rectOf('#mode-' + m)).x);
      check(mx[0] < mx[1] && mx[1] < mx[2] && (await P.eval(`document.getElementById('mode-easy').classList.contains('on')`)) && (await P.eval(`document.querySelectorAll('.mode.on').length`)) === 1, `${tag}: the modes are one, two, three sparkles left to right, and Easy is the one pressed on a fresh save`, mx);
      await sleep(900);
      await shot(`${tag}-01-levels-easy`);
      // the mode picker: tapping a mode shows it pressed, remembers it, and each mode has its own courses open
      await tapEl('#mode-medium');
      await sleep(200);
      s = await st();
      check(s.mode === 'medium' && s.screen === 'levels' && s.save.mode === 'medium' && (await P.eval(`document.getElementById('mode-medium').classList.contains('on') && document.querySelectorAll('.mode.on').length === 1`)) && (await savedObj()).mode === 'medium', `${tag}: tapping Medium presses it and saves it as the last mode`, { mode: s.mode });
      await tapEl('#mode-hard');
      await sleep(200);
      check((await st()).mode === 'hard' && (await P.eval(`document.querySelectorAll('.lvl.locked').length`)) === 9, `${tag}: Hard shows its own ten bubbles, 9 padlocked`);
      await shot(`${tag}-02-levels-hard`);
      await tapEl('#mode-easy');
      await sleep(200);
      await tapEl('.lvl[data-level="2"]');
      await sleep(150);
      check((await st()).screen === 'levels' && (await P.eval(`document.querySelector('.lvl[data-level="2"]').classList.contains('shake')`)), `${tag}: a padlocked course only wiggles`);
      await tapEl('#pgNext');
      await sleep(250);
      check((await st()).page === 1 && (await P.eval(`document.querySelectorAll('.lvl').length`)) === 10 && (await P.eval(`document.querySelector('.lvl').dataset.level`)) === '11', `${tag}: the page arrow shows World 2: courses 11 to 20`);
      await shot(`${tag}-03-levels-world2`);
      await tapEl('#pgPrev');
      await sleep(250);
      check((await st()).page === 0, `${tag}: and the back arrow returns to World 1`);

      // ---- course 1, opened with a finger on its bubble ----
      await tapEl('.lvl[data-level="1"]');
      await P.waitFor('__slideDebug.state.screen === "play"', 3000, 'course 1 to start');
      await sleep(500);
      s = await st();
      check(s.level === 1 && s.mode === 'easy' && s.phase === 'play' && s.s > 0 && s.v > 0, `${tag}: a finger on bubble 1 starts course 1 in Easy, and she is already sliding`, { v: s.v, s: s.s });
      const hud = await rectOf('#hud'), home = await rectOf('#homeBtn');
      check(hud.vis && home.vis && (await overlaps(['#hud', '#homeBtn'])).length === 0, `${tag}: coin counter and home button do not overlap or leave the screen`);
      check(s.her.x > W * 0.4 && s.her.x < W * 0.6 && s.her.y > H * 0.55 && s.her.y < H * 0.85, `${tag}: Isabella starts in the middle, in the lower part of the screen`, s.her);
      await sleep(900);
      check((await st()).hint === 'touch', `${tag}: course 1 shows how to steer (a finger sliding, as no tilt sensor is live)`);
      await shot(`${tag}-04-course1-start-hint`);
      // as far right as she can go she is still well on the screen
      await P.eval(`(__slideDebug.run.x = __slideDebug.run.lev.hw - 14)`);
      await sleep(120);
      s = await st();
      check(s.her.x < W * 0.88, `${tag}: at the right-hand rail she is still well on the screen`, { her: s.her.x });

      // ---- screenshots: an early, a middle and a late course in each mode ----
      let n = 5;
      for (const [course, mode, when] of [[3, 'easy', 'early'], [6, 'medium', 'middle-loop'], [12, 'hard', 'world2-hard'], [14, 'medium', 'world2'], [20, 'hard', 'last']]) {
        await start(course, mode);
        const at = await P.eval(`(() => { const lv = __slideDebug.run.lev, o = lv.obs.find((q) => q.s > lv.len * 0.33) || lv.obs[0]; return o.s - 800; })()`);
        await warpTo(at);
        await P.eval(`__pilotOn('child', true)`);
        await sleep(1300);
        s = await st();
        check(s.phase === 'play' && s.mode === mode && s.v > s.vc * 0.9 && s.v <= s.vc + 1 && s.poofs === 0, `${tag}: course ${course} (${when}) in ${mode}, sliding at ${Math.round(s.vc)} units a second`, { v: s.v, vc: s.vc, poofs: s.poofs });
        await shot(`${tag}-${String(n++).padStart(2, '0')}-course${course}-${mode}`);
        await P.eval('__pilotOff()');
      }

      // ---- a loop-the-loop ----
      await start(6, 'medium');
      const lp = await P.eval(`(() => { const lp = __slideDebug.run.lev.loops[0]; __slideDebug.warp(lp.a - 120, SlideLogic.laneAt(__slideDebug.run.lev, lp.a - 120)); return lp; })()`);
      await P.eval(`__pilotOn('child', true)`);
      await P.waitFor('__slideDebug.state.loop === 0', 4000, 'the loop');
      await sleep(900);
      s = await st();
      check(s.loop === 0 && s.loops === 1 && s.particles > 5, `${tag}: into the loop-the-loop: a shower of sparkles (${s.particles} of them)`, { loop: s.loop, particles: s.particles });
      await shot(`${tag}-10-loop-a`);
      await sleep(900);
      await shot(`${tag}-11-loop-b`);
      await P.waitFor(`__slideDebug.state.s > ${lp.b + 80}`, 6000, 'out of the loop');
      s = await st();
      check(s.loop === -1 && s.poofs === 0 && s.bonus >= 6, `${tag}: and out again, with the loop's coins (${s.bonus} of 8) and no poof`, { bonus: s.bonus, poofs: s.poofs });
      await P.eval('__pilotOff()');

      // ---- a rainbow arch, and the fall to it on Hard ----
      await start(10, 'hard');
      const arch = await warpTo('arch', 150);
      await P.eval(`__pilotOn('child', true)`);
      await P.waitFor('__slideDebug.state.cpN === 1', 4000, 'the arch');
      await sleep(500);
      await shot(`${tag}-12-arch`);
      await P.eval('__pilotOff()');
      await P.eval(`(() => { __steer(0); const r = __slideDebug.run; r.x = r.lev.hw + 40; })()`);
      await P.waitFor('__slideDebug.state.phase === "rescue"', 3000, 'the slip');
      await sleep(500);
      await shot(`${tag}-13-slip-on-a-cloud`);
      await P.waitFor('__slideDebug.state.phase === "play" && __slideDebug.state.restores === 1', 5000, 'the little cloud to bring her back');
      s = await st();
      check(s.slips === 1 && near(s.s, arch.s, 40) && s.mode === 'hard', `${tag}: Hard: off the rim she floats down on a little cloud and is back at the arch (s ${Math.round(s.s)}, arch ${arch.s})`, { s: s.s, arch: arch.s });
    }

    // ---- a poof, the rim, the key and the chest ----
    {
      const tag = '915x412', vh = 412 / 100;
      await P.viewport(915, 412, DPR);
      await fresh();
      console.log(`\n${tag}: a poof, the rim, the key, the finish`);
      await start(1, 'medium');
      await P.waitFor('__slideDebug.state.coins >= 5', 14000, 'the first five coins');
      const cloud = await warpTo('cloud', 260);
      await P.eval('__pilotOff()');
      const before = await st();
      await P.waitFor('__slideDebug.state.poofs === 1', 4000, 'the poof');
      s = await st();
      check(s.poofs === 1 && s.v <= s.vc * L.POOF_V + 25 && s.v > 0 && s.inv > 0, `${tag}: sliding into a cloud is a soft poof: down to ${Math.round(s.v)} (half of ${Math.round(s.vc)}) but she does not stop`, { v: s.v, cloud });
      check(s.coins === before.coins - 1 && s.spilled === 1 && (await P.eval(`document.getElementById('coinCount').textContent`)) === String(s.coins), `${tag}: Medium: one coin spilled (${before.coins} -> ${s.coins}), and the counter shows it`);
      await sleep(130);
      await shot(`${tag}-14-poof`);
      await sleep(2500);
      const after = await st();
      check(after.phase === 'play' && after.s > cloud.s + 100 && after.poofs === 1 && after.v > s.v + 20, `${tag}: she slides on past the cloud, picking up speed again; no second poof, nothing lost but the coin`, { s: after.s, v: after.v, poofs: after.poofs });
      // Easy: no coin is spilled
      await start(1, 'easy');
      await P.waitFor('__slideDebug.state.coins >= 5', 20000, 'the first five coins on Easy');
      await warpTo('cloud', 260);
      await P.eval('__pilotOff()');
      const eb = await st();
      await P.waitFor('__slideDebug.state.poofs === 1', 5000, 'the poof on Easy');
      s = await st();
      check(s.poofs === 1 && s.spilled === 0 && s.coins === eb.coins, `${tag}: Easy: the same poof spills no coin`, { coins: s.coins, was: eb.coins });
      // the rim: rails on Easy, a bump back on Medium, a slip on Hard (steering with a real finger)
      for (const mode of ['easy', 'medium', 'hard']) {
        await start(2, mode);
        await P.eval('__openSky()');
        await sleep(200);
        q = await st();
        await P.fingers('touchStart', [{ id: 1, x: q.her.x + 330, y: fy }]);
        if (mode === 'hard') await P.waitFor('__slideDebug.state.phase === "rescue"', 5000, 'the slip on Hard');
        else await sleep(2600);
        const r = await st();
        await P.fingers('touchEnd', []);
        const rim = r.hw - L.EDGE;
        if (mode === 'easy') check(r.phase === 'play' && r.slips === 0 && r.rims === 0 && r.rails >= 1 && r.x <= rim + 1e-6 && r.x > rim - 3, `${tag}: Easy: a finger held right holds her at the invisible rail (x ${Math.round(r.x)} of ${rim})`, { x: r.x, rails: r.rails });
        if (mode === 'medium') check(r.phase === 'play' && r.slips === 0 && r.rims >= 1 && r.x <= rim + 1e-6, `${tag}: Medium: she is bumped back from the rim (${r.rims} times) and never falls`, { x: r.x, rims: r.rims });
        if (mode === 'hard') check(r.phase === 'rescue' && r.slips === 1, `${tag}: Hard: held at the rim she slips off, onto a little cloud`, { phase: r.phase });
      }

      // ---- the key and the chest, with the key ----
      await start(1, 'easy');
      await P.eval(`__pilotOn('child', true)`);
      await warpTo('key', 700);
      await P.waitFor('__slideDebug.state.hasKey === true', 8000, 'the key');
      check((await P.eval(`document.getElementById('keyIcon').classList.contains('on')`)), `${tag}: the key she catches lights up beside the coin counter`);
      await shot(`${tag}-15-key`);
      await warpTo('finish', 1400);
      await sleep(900);
      await shot(`${tag}-16-finish-line`);
      await P.waitFor('__slideDebug.state.phase !== "play"', 9000, 'the finish line');
      s = await st();
      check(s.phase === 'finish' && s.stars >= 1, `${tag}: over the finish line the stars are settled`, { stars: s.stars });
      let sv = await savedObj();
      check(sv.v === 1 && sv.mode === 'easy' && sv.stars.easy[0] === s.stars && sv.unlocked.easy === 2 && sv.unlocked.medium === 1 && sv.unlocked.hard === 1 && sv.best.easy[0] === s.coins && sv.coins >= s.coins, `${tag}: saved at the line under game.slide.save: Easy course 1's stars, Easy course 2 open (Medium and Hard still on 1)`, sv);
      await P.waitFor('__slideDebug.state.phase === "done"', 20000, 'the chest');
      s = await st();
      check(near(s.x, 0, 14) && s.v === 0, `${tag}: she glides to the middle and stops at the treasure chest`, { x: s.x });
      await P.waitFor('__slideDebug.state.opened === true', 3000, 'the chest to open');
      await P.waitFor('__slideDebug.state.party > 0.4', 5000, 'the party');
      s = await st();
      check(s.hasKey && s.chestOpen > 0.9 && s.particles > 20, `${tag}: with the key the chest bursts open at once, with coins (${s.particles} of them in the air)`);
      await shot(`${tag}-17-chest`);
      s = await toResults(tag);
      const res = {};
      for (const sel of ['#resLevels', '#resReplay', '#resNext']) { const r = await rectOf(sel); res[sel] = +(Math.min(r.w, r.h) / vh).toFixed(1); }
      check(Object.values(res).every((v) => v >= 19), `${tag}: results buttons are at least 19vh`, res);
      const lit = await P.eval(`[...document.querySelectorAll('#bigStars svg use')].filter((u) => u.getAttribute('fill') === '#ffd23f').length`);
      check(lit === s.stars && (await P.eval(`document.getElementById('resCoins').textContent`)) === String(s.coins), `${tag}: the card shows her ${s.stars} star(s) and her ${s.coins} coins`, { lit });
      check((await overlaps(['.card', '#homeBtn'])).length === 0, `${tag}: the results card is on the screen and clear of the home button`);
      await shot(`${tag}-18-results`);
      sv = await savedObj();
      await tapEl('#resLevels');
      await sleep(300);
      check((await st()).screen === 'levels' && !(await P.eval(`document.querySelector('.lvl[data-level="2"]').classList.contains('locked')`)) && (await P.eval(`document.querySelector('.lvl[data-level="3"]').classList.contains('locked')`))
        && (await P.eval(`document.getElementById('starCount').textContent`)) === `${s.stars}/60` && (await P.eval(`document.getElementById('coinTotal').textContent`)) === String(sv.coins),
      `${tag}: back on the level select: course 2 open, course 3 padlocked, ${s.stars}/60 stars, ${sv.coins} coins (the chest's 10 included)`);
      await tapEl('#mode-medium');
      await sleep(200);
      check((await P.eval(`document.querySelector('.lvl[data-level="2"]').classList.contains('locked')`)) && (await P.eval(`document.getElementById('starCount').textContent`)) === '0/60', `${tag}: Medium has its own courses: still only course 1 open, 0/60 stars`);
      await tapEl('#mode-easy');
      await sleep(200);

      // ---- the chest without the key ----
      await start(1, 'easy');
      await P.eval(`__pilotOn('child', true)`);
      await P.waitFor('__slideDebug.state.coins >= 3', 20000, 'a few coins');
      await warpTo('finish', 300);
      await P.waitFor('__slideDebug.state.phase === "done"', 20000, 'the chest');
      s = await st();
      check(!s.hasKey && !s.opened, `${tag}: skipping the key: she reaches the chest without it, and it stays shut for a moment`);
      await sleep(600);
      check((await st()).keyFly > 0.1 && (await st()).keyFly < 1, `${tag}: the key floats down to her`);
      await shot(`${tag}-19-key-floats-down`);
      await P.waitFor('__slideDebug.state.opened === true', 4000, 'the chest to open anyway');
      s = await st();
      check(s.hasKey && s.opened, `${tag}: and the chest opens anyway (nothing can be failed)`);
      s = await toResults('no key');
      check(s.stars >= 1 && s.results, `${tag}: with the results card and at least a star`);

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
    await P.waitFor('__slideDebug.state.screen === "play"', 3000);
    await P.eval('__openSky()');   // (the steering checks need open sky: nothing to poof while they run)
    await sleep(500);
    s = await st();
    // a finger held to her right
    await P.fingers('touchStart', [{ id: 1, x: s.her.x + 220, y: fy }]);
    await sleep(450);
    let a = await st();
    check(a.input === 'touch' && a.touching && a.steer === 1 && a.x > 40 && a.vx > 0.8 * L.VU_MAX, 'a finger held to her right steers her right, at full steer', { input: a.input, steer: a.steer, x: a.x });
    // dragged to her left
    await P.fingers('touchMove', [{ id: 1, x: a.her.x - 220, y: fy }]);
    await sleep(600);
    let b = await st();
    check(b.input === 'touch' && b.steer === -1 && b.x < a.x - 40 && b.vx < 0, 'dragged to her left, she turns and slides left', { steer: b.steer, x: b.x, was: a.x });
    // left in one place: she slides to the finger and settles under it
    await P.fingers('touchMove', [{ id: 1, x: 330, y: fy }]);
    await sleep(2600);
    let c = await st();
    check(Math.abs(c.her.x - 330) < 12 && Math.abs(c.steer) < 0.25 && Math.abs(c.vx) < 60, 'with the finger left in one place she slides to it and settles under it', { her: c.her.x, steer: c.steer });
    await P.fingers('touchMove', [{ id: 1, x: 560, y: fy }]);
    await sleep(2600);
    c = await st();
    check(Math.abs(c.her.x - 560) < 12 && c.x > 0, 'and follows it across to the other side', { her: c.her.x, x: c.x });
    await P.fingers('touchEnd', []);
    await sleep(120);
    c = await st();
    check(c.input === 'none' && !c.touching && c.steer === 0, 'lifting the finger: straight ahead again (no tilt sensor here, so nothing steers)', { input: c.input, steer: c.steer });
    await sleep(500);
    check(Math.abs((await st()).vx) < 15, 'and she stops drifting sideways');
    // a touch the system cancels lets go too, and so does the window losing focus
    s = await st();
    await P.fingers('touchStart', [{ id: 1, x: s.her.x + 200, y: fy }]);
    await sleep(250);
    const heldBefore = (await st()).touching;
    await P.fingers('touchCancel', []);
    await sleep(80);
    check(heldBefore && !(await st()).touching, 'a cancelled touch lets go');
    await P.fingers('touchStart', [{ id: 1, x: s.her.x + 200, y: fy }]);
    await sleep(200);
    const heldBefore2 = (await st()).touching;
    await P.eval(`window.dispatchEvent(new Event('blur'))`);
    await sleep(60);
    check(heldBefore2 && !(await st()).touching, 'the window losing focus lets go');
    await P.fingers('touchEnd', []);
    }
    if (want('course')) {
    await P.viewport(W, H, DPR);
    await fresh();
    // ================= a whole Easy course by finger =================
    console.log('\nEasy course 1 from start to chest with a real finger (steering along the model child\'s line)');
    await tapEl('.lvl[data-level="1"]');
    await P.waitFor('__slideDebug.state.screen === "play"', 3000);
    await P.eval(`__pilotOn('child', false)`);
    {
      const full = Math.max(40, W * 0.09);
      q = await st();
      await P.fingers('touchStart', [{ id: 1, x: q.her.x, y: fy }]);
      const t0w = Date.now();
      let moves = 0, inputs = new Set();
      for (;;) {
        q = await P.eval(`(() => { const s = __slideDebug.state; return { phase: s.phase, her: s.her.x, steer: window.__pilot.steer, input: s.input }; })()`);
        if (q.phase !== 'play') break;
        inputs.add(q.input);
        const x = Math.max(4, Math.min(W * 0.8, q.her + q.steer * full));
        await P.fingers('touchMove', [{ id: 1, x, y: fy }]);
        moves++;
        if (Date.now() - t0w > 150000) throw new Error('course 1 by finger: no finish after 2.5 minutes');
        await sleep(25);
      }
      const secs = (Date.now() - t0w) / 1000;
      await P.fingers('touchEnd', []);
      s = await st();
      const lev1 = L.build(1, 'easy');
      check(s.phase !== 'play' && s.stars === 3 && s.coins >= 0.8 * s.laneTotal && s.hasKey, `Easy course 1 slid with a real finger (${moves} finger moves, ${secs.toFixed(1)}s): over the line with ${s.coins}/${s.laneTotal} coins, the key, 3 stars`, { poofs: s.poofs, stars: s.stars });
      check(s.poofs <= 1 && s.rails === 0, `the finger followed the model child's line cleanly (${s.poofs} poof${s.poofs === 1 ? '' : 's'}, ${s.rails} rail touches)`);
      check(inputs.has('touch') && [...inputs].every((i) => i === 'touch' || i === 'none'), 'the finger did all the steering (nothing else steered)', [...inputs]);
      check(near(secs, lev1.len / lev1.speed, 8), `Easy course 1 took ${secs.toFixed(1)}s to the line (verify.js says ${(lev1.len / lev1.speed).toFixed(1)}s)`);
      s = await toResults('Easy course 1 by finger');
      check(s.results && s.stars === 3 && (await P.eval(`document.querySelectorAll('#bigStars svg use[fill="#ffd23f"]').length`)) === 3, 'the chest opens and the card shows 3 stars');
      const sv = await savedObj();
      check(sv.stars.easy[0] === 3 && sv.unlocked.easy === 2 && sv.best.easy[0] === s.coins && sv.coins === s.coins + 10, 'saved: Easy course 1 = 3 stars, Easy course 2 open, coins banked (the chest\'s 10 included)', sv);
      // reload: it is all still there
      await open();
      const s2 = await st();
      check(s2.screen === 'levels' && s2.mode === 'easy' && s2.save.stars.easy[0] === 3 && s2.save.unlocked.easy === 2 && s2.save.coins === sv.coins && (await P.eval(`document.querySelectorAll('.lvl[data-level="1"] .st svg use[fill="#ffd23f"]').length`)) === 3
        && (await P.eval(`document.getElementById('starCount').textContent`)) === '3/60', 'after a reload the stars, the open course and the coins are all still there', s2.save);
      // stars never go down: slide course 1 again badly (straight to the end, hardly a coin)
      await tapEl('.lvl[data-level="1"]');
      await P.waitFor('__slideDebug.state.screen === "play"', 3000);
      await warpTo('finish', 300);
      s = await toResults('course 1 again');
      const sv2 = await savedObj();
      check(s.stars === 1 && sv2.stars.easy[0] === 3 && sv2.best.easy[0] === sv.best.easy[0] && sv2.coins >= sv.coins + 10, `a worse slide (${s.coins} coins, 1 star) shows 1 star on the card but never takes saved stars away; its coins are still banked`, sv2);
      // next and replay
      await tapEl('#resNext');
      await P.waitFor('__slideDebug.state.level === 2 && __slideDebug.state.screen === "play"', 3000, 'the next course');
      check(true, 'the "next" button starts course 2 (in Easy)');
      await warpTo('finish', 300);
      await toResults('course 2');
      await tapEl('#resReplay');
      const again = await P.waitFor('(() => { const s = __slideDebug.state; return s.level === 2 && s.screen === "play" && s.s < 400 ? { coins: s.coins, poofs: s.poofs } : null; })()', 3000, 'course 2 again');
      check(again.coins === 0 && again.poofs === 0, 'the "again" button starts the same course afresh', again);
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
      await start(4, 'easy');
      await P.eval('__openSky()');
      check((await P.eval('screen.orientation.angle')) === angle, `${way}: the page sees screen.orientation.angle = ${angle}`);
      s = await st();
      check(s.input === 'none' && !s.tiltLive, `${way}: before any sensor data, nothing steers`);
      // leaning right 15 degrees, the phone tipped back 30
      await P.eval(`__feed(${JSON.stringify(pose(angle, 15, 30))}, 40)`);
      let q = await st(), d = await P.eval('({ t: __dbg.tilt, s: __dbg.sensors, input: __dbg.input, steer: __dbg.steer })');
      const want = L.steerFromLean((Math.asin(Math.cos(Math.PI / 6) * Math.sin(Math.PI / 12)) * 180) / Math.PI);
      check(q.tiltLive && q.input === 'tilt' && near(q.steer, want, 0.05) && q.x > 30, `${way}: leaning the phone 15° to the right steers her right (steer ${q.steer.toFixed(2)}, expected ${want.toFixed(2)})`, { input: q.input, steer: q.steer, x: q.x });
      check(d.input === 'tilt' && d.t.live && d.t.source === 'motion' && near(d.t.lean, 12.95, 0.4) && d.s.angleUsed === angle && d.s.motionEvents >= 40 && near(d.t.x, pose(angle, 15, 30)[0], 0.1),
        `${way}: window.__dbg says tilt is steering and shows the sensor values (lean ${d.t.lean}°, up ${d.t.x}, ${d.t.y}, ${d.t.z})`, d);
      const xr = q.x;
      await P.eval(`__feed(${JSON.stringify(pose(angle, -15, 30))}, 50)`);
      q = await st();
      check(q.input === 'tilt' && near(q.steer, -want, 0.05) && q.x < xr - 40, `${way}: leaning left steers her left`, { steer: q.steer, x: q.x, was: xr });
      await P.eval(`__feed(${JSON.stringify(pose(angle, 1.5, 30))}, 30)`);
      q = await st();
      check(q.input === 'tilt' && Math.abs(q.steer) < 0.03, `${way}: held level (inside the dead zone) she slides straight`, q.steer);
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
      check(withFinger.input === 'touch' && withFinger.steer === -1 && q.input === 'tilt' && q.steer > 0.4, `${way}: a finger on the screen takes over from the tilt while it is down, and the tilt steers again when it lifts`, { during: withFinger.input, after: q.input });
      await P.eval('window.__bg');
      // the sensor going quiet: nothing steers
      await sleep(900);
      q = await st();
      check(q.input === 'none' && q.steer === 0 && !q.tiltLive, `${way}: when the samples stop, the tilt stops steering (straight ahead)`, { input: q.input, steer: q.steer });
    }
    await P.viewport(W, H, DPR, 90);
    await open();
    await start(4, 'easy');
    await P.eval('__openSky()');
    // not real data: the same value over and over (an emulator), and events with nothing in them (a desktop browser)
    await P.eval(`__feed(${JSON.stringify(pose(90, 18, 30))}, 60, 0)`);
    q = await st();
    check(!q.tiltLive && q.input === 'none' && q.steer === 0 && Math.abs(q.x) < 1, 'sixty identical sensor samples (leaning right) do not take over: tilt needs real, changing data', { input: q.input, x: q.x });
    await P.eval('__slideDebug.resetTilt()');
    const nulls0 = await P.eval('__dbg.sensors.motionNull');
    await P.eval('for (let i = 0; i < 20; i++) __motion(null); 1');
    check((await P.eval('__dbg.sensors.motionNull')) === nulls0 + 20 && !(await st()).tiltLive && (await P.eval('__dbg.tilt.samples')) === 0, 'sensor events with no values in them are counted and ignored');
    // lying on her side with the phone (its right edge straight down): tilt lets go, and takes hold again held level
    await start(4, 'easy');
    await P.eval('__openSky(); __slideDebug.resetTilt()');
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
    await start(1, 'easy');
    await P.eval('__openSky()');
    await sleep(700);
    const hint0 = (await st()).hint;
    await P.eval(`__feed(${JSON.stringify(pose(90, 0, 30))}, 40)`);
    q = await st();
    check(hint0 === 'touch' && q.hint === 'tilt', 'course 1\'s how-to-steer picture changes from a sliding finger to a rocking phone once the tilt sensor is live', { before: hint0, after: q.hint });
    await shot('tilt-01-course1-rocking-phone-hint');

    // devicemotion is the one that steers; deviceorientation only when devicemotion is silent
    await start(4, 'easy');
    await P.eval('__openSky(); __slideDebug.resetTilt()');
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
    for (const [stub, what, wantRe] of [
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
      check(perm.asked === 1 && wantRe.test(perm.permission) && q2.screen === 'play' && q2.input === 'touch' && q2.x > q.x + 20 && page.errors.length === 0,
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
    await start(4, 'easy');
    await P.eval('__openSky(); __slideDebug.resetTilt()');
    await sleep(200);
    let r1 = await P.eval(`__steer(1)`);
    for (let i = 0; i < 5; i++) { await sleep(80); await P.eval('__steer(1)'); }
    q = await st();
    check(r1 === 1 && q.input === 'bridge' && q.steer === 1 && q.x > 40 && (await P.eval('__dbg.input')) === 'bridge', 'window.__steer(1) steers her hard right (input "bridge")', { input: q.input, x: q.x });
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
    check(q.input === 'touch' && q.steer === -1, 'a finger on the screen wins over the bridge while it is down');
    // raw accelerometer readings through window.__tilt, with the display's rotation
    await sleep(700);
    await P.eval('__slideDebug.resetTilt()');
    for (const [angle, lean] of [[90, 15], [270, 15], [90, -15]]) {
      await P.eval('__slideDebug.resetTilt()');
      const u = pose(angle, lean, 30);
      await P.eval(`(async () => { for (let i = 0; i < 30; i++) { __tilt(${u[0]} + 0.03 * Math.sin(i), ${u[1]}, ${u[2]} + 0.03 * Math.cos(i), ${angle}); await new Promise((r) => setTimeout(r, 16)); } })()`);
      q = await st();
      const d = await P.eval('__dbg.tilt');
      check(q.input === 'tilt' && d.source === 'bridge' && Math.sign(q.steer) === Math.sign(lean) && near(Math.abs(q.steer), 0.6, 0.06), `window.__tilt(ax, ay, az, ${angle}) with a ${lean}° lean steers ${lean > 0 ? 'right' : 'left'} (${q.steer.toFixed(2)})`, { input: q.input, steer: q.steer, source: d.source });
    }
    // the readout
    const dbg = await P.eval('({ input: __dbg.input, steer: __dbg.steer, speed: __dbg.speed, tilt: __dbg.tilt, sensors: __dbg.sensors, text: __dbg.text() })');
    check(typeof dbg.input === 'string' && typeof dbg.steer === 'number' && dbg.speed > 0 && ['live', 'source', 'samples', 'changes', 'x', 'y', 'z', 'lean', 'raw', 'value', 'ageMs'].every((k) => k in dbg.tilt)
      && ['motionEvents', 'motionNull', 'orientationEvents', 'angleReported', 'angleUsed', 'secureContext', 'hasMotion', 'asked', 'permission'].every((k) => k in dbg.sensors) && /input \w+/.test(dbg.text) && /lean/.test(dbg.text),
    'window.__dbg has the active input, the steer, the speed, the last sensor values and the event counts', dbg.text.replace(/\n/g, ' | '));
    check((await P.eval(`getComputedStyle(document.getElementById('dbg')).display`)) === 'none', 'the on-screen readout is hidden in play');
    const hudC = await centre('#hud');
    await P.fingers('touchStart', [{ id: 3, x: hudC.x, y: hudC.y }]);
    await sleep(3300);
    await P.fingers('touchEnd', []);
    await sleep(400);
    check((await P.eval(`getComputedStyle(document.getElementById('dbg')).display`)) === 'block' && /input/.test(await P.eval(`document.getElementById('dbg').textContent`)), 'holding the coin counter for 3 seconds shows the readout on the screen (for checking the sensors on a phone)');
    await open('?dbg=1&level=1');
    check((await P.eval(`getComputedStyle(document.getElementById('dbg')).display`)) === 'block', '?dbg=1 shows it from the start');
    }
    if (want('real')) {
    await P.viewport(W, H, DPR);
    await fresh();
    // ---- REAL sensor events, from Chrome's own sensor pipeline ----
    console.log('\nreal sensor events from Chrome (DevTools sensor overrides): devicemotion, then deviceorientation');
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
      await start(4, 'easy');
      await P.eval('__openSky()');
      await feedReal(pose(90, 15, 30), 30);
      q = await st();
      let d = await P.eval('({ t: __dbg.tilt, s: __dbg.sensors })');
      check(d.s.motionEvents > 20 && d.t.source === 'motion' && d.t.live && q.input === 'tilt' && q.steer > 0.45 && q.x > 30, `Chrome's own devicemotion events (${d.s.motionEvents} of them, none made by the page) steer her right for a 15° right lean`, { input: q.input, steer: q.steer, lean: d.t.lean, up: [d.t.x, d.t.y, d.t.z] });
      const xr = q.x;
      await feedReal(pose(90, -15, 30), 30);
      q = await st();
      check(q.input === 'tilt' && q.steer < -0.45 && q.x < xr - 25, 'and left for a left lean', { steer: q.steer, x: q.x });
      for (const type of types) await P.send('Emulation.setSensorOverrideEnabled', { enabled: false, type });
    } catch (e) { check(false, 'real devicemotion events through the DevTools sensor overrides', String(e.message || e)); }
    try {
      const o = orientation(pose(90, 15, 30));
      await P.send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: o.beta, gamma: o.gamma });
      await open();
      await start(4, 'easy');
      await P.eval('__openSky()');
      for (let i = 0; i < 24; i++) { await P.send('DeviceOrientation.setDeviceOrientationOverride', { alpha: 0, beta: o.beta + (i % 2 ? 0.4 : -0.4), gamma: o.gamma }); await sleep(40); }
      q = await st();
      const d = await P.eval('({ t: __dbg.tilt, s: __dbg.sensors })');
      check(d.s.orientationEvents - d.s.orientationNull > 6 && d.t.source === 'orient' && q.input === 'tilt' && q.steer > 0.4 && q.x > 15, `Chrome's own deviceorientation events (beta ${o.beta.toFixed(1)}, gamma ${o.gamma.toFixed(1)}) steer her right for the same lean`, { input: q.input, steer: q.steer, lean: d.t.lean, events: d.s.orientationEvents });
      await P.send('DeviceOrientation.clearDeviceOrientationOverride');
    } catch (e) { check(false, 'real deviceorientation events through the DevTools override', String(e.message || e)); }
    }
    if (want('saves')) {
    await P.viewport(W, H, DPR);
    await fresh();
    // ================= saves, and the main game's mute switch =================
    console.log('\nsaves');
    for (const [bad, what] of [['{"mode":"fast","unlocked":"x","stars":"nope","best":7,"coins":"lots"}', 'nonsense fields'], ['{"unlocked":{"easy":99,"medium":-3},"stars":{"easy":[3,"3",9,-1]},"coins":-5}', 'odd numbers'], ['[1,2,3]', 'an array'], ['{oops', 'not JSON']]) {
      await P.eval(`localStorage.setItem('game.slide.save', ${JSON.stringify(bad)})`);
      await open();
      const z = await st();
      const ok = ['easy', 'medium', 'hard'].every((m) => z.save.unlocked[m] >= 1 && z.save.unlocked[m] <= 20 && z.save.stars[m].length === 20 && z.save.best[m].length === 20 && z.save.stars[m].every((v) => v >= 0 && v <= 3 && Number.isInteger(v))) && z.save.coins >= 0 && ['easy', 'medium', 'hard'].includes(z.save.mode) && z.screen === 'levels';
      check(ok, `a save with ${what} still opens safely`, { unlocked: z.save.unlocked, coins: z.save.coins });
    }
    console.log('\nwith window.IsabellaStore (as in the Android app), and the mute switch');
    await P.eval(`localStorage.clear()`);
    const lsBefore = await savedRaw();
    const mainSave = JSON.stringify({ muted: true, unlocked: 3, gold: 51, crown: true });
    const { identifier } = await P.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__fakeStore = { 'isabella.save': ${JSON.stringify(mainSave)}, 'game.slide.save': JSON.stringify({ v: 1, mode: 'medium', unlocked: { easy: 1, medium: 2, hard: 1 }, stars: { medium: [2] }, best: { medium: [40] }, coins: 123 }) };
               window.IsabellaStore = { get: (k) => (k in window.__fakeStore ? window.__fakeStore[k] : null), set: (k, v) => { window.__fakeStore[k] = String(v); } };`,
    });
    await open();
    s = await st();
    check(s.muted === true && s.mode === 'medium' && s.save.unlocked.medium === 2 && s.save.stars.medium[0] === 2 && s.save.coins === 123 && s.crown === true, 'progress, the last mode and the mute switch come from IsabellaStore, not localStorage', { muted: s.muted, mode: s.mode });
    await tapEl('.lvl[data-level="2"]');
    await P.waitFor('__slideDebug.state.screen === "play" && __slideDebug.state.level === 2', 3000);
    await sleep(300);
    q = await st();
    check(q.muted === true && (q.gain === 0 || q.gain === null), 'muted for real: no sound is made (no audio at all, or master gain 0)', { muted: q.muted, gain: q.gain });
    await warpTo('finish', 300);
    s = await toResults('IsabellaStore');
    const fake = JSON.parse(await P.eval(`window.__fakeStore['game.slide.save']`));
    check(fake.v === 1 && fake.stars.medium[0] === 2 && fake.stars.medium[1] === s.stars && fake.unlocked.medium === 3 && fake.unlocked.easy === 1 && fake.coins >= 123 + 10 && (await savedRaw()) === lsBefore, 'the save is written to IsabellaStore under game.slide.save; localStorage left alone', fake);
    check((await P.eval(`window.__fakeStore['isabella.save']`)) === mainSave, 'and the main game\'s save (with its mute switch) is never written: byte for byte as it was');
    await P.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    // with isabella.save in localStorage: read, never written, whatever happens
    const her = JSON.stringify({ unlocked: 20, stars: new Array(20).fill(3), gold: 5271, muted: false, played: true, crown: true });
    await P.eval(`localStorage.clear(); localStorage.setItem('isabella.save', ${JSON.stringify(her)})`);
    await open();
    check((await st()).crown === true && (await st()).muted === false, 'Isabella wears her crown glow when the main game says she earned it, and sound is on when not muted');
    await tapEl('.lvl[data-level="1"]');
    await P.waitFor('__slideDebug.state.screen === "play"', 3000);
    await warpTo('finish', 300);
    await toResults('mute');
    check((await P.eval(`localStorage.getItem('isabella.save')`)) === her, 'playing a course leaves isabella.save byte-for-byte as it was');
    await P.eval(`localStorage.setItem('isabella.save', '{not json')`);
    await open();
    check((await st()).muted === false && (await P.eval(`localStorage.getItem('isabella.save')`)) === '{not json', 'an unreadable isabella.save is left alone');
    await P.eval(`localStorage.setItem('isabella.save', ${JSON.stringify(JSON.stringify({ muted: true }))})`);
    await open();
    check((await st()).muted === true, 'muted: true in isabella.save mutes the game on the next visit');
    await P.eval(`localStorage.removeItem('isabella.save')`);

    // grown-ups: hold the title for 4 seconds to open every course (in the mode on show)
    await P.eval(`localStorage.clear()`);
    await open();
    await tapEl('#mode-hard');
    await sleep(150);
    const tr = await rectOf('#title');
    await P.fingers('touchStart', [{ id: 1, x: tr.x + tr.w / 2, y: tr.y + tr.h / 2 }]);
    await sleep(4300);
    await P.fingers('touchEnd', []);
    await sleep(200);
    s = await st();
    check(s.save.unlocked.hard === 20 && s.save.unlocked.easy === 1 && s.save.stars.hard.every((v) => v === 0), 'holding the title for 4 s opens every course in the mode on show (stars untouched, the other modes too)');
    }
    if (want('last')) {
    await P.viewport(W, H, DPR);
    await fresh();
    // ---- the last course, and the frame rate ----
    await start(20, 'hard');
    await P.eval(`__pilotOn('child', true)`);
    await sleep(400);
    await P.eval('__slideDebug.resetPerf()');
    await sleep(4000);
    const perf = await P.eval('__slideDebug.perf()');
    console.log(`        frame stats, Hard course 20 (headless, ${Math.round(W * 2.5)}x${Math.round(H * 2.5)} canvas): ${JSON.stringify(perf, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v))}`);
    check(perf.fps > 50 && perf.drawP95Ms < 10, 'Hard course 20 draws at over 50 fps with p95 draw time under 10 ms', { fps: +perf.fps.toFixed(1), p95: +perf.drawP95Ms.toFixed(2) });
    await start(17, 'medium');
    await P.eval(`(() => { const lp = __slideDebug.run.lev.loops[0]; __slideDebug.warp(lp.a - 200, SlideLogic.laneAt(__slideDebug.run.lev, lp.a - 200)); __pilotOn('child', true); })()`);
    await P.eval('__slideDebug.resetPerf()');
    await sleep(4500);
    const perfL = await P.eval('__slideDebug.perf()');
    check(perfL.fps > 50 && perfL.drawP95Ms < 12, 'and through a loop-the-loop (the busiest drawing) at over 50 fps with p95 draw time under 12 ms', { fps: +perfL.fps.toFixed(1), p95: +perfL.drawP95Ms.toFixed(2) });
    await P.eval('__pilotOff()');
    await start(20, 'easy');
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
    await start(7, 'medium');
    await sleep(500);
    const back = await P.eval('window.__back()');
    await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the back button to reach the hub');
    check(back === true, 'window.__back() returns true and goes to ../../index.html');
    await open();
    await start(12, 'hard');
    await sleep(400);
    await tapEl('#homeBtn');
    await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the home button from a course');
    check(true, 'the home button leaves a course for the hub');
    // coins earned are in the save the moment they are earned: leave mid-course, nothing lost
    await open();
    await start(1, 'easy');
    await P.eval(`__pilotOn('child', true)`);
    await P.waitFor('__slideDebug.state.coins >= 3', 20000, 'three coins');
    const heldCoins = (await st()).coins;
    await P.eval('window.__pause()');
    const mid = await savedObj();
    check(mid.coins >= heldCoins, `leaving in the middle of a course loses no coins (${heldCoins} earned, ${mid.coins} saved)`, mid.coins);
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
