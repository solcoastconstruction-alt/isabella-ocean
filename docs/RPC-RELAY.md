# The RPC relay

On mainnet the store app needs a paid Solana RPC, and a key packed into an APK can be pulled out of
it. So the app is given the address of a small Cloudflare Worker, `rpc.isabellaocean.app`, and the
Worker holds the provider's URL (key included) as a secret and forwards the app's JSON-RPC calls to it.

**State on 5 Oct 2026:** built and tested locally (`rpc-relay/`), **not deployed**. `web/config.js`
still points at public devnet. It has never been run against the real provider.

## What it does and does not protect

**It does:**
- keep the provider key out of the app, and out of every answer and error the relay gives;
- forward only the 16 RPC methods the app uses (below), and only one narrow form of the costly one;
- refuse anything that is not a small JSON-RPC POST;
- limit each caller address to 300 calls a minute.

**It does not:**
- **authenticate the app.** Anyone who learns the address (it is in the APK) can call those 16
  methods at that rate. The relay shrinks what a stranger can do with the key; it does not stop them.
- **cap the total.** The limit is per address. Many addresses together can still use up the
  provider plan. If that ever happens: lower the limit, add a Cloudflare WAF rate rule on the
  hostname, or rotate the key and move the hostname.
- **check where a request comes from.** The app's page is `file:///android_asset/…`, so its `Origin`
  header is `null` (measured in Chrome; some WebViews send `file://`). Any script or tool can send the
  same header, so **Origin is not a security control** and the relay ignores it. The CORS headers it
  returns (`Access-Control-Allow-Origin: *`) only let the page read the answer.
- **carry transactions.** The wallet app sends them through its own RPC (see "No sendTransaction").

## Files
| File | Job |
|---|---|
| `rpc-relay/src/index.js` | The Worker: one plain JS module, no build step, no dependencies. `ALLOWED_METHODS` and `LIMITS` are at the top. |
| `rpc-relay/wrangler.jsonc` | Name `isabella-ocean-rpc`, the custom domain, `workers_dev: false`, `preview_urls: false`, the rate limiter. |
| `rpc-relay/test/relay.test.mjs` | The guards, against a fake provider and a fake limiter (29 tests). |
| `rpc-relay/test/app-methods.test.mjs` | The allow-list equals what the app calls (10 tests). Fails when the app starts calling something new. |
| `rpc-relay/test/mutants.mjs` | Breaks copies of the relay and of the app 45 ways; every one must be caught. |
| `rpc-relay/tools/observe-app.mjs` | Runs the app's real scripts behind a logging proxy and records the methods per flow. |
| `rpc-relay/observed-methods.json` | That recording (5 Oct 2026). |
| `rpc-relay/tools/browser-check.mjs` | Headless Chrome on a `file://` page against a running relay: CORS, Origin, no WebSocket. |
| `rpc-relay/tools/devnet-hop.mjs` | Local testing only (see "Running it locally"). |

## The allow-list
Sixteen methods. Each was **seen** on the wire with the app's real scripts (`web/vendor/solana.js`,
`config.js`, `wallet.js`, `entitlement.js`, `payments.js`) running behind a logging proxy, and each
was **read** in the code. The numbers are calls in one run of that flow.

