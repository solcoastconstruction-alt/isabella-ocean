/* Isabella the Mermaid — payments configuration, MAINNET (the dApp Store build only).
 *
 * This file replaces web/config.js in exactly one build: the store flavor's release variant
 * (Gradle's storeRelease source set wins over main when assets are merged). Every debug build,
 * and so the hackathon judges' APK, keeps the devnet web/config.js. The family flavor never reads
 * either. scripts/sign-release.sh reads `cluster` below to name the signed APK.
 *
 * Same shape as web/config.js: test/payments/mainnet-config.test.mjs fails when the two drift,
 * and when an address here stops matching pool/mainnet.json.
 *
 * Addresses (5 Oct 2026): the pool and its mint are pool/mainnet.json; the merchant is the owner's
 * revenue wallet and its existing mainnet USDC account. rpcUrl is the studio's relay
 * (docs/RPC-RELAY.md); the public endpoint is "not for production".
 */
window.IsabellaConfig = {
  flavor: window.IsabellaFlavor || 'store',
  cluster: 'mainnet-beta',
  chain: 'solana:mainnet',
  rpcUrl: 'https://rpc.isabellaocean.app',
  freeLevels: 10,
  priceUsd: 4.99, // US dollars, at most 6 decimal places; charged as exactly 4,990,000 USDC base units
  stake: {
    programId: 'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy', // the mainnet SPL stake-pool program
    pool: 'HoG8qP3nFU5erDhwPkW7MYW2ZDK9yj69mifBUmQd7Pnk', // stake pool account (pool/mainnet.json)
    mint: 'Bz3AAGDBmzsQbLAakbquwEtA6moXPnkjuvv1ggSobabi', // OCEAN, the pool's token mint
    depositSol: 1.01,
    unlockThreshold: 0.99, // pool tokens the wallet must hold for World 2
    instantFeePct: 0.3, // shown to parents; the real fee is read from the pool account
  },
  merchant: {
    wallet: '4Jb1kcwYS2UFYL8cbXxURzWi2dscpT2ruQv6qLYNPMHq', // the revenue wallet; every purchase sends it a 0-lamport reference transfer
    usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // mainnet USDC (Circle)
    usdcAta: 'DDD9P9keL3a2ZhpBL37Sb3SoDosUkBv4v5JTJ4Z3ZYXP', // the revenue wallet's USDC account; exists (read on chain 5 Oct)
  },
  jupiter: {
    apiBase: 'https://api.jup.ag',
    apiKey: '', // optional: without a key api.jup.ag allows 0.5 requests/s per IP
  },
  offlineGraceHours: 24,
  recheckMinutes: 5,

  devnetPriceSol: 0.1, // unused on mainnet (payments.js and entitlement.js read it on devnet only); kept so both files have one shape
  slippageBps: 50, // Jupiter quotes
};
