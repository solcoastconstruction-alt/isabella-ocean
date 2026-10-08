// Offline tests for the relay's guards, against the Worker's own handler with a fake upstream and a
// fake rate-limit binding. Every response the relay produces in this file is kept, and the last test
// asserts that no part of the upstream URL appears in any of them.
// Run: node rpc-relay/test/relay.test.mjs     (RELAY_SRC=/path/index.js tests a mutated copy; see mutants.mjs)
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.RELAY_SRC || resolve(here, '../src/index.js');
const { createRelay, callerKey, ALLOWED_METHODS, LIMITS } = await import(pathToFileURL(SRC).href);

let passed = 0;
const t = async (name, fn) => { await fn(); passed++; console.log(`ok - ${name}`); };

// The upstream URL carries three markers; none may ever reach a caller.
const MARKERS = ['upstream-host-marker.invalid', 'PATHMARKER0123456789abcdef', 'KEYMARKER-0123-4567'];
const UPSTREAM = `https://${MARKERS[0]}/v1/${MARKERS[1]}?api-key=${MARKERS[2]}`;
const STAKE = 'Stake11111111111111111111111111111111111111';
const WALLET = '8JBFM9Uf67yX61aT3vs1b1dRN6Bd86yhuZnuL41bd5T3';
const GPA_PARAMS = [STAKE, { commitment: 'confirmed', encoding: 'base64', filters: [{ dataSize: 200 }, { memcmp: { offset: 44, bytes: WALLET } }] }];
const call = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, params: params === undefined ? [] : params });

// ---- fakes ----
function makeUpstream(mode = 'ok') {
  const up = { calls: [], mode };
  up.fetch = async (url, init) => {
    up.calls.push({ url, init, body: init.body });
    if (up.mode === 'throw') throw new Error('connect ECONNREFUSED ' + url);
    if (up.mode === '500') return new Response('upstream exploded at ' + url, { status: 500 });
    if (up.mode === '429') return new Response('{"error":"slow down ' + MARKERS[2] + '"}', { status: 429 });
    if (up.mode === 'redirect') return new Response(null, { status: 302, headers: { Location: url + '&again=1' } });
    if (up.mode === 'echo-key') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'bad key ' + MARKERS[2] } }), { status: 200 });
    if (up.mode === 'echo-host') return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'served by ' + MARKERS[0] }), { status: 200 });
    if (up.mode === 'not-json') return new Response('<html>gateway</html>', { status: 200 });
    if (up.mode === 'short') return new Response('[]', { status: 200 });
    const sent = JSON.parse(init.body);
    const answer = (c) => ({ jsonrpc: '2.0', id: c.id, result: 'result-of-' + c.method });
    return new Response(JSON.stringify(Array.isArray(sent) ? sent.map(answer) : answer(sent)), { status: 200, headers: { 'content-type': 'application/json', 'x-upstream-secret': MARKERS[2] } });
  };
  return up;
}
function makeLimiter(limit = Infinity) {
  const lim = { counts: new Map(), keys: [], broken: false };
  lim.limit = async ({ key }) => {
    if (lim.broken) throw new Error('limiter down');
    lim.keys.push(key);
    const n = (lim.counts.get(key) || 0) + 1;
    lim.counts.set(key, n);
    return { success: n <= limit };
  };
  return lim;
}

const seen = []; // every response the relay gave, for the leak sweep at the end
async function ask(relay, env, { method = 'POST', body, headers = {}, url = 'https://rpc.isabellaocean.app/', ip = '203.0.113.7', duplex } = {}) {
  const h = Object.assign({}, headers);
  if (ip) h['cf-connecting-ip'] = ip;
  const init = { method, headers: h };
  if (body !== undefined) { init.body = typeof body === 'string' || body instanceof ReadableStream ? body : JSON.stringify(body); if (!h['content-type']) h['content-type'] = 'application/json'; }
  if (duplex) init.duplex = duplex;
  const res = await relay(new Request(url, init), env);
  const text = await res.text();
  const head = Array.from(res.headers.entries()).map(([k, v]) => k + ': ' + v).join('\n');
  seen.push({ status: res.status, head, text });
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) { /* not JSON */ }
  return { status: res.status, headers: res.headers, text, json: parsed };
}
function setup({ mode = 'ok', limit = Infinity } = {}) {
  const up = makeUpstream(mode);
  const limiter = makeLimiter(limit);
  return { up, limiter, relay: createRelay(up.fetch), env: { UPSTREAM_RPC_URL: UPSTREAM, RPC_LIMITER: limiter } };
}

