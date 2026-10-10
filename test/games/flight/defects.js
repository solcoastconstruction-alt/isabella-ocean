// Fairy Flight: do the checks bite? Break a copy of the game on purpose, one defect at a time, and run the tests on it.
//   node test/games/flight/defects.js            every defect: the rule ones (Node, seconds each), then the browser ones
//                                                (headless Chrome, about a minute each), then one soak (2 minutes)
//   node test/games/flight/defects.js rules      only the ones verify.js must catch
//   node test/games/flight/defects.js browser    only the ones browser.js must catch
//   node test/games/flight/defects.js soak       only the leak soak.js must catch
// Each defect is one exact piece of text swapped for another in a copy under <repo>/.local/defects-flight. A defect whose text is no
// longer in the file is an error (the game has changed and the defect must be written again), and so is an unbroken copy that fails.
// The rule defects run verify.js without its two "frozen" checks (the sha1 of the table and of the 60 courses), so they have to be
// caught by what the rules do; the ones that change a course or the table (marked frozen) run with them, and a few of those must also be
// caught by the sweep. Exits non-zero unless every defect is injected AND caught. Prints "N injected, N caught".
'use strict';
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'web/games/flight');
const FAIRY = path.join(ROOT, 'web/fairy/fairy.js');
const WORK = path.join(ROOT, '.local/defects-flight');
const which = process.argv[2] || 'all';
const nameFilter = process.argv[3] || '';   // only the defects whose name contains this (for a quick re-run of one)

