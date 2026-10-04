// Sea Catch: do the checks bite? Break a copy of the game on purpose, one defect at a time, and run the tests on it.
//   node test/games/catch/defects.js            every defect: the rule ones (Node, seconds each), then the browser
//                                               ones (headless Chrome, a minute or two each), then one soak
//   node test/games/catch/defects.js rules      only the ones verify.js must catch
//   node test/games/catch/defects.js browser    only the ones browser.js must catch
//   node test/games/catch/defects.js soak       only the leak soak.js must catch
// Each defect is one exact piece of text swapped for another in a copy under <repo>/.local/defects. A defect whose
// text is no longer in the file is an error (the game has changed and the defect must be written again), and so is
// an unbroken copy that fails. Exits non-zero unless every defect is injected AND caught.
'use strict';
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'web/games/catch');
const WORK = path.join(ROOT, '.local/defects');
const which = process.argv[2] || 'all';

const RULES = [
  { name: 'coins can go below zero', file: 'logic.js',
    find: 'const coinLost = this.coins > 0;\n        if (coinLost) this.coins--;', put: 'const coinLost = true;\n        this.coins--;' },
  { name: 'a grump in the shell costs nothing', file: 'logic.js',
    find: '        if (coinLost) this.coins--;\n', put: '' },
  { name: 'the golden friend gives no coin', file: 'logic.js',
    find: 'this.golds++; this.coins++;', put: 'this.golds++;' },
  { name: 'nine friends make a coin', file: 'logic.js',
    find: 'if (this.tray.length >= TRAY) {', put: 'if (this.tray.length >= TRAY - 1) {' },
  { name: 'three bonks still earn two stars', file: 'logic.js',
    find: 'bonks <= 2 ? 2 : 1', put: 'bonks <= 3 ? 2 : 1' },
  { name: 'a missed friend costs a coin', file: 'logic.js',
    find: 'if (!it.grumpy) { this.misses++;', put: 'if (!it.grumpy) { this.misses++; if (this.coins > 0) this.coins--;' },
  { name: 'two grumps may come down side by side with no gap', file: 'logic.js',
    find: 'if (it.grumpy && e.grumpy) { if (dt < T_GG && dx < GAP_GG) return false; }', put: 'if (it.grumpy && e.grumpy) { /* no gap */ }' },
  { name: 'a friend may arrive glued to a grump', file: 'logic.js',
    find: 'else if (it.grumpy !== e.grumpy) { if (dt < this.tFG && dx < SEP_FG) return false; }', put: 'else if (it.grumpy !== e.grumpy) { /* glued */ }' },
  { name: 'two grumps in a row', file: 'logic.js',
    find: '&& this.mercy <= 0 && !this.lastGrumpy && ', put: '&& this.mercy <= 0 && ' },
  { name: 'level 7 falls one unit a second faster (a level drifting)', file: 'logic.js',
    find: 'coins: 6, speed: 135,', put: 'coins: 6, speed: 136,' },
  { name: 'the same seed gives different things (the plan drifts)', file: 'logic.js',
    find: 'const vy = cfg.speed * (0.93 + 0.14 * rng()), ac', put: 'const vy = cfg.speed * (0.92 + 0.14 * rng()), ac' },
  { name: 'a grump is as easy to catch as a friend', file: 'logic.js',
    find: 'const GRUMP_ZONE = { hw: 48, up: 24, down: 24 };', put: 'const GRUMP_ZONE = { hw: 84, up: 36, down: 44 };' },
  { name: 'no dizzy moment: two grumps together take two coins', file: 'logic.js',
    find: 'this.bonks++; this.shield = SHIELD;', put: 'this.bonks++; this.shield = 0;' },
  { name: 'grumps never ease off however often she is bonked', file: 'logic.js',
    find: 'const share = cfg.grumpy / (1 + CALM * bonks);', put: 'const share = cfg.grumpy;' },
  { name: 'Isabella jumps along at full speed instead of easing in', file: 'logic.js',
    find: '(this.aim - this.px) * (1 - Math.exp(-FOLLOW * dt))', put: '(this.aim - this.px)' },
  { name: 'Isabella can swim off the side of the screen', file: 'logic.js',
    find: 'if (finger != null) this.aim = clamp(finger, PX_MIN, this.vw - PX_MIN);', put: 'if (finger != null) this.aim = finger;' },
  { name: 'things may start their fall behind the home button', file: 'logic.js',
    find: 'for (let j = 0; j <= 10; j++) if (itemX(it, it.t0 + (aHome * j) / 10) < this.homeX) return false;', put: '' },
  { name: 'a saved game forgets its stars', file: 'logic.js',
    find: 'sv.stars = Array.from({ length: NLEV }, (_, i) => int(stars[i], 0, 3) || 0);', put: 'sv.stars = new Array(NLEV).fill(0);' },
  { name: 'a half-played level is not resumed', file: 'logic.js',
    find: "if (c > 0 && c < this.target) this.coins = c;", put: '' },
  { name: 'the eel has no drawing', file: 'art.js',
    find: '    eel(c, t, blink, happy, wig) {', put: '    eelx(c, t, blink, happy, wig) {' },
];
const BROWSER = [
  { name: 'Isabella ignores the finger as it slides', file: 'game.js', only: 'seeker',
    find: '    run.finger = A.toWorld(e.clientX, e.clientY).x;\n    run.idle = 0;\n    counters.moves++;', put: '    run.idle = 0;\n    counters.moves++;' },
  { name: 'Isabella follows the finger up and down instead of left and right', file: 'game.js', only: 'seeker',
    find: 'activeId = e.pointerId; run.finger = p.x;', put: 'activeId = e.pointerId; run.finger = p.y;' },
  { name: 'the home button goes to the wrong page', file: 'game.js', only: 'seeker',
    find: "HUB = '../../index.html'", put: "HUB = '../index.html'" },
  { name: 'window.__back is missing', file: 'game.js', only: 'seeker',
    find: 'window.__back = () => { persist(); location.href = HUB; return true; };', put: '' },
  { name: 'the device pixel ratio is not capped', file: 'art.js', only: 'seeker',
    find: 'dpr = Math.min(window.devicePixelRatio || 1, 2.5);', put: 'dpr = window.devicePixelRatio || 1;' },
  { name: 'a lost coin stays on show in the coin row', file: 'game.js', only: 'seeker',
    find: '    if (run.hud > 0) {\n      run.hud--;', put: '    if (run.hud > 0) {' },
  { name: 'the treasure chest never comes', file: 'game.js', only: 'seeker',
    find: 'if (r.rules.done && r.owed === 0 && !r.gather && !r.friends.length) startWin();', put: '' },
  { name: 'the stars are not saved', file: 'game.js', only: 'seeker',
    find: '    save.stars[n - 1] = Math.max(save.stars[n - 1], stars);\n', put: '' },
  { name: 'saved under another game\'s key', file: 'game.js', only: 'seeker',
    find: "SAVE_KEY = 'game.catch.save'", put: "SAVE_KEY = 'game.pop.save'" },
  { name: 'no hand shows the slide on level 1', file: 'game.js', only: 'seeker',
    find: 'const firstTime = r.n === 1 && !r.everCaught && r.pt > 0.8;', put: 'const firstTime = false;' },
  { name: 'the level bubbles are too small to tap (17vh)', file: 'index.html', only: 'seeker',
    find: '.lvl { width:23vh; height:23vh;', put: '.lvl { width:17vh; height:17vh;' },
  { name: 'the game writes the main game\'s save', file: 'game.js', only: 'more',
    find: '    store.set(SAVE_KEY, JSON.stringify(save));\n', put: "    store.set(SAVE_KEY, JSON.stringify(save));\n    store.set('isabella.save', JSON.stringify({ muted }));\n" },
  { name: 'the mute switch is ignored', file: 'game.js', only: 'more',
    find: '  let muted = readMuted();', put: '  let muted = false;' },
];
const SOAK = [
  { name: 'a little memory is kept every frame (a leak)', file: 'game.js',
    find: '    run.lit += (lit - run.lit) * Math.min(1, dt * 9);', put: '    run.lit += (lit - run.lit) * Math.min(1, dt * 9);\n    (window.__kept = window.__kept || []).push(new Array(40).fill(dt));' },
];

