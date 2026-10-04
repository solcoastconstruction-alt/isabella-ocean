// Records the demo on the owner's REAL Seeker (CLOCK IN needs real-device footage). The phone's
// owner approves every wallet request himself: this script never touches the wallet. It only taps
// through Isabella Ocean (the store app) and records the screen.
//   title → "+" (the six more games) → Sea Jigsaw, one puzzle → title → World 1 → World 2 locked →
//   parent gate → Stake 1 SOL → (he approves) → World 2 opens → a little play → Grown-ups →
//   Get my SOL back now → (he approves) → locked → Pay once → (he approves) → open.
// Needs: the Seeker on USB, awake, with Isabella Ocean 2.5 or later (nine games); a devnet wallet
// account that has never bought World 2, holds no stake and has ≥1.15 devnet SOL; and the app's
// save at "World 1 finished" (SEEKER_PRESET_SAVE=1 writes that save if it is short of it).
// Run: SEEKER_SERIAL=<adb serial> node test/e2e/record-seeker.js <wallet address>
//   → .local/demo/isabella-ocean-seeker-raw.mp4 + .local/demo/seeker.log (the editor cuts by the
//     log's lines; an earlier take's two files are kept beside them as *.before-<time>.*)
//   SEEKER_MINIGAME=0        leave the mini-game out ("+" is still shown)
//   SEEKER_RELOCK=quick      after the exit, go straight from Grown-ups to the unlock screen
//                            (default: show World 2's padlocks and pass the parent gate again)
// Rehearse without a phone (headless Chrome, mock wallet; see seeker-dry.js):
//   node test/e2e/record-seeker.js --dry-run MockWa11et7xKXtg2CW87d97TXJSDpbD5jBkheTqA8
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { connect, sleep } = require('../paywall/cdp.js');

const DRY = process.argv.includes('--dry-run');
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ADB = path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb');
const SERIAL = process.env.SEEKER_SERIAL;   // the phone's adb serial (kept out of the repo)
const PKG = 'app.isabella.mermaid.seeker';   // the store app only, never her app
const WALLET_PKG = 'com.solanamobile.wallet';
const MINIGAME = !/^(0|off|no|false)$/i.test(process.env.SEEKER_MINIGAME || '');
const QUICK_RELOCK = process.env.SEEKER_RELOCK === 'quick';
const PRESET_SAVE = process.env.SEEKER_PRESET_SAVE === '1';
const adb = (...a) => spawnSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8' });

// ---- the log: one line per beat, with the video time once recording has started ----
let OUT = path.join(__dirname, '../../.local/demo'), logFile = null, rec0 = 0, dev = null;
const held = [], said = new Map();
let repeats = 0;
function log(s) {
  if (rec0) {   // the editor cuts by these lines: each one is said once
    const n = (said.get(s) || 0) + 1; said.set(s, n);
    if (n > 1) { repeats++; s = `${s} (${n})`; }
  }
  const line = `${new Date().toISOString().slice(11, 19)}${rec0 ? ` [video ${((Date.now() - rec0) / 1000).toFixed(1)}s]` : ''}  ${s}`;
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, line + '\n'); else held.push(line);
}
// A beat: a log line, and in a dry run a screenshot of what the camera would see.
async function beat(s) { log(s); if (dev) await dev.shot(s); }

// ---- input: real Android touches on the phone (device pixels) ----
let cdp, dpr = 1;
const px = (v) => String(Math.round(v));
async function touchTap(x, y) { if (dev) await dev.tap(x, y); else adb('shell', 'input', 'tap', px(x), px(y)); }
async function touchSwipe(x1, y1, x2, y2, ms) { if (dev) await dev.swipe(x1, y1, x2, y2, ms); else adb('shell', 'input', 'swipe', px(x1), px(y1), px(x2), px(y2), px(ms)); }
// The centre of an element, once it is really the thing on top there (a screen may still be arriving).
async function at(selector, wait = 4000) {
  for (const t0 = Date.now(); ;) {
    try { const { x, y } = await cdp.center(selector); return [x * dpr, y * dpr]; } catch (e) { if (Date.now() - t0 > wait) throw e; }
    await sleep(150);
  }
}
async function tap(selector, pause = 900) { const [x, y] = await at(selector); await touchTap(x, y); await sleep(pause); }
async function hold(selector, ms) { const [x, y] = await at(selector); await touchSwipe(x, y, x, y, ms); }
async function tapUntil(selector, cond, what, tries = 3) {
  for (let i = 0; i < tries; i++) {
    await tap(selector, 400);
    try { await cdp.waitFor(cond, 4000, what); return; } catch (e) { log(`no ${what} yet; tapping ${selector} again`); }
  }
  throw new Error(`no ${what} after ${tries} taps on ${selector}`);
}
const top = () => (dev ? '' : adb('shell', 'dumpsys activity activities').stdout.split('\n').find((l) => l.includes('topResumedActivity')) || '');

