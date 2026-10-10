// Long-play check for Potion Colours: about three minutes of random real-touch play across levels and modes.
//   node test/games/potions/soak.js [screenshotDir] [chromeProfileDir] [seconds=180]
//   POTIONS_WEB=<dir> runs it against another copy of the web folder (to prove it catches a leak).
// Fingers drag or tap random bottles (mostly the ones the flower needs, sometimes any, sometimes let go in the wrong
// place), tap the cauldron (undo), the flower, Isabella and the grass, drag two bottles at once, and pick levels, modes
// and pages on the level map; the results card is left by its buttons. Checks: no exceptions or console errors, nothing
// piles up (particles, butterflies, leaving flowers, coins in flight, queued pours), the coins shown always equal the
// coins earned, and no memory growth: JS data in a heap-snapshot diff, DOM nodes and listeners, 50 trips through the
// level map and 8 chests in a row leaving nothing behind.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const WEB = path.resolve(process.env.POTIONS_WEB || path.join(ROOT, 'web'));
const PAGE = 'file://' + path.join(WEB, 'games/potions/index.html');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'potions-soak'));
const PROFILE = path.resolve(process.argv[3] || path.join(ROOT, '.local/chrome-potions-soak'));
const SECONDS = +(process.argv[4] || 180);
const W = 915, HT = 412, DPR = 2.625, PORT = 9496;

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await launch({ port: PORT, profile: PROFILE, width: W, height: HT });
  const problems = [];
  cdp.on((m) => {
    const p = m.params || {};
    if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + ((p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text));
    if (m.method === 'Runtime.consoleAPICalled' && /^(error|warning|assert)$/.test(p.type)) problems.push('console.' + p.type + ': ' + p.args.map((a) => a.value || a.description).join(' '));
    if (m.method === 'Log.entryAdded' && /^(error|warning)$/.test(p.entry.level)) problems.push('log.' + p.entry.level + ': ' + p.entry.text);
  });
  try {
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable'); await cdp.send('HeapProfiler.enable');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: HT, deviceScaleFactor: DPR, mobile: true });
    const ev = async (e) => { const r = await cdp.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(e.slice(0, 80) + ': ' + r.exceptionDetails.text); return r.result.value; };
    const D = (e) => ev('window.__dbg.' + e);
    const st = () => D('state()');
    // every level of every mode open, so the soak can wander (set as the page starts, before the game reads it)
    const seed = { v: 1, mode: 'medium', unlocked: { easy: 20, medium: 20, hard: 20 }, stars: { easy: new Array(20).fill(0), medium: new Array(20).fill(0), hard: new Array(20).fill(0) }, coins: 0 };
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); localStorage.setItem('game.potions.save', ${JSON.stringify(JSON.stringify(seed))}); } catch (e) {}` });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: PAGE });
    await loaded; await sleep(800);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

    const pt = (x, y, id) => ({ x, y, id, radiusX: 10, radiusY: 10, force: 1 });
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    async function tap(x, y) { await touch('touchStart', [pt(x, y, 1)]); await touch('touchEnd', []); }
    async function tapEl(sel) {
      const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 2 } : null; })()`);
      if (r) await tap(r.x, r.y);
      return !!r;
    }
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
    // Measured the same way every time: on the level map, after it has drawn, after two full GCs.
    const heap = async (onLevels) => {
      if (onLevels) { await D('goLevels()'); await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); await sleep(250); }
      await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
      const h = await cdp.send('Runtime.getHeapUsage'), dom = await cdp.send('Memory.getDOMCounters');
      return { usedMB: +(h.usedSize / 1048576).toFixed(2), nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents };
    };
    // Bytes held, by kind of thing, from a heap snapshot. Compiled code is kept apart: V8 compiles more as more of the
    // game gets played, which is warm-up, not a leak.
    let chunks = null;
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

    const peak = { parts: 0, butterflies: 0, leaving: 0, coinsFly: 0, queue: 0 };
    const tally = { drags: 0, multi: 0, taps: 0, cauldronTaps: 0, other: 0, levels: {}, modes: {}, results: 0, levelSwitches: 0, coinMismatch: 0, pages: 0, sessions: 0 };
    const memory = [];
    let shots = 0, sessionStart = Date.now(), lastKey = null;
    const t0 = Date.now(), warm = 20000;
    let base = null, baseKinds = null;
    await D('timeScale(3)');
    while (Date.now() - t0 < SECONDS * 1000) {
      if (!base && Date.now() - t0 > warm) { base = await heap(true); baseKinds = await heldByKind(); memory.push({ t: Math.round((Date.now() - t0) / 1000), ...base }); continue; }
      if (base && memory.length && Date.now() - t0 - memory[memory.length - 1].t * 1000 > 20000) memory.push({ t: Math.round((Date.now() - t0) / 1000), ...(await heap()) });
      const s = await st();
      for (const k of Object.keys(peak)) peak[k] = Math.max(peak[k], Array.isArray(s[k]) ? s[k].length : +s[k] || 0);
      // quiet moments only: the coins in the count must match the coins earned
      if (s.screen === 'play' && s.phase === 'play' && !s.show && s.coinsFly === 0 && s.hud !== s.rules.coins) tally.coinMismatch++;
      if (s.screen === 'levels') {
        // the short early levels most of the time (they reach the chest within a session), sometimes a later one, in any mode and page
        const m = ['easy', 'medium', 'hard'][tally.sessions++ % 3];
        await tapEl('#mode-' + m); await sleep(120);
        if (Math.random() < 0.25) { await tapEl(Math.random() < 0.5 ? '#pgNext' : '#pgPrev'); tally.pages++; await sleep(120); }
        const n = Math.random() < 0.6 ? 1 + Math.floor(Math.random() * 4) : 1 + Math.floor(Math.random() * 20);
        const here = await ev(`!!document.querySelector('.lvl[data-n="${n}"]')`);
        if (here) await tapEl(`.lvl[data-n="${n}"]`); else await tapEl('.lvl');
        await sleep(300);
        sessionStart = Date.now(); continue;
      }
      if (s.screen === 'results') {
        tally.results++;
        if (shots < 2) { fs.writeFileSync(path.join(OUT, `results-${++shots}.png`), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 0.5 } })).data, 'base64')); }
        const r = Math.random();
        if (!(r < 0.5 && await tapEl('#resNext'))) await tapEl(r < 0.8 ? '#resLevels' : '#resReplay');
        await sleep(400); sessionStart = Date.now(); continue;
      }
      const key = s.level + s.mode;
      if (key !== lastKey) { lastKey = key; tally.levels[s.level] = (tally.levels[s.level] || 0) + 1; tally.modes[s.mode] = (tally.modes[s.mode] || 0) + 1; }
      if (s.phase === 'win') { await sleep(250); continue; }   // the chest party plays out by itself
      if (Date.now() - sessionStart > 22000) { await D('goLevels()'); tally.levelSwitches++; await sleep(300); continue; }   // a long level: back to the map (its coins are kept)
      const ready = s.bottles.filter((b) => b.settled && !b.used);
      const r = Math.random(), cx = s.cauldron.cx, cy = s.cauldron.cy;
      if (s.show || s.active || !ready.length) {
        // while the show plays, poke around: the cauldron, the flower, Isabella, the grass
        if (r < 0.25) { const f = s.flowers[0]; if (f && Math.random() < 0.6) await tap(f.cx, f.cy); else if (s.isabella && Math.random() < 0.5) await tap(s.isabella.cx, s.isabella.cy); else await tap(rnd(150, W - 30), rnd(60, 200)); tally.other++; }
        else if (r < 0.32) { await tap(cx, cy); tally.cauldronTaps++; }
        await sleep(120); continue;
      }
      if (r < 0.04) { await tap(cx, cy); tally.cauldronTaps++; await sleep(100); continue; }                       // undo, or a squash of an empty pot
      if (r < 0.08) { await tap(rnd(150, W - 30), rnd(60, 300)); tally.other++; await sleep(60); continue; }
      const need = ready.filter((b) => s.rules.recipe.includes(b.id));
      const b = Math.random() < 0.8 && need.length ? pick(need) : pick(ready);
      if (r < 0.30 && ready.length >= 2) {
        // two fingers at once, each carrying a bottle to the cauldron
        const [p, q] = ready.slice(0, 2).sort(() => Math.random() - 0.5);
        await drag([{ x: p.hcx, y: p.hcy }, { x: q.hcx, y: q.hcy }], [{ x: cx - 20, y: cy }, { x: cx + 20, y: cy }], 10);
        tally.multi++; await sleep(100); continue;
      }
      if (r < 0.50) { await tap(b.hcx, b.hcy); tally.taps++; await sleep(60 + Math.random() * 100); continue; }
      const g = Math.random();
      const to = g < 0.75 ? { x: cx + rnd(-60, 60), y: cy + rnd(-70, 40) } : g < 0.9 ? { x: rnd(40, W - 40), y: rnd(100, HT - 30) } : { x: b.hcx + rnd(-30, 30), y: b.hcy - 10 };
      await drag([{ x: b.hcx, y: b.hcy }], [to], 8 + Math.floor(Math.random() * 8));
      tally.drags++;
      await sleep(40 + Math.random() * 100);
    }
    await D('timeScale(1)');
    const end = await heap(true), endKinds = await heldByKind();
    memory.push({ t: Math.round((Date.now() - t0) / 1000), ...end });
    const kindsGrew = {};
    for (const k of new Set(Object.keys(baseKinds).concat(Object.keys(endKinds)))) kindsGrew[k] = +(((endKinds[k] || 0) - (baseKinds[k] || 0)) / 1024).toFixed(1);
    // JS data = everything a game leak would pile up (objects, arrays, closures, strings, numbers...); 'native' is the canvases' pixels
    // and 'code' is V8 compiling more of the game as it is played
    const jsDataKB = +Object.keys(kindsGrew).filter((k) => !['code', 'native', 'hidden', 'synthetic'].includes(k)).reduce((a, k) => a + kindsGrew[k], 0).toFixed(1);
    // fifty trips to the level map and back into a level: the rebuilt grid must not leave DOM nodes or listeners behind
    const tripsBefore = await heap(true);
    for (let i = 0; i < 50; i++) { await D('goLevels()'); await sleep(20); await D(`start(${1 + (i % 20)}, '${['easy', 'medium', 'hard'][i % 3]}')`); await sleep(20); }
    const tripsAfter = await heap(true);
    // eight chests and results cards in a row (game time x4): the card's stars and the party must not pile up either
    await D('timeScale(4)');
    const chestNodes = [];
    for (let i = 0; i < 8; i++) {
      await D("start(1, 'easy')");
      for (let g = 0; g < 400; g++) {
        const s = await st();
        if (s.results) break;
        if (s.phase === 'play' && !s.show && s.rules.phase === 'filling' && !s.active && s.queue === 0) { const need = s.rules.recipe.filter((id) => !s.rules.poured.includes(id)); if (need.length) await D(`pour('${need[0]}')`); }
        await sleep(60);
      }
      await sleep(400);
      tally.results++;
      if (i % 3 === 0) { await tapEl('#resNext'); await sleep(300); }   // the results card's buttons, by touch
      if (i === 1 || i === 7) chestNodes.push((await heap(true)).nodes); else await D('goLevels()');
    }
    await D('timeScale(1)');
    const trips = { nodes: tripsAfter.nodes - tripsBefore.nodes, listeners: tripsAfter.listeners - tripsBefore.listeners, chestNodes: chestNodes[1] - chestNodes[0] };
    const s = await st(), c = await D('counters'), perf = await D('perf()');
    const fps = await ev(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })`);
    fs.writeFileSync(path.join(OUT, 'soak-end.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 0.5 } })).data, 'base64'));
    const grew = { heapMB: +(end.usedMB - base.usedMB).toFixed(2), codeKB: kindsGrew.code || 0, nativeKB: kindsGrew.native || 0, jsDataKB, nodes: end.nodes - base.nodes, listeners: end.listeners - base.listeners, trips };
    const report = { seconds: Math.round((Date.now() - t0) / 1000), tally, peak, memory, grew, kindsGrewKB: kindsGrew, counters: c, fps: +fps.toFixed(1), perf, final: { screen: s.screen, level: s.level, mode: s.mode, save: s.save }, problems };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    const bounded = peak.parts < 600 && peak.butterflies <= 9 && peak.leaving <= 4 && peak.coinsFly <= 4 && peak.queue <= 4;
    // No memory growth: JS data grows by under 100 KB; DOM nodes and listeners stay put; 50 trips through the level map leave nothing behind.
    const flat = jsDataKB < 100 && grew.heapMB < 1.5 && grew.nodes < 100 && grew.listeners <= 0 && end.documents <= base.documents && trips.nodes < 20 && trips.listeners <= 0 && trips.chestNodes < 10;
    const played = c.pours > 100 && c.wrongs > 0 && c.undos > 0 && c.blooms > 20 && tally.multi > 3 && tally.drags > 30 && tally.taps > 30 && Object.keys(tally.modes).length === 3 && Object.keys(tally.levels).length >= 3 && c.chests > 0 && tally.results > 0;
    console.log(JSON.stringify({ seconds: report.seconds, drags: tally.drags, twoFinger: tally.multi, taps: tally.taps, cauldronTaps: tally.cauldronTaps, pours: c.pours, wrongs: c.wrongs, undos: c.undos, blooms: c.blooms,
      chests: c.chests, results: tally.results, modes: tally.modes, levelsVisited: Object.keys(tally.levels).length, coinMismatch: tally.coinMismatch, peak, memory, grew, fps: report.fps, problems: problems.length }));
    const ok = problems.length === 0 && bounded && flat && played && tally.coinMismatch === 0 && fps >= 55;
    console.log(ok ? 'SOAK PASS' : `SOAK FAIL (problems ${problems.length}, bounded ${bounded}, flat ${flat}, played ${played}, coinMismatch ${tally.coinMismatch}, fps ${fps.toFixed(1)})`);
    if (problems.length) console.log(problems.slice(0, 5).join('\n'));
    cdp.close(); cdp.proc.kill();
    process.exit(ok ? 0 : 1);
  } catch (e) { console.error('soak crashed:', e); cdp.proc.kill(); process.exit(2); }
})();
