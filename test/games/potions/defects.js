// Potion Colours: do the checks bite? Break a copy of the game on purpose, one defect at a time, and run the tests on it.
//   node test/games/potions/defects.js            every defect: the rule ones (Node, seconds each), then the browser
//                                                 ones (headless Chrome, up to a few minutes each), then one soak
//   node test/games/potions/defects.js rules      only the ones verify.js must catch
//   node test/games/potions/defects.js browser    only the ones browser.js must catch
//   node test/games/potions/defects.js soak       only the leak soak.js must catch
// Each defect is one or more exact pieces of text swapped for others in a copy under <repo>/.local/defects. A defect whose
// text is no longer in the file is an error (the game has changed and the defect must be written again), and so is an
// unbroken copy that fails. Prints "N injected, N caught" and exits non-zero unless every defect is injected AND caught.
'use strict';
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'web/games/potions');
const FAIRY = path.join(ROOT, 'web/fairy');
const WORK = path.join(ROOT, '.local/defects-potions');
const which = process.argv[2] || 'all';
const ONLY = process.env.DEFECT || '';   // DEFECT=<part of a name> runs just the defects whose name contains it

// edits: [{ file, find, put }] (file is under web/games/potions unless it starts with fairy/)
const D = (name, file, find, put, extra) => Object.assign({ name, edits: [{ file, find, put }] }, extra || {});
const RULES = [
  { name: 'a round with two recipes: two sets make one colour and the dealer no longer checks', edits: [
    { file: 'logic.js', find: "{ set: ['yellow', 'white'], colour: '#fff3a8', name: 'pale yellow' }", put: "{ set: ['yellow', 'white'], colour: '#ff9ec4', name: 'pale yellow' }" },
    { file: 'logic.js', find: 'if (ways.length !== 1 || keyOf(ways[0]) !== keyOf(rec)) return null;', put: '' }] },
  D('two sets of bottles share a colour (maroon is red)', 'logic.js', "{ set: ['red', 'black'], colour: '#7a1630', name: 'maroon' }", "{ set: ['red', 'black'], colour: '#e53935', name: 'maroon' }"),
  D('a wrong mix is accepted', 'logic.js', 'if (colour !== this.flower.colour) {', 'if (colour === null) {'),
  D('the table is asymmetric: the order of the bottles matters', 'logic.js', '    idx.sort((p, q) => p - q);\n', ''),
  D('a decoy that is needed: the second flower of a double round may use a fourth bottle', 'logic.js', '&& new Set(first.concat(s)).size <= 3 && (first.length < 3 || s.every((b) => first.includes(b))));', ');'),
  D('undo does not return the last bottle, it returns the first', 'logic.js', 'const id = this.poured.pop(); this.undos++;', 'const id = this.poured.shift(); this.undos++;'),
  D('undo is refused once the last bottle is in (while the colours blend)', 'logic.js', "(this.phase !== 'filling' && this.phase !== 'mixing')", "this.phase !== 'filling'"),
  D('three wrong mixes still earn two stars', 'logic.js', 'wrongs <= 2 ? 2 : 1', 'wrongs <= 3 ? 2 : 1'),
  D('one wrong mix still earns three stars', 'logic.js', '(wrongs === 0 ? 3', '(wrongs <= 1 ? 3'),
  D('a mode does not scale: the snap is the same on every mode', 'logic.js', 'const SNAP = { easy: 105, medium: 70, hard: 49 };', 'const SNAP = { easy: 70, medium: 70, hard: 70 };'),
  D('a mode does not scale: the hint comes at the same time on every mode', 'logic.js', 'const HINT_S = { easy: 8, medium: 15, hard: 25 };', 'const HINT_S = { easy: 15, medium: 15, hard: 15 };'),
  D('a mode does not scale: the dots show on Medium and Hard too', 'logic.js', "dots: mode === 'easy' && n <= 3,", 'dots: n <= 3,'),
  D('Medium asks a three-bottle mix three levels too early', 'logic.js', 'medium: { 14: 1, 15: 1,', 'medium: { 11: 1, 14: 1, 15: 1,'),
  D('a level gets easier as it goes: the pool of mixes falls at level 7', 'logic.js', 'if (n <= 6) return PASTELS.concat(SECONDARIES);', 'if (n <= 6) return PASTELS.concat(SECONDARIES, DARKS);'),
  D('every level drifts (the seed changes)', 'logic.js', '(0x504f5400 + n * 131', '(0x504f5400 + n * 132'),
  D('one Hard level drifts (level 12 gains a three-bottle round)', 'logic.js', 'hard: { 11: 1, 12: 1, 13: 2,', 'hard: { 11: 1, 12: 2, 13: 2,'),
  D('a bloom earns no coin', 'logic.js', 'this.blooms++; this.coins++;', 'this.blooms++;'),
  D('a wrong mix costs a coin', 'logic.js', 'this.wrongs++; this.poured = [];', 'this.wrongs++; this.coins--; this.poured = [];'),
  D('the same bottle can be poured twice', 'logic.js', "if (this.poured.includes(id)) return { type: 'ignored', why: 'already' };", ''),
  D('swatch colour is not the recipe colour (the flower asks for its first bottle only)', 'logic.js', 'flowers.push({ recipe: rec.slice(), colour, size: rec.length });', 'flowers.push({ recipe: rec.slice(), colour: mixColour(rec.slice(0, 1)), size: rec.length });'),
  D('finishing a level opens nothing new', 'logic.js', 'sv.unlocked[mode] = Math.min(NLEV, Math.max(sv.unlocked[mode], n + 1));', 'sv.unlocked[mode] = Math.min(NLEV, Math.max(sv.unlocked[mode], n));'),
  D('finishing a level in one mode opens the next level in every mode', 'logic.js', 'sv.unlocked[mode] = Math.min(NLEV, Math.max(sv.unlocked[mode], n + 1));', 'for (const m2 of MODES) sv.unlocked[m2] = Math.min(NLEV, Math.max(sv.unlocked[m2], n + 1));'),
  D('a worse replay lowers the stars', 'logic.js', 'sv.stars[mode][n - 1] = Math.max(sv.stars[mode][n - 1], stars);', 'sv.stars[mode][n - 1] = stars;'),
  D('World 2 opens a level early', 'logic.js', 'sv.unlocked[mode] > 10', 'sv.unlocked[mode] > 9'),
  D('a saved game forgets its stars', 'logic.js', 'sv.stars[m] = Array.from({ length: NLEV }, (_, i) => int(st[i], 0, 3, 0));', 'sv.stars[m] = new Array(NLEV).fill(0);'),
  D('peach is moved to where it is too close to pale yellow (and no longer matches the docs)', 'logic.js', "{ set: ['red', 'yellow', 'white'], colour: '#ffb38a', name: 'peach' }", "{ set: ['red', 'yellow', 'white'], colour: '#ffc9a0', name: 'peach' }"),
  D('a bottle let go beside the cauldron does not snap (the snap is ignored)', 'logic.js', 'Math.hypot(bx - c.x, by - c.y) <= c.r + snap', 'Math.hypot(bx - c.x, by - c.y) <= c.r'),
  D('the mix completes one bottle early', 'logic.js', 'this.poured.length >= this.flower.recipe.length;', 'this.poured.length >= this.flower.recipe.length - 1;'),
  D('the hint points at a bottle that is already in the cauldron', 'logic.js', 'const id = this.table.find((b) => rec.includes(b) && !this.poured.includes(b));', 'const id = this.table.find((b) => rec.includes(b));'),
  D('a mix can be finished that was never completed', 'logic.js', "if (this.phase !== 'mixing') return { type: 'ignored' };", "if (this.phase === 'done') return { type: 'ignored' };"),
];
const BROWSER = [
  D('the home button goes to the wrong page', 'game.js', "HUB = '../../index.html'", "HUB = '../index.html'", { only: 'seeker' }),
  D('window.__back is missing', 'game.js', 'window.__back = () => { persist(); location.href = HUB; return true; };', '', { only: 'seeker' }),
  D('the device pixel ratio is not capped', '../../fairy/fairy.js', "Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2.5)", "((typeof window !== 'undefined' && window.devicePixelRatio) || 1)", { only: 'seeker' }),
  D("saved under another game's key", 'game.js', "SAVE_KEY = 'game.potions.save'", "SAVE_KEY = 'game.pop.save'", { only: 'seeker' }),
  D("the game writes the main game's save", 'game.js', '  function persist() { store.set(SAVE_KEY, JSON.stringify(save)); counters.persists++; }', "  function persist() { store.set(SAVE_KEY, JSON.stringify(save)); store.set(MAIN_KEY, JSON.stringify({ muted })); counters.persists++; }", { only: 'seeker' }),
  D('the mute switch is ignored', 'game.js', '  let muted = readMuted();', '  let muted = false;', { only: 'seeker' }),
  D('the level bubbles are too small to tap (16vh)', 'index.html', '--w:min(21vh, calc((100vw - 8vw) / 5.5))', '--w:min(16vh, calc((100vw - 8vw) / 5.5))', { only: 'seeker' }),
  D('the bottles are too small to tap (a 60-unit touch circle)', 'game.js', 'const BOTTLE_HIT = 62;', 'const BOTTLE_HIT = 30;', { only: 'seeker' }),
  D('the flower blooms in a different colour from its swatch', 'game.js', 'A.drawFlower(p.x, p.y, A.FLOWER_SCALE, f.bloom, f.hex, clock,', "A.drawFlower(p.x, p.y, A.FLOWER_SCALE, f.bloom, '#ff00ff', clock,", { only: 'seeker' }),
  D('the swatch in the thought bubble is not the colour the flower wants', 'game.js', 'A.drawBubble(p.x, p.by, f.hex, dots,', "A.drawBubble(p.x, p.by, '#00e0e0', dots,", { only: 'seeker' }),
  D('the liquid is the colour of the last bottle, not of the mix', 'game.js', 'c.to = A.hexRgb(L.mixColour(c.layers));\n    c.blend = had ? 0 : 1;', 'c.to = A.hexRgb(b.hex);\n    c.blend = had ? 0 : 1;', { only: 'seeker' }),
  D('undo does not free the bottle', 'game.js', "b.used = false; b.state = 'back'; b.t = 0;", "b.used = true; b.state = 'back'; b.t = 0;", { only: 'seeker' }),
  D('a tap on the cauldron does not undo', 'game.js', 'if (hitCauldron(p.x, p.y)) { counters.cauldronTaps++; requestUndo(); return; }', 'if (hitCauldron(p.x, p.y)) { counters.cauldronTaps++; return; }', { only: 'seeker' }),
  D('the flower does not tilt its head after a wrong mix', 'game.js', '    fl.tiltT = 0;\n', '', { only: 'seeker' }),
  D('the bottles are not refilled after a wrong mix', 'game.js', '      b.used = false;\n      later(0.1 + kk * 0.13', '      later(0.1 + kk * 0.13', { only: 'seeker' }),
  D('a bottle let go beside the cauldron snaps from the same distance in every mode', 'game.js', 'if (L.overCauldron(b.x, b.y, { x: c.x, y: c.y, r: c.r }, run.cfg.snap)) requestPour(b);', 'if (L.overCauldron(b.x, b.y, { x: c.x, y: c.y, r: c.r }, 105)) requestPour(b);', { only: 'seeker' }),
  D('the hint hand never appears', 'game.js', 'if (r.idle >= wait) {', 'if (false) {', { only: 'seeker' }),
  D('the hint comes twenty times too late', 'game.js', 'const wait = first ? Math.min(r.cfg.hint, 3.5) : r.cfg.hint;', 'const wait = first ? Math.min(r.cfg.hint, 3.5) : r.cfg.hint * 20;', { only: 'seeker' }),
  D('the stars and the next level are not saved', 'game.js', 'L.record(save, r.mode, r.n, r.stars, r.chestCoins, 0, 0);', '', { only: 'seeker' }),
  D('the treasure chest never comes', 'game.js', 'if (res.levelDone) startWin(); else advanceAfterBloom(fi, res);', 'if (res.levelDone) { /* no chest */ } else advanceAfterBloom(fi, res);', { only: 'seeker' }),
  D('the coin count jumps by two', 'game.js', 'run.hud++; run.hudPulse = 0.5;', 'run.hud += 2; run.hudPulse = 0.5;', { only: 'seeker' }),
  D('every level is open on the map', 'game.js', 'locked = n > prog.unlocked,', 'locked = false,', { only: 'seeker' }),
  D('no rotate overlay when held upright', 'index.html', '@media (orientation: portrait) { #rotate { display:flex; } }', '', { only: 'seeker' }),
];
const SOAK = [
  D('a little memory is kept every frame (a leak)', 'game.js', '    stepIsabella(dt);\n    A.stepParts(dt);\n  }', '    stepIsabella(dt);\n    A.stepParts(dt);\n    (window.__kept = window.__kept || []).push(new Array(40).fill(dt));\n  }', { must: /flat false/ }),
];

