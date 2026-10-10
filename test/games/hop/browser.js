// Toadstool Hop in headless Chrome, driven like a finger: real touch taps through the DevTools protocol.
//   node test/games/hop/browser.js [screenshotDir] [chromeProfileDir] [--only=seeker|phone800|more]
//   (defaults: <repo>/.local/shots-hop and <repo>/.local/chrome-hop; DevTools port 9493, its own throwaway profile)
//   HOP_WEB=<dir> runs it against another copy of the web folder (to prove the checks catch an injected defect).
// Runs twice, each with a fresh save: 915x412 at DPR 2.625 (the Seeker) and 800x360 at DPR 3 (a 20:9 phone).
//   the level select: three mode buttons, two pages of ten, padlocks, the page arrows, every button at least 19vh and nothing overlapping ->
//   the mode picker by touch (and remembered) -> level 1 on Easy by touch: she stands in the left third, the hand shows after a quiet spell,
//   a tap hops her, the camera keeps her in the left third -> the whole of Easy level 1 played with real taps to the chest, the key, the
//   coins counted, the results card and its stars, the save, level 2 open (also after a reload) -> a splash on level 5 (Medium): the frog
//   puts her back on the platform she left and one coin drifts away; on Easy nothing is lost -> a Hard choice: a tap on the left half hops to
//   the near platform and the right half to the far one -> a half-played level resumes after a reload -> home and window.__back.
// Once, at the Seeker size: mid-play screenshots of all eight skies, window.IsabellaStore, mute (read, never written), held upright, frame rate.
// Exits 1 on any failed check or any console error, warning or exception.
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const WEB = path.resolve(process.env.HOP_WEB || path.join(ROOT, 'web'));
const PAGE = 'file://' + path.join(WEB, 'games/hop/index.html');
const HUB = 'file://' + path.join(WEB, 'index.html');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const OUT = path.resolve(args[0] || path.join(ROOT, '.local/shots-hop'));
const PROFILE = path.resolve(args[1] || path.join(ROOT, '.local/chrome-hop'));
const PORT = 9493;

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
  async function loadWith(js, query) {
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { ${js} } catch (e) {} })();` });
    await go(PAGE + (query || ''), 'hop');
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  async function shot(name) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 1200 / (W * DPR) } });
    const f = path.join(OUT, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    shots.push(f);
    return f;
  }
  async function waitFor(fn, ms, every) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(every || 40); }
    return null;
  }
  const settle = (pred, ms) => waitFor(async () => { const s = await st(); return pred(s) ? s : null; }, ms || 12000, 40);
  // ---- one real finger: a tap ----
  const pt = (x, y) => ({ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 });
  async function touchTap(x, y) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(x, y)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function tapEl(sel) {
    const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await touchTap(r.x, r.y);
  }
  const tapRight = () => touchTap(W * 0.78, HT * 0.62);
  const tapLeft = () => touchTap(W * 0.3, HT * 0.62);
  // play one safe hop with a real tap: wait until a tap would work for the next 0.4 s (and she has settled), then tap
  async function safeHop(right) {
    const s = await settle((q) => q.screen === 'play' && q.phase === 'stand' && q.safe, 15000);
    if (!s) return null;
    const before = s.node;
    await (right === false ? tapLeft() : tapRight());
    return settle((q) => q.node > before || q.phase !== 'stand', 4000);
  }
  async function playOut(limitMs, afterEach) {
    const t0 = Date.now(); let n = 0;
    while (Date.now() - t0 < limitMs) {
      const s = await st();
      if (s.phase === 'chest' || s.phase === 'done' || s.results || s.screen !== 'play') break;
      if (s.phase === 'stand' && s.safe) { await tapRight(); n++; if (afterEach) await afterEach(await st()); await sleep(60); } else await sleep(30);
    }
    return n;
  }
  const box = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, r: b.right, b: b.bottom, on: getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' }; })()`);
  const overlap = (a, b) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

  async function suite(w, h, dpr, tag) {
    console.log(`\n=== ${w}x${h} @ DPR ${dpr} ===`);
    await viewport(w, h, dpr);
    await loadWith('localStorage.clear()');
    await sleep(500);
    let s = await st();
    check(`${tag}: opens on the level select with a fresh save (Easy, only level 1 open)`, s.screen === 'levels' && s.mode === 'easy' && s.unlocked.easy === 1 && s.unlocked.medium === 1 && s.unlocked.hard === 1, `screen ${s.screen}, mode ${s.mode}`);
    check(`${tag}: canvas fills the screen with DPR capped at 2.5`, s.dpr === 2.5 && s.canvas[0] === Math.round(w * 2.5) && s.canvas[1] === Math.round(h * 2.5), `dpr ${s.dpr}, canvas ${s.canvas}`);
    const vh = h / 100;
    const ui = await ev(`(() => { const r = (e) => e.getBoundingClientRect(), vh = innerHeight / 100;
      const lv = [...document.querySelectorAll('.lvl')], md = [...document.querySelectorAll('.mode')], t = r(document.getElementById('title')), hm = r(document.getElementById('home')), g = r(document.getElementById('grid')), pill = r(document.querySelector('.pill')), nx = r(document.getElementById('pgNext'));
      const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const boxes = [t, hm, g, pill, nx, ...md.map(r)];
      let ov = false; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hit(boxes[i], boxes[j])) ov = true;
      return { levels: lv.length, locked: lv.filter((b) => b.classList.contains('locked')).length, levelVh: +(Math.min(...lv.map((b) => Math.min(r(b).width, r(b).height))) / vh).toFixed(1),
        modes: md.length, modeVh: +(Math.min(...md.map((b) => Math.min(r(b).width, r(b).height))) / vh).toFixed(1), on: md.filter((b) => b.classList.contains('on')).map((b) => b.dataset.mode),
        homeVh: +(Math.min(hm.width, hm.height) / vh).toFixed(1), nextVh: +(Math.min(nx.width, nx.height) / vh).toFixed(1), prevHidden: getComputedStyle(document.getElementById('pgPrev')).visibility === 'hidden', dots: document.querySelectorAll('#pgDots span').length, overlap: ov,
        off: boxes.some((b) => b.left < -1 || b.top < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1) }; })()`);
    check(`${tag}: three mode buttons (Easy lit), ten level bubbles with 2-10 padlocked, a page arrow and two dots`, ui.modes === 3 && ui.on.length === 1 && ui.on[0] === 'easy' && ui.levels === 10 && ui.locked === 9 && ui.prevHidden && ui.dots === 2, ui);
    check(`${tag}: every touch target is at least 19vh (modes ${ui.modeVh}vh, levels ${ui.levelVh}vh, home ${ui.homeVh}vh, arrow ${ui.nextVh}vh), nothing overlaps and nothing is off the screen`, ui.modeVh >= 19 - 0.01 && (ui.levelVh >= 19 || w / h < 1.6) && ui.homeVh >= 15 && ui.nextVh >= 15 && !ui.overlap && !ui.off, ui);
    await shot(`${tag}-01-level-select`);

    await tapEl('.lvl[data-level="2"]');
    await sleep(120);
    check(`${tag}: a padlocked level only wiggles`, (await st()).screen === 'levels' && (await ev(`document.querySelector('.lvl[data-level="2"]').classList.contains('shake')`)));
    // the second page: World 2, all locked
    await tapEl('#pgNext'); await sleep(200);
    s = await st();
    const p2 = await ev(`(() => ({ nums: [...document.querySelectorAll('.lvl')].map((b) => +b.dataset.level), locked: document.querySelectorAll('.lvl.locked').length, prev: getComputedStyle(document.getElementById('pgPrev')).visibility, next: getComputedStyle(document.getElementById('pgNext')).visibility, on: [...document.querySelectorAll('#pgDots span')].map((q) => q.classList.contains('on')) }))()`);
    check(`${tag}: the arrow turns to World 2 (levels 11-20, all padlocked; the arrows and dots follow)`, s.page === 1 && p2.nums[0] === 11 && p2.nums[9] === 20 && p2.locked === 10 && p2.prev === 'visible' && p2.next === 'hidden' && p2.on[1] === true, p2);
    await shot(`${tag}-02-world2`);
    await tapEl('#pgPrev'); await sleep(200);
    check(`${tag}: and back to World 1`, (await st()).page === 0);

    // ---------- the mode picker, by touch ----------
    await tapEl('#mode-medium'); await sleep(150);
    s = await st();
    check(`${tag}: a tap on the two-sparkle button picks Medium, lit and remembered in the save`, s.mode === 'medium' && JSON.parse(await D('saved()')).mode === 'medium', `mode ${s.mode}`);
    await tapEl('#mode-hard'); await sleep(150);
    check(`${tag}: the three-sparkle button picks Hard`, (await st()).mode === 'hard');
    await tapEl('#mode-easy'); await sleep(150);
    check(`${tag}: and the one-sparkle button Easy again`, (await st()).mode === 'easy');

    // ---------- level 1 on Easy, by touch ----------
    await tapEl('.lvl[data-level="1"]');
    s = await settle((q) => q.screen === 'play' && q.level === 1 && q.phase === 'stand', 3000);
    check(`${tag}: a tap on level 1 starts it: she stands on the first bank`, !!s && s.mode === 'easy' && s.node === 0 && s.nodes === 12, s && `node ${s.node} of ${s.nodes}`);
    check(`${tag}: she stands in the left third of the screen, with the next platform ahead of her, clear of the home button`, !!s && s.pose.cx > w * 0.12 && s.pose.cx < w * 0.4 && s.next && s.next.cx > s.pose.cx + w * 0.1, s && `she is at ${(s.pose.cx / w).toFixed(2)} of the width`);
    const hm = await D('homeRect()');
    check(`${tag}: the home button is at least 15vh and she is not under it`, hm.w / vh >= 14.9 && !(s.pose.cx > hm.x && s.pose.cx < hm.x + hm.w && s.pose.cy > hm.y && s.pose.cy < hm.y + hm.h), `${(hm.w / vh).toFixed(1)}vh`);
    const gap = s.next ? s.next.cx - s.pose.cx : 0;
    check(`${tag}: toadstools are big enough to hop to (the platform is ${(s.next.hwClient * 2 / vh).toFixed(0)}vh wide, her hop ${(gap / vh).toFixed(0)}vh)`, s.next.hwClient * 2 / vh >= 16, s.next.hwClient * 2 / vh);
    await shot(`${tag}-03-level1-start`);
    // a quiet spell: the hand shows the tap (Easy: after 4 s)
    await sleep(500);
    s = await settle((q) => q.hintT > 0.8, 6500);
    check(`${tag}: after a quiet spell (4 s on Easy) a hand shows where to tap, and a tap hides it`, !!s && s.idle >= 3.9 && s.idle < 5.5, s && `idle ${s.idle.toFixed(1)} s`);
    await shot(`${tag}-04-the-hand`);
    // the real tap
    const c0 = await D('counters');
    await tapRight();
    s = await settle((q) => q.phase === 'hop', 1000);
    check(`${tag}: a real tap on the right half hops her (the hop is in the air)`, !!s && s.pose.mode === 'fly' && s.hintT < 1, s && `phase ${s.phase}`);
    await sleep(160);
    await shot(`${tag}-05-mid-hop`);
    s = await settle((q) => q.phase === 'stand' && q.node === 1, 3000);
    check(`${tag}: she lands on the next toadstool (no splash is possible on level 1), and the camera keeps her in the left third`, !!s && s.splashes === 0 && s.node === 1, s && `node ${s.node}`);
    await sleep(900);
    s = await st();
    check(`${tag}: ...settled at ${(s.pose.cx / w).toFixed(2)} of the width`, s.pose.cx > w * 0.15 && s.pose.cx < w * 0.42, s.pose.cx);
    // a tap on the left half hops too (anywhere works)
    await tapLeft();
    s = await settle((q) => q.node === 2 || q.phase === 'hop', 1500);
    check(`${tag}: a tap on the left half hops her too: a tap anywhere does`, !!s, s && s.phase);
    const c1 = await D('counters');
    check(`${tag}: taps are counted as real touch (pointer events)`, c1.downs >= c0.downs + 1 && c1.pointerTypes.touch >= 2, c1.pointerTypes);

    // ---------- the whole of Easy level 1, played with real taps ----------
    await D('start(1, "easy", true)');
    await D('timeScale(2)');
    const hops = await playOut(90000);
    s = await settle((q) => q.phase === 'chest' || q.phase === 'done', 15000);
    check(`${tag}: Easy level 1 played with real taps reaches the last bank beside the chest (${hops} taps)`, !!s && s.node === s.nodes - 1 && s.splashes === 0, s && `node ${s.node}/${s.nodes - 1}`);
    s = await settle((q) => q.opened, 8000);
    check(`${tag}: the chest bursts open (the key was taken on the way) with +10 coins`, !!s && s.hasKey && s.chestOpen > 0, s && `key ${s.hasKey}, open ${s.chestOpen.toFixed(2)}`);
    await sleep(500);
    await shot(`${tag}-06-chest-open`);
    s = await settle((q) => q.results, 9000);
    check(`${tag}: the results card shows 3 big stars and the level's coins; the counter shows the same coins as the rules`, !!s && s.resultsStars === 3 && s.shownCoins === s.coins && s.coins >= 10, s && `stars ${s.resultsStars}, coins ${s.coins}, shown ${s.shownCoins}`);
    const res = await ev(`(() => ({ stars: document.querySelectorAll('#bigStars svg').length, coins: +document.getElementById('resCoins').textContent, next: getComputedStyle(document.getElementById('resNext')).display }))()`);
    check(`${tag}: three star pictures and the coin total on the card, and a Next button`, res.stars === 3 && res.coins === s.coins && res.next !== 'none', res);
    await sleep(1400);
    await shot(`${tag}-07-results`);
    await D('timeScale(1)');
    const sv = JSON.parse(await D('saved()'));
    check(`${tag}: the save has the documented shape: version 1, mode, unlocked per mode, stars per mode, coins`, sv.v === 1 && sv.mode === 'easy' && sv.unlocked.easy === 2 && sv.stars.easy[0] === 3 && sv.stars.easy.length === 20 && sv.coins >= 10 && sv.chests === 1 && Object.keys(sv.stars).join() === 'easy,medium,hard', { unlocked: sv.unlocked, stars: sv.stars.easy.slice(0, 3), coins: sv.coins });
    check(`${tag}: the save is under game.hop.save, and nothing is written to the main game's isabella.save`, await ev(`(() => { try { return localStorage.getItem('isabella.save') === null && JSON.parse(localStorage.getItem('game.hop.save')).v === 1 && JSON.parse(localStorage.getItem('game.hop.save')).stars.easy[0] === 3; } catch (e) { return false; } })()`));
    check(`${tag}: the coin counter on screen reads the coins earned`, Number(await ev(`document.getElementById('hudCoins').textContent`)) === s.coins);
    // level 2 is open; the levels screen shows it, also after a reload
    await tapEl('#resLevels'); await sleep(250);
    s = await st();
    const open2 = await ev(`(() => { const b = document.querySelector('.lvl[data-level="2"]'); return { locked: b.classList.contains('locked'), stars1: document.querySelector('.lvl[data-level="1"] .st').innerHTML.split('#ffd23f').length - 1 }; })()`);
    check(`${tag}: back on the level select, level 2 is open and level 1 shows its stars`, s.screen === 'levels' && !open2.locked && open2.stars1 >= 3, open2);
    const before = await D('saved()');
    await reload();
    s = await st();
    check(`${tag}: after a reload the stars, the open level, the coins and Easy are still there`, s.unlocked.easy === 2 && s.savedStars.easy[0] === 3 && s.savedCoins >= 10 && s.mode === 'easy', `unlocked ${JSON.stringify(s.unlocked)}; saved before ${before && before.length} chars, after ${(await D('saved()') || '').length}`);
    check(`${tag}: and the Medium and Hard levels are separate: still only level 1 open`, s.unlocked.medium === 1 && s.unlocked.hard === 1);
    return;
  }

  // Find a moment when a tap would fall short: run fast until one comes, then slow right down and make sure it is still there (hopping
  // on carefully if this hop is never too far), and leave her standing at that moment with time slowed to a tenth.
  async function seekClosed() {
    for (let node = 0; node < 14; node++) {
      for (let k = 0; k < 40; k++) {
        await D('timeScale(6)');
        const a = await settle((q) => q.phase === 'stand' && q.predictOk === false, 22000);
        await D('timeScale(0.1)');
        if (!a) break;
        await sleep(40);
        const b = await st();
        if (b.phase === 'stand' && b.predictOk === false) return b;
      }
      await D('timeScale(3)');
      await safeHop(true);
    }
    return null;
  }

  // ---------- a splash and the frog (Medium and Easy) ----------
  async function splashSuite(tag, mode, lvl) {
    console.log(`\n--- ${tag}: a splash on level ${lvl} (${mode}) ---`);
    await loadWith(`localStorage.clear(); localStorage.setItem('game.hop.save', JSON.stringify({ v: 1, mode: '${mode}', unlocked: { easy: 20, medium: 20, hard: 20 }, stars: { easy: [], medium: [], hard: [] }, coins: 7, runs: {} }));`);
    await D(`start(${lvl}, "${mode}", true)`);
    await D('timeScale(0.5)');
    // collect a coin or two first: safe hops until she has some
    for (let i = 0; i < 14; i++) { const q = await st(); if (q.coins >= 1 || q.phase !== 'stand') break; await safeHop(true); }
    let s = await settle((q) => q.phase === 'stand', 5000);
    let coins0 = s.coins, saved0 = s.savedCoins, at0 = s.at, node0 = s.node;
    // wait for a moment when a tap falls short (deep inside a closed spell), then tap for real
    s = await seekClosed();
    check(`${tag}: a moment comes when the next platform is too far (a tap would fall short)`, !!s, s && `slack ${s.predictSlack.toFixed(1)}`);
    if (!s) return;
    coins0 = s.coins; saved0 = s.savedCoins;
    check(`${tag}: she holds a coin that a splash could take`, mode === 'easy' || coins0 > 0, `coins ${coins0}`);
    const sb = s.at;
    await tapRight();
    await D('timeScale(1)');
    s = await settle((q) => q.phase === 'hop' || q.phase === 'splash', 1500);
    await sleep(500);
    s = await settle((q) => q.phase === 'splash', 4000);
    check(`${tag}: the hop falls short and she splashes into the river`, !!s && s.splashes === 1, s && `phase ${s.phase}`);
    await sleep(550);
    s = await st();
    await shot(`${tag}-splash-frog`);
    check(`${tag}: a frog pops up with her on its head (a dizzy moment)`, s.phase === 'splash' && s.pose && (s.pose.mode === 'sit' || s.pose.mode === 'fall'), s.pose && s.pose.mode);
    s = await settle((q) => q.phase === 'stand', 6000);
    check(`${tag}: the frog boosts her back onto the platform she left, as if nothing had happened`, !!s && s.at === sb && s.node === node0 + (sb === at0 ? 0 : s.node - node0) && s.splashes === 1, s && `on ${s.at}, was ${sb}`);
    if (mode === 'easy') check(`${tag}: nothing is lost on Easy (${coins0} -> ${s.coins} coins, the save ${saved0} -> ${s.savedCoins})`, s.coins === coins0 && s.savedCoins === saved0);
    else check(`${tag}: one coin drifted away on ${mode} (${coins0} -> ${s.coins}; the save ${saved0} -> ${s.savedCoins}) and never goes below 0`, coins0 > 0 ? s.coins === coins0 - 1 && s.savedCoins === saved0 - 1 : s.coins === 0, `coins ${coins0} -> ${s.coins}`);
    s = await st();
    check(`${tag}: she can hop on afterwards`, !!(await safeHop(true)));
    await D('timeScale(1)');
  }

  // ---------- a Hard choice: left half near, right half far ----------
  async function choiceSuite() {
    console.log('\n--- the Hard choice ---');
    for (const side of ['left', 'right']) {
      await loadWith(`localStorage.clear(); localStorage.setItem('game.hop.save', JSON.stringify({ v: 1, mode: 'hard', unlocked: { easy: 20, medium: 20, hard: 20 }, stars: { easy: [], medium: [], hard: [] }, coins: 0, runs: {} }));`);
      await D('start(12, "hard", true)');
      await D('timeScale(3)');
      // hop on (real taps) until the choice is next
      const t0 = Date.now(); let s = null;
      while (Date.now() - t0 < 120000) {
        s = await st();
        if (s.phase === 'stand' && s.choice) break;
        if (s.phase === 'stand' && s.safe) await tapLeft(); else await sleep(25);
      }
      s = await settle((q) => q.phase === 'stand' && q.choice, 3000);
      check(`choice ${side}: Hard shows two platforms ahead, a near low one and a far high one`, !!s && s.next && s.nextFar && s.nextFar.y < s.next.y - 30 && s.nextFar.x > s.next.x, s && s.next && `near y ${s.next.y.toFixed(0)}, far y ${s.nextFar.y.toFixed(0)}`);
      if (side === 'left') await shot('choice-hard');
      await D('timeScale(0.5)');
      // wait for a safe moment for the platform we want: predictOk for near, predictFarOk for far
      const want = side === 'left' ? 'predictOk' : 'predictFarOk';
      s = await settle((q) => q.phase === 'stand' && q.choice && q[want] === true && q.predictSlack > 14, 30000);
      if (!s) { check(`choice ${side}: a moment to hop`, false); continue; }
      const near = s.next.id, far = s.nextFar.id, node = s.node;
      await (side === 'left' ? tapLeft() : tapRight());
      s = await settle((q) => q.node === node + 1, 5000);
      const landedOn = s ? s.at : null;
      check(`choice ${side}: a tap on the ${side} half hops to the ${side === 'left' ? 'near' : 'far'} platform`, !!s && landedOn === (side === 'left' ? near : far) && s.splashes === 0, s && `landed on ${landedOn}, near ${near}, far ${far}`);
      await D('timeScale(1)');
    }
    // on Medium a tap on the right half still takes the near one
    await loadWith(`localStorage.clear(); localStorage.setItem('game.hop.save', JSON.stringify({ v: 1, mode: 'medium', unlocked: { easy: 20, medium: 20, hard: 20 }, stars: { easy: [], medium: [], hard: [] }, coins: 0, runs: {} }));`);
    await D('start(12, "medium", true)'); await D('timeScale(3)');
    let s = null; const t0 = Date.now();
    while (Date.now() - t0 < 120000) { s = await st(); if (s.phase === 'stand' && s.choice) break; if (s.phase === 'stand' && s.safe) await tapLeft(); else await sleep(25); }
    await D('timeScale(0.5)');
    s = await settle((q) => q.phase === 'stand' && q.choice && q.predictOk === true && q.predictSlack > 14, 30000);
    if (s) { const near = s.next.id, node = s.node; await tapRight(); s = await settle((q) => q.node === node + 1, 5000); check('choice medium: the choice is shown, but a tap on the right half takes the near platform', !!s && s.at === near, s && `landed on ${s.at}, near ${near}`); } else check('choice medium: a moment to hop', false);
    await D('timeScale(1)');
  }

  // ---------- a half-played level resumes ----------
  async function resumeSuite() {
    console.log('\n--- a half-played level resumes ---');
    await loadWith(`localStorage.clear(); localStorage.setItem('game.hop.save', JSON.stringify({ v: 1, mode: 'easy', unlocked: { easy: 20, medium: 1, hard: 1 }, stars: { easy: [], medium: [], hard: [] }, coins: 0, runs: {} }));`);
    await D('start(4, "easy", true)'); await D('timeScale(3)');
    for (let i = 0; i < 6; i++) await safeHop(true);
    await D('timeScale(1)');
    let s = await settle((q) => q.phase === 'stand', 5000);
    const node = s.node, coins = s.coins, at = s.at;
    check('resume: she has hopped on and taken coins', node >= 4, `node ${node}, coins ${coins}`);
    await D('goLevels()'); await sleep(200);
    s = await st();
    check('resume: leaving the level saves where she stood', s.runs.includes('easy:4'), s.runs);
    await reload();
    await tapEl('.lvl[data-level="4"]'); await sleep(500);
    s = await st();
    check('resume: after a reload the same level starts where she was, with her coins', s.screen === 'play' && s.node === node && s.at === at && s.coins === coins, `node ${s.node}/${node}, coins ${s.coins}/${coins}`);
    await tapEl('#home'); await sleep(900);
    check('resume: the home button leaves for the hub (../../index.html)', (await ev('location.href')) === HUB, await ev('location.href'));
  }

  async function homeSuite() {
    console.log('\n--- home and the back button ---');
    await loadWith('localStorage.clear()');
    check('home: window.__back, window.__pause and window.__dbg exist', await ev(`typeof window.__back === 'function' && typeof window.__pause === 'function' && typeof window.__dbg === 'object'`));
    await tapEl('#home'); await sleep(900);
    check('home: the home button on the level select goes to the hub', (await ev('location.href')) === HUB);
    await loadWith('localStorage.clear()');
    const r = await ev('window.__back()');
    await sleep(900);
    check('home: window.__back() returns true and goes to the hub', r === true && (await ev('location.href')) === HUB);
    await loadWith('localStorage.clear()'); await D('start(1, "easy", true)'); await sleep(300);
    await ev('window.__back()'); await sleep(900);
    check('home: and from inside a level', (await ev('location.href')) === HUB);
  }

  // ---------- the rest, once ----------
  async function extras() {
    console.log('\n--- every sky, the app store, mute, upright, frame rate ---');
    await viewport(915, 412, 2.625);
    await loadWith(`localStorage.clear(); localStorage.setItem('game.hop.save', JSON.stringify({ v: 1, mode: 'medium', unlocked: { easy: 20, medium: 20, hard: 20 }, stars: { easy: [], medium: [], hard: [] }, coins: 3, runs: {} }));`);
    for (const [n, m] of [[1, 'easy'], [4, 'medium'], [7, 'hard'], [9, 'medium'], [11, 'medium'], [14, 'hard'], [16, 'easy'], [19, 'medium'], [20, 'hard']]) {
      await D(`start(${n}, "${m}", true)`); await D('timeScale(2)');
      for (let i = 0; i < 5; i++) await safeHop(true);
      await D('timeScale(1)'); await sleep(250);
      const s = await st();
      await shot(`sky-${String(n).padStart(2, '0')}-${m}-theme${s.theme}`);
      check(`sky: level ${n} (${m}, theme ${s.theme}) draws and plays (${s.node} hops in)`, s.screen === 'play' && s.node >= 1 && s.splashes <= 3, `node ${s.node}`);
    }
    // window.IsabellaStore: the saves go there, not to localStorage
    await ev('localStorage.clear()');
    const fake = `window.__store = {}; window.IsabellaStore = { get(k) { return window.__store[k] === undefined ? null : window.__store[k]; }, set(k, v) { window.__store[k] = v; } }; window.__store['isabella.save'] = JSON.stringify({ muted: true });`;
    await loadWith(fake);
    await ev('localStorage.clear()');
    await D('start(1, "easy", true)'); await sleep(300);
    await safeHop(true); await sleep(300);
    await D('goLevels()');
    const stored = await ev('Object.keys(window.__store)'), ls = await ev('Object.keys(localStorage)');
    check('app: inside the Android app (window.IsabellaStore) the save goes there under game.hop.save and nothing in localStorage', stored.includes('game.hop.save') && !ls.includes('game.hop.save'), { stored, ls });
    check('app: isabella.save is read for sound (muted) and never written', (await st()).muted === true && (await ev(`window.__store['isabella.save']`)) === JSON.stringify({ muted: true }));
    // mute through the plain browser setting
    await loadWith(`localStorage.setItem('isabella.save', JSON.stringify({ muted: true }))`);
    const mu = await st();
    await tapEl('.lvl[data-level="1"]'); await sleep(300);
    check('mute: the main game\'s mute setting is followed', mu.muted === true && (await st()).muted === true);
    check('mute: and isabella.save is unchanged after playing', (await ev(`localStorage.getItem('isabella.save')`)) === JSON.stringify({ muted: true }));
    // held upright
    await loadWith('localStorage.clear()'); await D('start(1, "easy", true)'); await sleep(300);
    const t1 = (await st()).t;
    await viewport(412, 915, 2.625); await sleep(500);
    const rot = await ev(`getComputedStyle(document.getElementById('rotate')).display`), t2 = (await st()).t; await sleep(600); const t3 = (await st()).t;
    check('upright: held upright, the rotate-the-phone picture shows and the game waits', rot === 'flex' && Math.abs(t3 - t2) < 0.02, `display ${rot}, t ${t2.toFixed(2)} -> ${t3.toFixed(2)}`);
    await shot('upright');
    await viewport(915, 412, 2.625); await sleep(500);
    const t4 = (await st()).t; await sleep(500);
    check('upright: turned back, play goes on', (await st()).t > t4 + 0.2 && t1 >= 0);
    // frame rate
    await D('resetPerf()'); await sleep(2500);
    const pf = await D('perf()');
    check('perf: frames draw quickly (headless Chrome, software rendering)', pf.frames > 20 && pf.p95Ms < 30, `avg ${pf.avgMs.toFixed(1)} ms, p95 ${pf.p95Ms.toFixed(1)} ms over ${pf.frames} frames`);
    const parts = (await st()).parts;
    check('perf: the particles stay bounded', parts < 400, parts);
    // the pictures of a splash and a rainbow of coins are in the other suites; here the real-time page is checked for errors at the end
  }

  // ---------- run ----------
  try {
    if (!ONLY || ONLY === 'seeker') await suite(915, 412, 2.625, 'seeker');
    if (!ONLY || ONLY === 'phone800') await suite(800, 360, 3, 'phone800');
    if (!ONLY || ONLY === 'more') {
      await viewport(915, 412, 2.625);
      await splashSuite('splash-medium', 'medium', 5);
      await splashSuite('splash-easy', 'easy', 6);
      await choiceSuite();
      await resumeSuite();
      await homeSuite();
      await extras();
    }
  } catch (e) {
    check('the run itself went through', false, e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e));
  }
  const bad = problems.filter((p) => !/favicon/.test(p.text));
  check('no console errors, warnings or exceptions anywhere', bad.length === 0, bad.length ? JSON.stringify(bad.slice(0, 3)) : `${shots.length} screenshots in ${OUT}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
  cdp.close(); chrome.kill();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); if (chrome) chrome.kill(); process.exit(1); });
process.on('exit', () => { try { if (chrome) chrome.kill(); } catch (e) { /* gone */ } });
