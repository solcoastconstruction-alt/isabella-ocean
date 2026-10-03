// Sea Words in headless Chrome at the Seeker's landscape sizes (915x412 and 800x360 CSS px, DPR 2.625, touch).
//   node test/games/words/browser.js [outDir] [chromeProfileDir]
//   (defaults: $TMPDIR/sea-words-shots and $TMPDIR/chrome-words; DevTools port 9457)
// At each size, from a fresh save, every step with real fingers through Input.dispatchTouchEvent:
//   the picker (three picture-only sizes, 19vh+ targets, nothing overlapping) -> Easy: a wrong line finds nothing and
//   fades; the word dragged with a wobbly finger is found; the treasure-chest celebration; the results card; Next
//   gives a different word -> Medium: every word dragged (some from the last letter back), a diagonal among them ->
//   Hard: all fourteen dragged, starting and ending off-centre, including backwards and diagonal words; 3 stars with
//   no hints -> progress saved under game.words.save survives a reload -> the home button goes to ../../index.html.
// Then, at 915x412: the hint after 20 s (Easy) and 40 s (Medium) of no progress and what it costs in Hard's stars;
// __wordsDebug.find; every picture drawn; mute shared with isabella.save (only its `muted` field, never an unreadable
// save); window.IsabellaStore; held upright; Android back; the frame rate. No console errors or exceptions anywhere.
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { serve, launch, openPage, sleep } = require('./cdp.js');

const REPO = path.resolve(__dirname, '../../..');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'sea-words-shots'));
const PROFILE = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'chrome-words'));
const PORT = 9457, DPR = 2.625;
const GAME = '/web/games/words/index.html';
const DX = { E: 1, SE: 1, S: 0, SW: -1, W: -1, NW: -1, N: 0, NE: 1 };
const BACKWARDS = new Set(['W', 'NW', 'N', 'SW']), DIAGONAL = new Set(['SE', 'SW', 'NE', 'NW']);

