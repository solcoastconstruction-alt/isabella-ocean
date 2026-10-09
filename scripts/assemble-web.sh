#!/bin/sh
# Assemble the web bundle for an app-store build: web/ without the wallet and payment code, with
# web-iap/ laid over it. The iOS project runs this on every build (a Run Script phase), so the app
# can never pack a stale or a wrong bundle; tests run it too.
#
#   scripts/assemble-web.sh <flavor> <out-dir>
#
# <flavor> is 'appstore' (iOS) or 'play'.
# POSIX sh only, and no tools outside /usr/bin and /bin: Xcode's build environment has no Homebrew.
set -eu

flavor="${1:?usage: assemble-web.sh <appstore|play> <out-dir>}"
out="${2:?usage: assemble-web.sh <appstore|play> <out-dir>}"
case "$flavor" in appstore|play) ;; *) echo "assemble-web: unknown flavor '$flavor'" >&2; exit 2 ;; esac

root="$(cd "$(dirname "$0")/.." && pwd)"
src="$root/web"
over="$root/web-iap"
fail() { echo "assemble-web: $*" >&2; exit 1; }

[ -f "$src/index.html" ] || fail "no $src/index.html"
case "$out" in /*) ;; *) out="$(pwd)/$out" ;; esac
case "$out" in "$root"|"$src"|"$over"|/) fail "refusing to write into $out" ;; esac

rm -rf "$out"
mkdir -p "$out"
cp -R "$src/." "$out/"

# 1. The wallet and payment code never ships in these builds.
gone="vendor/solana.js wallet.js payments.js entitlement.js paymock.js"
for f in $gone; do
  [ -f "$out/$f" ] || fail "expected web/$f to exist (has web/ been reorganised? update this list)"
  rm "$out/$f"
done
rmdir "$out/vendor" 2>/dev/null || fail "web/vendor holds more than solana.js: decide what ships"

# 2. Lay the app-store files over it.
for f in config.js paywall.js; do
  [ -f "$over/$f" ] || fail "no web-iap/$f"
  cp "$over/$f" "$out/$f"
done
printf "window.IsabellaFlavor = window.IsabellaFlavor || '%s';\n" "$flavor" > "$out/flavor.js"

# 3. index.html: drop the script tags of the removed files and the comment that lists them. Every
#    anchor must be found exactly once, or the page has changed under this script.
page="$out/index.html"
for tag in 'vendor/solana.js' 'wallet.js' 'entitlement.js' 'payments.js'; do
  n=$(/usr/bin/grep -c "<script src=\"$tag\"></script>" "$page" || true)
  [ "$n" = 1 ] || fail "index.html: expected one script tag for $tag, found $n"
done
n=$(/usr/bin/grep -c '^<!-- Order fixed by ' "$page" || true)
[ "$n" = 1 ] || fail "index.html: expected one 'Order fixed by' comment, found $n"
n=$(/usr/bin/grep -c '<symbol id="i-stake" ' "$page" || true)
[ "$n" = 1 ] || fail "index.html: expected one i-stake symbol, found $n"
/usr/bin/awk '
  /^<!-- Order fixed by / { skipping = 1 }
  skipping { if ($0 ~ /-->[[:space:]]*$/) skipping = 0; next }
  /<script src="(vendor\/solana|wallet|entitlement|payments)\.js"><\/script>/ { next }
  /<symbol id="i-stake" / { next }
  { print }
' "$page" > "$page.tmp"
mv "$page.tmp" "$page"
for tag in flavor.js config.js core.js render.js audio.js paywall.js hub.js app.js; do
  n=$(/usr/bin/grep -c "<script src=\"$tag\"></script>" "$page" || true)
  [ "$n" = 1 ] || fail "index.html: expected one script tag for $tag after the edit, found $n"
done

# 4. The check: nothing about wallets, staking or the chain may be left anywhere in the bundle.
#    (-a: treat every file as text, so a file with odd bytes is still read.)
words='solana|wallet|usdc|jupiter|[[:<:]]stak(e|ed|ing)|devnet|mainnet|blockchain|dapp|pages\.dev|mockpay'
if /usr/bin/grep -r -a -i -n -E "$words" "$out" > "$out.hits" 2>/dev/null; then
  echo "assemble-web: wallet or chain wording is left in the bundle:" >&2
  /usr/bin/cut -c1-200 "$out.hits" | /usr/bin/head -20 >&2
  rm -f "$out.hits"
  exit 1
fi
rm -f "$out.hits"
# The check must be able to see: the same search has to find the words in the source it was cut from.
/usr/bin/grep -r -a -i -q -E "$words" "$src" || fail "the wording check found nothing in web/ either: it is not looking"

count=$(/usr/bin/find "$out" -type f | /usr/bin/wc -l | /usr/bin/tr -d ' ')
echo "assemble-web: $flavor bundle, $count files, in $out"
