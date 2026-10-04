/* Isabella the Mermaid — payments configuration (Contract 3 in docs/kids-bundle/BUILD-PLAN.md).
 *
 * Devnet: the studio's own pool (pool/devnet.json, created 2 Oct 2026: 100% fee on rewards, 0.3%
 * instant exit) and the devnet merchant wallet. If any address is emptied, IsabellaPay throws an
 * Error with code 'NOT_CONFIGURED' and IsabellaEntitlement reports "locked"
 * (the family flavor is always unlocked and never reads any of this).
 *
 * Mainnet later: cluster 'mainnet-beta', chain 'solana:mainnet', a non-public rpcUrl (the public
 * endpoint is "not for production"), the mainnet pool, merchant.usdcMint =
 * EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v and an initialized merchant.usdcAta.
 */
window.IsabellaConfig = {
  flavor: window.IsabellaFlavor || 'store', // web/flavor.js sets 'store'; the Android family flavor sets 'family'
  cluster: 'devnet',
  chain: 'solana:devnet',
  rpcUrl: 'https://api.devnet.solana.com',
  freeLevels: 10,
  priceUsd: 4.99, // US dollars, at most 6 decimal places; charged as exactly 4,990,000 USDC base units
  stake: {
    programId: 'DPoo15wWDqpPJJtS2MUZ49aRxqz5ZaaJCJP4z8bLuib', // the stake-pool program that owns `pool` (devnet: SPoo1Ku8… or DPoo15wW…); empty = trust the pool account's owner
    pool: 'D5k3bxRYCWizSToy7C3WzQoPBXYNAUZ78Lo2vvFR9q7a', // stake pool account (base58)
    mint: 'Fm2VtHvAdzAFz7XbD9gNWbrnnqhEqkCEoZVyVyxFS7TT', // the pool's token mint (base58); must equal the pool's own mint
    depositSol: 1.01,
    unlockThreshold: 0.99, // pool tokens the wallet must hold for World 2
    instantFeePct: 0.3, // shown to parents; the real fee is read from the pool account
  },
  merchant: {
    wallet: 'HoackNncWJbNE8nKRpz241SLbS64cbP4Lr4zHZ5H7J2x', // studio wallet (base58): receives devnet SOL payments; every purchase sends it a 0-lamport reference transfer
    usdcMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // devnet: 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU (Circle devnet USDC); mainnet: EPjFWdd5…
    usdcAta: 'GQcMoT8uwHpAJnFYAPBSEu3Bq6FZWvipBYD6bB5RysdE', // the merchant's USDC token account for usdcMint; must already exist
  },
  jupiter: {
    apiBase: 'https://api.jup.ag',
    apiKey: '', // optional: without a key api.jup.ag allows 0.5 requests/s per IP; a free key from developers.jup.ag/portal raises that
  },
  offlineGraceHours: 24,
  recheckMinutes: 5,

  // ---- additions beyond Contract 3 (payments agent; all optional) ----
  devnetPriceSol: 0.1, // devnet only: buy(SOL) sends this much SOL to merchant.wallet instead of swapping via Jupiter
  slippageBps: 50, // Jupiter quotes
};
