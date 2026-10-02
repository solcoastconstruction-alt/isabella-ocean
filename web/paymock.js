/* Isabella the Mermaid — an in-memory stand-in for the payments modules (Contract 2 in
 * docs/kids-bundle/BUILD-PLAN.md): window.IsabellaConfig, window.Wallet, window.IsabellaPay and
 * window.IsabellaEntitlement. No network, no keys, nothing persists past a reload.
 *
 * paywall.js loads it only when the page URL has ?mockpay=1 (tests and demo rehearsal).
 *   URL presets (comma-separated):  ?mockpay=1&mock=staked | purchased | pending | ready | offline | nowallet
 *   URL speed:                       &mockdelay=ms   (default 600; every wallet/chain call waits this long)
 *   From the console or a test:     PayMock.next('stake', 'cancel')   one-shot outcome for the next call:
 *                                      'ok' | 'cancel' | 'fail' | 'offline' | 'funds'
 *                                   PayMock.setOffline(true)         every chain call fails; refresh keeps the cache
 *                                   PayMock.readySlowExits()         pending free exits become claimable
 *                                   PayMock.advance(ms)              move the mock clock (offline grace window)
 *                                   PayMock.set({ confirmLag: ms })  a stake/purchase reaches the chain this much later
 *                                   PayMock.calls                    every API call made, in order
 * Errors are Error objects with .code in: cancelled | offline | no-wallet | funds | failed | nothing-staked |
 * nothing-ready | bad-token, and .cancelled = true for a cancel (the shape paywall.js reads). */
