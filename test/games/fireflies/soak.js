// Long-play check for Firefly Numbers: about three minutes of random real-touch play across all three modes and both worlds.
//   node test/games/fireflies/soak.js [screenshotDir] [chromeProfileDir] [seconds=180]
//   FIREFLIES_WEB=<dir> runs it against another copy of the web folder (defects.js does this).
// Fingers tap fireflies (mostly the right ones for the jar, sometimes a wrong kind: the jar in a fill round, an outside
// firefly in a take-away, empty night, two fingers at once), tap the jar after it is full (overfills), let the hint hand
// show, leave levels by the menu or play them out through the results card. Checks: no exceptions or console errors; nothing
// piles up (fireflies, flights, sparkles, pops); the spacing rule holds in the real game, always; the coins in their row
// match the jars filled; the coins saved match the jars and chests played; and no memory growth: JS data in a heap-snapshot
// diff, DOM nodes and listeners, 50 trips through the menu and 8 chests in a row leaving nothing behind.
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const WEB = path.resolve(process.env.FIREFLIES_WEB || path.join(ROOT, 'web'));
const PAGE = 'file://' + path.join(WEB, 'games/fireflies/index.html');
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OUT = path.resolve(pos[0] || path.join(ROOT, '.local/fireflies-soak'));
const PROFILE = path.resolve(pos[1] || path.join(ROOT, '.local/chrome-fireflies-soak'));
const SECONDS = +(pos[2] || 180);
const W = 915, HT = 412, DPR = 2.625, PORT = 9494, ZONE = 52;

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
    const D = (e) => ev('window.__dbg.' + e);
    const st = () => D('state()');
    // every level of every mode open, so the soak can wander
    const seed = { v: 1, mode: 'easy', unlocked: { easy: 20, medium: 20, hard: 20 }, stars: { easy: [], medium: [], hard: [] }, coins: 100, jars: 0, caught: 0, overfills: 0, chests: 0 };
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.clear(); localStorage.setItem('game.fireflies.save', ${JSON.stringify(JSON.stringify(seed))}); } catch (e) {}` });
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
    const rnd = (a, z) => a + Math.random() * (z - a);
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    // Measured the same way every time: on the menu, after it has drawn, after two full GCs.
    const heap = async (onMenu) => {
      if (onMenu) { await D('goMenu(0)'); await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); await sleep(250); }
      await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage');
      const h = await cdp.send('Runtime.getHeapUsage'), dom = await cdp.send('Memory.getDOMCounters');
      return { usedMB: +(h.usedSize / 1048576).toFixed(2), nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents };
    };
    // Bytes held, by kind of thing, from a heap snapshot. Compiled code is kept apart: V8 compiles more as more of the game
    // gets played, which is warm-up, not a leak. Everything else (objects, arrays, closures, strings...) is what a leak would pile up.
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

    const peak = { flies: 0, flights: 0, parts: 0, pops: 0 };
    const tally = { taps: 0, multi: 0, wrongKind: 0, empty: 0, overTaps: 0, menuVisits: 0, results: 0, modes: {}, levels: {}, coinMismatch: 0, saveMismatch: 0, spacingBreaks: 0, hintsSeen: 0, badState: 0 };
    const memory = [];
    const t0 = Date.now(), warm = 20000;
    let base = null, baseKinds = null, sessionStart = Date.now(), lastKey = null, startCoins = (await st()).coins;
    let lastOverfills = 0, lastKeyMode = null, quietUntil = 0;
    while (Date.now() - t0 < SECONDS * 1000) {
      if (!base && Date.now() - t0 > warm) { base = await heap(true); baseKinds = await heldByKind(); memory.push({ t: Math.round((Date.now() - t0) / 1000), ...base }); continue; }
      if (base && memory.length && Date.now() - t0 - memory[memory.length - 1].t * 1000 > 20000) memory.push({ t: Math.round((Date.now() - t0) / 1000), ...(await heap()) });
      const s = await st();
      peak.flies = Math.max(peak.flies, s.flies.length); peak.flights = Math.max(peak.flights, s.flights.length); peak.parts = Math.max(peak.parts, s.parts); peak.pops = Math.max(peak.pops, s.pops);
      if (s.hint != null) tally.hintsSeen++;
      if (s.screen === 'play') {
        if (s.minGap < 2 * ZONE - 1e-6 || s.minGap < s.sep - 1e-6) tally.spacingBreaks++;
        if (!(s.inJar >= 0 && s.inJar <= 10 && s.shown >= 0 && s.shown <= 11) || s.flies.some((f) => !Number.isFinite(f.cx) || !Number.isFinite(f.cy)) || s.overfills < lastOverfills && s.level === lastKey) tally.badState++;
        if (!s.cel && !s.coinFly && !s.jarAnim && s.phase === 'play' && s.coinsHud !== s.capped) tally.coinMismatch++;
        lastOverfills = s.overfills; lastKey = s.level;
      }
      if (s.screen === 'menu') {
        tally.menuVisits++;
        const visit = tally.menuVisits;
        if (visit % 3 !== 2) {   // most visits go straight to a level that has a take-away, a sum of three or a sum, near its jar
          const [m2, n2, r2] = [['hard', 16, 3], ['medium', 12, 0], ['easy', 18, 2], ['hard', 17, 2], ['medium', 16, 3], ['hard', 14, 3], ['easy', 3, 0], ['hard', 20, 1], ['medium', 5, 0], ['hard', 18, 2]][visit % 10];
          await D(`start("${m2}", ${n2}, ${r2})`); await sleep(300);
          sessionStart = Date.now(); lastOverfills = 0;
          if (visit % 4 === 1) quietUntil = Date.now() + 15500;
          const t2 = await st(); if (t2.screen === 'play') { tally.modes[t2.runMode] = (tally.modes[t2.runMode] || 0) + 1; tally.levels[t2.level] = (tally.levels[t2.level] || 0) + 1; }
          continue;
        }
        const mode = ['easy', 'medium', 'hard'][Math.floor(visit / 3) % 3];
        await tapEl('#mode-' + mode); await sleep(80);
        if (Math.random() < 0.3) { await tapEl(Math.random() < 0.5 ? '#next' : '#prev'); await sleep(80); }
        // mostly the short early levels (they reach their chest within a session), sometimes the long later ones
        const pg = (await st()).page, n = (Math.random() < 0.6 ? 1 + Math.floor(Math.random() * 4) : 5 + Math.floor(Math.random() * 6)) + pg * 10;
        await tapEl(`.lvl[data-level="${n}"]`); await sleep(300);
        sessionStart = Date.now(); lastOverfills = 0;
        if (visit % 4 === 1) quietUntil = Date.now() + 15500;   // sit still a while: the hint hand must show (14 s is the longest wait, on Hard)
        const t = await st(); if (t.screen === 'play') { tally.modes[t.runMode] = (tally.modes[t.runMode] || 0) + 1; tally.levels[t.level] = (tally.levels[t.level] || 0) + 1; }
        continue;
      }
      if (s.screen === 'results') {
        tally.results++;
        const r = Math.random();
        if (!(r < 0.2 && await tapEl('#resNext'))) await tapEl(r < 0.8 ? '#resLevels' : '#resReplay');
        await sleep(400); sessionStart = Date.now(); lastOverfills = 0; continue;
      }
      if (s.phase !== 'play') { await sleep(250); continue; }   // the chest party plays out by itself
      if (Date.now() < quietUntil) { await sleep(300); continue; }
      if (Date.now() - sessionStart > 22000 + (quietUntil ? 15500 : 0)) { await D('goMenu(0)'); await sleep(300); continue; }   // a long level: back to the menu
      const free = s.flies.filter((f) => !f.busy && f.cx > 20 && f.cx < W - 20 && f.cy > 10 && f.cy < HT - 10);
      const r = Math.random();
      if (r < 0.04) { tally.empty++; await tap(rnd(130, W - 30), rnd(30, HT - 20)); await sleep(60); continue; }          // empty night (or whatever is there)
      if (r < 0.08 && s.rulesPhase === 'full') { tally.overTaps++; if (free.length) await tap(free[0].cx, free[0].cy); await sleep(60); continue; }   // one too many
      if (r < 0.12) {   // the wrong kind of tap for this jar
        tally.wrongKind++;
        if (s.roundKind === 't') { if (free.length) await tap(pick(free).cx, pick(free).cy); } else await tap(s.jar.cx, s.jar.cy);
        await sleep(60); continue;
      }
      if (r < 0.2 && free.length >= 2) {   // two fingers at once
        const [p, q] = free.slice(0, 2);
        await touch('touchStart', [pt(p.cx, p.cy, 1), pt(q.cx, q.cy, 2)]); await touch('touchEnd', []);
        tally.multi++; await sleep(80); continue;
      }
      if (s.roundKind === 't') { if (s.rulesPhase === 'fill' && !s.cel) { if (free.length && Math.random() < 0.25) await tap(pick(free).cx, pick(free).cy); else await tap(s.jar.cx, s.jar.cy); } else await sleep(120); tally.taps++; await sleep(80 + Math.random() * 200); continue; }
      if (!free.length || s.rulesPhase === 'full') { await sleep(150); continue; }
      const f = pick(free);
      await tap(f.cx, f.cy);
      tally.taps++;
      await sleep(80 + Math.random() * 300);
    }
    const end = await heap(true), endKinds = await heldByKind();
    memory.push({ t: Math.round((Date.now() - t0) / 1000), ...end });
    const kindsGrew = {};
    for (const k of new Set(Object.keys(baseKinds).concat(Object.keys(endKinds)))) kindsGrew[k] = +(((endKinds[k] || 0) - (baseKinds[k] || 0)) / 1024).toFixed(1);
    // JS data = everything a game leak would pile up; 'native' is the canvases' pixels (the backdrop and the ring picture are the only
    // two, checked below) and 'code' is V8 compiling more of the game as it is played
    const jsDataKB = +Object.keys(kindsGrew).filter((k) => !['code', 'native', 'hidden', 'synthetic'].includes(k)).reduce((a, k) => a + kindsGrew[k], 0).toFixed(1);
    // fifty trips to the menu and into a level: the rebuilt grid must not leave DOM nodes or listeners behind
    const tripsBefore = await heap(true);
    for (let i = 0; i < 50; i++) { await D('goMenu(0)'); await sleep(20); await D(`start("${['easy', 'medium', 'hard'][i % 3]}", ${1 + (i % 10)})`); await sleep(20); }
    const tripsAfter = await heap(true);
    // eight chests and results cards in a row (game time x4): the cards' stars and the party must not pile up either
    await D('timeScale(4)');
    const chestNodes = [];
    for (let i = 0; i < 8; i++) {
      await D('start("easy", 1)');
      for (let k = 0; k < 400; k++) {
        const q = await st();
        if (q.screen === 'results') break;
        if (q.phase === 'play' && q.rulesPhase === 'fill' && !q.cel && !q.jarAnim) { const f = q.flies.find((x) => !x.busy); if (f) await D(`tapFly(${f.id})`); }
        await sleep(40);
      }
      await sleep(400);
      if (i === 1 || i === 7) chestNodes.push((await heap(true)).nodes); else await D('goMenu(0)');
    }
    await D('timeScale(1)');
    const trips = { nodes: tripsAfter.nodes - tripsBefore.nodes, listeners: tripsAfter.listeners - tripsBefore.listeners, chestNodes: chestNodes[1] - chestNodes[0] };
    const s = await st(), c = await D('counters'), perf = await D('perf()');
    // the saved coins must equal what was earned: a coin per jar, five per chest (the starting 100 aside)
    tally.saveMismatch = s.coins === startCoins + c.caps + c.chests * 5 + 0 ? 0 : 1;
    const fps = await ev(`new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); })`);
    fs.writeFileSync(path.join(OUT, 'soak-end.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 0.5 } })).data, 'base64'));
    const grew = { heapMB: +(end.usedMB - base.usedMB).toFixed(2), codeKB: kindsGrew.code || 0, nativeKB: kindsGrew.native || 0, jsDataKB, nodes: end.nodes - base.nodes, listeners: end.listeners - base.listeners, trips, caches: s.caches };
    const report = { seconds: Math.round((Date.now() - t0) / 1000), tally, peak, memory, grew, kindsGrewKB: kindsGrew, counters: c, fps: +fps.toFixed(1), perf, final: { screen: s.screen, coins: s.coins, unlocked: s.unlocked }, problems };
    fs.writeFileSync(path.join(OUT, 'soak.json'), JSON.stringify(report, null, 2));
    const bounded = peak.flies <= 14 && peak.flights < 40 && peak.parts < 450 && peak.pops < 12;
    // No memory growth: JS data grows by under 100 KB; the two cached pictures stay two; DOM nodes and listeners stay put; and 50
    // trips through the menu leave nothing behind.
    const cs = s.caches, capped = cs.backdrop <= 1 && cs.ring <= 1;
    const flat = jsDataKB < 100 && capped && grew.heapMB < 1.5 && grew.nodes < 100 && grew.listeners <= 0 && end.documents <= base.documents
      && trips.nodes < 20 && trips.listeners <= 0 && trips.chestNodes < 10;
    const played = tally.taps > 80 && c.catches > 60 && c.caps > 10 && c.overfills > 0 && c.shakes > 0 && c.jarTaps > 0 && c.releases > 0 && tally.multi > 3 && c.chests > 0 && tally.results > 0 && Object.keys(tally.modes).length === 3 && c.hints > 0;
    console.log(JSON.stringify({ seconds: report.seconds, taps: tally.taps, twoFinger: tally.multi, wrongKind: tally.wrongKind, empty: tally.empty, overTaps: tally.overTaps, catches: c.catches, releases: c.releases, shakes: c.shakes, jarTaps: c.jarTaps, overfills: c.overfills,
      jars: c.caps, chests: c.chests, results: tally.results, modes: tally.modes, levelsVisited: Object.keys(tally.levels).length, hints: c.hints, coinMismatch: tally.coinMismatch, saveMismatch: tally.saveMismatch, spacingBreaks: tally.spacingBreaks, badState: tally.badState, peak, memory, grew, fps: report.fps, problems: problems.length }));
    const ok = problems.length === 0 && bounded && flat && played && tally.coinMismatch === 0 && tally.saveMismatch === 0 && tally.spacingBreaks === 0 && tally.badState === 0 && fps >= 45;
    console.log(ok ? 'SOAK PASS' : `SOAK FAIL (problems ${problems.length}, bounded ${bounded}, flat ${flat}, played ${played}, coinMismatch ${tally.coinMismatch}, saveMismatch ${tally.saveMismatch}, spacingBreaks ${tally.spacingBreaks}, badState ${tally.badState}, fps ${fps.toFixed(1)})`);
    if (problems.length) console.log(problems.slice(0, 5).join('\n'));
    onGame = false;
    cdp.close(); cdp.proc.kill();
    process.exit(ok ? 0 : 1);
  } catch (e) { console.error('soak crashed:', e); cdp.proc.kill(); process.exit(2); }
})();
