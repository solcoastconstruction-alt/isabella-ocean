// Records the demo on the owner's REAL Seeker (CLOCK IN needs real-device footage). The phone's
// owner approves every wallet request himself: this script never touches the wallet. It only taps
// through Isabella Ocean (the store app) and records the screen.
//   World 1 → World 2 locked → parent gate → Stake 1 SOL → (he approves) → World 2 opens → a little
//   play → Grown-ups → Get my SOL back now → (he approves) → locked → Pay once → (he approves) → open.
// Needs: the Seeker on USB, Isabella Ocean connected to a devnet wallet that has never bought World 2
// and holds ≥1.15 devnet SOL, and the app's save set to "World 1 finished".
// Run: SEEKER_SERIAL=<adb serial> node test/e2e/record-seeker.js <wallet address>
//   → .local/demo/isabella-ocean-seeker-raw.mp4 + .local/demo/seeker.log (for edit-demo.js)
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { connect, sleep } = require('../paywall/cdp.js');

const ADB = path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb');
const SERIAL = process.env.SEEKER_SERIAL;   // the phone's adb serial (kept out of the repo)
if (!SERIAL) { console.error('set SEEKER_SERIAL to the phone\'s adb serial (adb devices)'); process.exit(2); }
const PKG = 'app.isabella.mermaid.seeker';   // the store app only, never her app
const WALLET_PKG = 'com.solanamobile.wallet';
const OUT = path.join(__dirname, '../../.local/demo');
const adb = (...a) => spawnSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8' });
fs.mkdirSync(OUT, { recursive: true });
const logFile = path.join(OUT, 'seeker.log');
fs.writeFileSync(logFile, '');
let rec0 = 0;
const log = (s) => { const line = `${new Date().toISOString().slice(11, 19)}${rec0 ? ` [video ${((Date.now() - rec0) / 1000).toFixed(1)}s]` : ''}  ${s}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };

let cdp, dpr = 1;
async function at(selector) { const { x, y } = await cdp.center(selector); return [Math.round(x * dpr), Math.round(y * dpr)]; }
async function tap(selector, pause = 900) { const [x, y] = await at(selector); adb('shell', 'input', 'tap', String(x), String(y)); await sleep(pause); }
async function hold(selector, ms) { const [x, y] = await at(selector); adb('shell', 'input', 'swipe', String(x), String(y), String(x), String(y), String(ms)); }
async function tapUntil(selector, cond, what, tries = 3) {
  for (let i = 0; i < tries; i++) {
    await tap(selector, 400);
    try { await cdp.waitFor(cond, 4000, what); return; } catch (e) { log(`no ${what} yet; tapping ${selector} again`); }
  }
  throw new Error(`no ${what} after ${tries} taps on ${selector}`);
}
const top = () => adb('shell', 'dumpsys activity activities').stdout.split('\n').find((l) => l.includes('topResumedActivity')) || '';

// Wait while the owner approves in his wallet: log when the wallet comes up and when we're back.
async function walletRound(what, done, timeoutMs = 240000) {
  const t0 = Date.now(); let seen = false;
  while (Date.now() - t0 < timeoutMs) {
    if (await cdp.eval(done).catch(() => false)) { if (seen) log(`${what}: back in the app`); return; }
    const inWallet = top().includes(WALLET_PKG);
    if (inWallet && !seen) { seen = true; log(`${what}: wallet on screen (approve on the phone)`); }
    if (!inWallet && seen) { log(`${what}: back in the app`); seen = false; }
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
async function toTitle() {
  for (let i = 0; i < 10; i++) {
    const m = await mode();
    if (m === 'title') return;
    if (m === 'play') await tap('#pauseBtn', 1000);
    else if (m === 'paused') await tap('#pauseHome', 1200);
    else { await cdp.eval('window.__back()'); await sleep(400); }
  }
}
const ASK = "document.getElementById('pwAsk').classList.contains('on')";
const YAY = "document.getElementById('pwYay').classList.contains('on')";
const worldOpen = 'Paywall.worldOpen()';
async function toWorld2() {
  await toTitle(); await sleep(1200);
  await tap('#playBtn', 1800);
  if (!(await cdp.eval("document.getElementById('worldName').textContent.includes('2')"))) await tap('#pgNext', 2200);
}
async function openPaywall() {
  await toWorld2();
  await tapUntil('#grid .lvl:nth-child(1)', ASK, 'ask-a-grown-up screen');
  await sleep(1600);
  await tap('#pwAskGo', 500);
  await gate();
  await cdp.waitFor("document.getElementById('pwPay').classList.contains('on')", 5000, 'the unlock screen');
}
async function celebration(ms) { await cdp.waitFor(YAY, 60000, 'the celebration').catch(() => log('no celebration screen')); await sleep(ms); }

let recorder = null;
function startRecording() {
  adb('shell', 'rm -f /sdcard/Movies/isabella-demo-*.mp4');
  adb('shell', 'touch /sdcard/Movies/isabella-rec.on');
  recorder = spawn(ADB, ['-s', SERIAL, 'shell',
    'i=0; while [ -e /sdcard/Movies/isabella-rec.on ]; do screenrecord --bit-rate 10000000 --time-limit 170 /sdcard/Movies/isabella-demo-$i.mp4; i=$((i+1)); done']);
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
  const out = path.join(OUT, 'isabella-ocean-seeker-raw.mp4');
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'seeker-parts.txt'),
    '-vf', 'fps=30,scale=-2:1080', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', out], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(`ffmpeg failed: ${ff.stderr}`);
  for (const p of local) fs.unlinkSync(p);
  return out;
}

(async () => {
  const expectWallet = process.argv[2];
  if (!expectWallet) throw new Error('usage: node test/e2e/record-seeker.js <wallet address>');
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
  cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.waitFor('!!(window.Paywall && window.__dbg)', 15000, 'the app');
  await cdp.eval('Paywall.ready.then(() => true)');
  dpr = await cdp.eval('devicePixelRatio');
  // Either already connected to the expected wallet, or not connected at all: then the wallet
  // connects on camera when Stake is tapped, and we check it was the expected account.
  const pk = await cdp.eval('Wallet.publicKey');
  if (pk && pk !== expectWallet) throw new Error(`the app is connected to ${pk}, expected ${expectWallet}`);
  if (await cdp.eval(worldOpen)) throw new Error('World 2 is already open');
  const bal = await (await fetch('https://api.devnet.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [expectWallet, { commitment: 'confirmed' }] }) })).json();
  const sol = (bal.result && bal.result.value || 0) / 1e9;
  if (sol < 1.15) throw new Error(`${expectWallet} holds ${sol} devnet SOL; it needs at least 1.15`);
  log(`wallet ${expectWallet}: ${sol} devnet SOL; ${pk ? 'already connected' : 'it connects on camera'}`);
  await toTitle(); await sleep(1500);

  startRecording();
  rec0 = Date.now();
  await sleep(2500);
  log('title: four games');
  await sleep(2000);

  await tap('#playBtn', 2000);
  if (await cdp.eval("document.getElementById('worldName').textContent.includes('2')")) await tap('#pgPrev', 2500);
  log('World 1 (free)');
  await tap('#pgNext', 2500);
  log('World 2 (locked)');
  await tapUntil('#grid .lvl:nth-child(1)', ASK, 'ask-a-grown-up screen');
  await sleep(1800);
  await tap('#pwAskGo', 500);
  await gate();
  await cdp.waitFor("!!document.querySelector('#pwPay [data-act=stake]')", 30000, 'the stake option');
  log('the unlock screen');
  await sleep(5000);

  await tap('#pwPay [data-act=stake]', 300);
  log('tapped Stake 1 SOL');
  await walletRound('stake', `${worldOpen} || (Wallet.publicKey && Wallet.publicKey !== ${JSON.stringify(expectWallet)})`);
  const now = await cdp.eval('Wallet.publicKey');
  if (now !== expectWallet) throw new Error(`the wallet connected ${now}, not ${expectWallet}; pick that account in the wallet and re-take`);
  log('staked: World 2 is open');
  await celebration(4500);

  if (await cdp.eval(YAY)) await tap('#pwYayGo', 1500);
  if ((await mode()) !== 'levels') await toWorld2();
  await tap('#grid .lvl:nth-child(1)', 2500);
  for (let i = 0; i < 40 && !['play', 'intro'].includes(await mode()); i++) await sleep(250);
  log('level 11');
  const H = Math.round((await cdp.eval('innerHeight')) * dpr), W = Math.round((await cdp.eval('innerWidth')) * dpr);
  const sx = Math.round(W * 0.22);
  await sleep(2500);
  for (const [y1, y2] of [[0.5, 0.3], [0.3, 0.62], [0.62, 0.45], [0.45, 0.7]]) {
    adb('shell', 'input', 'swipe', String(sx), String(Math.round(H * y1)), String(sx + 40), String(Math.round(H * y2)), '1800');
  }
  await sleep(800);
  log('swam for a bit');

  await toTitle(); await sleep(1500);
  log('title');
  await tap('#parentBtn', 500);
  await gate();
  await cdp.waitFor("document.getElementById('pwManage').classList.contains('on')", 5000, 'the grown-ups screen');
  log('grown-ups: checking');
  await cdp.waitFor("!!document.querySelector('#pwManage [data-act=exitNow]')", 60000, 'the exit buttons');
  log('grown-ups: Staked');
  await sleep(4000);
  await tap('#pwManage [data-act=exitNow]', 2500);
  await cdp.waitFor("document.getElementById('pwConfirm').classList.contains('on')", 5000, 'the confirm dialog');
  await tap('#pwCfYes', 300);
  log('confirmed: get my SOL back now');
  await walletRound('exit', `!${worldOpen} && !IsabellaEntitlement.status().unlocked`);
  log('exit sent: World 2 locked');
  await cdp.waitFor("!!document.querySelector('#pwManage [data-act=ok]')", 120000, 'the exit to finish');
  log('SOL back: World 2 locked again');
  await sleep(4500);
  await tap('#pwManage [data-act=ok]', 1500);

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
  await tap('#pwPay [data-act=pick][data-i="0"]', 300);
  log('picked a token');
  await walletRound('buy', worldOpen);
  log('paid once: World 2 is open for good');
  await celebration(6000);

  const out = await stopRecording();
  console.log(`\nraw video: ${out}\nlog: ${logFile}`);
  cdp.ws.close();
  process.exit(0);
})().catch(async (e) => {
  console.error('RECORDING FAILED:', e.message);
  if (recorder) { try { console.error('partial video:', await stopRecording()); } catch (e2) { console.error(e2.message); } }
  process.exit(1);
});
