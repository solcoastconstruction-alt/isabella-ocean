/* Isabella the Mermaid — window.Wallet (Contract 2) over the Android bridge (Contract 1).
 *
 *   Wallet.available()        -> boolean (sync): an MWA wallet app is installed (or the dev mock is on)
 *   Wallet.connect()          -> Promise<base58 public key>
 *   Wallet.signAndSend(txs)   -> Promise<base58 signature[]>; txs = Transaction | VersionedTransaction | Uint8Array | base64, or an array
 *   Wallet.publicKey          -> base58 string | null (restored from IsabellaWallet.savedPublicKey(chain) at load)
 *   Wallet.disconnect()
 * Extras used by payments.js / entitlement.js: Wallet.connection(), Wallet.onChange(fn), Wallet.isDevMock,
 * Wallet.chain, Wallet.walletLabel.
 *
 * Rejections are Errors whose .code is one of the paywall's: 'cancelled' (also .cancelled = true),
 * 'no-wallet', 'funds', 'offline', 'failed'. .reason says exactly what happened (CANCELLED, NO_WALLET,
 * UNSUPPORTED_CHAIN, WALLET_TIMEOUT, MAYBE_SUBMITTED, INSUFFICIENT_SOL, OFFLINE, WALLET_ERROR, BAD_TX) and
 * .message is a sentence a parent can read. MAYBE_SUBMITTED (also .maybeSubmitted = true): the wallet went
 * quiet during a send, so the transaction may still land; check on-chain before retrying (payments.js does).
 *
 * Bridge as built: available() returns the string "true"/"false"; __walletResult(id, json) gets a JSON
 * string and the numeric id; results may carry noWallet, timeout, unsupportedChain, maybeSubmitted, and
 * publicKey when the wallet's account changed. In the family flavor window.IsabellaWallet is undefined and
 * this file does nothing on load (no RPC, no timers).
 *
 * Dev mock: used ONLY when there is no Android bridge AND config.cluster is 'devnet' AND the page URL
 * has ?devwallet=1. It keeps a devnet keypair in localStorage ('isabella.devwallet') and signs locally.
 */
