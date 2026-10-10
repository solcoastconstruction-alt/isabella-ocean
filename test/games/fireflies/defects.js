// Firefly Numbers: do the checks bite? Break a copy of the game on purpose, one defect at a time, and run the tests on it.
//   node test/games/fireflies/defects.js            every defect: the rule ones (Node, seconds each), then the browser
//                                                   ones (headless Chrome, about a minute each), then one soak
//   node test/games/fireflies/defects.js rules      only the ones verify.js must catch
//   node test/games/fireflies/defects.js browser    only the ones browser.js must catch
//   node test/games/fireflies/defects.js soak       only the leak soak.js must catch
//   node test/games/fireflies/defects.js dry        only check that every defect can be put into its copy (no tests run)
// Each defect is one exact piece of text swapped for another in a copy under <repo>/.local/fireflies-defects. A defect whose
// text is no longer in the file exactly once is an error (the game has changed and the defect must be written again), and so is
// an unbroken copy that fails. Prints "N injected, N caught" and exits non-zero unless every defect is injected AND caught.
'use strict';
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'web/games/fireflies');
const FAIRY = path.join(ROOT, 'web/fairy/fairy.js');
const WORK = path.join(ROOT, '.local/fireflies-defects');
const which = process.argv[2] || 'all';

// ---- breaks that verify.js must catch (the rules: logic.js) ----
const RULES = [
  { name: 'counting skips: the third firefly counts as two', file: 'logic.js',
    find: 'this.inJar++; this.caught++;', put: 'this.inJar += this.inJar === 2 ? 2 : 1; this.caught++;' },
  { name: 'an overfill is accepted: the extra firefly stays in the jar', file: 'logic.js',
    find: "if (this.phase === 'full') { this.overfills++; return { type: 'overfill' }; }   // one too many", put: "if (this.phase === 'full') { this.overfills++; this.inJar++; return { type: 'overfill' }; }   // one too many" },
  { name: 'an overfill is not counted against the stars', file: 'logic.js',
    find: "if (this.phase === 'full') { this.overfills++; return { type: 'overfill' }; }   // one too many", put: "if (this.phase === 'full') { return { type: 'overfill' }; }   // one too many" },
  { name: 'a sum\'s label shows a minus between the numerals', file: 'logic.js',
    find: "numerals.push(op('plus')); dots.push(op('plus'));", put: "numerals.push(op('minus')); dots.push(op('plus'));" },
  { name: 'a sum of two does not add up (the second number is one too big)', file: 'logic.js',
    find: 'return { k, parts: [a, total - a], total, target: total };', put: 'return { k, parts: [a, total - a + 1], total, target: total };' },
  { name: 'the dots do not match the numeral (one extra dot from five up)', file: 'logic.js',
    find: "numerals.push(num(p)); dots.push({ t: 'dots', n: p, crossed: 0 });", put: "numerals.push(num(p)); dots.push({ t: 'dots', n: p + (p > 4 ? 1 : 0), crossed: 0 });" },
  { name: 'a dot lights too early (one more lit than are in the jar)', file: 'logic.js',
    find: 'lit: out.length < inJar,', put: 'lit: out.length <= inJar,' },
  { name: 'a take-away goes below its answer (letting out is not stopped when full)', file: 'logic.js',
    find: "if (this.phase === 'full') { this.overfills++; return { type: 'overfill' }; }\n      this.inJar--;", put: "if (this.phase === 'full') { this.overfills++; }\n      this.inJar--;" },
  { name: 'a take-away can take everything out (nothing left in the jar)', file: 'logic.js',
    find: 'hi = total >= 5 ? total - 2 : total - 1;', put: 'hi = total >= 5 ? total : total - 1;' },
  { name: 'a take-away\'s answer is one too low', file: 'logic.js',
    find: "return { k: 't', parts: [total, away], total, away, target: total - away };", put: "return { k: 't', parts: [total, away], total, away, target: total - away - 1 };" },
  { name: 'the crossed dots are one short on a take-away', file: 'logic.js',
    find: 'crossed: i >= d.n - d.crossed }', put: 'crossed: i > d.n - d.crossed }' },
  { name: 'an outside firefly in a take-away counts as a catch', file: 'logic.js',
    find: "if (this.takeAway) return { type: 'shake' };", put: "if (this.takeAway && false) return { type: 'shake' };" },
  { name: 'tapping the jar in a counting round takes a firefly out', file: 'logic.js',
    find: "if (!this.takeAway) return { type: 'jar' };", put: "if (!this.takeAway) { this.inJar = Math.max(0, this.inJar - 1); return { type: 'jar' }; }" },
  { name: 'the next jar can be called before this one is full', file: 'logic.js',
    find: "if (this.done || this.phase !== 'full') return { type: 'ignored' };", put: "if (this.done) return { type: 'ignored' };" },
  { name: 'three overfills still earn two stars', file: 'logic.js',
    find: 'overfills <= 2 ? 2 : 1', put: 'overfills <= 3 ? 2 : 1' },
  { name: 'one overfill still earns three stars', file: 'logic.js',
    find: 'overfills <= 0 ? 3 :', put: 'overfills <= 1 ? 3 :' },
  { name: 'the jar of the level\'s biggest number never comes', file: 'logic.js',
    find: 'out.push(make(i, i === peak));', put: 'out.push(make(i, false));' },
  { name: 'fireflies overlap: the spacing pass never runs', file: 'logic.js',
    find: '      this.settle();\n    }\n    // the spacing rule', put: '    }\n    // the spacing rule' },
  { name: 'fireflies start on top of each other (no free-spot check)', file: 'logic.js',
    find: 'if (free(x, y)) return { x, y };', put: 'return { x, y };' },
  { name: 'a tap zone shrinks below 19vh (ZONE 40)', file: 'logic.js',
    find: 'const ZONE = 52;', put: 'const ZONE = 40;' },
  { name: 'a mode does not scale: Easy drifts at one speed from level 1 to 20', file: 'logic.js',
    find: 'easy: [22, 1.5]', put: 'easy: [22, 0]' },
  { name: 'a mode does not scale: Hard drifts like Medium', file: 'logic.js',
    find: 'hard: [36, 2.2]', put: 'hard: [28, 1.9]' },
  { name: 'a mode does not scale: Easy keeps the widest berth from level 1 to 20 (no tightening)', file: 'logic.js',
    find: 'easy: [146, 122]', put: 'easy: [146, 146]' },
  { name: 'the fireflies on screen are fewer than a jar needs', file: 'logic.js',
    find: 'Math.max(8, hi + 1) + MODE_BONUS[mode]', put: 'Math.max(8, hi - 3) + MODE_BONUS[mode]' },
  { name: 'a level drifts: Easy 3 climbs to 5', file: 'logic.js',
    find: "[4, 1, 'ccc'], [4, 1, 'cccc'], [5, 1, 'cccc']", put: "[5, 1, 'ccc'], [4, 1, 'cccc'], [5, 1, 'cccc']" },
  { name: 'a take-away appears in Medium', file: 'logic.js',
    find: "[10, 6, 'abbabab']", put: "[10, 6, 'abbatab']" },
  { name: 'a sum of three appears early in Medium (level 11)', file: 'logic.js',
    find: "[10, 3, 'caaaaa'], [10, 3, 'aaaaaa']", put: "[10, 3, 'caabaa'], [10, 3, 'aaaaaa']" },
  { name: 'a jar asks for eleven', file: 'logic.js',
    find: "[10, 7, 'btabtabt']", put: "[11, 7, 'btabtabt']" },
  { name: 'the hint hand comes after only 3 seconds on Easy', file: 'logic.js',
    find: 'easy: 7, medium: 10, hard: 14', put: 'easy: 3, medium: 10, hard: 14' },
  { name: 'a saved game forgets that a beaten level opens the next', file: 'logic.js',
    find: 'Math.max(u || 1, beaten + 1)', put: 'Math.max(u || 1, 1)' },
  { name: 'a saved game accepts any mode name', file: 'logic.js',
    find: 'if (MODES.includes(s.mode)) sv.mode = s.mode;', put: 'if (s.mode) sv.mode = s.mode;' },
];
// ---- breaks that browser.js must catch (real touch in headless Chrome) ----
const BROWSER = [
  { name: 'the home button goes to the wrong page', file: 'game.js', find: "HUB = '../../index.html'", put: "HUB = '../index.html'" },
  { name: 'window.__back is missing', file: 'game.js', find: 'window.__back = () => { persist(); location.href = HUB; return true; };', put: '' },
  { name: 'the device pixel ratio is not capped (art reads the raw ratio)', file: 'art.js', find: 'dpr = r.dpr; VW = r.VW;', put: 'dpr = window.devicePixelRatio || 1; VW = r.VW;' },
  { name: 'the stars are not saved', file: 'game.js', find: '    save.stars[m][n - 1] = Math.max(save.stars[m][n - 1] | 0, res.stars);\n', put: '' },
  { name: 'saved under another game\'s key', file: 'game.js', find: "SAVE_KEY = 'game.fireflies.save'", put: "SAVE_KEY = 'game.pop.save'" },
  { name: 'the game writes the main game\'s save', file: 'game.js', find: '    store.set(SAVE_KEY, JSON.stringify(save));\n', put: "    store.set(SAVE_KEY, JSON.stringify(save));\n    store.set('isabella.save', JSON.stringify({ muted }));\n" },
  { name: 'the mute switch is ignored', file: 'game.js', find: '  let muted = readMuted();', put: '  let muted = false;' },
  { name: 'no hand shows the first tap on a new level', file: 'game.js', find: 'const first = r.firstTime && !r.everTapped && r.t > 0.9;', put: 'const first = false;' },
  { name: 'the level bubbles are too small to tap (15vh)', file: 'index.html', find: '#grid { --w:min(23vh,', put: '#grid { --w:min(15vh,' },
  { name: 'the jar does not hiccup on an overfill', file: 'game.js', find: 'f.hiccupped = true; r.hic = 1; S.hiccup(); }\n        if (f.t >= 0.85', put: 'f.hiccupped = true; S.hiccup(); }\n        if (f.t >= 0.85' },
  { name: 'the treasure chest never comes', file: 'game.js', find: "} else if (res.type === 'level') {\n        wonLevel(res);\n      }", put: "} else if (res.type === 'level') {\n      }" },
  { name: 'a coin never lands in the coin row', file: 'game.js', find: 'r.coinFly = null; r.coinsHud++;', put: 'r.coinFly = null;' },
  { name: 'a shaken outside firefly does not shake', file: 'game.js', find: 'counters.shakes++; fly.shake = 0.5; S.boop();', put: 'counters.shakes++; S.boop();' },
  { name: 'an overfilling firefly stays tappable while it flutters (and can be tapped twice)', file: 'game.js', find: '      fly.busy = true;\n      r.flights.push({ type: \'over\'', put: '      r.flights.push({ type: \'over\'' },
  { name: 'a word appears on the child\'s screen (the home button says Home)', file: 'index.html', find: '<svg><use href="#i-home"/></svg></span></button>\n<div id="rotate">', put: '<svg><use href="#i-home"/></svg></span>Home</button>\n<div id="rotate">' },
  { name: 'the turn-your-phone picture never shows', file: 'index.html', find: '@media (orientation: portrait) { #rotate { display:flex; } }', put: '' },
  { name: 'beating a level does not open the next', file: 'game.js', find: '    save.unlocked[m] = Math.min(NLEV, Math.max(save.unlocked[m], n + 1));\n', put: '' },
  { name: 'the results card always says three stars', file: 'game.js', find: '    r.stars = res.stars;', put: '    r.stars = 3;' },
  { name: 'the mode picker forgets the mode', file: 'game.js', find: "S.click(); save.mode = m; persist(); buildMenu(); });", put: 'S.click(); persist(); buildMenu(); });' },
];
const SOAK = [
  { name: 'a little memory is kept every frame (a leak)', file: 'game.js',
    find: '    r.t += dt;\n    r.swarm.step(dt);', put: '    r.t += dt;\n    (window.__kept = window.__kept || []).push(new Array(40).fill(dt));\n    r.swarm.step(dt);' },
];

