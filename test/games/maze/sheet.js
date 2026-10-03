// Coral Maze: a visual sheet. Screenshots of every level, both level-select pages, the moments that matter
// (the swipe hand, the hint trail, a gate opening, a jellyfish bump, the dark water, the celebration) and the
// results card, plus one contact sheet of them all. For looking at, not asserting.
// Hard: the fish and the shark, every Hard level a moment in, a map of each whole Hard maze (drawn from logic.js:
// tunnels, the best way out, keys and their gates, currents, patrols and shells), a scrolled view, the hint, a
// patrol, keys in order, the dark, the dive to the chest and the trophy; contact sheets of the screens and the maps.
//   node test/games/maze/sheet.js [outDir] [chromeProfileDir] [width] [height] [easy|hard|both]
//   (defaults: $TMPDIR/coral-maze-sheet, $TMPDIR/chrome-maze-sheet, 915 x 412 at the Seeker's 2.625, both; port 9454)
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');

const REPO = path.resolve(__dirname, '../../..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'coral-maze-sheet'));
const PROFILE = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'chrome-maze-sheet'));
const W = +(process.argv[4] || 915), H = +(process.argv[5] || 412), PORT = 9454, WHICH = process.argv[6] || 'both';
const GAME = '/web/games/maze/index.html';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const srv = await serve(REPO);
  const base = `http://127.0.0.1:${srv.port}`;
  const chrome = await launch({ port: PORT, profile: PROFILE, width: W, height: H });
  const shots = [];
  let page;
  try {
    page = await openPage(PORT);
    const P = page;
    const shot = async (name, label) => { const f = await P.shot(path.join(OUT, name + '.png')); shots.push({ f, label: label || name }); console.log('  ' + f); };
    const st = () => P.eval('__mazeDebug.state');
    await P.viewport(W, H, 2.625);
    if (WHICH !== 'hard') await easySheet(P, shot, st);
    if (WHICH !== 'easy') await hardSheet(P, st);
    console.log(page.errors.length ? 'page errors: ' + JSON.stringify(page.errors) : 'no page errors');
  } catch (e) {
    console.log('FAIL ' + (e.stack || e));
    if (page) console.log('page errors: ' + JSON.stringify(page.errors));
    if (page) try { await page.shot(path.join(OUT, 'zz-failure.png')); } catch (e2) { /* ignore */ }
    process.exitCode = 1;
  } finally {
    if (page) page.close();
    await chrome.close();
    await srv.close();
  }

  async function contact(P, list, name, cols) {
    const tiles = list.map((s) => `<figure><img src="file://${s.f}"><figcaption>${s.label}</figcaption></figure>`).join('');
    const html = path.join(OUT, name + '.html');
    fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#123;font:13px system-ui;color:#cde}main{display:grid;grid-template-columns:repeat(${cols || 4},1fr);gap:6px;padding:6px}figure{margin:0}img{width:100%;display:block;border-radius:4px}figcaption{padding:2px 0 4px}</style><main>${tiles}</main>`);
    await P.viewport(1600, 2400, 1);
    await P.goto('file://' + html);
    await sleep(800);
    const r = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
    await P.viewport(W, H, 2.625);
  }

  async function easySheet(P, shot, st) {
    await P.goto(base + GAME);
    await sleep(700);
    await shot('00-levels-page1-fresh', 'level select, fresh');

    // every level, a moment after it starts (dark levels with their dark water in)
    for (let n = 1; n <= 20; n++) {
      await P.eval(`__mazeDebug.start(${n})`);
      await sleep(n >= 17 ? 3200 : 1700);
      await shot(`level-${String(n).padStart(2, '0')}`, `level ${n}`);
    }

    // level 1: the swipe hand for a first-timer
    await P.eval('__mazeDebug.start(1)');
    await sleep(4200);
    await shot('x1-level1-swipe-hand', 'level 1: the swipe hand');

    // level 6 mid-play: follow the solver to just before the gate, then the hint trail
    await P.eval('__mazeDebug.start(6)');
    await sleep(1200);
    let sol = await P.eval('__mazeDebug.solve()');
    for (let i = 0; i < sol.steps.length - 3; i++) {
      await P.eval(`__mazeDebug.move('${sol.steps[i].dir}')`);
      await P.waitFor('__mazeDebug.state.resting && !__mazeDebug.state.queued', 8000);
      await sleep(250);
    }
    await sleep(400);
    await shot('x2-level6-key-held', 'level 6: key found, gate glowing');
    await P.eval('__mazeDebug.showHint()');
    await sleep(900);
    await shot('x3-level6-hint-trail', 'level 6: the hint trail');
    sol = await P.eval('__mazeDebug.solve()');
    await P.eval(`__mazeDebug.move('${sol.steps[0].dir}')`);
    await sleep(120);
    await shot('x4-level6-gate-opening', 'level 6: the gate opens');

    // level 7: swim into the jellyfish on purpose: rest where its side tunnel meets the way, wait until it is
    // close, then swim into its tunnel
    await P.eval('__mazeDebug.start(7)');
    await sleep(1100);
    const J = await P.eval(`(() => { const lv = MazeLogic.build(7), p = lv.patrols[0], j = lv.path.includes(p.cells[0]) ? 0 : p.cells.length - 1;
      return { cell: p.cells[j], into: MazeLogic.DIRS[j === 0 ? p.axis : (p.axis + 2) % 4], x0: p.x0, y0: p.y0, dx: p.dx, dy: p.dy }; })()`);
    for (let k = 0; k < 20 && (await st()).pos.cell !== J.cell; k++) {
      const plan = await P.eval('__mazeDebug.solve()');
      await P.eval(`__mazeDebug.move('${plan.steps[0].dir}')`);
      await P.waitFor('__mazeDebug.state.resting && !__mazeDebug.state.queued', 8000);
    }
    await P.waitFor(`(() => { const s = __mazeDebug.state, q = s.patrols[0] / MazeLogic.P, lv = MazeLogic.build(7);
      return Math.hypot(${J.x0} + ${J.dx} * q - lv.cx[${J.cell}], ${J.y0} + ${J.dy} * q - lv.cy[${J.cell}]) < 1.6; })()`, 20000, 'the jellyfish to come close');
    await P.eval(`__mazeDebug.move('${J.into}')`);
    await P.waitFor('__mazeDebug.state.phase === "hit"', 4000, 'the bump');
    await sleep(450);
    await shot('x5-level7-jelly-bump', 'level 7: a jellyfish bump (gentle)');
    await P.waitFor('__mazeDebug.state.phase === "play"', 4000);
    await sleep(300);
    await shot('x6-level7-back-at-start', 'level 7: back at the start');

    // the dark water, after swimming a little
    await P.eval('__mazeDebug.start(18)');
    await sleep(2600);
    sol = await P.eval('__mazeDebug.solve()');
    for (let i = 0; i < 5; i++) { await P.eval(`__mazeDebug.move('${sol.steps[i].dir}', ${sol.steps[i].at})`); }
    await P.waitFor('__mazeDebug.state.resting && !__mazeDebug.state.queued', 15000);
    await sleep(500);
    await shot('x7-level18-dark-explored', 'level 18: dark water, part explored');

    // celebration and results (level 1, solver's way)
    await P.eval('__mazeDebug.start(1)');
    await sleep(1100);
    sol = await P.eval('__mazeDebug.solve()');
    for (const s of sol.steps) await P.eval(`__mazeDebug.move('${s.dir}', ${s.at})`);
    await P.waitFor('__mazeDebug.state.phase === "win"', 15000);
    await sleep(1500);
    await shot('x8-celebration', 'the treasure chest');
    await P.waitFor('__mazeDebug.state.screen === "results"', 6000);
    await sleep(1600);
    await shot('x9-results', 'results: 3 stars');

    // level 20's finale (crown)
    await P.eval('__mazeDebug.start(20)');
    await sleep(1100);
    sol = await P.eval('__mazeDebug.solve()');
    for (const s of sol.steps) await P.eval(`__mazeDebug.move('${s.dir}', ${s.at})`);
    await P.waitFor('__mazeDebug.state.screen === "results"', 60000);
    await sleep(1800);
    await shot('x10-results-level20-crown', 'level 20 results, with the crown');

    // level select with progress, both pages
    await P.eval('__mazeDebug.unlockAll()');
    await P.eval(`(() => { const s = JSON.parse(localStorage.getItem('isabella.maze')); s.stars = s.stars.map((v, i) => v || (i < 13 ? 1 + (i % 3) : 0)); localStorage.setItem('isabella.maze', JSON.stringify(s)); })()`);
    await P.goto(base + GAME);
    await sleep(700);
    await P.eval(`document.getElementById('pgPrev').click()`);
    await sleep(700);
    await shot('01-levels-page1-progress', 'level select, page 1');
    await P.eval(`document.getElementById('pgNext').click()`);
    await sleep(700);
    await shot('02-levels-page2-progress', 'level select, page 2');

    // one contact sheet
    await contact(P, shots, 'contact-sheet');
    console.log(`\n${shots.length} screenshots + contact-sheet.png in ${OUT}`);
  }

  async function hardSheet(P, st) {
    const hs = [], maps = [];
    const shot = async (name, label) => { const f = await P.shot(path.join(OUT, name + '.png')); hs.push({ f, label: label || name }); console.log('  ' + f); };
    const rest = () => P.waitFor('(() => { const s = __mazeDebug.state; return s.phase === "win" || (s.resting && !s.queued); })()', 60000);
    const plan = () => P.eval('__mazeDebug.solve()');
    const play = async (steps) => { await P.eval(`__mazeDebug.autoplay(${steps.length})`); };
    void st;
    await P.goto(base + GAME);
    await P.eval('localStorage.clear()');
    await P.goto(base + GAME);
    await sleep(700);
    await shot('h00-mode-easy', 'the fish: Easy (fresh)');
    const sh = await P.eval(`(() => { const b = document.getElementById('modeHard').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await P.tap(sh.x, sh.y);
    await sleep(800);
    await shot('h01-mode-hard', 'the shark: Hard (fresh)');

    // every Hard level a moment in, and a map of the whole maze
    for (let n = 1; n <= 20; n++) {
      await P.eval(`__mazeDebug.start(${n}, 'hard')`);
      await sleep(n >= 14 ? 3200 : 1800);
      await shot(`hard-${String(n).padStart(2, '0')}`, `Hard ${n}`);
      const url = await P.eval(`(${drawMap.toString()})(${n})`);
      const f = path.join(OUT, `hard-${String(n).padStart(2, '0')}-map.png`);
      fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64'));
      maps.push({ f, label: `Hard ${n}: the whole maze and its best way out` });
      console.log('  ' + f);
    }

    // a scrolled view in the middle of Hard 8, then the hint there
    await P.eval(`__mazeDebug.start(8, 'hard')`);
    await sleep(1200);
    let sol = await plan();
    await play(sol.steps.slice(0, 18));
    await rest();
    await sleep(700);
    await shot('h10-hard8-scrolled', 'Hard 8, 18 glides in: the view has followed her');
    await P.eval('__mazeDebug.idle(50)');
    await P.waitFor('__mazeDebug.state.hint !== null', 8000);
    await sleep(900);
    await shot('h11-hard8-hint', 'Hard 8: the hint, after 45 s without progress');
    // a pufferfish on the way (Hard 4): just before meeting it
    await P.eval(`__mazeDebug.start(4, 'hard')`);
    await sleep(1200);
    sol = await plan();
    const lane = await P.eval(`MazeLogic.build(4, 'hard').patrols[0].cells`);
    let k = sol.steps.findIndex((s) => s.cells.some((c) => lane.includes(c)));
    await play(sol.steps.slice(0, Math.max(1, k)));
    await rest();
    await sleep(500);
    await shot('h12-hard4-puffer', 'Hard 4: a pufferfish on the way: wait for it');
    // three keys in order (Hard 7): the first key found
    await P.eval(`__mazeDebug.start(7, 'hard')`);
    await sleep(1200);
    sol = await plan();
    const key0 = await P.eval(`MazeLogic.build(7, 'hard').keys[0].cell`);
    k = sol.steps.findIndex((s) => s.cells.includes(key0));
    await play(sol.steps.slice(0, k + 1));
    await rest();
    await sleep(500);
    await shot('h13-hard7-first-key', 'Hard 7: the first of three keys, in order');
    // the dark (Hard 17), part explored
    await P.eval(`__mazeDebug.start(17, 'hard')`);
    await sleep(2600);
    sol = await plan();
    await play(sol.steps.slice(0, 14));
    await rest();
    await sleep(600);
    await shot('h14-hard17-dark', 'Hard 17: dark water, part explored');
    // Hard 1 to the end: the dive to the chest, the results
    await P.eval(`__mazeDebug.start(1, 'hard')`);
    await sleep(1100);
    sol = await plan();
    await play(sol.steps);
    await P.waitFor('__mazeDebug.state.phase === "win"', 60000);
    await sleep(1000);
    await shot('h15-hard1-dive', 'out: the dive to the chest (the view follows)');
    await P.waitFor('__mazeDebug.state.screen === "results"', 8000);
    await sleep(1700);
    await shot('h16-hard1-results', 'Hard 1 results');
    // Hard 20: the trophy
    await P.eval(`__mazeDebug.start(20, 'hard')`);
    await sleep(1100);
    sol = await plan();
    await play(sol.steps);
    await P.waitFor('__mazeDebug.state.screen === "results"', 120000);
    await sleep(1800);
    await shot('h17-hard20-trophy', 'Hard 20 results: the golden trophy');
    // the level select with progress, both modes
    await P.eval('__mazeDebug.unlockAll()');
    await P.eval(`(() => { const s = JSON.parse(localStorage.getItem('isabella.maze')); s.hard.stars = s.hard.stars.map((v, i) => v || (i < 13 ? 1 + (i % 3) : 0)); localStorage.setItem('isabella.maze', JSON.stringify(s)); })()`);
    await P.goto(base + GAME);
    await sleep(700);
    await P.eval(`document.getElementById('pgPrev').click()`);
    await sleep(700);
    await shot('h18-levels-hard-page1', 'Hard level select, page 1 (the shark has its trophy)');
    await P.eval(`document.getElementById('pgNext').click()`);
    await sleep(700);
    await shot('h19-levels-hard-page2', 'Hard level select, page 2');
    await P.eval(`__mazeDebug.mode('easy')`);
    await sleep(700);
    await shot('h20-levels-easy-after', 'back to Easy: its own pages and stars');
    await contact(P, hs, 'contact-sheet-hard');
    await contact(P, maps, 'contact-sheet-hard-maps', 2);
    console.log(`\n${hs.length} Hard screenshots, ${maps.length} maps, contact-sheet-hard.png and contact-sheet-hard-maps.png in ${OUT}`);
  }
})();

// A map of a whole Hard maze, drawn in the page from logic.js: the tunnels; the best way out (gold, from the pink
// start to the sea on the right); keys (numbered in the order she needs them) and their gates in the same colour;
// currents (arrows); patrol lanes (orange); shells (white). Returns a PNG data URL.
function drawMap(n) {
  const L = MazeLogic, lv = L.build(n, 'hard'), sol = L.solve(lv), C = 26, M = 18;
  const cv = document.createElement('canvas');
  cv.width = lv.W * C + 2 * M + 30; cv.height = lv.H * C + 2 * M + 22;
  const g = cv.getContext('2d'), X = (i) => M + (i % lv.W) * C + C / 2, Y = (i) => M + Math.floor(i / lv.W) * C + C / 2;
  const KEY = ['#ff4d8d', '#4cc9f0', '#7bd93f'];
  g.fillStyle = lv.dark ? '#0a1530' : '#0d3355'; g.fillRect(0, 0, cv.width, cv.height);
  g.lineCap = 'round'; g.lineWidth = C * 0.62; g.strokeStyle = lv.dark ? '#33507a' : '#5fa8d8';
  for (let i = 0; i < lv.N; i++) {
    g.beginPath(); g.moveTo(X(i), Y(i)); g.lineTo(X(i) + 0.01, Y(i)); g.stroke();
    for (const d of [1, 2]) if (lv.open[i] & (1 << d) && lv.nx[i * 4 + d] < lv.N) { const j = lv.nx[i * 4 + d]; g.beginPath(); g.moveTo(X(i), Y(i)); g.lineTo(X(j), Y(j)); g.stroke(); }
  }
  g.beginPath(); g.moveTo(X(lv.exit), Y(lv.exit)); g.lineTo(X(lv.exit) + C, Y(lv.exit)); g.stroke();
  // the best way out
  g.strokeStyle = 'rgba(255,214,90,0.9)'; g.lineWidth = 3; g.beginPath(); g.moveTo(X(lv.start), Y(lv.start));
  for (const s of sol.steps) for (const c of s.cells) g.lineTo(c < lv.N ? X(c) : X(lv.exit) + C, c < lv.N ? Y(c) : Y(lv.exit));
  g.stroke();
  for (const cur of lv.currents) {
    g.strokeStyle = '#c8f6ff'; g.lineWidth = 2.5;
    const a = cur.cells[0], b = cur.cells[cur.cells.length - 1], dx = L.DX[cur.dir], dy = L.DY[cur.dir], x1 = X(b) + dx * C * 0.45, y1 = Y(b) + dy * C * 0.45;
    g.beginPath(); g.moveTo(X(a) - dx * C * 0.45, Y(a) - dy * C * 0.45); g.lineTo(x1, y1); g.stroke();
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - dx * 7 - dy * 6, y1 - dy * 7 - dx * 6); g.moveTo(x1, y1); g.lineTo(x1 - dx * 7 + dy * 6, y1 - dy * 7 + dx * 6); g.stroke();
  }
  for (const p of lv.patrols) { g.strokeStyle = 'rgba(255,150,40,0.85)'; g.lineWidth = 7; g.beginPath(); g.moveTo(X(p.cells[0]), Y(p.cells[0])); g.lineTo(X(p.cells[p.cells.length - 1]), Y(p.cells[p.cells.length - 1])); g.stroke(); }
  for (const c of lv.shells) { g.fillStyle = '#fff'; g.beginPath(); g.arc(X(c), Y(c) + 6, 4, 0, 7); g.fill(); }
  lv.gates.forEach((gt, k) => {
    const mx = (X(gt.a) + X(gt.b)) / 2, my = (Y(gt.a) + Y(gt.b)) / 2, vert = gt.dir === 1 || gt.dir === 3;
    g.strokeStyle = KEY[k]; g.lineWidth = 5; g.beginPath();
    if (vert) { g.moveTo(mx, my - C * 0.4); g.lineTo(mx, my + C * 0.4); } else { g.moveTo(mx - C * 0.4, my); g.lineTo(mx + C * 0.4, my); }
    g.stroke();
  });
  lv.keys.forEach((kk, k) => {
    g.fillStyle = KEY[k]; g.beginPath(); g.arc(X(kk.cell), Y(kk.cell), 8, 0, 7); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 11px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(k + 1), X(kk.cell), Y(kk.cell) + 0.5);
  });
  g.fillStyle = '#ff6fb0'; g.beginPath(); g.arc(X(lv.start), Y(lv.start), 7, 0, 7); g.fill();
  g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(X(lv.exit) + C, Y(lv.exit), 7, 0, 7); g.fill();
  g.fillStyle = '#cfe6ff'; g.font = '13px system-ui'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(`Hard ${n}: ${lv.W}x${lv.H}, par ${sol.par}${lv.dark ? ', dark ' + lv.dark : ''}`, M, cv.height - 6);
  return cv.toDataURL('image/png');
}

