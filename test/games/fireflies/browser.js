// Firefly Numbers in headless Chrome, driven like fingers: real touch through the DevTools protocol.
//   node test/games/fireflies/browser.js [screenshotDir] [chromeProfileDir] [--only=seeker|phone800|ipad]
//   (defaults: <repo>/.local/fireflies-shots and <repo>/.local/chrome-fireflies; DevTools port 9494, its own throwaway profile)
//   FIREFLIES_WEB=<dir> runs it against another copy of the web folder (defects.js does this).
// Runs three times, each with a fresh save: 915x412 at DPR 2.625 (the Seeker), 800x360 at DPR 3 (a 20:9 phone) and, shorter,
// 1024x768 (an iPad). On each phone size:
//   the menu (mode picker by touch, both pages of levels, padlocks) -> Easy level 1 played to its chest by real taps (every
//   tap counted, dots lit, cork, flower, coin, next jar, chest, 3 stars, the save) -> an overfill hiccup -> the hint hand
//   -> a Hard adding round and a sum of three -> a take-away round (outside fireflies only shake, the jar lets fireflies out,
//   never below the answer) -> every one of the 60 levels opened and checked mid-play -> the save, muted untouched, a reload,
//   held upright, home and window.__back.
// Exits 1 on any failed check or any console error, warning or exception.
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const WEB = path.resolve(process.env.FIREFLIES_WEB || path.join(ROOT, 'web'));
const PAGE = 'file://' + path.join(WEB, 'games/fireflies/index.html');
const HUB = 'file://' + path.join(WEB, 'index.html');
const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OUT = path.resolve(pos[0] || path.join(ROOT, '.local/fireflies-shots'));
const PROFILE = path.resolve(pos[1] || path.join(ROOT, '.local/chrome-fireflies'));
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const PORT = 9494;
const ZONE = 52, CHEST_COINS = 5;