let fails = 0, checks = 0;
function check(ok, what, detail) {
  checks++;
  if (!ok) fails++;
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail != null ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const srv = await serve(REPO);
  const base = `http://127.0.0.1:${srv.port}`;
  const chrome = await launch({ port: PORT, profile: PROFILE, width: 915, height: 412 });
  let page;
  try {
    page = await openPage(PORT);
    const P = page;
    const st = () => P.eval('__wordsDebug.state');
    const shot = async (name) => { const f = await P.shot(path.join(OUT, name + '.png')); console.log(`        shot ${f}`); };
    const rectOf = (sel) => P.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, vis: getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' }; })()`);
    const tapEl = async (sel) => { const r = await rectOf(sel); await P.tap(r.x + r.w / 2, r.y + r.h / 2); await sleep(120); };
    const savedRaw = () => P.eval(`localStorage.getItem('game.words.save')`);
    // the save as stored (a missing or unreadable one reads as empty, so a check fails cleanly instead of crashing)
    const saved = async () => { let v = null; try { v = JSON.parse((await savedRaw()) || 'null'); } catch (e) { /* unreadable */ } v = v && typeof v === 'object' ? v : {}; v.solved = v.solved || {}; return v; };
    const cssOf = (c) => P.eval(`__wordsDebug.cellCss(${c[0]}, ${c[1]})`);
    // A real finger along a word: down near one end (off by `off` of a cell in a random direction), a wobbly path,
    // up near the other end. `fromEnd` starts on the last letter. `beforeEnd` runs with the finger still down.
    async function dragWord(w, o) {
      o = o || {};
      const s = await st(), cell = s.cell.px, off = o.off == null ? 0.25 : o.off, wob = o.wobble == null ? 0.25 : o.wobble;
      const c0 = o.fromEnd ? w.cells[w.cells.length - 1] : w.cells[0], c1 = o.fromEnd ? w.cells[0] : w.cells[w.cells.length - 1];
      const a = await cssOf(c0), b = await cssOf(c1);
      const jit = () => { const t = Math.random() * Math.PI * 2, r = off * cell; return [Math.cos(t) * r, Math.sin(t) * r]; };
      const j0 = o.startOff ? [o.startOff[0] * cell, o.startOff[1] * cell] : jit(), j1 = jit(), A = { x: a.x + j0[0], y: a.y + j0[1] }, B = { x: b.x + j1[0], y: b.y + j1[1] };
      const len = Math.hypot(B.x - A.x, B.y - A.y) || 1, nx = -(B.y - A.y) / len, ny = (B.x - A.x) / len, steps = o.steps || 12, pts = [A];
      for (let k = 1; k < steps; k++) { const u = k / steps, wv = Math.sin(u * Math.PI * 2.5) * wob * cell; pts.push({ x: A.x + (B.x - A.x) * u + nx * wv, y: A.y + (B.y - A.y) * u + ny * wv }); }
      pts.push(B);
      await P.drag(pts, 16, o.beforeEnd);
      await sleep(60);
    }

    for (const [W, H] of [[915, 412], [800, 360]]) {
      const tag = `${W}x${H}`, vh = H / 100;
      console.log(`\n${tag} CSS px at DPR ${DPR} (DevTools port ${PORT}, profile ${PROFILE})`);
      await P.viewport(W, H, DPR);
      await P.goto(base + GAME);
      await P.eval('localStorage.clear()');
      await P.goto(base + GAME);
      await sleep(600);
      let s = await st();
      check(s.screen === 'modes' && JSON.stringify(s.save.solved) === '{"easy":0,"medium":0,"hard":0}' && s.save.stars === 0, `${tag}: opens on the picker with a fresh save`);
      check(s.dpr === 2.5, `${tag}: canvas DPR capped at 2.5 (device ${DPR})`, s.dpr);
      const sizes = {};
      for (const sel of ['#mode-easy', '#mode-medium', '#mode-hard', '#homeBtn', '#soundBtn']) { const r = await rectOf(sel); sizes[sel] = +(Math.min(r.w, r.h) / vh).toFixed(1); }
      check(Object.values(sizes).every((v) => v >= 19), `${tag}: the three size buttons, home and sound are at least 19vh`, sizes);
      const ov = await P.eval(`(() => { const ids = ['title', 'mode-easy', 'mode-medium', 'mode-hard', 'cnt-easy', 'homeBtn', 'soundBtn'], r = ids.map((i) => (i.startsWith('cnt') ? document.getElementById(i).parentElement : document.getElementById(i)).getBoundingClientRect());
        r.push(document.querySelector('#modes .pill').getBoundingClientRect()); ids.push('pill');
        const out = []; for (let i = 0; i < r.length; i++) { const a = r[i];
          if (a.left < 0 || a.top < 0 || a.right > innerWidth + 0.5 || a.bottom > innerHeight + 0.5) out.push(ids[i] + ' off screen');
          for (let j = i + 1; j < r.length; j++) { const b = r[j]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) out.push(ids[i] + '/' + ids[j]); } }
        return out; })()`);
      check(ov.length === 0, `${tag}: title, size buttons, trophy counters, star count, home and sound do not overlap or leave the screen`, ov);
      check((await P.eval(`document.getElementById('modes').innerText.replace(/\\s+/g, ' ').trim()`)) === 'Sea Words 0 0 0 0', `${tag}: the picker shows no words for children to read (just the title and numbers)`);
      await shot(`${tag}-01-picker`);

      // ================= Easy =================
      await tapEl('#mode-easy');
      s = await st();
      const ew = s.words[0];
      check(s.screen === 'play' && s.mode === 'easy' && s.words.length === 1 && s.cols === Math.max(5, ew.word.length) && s.rows === s.cols && ['E', 'S'].includes(ew.dir),
        `${tag}: a tap on the small one starts Easy: one word (${ew.word}, reading ${ew.dir}) in a ${s.cols}x${s.rows} grid`);
      check(s.cell.vh >= (s.cols === 5 ? 16.5 : 14), `${tag}: Easy's letters are big: each cell ${s.cell.vh}vh (${s.cell.px} px) in its ${s.cols}x${s.rows} grid`);
      const home = await rectOf('#homeBtn'), modesR = await rectOf('#modesBtn');
      check(modesR.vis && +(Math.min(modesR.w, modesR.h) / vh).toFixed(1) >= 19 && s.layout.board.left >= home.x + home.w && s.layout.board.left >= modesR.x + modesR.w && s.layout.panel.right <= W && s.layout.board.bottom <= H && s.layout.board.top >= 0 && s.layout.board.right <= s.layout.panel.left,
        `${tag}: the board and the picture sit clear of the home and size buttons (both 19vh) and on screen`, s.layout);
      await sleep(500);
      await shot(`${tag}-02-easy`);
      // a wrong line: from a letter that is not the end of any word, two letters along
      const ends = new Set(s.words.flatMap((w) => [w.cells[0].join(), w.cells[w.cells.length - 1].join()]));
      let wrong = null;
      for (let y = 0; y < s.rows && !wrong; y++) for (let x = 0; x < s.cols && !wrong; x++) {
        if (ends.has(`${x},${y}`)) continue;
        for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]]) { const ex = x + 2 * dx, ey = y + 2 * dy; if (ex >= 0 && ey >= 0 && ex < s.cols && ey < s.rows) { wrong = [[x, y], [ex, ey]]; break; } }
      }
      const wa = await cssOf(wrong[0]), wb = await cssOf(wrong[1]);
      await P.drag([wa, { x: (wa.x + wb.x) / 2, y: (wa.y + wb.y) / 2 + 3 }, wb], 30);
      await sleep(80);
      s = await st();
      check(s.found.length === 0 && s.fading === 1 && s.phase === 'play', `${tag}: a wrong line (${wrong[0]} to ${wrong[1]}) finds nothing and starts to fade away`);
      await shot(`${tag}-03-easy-wrong-line`);
      await sleep(600);
      s = await st();
      check(s.fading === 0 && s.found.length === 0 && s.hints === 0 && s.phase === 'play', `${tag}: ...it is gone half a second later, with no penalty`);
      // the word, with a wobbly finger; the line jumps onto the word before the finger lifts
      let during = null;
      await dragWord(ew, { off: 0.3, wobble: 0.25, beforeEnd: async () => { await P.frames(2); during = await st(); } });
      check(during && during.selecting && during.selection.magnet === ew.word, `${tag}: while the finger is still down near the last letter, the line already sits on ${ew.word}`, during && during.selection);
      s = await st();
      check(s.found.join() === ew.word && (s.phase === 'won' || s.phase === 'win'), `${tag}: lifting the finger finds ${ew.word} (a wobbly drag, down and up a third of a cell off the letters)`);
      await sleep(350);
      await shot(`${tag}-04-easy-found`);
      await P.waitFor('__wordsDebug.state.phase === "win"', 3000, 'the celebration');
      await sleep(1700);
      check((await st()).particles > 40, `${tag}: the treasure chest bursts with coins and confetti`, (await st()).particles);
      await shot(`${tag}-05-easy-celebration`);
      await P.waitFor('__wordsDebug.state.screen === "results"', 6000, 'the results card');
      await sleep(900);
      const res = {};
      for (const sel of ['#resModes', '#resNext']) { const r = await rectOf(sel); res[sel] = +(Math.min(r.w, r.h) / vh).toFixed(1); }
      check(Object.values(res).every((v) => v >= 19), `${tag}: results buttons are at least 19vh`, res);
      const pic = await P.eval(`(() => { const c = document.querySelector('#resPics canvas'); if (!c) return null; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let on = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 40) on++; return { w: c.width, cssW: c.offsetWidth, on: on / (c.width * c.height) }; })()`);
      check(pic && pic.w >= Math.round(pic.cssW * 2.5) - 1 && pic.on > 0.08, `${tag}: the results card shows ${ew.word}'s picture, sharp (${pic && pic.w} px for ${pic && pic.cssW} CSS px)`, pic);
      let sv = await saved();
      check(sv.solved.easy === 1 && sv.solved.medium === 0 && sv.words === 1, `${tag}: saved under game.words.save: 1 Easy puzzle solved`, sv);
      await shot(`${tag}-06-easy-results`);
      await tapEl('#resNext');
      s = await st();
      check(s.screen === 'play' && s.mode === 'easy' && s.words[0].word !== ew.word, `${tag}: Next starts a new Easy puzzle with a different picture (${ew.word} -> ${s.words[0].word})`);
      await tapEl('#modesBtn');
      s = await st();
      check(s.screen === 'modes' && (await P.eval(`document.getElementById('cnt-easy').textContent`)) === '1', `${tag}: the size button in play goes back to the picker, where Easy's trophy count is 1`);

      // ================= Medium =================
      await tapEl('#mode-medium');
      s = await st();
      check(s.mode === 'medium' && s.cols === 8 && s.rows === 8 && s.words.length >= 3 && s.words.length <= 4 && s.words.every((w) => ['E', 'SE', 'S', 'NE'].includes(w.dir)) && s.words.some((w) => DIAGONAL.has(w.dir)),
        `${tag}: Medium: ${s.words.length} words in an 8x8 grid, all reading forwards, with a diagonal (${s.words.map((w) => w.word + ' ' + w.dir).join(', ')})`);
      check(s.cell.vh >= 10, `${tag}: Medium's cells are ${s.cell.vh}vh`);
      await sleep(500);
      const mw = s.words;
      for (let i = 0; i < mw.length; i++) {
        await dragWord(mw[i], { fromEnd: i === 1, off: 0.25 });
        const s2 = await st();
        if (!s2.found.includes(mw[i].word)) check(false, `${tag}: Medium ${mw[i].word} (${mw[i].dir}) found by a real drag`, s2.found);
        if (i === 0) { await sleep(700); await shot(`${tag}-07-medium-mid`); }
      }
      s = await st();
      const diagM = mw.find((w) => DIAGONAL.has(w.dir));
      check(s.found.length === mw.length && s.found.includes(diagM.word), `${tag}: every Medium word found with a real drag, the second one dragged from its last letter back to its first, the diagonal ${diagM.word} among them`);
      await P.waitFor('__wordsDebug.state.screen === "results"', 8000, 'the results card');
      await sleep(1400);
      await shot(`${tag}-08-medium-results`);
      sv = await saved();
      check(sv.solved.medium === 1, `${tag}: Medium's puzzle saved`, sv.solved);
      await tapEl('#resModes');

      // ================= Hard =================
      await tapEl('#mode-hard');
      s = await st();
      const back = s.words.filter((w) => BACKWARDS.has(w.dir)), diag = s.words.filter((w) => DIAGONAL.has(w.dir));
      check(s.mode === 'hard' && s.cols === 12 && s.rows === 12 && s.words.length === 14 && back.length >= 1 && diag.length >= 1,
        `${tag}: Hard: all 14 words in a 12x12 grid; ${back.length} read backwards (${back.map((w) => w.word + ' ' + w.dir).join(', ')}), ${diag.length} diagonal`);
      check(s.cell.vh >= 7, `${tag}: Hard's cells are smaller (${s.cell.vh}vh, ${s.cell.px} px), so the drag is forgiving`);
      await sleep(600);
      const hw = s.words;
      let k = 0, magnetSeen = false, perf = null, perfT0 = 0, nextCell = null;
      for (const w of hw) {
        const opt = { fromEnd: k % 3 === 2, off: 0.3, wobble: 0.22 };
        if (k === 13) {
          // the last word: the finger lands in the NEXT cell, 0.6 of a cell beside the first letter (not along the word)
          const c0 = w.cells[0], c1 = w.cells[1], dx = c1[0] - c0[0], dy = c1[1] - c0[1];
          for (const [px, py] of [[0, 0.6], [0, -0.6], [0.6, 0], [-0.6, 0]]) {
            if (Math.abs(px * dx + py * dy) / (0.6 * Math.hypot(dx, dy)) > 0.9) continue;   // along the word: skip
            const gx = c0[0] + 0.5 + px, gy = c0[1] + 0.5 + py;
            if (gx > 0 && gy > 0 && gx < s.cols && gy < s.rows) { opt.startOff = [px, py]; opt.fromEnd = false; nextCell = [Math.floor(gx), Math.floor(gy)]; break; }
          }
        }
        if (k === 4) opt.beforeEnd = async () => { await P.frames(2); const d = await st(); magnetSeen = d.selection && d.selection.magnet === w.word; await shot(`${tag}-09-hard-dragging`); };
        // the frame rate over three real drags and a pause (no screenshots in that stretch)
        if (k === 7) { await P.eval('__wordsDebug.resetPerf()'); perfT0 = Date.now(); }
        await dragWord(w, opt);
        if (k === 9) { await sleep(Math.max(0, 2500 - (Date.now() - perfT0))); perf = await P.eval('__wordsDebug.perf()'); }
        const s2 = await st();
        if (!s2.found.includes(w.word)) check(false, `${tag}: Hard ${w.word} (${w.dir}) found by a real drag`, { found: s2.found });
        if (k === 5) { await sleep(600); await shot(`${tag}-10-hard-mid`); }
        k++;
      }
      s = await st();
      check(s.found.length === 14, `${tag}: all 14 Hard words found with real drags (every third from its last letter; down and up a third of a cell off)`, s.found.length);
      check(back.every((w) => s.found.includes(w.word)) && diag.every((w) => s.found.includes(w.word)), `${tag}: ...including the backwards ${back[0].word} (${back[0].dir}) and the diagonal ${diag[0].word} (${diag[0].dir})`);
      check(magnetSeen, `${tag}: mid-drag, the line sits on the word before the finger lifts`);
      check(nextCell && s.found.includes(hw[13].word) && (nextCell[0] !== hw[13].cells[0][0] || nextCell[1] !== hw[13].cells[0][1]),
        `${tag}: ${hw[13].word} found even though the finger landed in the next cell (${nextCell}), 0.6 of a cell off its first letter (${hw[13].cells[0]})`);
      console.log(`        frame stats, Hard with real drags (headless, ${Math.round(W * 2.5)}x${Math.round(H * 2.5)} canvas): ${JSON.stringify(perf, (kk, v) => (typeof v === 'number' ? +v.toFixed(2) : v))}`);
      check(perf.fps > 50 && perf.drawP95Ms < 10, `${tag}: Hard draws at over 50 fps with p95 draw time under 10 ms`, { fps: +perf.fps.toFixed(1), p95: +perf.drawP95Ms.toFixed(2) });
      await P.waitFor('__wordsDebug.state.phase === "win"', 3000, 'the celebration');
      await sleep(1900);
      await shot(`${tag}-11-hard-celebration`);
      await P.waitFor('__wordsDebug.state.screen === "results"', 6000, 'the results card');
      await P.waitFor('document.querySelectorAll("#bigStars svg.pop").length === 3', 4000, 'the stars to pop');
      s = await st();
      check(s.resultsStars === 3 && s.hints === 0, `${tag}: Hard without a hint earns 3 stars (never anything about speed)`, { stars: s.resultsStars, hints: s.hints });
      await shot(`${tag}-12-hard-results`);
      sv = await saved();
      check(sv.solved.hard === 1 && sv.stars === 3, `${tag}: Hard's puzzle and its 3 stars saved`, sv);

      // ================= progress survives a reload =================
      await P.goto(base + GAME);
      await sleep(500);
      s = await st();
      const shown = await P.eval(`['easy', 'medium', 'hard'].map((m) => document.getElementById('cnt-' + m).textContent).join() + '|' + document.getElementById('starCount').textContent`);
      check(s.screen === 'modes' && JSON.stringify(s.save.solved) === '{"easy":1,"medium":1,"hard":1}' && s.save.stars === 3 && shown === '1,1,1|3', `${tag}: after a reload the picker still shows 1 / 1 / 1 trophies and 3 stars`, shown);
      await shot(`${tag}-13-picker-after`);

      // ================= home =================
      await tapEl('#mode-easy');
      await sleep(300);
      await tapEl('#homeBtn');
      await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the home button to reach the hub');
      check(true, `${tag}: the home button (mid-puzzle) goes to ../../index.html (the hub)`);
    }

    // ================= hints =================
    console.log('\nhints (915x412)');
    await P.viewport(915, 412, DPR);
    await P.goto(base + GAME);
    await sleep(400);
    await P.eval(`__wordsDebug.start('easy', 3)`);
    await sleep(500);
    let s = await st();
    await P.eval('__wordsDebug.idle(17.5)');
    await sleep(400);
    check((await st()).hint === null && (await st()).idle < 20, 'Easy: no hint before 20 s without progress');
    await P.eval(`__wordsDebug.idle(${19.4} - __wordsDebug.state.idle)`);
    await P.eval('__wordsDebug.idle(1.5)');
    await sleep(200);
    let h = (await st()).hint;
    check(h && h.word === s.words[0].word && h.cell.join() === s.words[0].cells[0].join(), `Easy: after 20 s the first letter of ${s.words[0].word} glows (cell ${h && h.cell})`);
    await sleep(500);
    await shot('hint-01-easy');
    await dragWord(s.words[0], { off: 0.2 });
    s = await st();
    check(s.hint === null && s.found.length === 1, 'finding the word puts the hint away');
    await P.eval(`__wordsDebug.start('medium', 8)`);
    await sleep(400);
    await P.eval('__wordsDebug.idle(37.5)');
    await sleep(300);
    check((await st()).hint === null && (await st()).idle < 40, 'Medium: no hint before 40 s');
    await P.eval(`__wordsDebug.idle(40.5 - __wordsDebug.state.idle)`);
    await sleep(300);
    s = await st();
    check(s.hint && s.hint.word === s.words[0].word, `Medium: after 40 s the first letter of the top word (${s.words[0].word}) glows`);
    await shot('hint-02-medium');
    // Hard: one hint costs a star
    await P.eval(`__wordsDebug.start('hard', 12)`);
    await sleep(400);
    await P.eval('__wordsDebug.idle(41)');
    await sleep(300);
    s = await st();
    check(s.hint && s.hints === 1, 'Hard: after 40 s a first letter glows');
    for (const w of s.words) await P.eval(`__wordsDebug.find(${JSON.stringify(w.word)})`);
    await P.waitFor('__wordsDebug.state.screen === "results"', 8000, 'the results card');
    check((await st()).resultsStars === 2, 'Hard with one hint earns 2 stars');

    // ================= the find hook, and the pictures =================
    console.log('\nthe test hook and the pictures');
    await P.eval(`__wordsDebug.start('medium', 21)`);
    await sleep(300);
    s = await st();
    check((await P.eval(`__wordsDebug.find(${JSON.stringify(s.words[0].word)})`)) === true && (await P.eval(`__wordsDebug.find(${JSON.stringify(s.words[0].word)})`)) === false && (await P.eval(`__wordsDebug.find('NOTAWORD')`)) === false,
      '__wordsDebug.find runs the drag check: true once, false for a word already found or not in the puzzle');
    const seedA = await P.eval(`(() => { __wordsDebug.start('hard', 777); return __wordsDebug.state.grid.join(''); })()`);
    const seedB = await P.eval(`(() => { __wordsDebug.start('hard', 777); return __wordsDebug.state.grid.join(''); })()`);
    const seedC = await P.eval(`(() => { __wordsDebug.start('hard', 778); return __wordsDebug.state.grid.join(''); })()`);
    const fresh1 = await P.eval(`(() => { __wordsDebug.start('hard'); return __wordsDebug.state.seed; })()`);
    const fresh2 = await P.eval(`(() => { __wordsDebug.start('hard'); return __wordsDebug.state.seed; })()`);
    check(seedA === seedB && seedA !== seedC && fresh1 !== fresh2, `start(mode, seed) replays a puzzle exactly; without a seed every puzzle gets a fresh random one (${fresh1}, ${fresh2})`);
    const pics = await P.eval('__wordsDebug.pictures()');
    const badPics = Object.entries(pics).filter(([, v]) => v.fill < 0.08 || v.edge > 0);
    check(Object.keys(pics).length === 14 && badPics.length === 0, `all 14 pictures are drawn, inside their boxes (${Object.entries(pics).map(([w, v]) => `${w} ${Math.round(v.fill * 100)}%`).join(', ')})`, badPics);

    // ================= sound: shared with the main game's save, carefully =================
    console.log('\nthe mute switch (shared with isabella.save)');
    const herSave = JSON.stringify({ unlocked: 20, stars: new Array(20).fill(3), gold: 5271, muted: false, played: true, crown: true });
    await P.eval(`localStorage.setItem('isabella.save', ${JSON.stringify(herSave)})`);
    await P.goto(base + GAME);
    await sleep(400);
    check((await st()).crown === true, 'Isabella wears her crown when the main game says she earned it');
    await tapEl('#soundBtn');
    await sleep(150);
    const main = JSON.parse(await P.eval(`localStorage.getItem('isabella.save')`));
    check(main.muted === true && (await st()).muted === true && JSON.stringify(Object.assign({}, main, { muted: false })) === herSave && (await P.eval(`document.querySelector('#soundBtn use').getAttribute('href')`)) === '#i-mute',
      'the sound switch mutes and writes muted:true into isabella.save, every other field untouched');
    await tapEl('#soundBtn');
    await sleep(150);
    check((await P.eval(`localStorage.getItem('isabella.save')`)) === herSave && (await st()).muted === false, 'switching back leaves isabella.save byte-for-byte as it was');
    await P.eval(`localStorage.setItem('isabella.save', '{not json')`);
    await P.goto(base + GAME);
    await sleep(300);
    await tapEl('#soundBtn');
    await sleep(150);
    check((await P.eval(`localStorage.getItem('isabella.save')`)) === '{not json' && (await st()).muted === true, 'an unreadable isabella.save is never overwritten (the switch still mutes this visit)');
    await P.eval(`localStorage.removeItem('isabella.save')`);

    // ================= inside the Android app: window.IsabellaStore =================
    console.log('\nwith window.IsabellaStore (as in the Android app)');
    const lsBefore = await savedRaw();
    const { identifier } = await P.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__fakeStore = { 'isabella.save': JSON.stringify({ muted: true, unlocked: 3 }), 'game.words.save': JSON.stringify({ v: 1, solved: { easy: 4, medium: 2, hard: 0 }, stars: 0, words: 12, last: 'medium' }) };
               window.IsabellaStore = { get: (k) => (k in window.__fakeStore ? window.__fakeStore[k] : null), set: (k, v) => { window.__fakeStore[k] = String(v); } };`,
    });
    await P.goto(base + GAME);
    await sleep(300);
    s = await st();
    check(s.muted === true && s.save.solved.easy === 4 && s.save.solved.medium === 2 && (await P.eval(`document.getElementById('cnt-easy').textContent`)) === '4', 'progress and mute come from IsabellaStore, not localStorage', { muted: s.muted, solved: s.save.solved });
    await tapEl('#mode-easy');
    s = await st();
    await dragWord(s.words[0], { off: 0.2 });
    await P.waitFor('__wordsDebug.state.screen === "results"', 8000, 'the results card');
    const fake = JSON.parse(await P.eval(`window.__fakeStore['game.words.save']`));
    check(fake.solved.easy === 5 && fake.solved.medium === 2 && (await savedRaw()) === lsBefore, 'the save is written to IsabellaStore under game.words.save; localStorage left alone', fake);
    check((await st()).gain === 0, 'muted for real: master gain 0 once sound has started');
    await P.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

    // held upright, the page asks to turn the phone
    await P.goto(base + GAME);
    await sleep(300);
    await P.viewport(412, 915, DPR);
    await sleep(200);
    check((await P.eval(`getComputedStyle(document.getElementById('rotate')).display`)) === 'flex', 'portrait shows the turn-the-phone picture');
    await P.viewport(915, 412, DPR);

    // Android back: straight to the hub, from the middle of a puzzle
    await P.eval(`__wordsDebug.start('hard')`);
    await sleep(500);
    const backed = await P.eval('window.__back()');
    await P.waitFor(`location.pathname === '/web/index.html'`, 5000, 'the back button to reach the hub');
    check(backed === true, 'window.__back() returns true and goes to ../../index.html');

    console.log('');
    check(page.errors.length === 0, 'no console errors, exceptions or failed loads on any page', page.errors);
  } catch (e) {
    fails++;
    console.log('  FAIL ' + (e.stack || e));
    if (page) console.log('  page errors: ' + JSON.stringify(page.errors));
    if (page) try { await page.shot(path.join(OUT, 'zz-failure.png')); } catch (e2) { /* ignore */ }
  } finally {
    if (page) page.close();
    await chrome.close();
    await srv.close();
  }
  console.log(`\n${checks - fails}/${checks} checks passed${fails ? `, ${fails} FAILED` : ''}. Screenshots in ${OUT}`);
  process.exit(fails ? 1 : 0);
})();
