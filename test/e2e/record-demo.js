// Records the backup demo video on the Android emulator, as a parent would see it: the real store
// app, Solana Mobile's fakewallet and the studio's devnet stake pool, driven with real Android
// touches (shown as dots) at a pace a viewer can follow.
//   World 1 is free → World 2 is locked → stake 1 SOL → it opens → play → get the SOL back
//   instantly → it locks → pay once → it opens.
// Needs: emulator-5554 (ro.boot.qemu=1) with the store debug build and a fakewallet whose devnet
// wallet has ≥1.2 SOL and has never bought World 2. Never touches a real phone.
// Run: node test/e2e/record-demo.js   → .local/demo/isabella-ocean-emulator.mp4
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { connect, sleep } = require('../paywall/cdp.js');

const ADB = path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb');
const SERIAL = 'emulator-5554';
const PKG = 'app.isabella.mermaid.seeker';
const OUT = path.join(__dirname, '../../.local/demo');
const adb = (...a) => spawnSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8' });
let rec0 = 0;   // when the recording started: log lines carry their time in the video
const log = (s) => console.log(`${new Date().toISOString().slice(11, 19)}${rec0 ? ` [video ${((Date.now() - rec0) / 1000).toFixed(1)}s]` : ''}  ${s}`);
fs.mkdirSync(OUT, { recursive: true });

let cdp, dpr = 1;
// Real touches: CSS pixels in the WebView → device pixels (the game runs full screen).
async function at(selector) {
  const { x, y } = await cdp.center(selector);
  return [Math.round(x * dpr), Math.round(y * dpr)];
}
async function tap(selector, pause = 900) {
  const [x, y] = await at(selector);
  adb('shell', 'input', 'tap', String(x), String(y));
  await sleep(pause);
}
// Tap until the app shows the expected result (a tap during a page slide can miss).
async function tapUntil(selector, cond, what, tries = 3) {
  for (let i = 0; i < tries; i++) {
    await tap(selector, 400);
    try { await cdp.waitFor(cond, 4000, what); return; } catch (e) { log(`no ${what} yet; tapping ${selector} again`); }
  }
  throw new Error(`no ${what} after ${tries} taps on ${selector}`);
}
const ASK = "document.getElementById('pwAsk').classList.contains('on')";
async function hold(selector, ms) {
  const [x, y] = await at(selector);
  adb('shell', 'input', 'swipe', String(x), String(y), String(x), String(y), String(ms));
}

// Show the wallet screen for a moment, then tap its button, until `done()` is true in the app.
const WALLET_BUTTONS = ['AUTHORIZE', 'SEND TRANSACTION TO CLUSTER'];
async function approveUntil(done, what, timeoutMs = 150000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await cdp.eval(done).catch(() => false)) return;
    const xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty').stdout || '';
    for (const label of WALLET_BUTTONS) {
      const m = xml.match(new RegExp(`text="${label}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
      if (m) {
        const [x1, y1, x2, y2] = m.slice(1).map(Number);
        log(`wallet (${what}): ${label} on screen`);
        await sleep(2200);   // let the viewer read the wallet's request
        adb('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1));
        log(`wallet (${what}): tapped ${label}`);
        await sleep(1500);
        break;
      }
    }
    await sleep(600);
  }
  throw new Error(`timed out waiting for ${what}`);
}

async function gate() {
  await cdp.waitFor("document.getElementById('pwGate').classList.contains('on')", 5000, 'the parent gate');
  await sleep(1200);
  await hold('#pwHoldBtn', 3400);
  await cdp.waitFor("!document.getElementById('pwMathStage').hidden", 4000, 'the sum');
  await sleep(1200);
  const q = (await cdp.eval("document.getElementById('pwMathQ').textContent")).split('×').map((s) => parseInt(s, 10));
  for (const d of String(q[0] * q[1])) await tap(`#pwPad [data-k="${d}"]`, 500);
  await tap('#pwPad [data-k="ok"]', 600);
}
const mode = () => cdp.eval('__dbg.mode');
// Out of a level the way a player leaves it (pause, then home); back steps out of everything else.
async function toTitle() {
  for (let i = 0; i < 10; i++) {
    const m = await mode();
    if (m === 'title') return;
    if (m === 'play') await tap('#pauseBtn', 1000);
    else if (m === 'paused') await tap('#pauseHome', 1200);
    else { await cdp.eval('window.__back()'); await sleep(400); }
  }
}
async function toWorld2() {
  await toTitle(); await sleep(1200);
  await tap('#playBtn', 1800);
  if (!(await cdp.eval("document.getElementById('worldName').textContent.includes('2')"))) await tap('#pgNext', 2200);
}
async function openPaywall() {
  await toWorld2();
  await tapUntil('#grid .lvl:nth-child(1)', ASK, 'ask-a-grown-up screen');   // Level 11 is locked
  await sleep(1600);
  await tap('#pwAskGo', 500);
  await gate();
  await cdp.waitFor("document.getElementById('pwPay').classList.contains('on')", 5000, 'the unlock screen');
}
const worldOpen = 'Paywall.worldOpen()';
// The wallet checks the app's identity file within 3 s from its own process. Look the site up
// first, so the emulator's shared DNS cache already holds it.
const warmDns = () => cdp.eval(`fetch('https://isabellaocean-app.pages.dev/.well-known/assetlinks.json?w=' + Date.now(), { mode: 'no-cors', cache: 'no-store' }).then(() => true, () => false)`);
// The coins-and-confetti screen comes a few seconds after the unlock lands ("Checking with Solana").
const YAY = "document.getElementById('pwYay').classList.contains('on')";
async function celebration(ms) {
  await cdp.waitFor(YAY, 45000, 'the celebration').catch(() => log('no celebration screen'));
  await sleep(ms);
}

// The screen recorder: back-to-back segments on the device (each one is capped at 3 minutes).
let recorder = null;
function startRecording() {
  adb('shell', 'rm', '-f', '/sdcard/demo-*.mp4');
  adb('shell', 'touch', '/sdcard/rec.on');
  recorder = spawn(ADB, ['-s', SERIAL, 'shell',
    'i=0; while [ -e /sdcard/rec.on ]; do screenrecord --bit-rate 8000000 --time-limit 170 /sdcard/demo-$i.mp4; i=$((i+1)); done']);
}
async function stopRecording() {
  adb('shell', 'rm', '-f', '/sdcard/rec.on');
  adb('shell', 'pkill', '-INT', 'screenrecord');
  await new Promise((res) => { recorder.on('exit', res); setTimeout(res, 8000); });
  await sleep(1000);
  const parts = adb('shell', 'ls', '/sdcard/').stdout.split(/\s+/).filter((f) => /^demo-\d+\.mp4$/.test(f))
    .sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10));
  const local = parts.map((f) => { const p = path.join(OUT, f); adb('pull', `/sdcard/${f}`, p); return p; });
  fs.writeFileSync(path.join(OUT, 'parts.txt'), local.map((p) => `file '${p}'`).join('\n'));
  const out = path.join(OUT, 'isabella-ocean-emulator.mp4');
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'parts.txt'),
    '-vf', 'fps=30,scale=-2:1080', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-movflags', '+faststart', out], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr}`);
  for (const p of local) fs.unlinkSync(p);
  return out;
}