// ---- the app's screens ----
const on = (id) => `document.getElementById('${id}').classList.contains('on')`;
const ASK = on('pwAsk'), YAY = on('pwYay');
const worldOpen = 'Paywall.worldOpen()';
const HUB = "!!(window.Paywall && window.__dbg && window.IsabellaHub) && !location.pathname.includes('/games/')";
const mode = () => cdp.eval('__dbg.mode');
const inGame = () => cdp.eval("location.pathname.includes('/games/')").catch(() => true);
async function hubReady(ms = 15000) { await cdp.waitFor(HUB, ms, 'the title screen'); await cdp.eval('Paywall.ready.then(() => true)'); }
// From a mini-game back to the title: its home button, or Android's back if that is covered.
async function backToHub() {
  try { await tap('#homeBtn', 300); } catch (e) { await cdp.eval('window.__back()').catch(() => {}); }
  await hubReady();
}
async function toTitle() {
  for (let i = 0; i < 12; i++) {
    if (await inGame()) { await backToHub(); continue; }
    if (await cdp.eval('Paywall.isOpen()')) { await cdp.eval('window.__back()'); await sleep(400); continue; }
    const m = await mode();
    if (m === 'title') return;
    if (m === 'play') await tap('#pauseBtn', 800);
    else if (m === 'paused') await tap('#pauseHome', 900);
    else if (m === 'levels') await tap('#levelsHome', 700);
    else if (m === 'more') await tap('#moreBack', 700);
    else { await cdp.eval('window.__back()'); await sleep(400); }
  }
  throw new Error('could not get back to the title screen');
}

// The parent gate: hold 3 s, then the multiplication. `n` numbers the gate's log lines.
async function gate(n) {
  await cdp.waitFor(on('pwGate'), 5000, 'the parent gate');
  await sleep(500);
  for (let i = 0; ; i++) {
    await beat(`parent gate ${n}: hold${i ? ' again' : ''}`);
    await hold('#pwHoldBtn', 3400);
    try { await cdp.waitFor("!document.getElementById('pwMathStage').hidden", 4000, 'the sum'); break; } catch (e) { if (i) throw e; }
  }
  await beat(`parent gate ${n}: the sum`);
  await sleep(900);
  const q = (await cdp.eval("document.getElementById('pwMathQ').textContent")).split('×').map((s) => parseInt(s, 10));
  for (const d of String(q[0] * q[1])) await tap(`#pwPad [data-k="${d}"]`, 350);
  await tap('#pwPad [data-k="ok"]', 400);
}

// The app's own error screen on the unlock (pwPay) or grown-ups (pwManage) overlay, if it is showing.
const errorOn = (id) => `(() => { const o = document.getElementById('${id}'); if (!o.classList.contains('on') || !o.querySelector('[data-act=retry]')) return null;
  const t = (s) => { const e = o.querySelector(s); return e ? e.textContent.trim() : ''; };
  return { title: t('.pw-h2'), detail: t('.pw-small') }; })()`;
