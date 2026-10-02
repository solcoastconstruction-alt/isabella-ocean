// Coral Maze: proves every level can be escaped, and that none can trap her; freezes the levels.
//   node test/games/maze/verify.js
// For each of the 20 levels:
//   - fingerprint: the level built from its seed must be exactly the one frozen below (and the same twice);
//   - solvable: a search over the FULL state (Isabella's cell, every key and gate, the shell she returns to,
//     every patrol's position and direction) finds the way out; par = fewest moves (glides) out;
//   - cross-checked: a second, independent search (plain breadth-first by moves, string keys) agrees on par;
//   - fair: every state she can get into (by glides, taps and waiting) can still get out — no traps;
//   - replayed: the solver's plan, played tick by tick through step() as the game plays it, escapes in par
//     moves and earns 3 stars;
//   - in play: every key, patrol and helping current lies on the best way out;
//   - the rules hold under 2000 random moves per level (resting is safe, a touch only sends her back to her
//     shell, no swimming through walls, locked gates or against a current);
//   - the difficulty metric rises from each level to the next, and each new thing arrives on its own, gently.
// Exits non-zero on any failure.
'use strict';
const crypto = require('crypto');
const L = require('../../../web/games/maze/logic.js');

// Frozen 3 Oct 2026. Changing a level changes stars she may already have earned on it: don't.
const FROZEN = [
  'aa356ff43e9b', '6caaec96a543', 'ad42bba7999a', '351c80a03e9d', 'c081af1519f1',
  'a414f907cbd4', '3583d83e1a0b', '9a366e1b9c08', '020698db4952', '2efcdad8fe5d',
  'd350a64ee3e7', '5bb009c963ec', '706b8edb18e8', 'a2a0974f3d79', '72b0752b1ccd',
  '371d48d9e0c9', '2bc645538a77', '5e671399ab54', '196c93ebdaaa', 'cefbbaa276a3',
];
const fingerprint = (lv) => crypto.createHash('sha1').update(L.describe(lv)).digest('hex').slice(0, 12);

let fails = 0;
const problems = [];
const bad = (n, what) => { fails++; problems.push(`level ${n}: ${what}`); };

// An independent search: breadth-first by number of moves, waiting folded into each layer, states as strings.
function parByLayers(lv) {
  const key = (s) => [s.cell, s.cp, Array.from(s.items).join(','), Array.from(s.pp).join(','), Array.from(s.ps).join(',')].join('|');
  const seen = new Set();
  let layer = [L.newState(lv)];
  seen.add(key(layer[0]));
  for (let moves = 0; moves < 200 && layer.length; moves++) {
    // close the layer under waiting (free)
    if (lv.patrols.length) {
      for (let i = 0; i < layer.length; i++) {
        const w = L.cloneState(lv, layer[i]);
        L.step(lv, w, -1, -1, null);
        const k = key(w);
        if (!seen.has(k)) { seen.add(k); layer.push(w); }
      }
    }
    const next = [];
    for (const s of layer) {
      for (let d = 0; d < 4; d++) {
        if (!L.canPass(lv, s, s.cell, d)) continue;
        const g = L.cloneState(lv, s);
        if (L.glide(lv, g, d, -1, null) === 2) return moves + 1;
        const k = key(g);
        if (!seen.has(k)) { seen.add(k); next.push(g); }
      }
    }
    layer = next;
  }
  return -1;
}

// Play the plan the way game.js does: one step() per tick, a glide starting at its tick if she is resting.
function replay(lv, plan) {
  const st = L.newState(lv), out = {};
  let tick = 0, moves = 0, hits = 0, i = 0;
  while (!st.won && tick < 5000) {
    let input = -1;
    if (st.moving < 0 && i < plan.length && tick >= plan[i].at) { input = plan[i].dir; i++; }
    const r = L.step(lv, st, input, -1, out);
    if (out.started) moves++;
    if (r === 1) hits++;
    tick++;
  }
  return { won: st.won, moves, hits, tick };
}