function copyGame(tag, d) {
  const web = path.join(WORK, tag), dir = path.join(web, 'games/catch');
  fs.rmSync(web, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
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
  const base = run('verify.js', [], { CATCH_LOGIC: path.join(clean.dir, 'logic.js') });
  if (base.code !== 0) { console.log('an UNBROKEN copy fails verify.js: fix that first\n' + base.fails.join('\n')); process.exit(2); }
  console.log('unbroken copy: verify.js passes');
  RULES.forEach((d, i) => {
    const c = copyGame('rule-' + (i + 1), d);
    report('rules', d, c.error ? null : run('verify.js', [], { CATCH_LOGIC: path.join(c.dir, 'logic.js') }), c.error);
  });
}
if (which === 'all' || which === 'browser') {
  BROWSER.forEach((d, i) => {
    const c = copyGame('browser-' + (i + 1), d);
    report('browser', d, c.error ? null : run('browser.js', [path.join(WORK, 'shots-' + (i + 1)), path.join(WORK, 'chrome'), '--only=' + d.only], { CATCH_WEB: c.web }), c.error);
  });
}
if (which === 'all' || which === 'soak') {
  // the control first: an unbroken copy, soaked for the same 90 seconds, must show flat memory
  const clean = copyGame('clean-soak');
  const base = run('soak.js', [path.join(WORK, 'soak-out-clean'), path.join(WORK, 'chrome'), '90'], { CATCH_WEB: clean.web });
  if (!/SOAK PASS|flat true/.test(base.out)) { console.log('an UNBROKEN copy does not show flat memory in a 90 s soak: fix that first\n' + base.out.slice(-400)); process.exit(2); }
  console.log('unbroken copy: a 90 s soak shows flat memory');
  SOAK.forEach((d, i) => {
    const c = copyGame('soak-' + (i + 1), d);
    report('soak', d, c.error ? null : run('soak.js', [path.join(WORK, 'soak-out-' + (i + 1)), path.join(WORK, 'chrome'), '90'], { CATCH_WEB: c.web }), c.error, /flat false/);
  });
}
const injected = rows.filter((r) => r.injected).length, caught = rows.filter((r) => r.caught).length;
fs.writeFileSync(path.join(WORK, 'defects.json'), JSON.stringify(rows, null, 2));
console.log(`\n${rows.length} defects, ${injected} injected, ${caught} caught`);
process.exit(injected === rows.length && caught === rows.length && rows.length > 0 ? 0 : 1);
