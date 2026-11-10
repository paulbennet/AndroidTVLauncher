#!/usr/bin/env bash
# Verify the WebView is released while the launcher is hidden, and time the rebuild on return.
# Usage: scripts/release-test.sh      -> probe-results/<timestamp>-release/
set -eu
cd "$(dirname "$0")/.."
. scripts/env.sh
PKG=com.weblauncher.tv
OUT="probe-results/$(date +%Y-%m-%d_%H%M%S)-release"
mkdir -p "$OUT"
"$ADB" connect "${TV:?set TV=host:port in scripts/env.local.sh}" >/dev/null
A() { "$ADB" -s "$TV" "$@" | tr -d '\r'; }
home_watch_warn
pss() {  # PSS (KiB) of launcher + its WebView renderer, from the "Total PSS by process" section
  A shell dumpsys meminfo > "$OUT/meminfo-$1.txt"
  awk '/Total PSS by process/{p=1} /Total PSS by OOM/{p=0} p && (/com.weblauncher.tv/ || /sandboxed_process/)' "$OUT/meminfo-$1.txt" \
    | tee "$OUT/pss-$1.txt"
}

echo "1. heavy use: run probe page"
A shell am force-stop "$PKG"; A logcat -c
A shell input keyevent KEYCODE_WAKEUP   # end screensaver if it started (ADB input is not user activity)
A shell am start -n "$PKG/.MainActivity" --es page probe.html >/dev/null
for _ in $(seq 1 90); do A logcat -d -s WebLauncher:I | grep -q PROBE_DONE && break; sleep 2; done
pss after-probe

echo "2. another app in front for 75 s (release delay is 60 s)"
A shell am start -a android.settings.SETTINGS >/dev/null
sleep 75
pss hidden-75s

echo "3. back to the launcher"
A shell input keyevent KEYCODE_WAKEUP
A shell am start -n "$PKG/.MainActivity" >/dev/null
sleep 8
pss returned

A logcat -d -s WebLauncher:I > "$OUT/logcat.txt"
echo
grep -E "WEBVIEW_(BUILT|RELEASED)" "$OUT/logcat.txt" | sed 's/^.*WebLauncher: //'
grep -o 'STARTUP .*' "$OUT/logcat.txt" | tail -1
echo "Results: $OUT"
