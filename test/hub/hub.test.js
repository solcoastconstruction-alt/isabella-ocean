// The title screen as a game picker: Isabella, Bubble Party and Shell Match, and back again.
// Real mouse taps in headless Chrome (port 9454). Run: node test/hub/hub.test.js
const path = require('path');
const os = require('os');
const { launch, sleep } = require('../paywall/cdp.js');

const ROOT = path.resolve(__dirname, '../..');
const PAGE = 'file://' + path.join(ROOT, 'web/index.html');
const OUT = path.join(os.tmpdir(), 'isabella-hub');
let pass = 0, fail = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); ok ? pass++ : fail++; };

(async () => {
  const cdp = await launch({ port: 9454, profile: path.join(OUT, 'profile') });
  const errors = [];
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  const where = () => cdp.eval('location.pathname');
  const title = async () => {
    await cdp.waitFor("window.__dbg && __dbg.mode === 'title'", 8000, 'the title screen');
    await sleep(300);
  };

  for (const [w, h] of [[1335, 600], [1024, 768]]) {
    await cdp.viewport(w, h);
    await cdp.navigate(PAGE);
    await title();
    const sizes = await cdp.eval(`['popBtn','playBtn','matchBtn'].map((id) => { const b = document.getElementById(id).getBoundingClientRect(); return Math.round(Math.min(b.width, b.height) / innerHeight * 1000) / 10; })`);
    check(sizes.every((s) => s >= 19), `${w}x${h}: three game buttons, each at least 19vh (${sizes.join(' / ')} vh)`);
    console.log('      shot', await cdp.shot(path.join(OUT, `title-${w}x${h}.png`)));
  }
  await cdp.viewport(1335, 600);
  await cdp.navigate(PAGE);
  await title();

  await cdp.tap('#popBtn');
  await cdp.waitFor("location.pathname.endsWith('/games/pop/index.html') && !!window.__popDebug", 8000, 'Bubble Party to load');
  check((await where()).endsWith('/games/pop/index.html'), 'Bubble Party opens from its button');
  await sleep(800);
  console.log('      shot', await cdp.shot(path.join(OUT, 'pop.png')));
  await cdp.eval('window.__back()');
  await title();
  check((await where()).endsWith('/web/index.html'), 'back from Bubble Party returns to the picker');

  await cdp.tap('#matchBtn');
  await cdp.waitFor("location.pathname.endsWith('/games/match/index.html') && !!window.__matchDebug", 8000, 'Shell Match to load');
  check((await where()).endsWith('/games/match/index.html'), 'Shell Match opens from its button');
  await sleep(800);
  console.log('      shot', await cdp.shot(path.join(OUT, 'match.png')));
  await cdp.eval('window.__back()');
  await title();
  check((await where()).endsWith('/web/index.html'), 'back from Shell Match returns to the picker');

  await cdp.tap('#playBtn');
  await cdp.waitFor("__dbg.mode === 'levels'", 5000, 'Isabella levels');
  check(true, 'the middle button still opens Isabella\'s levels');

  check(errors.length === 0, `no JavaScript exceptions on any page${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log(`\n${pass}/${pass + fail} checks passed`);
  await cdp.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
