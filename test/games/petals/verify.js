// Petal Patterns: the rules, proven in Node (no browser).
//   node test/games/petals/verify.js            everything (about a minute: 2,000 extra random rounds per level and mode)
//   node test/games/petals/verify.js --quick    200 extra random rounds per level and mode (a few seconds; the defect runs use this)
//   node test/games/petals/verify.js --freeze   (re)write test/games/petals/fingerprints.json from the current generator
//   PETALS_LOGIC=<file> runs it against another copy of logic.js (to prove the checks catch an injected defect).
//
// THE GUARD THAT MATTERS: every round has EXACTLY ONE right answer. logic.js has its own guard (analyse); this file does
// NOT call it. It judges every round with a SEPARATE brute-force solver written here: it enumerates every pattern the shown
// row could be (each attribute alone, any period, built by cycling the first p values; every staircase built from every
// ordering of the flowers in the row; for odd-one-out every unit of up to a third of the row with exactly one exception)
// and demands that all of them say the same thing, that exactly one choice is that flower, and that every other choice
// looks different from it in colour or kind.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../..');
const L = require(path.resolve(process.env.PETALS_LOGIC || path.join(ROOT, 'web/games/petals/logic.js')));
const FP_FILE = path.join(__dirname, 'fingerprints.json');
const QUICK = process.argv.includes('--quick'), FREEZE = process.argv.includes('--freeze');
const EXTRA = QUICK ? 200 : 2000;

process.on('uncaughtException', (e) => { console.log('FAIL  crashed: ' + (e && e.message)); process.exit(1); });
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail != null ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
}
const fmt = (f) => f.join('.');
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

// ============ the independent solver ============
function perms(alpha, m) {                 // every ordering of m distinct flowers from the alphabet
  const out = [];
  const go = (cur, used) => { if (cur.length === m) { out.push(cur.slice()); return; } for (let i = 0; i < alpha.length; i++) if (!used[i]) { used[i] = true; cur.push(alpha[i]); go(cur, used); cur.pop(); used[i] = false; } };
  go([], []);
  return out;
}
function product(alpha, m) {               // every sequence of length m (repeats allowed)
  let out = [[]];
  for (let k = 0; k < m; k++) { const nx = []; for (const o of out) for (const a of alpha) nx.push(o.concat([a])); out = nx; }
  return out;
}
// What could come next? Returns { preds: Set<string> (flowers), wild: bool (some hypothesis fits but cannot say) }.
function nextFlowers(row) {
  const n = row.length, preds = new Set();
  let wild = false;
  // (1) repeating units, each attribute on its own
  const per = [0, 1, 2].map((a) => {
    const out = new Set();
    for (let p = 1; p * 2 <= n; p++) {
      const cyc = row.slice(0, p).map((f) => f[a]);
      let ok = true;
      for (let i = 0; i < n && ok; i++) if (cyc[i % p] !== row[i][a]) ok = false;
      if (ok) out.add(cyc[n % p]);
    }
    return out;
  });
  for (const c of per[0]) for (const k of per[1]) for (const s of per[2]) preds.add(fmt([c, k, s]));
  // (2) a staircase: group 1 is b0, group 2 is b0 b1, group 3 is b0 b1 b2 ... for every ordering of different flowers from the row
  const alpha = [], seen = new Set();
  for (const f of row) if (!seen.has(fmt(f))) { seen.add(fmt(f)); alpha.push(f); }
  for (let g = 2; g <= 6; g++) {
    const t = (g * (g + 1)) / 2;
    if (!(t <= n && n < t + g + 1)) continue;       // g complete groups, then part of the next
    if (alpha.length < g) continue;
    const j = n - t;
    for (const base of perms(alpha, g)) {
      const flat = [];
      for (let k = 1; k <= g + 1; k++) for (let i = 0; i < k; i++) flat.push(i < g ? base[i] : null);
      let ok = true;
      for (let i = 0; i < n && ok; i++) if (flat[i] === null || !same(flat[i], row[i])) ok = false;
      if (!ok) continue;
      if (j < g) preds.add(fmt(base[j])); else wild = true;
    }
  }
  return { preds, wild };
}
// Odd one out: which pots could be the one that breaks a unit of period p (each slot seen at least three times)?
function oddPots(row) {
  const L2 = row.length, alpha = [], seen = new Set();
  for (const f of row) if (!seen.has(fmt(f))) { seen.add(fmt(f)); alpha.push(f); }
  const cand = new Set();
  for (let p = 1; p * 3 <= L2; p++) {
    for (const base of product(alpha, p)) {
      const bad = [];
      for (let i = 0; i < L2; i++) if (!same(base[i % p], row[i])) bad.push(i);
      if (bad.length === 1) cand.add(bad[0]);
    }
  }
  let perfect = false;
  for (let p = 1; p * 2 <= L2 && !perfect; p++) {
    let ok = true;
    for (let i = 0; i < L2 && ok; i++) if (!same(row[i % p], row[i])) ok = false;
    if (ok) perfect = true;
  }
  // and the other way round: which pots, once replaced by SOME flower, make the row perfectly periodic?
  const fixable = new Set();
  for (let i = 0; i < L2; i++) {
    for (const f of alpha) {
      const r2 = row.slice(); r2[i] = f;
      for (let p = 1; p * 3 <= L2; p++) { let ok = true; for (let k = 0; k < L2 && ok; k++) if (!same(r2[k % p], r2[k])) ok = false; if (ok) fixable.add(i); }
    }
  }
  return { cand, perfect, fixable };
}
// the shortest period of each attribute over the whole row (+ the answer)
function minPeriod(seq) { for (let p = 1; p <= seq.length; p++) { let ok = true; for (let i = p; i < seq.length && ok; i++) if (seq[i] !== seq[i - p]) ok = false; if (ok) return p; } return seq.length; }
function varying(row) { return [0, 1, 2].map((a) => new Set(row.map((f) => f[a])).size > 1); }
const partition = (seq) => { const m = new Map(); return seq.map((v) => { if (!m.has(v)) m.set(v, m.size); return m.get(v); }).join(''); };

