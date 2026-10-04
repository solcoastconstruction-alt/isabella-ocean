// Treasure Blocks: proof that the tests bite. Each "mutant" is a copy of the game with one thing broken on purpose;
// the tests must fail on every one of them. (The real files are never touched: the copies live under .local/.)
//   node test/games/blocks/mutants.js            (every mutant: about 20 minutes; uses DevTools port 9484)
//   node test/games/blocks/mutants.js --rules    (only the ones verify.js must catch: about 3 minutes, no browser)
//   node test/games/blocks/mutants.js --only <name> [--only <name> ...]
//   node test/games/blocks/mutants.js --list
// First the untouched copy must PASS both tests (otherwise a failure would prove nothing). Then, for each mutant:
// the text to change must be found exactly once (so a mutant can never quietly stop applying after the code is
// reshaped), the change is made, and the test must exit non-zero with a FAIL line, which is printed.
// Ends with "N defects injected, N caught" and exits non-zero if any defect got through.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '../../..');
const SRC = path.join(REPO, 'web/games/blocks');
const WORK = path.join(REPO, '.local/mutants');
const ROOT = path.join(WORK, 'root');
const DST = path.join(ROOT, 'web/games/blocks');
const rot13 = (s) => s.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

// by: which test must catch it ('verify' = verify.js --quick, 'browser' = browser.js at 915x412, stopping at the first failure)
const MUTANTS = [
  // ---- the rules (logic.js), caught by verify.js ----
  { name: 'rows-do-not-settle', what: 'a full row goes but what was above it stays hanging', by: 'verify', file: 'logic.js',
    find: `if (gone.indexOf(y) >= 0) continue;`, put: `if (gone.indexOf(y) >= 0) { for (let x = 0; x < W; x++) g[y * W + x] = 0; to--; continue; }` },
  { name: 'row-one-short', what: 'a row with one gap counts as full', by: 'verify', file: 'logic.js',
    find: `if (n === W) full.push(y);`, put: `if (n >= W - 1) full.push(y);` },
  { name: 'no-bonus', what: 'several rows at once pay no bonus', by: 'verify', file: 'logic.js',
    find: `const BONUS = [0, 0, 1, 2, 4, 6];`, put: `const BONUS = [0, 0, 0, 0, 0, 0];` },
  { name: 'bag-is-dice', what: 'pieces are picked at random instead of from the bag (droughts possible)', by: 'verify', file: 'logic.js',
    find: `const id = this.queue[this.at++];`, put: `this.at++; const id = this.pool[Math.floor(this.rng() * this.pool.length)];` },
  { name: 'seed-ignored', what: 'the seed is ignored: the same seed deals different games', by: 'verify', file: 'logic.js',
    find: `this.bag = new Bag(M.bag, rngFor(this.seed));`, put: `this.bag = new Bag(M.bag, Math.random);` },
  { name: 'always-the-same-game', what: 'a game without a seed is always the same game', by: 'verify', file: 'logic.js',
    find: `function freshSeed() {`, put: `function freshSeed() { return 12345;` },
  { name: 'easy-can-end', what: 'Easy has no wave: the round ends when the well is full', by: 'verify', file: 'logic.js',
    find: `lockDelay: 0.9, dropGuard: 0.35, wave: 4,`, put: `lockDelay: 0.9, dropGuard: 0.35, wave: 0,` },
  { name: 'wave-washes-nothing', what: 'the wave comes but washes nothing away', by: 'verify', file: 'logic.js',
    find: `g.copyWithin(k * W, 0, (H - k) * W);`, put: `` },
  { name: 'turn-flips', what: 'a turn mirrors the piece instead of turning it', by: 'verify', file: 'logic.js',
    find: `cells = cells.map(([x, y]) => [n - 1 - y, x]);`, put: `cells = cells.map(([x, y]) => [y, x]);` },
  { name: 'through-the-wall', what: 'pieces can go one cell through the left wall', by: 'verify', file: 'logic.js',
    find: `if (cx < 0 || cx >= W || cy < 0 || cy >= H || g[cy * W + cx]) return false;`, put: `if (cx < -1 || cx >= W || cy < 0 || cy >= H || g[cy * W + cx]) return false;` },
  { name: 'turn-into-blocks', what: 'a turn that does not fit is made anyway', by: 'verify', file: 'logic.js',
    find: `if (this.fits(c.id, r, c.x + kx, c.y + ky)) { c.rot = r;`, put: `if (i === KICKS.length - 1 || this.fits(c.id, r, c.x + kx, c.y + ky)) { c.rot = r;` },
  { name: 'goal-one-late', what: 'the round goes on after the row goal is reached', by: 'verify', file: 'logic.js',
    find: `if (this.rowsDone >= this.goal) { this.phase = 'goal';`, put: `if (this.rowsDone > this.goal) { this.phase = 'goal';` },
  { name: 'hard-never-quicker', what: 'Hard never gets quicker', by: 'verify', file: 'logic.js',
    find: `speed: 0.6, accel: 0.015,`, put: `speed: 0.6, accel: 0,` },
  { name: 'drop-at-once', what: 'drop works the instant a piece appears (a double tap throws the next one down)', by: 'verify', file: 'logic.js',
    find: `this.age < this.M.dropGuard) return -1;`, put: `this.age < 0) return -1;` },
  { name: 'no-time-to-slide', what: 'a landed piece settles at once', by: 'verify', file: 'logic.js',
    find: `if (this.restT >= this.M.lockDelay) this.lock(0);`, put: `if (this.restT >= 0) this.lock(0);` },
  { name: 'outline-one-short', what: 'the outline (and the drop) stop one row above where the piece should land', by: 'verify', file: 'logic.js',
    find: `while (this.fits(c.id, c.rot, c.x, y + 1)) y++;`, put: `while (this.fits(c.id, c.rot, c.x, y + 2)) y++;` },
  { name: 'save-forgets-keys', what: 'the save loses its keys when it is read back', by: 'verify', file: 'logic.js',
    find: `sv.keys[m] = n(s.keys[m]);`, put: `sv.keys[m] = 0;` },
  { name: 'that-word', what: 'the forbidden name slips into a comment', by: 'verify', file: 'art.js',
    find: `/* Treasure Blocks — everything you see, drawn in code.`, put: `/* Treasure Blocks (like ${rot13('grgevf')[0].toUpperCase() + rot13('grgevf').slice(1)}) — everything you see, drawn in code.` },
  // ---- the game on the screen (game.js, art.js, index.html), caught by browser.js ----
  { name: 'left-goes-right', what: 'the left button slides the piece right', by: 'browser', file: 'game.js',
    find: `pad('padLeft', () => slide(-1), true);`, put: `pad('padLeft', () => slide(1), true);` },
  { name: 'hold-does-not-repeat', what: 'a held button slides only once', by: 'browser', file: 'game.js',
    find: `if (repeat) { h.down = true; h.t = 0; h.next = HOLD_AFTER; }`, put: `` },
  { name: 'pull-does-not-drop', what: 'a pull down on the well does nothing', by: 'browser', file: 'game.js',
    find: `g.axis = 'done'; counters.swipes++;\n      drop();`, put: `g.axis = 'done'; counters.swipes++;` },
  { name: 'tap-does-not-turn', what: 'a tap on the well does nothing', by: 'browser', file: 'game.js',
    find: `{ counters.taps++; turn(); }`, put: `{ counters.taps++; }` },
  { name: 'sloppy-drag-drops', what: 'a drag that drifts downward drops the piece', by: 'browser', file: 'game.js',
    find: `g.axis = dy > Math.abs(dx) * 1.5 ? 'down'`, put: `g.axis = dy > Math.abs(dx) * 0.5 ? 'down'` },
  { name: 'coins-not-saved', what: 'coins are not written to the save when a row pays', by: 'browser', file: 'game.js',
    find: `L.bankRows(save, r.mode, e.n, g.rowsAll);\n        persist();`, put: `L.bankRows(save, r.mode, e.n, g.rowsAll);` },
  { name: 'mist-never-clears', what: 'a full row clears no band of mist', by: 'browser', file: 'game.js',
    find: `later(0.3, () => { r.bandsTo = Math.max(r.bandsTo, to); A.reveal(); });`, put: `later(0.3, () => { A.reveal(); });` },
  { name: 'picture-never-drawn-clear', what: 'the clear picture is never drawn (the mist line moves, nothing shows)', by: 'browser', file: 'art.js',
    find: `if (cpx > 0) { ctx.drawImage(P.clear, 0, 0, P.pw, cpx, x0, y0, lay.w, clearH); drawn.clearRows = cpx; }`, put: `` },
  { name: 'no-outline', what: 'the outline where the piece will land is not drawn', by: 'browser', file: 'art.js',
    find: `if (v.ghostY != null && v.ghostY > cur.y) {`, put: `if (false) {` },
  { name: 'no-key', what: 'reaching the row goal adds no key to the save', by: 'browser', file: 'game.js',
    find: `L.bankKey(save, r.mode);\n        persist();`, put: `persist();` },
  { name: 'keep-going-empties', what: '"keep going" throws the blocks away', by: 'browser', file: 'game.js',
    find: `if (!r || !r.results || !r.g.keepGoing()) return;`, put: `if (!r || !r.results || !r.g.keepGoing()) return;\n    r.g.grid.fill(0);` },
  { name: 'small-buttons', what: 'the four play buttons are 16vh', by: 'browser', file: 'index.html',
    find: `--pad:min(27vh, 12.2vw);`, put: `--pad:min(16vh, 12.2vw);` },
  { name: 'home-goes-astray', what: 'the home button goes to the wrong page', by: 'browser', file: 'game.js',
    find: `const HUB = '../../index.html';`, put: `const HUB = '../index.html';` },
  { name: 'mute-rewrites-save', what: 'the sound switch overwrites the main game\'s whole save', by: 'browser', file: 'game.js', sizes: '915x412',
    find: `obj.muted = !!on;`, put: `obj = { muted: !!on };` },
  { name: 'dpr-uncapped', what: 'the canvas is not capped at 2.5 device pixels', by: 'browser', file: 'art.js',
    find: `dpr = Math.min(window.devicePixelRatio || 1, 2.5);`, put: `dpr = window.devicePixelRatio || 1;` },
  { name: 'hint-hand-stays', what: 'the first-time hand never goes away', by: 'browser', file: 'game.js',
    find: `(r.handOn && !r.inputs && r.pt > 1.4`, put: `(r.handOn && r.pt > 1.4` },
];

