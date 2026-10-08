/* Isabella Ocean — RPC relay (Cloudflare Worker, module syntax, no build step, no dependencies).
 *
 * The store app's page talks JSON-RPC to Solana. A provider key packed into an APK can be extracted,
 * so the app is given this relay's address instead, and the relay holds the provider URL (with its
 * key) as the Worker secret UPSTREAM_RPC_URL.
 *
 *   POST /        JSON-RPC 2.0, single or batch -> forwarded upstream if every rule below passes
 *   OPTIONS /     CORS preflight
 *   GET /         "ok" (health; says nothing else)
 *
 * What it enforces: POST only, a body cap, a batch cap, the method allow-list below, one narrowed
 * method (getProgramAccounts), and a per-address rate limit. What it does NOT do: authenticate the
 * app. Anyone who learns the address can call the allowed methods at the allowed rate
 * (docs/RPC-RELAY.md). The Origin header is not checked: the app's page is file:///android_asset/…,
 * so its Origin is "null" or "file://", which any caller can send.
 *
 * The upstream URL is never logged (this file logs nothing at all) and never put in a response: every
 * failure answers with fixed text, and an upstream answer that contains any part of the URL is replaced.
 */

/**
 * Every JSON-RPC method the store app calls, and nothing else. Derived by running the app's real
 * scripts behind a logging proxy (rpc-relay/tools/observe-app.mjs; recording in
 * rpc-relay/observed-methods.json) and cross-checked against web/entitlement.js and web/payments.js;
 * rpc-relay/test/app-methods.test.mjs fails when the app's code calls a method that is not here.
 * "web3 name" below is the @solana/web3.js Connection method when it differs from the RPC method.
 */
export const ALLOWED_METHODS = Object.freeze([
  // Is World 2 open? Runs at boot, every 5 minutes while visible, on resume, and after every payment
  // (entitlement.js refresh): the wallet's OCEAN balance and its purchase, found by reference key.
  'getTokenAccountsByOwner', // web3 name getParsedTokenAccountsByOwner; also the payable-token list
  'getSignaturesForAddress', // purchases by reference key (Restore purchase); also the "wallet went quiet" lookup
  'getTransaction', // checks a purchase paid the merchant; also the "wallet went quiet" lookup

  // Reading the pool and the wallet before any stake, exit, claim or purchase (payments.js).
  'getAccountInfo', // pool, validator list, reserve, mints, token accounts, stake history, lookup tables (web3 getAddressLookupTable)
  'getBalance', // enough SOL to stake or pay? Also the payable-token list
  'getEpochInfo', // has the pool been updated this epoch? When is a slow exit ready?
  'getMinimumBalanceForRentExemption', // rent for a token account, a stake account, the reserve
  'getTokenAccountBalance', // paying with USDC directly: is there enough?

  // Slow exit and claim only.
  'getMultipleAccounts', // web3 name getMultipleAccountsInfo: validator stake accounts, the 16 exit addresses
  'getStakeMinimumDelegation', // the smallest stake a slow exit may create
  'getRecentPerformanceSamples', // slot time, to estimate when a slow exit is ready
  'getProgramAccounts', // the parent's own stake accounts; narrowed to exactly that query (see programAccountsAllowed)

  // Every transaction: built, simulated before the wallet opens, then confirmed by polling over HTTP.
  'getLatestBlockhash',
  'simulateTransaction',
  'getSignatureStatuses', // confirmation and finalization polling (the app opens no WebSocket)
  'getBlockHeight', // has the blockhash expired?

  // NOT here on purpose: sendTransaction. On the phone the wallet signs AND sends (Mobile Wallet Adapter
  // signAndSendTransactions, WalletBridge.java) through its own RPC. The only app-side send is the
  // desktop dev wallet in web/wallet.js (?devwallet=1, devnet, no Android bridge), which is not the store app.
]);
const ALLOWED = new Set(ALLOWED_METHODS);

export const LIMITS = Object.freeze({
  maxBodyBytes: 32 * 1024, // the app's largest request is a simulateTransaction of one 1232-byte packet: about 2 KB
  maxBatch: 10, // the app sends no batches at all; a small allowance for web3.js's own batch helpers
  upstreamTimeoutMs: 25000,
});

const STAKE_PROGRAM = 'Stake11111111111111111111111111111111111111';
const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, solana-client', // web3.js sends solana-client on every call
  'Access-Control-Max-Age': '86400',
});

