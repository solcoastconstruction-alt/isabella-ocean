// Toadstool Hop: do the checks bite? Break a copy of the game on purpose, one defect at a time, and run the tests on it.
//   node test/games/hop/defects.js            every defect: the rule ones (Node, seconds each), then the browser ones (headless Chrome,
//                                             a minute or three each), then one soak
//   node test/games/hop/defects.js rules      only the ones verify.js must catch
//   node test/games/hop/defects.js browser    only the ones browser.js must catch
//   node test/games/hop/defects.js soak       only the leak soak.js must catch
//   add --match=text to run only the defects whose name contains the text
// Each defect is one exact piece of text swapped for another in a copy under <repo>/.local/defects-hop. A defect whose text is no longer in the
// file is an error (the game has changed and the defect must be written again), and so is an unbroken copy that fails. `must` names the check
// that is meant to catch the defect: a run that fails only some other check does not count. Exits non-zero unless every defect is injected AND
// caught. The last line is "N injected, N caught".
'use strict';
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'web');
const WORK = path.join(ROOT, '.local/defects-hop');
const which = (process.argv[2] && !process.argv[2].startsWith('--')) ? process.argv[2] : 'all';
const MATCH = (process.argv.find((a) => a.startsWith('--match=')) || '').slice(8);   // run only the defects whose name contains this text
const pick = (list) => list.filter((d) => !MATCH || d.name.includes(MATCH));

