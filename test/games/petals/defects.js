// Petal Patterns: do the checks bite? Break a copy of the game on purpose, one defect at a time, and run the tests on it.
//   node test/games/petals/defects.js            every defect: the rule ones (Node, seconds each), then the browser
//                                                ones (headless Chrome, about half a minute each), then one soak
//   node test/games/petals/defects.js rules      only the ones verify.js must catch
//   node test/games/petals/defects.js browser    only the ones browser.js must catch
//   node test/games/petals/defects.js soak       only the leak soak.js must catch
// Each defect is one or more exact pieces of text swapped for others in a copy under <repo>/.local/defects-petals. A defect
// whose text is no longer in the file is an error (the game has changed and the defect must be written again), and so is
// an unbroken copy that fails. Prints "N injected, N caught" and exits non-zero unless every defect is injected AND caught.
// Some generator defects come twice: once with logic.js's own guard still on (it re-rolls the bad rounds, so the
// generator cannot finish and the run fails), and once with the guard switched off too (so verify.js's separate
// brute-force solver has to catch the bad rounds itself).
'use strict';
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'web/games/petals');
const FAIRY = path.join(ROOT, 'web/fairy');
const WORK = path.join(ROOT, '.local/defects-petals');
const which = process.argv[2] || 'all';
const ONLY = process.argv[3] ? new RegExp(process.argv[3]) : null;   // node defects.js browser "another game" runs only the defects whose name matches

const GUARD_OFF = { find: 'function analyse(round, cfg) {\n    const why = [];', put: 'function analyse(round, cfg) {\n    return { ok: true, reasons: [] };\n    const why = [];' };

