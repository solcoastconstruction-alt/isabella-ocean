/* Isabella the Mermaid — the free tier and the grown-ups' screens (store flavor only).
 * World 1 (levels 1-10) is free. World 2 opens when a grown-up stakes 1 SOL or pays US$15 once,
 * through window.Wallet / IsabellaPay / IsabellaEntitlement (Contract 2 in docs/kids-bundle/BUILD-PLAN.md).
 * - Kids only ever see pictures: a gold padlock, and "ask a grown-up" with a big button.
 * - Every wallet action sits behind the parent gate: hold 3 s, then a 2-digit x 1-digit multiplication.
 * - The payment modules are looked up on every use, so a missing one shows "Unlock unavailable"
 *   on the grown-ups' screens and nothing else changes.
 * - The family flavor turns all of this off: no locks, no paywall, no grown-ups button. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const sound = (name, arg) => { try { const A = window.IsabellaAudio; A.init(); A[name](arg); } catch (e) { /* no audio here */ } };
  const flavor = window.IsabellaFlavor || (window.IsabellaConfig && window.IsabellaConfig.flavor) || 'store';
  const enabled = flavor !== 'family';

  // ?mockpay=1 (tests and demo rehearsal) swaps in web/paymock.js, an in-memory stand-in for the payment modules.
  const ready = !/[?&]mockpay=1(?:&|$)/.test(location.search) ? Promise.resolve() : new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'paymock.js';
    s.onload = s.onerror = () => resolve();
    document.head.appendChild(s);
  });

  // ---- the payment modules, looked up on every use ----
  const cfg = () => window.IsabellaConfig || {};
  const E = () => window.IsabellaEntitlement || null;
  const Pay = () => window.IsabellaPay || null;
  const W = () => window.Wallet || null;
  const canPay = () => !!(E() && Pay() && W());
  const freeLevels = () => +cfg().freeLevels || 10;
  const priceUsd = () => +cfg().priceUsd || 15;
  const depositSol = () => +(cfg().stake && cfg().stake.depositSol) || 1.01;
  const feePct = () => { const f = cfg().stake && cfg().stake.instantFeePct; return f != null ? +f : 0.3; };

  function status() {
    const e = E();
    if (!e) return null;
    try { return e.status() || null; } catch (err) { return null; }
  }
  // Is World 2 playable right now? (Family flavor: always.)
  function worldOpen() {
    if (!enabled) return true;
    const st = status();
    return !!(st && st.unlocked);
  }

  // ---- helpers ----
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const coded = (code, message) => Object.assign(new Error(message || code), { code, cancelled: code === 'cancelled' });
  const withTimeout = (p, ms) => Promise.race([Promise.resolve(p), sleep(ms).then(() => { throw coded('timeout', 'No answer from the network.'); })]);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const short = (pk) => { const s = String(pk || ''); return s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s; };
  const fmtSol = (x) => String(+(+x).toFixed(4));
  function fmtAmount(x) {
    if (typeof x !== 'number' || !isFinite(x)) return String(x == null ? '' : x);
    return x >= 1 ? String(+x.toFixed(2)) : String(+x.toPrecision(4));
  }
  const toMs = (t) => (t == null ? NaN : t instanceof Date ? t.getTime() : typeof t === 'number' ? (t < 1e12 ? t * 1000 : t) : Date.parse(t));
  function fmtWhen(t) {
    const ms = toMs(t);
    if (!isFinite(ms)) return '';
    return new Date(ms).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  // What went wrong, in a parent's words. The payment modules' errors are read loosely: a `.code`,
  // a `.cancelled` flag (Contract 1's shape), or failing those the message text.
  function kindOf(e) {
    if (e && typeof e.code === 'string' && COPY[e.code]) return e.code;
    const c = String((e && (e.code || e.error)) || '').toLowerCase();
    const s = `${c} ${String((e && e.message) || (typeof e === 'string' ? e : '')).toLowerCase()}`;
    if ((e && e.cancelled) || /cancel|declin|reject|denied|abort/.test(s)) return 'cancelled';
    if (/no-wallet|no_wallet|no wallet|not installed|wallet_not_found/.test(s)) return 'no-wallet';
    if ((e && e.offline) || navigator.onLine === false || /offline|network|failed to fetch|timeout|timed out|unreachable/.test(s)) return 'offline';
    if (/funds|insufficient|not enough/.test(s)) return 'funds';
    return 'failed';
  }
  const COPY = {
    cancelled: ['Cancelled', 'Nothing was sent. You can try again whenever you like.'],
    offline: ['You seem to be offline', "We couldn't reach Solana. Check the internet connection, then try again."],
    'no-wallet': ['No wallet app found', 'Unlocking needs a Solana wallet app on this phone.'],
    funds: ['Not enough in the wallet', 'The wallet needs a little more than the amount, to cover network fees.'],
    failed: ["That didn't work", 'If your wallet shows that it went through, open Grown-ups on the title screen and tap Restore purchase.'],
  };
  function errorCopy(e) {
    const k = kindOf(e), [title, text] = COPY[k];
    const detail = k === 'failed' || k === 'funds' ? String((e && (e.message || e.error)) || '').slice(0, 160) : '';
    return { title, text, detail };
  }

  // ---- overlays: a stack, so the back button always closes the top one ----
  const stack = [];
  // While a wallet request is in flight (since: ms), its screen stays put so the answer has somewhere
  // to land; after a minute the back button works again, in case a wallet never answers.
  const busy = { pwPay: 0, pwManage: 0 };
  const setBusy = (id, on) => { busy[id] = on ? busy[id] || Date.now() : 0; };
  function open(id) { if (!stack.includes(id)) stack.push(id); $(id).classList.add('on'); }
  function close(id) { const i = stack.indexOf(id); if (i >= 0) stack.splice(i, 1); $(id).classList.remove('on'); if (id in busy) busy[id] = 0; }
  const alive = (id) => stack.includes(id);   // flows check this after every wait: a closed screen starts nothing new
  const isOpen = () => stack.length > 0;
  function back() {
    if (!stack.length) return false;
    const top = stack[stack.length - 1];
    if (top === 'pwConfirm') answer(false);
    else if (busy[top] && Date.now() - busy[top] < 60000) { /* stay: the wallet will answer (or the parent cancels there) */ }
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
  const showTyped = () => { $('pwMathA').textContent = typed || ' '; };
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
  const head = (title, sub, noClose) => `<div class="pw-head"><div><div class="pw-title">${esc(title)}</div>${sub ? `<div class="pw-sub">${esc(sub)}</div>` : ''}</div>${noClose ? '' : X}</div>`;
  const busyHtml = (d) => `<div class="pw-center"><div class="spin"></div><div class="pw-h2">${esc(d.title)}</div>${d.text ? `<p class="pw-p">${esc(d.text)}</p>` : ''}</div>`;
  const msgHtml = (d, buttons) => `<div class="pw-center"><div class="pw-h2">${esc(d.title)}</div><p class="pw-p">${esc(d.text)}</p>${d.detail ? `<p class="pw-small">${esc(d.detail)}</p>` : ''}<div class="pw-row">${buttons}</div></div>`;
  const logoHtml = (t) => {
    const src = String(t.logo || '');
    // Only pictures that ship with the app: a kids' app makes no requests to image hosts.
    if (/^data:image\//.test(src) || /^(?![a-z]+:|\/\/)[\w./-]+\.(png|svg|webp|jpg)$/i.test(src)) return `<img src="${esc(src)}" alt="">`;
    return `<span class="tl">${esc(String(t.symbol || '?').slice(0, 1))}</span>`;
  };

  // Connect the wallet if it isn't yet (this is the only place the app asks a wallet to connect).
  async function connectWallet(view) {
    const w = W();
    if (w.publicKey) return String(w.publicKey);
    view('busy', { title: 'Connecting to your wallet', text: 'Approve the connection in your wallet app.' });
    let avail = true;
    try { avail = await w.available(); } catch (e) { avail = true; }
    if (avail === false || avail === 'false') throw coded('no-wallet');
    const r = await w.connect();
    if (r && r.ok === false) throw r;
    const pk = w.publicKey || (r && r.publicKey);
    if (!pk) throw coded('failed', 'The wallet did not connect.');
    return String(pk);
  }

  // ---- the paywall (grown-ups only; reached through the gate) ----
  let payRetry = null, tokens = [];
  function payView(view, d) {
    d = d || {};
    setBusy('pwPay', view === 'busy');
    const body = $('pwPayBody');
    if (view === 'choose') {
      body.innerHTML = head('Unlock World 2', 'Levels 11–20 · for grown-ups') + `
        <div class="pw-opts">
          <div class="pw-col">
            <button class="opt primary" data-act="stake"><svg class="ic" viewBox="0 0 48 48"><use href="#i-stake"/></svg><div><b>Stake 1 SOL</b><span>get it back any time</span></div></button>
            <ul class="pw-notes">
              <li>You deposit ${esc(depositSol())} SOL, plus a tiny network fee.</li>
              <li>While it's staked, you give up its staking rewards (about 5% a year). They pay for the game.</li>
              <li>Your SOL's value still moves with SOL's price.</li>
              <li>Getting your SOL back locks World 2 again.</li>
              <li>Instant exit costs ${esc(feePct())}%. Free exit takes about 2 days.</li>
            </ul>
          </div>
          <div class="pw-col">
            <button class="opt" data-act="buy"><svg class="ic" viewBox="0 0 48 48"><use href="#i-tag"/></svg><div><b>Pay US$${esc(priceUsd())} once</b><span>any token</span></div></button>
            <ul class="pw-notes">
              <li>One payment. No subscription.</li>
              <li>Pay with a token from your wallet. You see the exact amount before you approve.</li>
            </ul>
          </div>
        </div>`;
    } else if (view === 'tokens') {
      body.innerHTML = head(`Pay US$${priceUsd()} once`, 'Choose what to pay with') + (tokens.length
        ? `<div class="toks">${tokens.map((t, i) => `<button class="tok${t.enough === false ? ' short' : ''}" data-act="pick" data-i="${i}"${t.enough === false ? ' disabled' : ''}>${logoHtml(t)}<b>${esc(fmtAmount(t.amountNeeded))} ${esc(t.symbol)}</b>${t.enough === false ? '<small>not enough</small>' : ''}</button>`).join('')}</div>`
        : '<p class="pw-p">Nothing in this wallet can pay for World 2 right now.</p>') + '<div class="pw-row"><button class="pbtn" data-act="choose">Back</button></div>';
    } else if (view === 'busy') {
      body.innerHTML = busyHtml(d);
    } else if (view === 'checking') {
      body.innerHTML = head('Unlock World 2') + busyHtml(d);   // only the network: can be closed
    } else if (view === 'error') {
      body.innerHTML = head('Unlock World 2') + msgHtml(d, '<button class="pbtn" data-act="choose">Back</button><button class="pbtn primary" data-act="retry">Try again</button>');
    } else if (view === 'sent') {
      body.innerHTML = head('Unlock World 2') + msgHtml({ title: 'Sent. Almost there', text: "Your wallet sent it, but Solana hasn't confirmed it yet. World 2 opens by itself once it does, usually within a minute. You can close this." }, '<button class="pbtn primary" data-act="close">OK</button>');
    } else if (view === 'unavailable') {
      body.innerHTML = head('Unlock World 2') + msgHtml({ title: 'Unlock unavailable', text: "This copy of the game can't reach a wallet, so World 2 can't be unlocked here." }, '<button class="pbtn primary" data-act="close">OK</button>');
    }
  }
  function openPaywall() {
    open('pwPay');
    payView(canPay() ? 'choose' : 'unavailable');
  }
  async function doStake() {
    payRetry = doStake;
    try {
      await connectWallet(payView);
      if (!alive('pwPay')) return;
      payView('busy', { title: 'Approve the deposit in your wallet', text: `You're staking ${depositSol()} SOL. Your wallet shows the details first.` });
      await Pay().stake();
      await unlockAfterPaying();
    } catch (e) { payView('error', errorCopy(e)); }
  }
  async function doTokens() {
    payRetry = doTokens;
    try {
      await connectWallet(payView);
      if (!alive('pwPay')) return;
      payView('checking', { title: 'Looking in your wallet', text: '' });
      tokens = (await withTimeout(Pay().payableTokens(), 30000)) || [];
      if (alive('pwPay')) payView('tokens');
    } catch (e) { payView('error', errorCopy(e)); }
  }
  async function doBuy(t) {
    if (!t) return;
    payRetry = () => doBuy(t);
    try {
      await connectWallet(payView);
      if (!alive('pwPay')) return;
      payView('busy', { title: 'Approve the payment in your wallet', text: `About ${fmtAmount(t.amountNeeded)} ${t.symbol}. Your wallet shows the exact amount first.` });
      await Pay().buy(t.mint);
      await unlockAfterPaying();
    } catch (e) { payView('error', errorCopy(e)); }
  }
  // The wallet has sent it; World 2 opens once the entitlement check sees it on chain. The
  // celebration only plays while a grown-up is still on this screen (never over a level).
  async function unlockAfterPaying() {
    payView('checking', { title: 'Unlocking World 2', text: 'Checking with Solana. This takes a moment.' });
    for (let i = 0; i < 8 && alive('pwPay'); i++) {
      try { await withTimeout(E().refresh(), 15000); } catch (e) { /* offline or slow: check again */ }
      if (worldOpen()) { if (alive('pwPay')) celebrate(); return; }
      await sleep(i < 3 ? 1500 : 3000);
    }
    keepChecking();
    if (alive('pwPay')) payView('sent');
  }
  // A payment the chain hasn't shown yet: look again a few times, so the padlocks open by themselves.
  let laterT = [];
  function keepChecking() {
    laterT.forEach(clearTimeout);
    laterT = [20, 60, 120].map((s) => setTimeout(() => { try { E().refresh().catch(() => {}); } catch (e) { /* gone */ } }, s * 1000));
  }
  $('pwPay').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || busy.pwPay) return;
    sound('click');
    const act = b.dataset.act;
    if (act === 'close') close('pwPay');
    else if (act === 'stake') doStake();
    else if (act === 'buy') doTokens();
    else if (act === 'pick') doBuy(tokens[+b.dataset.i]);
    else if (act === 'choose') payView('choose');
    else if (act === 'retry' && payRetry) payRetry();
  });

  // ---- the grown-ups' screen: status, getting SOL back, restore, disconnect ----
  let manRetry = null, manSeq = 0, manView = '', manData = {};
  function manRender(view, d) {
    manView = view;
    setBusy('pwManage', view === 'busy');
    const body = $('pwManBody');
    if (view === 'busy') { body.innerHTML = busyHtml(d); return; }
    if (view === 'checking') { body.innerHTML = head('Grown-ups') + busyHtml(d); return; }   // only the network: can be closed
    if (view === 'unavailable') {
      body.innerHTML = head('Grown-ups') + msgHtml({ title: 'Unlock unavailable', text: "This copy of the game can't reach a wallet, so World 2 can't be unlocked or managed here." }, '<button class="pbtn primary" data-act="close">OK</button>');
      return;
    }
    if (view === 'done') { body.innerHTML = head('Grown-ups') + msgHtml(d, '<button class="pbtn primary" data-act="ok">OK</button>'); return; }
    if (view === 'error') { body.innerHTML = head('Grown-ups') + msgHtml(d, '<button class="pbtn" data-act="ok">Back</button><button class="pbtn primary" data-act="retry">Try again</button>'); return; }
    // main
    manData = d || {};
    const st = status() || {}, w = W();
    const pk = (w && w.publicKey) || null;   // the wallet connected now (not the one in the cached check)
    const label = st.unlocked ? (st.via === 'stake' ? 'Staked ✓' : st.via === 'purchase' ? 'Purchased ✓' : 'Unlocked ✓') : 'Not unlocked';
    const offline = !!st.offline || !!manData.checkFailed;
    let offLine = '';
    if (offline) {
      offLine = `Offline${st.checkedAt ? ` · last checked ${fmtWhen(st.checkedAt)}` : ''}`;
      offLine += st.unlocked && st.offlineUntil ? ` · World 2 stays open until ${fmtWhen(st.offlineUntil)}` : ' · connect to the internet to check';
    }
    const acts = [];
    if (!canPay()) acts.push('<div class="pw-p">Unlock unavailable: this copy of the game can\'t reach a wallet.</div>');
    else {
      if (!st.unlocked) acts.push('<button class="pbtn primary" data-act="unlock">Unlock World 2</button>');
      if (st.unlocked && st.via === 'stake') {
        acts.push(`<button class="pbtn" data-act="exitNow">Get my SOL back now (−${esc(feePct())}%)</button>`);
        acts.push('<button class="pbtn" data-act="exitFree">Get my SOL back free (~2 days)</button>');
      }
      acts.push('<button class="pbtn" data-act="restore">Restore purchase</button>');
      if (pk) acts.push('<button class="pbtn" data-act="disconnect">Disconnect wallet</button>');
    }
    const pend = manData.pending || [];
    let pendHtml = '';
    if (pend.length) {
      pendHtml = `<div class="pw-h3">SOL on its way back</div><div class="pend">${pend.map((p) => {
        const when = fmtWhen(p.readyAt);
        return `<div class="pend-row"><div><b>${esc(fmtSol((+p.lamports || 0) / 1e9))} SOL</b><span>${p.ready ? 'Ready to claim' : `Ready around ${esc(when || 'in about 2 days')}`}</span></div>${p.ready ? '<button class="pbtn primary" data-act="claim">Claim</button>' : ''}</div>`;
      }).join('')}</div>`;
    } else if (manData.pendingFailed) pendHtml = '<p class="pw-small">Couldn\'t check for SOL on its way back. Try again when you\'re online.</p>';
    body.innerHTML = `
      <div class="pw-head"><div>
        <div class="pw-kicker">Grown-ups · World 2</div>
        <div class="pw-title st ${st.unlocked ? 'ok' : ''}" id="pwStatus">${esc(label)}</div>
        <div class="pw-sub">${pk ? `Wallet ${esc(short(pk))}` : 'No wallet connected'}</div>
        ${offLine ? `<div class="pw-warn">${esc(offLine)}</div>` : ''}
      </div>${X}</div>
      <div class="acts">${acts.join('')}</div>${pendHtml}`;
  }
  function openManage() { open('pwManage'); loadManage(); }
  async function loadManage() {
    if (!E()) { manRender('unavailable'); return; }
    const seq = ++manSeq, w = W(), p = Pay();
    manRender('checking', { title: 'Checking', text: '' });
    const [check, pend] = await Promise.allSettled([
      withTimeout(E().refresh(), 10000),
      p && w && w.publicKey ? withTimeout(p.pendingSlowExits(), 10000) : Promise.resolve([]),
    ]);
    if (seq !== manSeq || !stack.includes('pwManage')) return;
    manRender('main', {
      checkFailed: check.status === 'rejected',
      pending: pend.status === 'fulfilled' ? pend.value || [] : [],
      pendingFailed: pend.status === 'rejected',
    });
  }
  // Run one wallet action from the grown-ups' screen: spinner, then a result or a kind error.
  async function manRun(title, text, fn, retry) {
    manRetry = retry;
    manRender('busy', { title, text });
    try {
      const msg = await fn();
      if (msg === 'celebrated' || !alive('pwManage')) return;
      if (msg) manRender('done', msg); else loadManage();
    } catch (e) { manRender('error', errorCopy(e)); }
  }
  // Connect if needed; false if the screen was closed meanwhile (then nothing else may start).
  async function connectHere() {
    await connectWallet(manRender);
    if (!alive('pwManage')) return false;
    return true;
  }
  // After SOL leaves the pool: lock now (the payments module may already have), then ask the chain.
  async function settle() {
    try { E().revokeLocal(); } catch (e) { /* already done */ }
    try { await withTimeout(E().refresh(), 10000); } catch (e) { /* stays locked until the next check */ }
  }
  async function exitNow() {
    const fee = feePct(), est = fmtSol(depositSol() * (1 - fee / 100));
    if (!(await confirmBox('Get your SOL back now?', `You get about ${est} SOL back right away (a ${fee}% fee). World 2 will lock again.`, 'Yes, get it back', 'Keep it staked'))) return;
    await manRun('Getting your SOL back', 'Approve it in your wallet app.', async () => {
      if (!(await connectHere())) return null;
      manRender('busy', { title: 'Getting your SOL back', text: 'Approve it in your wallet app.' });
      const r = await Pay().exitInstant();
      manRender('checking', { title: 'Almost done', text: 'Checking with Solana.' });
      await settle();
      const out = r && r.solOut != null ? fmtSol(r.solOut) : est;
      return { title: 'Your SOL is back', text: `About ${out} SOL is back in your wallet. ${worldOpen() ? 'World 2 is still open: it was also bought.' : 'World 2 is locked again.'}` };
    }, exitNow);
  }
  async function exitFree() {
    if (!(await confirmBox('Get your SOL back for free?', 'It takes about 2 days. You claim it here when it\'s ready. World 2 will lock again now.', 'Yes, start', 'Keep it staked'))) return;
    await manRun('Starting the free withdrawal', 'Approve it in your wallet app.', async () => {
      if (!(await connectHere())) return null;
      manRender('busy', { title: 'Starting the free withdrawal', text: 'Approve it in your wallet app.' });
      const r = await Pay().exitSlow();
      manRender('checking', { title: 'Almost done', text: 'Checking with Solana.' });
      await settle();
      const when = fmtWhen(r && r.readyAt);
      return { title: 'On its way back', text: `Your SOL will be ready to claim ${when ? `around ${when}` : 'in about 2 days'}. Come back here and tap Claim. ${worldOpen() ? '' : 'World 2 is locked again.'}`.trim() };
    }, exitFree);
  }
  async function claim() {
    await manRun('Claiming your SOL', 'Approve it in your wallet app.', async () => {
      if (!(await connectHere())) return null;
      manRender('busy', { title: 'Claiming your SOL', text: 'Approve it in your wallet app.' });
      const r = await Pay().claimSlow();
      return { title: 'Claimed', text: `${r && r.solOut ? `About ${fmtSol(r.solOut)} SOL is` : 'Your SOL is'} back in your wallet.` };
    }, claim);
  }
  async function restore() {
    await manRun('Checking your wallet', '', async () => {
      const wasOpen = worldOpen();
      if (!(await connectHere())) return null;
      const pk = String(W().publicKey || '');
      manRender('checking', { title: 'Checking your wallet', text: 'Looking for a stake or a purchase on Solana.' });
      let failed = false;
      try { await withTimeout(E().refresh(), 15000); } catch (e) { failed = true; }
      const st = status() || {};
      if (!alive('pwManage')) return null;
      if (st.unlocked && !wasOpen) { celebrate(); return 'celebrated'; }
      if (st.unlocked) return { title: 'All good', text: 'World 2 is unlocked for this wallet.' };
      if (failed || st.offline) throw coded('offline');
      return { title: 'Nothing found', text: `This wallet (${short(pk)}) has no stake or purchase for World 2.` };
    }, restore);
  }
  async function disconnect() {
    if (!(await confirmBox('Disconnect this wallet?', 'The game forgets this wallet. If World 2 was unlocked with it, World 2 locks until you connect it again with Restore purchase.', 'Disconnect', 'Cancel'))) return;
    await manRun('Disconnecting', '', async () => {
      await W().disconnect();
      await settle();
      return null;
    }, disconnect);
  }
  $('pwManage').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || busy.pwManage) return;
    sound('click');
    const act = b.dataset.act;
    if (act === 'close') close('pwManage');
    else if (act === 'unlock') { close('pwManage'); openPaywall(); }
    else if (act === 'exitNow') exitNow();
    else if (act === 'exitFree') exitFree();
    else if (act === 'claim') claim();
    else if (act === 'restore') restore();
    else if (act === 'disconnect') disconnect();
    else if (act === 'ok') loadManage();
    else if (act === 'retry' && manRetry) manRetry();
  });

  // ---- confirm dialog (before SOL leaves the pool, and before disconnecting) ----
  let cfAnswer = null;
  function confirmBox(title, text, yes, no) {
    $('pwCfT').textContent = title;
    $('pwCfB').textContent = text;
    $('pwCfYes').textContent = yes;
    $('pwCfNo').textContent = no || 'Cancel';
    open('pwConfirm');
    return new Promise((res) => { cfAnswer = res; });
  }
  function answer(v) { close('pwConfirm'); const r = cfAnswer; cfAnswer = null; if (r) r(v); }

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
  $('pwCfNo').addEventListener('click', () => { sound('click'); answer(false); });
  $('pwCfYes').addEventListener('click', () => { sound('click'); answer(true); });
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
    ready.then(() => {
      const e = E();
      const changed = () => { try { if (hooks.onChange) hooks.onChange(status()); } catch (err) { console.error(err); } };
      changed();
      if (!e) return;
      try {
        e.onChange(() => {
          changed();
          if (alive('pwManage') && manView === 'main') manRender('main', manData);
        });
      } catch (err) { console.error(err); }
      Promise.resolve().then(() => e.refresh()).catch(() => { /* offline: the cached result stands */ });
      try { e.startWatching(); } catch (err) { console.error(err); }
    });
  }

  window.Paywall = { enabled, flavor, ready, boot, freeLevels, worldOpen, status, isOpen, back, ask, gate, openPaywall, openManage };
})();
