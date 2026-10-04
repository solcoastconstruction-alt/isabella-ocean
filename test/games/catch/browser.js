// Sea Catch in headless Chrome, driven like a finger: real touch drags through the DevTools protocol.
//   node test/games/catch/browser.js [screenshotDir] [chromeProfileDir] [--only=seeker|phone800|more]
//   (defaults: <repo>/.local/shots and <repo>/.local/chrome-catch; DevTools port 9483, its own throwaway profile)
//   CATCH_WEB=<dir> runs it against another copy of the web folder (to prove the checks catch an injected defect).
// Runs twice, each with a fresh save: 915x412 at DPR 2.625 (the Seeker) and 800x360 at DPR 3 (a 20:9 phone).
//   level select -> level 1 by touch -> the hand shows the slide -> a finger anywhere moves her, and she eases ->
//   real drags catch friends, ten make a coin -> a missed friend costs nothing -> level 3: a grump caught by a real
//   drag costs a coin (never below 0), a dodged grump costs nothing, the golden friend is a whole coin -> level 1
//   played to its chest -> results and stars -> level 2 unlocked, still unlocked after a reload -> home and back.
// Once, at the Seeker size: every level mid-play (screenshots), the picture sheet of every friend and grump,
// counting order, window.IsabellaStore, mute, held upright, frame rate.
// Exits 1 on any failed check or any console error, warning or exception.
'use strict';
const fs = require('fs'), path = require('path');
const { launch, sleep } = require('./cdp');
const { plan } = require('./models');

