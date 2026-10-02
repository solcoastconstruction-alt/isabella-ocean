// End-to-end check of the free tier and the grown-ups' screens, in headless Chrome over CDP
// (Node 22+, no dependencies). Taps and holds are real mouse input at each element's centre, and a
// tap fails if anything covers the element.
//
//   node test/paywall/drive.js --out <screenshots dir> --profile <chrome profile dir> [--port 9450]
//
// Opens web/index.html?mockpay=1 (web/paymock.js stands in for the payment modules), walks every
// kid and grown-up path, asserts what each screen shows, saves a screenshot per step, then repeats
// the main screens at 1024x768. Also checks the family flavor against the app before this change
// (git revision --baseline, default afb0859). Exits 1 if any check fails.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { launch, sleep } = require('./cdp');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(__dirname, '../..');
const TMP = path.join(os.tmpdir(), 'isabella-paywall');
const OUT = path.resolve(arg('out', path.join(TMP, 'shots')));
const PROFILE = path.resolve(arg('profile', path.join(TMP, 'chrome-paywall')));
const PORT = +arg('port', 9450);
const BASELINE = arg('baseline', 'afb0859');
const PAGE = `file://${ROOT}/web/index.html`;

// A child who has finished World 1 (level 11 is next) / one who has played everything.
const WORLD1_DONE = { unlocked: 11, stars: [3, 3, 2, 3, 1, 2, 3, 3, 2, 1], gold: 420, muted: true, played: true };
const ALL_OPEN = { unlocked: 20, stars: [3, 3, 2, 3, 1, 2, 3, 3, 2, 1, 2, 1], gold: 900, muted: true, played: true };

let cdp, shotN = 0, prefix = '';
const results = [], shots = [], exceptions = [];
function check(ok, msg) { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); }
async function shot(name) {
  const file = path.join(OUT, `${String(++shotN).padStart(2, '0')}-${prefix}${name}.png`);
  await cdp.shot(file);
  shots.push(file);
}
const ev = (js) => cdp.eval(js);
const on = (id) => ev(`document.getElementById(${JSON.stringify(id)}).classList.contains('on')`);
const visible = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getClientRects().length > 0; })()`);
const text = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
const mode = () => ev('__dbg.mode');
const worldOpen = () => ev('Paywall.worldOpen()');

// Load the game fresh with a given save (and flavor) set before any of its scripts run.
async function open(query, { save = WORLD1_DONE, family = false, noPayments = false } = {}) {
  const src = `try { localStorage.setItem('isabella.save', ${JSON.stringify(JSON.stringify(save))}); } catch (e) {}` + (family ? "window.IsabellaFlavor = 'family';" : '')
    // Simulate the payment modules being absent: their scripts still run, but their globals never land.
    + (noPayments ? "['IsabellaPay','IsabellaEntitlement','Wallet'].forEach((k) => Object.defineProperty(window, k, { get() {}, set() {}, configurable: false }));" : '');
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
  await cdp.navigate(`${PAGE}${query ? `?${query}` : ''}`);
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await cdp.waitFor('window.Paywall && window.__dbg', 5000, 'the game to start');
  await ev('Paywall.ready.then(() => true)');
  await sleep(250);
}
async function toTitle() {
  for (let i = 0; i < 6 && (await mode()) !== 'title'; i++) { await ev('window.__back()'); await sleep(120); }
}
const tile = (n) => `#grid .lvl:nth-child(${((n - 1) % 10) + 1})`;