const rows = [];
const t0 = Date.now();
for (let n = 1; n <= L.LEVELS.length; n++) {
  const cfg = L.LEVELS[n - 1];
  const lv = L.build(n), again = L.build(n), fp = fingerprint(lv);
  if (!lv.ok) bad(n, 'did not build: ' + lv.why);
  if (fingerprint(again) !== fp) bad(n, 'not deterministic: two builds differ');
  if (fp !== FROZEN[n - 1]) bad(n, `CHANGED (fingerprint ${fp}, frozen ${FROZEN[n - 1]})`);
  const a = L.analyze(lv);
  if (!a.solvable) { bad(n, 'NO WAY OUT'); rows.push({ n, cfg, lv, fp, a }); continue; }
  if (!a.fair) bad(n, `${a.trapped} trapped state(s), e.g. resting at cell ${a.trapState.cell}`);
  if (a.par !== cfg.par) bad(n, `par in LEVELS is ${cfg.par} but the solver finds ${a.par}`);
  const layered = parByLayers(lv);
  if (layered !== a.par) bad(n, `independent search finds ${layered} moves, solver ${a.par}`);
  const rp = replay(lv, a.plan);
  if (!rp.won || rp.moves !== a.par || rp.hits) bad(n, `replayed plan: won=${rp.won} moves=${rp.moves} hits=${rp.hits}`);
  if (L.starsFor(a.par, rp.moves) !== 3) bad(n, 'the best way out does not earn 3 stars');
  rows.push({ n, cfg, lv, fp, a, layered, rp });
}

// Each level's things are really in play: every key lies on the best way out (its gate cannot be avoided),
// every patrol's lane meets that way, and every current meant to help is ridden on it.
for (const r of rows) {
  if (!r.a.plan) continue;
  const cells = new Set([r.lv.start]);
  for (const s of r.a.plan) for (const c of s.cells) cells.add(c);
  r.lv.keys.forEach((k, i) => { if (!cells.has(k.cell)) bad(r.n, `key ${i} is not on the way out`); });
  r.lv.patrols.forEach((p, j) => { if (!p.cells.some((c) => cells.has(c))) bad(r.n, `patrol ${j} never meets the way out`); });
  (r.cfg.currents || []).forEach((c, i) => { if (c.mode === 'help' && !r.lv.currents[i].cells.some((x) => cells.has(x))) bad(r.n, `helping current ${i} is not ridden`); });
}

