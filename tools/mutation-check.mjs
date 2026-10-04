// Guards for the guards: inject one defect at a time into a copy of web/ and require
// test/payments/unit.test.mjs to FAIL for each. Prints "N injections, N caught".
//   cd tools && node mutation-check.mjs
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUTATIONS = [
  ['entitlement.js', 'the offline grace window never expires', "const unlocked = !!c.unlocked && !!c.via && until !== null && (c.via === 'purchase' || env.now() < until);", 'const unlocked = !!c.unlocked && !!c.via && until !== null;'],
  ['entitlement.js', 'a purchase lapses offline again', "(c.via === 'purchase' || env.now() < until)", '(env.now() < until)'],
  ['entitlement.js', 'revokeLocal hold ignored', 'const held = !!(same && same.holdUntil && now < same.holdUntil && !opts.ignoreHold);', 'const held = false;'],
  ['entitlement.js', 'reference prefix changed', "const REFERENCE_PREFIX = 'isabella-purchase-v1';", "const REFERENCE_PREFIX = 'isabella-purchase-v2';"],
  ['entitlement.js', 'family flavor touches the network', 'if (isFamily()) return Promise.resolve(emitIfChanged());', ''],
  ['entitlement.js', 'family flavor starts timers', 'if (isFamily()) { watcher = { stop() { watcher = null; } }; return watcher.stop; }', ''],
  ['entitlement.js', 'any payment counts as a purchase', 'if (delta >= Math.round(Number(cfg.devnetPriceSol || 0.1) * 1e9))', 'if (delta > 0)'],
  ['entitlement.js', 'the price loses a base unit', "return BigInt(m[1] + (m[2] || '').padEnd(decimals, '0'));", "return BigInt(m[1] + (m[2] || '').padEnd(decimals, '0')) - 1n;"],
  ['entitlement.js', 'the price truncated to whole dollars', "return BigInt(m[1] + (m[2] || '').padEnd(decimals, '0'));", "return BigInt(m[1] + ''.padEnd(decimals, '0'));"],
  ['payments.js', 'a USDC balance one unit short passes as enough', 'list[1].enough = raw >= usdcUnits();', 'list[1].enough = raw + 1n >= usdcUnits();'],
  ['entitlement.js', 'another wallet inherits the cache', 'if (!current || !c || c.wallet !== current) {', 'if (!current || !c) {'],
  ['entitlement.js', 'a disconnected wallet stays unlocked', 'if (!current || !c || c.wallet !== current) {', 'if (!c || (current && c.wallet !== current)) {'],
  ['entitlement.js', 'refresh can hang on a silent RPC', 'Promise.race([doRefresh(wallet, opts || {}), timeout])', 'Promise.race([doRefresh(wallet, opts || {})])'],
  ['entitlement.js', 'a just-confirmed purchase is ignored', 'if (same && same.pendingPurchase) {', 'if (false) {'],
  ['entitlement.js', 'refresh while hidden', 'const onResume = () => { if (visible()) refresh(); };', 'const onResume = () => { refresh(); };'],
  ['entitlement.js', 'threshold off by one unit', 'tokens.raw >= thresholdRaw(tokens.decimals)', 'tokens.raw + 1n >= thresholdRaw(tokens.decimals)'],
  ['wallet.js', 'dev mock active even with the Android bridge', "const devMock = !bridge && cfg.cluster === 'devnet'", "const devMock = cfg.cluster === 'devnet'"],
  ['wallet.js', 'cancellation not reported as cancelled', "if (r.cancelled) return walletError('CANCELLED'", "if (false) return walletError('CANCELLED'"],
  ['wallet.js', 'maybeSubmitted not surfaced', "if (r.maybeSubmitted) return walletError('MAYBE_SUBMITTED'", "if (false) return walletError('MAYBE_SUBMITTED'"],
  ['wallet.js', 'insufficient lamports not reported as funds', "INSUFFICIENT_SOL: 'funds'", "INSUFFICIENT_SOL: 'failed'"],
  ['payments.js', 'a failed-kind message the paywall would show as offline', 'Solana is paying out this epoch', 'The network is paying out this epoch'],
  ['payments.js', 'a remote logo URL', "{ mint: SOL_MINT, symbol: 'SOL', logo: LOGO_SOL,", "{ mint: SOL_MINT, symbol: 'SOL', logo: 'https://example.com/sol.png',"],
  ['payments.js', 'fees rounded down instead of up', 'return den === 0n ? 0n : (amount * num + den - 1n) / den;', 'return den === 0n ? 0n : (amount * num) / den;'],
  ['payments.js', 'stale-pool error not mapped', "17: ['POOL_STALE',", "1017: ['POOL_STALE',"],
  ['payments.js', 'cooldown ignores the cluster rate limit', 'const newly = BigInt(Math.max(1, Math.floor(weight * Number(prev.effective) * 0.09)));', 'const newly = current;'],
];

let caught = 0;
const report = [];
for (const [file, label, from, to] of MUTATIONS) {
  const dir = mkdtempSync(join(tmpdir(), 'isabella-mut-'));
  try {
    cpSync(join(root, 'web'), dir, { recursive: true });
    const path = join(dir, file);
    const src = readFileSync(path, 'utf8');
    const count = src.split(from).length - 1;
    if (count !== 1) { report.push(`ANCHOR ${count === 0 ? 'MISSING' : 'AMBIGUOUS'}  ${file}: ${label}`); continue; }
    writeFileSync(path, src.replace(from, to));
    const run = spawnSync(process.execPath, ['--test', '--test-timeout=20000', join(root, 'test/payments/unit.test.mjs')], {
      env: Object.assign({}, process.env, { PAYMENTS_WEB_DIR: dir }), encoding: 'utf8', timeout: 90000, killSignal: 'SIGKILL',
    });
    const failed = run.status !== 0;
    if (failed) caught++;
    const which = (run.stdout || '').split('\n').filter((l) => l.startsWith('✖') && !l.includes('failing tests')).map((l) => l.replace(/^✖ /, '').replace(/ \([\d.]+ms\)$/, ''));
    report.push(`${failed ? 'caught ' : 'MISSED '} ${file}: ${label}${run.error ? ' [run timed out]' : ''}${which.length ? '  <- ' + [...new Set(which)].join('; ') : ''}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(report.join('\n'));
console.log(`${MUTATIONS.length} injections, ${caught} caught`);
process.exit(caught === MUTATIONS.length ? 0 : 1);