// The parent gate: hold 3 s, then answer the multiplication on the pad.
async function holdGate() {
  await cdp.waitFor("document.getElementById('pwGate').classList.contains('on')", 3000, 'the gate');
  await cdp.hold('#pwHoldBtn', 3300);
  await cdp.waitFor("!document.getElementById('pwMathStage').hidden", 2000, 'the multiplication');
}
async function problem() { const [a, b] = (await text('#pwMathQ')).split('×').map((s) => parseInt(s, 10)); return { q: `${a} × ${b}`, ans: a * b }; }
async function typeAnswer(n) {
  for (const d of String(n)) await cdp.tap(`#pwPad [data-k="${d}"]`);
  await cdp.tap('#pwPad [data-k="ok"]');
}
async function passGate() { await holdGate(); await typeAnswer((await problem()).ans); }
async function openManage() {
  await toTitle();
  await cdp.tap('#parentBtn');
  await passGate();
  await cdp.waitFor("document.getElementById('pwStatus')", 8000, 'the grown-ups screen');
}
// Every button on the open overlays (and the grown-ups button) must be at least ~19vh both ways.
async function audit(label) {
  const r = await measure();
  check(r.n > 0 && !r.bad.length, `touch targets, ${label}: ${r.n} buttons, smallest ${r.smallest.toFixed(1)}vh${r.bad.length ? `; too small: ${r.bad.join(', ')}` : ''}`);
}
function measure() {
  return ev(`(() => {
    const min = innerHeight * 0.185, sizes = [], bad = [];
    const btns = [...document.querySelectorAll('.ov.on button, #parentBtn')].filter((b) => b.getClientRects().length);
    for (const b of btns) {
      const q = b.getBoundingClientRect(), s = Math.min(q.width, q.height);
      sizes.push(s);
      if (s < min) bad.push((b.id || b.dataset.act || b.dataset.k || b.className) + ' ' + Math.round(q.width) + 'x' + Math.round(q.height));
    }
    return { n: btns.length, smallest: sizes.length ? (Math.min(...sizes) / innerHeight) * 100 : 0, bad };
  })()`);
}
// The checks below can only pass for a reason if they can also fail: prove each one bites once.
async function anchors() {
  await ev("setTimeout(() => { throw new Error('anchor: deliberate'); }, 0); 1");
  await sleep(150);
  check(exceptions.length === 1 && exceptions[0].includes('anchor: deliberate'), 'anchor: the exception check catches a deliberately thrown error');
  exceptions.length = 0;
  await ev(`(() => { const d = document.createElement('div'); d.id = 'anchorOv'; d.className = 'ov on';
    d.innerHTML = '<button style="width:30vh;height:12vh">tiny</button>'; document.body.appendChild(d); return 1; })()`);
  const r = await measure();
  await ev("document.getElementById('anchorOv').remove(); 1");
  check(r.bad.length === 1 && r.bad[0].includes('x72'), `anchor: the touch-target audit flags a deliberately 12vh-tall button (${r.bad.join(', ')})`);
}
async function finishLevelNow() {
  await ev('(() => { const g = __dbg.game; g.state = "win"; g.st = 3.7; return 1; })()');
  await cdp.waitFor("__dbg.mode === 'results'", 3000, 'the results screen');
  await sleep(150);
}