const RULES = [
  { name: 'coins can go below zero', file: 'logic.js',
    find: 'const lost = this.M.loss && this.coins > 0;', put: 'const lost = this.M.loss;' },
  { name: 'Easy loses a coin to a bonk', file: 'logic.js',
    find: "easy:   { speed: 0.8,  dust: 118, extra: 0,   slow: 0.7, bug: 0.8, loss: false },", put: "easy:   { speed: 0.8,  dust: 118, extra: 0,   slow: 0.7, bug: 0.8, loss: true }," },
  { name: 'a plant that never blooms', file: 'logic.js',
    find: 'if (dx * dx + dy * dy <= R * R) {', put: 'if (false) {' },
  { name: 'a plant brought to life pays no coin', file: 'logic.js',
    find: 'this.bloomAt[i] = t; this.bloomed++; this.coins++;', put: 'this.bloomAt[i] = t; this.bloomed++;' },
  { name: 'enemies can not bonk', file: 'logic.js',
    find: 'if (dx * dx + dy * dy < rr * rr) {', put: 'if (false) {' },
  { name: 'a bonk gives no shield, so one bump is many', file: 'logic.js',
    find: 'this.bonks++; this.shield = SHIELD; this.kick = KICK_T;', put: 'this.bonks++; this.shield = 0; this.kick = KICK_T;' },
  { name: 'a course with an unreachable plant (the fifth is up beyond the sky)', file: 'logic.js', frozen: true, must: /sweep/,
    find: 'plants.push({ id: i, x, kind, sup, tier, sz, by, hy, amp, om, ph });', put: 'plants.push({ id: i, x, kind, sup, tier, sz, by, hy: i === 4 ? -250 : hy, amp, om, ph });' },
  { name: 'a mode that does not scale: Hard is as slow as Medium', file: 'logic.js',
    find: 'hard:   { speed: 1.25, dust: 62,', put: 'hard:   { speed: 1,    dust: 62,' },
  { name: 'Easy\'s dust radius is not wide', file: 'logic.js',
    find: "easy:   { speed: 0.8,  dust: 118,", put: "easy:   { speed: 0.8,  dust: 70, " },
  { name: 'Hard\'s dust radius is not tight', file: 'logic.js',
    find: 'hard:   { speed: 1.25, dust: 62,', put: 'hard:   { speed: 1.25, dust: 90,' },
  { name: 'Easy keeps all the enemies', file: 'logic.js',
    find: "if (mode === 'easy') list = b.enemies.filter((e, i) => i % 2 === 0);", put: "if (mode === 'easy') list = b.enemies.slice();" },
  { name: 'Hard adds no enemies', file: 'logic.js',
    find: 'hard:   { speed: 1.25, dust: 62,  extra: 0.5,', put: 'hard:   { speed: 1.25, dust: 62,  extra: 0,  ' },
  { name: 'Easy\'s critters are no slower', file: 'logic.js',
    find: 've: r1(e.ve * (bug ? M.bug : M.slow)),', put: 've: e.ve,' },
  { name: 'two thirds of the plants earn 2 stars is now one half', file: 'logic.js',
    find: 'bloomed * 3 >= total * 2 ? 2 : 1', put: 'bloomed * 2 >= total ? 2 : 1' },
  { name: '3 stars without every plant (nine tenths is enough)', file: 'logic.js',
    find: 'function starsFor(bloomed, total) { return bloomed >= total ? 3', put: 'function starsFor(bloomed, total) { return bloomed * 10 >= total * 9 ? 3' },
  { name: 'the chest pays no coins', file: 'logic.js',
    find: 'this.coins += CHEST_COINS; this.chestCoins = CHEST_COINS;', put: 'this.chestCoins = 0;' },
  { name: 'without the key the key never floats over', file: 'logic.js',
    find: 'if (!this.keyGot && !this.keyFloat && since >= KEY_FLOAT_AT)', put: 'if (false)' },
  { name: 'the chest waits for a key that was not taken (it never opens)', file: 'logic.js',
    find: 'const need = this.keyGot && !this.keyFloat ? OPEN_KEY : OPEN_NOKEY;', put: 'const need = this.keyGot && !this.keyFloat ? OPEN_KEY : 1e9;' },
  { name: 'level 7 is one unit a second faster (a level drifting)', file: 'logic.js', frozen: true,
    find: '{ n: 7,  world: 1, theme: 2, secs: 52, speed: 125,', put: '{ n: 7,  world: 1, theme: 2, secs: 52, speed: 126,' },
  { name: 'the same seed gives a different course (the generator drifts)', file: 'logic.js', frozen: true,
    find: 'cfg.seed * 7919 + 13', put: 'cfg.seed * 7919 + 14' },
  { name: 'a saved game forgets its stars', file: 'logic.js',
    find: 'sv.stars[m] = Array.from({ length: NLEV }, (_, i) => int(st[i], 0, 3) || 0);', put: 'sv.stars[m] = new Array(NLEV).fill(0);' },
  { name: 'Isabella jumps to the finger instead of easing', file: 'logic.js',
    find: 'this.y = ease(this.y, aimY, dt, kY, vY);', put: 'this.y = aimY;' },
  { name: 'Isabella can fly off the top and bottom of the sky', file: 'logic.js',
    find: 'if (finger) { aimY = clamp(finger.y, Y_MIN, Y_MAX);', put: 'if (finger) { aimY = finger.y;' },
  { name: 'with no finger she stays where she was (no drift to the middle)', file: 'logic.js',
    find: 'else { aimY = Y_REST; aimX = PX_NOM;', put: 'else { aimY = this.y; aimX = PX_NOM;' },
  { name: 'the finger drags her sideways across the whole screen', file: 'logic.js',
    find: 'aimX = finger.x == null ? PX_NOM : clamp(finger.x, PX_LO, PX_HI);', put: 'aimX = finger.x == null ? PX_NOM : finger.x;' },
  { name: 'ground critters have no body (they can not bonk)', file: 'logic.js', frozen: true,
    find: 'const CRITTER_R = 30,', put: 'const CRITTER_R = 0,' },
  { name: 'a bloom takes two and a half seconds', file: 'logic.js',
    find: 'const BLOOM_T = 0.5;', put: 'const BLOOM_T = 2.5;' },
  { name: 'the scroll never stops, so the chest flies past', file: 'logic.js',
    find: 'if (t <= c.tb) return c.v * t;', put: 'return c.v * t;' },
  { name: 'the golden key can not be taken', file: 'logic.js',
    find: 'if (dx * dx + dy * dy <= KEY_R * KEY_R) { this.keyGot = true;', put: 'if (false) { this.keyGot = true;' },
  { name: 'a made-up mode name in the save is believed', file: 'logic.js',
    find: 'if (MODES.includes(s.mode)) sv.mode = s.mode;', put: 'sv.mode = s.mode || sv.mode;' },
];
const BROWSER = [
  { name: 'the home button goes to the wrong page', file: 'game.js', only: 'seeker',
    find: "HUB = '../../index.html'", put: "HUB = '../index.html'" },
  { name: 'window.__back is missing', file: 'game.js', only: 'seeker',
    find: "window.__back = () => {\n    if (screen === 'play' || screen === 'results') { persist(); goLevels(); return true; }\n    persist(); location.href = HUB; return true;\n  };", put: '' },
  { name: 'window.__back from a course goes straight home instead of to the level map', file: 'game.js', only: 'seeker',
    find: "    if (screen === 'play' || screen === 'results') { persist(); goLevels(); return true; }\n", put: '' },
  { name: 'the device pixel ratio is not capped', file: '../../fairy/fairy.js', only: 'seeker',
    find: "const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2.5);", put: "const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;" },
  { name: 'Isabella ignores the finger as it slides', file: 'game.js', only: 'seeker',
    find: '    run.finger = { x: p.x, y: p.y };\n    run.idle = 0;\n    counters.moves++;', put: '    run.idle = 0;\n    counters.moves++;' },
  { name: 'Isabella ignores where the finger lands (only slides count)', file: 'game.js', only: 'seeker',
    find: 'activeId = e.pointerId; run.finger = { x: p.x, y: p.y };', put: 'activeId = e.pointerId; run.finger = null;' },
  { name: 'a lost coin stays on show in the coin row', file: 'game.js', only: 'seeker',
    find: '    if (run.hud > 0) {\n      run.hud--;', put: '    if (run.hud > 0) {' },
  { name: 'the results never come after the chest', file: 'game.js', only: 'seeker',
    find: 'later(2.4, showResults);', put: '' },
  { name: 'the stars are not saved', file: 'game.js', only: 'seeker',
    find: '    save.stars[r.mode][n - 1] = Math.max(save.stars[r.mode][n - 1], R.stars);\n', put: '' },
  { name: 'the next level is not unlocked', file: 'game.js', only: 'seeker',
    find: '    save.unlocked[r.mode] = Math.min(NLEV, Math.max(save.unlocked[r.mode], n + 1));\n', put: '' },
  { name: 'saved under another game\'s key', file: 'game.js', only: 'seeker',
    find: "SAVE_KEY = 'game.flight.save'", put: "SAVE_KEY = 'game.catch.save'" },
  { name: 'the mode picker does nothing (always Medium)', file: 'game.js', only: 'seeker',
    find: "for (const m of L.MODES) tap('mode-' + m, () => setMode(m));", put: "for (const m of L.MODES) tap('mode-' + m, () => setMode('medium'));" },
  { name: 'the arrow to World 2 does nothing', file: 'game.js', only: 'seeker',
    find: "tap('pgNext', () => setPage(page + 1));", put: "tap('pgNext', () => {});" },
  { name: 'no hand shows the slide on level 1', file: 'game.js', only: 'seeker',
    find: 'const firstTime = r.n === 1 && !r.everBloomed && r.pt > 0.8;', put: 'const firstTime = false;' },
  { name: 'a bloom\'s coin never flies to the row', file: 'game.js', only: 'seeker',
    find: '      r.owed++; r.flyCoins.push({ t: -0.25, x0: e.x, y0: e.y - 18 });\n', put: '' },
  { name: 'the level bubbles are too small to tap (17vh)', file: 'index.html', only: 'seeker',
    find: '.lvl { width:21vh; height:21vh;', put: '.lvl { width:17vh; height:17vh;' },
  { name: 'the home button is too small to tap (12vh)', file: 'index.html', only: 'seeker',
    find: '#home { position:fixed; top:1.5vh; left:max(1.5vh, env(safe-area-inset-left)); width:19vh; height:19vh;', put: '#home { position:fixed; top:1.5vh; left:max(1.5vh, env(safe-area-inset-left)); width:12vh; height:12vh;' },
  { name: 'the game writes the main game\'s save', file: 'game.js', only: 'more',
    find: '    store.set(SAVE_KEY, JSON.stringify(save));\n', put: "    store.set(SAVE_KEY, JSON.stringify(save));\n    store.set('isabella.save', JSON.stringify({ muted }));\n" },
  { name: 'the mute switch is ignored', file: 'game.js', only: 'more',
    find: '  let muted = readMuted();', put: '  let muted = false;' },
  { name: 'the rotate overlay is missing', file: 'index.html', only: 'more',
    find: '@media (orientation: portrait) { #rotate { display:flex; } }', put: '' },
  { name: 'held upright, the course runs on behind the overlay', file: 'game.js', only: 'more',
    find: '    if (!upright()) {\n      let rem', put: '    {\n      let rem' },
];
const SOAK = [
  { name: 'a little memory is kept every frame (a leak)', file: 'game.js',
    find: '    stepCoins(dt);\n    stepHint(dt);', put: '    (window.__kept = window.__kept || []).push(new Array(400).fill(dt));\n    stepCoins(dt);\n    stepHint(dt);' },
];

