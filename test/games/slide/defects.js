// Do the checks bite? Breaks a COPY of Rainbow Slide on purpose, one defect at a time, and runs the tests against the
// copy: every defect must make its test fail, with the failure that names it. Prints "N injected, N caught".
//   node test/games/slide/defects.js                 (all of them: about half an hour)
//   node test/games/slide/defects.js rail-missing-on-easy checkpoint-does-not-restore      (only those)
//   node test/games/slide/defects.js rules           (only the quick ones that need no browser)
//   node test/games/slide/defects.js --list
// Each copy lives in <repo>/.local/mutants-slide/<name>/web (the whole web/ tree, so the hub and FairyArt are there);
// verify.js is pointed at it with SLIDE_DIR, browser.js and soak.js with SLIDE_ROOT. Nothing in the real tree is touched.
// First a control: an unbroken copy must pass.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.resolve(__dirname, '../../..');
const WORK = path.join(REPO, '.local/mutants-slide');
const SLIDE = 'web/games/slide';

// file: which file of web/games/slide to break; find -> put: the break (find must occur exactly once);
// run: verify | browser | soak; sections: which parts of browser.js; expect: the failure that should name it.
const MUTANTS = [
  // ---- the courses, the rules and the tilt maths (verify.js) ----
  { name: 'coin-in-the-drifters-way', what: 'coins laid where a drifting cloud goes', file: 'logic.js', run: 'verify',
    find: 'drifter(s, side, 1);\n        line(s - 180, s + 180, 4, 0);', put: 'const dsd = drifter(s, side, 1);\n        line(s - 180, s + 180, 4, dsd * 150);', expect: /coin\(s\) or the key not on a clean line/ },
  { name: 'cloud-on-the-line', what: 'a cloud sits right on the clear lane', file: 'logic.js', run: 'verify',
    find: 'put(o, s, lane + sd * off);\n      return sd;', put: 'put(o, s, lane);\n      return sd;', expect: /no clean line|not on a clean line|the model child slides it without a poof/ },
  { name: 'wall-with-no-way-through', what: 'a row of clouds with no gap', file: 'logic.js', run: 'verify',
    find: 'x = lane + sd * (CLOUD[0].r + CLOUD[0].hx + BODY_R + clearK * rnd(1.1, 1.4));', put: 'x = lane + sd * 8;', expect: /no clean line/ },
  { name: 'cloud-in-a-loop', what: 'clouds are laid inside the loop-the-loop zone', file: 'logic.js', run: 'verify',
    find: 'if (z && s + NOM[kind] + 120 > z.a) {', put: 'if (false && z && s + NOM[kind] + 120 > z.a) {', expect: /no cloud in or near a loop-the-loop/ },
  { name: 'loop-coins-not-extra', what: 'the coins in a loop count toward the stars', file: 'logic.js', run: 'verify',
    find: 'coin(z.lp.a + ((i + 0.5) * LOOP_LEN) / 8, 0, 1);', put: 'coin(z.lp.a + ((i + 0.5) * LOOP_LEN) / 8, 0, 0);', expect: /eight extra coins in each/ },
  { name: 'arch-in-a-loop', what: 'a rainbow arch can stand inside a loop', file: 'logic.js', run: 'verify',
    find: 'const z = inLoopZone(p, 380); if (z) p = z.b + LOOP_MARGIN + 380;', put: 'const z = null; if (z) p = z.b + LOOP_MARGIN + 380;', expect: /nothing near an arch/ },
  { name: 'key-off-the-lane', what: 'the key hangs off the lane', file: 'logic.js', run: 'verify',
    find: 'lev.key.x = Math.round(laneAt(lev, keyS));', put: 'lev.key.x = Math.round(laneAt(lev, keyS)) + 150;', expect: /the key hangs on the lane/ },
  { name: 'drifter-crosses-the-lane', what: 'a drifting cloud sweeps across the lane', file: 'logic.js', run: 'verify',
    find: 'const room = halfWidth(o) + BODY_R + clearK * rnd(0.8, 1.2);', put: 'const room = 0;', expect: /never reaches the lane|no clean line/ },
  { name: 'rail-missing-on-easy', what: 'Easy has no invisible rail at the rim', file: 'logic.js', run: 'verify',
    find: "if (M.edge === 'rail') {", put: "if (M.edge === 'rail' && false) {", expect: /Easy: invisible rails hold her/ },
  { name: 'medium-slips-like-hard', what: 'Medium lets her fall off the rim', file: 'logic.js', run: 'verify',
    find: "} else if (M.edge === 'rim') {", put: "} else if (M.edge === 'rimX') {", expect: /Medium: at the rim she is bumped back|nothing ever makes her slip/ },
  { name: 'poof-can-make-her-slip', what: 'a poof near the rim on Hard can throw her off', file: 'logic.js', run: 'verify',
    find: '        if (this.inv > 0) {\n          // (a poof, or the moment', put: '        if (false) {\n          // (a poof, or the moment', expect: /back to the course speed a few seconds later|eyes shut still reaches the chest/ },
  { name: 'checkpoint-does-not-restore', what: 'floating back puts her at the start, not at the arch', file: 'logic.js', run: 'verify',
    find: 'this.s = this.cpS; this.x = laneAt(lv, this.s);', put: 'this.s = 0; this.x = laneAt(lv, this.s);', expect: /a slip brings her back to the last arch/ },
  { name: 'slip-loses-the-coins', what: 'the fall to the arch takes her coins away', file: 'logic.js', run: 'verify',
    find: '          this.moved = true;\n', put: '          this.moved = true; this.laneCount = 0;\n', expect: /her coins .* and the key are kept/ },
  { name: 'arch-not-remembered', what: 'passing an arch does not make it the checkpoint', file: 'logic.js', run: 'verify',
    find: "this.cpS = lv.arches[this.ai]; this.cpN = ++this.ai; this.emit('arch', this.cpS); }", put: "this.cpN = ++this.ai; this.emit('arch', this.cpS); }", expect: /passing an arch makes it the checkpoint/ },
  { name: 'mode-not-scaling', what: 'Hard slides at the same speed as Medium', file: 'logic.js', run: 'verify',
    find: "hard:   { id: 'hard',   idx: 2, speed: 1.25,", put: "hard:   { id: 'hard',   idx: 2, speed: 1,", expect: /speeds: Easy ×0\.8/ },
  { name: 'easy-spills-coins', what: 'a poof spills a coin on Easy', file: 'logic.js', run: 'verify',
    find: "edge: 'rail', spill: false", put: "edge: 'rail', spill: true", expect: /no coin is spilled|no spilled coin on Easy/ },
  { name: 'poof-stops-her', what: 'a poof stops her dead', file: 'logic.js', run: 'verify',
    find: 'this.v = Math.min(this.v, this.vc * POOF_V);', put: 'this.v = 0;', expect: /a cloud is one soft poof/ },
  { name: 'stars-by-time', what: 'stars given for a fast time', file: 'logic.js', run: 'verify',
    find: 'this.stars = starsFor(this.laneCount, lv.laneTotal);', put: 'this.stars = this.t < 60 ? 3 : 1;', expect: /stars do not depend on time/ },
  { name: 'chest-stays-shut-without-key', what: 'without the key the chest never opens', file: 'logic.js', run: 'verify',
    find: 'this.st >= (this.hasKey ? NEAR_OPEN : KEY_DELAY)', put: 'this.st >= (this.hasKey ? NEAR_OPEN : 1e9)', expect: /the finish: she glides to the middle and stops at the chest, which opens \(without/ },
  { name: 'seed-changed', what: 'a course is no longer the frozen one', file: 'logic.js', run: 'verify',
    find: 'const seed = seedOverride != null ? seedOverride : SEEDS[modeId][n - 1];', put: 'const seed = seedOverride != null ? seedOverride : SEEDS[modeId][n - 1] + 1;', expect: /is the frozen course/ },
  { name: 'difficulty-upside-down', what: 'the courses get roomier, not tighter', file: 'logic.js', run: 'verify',
    find: 'clear: Math.round(w2 ? lerp(80, 55, t) : lerp(125, 85, t)),', put: 'clear: Math.round(w2 ? lerp(55, 80, t) : lerp(85, 125, t)),', expect: /is harder than course/ },
  { name: 'course-too-long', what: 'courses half as long again', file: 'logic.js', run: 'verify',
    find: 'len: Math.round((secs * speed) / 10) * 10,', put: 'len: Math.round((secs * speed * 1.5) / 10) * 10,', expect: /takes 50–75 s at Medium speed/ },
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

  // ---- the game in the browser (browser.js) ----
  { name: 'touch-steers-backwards', what: 'a finger to her right steers her left', file: 'game.js', run: 'browser', sections: 'fingers',
    find: 'dx = touch.x - her,', put: 'dx = her - touch.x,', expect: /FAIL a finger held to her right steers her right/ },
  { name: 'tilt-forgets-which-way-round', what: 'the game ignores screen.orientation.angle', file: 'game.js', run: 'browser', sections: 'tilt',
    find: 'return tilt.push(ax, ay, az, angle, now, src);', put: 'return tilt.push(ax, ay, az, 90, now, src);', expect: /FAIL angle 270 \(the other way round\): leaning the phone 15° to the right steers her right/ },
  { name: 'tilt-beats-finger', what: 'a finger cannot take over from the tilt', file: 'game.js', run: 'browser', sections: 'tilt',
    find: '    if (touch.id != null) {\n      // a finger: she slides toward it', put: '    if (touch.id != null && !tilt.live(now)) {\n      // a finger: she slides toward it', expect: /FAIL angle 90 \(top edge to the left\): a finger on the screen takes over from the tilt/ },
  { name: 'rejected-permission-unhandled', what: 'a refused sensor permission is an unhandled error', file: 'game.js', run: 'browser', sections: 'tilt',
    find: ", (err) => { sens.permission[name] = 'refused (' + ((err && err.name) || err) + ')'; });", put: ');', expect: /FAIL a promise that rejects from requestPermission cannot break the game/ },
  { name: 'no-bridge', what: 'window.__steer is missing', file: 'game.js', run: 'browser', sections: 'bridge',
    find: 'window.__steer = (x) =>', put: 'window.__steerGone = (x) =>', expect: /__steer is not defined/ },
  { name: 'save-not-written', what: 'nothing is saved', file: 'game.js', run: 'browser', sections: 'sizes', sizes: '915x412',
    find: "const persist = () => { dirty = false; lastPersist = performance.now(); store.set(SAVE_KEY, JSON.stringify(save)); };", put: 'const persist = () => { dirty = false; };', expect: /FAIL 915x412: saved at the line under game\.slide\.save/ },
  { name: 'mode-not-remembered', what: 'the last mode played is not saved', file: 'game.js', run: 'browser', sections: 'sizes', sizes: '915x412',
    find: 'if (save.mode !== m) { save.mode = m; persist(); }', put: 'if (save.mode !== m) { save.mode = m; }', expect: /FAIL 915x412: tapping Medium presses it and saves it as the last mode/ },
  { name: 'stars-go-down', what: 'a worse slide takes saved stars away', file: 'game.js', run: 'browser', sections: 'course',
    find: 'st[n - 1] = Math.max(st[n - 1], run.stars);', put: 'st[n - 1] = run.stars;', expect: /FAIL a worse slide .* never takes saved stars away/ },
  { name: 'results-never-come', what: 'the results card never appears', file: 'game.js', run: 'browser', sections: 'sizes', sizes: '915x412',
    find: 'later(RESULTS_AT, showResults);', put: 'void showResults;', expect: /timed out waiting for 915x412: the results card/ },
  { name: 'writes-the-main-save', what: 'playing writes into the main game\'s isabella.save', file: 'game.js', run: 'browser', sections: 'saves',
    find: '    save.taught = true;\n    persist();', put: "    save.taught = true;\n    store.set(MAIN_KEY, JSON.stringify(Object.assign({}, readMain() || {}, { muted: false })));\n    persist();", expect: /FAIL playing a course leaves isabella\.save byte-for-byte as it was|never written: byte for byte/ },
  { name: 'key-icon-never-lights', what: 'catching the key does not light the key icon', file: 'game.js', run: 'browser', sections: 'sizes', sizes: '915x412',
    find: "$('keyIcon').classList.add('on');", put: '', expect: /FAIL 915x412: the key she catches lights up/ },
  { name: 'home-goes-nowhere', what: 'the home button points at the wrong page', file: 'game.js', run: 'browser', sections: 'last',
    find: "HUB = '../../index.html'", put: "HUB = 'index.html?x'", expect: /timed out waiting for the home button from a course/ },
  { name: 'back-button-missing', what: 'window.__back does not leave', file: 'game.js', run: 'browser', sections: 'last',
    find: "window.__back = () => { flush(); location.href = '../../index.html'; return true; };", put: 'window.__back = () => false;', expect: /timed out waiting for the back button to reach the hub|FAIL window\.__back\(\) returns true/ },
  { name: 'crash-drawing-a-cloud', what: 'an exception in the drawing code', file: 'art.js', run: 'browser', sections: 'sizes', sizes: '915x412',
    find: 'F.drawCloud(ctx, -wp / 2, bob - 4 * p.k, wp,', put: 'F.drawCloudz(ctx, -wp / 2, bob - 4 * p.k, wp,', expect: /drawCloudz is not a function/ },
  { name: 'mode-button-too-small', what: 'the mode buttons are 14vh', file: 'index.html', run: 'browser', sections: 'sizes', sizes: '915x412',
    find: '.mode { width:19vh; height:19vh;', put: '.mode { width:14vh; height:14vh;', expect: /FAIL 915x412: level bubbles, home, the three mode buttons and the page arrow are at least 19vh/ },

  // ---- leaks (soak.js, a short one) ----
  { name: 'particles-never-die', what: 'particles are never removed', file: 'art.js', run: 'soak',
    find: "      p.life -= dt;\n      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }", put: "      p.life -= dt;\n      if (p.life <= -1e9) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }", expect: /particles (pile up|reached their cap)/ },
  { name: 'listener-leak', what: 'every course adds another event listener', file: 'game.js', run: 'soak',
    find: '    level = n;\n    run = new L.Run(n, mode);', put: "    level = n;\n    window.addEventListener('resize', () => R.resize());\n    run = new L.Run(n, mode);", expect: /event listeners grew/ },
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
    const file = path.join(root, SLIDE, m.file), src = fs.readFileSync(file, 'utf8'), n = src.split(m.find).length - 1;
    if (n !== 1) throw new Error(`${name}: the text to break occurs ${n} times in ${m.file} (it must occur exactly once)`);
    fs.writeFileSync(file, src.replace(m.find, () => m.put));
  }
  return root;
}
function runTest(root, m, name) {
  const profile = path.join(WORK, 'chrome'), out = path.join(WORK, name, 'out');
  if (m.run === 'verify') return sh('node', ['test/games/slide/verify.js'], { SLIDE_DIR: path.join(root, SLIDE) });
  if (m.run === 'browser') return sh('node', ['test/games/slide/browser.js', out, profile], { SLIDE_ROOT: root, SLIDE_SECTIONS: m.sections || '', SLIDE_SIZES: m.sizes || '915x412' });
  return sh('node', ['test/games/slide/soak.js', '45', out, profile], { SLIDE_ROOT: root });
}
const tail = (out) => out.split('\n').filter((l) => /FAIL|checks passed|SOAK|crashed/.test(l)).slice(0, 4).map((l) => l.trim().slice(0, 170)).join(' | ');

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--list')) { for (const m of MUTANTS) console.log(`${m.name.padEnd(34)} ${m.run.padEnd(8)} ${m.what}`); return; }
  const chosen = args.length ? MUTANTS.filter((m) => args.includes(m.name) || (args.includes('rules') && m.run === 'verify')) : MUTANTS;
  fs.mkdirSync(WORK, { recursive: true });
  const t0 = Date.now();
  let bad = 0;

  // the control: unbroken copies pass (so a failure below is the defect's doing, not the copy's)
  if (!args.length || args.includes('--control')) {
    const root = makeCopy('control', null);
    const v = await runTest(root, { run: 'verify' }, 'control');
    console.log(`control  verify.js on an unbroken copy: ${v.code === 0 ? 'passes' : 'FAILS'}  (${tail(v.out)})`);
    const b = await runTest(root, { run: 'browser', sections: 'fingers,tilt,bridge,saves' }, 'control');
    console.log(`control  browser.js (fingers, tilt, bridge, saves) on an unbroken copy: ${b.code === 0 ? 'passes' : 'FAILS'}  (${tail(b.out)})`);
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

  console.log(`\n${results.length} injected, ${results.filter((r) => r.caught).length} caught${bad ? `, ${bad} PROBLEM(S)` : ''} (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(bad ? 1 : 0);
})();