// Messages are read by web/payments.js: a 429 or 502 status is retried and then shown as "could not reach
// the Solana network"; the other texts must stay clear of the words it treats as a network failure.
const E = Object.freeze({
  parse: [400, -32700, 'The request body is not valid JSON.'],
  invalid: [400, -32600, 'Not a JSON-RPC 2.0 request.'],
  tooLarge: [413, -32600, 'The request body is too large for this relay.'],
  tooMany: [400, -32600, 'Too many calls in one batch for this relay.'],
  method: [403, -32601, 'Method not allowed by this relay.'],
  limited: [429, -32429, 'Too many requests from this address. Wait a minute and try again.'],
  upstream: [502, -32000, 'The relay could not get an answer from Solana. Try again.'],
  config: [503, -32000, 'The relay is not set up.'],
});

function respond(status, body, extra) {
  return new Response(body, { status, headers: Object.assign({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, CORS, extra || {}) });
}
function text(status, body, extra) { return respond(status, body, Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, extra || {})); }
function json(status, value, extra) { return respond(status, JSON.stringify(value), Object.assign({ 'Content-Type': 'application/json' }, extra || {})); }
function rpcError(kind, id, detail) {
  const [, code, message] = E[kind];
  return { jsonrpc: '2.0', error: { code, message: detail ? message + ' ' + detail : message }, id: id === undefined ? null : id };
}
function fail(kind, id, extra) { return json(E[kind][0], rpcError(kind, id), extra); }
const validId = (id) => id === null || typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id));

/** One JSON-RPC call: 'ok', or the kind of error it earns. */
function judge(call) {
  if (!call || typeof call !== 'object' || Array.isArray(call)) return 'invalid';
  if (call.jsonrpc !== '2.0' || typeof call.method !== 'string' || !validId(call.id)) return 'invalid';
  if (call.params !== undefined && (call.params === null || typeof call.params !== 'object')) return 'invalid';
  if (!ALLOWED.has(call.method)) return 'method';
  if (call.method === 'getProgramAccounts' && !programAccountsAllowed(call.params)) return 'method';
  return 'ok';
}

/**
 * getProgramAccounts is the one costly method on the list. The app makes exactly one such query
 * (payments.js ownStakeAccounts): the Stake program, 200-byte accounts, a memcmp on the withdrawer.
 * Anything else is refused, so the relay cannot be used to scan a whole program.
 */
function programAccountsAllowed(params) {
  if (!Array.isArray(params) || params[0] !== STAKE_PROGRAM) return false;
  const filters = params[1] && params[1].filters;
  if (!Array.isArray(filters) || filters.length > 4) return false;
  return filters.some((f) => f && f.dataSize === 200) && filters.some((f) => f && f.memcmp && typeof f.memcmp.bytes === 'string');
}