function copyGame(tag, d) {
  const web = path.join(WORK, tag), dir = path.join(web, 'games/flight'), fdir = path.join(web, 'fairy');
  fs.rmSync(web, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(fdir, { recursive: true });
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.copyFileSync(FAIRY, path.join(fdir, 'fairy.js'));
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>hub stand-in</title>');
  if (d) {
    const file = path.join(dir, d.file), src = fs.readFileSync(file, 'utf8'), n = src.split(d.find).length - 1;
    if (n !== 1) return { web, dir, error: `the text to break is in ${d.file} ${n} times (it must be there exactly once)` };
    fs.writeFileSync(file, src.replace(d.find, () => d.put));
  }
  return { web, dir };
}
function run(cmd, args, env) {
  const r = spawnSync('node', [path.join(__dirname, cmd), ...args], { env: Object.assign({}, process.env, env), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = (r.stdout || '') + (r.stderr || '');
  return { code: r.status, out, fails: out.split('\n').filter((l) => /^FAIL|SOAK FAIL|crashed/.test(l)).map((l) => l.replace(/^FAIL\s+/, '').slice(0, 150)) };
}
const rows = [];
// must: the output has to show this (so a run that fails for some other reason does not count as a catch)
function report(kind, d, r, copyError, must) {
  const caught = !copyError && r.code !== 0 && r.fails.length > 0 && (!must || must.test(r.out));
  rows.push({ kind, name: d.name, injected: !copyError, caught, by: copyError || r.fails.slice(0, 3) });
  console.log(`${copyError ? 'NOT INJECTED' : caught ? 'CAUGHT ' : 'MISSED '}  [${kind}] ${d.name}`);
  if (copyError) console.log('          ' + copyError);
  else for (const f of r.fails.slice(0, 3)) console.log('          <- ' + f);
  if (!copyError && r.fails.length > 3) console.log(`          ... and ${r.fails.length - 3} more`);
}

fs.mkdirSync(WORK, { recursive: true });
if (which === 'all' || which === 'rules') {
  const clean = copyGame('clean');
  const base = run('verify.js', [], { FLIGHT_LOGIC: path.join(clean.dir, 'logic.js') });
  const baseNF = run('verify.js', [], { FLIGHT_LOGIC: path.join(clean.dir, 'logic.js'), FLIGHT_NOFREEZE: '1' });
  if (base.code !== 0 || baseNF.code !== 0) { console.log('an UNBROKEN copy fails verify.js: fix that first\n' + base.fails.concat(baseNF.fails).join('\n')); process.exit(2); }
  console.log('unbroken copy: verify.js passes');
  RULES.forEach((d, i) => {
    if (nameFilter && !d.name.includes(nameFilter)) return;
    const c = copyGame('rule-' + (i + 1), d);
    report('rules', d, c.error ? null : run('verify.js', [], Object.assign({ FLIGHT_LOGIC: path.join(c.dir, 'logic.js') }, d.frozen ? {} : { FLIGHT_NOFREEZE: '1' })), c.error, d.must);
  });
}
if (which === 'all' || which === 'browser') {
  // the control first: an unbroken copy must pass the browser test, or a "catch" means nothing
  const clean = copyGame('clean-browser');
  const base = run('browser.js', [path.join(WORK, 'shots-clean'), path.join(WORK, 'chrome'), '--only=seeker'], { FLIGHT_WEB: clean.web });
  if (base.code !== 0) { console.log('an UNBROKEN copy fails browser.js: fix that first\n' + base.fails.join('\n')); process.exit(2); }
  console.log('unbroken copy: browser.js passes');
  BROWSER.forEach((d, i) => {
    if (nameFilter && !d.name.includes(nameFilter)) return;
    const c = copyGame('browser-' + (i + 1), d);
    report('browser', d, c.error ? null : run('browser.js', [path.join(WORK, 'shots-' + (i + 1)), path.join(WORK, 'chrome'), '--only=' + d.only], { FLIGHT_WEB: c.web }), c.error);
  });
}
if (which === 'all' || which === 'soak') {
  // the control first: an unbroken copy, soaked for the same 90 seconds, must show flat memory
  const clean = copyGame('clean-soak');
  const base = run('soak.js', [path.join(WORK, 'soak-out-clean'), path.join(WORK, 'chrome'), '90'], { FLIGHT_WEB: clean.web });
  if (!/flat true|SOAK PASS/.test(base.out) || /flat false/.test(base.out)) { console.log('an UNBROKEN copy does not show flat memory in a 90 s soak: fix that first\n' + base.out.slice(-600)); process.exit(2); }
  console.log('unbroken copy: a 90 s soak shows flat memory');
  SOAK.forEach((d, i) => {
    const c = copyGame('soak-' + (i + 1), d);
    report('soak', d, c.error ? null : run('soak.js', [path.join(WORK, 'soak-out-' + (i + 1)), path.join(WORK, 'chrome'), '90'], { FLIGHT_WEB: c.web }), c.error, /flat false/);
  });
}
const injected = rows.filter((r) => r.injected).length, caught = rows.filter((r) => r.caught).length;
fs.writeFileSync(path.join(WORK, 'defects.json'), JSON.stringify(rows, null, 2));
console.log(`\n${rows.length} defects, ${injected} injected, ${caught} caught`);
process.exit(injected === rows.length && caught === rows.length && rows.length > 0 ? 0 : 1);