function copyGame(tag, d) {
  const web = path.join(WORK, tag), dir = path.join(web, 'games/fireflies');
  fs.rmSync(web, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(web, 'fairy'), { recursive: true });
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.copyFileSync(FAIRY, path.join(web, 'fairy/fairy.js'));
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
if (which === 'dry') {
  let bad = 0;
  for (const [kind, list] of [['rules', RULES], ['browser', BROWSER], ['soak', SOAK]]) list.forEach((d, i) => { const c = copyGame(`dry-${kind}-${i + 1}`, d); if (c.error) { bad++; console.log(`NOT INJECTED [${kind}] ${d.name}: ${c.error}`); } fs.rmSync(c.web, { recursive: true, force: true }); });
  console.log(`${RULES.length + BROWSER.length + SOAK.length} defects, ${RULES.length + BROWSER.length + SOAK.length - bad} injected (dry run, nothing tested)`);
  process.exit(bad ? 1 : 0);
}
if (which === 'all' || which === 'rules') {
  const clean = copyGame('clean');
  const base = run('verify.js', [], { FIREFLIES_LOGIC: path.join(clean.dir, 'logic.js') });
  if (base.code !== 0) { console.log('an UNBROKEN copy fails verify.js: fix that first\n' + base.fails.join('\n')); process.exit(2); }
  console.log('unbroken copy: verify.js passes');
  RULES.forEach((d, i) => {
    const c = copyGame('rule-' + (i + 1), d);
    report('rules', d, c.error ? null : run('verify.js', [], { FIREFLIES_LOGIC: path.join(c.dir, 'logic.js') }), c.error);
    if (!c.error) fs.rmSync(c.web, { recursive: true, force: true });
  });
}
if (which === 'all' || which === 'browser') {
  const clean = copyGame('clean-browser');
  const base = run('browser.js', [path.join(WORK, 'shots-clean'), path.join(WORK, 'chrome'), '--only=seeker'], { FIREFLIES_WEB: clean.web });
  if (base.code !== 0) { console.log('an UNBROKEN copy fails browser.js: fix that first\n' + base.fails.join('\n')); process.exit(2); }
  console.log('unbroken copy: browser.js passes');
  BROWSER.forEach((d, i) => {
    const c = copyGame('browser-' + (i + 1), d);
    report('browser', d, c.error ? null : run('browser.js', [path.join(WORK, 'shots-' + (i + 1)), path.join(WORK, 'chrome'), '--only=seeker'], { FIREFLIES_WEB: c.web }), c.error);
    if (!c.error) fs.rmSync(c.web, { recursive: true, force: true });
  });
}
if (which === 'all' || which === 'soak') {
  // the control first: an unbroken copy, soaked for the same 90 seconds, must show flat memory
  const clean = copyGame('clean-soak');
  const base = run('soak.js', [path.join(WORK, 'soak-out-clean'), path.join(WORK, 'chrome'), '90'], { FIREFLIES_WEB: clean.web });
  // (a 90 s soak cannot visit every mode, so only the memory verdict is compared: the unbroken copy must not say "flat false")
  if (!/SOAK/.test(base.out) || /flat false|crashed/.test(base.out)) { console.log('an UNBROKEN copy does not show flat memory in a 90 s soak: fix that first\n' + base.out.slice(-600)); process.exit(2); }
  console.log('unbroken copy: a 90 s soak shows flat memory');
  SOAK.forEach((d, i) => {
    const c = copyGame('soak-' + (i + 1), d);
    report('soak', d, c.error ? null : run('soak.js', [path.join(WORK, 'soak-out-' + (i + 1)), path.join(WORK, 'chrome'), '90'], { FIREFLIES_WEB: c.web }), c.error, /flat false/);
    if (!c.error) fs.rmSync(c.web, { recursive: true, force: true });
  });
}
const injected = rows.filter((r) => r.injected).length, caught = rows.filter((r) => r.caught).length;
fs.writeFileSync(path.join(WORK, 'defects.json'), JSON.stringify(rows, null, 2));
console.log(`\n${rows.length} defects, ${injected} injected, ${caught} caught`);
console.log(`${injected} injected, ${caught} caught`);
process.exit(injected === rows.length && caught === rows.length && rows.length > 0 ? 0 : 1);