const RULES = [
  { name: 'two choices are the right answer (the guard on: every round is re-rolled, none can be made)', file: 'logic.js',
    edits: [{ find: 'const all = shuffle(rng, [fcopy(answer)].concat(wrong));', put: 'const all = shuffle(rng, [fcopy(answer), fcopy(answer)].concat(wrong.slice(1)));' }] },
  { name: 'two choices are the right answer (the guard switched off)', file: 'logic.js',
    edits: [{ find: 'const all = shuffle(rng, [fcopy(answer)].concat(wrong));', put: 'const all = shuffle(rng, [fcopy(answer), fcopy(answer)].concat(wrong.slice(1)));' }, GUARD_OFF] },
  { name: 'a wrong choice is the answer itself (the guard switched off)', file: 'logic.js',
    edits: [{ find: '      if (f[0] === answer[0] && f[1] === answer[1]) continue;\n', put: '' },
      { find: 'if (sameCK(f, answer) || chosen.some((q) => sameCK(q, f))) return false;', put: 'if (chosen.some((q) => sameCK(q, f))) return false;' }, GUARD_OFF] },
  { name: 'a wrong choice has the answer\'s colour AND kind and differs only in size (the guard switched off)', file: 'logic.js',
    edits: [{ find: '      if (f[0] === answer[0] && f[1] === answer[1]) continue;\n', put: '      if (f[0] === answer[0] && f[1] === answer[1] && f[2] === answer[2]) continue;\n' },
      { find: 'if (sameCK(f, answer) || chosen.some((q) => sameCK(q, f))) return false;', put: 'if (fsame(f, answer) || chosen.some((q) => fsame(q, f))) return false;' },
      { find: "if (!has('s')) f[2] = answer[2]; else if (rng() < 0.5) f[2] = f[2] ^ 1;", put: "if (!has('s')) f[2] = answer[2]; else f[2] = answer[2];" }, GUARD_OFF] },
  { name: 'a row shows one period, not two (the guard switched off)', file: 'logic.js',
    edits: [{ find: "const m = mode === 'easy' ? 2 * maxP :", put: "const m = mode === 'easy' ? 1 * maxP :" }, GUARD_OFF] },
  { name: 'a row shows one period, not two (the guard on)', file: 'logic.js',
    edits: [{ find: "const m = mode === 'easy' ? 2 * maxP :", put: "const m = mode === 'easy' ? 1 * maxP :" }] },
  { name: 'Medium rows are cut short (floor of 2.5 periods, so a unit of 3 shows 7 and not 8)', file: 'logic.js',
    edits: [{ find: "mode === 'medium' ? Math.ceil(2.5 * maxP)", put: "mode === 'medium' ? Math.floor(2.5 * maxP)" }] },
  { name: 'a wrong flower is accepted', file: 'logic.js',
    edits: [{ find: 'const choiceRight = (round, i) => !!round.choices && i === round.correct;', put: 'const choiceRight = (round, i) => !!round.choices;' }] },
  { name: 'in an odd-one-out round any pot is accepted', file: 'logic.js',
    edits: [{ find: "const potRight = (round, i) => round.type === 'O' && i === round.odd;", put: "const potRight = (round, i) => round.type === 'O';" }] },
  { name: 'the hint points at a distractor', file: 'logic.js',
    edits: [{ find: "{ choice: round.correct }", put: "{ choice: (round.correct + 1) % round.choices.length }" }] },
  { name: 'the hint points at the wrong pot in an odd-one-out round', file: 'logic.js',
    edits: [{ find: "{ pot: round.odd }", put: "{ pot: 0 }" }] },
  { name: 'Hard has three choices, like Medium (a mode that does not scale)', file: 'logic.js',
    edits: [{ find: 'const CHOICES = { easy: 2, medium: 3, hard: 4 };', put: 'const CHOICES = { easy: 2, medium: 3, hard: 3 };' }] },
  { name: 'Easy waits 12 seconds for the hint', file: 'logic.js',
    edits: [{ find: 'const HINT_S = { easy: 8,', put: 'const HINT_S = { easy: 12,' }] },
  { name: 'the hint comes a moment after its time, not at it', file: 'logic.js',
    edits: [{ find: 'const hintDue = (idle, mode) => idle >= (HINT_S[mode] || HINT_S.easy);', put: 'const hintDue = (idle, mode) => idle > (HINT_S[mode] || HINT_S.easy);' }] },
  { name: 'three wrong taps still earn two stars', file: 'logic.js',
    edits: [{ find: 'wrong <= 2 ? 2 : 1', put: 'wrong <= 3 ? 2 : 1' }] },
  { name: 'finishing level 9 opens World 2 (level 11) early', file: 'logic.js',
    edits: [{ find: 'save.unlocked[mode] = Math.min(NLEV, Math.max(save.unlocked[mode], level + 1));', put: 'save.unlocked[mode] = Math.min(NLEV, Math.max(save.unlocked[mode], level + (level === 9 ? 2 : 1)));' }] },
  { name: 'a worse replay lowers the stars already won', file: 'logic.js',
    edits: [{ find: 'arr[level - 1] = Math.max(arr[level - 1] || 0, stars);', put: 'arr[level - 1] = stars;' }] },
  { name: 'World 2 has five rounds a level, not six', file: 'logic.js',
    edits: [{ find: 'const roundsIn = (n) => (n >= 11 ? 6 : 5);', put: 'const roundsIn = (n) => 5;' }] },
  { name: 'level 7 draws on a different pool (a level drifting)', file: 'logic.js',
    edits: [{ find: "/*  7 */ { attr: 'ck', sh: [AB, ABB, AAB, ABC], nc: 5, nk: 5, traps: 3 },", put: "/*  7 */ { attr: 'ck', sh: [AB, ABB, AAB, ABC], nc: 5, nk: 5, traps: 4 }," }] },
  { name: 'the same seed gives different rounds (the seed drifts)', file: 'logic.js',
    edits: [{ find: '`petals|${level}|${mode}|${variant | 0}`', put: '`petals|${level}|${mode}|${(variant | 0) + 1}`' }] },
  { name: 'an odd-one-out row has two odd pots (the guard switched off)', file: 'logic.js',
    edits: [{ find: '    row[e] = odd;\n', put: '    row[e] = odd; row[(e + 3) % L] = fcopy(odd);\n' }, GUARD_OFF] },
  { name: 'an odd-one-out round comes with a tray (the guard switched off)', file: 'logic.js',
    edits: [{ find: "row, answer: want, choices: null, correct: -1, odd: e,", put: "row, answer: want, choices: [fcopy(want), fcopy(odd)], correct: 0, odd: e," }, GUARD_OFF] },
  { name: 'odd-one-out rounds appear on Medium too', file: 'logic.js',
    edits: [{ find: 'odd: hard && !!S.odd,', put: 'odd: !!S.odd,' }] },
  { name: 'level 1 varies the kind as well as the colour', file: 'logic.js',
    edits: [{ find: "/*  1 */ { attr: 'c', sh: [AB], nc: 3, nk: 0, traps: 0 },", put: "/*  1 */ { attr: 'ck', sh: [AB], nc: 3, nk: 4, traps: 0 }," }] },
  { name: 'the size varies on Medium', file: 'logic.js',
    edits: [{ find: "if (S.attr === 'indep') lists = { c: S.cs, k: S.ks, s: hard ? S.ss : [], ck: [] };", put: "if (S.attr === 'indep') lists = { c: S.cs, k: S.ks, s: S.ss, ck: [] };" },
      { find: "const withSize = mode === 'hard' && cfg.lists.s.length > 0;", put: "const withSize = cfg.lists.s.length > 0;" }] },
  { name: 'a staircase row is one pot short', file: 'logic.js',
    edits: [{ find: 'medium: { g: 3, j: 2 }', put: 'medium: { g: 3, j: 1 }' }] },
  { name: 'two colours are nearly the same (yellow turned orange)', file: 'logic.js',
    edits: [{ find: "'#ffd93d', '#5ad17a'", put: "'#ffa84a', '#5ad17a'" }] },
  { name: 'the choice flowers are too small to touch (96 units)', file: 'logic.js',
    edits: [{ find: 'TRAY_Y = 452, CARD = 136;', put: 'TRAY_Y = 452, CARD = 96;' }] },
  { name: 'an odd-one-out row does not zig-zag on a squarer screen, so pots overlap', file: 'logic.js',
    edits: [{ find: 'const zig = !!o.target && pitch < TARGET_MIN + 2;', put: 'const zig = false;' }] },
  { name: 'a saved level count is not tidied (a save can open level 99)', file: 'logic.js',
    edits: [{ find: 'if (u >= 1) d.unlocked[m] = Math.min(NLEV, Math.floor(u));', put: 'if (u >= 1) d.unlocked[m] = Math.floor(u);' }] },
];