(async () => {
  if (adb('shell', 'getprop', 'ro.boot.qemu').stdout.trim() !== '1') throw new Error(`${SERIAL} is not an emulator; refusing`);
  const expectWallet = process.argv[2] || null;

  // A brand-new install: no save, no wallet, no cached unlock.
  adb('shell', 'settings', 'put', 'system', 'show_touches', '1');
  adb('shell', 'pm', 'clear', PKG);
  adb('shell', 'am', 'start', '-n', `${PKG}/app.isabella.mermaid.MainActivity`);
  let pid = '';
  for (let i = 0; i < 40 && !pid; i++) { await sleep(250); pid = adb('shell', 'pidof', PKG).stdout.trim(); }
  if (!pid) throw new Error('the app did not start');
  adb('forward', 'tcp:9460', `localabstract:webview_devtools_remote_${pid}`);
  let page = null;
  for (let i = 0; i < 40 && !page; i++) {
    await sleep(250);
    try { page = (await (await fetch('http://127.0.0.1:9460/json/list')).json()).find((t) => t.type === 'page' && t.url.includes('index.html')); } catch (e) { /* not up yet */ }
  }
  if (!page) throw new Error('no DevTools page on :9460');
  cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
  await cdp.waitFor('!!(window.Paywall && window.__dbg)', 15000, 'the app to start');

  // The demo family has finished World 1 (the free part).
  await cdp.eval(`(() => {
    const save = { unlocked: 11, stars: Array(20).fill(0).map((s, i) => (i < 10 ? 2 + (i % 2) : 0)), gold: 140, muted: true, played: true };
    IsabellaStore.set('isabella.save', JSON.stringify(save));
    return true; })()`);
  const loaded = cdp.once('Page.loadEventFired'); await cdp.eval('location.reload(), true'); await loaded;
  await cdp.waitFor('!!(window.Paywall && window.__dbg)', 15000, 'the app to restart');
  await cdp.eval('Paywall.ready.then(() => true)');
  dpr = await cdp.eval('devicePixelRatio');
  if (await cdp.eval(worldOpen)) throw new Error('World 2 is already open for this wallet; use a fresh fakewallet key');
  await sleep(1500);

  startRecording();
  rec0 = Date.now();
  await sleep(2500);
  log('title: the three games');
  await sleep(2500);

  // 1. World 1 is free; World 2 is locked.
  await tap('#playBtn', 2000);
  // The map opens on the next level to play (World 2 here): show the free world first.
  if (await cdp.eval("document.getElementById('worldName').textContent.includes('2')")) await tap('#pgPrev', 2500);
  log('World 1 (free)');
  await tap('#pgNext', 2500);
  log('World 2 (locked)');
  await tapUntil('#grid .lvl:nth-child(1)', ASK, 'ask-a-grown-up screen');
  await sleep(2000);
  await tap('#pwAskGo', 500);
  await gate();
  await cdp.waitFor("!!document.querySelector('#pwPay [data-act=stake]')", 30000, 'the stake option');
  log('the unlock screen');
  await sleep(5000);

  // 2. Stake 1 SOL.
  await warmDns();
  await tap('#pwPay [data-act=stake]', 300);
  log('tapped Stake 1 SOL');
  await approveUntil(worldOpen, 'stake');
  if (expectWallet) { const pk = await cdp.eval('Wallet.publicKey'); if (pk !== expectWallet) throw new Error(`connected ${pk}, expected ${expectWallet}`); }
  log('staked: World 2 is open');
  await celebration(4500);

  // 3. Play Level 11 for a few seconds.
  if (await cdp.eval(YAY)) await tap('#pwYayGo', 1500);
  if ((await mode()) !== 'levels') await toWorld2();
  await tap('#grid .lvl:nth-child(1)', 2500);
  for (let i = 0; i < 40 && !['play', 'intro'].includes(await mode()); i++) await sleep(250);
  log(`level 11 (${await mode()})`);
  const H = Math.round((await cdp.eval('innerHeight')) * dpr), Wd = Math.round((await cdp.eval('innerWidth')) * dpr);
  const sx = Math.round(Wd * 0.22);
  await sleep(2500);   // the level's intro
  for (const [y1, y2] of [[0.5, 0.3], [0.3, 0.62], [0.62, 0.45], [0.45, 0.7], [0.7, 0.4]]) {
    adb('shell', 'input', 'swipe', String(sx), String(Math.round(H * y1)), String(sx + 40), String(Math.round(H * y2)), '1800');
  }
  await sleep(800);
  log('swam for a bit');

  // 4. Grown-ups: get the SOL back now. World 2 locks again.
  await toTitle(); await sleep(1500);
  log('title');
  await tap('#parentBtn', 500);
  await gate();
  await cdp.waitFor("document.getElementById('pwManage').classList.contains('on')", 5000, 'the grown-ups screen');
  log('grown-ups: checking');
  await cdp.waitFor("!!document.querySelector('#pwManage [data-act=exitNow]')", 45000, 'the exit buttons');
  log('grown-ups: Staked');
  await sleep(4000);
  await tap('#pwManage [data-act=exitNow]', 2500);
  await cdp.waitFor("document.getElementById('pwConfirm').classList.contains('on')", 5000, 'the confirm dialog');
  await warmDns();
  await tap('#pwCfYes', 300);
  log('confirmed: get my SOL back now');
  await approveUntil(`!${worldOpen} && !IsabellaEntitlement.status().unlocked`, 'exit');
  log('exit sent: World 2 locked');
  // The grown-ups screen finishes by itself once Solana confirms: "Your SOL is back".
  await cdp.waitFor("!!document.querySelector('#pwManage [data-act=ok]')", 90000, 'the exit to finish');
  log('SOL back: World 2 locked again');
  await sleep(4500);
  await tap('#pwManage [data-act=ok]', 1500);

  // 5. Pay once instead (devnet: 0.1 SOL to the merchant).
  await cdp.eval("['pwManage','pwPay','pwAsk'].forEach((id) => { const o = document.getElementById(id); if (o.classList.contains('on')) window.__back(); }), true");
  await sleep(800);
  await openPaywall();
  await cdp.waitFor("!!document.querySelector('#pwPay [data-act=buy]')", 30000, 'the pay option');
  log('the unlock screen again');
  await sleep(2500);
  await tap('#pwPay [data-act=buy]', 300);
  log('tapped Pay once');
  await cdp.waitFor("!!document.querySelector('#pwPay [data-act=pick]')", 60000, 'the token list');
  log('choose a token');
  await sleep(3500);
  await warmDns();
  await tap('#pwPay [data-act=pick][data-i="0"]', 300);
  log('picked a token');
  await approveUntil(worldOpen, 'buy');
  log('paid once: World 2 is open for good');
  await celebration(6000);

  const out = await stopRecording();
  adb('shell', 'settings', 'put', 'system', 'show_touches', '0');
  const wallet = await cdp.eval('Wallet.publicKey');
  const sigs = await (await fetch('https://api.devnet.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [wallet, { limit: 4 }] }) })).json();
  console.log(`\nwallet ${wallet}; its latest devnet transactions:`);
  for (const s of sigs.result || []) console.log(`  https://explorer.solana.com/tx/${s.signature}?cluster=devnet ${s.err ? 'ERR' : 'ok'}`);
  console.log(errors.length ? `JavaScript exceptions: ${errors.join(' | ')}` : 'no JavaScript exceptions');
  console.log(`\nvideo: ${out}`);
  cdp.ws.close();
  process.exit(0);
})().catch(async (e) => {
  console.error('DEMO FAILED:', e.message);
  if (recorder) { try { console.error('partial video:', await stopRecording()); } catch (e2) { console.error(e2.message); } }
  adb('shell', 'settings', 'put', 'system', 'show_touches', '0');
  process.exit(1);
});
