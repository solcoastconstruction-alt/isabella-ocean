# The website

**https://isabellaocean-app.pages.dev**, the source in `site/`. It does four jobs:

1. **Wallet identity:** `/.well-known/assetlinks.json` tells wallets that the app `app.isabella.mermaid.seeker`, signed with our certificate, really belongs to this site. Wallets then show "Isabella Ocean" as verified.
2. **Legal pages:** `privacy.html` and `terms.html`. The app links to them from the grown-ups screen.
3. **A landing page:** `index.html`, with `icon.png` and `img/`.
4. **The devnet test APK:** `/isabella-ocean.apk`, a direct download for hackathon judges, linked from the landing page's footer.
   - It is the store-flavor debug build (ANDROID.md), which runs on Solana devnet.
   - It is **not in git**. The deploy script builds it and adds it.

**Brand rule:** the site and app stand alone as Isabella Ocean. They must not name or link any other
business of the owner.

## Deploy (Cloudflare Pages, classic project `isabellaocean-app`)
```bash
scripts/deploy-site.sh              # builds the store debug APK, then deploys site/ plus the APK
scripts/deploy-site.sh <file.apk>   # deploys that APK instead
```
- **Always deploy through the script.** It deploys a temp copy of `site/` with the APK added. A plain `wrangler pages deploy site` would **remove the APK** from the live site.
- **What the script does:**
  - builds the APK (or takes yours) and checks it: every game in `web/games` is packed, it is the store flavor, and its signing certificate is listed in `assetlinks.json`;
  - refuses if another brand's name or a private detail appears in the pages or inside the APK;
  - checks that the Pages project exists, then runs `npx wrangler pages deploy <tempdir> --project-name isabellaocean-app --branch main --commit-dirty=true`;
  - checks the result: wrangler must report a `*.isabellaocean-app.pages.dev` deployment and no Worker, and the live APK, `/`, `/privacy`, `/terms` and `assetlinks.json` must match what it staged, byte for byte.
- **`site/_headers`** serves the APK as `application/vnd.android.package-archive` with `Content-Disposition: attachment`. Pages reads this file when you deploy and never serves it.
- **Always pass `--project-name`.** The script refuses to run without it.
  - Since wrangler 4.146, when wrangler detects an AI agent, a `pages` command for a project that doesn't exist yet silently creates a **Worker** instead, on the account's `workers.dev` subdomain. That subdomain names a different brand.
  - The wrangler source also skips that hand-over when `--branch` or `--commit-dirty` is passed, or when the project exists.
- The classic project was created once with `wrangler pages project create isabellaocean-app --production-branch main --force`.
- **A 200 proves nothing on its own.** For a missing file, Pages answers 200 with `index.html`. To check by hand, look at the content:
  ```bash
  curl -sI https://isabellaocean-app.pages.dev/isabella-ocean.apk   # content-type: application/vnd.android.package-archive
  curl -s https://isabellaocean-app.pages.dev/.well-known/assetlinks.json
  ```
  The second one should return the JSON with our package and certificate.

## `assetlinks.json`
```json
[{"relation":["delegate_permission/common.handle_all_urls","delegate_permission/common.get_login_creds"],
  "target":{"namespace":"android_app","package_name":"app.isabella.mermaid.seeker",
  "sha256_cert_fingerprints":["BE:22:1E:89:34:43:DA:8A:BB:06:15:B3:CE:43:FB:58:99:51:C7:CD:B5:E5:39:37:E5:C9:CF:DC:12:FF:42:23"]}}]
```
That fingerprint is today's **debug** certificate. When the release keystore exists, **add** its
SHA-256 to the list (keep the debug one for test builds) and redeploy with `scripts/deploy-site.sh`
(TODO.md). The script refuses an APK whose certificate isn't listed.

## The legal pages
- **Privacy:** the games collect nothing. No accounts, sign-in, ads, analytics or tracking. The only network traffic is to Solana and Jupiter, for an unlock the parent starts.
- **Terms:** both unlock options in plain English:
  - you give up the staking rewards;
  - SOL's price moves;
  - instant exit costs 0.3%, free exit takes ~2 days;
  - a stake unlock locks after 24 h unchecked;
  - a purchase never expires.
  - The pages also note the devnet testing period.
- **Update the dates** at the top of each page whenever the content changes.

## The product domain (isabellaocean.app), added 7 Oct 2026

The same Pages project also answers on **https://isabellaocean.app**, the identity the release (dApp Store)
build presents to wallets. Wallets judge that host at signing time (kids-bundle Appendix F), so
`site/_worker.js` serves it as the product ships and leaves pages.dev exactly as the judges were given it:
- no `/isabella-ocean.apk` (404), no sideload paragraph (`#devnet-apk`), and the devnet-only passages removed
  per response: the home page's `p.note` ("currently in testing on Solana's devnet") and the terms' "Testing
  period" section;
- a real 404 for any path that is not part of the site (Pages would otherwise answer with the home page);
  the served set is listed in the worker (`STORE_PATHS`, `/img/`), keep it in step with `site/`.
`test/site/worker.test.mjs` (also in `cd tools && npm test`) checks each removal matches its page exactly once,
that no devnet wording survives on the product pages, the 404 set, and that pages.dev passes through untouched.
Deploying is the same `scripts/deploy-site.sh <live apk>`; afterwards check `curl -s https://isabellaocean.app/
| grep -ci devnet` is 0 and `curl -sI https://isabellaocean.app/nothing-here` is 404.