const BROWSER = [
  { name: 'the game accepts a wrong flower', file: 'game.js', only: 'seeker',
    edits: [{ find: 'if (L.choiceRight(R, i)) { counters.rights++; correct(i); return; }', put: 'if (true) { counters.rights++; correct(i); return; }' }] },
  { name: 'the game accepts any pot in an odd-one-out round', file: 'game.js', only: 'seeker',
    edits: [{ find: 'if (L.potRight(R, i)) { counters.rights++; correct(i); return; }', put: 'if (true) { counters.rights++; correct(i); return; }' }] },
  { name: 'the hint hand rests on a distractor', file: 'game.js', only: 'seeker',
    edits: [{ find: 'const q = g.plates[R.correct];\n    return { x: q.x + 4, y: q.y - 8 };', put: 'const q = g.plates[(R.correct + 1) % g.plates.length];\n    return { x: q.x + 4, y: q.y - 8 };' }] },
  { name: 'the hint never shows', file: 'game.js', only: 'seeker',
    edits: [{ find: 'else if (L.hintDue(r.idle, r.mode)) {', put: 'else if (false) {' }] },
  { name: 'a tap does not start the quiet spell again', file: 'game.js', only: 'seeker',
    edits: [{ find: '    r.idle = 0; r.hint = null;\n    if (r.phase !== \'ask\') return;', put: '    if (r.phase !== \'ask\') return;' }] },
  { name: 'Easy never lifts the repeating unit', file: 'game.js', only: 'seeker',
    edits: [{ find: "if (r.mode === 'easy' && !r.pulsed && R.unit) { r.pulsed = true; r.pulse = { t: 0 }; counters.pulses++; }", put: '' }] },
  { name: 'the treasure chest never comes', file: 'game.js', only: 'seeker',
    edits: [{ find: 'if (r.ri + 1 < r.rounds.length) setupRound(r.ri + 1); else startWin(); }', put: 'if (r.ri + 1 < r.rounds.length) setupRound(r.ri + 1); }' }] },
  { name: 'the stars and the next level are not saved', file: 'game.js', only: 'seeker',
    edits: [{ find: 'r.stars = L.finishLevel(save, mode, r.n, r.wrong);', put: 'r.stars = L.starsFor(r.wrong);' }] },
  { name: 'saved under another game\'s key', file: 'game.js', only: 'seeker',
    edits: [{ find: "SAVE_KEY = 'game.petals.save'", put: "SAVE_KEY = 'game.pop.save'" }] },
  { name: 'a coin is not in the save until the level ends', file: 'game.js', only: 'seeker',
    edits: [{ find: 'save.coins += L.COINS_PER_ROUND; save.rounds++;\n    persist();', put: 'save.coins += L.COINS_PER_ROUND; save.rounds++;' }] },
  { name: 'a wrong tap is not counted (three stars for a messy level)', file: 'game.js', only: 'seeker',
    edits: [{ find: 'r.wrong++; r.roundWrong++; counters.wrongs++;', put: 'r.roundWrong++; counters.wrongs++;' }] },
  { name: 'the same faded flower counts again and again', file: 'game.js', only: 'seeker',
    edits: [{ find: 'if (was) { counters.ignored++; return; }', put: 'if (false) { counters.ignored++; return; }' }] },
  { name: 'a wrong flower does not fade', file: 'game.js', only: 'seeker',
    edits: [{ find: 'wrongTap(p.fade > 0, () => { p.wob = 1; p.droop = 1; p.fade = FADE_T; });', put: 'wrongTap(p.fade > 0, () => { p.wob = 1; p.droop = 1; });' }] },
  { name: 'the wrong flower is planted', file: 'game.js', only: 'seeker',
    edits: [{ find: 'r.planted = true; r.potF[last] = R.answer.slice(); r.bloom[last] = 0;', put: 'r.planted = true; r.potF[last] = R.row[1].slice(); r.bloom[last] = 0;' }] },
  { name: 'the row does not bloom in a wave (every pot opens at once)', file: 'game.js', only: 'seeker',
    edits: [{ find: 'r.bloom[i] = smooth((r.pt - i * WAVE_STEP) / WAVE_OPEN);', put: 'r.bloom[i] = smooth(r.pt / WAVE_OPEN);' }] },
  { name: 'no butterflies and no coin come after a right answer', file: 'game.js', only: 'seeker',
    edits: [{ find: 'for (let k = 0; k < 3; k++) {\n      const i = Math.min', put: 'for (let k = 0; k < 0; k++) {\n      const i = Math.min' }, { find: 'r.coinsFly.push({ t: 0, x0: tgt.x, y0: tgt.y - 30 });', put: '' }] },
  { name: 'the home button goes to the wrong page', file: 'game.js', only: 'seeker',
    edits: [{ find: "HUB = '../../index.html'", put: "HUB = '../index.html'" }] },
  { name: 'window.__back is missing', file: 'game.js', only: 'seeker',
    edits: [{ find: 'window.__back = () => { persist(); location.href = HUB; return true; };', put: '' }] },
  { name: 'the level bubbles are too small to tap (15vh)', file: 'index.html', only: 'seeker',
    edits: [{ find: '--b:20vh;', put: '--b:15vh;' }] },
  { name: 'the mode buttons are too small to tap (14vh)', file: 'index.html', only: 'seeker',
    edits: [{ find: '.mode { width:19vh; height:19vh;', put: '.mode { width:14vh; height:14vh;' }] },
  { name: 'the rotate overlay is missing', file: 'index.html', only: 'extras',
    edits: [{ find: '@media (orientation: portrait) { #rotate { display:flex; } }', put: '' }] },
  { name: 'the game writes the main game\'s save', file: 'game.js', only: 'extras',
    edits: [{ find: '  function persist() { store.set(SAVE_KEY, JSON.stringify(save)); counters.persists++; }', put: "  function persist() { store.set(SAVE_KEY, JSON.stringify(save)); store.set('isabella.save', JSON.stringify({ muted })); counters.persists++; }" }] },
  { name: 'the mute switch is ignored', file: 'game.js', only: 'extras',
    edits: [{ find: '  let muted = readMuted();', put: '  let muted = false;' }] },
  { name: 'the save skips window.IsabellaStore', file: 'game.js', only: 'extras',
    edits: [{ find: '      try { if (window.IsabellaStore) { window.IsabellaStore.set(k, v); return; } } catch (e) { /* fall through */ }\n', put: '' }] },
  { name: 'window.__pause is missing', file: 'game.js', only: 'seeker',
    edits: [{ find: 'window.__pause = () => { S.suspend(); persist(); };', put: '' }] },
];
const SOAK = [
  { name: 'a little memory is kept every frame (a leak)', file: 'game.js',
    edits: [{ find: '    if (r.hudPulse > 0) r.hudPulse = Math.max(0, r.hudPulse - dt * 2);', put: '    if (r.hudPulse > 0) r.hudPulse = Math.max(0, r.hudPulse - dt * 2);\n    (window.__kept = window.__kept || []).push(new Array(40).fill(dt));' }] },
];

