// Guards for the guards: break one thing at a time in a COPY of the relay (or of the app's scripts)
// and require the named test file to FAIL. Prints "N injections, N caught"; exits 1 if any survives
// or if an injection no longer finds the text it replaces.
// Run: node rpc-relay/test/mutants.mjs      (about a minute)
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const RELAY = 'relay.test.mjs', APP = 'app-methods.test.mjs';

// [test file, what breaks, text to find, replacement] in rpc-relay/src/index.js
const RELAY_MUTANTS = [
  [RELAY, 'the allow-list is not enforced', "if (!ALLOWED.has(call.method)) return 'method';", ''],
  [RELAY, 'sendTransaction slips onto the list', "'getBlockHeight', // has the blockhash expired?", "'getBlockHeight', 'sendTransaction',"],
  [RELAY, 'getProgramAccounts is not narrowed', "if (call.method === 'getProgramAccounts' && !programAccountsAllowed(call.params)) return 'method';", ''],
  [RELAY, 'getProgramAccounts on any program', 'params[0] !== STAKE_PROGRAM', 'false'],
  [RELAY, 'getProgramAccounts without the size filter', 'filters.some((f) => f && f.dataSize === 200) && ', ''],
  [RELAY, 'a request that is not JSON-RPC is forwarded', "if (call.jsonrpc !== '2.0' || typeof call.method !== 'string' || !validId(call.id)) return 'invalid';", "if (typeof call.method !== 'string') return 'invalid';"],
  [RELAY, 'bad JSON is turned into a call', "try { body = JSON.parse(raw); } catch (e) { return fail('parse', null); }", "try { body = JSON.parse(raw); } catch (e) { body = { jsonrpc: '2.0', id: 1, method: 'getBlockHeight' }; }"],
  [RELAY, 'the body cap ignores a streamed body', 'if (size > cap) {', 'if (false) {'],
  [RELAY, 'the body cap ignores the declared length', 'if (declared > cap) return null;', ''],
  [RELAY, 'the body cap is ten times larger', 'maxBodyBytes: 32 * 1024,', 'maxBodyBytes: 320 * 1024,'],
  [RELAY, 'the batch cap is gone', "if (body.length > LIMITS.maxBatch) return fail('tooMany', null);", ''],
  [RELAY, 'a mixed batch is forwarded whole', "const allowed = body.filter((call, i) => verdicts[i] === 'ok');", 'const allowed = body;'],
  [RELAY, 'a batch with nothing allowed goes upstream', "if (!allowed.length) return json(verdicts.includes('method') ? 403 : 400, out);", ''],
  [RELAY, 'non-POST requests are forwarded', "if (method !== 'POST') return text(405, 'POST only\\n', { Allow: 'POST, OPTIONS' });", ''],
  [RELAY, 'other paths are served', "if (url.pathname !== '/') return text(404, 'not found\\n');", ''],
  [RELAY, 'the preflight forgets solana-client', "'Access-Control-Allow-Headers': 'content-type, solana-client',", "'Access-Control-Allow-Headers': 'content-type',"],
  [RELAY, 'the preflight is not answered', "if (method === 'OPTIONS') return respond(204, null);", ''],
  [RELAY, 'the health line says more', "method === 'HEAD' ? null : 'ok\\n'", "method === 'HEAD' ? null : 'isabella-ocean-rpc 1.0 ok\\n'"],
  [RELAY, 'answers on workers.dev', "if (url.hostname === 'workers.dev' || url.hostname.endsWith('.workers.dev')) return new Response(null, { status: 404 });", ''],
  [RELAY, 'a WebSocket upgrade gets the health line', "if ((request.headers.get('upgrade') || '').toLowerCase() === 'websocket') return text(426, 'This relay speaks JSON-RPC over HTTP POST only.\\n');", ''],
  [RELAY, 'the thrown upstream error is passed on', '} catch (e) { return null; } // the error text can carry the URL: drop it', "} catch (e) { return { text: JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: String(e && e.message) }, id: null }) }; }"],
  [RELAY, 'an upstream error body is passed on', 'if (!res.ok) return null;', 'if (!res.ok) return { text: answer };'],
  [RELAY, 'the upstream answer is not checked for the key', 'for (const s of secretsOf(upstream)) if (answer.includes(s)) return null;', ''],
  [RELAY, 'the upstream answer is not checked for the host', 'out.add(u.host);\n    out.add(u.hostname);', ''],
  [RELAY, 'upstream headers are copied to the caller', "return respond(200, up.text, { 'Content-Type': 'application/json' });", "return respond(200, up.text, { 'Content-Type': 'application/json', 'X-Upstream': upstream });"],
  [RELAY, 'an upstream 429 becomes a 502', 'if (res.status === 429) return { limited: true };', ''],
  [RELAY, 'a bad secret is used anyway', "if (!/^https?:\\/\\/[^\\s]+$/.test(upstream) || !limiter || typeof limiter.limit !== 'function') return fail('config', null);", "if (!limiter || typeof limiter.limit !== 'function') return fail('config', null);"],
  [RELAY, 'the rate limit is ignored', 'if (!r || r.success !== true) return false;', ''],
  [RELAY, 'the rate limit is one bucket for everyone', "const who = callerKey(request.headers.get('cf-connecting-ip'));", "const who = 'everyone';"],
  [RELAY, 'IPv6 callers are limited per single address', 'return groups.slice(0, 4)', 'return groups.slice(0, 8)'],
  [RELAY, 'a batch is charged once', 'within = await charge(limiter, who, body.length - 1);', 'within = true;'],
  [RELAY, 'a broken limiter opens the relay', "try { within = await charge(limiter, who, 1); } catch (e) { return fail('config', null); }", 'try { within = await charge(limiter, who, 1); } catch (e) { within = true; }'],
  [RELAY, 'a limited caller gets a 403', "limited: [429, -32429,", "limited: [403, -32429,"],
  [APP, 'a method the app needs is dropped from the list', "  'getStakeMinimumDelegation', // the smallest stake a slow exit may create\n", ''],
  [APP, 'a per-instance method the app needs is dropped (getBlockHeight)', "  'getBlockHeight', // has the blockhash expired?\n", ''],
  [APP, 'a method the app never calls is added', "  'getLatestBlockhash',\n", "  'getLatestBlockhash',\n  'getSlot',\n"],
  [APP, 'sendTransaction is allowed', "  'getLatestBlockhash',\n", "  'getLatestBlockhash',\n  'sendTransaction',\n"],
  [APP, 'getProgramAccounts refuses the app\'s own query', 'f && f.dataSize === 200', 'f && f.dataSize === 4008'],
];
// [test file, what changes in the app, file under web/, text to find, replacement]
const APP_MUTANTS = [
  [APP, 'the app starts calling a method that is not on the list', 'payments.js', "const info = await rpc(() => c.getEpochInfo('confirmed'), 'epoch');", "const info = await rpc(() => c.getEpochInfo('confirmed'), 'epoch'); await c.getSlot('confirmed');"],
  [APP, 'the app starts calling a method this test has never seen', 'entitlement.js', "const reference = referenceFor(walletBase58);\n    const sigs", "const reference = referenceFor(walletBase58);\n    await connection().getTokenLargestAccounts(new L.web3.PublicKey(reference));\n    const sigs"],
  [APP, 'the app subscribes to a signature', 'payments.js', 'const started = env.now();', 'const started = env.now(); c.onSignature(signature, () => {}, \'confirmed\');'],
  [APP, 'the app confirms through the library (a subscription)', 'payments.js', 'const started = env.now();', 'const started = env.now(); await c.confirmTransaction(signature);'],
  [APP, 'the app sends a transaction itself', 'payments.js', 'const [signature] = await window.Wallet.signAndSend([tx]);', 'const signature = await c.sendRawTransaction(tx.serialize());'],
  [APP, 'the dev wallet (which sends) stays on beside the Android bridge', 'wallet.js', "const devMock = !bridge && cfg.cluster === 'devnet'", "const devMock = cfg.cluster === 'devnet'"],
  [APP, 'the app uses an spl helper that talks to the RPC', 'payments.js', "const ai = await rpc(() => c.getAccountInfo(mint, 'confirmed'), 'mint');", "const ai = await rpc(() => c.getAccountInfo(mint, 'confirmed'), 'mint'); await splToken.getMint(c, mint);"],
];

