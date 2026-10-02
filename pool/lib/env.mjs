// Shared plumbing: CLI args, cluster config, keypairs, connection, safety guards, formatting.
import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

export const POOL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const CLUSTERS = {
  devnet: {
    rpcUrl: 'https://api.devnet.solana.com',
    genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    explorerSuffix: '?cluster=devnet',
  },
  mainnet: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    explorerSuffix: '',
  },
};

// ---------- args ----------
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const eq = a.indexOf('=');
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}

// ---------- config ----------
// GitHub Actions passes unset secrets/variables as empty strings: treat those as unset.
export function env(name) {
  const v = process.env[name];
  return v !== undefined && v.trim() !== '' ? v.trim() : undefined;
}

export function loadContext(args = parseArgs(), { requireConfig = true } = {}) {
  const cluster = String(args.cluster ?? env('POOL_CLUSTER') ?? 'devnet');
  if (!CLUSTERS[cluster]) throw new Error(`unknown cluster "${cluster}" (devnet | mainnet)`);
  const configPath = resolve(String(args.config ?? env('POOL_CONFIG') ?? join(POOL_DIR, `${cluster}.json`)));
  let config = null;
  if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf8'));
  else if (requireConfig) throw new Error(`config not found: ${configPath} (run create-pool.mjs first, or pass --config)`);
  if (config && config.cluster && config.cluster !== cluster) throw new Error(`config ${configPath} is for ${config.cluster}, not ${cluster}`);
  const rpcUrl = String(args.rpc ?? env('POOL_RPC_URL') ?? config?.rpcUrl ?? CLUSTERS[cluster].rpcUrl);
  const keysDir = resolve(String(args['keys-dir'] ?? env('POOL_KEYS_DIR') ?? join(POOL_DIR, 'keys', cluster)));
  const connection = new Connection(rpcUrl, { commitment: 'confirmed', confirmTransactionInitialTimeout: 90_000 });
  return { cluster, configPath, config, rpcUrl, keysDir, connection, args };
}

export function saveConfig(ctx, config) {
  const ordered = JSON.stringify(config, null, 2) + '\n';
  writeFileSync(ctx.configPath, ordered);
  ctx.config = config;
}

// ---------- keypairs ----------
// Keypair files use the Solana CLI format (JSON array of 64 secret-key bytes).
export function roleEnvName(role) { return `POOL_${role.toUpperCase().replace(/-/g, '_')}_KEYPAIR`; }

export function keypairPath(ctx, role) { return join(ctx.keysDir, `${role}.json`); }

export function loadKeypair(ctx, role, { optional = false } = {}) {
  const envName = roleEnvName(role);
  const fromEnv = env(envName);
  if (fromEnv) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fromEnv)));
  const path = keypairPath(ctx, role);
  if (existsSync(path)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, 'utf8'))));
  if (optional) return null;
  throw new Error(`missing keypair "${role}": set ${envName} or create ${path} (node keys.mjs)`);
}

export function writeKeypair(path, kp) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) throw new Error(`refusing to overwrite ${path}`);
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  chmodSync(path, 0o600);
}

// ---------- guards ----------
// Refuse to send anything unless the RPC really is the configured cluster, and refuse
// mainnet unless the operator explicitly opts in (BUILD-PLAN hard rule 2 for the agents).
export async function assertCluster(ctx) {
  const genesis = await ctx.connection.getGenesisHash();
  const want = CLUSTERS[ctx.cluster].genesisHash;
  if (genesis !== want) throw new Error(`RPC ${ctx.rpcUrl} has genesis ${genesis}, expected ${ctx.cluster} (${want})`);
}

export async function assertSendAllowed(ctx) {
  await assertCluster(ctx);
  if (ctx.cluster === 'mainnet' && env('POOL_ALLOW_MAINNET') !== 'yes') {
    throw new Error('mainnet transactions are disabled. Set POOL_ALLOW_MAINNET=yes only when you (the owner) intend to send real transactions.');
  }
}

// ---------- formatting ----------
export function lamportsToSol(l, digits = 9) {
  const v = BigInt(l);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 1_000_000_000n;
  const frac = (a % 1_000_000_000n).toString().padStart(9, '0').slice(0, digits);
  return `${neg ? '-' : ''}${whole}${digits > 0 ? '.' + frac : ''}`;
}

export function solToLamports(sol) {
  const s = String(sol).trim();
  if (!/^\d+(\.\d{1,9})?$/.test(s)) throw new Error(`bad SOL amount "${sol}"`);
  const [w, f = ''] = s.split('.');
  return BigInt(w) * 1_000_000_000n + BigInt((f + '000000000').slice(0, 9));
}

export function feeToString(f) {
  if (!f) return 'none';
  const n = BigInt(f.numerator), d = BigInt(f.denominator);
  if (n === 0n || d === 0n) return '0%';
  const pct = Number(n * 1_000_000n / d) / 10_000;
  return `${pct}% (${n}/${d})`;
}

export function explorerTx(ctx, sig) { return `https://explorer.solana.com/tx/${sig}${CLUSTERS[ctx.cluster].explorerSuffix}`; }
export function explorerAddr(ctx, addr) { return `https://explorer.solana.com/address/${addr}${CLUSTERS[ctx.cluster].explorerSuffix}`; }

export const pk = (v) => (v instanceof PublicKey ? v : new PublicKey(v));
export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
export { LAMPORTS_PER_SOL };

// Base58 (Bitcoin alphabet) for printing instruction data, e.g. for a Squads transaction.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(bytes) {
  const b = Buffer.from(bytes);
  let n = b.length ? BigInt('0x' + b.toString('hex')) : 0n;
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const x of b) { if (x === 0) out = '1' + out; else break; }
  return out;
}

// JSON.stringify that copes with BigInt and PublicKey
export function toJson(v, space = 2) {
  return JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x instanceof PublicKey ? x.toBase58() : x), space);
}
