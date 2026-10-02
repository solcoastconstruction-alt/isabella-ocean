// Shell Match in headless Chrome, driven like a finger: touch taps on the real page via the DevTools protocol.
// A solver reads the board through window.__matchDebug and plays; screenshots and saves are checked as it goes.
//   usage: node test/games/match/browser.js [outDir] [chromeProfileDir]
//   (defaults: $TMPDIR/shell-match-shots and $TMPDIR/chrome-match; DevTools port 9452)
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');

const REPO = path.resolve(__dirname, '../../..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'shell-match-shots'));
const PROFILE = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'chrome-match'));
const PORT = 9452;
const GAME = '/web/games/match/index.html';

let fails = 0, checks = 0;
function check(ok, what, detail) {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve(REPO);
  const base = `http://127.0.0.1:${srv.port}`;
  const chrome = await launch({ port: PORT, profile: PROFILE, width: 1335, height: 600 });
  const shots = [];
  let page;
  try {
    page = await openPage(PORT);
    const P = page;
    const st = () => P.eval('__matchDebug.state');
    const shot = async (name) => { const f = await P.shot(path.join(OUT, name + '.png')); shots.push(f); console.log(`  shot ${f}`); };
    const tapRect = (r) => P.tap(r.x + r.w / 2, r.y + r.h / 2);
    const tapCard = async (pos) => { const s = await st(); await tapRect(s.cards[pos].rect); };
    const tapEl = async (sel) => { const r = await P.eval(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()`); await tapRect(r); };
    const waitPlayable = () => P.waitFor('(() => { const s = __matchDebug.state; return s.phase === "clear" || (s.phase === "play" && !s.locked); })()', 6000, 'the board to take taps again');
    const waitResults = async () => { await P.waitFor('__matchDebug.state.screen === "results"', 12000, 'the results card'); await P.waitFor('document.querySelectorAll("#bigStars svg.pop").length === 3', 4000, 'three stars to pop'); };
    const shownStars = () => P.eval(`[...document.querySelectorAll('#bigStars svg use')].filter((u) => u.getAttribute('fill') === '#ffd23f').length`);
    const savedRaw = () => P.eval(`localStorage.getItem('game.match.save')`);
    const overlaps = () => P.eval(`(() => { const r = (e) => e.getBoundingClientRect(), hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      const t = r(document.getElementById('title')), p = r(document.querySelector('.pill')), g = r(document.getElementById('grid')), h = r(document.getElementById('homeBtn'));
      return { titlePill: hit(t, p), titleGrid: hit(t, g), titleHome: hit(t, h), gridHome: hit(g, h), offscreen: [t, p, g, h].some((b) => b.left < 0 || b.top < 0 || b.right > innerWidth || b.bottom > innerHeight) }; })()`);

    // Plays the current level: `miss` deliberate mismatches first, then a perfect run from the board read
    // through __matchDebug. `during(i, pair)` runs after the i-th pair's second tap (for screenshots).
    async function play({ miss = 0, during, tripleTap = false } = {}) {
      await P.waitFor('__matchDebug.state.phase === "play"', 30000, 'play to begin');
      let s = await st();
      for (let i = 0; i < miss; i++) {
        const down = s.cards.filter((c) => c.state === 'down');
        const a = down[0], b = down.find((c) => c.kind !== a.kind), c3 = down.find((c) => c !== a && c !== b);
        await tapRect(a.rect); await tapRect(b.rect);
        if (tripleTap && i === 0) {
          await tapRect(c3.rect); // a third shell while two are open: must be ignored
          const t = await st();
          check(t.cards[c3.pos].state === 'down' && t.cards.filter((c) => c.state === 'up').length === 2, 'a third tap while two shells are open is ignored', t.cards.map((c) => c.state[0]).join(''));
        }
        await waitPlayable();
        s = await st();
      }
      check(s.mismatches === miss, `${miss} deliberate mismatch(es) counted`, s.mismatches);
      const byKind = {};
      for (const c of s.cards) if (c.state === 'down') (byKind[c.kind] = byKind[c.kind] || []).push(c);
      let i = 0;
      for (const pair of Object.values(byKind)) {
        await tapRect(pair[0].rect); await tapRect(pair[1].rect);
        if (during) await during(i, pair);
        await waitPlayable();
        i++;
      }
      return st();
    }

    // ================= Seeker-sized screen: 1335 x 600 CSS px at 2x, touch =================
    console.log(`\nSeeker screen 1335x600 @2x (DevTools port ${PORT}, profile ${PROFILE})`);
    await P.viewport(1335, 600, 2);
    await P.goto(base + GAME);
    await P.eval(`localStorage.clear()`);
    await P.goto(base + GAME);
    await sleep(500);
    let s = await st();
    check(s.screen === 'levels' && JSON.stringify(s.save) === JSON.stringify({ unlocked: 1, stars: [0, 0, 0, 0, 0, 0] }), 'opens on the level select with a fresh save', s.save);
    check(s.dpr === 2, 'canvas at device pixel ratio 2', s.dpr);
    const sizes = await P.eval(`(() => { const vh = innerHeight / 100, r = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return +(Math.min(b.width, b.height) / vh).toFixed(1); }; return { level: r('.lvl'), home: r('#homeBtn') }; })()`);
    check(sizes.level >= 19 && sizes.home >= 19, 'level buttons and the home button touch area are at least 19vh', sizes);
    check((await P.eval(`document.querySelectorAll('.lvl.locked').length`)) === 5, 'levels 2-6 start locked');
    let ov = await overlaps();
    check(!Object.values(ov).some(Boolean), 'level select: title, star count, grid and home button do not overlap', ov);
    await shot('01-level-select-fresh');

    await tapEl('.lvl[data-level="2"]');
    await sleep(150);
    check((await st()).muted === false && (await st()).gain === 1, 'not muted when the main game is not: master gain 1 after the first tap', { muted: (await st()).muted, gain: (await st()).gain });
    check((await st()).screen === 'levels' && (await P.eval(`document.querySelector('.lvl[data-level="2"]').classList.contains('shake')`)), 'a locked level only wiggles');

    // ---- level 1: three mismatches -> 1 star ----
    await tapEl('.lvl[data-level="1"]');
    await P.waitFor('__matchDebug.state.phase === "peek"', 5000, 'the peek');
    await sleep(700);
    await shot('02-level1-peek');
    s = await play({ miss: 3, tripleTap: true });
    await waitResults();
    s = await st();
    check(s.resultsStars === 1 && (await shownStars()) === 1, 'level 1 with 3 mismatches (2 pairs): 1 star', { resultsStars: s.resultsStars, shown: await shownStars() });
    check(JSON.stringify(JSON.parse(await savedRaw())) === JSON.stringify({ unlocked: 2, stars: [1, 0, 0, 0, 0, 0] }), 'saved: level 1 = 1 star, level 2 unlocked', await savedRaw());

    // ---- replay level 1 perfectly -> 3 stars (best kept) ----
    await tapEl('#resReplay');
    s = await play();
    await waitResults();
    s = await st();
    check(s.resultsStars === 3 && (await shownStars()) === 3 && s.mismatches === 0, 'solver replays level 1 perfectly: 3 stars', s.resultsStars);
    check(JSON.parse(await savedRaw()).stars[0] === 3, 'saved: level 1 now 3 stars', await savedRaw());

    // ---- replay level 1 with 2 mismatches -> 2 stars shown, best stays 3 ----
    await tapEl('#resReplay');
    s = await play({ miss: 2 });
    await waitResults();
    s = await st();
    check(s.resultsStars === 2 && (await shownStars()) === 2, 'level 1 with 2 mismatches: 2 stars', s.resultsStars);
    check(JSON.parse(await savedRaw()).stars[0] === 3, 'saved: best stars kept at 3 after a worse run', await savedRaw());

    // ---- levels 2-6, each started with the results card's "next" button, all perfect ----
    let perf = null;
    for (let n = 2; n <= 6; n++) {
      await tapEl('#resNext');
      await P.waitFor(`__matchDebug.state.level === ${n}`, 3000, `level ${n} to start`);
      s = await st();
      check(s.pairs === [0, 2, 3, 4, 6, 8, 10][n] && s.cards.length === 2 * s.pairs, `level ${n}: ${s.pairs} pairs, ${s.cards.length} shells`);
      if (n >= 4) {
        await P.waitFor('__matchDebug.state.phase === "shuffle"', 20000, 'the shuffle');
        const before = (await st()).cards.map((c) => c.id);
        await sleep(950); // mid-slide of the first swap
        await shot(`0${n === 4 ? 5 : n === 5 ? 6 : 7}-level${n}-shuffle`);
        await P.waitFor('__matchDebug.state.phase === "play"', 20000);
        s = await st();
        const moved = s.cards.filter((c, i) => c.id !== before[i]).length;
        check(moved === 2 * s.swaps.length, `level ${n}: ${s.swaps.length} swap(s) moved ${moved} shells`, s.swaps);
      }
      if (n === 6) await P.eval('__matchDebug.resetPerf()');
      s = await play({
        during: async (i, pair) => {
          if (n === 3 && i === 1) { await sleep(450); await shot('03-level3-match-dance'); }
          if (n === 3 && i === 2) { await waitPlayable(); const t = await st(); const nxt = t.cards.find((c) => c.state === 'down'); await tapRect(nxt.rect); await sleep(300); await shot('04-level3-mid-play'); await tapRect(t.cards.find((c) => c.kind === nxt.kind && c.pos !== nxt.pos).rect); }
          if (n === 6 && i === 5) { await waitPlayable(); const t = await st(); const nxt = t.cards.find((c) => c.state === 'down'); await tapRect(nxt.rect); await sleep(350); await shot('08-level6-ten-pairs-mid-play'); await tapRect(t.cards.find((c) => c.kind === nxt.kind && c.pos !== nxt.pos).rect); }
        },
      });
      if (n === 6) {
        perf = await P.eval('__matchDebug.perf()');
        await P.waitFor('__matchDebug.state.phase === "clear"', 5000);
        await sleep(1300);
        await shot('09-level6-celebration');
      }
      await waitResults();
      s = await st();
      check(s.resultsStars === 3 && s.mismatches === 0, `solver clears level ${n} perfectly: 3 stars`, s.resultsStars);
      const sv = JSON.parse(await savedRaw());
      check(sv.stars[n - 1] === 3 && sv.unlocked === Math.min(6, n + 1), `saved: level ${n} = 3 stars, unlocked ${sv.unlocked}`, sv);
      if (n === 6) { await sleep(700); await shot('10-level6-clear-stars'); }
    }
    check((await P.eval(`getComputedStyle(document.getElementById('resNext')).display`)) === 'none', 'no "next" button after the last level');
    console.log(`  frame stats during level 6 play (headless, 2670x1200 canvas): ${JSON.stringify(perf, (k, v) => (typeof v === 'number' ? +v.toFixed(2) : v))}`);
    check(perf && perf.fps > 50 && perf.drawP95Ms < 8.3, 'level 6 renders at >50 fps with p95 draw time under 8.3 ms (room for 120 Hz)', perf);

    await tapEl('#resLevels');
    await sleep(500);
    s = await st();
    check(s.screen === 'levels' && (await P.eval(`document.getElementById('starCount').textContent`)) === '18/18' && (await P.eval(`document.querySelectorAll('.lvl.locked').length`)) === 0, 'level select: every level open, 18/18 stars');
    await shot('11-level-select-all-stars');

    // a reload keeps the progress
    await P.goto(base + GAME);
    await sleep(300);
    check(JSON.stringify((await st()).save) === JSON.stringify({ unlocked: 6, stars: [3, 3, 3, 3, 3, 3] }), 'progress survives a reload', (await st()).save);

    // ================= 1024 x 768 =================
    console.log('\n1024x768 @1x');
    await P.viewport(1024, 768, 1);
    await P.goto(base + GAME);
    await sleep(500);
    ov = await overlaps();
    check(!Object.values(ov).some(Boolean), '1024x768 level select: title, star count, grid and home button do not overlap', ov);
    await shot('12-level-select-1024x768');
    const lays = [];
    for (let n = 1; n <= 6; n++) lays.push(await P.eval(`__matchDebug.layoutFor(${n})`));
    console.log('  targets at 1024x768: ' + lays.map((l, i) => `L${i + 1} ${l.cols}x${l.rows} ${l.targetVh.toFixed(1)}vh`).join(' | '));
    check(lays.every((l) => l.targetVh >= 19), 'every level at least 19vh at 1024x768', lays.map((l) => +l.targetVh.toFixed(1)));
    check(lays.every((l) => Math.min(l.cell.w, l.cell.h) / 7.68 >= 19), 'cell rectangles on the page agree (CSS px / vh)');
    await tapEl('.lvl[data-level="6"]');
    await P.waitFor('__matchDebug.state.phase === "play"', 30000);
    await sleep(200);
    await shot('13-level6-ten-pairs-1024x768');
    s = await play();
    await waitResults();
    check((await st()).resultsStars === 3, 'solver clears the 10-pair level at 1024x768: 3 stars');
    await sleep(700);
    await shot('14-level6-clear-1024x768');

    // back to the Seeker size for the rest
    await P.viewport(1335, 600, 2);
    await P.goto(base + GAME);
    await sleep(300);
    const seekerLays = [];
    for (let n = 1; n <= 6; n++) seekerLays.push(await P.eval(`__matchDebug.layoutFor(${n})`));
    console.log('  targets at 1335x600: ' + seekerLays.map((l, i) => `L${i + 1} ${l.cols}x${l.rows} ${l.targetVh.toFixed(1)}vh`).join(' | '));
    check(seekerLays.every((l) => l.targetVh >= 19), 'every level at least 19vh at 1335x600', seekerLays.map((l) => +l.targetVh.toFixed(1)));

    // ================= inside the Android app: window.IsabellaStore =================
    console.log('\nwith window.IsabellaStore (as in the Android app)');
    const lsBefore = await savedRaw();
    const { identifier } = await P.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__fakeStore = { 'isabella.save': JSON.stringify({ muted: true, unlocked: 3 }), 'game.match.save': JSON.stringify({ unlocked: 2, stars: [2, 0, 0, 0, 0, 0] }) };
               window.IsabellaStore = { get: (k) => (k in window.__fakeStore ? window.__fakeStore[k] : null), set: (k, v) => { window.__fakeStore[k] = String(v); } };`,
    });
    await P.goto(base + GAME);
    await sleep(300);
    s = await st();
    check(s.muted === true, 'mute follows isabella.save from IsabellaStore', s.muted);
    check(JSON.stringify(s.save) === JSON.stringify({ unlocked: 2, stars: [2, 0, 0, 0, 0, 0] }), 'progress read from IsabellaStore, not localStorage', s.save);
    await tapEl('.lvl[data-level="2"]');
    await sleep(100);
    check((await st()).gain === 0, 'muted for real: the master gain is 0 once sound starts', (await st()).gain);
    s = await play();
    await waitResults();
    const fake = JSON.parse(await P.eval(`window.__fakeStore['game.match.save']`));
    check(fake.stars[1] === 3 && fake.unlocked === 3, 'save written to IsabellaStore under game.match.save', fake);
    check((await savedRaw()) === lsBefore, 'localStorage left alone when IsabellaStore exists');

    // grown-ups: holding the title for 4 seconds opens every level
    await tapEl('#resLevels');
    await sleep(300);
    const tr = await P.eval(`(() => { const b = document.getElementById('title').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await P.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tr.x, y: tr.y, id: 1 }] });
    await sleep(4300);
    await P.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(200);
    const held = JSON.parse(await P.eval(`window.__fakeStore['game.match.save']`));
    check(held.unlocked === 6 && (await P.eval(`document.querySelectorAll('.lvl.locked').length`)) === 0, 'holding the title for 4 s opens every level (stars untouched)', held);
    await P.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

    // held upright, the page asks to turn the phone sideways
    await P.viewport(600, 1335, 2);
    await sleep(200);
    check((await P.eval(`getComputedStyle(document.getElementById('rotate')).display`)) === 'flex', 'portrait shows the turn-the-phone picture');
    await shot('15-portrait-rotate-hint');
    await P.viewport(1335, 600, 2);

    // ================= getting home =================
    console.log('\nhome and back');
    await P.goto(base + GAME);
    await sleep(200);
    const backResult = await P.eval(`(() => { const r = window.__back(); return r; })()`);
    await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the back button to reach the hub');
    check(backResult === true, 'window.__back() returns true and goes to ../../index.html', await P.eval('location.pathname'));
    await P.goto(base + GAME + '?level=2&seed=5');
    await sleep(300);
    await tapEl('#homeBtn');
    await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the home button to reach the hub');
    check(true, 'the home button (mid-level) goes to ../../index.html');

    console.log('');
    check(page.errors.length === 0, 'no console errors, exceptions or failed loads on any page', page.errors);
  } catch (e) {
    fails++;
    console.log('  FAIL ' + (e.stack || e));
    if (page) try { await page.shot(path.join(OUT, 'zz-failure.png')); } catch (e2) { /* ignore */ }
  } finally {
    if (page) page.close();
    await chrome.close();
    await srv.close();
  }
  console.log(`\n${checks - fails}/${checks} checks passed${fails ? `, ${fails} FAILED` : ''}. Screenshots in ${OUT}`);
  process.exit(fails ? 1 : 0);
})();