// The rules, tried at random in every level (2000 moves each, from a fixed seed so every run is the same):
//   - keeping still is always safe: however long she rests, no patrol touches her or even comes within reach;
//   - a touch sends her back to her last shell (or the start), resting, with every key and gate as they were;
//   - she only ever swims through open tunnels: never a wall, never a gate before she has its key, never into a
//     current against its flow; she never rests inside a current; a gate never opens without its key.
const ruleCount = { moves: 0, ticks: 0, restTicks: 0, touches: 0, taps: 0 };
function rules(n) {
  const lv = L.build(n), rng = L.mulberry32(7000 + n), st = L.newState(lv), out = {}, prev = L.newState(lv);
  const fail = (what) => { bad(n, 'rules: ' + what); return true; };
  const reachOf = (j) => { const p = lv.patrols[j]; return Math.hypot(L.patrolX(p, st.pp[j]) - lv.cx[st.cell], L.patrolY(p, st.pp[j]) - lv.cy[st.cell]); };
  const tick = (input, tapTo) => {
    L.copyState(prev, st);
    const r = L.step(lv, st, input, tapTo, out);
    ruleCount.ticks++;
    const resting = prev.moving < 0 && !out.started;
    if (resting) {
      ruleCount.restTicks++;
      if (r === 1) return fail('touched while resting') && -1;
      for (let j = 0; j < lv.patrols.length; j++) if (reachOf(j) < L.HIT) return fail(`patrol ${j} within reach of her while she rests`) && -1;
    }
    if (r === 1) {
      ruleCount.touches++;
      const home = st.cp >= 0 ? lv.shells[st.cp] : lv.start;
      if (st.cell !== home || st.moving >= 0 || st.cp !== prev.cp) return fail('a touch did not send her back to her shell, resting') && -1;
      if (Array.from(st.items).join() !== Array.from(prev.items).join()) return fail('a touch changed her keys or gates') && -1;
      return r;
    }
    for (let g = 0; g < lv.gates.length; g++) if (prev.items[g] === L.FLOOR && st.items[g] === L.OPEN) return fail(`gate ${g} opened without its key`) && -1;
    if (out.from !== out.to && r !== 2) {
      const d = out.dir, g = lv.gateAt[out.from * 4 + d];
      if (!(lv.open[out.from] & (1 << d)) || lv.nx[out.from * 4 + d] !== out.to) return fail(`swam through a wall from cell ${out.from}`) && -1;
      if (g >= 0 && prev.items[g] === L.FLOOR) return fail(`swam through gate ${g} without its key`) && -1;
      if (lv.cur[out.to] === L.OPP[d]) return fail(`swam into a current against its flow at cell ${out.to}`) && -1;
    }
    if (st.moving < 0 && !st.won && lv.cur[st.cell] >= 0) return fail(`came to rest inside a current at cell ${st.cell}`) && -1;
    return r;
  };
  for (let k = 0; k < 2000; k++) {
    if (st.won) { L.copyState(st, L.newState(lv)); }   // out: start again and keep trying things
    const w = Math.floor(rng() * (lv.patrols.length ? 14 : 2));
    for (let i = 0; i < w; i++) if (tick(-1, -1) < 0) return;
    const d = Math.floor(rng() * 4);
    if (!L.canPass(lv, st, st.cell, d)) continue;
    let tapTo = -1;
    if (rng() < 0.3) { const run = L.tapRun(lv, st, st.cell, d); if (run.length) { tapTo = run[Math.floor(rng() * run.length)]; ruleCount.taps++; } }
    ruleCount.moves++;
    let r = tick(d, tapTo);
    for (let guard = 0; r === 0 && st.moving >= 0; guard++) {
      if (guard > 500) { fail('a glide never ended'); return; }
      r = tick(-1, -1);
    }
    if (r < 0) return;
  }
}
for (let n = 1; n <= L.LEVELS.length; n++) rules(n);

// The difficulty metric must rise from each level to the next.
for (let i = 1; i < rows.length; i++) {
  if (!(rows[i].a.difficulty > rows[i - 1].a.difficulty)) bad(rows[i].n, `difficulty ${rows[i].a.difficulty} does not rise above level ${rows[i - 1].n}'s ${rows[i - 1].a.difficulty}`);
}