const args = process.argv.slice(2);
if (args.includes('--list')) { for (const m of MUTANTS) console.log(`${m.name.padEnd(28)} ${m.by.padEnd(8)} ${m.what}`); process.exit(0); }
const only = args.map((a, i) => (a === '--only' ? args[i + 1] : null)).filter(Boolean);
const rulesOnly = args.includes('--rules');
const chosen = MUTANTS.filter((m) => (only.length ? only.includes(m.name) : true) && (!rulesOnly || m.by === 'verify'));
if (!chosen.length) { console.log('no such mutant; try --list'); process.exit(2); }

// a copy of the site with a copy of the game in it: everything else is linked, so the hub and the other games work
function pristine() {
  fs.rmSync(ROOT, { recursive: true, force: true });
  fs.mkdirSync(path.join(ROOT, 'web/games'), { recursive: true });
  for (const f of fs.readdirSync(path.join(REPO, 'web'))) if (f !== 'games') fs.symlinkSync(path.join(REPO, 'web', f), path.join(ROOT, 'web', f));
  for (const f of fs.readdirSync(path.join(REPO, 'web/games'))) if (f !== 'blocks') fs.symlinkSync(path.join(REPO, 'web/games', f), path.join(ROOT, 'web/games', f));
  fs.cpSync(SRC, DST, { recursive: true });
}
function run(by, sizes) {
  const env = Object.assign({}, process.env, { BLOCKS_WEB: DST, BLOCKS_ROOT: ROOT });
  const t0 = Date.now();
  let r;
  if (by === 'verify') r = spawnSync(process.execPath, [path.join(__dirname, 'verify.js'), '--quick'], { env, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 300000 });
  else {
    Object.assign(env, { BLOCKS_BAIL: '1', BLOCKS_SIZES: sizes || '915x412' });
    r = spawnSync(process.execPath, [path.join(__dirname, 'browser.js'), path.join(WORK, 'shots'), path.join(WORK, 'chrome')], { env, encoding: 'utf8', maxBuffer: 1 << 26, timeout: 600000 });
  }
  const out = (r.stdout || '') + (r.stderr || '');
  return { code: r.status, fails: out.split('\n').filter((l) => /^\s*FAIL/.test(l)), out, secs: Math.round((Date.now() - t0) / 1000) };
}