const results = [], problems = [];
let chrome = null;   // killed on every exit path so the port is never left busy
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail != null && detail !== '' ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
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
  async function go(url, label) {
    where = label;
    const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url }); await loaded;
    // a load event left over from the page being left must not count: wait until the page asked for is the one that is ready
    await waitFor(async () => { try { return (await ev('location.href')) === url && (await ev('document.readyState')) === 'complete'; } catch (e) { return false; } }, 8000, 50);
    await sleep(400);
  }
  async function reload() { const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.reload', { ignoreCache: true }); await loaded; await sleep(400); }
  // Open the game with storage set up by `js`. It runs as the new page starts, AFTER the old page has gone:
  // a page writes its save as it closes (pagehide), so storage changed while it is open would be overwritten.
  async function loadWith(js) {
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { ${js} } catch (e) {} })();` });
    await go(PAGE, 'fireflies');
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  async function shot(name) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: HT, scale: 1200 / (W * DPR) } });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  }
  async function waitFor(fn, ms, every) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(every || 60); }
    return null;
  }
  const settle = (pred, ms) => waitFor(async () => { const s = await st(); return pred(s) ? s : null; }, ms || 12000, 80);
  async function touchTap(x, y) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function tapEl(sel) {
    const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await touchTap(r.x, r.y);
  }
  // a firefly a finger can reach: free, grown, on screen
  const freeFly = (s) => s.flies.filter((f) => !f.busy && f.age > 0.8 && f.cx > f.cr * 0.6 && f.cx < W - f.cr * 0.6 && f.cy > f.cr * 0.4 && f.cy < HT - f.cr * 0.3);
  async function tapFlyReal() {
    let s = await st(), f = freeFly(s)[0];
    for (let i = 0; !f && i < 25; i++) { await sleep(80); s = await st(); f = freeFly(s)[0]; }
    if (!f) return null;
    await touchTap(f.cx, f.cy);
    return f.id;
  }
  async function oneFly() {   // a firefly that can be tapped, waiting for the fading-in ones to grow
    let s = await st(), f = freeFly(s)[0];
    for (let i = 0; !f && i < 25; i++) { await sleep(80); s = await st(); f = freeFly(s)[0]; }
    return f;
  }
  async function tapJarReal() { const s = await st(); await touchTap(s.jar.cx, s.jar.cy); return s; }
  const quiet = (s) => s.shown === s.inJar && s.flights.length === 0;
  const lit = (s) => s.litDots;

  // Fill the current jar with real taps; returns what was seen after each tap
  async function fillJar(log) {
    let s = await st();
    const target = s.target, seen = [];
    for (let guard = 0; s.inJar < target && guard < 60; guard++) {
      const before = s.inJar, id = await tapFlyReal();
      if (id == null) { await sleep(150); s = await st(); continue; }
      s = await settle((q) => q.inJar === before + 1 && q.shown === q.inJar, 4000) || await st();
      seen.push({ inJar: s.inJar, shown: s.shown, lit: lit(s) });
      if (log) log.push(s);
    }
    return { target, seen, state: s };
  }
  // Play whatever is on screen to the results card by real taps (fireflies in fill rounds, the jar in take-aways)
  async function playOut(maxMs) {
    const t0 = Date.now();
    while (Date.now() - t0 < (maxMs || 150000)) {
      const s = await st();
      if (s.screen === 'results') return s;
      if (s.screen !== 'play') return s;
      if (s.phase === 'play' && s.rulesPhase === 'fill' && !s.cel) {
        if (s.roundKind === 't') await touchTap(s.jar.cx, s.jar.cy); else await tapFlyReal();
        await sleep(110);
      } else await sleep(120);
    }
    return st();
  }

  async function suite(w, h, dpr, tag, short) {
    console.log(`\n=== ${w}x${h} @ DPR ${dpr} (${tag}) ===`);
    await viewport(w, h, dpr);
    const SEED_ISA = '{"muted":true,"keep":"me"}';
    await loadWith(`localStorage.clear(); localStorage.setItem('isabella.save', ${JSON.stringify(SEED_ISA)});`);
    await sleep(500);
    let s = await st();

    // ---------- the menu ----------
    check(`${tag}: opens on the menu with a fresh save (Easy, level 1 only, no coins)`, s.screen === 'menu' && s.page === 0 && s.saveMode === 'easy' && ['easy', 'medium', 'hard'].every((m) => s.unlocked[m] === 1) && s.coins === 0, `screen ${s.screen}`);
    check(`${tag}: canvas fills the screen with DPR capped at 2.5, world 540 tall`, s.dpr === 2.5 && s.canvas[0] === Math.round(w * 2.5) && s.canvas[1] === Math.round(h * 2.5), `dpr ${s.dpr}, canvas ${s.canvas}`);
    const ui = await ev(`(() => { const vh = innerHeight / 100, r = (e) => e.getBoundingClientRect(), hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const small = (e) => Math.min(r(e).width, r(e).height) / vh;
      const lv = [...document.querySelectorAll('.lvl')], modes = [...document.querySelectorAll('.mode')], parts = [document.querySelector('.title .t1'), ...modes, document.querySelector('.pill'), document.getElementById('grid'), document.getElementById('home'), document.getElementById('next')];
      let overlap = []; for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (hit(r(parts[i]), r(parts[j]))) overlap.push(i + '/' + j);
      return { n: lv.length, locked: lv.filter((b) => b.classList.contains('locked')).length, levelVh: +Math.min(...lv.map(small)).toFixed(1), modeVh: +Math.min(...modes.map(small)).toFixed(1), homeVh: +small(document.getElementById('home')).toFixed(1),
        arrowVh: +small(document.getElementById('next')).toFixed(1), modesOn: modes.filter((m) => m.classList.contains('on')).map((m) => m.dataset.mode), overlap, off: parts.some((b) => r(b).left < -1 || r(b).top < -1 || r(b).right > innerWidth + 1 || r(b).bottom > innerHeight + 1) }; })()`);
    check(`${tag}: menu: ten levels (9 padlocked), three mode buttons, home and page arrow each at least 19vh, nothing overlapping or off screen`, ui.n === 10 && ui.locked === 9 && ui.levelVh >= 19 && ui.modeVh >= 19 && ui.homeVh >= 19 && ui.arrowVh >= 19 && ui.overlap.length === 0 && !ui.off, ui);
    check(`${tag}: Easy is the mode shown pressed on a fresh save`, JSON.stringify(ui.modesOn) === '["easy"]');
    await shot(`${tag}-01-menu`);

    // the mode picker, by touch
    await tapEl('#mode-medium'); await sleep(150);
    let on = await ev(`[...document.querySelectorAll('.mode.on')].map((m) => m.dataset.mode)`), saved = JSON.parse(await ev(`localStorage.getItem('game.fireflies.save')`));
    check(`${tag}: tapping Medium presses it and remembers it in the save`, JSON.stringify(on) === '["medium"]' && saved.mode === 'medium', { on, mode: saved.mode });
    await tapEl('#mode-hard'); await sleep(150);
    on = await ev(`[...document.querySelectorAll('.mode.on')].map((m) => m.dataset.mode)`); saved = JSON.parse(await ev(`localStorage.getItem('game.fireflies.save')`));
    check(`${tag}: tapping Hard presses it (and only it) and remembers it`, JSON.stringify(on) === '["hard"]' && saved.mode === 'hard');
    await tapEl('#mode-easy'); await sleep(150);
    check(`${tag}: back on Easy`, JSON.stringify(await ev(`[...document.querySelectorAll('.mode.on')].map((m) => m.dataset.mode)`)) === '["easy"]');

    // two pages of levels
    await tapEl('#next'); await sleep(200);
    s = await st();
    const p2 = await ev(`(() => ({ nums: [...document.querySelectorAll('.lvl')].map((b) => +b.dataset.level), locked: [...document.querySelectorAll('.lvl')].filter((b) => b.classList.contains('locked')).length, prevOff: document.getElementById('prev').classList.contains('off'), nextOff: document.getElementById('next').classList.contains('off'), dots: [...document.querySelectorAll('#dots i')].map((d) => d.classList.contains('on')) }))()`);
    check(`${tag}: the second page is World 2: levels 11 to 20, all padlocked, the next arrow gone, page dot 2 lit`, s.page === 1 && JSON.stringify(p2.nums) === JSON.stringify([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]) && p2.locked === 10 && p2.nextOff && !p2.prevOff && JSON.stringify(p2.dots) === '[false,true]', p2);
    await shot(`${tag}-02-menu-world2`);
    await tapEl('.lvl[data-level="11"]'); await sleep(200);
    check(`${tag}: a padlocked level only wiggles (still on the menu)`, (await st()).screen === 'menu' && (await ev(`document.querySelector('.lvl[data-level="11"]').classList.contains('shake')`)));
    await tapEl('#prev'); await sleep(200);
    s = await st();
    check(`${tag}: the back arrow returns to World 1 (levels 1 to 10)`, s.page === 0 && (await ev(`document.querySelectorAll('.lvl[data-level="1"]').length`)) === 1);

    // ---------- Easy level 1, every jar, by real taps ----------
    await tapEl('.lvl[data-level="1"]');
    s = await settle((q) => q.screen === 'play', 4000);
    check(`${tag}: level 1 opens in play`, !!s && s.level === 1 && s.runMode === 'easy' && s.round === 0, s && `screen ${s.screen}`);
    const plan = (await D('levels()'))[0][0];
    const rounds = s.rounds;
    check(`${tag}: Easy 1 has ${plan.jars} jars and ${plan.count} fireflies drifting; each tap zone is at least 19vh across and no two zones overlap`,
      rounds === plan.jars && s.flies.length === plan.count && s.flies.every((f) => (2 * f.cr * DPR) / (HT * DPR) * 100 >= 19) && s.minGap >= 2 * ZONE - 1e-6 && s.sep >= plan.sep - 1e-6,
      { jars: rounds, flies: s.flies.length, zoneVh: +((2 * s.flies[0].cr / HT) * 100).toFixed(1), minGap: +s.minGap.toFixed(1) });
    const txt = await ev(`document.body.innerText.trim()`);
    check(`${tag}: nothing to read on a child's screen in play (no words, no timers)`, txt === '', JSON.stringify(txt));
    const hint0 = await settle((q) => q.hint != null, 3500);
    check(`${tag}: the hint hand points at a firefly before the first tap (a first visit to the level)`, !!hint0 && hint0.hint !== 'jar' && hint0.flies.some((f) => f.id === hint0.hint));
    await shot(`${tag}-03-easy1-start`);
    check(`${tag}: the label on jar 1 shows its number as a numeral and as that many dots`, s.label.numerals.length === 1 && s.label.numerals[0].v === s.target && s.label.dots[0].n === s.target && s.label.total === s.target && s.litDots === 0, s.label);

    const totalsSeen = [], coinsBefore = s.coins;
    let sawCork = false, sawBloom = false, sawCoinFly = false, caughtTaps = 0;
    for (let jar = 0; jar < rounds; jar++) {
      s = await settle((q) => q.screen === 'play' && q.round === jar && !q.jarAnim && q.rulesPhase === 'fill', 8000);
      const target = s.target; totalsSeen.push(target);
      const r = await fillJar();
      caughtTaps += r.target;
      const incs = r.seen.every((q, i) => q.inJar === i + 1 && q.shown === i + 1 && q.lit === i + 1);
      if (jar === 0) {
        await shot(`${tag}-04-easy1-jar1-filled`);
        check(`${tag}: jar 1: each tap adds exactly one: the count, the big numeral and the lit dots all go 1, 2, 3...`, r.seen.length === target && incs, r.seen.map((q) => q.inJar + '/' + q.shown + '/' + q.lit).join(' '));
        check(`${tag}: the hint hand is gone after the first tap`, (await st()).hint == null);
      }
      let sawFull = false;
      const fullState = await settle((q) => q.rulesPhase === 'full' && q.cel, 3000);
      sawFull = !!fullState;
      if (jar === 0) check(`${tag}: jar 1 full: the celebration starts (jar glows) and no more can be added`, sawFull && fullState.inJar === target && fullState.overfills === 0, fullState && { inJar: fullState.inJar });
      const c = await waitFor(async () => { const q = await st(); sawCork = sawCork || (q.cork != null && q.cork > 0.9); sawBloom = sawBloom || q.bloom > 0.9; sawCoinFly = sawCoinFly || q.coinFly; return !q.cel && q.coinsHud >= jar + 1 ? q : null; }, 6000, 50);
      if (jar === 0) check(`${tag}: jar 1: the cork drops in, the flower beside it blooms, a coin flies to the coin row and lands`, sawCork && sawBloom && sawCoinFly && c && c.coinsHud === 1, { sawCork, sawBloom, sawCoinFly, hud: c && c.coinsHud });
      if (jar < rounds - 1) {
        s = await settle((q) => q.round === jar + 1 && !q.jarAnim, 5000);
        if (jar === 0) check(`${tag}: then a fresh empty jar with its own number arrives and the flower goes to the garden`, !!s && s.inJar === 0 && s.shown === 0 && s.litDots === 0 && s.garden >= 1 || (!!s && s.inJar === 0 && s.litDots === 0), s && { garden: s.garden, target: s.target });
      }
    }
    s = await settle((q) => q.win, 6000);
    check(`${tag}: the last jar ends the level: the treasure chest comes`, !!s && s.win && s.done, s && { win: s.win });
    s = await settle((q) => q.chestBurst, 6000);
    await sleep(300); await shot(`${tag}-05-easy1-chest`);
    check(`${tag}: the chest bursts open`, !!s && s.chestBurst);
    s = await settle((q) => q.screen === 'results', 8000);
    await sleep(1400); await shot(`${tag}-06-easy1-results`);
    const bigStars = await ev(`(() => ({ n: document.querySelectorAll('#bigStars svg').length, lit: [...document.querySelectorAll('#bigStars use')].filter((u) => u.getAttribute('fill') === '#ffd23f').length, popped: document.querySelectorAll('#bigStars svg.pop').length, btns: [...document.querySelectorAll('#results button')].map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height) / (innerHeight / 100)) }))()`);
    check(`${tag}: results: three stars, all lit (no overfills), and the buttons are at least 19vh`, !!s && s.resultsStars === 3 && bigStars.n === 3 && bigStars.lit === 3 && bigStars.popped === 3 && bigStars.btns.every((v) => v >= 18.95), bigStars);
    s = await st();
    const sv = JSON.parse(await ev(`localStorage.getItem('game.fireflies.save')`));
    check(`${tag}: the save holds the stars, the next level, the coins (a coin a jar + the chest) and the totals`,
      sv.v === 1 && sv.stars.easy[0] === 3 && sv.unlocked.easy === 2 && sv.unlocked.medium === 1 && sv.coins === coinsBefore + rounds + CHEST_COINS && sv.jars === rounds && sv.chests === 1 && sv.caught === caughtTaps && sv.overfills === 0,
      { stars: sv.stars.easy, unlocked: sv.unlocked, coins: sv.coins, jars: sv.jars, caught: sv.caught });
    check(`${tag}: jars had numbers within Easy 1's 1 to 3`, totalsSeen.every((t) => t >= 1 && t <= 3), totalsSeen);

    // ---------- an overfill: one tap too many ----------
    await tapEl('#resReplay');
    s = await settle((q) => q.screen === 'play' && q.round === 0, 4000);
    check(`${tag}: no hand shows the first tap on a level already won (only after a quiet spell)`, (await st()).hint == null);
    const r1 = await fillJar();
    const fullNow = await st();
    const coinsAtFull = fullNow.coins;
    const id = await tapFlyReal();
    s = await settle((q) => q.overfills === 1, 2000);
    check(`${tag}: a tap after the jar is full is an overfill: counted, nothing added, the jar still holds its number`, !!s && s.overfills === 1 && s.inJar === r1.target && s.stars === 2 && s.flights.includes('over'), s && { overfills: s.overfills, inJar: s.inJar, flights: s.flights });
    const busyAt = await st();
    check(`${tag}: that firefly is out of play while it flies (it cannot be tapped twice)`, busyAt.flies.filter((f) => f.busy).length === 1);
    const hic = await waitFor(async () => { const q = await st(); return q.hic > 0.2 ? q : null; }, 2000, 30);
    check(`${tag}: the jar hiccups`, !!hic);
    s = await settle((q) => q.flights.indexOf('over') < 0 && !q.flies.some((f) => f.busy), 4000);
    check(`${tag}: the firefly flutters back out and rejoins the others (no firefly lost)`, !!s && s.flies.length === plan.count && s.minGap >= 2 * ZONE - 1e-6, s && { flies: s.flies.length });
    const after = await settle((q) => q.round === 1 || q.capped >= 1, 5000);
    check(`${tag}: and nothing else happens: the jar is still capped normally and the next one comes`, !!after && after.overfills === 1 && after.capped >= 1, after && { overfills: after.overfills, capped: after.capped });
    await shot(`${tag}-07-overfill`);
    const fin = await playOut();
    check(`${tag}: the level still finishes, with 2 stars (one overfill)`, fin.screen === 'results' && fin.resultsStars === 2, { screen: fin.screen, stars: fin.resultsStars });
    const sv2 = JSON.parse(await ev(`localStorage.getItem('game.fireflies.save')`));
    check(`${tag}: a worse play never lowers the saved stars (still 3), and the overfill is counted in the totals`, sv2.stars.easy[0] === 3 && sv2.overfills === 1 && sv2.chests === 2, { stars: sv2.stars.easy, overfills: sv2.overfills });

    // ---------- the hint hand after a quiet spell ----------
    await tapEl('#resReplay');
    s = await settle((q) => q.screen === 'play' && q.round === 0, 4000);
    await sleep(2500);
    check(`${tag}: no hand yet after 2.5 s of quiet`, (await st()).hint == null);
    const hint = await settle((q) => q.hint != null, 8500);
    check(`${tag}: after a quiet spell (7 s on Easy) the hint hand points at a firefly`, !!hint && hint.idle >= hint.hintAfter - 0.3 && hint.flies.some((f) => f.id === hint.hint), hint && { idle: +hint.idle.toFixed(1), after: hint.hintAfter });
    await tapFlyReal(); await sleep(150);
    check(`${tag}: a tap sends it away`, (await st()).hint == null);
    if (short) { await D('goMenu()'); return; }

    // ---------- Hard: a sum, a sum of three ----------
    await D('unlock("hard", 20)');
    await D('goMenu()'); await sleep(200);
    await tapEl('#mode-hard'); await sleep(150);
    await D('start("hard", 6, 1)'); await sleep(400);
    s = await st();
    check(`${tag}: Hard 6 jar 2 is a sum: "${s.roundDesc}" shows two numerals with a plus and two rows of dots with a plus`, s.roundKind === 'a' && s.label.numerals.length === 3 && s.label.numerals[1].v === 'plus' && s.label.dots.length === 3 && s.label.dots[1].v === 'plus' && s.label.total === s.target, s.label);
    await shot(`${tag}-08-hard-sum-start`);
    const sumTotal = s.target, seenSum = [];
    for (let i = 0; i < sumTotal; i++) {
      const before = (await st()).inJar, id2 = await tapFlyReal();
      const q = await settle((x) => x.inJar === before + 1 && x.shown === x.inJar, 4000);
      seenSum.push(q ? q.shown + '/' + q.litDots : 'x');
      if (i === 1) await shot(`${tag}-09-hard-sum-mid`);
    }
    check(`${tag}: ${s.roundDesc}: the jar fills to ${sumTotal} one by one, dots lighting across both groups`, seenSum.join(' ') === Array.from({ length: sumTotal }, (_, i) => `${i + 1}/${i + 1}`).join(' '), seenSum.join(' '));
    s = await settle((q) => q.cel && q.rulesPhase === 'full', 3000);
    const cel2 = await settle((q) => !q.cel && q.round === 2 && !q.jarAnim, 7000);
    check(`${tag}: the sum's jar is celebrated and the next jar arrives`, !!s && !!cel2 && cel2.capped === 2 && cel2.overfills === 0, cel2 && { round: cel2.round });
    await D('start("hard", 14, 3)'); await sleep(400);
    s = await st();
    check(`${tag}: Hard 14 jar 4 is a sum of three: "${s.roundDesc}" with two pluses in both rows`, s.roundKind === 'b' && s.label.numerals.length === 5 && s.label.dots.length === 5 && s.label.numerals.filter((t) => t.v === 'plus').length === 2 && s.label.total === s.target, s.label);
    await shot(`${tag}-10-hard-sum3`);

    // ---------- Hard: a take-away ----------
    await D('start("hard", 16, 3)'); await sleep(500);
    s = await st();
    check(`${tag}: Hard 16 jar 4 is a take-away "${s.roundDesc}": the jar starts full, the label has a minus and dots with some crossed`, s.roundKind === 't' && s.inJar === s.total && s.shown === s.total && s.label.numerals[1].v === 'minus' && s.label.dots.length === 1 && s.label.dots[0].crossed > 0 && s.litDots === s.total, { desc: s.roundDesc, inJar: s.inJar, label: s.label.dots });
    await shot(`${tag}-11-takeaway-start`);
    const away = s.label.dots[0].crossed, start = s.inJar, target = s.target;
    const outside = await oneFly();
    await touchTap(outside.cx, outside.cy);
    const shook = await settle((q) => q.flies.some((f) => f.shaking), 1500);
    s = await st();
    check(`${tag}: take-away: tapping a firefly outside only shakes it (the jar keeps ${start}, no overfill)`, !!shook && s.inJar === start && s.overfills === 0 && s.flies.length > 0 && s.rulesPhase === 'fill');
    const seenOut = [];
    for (let i = 0; i < away; i++) {
      await tapJarReal();
      const q = await settle((x) => x.inJar === start - i - 1 && x.shown === x.inJar, 3000);
      seenOut.push(q ? q.inJar + '/' + q.crossedDots : 'x');
      if (i === 0) await shot(`${tag}-12-takeaway-first-out`);
    }
    check(`${tag}: take-away: each tap on the jar lets one out (${start} down to ${target}); the crossed dots dim one by one`, seenOut.join(' ') === Array.from({ length: away }, (_, i) => `${start - i - 1}/${i + 1}`).join(' '), seenOut.join(' '));
    s = await settle((q) => q.cel && q.rulesPhase === 'full', 3000);
    check(`${tag}: take-away: at ${target} the jar is done and celebrated`, !!s && s.inJar === target && s.overfills === 0);
    await tapJarReal();
    s = await settle((q) => q.overfills === 1, 1500);
    check(`${tag}: take-away: one more tap on the jar is a hiccup and the jar never goes below ${target}`, !!s && s.inJar === target && s.shown >= target && s.overfills === 1, s && { inJar: s.inJar, flights: s.flights });
    s = await settle((q) => !q.cel && q.round === 4 && !q.jarAnim, 7000);
    check(`${tag}: take-away: the next jar arrives, the coin is in the row`, !!s && s.coinsHud >= 4, s && { hud: s.coinsHud, round: s.round });

    // ---------- all sixty levels open and play ----------
    const bad = [];
    for (const m of ['easy', 'medium', 'hard']) {
      for (let n = 1; n <= 20; n++) {
        await D(`start("${m}", ${n})`);
        await sleep(120);
        const q = await st(), p = (await D('levels()'))[['easy', 'medium', 'hard'].indexOf(m)][n - 1];
        const okFlies = q.flies.length === q.swarmWant && q.swarmWant <= p.count && q.swarmWant >= 8 && q.flies.every((f) => f.cx > 0 && f.cx < W && f.cy > 0 && f.cy < HT);
        const okLabel = q.label && q.label.total === q.total && q.rounds === p.jars && q.screen === 'play' && q.runMode === m && q.level === n;
        if (!okFlies || !okLabel) bad.push(`${m} ${n}: flies ${q.flies.length}/${p.count} label ${okLabel}`);
        if ((n === 1 || n === 10 || n === 11 || n === 20) && m !== 'medium') await shot(`${tag}-lv-${m}-${n}`);
      }
    }
    check(`${tag}: all 60 levels open: the right number of fireflies on screen, the label's dots equal its total, no errors`, bad.length === 0, bad.slice(0, 4));
    await sleep(300);

    // ---------- the save, mute, reload, home ----------
    const isa = await ev(`localStorage.getItem('isabella.save')`);
    check(`${tag}: the game never writes isabella.save (mute and the rest are only read)`, isa === SEED_ISA, isa);
    s = await st();
    check(`${tag}: sound follows the main game's mute setting`, s.muted === true);
    const raw = await ev(`localStorage.getItem('game.fireflies.save')`), sv3 = JSON.parse(raw);
    check(`${tag}: the save is under game.fireflies.save with the common frame's shape`, sv3.v === 1 && ['easy', 'medium', 'hard'].includes(sv3.mode) && ['easy', 'medium', 'hard'].every((m) => Number.isInteger(sv3.unlocked[m]) && Array.isArray(sv3.stars[m])) && typeof sv3.coins === 'number', Object.keys(sv3).join(','));
    await D('goMenu()'); await sleep(700);
    const before = await ev(`localStorage.getItem('game.fireflies.save')`);
    await reload();
    await waitFor(async () => { try { return (await ev('document.readyState')) === 'complete' && (await ev('typeof window.__dbg')) === 'object'; } catch (e) { return false; } }, 5000, 50);
    s = await st();
    if (s.unlocked.easy !== 2) console.log('  (the save before the reload: ' + before + '; after: ' + (await ev(`localStorage.getItem('game.fireflies.save')`)) + ')');
    check(`${tag}: after a reload the progress is still there (Easy level 2 open, level 1 with three stars)`, s.unlocked.easy === 2 && s.unlocked.hard === 20 && s.savedStars.easy[0] === 3 && s.screen === 'menu', { unlocked: s.unlocked });
    await viewport(h, w, dpr); await sleep(400);
    const rot = await ev(`(() => ({ rotate: getComputedStyle(document.getElementById('rotate')).display, upright: window.__dbg.state().upright }))()`);
    check(`${tag}: held upright, the turn-your-phone picture covers the game`, rot.rotate === 'flex' && rot.upright === true, rot);
    await viewport(w, h, dpr); await sleep(400);
    check(`${tag}: and it goes away when the phone is turned back`, (await ev(`getComputedStyle(document.getElementById('rotate')).display`)) === 'none');
    await tapEl('#home');
    await waitFor(async () => (await ev('location.href')) === HUB, 5000);
    check(`${tag}: the home button goes to the hub (../../index.html)`, (await ev('location.href')) === HUB, await ev('location.href'));
    await go(PAGE, 'fireflies'); await sleep(300);
    const back = await ev(`(() => { const r = window.__back(); return [r, typeof window.__pause]; })()`);
    await waitFor(async () => (await ev('location.href')) === HUB, 5000);
    check(`${tag}: window.__back() returns true and goes to the hub; window.__pause exists`, back[0] === true && back[1] === 'function' && (await ev('location.href')) === HUB);
    await go(PAGE, 'fireflies');
    const perf = await D('perf()');
    check(`${tag}: frames stay cheap (average under 12 ms to draw and step)`, perf.frames < 5 || perf.avgMs < 12, { avgMs: +perf.avgMs.toFixed(2), p95Ms: +perf.p95Ms.toFixed(2) });
  }

  // an iPad-shaped screen, shorter: the menu fits and a level plays
  async function ipadSuite() {
    const w = 1024, h = 768, dpr = 2, tag = 'ipad';
    console.log(`\n=== ${w}x${h} @ DPR ${dpr} (${tag}) ===`);
    await viewport(w, h, dpr);
    await loadWith('localStorage.clear();');
    await sleep(500);
    const ui = await ev(`(() => { const vh = innerHeight / 100, r = (e) => e.getBoundingClientRect(), hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const small = (e) => Math.min(r(e).width, r(e).height) / vh;
      const lv = [...document.querySelectorAll('.lvl')], modes = [...document.querySelectorAll('.mode')], parts = [document.querySelector('.title .t1'), ...modes, document.querySelector('.pill'), document.getElementById('grid'), document.getElementById('home'), document.getElementById('next')];
      let overlap = []; for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) if (hit(r(parts[i]), r(parts[j]))) overlap.push(i + '/' + j);
      return { levelVh: +Math.min(...lv.map(small)).toFixed(1), modeVh: +Math.min(...modes.map(small)).toFixed(1), arrowVh: +small(document.getElementById('next')).toFixed(1), overlap, off: parts.some((b) => r(b).left < -1 || r(b).top < -1 || r(b).right > innerWidth + 1 || r(b).bottom > innerHeight + 1) }; })()`);
    check(`${tag}: the menu fits a squarer screen: levels, modes and arrow at least 19vh, nothing overlapping or off screen`, ui.levelVh >= 19 && ui.modeVh >= 19 && ui.arrowVh >= 19 && ui.overlap.length === 0 && !ui.off, ui);
    await shot(`${tag}-01-menu`);
    await tapEl('.lvl[data-level="1"]');
    let s = await settle((q) => q.screen === 'play', 4000);
    check(`${tag}: a level opens; every firefly's tap zone is at least 19vh, zones never overlap, fewer fireflies fit`, !!s && s.flies.length >= 5 && s.flies.length <= 8 && s.flies.every((f) => (2 * f.cr / h) * 100 >= 19) && s.minGap >= 2 * ZONE - 1e-6, s && { flies: s.flies.length });
    await sleep(600); await shot(`${tag}-02-play`);
    W = w; HT = h;
    const r = await fillJar();
    check(`${tag}: a jar fills by touch`, r.state.inJar === r.target && r.state.rulesPhase === 'full', { target: r.target });
    const aud = (await st()).audio;
    check(`${tag}: sound is on (unmuted): the audio context exists after real taps, and playing the notes raised no error`, aud === 'running' || aud === 'suspended', aud);
  }

  const runs = [['seeker', 915, 412, 2.625, false], ['phone800', 800, 360, 3, false]].filter((r) => !ONLY || ONLY === r[0] || (ONLY === 'ipad' && false));
  for (const [tag, w, h, dpr, short] of runs) await suite(w, h, dpr, tag, short);
  if (!ONLY || ONLY === 'ipad') await ipadSuite();

  const prob = problems.filter((p) => p.where === 'fireflies');
  console.log(`\nconsole problems on the game: ${prob.length}`);
  for (const p of prob.slice(0, 8)) console.log(`  ${p.kind}: ${p.text}`);
  check('no console errors, warnings or exceptions in the game', prob.length === 0);
  const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
  console.log(`\n${pass} passed, ${fail} failed`);
  cdp.close(); cdp.proc.kill();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('browser test crashed:', e); if (chrome) chrome.kill(); process.exit(2); });