// New things arrive one at a time, each first in a gentle level, and only after the ones before.
const has = (lv) => ({ key: lv.keys.length > 0, patrol: lv.patrols.length > 0, current: lv.currents.length > 0, dark: lv.dark > 0 });
const firstAt = {};
for (const r of rows) {
  const h = has(r.lv), fresh = Object.keys(h).filter((k) => h[k] && !(k in firstAt));
  if (fresh.length > 1) bad(r.n, 'brings in more than one new thing: ' + fresh.join(', '));
  for (const k of fresh) firstAt[k] = r.n;
}
const intro = (k) => rows.find((r) => r.n === firstAt[k]);
const planCells = (r) => { const s = new Set([r.lv.start]); for (const st of r.a.plan || []) for (const c of st.cells) s.add(c); return s; };
const gentle = [];
if (intro('key')) { const r = intro('key'); const ok = r.cfg.keys.length === 1 && r.cfg.keys[0].key === 'path' && planCells(r).has(r.lv.keys[0].cell); gentle.push(`key at ${r.n}: one key, lying on the way to its gate ${ok ? 'ok' : 'NO'}`); if (!ok) bad(r.n, 'first key is not gentle'); }
if (intro('patrol')) { const r = intro('patrol'); const ok = r.lv.patrols.length === 1 && r.cfg.patrols[0].mode === 'side'; gentle.push(`patrol at ${r.n}: one jellyfish in a side tunnel ${ok ? 'ok' : 'NO'}`); if (!ok) bad(r.n, 'first patrol is not gentle'); }
if (intro('current')) { const r = intro('current'); const cells = planCells(r); const ok = r.lv.currents.length === 1 && r.cfg.currents[0].mode === 'help' && r.lv.currents[0].cells.some((c) => cells.has(c)); gentle.push(`current at ${r.n}: one current, carrying her the right way ${ok ? 'ok' : 'NO'}`); if (!ok) bad(r.n, 'first current is not gentle'); }
if (intro('dark')) { const r = intro('dark'); const ok = r.lv.dark >= 3 && Math.max(...rows.filter((q) => q.lv.dark).map((q) => q.lv.dark)) === r.lv.dark; gentle.push(`dark at ${r.n}: the widest light (${r.lv.dark} cells) ${ok ? 'ok' : 'NO'}`); if (!ok) bad(r.n, 'first dark level is not gentle'); }
for (const k of ['key', 'patrol', 'current', 'dark']) if (!(k in firstAt)) { fails++; problems.push(`no level has a ${k}`); }

// The table.
const things = (lv) => [lv.keys.length && `${lv.keys.length} key`, lv.patrols.length && `${lv.patrols.length} ${lv.patrols.map((p) => p.kind).join('+')}`, lv.currents.length && `${lv.currents.length} current`, lv.dark && `dark ${lv.dark}`].filter(Boolean).join(', ') || '-';
console.log('Coral Maze: 20 levels, each searched over its full state (cell, keys, gates, shell, every patrol\'s position and direction)\n');
console.log('lvl size  seed fingerprint   par cells ticks waits choices spare  difficulty  states  stars3<=  fair  in it');
for (const r of rows) {
  const a = r.a;
  console.log(
    String(r.n).padStart(3), `${r.cfg.w}x${r.cfg.h}`.padStart(5), String(r.cfg.seed).padStart(5), ' ' + r.fp + (r.fp === FROZEN[r.n - 1] ? ' ' : '!'),
    String(a.par).padStart(4), String(a.cells || 0).padStart(5), String(a.ticks || 0).padStart(5), String(a.waits || 0).padStart(5),
    String(a.choices || 0).padStart(7), String(a.spare || 0).padStart(5), String(a.difficulty || '-').padStart(11), String(a.states || 0).padStart(7),
    String(a.par ? L.threeStarMax(a.par) : '-').padStart(9), (a.fair ? ' yes' : '  NO').padStart(5), ' ' + things(r.lv),
  );
}
console.log('\n' + gentle.join('\n'));
console.log(`\nindependent breadth-first search agrees on par for ${rows.filter((r) => r.layered === r.a.par).length}/${rows.length} levels; ` +
  `plans replayed through step() escape in par moves for ${rows.filter((r) => r.rp && r.rp.won && r.rp.moves === r.a.par).length}/${rows.length}; ` +
  `${rows.reduce((s, r) => s + (r.a.states || 0), 0)} reachable states checked for traps (${Date.now() - t0} ms)`);
console.log(`rules tried at random: ${ruleCount.moves} glides and taps (${ruleCount.taps} taps), ${ruleCount.ticks} ticks, ${ruleCount.restTicks} of them resting, ${ruleCount.touches} touches by a patrol`);
if (problems.length) console.log('\n' + problems.map((p) => 'FAIL ' + p).join('\n'));
console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL 20 LEVELS PASS: solvable, fair, frozen, difficulty rising');
process.exit(fails ? 1 : 0);
