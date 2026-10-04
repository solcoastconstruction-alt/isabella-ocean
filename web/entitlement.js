/* Isabella the Mermaid — window.IsabellaEntitlement (Contract 2): is World 2 unlocked?
 *
 *   status()        sync, from the cache -> { unlocked, via:'stake'|'purchase'|'family'|null, wallet, checkedAt,
 *                   offlineUntil, offline, tokens, purchase, lastError }
 *                   offline = the last check failed; offlineUntil = checkedAt + offlineGraceHours (ms).
 *   refresh()       on-chain check; updates the cache; resolves status() within ~9 s, never rejects. A failed
 *                   check keeps the last result until the offline grace window ends.
 *   onChange(fn)    fn(status) whenever unlocked / via / wallet changes. Returns an unsubscribe function.
 *   startWatching() refresh now, every config.recheckMinutes while the page is visible, on resume and on
 *                   wallet changes. Returns a stop function. Re-evaluates the grace window every 30 s (no network).
 *   revokeLocal()   lock the stake unlock at once (exit flows call it the moment tokens leave). Idempotent.
 *                   A found purchase is kept; revokeLocal({ all: true }) drops it too (refresh finds it again).
 *   notePurchase(signature)  payments.js: this wallet just confirmed a purchase; refresh() accepts that
 *                   signature at 'confirmed' until the finalized one is found.
 *
 * Rules (BUILD-PLAN.md): family flavor is always unlocked and never touches the network or starts timers.
 * Otherwise a wallet must be connected (after Wallet.disconnect() everything reports locked), and unlocked =
 * the last SUCCESSFUL check found a valid purchase (permanent: it never lapses offline, decided at
 * integration), OR pool tokens >= config.stake.unlockThreshold and now < checkedAt + config.offlineGraceHours.
 *
 * Purchases need no database: each purchase transaction carries a read-only "reference" key,
 * sha256("isabella-purchase-v1" + walletBase58) -> 32 bytes -> public key. refresh() finds purchases with
 * getSignaturesForAddress(reference) and accepts a finalized, successful transaction that raised the
 * merchant's USDC account by >= priceUsd, or (devnet only) the merchant wallet by >= devnetPriceSol.
 * The test is "at least the price", so a purchase made at an earlier, higher price still counts.
 */
