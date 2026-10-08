#!/usr/bin/env node
// A plain SOL transfer from the payer key. Run by the owner. Mainnet needs POOL_ALLOW_MAINNET=yes.
//
//   node send-sol.mjs --to <address> --sol 0.5                    # devnet
//   POOL_ALLOW_MAINNET=yes node send-sol.mjs --cluster mainnet --to <address> --sol 0.5
//   node send-sol.mjs --to <address> --sol 0.5 --dry-run          # print only
//
// It refuses to leave the payer with less than --keep SOL (default 0.05) so the payer can still pay fees.
import { SystemProgram } from '@solana/web3.js';
import { parseArgs, loadContext, loadKeypair, assertCluster, assertSendAllowed, lamportsToSol, solToLamports, explorerTx, pk } from './lib/env.mjs';
import { sendTx } from './lib/tx.mjs';

const args = parseArgs();
if (!args.to || args.to === true || !args.sol || args.sol === true) {
  console.error('usage: node send-sol.mjs [--cluster mainnet] --to <address> --sol <amount> [--keep 0.05] [--dry-run]');
  process.exit(2);
}
const ctx = loadContext(args, { requireConfig: false });
const dry = !!args['dry-run'];
if (dry) await assertCluster(ctx); else await assertSendAllowed(ctx);

const payer = loadKeypair(ctx, 'payer');
const to = pk(String(args.to));
const lamports = solToLamports(String(args.sol));
const keep = solToLamports(String(args.keep ?? '0.05'));
if (lamports <= 0n) throw new Error('--sol must be more than 0');
if (to.equals(payer.publicKey)) throw new Error('--to is the payer itself');

const [balance, toInfo] = await Promise.all([ctx.connection.getBalance(payer.publicKey, 'confirmed'), ctx.connection.getAccountInfo(to, 'confirmed')]);
// A wallet is a system account. Anything else (a token account, a program's account) would swallow the SOL.
if (toInfo && !toInfo.owner.equals(SystemProgram.programId)) throw new Error(`${to.toBase58()} is not a wallet: it is owned by ${toInfo.owner.toBase58()}`);
if (BigInt(balance) - lamports < keep) throw new Error(`the payer holds ${lamportsToSol(BigInt(balance))} SOL; sending ${lamportsToSol(lamports)} would leave less than ${lamportsToSol(keep)}`);

console.log(`${ctx.cluster.toUpperCase()}  from payer ${payer.publicKey.toBase58()} (${lamportsToSol(BigInt(balance))} SOL)`);
console.log(`  to ${to.toBase58()} (${toInfo ? lamportsToSol(BigInt(toInfo.lamports)) : '0'} SOL${toInfo ? '' : ', a new address'})   amount ${lamportsToSol(lamports)} SOL`);
if (dry) { console.log('DRY RUN: nothing was sent'); process.exit(0); }

const sig = await sendTx(ctx, { label: `send ${lamportsToSol(lamports)} SOL`, instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports })], signers: [payer] });
console.log(explorerTx(ctx, sig));
console.log(`payer now ${lamportsToSol(BigInt(await ctx.connection.getBalance(payer.publicKey, 'confirmed')))} SOL, recipient ${lamportsToSol(BigInt(await ctx.connection.getBalance(to, 'confirmed')))} SOL`);
