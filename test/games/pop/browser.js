// Bubble Party in headless Chrome, driven like fingers: real touch drags through the DevTools protocol.
//   node test/games/pop/browser.js [screenshotDir] [chromeProfileDir]
//   (defaults: <tmp>/pop-shots and <tmp>/chrome-pop; DevTools port 9455, its own throwaway profile)
// Runs twice, each with a fresh save: 915x412 at DPR 2.625 (the Seeker) and 800x360 at DPR 3 (a 20:9 phone).
//   level select -> level 1 by touch -> real drags save ten creatures and earn a coin -> a wrong drop bounces
//   back -> level 3: a grumpy drop costs a coin, a tapped grump pops harmlessly -> level 1 played to its chest
//   through the hooks -> results -> level 2 unlocked, still unlocked after a reload -> home goes to ../../index.html.
// Once, at the Seeker size: every level mid-play (screenshots), the real v1 save migrating, window.IsabellaStore,
// mute, held upright, frame rate. Exits 1 on any failed check or any console error, warning or exception.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const PAGE = 'file://' + path.join(ROOT, 'web/games/pop/index.html');
const HUB = 'file://' + path.join(ROOT, 'web/index.html');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'pop-shots'));
const PROFILE = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'chrome-pop'));
const PORT = 9455;
// a real save from the old tap-to-pop game (see verify.js)
const V1_SAVE = '{"v":1,"scene":1,"aquarium":[{"k":"jelly","c":"#ff7ac8"},{"k":"puffer","c":"#ffc93a"},{"k":"jelly","c":"#ff7ac8"},{"k":"jelly","c":"#ff7ac8"}],"total":14,"kinds":{"crab":3,"turtle":2,"fish":2,"seahorse":2,"starfish":1,"jelly":3,"puffer":1},"filled":1}';

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
  const D = (expr) => ev(`window.__popDebug.${expr}`);
  const st = () => D('state()');
  async function go(url, label) { where = label; const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url }); await loaded; await sleep(400); }
  async function reload() { const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.reload', { ignoreCache: true }); await loaded; await sleep(400); }
  // Open the game with storage set up by `js`. It runs as the new page starts, AFTER the old page has gone:
  // a page writes its save as it closes (pagehide), so storage changed while it is open would be overwritten.
  async function loadWith(js) {
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { ${js} } catch (e) {} })();` });
    await go(PAGE, 'pop');
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
  async function touchTap(x, y) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function tapEl(sel) {
    const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await touchTap(r.x, r.y);
  }
  // one finger down on `a`, sliding to `b` over `steps` moves (60 Hz), then up; `beforeEnd` runs with the finger still down
  async function touchDrag(a, b, o) {
    o = o || {};
    const steps = o.steps || 12;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1, radiusX: 10, radiusY: 10, force: 1 }] });
    await sleep(30);
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, id: 1, radiusX: 10, radiusY: 10, force: 1 }] });
      await sleep(16);
    }
    if (o.beforeEnd) await o.beforeEnd();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  // bubbles a finger can reach: above the sand, on screen, clear of the home button and of other bubbles
  async function reachable(filter) {
    const [s, home] = await Promise.all([st(), ev(`(() => { const r = document.getElementById('home').getBoundingClientRect(); return { r: r.right, b: r.bottom }; })()`)]);
    const floorY = (s.floor * s.scale) / s.dpr;
    return s.bubbles.filter((b) => b.visible && !b.held && !b.snapping && b.cy - b.cr > 4 && b.cy + b.cr * 0.3 < floorY && b.cy - b.cr * 0.5 < floorY
      && !(b.cx < home.r + 30 && b.cy < home.b + 30) && b.cx > b.cr * 0.6 && b.cx < W - b.cr * 0.6
      && !s.bubbles.some((q) => q !== b && q.id !== b.id && Math.hypot(q.cx - b.cx, q.cy - b.cy) < (q.cr + b.cr) * 1.05)
      && (!filter || filter(b)));
  }
  const iconOf = (s, kind) => s.icons.find((i) => i.kind === kind);
  const toClient = (s, x, y) => ({ x: (x * s.scale) / s.dpr, y: (y * s.scale) / s.dpr });
  async function spawnAt(kind, fx, y) { const s = await st(); return D(`spawn({ kind: '${kind}', x: ${s.VW * fx}, y: ${y}, still: true })`); }
  const bubble = async (id) => (await st()).bubbles.find((b) => b.id === id);
  // saves through the hooks: spawn a bubble with one of the level's creatures and drop it on its icon (the same rule code as a drag)
  async function hookSaves(n, gapMs) {
    const s = await st(), kinds = s.icons.map((i) => i.kind);
    for (let i = 0; i < n; i++) {
      const k = kinds[i % kinds.length], id = await D(`spawn({ kind: '${k}', x: ${s.VW * (0.25 + 0.5 * Math.random())}, y: 200, still: true })`);
      const t = await D(`drop(${id}, '${k}')`);
      if (t !== 'saved' && t !== 'ignored') throw new Error('hook drop gave ' + t);
      if (gapMs) await sleep(gapMs);
    }
  }
  const settle = (pred, ms) => waitFor(async () => { const s = await st(); return pred(s) ? s : null; }, ms || 12000, 120);
  const quiet = (s) => s.friends === 0 && s.flyCoins === 0 && s.owed === 0 && s.trayShown === s.tray && s.hudCoins === s.coins;

  async function suite(w, h, dpr, tag) {
    console.log(`\n=== ${w}x${h} @ DPR ${dpr} ===`);
    await viewport(w, h, dpr);
    await loadWith('localStorage.clear()');
    await sleep(500);
    let s = await st();
    check(`${tag}: opens on the level select with a fresh save`, s.screen === 'levels' && s.unlocked === 1 && s.savedStars.every((v) => v === 0), `screen ${s.screen}, unlocked ${s.unlocked}`);
    check(`${tag}: canvas fills the screen with DPR capped at 2.5`, s.dpr === 2.5 && s.canvas[0] === Math.round(w * 2.5) && s.canvas[1] === Math.round(h * 2.5), `dpr ${s.dpr}, canvas ${s.canvas}`);
    const ui = await ev(`(() => { const vh = innerHeight / 100, r = (e) => e.getBoundingClientRect(), hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const lv = [...document.querySelectorAll('.lvl')], t = r(document.getElementById('title')), p = r(document.querySelector('.pill')), g = r(document.getElementById('grid')), hm = r(document.getElementById('home'));
      return { n: lv.length, locked: lv.filter((b) => b.classList.contains('locked')).length, levelVh: +(Math.min(...lv.map((b) => Math.min(r(b).width, r(b).height))) / vh).toFixed(1),
        homeVh: +(Math.min(hm.width, hm.height) / vh).toFixed(1), overlap: hit(t, p) || hit(t, g) || hit(g, hm) || hit(p, g) || hit(t, hm), off: [t, p, g, hm].some((b) => b.left < 0 || b.top < 0 || b.right > innerWidth || b.bottom > innerHeight) }; })()`);
    check(`${tag}: ten numbered level bubbles, 2-10 padlocked, each at least 19vh, nothing overlapping`, ui.n === 10 && ui.locked === 9 && ui.levelVh >= 19 && ui.homeVh >= 19 && !ui.overlap && !ui.off, ui);
    await shot(`${tag}-01-level-select`);

    await tapEl('.lvl[data-level="2"]');
    await sleep(120);
    check(`${tag}: a padlocked level only wiggles`, (await st()).screen === 'levels' && (await ev(`document.querySelector('.lvl[data-level="2"]').classList.contains('shake')`)));

    // ---------- level 1 by touch ----------
    await tapEl('.lvl[data-level="1"]');
    s = await settle((q) => q.screen === 'play' && q.level === 1, 3000);
    check(`${tag}: a tap on level 1 starts it`, !!s, s && `level ${s.level}`);
    await sleep(1600);
    s = await st();
    const iconVh = s.icons.map((i) => +((i.cr * 2) / h * 100).toFixed(1)), bubVh = s.bubbles.map((b) => +((b.cr * 2) / h * 100).toFixed(1));
    check(`${tag}: two creature icons on the sand, each at least 19vh`, s.icons.length === 2 && iconVh.every((v) => v >= 19), iconVh.join(', ') + ' vh');
    check(`${tag}: bubbles are at least 19vh across`, bubVh.length >= 2 && bubVh.every((v) => v >= 19), bubVh.join(', ') + ' vh');
    check(`${tag}: before the first save, a hand shows a bubble being carried to its icon`, s.hint != null, `hint on bubble ${s.hint}`);
    await shot(`${tag}-02-level1-hint`);

    // ---------- real touch: ten drags onto the matching icons make a coin ----------
    const c0 = await D('counters');
    let saved = 0, tries = 0, coinShot = false;
    const misses = [];
    while (saved < 10 && tries < 60) {
      tries++;
      const bs = await reachable((b) => b.cute);
      if (!bs.length) { await sleep(300); continue; }   // more are on their way up
      const b = bs[0], s1 = await st(), ic = iconOf(s1, b.kind);
      await touchDrag({ x: b.cx, y: b.cy }, { x: ic.cx, y: ic.cy }, { steps: 12, beforeEnd: saved === 0 ? () => shot(`${tag}-03-dragging-to-its-icon`) : null });
      await sleep(40);
      const s2 = await st();
      if (s2.saves === s1.saves + 1 && s2.coins * 10 + s2.tray === s1.coins * 10 + s1.tray + 1) saved++;
      else misses.push({ kind: b.kind, savesBefore: s1.saves, savesAfter: s2.saves });
      if (saved === 1) { await sleep(500); await shot(`${tag}-04-saved-on-its-icon`); }
      if (saved === 10 && !coinShot) {
        const fly = await waitFor(async () => { const q = await st(); return q.flyCoins > 0 ? q : null; }, 4000, 40);
        if (fly) { await sleep(250); await shot(`${tag}-05-coin-flies-up`); coinShot = true; }
      }
    }
    const c1 = await D('counters');
    s = await st();
    check(`${tag}: 10 real touch drags onto the matching icons save 10 creatures`, saved === 10 && misses.length === 0, `saved ${saved} in ${tries} tries; misses ${JSON.stringify(misses)}`);
    check(`${tag}: ten saved make a gold coin and the tray starts again`, s.coins === 1 && s.tray === 0, `coins ${s.coins}, tray ${s.tray}`);
    check(`${tag}: the drags arrived as touch pointers`, (c1.pointerTypes.touch || 0) - (c0.pointerTypes.touch || 0) >= 10 && c1.grabs - c0.grabs >= 10, JSON.stringify(c1.pointerTypes));
    s = await settle((q) => quiet(q) && q.hudCoins === 1, 8000);
    check(`${tag}: the coin lands in its ring at the top`, !!s && coinShot, s ? `hudCoins ${s.hudCoins}` : 'never landed');

    // ---------- a wrong drop bounces back up ----------
    s = await st();
    const before = { saves: s.saves, tray: s.tray, coins: s.coins };
    const wid = await spawnAt('fish', 0.5, 190);
    await sleep(350);
    let wb = await bubble(wid);
    const turtle = iconOf(s, 'turtle');
    await touchDrag({ x: wb.cx, y: wb.cy }, { x: turtle.cx, y: turtle.cy }, { steps: 12 });
    await sleep(200);
    s = await st();
    const wb1 = await bubble(wid);
    check(`${tag}: a fish dropped on the turtle icon changes nothing (no penalty)`, s.saves === before.saves && s.tray === before.tray && s.coins === before.coins && !!wb1, `saves ${s.saves}, tray ${s.tray}, coins ${s.coins}, bubble ${wb1 ? 'still here' : 'gone'}`);
    await shot(`${tag}-06-wrong-drop-bounces`);
    await sleep(1300);
    const wb2 = await bubble(wid);
    check(`${tag}: ...and it bounces gently back up into the water, still there to carry`, wb1 && wb2 && wb2.y < s.floor - 20 && wb2.y < wb1.y - 60 && !wb2.held,
      wb1 && wb2 ? `y ${wb1.y.toFixed(0)} -> ${wb2.y.toFixed(0)} (sand at ${s.floor})` : 'bubble missing');
    // a tap on a friend's bubble: it jiggles and the hand shows where it lives (it does not pop)
    const tapB = (await reachable((b) => b.cute))[0];
    if (tapB) {
      const cc = await D('counters');
      await touchTap(tapB.cx, tapB.cy); await sleep(120);
      const after = await st(), cc2 = await D('counters');
      check(`${tag}: a tap on a friend's bubble does not pop it; the hand shows where it lives`, cc2.cuteTaps === cc.cuteTaps + 1 && after.bubbles.some((b) => b.id === tapB.id) && after.hint === tapB.id, `hint ${after.hint}`);
    } else check(`${tag}: a tap on a friend's bubble does not pop it`, false, 'no bubble to tap');

    // ---------- level 3: grumpy creatures ----------
    await D('start(3)');
    await sleep(500);
    await hookSaves(10, 30);
    s = await settle((q) => quiet(q) && q.hudCoins === 1, 9000);
    check(`${tag}: level 3, one coin earned`, !!s && s.coins === 1, s && `coins ${s.coins}`);
    const gid = await spawnAt('urchin', 0.5, 180);
    await sleep(350);
    const gb = await bubble(gid);
    s = await st();
    const sand = toClient(s, (s.icons[0].x + s.icons[1].x) / 2, s.icons[0].y + 10);   // bare sand between two icons
    await touchDrag({ x: gb.cx, y: gb.cy }, sand, { steps: 12, beforeEnd: () => shot(`${tag}-07-grump-held-over-the-sand`) });
    await sleep(150);
    s = await st();
    check(`${tag}: a grumpy creature dropped on the sand costs one coin`, s.coins === 0 && s.grumpDrops === 1 && s.hudCoins === 0 && s.lostCoins === 1 && !(await bubble(gid)), `coins ${s.coins}, grumpDrops ${s.grumpDrops}, lostCoins ${s.lostCoins}`);
    await sleep(350);
    await shot(`${tag}-08-grump-grumbles-coin-wobbles-away`);
    const gid2 = await spawnAt('urchin', 0.5, 180);
    await sleep(300);
    const gb2 = await bubble(gid2), whale = iconOf(s, 'whale');
    await touchDrag({ x: gb2.cx, y: gb2.cy }, { x: whale.cx, y: whale.cy }, { steps: 10 });
    await sleep(120);
    s = await st();
    check(`${tag}: another grumpy drop at 0 coins: still 0, never below`, s.coins === 0 && s.grumpDrops === 2 && s.hudCoins === 0, `coins ${s.coins}, grumpDrops ${s.grumpDrops}`);
    const gid3 = await spawnAt('urchin', 0.3, 200);
    await sleep(300);
    const gb3 = await bubble(gid3), cg = await D('counters');
    await touchTap(gb3.cx, gb3.cy); await sleep(120);
    s = await st();
    check(`${tag}: a tap pops a grumpy bubble away harmlessly`, !(await bubble(gid3)) && (await D('counters')).grumpTaps === cg.grumpTaps + 1 && s.grumpDrops === 2 && s.coins === 0);
    const gid4 = await spawnAt('urchin', 0.7, 140);
    await sleep(300);
    const gb4 = await bubble(gid4);
    await touchDrag({ x: gb4.cx, y: gb4.cy }, { x: gb4.cx - 40, y: gb4.cy + 50 }, { steps: 8 });
    await sleep(120);
    s = await st();
    check(`${tag}: a grumpy creature let go in the water just floats on`, !!(await bubble(gid4)) && s.grumpDrops === 2, `grumpDrops ${s.grumpDrops}`);
    // the tenth save earns a coin that is still on its way up when a grump lands on the sand: that coin wobbles
    // away instead of landing, so the row never shows a coin she no longer has
    await hookSaves(10, 0);
    const gid5 = await spawnAt('urchin', 0.4, 200);
    await D(`drop(${gid5}, 'sand')`);
    s = await st();
    const inFlight = s.coins === 0 && s.hudCoins === 0 && s.owed === 1 && s.debt === 1;
    s = await settle((q) => quiet(q) && q.debt === 0 && q.lostCoins === 0, 9000);
    check(`${tag}: a coin still flying when a grump lands wobbles away instead of landing`, inFlight && !!s && s.coins === 0 && s.hudCoins === 0, s ? `coins ${s.coins}, row ${s.hudCoins}` : 'never settled');

    // ---------- level 1 to its treasure chest, through the hooks ----------
    await D('start(1)');
    await sleep(300);
    s = await st();
    check(`${tag}: level 1 resumes with the coin it had`, s.level === 1 && s.coins === 1 && s.hudCoins === 1, `coins ${s.coins}`);
    const need = (s.coinTarget - s.coins) * 10 - s.tray;
    await hookSaves(need, 45);
    s = await st();
    check(`${tag}: the 30th save reaches the target: progress is saved at once`, s.done && s.coins === 3 && s.unlocked === 2 && s.savedStars[0] === 3, `coins ${s.coins}/${s.coinTarget}, unlocked ${s.unlocked}, stars ${s.savedStars[0]}`);
    s = await settle((q) => q.phase === 'win', 15000);
    check(`${tag}: when the last coin lands, the treasure chest rises out of the sand`, !!s && s.chest && s.hudCoins === 3, s && `phase ${s.phase}, hudCoins ${s.hudCoins}`);
    s = await settle((q) => q.chestOpen > 0.95, 4000);
    await sleep(200);
    await shot(`${tag}-09-treasure-chest-opens`);
    const gold = await ev(`window.__popDebug.state().parts`);
    check(`${tag}: ...and opens with a fountain of gold coins`, !!s && gold > 60, `chest open ${s && s.chestOpen.toFixed(2)}, ${gold} particles`);
    s = await settle((q) => q.results, 6000);
    await waitFor(() => ev(`document.querySelectorAll('#bigStars svg.pop').length === 3`), 3000);
    await sleep(300);
    const shownStars = await ev(`[...document.querySelectorAll('#bigStars svg use')].filter((u) => u.getAttribute('fill') === '#ffd23f').length`);
    check(`${tag}: results: 3 stars (no grumpy drops on level 1)`, !!s && s.resultsStars === 3 && shownStars === 3, s && `stars ${s.resultsStars}, shown ${shownStars}`);
    await shot(`${tag}-10-results`);
    const saved1 = JSON.parse(await D('saved()'));
    check(`${tag}: saved: level 2 unlocked, 3 stars on level 1, the finished run cleared`, saved1.v === 2 && saved1.unlocked === 2 && saved1.stars[0] === 3 && !saved1.runs['1'] && saved1.runs['3'] && saved1.runs['3'].grumps === 3,
      JSON.stringify({ v: saved1.v, unlocked: saved1.unlocked, stars: saved1.stars.slice(0, 3), runs: saved1.runs }));

    await tapEl('#resLevels');
    await sleep(400);
    let lv = await ev(`(() => { const b = (n) => document.querySelector('.lvl[data-level="' + n + '"]'); return { screen: window.__popDebug.state().screen, l2locked: b(2).classList.contains('locked'), l2next: b(2).classList.contains('next'), l3locked: b(3).classList.contains('locked'), l1stars: b(1).querySelectorAll('use[fill="#ffd23f"]').length, pill: document.getElementById('starCount').textContent }; })()`);
    check(`${tag}: the levels button shows level 2 open (and bobbing) with 3 stars on level 1`, lv.screen === 'levels' && !lv.l2locked && lv.l2next && lv.l3locked && lv.l1stars === 3 && lv.pill === '3/30', lv);
    await shot(`${tag}-11-level-select-level-2-open`);
    await reload(); await sleep(500);
    lv = await ev(`(() => { const b = (n) => document.querySelector('.lvl[data-level="' + n + '"]'); return { l2locked: b(2).classList.contains('locked'), l1stars: b(1).querySelectorAll('use[fill="#ffd23f"]').length, unlocked: window.__popDebug.state().unlocked }; })()`);
    check(`${tag}: after a reload level 2 is still open and level 1 keeps its stars`, !lv.l2locked && lv.l1stars === 3 && lv.unlocked === 2, lv);
    await tapEl('.lvl[data-level="2"]');
    s = await settle((q) => q.screen === 'play' && q.level === 2, 3000);
    check(`${tag}: level 2 plays: octopus and puffer on the sand`, !!s && s.icons.map((i) => i.kind).join() === 'octopus,puffer', s && s.icons.map((i) => i.kind).join());

    // ---------- home and back ----------
    where = 'hub';
    let loaded = cdp.once('Page.loadEventFired');
    await tapEl('#home');
    await loaded; await sleep(300);
    let href = await ev('location.href');
    check(`${tag}: the home button opens ../../index.html`, href === HUB, href.replace(ROOT, ''));
    await go(PAGE, 'pop'); await sleep(300);
    where = 'hub';
    loaded = cdp.once('Page.loadEventFired');
    const ret = await ev('window.__back()');
    await loaded; await sleep(300);
    href = await ev('location.href');
    check(`${tag}: window.__back() returns true and opens ../../index.html`, ret === true && href === HUB, href.replace(ROOT, ''));
    await go(PAGE, 'pop');
  }

  // ======================= the two phone sizes =======================
  await suite(915, 412, 2.625, 'seeker');
  await suite(800, 360, 3, 'phone800');

  // ======================= once, at the Seeker size =======================
  console.log('\n=== more, at 915x412 ===');
  await viewport(915, 412, 2.625);
  await loadWith(`localStorage.clear(); localStorage.setItem('game.pop.save', JSON.stringify({ v: 2, unlocked: 10, stars: [3, 3, 3, 2, 3, 3, 1, 2, 3, 0] }))`);
  await sleep(400);
  await shot('levels-all-open');

  // ---------- counting order: friends saved in a rush are counted 1, 2, 3 ... one after another ----------
  await D('start(1, true)');
  await sleep(200);
  await hookSaves(10, 0);   // ten at once: they all finish dancing on their icons together
  await sleep(150);
  await hookSaves(3, 0);    // three more while those ten are still on their way (they wait for the coin)
  await settle(quiet, 12000);
  const log = (await D('counters')).countLog.slice(-13), order = log.map((e) => e[0]);
  const gaps = log.slice(1, 10).map((e, i) => e[1] - log[i][1]);
  check('friends saved in a rush are counted in order, one after another: 1..10, a coin, then 1, 2, 3',
    order.join() === '1,2,3,4,5,6,7,8,9,10,1,2,3' && gaps.every((g) => g >= 0.12), `order ${order.join(',')}; gaps ${gaps.map((g) => g.toFixed(2)).join(',')} s`);

  // ---------- every level mid-play ----------
  const table = await D('levels()');
  for (let n = 1; n <= 10; n++) {
    await D(`start(${n}, true)`);
    await sleep(200);
    const s0 = await st();
    await hookSaves(n === 10 ? 26 : 10 + (n % 4) + 2, 25);   // a coin or two in, some friends in the tray
    await settle(quiet, 9000);
    // a lively sea: friends from the level, and up to two of its grumps
    const cfg = table[n - 1], g = cfg.grumps.slice(0, 2), size = Math.min(6, cfg.bubbles + 1);
    const mix = cfg.kinds.map((k) => k[0]).slice(0, size - g.length);
    g.forEach((k, i) => mix.splice(1 + i * 2, 0, k));
    for (let i = 0; i < mix.length; i++) await D(`spawn({ kind: '${mix[i]}', x: ${s0.VW * (0.18 + (0.66 * i) / Math.max(1, mix.length - 1))}, y: ${150 + (i % 2) * 80} })`);
    await sleep(900);
    const s = await st();
    const iconVh = Math.min(...s.icons.map((i) => (i.cr * 2) / 412 * 100));
    check(`level ${n}: ${cfg.kinds.length} icons (${s.icons.map((i) => i.kind).join(', ')}), ${cfg.coins} coins to the chest, icons >= 19vh${cfg.grumps.length ? ', grumps: ' + cfg.grumps.join(', ') : ''}`,
      s.icons.length === cfg.kinds.length && s.coinTarget === cfg.coins && iconVh >= 19 && (!cfg.grumps.length || s.bubbles.some((b) => b.grumpy)), `icons ${iconVh.toFixed(1)}vh, coins ${s.coins}/${s.coinTarget}, tray ${s.tray}`);
    await shot(`level-${String(n).padStart(2, '0')}-mid-play`);
  }

  // ---------- the real v1 save from the old game migrates ----------
  await loadWith(`localStorage.clear(); localStorage.setItem('game.pop.save', ${JSON.stringify(V1_SAVE)})`);
  await sleep(400);
  let s = await st();
  check('v1 save: the game opens on the level select with level 1 open and the old totals kept', s.screen === 'levels' && s.unlocked === 1 && s.total === 14 && (await ev(`document.querySelectorAll('.lvl.locked').length`)) === 9, `unlocked ${s.unlocked}, total ${s.total}`);
  check('v1 save: loading it does not rewrite it straight away', (await ev(`localStorage.getItem('game.pop.save')`)) === V1_SAVE);
  await tapEl('.lvl[data-level="1"]'); await sleep(300);
  await hookSaves(1, 0);
  const sv = JSON.parse(await ev(`localStorage.getItem('game.pop.save')`));
  check('v1 save: after the first save it is stored as v2, keeping the lifetime totals', sv.v === 2 && sv.unlocked === 1 && sv.total === 15 && sv.kinds.jelly === 3 && sv.parties === 1 && !sv.aquarium && sv.runs['1'] && sv.runs['1'].tray.length === 1,
    JSON.stringify(sv));

  // ---------- inside the Android app: window.IsabellaStore ----------
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source:
    `(() => { const m = new Map([['isabella.save', JSON.stringify({ muted: true })], ['game.pop.save', ${JSON.stringify(V1_SAVE)}]]);
      window.__fakeStore = m; window.IsabellaStore = { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); } }; })();` });
  await reload(); await sleep(500);
  const localBefore = await ev(`localStorage.getItem('game.pop.save')`);
  s = await st();
  check('IsabellaStore: the save and the mute setting are read from the app store', s.total === 14 && s.unlocked === 1 && s.muted === true, `total ${s.total}, muted ${s.muted}`);
  await D('start(1)'); await sleep(200); await hookSaves(2, 20);
  const inStore = JSON.parse(await ev(`window.__fakeStore.get('game.pop.save')`));
  check('IsabellaStore: saves go to the app store, not localStorage', inStore.v === 2 && inStore.total === 16 && (await ev(`localStorage.getItem('game.pop.save')`)) === localBefore, `store total ${inStore.total}`);
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

  // ---------- sound follows the main game's mute switch ----------
  await loadWith(`localStorage.setItem('isabella.save', JSON.stringify({ unlocked: 3, muted: true }))`);
  await sleep(400);
  await tapEl('.lvl[data-level="1"]'); await sleep(300);
  s = await st();
  check('muted when isabella.save says so (no audio started at all)', s.muted === true && s.audio === 'none', `muted ${s.muted}, audio ${s.audio}`);
  await loadWith(`localStorage.setItem('isabella.save', JSON.stringify({ unlocked: 3, muted: false }))`);
  await sleep(400);
  const audioBefore = (await st()).audio;
  await tapEl('.lvl[data-level="1"]'); await sleep(400);
  s = await st();
  check('not muted: sound waits for a gesture, then runs after the first tap', audioBefore === 'none' && s.muted === false && s.audio === 'running' && s.gain > 0.5, `before ${audioBefore}, after ${s.audio}, gain ${s.gain}`);
  await ev(`localStorage.removeItem('isabella.save')`);

  // ---------- held upright the game waits behind a turn-the-phone picture ----------
  await viewport(412, 915, 2.625);
  await sleep(400);
  const up = await ev(`(() => { const r = document.getElementById('rotate'); return getComputedStyle(r).display; })()`);
  const cu0 = await D('counters');
  const ub = (await st()).bubbles[0];
  if (ub) await touchTap(ub.cx, ub.cy);
  await sleep(100);
  check('held upright: a turn-the-phone picture covers the game and taps do nothing', up === 'flex' && (await D('counters')).grabs === cu0.grabs, `rotate ${up}`);
  await viewport(915, 412, 2.625);
  await sleep(400);

  // ---------- frame rate: level 10, full sea ----------
  await D('start(10, true)');
  await sleep(300);
  for (let i = 0; i < 4; i++) await hookSaves(3, 30);
  await sleep(2500);
  const fpsExpr = `new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res({ frames: n, secs: (performance.now() - t0) / 1000 }); }; requestAnimationFrame(f); })`;
  await D('resetPerf()');
  const fps = await ev(fpsExpr), perf = await D('perf()');
  check('frame rate on level 10 with a full sea', fps.frames / fps.secs >= 55, `${(fps.frames / fps.secs).toFixed(1)} fps; game update+draw avg ${perf.avgMs.toFixed(2)} ms, p95 ${perf.p95Ms.toFixed(2)} ms`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await D('resetPerf()');
  const fps4 = await ev(fpsExpr), perf4 = await D('perf()');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  check('frame rate with the CPU slowed 4x (a modest phone)', fps4.frames / fps4.secs >= 45, `${(fps4.frames / fps4.secs).toFixed(1)} fps; game work p95 ${perf4.p95Ms.toFixed(2)} ms`);

  // ---------- no errors ----------
  const pop = problems.filter((p) => p.where === 'pop');
  check('no console errors, warnings or exceptions on the game page', pop.length === 0, pop.length ? JSON.stringify(pop.slice(0, 5)) : 'none');

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), page: PAGE, results, problems, shots }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed. Screenshots in ${OUT}`);
  cdp.close(); cdp.proc.kill();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('browser test crashed:', e); if (chrome) chrome.kill(); process.exit(2); });