(function () {
  'use strict';
  const cfg = window.IsabellaConfig || {};
  const L = window.SolanaLib;
  const STORE_KEY = 'isabella.entitlement';
  const HOLD_MS = 3 * 60 * 1000; // after revokeLocal, ignore pool tokens that are still on their way out
  const REFERENCE_PREFIX = 'isabella-purchase-v1';
  const isFamily = () => cfg.flavor === 'family';
  const isMainnet = () => cfg.cluster === 'mainnet-beta' || cfg.cluster === 'mainnet';

  // Tests replace env.now (clock) and env.refreshTimeoutMs. The RPC is Wallet.connection(), which tests may
  // also replace. The paywall needs refresh() to settle within ~10 s.
  const env = { now: () => Date.now(), refreshTimeoutMs: 9000 };

  function connection() {
    if (window.Wallet && typeof window.Wallet.connection === 'function') return window.Wallet.connection();
    return new L.web3.Connection(cfg.rpcUrl, { commitment: 'confirmed' });
  }
  function currentWallet() { return (window.Wallet && window.Wallet.publicKey) || null; }

  // ---- cache (Android SharedPreferences via IsabellaStore, else localStorage) ----
  function storeGet() {
    try { if (window.IsabellaStore) return window.IsabellaStore.get(STORE_KEY); } catch (e) { /* fall through */ }
    try { return window.localStorage.getItem(STORE_KEY); } catch (e) { return null; }
  }
  function storeSet(value) {
    try { if (window.IsabellaStore) { window.IsabellaStore.set(STORE_KEY, value); return; } } catch (e) { /* fall through */ }
    try { window.localStorage.setItem(STORE_KEY, value); } catch (e) { /* nothing to do */ }
  }
  function readCache() {
    try { const c = JSON.parse(storeGet() || 'null'); return c && typeof c === 'object' ? c : null; } catch (e) { return null; }
  }
  function writeCache(c) { storeSet(JSON.stringify(Object.assign({ v: 1 }, c))); }
  function blank(wallet) {
    return { wallet, unlocked: false, via: null, checkedAt: 0, tokens: null, purchase: null, pendingPurchase: null, lastError: null, lastAttemptAt: 0, holdUntil: 0 };
  }

  // ---- the reference key ----
  function referenceFor(walletBase58) {
    const bytes = new TextEncoder().encode(REFERENCE_PREFIX + String(walletBase58));
    return new L.web3.PublicKey(L.sha256(bytes)).toBase58();
  }

  // ---- status ----
  function graceMs() { return (Number(cfg.offlineGraceHours) || 24) * 3600 * 1000; }

  function status() {
    if (isFamily()) return { unlocked: true, via: 'family', wallet: null, checkedAt: null, offlineUntil: null, offline: false };
    const current = currentWallet();
    const c = readCache();
    if (!current || !c || c.wallet !== current) {
      return { unlocked: false, via: null, wallet: current, checkedAt: null, offlineUntil: null, offline: !!(c && c.wallet === current && c.lastError), lastError: null };
    }
    const checkedAt = Number(c.checkedAt) || 0;
    const until = checkedAt ? checkedAt + graceMs() : null;
    // A purchase is permanent, so it never lapses offline; only the stake unlock needs re-checking
    // (the tokens can leave the wallet, and that must lock World 2 again).
    const unlocked = !!c.unlocked && !!c.via && until !== null && (c.via === 'purchase' || env.now() < until);
    return {
      unlocked,
      via: unlocked ? c.via : null,
      wallet: c.wallet,
      checkedAt: checkedAt || null,
      offlineUntil: until,
      offline: !!c.lastError,
      tokens: typeof c.tokens === 'number' ? c.tokens : null,
      purchase: c.purchase ? c.purchase.signature : null,
      lastError: c.lastError || null,
    };
  }

  // ---- change notification ----
  const listeners = new Set();
  let lastKey = null;
  function keyOf(s) { return [s.unlocked, s.via, s.wallet].join('|'); }
  function emitIfChanged() {
    const s = status();
    const k = keyOf(s);
    if (k === lastKey) return s;
    lastKey = k;
    for (const fn of listeners) { try { fn(s); } catch (e) { /* a listener's bug is not ours */ } }
    return s;
  }

  // ---- on-chain reads ----
  async function poolTokenBalance(walletBase58) {
    if (!cfg.stake || !cfg.stake.mint) return null;
    const res = await connection().getParsedTokenAccountsByOwner(
      new L.web3.PublicKey(walletBase58), { mint: new L.web3.PublicKey(cfg.stake.mint) }, 'confirmed');
    let raw = 0n, decimals = 9;
    for (const { account } of res.value) {
      const ta = account.data && account.data.parsed && account.data.parsed.info && account.data.parsed.info.tokenAmount;
      if (!ta) continue;
      raw += BigInt(ta.amount);
      decimals = ta.decimals;
    }
    return { raw, decimals, ui: Number(raw) / 10 ** decimals };
  }

  function thresholdRaw(decimals) {
    return BigInt(Math.round(Number(cfg.stake.unlockThreshold) * 10 ** decimals));
  }

  /**
   * config.priceUsd in a token's base units, exactly. The price is read as a decimal string and never
   * multiplied as a float: 4.99 with 6 decimals is 4990000n. payments.js charges this same amount.
   */
  function priceUnits(decimals) {
    const m = /^(\d+)(?:\.(\d*))?$/.exec(String(cfg.priceUsd).trim());
    if (!m || (m[2] || '').length > decimals) return BigInt(Math.round(Number(cfg.priceUsd) * 10 ** decimals)); // exponent form, or finer than the token
    return BigInt(m[1] + (m[2] || '').padEnd(decimals, '0'));
  }

  /** Did this transaction pay the merchant enough (and carry the reference)? Returns { kind, amount } or null. */
  function verifyPurchaseTransaction(tx, referenceBase58) {
    if (!tx || !tx.meta || tx.meta.err) return null;
    const m = cfg.merchant || {};
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    const all = [];
    for (let i = 0; i < keys.length; i++) all.push(keys.get(i).toBase58());
    if (referenceBase58 && !all.includes(referenceBase58)) return null;
    if (m.usdcMint) {
      const pre = tx.meta.preTokenBalances || [];
      for (const pb of tx.meta.postTokenBalances || []) {
        if (pb.mint !== m.usdcMint) continue;
        const isMerchant = (m.usdcAta && all[pb.accountIndex] === m.usdcAta) || (m.wallet && pb.owner === m.wallet);
        if (!isMerchant) continue;
        const before = pre.find((x) => x.accountIndex === pb.accountIndex);
        const delta = BigInt(pb.uiTokenAmount.amount) - BigInt(before ? before.uiTokenAmount.amount : '0');
        const need = priceUnits(pb.uiTokenAmount.decimals);
        if (delta >= need) return { kind: 'usdc', amount: Number(delta) / 10 ** pb.uiTokenAmount.decimals };
      }
    }
    if (!isMainnet() && m.wallet) {
      const i = all.indexOf(m.wallet);
      if (i >= 0) {
        const delta = tx.meta.postBalances[i] - tx.meta.preBalances[i];
        if (delta >= Math.round(Number(cfg.devnetPriceSol || 0.1) * 1e9)) return { kind: 'sol', amount: delta / 1e9 };
      }
    }
    return null;
  }

  async function verifySignature(signature, referenceBase58, commitment) {
    const tx = await connection().getTransaction(signature, { commitment: commitment || 'finalized', maxSupportedTransactionVersion: 0 });
    const v = verifyPurchaseTransaction(tx, referenceBase58);
    return v ? { signature, kind: v.kind, amount: v.amount, blockTime: tx.blockTime || null } : null;
  }

  /** Find a finalized purchase for this wallet through its reference key. Resolves { signature, kind, amount } or null. */
  async function findPurchase(walletBase58) {
    const m = cfg.merchant || {};
    if (!m.wallet && !m.usdcAta) return null;
    const reference = referenceFor(walletBase58);
    const sigs = await connection().getSignaturesForAddress(new L.web3.PublicKey(reference), { limit: 100 }, 'finalized');
    for (const s of sigs.filter((x) => !x.err).slice(0, 20)) {
      const found = await verifySignature(s.signature, reference, 'finalized');
      if (found) return found;
    }
    return null;
  }

  async function purchaseFor(wallet, same) {
    const reference = referenceFor(wallet);
    if (same && same.purchase && same.purchase.signature) {
      const again = await verifySignature(same.purchase.signature, reference, 'finalized');
      if (again) return again;
    }
    if (same && same.pendingPurchase) { // bought on this device a moment ago: confirmed is enough for this one
      const p = await verifySignature(same.pendingPurchase, reference, 'confirmed');
      if (p) {
        const final = await verifySignature(same.pendingPurchase, reference, 'finalized').catch(() => null);
        return final || Object.assign(p, { pending: true });
      }
    }
    return findPurchase(wallet);
  }

  // ---- refresh ----
  let inflight = null;
  function refresh(opts) {
    if (isFamily()) return Promise.resolve(emitIfChanged());
    if (inflight) return inflight;
    const wallet = currentWallet();
    if (!wallet) return Promise.resolve(emitIfChanged()); // disconnected: locked, nothing to check
    let timer = null;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), env.refreshTimeoutMs); });
    inflight = Promise.race([doRefresh(wallet, opts || {}), timeout])
      .then((r) => { if (r === 'timeout') recordFailure(wallet, 'The Solana network did not answer in time.'); return emitIfChanged(); })
      .finally(() => { clearTimeout(timer); inflight = null; });
    return inflight;
  }

  function recordFailure(wallet, msg) {
    const cached = readCache();
    const same = cached && cached.wallet === wallet ? cached : blank(wallet);
    writeCache(Object.assign({}, same, { lastError: msg, lastAttemptAt: env.now() }));
  }

  async function doRefresh(wallet, opts) {
    const cached = readCache();
    const same = cached && cached.wallet === wallet ? cached : null;
    try {
      const [tokens, purchase] = await Promise.all([poolTokenBalance(wallet), purchaseFor(wallet, same)]);
      const now = env.now();
      const held = !!(same && same.holdUntil && now < same.holdUntil && !opts.ignoreHold);
      const stakeOk = !held && !!tokens && tokens.raw >= thresholdRaw(tokens.decimals);
      const via = purchase ? 'purchase' : stakeOk ? 'stake' : null;
      const latest = readCache(); // revokeLocal or notePurchase may have run while we were waiting
      const pending = latest && latest.wallet === wallet && latest.pendingPurchase && !(purchase && !purchase.pending) ? latest.pendingPurchase : null;
      writeCache({
        wallet, unlocked: !!via, via, checkedAt: now,
        tokens: tokens ? tokens.ui : null,
        purchase: purchase ? { signature: purchase.signature, kind: purchase.kind, amount: purchase.amount } : null,
        pendingPurchase: pending,
        lastError: null, lastAttemptAt: now,
        // ignoreHold (an exit failed, or a new stake landed) ends the hold; otherwise keep a running one
        holdUntil: !opts.ignoreHold && latest && latest.wallet === wallet && latest.holdUntil > now ? latest.holdUntil : 0,
      });
    } catch (e) {
      recordFailure(wallet, (e && e.message) || String(e));
    }
  }

  // ---- revoke / note ----
  function revokeLocal(opts) {
    if (isFamily()) return status();
    const wallet = currentWallet();
    if (!wallet) return emitIfChanged();
    const c = readCache();
    const same = c && c.wallet === wallet ? c : blank(wallet);
    const now = env.now();
    const keep = !(opts && opts.all) && same.purchase ? same.purchase : null;
    writeCache(Object.assign({}, same, {
      unlocked: !!keep, via: keep ? 'purchase' : null, checkedAt: keep ? same.checkedAt : 0,
      tokens: 0, purchase: keep, pendingPurchase: keep ? same.pendingPurchase : null,
      holdUntil: Math.max(Number(same.holdUntil) || 0, now + HOLD_MS),
    }));
    return emitIfChanged();
  }

  function notePurchase(signature) {
    if (isFamily()) return status();
    const wallet = currentWallet();
    if (!wallet || !signature) return status();
    const c = readCache();
    const same = c && c.wallet === wallet ? c : blank(wallet);
    writeCache(Object.assign({}, same, { pendingPurchase: String(signature) }));
    return status();
  }

  // ---- watching ----
  let watcher = null;
  function startWatching() {
    if (watcher) return watcher.stop;
    if (isFamily()) { watcher = { stop() { watcher = null; } }; return watcher.stop; } // no timers, no network
    const visible = () => !window.document || window.document.visibilityState !== 'hidden';
    const minutes = Math.max(0.1, Number(cfg.recheckMinutes) || 5);
    const poll = setInterval(() => { if (visible()) refresh(); }, minutes * 60 * 1000);
    const clock = setInterval(emitIfChanged, 30 * 1000);
    const onResume = () => { if (visible()) refresh(); };
    if (window.document) window.document.addEventListener('visibilitychange', onResume);
    window.addEventListener('online', onResume);
    const offWallet = window.Wallet && window.Wallet.onChange ? window.Wallet.onChange(() => { emitIfChanged(); refresh(); }) : null;
    watcher = {
      stop() {
        clearInterval(poll); clearInterval(clock);
        if (window.document) window.document.removeEventListener('visibilitychange', onResume);
        window.removeEventListener('online', onResume);
        if (offWallet) offWallet();
        watcher = null;
      },
    };
    emitIfChanged();
    refresh();
    return watcher.stop;
  }

  lastKey = keyOf(status());

  window.IsabellaEntitlement = {
    status,
    refresh,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    startWatching,
    revokeLocal,
    notePurchase,
    // helpers shared with payments.js and the tests
    referenceFor,
    findPurchase,
    poolTokenBalance,
    verifyPurchaseTransaction,
    priceUnits,
    STORE_KEY,
    _env: env,
  };
})();