// ============ judging one round ============
const PAL = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const cdist = (a, b) => { const A = hex(PAL[a]), B = hex(PAL[b]); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
function judge(r, level, mode) {
  const why = [], cfg = L.config(level, mode);
  const okFlower = (f) => Array.isArray(f) && f.length === 3 && f[0] >= 0 && f[0] < 7 && f[1] >= 0 && f[1] < 6 && (f[2] === 0 || f[2] === 1) && Number.isInteger(f[0] + f[1] + f[2]);
  if (!r.row.every(okFlower) || !okFlower(r.answer)) { why.push('a flower is out of range'); return why; }
  if (r.type === 'O') {
    if (r.choices) why.push('an odd-one-out round has a tray');
    if (mode !== 'hard') why.push('odd-one-out outside Hard');
    const { cand, perfect, fixable } = oddPots(r.row);
    if (perfect) why.push('the row has no odd pot');
    if (!(cand.size === 1 && cand.has(r.odd))) why.push('odd pots: ' + [...cand].join(','));
    if (!(fixable.size === 1 && fixable.has(r.odd))) why.push('fixable pots: ' + [...fixable].join(','));
    if (!(r.odd >= 0 && r.odd < r.row.length)) why.push('odd index out of the row');
    else if (r.row[r.odd][0] === r.answer[0] && r.row[r.odd][1] === r.answer[1]) why.push('the odd pot looks like the one that belongs');
    const want = r.row.map((f, i) => (i === r.odd ? r.answer : f));
    const pk = [0, 1, 2].map((a) => minPeriod(want.map((f) => f[a])));
    if (Math.max.apply(null, pk) * 3 > r.row.length) why.push('fewer than three units shown');
    return why;
  }
  const { preds, wild } = nextFlowers(r.row);
  if (wild) why.push('a staircase fits but cannot say');
  if (!(preds.size === 1 && preds.has(fmt(r.answer)))) why.push('predictions: ' + [...preds].join(' | ') + ' vs answer ' + fmt(r.answer));
  if (!r.choices || r.choices.length !== L.CHOICES[mode]) why.push('wrong number of choices');
  if (r.choices) {
    const right = r.choices.map((f, i) => (fmt(f) === [...preds][0] ? i : -1)).filter((i) => i >= 0);
    if (right.length !== 1) why.push('choices equal to the prediction: ' + right.length);
    if (right.length === 1 && r.correct !== right[0]) why.push('the marked correct index is not the right flower');
    for (let i = 0; i < r.choices.length; i++) {
      const f = r.choices[i];
      if (!okFlower(f)) { why.push('choice out of range'); continue; }
      if (i !== r.correct && f[0] === r.answer[0] && f[1] === r.answer[1]) why.push('a wrong choice has the same colour AND kind as the answer');
      for (let k = i + 1; k < r.choices.length; k++) {
        const q = r.choices[k];
        if (f[0] === q[0] && f[1] === q[1]) why.push('two choices look alike');
        if (f[0] !== q[0] && cdist(f[0], q[0]) < 55) why.push('two choices are nearly the same colour');
      }
    }
  }
  if (r.type === 'P') {
    // two full periods are on show: every attribute's own shortest period fits twice in the row
    const full = r.row.concat([r.answer]);
    const pk = [0, 1, 2].map((a) => minPeriod(full.map((f) => f[a])));
    const P = Math.max.apply(null, pk);
    if (r.row.length < 2 * P) why.push('fewer than two periods shown (' + r.row.length + ' < 2x' + P + ')');
    const want = mode === 'easy' ? 2 * P : mode === 'medium' ? Math.ceil(2.5 * P) : Math.min(3 * P, 12);
    if (r.row.length !== want) why.push(`row length ${r.row.length} is not the ${mode} length ${want}`);
  } else if (r.type === 'G') {
    const gs = r.groups.slice(0, -1);
    if (gs.length < 3) why.push('fewer than three groups shown');
    if (r.row.length !== (mode === 'hard' ? 12 : mode === 'medium' ? 8 : 7)) why.push('a staircase row of the wrong length');
  }
  return why;
}
// which attributes may vary, per level and mode (the table of the brief), judged from the flowers themselves
function judgeAttrs(r, level, mode) {
  const why = [];
  if (r.type === 'G' || r.type === 'O') {
    const g = mode === 'easy' ? level >= 18 : level >= 16;
    if (r.type === 'G' && !g) why.push('a staircase too early');
    if (r.type === 'O' && !(mode === 'hard' && level >= 18)) why.push('odd-one-out outside Hard 18-20');
  }
  const full = r.type === 'O' ? r.row.map((f, i) => (i === r.odd ? r.answer : f)) : r.row.concat([r.answer]);
  const v = varying(full), c = full.map((f) => f[0]), k = full.map((f) => f[1]);
  const nv = (v[0] ? 1 : 0) + (v[1] ? 1 : 0);
  if (level <= 3 && (v[1] || v[2])) why.push('only colour may vary on levels 1-3');
  if (level >= 4 && level <= 6 && (v[0] || v[2])) why.push('only kind may vary on levels 4-6');
  if (v[2] && !(mode === 'hard' && level >= 13)) why.push('size varies outside Hard 13+');
  if (mode === 'easy' && nv !== 1) why.push('Easy varies exactly one of colour and kind');
  if (mode !== 'easy' && r.type === 'P') {
    if (level >= 7 && !(v[0] && v[1]) && !v[2]) why.push('colour and kind should both vary here');
    if (level >= 7 && level <= 13 && v[0] && v[1] && partition(c) !== partition(k)) why.push('colour and kind change together on 7-13');
    if (level >= 14 && v[0] && v[1] && partition(c) === partition(k)) why.push('colour and kind should follow different cycles from 14');
  }
  return why;
}

// ============ the frozen rounds and the extras ============
const t0 = Date.now();
const stats = { attempts: 0, rerolls: 0 };
const frozen = {};
for (const m of L.MODES) for (let n = 1; n <= 20; n++) frozen[m + n] = L.levelRounds(n, m, 0, stats);

// --- structure of the level table ---
{
  let bad = [];
  for (const m of L.MODES) for (let n = 1; n <= 20; n++) {
    const c = L.config(n, m), rs = frozen[m + n];
    if (rs.length !== (n >= 11 ? 6 : 5) || c.rounds !== rs.length) bad.push(`${m}${n} rounds ${rs.length}`);
    if (c.choices !== { easy: 2, medium: 3, hard: 4 }[m]) bad.push(`${m}${n} choices`);
    if (c.hint !== { easy: 8, medium: 15, hard: 25 }[m]) bad.push(`${m}${n} hint`);
    if (c.world !== (n >= 11 ? 2 : 1)) bad.push(`${m}${n} world`);
  }
  check('20 levels x 3 modes: 5 rounds (6 on World 2), 2/3/4 choices, hints at 8/15/25 s', bad.length === 0, bad.slice(0, 4));
}

// --- no ambiguity: the frozen rounds ---
{
  let rounds = 0; const bad = [];
  for (const m of L.MODES) for (let n = 1; n <= 20; n++) frozen[m + n].forEach((r, i) => { rounds++; const w = judge(r, n, m).concat(judgeAttrs(r, n, m)); if (w.length) bad.push(`${m}${n}#${i}: ${w[0]}`); });
  check(`NO AMBIGUITY: all ${rounds} frozen rounds have exactly one answer (separate brute-force solver)`, bad.length === 0, bad.slice(0, 5));
}
// --- no ambiguity: many more rounds, per level and mode ---
{
  const rng = L.mulberry32(20261010);
  let rounds = 0; const bad = [], byType = { P: 0, G: 0, O: 0 }, rs = { attempts: 0, rerolls: 0 };
  for (const m of L.MODES) for (let n = 1; n <= 20; n++) {
    for (let i = 0; i < EXTRA; i++) {
      const r = L.randomRound(n, m, rng, null, rs);
      rounds++; byType[r.type]++;
      const w = judge(r, n, m).concat(judgeAttrs(r, n, m));
      if (w.length) bad.push(`${m}${n}: ${w[0]}`);
    }
  }
  stats.attempts += rs.attempts; stats.rerolls += rs.rerolls;
  check(`NO AMBIGUITY: ${rounds} extra random rounds (${EXTRA} per level and mode) have exactly one answer`, bad.length === 0, bad.slice(0, 5));
  check('the random rounds include periodic, staircase and odd-one-out rounds', byType.P > 0 && byType.G > 0 && byType.O > 0, byType);
}
// --- replays (variants 1..3) are checked too ---
{
  const bad = []; let n3 = 0;
  for (const m of L.MODES) for (let n = 1; n <= 20; n++) for (let v = 1; v <= 3; v++) {
    const rs = L.levelRounds(n, m, v, stats);
    rs.forEach((r, i) => { n3++; const w = judge(r, n, m).concat(judgeAttrs(r, n, m)); if (w.length) bad.push(`${m}${n} v${v}#${i}: ${w[0]}`); });
  }
  const a = JSON.stringify(L.levelRounds(5, 'medium', 1)), b = JSON.stringify(L.levelRounds(5, 'medium', 0)), c = JSON.stringify(L.levelRounds(5, 'medium', 1));
  check(`replay variants 1-3 (${n3} rounds) are all unambiguous`, bad.length === 0, bad.slice(0, 4));
  check('a replay is different from the frozen level, and the same variant always gives the same rounds', a !== b && a === c);
}
// --- the odd-one-out rounds ---
{
  const odds = [];
  for (let n = 1; n <= 20; n++) for (const m of L.MODES) for (const r of frozen[m + n]) if (r.type === 'O') odds.push({ n, m, r });
  const onlyHard = odds.every((o) => o.m === 'hard' && o.n >= 18);
  const per = [18, 19, 20].map((n) => frozen['hard' + n].filter((r) => r.type === 'O').length);
  check('odd-one-out rounds exist only on Hard 18-20 (2, 3 and 3 of them), with no tray', onlyHard && per.join() === '2,3,3' && odds.every((o) => !o.r.choices), per);
  const one = odds.every(({ r }) => { const x = oddPots(r.row); return x.cand.size === 1 && x.cand.has(r.odd) && x.fixable.size === 1; });
  check('each odd-one-out row has exactly one odd pot (found two ways)', odds.length === 8 && one, odds.length);
}
// --- the staircase rounds ---
{
  const gs = [];
  for (let n = 1; n <= 20; n++) for (const m of L.MODES) for (const r of frozen[m + n]) if (r.type === 'G') gs.push({ n, m, r });
  const firstEasy = Math.min.apply(null, gs.filter((g) => g.m === 'easy').map((g) => g.n)), firstMed = Math.min.apply(null, gs.filter((g) => g.m === 'medium').map((g) => g.n)), firstHard = Math.min.apply(null, gs.filter((g) => g.m === 'hard').map((g) => g.n));
  check('staircase (growing) rounds start at level 16 on Medium and Hard, 18 on Easy', firstMed === 16 && firstHard === 16 && firstEasy === 18, [firstEasy, firstMed, firstHard]);
  const ok = gs.every(({ r }) => r.groups.slice(0, -1).every((v, i) => v === i + 1) && r.answer && nextFlowers(r.row).preds.size === 1);
  check('every staircase row is groups of 1, 2, 3 ... then part of the next, and its next flower is determined', ok, gs.length);
}

// --- the families and attributes across the levels ---
{
  const fam = new Set(); let hasKind = new Set(), hasCol = new Set();
  for (const m of L.MODES) for (let n = 1; n <= 20; n++) for (const r of frozen[m + n]) { String(r.fam).split('+').forEach((f) => fam.add(f)); r.row.forEach((f) => { hasKind.add(f[1]); hasCol.add(f[0]); }); }
  const want = ['AB', 'ABB', 'AAB', 'ABC', 'AABB', 'ABAC', 'ABCD', 'GROW', 'ODD'];
  check('every pattern family appears somewhere in the frozen levels', want.every((f) => fam.has(f)), [...fam].join(','));
  check('all 7 colours and all 6 kinds are used', hasKind.size === 6 && hasCol.size === 7, [hasCol.size, hasKind.size]);
}
// --- difficulty rises ---
{
  // from the rounds themselves: the longest unit, the attributes that vary, the choices, the row length
  const obs = {};
  for (const m of L.MODES) for (let n = 1; n <= 20; n++) {
    const rs = frozen[m + n]; let maxP = 0, vary = 0, row = 0, special = 0;
    for (const r of rs) {
      const full = r.type === 'O' ? r.row : r.row.concat([r.answer]);
      if (r.type === 'P') maxP = Math.max(maxP, Math.max.apply(null, [0, 1, 2].map((a) => minPeriod(full.map((f) => f[a])))));
      else if (r.type === 'G') { maxP = Math.max(maxP, 5); special++; } else { maxP = Math.max(maxP, 6); special++; }
      vary = Math.max(vary, varying(full).filter(Boolean).length);
      row += r.row.length / rs.length;
    }
    obs[m + n] = { maxP, vary, row, choices: L.CHOICES[m], special, score: maxP * 10 + vary * 6 + L.CHOICES[m] * 4 + row + special * 2 };
  }
  const mean = (m, a, b) => { let s = 0; for (let n = a; n <= b; n++) s += obs[m + n].score; return s / (b - a + 1); };
  let ok1 = true, ok2 = true, ok3 = true; const info = {};
  for (const m of L.MODES) {
    const t = [mean(m, 1, 3), mean(m, 4, 6), mean(m, 7, 10)], u = [mean(m, 11, 13), mean(m, 14, 16), mean(m, 17, 20)];
    info[m] = t.concat(u).map((v) => Math.round(v));
    if (!(t[0] < t[1] && t[1] < t[2])) ok1 = false;
    if (!(u[0] < u[1] && u[1] < u[2])) ok2 = false;
    if (!(u[0] > t[2] || obs[m + 11].score > obs[m + 10].score)) ok3 = false;
  }
  check('difficulty seen in the rounds rises through levels 1-10 (thirds), in every mode', ok1, info);
  check('difficulty seen in the rounds rises through levels 11-20 (thirds), in every mode', ok2, info);
  check('level 11 is harder than level 10 in every mode (the table)', L.MODES.every((m) => L.difficulty(11, m) > L.difficulty(10, m)), L.MODES.map((m) => [L.difficulty(10, m), L.difficulty(11, m)]));
  // and the top of World 1 against the top of World 2, from the rounds (the most demanding family met on levels 8-10 against 17-20)
  check('World 2 asks more than World 1 in the rounds themselves, in every mode', L.MODES.every((m) => mean(m, 17, 20) > mean(m, 7, 10) + 5 && mean(m, 11, 13) > mean(m, 1, 3)), info);
  // from the table: families allowed, attributes, choices, row length
  const d = (n, m) => L.difficulty(n, m);
  let up = true, steps = {}; const slips = [];
  for (const m of L.MODES) {
    let strict = 0;
    for (let n = 2; n <= 20; n++) { if (d(n, m) < d(n - 1, m)) { up = false; slips.push(`${m} ${n - 1}->${n}`); } if (d(n, m) > d(n - 1, m)) strict++; }
    steps[m] = strict;
  }
  check('the level table never gets easier from one level to the next, in any mode', up, slips);
  check('and Medium gets harder at 18 or more of its 19 steps', steps.medium >= 18, steps);
  check('level 10 is harder than level 1, and level 20 than level 11, in every mode', L.MODES.every((m) => d(10, m) > d(1, m) && d(20, m) > d(11, m) && d(11, m) > d(10, m)));
  let ord = true; const wrong = [];
  for (let n = 1; n <= 20; n++) if (!(d(n, 'easy') < d(n, 'medium') && d(n, 'medium') < d(n, 'hard'))) { ord = false; wrong.push(n); }
  check('Easy < Medium < Hard on every level (table)', ord, wrong);
  let ord2 = true; const wrong2 = [];
  for (let n = 1; n <= 20; n++) if (!(obs['easy' + n].score < obs['medium' + n].score && obs['medium' + n].score < obs['hard' + n].score)) { ord2 = false; wrong2.push(n); }
  check('Easy < Medium < Hard on every level (seen in the rounds)', ord2, wrong2);
  const scal = L.MODES.map((m) => L.config(1, m)), scalOk = scal[0].choices < scal[1].choices && scal[1].choices < scal[2].choices && scal[0].periods < scal[1].periods && scal[1].periods < scal[2].periods && scal[0].hint < scal[1].hint && scal[1].hint < scal[2].hint;
  check('a mode scales the choices (2/3/4), the periods shown (2/2.5/3) and the hint wait (8/15/25 s)', scalOk);
  // Easy: one attribute varying; Hard allows them all at that level
  let easyOne = true;
  for (let n = 1; n <= 20; n++) for (const r of frozen['easy' + n]) { if (r.type === 'O') continue; const v = varying(r.row.concat([r.answer])); if (v[0] + v[1] + v[2] !== 1) easyOne = false; }
  check('Easy: exactly one attribute varies in every round', easyOne);
  let hardTop = 0, hardSize = 0;
  for (let n = 1; n <= 20; n++) for (const r of frozen['hard' + n]) { const v = varying(r.type === 'O' ? r.row : r.row.concat([r.answer])); if (v[0] && v[1] && v[2]) hardTop++; if (v[2]) hardSize++; }
  check('Hard uses all three attributes (colour, kind, size) in some rounds, size only from level 13', hardTop > 0 && hardSize > 0, { three: hardTop, size: hardSize });
}

// --- hints, stars, saves ---
{
  const sec = { easy: L.HINT_S.easy, medium: L.HINT_S.medium, hard: L.HINT_S.hard };
  check('hint timers: Easy 8 s, Medium 15 s, Hard 25 s', sec.easy === 8 && sec.medium === 15 && sec.hard === 25, sec);
  check('the hint is due exactly at the wait, not before', !L.hintDue(7.99, 'easy') && L.hintDue(8, 'easy') && !L.hintDue(14.9, 'medium') && L.hintDue(15, 'medium') && !L.hintDue(24.9, 'hard') && L.hintDue(25, 'hard') && !L.hintDue(0, 'easy'));
  let ok = true, odd = true, n = 0;
  for (const m of L.MODES) for (let lv = 1; lv <= 20; lv++) for (const r of frozen[m + lv]) {
    n++;
    const t = L.hintTarget(r);
    if (r.type === 'O') { if (t.pot !== r.odd || t.choice !== undefined) odd = false; }
    else if (!(t.choice === r.correct && same(r.choices[t.choice], r.answer))) ok = false;
  }
  check(`the hint always points at the right flower, never a distractor (${n} rounds)`, ok && odd);
  check('a tap on a wrong choice is not accepted, the right one is', L.MODES.every((m) => frozen[m + 5].every((r) => r.choices.every((f, i) => L.choiceRight(r, i) === (i === r.correct)))));
  check('in an odd-one-out round only the odd pot is accepted', frozen.hard18.filter((r) => r.type === 'O').every((r) => r.row.every((f, i) => L.potRight(r, i) === (i === r.odd))));
  check('stars: 3 for no wrong taps, 2 for one or two, 1 for more; never for speed', L.starsFor(0) === 3 && L.starsFor(1) === 2 && L.starsFor(2) === 2 && L.starsFor(3) === 1 && L.starsFor(40) === 1 && L.starsFor.length === 1);
  const sv = L.defaultSave();
  const s1 = L.finishLevel(sv, 'easy', 1, 3);
  check('finishing a level keeps the stars, opens the next, counts a chest', s1 === 1 && sv.stars.easy[0] === 1 && sv.unlocked.easy === 2 && sv.chests === 1 && sv.unlocked.medium === 1 && sv.unlocked.hard === 1);
  L.finishLevel(sv, 'easy', 1, 0); L.finishLevel(sv, 'easy', 1, 5);
  check('the best stars are kept (a worse replay never lowers them) and the level count only moves forward', sv.stars.easy[0] === 3 && sv.unlocked.easy === 2 && sv.plays.easy[0] === 3);
  for (let i = 1; i <= 9; i++) L.finishLevel(sv, 'easy', i + 1, 0);
  check('World 2 (level 11) opens when level 10 of that mode is finished, not before', (() => { const t = L.defaultSave(); for (let i = 1; i <= 9; i++) L.finishLevel(t, 'hard', i, 0); const before = t.unlocked.hard; L.finishLevel(t, 'hard', 10, 1); return before === 10 && t.unlocked.hard === 11 && t.unlocked.easy === 1; })(), sv.unlocked.easy);
  L.finishLevel(sv, 'easy', 20, 0);
  check('the last level never opens a level 21', sv.unlocked.easy === 20);
  const bad = L.migrate('{not json'), junk = L.migrate({ mode: 'nope', unlocked: { easy: 99, medium: -4 }, stars: { hard: [7, -1, 'x', 2] }, coins: -5 });
  check('a broken or odd save becomes a safe one', bad.unlocked.easy === 1 && bad.mode === 'easy' && junk.mode === 'easy' && junk.unlocked.easy === 20 && junk.unlocked.medium === 1 && junk.stars.hard.join() === '3,0,0,2' && junk.coins === 0, junk);
  const sh = L.defaultSave();
  check('the save has the shape of docs/FAIRY.md (v, mode, unlocked, stars per mode, coins)', sh.v === 1 && ['easy', 'medium', 'hard'].every((m) => sh.unlocked[m] === 1 && Array.isArray(sh.stars[m])) && sh.coins === 0 && sh.mode === 'easy');
  check('coins: a coin for every round, five from the chest', L.COINS_PER_ROUND === 1 && L.CHEST_COINS === 5);
}

// --- the picture: palette, layout, touch targets ---
{
  let min = 1e9; for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) min = Math.min(min, cdist(a, b));
  check('any two of the seven colours are visibly different (RGB distance at least 55)', min >= 55 && L.RAINBOW.length === 7 && L.RAINBOW.every((c, i) => c === PAL[i]), Math.round(min));
  const MIN = 0.19 * 540;
  const bad = [];
  for (const vw of [720, 800, 960, 1080, 1199, 1335, 1500]) {
    const ch = [2, 3, 4].map((n) => L.layoutChoices(n, vw));
    for (const row of ch) {
      row.forEach((p, i) => {
        if (p.w < MIN || p.h < MIN) bad.push(`vw ${vw} plate ${p.w}`);
        if (p.x - p.w / 2 < 0 || p.x + p.w / 2 > vw) bad.push(`vw ${vw} plate off screen`);
        if (p.y + p.h / 2 > 540) bad.push('plate below the screen');
        if (i && p.x - p.w / 2 < row[i - 1].x + row[i - 1].w / 2) bad.push(`vw ${vw} plates overlap`);
      });
    }
    for (const n of [8, 9]) {
      const lay = L.layoutRow(n, vw, { target: true }), pts = lay.pots.map((p) => [p.x, 296 + p.dy]);
      for (let i = 0; i < n; i++) {
        if (pts[i][0] - lay.reach < 0 || pts[i][0] + lay.reach > vw) bad.push(`vw ${vw} n ${n} pot off screen`);
        for (let k = i + 1; k < n; k++) if (Math.hypot(pts[i][0] - pts[k][0], pts[i][1] - pts[k][1]) < 2 * lay.reach - 0.5) bad.push(`vw ${vw} n ${n} pots ${i},${k} closer than a touch target`);
      }
      if (lay.reach * 2 < MIN - 0.01) bad.push('reach too small');
    }
  }
  check('touch targets are at least 19vh: the choice plates and the pots of an odd-one-out row, from iPad to widescreen, none overlapping, all on screen', bad.length === 0, [...new Set(bad)].slice(0, 4));
  const wide = L.layoutRow(13, 1199, {}), narrow = L.layoutRow(13, 720, {});
  check('a long row of pots shrinks to fit any width, staying inside the screen', [wide, narrow].every((l, i) => l.pots.every((p) => p.x > 0 && p.x < (i ? 720 : 1199))) && narrow.scale < wide.scale);
}