// ---------------------------------------------------------------------------------------------
async function freeTierGateAndStake() {
  console.log('\n# Free tier, the parent gate, stake -> World 2 unlocked');
  await open('mockpay=1&mockdelay=300');
  await anchors();
  const boot = await ev('PayMock.calls.slice()');
  check(boot.includes('refresh') && boot.includes('startWatching') && !boot.includes('connect'),
    `store flavor boot: IsabellaEntitlement.refresh() and startWatching(), no wallet prompt (${[...new Set(boot)].join(', ')})`);
  check(await visible('#parentBtn'), 'store flavor: the grown-ups button is on the title screen');
  await audit('title');
  await shot('title-store');

  await cdp.tap('#playBtn');
  await cdp.waitFor("__dbg.mode === 'levels'");
  const locks = await ev("[...document.querySelectorAll('#grid .lvl')].map((b) => b.classList.contains('paylock') && !!b.querySelector('.plock'))");
  check((await text('#worldName')) === 'World 2' && locks.length === 10 && locks.every(Boolean), 'World 2 page: all ten tiles (11-20) wear the gold padlock');
  await shot('levels-world2-locked');
  await cdp.tap('#pgPrev');
  const w1 = await ev("[...document.querySelectorAll('#grid .lvl')].map((b) => b.className)");
  check(w1.length === 10 && w1.every((c) => c === 'lvl'), 'World 1 page: levels 1-10 free and open, no padlocks');
  await cdp.tap('#pgNext');

  await cdp.tap(tile(11));
  await cdp.waitFor("document.getElementById('pwAsk').classList.contains('on')", 2000, 'ask a grown-up');
  check((await mode()) === 'levels' && !(await ev('!!__dbg.game')), 'level 11 is locked: tapping it starts nothing and opens "ask a grown-up"');
  await audit('ask a grown-up');
  await shot('ask-a-grown-up');
  await ev('window.__back()');
  check(!(await on('pwAsk')) && (await mode()) === 'levels', 'back closes "ask a grown-up"');

  await cdp.tap(tile(11)); await cdp.tap('#pwAskGo');
  await cdp.waitFor("document.getElementById('pwGate').classList.contains('on')");
  check(await visible('#pwHoldBtn') && !(await visible('#pwMathStage')), 'the grown-up button opens the gate at "press and hold"');
  await audit('gate, hold');
  await shot('gate-hold');
  await cdp.hold('#pwHoldBtn', 1200);
  check(!(await visible('#pwMathStage')), 'holding for 1.2 s is not enough');
  await cdp.tap('#pwGateX');
  check(!(await on('pwGate')), 'the cancel button closes the gate');
  await cdp.tap(tile(11)); await cdp.tap('#pwAskGo');
  await ev('window.__back()');
  check(!(await on('pwGate')), 'back closes the gate');

  await cdp.tap(tile(11)); await cdp.tap('#pwAskGo');
  await holdGate();
  check(true, 'holding for 3 s brings up the multiplication');
  await audit('gate, number pad');
  const p1 = await problem();
  await shot('gate-multiplication');
  await typeAnswer(p1.ans + 1);
  const shaking = await ev("document.getElementById('pwMathStage').classList.contains('shake')");
  const p2 = await problem();
  await shot('gate-wrong-answer');
  check(shaking && (await on('pwGate')) && !(await on('pwPay')) && (await text('#pwMathA')) === '',
    `wrong answer (${p1.q} = ${p1.ans + 1}) shakes, clears, stays in the gate; new problem ${p2.q}`);
  await typeAnswer(p2.ans);
  check((await on('pwPay')) && !(await on('pwGate')), `right answer (${p2.q} = ${p2.ans}) opens the paywall`);

  const pw = await text('#pwPayBody');
  const need = ['Stake 1 SOL', 'get it back any time', 'Pay US$15 once', 'any token', 'staking rewards (about 5% a year)',
    "value still moves with SOL's price", 'Getting your SOL back locks World 2 again', 'Instant exit costs 0.3%', 'Free exit takes about 2 days'];
  const missing = need.filter((s) => !pw.includes(s));
  check(!missing.length, `paywall shows both options and the plain disclosures${missing.length ? `; missing: ${missing.join(' | ')}` : ''}`);
  await audit('paywall');
  await shot('paywall');

  await ev("PayMock.next('stake', 'cancel')");
  await cdp.tap('#pwPay [data-act=stake]');
  await cdp.waitFor("document.getElementById('pwPayBody').textContent.includes('Cancelled')", 5000, 'the cancelled message');
  check(!(await worldOpen()) && (await text('#pwPayBody')).includes('Nothing was sent'), 'cancel in the wallet: a kind message, World 2 stays locked');
  await shot('stake-cancelled');
  await ev("PayMock.next('stake', 'fail')");
  await cdp.tap('#pwPay [data-act=retry]');
  await cdp.waitFor("document.getElementById('pwPayBody').textContent.includes(\"didn't work\")", 5000, 'the failure message');
  check(!(await worldOpen()) && (await text('#pwPayBody')).includes('Restore purchase'), 'stake fails: a kind message pointing to Restore purchase');
  await shot('stake-failed');

  await ev('PayMock.set({ delay: 1500 })');
  await cdp.tap('#pwPay [data-act=retry]');
  await cdp.waitFor("document.getElementById('pwPayBody').textContent.includes('Approve the deposit')", 5000, 'the progress screen');
  await shot('stake-in-progress');
  const handled = await ev('window.__back()');
  check(handled === true && (await on('pwPay')), 'back while the wallet is busy keeps the progress screen (and the app)');
  await cdp.waitFor("document.getElementById('pwYay').classList.contains('on')", 10000, 'the celebration');
  const st = await ev('Paywall.status()');
  check(st.unlocked && st.via === 'stake', `stake() -> World 2 unlocked (status ${JSON.stringify({ unlocked: st.unlocked, via: st.via })})`);
  check((await mode()) === 'levels' && (await text('#worldName')) === 'World 2' && (await ev("document.querySelectorAll('#grid .paylock').length")) === 0,
    'celebration plays over the World 2 levels, padlocks gone');
  await audit('celebration');
  await sleep(500);
  await shot('stake-celebration');
  await cdp.tap('#pwYayGo');
  check(!(await on('pwYay')), 'the big play button ends the celebration');
  await sleep(300);
  await shot('levels-world2-unlocked');
  await cdp.tap(tile(11));
  check((await mode()) === 'intro' && (await ev('__dbg.game.n')) === 11, 'level 11 now starts');
  await ev('PayMock.set({ delay: 300 })');
}