| RPC method | Called from | Seen in |
|---|---|---|
| `getTokenAccountsByOwner` | `entitlement.js:114`, `payments.js:222, 941, 954` (web3 `getParsedTokenAccountsByOwner`) | every entitlement check, stake, both exits, token list |
| `getSignaturesForAddress` | `entitlement.js:181`, `payments.js:331` | every entitlement check, restore, pay once, a wallet that went quiet |
| `getTransaction` | `entitlement.js:171`, `payments.js:334` | restore, re-check with a purchase, pay once, a wallet that went quiet |
| `getAccountInfo` | `payments.js:114, 168, 229, 405, 430, 484, 581, 771, 817, 854`, and `:732` (web3 `getAddressLookupTable`) | stake, both exits, pay once (devnet USDC and mainnet dry runs) |
| `getBalance` | `payments.js:405, 910, 937, 952` | stake, pay once, token list |
| `getEpochInfo` | `payments.js:214, 636` | stake, both exits, pending exits, claim |
| `getMinimumBalanceForRentExemption` | `payments.js:407, 431, 483, 522` | stake, both exits |
| `getTokenAccountBalance` | `payments.js:817` | pay once with USDC |
| `getMultipleAccounts` | `payments.js:510, 528, 626` (web3 `getMultipleAccountsInfo`) | slow exit, pending exits, claim |
| `getStakeMinimumDelegation` | `payments.js:482` | slow exit |
| `getRecentPerformanceSamples` | `payments.js:454` | slow exit, pending exits, claim |
| `getProgramAccounts` | `payments.js:619` | pending exits, claim |
| `getLatestBlockhash` | `payments.js:364, 828` | every transaction |
| `simulateTransaction` | `payments.js:274` | every transaction, before the wallet opens |
| `getSignatureStatuses` | `payments.js:286, 293, 349` | confirming and finalizing every transaction |
| `getBlockHeight` | `payments.js:291, 339` | confirming every transaction |

**`getProgramAccounts` is narrowed.** It is the one method that can be made to scan a whole program.
The app makes one such query: the Stake program, 200-byte accounts, a `memcmp` on the withdrawer.
The relay passes that shape and refuses every other use. If a provider refuses it anyway, the app
already copes: it still finds the exit accounts it created itself (`payments.js:624`).

**Calls per flow** (devnet, 5 Oct 2026; the same counts through the proxy and through the relay):

| Flow | Calls | Notes |
|---|---|---|
| Boot entitlement check | 2 | 3 when the wallet has a purchase |
| 5-minute re-check | 2 | 2 or 3, every 5 minutes while the app is on screen |
| Payable-token list | 2 | 3 on mainnet, plus Jupiter (which does not go through the relay) |
| Stake | 14 | in about 5 s, including the confirmation and the re-check |
| Instant exit | 12 | 16 when the wallet went quiet and the app looked the transaction up itself |
| Slow exit, up to the wallet prompt | 12 | then about 4 more to confirm |
| Grown-ups screen (pending exits) | 4 | each time it opens |
| Claim, nothing ready | 4 | |
| Pay once (devnet SOL) | 13 | includes polling until the purchase is finalized |
| Restore purchase | 3 | |
| Mainnet pay once, dry run | 2–3 per route tried | read-only: blockhash, simulate, one account |

**Paths reasoned from the code, not run:**
- a claim that really pays out, and a slow exit that the wallet signs (both use the same send and
  confirm code as stake: `runLegacy`, `payments.js:362`);
- a real mainnet purchase past the dry run (same confirm code; `afterPurchase`, `payments.js:922`);
- the stake-history read for an exit that has passed its epoch (`payments.js:581`, a `getAccountInfo`);
- the pool-update prepend when the pool missed an epoch (`payments.js:216`, a `getAccountInfo`);
- an expired blockhash (`payments.js:292`, `getSignatureStatuses`).

None of these adds a method: `rpc-relay/test/app-methods.test.mjs` sweeps every script under `web/`
for Connection calls, asks the bundled library which RPC method each one sends, and requires that
set to equal the list exactly.

### No sendTransaction
On the phone the wallet signs **and sends**: `WalletBridge.java` calls Mobile Wallet Adapter's
`signAndSendTransactions`, and the wallet uses its own RPC. In the recording the three sends appear
only in the test wallet's own traffic, never in the app's. The one app-side send is the desktop dev
wallet (`web/wallet.js:159`: no Android bridge, devnet, `?devwallet=1`), which is not the store app.
So `sendTransaction` is refused, and a stolen relay address cannot be used to broadcast anything.