/** Read at most `cap` bytes of the body. Resolves the text, or null when it is larger. */
async function readCapped(request, cap) {
  const declared = Number(request.headers.get('content-length'));
  if (declared > cap) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { try { await reader.cancel(); } catch (e) { /* already closed */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

/** The pieces of the upstream URL that must never reach a caller: all of it, its host, its key. */
function secretsOf(upstream) {
  const out = new Set([upstream]);
  try {
    const u = new URL(upstream);
    out.add(u.host);
    out.add(u.hostname);
    for (const v of u.searchParams.values()) if (v.length >= 8) out.add(v);
    for (const seg of u.pathname.split('/')) if (seg.length >= 16) out.add(seg);
  } catch (e) { /* not a URL: handled by the caller */ }
  return Array.from(out).filter(Boolean);
}

/** POST the body upstream. Resolves the answer's text, or null on any failure (never a reason). */
async function askUpstream(fetcher, upstream, body) {
  let res;
  try {
    res = await fetcher(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(LIMITS.upstreamTimeoutMs),
    });
  } catch (e) { return null; } // the error text can carry the URL: drop it
  let answer;
  try { answer = await res.text(); } catch (e) { return null; }
  if (res.status === 429) return { limited: true };
  if (!res.ok) return null;
  for (const s of secretsOf(upstream)) if (answer.includes(s)) return null;
  return { text: answer };
}

/**
 * The rate-limit key: an IPv4 address as it is, or the /64 of an IPv6 address (one home or phone is
 * handed a whole /64, so limiting single IPv6 addresses would limit nothing).
 */
export function callerKey(ip) {
  const text = String(ip || '').trim().toLowerCase();
  if (!text) return 'unknown';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (mapped) return mapped[1];
  if (!text.includes(':')) return text;
  const [head, tail] = text.split('::');
  const front = head ? head.split(':') : [];
  const back = tail ? tail.split(':') : [];
  const groups = tail === undefined ? front : front.concat(Array(Math.max(0, 8 - front.length - back.length)).fill('0'), back);
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

async function charge(limiter, key, times) {
  for (let i = 0; i < times; i++) {
    const r = await limiter.limit({ key });
    if (!r || r.success !== true) return false;
  }
  return true;
}

export function createRelay(fetcher) {
  return async function handle(request, env) {
    const url = new URL(request.url);
    // Belt and braces for "workers_dev": false in wrangler.jsonc: never answer on a workers.dev name.
    if (url.hostname === 'workers.dev' || url.hostname.endsWith('.workers.dev')) return new Response(null, { status: 404 });
    if (url.pathname !== '/') return text(404, 'not found\n');
    const method = request.method;
    if (method === 'OPTIONS') return respond(204, null);
    if (method === 'GET' || method === 'HEAD') {
      if ((request.headers.get('upgrade') || '').toLowerCase() === 'websocket') return text(426, 'This relay speaks JSON-RPC over HTTP POST only.\n');
      return text(200, method === 'HEAD' ? null : 'ok\n');
    }
    if (method !== 'POST') return text(405, 'POST only\n', { Allow: 'POST, OPTIONS' });

    const upstream = env && typeof env.UPSTREAM_RPC_URL === 'string' ? env.UPSTREAM_RPC_URL.trim() : '';
    const limiter = env && env.RPC_LIMITER;
    if (!/^https?:\/\/[^\s]+$/.test(upstream) || !limiter || typeof limiter.limit !== 'function') return fail('config', null);

    // Rate limit first, so refused and malformed requests are counted too.
    const who = callerKey(request.headers.get('cf-connecting-ip'));
    const retry = { 'Retry-After': '60' };
    let within;
    try { within = await charge(limiter, who, 1); } catch (e) { return fail('config', null); }
    if (!within) return fail('limited', null, retry);

    let raw;
    try { raw = await readCapped(request, LIMITS.maxBodyBytes); } catch (e) { return fail('invalid', null); }
    if (raw === null) return fail('tooLarge', null);
    let body;
    try { body = JSON.parse(raw); } catch (e) { return fail('parse', null); }

    if (!Array.isArray(body)) {
      const verdict = judge(body);
      const id = body && typeof body === 'object' && validId(body.id) ? body.id : null;
      if (verdict !== 'ok') return fail(verdict, id);
      const up = await askUpstream(fetcher, upstream, JSON.stringify(body));
      if (up && up.limited) return fail('limited', id, retry);
      if (!up) return fail('upstream', id);
      return respond(200, up.text, { 'Content-Type': 'application/json' });
    }

    if (body.length === 0) return fail('invalid', null);
    if (body.length > LIMITS.maxBatch) return fail('tooMany', null);
    try { within = await charge(limiter, who, body.length - 1); } catch (e) { return fail('config', null); } // a batch costs one per call
    if (!within) return fail('limited', null, retry);

    // Refused calls are answered here; the allowed ones go upstream together and are merged back in order.
    const verdicts = body.map(judge);
    const out = body.map((call, i) => (verdicts[i] === 'ok' ? null : rpcError(verdicts[i], call && typeof call === 'object' && validId(call.id) ? call.id : null)));
    const allowed = body.filter((call, i) => verdicts[i] === 'ok');
    if (!allowed.length) return json(verdicts.includes('method') ? 403 : 400, out);
    const up = await askUpstream(fetcher, upstream, JSON.stringify(allowed));
    if (up && up.limited) return fail('limited', null, retry);
    let answers = null;
    if (up) { try { answers = JSON.parse(up.text); } catch (e) { answers = null; } }
    if (!Array.isArray(answers) || answers.length !== allowed.length) return fail('upstream', null);
    let next = 0;
    return json(200, out.map((own) => own || answers[next++]));
  };
}

export default { fetch: createRelay((input, init) => fetch(input, init)) };
