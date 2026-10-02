// Coral Maze: a visual sheet. Screenshots of every level, both level-select pages, the moments that matter
// (the swipe hand, the hint trail, a gate opening, a jellyfish bump, the dark water, the celebration) and the
// results card, plus one contact sheet of them all. For looking at, not asserting.
//   node test/games/maze/sheet.js [outDir] [chromeProfileDir] [width] [height]
//   (defaults: $TMPDIR/coral-maze-sheet, $TMPDIR/chrome-maze-sheet, 915 x 412 at the Seeker's 2.625; DevTools port 9454)
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');

const REPO = path.resolve(__dirname, '../../..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'coral-maze-sheet'));
const PROFILE = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'chrome-maze-sheet'));
const W = +(process.argv[4] || 915), H = +(process.argv[5] || 412), PORT = 9454;
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
    const tiles = shots.map((s) => `<figure><img src="file://${s.f}"><figcaption>${s.label}</figcaption></figure>`).join('');
    const html = path.join(OUT, 'contact.html');
    fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#123;font:13px system-ui;color:#cde}main{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:6px}figure{margin:0}img{width:100%;display:block;border-radius:4px}figcaption{padding:2px 0 4px}</style><main>${tiles}</main>`);
    await P.viewport(1600, 2400, 1);
    await P.goto('file://' + html);
    await sleep(800);
    const r = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, 'contact-sheet.png'), Buffer.from(r.data, 'base64'));
    console.log(`\n${shots.length} screenshots + contact-sheet.png in ${OUT}`);
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
})();