### No WebSocket
The app never opens one, so the relay does not carry them (an upgrade request gets 426).
- **Code:** the app calls no `on…` subscription and no `confirmTransaction`. It confirms by polling
  `getSignatureStatuses` and `getBlockHeight` once a second (`payments.js:282`), and waits for
  finality the same way (`payments.js:345`). web3.js builds its socket client with
  `autoconnect: false` and connects only when a subscription exists.
- **Measured:** across every flow above the app constructed 0 WebSockets and the proxy saw 0 upgrade
  requests; headless Chrome's network log shows none either. The detector does fire: one real
  `onSlotChange` constructed a socket at once.
- **Kept true by a test:** `app-methods.test.mjs` fails if any app script calls a subscription.

## Limits
| Limit | Value | Why |
|---|---|---|
| Request body | 32 KB | the app's largest request is one simulated transaction, about 2 KB |
| Batch length | 10 | the app sends no batches (0 in every recording); each call in a batch is checked and charged on its own |
| Calls per address | 300 a minute | below |
| Upstream wait | 25 s | then a 502 |

**Why 300 a minute.** A normal session (open, stake, play, exit) is under 60 calls in total. The
heaviest thing one phone can do is wait on a slow confirmation: two polls a second for at most two
minutes, about 120 a minute. 300 is two and a half times that, so two devices at home behind one
address both fit at their worst, and a normal family uses a few percent.
- **IPv6** callers are counted by their /64, since one home is handed a whole /64.
- **The number is approximate.** Cloudflare counts per data centre and catches up over a few seconds.
- **Phone networks share addresses.** Several families on one carrier address share one allowance.
  At launch sizes this is far away; if it bites, raise `limit` in `wrangler.jsonc` and deploy.