(function () {
  'use strict';
  const q = new URLSearchParams(location.search);
  const presets = (q.get('mock') || '').split(',').filter(Boolean);

  // Contract 3, devnet defaults. A real config.js (if loaded) is kept: it has the same shape.
  const cfg = window.IsabellaConfig = window.IsabellaConfig || {
    flavor: window.IsabellaFlavor || 'store',
    cluster: 'devnet', chain: 'solana:devnet', rpcUrl: 'https://api.devnet.solana.com',
    freeLevels: 10, priceUsd: 15,
    stake: { programId: '', pool: '', mint: '', depositSol: 1.01, unlockThreshold: 0.99, instantFeePct: 0.3 },
    merchant: { wallet: '', usdcMint: '', usdcAta: '' },
    jupiter: { apiBase: 'https://api.jup.ag', apiKey: '' },
    offlineGraceHours: 24, recheckMinutes: 5,
  };
  const family = (cfg.flavor || window.IsabellaFlavor) === 'family';

  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const fake = (n) => Array.from({ length: n }, () => B58[Math.floor(Math.random() * 58)]).join('');
  const WALLET = 'MockWa11et7xKXtg2CW87d97TXJSDpbD5jBkheTqA8';   // one fake parent wallet, same after reconnect
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const USDC_MINT = cfg.merchant.usdcMint || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr';
  const SOL_USD = 118;   // 1 Oct 2026, for the mock's "amount needed"
  const DAY = 864e5;
  const coinLogo = (bg, fg, txt) => 'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="19" fill="${bg}"/>` +
    `<text x="20" y="26" font-family="sans-serif" font-size="15" font-weight="700" fill="${fg}" text-anchor="middle">${txt}</text></svg>`);

  const S = {
    delay: q.has('mockdelay') ? Math.max(0, +q.get('mockdelay')) : 600,
    offline: false,
    walletAvailable: true,
    publicKey: null,
    poolTokens: 0,          // on-chain: the parent's pool tokens
    purchased: false,       // on-chain: a finalized US$15 payment with the parent's reference key
    pending: [],            // on-chain: the parent's deactivating stake accounts {stakeAccount, lamports, readyAt}
    cache: null,            // the phone's last SUCCESSFUL check {unlocked, via, wallet, checkedAt}
    lastCheckFailed: false,
    clock: 0,               // ms added to Date.now() (PayMock.advance)
    confirmLag: 0,          // ms before a new stake/purchase shows up on chain (finalization)
    next: {},               // one-shot outcomes per operation
  };
  const land = (fn) => { if (S.confirmLag) setTimeout(fn, S.confirmLag); else fn(); };
  const calls = [];
  const now = () => Date.now() + S.clock;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fail = (code, message) => Object.assign(new Error(message), { code, cancelled: code === 'cancelled' });
  const take = (op) => { const o = S.next[op] || 'ok'; delete S.next[op]; return o; };

  // Every wallet/chain call: log it, wait, then apply the outcome queued for it (if any).
  async function call(op, needsNet, fn) {
    calls.push(op);
    const outcome = take(op);
    await wait(S.delay);
    if (outcome === 'cancel') throw fail('cancelled', 'You cancelled in the wallet.');
    if (outcome === 'offline' || (needsNet && S.offline)) throw fail('offline', 'Network request failed (offline).');
    if (outcome === 'funds') throw fail('funds', 'Insufficient funds for this transaction.');
    if (outcome === 'fail') throw fail('failed', 'Transaction simulation failed (mock).');
    return fn();
  }
  const needWallet = () => { if (!S.publicKey) throw fail('no-wallet', 'No wallet connected.'); };

  // ---- what the chain says right now ----
  function onChain() {
    const via = S.poolTokens >= cfg.stake.unlockThreshold ? 'stake' : S.purchased ? 'purchase' : null;
    return { via: S.publicKey ? via : null };
  }

  // ---- IsabellaEntitlement ----
  const listeners = [];
  let lastSig = '';
  function status() {
    if (family) return { unlocked: true, via: 'family', wallet: null, checkedAt: now(), offlineUntil: null, offline: false };
    const c = S.cache, graceMs = cfg.offlineGraceHours * 36e5;
    if (!c) return { unlocked: false, via: null, wallet: S.publicKey, checkedAt: null, offlineUntil: null, offline: S.lastCheckFailed };
    const until = c.checkedAt + graceMs, ok = c.unlocked && now() < until;
    return { unlocked: ok, via: ok ? c.via : null, wallet: c.wallet, checkedAt: c.checkedAt, offlineUntil: until, offline: S.lastCheckFailed };
  }
  function notify() {
    const st = status(), sig = [st.unlocked, st.via, st.wallet, st.offline].join('|');
    if (sig === lastSig) return;
    lastSig = sig;
    for (const fn of listeners.slice()) { try { fn(st); } catch (e) { console.error(e); } }
  }
  let watchT = null;
  window.IsabellaEntitlement = {
    status() { calls.push('status'); return status(); },
    async refresh() {
      calls.push('refresh');
      await wait(Math.round(S.delay / 2));
      if (S.offline) { S.lastCheckFailed = true; notify(); return status(); }   // keep the last result
      S.lastCheckFailed = false;
      const via = onChain().via;
      S.cache = { unlocked: !!via, via, wallet: S.publicKey, checkedAt: now() };
      notify();
      return status();
    },
    onChange(fn) { listeners.push(fn); return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
    startWatching() {
      calls.push('startWatching');
      if (watchT) return;
      const every = cfg.recheckMinutes * 6e4;
      watchT = setInterval(() => { if (!document.hidden) window.IsabellaEntitlement.refresh(); }, every);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) window.IsabellaEntitlement.refresh(); });
    },
    revokeLocal() { calls.push('revokeLocal'); if (S.cache) S.cache = Object.assign({}, S.cache, { unlocked: false, via: null }); notify(); },
  };

  // ---- Wallet ----
  window.Wallet = {
    available() { calls.push('available'); return S.walletAvailable; },
    connect() {
      return call('connect', false, () => {
        if (!S.walletAvailable) throw fail('no-wallet', 'No Solana wallet app is installed.');
        S.publicKey = WALLET;
        return { ok: true, publicKey: WALLET, walletLabel: 'Mock Wallet' };
      });
    },
    signAndSend(txs) { return call('signAndSend', true, () => { needWallet(); return (txs || []).map(() => fake(88)); }); },
    get publicKey() { return S.publicKey; },
    disconnect() { calls.push('disconnect'); S.publicKey = null; },
  };

  // ---- IsabellaPay ----
  window.IsabellaPay = {
    stake() {
      return call('stake', true, () => {
        needWallet();
        land(() => { S.poolTokens += cfg.stake.depositSol; });   // pool token ~1 SOL each (the 100% fee keeps it flat)
        return { signature: fake(88) };
      });
    },
    exitInstant() {
      return call('exitInstant', true, () => {
        needWallet();
        if (S.poolTokens <= 0) throw fail('nothing-staked', 'This wallet has no pool tokens.');
        const solOut = +(S.poolTokens * (1 - cfg.stake.instantFeePct / 100)).toFixed(6);
        S.poolTokens = 0;
        window.IsabellaEntitlement.revokeLocal();
        return { signature: fake(88), solOut };
      });
    },
    exitSlow() {
      return call('exitSlow', true, () => {
        needWallet();
        if (S.poolTokens <= 0) throw fail('nothing-staked', 'This wallet has no pool tokens.');
        const p = { stakeAccount: fake(44), lamports: Math.round(S.poolTokens * 1e9), readyAt: now() + 2 * DAY };
        S.pending.push(p);
        S.poolTokens = 0;
        window.IsabellaEntitlement.revokeLocal();
        return { signature: fake(88), stakeAccount: p.stakeAccount, readyAt: p.readyAt };
      });
    },
    pendingSlowExits() {
      return call('pendingSlowExits', true, () => S.pending.map((p) => ({ stakeAccount: p.stakeAccount, lamports: p.lamports, ready: now() >= p.readyAt, readyAt: p.readyAt })));
    },
    claimSlow() {
      return call('claimSlow', true, () => {
        needWallet();
        const ready = S.pending.filter((p) => now() >= p.readyAt);
        if (!ready.length) throw fail('nothing-ready', 'No withdrawal is ready to claim yet.');
        S.pending = S.pending.filter((p) => now() < p.readyAt);
        return { signature: fake(88), solOut: ready.reduce((s, p) => s + p.lamports, 0) / 1e9 };
      });
    },
    payableTokens() {
      return call('payableTokens', true, () => [
        { mint: SOL_MINT, symbol: 'SOL', logo: coinLogo('#14151a', '#14f195', 'S'), amountNeeded: +(cfg.priceUsd / SOL_USD).toFixed(4) },
        { mint: USDC_MINT, symbol: 'USDC', logo: coinLogo('#2775ca', '#fff', '$'), amountNeeded: cfg.priceUsd },
      ]);
    },
    buy(mint) {
      return call('buy', true, () => {
        needWallet();
        if (mint !== SOL_MINT && mint !== USDC_MINT) throw fail('bad-token', 'That token cannot pay for this.');
        land(() => { S.purchased = true; });
        return { signature: fake(88) };
      });
    },
  };

  // ---- controls for tests and rehearsal ----
  window.PayMock = {
    state: S, calls,
    next(op, outcome) { S.next[op] = outcome; },
    set(o) { Object.assign(S, o); },
    setOffline(v) { S.offline = !!v; },
    readySlowExits() { for (const p of S.pending) p.readyAt = now() - 1000; },
    advance(ms) { S.clock += ms; notify(); },
    reset() { Object.assign(S, { offline: false, walletAvailable: true, publicKey: null, poolTokens: 0, purchased: false, pending: [], cache: null, lastCheckFailed: false, clock: 0, confirmLag: 0, next: {} }); calls.length = 0; notify(); },
  };
  // A preset is a state the phone could already be in at launch (it checked last time and cached it).
  const remember = (via) => { S.publicKey = WALLET; S.cache = { unlocked: !!via, via, wallet: WALLET, checkedAt: now() }; };
  for (const p of presets) {
    if (p === 'staked') { S.poolTokens = cfg.stake.depositSol; remember('stake'); }
    if (p === 'purchased') { S.purchased = true; remember('purchase'); }
    if (p === 'pending' || p === 'ready') { S.publicKey = WALLET; S.pending.push({ stakeAccount: fake(44), lamports: 1.01e9, readyAt: p === 'ready' ? now() - 1000 : now() + 2 * DAY }); }
    if (p === 'offline') { S.offline = true; S.lastCheckFailed = true; }
    if (p === 'nowallet') S.walletAvailable = false;
  }
})();