let caught = 0, problems = 0;
const kinds = [...new Set(chosen.map((m) => m.by))];
console.log(`the untouched copy must pass first (${kinds.join(' and ')})`);
pristine();
for (const by of kinds) {
  const r = run(by);
  const ok = r.code === 0 && r.fails.length === 0;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${by === 'verify' ? 'verify.js --quick' : 'browser.js at 915x412'} on the untouched copy: ${ok ? 'passes' : 'does NOT pass'} (${r.secs} s)`);
  if (!ok) { console.log(r.fails.slice(0, 5).join('\n') || r.out.slice(-600)); process.exit(1); }
}
console.log(`\n${chosen.length} defects, one at a time`);
for (const m of chosen) {
  pristine();
  const file = path.join(DST, m.file), text = fs.readFileSync(file, 'utf8'), n = text.split(m.find).length - 1;
  if (n !== 1) { problems++; console.log(`  FAIL ${m.name}: the text to change was found ${n} times in ${m.file}, not once (the mutant no longer applies)`); continue; }
  fs.writeFileSync(file, text.replace(m.find, () => m.put));
  const r = run(m.by, m.sizes);
  const ok = r.code !== 0 && r.fails.length > 0;
  if (ok) caught++; else problems++;
  console.log(`  ${ok ? 'caught' : 'MISSED'} ${m.name}: ${m.what} (${m.by}.js, ${r.secs} s)`);
  console.log(`         ${ok ? r.fails[0].trim().slice(0, 230) : 'the test still passed'}${r.fails.length > 1 ? `  (+${r.fails.length - 1} more)` : ''}`);
}
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`\n${chosen.length} defects injected, ${caught} caught${problems ? `, ${problems} NOT caught` : ''}`);
process.exit(problems ? 1 : 0);
