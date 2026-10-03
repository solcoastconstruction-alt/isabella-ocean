# The website

**https://isabellaocean-app.pages.dev**, the source in `site/`. It does three jobs:

1. **Wallet identity:** `/.well-known/assetlinks.json` tells wallets that the app `app.isabella.mermaid.seeker`, signed with our certificate, really belongs to this site. Wallets then show "Isabella Ocean" as verified.
2. **Legal pages:** `privacy.html` and `terms.html`. The app links to them from the grown-ups screen.
3. **A landing page:** `index.html`, with `icon.png` and `img/`.

**Brand rule:** the site and app stand alone as Isabella Ocean. They must not name or link any other
business of the owner.

## Deploy (Cloudflare Pages, classic project `isabellaocean-app`)
```bash
npx wrangler pages deploy site --project-name isabellaocean-app --branch main --commit-dirty=true
```
- **Always pass `--project-name`.** With wrangler 4.146, a `pages` command for a project that doesn't exist yet silently creates a **Worker** instead, on the account's `workers.dev` subdomain. That subdomain names a different brand.
- The classic project was created once with `wrangler pages project create isabellaocean-app --production-branch main --force`.
- **After deploying, check the result:**
  ```bash
  curl -s https://isabellaocean-app.pages.dev/.well-known/assetlinks.json
  ```
  This should return the JSON with our package and certificate.

## `assetlinks.json`
```json
[{"relation":["delegate_permission/common.handle_all_urls","delegate_permission/common.get_login_creds"],
  "target":{"namespace":"android_app","package_name":"app.isabella.mermaid.seeker",
  "sha256_cert_fingerprints":["BE:22:1E:89:34:43:DA:8A:BB:06:15:B3:CE:43:FB:58:99:51:C7:CD:B5:E5:39:37:E5:C9:CF:DC:12:FF:42:23"]}}]
```
That fingerprint is today's **debug** certificate. When the release keystore exists, **add** its
SHA-256 to the list (keep the debug one for test builds) and redeploy (TODO.md).

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
