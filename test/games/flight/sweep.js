// The proof that a course can be played perfectly: a sweep over (time, height).
// Isabella stays at her usual column (the finger may move her a little sideways, but this never needs it) and moves up and
// down at no more than `speed` of her top vertical speed. At every step the sweep knows which heights are free of every
// enemy (with a margin), and which buds and the key she has reached. A state is (height, which of the buds and the key that
// are in reach right now she has already reached); a bud that leaves reach unreached kills the state. If any state survives to
// the chest, a path exists that brings every plant to life and the key into her hand without touching an enemy.
//   const { sweep } = require('./sweep');  sweep(L, course, { speed: 0.6, path: true }) -> { ok, slots, ys, narrowest }
'use strict';

const DT = 0.05;

function sweep(L, c, o) {
  o = o || {};
  const speed = o.speed == null ? 0.6 : o.speed, margin = o.margin == null ? 10 : o.margin, slack = o.slack == null ? 6 : o.slack;
  const YS = 4.2, NY = Math.floor((L.Y_MAX - L.Y_MIN) / YS) + 1;
  const reach = Math.floor((speed * L.VY_MAX * DT) / YS + 1e-9);   // cells she can move in one step
  const steps = Math.ceil(c.tStop / DT) + 1;
  const yOf = (j) => L.Y_MIN + j * YS;

  // targets: the plants (a bud blooms within the dust radius of its head) and the key
  const targets = c.plants.map((p) => ({ kind: 'plant', pos: (t) => { const q = L.plantAt(c, p, t); return { x: q.x, y: q.y }; }, r: c.dust - slack }));
  targets.push({ kind: 'key', pos: (t) => L.keyAt(c, t), r: L.KEY_R - slack });
  // when each target is in reach sideways (|dx| <= r), and the slot (bit) it uses while it is
  const tin = [], tout = [];
  for (const g of targets) {
    let a = -1, b = -1;
    for (let k = 0; k < steps; k++) {
      const p = g.pos(k * DT), dx = p.x - L.PX_NOM;
      if (Math.abs(dx) <= g.r) { if (a < 0) a = k; b = k; }
    }
    tin.push(a); tout.push(b);
  }
  const slotOf = new Array(targets.length).fill(-1), busy = [];
  const order = targets.map((_, i) => i).filter((i) => tin[i] >= 0).sort((p, q) => tin[p] - tin[q]);
  for (const i of order) {
    let s = 0;
    while (busy[s] != null && busy[s] >= tin[i]) s++;
    slotOf[i] = s; busy[s] = tout[i];
  }
  const slots = busy.length;
  if (slots > 8) return { ok: false, slots, reason: 'too many buds in reach at once' };
  const never = targets.map((_, i) => i).filter((i) => tin[i] < 0);
  if (never.length) return { ok: false, slots, reason: 'a target never comes within reach: ' + never.join(',') };

  // per step: which slots are satisfied at each height, which slots end here
  const startsAt = new Map(), endsAt = new Map();
  targets.forEach((_, i) => { (startsAt.get(tin[i]) || startsAt.set(tin[i], []).get(tin[i])).push(i); (endsAt.get(tout[i]) || endsAt.set(tout[i], []).get(tout[i])).push(i); });
  const M = 1 << slots;
  let cur = new Uint8Array(M * NY), nxt = new Uint8Array(M * NY);
  const dil = new Uint8Array(NY), sat = new Int32Array(NY), free = new Uint8Array(NY);
  let active = [];
  const par = o.path ? [] : null;           // parent pointers for the path
  cur[0 * NY + Math.round((L.Y_REST - L.Y_MIN) / YS)] = 1;
  let narrowest = NY;
  const rrE = (e) => e.r + L.R_I + margin;
  for (let k = 1; k < steps; k++) {
    const t = k * DT;
    // heights free of every enemy now
    free.fill(1);
    for (const e of c.enemies) {
      const q = L.enemyAt(c, e, t), dx = q.x - L.PX_NOM, rr = rrE(e);
      if (dx > rr || dx < -rr) continue;
      const half = Math.sqrt(rr * rr - dx * dx);
      const j0 = Math.max(0, Math.ceil((q.y - half - L.Y_MIN) / YS)), j1 = Math.min(NY - 1, Math.floor((q.y + half - L.Y_MIN) / YS));
      for (let j = j0; j <= j1; j++) free[j] = 0;
    }
    let f = 0; for (let j = 0; j < NY; j++) f += free[j];
    if (f < narrowest) narrowest = f;
    // which targets are in reach now, and which slots a height satisfies
    for (const i of startsAt.get(k) || []) active.push(i);
    sat.fill(0);
    for (const i of active) {
      const p = targets[i].pos(t), dx = p.x - L.PX_NOM, r = targets[i].r;
      if (Math.abs(dx) > r) continue;
      const half = Math.sqrt(r * r - dx * dx);
      const j0 = Math.max(0, Math.ceil((p.y - half - L.Y_MIN) / YS)), j1 = Math.min(NY - 1, Math.floor((p.y + half - L.Y_MIN) / YS));
      for (let j = j0; j <= j1; j++) sat[j] |= 1 << slotOf[i];
    }
    let exit = 0; for (const i of endsAt.get(k) || []) exit |= 1 << slotOf[i];
    nxt.fill(0);
    const pk = o.path ? new Int32Array(M * NY).fill(-1) : null;
    let any = false;
    for (let m = 0; m < M; m++) {
      const base = m * NY;
      // dilate the reachable heights by `reach` cells
      let last = -1e9, has = false;
      for (let j = 0; j < NY; j++) { if (cur[base + j]) { last = j; has = true; } dil[j] = j - last <= reach ? 1 : 0; }
      if (!has) continue;
      last = 1e9;
      for (let j = NY - 1; j >= 0; j--) { if (cur[base + j]) last = j; if (last - j <= reach) dil[j] = 1; }
      for (let j = 0; j < NY; j++) {
        if (!dil[j] || !free[j]) continue;
        let nm = m | sat[j];
        if ((nm & exit) !== exit) continue;             // a bud leaving reach unreached
        nm &= ~exit;
        const at = nm * NY + j;
        if (!nxt[at]) {
          nxt[at] = 1; any = true;
          if (pk) { for (let d = 0; d <= reach; d++) { if (j - d >= 0 && cur[base + j - d]) { pk[at] = base + j - d; break; } if (j + d < NY && cur[base + j + d]) { pk[at] = base + j + d; break; } } }
        }
      }
    }
    active = active.filter((i) => tout[i] > k);
    if (!any) return { ok: false, slots, failedAt: t, narrowest: narrowest * YS };
    if (par) par.push(pk);
    const tmp = cur; cur = nxt; nxt = tmp;
  }
  // at the last step the only state that counts is the one with every slot cleared
  let endJ = -1;
  for (let j = 0; j < NY; j++) if (cur[0 * NY + j]) { endJ = j; break; }
  const ok = endJ >= 0;
  const res = { ok, slots, narrowest: narrowest * YS, steps };
  if (ok && o.path) {
    // walk back through the parent pointers: ys[k] is the height at step k
    const ys = new Array(steps).fill(L.Y_REST);
    let at = 0 * NY + endJ;
    for (let k = steps - 1; k >= 1; k--) {
      ys[k] = yOf(at % NY);
      const p = par[k - 1][at];
      at = p;
    }
    ys[0] = L.Y_REST;
    res.ys = ys; res.dt = DT;
  }
  return res;
}

module.exports = { sweep, DT };
