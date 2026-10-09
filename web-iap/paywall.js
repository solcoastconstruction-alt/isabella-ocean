/* Isabella the Mermaid — the free tier and the grown-ups' screens for the app-store builds
 * (flavor 'appstore' on iOS; 'play' later). This file replaces web/paywall.js in those builds
 * (scripts/assemble-web.sh), and shows the same window.Paywall to app.js.
 * World 1 (levels 1-10) is free. World 2 opens when a grown-up buys it once through the store's own
 * in-app purchase, which the native shell offers as window.IsabellaBilling:
 *   state()      sync -> { owned, price, ready }   price is the store's own localized text, or null
 *   buy()        -> Promise<{ status: 'purchased' | 'pending' | 'cancelled' }>
 *   restore()    -> Promise<{ owned }>
 *   redeem()     -> Promise<{}>                    optional: opens the store's own "redeem a code" sheet
 *   refresh()    -> Promise<{}>                    load the product and re-check ownership
 *   onChange(fn) fn(state) whenever state changes; returns an unsubscribe function
 * buy/restore/refresh reject with an Error whose .code is 'offline', 'unavailable' or 'failed'.
 * - Kids only ever see pictures: a gold padlock, and "ask a grown-up" with a big button.
 * - The purchase and the links out sit behind the parent gate: hold 3 s, then a 2-digit x 1-digit
 *   multiplication.
 * - The bridge is looked up on every use, so a copy without one shows "Unlock unavailable" on the
 *   grown-ups' screens and nothing else changes. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const sound = (name, arg) => { try { const A = window.IsabellaAudio; A.init(); A[name](arg); } catch (e) { /* no audio here */ } };
  const flavor = window.IsabellaFlavor || (window.IsabellaConfig && window.IsabellaConfig.flavor) || 'appstore';
  const enabled = flavor !== 'family';
  const STORE = flavor === 'play' ? 'Google Play' : 'the App Store';

  const cfg = () => window.IsabellaConfig || {};
  const B = () => window.IsabellaBilling || null;
  const freeLevels = () => +cfg().freeLevels || 10;
  const canRedeem = () => { const b = B(); return !!b && typeof b.redeem === 'function'; };

  function status() {
    const b = B();
    if (!b) return null;
    try { const s = b.state() || {}; return { unlocked: !!s.owned, via: s.owned ? 'purchase' : null, price: s.price || null, ready: !!s.ready }; } catch (err) { return null; }
  }
  // Is World 2 playable right now?
  function worldOpen() {
    if (!enabled) return true;
    const st = status();
    return !!(st && st.unlocked);
  }

  // ---- helpers ----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const coded = (code, message) => Object.assign(new Error(message || code), { code });
  const withTimeout = (p, ms) => Promise.race([Promise.resolve(p), sleep(ms).then(() => { throw coded('offline', 'No answer from the store.'); })]);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const COPY = {
    offline: ['You seem to be offline', `We couldn't reach ${STORE}. Check the internet connection, then try again.`],
    unavailable: ['Purchases are turned off', 'This device is set not to allow purchases (for example by Screen Time), or the unlock is not on sale here yet.'],
    failed: ["That didn't work", `Nothing was unlocked. If ${STORE} shows a charge, tap Restore purchase.`],
  };
  function errorCopy(e) {
    const k = e && COPY[e.code] ? e.code : navigator.onLine === false ? 'offline' : 'failed';
    const [title, text] = COPY[k];
    return { title, text };
  }

  // ---- overlays: a stack, so the top one always closes first ----
  const stack = [];
  // While the store's own sheet is up (since: ms), the screen under it stays put so the answer has
  // somewhere to land; after a minute it can be closed again, in case the store never answers.
  const busy = { pwPay: 0, pwManage: 0 };
  const setBusy = (id, on) => { busy[id] = on ? busy[id] || Date.now() : 0; };
  function open(id) { if (!stack.includes(id)) stack.push(id); $(id).classList.add('on'); }
  function close(id) { const i = stack.indexOf(id); if (i >= 0) stack.splice(i, 1); $(id).classList.remove('on'); if (id in busy) busy[id] = 0; }
  const alive = (id) => stack.includes(id);   // flows check this after every wait: a closed screen starts nothing new
  const isOpen = () => stack.length > 0;
  function back() {
    if (!stack.length) return false;
    const top = stack[stack.length - 1];
    if (busy[top] && Date.now() - busy[top] < 60000) { /* stay: the store will answer */ }
    else if (top === 'pwGate') cancelGate();
    else if (top === 'pwYay') endYay();
    else close(top);
    return true;
  }

  // ---- kids: "ask a grown-up" (pictures only) ----
  function ask() { if (enabled) open('pwAsk'); }

  // ---- the parent gate: hold 3 s, then a multiplication on a number pad ----
  const RING = 2 * Math.PI * 46;
  let onPass = null, holdT = 0, holdRaf = 0, holdT0 = 0, prob = null, typed = '';
  function gate(pass) {
    onPass = pass || null;
    stopHold();
    $('pwHoldStage').hidden = false;
    $('pwMathStage').hidden = true;
    open('pwGate');
  }
  const setRing = (u) => { $('pwRing').style.strokeDashoffset = String(RING * (1 - u)); };
  function startHold(e) {
    e.preventDefault();
    if (holdT) return;
    sound('click');
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* fine without */ }
    holdT0 = performance.now();
    $('pwHoldBtn').classList.add('holding');
    holdT = setTimeout(holdDone, 3000);
    const tick = () => { if (!holdT) return; setRing(Math.min(1, (performance.now() - holdT0) / 3000)); holdRaf = requestAnimationFrame(tick); };
    holdRaf = requestAnimationFrame(tick);
  }
  function stopHold() {
    clearTimeout(holdT); holdT = 0; cancelAnimationFrame(holdRaf);
    $('pwHoldBtn').classList.remove('holding');
    setRing(0);
  }
  function holdDone() {
    holdT = 0; cancelAnimationFrame(holdRaf);
    $('pwHoldBtn').classList.remove('holding');
    sound('key');
    newProblem();
    $('pwHoldStage').hidden = true;
    $('pwMathStage').hidden = false;
  }
  function newProblem() {
    let a;
    do { a = 12 + Math.floor(Math.random() * 88); } while (a % 10 === 0);   // 12..99, never a round ten
    prob = { a, b: 3 + Math.floor(Math.random() * 7) };                      // x 3..9
    typed = '';
    $('pwMathQ').textContent = `${prob.a} × ${prob.b}`;
    showTyped();
  }
  const showTyped = () => { $('pwMathA').textContent = typed || ' '; };
  function padKey(k) {
    if (k === 'ok') { checkAnswer(); return; }
    if (k === 'del') typed = typed.slice(0, -1);
    else if (typed.length < 3) typed += k;
    showTyped();
  }
  function checkAnswer() {
    if (!typed) return;
    if (+typed === prob.a * prob.b) {
      const f = onPass;
      onPass = null;
      close('pwGate');
      if (f) f();
      return;
    }
    sound('locked');
    const box = $('pwMathStage');
    box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
    newProblem();
  }
  function cancelGate() { onPass = null; stopHold(); close('pwGate'); }

  // ---- shared bits of the grown-ups' screens ----
  const X = '<button class="pw-x" data-act="close" aria-label="Close"><svg><use href="#i-close"/></svg></button>';
  // This build's own pages on the game's site (privacy policy, terms). They stand alone: nothing on
  // them leads to the rest of the site. Links open in the device's browser, never inside the game,
  // and only from these screens, which sit behind the parent gate.
  const SITE = 'https://isabellaocean.app/apple/';
  const LEGAL = `<p class="pw-legal"><a href="${SITE}privacy" data-ext>Privacy policy</a> · <a href="${SITE}terms" data-ext>Terms</a></p>`;
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-ext]');
    if (!a) return;
    e.preventDefault();
    try { if (window.IsabellaApp && window.IsabellaApp.openUrl && window.IsabellaApp.openUrl(a.href)) return; } catch (err) { /* no bridge */ }
    window.open(a.href, '_blank', 'noopener');
  });
  const head = (title, sub) => `<div class="pw-head"><div><div class="pw-title">${esc(title)}</div>${sub ? `<div class="pw-sub">${esc(sub)}</div>` : ''}</div>${X}</div>`;
  const busyHtml = (d) => `<div class="pw-center"><div class="spin"></div><div class="pw-h2">${esc(d.title)}</div>${d.text ? `<p class="pw-p">${esc(d.text)}</p>` : ''}</div>`;
  const msgHtml = (d, buttons) => `<div class="pw-center"><div class="pw-h2">${esc(d.title)}</div><p class="pw-p">${esc(d.text)}</p><div class="pw-row">${buttons}</div></div>`;
  const GIFT = '<svg class="ic" viewBox="0 0 48 48"><rect x="7" y="21" width="34" height="21" rx="3" fill="#ff6fb0" stroke="#9c1f5c" stroke-width="2"/><rect x="4" y="13" width="40" height="9" rx="3" fill="#ff8fc3" stroke="#9c1f5c" stroke-width="2"/><rect x="21" y="13" width="6" height="29" fill="#ffd23f" stroke="#a86a00" stroke-width="1.5"/><path d="M24 13c-3-7-12-8-12-3s7 4 12 3zm0 0c3-7 12-8 12-3s-7 4-12 3z" fill="#ffd23f" stroke="#a86a00" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  const UNAVAILABLE = { title: 'Unlock unavailable', text: `This copy of the game can't reach ${STORE}, so World 2 can't be unlocked here.` };
  const PENDING = { title: 'Waiting for approval', text: 'The purchase needs to be approved first (Ask to Buy). World 2 opens by itself once it is. You can close this.' };

  // The store's price for the unlock. The first look at a cold start can come before the store has
  // answered, so ask once more before saying it can't be bought.
  async function priceNow() {
    let st = status();
    if (st && !st.price) {
      try { await withTimeout(B().refresh(), 10000); } catch (e) { /* the screen says so below */ }
      st = status();
    }
    return st;
  }

  // ---- the paywall (grown-ups only; reached through the gate) ----
  let payRetry = null;
  function payView(view, d) {
    d = d || {};
    setBusy('pwPay', view === 'busy');
    const body = $('pwPayBody');
    if (view === 'offer') {
      body.innerHTML = head('Unlock World 2', 'Levels 11–20 · for grown-ups') + `
        <div class="pw-opts">
          <div class="pw-col">
            <button class="opt primary" data-act="buy"><svg class="ic" viewBox="0 0 48 48"><use href="#i-tag"/></svg><div><b>Unlock for ${esc(d.price)}</b><span>one payment</span></div></button>
            <ul class="pw-notes">
              <li>Ten more levels with Isabella: levels 11 to 20.</li>
              <li>One payment. No subscription, no ads.</li>
              <li>Yours to keep. It comes back on a new device with Restore purchase.</li>
              <li>Everything else in the game stays free.</li>
            </ul>
          </div>
          <div class="pw-col">
            <button class="opt" data-act="restore"><svg class="ic" viewBox="0 0 48 48"><use href="#i-key"/></svg><div><b>Restore purchase</b><span>already bought it?</span></div></button>
            ${canRedeem() ? `<button class="opt" data-act="redeem">${GIFT}<div><b>Redeem a code</b><span>were you given one?</span></div></button>` : ''}
          </div>
        </div>${LEGAL}`;
    } else if (view === 'busy') {
      body.innerHTML = busyHtml(d);
    } else if (view === 'checking') {
      body.innerHTML = head('Unlock World 2') + busyHtml(d);   // only a look-up: can be closed
    } else if (view === 'error') {
      body.innerHTML = head('Unlock World 2') + msgHtml(d, '<button class="pbtn" data-act="offer">Back</button><button class="pbtn primary" data-act="retry">Try again</button>');
    } else if (view === 'note') {
      body.innerHTML = head('Unlock World 2') + msgHtml(d, '<button class="pbtn primary" data-act="close">OK</button>');
    }
  }
  async function openPaywall() {
    open('pwPay');
    payRetry = openPaywall;
    if (!B()) { payView('note', UNAVAILABLE); return; }
    if (worldOpen()) { payView('note', { title: 'All good', text: 'World 2 is already unlocked.' }); return; }
    let st = status();
    if (!st.price) { payView('checking', { title: 'One moment', text: '' }); st = await priceNow(); }
    if (!alive('pwPay')) return;
    if (worldOpen()) { celebrate(); return; }
    if (!st || !st.price) { payView('error', errorCopy(coded(navigator.onLine === false ? 'offline' : 'unavailable'))); return; }
    payView('offer', { price: st.price });
  }
  async function doBuy() {
    payRetry = doBuy;
    payView('busy', { title: `Waiting for ${STORE}`, text: 'Confirm the purchase when it asks.' });
    try {
      const r = (await B().buy()) || {};
      if (r.status === 'cancelled') { if (alive('pwPay')) openPaywall(); return; }   // nothing happened: back to the offer
      if (r.status === 'pending') { if (alive('pwPay')) payView('note', PENDING); return; }
      if (worldOpen()) { if (alive('pwPay')) celebrate(); return; }
      throw coded('failed');
    } catch (e) { if (alive('pwPay')) payView('error', errorCopy(e)); }
  }
  async function doRestore(view, here, retry) {
    const wasOpen = worldOpen();
    view('busy', { title: 'Checking your purchases', text: `${STORE[0].toUpperCase()}${STORE.slice(1)} may ask you to sign in.` });
    try {
      await B().restore();
      if (!alive(here)) return;
      if (worldOpen() && !wasOpen) { celebrate(); return; }
      view('note', worldOpen() ? { title: 'All good', text: 'World 2 is unlocked.' }
        : { title: 'Nothing found', text: 'This account has not bought World 2.' });
    } catch (e) { if (alive(here)) view('error', errorCopy(e), retry); }
  }
  // A code the family was given. The store's own sheet takes it; a redeemed code then arrives like
  // a purchase, sometimes a moment after the sheet has closed (boot()'s onChange celebrates it
  // while a grown-up is still on these screens). Closing the sheet without a code changes nothing.
  async function doRedeem(view, here, home) {
    const wasOpen = worldOpen();
    view('busy', { title: `Opening ${STORE}`, text: 'Type the code there.' });
    try {
      await B().redeem();
      if (!alive(here)) return;
      if (worldOpen() && !wasOpen) { celebrate(); return; }
      home();
    } catch (e) { if (alive(here)) view('error', errorCopy(e)); }
  }
  $('pwPay').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || busy.pwPay) return;
    sound('click');
    const act = b.dataset.act;
    if (act === 'close') close('pwPay');
    else if (act === 'buy') doBuy();
    else if (act === 'restore') { payRetry = () => doRestore(payView, 'pwPay'); payRetry(); }
    else if (act === 'redeem') { payRetry = () => doRedeem(payView, 'pwPay', openPaywall); payRetry(); }
    else if (act === 'offer') openPaywall();
    else if (act === 'retry' && payRetry) payRetry();
  });

  // ---- the grown-ups' screen: status, unlock, restore, the links ----
  let manRetry = null, manView = '';
  function manRender(view, d) {
    manView = view;
    setBusy('pwManage', view === 'busy');
    const body = $('pwManBody');
    if (view === 'busy') { body.innerHTML = busyHtml(d); return; }
    if (view === 'note') { body.innerHTML = head('Grown-ups') + msgHtml(d, '<button class="pbtn primary" data-act="ok">OK</button>'); return; }
    if (view === 'error') { body.innerHTML = head('Grown-ups') + msgHtml(d, '<button class="pbtn" data-act="ok">Back</button><button class="pbtn primary" data-act="retry">Try again</button>'); return; }
    // main
    const st = status();
    const acts = [];
    if (!st) acts.push(`<div class="pw-p">Unlock unavailable: this copy of the game can't reach ${esc(STORE)}.</div>`);
    else {
      if (!st.unlocked) acts.push('<button class="pbtn primary" data-act="unlock">Unlock World 2</button>');
      acts.push('<button class="pbtn" data-act="restore">Restore purchase</button>');
      if (!st.unlocked && canRedeem()) acts.push('<button class="pbtn" data-act="redeem">Redeem a code</button>');
    }
    body.innerHTML = `
      <div class="pw-head"><div>
        <div class="pw-kicker">Grown-ups · World 2</div>
        <div class="pw-title st ${st && st.unlocked ? 'ok' : ''}" id="pwStatus">${st && st.unlocked ? 'Purchased ✓' : 'Not unlocked'}</div>
        <div class="pw-sub">${st && st.unlocked ? 'Levels 11–20 are open' : 'Levels 1–10 and the other games are free'}</div>
      </div>${X}</div>
      <div class="acts">${acts.join('')}</div>${LEGAL}`;
  }
  function openManage() {
    open('pwManage');
    manRender('main');
    try { if (B()) B().refresh().catch(() => {}); } catch (e) { /* the cached answer stands */ }
  }
  $('pwManage').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || busy.pwManage) return;
    sound('click');
    const act = b.dataset.act;
    if (act === 'close') close('pwManage');
    else if (act === 'unlock') { close('pwManage'); openPaywall(); }
    else if (act === 'restore') { manRetry = () => doRestore(manRender, 'pwManage'); manRetry(); }
    else if (act === 'redeem') { manRetry = () => doRedeem(manRender, 'pwManage', () => manRender('main')); manRetry(); }
    else if (act === 'ok') manRender('main');
    else if (act === 'retry' && manRetry) manRetry();
  });

  // ---- World 2 unlocked: coins and confetti, then the World 2 levels ----
  let hooks = {};
  function celebrate() {
    for (const id of stack.slice()) close(id);
    try { if (hooks.onUnlocked) hooks.onUnlocked(); } catch (e) { console.error(e); }
    const box = $('pwConfetti'), colors = ['#ff4d6d', '#ff9f43', '#ffd93d', '#5ad17a', '#4cc9f0', '#6c63ff', '#c86bfa'];
    box.innerHTML = Array.from({ length: 70 }, (_, i) => {
      const coin = i % 4 === 0, dur = 2.4 + Math.random() * 2.2;
      return `<i class="${coin ? 'c' : ''}" style="left:${(Math.random() * 100).toFixed(1)}%;animation-duration:${dur.toFixed(2)}s;animation-delay:${(Math.random() * 1.6).toFixed(2)}s;--dx:${((Math.random() - 0.5) * 30).toFixed(1)}vh;--rot:${Math.round((Math.random() - 0.5) * 1440)}deg;${coin ? '' : `background:${colors[i % colors.length]}`}"></i>`;
    }).join('');
    open('pwYay');
  }
  function endYay() { close('pwYay'); $('pwConfetti').innerHTML = ''; }

  // ---- wiring ----
  const tap = (id, fn) => $(id).addEventListener('click', () => { sound('click'); fn(); });
  tap('pwAskBack', () => close('pwAsk'));
  tap('pwAskGo', () => { close('pwAsk'); gate(openPaywall); });
  tap('pwGateX', cancelGate);
  tap('pwYayGo', endYay);
  tap('parentBtn', () => gate(openManage));
  const hold = $('pwHoldBtn');
  hold.addEventListener('pointerdown', startHold);
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) hold.addEventListener(ev, () => { if (holdT) stopHold(); });
  hold.addEventListener('contextmenu', (e) => e.preventDefault());
  $('pwPad').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].map((k) =>
    k === 'del' ? '<button data-k="del" class="del" aria-label="Delete"><svg viewBox="0 0 24 24"><use href="#i-backspace"/></svg></button>'
      : k === 'ok' ? '<button data-k="ok" class="ok">OK</button>' : `<button data-k="${k}">${k}</button>`).join('');
  $('pwPad').addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) { sound('click'); padKey(b.dataset.k); } });

  // Called once by app.js after the title screen is up. hooks.onChange(status) when the unlock
  // changes (re-draw the locks); hooks.onUnlocked() right after a grown-up unlocks World 2.
  function boot(h) {
    hooks = h || {};
    if (!enabled) return;
    $('parentBtn').hidden = false;
    const changed = () => { try { if (hooks.onChange) hooks.onChange(status()); } catch (err) { console.error(err); } };
    changed();
    const b = B();
    if (!b) return;
    let was = worldOpen();
    try {
      b.onChange(() => {
        const now = worldOpen();
        changed();
        // An approval that arrives later (Ask to Buy) while a grown-up is still on these screens.
        if (now && !was && (alive('pwPay') || alive('pwManage')) && !busy.pwPay && !busy.pwManage) celebrate();
        else if (alive('pwManage') && manView === 'main') manRender('main');
        was = now;
      });
    } catch (err) { console.error(err); }
  }

  window.Paywall = { enabled, flavor, ready: Promise.resolve(), boot, freeLevels, worldOpen, status, isOpen, back, ask, gate, openPaywall, openManage };
})();
