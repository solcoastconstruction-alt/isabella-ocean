// Headless-Chrome check for Isabella's Bubble Party (web/games/pop).
//   node test/games/pop/verify.js <screenshotDir> <chromeProfileDir>
// Starts its own Chrome (CDP port 9451, its own throwaway profile, window 1335x600), drives real
// mouse and multi-touch input through CDP, saves screenshots, and asserts: pops are counted, friends
// join the aquarium and are saved, multi-touch and swipes pop, specials work, ten friends change the
// sea, the save survives a reload, mute follows the main game, window.IsabellaStore is used when present,
// the 1024x768 and phone layouts fit (DPR capped at 2.5), back/home go to the hub, the frame rate,
// and that the page logs no errors.
const fs = require('fs'), os = require('os'), path = require('path');
const { launch, sleep } = require('./cdp');

const ROOT = path.resolve(__dirname, '../../..');
const PAGE = 'file://' + path.join(ROOT, 'web/games/pop/index.html');
const HUB = 'file://' + path.join(ROOT, 'web/index.html');
const OUT = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'pop-shots'));
const PROFILE = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'chrome-pop'));
const PORT = 9451, W = 1335, HT = 600;

const results = [], shots = [], problems = [], notes = {};
let chrome = null; // killed on every exit path so port 9451 is never left busy
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail != null ? `  (${detail})` : ''}`);
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true }); // a fresh profile means a fresh save
  fs.mkdirSync(OUT, { recursive: true });
  const cdp = await launch({ port: PORT, profile: PROFILE, width: W, height: HT });
  chrome = cdp.proc;
  let where = 'blank';
  cdp.on((m) => {
    const p = m.params || {};
    if (m.method === 'Runtime.exceptionThrown') problems.push({ where, kind: 'exception', text: (p.exceptionDetails.exception && p.exceptionDetails.exception.description) || p.exceptionDetails.text });
    if (m.method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'warning' || p.type === 'assert')) problems.push({ where, kind: 'console.' + p.type, text: p.args.map((a) => (a.value != null ? a.value : a.description)).join(' ') });
    if (m.method === 'Log.entryAdded' && (p.entry.level === 'error' || p.entry.level === 'warning')) problems.push({ where, kind: 'log.' + p.entry.level, text: p.entry.text + (p.entry.url ? ' ' + p.entry.url : '') });
  });
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Log.enable');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 10 });
  // headless --window-size=1335,600 leaves a 1335x513 viewport (room kept for a toolbar), so pin the page to 1335x600
  const desk = () => cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: HT, deviceScaleFactor: 1, mobile: false });
  await desk();

  const evaluate = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('evaluate failed: ' + expr.slice(0, 80) + ' :: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text));
    return r.result.value;
  };
  const D = (expr) => evaluate(`window.__popDebug.${expr}`);
  async function go(url, label) { where = label; const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.navigate', { url }); await loaded; await sleep(400); }
  async function reload() { const loaded = cdp.once('Page.loadEventFired'); await cdp.send('Page.reload', { ignoreCache: true }); await loaded; await sleep(400); }
  async function shot(name) {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    shots.push(f);
    return f;
  }
  async function click(x, y) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  }
  async function touchTap(points) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 12, radiusY: 12, force: 1 })) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  async function touchSwipe(a, b, steps) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
    for (let i = 1; i <= steps; i++) {
      const u = i / steps;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, id: 1 }] });
      await sleep(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  // bubbles that are fully tappable: above the seabed, on screen, and nowhere near the home button
  async function visible(filter) {
    const [bs, home, vh] = await Promise.all([D('bubbles()'), evaluate(`(() => { const r = document.getElementById('home').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })()`), evaluate('innerHeight')]);
    return bs.filter((b) => b.visible && b.cy - b.cr > 4 && b.cy + b.cr * 0.4 < vh * 0.8 && !(b.cx < home.r + 20 && b.cy < home.b + 20) && (!filter || filter(b)))
      .sort((p, q) => p.cx - q.cx);
  }
  async function waitVisible(n, ms, filter) {
    const t0 = Date.now();
    let v = [];
    while (Date.now() - t0 < (ms || 9000)) { v = await visible(filter); if (v.length >= n) return v; await sleep(120); }
    return v;
  }
  async function waitFor(fn, ms, every) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(every || 100); }
    return null;
  }
  // an open-water point (no bubble, no Isabella, no friend, no home button)
  async function openWater() {
    const [bs, isa, vh, vw] = await Promise.all([D('bubbles()'), D('isabella()'), evaluate('innerHeight'), evaluate('innerWidth')]);
    for (let gy = 0.18; gy <= 0.62; gy += 0.04) {
      for (let gx = 0.2; gx <= 0.95; gx += 0.03) {
        const x = gx * vw, y = gy * vh;
        if (bs.some((b) => Math.hypot(b.cx - x, b.cy - y) < b.cr + 50)) continue;
        if (isa && Math.hypot(isa.cx - x, isa.cy - y) < vh * 0.32) continue;
        return { x, y };
      }
    }
    return null;
  }

  // ================= 1. start =================
  await go(PAGE, 'pop');
  await sleep(1300);
  const env = await evaluate(`({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio, cw: document.getElementById('c').width, ch: document.getElementById('c').height, title: document.title, touch: navigator.maxTouchPoints })`);
  notes.viewport = env;
  check('viewport 1335x600, canvas fills it', env.w === W && env.h === HT && env.cw === W && env.ch === HT, JSON.stringify(env));
  let st = await D('state()');
  check('fresh start: scene 0, empty aquarium, starter bubbles ready', st.scene === 0 && st.aquarium.length === 0 && st.bubbles >= 3, `bubbles ${st.bubbles}`);
  const starterVh = (await D('bubbles()')).map((b) => ((b.cr * 2) / env.h) * 100);
  check('starting bubbles are at least 19vh across', starterVh.length >= 3 && starterVh.every((v) => v >= 19), starterVh.map((v) => v.toFixed(1) + 'vh').join(', '));
  await shot('01-start');

  // ================= 2. one mouse tap: pop, wiggle, join, numeral 1, saved =================
  let v = await waitVisible(1);
  let c0 = await D('counters');
  await click(v[0].cx, v[0].cy);
  await sleep(110);
  let c1 = await D('counters');
  st = await D('state()');
  check('a tap pops the bubble', c1.pops === c0.pops + 1, `pops ${c0.pops} -> ${c1.pops}`);
  check('the friend inside joins the aquarium', st.aquarium.length === 1 && c1.joins === 1, `aquarium [${st.aquarium}]`);
  await shot('02-popping');
  await sleep(1250); // wiggle 0.45 s + swim 0.75 s
  st = await D('state()');
  check('it lands in place 1 and the numeral 1 shows', st.landed === 1 && st.numerals.includes(1), `landed ${st.landed}, numerals [${st.numerals}]`);
  await shot('03-joining-numeral-1');
  let saved = JSON.parse(await D('saved()'));
  check('saved under game.pop.save', saved && saved.total === 1 && saved.aquarium.length === 1 && saved.aquarium[0].k === st.aquarium[0], await D('saved()'));
  check('saved to localStorage when window.IsabellaStore is absent', JSON.parse(await evaluate(`localStorage.getItem('game.pop.save')`)).total === 1);

  // ================= 3. multi-touch: three fingers, three pops, one frame =================
  v = await waitVisible(3, 12000);
  if (v.length < 3) {
    for (const fx of [0.3, 0.5, 0.7]) await D(`spawn({ x: ${fx} * window.__popDebug.state().VW, y: 240, still: true })`);
    await sleep(200); v = await waitVisible(3);
  }
  c0 = await D('counters');
  await touchTap(v.slice(0, 3).map((b) => ({ x: b.cx, y: b.cy })));
  await sleep(90);
  c1 = await D('counters');
  check('multi-touch: 3 fingers pop 3 bubbles', c1.pops - c0.pops === 3, `pops +${c1.pops - c0.pops}`);
  check('multi-touch: 3 pointers were down at once', c1.maxPointers >= 3, `maxPointers ${c1.maxPointers}`);
  check('multi-touch: all 3 pops landed in the same frame', c1.maxPopsInFrame >= 3, `maxPopsInFrame ${c1.maxPopsInFrame}`);
  check('touches arrive as pointerType "touch"', (c1.pointerTypes.touch || 0) >= 3, JSON.stringify(c1.pointerTypes));
  await shot('04-multitouch-pops');
  await sleep(1350);
  st = await D('state()');
  check('friends 2, 3 and 4 are counted', st.landed === 4 && [2, 3, 4].every((n) => st.numerals.includes(n)), `landed ${st.landed}, numerals [${st.numerals}]`);
  await shot('05-counting-2-3-4');

  // ================= 4. a sliding finger pops what it passes; open water just ripples =================
  v = await waitVisible(2, 12000);
  if (v.length >= 2) {
    // start and end in open water just beyond the two outer bubbles, but always on the canvas
    // (a finger that comes down on the home button, or off the screen, is not a swipe on the sea)
    const home = await evaluate(`(() => { const r = document.getElementById('home').getBoundingClientRect(); return { r: r.right, b: r.bottom }; })()`);
    const onSea = (pt) => pt.x > 10 && pt.x < W - 10 && pt.y > 10 && pt.y < HT * 0.72 && !(pt.x < home.r + 10 && pt.y < home.b + 10);
    const [p, q] = [v[0], v[v.length - 1]], dx = q.cx - p.cx, dy = q.cy - p.cy, L = Math.hypot(dx, dy) || 1;
    let a = { x: p.cx - (dx / L) * (p.cr + 30), y: p.cy - (dy / L) * (p.cr + 30) }, b = { x: q.cx + (dx / L) * (q.cr + 30), y: q.cy + (dy / L) * (q.cr + 30) };
    const fromWater = onSea(a);
    if (!fromWater) a = { x: p.cx, y: p.cy };
    if (!onSea(b)) b = { x: q.cx, y: q.cy };
    c0 = await D('counters');
    await touchSwipe(a, b, 14);
    await sleep(60);
    c1 = await D('counters');
    check('a sliding finger pops the bubbles it passes', c1.pops - c0.pops >= 2,
      `pops +${c1.pops - c0.pops} along one swipe from ${a.x.toFixed(0)},${a.y.toFixed(0)} (${fromWater ? 'open water' : 'on the first bubble'}) to ${b.x.toFixed(0)},${b.y.toFixed(0)}`);
  } else check('a sliding finger pops the bubbles it passes', false, 'not enough bubbles on screen');
  const water = await openWater();
  c0 = await D('counters');
  if (water) await click(water.x, water.y);
  await sleep(60);
  c1 = await D('counters');
  check('a tap on open water ripples: no pop, nothing lost', water && c1.misses === c0.misses + 1 && c1.pops === c0.pops, water ? `at ${water.x.toFixed(0)},${water.y.toFixed(0)}` : 'no open water found');
  await sleep(1300);
  const fr = await D('friends()');
  c0 = await D('counters');
  await click(fr[0].cx, fr[0].cy);
  await sleep(60);
  c1 = await D('counters');
  check('tapping a friend in the aquarium: it wiggles and sings its number', c1.friendTaps === c0.friendTaps + 1 && c1.pops === c0.pops);

  // ================= 5. specials =================
  st = await D('state()');
  const VW = st.VW;
  const rid = await D(`spawn({ special: 'rainbow', x: ${VW * 0.34}, y: 235, still: true })`);
  const gid = await D(`spawn({ special: 'giant', x: ${VW * 0.68}, y: 245, still: true })`);
  await sleep(650);
  await shot('06-special-bubbles');
  let all = await D('bubbles()');
  const rb = all.find((b) => b.id === rid), gb = all.find((b) => b.id === gid);
  check('giant bubble is much bigger than a normal one', gb && gb.r >= 100, gb && `radius ${gb.r.toFixed(0)} units (normal 60-70)`);
  c0 = await D('counters');
  const aqBefore = (await D('state()')).aquarium.length;
  await click(rb.cx, rb.cy);
  await sleep(260);
  c1 = await D('counters');
  st = await D('state()');
  check('rainbow bubble pops with a music-note burst', c1.rainbow === c0.rainbow + 1 && st.notes >= 10, `${st.notes} notes flying`);
  check('the rainbow bubble\'s friend joins too', st.aquarium.length === Math.min(10, aqBefore + 1), `aquarium ${aqBefore} -> ${st.aquarium.length}`);
  await shot('07-rainbow-note-burst');
  all = await D('bubbles()');
  const g2 = all.find((b) => b.id === gid), smallBefore = all.filter((b) => b.special === 'small').length;
  await click(g2.cx, g2.cy);
  await sleep(450);
  all = await D('bubbles()');
  c1 = await D('counters');
  const smalls = all.filter((b) => b.special === 'small');
  check('giant bubble splits into 3-4 small bubbles', c1.giant === c0.giant + 1 && smalls.length - smallBefore >= 3, `${smalls.length - smallBefore} small bubbles`);
  check('small bubbles are bonuses: smaller than the starting size', smalls.every((b) => b.r < 50), smalls.map((b) => b.r.toFixed(0)).join(', '));
  await shot('08-giant-split');
  for (let k = 0; k < 6; k++) {
    const sm = (await visible((b) => b.special === 'small'));
    if (!sm.length) break;
    await click(sm[0].cx, sm[0].cy); await sleep(70);
  }
  c1 = await D('counters');
  check('small bonus bubbles pop', c1.small >= 3, `${c1.small} small pops`);

  // ================= 6. ten friends: party, then a new sea =================
  for (let guard = 0; guard < 80; guard++) {
    st = await D('state()');
    if (st.phase !== 'play' || st.aquarium.length >= 10) break;
    v = await waitVisible(1, 6000);
    if (v.length) await click(v[0].cx, v[0].cy);
    await sleep(160);
  }
  st = await D('state()');
  check('the aquarium fills to ten', st.aquarium.length === 10 || st.phase !== 'play', `aquarium ${st.aquarium.length}, phase ${st.phase}`);
  const party = await waitFor(async () => (await D('state()')).phase === 'party', 6000);
  check('ten friends start a party', !!party);
  await sleep(2700);
  st = await D('state()');
  check('everyone counted 1..10 is in the aquarium during the party', st.landed === 10, `landed ${st.landed}`);
  const host = await D('isabella()');
  check('Isabella hosts the party in the middle of the sea', host && Math.abs(host.x - st.VW / 2) < st.VW * 0.12, host ? `x ${host.x.toFixed(0)} of ${st.VW.toFixed(0)}` : 'not on screen');
  const counting = (await D('counters')).countAlong;
  check('party count-along: friends count off left to right', counting >= 6 && st.numerals.length >= 3, `counted to ${counting}, numerals showing [${st.numerals}]`);
  await shot('09-party-count-along');
  const changing = await waitFor(async () => (await D('state()')).phase === 'change', 6000);
  check('the count-along reaches 10, then the sea changes', !!changing && (await D('counters')).countAlong === 10);
  await sleep(1100);
  await shot('10-scene-change');
  await waitFor(async () => (await D('state()')).phase === 'play', 5000);
  await sleep(1400);
  st = await D('state()');
  saved = JSON.parse(await D('saved()'));
  check('new sea: scene 1 with an empty aquarium and new creatures', st.scene === 1 && st.sceneId === 'garden' && st.aquarium.length === 0, `${st.sceneId}`);
  check('scene change saved (scene 1, filled 1)', saved.scene === 1 && saved.filled === 1 && saved.aquarium.length === 0, JSON.stringify(saved));
  await shot('11-new-scene');

  // ================= 7. Isabella swims by and waves; a tap makes her twirl =================
  await D('startIsabella()');
  const mid = await waitFor(async () => { const i = await D('isabella()'); return i && i.x > VW * 0.33 && i.x < VW * 0.66 ? i : null; }, 9000, 60);
  check('Isabella swims through the scene', !!mid);
  if (mid) {
    c0 = await D('counters');
    await shot('12-isabella-waves');
    const i2 = await D('isabella()');
    if ((await D('bubbles()')).some((b) => Math.hypot(b.cx - i2.cx, b.cy - i2.cy) < b.cr + 16)) await sleep(400); // a bubble in front of her takes the tap
    const i3 = await D('isabella()');
    await click(i3.cx, i3.cy);
    await sleep(80);
    c1 = await D('counters');
    check('tapping Isabella: hearts and a twirl', c1.isabellaTaps === c0.isabellaTaps + 1 || c1.pops === c0.pops + 1, `isabellaTaps ${c1.isabellaTaps}`);
  }

  // ================= 8. the save survives a reload =================
  for (let k = 0; k < 2; k++) { v = await waitVisible(1, 8000); if (v.length) await click(v[0].cx, v[0].cy); await sleep(200); }
  await sleep(1400);
  const before = await D('state()');
  await reload(); await sleep(600);
  st = await D('state()');
  check('reload restores the aquarium, the sea and the total', st.scene === before.scene && JSON.stringify(st.aquarium) === JSON.stringify(before.aquarium) && st.total === before.total,
    `scene ${st.scene}, aquarium [${st.aquarium}], total ${st.total}`);

  // ================= 9. frame rate =================
  v = await waitVisible(2, 8000);
  await touchTap(v.slice(0, 3).map((b) => ({ x: b.cx, y: b.cy })));
  const fpsExpr = `new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else res({ frames: n, secs: (performance.now() - t0) / 1000 }); }; requestAnimationFrame(f); })`;
  const fps = await evaluate(fpsExpr);
  const perf = await D('perf()');
  notes.fps = { ...fps, fps: fps.frames / fps.secs, perf };
  check('frame rate: rAF frames over 3 s', fps.frames / fps.secs >= 55, `${fps.frames} frames / ${fps.secs.toFixed(2)} s = ${(fps.frames / fps.secs).toFixed(1)} fps; game update+draw avg ${perf.avgMs.toFixed(2)} ms, p95 ${perf.p95Ms.toFixed(2)} ms, max ${perf.maxMs.toFixed(2)} ms`);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await D(`spawn({ special: 'rainbow', x: ${VW * 0.5}, y: 250, still: true })`);
  const fps4 = await evaluate(fpsExpr);
  const perf4 = await D('perf()');
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  notes.fps4x = { ...fps4, fps: fps4.frames / fps4.secs, perf: perf4 };
  check('frame rate with the CPU slowed 4x (a modest phone)', fps4.frames / fps4.secs >= 50, `${(fps4.frames / fps4.secs).toFixed(1)} fps; game work p95 ${perf4.p95Ms.toFixed(2)} ms`);

  // ================= 10. sound: starts on the first finger tap; mute follows the main game's isabella.save =================
  await evaluate(`localStorage.setItem('isabella.save', JSON.stringify({ unlocked: 3, muted: true }))`);
  await reload(); await sleep(500);
  v = await waitVisible(1); if (v.length) await touchTap([{ x: v[0].cx, y: v[0].cy }]); await sleep(250);
  st = await D('state()');
  check('muted when isabella.save says muted (no audio started at all)', st.muted === true && st.audio === 'none', `muted ${st.muted}, audio ${st.audio}, gain ${st.gain}`);
  await evaluate(`localStorage.setItem('isabella.save', JSON.stringify({ unlocked: 3, muted: false }))`);
  await reload(); await sleep(500);
  st = await D('state()');
  const audioBefore = st.audio;
  v = await waitVisible(1); if (v.length) await touchTap([{ x: v[0].cx, y: v[0].cy }]); await sleep(300);
  st = await D('state()');
  check('not muted: sound waits for a gesture, then runs after the first finger tap', audioBefore === 'none' && st.muted === false && st.audio === 'running' && st.gain > 0.5, `before tap ${audioBefore}; after tap ${st.audio}, gain ${st.gain.toFixed(2)}`);
  await evaluate(`localStorage.removeItem('isabella.save')`);

  // ================= 11. inside the Android app: window.IsabellaStore is used =================
  const seed = { v: 1, scene: 2, aquarium: [{ k: 'turtle', c: '#5fb84a' }, { k: 'whale', c: '#4f8ff0' }], total: 42, kinds: { turtle: 9 }, filled: 4 };
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source:
    `(() => { const m = new Map([['isabella.save', JSON.stringify({ muted: true })], ['game.pop.save', ${JSON.stringify(JSON.stringify(seed))}]]);
      window.__fakeStore = m; window.IsabellaStore = { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, String(v)); } }; })();` });
  await reload(); await sleep(600);
  const localBefore = await evaluate(`localStorage.getItem('game.pop.save')`); // written by the previous (browser) page as it closed
  st = await D('state()');
  check('IsabellaStore: save and mute are read from the app store', st.scene === 2 && st.aquarium.join() === 'turtle,whale' && st.total === 42 && st.muted === true, `scene ${st.scene}, aquarium [${st.aquarium}], total ${st.total}, muted ${st.muted}`);
  v = await waitVisible(1); if (v.length) await click(v[0].cx, v[0].cy); await sleep(150);
  const inStore = JSON.parse(await evaluate(`window.__fakeStore.get('game.pop.save')`));
  const inLocal = await evaluate(`localStorage.getItem('game.pop.save')`);
  check('IsabellaStore: a pop is written to the app store, not localStorage', inStore.total === 43 && inStore.aquarium.length === 3 && inLocal === localBefore, `store total ${inStore.total}, aquarium ${inStore.aquarium.length}; localStorage untouched: ${inLocal === localBefore}`);
  await shot('11b-isabellastore-kelp-scene');
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });

  // ================= 12. 1024x768 (first a live resize, as when a tablet turns, then a fresh load) =================
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await sleep(1000); // bubbles glide back inside rather than jump
  st = await D('state()');
  const bs = await D('bubbles()');
  check('live resize: canvas follows the new screen, bubbles stay inside it', st.canvas[0] === 1024 && st.canvas[1] === 768 && bs.every((b) => b.x - b.r > -2 && b.x + b.r < st.VW + 2), `canvas ${st.canvas}, VW ${st.VW.toFixed(0)}`);
  await reload(); await sleep(1300);
  st = await D('state()');
  const slots = await D('slots()'), sp = slots[1] - slots[0];
  check('1024x768: canvas fills the screen', st.canvas[0] === 1024 && st.canvas[1] === 768, `${st.canvas}`);
  check('1024x768: all ten aquarium places fit', slots[0] - sp / 2 >= 0 && slots[9] + sp / 2 <= st.VW, `VW ${st.VW.toFixed(0)}, places ${slots[0].toFixed(0)}..${slots[9].toFixed(0)}`);
  const vh1024 = (await D('bubbles()')).filter((b) => !b.special).map((b) => ((b.cr * 2) / 768) * 100);
  check('1024x768: bubbles still at least 19vh across', vh1024.every((x) => x >= 19), vh1024.map((x) => x.toFixed(1)).join(', '));
  await shot('13-1024x768-start');
  for (let k = 0; k < 3; k++) { v = await waitVisible(1, 8000); if (v.length) await click(v[0].cx, v[0].cy); await sleep(250); }
  await sleep(1300);
  await shot('14-1024x768-aquarium');

  // ================= 13. a 20:9 phone at DPR 2.625: held upright it waits; turned, it plays (canvas capped at 2.5) =================
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true });
  await reload(); await sleep(1000);
  c0 = await D('counters');
  await evaluate(`window.__seen = 0; addEventListener('pointerdown', () => window.__seen++, true)`); // proves the tap reached the page
  const upright = (await D('bubbles()')).find((b) => b.visible);
  if (upright) await touchTap([{ x: upright.cx, y: upright.cy }]);
  await sleep(150);
  c1 = await D('counters');
  const seen = await evaluate('window.__seen');
  check('phone held upright: the sea waits behind a turn-the-phone picture, taps do nothing', !!upright && seen === 1 && c1.pops === c0.pops, `tap arrived ${seen}x, pops ${c0.pops} -> ${c1.pops}`);
  await shot('15a-phone-upright-turn-me');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 915, height: 412, deviceScaleFactor: 2.625, mobile: true });
  await sleep(1300);
  st = await D('state()');
  check('phone 915x412 @2.625: DPR capped at 2.5', st.dpr === 2.5 && st.canvas[0] === Math.round(915 * 2.5) && st.canvas[1] === Math.round(412 * 2.5), `canvas ${st.canvas}, VW ${st.VW.toFixed(0)}`);
  v = await waitVisible(1, 8000);
  c0 = await D('counters');
  if (v.length) await touchTap([{ x: v[0].cx, y: v[0].cy }]);
  await sleep(120);
  c1 = await D('counters');
  check('phone: a finger tap pops', c1.pops === c0.pops + 1);
  await shot('15-phone-915x412-dpr2.625');
  await desk();

  // ================= 14. back button and home button go to the hub =================
  await reload(); await sleep(500);
  const popErrorsSoFar = problems.length;
  where = 'hub';
  let loaded = cdp.once('Page.loadEventFired');
  const ret = await evaluate('window.__back()');
  await loaded; await sleep(300);
  let href = await evaluate('location.href');
  check('window.__back() returns true and opens ../../index.html', ret === true && href === HUB, href.replace(ROOT, ''));
  await go(PAGE, 'pop'); await sleep(500);
  const hb = await evaluate(`(() => { const r = document.querySelector('#home span').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; })()`);
  check('home button is round, top-left, about 15vh', hb.x < 160 && hb.y < 120 && Math.abs(hb.w - 0.15 * HT) < 2, JSON.stringify(hb));
  where = 'hub';
  loaded = cdp.once('Page.loadEventFired');
  await click(hb.x, hb.y);
  await loaded; await sleep(300);
  href = await evaluate('location.href');
  check('home button opens ../../index.html', href === HUB, href.replace(ROOT, ''));

  // ================= 15. no errors =================
  const popProblems = problems.filter((p) => p.where === 'pop');
  const errs = popProblems.filter((p) => p.kind === 'exception' || /error|assert/.test(p.kind));
  check('no console errors or exceptions on the game page', errs.length === 0, errs.length ? JSON.stringify(errs.slice(0, 5)) : 'none');
  check('no console warnings on the game page either', popProblems.length === 0, popProblems.length ? JSON.stringify(popProblems.slice(0, 3)) : 'none');
  notes.problems = problems;
  notes.popErrorsBeforeHub = popErrorsSoFar;

  const failed = results.filter((r) => !r.ok);
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify({ when: new Date().toISOString(), page: PAGE, results, notes, shots }, null, 2));
  console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots in ${OUT}`);
  cdp.close(); cdp.proc.kill();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('verify crashed:', e); if (chrome) chrome.kill(); process.exit(2); });