async function manageStakedAndExitNow() {
  console.log('\n# Grown-ups screen: staked, get SOL back now -> locked again');
  await openManage();
  const t = await text('#pwManBody');
  check((await text('#pwStatus')) === 'Staked ✓', 'status: Staked ✓');
  check(/Wallet \w{4}…\w{4}/.test(t), `the wallet's short address (${(t.match(/Wallet \S+/) || [''])[0]})`);
  const btns = ['Get my SOL back now (−0.3%)', 'Get my SOL back free (~2 days)', 'Restore purchase', 'Disconnect wallet'];
  check(btns.every((b) => t.includes(b)), `buttons: ${btns.join(' / ')}`);
  await audit('grown-ups, staked');
  await shot('manage-staked');

  await cdp.tap('#pwManage [data-act=exitNow]');
  check((await on('pwConfirm')) && (await text('#pwCfB')).includes('World 2 will lock again'), 'confirm first: "World 2 will lock again"');
  await audit('confirm');
  await shot('confirm-exit-now');
  await ev('window.__back()');
  check(!(await on('pwConfirm')) && (await on('pwManage')) && (await worldOpen()), 'back on the confirm cancels; still staked');
  await cdp.tap('#pwManage [data-act=exitNow]');
  await cdp.tap('#pwCfYes');
  await cdp.waitFor("document.getElementById('pwManBody').textContent.includes('Your SOL is back')", 6000, 'the exit result');
  const done = await text('#pwManBody');
  check(!(await worldOpen()) && done.includes('World 2 is locked again') && done.includes('1.007'), `exitInstant -> World 2 locked again ("${done.slice(0, 90)}…")`);
  await shot('exit-now-done');
  await cdp.tap('#pwManage [data-act=ok]');
  await cdp.waitFor("document.getElementById('pwStatus') && document.getElementById('pwStatus').textContent === 'Not unlocked'", 6000, 'Not unlocked');
  check(true, 'status: Not unlocked');
  await shot('manage-not-unlocked');
  await cdp.tap('#pwManage [data-act=close]');
  await cdp.tap('#playBtn');
  check((await ev("document.querySelectorAll('#grid .paylock').length")) === 10, 'World 2 tiles are padlocked again');
  await shot('levels-locked-again');
}

async function buyDisconnectRestore() {
  console.log('\n# Pay US$15 once -> unlocked; disconnect; restore purchase');
  await cdp.tap(tile(11)); await cdp.tap('#pwAskGo');
  await passGate();
  await cdp.tap('#pwPay [data-act=buy]');
  await cdp.waitFor("document.querySelectorAll('#pwPay .tok').length", 5000, 'the token list');
  const toks = await ev("[...document.querySelectorAll('#pwPay .tok')].map((b) => b.textContent.trim())");
  check(toks.length === 2 && toks[0].includes('SOL') && toks[1] === '15 USDC', `payableTokens -> pick a token (${toks.join(', ')})`);
  await audit('pick a token');
  await shot('pay-pick-token');
  await cdp.tap('#pwPay [data-act=pick][data-i="1"]');
  await cdp.waitFor("document.getElementById('pwYay').classList.contains('on')", 8000, 'the celebration');
  const st = await ev('Paywall.status()');
  check(st.unlocked && st.via === 'purchase', 'buy(USDC) -> World 2 unlocked (via purchase)');
  await sleep(400);
  await shot('buy-celebration');
  await cdp.tap('#pwYayGo');

  await openManage();
  const t = await text('#pwManBody');
  check((await text('#pwStatus')) === 'Purchased ✓' && !t.includes('Get my SOL back') && t.includes('Restore purchase') && t.includes('Disconnect wallet'),
    'status: Purchased ✓ (no SOL to get back; restore and disconnect offered)');
  await shot('manage-purchased');
  await cdp.tap('#pwManage [data-act=disconnect]');
  check(await on('pwConfirm'), 'disconnect asks first');
  await shot('confirm-disconnect');
  await cdp.tap('#pwCfYes');
  await cdp.waitFor("document.getElementById('pwStatus') && document.getElementById('pwStatus').textContent === 'Not unlocked'", 6000, 'Not unlocked');
  check((await text('#pwManBody')).includes('No wallet connected') && !(await worldOpen()), 'after disconnect: no wallet, World 2 locked');
  await shot('manage-disconnected');
  await cdp.tap('#pwManage [data-act=restore]');
  await cdp.waitFor("document.getElementById('pwYay').classList.contains('on')", 8000, 'the celebration');
  check((await worldOpen()) && (await ev('Paywall.status().via')) === 'purchase', 'Restore purchase (connect + refresh) finds the purchase: unlocked again');
  await sleep(400);
  await shot('restore-celebration');
  await ev('window.__back()');
  check(!(await on('pwYay')) && (await mode()) === 'levels', 'back ends the celebration on the World 2 levels');
}

