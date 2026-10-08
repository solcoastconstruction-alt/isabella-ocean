#!/usr/bin/env node
// Check a plan file and hand it to the debug-only signing page on a phone (README "Phone manager").
//
//   node phone-plan.mjs show plans/create.json                       # the same summary the phone shows
//   node phone-plan.mjs push plans/create.json --serial <adb serial> # open pool-manager.html with the plan
//
// `push` starts the store app's DEBUG build on that one device with two intent extras: the page name and
// the plan's exact bytes (base64url). Nothing is written to the phone. The page shows the plan's cluster
// and fingerprint: compare the fingerprint with the one printed here before approving anything.
// --serial is required, so a plan can never go to whichever phone happens to be plugged in.
// A mainnet plan is pushed only with POOL_ALLOW_MAINNET=yes, the same opt-in every sender here needs.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, env } from './lib/env.mjs';
import { PoolPlan, readPlan, describePlan } from './lib/plan.mjs';

const die = (message) => { console.error(`\n${message}`); process.exit(1); };
const args = parseArgs();
const [command, file] = args._;
if (!['show', 'push'].includes(command) || !file) {
  console.error('usage: node phone-plan.mjs show <plan.json>\n       node phone-plan.mjs push <plan.json> --serial <adb serial> [--package app.isabella.mermaid.seeker]');
  process.exit(2);
}

const { plan, bytes, fingerprint, check } = readPlan(file);
console.log(describePlan(check, { fingerprint }));
if (!check.ok) { console.error('\nThis plan cannot be signed.'); process.exit(1); }
if (command === 'show') process.exit(0);

if (plan.cluster === 'mainnet' && env('POOL_ALLOW_MAINNET') !== 'yes') {
  die('this is a MAINNET plan. Set POOL_ALLOW_MAINNET=yes only when you (the owner) intend to send real transactions.');
}
const serial = args.serial;
if (!serial || serial === true) die('--serial <adb serial> is required (see `adb devices`); the plan goes to that device only');
const pkg = String(args.package ?? 'app.isabella.mermaid.seeker');
const sdkAdb = join(homedir(), 'Library/Android/sdk/platform-tools/adb');
const ADB = env('ADB') ?? (existsSync(sdkAdb) ? sdkAdb : 'adb');
const adb = (...a) => {
  const r = spawnSync(ADB, ['-s', String(serial), ...a], { encoding: 'utf8' });
  if (r.error) die(`could not run adb (${ADB}): ${r.error.message}`);
  return r;
};

if (adb('get-state').stdout.trim() !== 'device') die(`device ${serial} is not connected (adb devices)`);
if (!adb('shell', 'pm', 'path', pkg).stdout.includes('package:')) die(`${pkg} is not installed on ${serial}`);
// The page exists only in debug builds and in the owner build (versionName "-owner", a release-signed
// build that presents the product domain; android/app/build.gradle); a plain release would silently open
// the game instead.
const dump = adb('shell', 'dumpsys', 'package', pkg).stdout;
if (!/\bDEBUGGABLE\b/.test(dump) && !/versionName=\S*-owner\b/.test(dump)) die(`${pkg} on ${serial} is neither a debug build nor an owner build, so it has no pool-manager page`);

const b64 = PoolPlan.b64urlEncode(bytes);
const r = adb('shell', 'am', 'start', '-n', `${pkg}/app.isabella.mermaid.MainActivity`, '--es', 'page', 'pool-manager.html', '--es', 'plan', b64);
if (r.status !== 0 || /Error/.test(r.stdout + r.stderr)) die(`am start failed: ${(r.stdout + r.stderr).trim()}`);
console.log(`\nSent to ${serial} (${bytes.length} bytes). The phone must show:`);
console.log(`  ${check.clusterInfo.label}   fingerprint ${fingerprint}`);
console.log('If either differs, do not approve anything.');
