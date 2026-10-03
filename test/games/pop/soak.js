// Long-play check for Bubble Party: about three minutes of random real-touch play across the levels.
//   node test/games/pop/soak.js [screenshotDir] [chromeProfileDir] [seconds=180]
// Fingers drag random bubbles (mostly home, sometimes to the wrong icon, the bare sand or the water), drop and
// tap grumps, drag two bubbles at once, tap Isabella and the icons; levels are picked on the level select and
// left through the results card (or the levels screen when a level drags on). Checks: no exceptions or console
// errors, nothing piles up (bubbles, friends, particles, leaving creatures, numerals, coins in flight), the coins
// shown always equal the coins earned, and no memory growth: JS data in a heap-snapshot diff, bounded picture
// caches, DOM nodes and listeners, 50 trips through the level select and 8 chests in a row leaving nothing behind.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const PAGE = 'file://' + path.join(ROOT, 'web/games/pop/index.html');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'pop-soak'));
const PROFILE = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'chrome-pop-soak'));
const SECONDS = +(process.argv[4] || 180);
const W = 915, HT = 412, DPR = 2.625, PORT = 9455;

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await launch({ port: PORT, profile: PROFILE, width: W, height: HT });
  const problems = [];
  let onGame = true;
  cdp.on((m) => {
    const p = m.params || {};
    if (!onGame) return;
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && /^(error|warning|assert)$/.test(p.type)) problems.push('console.' + p.type + ': ' + p.args.map((a) => a.value || a.description).join(' '));
    if (m.method === 'Log.entryAdded' && /^(error|warning)$/.test(p.entry.level)) problems.push('log.' + p.entry.level + ': ' + p.entry.text);
  });
  try {
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('HeapProfiler.enable');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: HT, deviceScaleFactor: DPR, mobile: true });
    const ev = async (e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(e.slice(0, 80) + ': ' + r.exceptionDetails.text); return r.result.value; };
    const D = (e) => ev('window.__popDebug.' + e);
    const st = () => D('state()');
    // every level open, so the soak can wander; levels 1-3 a few saves from their chests, so chests and results come up too
    // (set as the page starts, before the game reads it)
    const seed = { v: 2, unlocked: 10, stars: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], runs: {
      1: { coins: 2, tray: ['fish', 'turtle', 'fish', 'turtle', 'fish', 'turtle'], grumps: 0 },
      2: { coins: 2, tray: ['octopus', 'puffer', 'octopus', 'puffer', 'octopus'], grumps: 0 },
      3: { coins: 3, tray: ['turtle', 'whale', 'crab', 'turtle', 'whale'], grumps: 0 } } };
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); localStorage.setItem('game.pop.save', ${JSON.stringify(JSON.stringify(seed))}); } catch (e) {}` });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: PAGE });
    await loaded; await sleep(800);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

    const pt = (x, y, id) => ({ x, y, id, radiusX: 10, radiusY: 10, force: 1 });
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    async function tap(x, y) { await touch('touchStart', [pt(x, y, 1)]); await touch('touchEnd', []); }
    async function tapEl(sel) {
      const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || e.offsetParent === null && getComputedStyle(e).position !== 'fixed') return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; })()`);
      if (r) await tap(r.x, r.y);
      return !!r;
    }
    // one or more fingers, each from a[i] to b[i], moving together
    async function drag(a, b, steps) {
      await touch('touchStart', a.map((p, i) => pt(p.x, p.y, i + 1)));
      for (let k = 1; k <= steps; k++) {
        const u = k / steps;
        await touch('touchMove', a.map((p, i) => pt(p.x + (b[i].x - p.x) * u, p.y + (b[i].y - p.y) * u, i + 1)));
        await sleep(16);
      }
      await touch('touchEnd', []);
    }
    const rnd = (a, z) => a + Math.random() * (z - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    // Measured the same way every time: on the level select, after it has drawn (its stars and padlocks are <use>
    // copies made when first drawn, so counting before the first frame reads ~80 nodes low), after two full GCs.
    const heap = async (onLevels) => {
      if (onLevels) { await D('goLevels()'); await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); await sleep(250); }
      await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
      const h = await cdp.send('Runtime.getHeapUsage'), dom = await cdp.send('Memory.getDOMCounters');
      return { usedMB: +(h.usedSize / 1048576).toFixed(2), nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents };
    };
    // Bytes held, by kind of thing, from a heap snapshot. Compiled code is kept apart: V8 compiles more as
    // more of the game gets played, which is warm-up, not a leak. Everything else (objects, arrays,
    // closures, strings...) is what a leak would pile up.
    let chunks = null;   // one listener for every snapshot; collecting only while a snapshot is being taken
    cdp.on((m) => { if (chunks && m.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(m.params.chunk); });
    async function heldByKind() {
      chunks = [];
      await cdp.send('HeapProfiler.collectGarbage');
      await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      const snap = JSON.parse(chunks.join('')); chunks = null;
      const f = snap.snapshot.meta.node_fields, nf = f.length, ti = f.indexOf('type'), si = f.indexOf('self_size'), types = snap.snapshot.meta.node_types[0];
      const out = {};
      for (let i = 0; i < snap.nodes.length; i += nf) { const t = types[snap.nodes[i + ti]]; out[t] = (out[t] || 0) + snap.nodes[i + si]; }
      return out;
    }

    const peak = { bubbles: 0, friends: 0, parts: 0, leavers: 0, numerals: 0, flyCoins: 0, lostCoins: 0 };
    const tally = { drags: 0, multi: 0, taps: 0, levels: {}, results: 0, levelSwitches: 0, coinMismatch: 0 };
    const memory = [];
    let shots = 0, sessionStart = Date.now(), lastLevel = null;
    const t0 = Date.now(), warm = 20000;
    let base = null, baseKinds = null;
    while (Date.now() - t0 < SECONDS * 1000) {
      if (!base && Date.now() - t0 > warm) { base = await heap(true); baseKinds = await heldByKind(); memory.push({ t: Math.round((Date.now() - t0) / 1000), ...base }); continue; }
      if (base && memory.length && Date.now() - t0 - memory[memory.length - 1].t * 1000 > 20000) memory.push({ t: Math.round((Date.now() - t0) / 1000), ...(await heap()) });
      const s = await st();
      for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], Array.isArray(s[k]) ? s[k].length : s[k] || 0);
      // quiet moments only: the coins in their rings must match the coins earned
      if (s.screen === 'play' && s.friends === 0 && s.flyCoins === 0 && s.owed === 0 && s.hudCoins !== s.coins) tally.coinMismatch++;
      if (s.screen === 'levels') {
        // mostly the short early levels (they reach their chest within a session), sometimes the long later ones
        const n = Math.random() < 0.6 ? 1 + Math.floor(Math.random() * 3) : 4 + Math.floor(Math.random() * 7);
        await tapEl(`.lvl[data-level="${n}"]`); await sleep(300);
        sessionStart = Date.now(); continue;
      }
      if (s.screen === 'results') {
        tally.results++;
        if (shots < 2) { fs.writeFileSync(path.join(OUT, `results-${++shots}.png`), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 0.5 } })).data, 'base64')); }
        const r = Math.random();
        if (!(r < 0.5 && await tapEl('#resNext'))) await tapEl(r < 0.8 ? '#resLevels' : '#resReplay');
        await sleep(400); sessionStart = Date.now(); continue;
      }
      if (s.level !== lastLevel) { lastLevel = s.level; tally.levels[s.level] = (tally.levels[s.level] || 0) + 1; }
      if (s.phase === 'win') { await sleep(250); continue; }   // the chest party plays out by itself
      if (Date.now() - sessionStart > 35000) { await D('goLevels()'); tally.levelSwitches++; await sleep(300); continue; }   // a long level: back to the levels (its coins are kept)
      const floorY = (s.floor * s.scale) / s.dpr;
      const free = s.bubbles.filter((b) => b.visible && !b.held && !b.snapping && b.cy > b.cr * 0.4 && b.cy - b.cr * 0.4 < floorY && !(b.cx < 120 && b.cy < 110));
      const r = Math.random();
      if (!free.length && Math.random() < 0.75) { await sleep(150); continue; }   // the next bubbles are still coming up
      if (!free.length || r < 0.05) {
        // a tap somewhere: open water, an icon, Isabella's side of the sea
        const ic = pick(s.icons);
        if (Math.random() < 0.5 && ic) await tap(ic.cx, ic.cy); else await tap(rnd(150, W - 30), rnd(60, floorY - 20));
        tally.taps++; await sleep(60); continue;
      }
      if (r < 0.3 && free.length >= 2) {
        // two fingers at once, each carrying a friend home
        const [p, q] = free.slice(0, 2), ip = s.icons.find((i) => i.kind === p.kind) || pick(s.icons), iq = s.icons.find((i) => i.kind === q.kind) || pick(s.icons);
        await drag([{ x: p.cx, y: p.cy }, { x: q.cx, y: q.cy }], [{ x: ip.cx, y: ip.cy }, { x: iq.cx + 6, y: iq.cy }], 12);
        tally.multi++; await sleep(80); continue;
      }
      const b = pick(free);
      let to;
      if (b.grumpy) {
        const g = Math.random();
        if (g < 0.4) { await tap(b.cx, b.cy); tally.taps++; await sleep(80); continue; }      // pop it away
        to = g < 0.7 ? { x: rnd(40, W - 40), y: rnd(floorY + 20, HT - 20) } : { x: b.cx + rnd(-80, 80), y: Math.max(30, b.cy - 40) };   // onto the sand, or just let go
      } else {
        const g = Math.random(), home = s.icons.find((i) => i.kind === b.kind), other = pick(s.icons.filter((i) => i !== home)) || home;
        to = g < 0.72 && home ? { x: home.cx + rnd(-20, 20), y: home.cy + rnd(-20, 20) }
          : g < 0.86 ? { x: other.cx, y: other.cy }
          : g < 0.93 ? { x: rnd(40, W - 40), y: rnd(floorY + 20, HT - 20) } : { x: rnd(150, W - 40), y: rnd(40, floorY - 30) };
      }
      await drag([{ x: b.cx, y: b.cy }], [to], 8 + Math.floor(Math.random() * 8));
      tally.drags++;
      await sleep(40 + Math.random() * 80);
    }
    const end = await heap(true), endKinds = await heldByKind();
    memory.push({ t: Math.round((Date.now() - t0) / 1000), ...end });
    const kindsGrew = {};
    for (const k of new Set(Object.keys(baseKinds).concat(Object.keys(endKinds)))) kindsGrew[k] = +(((endKinds[k] || 0) - (baseKinds[k] || 0)) / 1024).toFixed(1);
    // JS data = everything a game leak would pile up (objects, arrays, closures, strings, numbers...); 'native' is the
    // canvases' pixels (bounded caches, checked below) and 'code' is V8 compiling more of the game as it is played
    const jsDataKB = +Object.keys(kindsGrew).filter((k) => !['code', 'native', 'hidden', 'synthetic'].includes(k)).reduce((a, k) => a + kindsGrew[k], 0).toFixed(1);
    // fifty trips to the level select and back: the rebuilt grid must not leave DOM nodes or listeners behind
    const tripsBefore = await heap(true);
    for (let i = 0; i < 50; i++) { await D('goLevels()'); await sleep(20); await D(`start(${1 + (i % 10)})`); await sleep(20); }
    const tripsAfter = await heap(true);
    // eight chests and results cards in a row (game time x4): the cards' stars and the party must not pile up either
    await D('timeScale(4)');
    const chestNodes = [];
    for (let i = 0; i < 8; i++) {
      await D('start(1, true)');
      await ev(`(() => { const P = window.__popDebug, ks = P.state().icons.map((q) => q.kind); for (let k = 0; k < 30; k++) { const id = P.spawn({ kind: ks[k % 2], x: 500, y: 200, still: true }); P.drop(id, ks[k % 2]); } })()`);
      for (let w = 0; w < 80 && !(await st()).results; w++) await sleep(100);
      await sleep(400);
      if (i === 1 || i === 7) chestNodes.push((await heap(true)).nodes); else await D('goLevels()');
    }
    await D('timeScale(1)');
    const trips = { nodes: tripsAfter.nodes - tripsBefore.nodes, listeners: tripsAfter.listeners - tripsBefore.listeners, chestNodes: chestNodes[1] - chestNodes[0] };
    const s = await st(), c = await D('counters'), perf = await D('perf()');
    const fps = await ev(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })`);
    fs.writeFileSync(path.join(OUT, 'soak-end.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 0.5 } })).data, 'base64'));
    const grew = { heapMB: +(end.usedMB - base.usedMB).toFixed(2), codeKB: kindsGrew.code || 0, nativeKB: kindsGrew.native || 0, jsDataKB, nodes: end.nodes - base.nodes, listeners: end.listeners - base.listeners, trips, caches: s.caches };
    const report = { seconds: Math.round((Date.now() - t0) / 1000), tally, peak, memory, grew, kindsGrewKB: kindsGrew, counters: c, fps: +fps.toFixed(1), perf, final: { screen: s.screen, level: s.level, unlocked: s.unlocked, stars: s.savedStars }, problems };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    const bounded = peak.bubbles <= 12 && peak.friends < 30 && peak.parts < 600 && peak.leavers < 40 && peak.numerals < 12 && peak.flyCoins < 6 && peak.lostCoins < 8;
    // No memory growth: JS data grows by under 100 KB; the picture caches stay bounded (two seas, two bubble glasses,
    // one glow per colour) so canvas memory cannot creep; DOM nodes and listeners stay put; and 50 trips through the
    // level select leave nothing behind.
    const cs = s.caches, capped = cs.back <= 2 && cs.floor <= 2 && cs.glass <= 2 && cs.glow <= 80 && cs.shade <= 200 && cs.pal <= 60;
    const flat = jsDataKB < 100 && capped && grew.heapMB < 1.5 && grew.nodes < 100 && grew.listeners <= 0 && end.documents <= base.documents
      && trips.nodes < 20 && trips.listeners <= 0 && trips.chestNodes < 10;
    const played = tally.drags > 100 && c.saves > 60 && c.grumpDrops > 0 && c.grumpTaps > 0 && c.wrong > 0 && tally.multi > 3 && Object.keys(tally.levels).length >= 3 && c.chests > 0 && tally.results > 0;
    console.log(JSON.stringify({ seconds: report.seconds, drags: tally.drags, twoFinger: tally.multi, taps: tally.taps, saves: c.saves, wrong: c.wrong, grumpDrops: c.grumpDrops, grumpTaps: c.grumpTaps,
      coinsEarned: c.coinsEarned, coinsLost: c.coinsLost, chests: c.chests, results: tally.results, levelsVisited: tally.levels, coinMismatch: tally.coinMismatch, peak, memory, grew, fps: report.fps, problems: problems.length }));
    const ok = problems.length === 0 && bounded && flat && played && tally.coinMismatch === 0 && fps >= 55;
    console.log(ok ? 'SOAK PASS' : `SOAK FAIL (problems ${problems.length}, bounded ${bounded}, flat ${flat}, played ${played}, coinMismatch ${tally.coinMismatch}, fps ${fps.toFixed(1)})`);
    if (problems.length) console.log(problems.slice(0, 5).join('\n'));
    onGame = false;
    cdp.close(); cdp.proc.kill();
    process.exit(ok ? 0 : 1);
  } catch (e) { console.error('soak crashed:', e); cdp.proc.kill(); process.exit(2); }
})();