async function slowExitAndClaim() {
  console.log('\n# Free exit (~2 days) -> pending -> ready -> claim');
  await open('mockpay=1&mockdelay=300&mock=staked');
  check(await worldOpen(), 'a phone that checked earlier (cached stake) opens World 2 at once');
  await openManage();
  await cdp.tap('#pwManage [data-act=exitFree]');
  const c = await text('#pwCfB');
  check(c.includes('about 2 days') && c.includes('World 2 will lock again'), 'confirm first: about 2 days, World 2 will lock again');
  await cdp.tap('#pwCfYes');
  await cdp.waitFor("document.getElementById('pwManBody').textContent.includes('On its way back')", 6000, 'the slow exit result');
  check(!(await worldOpen()), `exitSlow -> World 2 locked ("${(await text('#pwManBody')).slice(0, 100)}…")`);
  await shot('exit-free-started');
  await cdp.tap('#pwManage [data-act=ok]');
  await cdp.waitFor("document.querySelector('#pwManBody .pend-row')", 6000, 'the pending list');
  check((await text('#pwManBody .pend-row')).includes('Ready around') && !(await visible('#pwManBody [data-act=claim]')), 'pending list: 1.01 SOL, ready around a date, no Claim yet');
  await shot('manage-pending');
  await ev('PayMock.readySlowExits()');
  await ev('window.__back()');
  check(!(await on('pwManage')) && (await mode()) === 'title', 'back closes the grown-ups screen');
  await openManage();
  check((await text('#pwManBody .pend-row')).includes('Ready to claim') && (await visible('#pwManBody [data-act=claim]')), 'two days later: Ready to claim, with a Claim button');
  await audit('grown-ups, pending ready');
  await shot('manage-pending-ready');
  await cdp.tap('#pwManage [data-act=claim]');
  await cdp.waitFor("document.getElementById('pwManBody').textContent.includes('Claimed')", 6000, 'the claim result');
  await shot('claimed');
  await cdp.tap('#pwManage [data-act=ok]');
  await cdp.waitFor("document.getElementById('pwStatus')", 6000);
  check(!(await ev("document.querySelector('#pwManBody .pend-row')")), 'claimSlow -> the pending list is empty');
}

