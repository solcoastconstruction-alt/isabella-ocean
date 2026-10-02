#!/usr/bin/env node
// Devnet only: top a key up to a target balance with requestAirdrop, retrying with
// exponential backoff (the public faucet rate-limits per IP and per request size).
//
//   node airdrop.mjs                    # payer to 5 SOL
//   node airdrop.mjs --to staker --sol 0.05
//   node airdrop.mjs --address <pubkey> --sol 2
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { loadContext, parseArgs, loadKeypair, assertCluster, lamportsToSol, solToLamports, sleep } from './lib/env.mjs';

const args = parseArgs();
const ctx = loadContext(args, { requireConfig: false });
if (ctx.cluster !== 'devnet') throw new Error('airdrops exist only on devnet');
await assertCluster(ctx);

const target = args.address ? new PublicKey(String(args.address)) : loadKeypair(ctx, String(args.to ?? 'payer')).publicKey;
const want = solToLamports(String(args.sol ?? '5'));
const sizes = String(args.sizes ?? '5,2,1,0.5').split(',').map((s) => solToLamports(s.trim()));
const maxTries = Number(args.tries ?? 14);

let bal = BigInt(await ctx.connection.getBalance(target, 'confirmed'));
console.log(`${target.toBase58()} has ${lamportsToSol(bal)} SOL, target ${lamportsToSol(want)} SOL`);
let sizeIdx = 0, delay = 4000;
for (let attempt = 1; bal < want && attempt <= maxTries; attempt++) {
  const need = want - bal;
  let ask = sizes[sizeIdx];
  if (ask > need) ask = need < LAMPORTS_PER_SOL / 10 ? BigInt(LAMPORTS_PER_SOL / 10) : need;
  try {
    const sig = await ctx.connection.requestAirdrop(target, Number(ask));
    const { blockhash, lastValidBlockHeight } = await ctx.connection.getLatestBlockhash('confirmed');
    await ctx.connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    bal = BigInt(await ctx.connection.getBalance(target, 'confirmed'));
    console.log(`  +${lamportsToSol(ask)} SOL (${sig}) -> ${lamportsToSol(bal)} SOL`);
    delay = 4000;
  } catch (e) {
    const msg = String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 160);
    // a smaller request often succeeds when a big one is refused
    if (sizeIdx < sizes.length - 1 && /limit|429|too many|faucet|internal|dry/i.test(msg)) sizeIdx++;
    console.log(`  attempt ${attempt} (${lamportsToSol(ask)} SOL) failed: ${msg}; next try in ${delay / 1000}s`);
    await sleep(delay);
    delay = Math.min(delay * 2, 120_000);
  }
}
console.log(bal >= want ? `done: ${lamportsToSol(bal)} SOL` : `stopped at ${lamportsToSol(bal)} SOL (wanted ${lamportsToSol(want)}). The public faucet is rate-limited; retry later or use https://faucet.solana.com with this address.`);
process.exit(bal >= want ? 0 : 2);