const work = mkdtempSync(join(tmpdir(), 'relay-mutants-'));
const run = (testFile, env) => spawnSync(process.execPath, [resolve(here, testFile)], { env: Object.assign({}, process.env, env), encoding: 'utf8', timeout: 120000 });
let caught = 0, total = 0;
const survivors = [];
function report(label, what, r) {
  total++;
  const failed = r.status !== 0;
  if (failed) caught++; else survivors.push(`${label}: ${what}`);
  const why = failed ? ((r.stderr || '').split('\n').find((l) => /AssertionError|Error/.test(l)) || 'exit ' + r.status).trim().slice(0, 150) : 'NOT CAUGHT';
  console.log(`${failed ? 'caught' : 'ALIVE '} - ${what}  [${why}]`);
}
try {
  for (const f of [RELAY, APP]) { const clean = run(f, {}); if (clean.status !== 0) { console.error(`${f} fails on the unmodified code; fix that first\n${clean.stderr}`); process.exit(1); } }
  const relaySrc = readFileSync(resolve(here, '../src/index.js'), 'utf8');
  const copy = join(work, 'index.js');
  for (const [testFile, what, find, replace] of RELAY_MUTANTS) {
    if (relaySrc.split(find).length !== 2) { console.error(`injection "${what}" does not match exactly once in src/index.js`); process.exit(1); }
    writeFileSync(copy, relaySrc.replace(find, () => replace));
    report('relay', what, run(testFile, { RELAY_SRC: copy }));
  }
  const web = join(work, 'web');
  for (const [testFile, what, file, find, replace] of APP_MUTANTS) {
    rmSync(web, { recursive: true, force: true });
    cpSync(resolve(root, 'web'), web, { recursive: true });
    const src = readFileSync(join(web, file), 'utf8');
    if (src.split(find).length !== 2) { console.error(`injection "${what}" does not match exactly once in web/${file}`); process.exit(1); }
    writeFileSync(join(web, file), src.replace(find, () => replace));
    report('app', what, run(testFile, { PAYMENTS_WEB_DIR: web }));
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(`\n${total} injections, ${caught} caught`);
if (survivors.length) { console.log('survivors:\n  ' + survivors.join('\n  ')); process.exit(1); }