function copyGame(tag, d) {
  const web = path.join(WORK, tag), dir = path.join(web, 'games/potions');
  fs.rmSync(web, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.mkdirSync(path.join(web, 'fairy'), { recursive: true });
  for (const f of fs.readdirSync(FAIRY)) fs.copyFileSync(path.join(FAIRY, f), path.join(web, 'fairy', f));
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>hub stand-in</title>');
  if (d) {
    for (const e of d.edits) {
      const file = path.join(dir, e.file), src = fs.readFileSync(file, 'utf8'), n = src.split(e.find).length - 1;
      if (n !== 1) return { web, dir, error: `the text to break is in ${e.file} ${n} times (it must be there exactly once)` };
      fs.writeFileSync(file, src.replace(e.find, () => e.put));
    }
  }
  return { web, dir };
}
function run(cmd, args, env) {
  const r = spawnSync('node', [path.join(__dirname, cmd), ...args], { env: Object.assign({}, process.env, env), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  return { code: r.status, out, fails: out.split('\n').filter((l) => /^FAIL|SOAK FAIL|crashed/.test(l)).map((l) => l.replace(/^FAIL\s+/, '').slice(0, 150)) };
}
const rows = [];
function report(kind, d, r, copyError, must) {
  const caught = !copyError && r.code !== 0 && r.fails.length > 0 && (!must || must.test(r.out));
  rows.push({ kind, name: d.name, injected: !copyError, caught, by: copyError || r.fails.slice(0, 3) });
  console.log(`${copyError ? 'NOT INJECTED' : caught ? 'CAUGHT ' : 'MISSED '}  [${kind}] ${d.name}`);
  if (copyError) console.log('          ' + copyError);
  else for (const f of r.fails.slice(0, 2)) console.log('          <- ' + f);
}

fs.mkdirSync(WORK, { recursive: true });
if (which === 'all' || which === 'rules') {
  const clean = copyGame('clean');
  const base = run('verify.js', [], { POTIONS_LOGIC: path.join(clean.dir, 'logic.js') });
  if (base.code !== 0) { console.log('an UNBROKEN copy fails verify.js: fix that first\n' + base.fails.join('\n')); process.exit(2); }
  console.log('unbroken copy: verify.js passes');
  RULES.forEach((d, i) => {
    if (ONLY && !d.name.includes(ONLY)) return;
    const c = copyGame('rule-' + (i + 1), d);
    report('rules', d, c.error ? null : run('verify.js', [], { POTIONS_LOGIC: path.join(c.dir, 'logic.js') }), c.error);
  });
}
if (which === 'all' || which === 'browser') {
  BROWSER.forEach((d, i) => {
    if (ONLY && !d.name.includes(ONLY)) return;
    const c = copyGame('browser-' + (i + 1), d);
    report('browser', d, c.error ? null : run('browser.js', [path.join(WORK, 'shots-' + (i + 1)), path.join(WORK, 'chrome'), '--only=' + d.only, '--bail'], { POTIONS_WEB: c.web }), c.error);
  });
}
if (which === 'all' || which === 'soak') {
  // the control first: an unbroken copy, soaked for the same 90 seconds, must show flat memory
  const clean = copyGame('clean-soak');
  const base = run('soak.js', [path.join(WORK, 'soak-out-clean'), path.join(WORK, 'chrome'), '90'], { POTIONS_WEB: clean.web });
  if (!/SOAK PASS|flat true/.test(base.out)) { console.log('an UNBROKEN copy does not show flat memory in a 90 s soak: fix that first\n' + base.out.slice(-400)); process.exit(2); }
  console.log('unbroken copy: a 90 s soak shows flat memory');
  SOAK.forEach((d, i) => {
    const c = copyGame('soak-' + (i + 1), d);
    report('soak', d, c.error ? null : run('soak.js', [path.join(WORK, 'soak-out-' + (i + 1)), path.join(WORK, 'chrome'), '90'], { POTIONS_WEB: c.web }), c.error, d.must);
  });
}
const injected = rows.filter((r) => r.injected).length, caught = rows.filter((r) => r.caught).length;
fs.writeFileSync(path.join(WORK, 'defects.json'), JSON.stringify(rows, null, 2));
console.log(`\n${rows.length} defects: ${injected} injected, ${caught} caught`);
console.log(`${injected} injected, ${caught} caught`);
process.exit(injected === rows.length && caught === rows.length && rows.length > 0 ? 0 : 1);