// ---------------------------------------------------------------- routes
await t('GET / is a health line that says nothing: exactly "ok"', async () => {
  const { relay, env, up } = setup();
  const r = await ask(relay, env, { method: 'GET' });
  assert.equal(r.status, 200);
  assert.equal(r.text, 'ok\n');
  assert.match(r.headers.get('content-type'), /^text\/plain/);
  assert.equal(up.calls.length, 0, 'health never touches the upstream');
});
await t('other paths are 404, and never reach the upstream', async () => {
  const { relay, env, up } = setup();
  assert.equal((await ask(relay, env, { method: 'GET', url: 'https://rpc.isabellaocean.app/status' })).status, 404);
  assert.equal((await ask(relay, env, { url: 'https://rpc.isabellaocean.app/v1', body: call('getBlockHeight') })).status, 404);
  assert.equal(up.calls.length, 0);
});
await t('non-POST methods are refused with 405 and never reach the upstream', async () => {
  const { relay, env, up } = setup();
  for (const method of ['PUT', 'DELETE', 'PATCH']) {
    const r = await ask(relay, env, { method, body: call('getBlockHeight') });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.get('allow'), 'POST, OPTIONS');
  }
  assert.equal(up.calls.length, 0);
});
await t('CORS preflight: 204, any origin, POST, and the two headers web3.js sends', async () => {
  const { relay, env, up, limiter } = setup();
  for (const origin of ['null', 'file://']) {
    const r = await ask(relay, env, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,solana-client' } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.match(r.headers.get('access-control-allow-methods'), /POST/);
    const allowed = r.headers.get('access-control-allow-headers').toLowerCase().split(/,\s*/);
    assert.ok(allowed.includes('content-type') && allowed.includes('solana-client'), 'allows content-type and solana-client');
  }
  assert.equal(up.calls.length, 0);
  assert.equal(limiter.keys.length, 0, 'a preflight is not charged');
});
await t('errors carry the CORS header too, so the page can read them', async () => {
  const { relay, env } = setup();
  const r = await ask(relay, env, { body: call('sendTransaction', ['AA==']) });
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
});
await t('a workers.dev hostname gets a bare 404', async () => {
  const { relay, env, up } = setup();
  for (const url of ['https://isabella-ocean-rpc.someone.workers.dev/', 'https://abc123-isabella-ocean-rpc.someone.workers.dev/']) {
    const r = await ask(relay, env, { url, body: call('getBlockHeight') });
    assert.equal(r.status, 404);
    assert.equal(r.text, '');
    assert.equal((await ask(relay, env, { url, method: 'GET' })).status, 404);
  }
  assert.equal(up.calls.length, 0);
});
await t('a WebSocket upgrade is refused with 426 (the relay is HTTP only)', async () => {
  const { relay, env, up } = setup();
  const r = await ask(relay, env, { method: 'GET', headers: { Upgrade: 'websocket', Connection: 'Upgrade' } });
  assert.equal(r.status, 426);
  assert.equal(up.calls.length, 0);
});

// ---------------------------------------------------------------- allow-list
await t('an allowed call is forwarded: same body, POST, no caller headers, answer passed back', async () => {
  const { relay, env, up } = setup();
  const body = call('getBalance', [WALLET, { commitment: 'confirmed' }], 'abc');
  const r = await ask(relay, env, { body, headers: { authorization: 'Bearer caller-token', cookie: 'a=b', 'solana-client': 'js/1.99.0' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { jsonrpc: '2.0', id: 'abc', result: 'result-of-getBalance' });
  assert.equal(r.headers.get('x-upstream-secret'), null, 'upstream headers are not copied to the caller');
  assert.equal(up.calls.length, 1);
  assert.equal(up.calls[0].url, UPSTREAM);
  assert.equal(up.calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(up.calls[0].body), body);
  assert.deepEqual(Object.keys(up.calls[0].init.headers).map((k) => k.toLowerCase()), ['content-type'], 'only Content-Type goes upstream (no caller address, token or cookie)');
});
await t(`all ${ALLOWED_METHODS.length} allowed methods pass`, async () => {
  const { relay, env, up } = setup();
  assert.ok(ALLOWED_METHODS.length >= 10, 'the list is not empty');
  for (const m of ALLOWED_METHODS) {
    const r = await ask(relay, env, { body: call(m, m === 'getProgramAccounts' ? GPA_PARAMS : []) });
    assert.equal(r.status, 200, m);
    assert.equal(r.json.result, 'result-of-' + m);
  }
  assert.equal(up.calls.length, ALLOWED_METHODS.length);
});
await t('methods off the list are refused with a JSON-RPC error and never reach the upstream', async () => {
  const { relay, env, up } = setup();
  const refused = ['sendTransaction', 'requestAirdrop', 'getSlot', 'getBlock', 'getLargestAccounts', 'getSupply', 'getTokenLargestAccounts', 'getVoteAccounts',
    'GETBALANCE', 'getBalance ', '', 'constructor', '__proto__', 'toString', 'has'];
  for (const m of refused) {
    const r = await ask(relay, env, { body: call(m, [], 9) });
    assert.equal(r.status, 403, JSON.stringify(m));
    assert.equal(r.json.error.code, -32601);
    assert.equal(r.json.id, 9);
    assert.equal(r.json.jsonrpc, '2.0');
  }
  assert.equal(up.calls.length, 0);
  assert.ok(!ALLOWED_METHODS.includes('sendTransaction'), 'the wallet sends; the app does not');
});
await t('getProgramAccounts passes only as the app\'s own stake-account query', async () => {
  const { relay, env, up } = setup();
  assert.equal((await ask(relay, env, { body: call('getProgramAccounts', GPA_PARAMS) })).status, 200);
  const bad = [
    ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', GPA_PARAMS[1]], // another program
    [STAKE], // the whole Stake program
    [STAKE, { filters: [] }],
    [STAKE, { filters: [{ dataSize: 200 }] }], // every stake account on the cluster
    [STAKE, { filters: [{ memcmp: { offset: 44, bytes: WALLET } }] }],
    [STAKE, { filters: [{ dataSize: 4008 }, { memcmp: { offset: 44, bytes: WALLET } }] }],
    [], undefined,
  ];
  for (const params of bad) {
    const body = { jsonrpc: '2.0', id: 1, method: 'getProgramAccounts' };
    if (params !== undefined) body.params = params;
    const r = await ask(relay, env, { body });
    assert.equal(r.status, 403, JSON.stringify(params));
  }
  assert.equal(up.calls.length, 1);
});
await t('malformed requests: bad JSON, not JSON-RPC, empty batch', async () => {
  const { relay, env, up } = setup();
  for (const raw of ['', '{', 'getBalance', '{"jsonrpc":"2.0","id":1,"method":"getBalance"', '\u0000']) {
    const r = await ask(relay, env, { body: raw, headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 400, JSON.stringify(raw));
    assert.equal(r.json.error.code, -32700);
  }
  const notRpc = [null, 5, 'getBalance', {}, { method: 'getBalance', id: 1 }, { jsonrpc: '1.0', id: 1, method: 'getBalance' }, { jsonrpc: '2.0', id: 1, method: 7 },
    { jsonrpc: '2.0', id: {}, method: 'getBalance' }, { jsonrpc: '2.0', method: 'getBalance' }, { jsonrpc: '2.0', id: 1, method: 'getBalance', params: 'x' }, []];
  for (const body of notRpc) {
    const r = await ask(relay, env, { body: JSON.stringify(body) });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.json.error.code, -32600);
  }
  assert.equal(up.calls.length, 0);
});

// ---------------------------------------------------------------- batches
await t('a batch of allowed calls is forwarded as one batch', async () => {
  const { relay, env, up } = setup();
  const batch = [call('getBalance', [WALLET], 1), call('getEpochInfo', [], 2), call('getBlockHeight', [], 3)];
  const r = await ask(relay, env, { body: batch });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.map((x) => [x.id, x.result]), [[1, 'result-of-getBalance'], [2, 'result-of-getEpochInfo'], [3, 'result-of-getBlockHeight']]);
  assert.equal(up.calls.length, 1);
  assert.deepEqual(JSON.parse(up.calls[0].body), batch);
});
await t('a mixed batch: allowed calls go upstream, refused ones are answered here, order kept', async () => {
  const { relay, env, up } = setup();
  const batch = [call('sendTransaction', ['AA=='], 'a'), call('getBalance', [WALLET], 'b'), { nonsense: true }, call('getProgramAccounts', [STAKE], 'c'), call('getEpochInfo', [], 'd')];
  const r = await ask(relay, env, { body: batch });
  assert.equal(r.status, 200);
  assert.equal(r.json.length, 5);
  assert.deepEqual(r.json.map((x) => x.id), ['a', 'b', null, 'c', 'd']);
  assert.equal(r.json[0].error.code, -32601);
  assert.equal(r.json[1].result, 'result-of-getBalance');
  assert.equal(r.json[2].error.code, -32600);
  assert.equal(r.json[3].error.code, -32601);
  assert.equal(r.json[4].result, 'result-of-getEpochInfo');
  assert.equal(up.calls.length, 1);
  assert.deepEqual(JSON.parse(up.calls[0].body).map((c) => c.method), ['getBalance', 'getEpochInfo'], 'the refused calls never left the relay');
});
await t('a batch with nothing allowed is refused whole and never reaches the upstream', async () => {
  const { relay, env, up } = setup();
  const r = await ask(relay, env, { body: [call('sendTransaction', ['AA=='], 1), call('getSlot', [], 2)] });
  assert.equal(r.status, 403);
  assert.deepEqual(r.json.map((x) => x.error.code), [-32601, -32601]);
  assert.equal(up.calls.length, 0);
});
await t(`a batch longer than ${LIMITS.maxBatch} is refused; one of exactly ${LIMITS.maxBatch} passes`, async () => {
  const { relay, env, up } = setup();
  const many = (n) => Array.from({ length: n }, (_, i) => call('getBlockHeight', [], i));
  const over = await ask(relay, env, { body: many(LIMITS.maxBatch + 1) });
  assert.equal(over.status, 400);
  assert.equal(over.json.error.code, -32600);
  assert.equal(up.calls.length, 0);
  const at = await ask(relay, env, { body: many(LIMITS.maxBatch) });
  assert.equal(at.status, 200);
  assert.equal(at.json.length, LIMITS.maxBatch);
});

// ---------------------------------------------------------------- body size
await t('an oversize body is refused (declared length), and one at the cap passes', async () => {
  const { relay, env, up } = setup();
  const pad = (bytes) => { const base = JSON.stringify(call('getBalance', [''])); return JSON.stringify(call('getBalance', ['x'.repeat(bytes - base.length)])); };
  const over = await ask(relay, env, { body: pad(LIMITS.maxBodyBytes + 1) });
  assert.equal(over.status, 413);
  assert.equal(up.calls.length, 0);
  assert.equal((await ask(relay, env, { body: pad(100 * 1024) })).status, 413, 'a 100 KB body is refused whatever LIMITS says');
  assert.equal(up.calls.length, 0);
  assert.ok(LIMITS.maxBodyBytes >= 4 * 1024, 'room for the app\'s largest request (about 2 KB)');
  const at = await ask(relay, env, { body: pad(LIMITS.maxBodyBytes) });
  assert.equal(at.status, 200);
  assert.equal(up.calls.length, 1);
});
await t('a declared length over the cap is refused before the body is read', async () => {
  const { relay, env, up } = setup();
  const r = await ask(relay, env, { body: call('getBlockHeight'), headers: { 'content-type': 'application/json', 'content-length': String(LIMITS.maxBodyBytes + 1) } });
  assert.equal(r.status, 413);
  assert.equal(up.calls.length, 0);
});
await t('an oversize body is refused when no length is declared (streamed)', async () => {
  const { relay, env, up } = setup();
  const chunk = new TextEncoder().encode('x'.repeat(4096));
  let sent = 0, pulled = 0;
  const stream = new ReadableStream({
    pull(controller) { pulled++; if (sent > LIMITS.maxBodyBytes * 8) { controller.close(); return; } sent += chunk.byteLength; controller.enqueue(chunk); },
  });
  const r = await ask(relay, env, { body: stream, duplex: 'half', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 413);
  assert.equal(up.calls.length, 0);
  assert.ok(sent <= LIMITS.maxBodyBytes + 4 * chunk.byteLength, `stopped reading soon after the cap (read ${sent} bytes in ${pulled} pulls)`);
});

// ---------------------------------------------------------------- upstream failures
await t('upstream failures answer with fixed text: unreachable, 500, redirect, not JSON, wrong batch length', async () => {
  for (const mode of ['throw', '500', 'redirect']) {
    const { relay, env, up } = setup({ mode });
    const r = await ask(relay, env, { body: call('getBalance', [WALLET], 4) });
    assert.equal(r.status, 502, mode);
    assert.deepEqual(r.json, { jsonrpc: '2.0', error: { code: -32000, message: 'The relay could not get an answer from Solana. Try again.' }, id: 4 });
    assert.equal(up.calls.length, 1);
    const b = await ask(relay, env, { body: [call('getBalance', [WALLET], 5), call('getSlot', [], 6)] });
    assert.equal(b.status, 502, mode + ' batch');
  }
  for (const mode of ['not-json', 'short']) {
    const { relay, env } = setup({ mode });
    const b = await ask(relay, env, { body: [call('getBalance', [WALLET], 5), call('getEpochInfo', [], 6)] });
    assert.equal(b.status, 502, mode);
  }
});
await t('an upstream answer that repeats the key or the host is replaced', async () => {
  for (const mode of ['echo-key', 'echo-host']) {
    const { relay, env } = setup({ mode });
    const r = await ask(relay, env, { body: call('getBalance', [WALLET]) });
    assert.equal(r.status, 502, mode);
    assert.equal(r.json.error.message, 'The relay could not get an answer from Solana. Try again.');
  }
});
await t('an upstream 429 becomes the relay\'s own 429', async () => {
  const { relay, env } = setup({ mode: '429' });
  const r = await ask(relay, env, { body: call('getBalance', [WALLET], 3) });
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, -32429);
  assert.equal(r.json.id, 3);
});
await t('not set up (no secret, a bad secret, no limiter): 503 with fixed text', async () => {
  const { relay, up, limiter } = setup();
  for (const env of [{}, { RPC_LIMITER: limiter }, { UPSTREAM_RPC_URL: '', RPC_LIMITER: limiter }, { UPSTREAM_RPC_URL: 'not a url ' + MARKERS[2], RPC_LIMITER: limiter }, { UPSTREAM_RPC_URL: UPSTREAM }, undefined]) {
    const r = await ask(relay, env, { body: call('getBalance', [WALLET]) });
    assert.equal(r.status, 503);
    assert.equal(r.json.error.message, 'The relay is not set up.');
  }
  assert.equal(up.calls.length, 0);
});

// ---------------------------------------------------------------- rate limit
await t('rate limit: the call past the limit gets HTTP 429 and a JSON-RPC error, and never reaches the upstream', async () => {
  const { relay, env, up } = setup({ limit: 3 });
  for (let i = 0; i < 3; i++) assert.equal((await ask(relay, env, { body: call('getBlockHeight') })).status, 200);
  const r = await ask(relay, env, { body: call('getBlockHeight', [], 8) });
  assert.equal(r.status, 429);
  assert.equal(r.json.jsonrpc, '2.0');
  assert.equal(r.json.error.code, -32429);
  assert.match(r.json.error.message, /Too many requests/);
  assert.equal(r.headers.get('retry-after'), '60');
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.equal(up.calls.length, 3);
});
await t('rate limit is per caller address', async () => {
  const { relay, env, limiter } = setup({ limit: 2 });
  for (let i = 0; i < 3; i++) await ask(relay, env, { body: call('getBlockHeight'), ip: '198.51.100.1' });
  assert.equal((await ask(relay, env, { body: call('getBlockHeight'), ip: '198.51.100.1' })).status, 429);
  assert.equal((await ask(relay, env, { body: call('getBlockHeight'), ip: '198.51.100.2' })).status, 200, 'another address is not affected');
  assert.deepEqual(Array.from(new Set(limiter.keys)).sort(), ['198.51.100.1', '198.51.100.2']);
});
await t('IPv6 callers are limited by their /64, however the address is written', async () => {
  assert.equal(callerKey('203.0.113.7'), '203.0.113.7');
  assert.equal(callerKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(callerKey(null), 'unknown');
  assert.equal(callerKey('2001:db8:12:3400:aaaa:bbbb:cccc:dddd'), '2001:db8:12:3400::/64');
  assert.equal(callerKey('2001:0DB8:0012:3400::1'), '2001:db8:12:3400::/64');
  assert.equal(callerKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(callerKey('::1'), '0:0:0:0::/64');
  const { relay, env } = setup({ limit: 2 });
  for (const ip of ['2001:db8:12:3400::1', '2001:db8:12:3400:ffff:ffff:ffff:ffff']) assert.equal((await ask(relay, env, { body: call('getBlockHeight'), ip })).status, 200);
  assert.equal((await ask(relay, env, { body: call('getBlockHeight'), ip: '2001:db8:12:3400:1:2:3:4' })).status, 429, 'a third address in the same /64 is the same caller');
  assert.equal((await ask(relay, env, { body: call('getBlockHeight'), ip: '2001:db8:12:3401::1' })).status, 200, 'the next /64 is someone else');
});
await t('a batch is charged one per call, and refused requests are charged too', async () => {
  const a = setup({ limit: 6 });
  const batch = Array.from({ length: 5 }, (_, i) => call('getBlockHeight', [], i));
  assert.equal((await ask(a.relay, a.env, { body: batch })).status, 200);
  assert.equal(a.limiter.counts.get('203.0.113.7'), 5);
  const second = await ask(a.relay, a.env, { body: batch });
  assert.equal(second.status, 429, 'two batches of 5 do not fit in a limit of 6');
  assert.equal(a.up.calls.length, 1);
  const b = setup({ limit: 2 });
  for (let i = 0; i < 2; i++) assert.equal((await ask(b.relay, b.env, { body: call('sendTransaction', ['AA==']) })).status, 403);
  assert.equal((await ask(b.relay, b.env, { body: call('getBlockHeight') })).status, 429, 'refused calls used up the allowance');
  assert.equal(b.up.calls.length, 0);
});
await t('a broken limiter closes the relay rather than opening it', async () => {
  const { relay, env, up, limiter } = setup();
  limiter.broken = true;
  const r = await ask(relay, env, { body: call('getBlockHeight') });
  assert.equal(r.status, 503);
  assert.equal(up.calls.length, 0);
});

// ---------------------------------------------------------------- the leak sweep
await t('no response in this whole run contains any part of the upstream URL', async () => {
  assert.ok(seen.length >= 100, `the sweep looked at ${seen.length} responses`);
  const statuses = new Set(seen.map((s) => s.status));
  for (const s of [200, 204, 400, 403, 404, 405, 413, 426, 429, 502, 503]) assert.ok(statuses.has(s), 'the sweep includes a ' + s);
  for (const s of seen) for (const m of MARKERS.concat([UPSTREAM, 'api-key', 'ECONNREFUSED'])) {
    assert.ok(!s.text.includes(m) && !s.head.includes(m), `"${m}" leaked in a ${s.status}: ${s.text.slice(0, 200)}`);
  }
});

console.log(`\n${passed} passed`);