// --- the guard in logic.js itself refuses bad rounds (hand-made ones) ---
{
  const f = (c, k, s) => [c, k, s === undefined ? 1 : s];
  const cfg = L.config(1, 'medium');
  const good = { type: 'P', fam: 'AB', vary: 'c', link: 'single', row: [f(0, 1), f(2, 1), f(0, 1), f(2, 1), f(0, 1)], answer: f(2, 1), choices: [f(2, 1), f(0, 1), f(4, 1)], correct: 0, odd: -1, unit: [0, 2], groups: null, n: 5 };
  const clone = (r) => JSON.parse(JSON.stringify(r));
  const bad = [];
  const verdict = (name, r, want, cf) => { const v = L.analyse(r, cf || cfg).ok; if (v !== want) bad.push(`${name}: ${v}`); };
  verdict('a good round', good, true);
  const a = clone(good); a.row = a.row.slice(0, 1); a.unit = [0, 2]; verdict('one period shown', a, false);
  const b = clone(good); b.choices[1] = f(2, 1); verdict('two right choices', b, false);
  const c = clone(good); c.choices[1] = f(2, 1, 0); verdict('a wrong choice with the same colour and kind', c, false);
  const d = clone(good); d.choices = d.choices.slice(0, 2); verdict('too few choices', d, false);
  const e = clone(good); e.correct = 1; verdict('the wrong index marked', e, false);
  const g = clone(good); g.answer = f(4, 1); g.choices = [f(4, 1), f(0, 1), f(2, 1)]; verdict('an answer the row does not give', g, false);
  const h = clone(good); h.row = [f(0, 1), f(2, 1), f(0, 1), f(2, 1), f(0, 1), f(4, 1)]; h.answer = f(2, 1); verdict('a row that stops being a pattern', h, false);
  const o = { type: 'O', fam: 'ODD', vary: 'c', shape: 'AB', link: 'single', row: [f(0, 1), f(2, 1), f(0, 1), f(2, 1), f(4, 1), f(2, 1), f(0, 1), f(2, 1)], answer: f(0, 1), choices: null, correct: -1, odd: 4, unit: null, groups: null, n: 8 };
  verdict('an odd-one-out round', o, true);
  const o2 = clone(o); o2.row[1] = f(4, 1); verdict('two odd pots', o2, false);
  const o3 = clone(o); o3.row[4] = f(0, 1); o3.odd = 4; verdict('no odd pot at all', o3, false);
  const o4 = clone(o); o4.odd = 3; verdict('the wrong pot marked odd', o4, false);
  const o5 = clone(o); o5.choices = [f(0, 1), f(2, 1)]; verdict('an odd round with a tray', o5, false);
  const gr = { type: 'G', fam: 'GROW', vary: 'c', link: 'single', row: [f(0, 1), f(0, 1), f(2, 1), f(0, 1), f(2, 1), f(4, 1), f(0, 1)], answer: f(2, 1), choices: [f(2, 1), f(4, 1)], correct: 0, odd: -1, unit: [3, 6], groups: [1, 2, 3, 1], n: 7 };
  const easy = L.config(1, 'easy');
  verdict('a staircase round', gr, true, easy);
  const gr2 = clone(gr); gr2.answer = f(4, 1); gr2.choices = [f(4, 1), f(2, 1)]; verdict('a staircase with the wrong next flower', gr2, false, easy);
  check('the generator\'s own guard refuses ambiguous and malformed rounds and passes sound ones (a sample of hand-made rounds)', bad.length === 0, bad);
}

