// Plan files: the manager-signed (or fee-owner-signed) instructions, written as JSON for a phone wallet.
// The debug-only page android/app/src/debug/assets/pool-manager.html reads one, shows every instruction
// in plain words, and asks the wallet on the phone (Mobile Wallet Adapter) to sign and send each step.
//
// The decoder lives in ONE file, android/app/src/debug/assets/pool-plan.js, a plain browser script.
// It is evaluated here unchanged, so the Mac and the phone describe a plan with the same code.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { CLUSTERS, POOL_DIR, env, base58 } from './env.mjs';

export const POOL_PLAN_JS = resolve(POOL_DIR, '../android/app/src/debug/assets/pool-plan.js');

function loadDecoder() {
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', readFileSync(POOL_PLAN_JS, 'utf8'))(module, module.exports);
  return module.exports;
}
export const PoolPlan = loadDecoder();

export const CHAIN = { devnet: 'solana:devnet', mainnet: 'solana:mainnet' };

/** One instruction as the plan (and the Squads printout) carries it. */
export function ixToJson(label, instruction) {
  return {
    label,
    programId: instruction.programId.toBase58(),
    accounts: instruction.keys.map((m) => ({ pubkey: m.pubkey.toBase58(), isSigner: m.isSigner, isWritable: m.isWritable })),
    dataBase58: base58(instruction.data),
    dataHex: Buffer.from(instruction.data).toString('hex'),
  };
}

/**
 * steps: [{ title, instructions: [{ label, instruction }] }]. `signer` is the one account that signs and
 * pays for every step (the phone wallet's account). The cluster is ctx's, never a default; a mainnet
 * plan is only built when the operator has set POOL_ALLOW_MAINNET=yes, and it says so inside.
 */
export function buildPlan(ctx, { kind, signer, steps, note }) {
  if (!CLUSTERS[ctx.cluster]) throw new Error(`unknown cluster ${ctx.cluster}`);
  if (ctx.cluster === 'mainnet' && env('POOL_ALLOW_MAINNET') !== 'yes') {
    throw new Error('refusing to write a mainnet plan: set POOL_ALLOW_MAINNET=yes only when you (the owner) intend to send real transactions.');
  }
  const plan = {
    format: PoolPlan.FORMAT,
    kind,
    cluster: ctx.cluster,
    chain: CHAIN[ctx.cluster],
    genesisHash: CLUSTERS[ctx.cluster].genesisHash,
    ...(ctx.cluster === 'mainnet' ? { allowMainnet: 'yes' } : {}),
    rpcUrl: ctx.rpcUrl,
    signer: signer.toBase58(),
    createdAt: new Date().toISOString(),
    ...(note ? { note } : {}),
    steps: steps.map((s) => ({ title: s.title, instructions: s.instructions.map((i) => ixToJson(i.label, i.instruction)) })),
  };
  const check = PoolPlan.checkPlan(plan);
  if (!check.ok) throw new Error(`the plan does not pass its own checks:\n  ${check.errors.join('\n  ')}`);
  return plan;
}

export function planText(plan) { return JSON.stringify(plan, null, 2) + '\n'; }

export function fingerprintOf(bytes) {
  return PoolPlan.fingerprint(createHash('sha256').update(bytes).digest());
}

export function writePlan(path, plan) {
  const file = resolve(String(path));
  const text = planText(plan);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { file, fingerprint: fingerprintOf(Buffer.from(text, 'utf8')) };
}

export function readPlan(path) {
  const bytes = readFileSync(resolve(String(path)));
  const plan = JSON.parse(PoolPlan.utf8Decode(bytes));
  return { plan, bytes, fingerprint: fingerprintOf(bytes), check: PoolPlan.checkPlan(plan) };
}

/** The same plain summary the phone shows, as text lines. */
export function describePlan(check, { fingerprint } = {}) {
  const lines = [];
  lines.push(`${check.clusterInfo ? check.clusterInfo.label : 'UNKNOWN CLUSTER'}${fingerprint ? `   fingerprint ${fingerprint}` : ''}`);
  if (check.signer) lines.push(`signs and pays: ${check.signer}`);
  check.steps.forEach((s, si) => {
    lines.push(`\nStep ${si + 1} of ${check.steps.length}: ${s.title}`);
    s.instructions.forEach((d, ii) => {
      lines.push(`  ${ii + 1}. ${d.name ?? 'NOT DECODED'}   program ${d.program}${d.programName ? ` (${d.programName})` : ''}`);
      for (const [k, v] of d.params) lines.push(`       ${k}: ${v}`);
      for (const a of d.accounts) lines.push(`       - ${a.role}: ${a.pubkey}${a.isSigner ? '  SIGNER' : ''}${a.isWritable ? '  writable' : ''}${a.known ? `  (${a.known})` : ''}`);
    });
  });
  if (check.errors.length) lines.push('\nPROBLEMS (nothing can be signed):', ...check.errors.map((e) => `  ! ${e}`));
  return lines.join('\n');
}
