// End to end on the Android emulator, as a parent would: the real store app, the real
// IsabellaWallet bridge, Solana Mobile's fakewallet, and the studio's devnet stake pool.
//   stake 1.01 SOL → World 2 opens → "Get my SOL back now" → World 2 locks → pay once → opens.
// Needs: emulator-5554 (ro.boot.qemu=1) running the store debug build with the fakewallet
// installed and funded (≥1.2 devnet SOL); the app's WebView DevTools socket forwarded to :9460.
// Never touches a real phone. Run: node test/e2e/emulator-flow.js
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { connect, sleep } = require('../paywall/cdp.js');

const ADB = path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb');
const SERIAL = 'emulator-5554';
const OUT = path.join(os.tmpdir(), 'isabella-e2e');
fs.mkdirSync(OUT, { recursive: true });
const adb = (...a) => spawnSync(ADB, ['-s', SERIAL, ...a], { encoding: 'utf8' });
let pass = 0, fail = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); ok ? pass++ : fail++; };
const shot = (name) => { const f = path.join(OUT, `${name}.png`); fs.writeFileSync(f, spawnSync(ADB, ['-s', SERIAL, 'exec-out', 'screencap', '-p']).stdout); return f; };

// Tap whichever fakewallet button is showing ("AUTHORIZE" for connect and sign, then
// "SEND TRANSACTION TO CLUSTER"), until `done()` is true in the app or time runs out.
const WALLET_BUTTONS = ['AUTHORIZE', 'SEND TRANSACTION TO CLUSTER'];
async function approveUntil(cdp, done, what, timeoutMs = 120000) {
  const t0 = Date.now(); let taps = 0;
  while (Date.now() - t0 < timeoutMs) {
    if (await cdp.eval(done).catch(() => false)) return taps;
    const xml = adb('exec-out', 'uiautomator', 'dump', '/dev/tty').stdout || '';
    for (const label of WALLET_BUTTONS) {
      const m = xml.match(new RegExp(`text="${label}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
      if (m) {
        const [x1, y1, x2, y2] = m.slice(1).map(Number);
        shot(`wallet-${what}-${++taps}`);
        adb('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1));
        console.log(`      wallet: tapped ${label}`);
        await sleep(1500);
        break;
      }
    }
    await sleep(700);
  }
  throw new Error(`timed out waiting for ${what}`);
}

(async () => {
  if (adb('shell', 'getprop', 'ro.boot.qemu').stdout.trim() !== '1') throw new Error(`${SERIAL} is not an emulator; refusing`);
  const list = await (await fetch('http://127.0.0.1:9460/json/list')).json();
  const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!page) throw new Error('the app is not open on index.html (forward the DevTools socket to :9460)');
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const errors = []; cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));

  // A clean slate: World 1 finished, no unlock cached, wallet disconnected; then reload.
  await cdp.eval(`(() => {
    const save = { unlocked: 11, stars: Array(20).fill(0).map((s, i) => (i < 10 ? 2 : 0)), gold: 100, muted: true, played: true };
    IsabellaStore.set('isabella.save', JSON.stringify(save));
    IsabellaStore.set('isabella.entitlement', '');
    try { Wallet.disconnect(); } catch (e) {}
    return true; })()`);
  const loaded = cdp.once('Page.loadEventFired'); await cdp.eval('location.reload(), true'); await loaded;
  await cdp.waitFor('!!(window.Paywall && window.__dbg)', 15000, 'the app to start');   // (Paywall.ready resolves to undefined: await it separately)
  await cdp.eval('Paywall.ready.then(() => true)');
  check(await cdp.eval("IsabellaConfig.stake.pool === 'D5k3bxRYCWizSToy7C3WzQoPBXYNAUZ78Lo2vvFR9q7a'"), 'the app points at the studio devnet pool');
  check(await cdp.eval('IsabellaWallet.available() === "true"'), 'a wallet app is installed (fakewallet)');

  const gate = async () => {
    await cdp.waitFor("document.getElementById('pwGate').classList.contains('on')", 5000, 'the parent gate');
    await cdp.hold('#pwHoldBtn', 3300);
    await cdp.waitFor("!document.getElementById('pwMathStage').hidden", 3000, 'the sum');
    const q = (await cdp.eval("document.getElementById('pwMathQ').textContent")).split('×').map((s) => parseInt(s, 10));
    for (const d of String(q[0] * q[1])) await cdp.tap(`#pwPad [data-k="${d}"]`);
    await cdp.tap('#pwPad [data-k="ok"]');
  };
  const toTitle = async () => { for (let i = 0; i < 8 && (await cdp.eval('__dbg.mode')) !== 'title'; i++) { await cdp.eval('window.__back()'); await sleep(250); } };
  const openPaywall = async () => {
    await toTitle(); await cdp.tap('#playBtn'); await sleep(400);
    if (!(await cdp.eval("document.getElementById('worldName').textContent.includes('2')"))) { await cdp.tap('#pgNext'); await sleep(300); }
    await cdp.tap('#grid .lvl:nth-child(1)'); await cdp.tap('#pwAskGo'); await gate();
    await cdp.waitFor("document.getElementById('pwPay').classList.contains('on')", 5000, 'the unlock screen');
  };
  const worldOpen = 'Paywall.worldOpen()';

  // 1. Stake 1 SOL.
  await openPaywall();
  check(!(await cdp.eval(worldOpen)), 'World 2 starts locked');
  await cdp.waitFor("!!document.querySelector('#pwPay [data-act=stake]')", 30000, 'the stake option');
  shot('1-paywall');
  await cdp.tap('#pwPay [data-act=stake]');
  await approveUntil(cdp, worldOpen, 'stake');
  check(await cdp.eval(worldOpen), 'staking 1.01 SOL opened World 2');
  const st = await cdp.eval('IsabellaEntitlement.status()');
  check(st.via === 'stake' && st.tokens >= 0.99, `entitlement: via ${st.via}, ${st.tokens} OCEAN in the wallet`);
  await sleep(1500); shot('2-unlocked');

  // 2. Get the SOL back instantly: World 2 must lock again.
  await cdp.eval("document.getElementById('pwYayGo') && document.getElementById('pwYay').classList.contains('on') && document.getElementById('pwYayGo').click(), true");
  await toTitle(); await cdp.tap('#parentBtn'); await gate();
  await cdp.waitFor("document.getElementById('pwManage').classList.contains('on')", 5000, 'the grown-ups screen');
  // The grown-ups screen checks the chain first ("Checking"), then shows its buttons.
  await cdp.waitFor("!!document.querySelector('#pwManage [data-act=exitNow]')", 45000, 'the exit buttons');
  shot('3-manage-staked');
  await cdp.tap('#pwManage [data-act=exitNow]');
  await cdp.waitFor("document.getElementById('pwConfirm').classList.contains('on')", 5000, 'the confirm dialog');
  await cdp.tap('#pwCfYes');
  await approveUntil(cdp, `!${worldOpen} && !IsabellaEntitlement.status().unlocked`, 'exit');
  check(!(await cdp.eval(worldOpen)), 'the instant exit locked World 2 again');
  await sleep(1500); shot('4-locked-again');

  // 3. Pay once instead (devnet: 0.1 SOL to the merchant, with the purchase reference).
  await cdp.eval("['pwManage','pwPay','pwAsk'].forEach((id) => { const o = document.getElementById(id); if (o.classList.contains('on')) window.__back(); }), true");
  await openPaywall();
  await cdp.waitFor("!!document.querySelector('#pwPay [data-act=buy]')", 30000, 'the pay option');
  await cdp.tap('#pwPay [data-act=buy]');
  await cdp.waitFor("!!document.querySelector('#pwPay [data-act=pick]')", 60000, 'the token list');
  shot('5-pick-token');
  await cdp.tap('#pwPay [data-act=pick][data-i="0"]');
  await approveUntil(cdp, worldOpen, 'buy');
  check(await cdp.eval(worldOpen), 'paying once opened World 2');
  check((await cdp.eval('IsabellaEntitlement.status().via')) === 'purchase', 'entitlement: via purchase');
  await sleep(1500); shot('6-bought');

  const wallet = await cdp.eval('Wallet.publicKey');
  const sigs = await (await fetch('https://api.devnet.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getSignaturesForAddress', params: [wallet, { limit: 3 }] }) })).json();
  console.log('\nwallet', wallet, '— latest transactions (newest first):');
  for (const s of sigs.result || []) console.log(`  https://explorer.solana.com/tx/${s.signature}?cluster=devnet ${s.err ? 'ERR' : 'ok'}`);
  check(errors.length === 0, `no JavaScript exceptions${errors.length ? ': ' + errors.join(' | ') : ''}`);
  console.log(`\n${pass}/${pass + fail} checks passed; screenshots in ${OUT}`);
  cdp.ws.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('E2E FAILED:', e.message); console.error(`screenshots so far in ${OUT}`); process.exit(1); });