// Wait while the owner approves in his wallet: log when the wallet comes up and when we're back.
// Stops at once if another account connects, or the app says the request failed. A cancel in the
// wallet ("Nothing was sent") is tried once more with `again`; anything else ends the take.
let expectWallet = null;
async function walletRound(what, done, screen, again, timeoutMs = 240000) {
  const other = `(!!Wallet.publicKey && Wallet.publicKey !== ${JSON.stringify(expectWallet)})`;
  const t0 = Date.now(); let seen = false, n = 0, retried = false;
  while (Date.now() - t0 < timeoutMs) {
    if (await cdp.eval(`${other} || (${done})`).catch(() => false)) {
      if (seen) log(`${what}: back in the app ${n}`);
      const now = await cdp.eval('Wallet.publicKey');
      if (now !== expectWallet) throw new Error(`the wallet connected ${now}, not ${expectWallet}; pick that account in the wallet and re-take`);
      return;
    }
    const err = await cdp.eval(errorOn(screen)).catch(() => null);
    if (err) {
      if (err.title !== 'Cancelled' || retried) throw new Error(`${what} failed in the app: ${err.title}${err.detail ? ` (${err.detail})` : ''}`);
      retried = true; seen = false;
      log(`${what}: cancelled in the wallet; asking once more`);
      await sleep(1500);
      await again();
      continue;
    }
    const inWallet = top().includes(WALLET_PKG);
    if (inWallet && !seen) { seen = true; n++; log(`${what}: wallet on screen ${n} (approve on the phone)`); }
    if (!inWallet && seen) { log(`${what}: back in the app ${n}`); seen = false; }
    await sleep(500);
  }
  throw new Error(`timed out waiting for ${what}`);
}
// Wait for something on an overlay, but not past the app's own error screen.
async function waitOn(screen, cond, ms, what) {
  await cdp.waitFor(`(${cond}) || !!(${errorOn(screen)})`, ms, what);
  const err = await cdp.eval(errorOn(screen));
  if (err) throw new Error(`no ${what}: the app says "${err.title}"${err.detail ? ` (${err.detail})` : ''}`);
}
// The "World 2!" card follows the unlock at once, unless the chain was slow to confirm ("Sent. Almost there").
async function celebration(ms) {
  const shown = await cdp.waitFor(YAY, 6000, 'the celebration').then(() => true, () => false);
  if (!shown) log('no celebration screen');
  await sleep(ms);
}
// Dry run only: make the mock wallet's next answer a cancel or a failure (DRY_NEXT=stake:cancel).
async function dryNext(op) {
  const [o, outcome] = (process.env.DRY_NEXT || '').split(':');
  if (dev && o === op) await cdp.eval(`PayMock.next(${JSON.stringify(op)}, ${JSON.stringify(outcome)}), true`);
}

async function toWorld2() {
  await toTitle(); await sleep(800);
  await tap('#playBtn', 1500);
  if (!(await cdp.eval("document.getElementById('worldName').textContent.includes('2')"))) await tap('#pgNext', 1500);
}

// One new game, played for real: Sea Jigsaw's first easy puzzle (4 pieces), dragged home piece by
// piece, then the key and the treasure chest. No wallet, no tilt. It never ends the take: on any
// trouble it logs why and goes back to the title.
async function seaJigsaw() {
  try {
    await tap('#jigsawBtn', 300);
    await cdp.waitFor("!!window.__jigsawDebug && __jigsawDebug.state().screen === 'levels'", 15000, 'Sea Jigsaw');
    await beat('Sea Jigsaw: the puzzles');
    await sleep(1500);
    await tap('#mode-easy', 500);
    await tap('#grid .lvl[data-n="1"]', 300);
    await cdp.waitFor("__jigsawDebug.state().phase === 'play'", 5000, 'the puzzle');
    await beat('Sea Jigsaw: puzzle 1');
    await sleep(1500);
    const look = `(() => { const s = __jigsawDebug.state(), q = s.pieces.find((v) => (v.st === 'tray' || v.st === 'loose') && v.ready);
      return { playing: s.phase === 'play' && !s.done, home: s.homeCount, q: q ? [q.cx, q.cy, q.hcx, q.hcy] : null }; })()`;
    for (let drags = 0, t0 = Date.now(); drags < 12 && Date.now() - t0 < 25000;) {
      const s = await cdp.eval(look);
      if (!s.playing) break;
      if (!s.q) { await sleep(150); continue; }   // the next pieces are still hopping into the tray
      await touchSwipe(...s.q.map((v) => v * dpr), 500);
      drags++;
      await sleep(500);
    }
    if (!(await cdp.eval('__jigsawDebug.state().done'))) throw new Error('the puzzle was not finished');
    await beat('Sea Jigsaw: solved');
    await cdp.waitFor('__jigsawDebug.state().results', 9000, 'the treasure chest').catch(() => {});
    await beat('Sea Jigsaw: the chest');
    await sleep(1800);
  } catch (e) {
    log(`Sea Jigsaw: left early (${e.message.split('\n')[0]})`);
  }
  if (await inGame()) await backToHub();
  await toTitle();
}

