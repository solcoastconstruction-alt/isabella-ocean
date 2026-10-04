// Do the checks bite? Breaks a COPY of Splash Dash on purpose, one defect at a time, and runs the tests against the
// copy: every defect must make its test fail, with the failure that names it.
//   node test/games/dash/mutate.js                 (all of them: about half an hour)
//   node test/games/dash/mutate.js tilt-sign-flipped button-never-releases     (only those)
//   node test/games/dash/mutate.js --list
// Each copy lives in <repo>/.local/mutants/<name>/web (the whole web/ tree, so the hub is there for the home
// button); verify.js is pointed at it with DASH_DIR, browser.js and soak.js with DASH_ROOT. Nothing in the real
// tree is touched. First a control: an unbroken copy must pass.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '../../..');
const WORK = path.join(REPO, '.local/mutants');
const DASH = 'web/games/dash';

// file: which file of web/games/dash to break; find -> put: the break (find must occur exactly once);
// run: verify | browser | soak; sections: which parts of browser.js; expect: the failure that should name it.
const MUTANTS = [
  // ---- the rules, the courses and the tilt maths (verify.js) ----
  { name: 'impassable-gap', what: 'a line of buoys with no way through', file: 'logic.js', run: 'verify',
    find: 'for (let x = lane + sd * (24 + BODY_R + C.clear * rnd(1.1, 1.4)); Math.abs(x) <= HALF - 24; x += sd * 100) put(make.buoy(), s, x);',
    put: 'for (let x = lane + sd * 30; Math.abs(x) <= HALF - 24; x += sd * 100) put(make.buoy(), s, x);', expect: /no clean line/ },
  { name: 'tilt-sign-flipped', what: 'leaning right steers left', file: 'logic.js', run: 'verify',
    find: 'SIGN: 1, ', put: 'SIGN: -1, ', expect: /leaning 20° right gives full right steer/ },
  { name: 'tilt-ignores-which-way-round', what: 'the phone held the other way round steers backwards', file: 'logic.js', run: 'verify',
    find: 'else if (a === 270) { out[0] = ay; out[1] = -ax; }', put: 'else if (a === 270) { out[0] = -ay; out[1] = ax; }', expect: /angle 270\): leaning 20° right/ },
  { name: 'tilt-no-dead-zone', what: 'no dead zone: the slightest lean steers', file: 'logic.js', run: 'verify',
    find: 'DEAD: 2.5, ', put: 'DEAD: 0, ', expect: /dead zone/ },
  { name: 'tilt-no-filter', what: 'the low-pass filter removed', file: 'logic.js', run: 'verify',
    find: 'this.value += (this.raw - this.value) * (1 - Math.exp(-dt / TILT.TAU));', put: 'this.value = this.raw;', expect: /the low-pass filter: 63%/ },
  { name: 'tilt-live-on-constant-data', what: 'tilt takes over on data that never changes', file: 'logic.js', run: 'verify',
    find: 'this.samples >= TILT.MIN_SAMPLES && this.changes >= TILT.MIN_CHANGES && nowMs', put: 'this.samples >= TILT.MIN_SAMPLES && nowMs', expect: /identical samples do not make tilt live/ },
  { name: 'tilt-on-its-side-still-steers', what: 'a phone lying on its side steers hard over for ever', file: 'logic.js', run: 'verify',
    find: 'if (this.wild >= TILT.WILD_S) this.off = true;', put: 'if (this.wild >= 9e9) this.off = true;', expect: /on its side \(85° for over/ },
  { name: 'boost-instant', what: 'the speed button jumps straight to top speed', file: 'logic.js', run: 'verify',
    find: 'else if (boost) this.v = Math.min(V_MAX, this.v + up * dt);', put: 'else if (boost) this.v = V_MAX;', expect: /reaches top speed in 2\.4s \(gradually\)/ },
  { name: 'boost-never-eases', what: 'letting go of the speed button does nothing', file: 'logic.js', run: 'verify',
    find: 'else if (this.v > V_SLOW) this.v = V_SLOW + (this.v - V_SLOW) * Math.exp(-dt / EASE_DOWN);', put: 'else if (this.v > V_SLOW) this.v += 0;', expect: /letting go starts easing back/ },
  { name: 'bump-stops-her', what: 'a bump stops her dead', file: 'logic.js', run: 'verify',
    find: 'this.v = Math.min(this.v, V_BUMP);', put: 'this.v = 0;', expect: /a bump drops her to slow speed \(she does not stop\)/ },
  { name: 'bump-takes-all-coins', what: 'a bump takes every coin', file: 'logic.js', run: 'verify',
    find: "if (this.coinCount > 0) { this.coinCount--; this.spilled++; this.emit('spill'); }", put: "if (this.coinCount > 0) { this.coinCount = 0; this.spilled++; this.emit('spill'); }", expect: /and spills one coin/ },
  { name: 'stars-by-time', what: 'stars given for a fast time', file: 'logic.js', run: 'verify',
    find: 'this.stars = starsFor(this.coinCount, lv.groundTotal);', put: 'this.stars = this.t < 60 ? 3 : 1;', expect: /stars do not depend on time/ },
  { name: 'coin-in-the-boats-way', what: 'coins laid where a drifting boat goes', file: 'logic.js', run: 'verify',
    find: "put(o, s, Math.round(x));\n        line(s - 180, s + 180, 4, 0);", put: "put(o, s, Math.round(x));\n        line(s - 60, s + 60, 4, sd * (room + amp));", expect: /coin\(s\) not on a clean line/ },
  { name: 'wave-gap-leaves-the-lane', what: 'the gap in a wave sways right off the lane', file: 'logic.js', run: 'verify',
    find: 'amp = Math.round(gap / 2 - BODY_R - C.clear * 0.5);', put: 'amp = Math.round(gap * 1.2);', expect: /not on a clean line|the model child bumped/ },
  { name: 'seed-changed', what: 'a course is no longer the frozen one', file: 'logic.js', run: 'verify',
    find: 'const SEEDS = [', put: 'const SEEDS = [77, ', expect: /course 1 is the frozen course/ },
  { name: 'difficulty-upside-down', what: 'the courses get roomier, not tighter', file: 'logic.js', run: 'verify',
    find: 'clear: Math.round(lerp(115, 55, u)),', put: 'clear: Math.round(lerp(55, 115, u)),', expect: /harder than course/ },
  { name: 'course-too-long', what: 'courses half as long again', file: 'logic.js', run: 'verify',
    find: 'len: 17500 + 200 * (n - 1),', put: 'len: 26000 + 200 * (n - 1),', expect: /at slow speed \(stated/ },
  { name: 'kelp-does-not-slow', what: 'kelp does nothing', file: 'logic.js', run: 'verify',
    find: 'else if (kelp) this.v +=', put: 'else if (kelp && false) this.v +=', expect: /kelp slows her/ },
  { name: 'ramp-never-leaps', what: 'the wave ramp never throws her', file: 'logic.js', run: 'verify',
    find: 'if (this.v >= V_LEAP) {', put: 'if (this.v >= V_LEAP * 9) {', expect: /a ramp taken fast throws her into the air/ },
  { name: 'leaves-the-course', what: 'nothing holds her on the course', file: 'logic.js', run: 'verify',
    find: 'if (this.x > XMAX) { this.x = XMAX; if (this.vx > 0) this.vx = 0; }', put: 'if (this.x > XMAX * 9) { this.x = XMAX; }', expect: /she cannot leave the course on the right/ },

  // ---- the game in the browser (browser.js) ----
  { name: 'button-never-releases', what: 'the speed button stays held when the finger lifts', file: 'game.js', run: 'browser', sections: 'fingers',
    find: "    goBtn.addEventListener(type, (e) => { if (e.pointerId === go.id) releaseGo(); });\n    window.addEventListener(type, (e) => { if (e.pointerId === go.id) releaseGo(); });",
    put: "    goBtn.addEventListener(type, (e) => { void e; });\n    window.addEventListener(type, (e) => { void e; });", expect: /FAIL letting go of the button: it is released at once/ },
  { name: 'touch-steers-backwards', what: 'a finger to her right steers her left', file: 'game.js', run: 'browser', sections: 'fingers',
    find: 'dx = touch.x - her,', put: 'dx = her - touch.x,', expect: /FAIL a finger held to her right steers her right/ },
  { name: 'tilt-forgets-which-way-round', what: 'the game ignores screen.orientation.angle', file: 'game.js', run: 'browser', sections: 'tilt',
    find: 'return tilt.push(ax, ay, az, angle, now, src);', put: 'return tilt.push(ax, ay, az, 90, now, src);', expect: /FAIL angle 270 \(the other way round\): leaning the phone 15° to the right steers her right/ },
  { name: 'tilt-beats-finger', what: 'a finger cannot take over from the tilt', file: 'game.js', run: 'browser', sections: 'tilt',
    find: '    if (touch.id != null) {\n      // a finger: she swims toward it', put: '    if (touch.id != null && !tilt.live(now)) {\n      // a finger: she swims toward it', expect: /FAIL angle 90 \(top edge to the left\): a finger on the water takes over from the tilt/ },
  { name: 'rejected-permission-unhandled', what: 'a refused sensor permission is an unhandled error', file: 'game.js', run: 'browser', sections: 'tilt',
    find: ", (err) => { sens.permission[name] = 'refused (' + ((err && err.name) || err) + ')'; });", put: ');', expect: /FAIL a promise that rejects from requestPermission cannot break the game/ },
  { name: 'no-bridge', what: 'window.__steer is missing', file: 'game.js', run: 'browser', sections: 'bridge',
    find: 'window.__steer = (x) =>', put: 'window.__steerGone = (x) =>', expect: /__steer is not defined/ },
  { name: 'save-not-written', what: 'nothing is saved', file: 'game.js', run: 'browser', sections: 'course',
    find: 'const persist = () => store.set(SAVE_KEY, JSON.stringify(save));', put: 'const persist = () => {};', expect: /FAIL saved: course 1 = 3 stars/ },
  { name: 'stars-go-down', what: 'a worse swim takes saved stars away', file: 'game.js', run: 'browser', sections: 'course',
    find: 'save.stars[n - 1] = Math.max(save.stars[n - 1], run.stars);', put: 'save.stars[n - 1] = run.stars;', expect: /FAIL a worse swim .* never takes saved stars away/ },
  { name: 'button-held-across-the-finish', what: 'the speed button is still held after the finish line', file: 'game.js', run: 'browser', sections: 'course',
    find: "    persist();\n    releaseAll();\n    document.body.classList.remove('swim');", put: "    persist();\n    document.body.classList.remove('swim');", expect: /FAIL crossing the line lets go of the speed button/ },
  { name: 'results-never-come', what: 'the results card never appears', file: 'game.js', run: 'browser', sections: 'course',
    find: 'later(RESULTS_AT, showResults);', put: 'void showResults;', expect: /timed out waiting for course 1 by finger: the results card/ },
  { name: 'mute-wipes-the-main-save', what: 'the sound switch overwrites the main game\'s save', file: 'game.js', run: 'browser', sections: 'sound',
    find: '    obj.muted = !!on;', put: '    obj = { muted: !!on };', expect: /FAIL the sound switch mutes and writes muted:true into isabella\.save, every other field untouched/ },
  { name: 'home-goes-nowhere', what: 'the home button points at the wrong page', file: 'game.js', run: 'browser', sections: 'last',
    find: "HUB = '../../index.html'", put: "HUB = 'index.html?x'", expect: /timed out waiting for the home button from a course/ },
  { name: 'crash-drawing-a-buoy', what: 'an exception in the drawing code', file: 'art.js', run: 'browser', sections: 'last',
    find: "else if (o.k === 'buoy') blit(SP.buoy(o.v), p.x, y, p.k, rot * 2.2);", put: "else if (o.k === 'buoy') blitz(SP.buoy(o.v), p.x, y, p.k, rot * 2.2);", expect: /page errors: \[.*blitz is not defined/ },
  { name: 'speed-button-too-small', what: 'the speed button is 14vh', file: 'index.html', run: 'browser', sections: 'sizes', sizes: '915x412',
    find: 'bottom:3vh; width:29vh; height:29vh;', put: 'bottom:3vh; width:14vh; height:14vh;', expect: /FAIL 915x412: the speed button is 14\.0vh \(at least 19vh\)/ },

  // ---- leaks (soak.js, a short one) ----
  { name: 'particles-never-die', what: 'particles are never removed', file: 'art.js', run: 'soak',
    find: "      p.life -= dt;\n      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }", put: "      p.life -= dt;\n      if (p.life <= -1e9) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }", expect: /particles pile up/ },
  { name: 'listener-leak', what: 'every course adds another event listener', file: 'game.js', run: 'soak',
    find: '    level = n;\n    run = new L.Run(n);', put: "    level = n;\n    window.addEventListener('resize', () => R.resize());\n    run = new L.Run(n);", expect: /event listeners grew/ },
  { name: 'memory-leak', what: 'every frame keeps a little more memory', file: 'game.js', run: 'soak',
    find: '    streakT -= dt;', put: '    streakT -= dt; (window.__leak = window.__leak || []).push(new Array(700).fill(clock));', expect: /heap grew/ },
];

function sh(cmd, args, env) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: REPO, env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('exit', (code) => resolve({ code, out }));
  });
}
function makeCopy(name, m) {
  const root = path.join(WORK, name);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  fs.cpSync(path.join(REPO, 'web'), path.join(root, 'web'), { recursive: true });
  if (m) {
    const file = path.join(root, DASH, m.file), src = fs.readFileSync(file, 'utf8'), n = src.split(m.find).length - 1;
    if (n !== 1) throw new Error(`${name}: the text to break occurs ${n} times in ${m.file} (it must occur exactly once)`);
    fs.writeFileSync(file, src.replace(m.find, m.put));
  }
  return root;
}
function runTest(root, m, name) {
  const profile = path.join(WORK, 'chrome'), out = path.join(WORK, name, 'out');
  if (m.run === 'verify') return sh('node', ['test/games/dash/verify.js'], { DASH_DIR: path.join(root, DASH) });
  if (m.run === 'browser') return sh('node', ['test/games/dash/browser.js', out, profile], { DASH_ROOT: root, DASH_SECTIONS: m.sections || '', DASH_SIZES: m.sizes || '915x412' });
  return sh('node', ['test/games/dash/soak.js', '45', out, profile], { DASH_ROOT: root });
}
const tail = (out) => out.split('\n').filter((l) => /FAIL|checks passed|SOAK|crashed/.test(l)).slice(0, 4).map((l) => l.trim().slice(0, 170)).join(' | ');

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--list')) { for (const m of MUTANTS) console.log(`${m.name.padEnd(34)} ${m.run.padEnd(8)} ${m.what}`); return; }
  const chosen = args.length ? MUTANTS.filter((m) => args.includes(m.name)) : MUTANTS;
  fs.mkdirSync(WORK, { recursive: true });
  const t0 = Date.now();
  let bad = 0;

  // the control: unbroken copies pass (so a failure below is the defect's doing, not the copy's)
  if (!args.length || args.includes('--control')) {
    const root = makeCopy('control', null);
    const v = await runTest(root, { run: 'verify' }, 'control');
    console.log(`control  verify.js on an unbroken copy: ${v.code === 0 ? 'passes' : 'FAILS'}  (${tail(v.out)})`);
    const b = await runTest(root, { run: 'browser', sections: 'fingers,tilt,bridge,sound' }, 'control');
    console.log(`control  browser.js (fingers, tilt, bridge, sound) on an unbroken copy: ${b.code === 0 ? 'passes' : 'FAILS'}  (${tail(b.out)})`);
    if (v.code !== 0 || b.code !== 0) bad++;
  }

  const results = [];
  const report = (m, r) => {
    const caught = r.code !== 0 && m.expect.test(r.out);
    if (!caught) bad++;
    results.push({ name: m.name, caught });
    console.log(`${caught ? 'CAUGHT ' : 'MISSED '} ${m.name.padEnd(32)} ${m.run.padEnd(7)} ${m.what}\n         ${caught ? (r.out.split('\n').find((l) => m.expect.test(l)) || '').trim().slice(0, 190) : 'exit ' + r.code + ': ' + tail(r.out)}`);
  };
  // verify.js runs need no browser: four at a time
  const logic = chosen.filter((m) => m.run === 'verify');
  for (let i = 0; i < logic.length; i += 4) {
    await Promise.all(logic.slice(i, i + 4).map(async (m) => report(m, await runTest(makeCopy(m.name, m), m, m.name))));
  }
  // the browser ones share a DevTools port: one at a time
  for (const m of chosen.filter((q) => q.run !== 'verify')) report(m, await runTest(makeCopy(m.name, m), m, m.name));

  console.log(`\n${results.filter((r) => r.caught).length}/${results.length} defects caught${bad ? `, ${bad} PROBLEM(S)` : ''} (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(bad ? 1 : 0);
})();