const ROOT = path.resolve(__dirname, '../../..');
const WEB = path.resolve(process.env.CATCH_WEB || path.join(ROOT, 'web'));
const PAGE = 'file://' + path.join(WEB, 'games/catch/index.html');
const HUB = 'file://' + path.join(WEB, 'index.html');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const OUT = path.resolve(args[0] || path.join(ROOT, '.local/shots'));
const PROFILE = path.resolve(args[1] || path.join(ROOT, '.local/chrome-catch'));
const PORT = 9483;
const L = require(path.join(WEB, 'games/catch/logic.js'));
// a seed whose first 50 seconds of level 1 hold no golden friend (so "ten caught make a coin" is exactly ten)
function plainSeed(vw) { for (let seed = 100; ; seed++) if (!plan(L, 1, vw, seed, 50).items.some((it) => it.gold)) return seed; }

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
  const D = (expr) => ev(`window.__catchDebug.${expr}`);
  const st = () => D('state()');
  async function go(url, label) { where = label; const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url }); await loaded; await sleep(400); }
  async function reload() { const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.reload', { ignoreCache: true }); await loaded; await sleep(400); }
  // Open the game with storage set up by `js`. It runs as the new page starts, AFTER the old page has gone:
  // a page writes its save as it closes (pagehide), so storage changed while it is open would be overwritten.
  async function loadWith(js) {
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { try { ${js} } catch (e) {} })();` });
    await go(PAGE, 'catch');
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
  // ---- one real finger ----
  const pt = (x, y) => ({ x, y, id: 1, radiusX: 10, radiusY: 10, force: 1 });
  const finger = { down: false, x: 0, y: 0 };
  async function fingerDown(x, y) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(x, y)] }); finger.down = true; finger.x = x; finger.y = y; }
  async function fingerMove(x, y, steps) {
    const x0 = finger.x, y0 = finger.y, n = steps || 8;
    for (let i = 1; i <= n; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(x0 + ((x - x0) * i) / n, y0 + ((y - y0) * i) / n)] }); await sleep(16); }
    finger.x = x; finger.y = y;
  }
  async function fingerUp() { if (finger.down) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); finger.down = false; }
  async function touchTap(x, y) { await fingerDown(x, y); await fingerUp(); }
  async function tapEl(sel) {
    const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await touchTap(r.x, r.y);
  }
  // Slide the finger so the shell is under thing `id` when it comes down, and keep it there until the thing has
  // been caught, has bonked, or has gone past. o.dx: aim this many screen pixels to the side. o.then: called once
  // the finger is in place. Returns the state straight after.
  async function slideUnder(id, o) {
    o = o || {};
    let s = await st(), it = s.items.find((q) => q.id === id);
    if (!it) return s;
    const y = o.y || HT * 0.62;
    if (!finger.down) await fingerDown(s.pxClient, y);
    await fingerMove(it.xcClient + (o.dx || 0), y, 10);
    if (o.then) await o.then();
    for (let i = 0; i < 600; i++) {
      s = await st(); it = s.items.find((q) => q.id === id);
      if (!it || it.past) break;
      await sleep(20);
    }
    return s;
  }
  // the next friend worth going for: the lowest one that still has a second and a half to fall (time to get there)
  const nextFriend = (s) => s.items.filter((q) => !q.grumpy && !q.gold && !q.past && !q.hidden && q.tc - s.t > 1.5).sort((a, b) => a.tc - b.tc)[0];
  // real play for a while: the finger goes under the lowest friend that has no grump landing beside it
  async function autoPlay(ms) {
    const t0 = Date.now(), y = HT * 0.62;
    while (Date.now() - t0 < ms) {
      const s = await st();
      if (s.screen !== 'play' || s.phase !== 'play') break;
      if (!finger.down) await fingerDown(s.pxClient, y);
      const grumps = s.items.filter((q) => q.grumpy && !q.past);
      const f = s.items.filter((q) => !q.grumpy && !q.past && q.cy < s.catchYClient + 10).sort((a, b) => b.cy - a.cy)
        .find((q) => !grumps.some((g) => Math.abs(g.xcClient - q.xcClient) < 95 && Math.abs(g.tc - q.tc) < 0.9));
      let x = f ? f.xcClient : finger.x;
      const near = grumps.find((g) => Math.abs(g.xcClient - x) < 80 && g.cy > s.catchYClient - 150);
      if (near && !f) x = near.xcClient + (x >= near.xcClient ? 100 : -100);
      await fingerMove(Math.max(8, Math.min(W - 8, x)), y, 3);
      await sleep(30);
    }
  }
  // catches through the hook: the same rule code as a real catch
  async function hookCatch(n, gapMs, gold) {
    const s = await st(), kinds = (await D('levels()'))[s.level - 1].kinds.map((k) => k[0]);
    for (let i = 0; i < n; i++) {
      const id = await D(`spawn({ kind: '${kinds[i % kinds.length]}', x: ${s.VW * (0.3 + 0.4 * Math.random())}, y: 120, gold: ${!!gold}, grown: true })`);
      const t = await D(`catchItem(${id})`);
      if (t !== 'catch' && t !== 'gold' && t !== 'ignored') throw new Error('hook catch gave ' + t);
      if (gapMs) await sleep(gapMs);
    }
  }
  const settle = (pred, ms) => waitFor(async () => { const s = await st(); return pred(s) ? s : null; }, ms || 12000, 120);
  const quiet = (s) => s.friends === 0 && s.flyCoins === 0 && s.owed === 0 && s.trayShown === s.tray && s.hudCoins === s.coins;
  const place = (o) => D(`spawn(${JSON.stringify(Object.assign({ grown: true }, o))})`);

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
    check(`${tag}: ten numbered level bubbles, 2-10 padlocked, each at least 19vh, nothing overlapping or off the screen`, ui.n === 10 && ui.locked === 9 && ui.levelVh >= 19 && ui.homeVh >= 19 && !ui.overlap && !ui.off, ui);
    await shot(`${tag}-01-level-select`);

    await tapEl('.lvl[data-level="2"]');
    await sleep(120);
    check(`${tag}: a padlocked level only wiggles`, (await st()).screen === 'levels' && (await ev(`document.querySelector('.lvl[data-level="2"]').classList.contains('shake')`)));

    // ---------- level 1 by touch ----------
    await tapEl('.lvl[data-level="1"]');
    s = await settle((q) => q.screen === 'play' && q.level === 1 && q.items.length > 0, 3000);
    check(`${tag}: a tap on level 1 starts it, with a friend already on its way down`, !!s && s.items.length >= 1 && s.items.every((q) => !q.grumpy), s && `level ${s.level}, ${s.items.length} falling`);
    await D(`start(1, true, ${plainSeed(s.VW)})`);   // the same level again, from a known seed
    s = await settle((q) => q.hint != null, 9000);
    await sleep(900);
    check(`${tag}: before the first catch, a hand shows the finger sliding along under a falling friend`, !!s && s.hint != null && s.items.some((q) => q.id === s.hint && !q.grumpy), s && `hint for thing ${s.hint}`);
    await shot(`${tag}-02-level1-the-hand-shows-the-slide`);
    s = await st();
    const sizes = { bubbleVh: +(Math.min(...s.items.map((q) => q.cr * 2)) / h * 100).toFixed(1) };
    const hud = await D('hud()'), tray = await D('trayPlaces()'), homeR = await ev(`(() => { const r = document.getElementById('home').getBoundingClientRect(); return { r: r.right, b: r.bottom }; })()`);
    check(`${tag}: a friend's bubble is at least 18vh across; the coin row and the ten tray places are on the screen, clear of the home button`,
      sizes.bubbleVh >= 18 && hud.length === 2 && hud.every((c) => c.cx > homeR.r + 10 && c.cx < w - 10 && c.cy > 4 && c.cy < h * 0.25)
      && tray.length === 10 && tray.every((c) => c.cx > 12 && c.cx < w - 12 && c.cnum < h - 4) && tray[9].cx - tray[0].cx > w * 0.4,
      `bubble ${sizes.bubbleVh}vh, coin rings at x ${hud.map((c) => c.cx.toFixed(0)).join(',')}, tray x ${tray[0].cx.toFixed(0)}..${tray[9].cx.toFixed(0)}`);

    // ---------- the finger: anywhere on the screen, only its x matters, and she eases toward it ----------
    await D('pause(true)'); await D('clear()');
    const c0 = await D('counters');
    s = await st();
    const start = s.pxClient, farX = w - 60;
    await fingerDown(farX, h * 0.2);   // near the top of the screen, far from her
    await sleep(70);
    const s1 = await st();
    const s2 = await settle((q) => Math.abs(q.pxClient - farX) < 3, 2500);
    check(`${tag}: a finger near the top of the screen calls her over: she swims toward its x (she is never touched)`, !!s2 && s2.fingerDown, s2 ? `shell at ${s2.pxClient.toFixed(0)}, finger at ${farX}` : `shell at ${(await st()).pxClient.toFixed(0)}`);
    check(`${tag}: ...easing, not jumping: 70 ms after the touch she has moved, but is not there yet`, s1.pxClient > start + 2 && s1.pxClient < start + (farX - start) * 0.7, `${start.toFixed(0)} -> ${s1.pxClient.toFixed(0)} -> ${s2 ? s2.pxClient.toFixed(0) : '?'}`);
    await fingerMove(farX, h - 14, 6);   // straight down: x has not changed
    await sleep(250);
    s = await st();
    check(`${tag}: sliding the finger straight down moves nothing: only its x matters`, Math.abs(s.pxClient - farX) < 3, `shell at ${s.pxClient.toFixed(0)}`);
    await fingerMove(170, h - 14, 14);   // along the very bottom, over the tray
    const s3 = await settle((q) => Math.abs(q.pxClient - 170) < 3, 2500);
    check(`${tag}: a drag along the bottom edge brings her back across`, !!s3 && s3.face < 0, s3 ? `shell at ${s3.pxClient.toFixed(0)}, facing ${s3.face < 0 ? 'left' : 'right'}` : 'never arrived');
    await fingerMove(2, h * 0.5, 6);
    await sleep(900);
    s = await st();
    check(`${tag}: at the edge of the screen she stops with her shell still on it`, Math.abs(s.px - s.pxMin) < 1 && s.pxClient > 30, `shell at ${s.pxClient.toFixed(0)} px`);
    await fingerMove(w / 2, h * 0.5, 10);
    await sleep(150);
    await fingerUp();
    const s4 = await settle((q) => Math.abs(q.pxClient - w / 2) < 3, 2500);
    await sleep(400);
    s = await st();
    const c1 = await D('counters');
    check(`${tag}: with the finger lifted she carries on to where it was, and waits there`, !!s4 && !s.fingerDown && Math.abs(s.pxClient - w / 2) < 3, `shell at ${s.pxClient.toFixed(0)}`);
    check(`${tag}: the drags arrived as touch pointers`, (c1.pointerTypes.touch || 0) - (c0.pointerTypes.touch || 0) >= 1 && c1.moves - c0.moves >= 30 && !c1.pointerTypes.mouse, JSON.stringify(c1.pointerTypes) + `, ${c1.moves - c0.moves} moves`);
    await D('pause(false)');

    // ---------- real touch: the friends that fall by themselves, caught by sliding under them ----------
    let caught = 0, tries = 0;
    const lost = [];
    while (caught < 3 && tries < 12) {
      tries++;
      const f = await waitFor(async () => nextFriend(await st()), 8000, 100);
      if (!f) break;
      const before = await st();
      const after = await slideUnder(f.id, { then: caught === 0 ? () => shot(`${tag}-03-sliding-under-a-friend`) : null });
      if (after.catches + after.golds === before.catches + before.golds + 1) caught++; else lost.push(f.kind);
      if (caught === 1 && !lost.length) { await sleep(120); await shot(`${tag}-04-caught-in-the-shell`); }
    }
    s = await st();
    check(`${tag}: 3 friends falling by themselves are caught by real drags, and the tray counts them`, caught === 3 && lost.length === 0 && s.catches * 1 + s.golds * 10 === s.coins * 10 + s.tray, `caught ${caught} in ${tries} tries; tray ${s.tray}, coins ${s.coins}`);
    check(`${tag}: once she has caught one, the hand is gone`, s.hint == null);
    // the rest of the ten: placed by hand (so the test is quick), still caught by real drags
    await D('pause(true)'); await D('clear()');
    await settle(quiet, 6000);
    let placed = 0, coinShot = false;
    for (let i = 0; i < 20 && (await st()).coins < 1; i++) {
      s = await st();
      const x = s.VW * (i % 2 ? 0.28 : 0.72) + (Math.random() - 0.5) * 120;
      const id = await place({ kind: i % 2 ? 'fish' : 'turtle', x, y: 150 });
      const after = await slideUnder(id);
      if (after.catches === s.catches + 1) placed++;
      if (after.coins === 1 && !coinShot) {
        const fly = await waitFor(async () => { const q = await st(); return q.flyCoins > 0 ? q : null; }, 5000, 40);
        if (fly) { await sleep(280); await shot(`${tag}-05-ten-make-a-coin`); coinShot = true; }
      }
    }
    await fingerUp();
    s = await settle((q) => quiet(q) && q.hudCoins === 1, 8000);
    const log = (await D('counters')).countLog.map((e) => e[0]);
    check(`${tag}: ten caught make a gold coin, the tray starts again, and the coin lands in its ring`, !!s && s.coins === 1 && s.tray === 0 && s.catches === 10 && coinShot, s ? `coins ${s.coins}, tray ${s.tray}, ${placed} placed friends caught` : 'never settled');
    check(`${tag}: the tray counted them 1 to 10 in order`, log.slice(-10).join() === '1,2,3,4,5,6,7,8,9,10', log.join(','));

    // ---------- a missed friend costs nothing ----------
    s = await st();
    const before = { coins: s.coins, tray: s.tray, catches: s.catches, misses: s.misses, bonks: s.bonks };
    const missId = await place({ kind: 'starfish', x: s.px > s.VW / 2 ? 160 : s.VW - 160, y: 240 });
    // it gets past, pops out of its bubble at the sand and swims away
    await waitFor(async () => (await st()).items.some((q) => q.id === missId && q.hidden), 8000, 40);
    await sleep(420);
    const swimming = (await st()).leavers;
    await shot(`${tag}-06-a-missed-friend-swims-off`);
    await waitFor(async () => !(await st()).items.some((q) => q.id === missId), 8000, 80);
    await sleep(200);
    s = await st();
    check(`${tag}: a friend that gets past swims away and costs nothing: coins, tray and stars are as they were`, swimming >= 1 && s.coins === before.coins && s.tray === before.tray && s.catches === before.catches && s.bonks === 0 && s.stars === 3 && s.misses === before.misses + 1 && s.hudCoins === before.coins,
      `coins ${s.coins}, tray ${s.tray}, misses ${s.misses}, stars ${s.stars}`);

    // ---------- level 3: grumps ----------
    await D('start(3, true, 5)');
    await D('pause(true)'); await D('clear()');
    await sleep(300);
    await hookCatch(10, 25);
    s = await settle((q) => quiet(q) && q.hudCoins === 1, 9000);
    check(`${tag}: level 3, one coin earned`, !!s && s.coins === 1, s && `coins ${s.coins}`);
    s = await st();
    let gid = await place({ kind: 'urchin', x: s.px + (s.px > s.VW / 2 ? -330 : 330), y: 130 });
    s = await slideUnder(gid, { then: () => shot(`${tag}-07-a-grump-is-coming-down`) });
    check(`${tag}: a grump caught by a real drag costs one coin: a bonk, a wobble, the coin drifts away`, s.coins === 0 && s.bonks === 1 && s.hudCoins === 0 && s.lostCoins === 1 && s.dizzy > 0 && s.stars === 2 && s.tray === 0,
      `coins ${s.coins}, bonks ${s.bonks}, lost coins on show ${s.lostCoins}, dizzy ${s.dizzy.toFixed(2)}, stars ${s.stars}`);
    await sleep(260);
    await shot(`${tag}-08-a-grump-is-caught-bonk`);
    await sleep(1700);   // the dizziness passes
    s = await st();
    gid = await place({ kind: 'urchin', x: s.px + (s.px > s.VW / 2 ? -300 : 300), y: 150 });
    s = await slideUnder(gid);
    check(`${tag}: another grump at 0 coins: still 0, never below`, s.coins === 0 && s.bonks === 2 && s.hudCoins === 0 && s.lostCoins <= 1, `coins ${s.coins}, bonks ${s.bonks}`);
    await sleep(1700);
    // a grump coming straight down on her: a slide to the side dodges it
    s = await st();
    gid = await place({ kind: 'urchin', x: s.px, y: 120 });
    await sleep(300);
    await fingerMove(finger.x + (finger.x > w / 2 ? -150 : 150), finger.y, 10);
    await waitFor(async () => !(await st()).items.some((q) => q.id === gid), 8000, 80);
    s = await st();
    check(`${tag}: a grump coming straight down on her is dodged by sliding aside: nothing is lost`, s.bonks === 2 && s.coins === 0, `bonks ${s.bonks}`);
    // the golden friend
    const gold = await place({ kind: 'turtle', gold: true, x: s.px + (s.px > s.VW / 2 ? -280 : 280), y: 150 });
    const trayBefore = s.tray;
    s = await slideUnder(gold, { then: () => shot(`${tag}-09-the-golden-friend`) });
    check(`${tag}: the golden friend, caught by a real drag, is a whole coin by itself`, s.coins === 1 && s.golds === 1 && s.tray === trayBefore && s.owed === 1, `coins ${s.coins}, golds ${s.golds}, tray ${s.tray}`);
    await fingerUp();
    s = await settle((q) => quiet(q) && q.hudCoins === 1, 6000);
    check(`${tag}: ...and its coin flies up into the coin row`, !!s);
    // the tenth catch earns a coin that is still on its way up when a grump lands: that coin wobbles away instead
    // of landing, so the row never shows a coin she no longer has
    await D('start(3, true, 5)'); await D('pause(true)'); await D('clear()');
    await hookCatch(10, 0);
    const g5 = await place({ kind: 'urchin', x: 300, y: 100 });
    await D(`catchItem(${g5})`);
    s = await st();
    const inFlight = s.coins === 0 && s.hudCoins === 0 && s.owed === 1 && s.debt === 1;
    s = await settle((q) => quiet(q) && q.debt === 0 && q.lostCoins === 0, 9000);
    check(`${tag}: a coin still on its way when a grump lands wobbles away instead of landing`, inFlight && !!s && s.coins === 0 && s.hudCoins === 0, s ? `coins ${s.coins}, row ${s.hudCoins}` : 'never settled');

    // ---------- levels 5 and 10, really played for a few seconds (screenshots) ----------
    for (const n of [5, 10]) {
      await D(`start(${n}, true, ${40 + n})`);
      await hookCatch(n === 10 ? 14 : 6, 20);
      await autoPlay(n === 10 ? 6500 : 5500);
      s = await st();
      const cfg = (await D('levels()'))[n - 1], allowed = cfg.kinds.map((k) => k[0]).concat(cfg.grumps);
      check(`${tag}: level ${n} mid-play: ${cfg.coins} coins to the chest, only this level's friends and grumps in the water`, s.level === n && s.coinTarget === cfg.coins && s.items.length >= 2 && s.items.every((q) => allowed.includes(q.kind)),
        `${s.items.length} falling: ${s.items.map((q) => q.kind).join(', ')}; coins ${s.coins}/${s.coinTarget}, tray ${s.tray}, bonks ${s.bonks}`);
      await shot(`${tag}-level-${String(n).padStart(2, '0')}-mid-play`);
      await fingerUp();
    }

    // ---------- level 1 to its treasure chest ----------
    await D('start(1)');
    await sleep(300);
    s = await st();
    check(`${tag}: level 1 resumes with the coin it had`, s.level === 1 && s.coins === 1 && s.hudCoins === 1, `coins ${s.coins}`);
    await sleep(2200);
    await shot(`${tag}-level-01-mid-play`);
    await D('pause(true)'); await D('clear()');
    await hookCatch(9, 40);
    // the last friend by a real drag
    s = await st();
    const lastId = await place({ kind: 'fish', x: s.px + (s.px > s.VW / 2 ? -260 : 260), y: 170 });
    s = await slideUnder(lastId);
    await fingerUp();
    check(`${tag}: the 20th catch reaches the goal: progress is saved at once`, s.done && s.coins === 2 && s.unlocked === 2 && s.savedStars[0] === 3, `coins ${s.coins}/${s.coinTarget}, unlocked ${s.unlocked}, stars ${s.savedStars[0]}`);
    s = await settle((q) => q.phase === 'win', 15000);
    check(`${tag}: when the last coin lands, the treasure chest rises out of the sand`, !!s && s.chest && s.hudCoins === 2, s && `phase ${s.phase}, hudCoins ${s.hudCoins}`);
    s = await settle((q) => q.chestOpen > 0.95, 4000);
    await sleep(250);
    await shot(`${tag}-10-the-chest-bursts-with-coins`);
    const gold2 = await ev(`window.__catchDebug.state().parts`);
    check(`${tag}: ...and bursts with a fountain of gold coins`, !!s && gold2 > 60, `chest open ${s && s.chestOpen.toFixed(2)}, ${gold2} particles`);
    s = await settle((q) => q.results, 6000);
    await waitFor(() => ev(`document.querySelectorAll('#bigStars svg.pop').length === 3`), 3000);
    await sleep(300);
    const res = await ev(`(() => { const vh = innerHeight / 100, r = (e) => e.getBoundingClientRect(), bs = ['resLevels', 'resReplay', 'resNext'].map((id) => r(document.getElementById(id))), c = r(document.querySelector('.card'));
      return { stars: [...document.querySelectorAll('#bigStars svg use')].filter((u) => u.getAttribute('fill') === '#ffd23f').length, btnVh: +(Math.min(...bs.map((b) => Math.min(b.width, b.height))) / vh).toFixed(1),
        off: c.left < 0 || c.top < 0 || c.right > innerWidth || c.bottom > innerHeight, overlap: bs.some((a, i) => bs.some((b, j) => i < j && a.left < b.right && b.left < a.right)) }; })()`);
    check(`${tag}: results: 3 stars (no grump caught on level 1); three buttons at least 19vh, the card on the screen`, !!s && s.resultsStars === 3 && res.stars === 3 && res.btnVh >= 19 && !res.off && !res.overlap, Object.assign({ resultsStars: s && s.resultsStars }, res));
    await shot(`${tag}-11-results`);
    const saved1 = JSON.parse(await D('saved()'));
    check(`${tag}: saved under game.catch.save: level 2 unlocked, 3 stars on level 1, the finished run cleared`, saved1.v === 1 && saved1.unlocked === 2 && saved1.stars[0] === 3 && !saved1.runs['1'] && saved1.chests === 1
      && (await ev(`localStorage.getItem('game.catch.save')`)) === JSON.stringify(saved1), JSON.stringify({ v: saved1.v, unlocked: saved1.unlocked, stars: saved1.stars.slice(0, 3), runs: saved1.runs, chests: saved1.chests }));

    await tapEl('#resLevels');
    await sleep(400);
    let lv = await ev(`(() => { const b = (n) => document.querySelector('.lvl[data-level="' + n + '"]'); return { screen: window.__catchDebug.state().screen, l2locked: b(2).classList.contains('locked'), l2next: b(2).classList.contains('next'), l3locked: b(3).classList.contains('locked'), l1stars: b(1).querySelectorAll('use[fill="#ffd23f"]').length, pill: document.getElementById('starCount').textContent }; })()`);
    check(`${tag}: the levels button shows level 2 open (and bobbing) with 3 stars on level 1`, lv.screen === 'levels' && !lv.l2locked && lv.l2next && lv.l3locked && lv.l1stars === 3 && lv.pill === '3/30', lv);
    await shot(`${tag}-12-level-select-level-2-open`);
    await reload(); await sleep(500);
    lv = await ev(`(() => { const b = (n) => document.querySelector('.lvl[data-level="' + n + '"]'); return { l2locked: b(2).classList.contains('locked'), l1stars: b(1).querySelectorAll('use[fill="#ffd23f"]').length, unlocked: window.__catchDebug.state().unlocked }; })()`);
    check(`${tag}: after a reload level 2 is still open and level 1 keeps its stars`, !lv.l2locked && lv.l1stars === 3 && lv.unlocked === 2, lv);
    await tapEl('.lvl[data-level="2"]');
    s = await settle((q) => q.screen === 'play' && q.level === 2 && q.items.length > 0, 3000);
    check(`${tag}: level 2 plays (3 coins to its chest)`, !!s && s.coinTarget === 3, s && `coins to get ${s.coinTarget}`);
    // a half-played level comes back after leaving
    await D('pause(true)'); await D('clear()');
    await hookCatch(4, 20);
    await sleep(200);

    // ---------- home and back ----------
    where = 'hub';
    let loaded = cdp.once('Page.loadEventFired');
    await tapEl('#home');
    await loaded; await sleep(300);
    let href = await ev('location.href');
    check(`${tag}: the home button opens ../../index.html`, href === HUB, href.replace(WEB, ''));
    await go(PAGE, 'catch'); await sleep(300);
    const kept = JSON.parse(await D('saved()'));
    check(`${tag}: leaving by the home button saved the half-played level 2 (4 friends in the tray)`, kept.runs['2'] && kept.runs['2'].tray.length === 4 && kept.total >= 44, JSON.stringify(kept.runs) + `, ${kept.total} friends caught in all`);
    where = 'hub';
    loaded = cdp.once('Page.loadEventFired');
    const ret = await ev('window.__back()');
    await loaded; await sleep(300);
    href = await ev('location.href');
    check(`${tag}: window.__back() returns true and opens ../../index.html`, ret === true && href === HUB, href.replace(WEB, ''));
    await go(PAGE, 'catch');
  }

  // ======================= the two phone sizes =======================
  if (!ONLY || ONLY === 'seeker') await suite(915, 412, 2.625, 'seeker');
  if (!ONLY || ONLY === 'phone800') await suite(800, 360, 3, 'phone800');

  // ======================= once, at the Seeker size =======================
  if (!ONLY || ONLY === 'more') await more();

  async function more() {
    console.log('\n=== more, at 915x412 ===');
    await viewport(915, 412, 2.625);
    await loadWith(`localStorage.clear(); localStorage.setItem('game.catch.save', JSON.stringify({ v: 1, unlocked: 10, stars: [3, 3, 3, 2, 3, 3, 1, 2, 3, 0] }))`);
    await sleep(400);
    await shot('levels-all-open');

    // ---------- the picture sheet: every friend and every grump side by side ----------
    await D('sheet(true)');
    await ev(`document.getElementById('levels').classList.remove('on')`);
    await sleep(300);
    await shot('sheet-every-friend-and-every-grump');
    await ev(`document.getElementById('levels').classList.add('on')`);
    await D('sheet(false)');

    // ---------- counting order: friends caught in a rush are counted 1, 2, 3 ... one after another ----------
    await D('start(1, true, 3)'); await D('pause(true)'); await D('clear()');
    await sleep(200);
    await ev(`(() => { const P = window.__catchDebug, ks = ['fish', 'turtle', 'starfish']; for (let k = 0; k < 13; k++) { const id = P.spawn({ kind: ks[k % 3], x: 500, y: 100 }); P.catchItem(id); } })()`);
    await settle(quiet, 14000);
    const log = (await D('counters')).countLog.slice(-13), order = log.map((e) => e[0]);
    const gaps = log.slice(1, 10).map((e, i) => e[1] - log[i][1]);
    check('friends caught in a rush are counted in order, one after another: 1..10, a coin, then 1, 2, 3',
      order.join() === '1,2,3,4,5,6,7,8,9,10,1,2,3' && gaps.every((g) => g >= 0.12), `order ${order.join(',')}; gaps ${gaps.map((g) => g.toFixed(2)).join(',')} s`);

    // ---------- every level mid-play, really played ----------
    const table = await D('levels()');
    for (let n = 1; n <= 10; n++) {
      await D(`start(${n}, true, ${70 + n})`);
      await sleep(150);
      await hookCatch(10 + (n % 4) + 2, 15);   // a coin in, some friends in the tray
      await autoPlay(n <= 2 ? 6500 : 5000);
      const s = await st(), cfg = table[n - 1], allowed = cfg.kinds.map((k) => k[0]).concat(cfg.grumps);
      const hud = await D('hud()');
      check(`level ${n}: ${cfg.coins} coins to the chest (${cfg.kinds.length} friends${cfg.grumps.length ? ', grumps: ' + cfg.grumps.join(', ') : ''}); the coin row fits beside the home button`,
        s.level === n && s.coinTarget === cfg.coins && s.items.every((q) => allowed.includes(q.kind)) && hud.length === cfg.coins && hud[0].cx > 130 && hud[hud.length - 1].cx < 915 - 40 && s.postponed === 0,
        `${s.items.length} falling, coins ${s.coins}/${s.coinTarget}, tray ${s.tray}, bonks ${s.bonks}, first ring at x ${hud[0].cx.toFixed(0)}`);
      await shot(`level-${String(n).padStart(2, '0')}-mid-play`);
      await fingerUp();
    }

    // ---------- inside the Android app: window.IsabellaStore ----------
    const seedSave = JSON.stringify({ v: 1, unlocked: 4, stars: [3, 2, 1, 0, 0, 0, 0, 0, 0, 0], runs: {}, total: 77, golds: 2, coins: 9, chests: 3 });
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source:
      `(() => { const m = new Map([['isabella.save', JSON.stringify({ unlocked: 7, muted: true })], ['game.catch.save', ${JSON.stringify(seedSave)}]]);
        window.__fakeStore = m; window.IsabellaStore = { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); } }; })();` });
    await reload(); await sleep(500);
    const localBefore = await ev(`localStorage.getItem('game.catch.save')`);
    let s = await st();
    check('IsabellaStore: the save and the mute setting are read from the app store', s.total === 77 && s.unlocked === 4 && s.muted === true, `total ${s.total}, unlocked ${s.unlocked}, muted ${s.muted}`);
    await D('start(1)'); await sleep(200); await D('pause(true)'); await hookCatch(10, 10);
    const inStore = JSON.parse(await ev(`window.__fakeStore.get('game.catch.save')`));
    const main = await ev(`window.__fakeStore.get('isabella.save')`);
    check('IsabellaStore: saves go to the app store, not localStorage; isabella.save is never written', inStore.v === 1 && inStore.total === 87 && (await ev(`localStorage.getItem('game.catch.save')`)) === localBefore && main === JSON.stringify({ unlocked: 7, muted: true }),
      `store total ${inStore.total}; isabella.save ${main}`);
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
    check('isabella.save is left exactly as it was', (await ev(`localStorage.getItem('isabella.save')`)) === JSON.stringify({ unlocked: 3, muted: false }));
    await ev(`localStorage.removeItem('isabella.save')`);

    // ---------- held upright the game waits behind a turn-the-phone picture ----------
    const tBefore = (await st()).t;
    await viewport(412, 915, 2.625);
    await sleep(400);
    const up = await ev(`(() => { const r = document.getElementById('rotate'); return getComputedStyle(r).display; })()`);
    const cu0 = await D('counters');
    await touchTap(60, 600);
    await sleep(150);
    check('held upright: a turn-the-phone picture covers the game and touches do nothing', up === 'flex' && (await D('counters')).downs === cu0.downs, `rotate ${up}`);
    await viewport(915, 412, 2.625);
    await sleep(400);
    await sleep(500);
    s = await st();
    check('...and turned back the level carries on, Isabella still on the screen', s.screen === 'play' && s.t > tBefore + 0.3 && s.px >= s.pxMin && s.px <= s.VW - s.pxMin && Math.abs(s.VW - 1199.5) < 1, `time ${tBefore.toFixed(1)} -> ${s.t.toFixed(1)} s, shell at ${s.px.toFixed(0)} of ${s.VW.toFixed(0)}`);

    // ---------- frame rate: level 10 in full flow ----------
    await D('start(10, true, 21)');
    await sleep(300);
    await hookCatch(17, 10);
    await sleep(3500);
    const fpsExpr = `new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res({ frames: n, secs: (performance.now() - t0) / 1000 }); }; requestAnimationFrame(f); })`;
    await D('resetPerf()');
    const fps = await ev(fpsExpr), perf = await D('perf()');
    check('frame rate on level 10 in full flow', fps.frames / fps.secs >= 55, `${(fps.frames / fps.secs).toFixed(1)} fps; game update+draw avg ${perf.avgMs.toFixed(2)} ms, p95 ${perf.p95Ms.toFixed(2)} ms`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await D('resetPerf()');
    const fps4 = await ev(fpsExpr), perf4 = await D('perf()');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    check('frame rate with the CPU slowed 4x (a modest phone)', fps4.frames / fps4.secs >= 45, `${(fps4.frames / fps4.secs).toFixed(1)} fps; game work p95 ${perf4.p95Ms.toFixed(2)} ms`);
  }

  // ---------- no errors ----------
  const mine = problems.filter((p) => p.where === 'catch');
  check('no console errors, warnings or exceptions on the game page', mine.length === 0, mine.length ? JSON.stringify(mine.slice(0, 5)) : 'none');

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), results, problems, shots: shots.map((f) => path.basename(f)) }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed. Screenshots in ${path.relative(ROOT, OUT) || OUT}`);
  cdp.close(); cdp.proc.kill();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('browser test crashed:', e); if (chrome) chrome.kill(); process.exit(2); });
