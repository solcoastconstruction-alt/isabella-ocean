# The Android apps

One codebase, two flavors. Both wrap the same `web/` folder, packed as the APK's assets, in a plain
WebView app: no framework, no androidx.

| | `family` | `store` |
|---|---|---|
| Package | `app.isabella.mermaid` | `app.isabella.mermaid.seeker` |
| Name on the phone | Isabella the Mermaid | Isabella Ocean |
| Wallet and paywall | none; everything unlocked | yes (PAYMENTS.md) |
| Internet | never used | Solana RPC and Jupiter only |
| Distribution | installed directly | Solana dApp Store (TODO.md) |

- **Java:** build with Java 17 (Homebrew `openjdk@17`). Android Studio's bundled Java is now 25, which Gradle 8.11 rejects ("Unsupported class file major version 69").
- **Version:** 2.4 (versionCode 6), with `compileSdk`/`targetSdk` 36 and `minSdk` 26.
- **Flavor assets:** `android/app/src/<flavor>/assets/flavor.js` overrides `web/flavor.js`.

## Build
```bash
cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ./gradlew :app:assembleFamilyDebug :app:assembleStoreDebug
```
The APKs land in `android/app/build/outputs/apk/<flavor>/debug/`. To check what a build packed, run
`unzip -l <apk> | grep assets/`.

- **MWA library workarounds** (store flavor only):
  - The library declares compileSdk 37, and that metadata check is skipped. The newest API it calls is backported by D8.
  - Its unused `kotlin-stdlib` dependency is excluded.

## Signing
- **Today:** every build is signed with this Mac's debug key, SHA-256 `BE:22:1E:89:…:42:23`, and that is the certificate in the site's `assetlinks.json`.
- **Release:** a dApp Store release needs a **release keystore**, kept safe forever, because every update must use the same key. Then:
  - add its SHA-256 to `site/.well-known/assetlinks.json` and redeploy the site;
  - otherwise wallets show the app as unverified.

## What the page can call (`MainActivity.java`)
- **`IsabellaStore.get(key)` / `set(key, value)`:** SharedPreferences file `isabella`, where all game saves live. `adb install -r` keeps it.
- **`IsabellaApp`:**
  - `canPin()`, `isPinned()` and `pinToHome()` drive the title screen's "Add to Home screen" button.
  - `openUrl(url)` opens a browser, but only for `https://isabellaocean-app.pages.dev/…`.
- **Android events:**
  - the back button calls `window.__back()`;
  - leaving the app calls `window.__pause()`.
  - The app runs full screen (immersive).
- **Store flavor only:** `window.IsabellaWallet` (WalletBridge) and `WalletKeepAlive` (PAYMENTS.md).

## Installing over USB
- `adb install -r <apk>` updates in place and keeps all saved progress. The new build must be signed with the same key; check with `apksigner verify --print-certs`.
- An app installed over USB appears in the app drawer, not on the home screen. The in-app "Add to Home screen" button pins it.
- **Read progress first** on a debug build: `adb shell run-as <package> cat shared_prefs/isabella.xml`. Compare it before and after an update.
- **Don't interrupt a level:** before updating, read `__dbg.mode` over WebView DevTools. `title`, `levels` or `results` is safe.
- **Frozen apps:** Android freezes background apps (`dumpsys activity processes` shows `isFrozen=true`). A frozen app can't answer DevTools, so bring it to the front with `am start` first.

## WebView DevTools (debug builds)
```bash
adb forward tcp:9460 localabstract:webview_devtools_remote_$(adb shell pidof app.isabella.mermaid.seeker)
```
Then connect to `http://127.0.0.1:9460/json/list` (`test/paywall/cdp.js` is a small client). The
pid, and so the socket name, changes whenever the app restarts.

## The emulator (for wallet tests and demo videos)
- **The AVD:** `fz36` (serial `emulator-5554`; `ro.boot.qemu=1`). Tests refuse any device that isn't an emulator.
- **Test wallet:** Solana Mobile's test wallet, "fakewallet", built from source with a devnet key baked in (DEMO.md explains the build).
- **IPv6:** the Mac has no IPv6, so turn it off in the emulator, or the wallet's 3-second identity check times out. This resets on every emulator reboot.
  ```bash
  adb -s emulator-5554 root && adb -s emulator-5554 shell sysctl -w net.ipv6.conf.all.disable_ipv6=1
  ```
- **Slow first connection:** even with IPv6 off, a slow first connection can still fail that check ("Verification failed"). The demo recorder looks the site up first, so the DNS answer is cached.