**What a parent sees when limited** (tried with the app's real scripts and the limit set to 8):
- **Starting a stake, an exit, a purchase or the token list:** after three quick tries, the
  paywall's offline card: "You seem to be offline. We couldn't reach Solana. Check the internet
  connection, then try again." Nothing has been signed or sent at that point.
- **The background re-check:** nothing. The last result stands (a stake stays open for the 24-hour
  grace period, a purchase for good) and the next check corrects it.
- **While a sent transaction is confirming:** the app keeps polling. If it were limited for the whole
  two minutes it would say "Still waiting for the network. Check again in a minute." The transaction
  itself went through the wallet and is not affected; the next re-check picks it up.

`web/wallet.js` sets `disableRetryOnRateLimit`, so the library does not retry a 429 by itself;
`payments.js` retries three times, half a second apart, and `entitlement.js` just keeps its cache.

**Answers the relay gives itself** (all JSON-RPC errors, all with fixed text):

| Case | HTTP | Code |
|---|---|---|
| Method not on the list | 403 | -32601 |
| Too many requests | 429, `Retry-After: 60` | -32429 |
| Provider unreachable, slow, or answering with an error page | 502 | -32000 |
| Body too large | 413 | -32600 |
| Bad JSON / not JSON-RPC / batch too long | 400 | -32700 / -32600 |
| Secret or limiter missing | 503 | -32000 |

## Deploying (the owner does this; nothing here has been deployed)
From `rpc-relay/`:
1. `npx wrangler deploy` **first**, so the Worker is created from `wrangler.jsonc` with workers.dev
   already off. (Setting the secret first would make wrangler create an empty Worker by itself, and
   that one's addresses are not governed by this file.)
   - It should list exactly one address: `rpc.isabellaocean.app (custom domain)`. If a
     `workers.dev` line appears, stop and fix that first.
   - The custom domain needs no existing DNS record named `rpc` in the `isabellaocean.app` zone.
   - Until step 2 every call answers 503 "The relay is not set up."
2. `npx wrangler secret put UPSTREAM_RPC_URL` and paste the provider's full mainnet URL, key included.
3. Check it:
   - `curl https://rpc.isabellaocean.app/` → `ok`
   - `curl -X POST https://rpc.isabellaocean.app/ -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getEpochInfo"}'` → an epoch.
     This is also the first proof that the provider accepts requests from a Worker.
   - the same with `"method":"getSlot"` → HTTP 403, "Method not allowed by this relay."
   - `curl -i -X OPTIONS https://rpc.isabellaocean.app/ -H 'Origin: null' -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type,solana-client'` → 204 with `access-control-allow-headers: content-type, solana-client`
   - the workers.dev check below
4. Then the one-line change in `web/config.js`, with the rest of the mainnet settings (PAYMENTS.md):
   `rpcUrl: 'https://rpc.isabellaocean.app',`

### Check that no workers.dev address exists
The account's workers.dev subdomain carries a different name that must not be tied to this product,
so the Worker must never be reachable there. Three layers keep it off: `"workers_dev": false`,
`"preview_urls": false`, and the Worker itself answers a bare 404 to any `*.workers.dev` hostname.
After **every** deploy:
- **Dashboard:** Workers & Pages → `isabella-ocean-rpc` → Settings → Domains & Routes. Only
  `rpc.isabellaocean.app` is listed; workers.dev and Preview URLs both show as disabled.
- **Or the API:** `GET /accounts/<account id>/workers/scripts/isabella-ocean-rpc/subdomain` returns
  `"enabled": false` and `"previews_enabled": false`.
- A `curl` of the workers.dev address is **not** proof either way: Cloudflare's own "nothing here"
  page and the Worker's guard both answer 404.

### Rotating the key
1. Make a new key at the provider.
2. `npx wrangler secret put UPSTREAM_RPC_URL` with the new URL. It takes effect at once; the app does
   not change and no release is needed.
3. Repeat the `getEpochInfo` check above.
4. Delete the old key at the provider.

## Running it locally
```
node rpc-relay/tools/devnet-hop.mjs                    # terminal 1
cp rpc-relay/.dev.vars.example rpc-relay/.dev.vars
cd rpc-relay && npm run dev                            # terminal 2: http://127.0.0.1:8787
node rpc-relay/tools/browser-check.mjs                 # CORS from a file:// page
node rpc-relay/tools/observe-app.mjs --wallet <devnet key.json> --rpc http://127.0.0.1:8787 --flows connect,boot,stake,recheck,exit-instant
```
- **Why the hop:** every request a Worker makes carries a `CF-Worker` header, and
  `api.devnet.solana.com` answers any request with that header with 403 "Your IP or provider is
  blocked from this endpoint". So `wrangler dev` cannot use the public endpoint directly; the hop
  re-sends only the body. **The same is true in production: the public endpoints cannot be the
  relay's upstream.** A paid provider is expected to accept Workers, which is the first thing the
  post-deploy check proves.
- `observe-app.mjs` without `--rpc` puts its own logging proxy in front of the cluster; `--mainnet`
  runs the read-only mainnet flows. A full devnet run spends about 0.11 devnet SOL.

## Tests
| Command | Checks | Result, 5 Oct 2026 |
|---|---|---|
| `node rpc-relay/test/relay.test.mjs` | allow-list (single, batch, mixed batch), body and batch caps, bad JSON, non-POST, preflight, provider failures, no part of the provider URL in any of the 117 responses the run produces, rate limit | 29/29 |
| `node rpc-relay/test/app-methods.test.mjs` | the list equals what the app calls; no send; no subscription | 10/10 |
| `node rpc-relay/test/mutants.mjs` | 38 defects in the relay and 7 changes to the app, one at a time (about a minute) | 45/45 caught |

## Things worth knowing
- **Every call is two requests on the phone.** A `file://` page preflights each JSON POST and
  Chrome did not reuse the preflight (5 for 5 calls). Preflights are answered by the Worker without
  touching the provider and are not charged to the rate limit, but they count as Worker requests.
- **The Worker logs nothing,** and platform logs are off in `wrangler.jsonc`. Turn `observability`
  on only while investigating; Worker logs do not include the secret.
- **Jupiter does not go through the relay.** The page calls `api.jup.ag` directly (`payments.js:698`).
- **If the rate limiter itself fails, the relay closes** (503) rather than running unlimited.