(function () {
  'use strict';
  const cfg = window.IsabellaConfig || {};
  const L = window.SolanaLib;
  const chain = cfg.chain || 'solana:devnet';
  const bridge = window.IsabellaWallet || null;
  const MOCK_KEY = 'isabella.devwallet';
  const MOCK_CONNECTED = 'isabella.devwallet.connected';
  // A wallet prompt waits on a person; this only catches a lost callback. Longer than the bridge's own
  // 10-minute backstop, so after Android thaws the app the bridge's real answer wins the race.
  const TIMEOUT_MS = 11 * 60 * 1000;

  const CODE_OF = { CANCELLED: 'cancelled', NO_WALLET: 'no-wallet', INSUFFICIENT_SOL: 'funds', INSUFFICIENT_FUNDS: 'funds', OFFLINE: 'offline' };
  function walletError(reason, message, extra) {
    const e = new Error(message);
    e.reason = reason;
    e.code = CODE_OF[reason] || 'failed';
    if (reason === 'CANCELLED') e.cancelled = true;
    if (extra) Object.assign(e, extra);
    return e;
  }
  /** Sort a wallet or RPC error message into funds / offline / other (the bare word "network" is not enough). */
  function classify(message, fallbackReason) {
    const m = String(message || '');
    if (/insufficient (lamports|funds)|no record of a prior credit|not enough sol/i.test(m)) return walletError('INSUFFICIENT_SOL', 'The wallet does not have enough SOL for this.', { detail: m });
    if (/failed to fetch|fetch failed|network request failed|offline|no internet|internet connection|unable to resolve|ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(m)) return walletError('OFFLINE', 'The phone could not reach the Solana network. Check the internet connection and try again.', { detail: m });
    return walletError(fallbackReason || 'WALLET_ERROR', m ? 'The wallet reported a problem: ' + m : 'The wallet reported a problem.', { detail: m });
  }

  const search = (window.location && window.location.search) || '';
  const devMock = !bridge && cfg.cluster === 'devnet' && /[?&]devwallet=1(?:&|$)/.test(search);

  let publicKey = null;
  let walletLabel = null;
  const listeners = new Set();
  function setKey(pk, label) {
    const next = pk ? String(pk) : null;
    walletLabel = label || walletLabel;
    if (next === publicKey) return;
    publicKey = next;
    for (const fn of listeners) { try { fn(publicKey); } catch (e) { /* a listener's bug is not ours */ } }
  }

  // ---- Android bridge: async calls return at once; Java later calls window.__walletResult(id, json) ----
  const pending = new Map();
  let nextId = 1;
  const earlierResultHandler = window.__walletResult;
  window.__walletResult = function (id, json) {
    const key = String(id);
    const p = pending.get(key);
    if (!p) { if (typeof earlierResultHandler === 'function') earlierResultHandler(id, json); return; }
    pending.delete(key);
    clearTimeout(p.timer);
    let r = json;
    if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = { ok: false, error: 'The wallet sent an unreadable answer.' }; } }
    if (!r || typeof r !== 'object') r = { ok: false, error: 'The wallet sent an empty answer.' };
    p.resolve(r);
  };

  function bridgeCall(method, onTimeout, ...args) {
    return new Promise((resolve, reject) => {
      const id = nextId++; // a JS number: converts cleanly whether the Java side takes int or String
      const timer = setTimeout(() => { pending.delete(String(id)); reject(onTimeout()); }, TIMEOUT_MS);
      pending.set(String(id), { resolve, timer });
      try {
        bridge[method](id, ...args);
      } catch (e) {
        pending.delete(String(id));
        clearTimeout(timer);
        reject(walletError('WALLET_ERROR', 'Could not reach the wallet app: ' + (e && e.message)));
      }
    });
  }

  function failure(r) {
    if (r.publicKey && String(r.publicKey) !== publicKey) setKey(String(r.publicKey));
    const msg = r.error ? String(r.error) : '';
    if (r.cancelled) return walletError('CANCELLED', msg || 'Cancelled in the wallet.');
    if (r.noWallet) return walletError('NO_WALLET', 'No Solana wallet app is installed on this phone.');
    if (r.unsupportedChain) return walletError('UNSUPPORTED_CHAIN', 'The wallet app does not support ' + chain + '.');
    if (r.maybeSubmitted) return walletError('MAYBE_SUBMITTED', 'The wallet stopped answering after it may have sent the transaction.', { maybeSubmitted: true, detail: msg });
    if (r.timeout) return walletError('WALLET_TIMEOUT', 'The wallet app did not answer in time.', { detail: msg });
    if (Array.isArray(r.signatures)) { // MWA NOT_SUBMITTED: signed, but the wallet's send was refused (often a slow approval)
      return walletError('NOT_SUBMITTED', 'The wallet signed, but Solana did not take the transaction, so nothing was spent. Please try again.', { detail: msg, signatures: r.signatures });
    }
    if (/^busy/i.test(msg)) return walletError('WALLET_BUSY', 'The wallet is still busy with the previous request. Please wait a moment and try again.', { detail: msg });
    return classify(msg, 'WALLET_ERROR');
  }

  // ---- dev mock (desktop browser, devnet, ?devwallet=1 only) ----
  let mockKeypair = null;
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private window */ } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* private window */ } }
  function mockLoad(create) {
    if (mockKeypair) return mockKeypair;
    const saved = lsGet(MOCK_KEY);
    if (saved) {
      try { mockKeypair = L.web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(saved))); } catch (e) { mockKeypair = null; }
    }
    if (!mockKeypair && create) {
      mockKeypair = L.web3.Keypair.generate();
      lsSet(MOCK_KEY, JSON.stringify(Array.from(mockKeypair.secretKey)));
    }
    return mockKeypair;
  }

  let sharedConnection = null;
  function connection() {
    // web3.js's own 429 retry reports through console.error; payments.js retries reads itself, and a
    // failed entitlement check just keeps the cached result, so leave rate limits to the callers.
    if (!sharedConnection) sharedConnection = new L.web3.Connection(cfg.rpcUrl, { commitment: 'confirmed', disableRetryOnRateLimit: true });
    return sharedConnection;
  }

  function toBase64(tx) {
    if (typeof tx === 'string') return tx;
    let bytes;
    if (tx instanceof Uint8Array) bytes = tx;
    else if (tx instanceof L.web3.VersionedTransaction) bytes = tx.serialize();
    else if (tx instanceof L.web3.Transaction) bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    else throw walletError('BAD_TX', 'Wallet.signAndSend takes transactions, bytes or base64 strings.');
    return L.Buffer.from(bytes).toString('base64');
  }

  async function mockSignAndSend(b64s) {
    const kp = mockLoad(false);
    if (!kp) throw walletError('NO_WALLET', 'The dev wallet is not connected.');
    const conn = connection();
    const sigs = [];
    for (const b64 of b64s) {
      const tx = L.web3.VersionedTransaction.deserialize(L.Buffer.from(b64, 'base64'));
      if (!tx.message.staticAccountKeys[0].equals(kp.publicKey)) throw walletError('WALLET_ERROR', 'The fee payer is not the dev wallet.');
      tx.sign([kp]);
      try { sigs.push(await conn.sendRawTransaction(tx.serialize(), { preflightCommitment: 'confirmed', maxRetries: 5 })); } catch (e) { throw classify(e && e.message, 'WALLET_ERROR'); }
    }
    return sigs;
  }

  // ---- restore the saved key (nothing else happens on load) ----
  if (bridge) {
    try { const k = bridge.savedPublicKey(chain); if (k && String(k) !== 'null') publicKey = String(k); } catch (e) { /* older bridge */ }
  } else if (devMock && lsGet(MOCK_CONNECTED) === '1' && mockLoad(false)) {
    publicKey = mockKeypair.publicKey.toBase58();
  }

  const Wallet = {
    get publicKey() { return publicKey; },
    get walletLabel() { return walletLabel; },
    get isDevMock() { return devMock; },
    chain,

    available() {
      if (bridge) { try { return String(bridge.available()) === 'true'; } catch (e) { return false; } }
      return devMock;
    },

    async connect() {
      if (bridge) {
        if (!Wallet.available()) throw walletError('NO_WALLET', 'No Solana wallet app is installed on this phone.');
        const r = await bridgeCall('connect', () => walletError('WALLET_TIMEOUT', 'The wallet app did not answer.'), chain);
        if (!r.ok || !r.publicKey) throw failure(r);
        setKey(String(r.publicKey), r.walletLabel);
        return publicKey;
      }
      if (devMock) {
        const kp = mockLoad(true);
        lsSet(MOCK_CONNECTED, '1');
        setKey(kp.publicKey.toBase58(), 'Dev wallet (devnet)');
        if (window.console) console.info('[devwallet] ' + publicKey + ' (devnet; fund it to test)');
        return publicKey;
      }
      throw walletError('NO_WALLET', 'No Solana wallet is available here.');
    },

    async signAndSend(txs) {
      const list = Array.isArray(txs) ? txs : [txs];
      if (!list.length) return [];
      if (!publicKey) throw walletError('NO_WALLET', 'Connect a wallet first.');
      const b64s = list.map(toBase64);
      if (bridge) {
        const r = await bridgeCall('signAndSend',
          () => walletError('MAYBE_SUBMITTED', 'The wallet app stopped answering; the transaction may still land.', { maybeSubmitted: true }),
          chain, JSON.stringify(b64s));
        if (!r.ok) throw failure(r);
        if (r.publicKey && String(r.publicKey) !== publicKey) setKey(String(r.publicKey));
        const sigs = Array.isArray(r.signatures) ? r.signatures.map(String) : [];
        if (sigs.length !== b64s.length) throw walletError('WALLET_ERROR', 'The wallet returned ' + sigs.length + ' signatures for ' + b64s.length + ' transactions.');
        return sigs;
      }
      if (devMock) return mockSignAndSend(b64s);
      throw walletError('NO_WALLET', 'No Solana wallet is available here.');
    },

    disconnect() {
      if (bridge) { try { bridge.disconnect(chain); } catch (e) { /* nothing to forget */ } }
      if (devMock) lsDel(MOCK_CONNECTED); // keep the dev keypair (and its devnet SOL) for next time
      setKey(null);
    },

    /** Shared RPC connection to config.rpcUrl (commitment 'confirmed'). Tests may replace this function. */
    connection,

    /** fn(publicKeyOrNull) after connect/disconnect/account change. Returns an unsubscribe function. */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** The error shape every module uses (code from the paywall's set, precise reason, readable message). */
    error: walletError,
    classifyError: classify,
  };

  window.Wallet = Wallet;
})();
