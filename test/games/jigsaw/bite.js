// Do the checks bite? Breaks a copy of Sea Jigsaw on purpose, one defect at a time, and makes sure the tests notice.
//   node test/games/jigsaw/bite.js            every defect (about 20 minutes: the browser ones are slow)
//   node test/games/jigsaw/bite.js verify     only the defects verify.js should catch (about a minute)
//   node test/games/jigsaw/bite.js browser    only the ones that need the browser test
//   node test/games/jigsaw/bite.js soak       only the one that needs the soak
//   node test/games/jigsaw/bite.js <id> ...   just these
// The game is copied to <repo>/.local/bite/web/games/jigsaw (never edited in place); each defect is a small text
// change to that copy. A defect is "caught" when the test exits non-zero AND a FAIL line names the right check.
// Before any defect, the untouched copy must pass (so a failure really is the defect), and every defect's anchor
// must be found exactly once in the source (so a defect can never silently stop being injected).
'use strict';
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'web/games/jigsaw');
const WORK = path.join(ROOT, '.local/bite');
const COPY = path.join(WORK, 'web/games/jigsaw');

// edits: [file, text to find (exactly once), what to put there]. expect: the failing check must match this.
const DEFECTS = [
  // ----- caught by verify.js -----
  { id: 'cut-left-open', by: 'verify', what: 'a piece walks its bottom edge the wrong way, so its outline never closes',
    edits: [['logic.js', 'else { back(path, h[c][r]); sides.b = hd[c][r]; }', 'else { fwd(path, h[c][r]); sides.b = hd[c][r]; }']], expect: /closed outline that goes round its four corners/ },
  { id: 'tab-too-big', by: 'verify', what: 'tabs twice the size, so they run into each other',
    edits: [['logic.js', '0.092 + R() * 0.012', '0.19 + R() * 0.012']], expect: /every tab meets its blank|crosses itself/ },
  { id: 'two-pieces-one-home', by: 'verify', what: 'the last column of pieces is given the homes of the column before',
    edits: [['logic.js', 'hx: (c + 0.5) * cw', 'hx: (Math.min(c, cols - 2) + 0.5) * cw']], expect: /exactly one home/ },
  { id: 'edge-not-shared', by: 'verify', what: 'the second piece along an edge is cut a few units off the first, leaving a gap',
    edits: [['logic.js', "path.push(['C', ...E[8], ...E[7], ...E[6]],", "path.push(['C', E[8][0] + 3, E[8][1] + 3, ...E[7], ...E[6]],"]], expect: /shared by exactly two pieces/ },
  { id: 'no-base-coins-when-slow', by: 'verify', what: 'a finish after all the bonus coins have gone pays nothing',
    edits: [['logic.js', 'total: M.base + bonus * M.bonusEach };', 'total: bonus ? M.base + bonus * M.bonusEach : 0 };']], expect: /base is always given/ },
  { id: 'bonus-never-drains', by: 'verify', what: 'the bonus coins stay for a hundred times too long',
    edits: [['logic.js', 'if (t >= s) left--;', 'if (t >= s * 100) left--;']], expect: /drift away one at a time/ },
  { id: 'a-puzzle-gets-easier', by: 'verify', what: 'Easy 5 is cut into 4 pieces instead of 6, so the count goes down',
    edits: [['logic.js', "['whale', 3, 2, 105]", "['whale', 2, 2, 105]"]], expect: /piece counts rise/ },
  { id: 'a-piece-in-two-places', by: 'verify', what: 'a piece dropped on the board keeps its tray slot as well',
    edits: [['logic.js', "      if (slot >= 0) this.slots[slot] = -1;\n      this.state[id] = 'loose'; this.misses++;", "      this.state[id] = 'loose'; this.misses++;"]], expect: /wrong drop just stays|random play can never lose/ },
  { id: 'save-forgets-the-coins', by: 'verify', what: 'loading a save throws the coins away',
    edits: [['logic.js', 'sv.coins = int(s.coins, 0, 1e9) || 0;', 'sv.coins = 0;']], expect: /round trip/ },
  { id: 'hard-dealt-in-any-order', by: 'verify', what: 'Hard deals its pieces in any order instead of the frame first',
    edits: [['logic.js', 'out.sort((a, b) => ring(p, a) - ring(p, b) || at.get(a) - at.get(b));', '']], expect: /order pieces are dealt/ },
  { id: 'snap-from-a-neighbours-place', by: 'verify', what: 'Easy snaps a piece home from nearly a whole piece away',
    edits: [['logic.js', 'snap: 0.5, snapMin: 60, snapMax: 110', 'snap: 0.9, snapMin: 60, snapMax: 300']], expect: /magnetic snap/ },
  { id: 'a-picture-one-shade-off', by: 'verify', what: 'the turtle is drawn one step of green darker (nobody would see it)',
    edits: [['pictures.js', "creature('turtle', '#3fbf7f', 404, 262, 4.5", "creature('turtle', '#3fbf7e', 404, 262, 4.5"]], expect: /frozen: all thirty pictures/ },
  { id: 'a-painter-loses-a-restore', by: 'verify', what: 'the kelp painter saves the canvas state and never puts it back',
    edits: [['pictures.js', 'ctx.ellipse(s * 15, 0, 16, 6, 0, 0, TAU); ctx.fill(); ctx.restore(); }', 'ctx.ellipse(s * 15, 0, 16, 6, 0, 0, TAU); ctx.fill(); }']], expect: /balances its save/ },
  { id: 'the-same-picture-twice', by: 'verify', what: 'Easy 2 uses Easy 1\'s picture',
    edits: [['logic.js', "['turtle', 2, 2, 102]", "['hello', 2, 2, 102]"]], expect: /thirty different pictures/ },
  { id: 'pixel-ratio-uncapped', by: 'verify', what: 'the device pixel ratio is no longer capped at 2.5',
    edits: [['art.js', 'Math.min(window.devicePixelRatio || 1, 2.5)', '(window.devicePixelRatio || 1)']], expect: /bundle's contract/ },

  // ----- caught by browser.js: the play-through with real touches -----
  { id: 'pieces-never-snap', by: 'browser', part: 'suite', what: 'a piece let go near its place no longer goes home',
    edits: [['game.js', 'snapR: L.snapRadius(run.p) * run.lay.k, tray: T }));', 'snapR: 0, tray: T }));']], expect: /glides home and clicks in/ },
  { id: 'pieces-cut-from-the-wrong-place', by: 'browser', part: 'suite', what: 'every piece shows a bit of the picture 9 pixels to the side of its own',
    edits: [['art.js', 'g.drawImage(pic, 0, 0);\n      g.restore();', 'g.drawImage(pic, 9, 0);\n      g.restore();']], expect: /exactly its part of the picture/ },
  { id: 'piece-put-down-beside-its-place', by: 'browser', part: 'suite', what: 'a piece that goes home is drawn 12 pixels to the right of its place',
    edits: [['art.js', 'g.drawImage(sp.c, sp.sx, sp.sy);', 'g.drawImage(sp.c, sp.sx + 12, sp.sy);']], expect: /exactly its part of the picture/ },
  { id: 'clock-runs-before-the-first-touch', by: 'browser', part: 'suite', what: 'the bonus clock starts when the puzzle opens, not at the first touch',
    edits: [['game.js', 'const rules = new L.Run(p, save.runs[p.id]);', 'const rules = new L.Run(p, save.runs[p.id]); rules.start();']], expect: /clock has not started/ },
  { id: 'chest-never-opens', by: 'browser', part: 'suite', what: 'the key reaches the chest and nothing happens',
    edits: [['game.js', 'OPEN: 2.7,', 'OPEN: 99,']], expect: /chest opens and bursts/ },
  { id: 'finish-not-saved', by: 'browser', part: 'suite', what: 'a finished puzzle is not written to the save',
    edits: [['game.js', 'counters.finishes++; counters.coinsWon += r.won.total;\n    persist();', 'counters.finishes++; counters.coinsWon += r.won.total;']], expect: /saved: 8 coins/ },

  // ----- caught by browser.js: the once-only checks -----
  { id: 'a-picture-of-plain-water', by: 'browser', part: 'more', what: 'Hard 10\'s picture is painted as nothing but blue water',
    edits: [['pictures.js', "      f();\n      ctx.restore();", "      if (id === 'everyone') water(TH.everyone); else f();\n      ctx.restore();"]], expect: /no picture has a large flat area/ },
  { id: 'sound-button-wipes-the-main-save', by: 'browser', part: 'more', what: 'the sound button rewrites the whole of the main game\'s save',
    edits: [['game.js', 'obj.muted = !!on;\n    store.set(MAIN_KEY, JSON.stringify(obj));', 'store.set(MAIN_KEY, JSON.stringify({ muted: !!on }));']], expect: /changes only `muted`/ },
  { id: 'canvases-never-freed', by: 'browser', part: 'more', what: 'a finished puzzle\'s picture and pieces are never given back',
    edits: [['art.js', 'free(asset.pic); free(asset.board);\n    for (const sp of asset.sprites) { free(sp.c); free(sp.sh); }', '']], expect: /every canvas made is either in use or freed/ },

  // ----- caught by soak.js -----
  { id: 'results-card-piles-up', by: 'soak', what: 'every results card keeps the last one\'s key and coins as well',
    edits: [['game.js', 'loot.innerHTML = `<svg class="keyl"', 'loot.innerHTML += `<svg class="keyl"']], expect: /SOAK FAIL \(.*flat false/ },
];

// only the copy of the game is thrown away between runs (Chrome may still be closing its profile next door)
const wipe = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
function freshCopy() {
  wipe(path.join(WORK, 'web'));
  fs.mkdirSync(COPY, { recursive: true });
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(COPY, f));
  fs.writeFileSync(path.join(WORK, 'web/index.html'), '<!doctype html><title>hub</title>');   // somewhere for the home button to go
}
function inject(d) {
  freshCopy();
  for (const [file, find, put] of d.edits) {
    const f = path.join(COPY, file), src = fs.readFileSync(f, 'utf8'), n = src.split(find).length - 1;
    if (n !== 1) throw new Error(`${d.id}: its anchor is in ${file} ${n} times (it must be there exactly once): ${JSON.stringify(find.slice(0, 60))}`);
    fs.writeFileSync(f, src.replace(find, () => put));
  }
}
function run(by, part) {
  const env = Object.assign({}, process.env, { JIGSAW_DIR: COPY });
  let args;
  if (by === 'verify') args = [path.join(__dirname, 'verify.js')];
  else if (by === 'browser') { args = [path.join(__dirname, 'browser.js'), path.join(WORK, 'shots'), path.join(WORK, 'chrome')]; Object.assign(env, { JIGSAW_QUICK: '1', JIGSAW_BAIL: '1', JIGSAW_PART: part || '' }); }
  else args = [path.join(__dirname, 'soak.js'), path.join(WORK, 'soak'), path.join(WORK, 'chrome-soak'), '40'];
  const r = spawnSync(process.execPath, args, { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const want = process.argv.slice(2);
const chosen = DEFECTS.filter((d) => !want.length || want.includes(d.by) || want.includes(d.id));
if (!chosen.length) { console.log('no such defect; ids: ' + DEFECTS.map((d) => d.id).join(', ')); process.exit(2); }
// every anchor must be found before anything runs, whichever defects were asked for
for (const d of DEFECTS) inject(d);

const rows = [];
let bad = 0;
const groups = [...new Set(chosen.map((d) => d.by + (d.part ? ':' + d.part : '')))];
for (const g of groups) {
  const [by, part] = g.split(':');
  // the control: the untouched copy must pass this very run (for the short soak: its memory must be flat)
  freshCopy();
  const c = run(by, part);
  const controlOk = by === 'soak' ? /SOAK (PASS|FAIL \(.*flat true)/.test(c.out) && !/problems [1-9]/.test(c.out) : c.code === 0;
  console.log(`${controlOk ? 'ok    ' : 'BROKEN'}  control: the untouched game through ${by}${part ? ' (' + part + ')' : ''}${controlOk ? '' : '\n' + c.out.split('\n').filter((l) => /FAIL|crash|Error/.test(l)).slice(0, 5).join('\n')}`);
  if (!controlOk) { bad++; continue; }
  for (const d of chosen.filter((v) => v.by === by && (v.part || '') === (part || ''))) {
    inject(d);
    const r = run(by, part);
    const fails = r.out.split('\n').filter((l) => /^FAIL|^SOAK FAIL/.test(l));
    const caught = r.code !== 0 && fails.some((l) => d.expect.test(l));
    if (!caught) bad++;
    rows.push({ id: d.id, by: d.by, caught, first: fails[0] ? fails[0].slice(0, 150) : '(no failing check)' });
    console.log(`${caught ? 'CAUGHT' : 'MISSED'}  ${d.id} [${by}]: ${d.what}\n          -> ${fails[0] ? fails[0].slice(0, 170) : 'no check failed (exit ' + r.code + ')'}`);
  }
}
try { wipe(WORK); } catch (e) { /* a profile Chrome is still closing: it is under .local, which git ignores */ }
console.log(`\n${rows.length} injections, ${rows.filter((r) => r.caught).length} caught${bad ? ` (${bad} PROBLEMS)` : ''}`);
process.exit(bad ? 1 : 0);