async function offline() {
  console.log('\n# Offline: the grace window, then locked; unlocking offline; back online');
  await open('mockpay=1&mockdelay=300&mock=staked');
  await ev('PayMock.setOffline(true)');
  await openManage();
  const t = await text('#pwManBody');
  check((await text('#pwStatus')) === 'Staked ✓' && t.includes('Offline') && t.includes('World 2 stays open until') && (await worldOpen()),
    `offline, inside the grace window: still Staked ✓ ("${(t.match(/Offline[^]*?(?=Get my|Unlock|Restore|$)/) || [''])[0].trim()}")`);
  await shot('manage-offline-grace');
  await ev('PayMock.advance(25 * 3600e3)');
  await cdp.waitFor("document.getElementById('pwStatus').textContent === 'Not unlocked'", 4000, 'the lock after 24 h offline');
  check(!(await worldOpen()) && (await text('#pwManBody')).includes('connect to the internet to check'), 'offline past 24 h: locked until a successful check (updates live)');
  await shot('manage-offline-expired');
  await cdp.tap('#pwManage [data-act=close]');
  await cdp.tap('#playBtn');
  await cdp.tap(tile(11)); await cdp.tap('#pwAskGo');
  await passGate();
  await cdp.tap('#pwPay [data-act=stake]');
  await cdp.waitFor("document.getElementById('pwPayBody').textContent.includes('offline')", 6000, 'the offline message');
  check(!(await worldOpen()), 'unlocking while offline: "You seem to be offline", nothing changes');
  await shot('paywall-offline');
  await ev('window.__back()');
  check(!(await on('pwPay')) && (await mode()) === 'levels', 'back closes the paywall');
  await ev('PayMock.setOffline(false)');
  await ev('IsabellaEntitlement.refresh()');
  await sleep(200);
  check((await worldOpen()) && (await ev("document.querySelectorAll('#grid .paylock').length")) === 0, 'back online, the next check re-opens World 2 and the padlocks go live');
}

async function closedWhileConfirming() {
  console.log('\n# Closing the paywall while Solana confirms: no celebration later, the padlocks just open');
  await open('mockpay=1&mockdelay=200');
  await cdp.tap('#playBtn');
  await cdp.tap(tile(11)); await cdp.tap('#pwAskGo');
  await passGate();
  await ev('PayMock.set({ confirmLag: 4000 })');
  await cdp.tap('#pwPay [data-act=stake]');
  await cdp.waitFor("document.getElementById('pwPayBody').textContent.includes('Unlocking World 2')", 6000, 'the confirming screen');
  check(await visible('#pwPay [data-act=close]'), 'while Solana confirms, the screen can be closed (only the network is busy)');
  await shot('stake-confirming');
  await ev('window.__back()');
  check(!(await on('pwPay')) && (await mode()) === 'levels' && !(await worldOpen()), 'back closes it; World 2 stays padlocked until the chain shows the stake');
  await sleep(7000);   // long past the 4 s lag: a paywall still polling would have celebrated by now
  await ev('IsabellaEntitlement.refresh()');   // what the watcher and the follow-up checks do
  await sleep(300);
  check((await worldOpen()) && (await ev("document.querySelectorAll('#grid .paylock').length")) === 0 && !(await on('pwYay')),
    'once the chain shows it, the padlocks open by themselves and no celebration pops up later');
}

async function lostMidLevel() {
  console.log('\n# The unlock goes away during a World 2 level');
  await open('mockpay=1&mockdelay=100&mock=staked', { save: ALL_OPEN });
  await cdp.tap('#playBtn');
  await cdp.tap(tile(11));
  await ev('__dbg.play()');
  await sleep(600);
  await ev('IsabellaPay.exitInstant()');
  await sleep(300);
  check(!(await worldOpen()) && (await mode()) === 'play' && !(await ev('Paywall.isOpen()')) && (await ev('__dbg.game.n')) === 11,
    'locked mid-level: level 11 keeps playing, nothing pops up');
  await shot('world2-level-keeps-playing');
  await finishLevelNow();
  check(await visible('#resLevels') && !(await visible('#resNext')) && !(await visible('#resReplay')), 'the level finishes; its results lead only back to the levels');
  await shot('results-after-lock');
  await cdp.tap('#resLevels');
  check((await mode()) === 'levels' && (await text('#worldName')) === 'World 2' && (await ev("document.querySelectorAll('#grid .paylock').length")) === 10,
    'back on the levels screen with the padlock shown');
  await shot('levels-lock-shown');
}

async function nextAfterTen() {
  console.log('\n# "Next" after level 10');
  await open('mockpay=1&mockdelay=100', { save: Object.assign({}, WORLD1_DONE, { unlocked: 10 }) });
  await ev('__dbg.start(10); __dbg.play()');
  await finishLevelNow();
  check(await visible('#resNext'), 'level 10 results show "next"');
  await cdp.tap('#resNext');
  check((await on('pwAsk')) && (await mode()) === 'results', '"next" after level 10 opens "ask a grown-up" (level 11 does not start)');
  await shot('next-after-level-10');
  await ev('window.__back()');
  check(!(await on('pwAsk')) && (await mode()) === 'results', 'back returns to the results');
}

