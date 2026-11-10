#!/usr/bin/env bash
# Run the WebView probe on the TV and collect results into probe-results/<timestamp>/.
# Usage: scripts/probe.sh            (launcher must already be installed: scripts/install.sh)
set -eu
cd "$(dirname "$0")/.."
. scripts/env.sh
PKG=com.weblauncher.tv
OUT="probe-results/$(date +%Y-%m-%d_%H%M%S)"
mkdir -p "$OUT"
"$ADB" connect "${TV:?set TV=host:port in scripts/env.local.sh}" >/dev/null
A() { "$ADB" -s "$TV" "$@" | tr -d '\r'; }
home_watch_warn

# Memory of this app + every WebView renderer (sandboxed_process) currently alive.
mem() {
  A shell dumpsys meminfo "$PKG" > "$OUT/meminfo-app-$1.txt"
  A shell dumpsys meminfo | grep -iE "sandboxed_process|$PKG|launcherx|com.omeda.arc" > "$OUT/meminfo-summary-$1.txt" || true
}

echo "1/4 cold start"
A shell am force-stop "$PKG"
A logcat -c
A shell input keyevent KEYCODE_WAKEUP
A shell am start -W -n "$PKG/.MainActivity" > "$OUT/cold-start.txt"
sleep 8
mem idle

echo "2/4 running probe (~90 s)"
A shell input keyevent KEYCODE_WAKEUP   # end screensaver if it started (ADB input is not user activity)
A shell am start -n "$PKG/.MainActivity" --es page probe.html >/dev/null
for _ in $(seq 1 90); do
  A logcat -d -s WebLauncher:I | grep -q PROBE_DONE && break
  sleep 2
done
A logcat -d -s WebLauncher:I > "$OUT/logcat.txt"

echo "3/4 memory after probe"
mem after-probe
A shell dumpsys gfxinfo "$PKG" > "$OUT/gfxinfo.txt"

echo "4/4 back to launcher"
A shell am start -n "$PKG/.MainActivity" --es page index.html >/dev/null

# Reassemble chunked JSON: "PROBE_RESULT i/n <chunk>"
grep -o 'PROBE_RESULT [0-9]*/[0-9]* .*' "$OUT/logcat.txt" \
  | awk '{ split($2, a, "/"); idx = a[1]; sub(/^PROBE_RESULT [0-9]+\/[0-9]+ /, ""); print idx "\t" $0 }' \
  | sort -n | cut -f2- | tr -d '\n' > "$OUT/probe.json"
grep -o 'STARTUP .*' "$OUT/logcat.txt" | head -1 > "$OUT/startup.txt" || true

echo
echo "Results: $OUT"
grep -E "TotalTime|WaitTime" "$OUT/cold-start.txt" || true
cat "$OUT/startup.txt"
grep -E "TOTAL PSS|TOTAL:" "$OUT/meminfo-app-idle.txt" | head -2
cat "$OUT/meminfo-summary-idle.txt"