// --- frozen by fingerprint ---
{
  const fp = {};
  for (const m of L.MODES) for (let n = 1; n <= 20; n++) fp[`${m}${n}`] = crypto.createHash('sha1').update(JSON.stringify(frozen[m + n])).digest('hex').slice(0, 16);
  if (FREEZE) { fs.writeFileSync(FP_FILE, JSON.stringify(fp, null, 1) + '\n'); console.log('wrote ' + FP_FILE); }
  const want = JSON.parse(fs.readFileSync(FP_FILE, 'utf8'));
  const diff = Object.keys(fp).filter((k) => want[k] !== fp[k]);
  check(`the rounds of all 60 levels (20 x 3 modes) are frozen by fingerprint`, Object.keys(want).length === 60 && diff.length === 0, diff.slice(0, 6));
  const again = {};
  for (const m of L.MODES) for (const n of [1, 9, 15, 20]) again[m + n] = JSON.stringify(L.levelRounds(n, m, 0));
  check('the same seed gives the same rounds, run after run', Object.keys(again).every((k) => again[k] === JSON.stringify(frozen[k])));
}

// --- the re-roll rate ---
{
  const rate = stats.attempts ? (100 * stats.rerolls) / stats.attempts : 0;
  check(`re-rolls: ${stats.rerolls} of ${stats.attempts} generated rounds failed the guard and were made again (${rate.toFixed(3)}%; under 5% is healthy)`, stats.rerolls <= stats.attempts * 0.05 && stats.attempts > 1000, { attempts: stats.attempts, rerolls: stats.rerolls });
}

console.log(`\n${pass} passed, ${fail} failed  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