async function unavailable() {
  console.log('\n# No payment modules (no ?mockpay): "Unlock unavailable", the game still works');
  await open('', { noPayments: true });
  check(!(await ev('!!(window.IsabellaPay || window.IsabellaEntitlement || window.Wallet)')), 'no IsabellaPay / IsabellaEntitlement / Wallet on the page');
  await cdp.tap('#playBtn');
  check((await ev("document.querySelectorAll('#grid .paylock').length")) === 10, 'World 2 stays padlocked (fails closed)');
  await cdp.tap(tile(11)); await cdp.tap('#pwAskGo');
  await passGate();
  check((await text('#pwPayBody')).includes('Unlock unavailable'), 'paywall: "Unlock unavailable"');
  await shot('paywall-unavailable');
  await cdp.tap('#pwPay [data-act=close]');
  await toTitle();
  await cdp.tap('#parentBtn');
  await passGate();
  check((await text('#pwManBody')).includes('Unlock unavailable'), 'grown-ups screen: "Unlock unavailable"');
  await shot('manage-unavailable');
  await cdp.tap('#pwManage [data-act=close]');
  await cdp.tap('#playBtn'); await cdp.tap('#pgPrev'); await cdp.tap(tile(1));
  await ev('__dbg.play()');
  await sleep(1200);
  check((await mode()) === 'play' && (await ev('__dbg.game.t')) > 0.8, 'World 1 level 1 plays normally');
}

// The family flavor next to the app as it was before this change (git BASELINE).
async function family() {
  console.log('\n# Family flavor: no locks, no paywall, no grown-ups button; same as before');
  const grab = async () => {
    const out = {};
    const buttons = () => ev("[...document.querySelectorAll('button')].filter((b) => b.getClientRects().length).map((b) => b.id || b.className).join(',')");
    out.title = await buttons();
    await cdp.tap('#playBtn');
    out.levels2 = await ev("[document.getElementById('worldName').textContent, document.getElementById('grid').innerHTML, document.getElementById('pgDots').innerHTML].join('|')");
    await cdp.tap('#pgPrev');
    out.levels1 = await ev("[document.getElementById('worldName').textContent, document.getElementById('grid').innerHTML].join('|')");
    out.levelsButtons = await buttons();
    await cdp.tap('#pgNext');
    await cdp.tap(tile(12));
    out.tap12 = `${await mode()}`;
    await ev('__dbg.start(10); __dbg.play()');
    await finishLevelNow();
    out.results = await buttons();
    await cdp.tap('#resNext');
    out.next = `${await mode()} ${await ev('__dbg.game && __dbg.game.n')}`;
    return out;
  };
  await open('mockpay=1', { family: true });
  check((await ev('Paywall.enabled')) === false && !(await visible('#parentBtn')), 'family: Paywall.enabled = false, no grown-ups button');
  await shot('family-title');
  await cdp.tap('#playBtn');
  const cls = await ev("[...document.querySelectorAll('#grid .lvl')].map((b) => b.className)");
  check(!(await ev("document.querySelector('.paylock, .plock')")) && cls[0] === 'lvl' && cls.slice(1).every((c) => c === 'lvl locked'),
    'family World 2: level 11 open, 12-20 behind the old grey padlock only');
  await shot('family-levels-world2');
  await cdp.tap(tile(11));
  check((await mode()) === 'intro' && (await ev('__dbg.game.n')) === 11, 'family: level 11 starts straight away');
  const calls = await ev('PayMock.calls.slice()');
  check(calls.length === 0, `family: no wallet or entitlement call at all (${calls.length} calls)`);

  let base = null;
  try {
    const dir = path.join(TMP, 'baseline-web');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of ['index.html', 'app.js', 'core.js', 'render.js', 'audio.js']) {
      fs.writeFileSync(path.join(dir, f), execFileSync('git', ['-C', ROOT, 'show', `${BASELINE}:web/${f}`]));
    }
    base = `file://${dir}/index.html`;
  } catch (e) { check(false, `could not read the baseline app at ${BASELINE}: ${e.message}`); }
  if (!base) return;
  await open('', { family: true });
  const now = await grab();
  const src = `try { localStorage.setItem('isabella.save', ${JSON.stringify(JSON.stringify(WORLD1_DONE))}); } catch (e) {}`;
  const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: src });
  await cdp.navigate(base);
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  await cdp.waitFor('window.__dbg', 5000); await sleep(250);
  const before = await grab();
  check(before.title === 'playBtn,soundBtn' && before.levels2.startsWith('World 2|') && before.levels2.includes('lvl locked') && before.next === 'intro 11',
    `anchor: the baseline snapshot is real (title ${before.title}; ${before.levels2.length} chars of World 2 grid; next -> ${before.next})`);
  // Since the baseline, her build gained exactly one thing on the title: the game picker either side of
  // Play (Bubble Party, Shell Match). Everything else must still match the baseline exactly.
  const expect = { ...before, title: before.title.replace('playBtn', 'popBtn,playBtn,matchBtn') };
  for (const k of Object.keys(before)) {
    check(now[k] === expect[k], `family = before (${BASELINE})${k === 'title' ? ' + game picker' : ''}: ${k}${now[k] === expect[k] ? '' : `\n      now:    ${String(now[k]).slice(0, 200)}\n      expect: ${String(expect[k]).slice(0, 200)}`}`);
  }
}