function copyGame(tag, d) {
  const web = path.join(WORK, tag), dir = path.join(web, 'games/petals');
  fs.rmSync(web, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(dir, f));
  fs.mkdirSync(path.join(web, 'fairy'), { recursive: true });
  for (const f of fs.readdirSync(FAIRY)) fs.copyFileSync(path.join(FAIRY, f), path.join(web, 'fairy', f));
  fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>hub stand-in</title>');
  if (d) {
    const file = path.join(dir, d.file);
    let src = fs.readFileSync(file, 'utf8');
    for (const e of d.edits) {
      const n = src.split(e.find).length - 1;
      if (n !== 1) return { web, dir, error: `the text to break is in ${d.file} ${n} times (it must be there exactly once): ${e.find.slice(0, 70)}` };
      src = src.replace(e.find, () => e.put);
    }
    fs.writeFileSync(file, src);
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
  else for (const f of r.fails.slice(0, 3)) console.log('          <- ' + f);
  if (!copyError && r.fails.length > 3) console.log(`          ... and ${r.fails.length - 3} more`);
}

fs.mkdirSync(WORK, { recursive: true });
if (which === 'all' || which === 'rules') {
  const clean = copyGame('clean');
  const base = run('verify.js', ['--quick'], { PETALS_LOGIC: path.join(clean.dir, 'logic.js') });
  if (base.code !== 0) { console.log('an UNBROKEN copy fails verify.js: fix that first\n' + base.fails.join('\n')); process.exit(2); }
  console.log('unbroken copy: verify.js passes');
  RULES.forEach((d, i) => {
    const c = copyGame('rule-' + (i + 1), d);
    report('rules', d, c.error ? null : run('verify.js', ['--quick'], { PETALS_LOGIC: path.join(c.dir, 'logic.js') }), c.error);
  });
}
if (which === 'all' || which === 'browser') {
  const clean = copyGame('clean-browser');
  const base = run('browser.js', [path.join(WORK, 'shots-clean'), path.join(WORK, 'chrome'), '--only=seeker'], { PETALS_WEB: clean.web });
  if (base.code !== 0) { console.log('an UNBROKEN copy fails browser.js: fix that first\n' + base.fails.join('\n')); process.exit(2); }
  console.log('unbroken copy: browser.js passes');
  BROWSER.forEach((d, i) => {
    if (ONLY && !ONLY.test(d.name)) return;
    const c = copyGame('browser-' + (i + 1), d);
    report('browser', d, c.error ? null : run('browser.js', [path.join(WORK, 'shots-' + (i + 1)), path.join(WORK, 'chrome'), '--only=' + d.only], { PETALS_WEB: c.web }), c.error);
  });
}
if (which === 'all' || which === 'soak') {
  // the control first: an unbroken copy, soaked for the same 90 seconds, must show flat memory
  const clean = copyGame('clean-soak');
  const base = run('soak.js', [path.join(WORK, 'soak-out-clean'), path.join(WORK, 'chrome'), '90'], { PETALS_WEB: clean.web });
  if (!/SOAK PASS|flat true/.test(base.out)) { console.log('an UNBROKEN copy does not show flat memory in a 90 s soak: fix that first\n' + base.out.slice(-600)); process.exit(2); }
  console.log('unbroken copy: a 90 s soak shows flat memory');
  SOAK.forEach((d, i) => {
    const c = copyGame('soak-' + (i + 1), d);
    report('soak', d, c.error ? null : run('soak.js', [path.join(WORK, 'soak-out-' + (i + 1)), path.join(WORK, 'chrome'), '90'], { PETALS_WEB: c.web }), c.error, /flat false/);
  });
}
const injected = rows.filter((r) => r.injected).length, caught = rows.filter((r) => r.caught).length;
fs.writeFileSync(path.join(WORK, 'defects.json'), JSON.stringify(rows, null, 2));
console.log(`\n${rows.length} defects, ${injected} injected, ${caught} caught`);
console.log(`${injected} injected, ${caught} caught`);
process.exit(injected === rows.length && caught === rows.length && rows.length > 0 ? 0 : 1);
