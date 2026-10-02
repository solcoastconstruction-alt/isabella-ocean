#!/usr/bin/env node
// Generate the pool's keypairs (Solana CLI JSON format) into pool/keys/<cluster>/, which is
// gitignored. Never overwrites an existing file. Prints public keys only.
//
//   node keys.mjs                 # devnet: payer, manager, staker + one-shot account keys
//   node keys.mjs --cluster mainnet --roles staker,payer,pool,validator-list,reserve,mint
//     (mainnet: the MANAGER should be a Squads vault, not a file — see README)
import { existsSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { loadContext, parseArgs, keypairPath, writeKeypair, loadKeypair } from './lib/env.mjs';

const ROLES = {
  payer: 'pays rent and fees; seeds the pool; funds the smoke-test parent (devnet "treasury")',
  manager: 'pool manager: fees, funding authorities, metadata, receives fee tokens (mainnet: Squads vault)',
  staker: 'pool staker: adds validators, moves stake (used by the crank)',
  pool: 'stake pool account (one-shot, signs only at creation)',
  'validator-list': 'validator list account (one-shot)',
  reserve: 'reserve stake account (one-shot)',
  mint: 'pool token mint (one-shot)',
};

const args = parseArgs();
const ctx = loadContext(args, { requireConfig: false });
const roles = String(args.roles ?? Object.keys(ROLES).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
console.log(`cluster ${ctx.cluster}, keys dir ${ctx.keysDir}`);
for (const role of roles) {
  if (!ROLES[role]) throw new Error(`unknown role ${role}`);
  const path = keypairPath(ctx, role);
  let state = 'exists';
  if (!existsSync(path)) { writeKeypair(path, Keypair.generate()); state = 'created'; }
  const kp = loadKeypair(ctx, role);
  console.log(`${role.padEnd(15)} ${kp.publicKey.toBase58()}  (${state})  ${ROLES[role]}`);
}