async function smallScreen() {
  console.log('\n# 1024x768');
  prefix = '1024x768-';
  await cdp.viewport(1024, 768);
  await open('mockpay=1&mockdelay=300');
  await audit('title @1024x768');
  await shot('title');
  await cdp.tap('#playBtn');
  await shot('levels-world2-locked');
  await cdp.tap(tile(11));
  await audit('ask @1024x768');
  await shot('ask-a-grown-up');
  await cdp.tap('#pwAskGo');
  await audit('gate hold @1024x768');
  await shot('gate-hold');
  await holdGate();
  await audit('gate pad @1024x768');
  await shot('gate-multiplication');
  await typeAnswer((await problem()).ans);
  await audit('paywall @1024x768');
  await shot('paywall');
  const fits = await ev("(() => { const b = document.getElementById('pwPayBody'); return b.scrollHeight <= b.clientHeight + 1; })()");
  check(fits, 'paywall fits 1024x768 with every disclosure visible (no scrolling)');
  await cdp.tap('#pwPay [data-act=buy]');
  await cdp.waitFor("document.querySelectorAll('#pwPay .tok').length", 5000);
  await audit('tokens @1024x768');
  await shot('pay-pick-token');
  await cdp.tap('#pwPay [data-act=close]');
  await open('mockpay=1&mockdelay=300&mock=staked,ready');
  await openManage();
  await audit('grown-ups @1024x768');
  await shot('manage-staked-pending');
  await cdp.tap('#pwManage [data-act=exitNow]');
  await audit('confirm @1024x768');
  await shot('confirm-exit-now');
  await cdp.viewport(1335, 600);
  prefix = '';
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.unlinkSync(path.join(OUT, f));
  cdp = await launch({ port: PORT, profile: PROFILE, width: 1335, height: 600 });
  cdp.on('Runtime.exceptionThrown', (p) => exceptions.push(`${p.exceptionDetails.text} ${p.exceptionDetails.exception ? p.exceptionDetails.exception.description : ''}`));
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.viewport(1335, 600);
  const t0 = Date.now();
  // --only <text> runs just the scenarios whose name contains it (manage and buy continue from stake).
  const only = arg('only', '');
  const scenarios = [freeTierGateAndStake, manageStakedAndExitNow, buyDisconnectRestore, slowExitAndClaim, offline,
    closedWhileConfirming, lostMidLevel, nextAfterTen, unavailable, family, smallScreen];
  try {
    for (const s of scenarios) if (!only || s.name.includes(only)) await s();
  } catch (e) {
    check(false, `driver stopped: ${e.message}`);
    try { await shot('driver-stopped-here'); } catch (x) { /* browser gone */ }
  }
  check(!exceptions.length, `no JavaScript exceptions on any page${exceptions.length ? `:\n      ${exceptions.join('\n      ')}` : ''}`);
  await cdp.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - t0) / 1000).toFixed(0)} s; ${shots.length} screenshots in ${OUT}`);
  if (failed.length) { console.log('FAILED:'); failed.forEach((f) => console.log(`  ${f.msg}`)); }
  process.exit(failed.length ? 1 : 0);
})();