// ---- recording ----
let recorder = null;
const RAW = () => path.join(OUT, 'isabella-ocean-seeker-raw.mp4');
function startTake() {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, dev ? 'seeker-dry.log' : 'seeker.log');
  if (!dev) {   // an earlier take stays on disk: its cut list belongs to it
    const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    for (const f of [file, RAW()]) if (fs.existsSync(f)) fs.renameSync(f, f.replace(/(\.\w+)$/, `.before-${stamp}$1`));
  }
  fs.writeFileSync(file, held.map((l) => l + '\n').join(''));
  logFile = file;
  if (!dev) {
    adb('shell', 'rm -f /sdcard/Movies/isabella-demo-*.mp4');
    adb('shell', 'touch /sdcard/Movies/isabella-rec.on');
    recorder = spawn(ADB, ['-s', SERIAL, 'shell',
      'i=0; while [ -e /sdcard/Movies/isabella-rec.on ]; do screenrecord --bit-rate 10000000 --time-limit 170 /sdcard/Movies/isabella-demo-$i.mp4; i=$((i+1)); done']);
  }
  rec0 = Date.now();
}
async function stopRecording() {
  adb('shell', 'rm -f /sdcard/Movies/isabella-rec.on');
  adb('shell', 'pkill -INT screenrecord');
  await new Promise((res) => { recorder.on('exit', res); setTimeout(res, 8000); });
  await sleep(1000);
  const parts = adb('shell', 'ls /sdcard/Movies/').stdout.split(/\s+/).filter((f) => /^isabella-demo-\d+\.mp4$/.test(f))
    .sort((a, b) => parseInt(a.slice(14), 10) - parseInt(b.slice(14), 10));
  const local = parts.map((f) => { const p = path.join(OUT, `seeker-${f}`); adb('pull', `/sdcard/Movies/${f}`, p); return p; });
  adb('shell', 'rm -f /sdcard/Movies/isabella-demo-*.mp4');   // leave his phone as we found it
  fs.writeFileSync(path.join(OUT, 'seeker-parts.txt'), local.map((p) => `file '${p}'`).join('\n'));
  const out = RAW();
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'seeker-parts.txt'),
    '-vf', 'fps=30,scale=-2:1080', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr}`);
  for (const p of local) fs.unlinkSync(p);
  return out;
}

// ---- before the camera rolls ----
// Has this account already unlocked World 2 on chain? Asked through the app's own read-only checks
// (a purchase by its reference key; pool tokens), so an account that would spoil the take is caught
// even when the wallet only connects on camera.
const chainCheck = (address) => `(async () => {
  const E = window.IsabellaEntitlement, a = ${JSON.stringify(address)};
  if (!E || typeof E.findPurchase !== 'function' || typeof E.poolTokenBalance !== 'function') return { missing: true };
  const [bought, pool] = await Promise.all([E.findPurchase(a), E.poolTokenBalance(a)]);
  return { bought: bought ? bought.signature : null, pool: pool ? pool.ui : 0, threshold: +IsabellaConfig.stake.unlockThreshold };
})()`;
async function checkAccount() {
  let r = null, why = '';
  for (let i = 0; i < 3 && !r; i++) { try { r = await cdp.eval(chainCheck(expectWallet)); } catch (e) { why = e.message.split('\n')[0]; await sleep(2000); } }
  if (!r) throw new Error(`could not check ${expectWallet} on chain (${why}); is the phone online?`);
  if (r.missing) { if (dev) { log('dry run: no chain to ask (mock payments)'); return; } throw new Error('this build of the app has no purchase check; install the current store build'); }
  if (r.bought) throw new Error(`${expectWallet} has already bought World 2 (${r.bought}); a purchase is permanent, so use an account that never bought`);
  if (r.pool >= r.threshold) throw new Error(`${expectWallet} already holds ${r.pool} pool tokens (a stake); get that SOL back first, or use another account`);
  log(`on chain: ${expectWallet} has no purchase and ${r.pool} pool tokens`);
}
const SAVE = `(() => { try { const s = JSON.parse((window.IsabellaStore ? IsabellaStore.get('isabella.save') : localStorage.getItem('isabella.save')) || 'null') || {};
  const stars = s.stars || []; return { save: s, unlocked: Math.max(s.unlocked || 1, stars.reduce((m, st, i) => (st > 0 ? i + 2 : m), 1)) }; } catch (e) { return { save: {}, unlocked: 1 }; } })()`;
async function checkSave() {
  let s = await cdp.eval(SAVE);
  if (s.unlocked < 11 && PRESET_SAVE) {
    const stars = [3, 3, 2, 3, 1, 2, 3, 3, 2, 1].map((v, i) => Math.max(v, (s.save.stars || [])[i] || 0));
    const save = JSON.stringify(Object.assign({ gold: 420 }, s.save, { unlocked: 11, stars, played: true }));
    await cdp.eval(`(() => { const v = ${JSON.stringify(save)}; if (window.IsabellaStore) IsabellaStore.set('isabella.save', v); else localStorage.setItem('isabella.save', v); return true; })()`);
    const loaded = cdp.once('Page.loadEventFired'); await cdp.eval('location.reload(), true'); await loaded;
    await hubReady();
    s = await cdp.eval(SAVE);
    log('save: set to "World 1 finished"');
  }
  if (s.unlocked < 11) throw new Error(`the save has only reached level ${s.unlocked}: level 11 would stay shut after the stake. Run again with SEEKER_PRESET_SAVE=1 (writes "World 1 finished"), or hold the Isabella logo for 4 seconds`);
}
async function openApp() {
  if (DRY) { dev = await require('./seeker-dry.js').open(); OUT = dev.out; return dev.cdp; }
  adb('shell', 'am', 'start', '-n', `${PKG}/app.isabella.mermaid.MainActivity`);
  let pid = '';
  for (let i = 0; i < 40 && !pid; i++) { await sleep(250); pid = adb('shell', 'pidof', PKG).stdout.trim(); }
  if (!pid) throw new Error('Isabella Ocean did not start');
  adb('forward', 'tcp:9333', `localabstract:webview_devtools_remote_${pid}`);
  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(250);
    try { page = (await (await fetch('http://127.0.0.1:9333/json/list')).json()).find((t) => t.type === 'page' && t.url.includes('index.html')); } catch (e) { /* not up yet */ }
  }
  if (!page) throw new Error('no DevTools page on :9333');
  const c = await connect(page.webSocketDebuggerUrl);
  await c.send('Page.enable'); await c.send('Runtime.enable');
  return c;
}

async function main() {
  if (!DRY && !SERIAL) { console.error('set SEEKER_SERIAL to the phone\'s adb serial (adb devices)'); process.exit(2); }
  expectWallet = ARGS[0];
  if (!expectWallet) throw new Error('usage: node test/e2e/record-seeker.js <wallet address>');
  cdp = await openApp();
  if (await inGame()) await backToHub();   // the app was left inside a mini-game
  await hubReady();
  dpr = await cdp.eval('devicePixelRatio');
  const app = await cdp.eval("({ cluster: IsabellaConfig.cluster, price: IsabellaConfig.priceUsd, games: IsabellaHub.GAMES.map((g) => g.id), more: !!document.getElementById('moreBtn') && !document.getElementById('moreBtn').hidden, pin: document.getElementById('pinBtn').style.display !== 'none' })").catch(() => null);
  if (!app || !app.more) throw new Error('this is an older Isabella Ocean (no "+" on the title); install version 2.5 first');
  if (app.cluster !== 'devnet') throw new Error(`the app is on ${app.cluster}; this recorder is for devnet only`);
  const version = dev ? 'dry run' : (adb('shell', 'dumpsys', 'package', PKG).stdout.match(/versionName=(\S+)/) || [])[1] || 'unknown';
  log(`app: version ${version}; ${app.games.length + 1} games; pay once US$${app.price}; ${Math.round(await cdp.eval('innerWidth'))}×${Math.round(await cdp.eval('innerHeight'))} at ×${+dpr.toFixed(2)}`);
  const miniGame = MINIGAME && app.games.includes('jigsaw');
  if (MINIGAME && !miniGame) log('no Sea Jigsaw in this build: the mini-game step is left out');
  if (app.pin) log('note: "Add to Home screen" shows on the title; pin the app first if it should not be in the shot');
  // Either already connected to the expected wallet, or not connected at all: then the wallet
  // connects on camera when Stake is tapped, and we check it was the expected account.
  const pk = await cdp.eval('Wallet.publicKey');
  if (pk && pk !== expectWallet) throw new Error(`the app is connected to ${pk}, expected ${expectWallet}`);
  if (await cdp.eval(worldOpen)) throw new Error('World 2 is already open');
  await checkAccount();
  if (!dev) {
    const bal = await (await fetch('https://api.devnet.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [expectWallet, { commitment: 'confirmed' }] }) })).json();
    const sol = (bal.result && bal.result.value || 0) / 1e9;
    if (sol < 1.15) throw new Error(`${expectWallet} holds ${sol} devnet SOL; it needs at least 1.15`);
    log(`wallet ${expectWallet}: ${sol} devnet SOL; ${pk ? 'already connected' : 'it connects on camera'}`);
  }
  await checkSave();
  await toTitle(); await sleep(1500);

  startTake();
  await sleep(1500);
  await beat('title');
  await sleep(2500);

  // nine games: three on the title, six behind "+"
  await tap('#moreBtn', 500);
  await cdp.waitFor("__dbg.mode === 'more'", 3000, 'the more-games screen');
  await beat('more games');
  await sleep(3000);
  if (miniGame) await seaJigsaw(); else await tap('#moreBack', 500);
  await cdp.waitFor("__dbg.mode === 'title'", 5000, 'the title screen');
  await beat('title again');
  await sleep(1200);

  await tap('#playBtn', 1500);
  if (await cdp.eval("document.getElementById('worldName').textContent.includes('2')")) await tap('#pgPrev', 300);
  await beat('World 1 (free)');
  await sleep(1800);
  await tap('#pgNext', 300);
  await beat('World 2 (locked)');
  await sleep(1500);
  await tapUntil('#grid .lvl:nth-child(1)', ASK, 'ask-a-grown-up screen');
  await beat('ask a grown-up');
  await sleep(1500);
  await tap('#pwAskGo', 300);
  await gate(1);
  await cdp.waitFor("!!document.querySelector('#pwPay [data-act=stake]')", 30000, 'the stake option');
  await beat('the unlock screen');
  await sleep(4000);

  await dryNext('stake');
  await tap('#pwPay [data-act=stake]', 300);
  log('tapped Stake 1 SOL');
  await walletRound('stake', worldOpen, 'pwPay', () => tap('#pwPay [data-act=retry]', 300));
  await beat('staked: World 2 is open');
  await celebration(3500);

  if (await cdp.eval(YAY)) await tap('#pwYayGo', 1500);
  if (await cdp.eval('Paywall.isOpen()') || (await mode()) !== 'levels') await toWorld2();
  await tap('#grid .lvl:nth-child(1)', 1500);
  for (let i = 0; i < 40 && !['play', 'intro'].includes(await mode()); i++) await sleep(250);
  if (!['play', 'intro'].includes(await mode())) throw new Error('level 11 did not start');
  await beat('level 11');
  const H = (await cdp.eval('innerHeight')) * dpr, W = (await cdp.eval('innerWidth')) * dpr;
  const sx = W * 0.22;
  await sleep(2500);
  for (const [y1, y2] of [[0.5, 0.3], [0.3, 0.62], [0.62, 0.45], [0.45, 0.7]]) await touchSwipe(sx, H * y1, sx + 40, H * y2, 1800);
  await sleep(800);
  await beat('swam for a bit');

  await toTitle(); await sleep(1200);
  await beat('title (after level 11)');
  await tap('#parentBtn', 300);
  await gate(2);
  await cdp.waitFor(on('pwManage'), 5000, 'the grown-ups screen');
  log('grown-ups: checking');
  await waitOn('pwManage', "!!document.querySelector('#pwManage [data-act=exitNow]')", 60000, 'exit buttons');
  await beat('grown-ups: Staked');
  await sleep(3000);
  await tap('#pwManage [data-act=exitNow]', 300);
  await cdp.waitFor(on('pwConfirm'), 5000, 'the confirm dialog');
  await beat('confirm: get my SOL back now?');
  await sleep(2200);
  await dryNext('exitInstant');
  await tap('#pwCfYes', 300);
  log('confirmed: get my SOL back now');
  await walletRound('exit', `!${worldOpen} && !IsabellaEntitlement.status().unlocked`, 'pwManage', async () => {
    await tap('#pwManage [data-act=retry]', 300);
    await cdp.waitFor(on('pwConfirm'), 5000, 'the confirm dialog');
    await tap('#pwCfYes', 300);
  });
  log('exit sent: World 2 locked');
  await waitOn('pwManage', "!!document.querySelector('#pwManage [data-act=ok]')", 120000, 'end of the exit');
  await beat('SOL back: World 2 locked again');
  await sleep(3000);
  await tap('#pwManage [data-act=ok]', 300);
  // back on the grown-ups screen's main view: "Not unlocked", with an "Unlock World 2" button
  const main = await cdp.waitFor("!!document.querySelector('#pwManage [data-act=unlock]')", 20000, 'the grown-ups screen').then(() => true, () => false);
  if (main) { await beat('grown-ups: Not unlocked'); await sleep(1500); }

  if (QUICK_RELOCK && main) {
    await tap('#pwManage [data-act=unlock]', 300);
  } else {
    if (main) await tap('#pwManage [data-act=close]', 500);
    await toWorld2();
    await beat('World 2: padlocks again');
    await sleep(1500);
    await tapUntil('#grid .lvl:nth-child(1)', ASK, 'ask-a-grown-up screen');
    await beat('ask a grown-up again');
    await sleep(1000);
    await tap('#pwAskGo', 300);
    await gate(3);
  }
  await cdp.waitFor("!!document.querySelector('#pwPay [data-act=buy]')", 30000, 'the pay option');
  await beat('the unlock screen again');
  await sleep(2500);
  await tap('#pwPay [data-act=buy]', 300);
  log('tapped Pay once');
  await waitOn('pwPay', "!!document.querySelector('#pwPay [data-act=pick]')", 60000, 'token list');
  await beat('choose a token');
  await sleep(2500);
  // devnet: pay with SOL (0.1). Never tap a greyed-out token: nothing would happen.
  const pick = await cdp.eval("(() => { const b = [...document.querySelectorAll('#pwPay [data-act=pick]')].find((x) => !x.disabled && /\\bSOL\\b/.test(x.textContent)); return b ? b.dataset.i : null; })()");
  if (pick == null) throw new Error('SOL cannot pay here (not enough in the wallet?)');
  await dryNext('buy');
  await tap(`#pwPay [data-act=pick][data-i="${pick}"]`, 300);
  log('picked a token');
  await walletRound('buy', worldOpen, 'pwPay', () => tap('#pwPay [data-act=retry]', 300));
  await beat('paid once: World 2 is open for good');
  await celebration(5000);
  await beat('end');

  if (dev) {
    const bad = dev.exceptions.length || repeats;
    console.log(`\ndry run ${bad ? 'FAILED' : 'passed'}: ${dev.exceptions.length} page exceptions, ${repeats} repeated log lines\nlog: ${logFile}\nscreenshots: ${path.join(OUT, 'shots')}`);
    for (const e of dev.exceptions) console.log(`  exception: ${e.split('\n')[0]}`);
    await dev.close();
    process.exit(bad ? 1 : 0);
  }
  const out = await stopRecording();
  console.log(`\nraw video: ${out}\nlog: ${logFile}`);
  cdp.ws.close();
  process.exit(0);
}

if (require.main === module) {
  main().catch(async (e) => {
    console.error(`${DRY ? 'DRY RUN' : 'RECORDING'} FAILED:`, e.message);
    if (rec0) log(`FAILED: ${e.message.split('\n')[0]}`);
    if (recorder) { try { console.error('partial video:', await stopRecording()); } catch (e2) { console.error(e2.message); } }
    if (dev) { try { await dev.shot('failed'); await dev.close(); } catch (e2) { /* gone */ } }
    process.exit(1);
  });
}
module.exports = { chainCheck };