const RULES = [
  { name: 'a platform is out of reach (one gap is 170 units too long)', file: 'logic.js', must: /a search over tap times/,
    find: 'b.x0 = base + g;\n      return g;', put: 'b.x0 = base + g + (b.id === 5 ? 170 : 0);\n      return g;' },
  { name: 'a lily pad drifts six times too far (off the screen, into its neighbour)', file: 'logic.js', must: /nothing drifts off/,
    find: 'p.ax = +(cfg.padAmp * M.ampK * (0.75 + 0.5 * d.a)).toFixed(1);', put: 'p.ax = +(cfg.padAmp * M.ampK * 6 * (0.75 + 0.5 * d.a)).toFixed(1);' },
  { name: 'a coin sits on the bank, a place she can never take it from', file: 'logic.js', must: /every coin, butterfly and the key is on a platform/,
    find: "      if (p.kind === 'bank') return;\n      if (i === keyNode)", put: '      if (i === keyNode)' },
  { name: 'a bonus coin is put on a platform that is not a far one', file: 'logic.js', must: /every coin, butterfly and the key is on a platform/,
    find: '      p.coin = d.coin < cfg.coin;\n', put: '      p.coin = d.coin < cfg.coin;\n      if (nd.far >= 0) c.plats[nd.far].coin = true;\n' },
  { name: 'the frog does not rescue her (she stays in the water)', file: 'logic.js', must: /a hop that is too far splashes her/,
    find: 'if (this.t - this.sp.t0 >= RESCUE) {', put: 'if (this.t - this.sp.t0 >= RESCUE * 1e6) {' },
  { name: 'the frog puts her on the next platform, not the one she left', file: 'logic.js', must: /a hop that is too far splashes her/,
    find: 'this.phase = \'stand\'; this.stand0 = this.t - SETTLE; this.ofs = 0; this.sp = null;', put: 'this.phase = \'stand\'; this.node++; this.stand0 = this.t - SETTLE; this.ofs = 0; this.sp = null;' },
  { name: 'Easy platforms are no bigger than Medium ones (a mode that does not scale)', file: 'logic.js', must: /the modes: Easy platforms wider/,
    find: "easy: { id: 'easy', size: 1.5,", put: "easy: { id: 'easy', size: 1.2," },
  { name: 'Hard drifts no faster than Easy (a mode that does not scale)', file: 'logic.js', must: /the modes: Easy platforms wider/,
    find: "hard: { id: 'hard', size: 0.95, speedK: 1.3,", put: "hard: { id: 'hard', size: 0.95, speedK: 0.7," },
  { name: 'the key cannot be found (it is put nowhere)', file: 'logic.js', must: /every coin, butterfly and the key is on a platform/,
    find: 'keyNode = cand.length ? cand[Math.floor(D0[lo].coin * cand.length)] : lo;', put: 'keyNode = c.nodes.length - 1;' },
  { name: 'the key stands in the first half of the course', file: 'logic.js', must: /every coin, butterfly and the key is on a platform/,
    find: 'const lo = Math.ceil((c.nodes.length - 1) * 0.5), hi = Math.floor((c.nodes.length - 1) * 0.82), cand = [];', put: 'const lo = Math.ceil((c.nodes.length - 1) * 0.1), hi = Math.floor((c.nodes.length - 1) * 0.3), cand = [];' },
  { name: 'a splash can take her coins below zero', file: 'logic.js', must: /a splash costs one coin/,
    find: 'if (this.M.coinLoss && this.coins > 0) { this.coins--;', put: 'if (this.M.coinLoss) { this.coins--;' },
  { name: 'a splash costs a coin on Easy too', file: 'logic.js', must: /a splash costs one coin|the modes: Easy platforms wider|a hop that is too far splashes/,
    find: 'rb: 66, coinLoss: false,', put: 'rb: 66, coinLoss: true,' },
  { name: 'three splashes still earn two stars', file: 'logic.js', must: /stars count splashes/,
    find: 'splashes <= 2 ? 2 : 1', put: 'splashes <= 3 ? 2 : 1' },
  { name: 'one splash still earns three stars', file: 'logic.js', must: /stars count splashes/,
    find: '(splashes === 0 ? 3 :', put: '(splashes <= 1 ? 3 :' },
  { name: 'on Easy and Medium a tap on the right half takes the far platform', file: 'logic.js', must: /the choice: on Hard a tap on the left half/,
    find: 'if (nd.far >= 0 && this.M.byHalf && side > 0)', put: 'if (nd.far >= 0 && side > 0)' },
  { name: 'a tap in the air starts another hop', file: 'logic.js', must: /a tap while she is in the air is ignored/,
    find: "      if (this.phase !== 'stand') return false;\n      if (!this.target(side || 0)) return false;", put: '      if (!this.target(side || 0)) return false;' },
  { name: 'a tap just after landing is lost', file: 'logic.js', must: /a tap while she is in the air is ignored/,
    find: "if (this.phase === 'stand' && this.queued != null && this.t - this.stand0 >= SETTLE - 1e-9) this.go(this.queued, events);", put: 'if (false) this.go(this.queued, events);' },
  { name: 'the chest opens but gives no coins', file: 'logic.js', must: /the chest: with the key it opens/,
    find: 'this.coins += CHEST_COINS; this.chestCoins = CHEST_COINS;', put: 'this.chestCoins = CHEST_COINS;' },
  { name: 'without the key the chest never opens', file: 'logic.js', must: /the chest: with the key it opens/,
    find: 'CHEST_OPEN_LATE = 2.3;', put: 'CHEST_OPEN_LATE = 1e9;' },
  { name: 'a saved game forgets the mode', file: 'logic.js', must: /the save: a fresh one/,
    find: '    if (MODE_IDS.indexOf(s.mode) >= 0) sv.mode = s.mode;\n', put: '' },
  { name: 'a saved game forgets its stars', file: 'logic.js', must: /the save: a fresh one/,
    find: '      sv.stars[m] = Array.from({ length: NLEV }, (_, i) => int(st[i], 0, 3) || 0);', put: '      sv.stars[m] = new Array(NLEV).fill(0);' },
  { name: 'Hard and Medium share Easy\'s open levels', file: 'logic.js', must: /the save: a fresh one/,
    find: 'int(s.unlocked[m], 1, NLEV)', put: 'int(s.unlocked.easy, 1, NLEV)' },
  { name: 'a half-played level is resumed without its coins', file: 'logic.js', must: /a half-played level resumes/,
    find: 'this.coins = int(s.coins, 0, 999) || 0; this.splashes = int(s.splashes, 0, 999) || 0;', put: 'this.splashes = int(s.splashes, 0, 999) || 0;' },
  { name: 'level 9 drifts a little faster (a level that changed)', file: 'logic.js', must: /the level table is frozen|all 60 courses are frozen/,
    find: ': +(0.7 + 0.42 * (k - 2) / 7).toFixed(3),', put: ': +(0.7 + 0.43 * (k - 2) / 7).toFixed(3),' },
  { name: 'World 2 starts no harder than World 1 ended', file: 'logic.js', must: /level 11 costs more than level 10|difficulty \(a fixed cost function/,
    find: 'w2 ? +(0.42 + 0.16 * u).toFixed(3)', put: 'w2 ? +(0.08 + 0.12 * u).toFixed(3)' },
  { name: 'gusts are out of step with the clouds (a platform that is not periodic)', file: 'logic.js', must: /every moving platform repeats/,
    find: 'p.gw = p.wy;', put: 'p.gw = p.wy * 1.0137;' },
  { name: 'the far platform of a choice is no higher than the near one', file: 'logic.js', must: /every coin, butterfly and the key is on a platform/,
    find: 'F.y0 = Math.round(clamp(yPrev - 46 - 22 * d.fy, 280, 360));', put: 'F.y0 = Math.round(clamp(yPrev + 46 + 22 * d.fy, 380, 420));' },
  { name: 'Hard\'s butterflies are too small to hop through', file: 'logic.js', must: /a search over tap times|every coin, butterfly and the key is on a platform/,
    find: 'rb: 46, coinLoss: true,', put: 'rb: 12, coinLoss: true,' },
];
const BROWSER = [
  { name: 'Isabella ignores a tap on the left half', file: 'game.js', only: 'seeker', must: /left half hops/,
    find: 'tapAt(e.clientX < window.innerWidth / 2 ? -1 : 1);', put: 'if (e.clientX < window.innerWidth / 2) return; tapAt(1);' },
  { name: 'the hand never shows, however long she is left', file: 'game.js', only: 'seeker', must: /a hand shows where to tap/,
    find: 'if (r.idle > R.M.hint) {', put: 'if (r.idle > 1e9) {' },
  { name: 'the camera does not follow her (she walks off the screen)', file: 'game.js', only: 'seeker', must: /settled at|left third/,
    find: 'r.cam += (target - r.cam) * (1 - Math.exp(-dt * (R.phase === \'hop\' ? 7 : 4)));', put: '' },
  { name: 'the stars are not saved', file: 'game.js', only: 'seeker', must: /the save has the documented shape|after a reload the stars/,
    find: '    save.stars[m][n - 1] = Math.max(save.stars[m][n - 1], stars);\n', put: '' },
  { name: 'the chest\'s coins are not put in the save', file: 'game.js', only: 'seeker', must: /the save has the documented shape|after a reload the stars/,
    find: '      addCoins(L.CHEST_COINS, cc.x, cc.y - 90);\n', put: '' },
  { name: 'the results card never comes', file: 'game.js', only: 'seeker', must: /results card shows 3 big stars/,
    find: 'if (!r.results && r.doneT >= RESULTS_AFTER) showResults();', put: '' },
  { name: 'saved under another game\'s key', file: 'game.js', only: 'seeker', must: /the save is under game.hop.save|the save has the documented shape/,
    find: "SAVE_KEY = 'game.hop.save'", put: "SAVE_KEY = 'game.pop.save'" },
  { name: 'the game writes the main game\'s save', file: 'game.js', only: 'seeker', must: /nothing is written to the main game/,
    find: '    save.mode = mode;\n    store.set(SAVE_KEY, JSON.stringify(save));', put: "    save.mode = mode;\n    store.set(SAVE_KEY, JSON.stringify(save));\n    store.set('isabella.save', JSON.stringify({ muted }));" },
  { name: 'the level bubbles are too small to tap (17vh)', file: 'index.html', only: 'seeker', must: /every touch target is at least 19vh/,
    find: '.lvl { width:23vh; height:23vh;', put: '.lvl { width:17vh; height:17vh;' },
  { name: 'the mode buttons are too small to tap (13vh)', file: 'index.html', only: 'seeker', must: /every touch target is at least 19vh/,
    find: '.mode { width:19vh; height:19vh;', put: '.mode { width:13vh; height:13vh;' },
  { name: 'the device pixel ratio is not capped', path: 'fairy/fairy.js', only: 'seeker', must: /canvas fills the screen/,
    find: "const dpr = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, 2.5);", put: "const dpr = ((typeof window !== 'undefined' && window.devicePixelRatio) || 1);" },
  { name: 'a splash costs no coin in the save on Medium', file: 'game.js', only: 'more', must: /one coin drifted away on medium/,
    find: '        save.coins = Math.max(0, save.coins - 1);\n', put: '' },
  { name: 'a half-played level is not remembered', file: 'game.js', only: 'more', must: /resume: /,
    find: 'if (run.rules.node > 0) save.runs[key] = run.rules.snapshot(); else delete save.runs[key];', put: '' },
  { name: 'the home button goes to the wrong page', file: 'game.js', only: 'more', must: /home: /,
    find: "HUB = '../../index.html'", put: "HUB = '../index.html'" },
  { name: 'window.__back is missing', file: 'game.js', only: 'more', must: /home: window.__back/,
    find: 'window.__back = () => { persist(); location.href = HUB; return true; };', put: '' },
  { name: 'the mute switch is ignored', file: 'game.js', only: 'more', must: /mute: /,
    find: '  let muted = readMuted();', put: '  let muted = false;' },
  { name: 'held upright, the game does not wait', file: 'game.js', only: 'more', must: /upright: /,
    find: '    if (!upright()) {\n      let rem', put: '    if (true) {\n      let rem' },
];
const SOAK = [
  { name: 'a little memory is kept every step (a leak)', file: 'game.js',
    find: '    R.step(dt, events);\n    for (let i = 0; i < events.length; i++) onEvent(events[i]);\n    if (run !== r) return;', put: '    R.step(dt, events);\n    (window.__kept = window.__kept || []).push(new Array(40).fill(dt));\n    for (let i = 0; i < events.length; i++) onEvent(events[i]);\n    if (run !== r) return;' },
];

function copyGame(tag, d) {
  const web = path.join(WORK, tag), dir = path.join(web, 'games/hop');
  fs.rmSync(web, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(path.join(SRC, 'games/hop'))) fs.copyFileSync(path.join(SRC, 'games/hop', f), path.join(dir, f));
  fs.mkdirSync(path.join(web, 'fairy'), { recursive: true });
  for (const f of fs.readdirSync(path.join(SRC, 'fairy'))) fs.copyFileSync(path.join(SRC, 'fairy', f), path.join(web, 'fairy', f));
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>hub stand-in</title>');
  if (d) {
    const file = d.path ? path.join(web, d.path) : path.join(dir, d.file), src = fs.readFileSync(file, 'utf8'), n = src.split(d.find).length - 1;
    if (n !== 1) return { web, dir, error: `the text to break is in ${d.path || d.file} ${n} times (it must be there exactly once)` };
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
// must: the output has to show this FAIL line (so a run that fails for some other reason does not count as a catch)
function report(kind, d, r, copyError, must) {
  const caught = !copyError && r.code !== 0 && r.fails.length > 0 && (!must || r.fails.some((f) => must.test(f)));
  rows.push({ kind, name: d.name, injected: !copyError, caught, by: copyError || r.fails.slice(0, 3) });
  console.log(`${copyError ? 'NOT INJECTED' : caught ? 'CAUGHT ' : 'MISSED '}  [${kind}] ${d.name}`);
  if (copyError) console.log('          ' + copyError);
  else for (const f of r.fails.slice(0, 3)) console.log('          <- ' + f);
  if (!copyError && r.fails.length > 3) console.log(`          ... and ${r.fails.length - 3} more`);
}

fs.mkdirSync(WORK, { recursive: true });
if (which === 'all' || which === 'rules') {
  const clean = copyGame('clean');
  const base = run('verify.js', [], { HOP_LOGIC: path.join(clean.dir, 'logic.js') });
  if (base.code !== 0) { console.log('an UNBROKEN copy fails verify.js: fix that first\n' + base.fails.join('\n')); process.exit(2); }
  console.log('unbroken copy: verify.js passes');
  pick(RULES).forEach((d, i) => {
    const c = copyGame('rule-' + (i + 1), d);
    report('rules', d, c.error ? null : run('verify.js', [], { HOP_LOGIC: path.join(c.dir, 'logic.js') }), c.error, d.must);
  });
}
if (which === 'all' || which === 'browser') {
  pick(BROWSER).forEach((d, i) => {
    const c = copyGame('browser-' + (i + 1), d);
    report('browser', d, c.error ? null : run('browser.js', [path.join(WORK, 'shots-' + (i + 1)), path.join(WORK, 'chrome'), '--only=' + d.only], { HOP_WEB: c.web }), c.error, d.must);
  });
}
if (which === 'all' || which === 'soak') {
  // the control first: an unbroken copy, soaked for the same 90 seconds, must show flat memory
  const clean = copyGame('clean-soak');
  const base = run('soak.js', [path.join(WORK, 'soak-out-clean'), path.join(WORK, 'chrome'), '90'], { HOP_WEB: clean.web });
  if (!/SOAK PASS|flat true/.test(base.out)) { console.log('an UNBROKEN copy does not show flat memory in a 90 s soak: fix that first\n' + base.out.slice(-600)); process.exit(2); }
  console.log('unbroken copy: a 90 s soak shows flat memory');
  pick(SOAK).forEach((d, i) => {
    const c = copyGame('soak-' + (i + 1), d);
    report('soak', d, c.error ? null : run('soak.js', [path.join(WORK, 'soak-out-' + (i + 1)), path.join(WORK, 'chrome'), '90'], { HOP_WEB: c.web }), c.error, /flat false/);
  });
}
const injected = rows.filter((r) => r.injected).length, caught = rows.filter((r) => r.caught).length;
fs.writeFileSync(path.join(WORK, 'defects.json'), JSON.stringify(rows, null, 2));
console.log(`\n${rows.length} defects, ${injected} injected, ${caught} caught`);
console.log(`${injected} injected, ${caught} caught`);
process.exit(injected === rows.length && caught === rows.length && rows.length > 0 ? 0 : 1);
