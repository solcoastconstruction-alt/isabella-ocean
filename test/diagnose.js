// Where does a level become impossible, and what is there?  usage: node test/diagnose.js 13 210 [inflate]
const C = require('../web/core.js');
const [n, sx, inflate] = process.argv.slice(2).map(Number);
const lev = C.buildLevel(n), speed = lev.cfg.speed, DT = 1 / 60, CELL = 4;
const ys = []; for (let y = C.TOP; y <= C.FLOOR; y += CELL) ys.push(y);
const maxMove = Math.max(1, Math.floor((C.SWIM * 0.6 * DT) / CELL));
let reach = ys.map((y) => !C.hitTest(lev, 0, sx, y, inflate || 0));
const hist = [];
for (let s = 1; s < 1e6; s++) {
  const t = s * DT, px = speed * t + sx, next = ys.map(() => false);
  let open = 0;
  for (let i = 0; i < ys.length; i++) {
    let ok = false;
    for (let j = Math.max(0, i - maxMove); j <= Math.min(ys.length - 1, i + maxMove); j++) if (reach[j]) ok = true;
    if (ok && !C.hitTest(lev, t, px, ys[i], inflate || 0)) { next[i] = true; open++; }
  }
  hist.push({ t, px, open });
  if (!open) {
    console.log(`level ${n} sx=${sx}: no way through at world x=${px.toFixed(0)} t=${t.toFixed(2)}`);
    // band history in the last 1.5 s
    const tail = hist.slice(-90).filter((_, k) => k % 10 === 0).map((h) => `${h.px.toFixed(0)}:${h.open * CELL}`);
    console.log('reachable band (x:units) leading up to it:', tail.join(' '));
    for (const o of lev.obs) {
      const x0 = o.k === 'fish' ? C.fishX(o, t) - 40 : o.x0, x1 = o.k === 'fish' ? C.fishX(o, t) + 50 : o.x1;
      if (x1 > px - 500 && x0 < px + 150) console.log('  ', o.k, JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'k').map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(2) : v]))));
    }
    process.exit(0);
  }
  reach = next;
  if (px > lev.len + 400) { console.log(`level ${n} sx=${sx}: passable; min band ${Math.min(...hist.map((h) => h.open)) * CELL}`); process.exit(0); }
}
