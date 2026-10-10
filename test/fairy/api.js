// FairyArt's API without a browser: loads web/fairy/fairy.js against a fake window, then calls every
// draw function with a recording fake canvas context. Checks the whole API is there, THEMES and RAINBOW
// are as documented, nothing throws (times 0, 1.3 and 7.9; every pose and kind), save/restore are
// balanced for every call, nothing draws with a random number, and a call twice gives the same drawing.
//   node test/fairy/api.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const FILE = path.resolve(__dirname, '../../web/fairy/fairy.js');
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail != null && detail !== '' ? `  (${typeof detail === 'string' ? detail : JSON.stringify(detail)})` : ''}`);
}

// a ctx that records: every method is a no-op that logs its name and arguments; property sets are accepted
function fakeCtx() {
  const state = { saves: 0, restores: 0, depth: 0, minDepth: 0, log: [], badNumber: null };
  const props = {};
  const note = (name, args) => {
    for (const a of args) if (typeof a === 'number' && !Number.isFinite(a) && !state.badNumber) state.badNumber = name + '(' + args.join(', ') + ')';
    state.log.push(name + ':' + args.map((a) => (typeof a === 'number' ? Math.round(a * 1000) / 1000 : typeof a)).join(','));
  };
  const proxy = new Proxy({}, {
    get(_, key) {
      if (key === 'save') return () => { state.saves++; state.depth++; state.log.push('save'); };
      if (key === 'restore') return () => { state.restores++; state.depth--; if (state.depth < state.minDepth) state.minDepth = state.depth; state.log.push('restore'); };
      if (key in props) return props[key];
      if (typeof key === 'symbol') return undefined;
      return (...args) => {
        note(String(key), args);
        if (/^create.*Gradient$/.test(String(key))) return { addColorStop() { /* fake gradient */ } };
        return proxy;
      };
    },
    set(_, key, v) { props[key] = v; if (typeof v === 'number' && !Number.isFinite(v) && !state.badNumber) state.badNumber = 'set ' + String(key) + '=' + v; state.log.push('set ' + String(key)); return true; },
  });
  props.globalAlpha = 1;
  return { ctx: proxy, state };
}

// load the module with a minimal window
const sandbox = { window: { devicePixelRatio: 3, innerWidth: 915, innerHeight: 412 }, Math: Object.create(Math), console };
let randomCalls = 0;
sandbox.Math.random = () => { randomCalls++; return 0.5; };
sandbox.window.window = sandbox.window;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: FILE });
const F = sandbox.window.FairyArt;

const NAMES = ['drawFairy', 'drawWings', 'drawSparkles', 'drawDust', 'drawSky', 'drawCloud', 'drawRainbow', 'drawRainbowRibbon', 'drawWaterfall',
  'drawTree', 'drawMushroom', 'drawFlower', 'drawGrass', 'drawLilyPad', 'drawCoin', 'drawKey', 'drawChest', 'drawButterfly', 'drawBug',
  'drawCritter', 'drawFirefly', 'drawHand', 'setupCanvas'];
check('FairyArt is on window', !!F && typeof F === 'object');
const missing = NAMES.filter((n) => typeof F[n] !== 'function');
check(`every one of the ${NAMES.length} functions exists`, missing.length === 0, missing);

const RB = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
check('RAINBOW is the 7 exact colours', Array.isArray(F.RAINBOW) && F.RAINBOW.length === 7 && F.RAINBOW.every((c, i) => c === RB[i]), F.RAINBOW);
const P = F.PAL || {};
check('PAL has skin, hair, hairHi, a 7-colour wing, leaf, leafDark, trunk, sky and the coin golds',
  P.skin === '#f7cdb0' && P.hair === '#6b3a1f' && P.hairHi === '#9a5f38' && Array.isArray(P.wing) && P.wing.length === 7 && !!P.leaf && !!P.leafDark && !!P.trunk && !!P.skyTop && !!P.sky && P.gold1 === '#fff6b0' && P.gold2 === '#ffd633' && P.gold3 === '#e8a200', Object.keys(P).join(' '));
check('THEMES has at least 8 scene palettes', Array.isArray(F.THEMES) && F.THEMES.length >= 8, F.THEMES && F.THEMES.length);
const bad = [];
(F.THEMES || []).forEach((t, i) => {
  const okc = (c) => typeof c === 'string' && c.length > 3;
  if (!(typeof t.name === 'string' && t.name && okc(t.top) && okc(t.bot) && okc(t.far) && Array.isArray(t.ground) && t.ground.length === 2 && t.ground.every(okc) && okc(t.sun) &&
    Array.isArray(t.cloud) && t.cloud.length === 2 && t.cloud.every(okc) && Array.isArray(t.flower) && t.flower.length >= 3 && t.flower.every(okc) && typeof t.night === 'boolean')) bad.push(i);
});
check('every theme has name, top, bot, far, ground[2], sun, cloud[2], flower[], night', bad.length === 0, bad);
check('themes 0-3 are daylight Meadow scenes, 4-7 Cloud Tops, and one of those is a night', F.THEMES.slice(0, 4).every((t) => !t.night) && F.THEMES.slice(4, 8).some((t) => t.night));

// every call
const POSES = ['fly', 'hover', 'stand', 'sit', 'slide', 'fall'];
const TIMES = [0, 1.3, 7.9];
const pts = Array.from({ length: 12 }, (_, i) => ({ x: 100 + i * 20, y: 200 + Math.sin(i) * 30, age: i * 0.1 }));
const calls = [];
for (const t of TIMES) {
  for (const pose of POSES) for (const happy of [false, true]) for (const flip of [false, true])
    calls.push([`drawFairy ${pose} happy=${happy} flip=${flip} t=${t}`, (c) => F.drawFairy(c, 300, 270, t, { pose, happy, flip, scale: 1.4, tilt: 0.2, alpha: 0.8, dust: 1, glow: 1, wand: true })]);
  calls.push([`drawFairy defaults t=${t}`, (c) => F.drawFairy(c, 300, 270, t)]);
  calls.push([`drawFairy no options t=${t}`, (c) => F.drawFairy(c, 300, 270, t, {})]);
  calls.push([`drawFairy wand off t=${t}`, (c) => F.drawFairy(c, 300, 270, t, { wand: false, dust: 0.3 })]);
  calls.push([`drawWings t=${t}`, (c) => F.drawWings(c, t, { freq: 20, amp: 0.5, spread: 1, alpha: 0.9, scale: 1.2 })]);
  calls.push([`drawWings defaults t=${t}`, (c) => F.drawWings(c, t)]);
  calls.push([`drawSparkles t=${t}`, (c) => F.drawSparkles(c, 50, 60, t, 12, 40, 0.8)]);
  calls.push([`drawDust t=${t}`, (c) => F.drawDust(c, pts, t)]);
  calls.push([`drawDust empty t=${t}`, (c) => F.drawDust(c, [], t)]);
  F.THEMES.forEach((th, i) => calls.push([`drawSky theme ${i} t=${t}`, (c) => F.drawSky(c, 960, 540, i, t)]));
  calls.push([`drawSky by object t=${t}`, (c) => F.drawSky(c, 960, 540, F.THEMES[2], t)]);
  for (const grumpy of [false, true]) calls.push([`drawCloud grumpy=${grumpy} t=${t}`, (c) => F.drawCloud(c, 100, 100, 120, { shade: '#cde', alpha: 0.9, grumpy })]);
  calls.push([`drawCloud no options t=${t}`, (c) => F.drawCloud(c, 100, 100, 120)]);
  calls.push([`drawRainbow t=${t}`, (c) => F.drawRainbow(c, 400, 400, 200, 20, { from: Math.PI, to: Math.PI * 2, alpha: 0.8 })]);
  calls.push([`drawRainbow default arc t=${t}`, (c) => F.drawRainbow(c, 400, 400, 200, 20)]);
  calls.push([`drawRainbow too thin t=${t}`, (c) => F.drawRainbow(c, 400, 400, 30, 20, {})]);
  calls.push([`drawRainbowRibbon t=${t}`, (c) => F.drawRainbowRibbon(c, pts, 40, 0.9)]);
  calls.push([`drawRainbowRibbon short t=${t}`, (c) => F.drawRainbowRibbon(c, pts.slice(0, 1), 40)]);
  calls.push([`drawWaterfall t=${t}`, (c) => F.drawWaterfall(c, 400, 50, 60, 300, t)]);
  for (let k = 0; k < 4; k++) calls.push([`drawTree kind ${k} t=${t}`, (c) => F.drawTree(c, 300, 450, 1.1, k, t)]);
  calls.push([`drawMushroom t=${t}`, (c) => F.drawMushroom(c, 100, 400, 1, '#ff4d6d')]);
  calls.push([`drawMushroom default colour t=${t}`, (c) => F.drawMushroom(c, 100, 400, 1)]);
  for (let k = 0; k < 6; k++) for (const bloom of [0, 0.5, 1]) calls.push([`drawFlower kind ${k} bloom ${bloom} t=${t}`, (c) => F.drawFlower(c, 120, 450, 1.2, k, bloom, t)]);
  calls.push([`drawGrass t=${t}`, (c) => F.drawGrass(c, 0, 500, 300, t, '#4fbf6a')]);
  calls.push([`drawGrass default colour t=${t}`, (c) => F.drawGrass(c, 0, 500, 300, t)]);
  calls.push([`drawLilyPad t=${t}`, (c) => F.drawLilyPad(c, 200, 480, 34, { time: t, flower: true })]);
  calls.push([`drawLilyPad no options t=${t}`, (c) => F.drawLilyPad(c, 200, 480, 34)]);
  calls.push([`drawCoin t=${t}`, (c) => F.drawCoin(c, 50, 50, t * 4, 14)]);
  calls.push([`drawCoin default r t=${t}`, (c) => F.drawCoin(c, 50, 50, t)]);
  calls.push([`drawKey t=${t}`, (c) => F.drawKey(c, 50, 50, 1.2, t)]);
  for (const open of [0, 0.5, 1]) calls.push([`drawChest open ${open} t=${t}`, (c) => F.drawChest(c, 400, 450, open, t)]);
  calls.push([`drawButterfly t=${t}`, (c) => F.drawButterfly(c, 200, 200, t, '#ff8fc0', 1.3)]);
  calls.push([`drawButterfly defaults t=${t}`, (c) => F.drawButterfly(c, 200, 200, t)]);
  for (let k = 0; k < 3; k++) {
    calls.push([`drawBug kind ${k} t=${t}`, (c) => F.drawBug(c, 300, 200, t, k, 1.2)]);
    calls.push([`drawBug kind ${k} flipped t=${t}`, (c) => F.drawBug(c, 300, 200, t, k, -1.2)]);
    calls.push([`drawCritter kind ${k} t=${t}`, (c) => F.drawCritter(c, 300, 450, t, k, 1.2)]);
    calls.push([`drawCritter kind ${k} flipped t=${t}`, (c) => F.drawCritter(c, 300, 450, t, k, -1.2)]);
  }
  calls.push([`drawFirefly t=${t}`, (c) => F.drawFirefly(c, 300, 200, t, 1)]);
  calls.push([`drawFirefly dim t=${t}`, (c) => F.drawFirefly(c, 300, 200, t, 0.2)]);
  calls.push([`drawHand t=${t}`, (c) => F.drawHand(c, 300, 200, t, 1)]);
  calls.push([`drawHand faded t=${t}`, (c) => F.drawHand(c, 300, 200, t, 0)]);
}

const failures = [];
let balanced = 0, drawn = 0, quiet = 0, nonFinite = [], leaked = [], logs = new Map();
randomCalls = 0;
for (const [name, fn] of calls) {
  const { ctx, state } = fakeCtx();
  try { fn(ctx); } catch (e) { failures.push(name + ': ' + (e && e.message)); continue; }
  if (state.saves === state.restores && state.minDepth >= 0 && state.depth === 0) balanced++; else leaked.push(`${name} (save ${state.saves}, restore ${state.restores})`);
  if (state.log.length > 3) drawn++;
  else if (/empty|short|faded/.test(name)) quiet++; // nothing to draw: no dust, a one-point ribbon, a fully faded hand
  if (state.badNumber) nonFinite.push(name + ' -> ' + state.badNumber);
  logs.set(name, state.log.join('|'));
}
check(`${calls.length} calls (every pose, kind, bloom, theme and time 0 / 1.3 / 7.9) throw nothing`, failures.length === 0, failures.slice(0, 4));
check('every call draws something (but the empty, one-point and faded ones, which draw nothing)', drawn + quiet === calls.length && quiet === 9, `${drawn} drew, ${quiet} left blank on purpose, of ${calls.length}`);
check('save/restore balanced in every call, never over-restored', leaked.length === 0 && balanced === calls.length, leaked.slice(0, 4).length ? leaked.slice(0, 4) : `${balanced}/${calls.length}`);
check('no NaN or Infinity reaches the canvas', nonFinite.length === 0, nonFinite.slice(0, 4));
check('no draw call uses Math.random', randomCalls === 0, randomCalls);
// deterministic: the same call gives the same drawing
let diff = [];
for (const [name, fn] of calls.slice(0, 400)) { const { ctx, state } = fakeCtx(); fn(ctx); if (state.log.join('|') !== logs.get(name)) diff.push(name); }
check('the same call draws the same picture twice', diff.length === 0, diff.slice(0, 3));
// time really moves things (wings beat, grass sways)
const a = fakeCtx(), b = fakeCtx(); F.drawFairy(a.ctx, 0, 0, 0.1, { pose: 'fly' }); F.drawFairy(b.ctx, 0, 0, 0.2, { pose: 'fly' });
check('time animates the fairy (wings beat)', a.state.log.join('|') !== b.state.log.join('|'));
const g1 = fakeCtx(), g2 = fakeCtx(); F.drawFlower(g1.ctx, 0, 0, 1, 0, 0, 1); F.drawFlower(g2.ctx, 0, 0, 1, 0, 1, 1);
check('bloom changes the flower', g1.state.log.join('|') !== g2.state.log.join('|'));

// setupCanvas: a fake canvas, the house DPR-capped fit
{
  const { ctx } = fakeCtx(); let tf = null;
  const c2 = new Proxy(ctx, { get(t, k) { if (k === 'setTransform') return (...a) => { tf = a; }; return t[k]; }, set(t, k, v) { t[k] = v; return true; } });
  const canvas = { width: 0, height: 0, getContext: () => c2 };
  const r = F.setupCanvas(canvas);
  check('setupCanvas returns { ctx, resize }', !!r && !!r.ctx && typeof r.resize === 'function');
  const m = r.resize();
  const sc = canvas.height / 540;
  check('resize: 540 units tall, DPR capped at 2.5, width follows the screen', m.VH === 540 && m.dpr === 2.5 && m.cssW === 915 && m.cssH === 412 && canvas.height === Math.round(412 * 2.5) && Math.abs(m.VW - canvas.width / sc) < 1e-6 && tf && Math.abs(tf[0] - sc) < 1e-9, m);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
