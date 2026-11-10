#!/usr/bin/env bash
# Time "another app in front, then back to the launcher" for three hidden durations:
#   10 s  -> WebView still alive (hot)
#   75 s  -> WebView released (release delay 60 s): rebuild
#   135 s -> process ended (exit delay set to 120 s for this test): cold start
# Usage: scripts/return-test.sh [cycles=3]     OTHER=<package> to change the app in front (default YouTube)
set -eu
cd "$(dirname "$0")/.."
. scripts/env.sh
PKG=com.weblauncher.tv
OTHER="${OTHER:-com.google.android.youtube.tv}"
CYCLES="${1:-3}"
OUT="probe-results/$(date +%Y-%m-%d_%H%M%S)-return"
mkdir -p "$OUT"
"$ADB" connect "${TV:?set TV=host:port in scripts/env.local.sh}" >/dev/null
A() { "$ADB" -s "$TV" "$@" | tr -d '\r'; }
wake() { A shell input keyevent KEYCODE_WAKEUP; }   # ADB activity doesn't stop the screensaver
pss() {  # summed PSS (MiB) of processes matching $1, from "Total PSS by process"
  A shell dumpsys meminfo | awk '/Total PSS by process/{p=1} /Total PSS by OOM/{p=0} p' | grep -E "$1" \
    | awk -F'K:' '{gsub(/[ ,]/, "", $1); s += $1} END {printf "%d", s / 1024}'
}

wake
A shell am start -n "$PKG/.MainActivity" --el releaseDelayMs 60000 --el exitDelayMs 120000 >/dev/null
sleep 5
printf "cycle\thidden_s\tlaunch\tdisplayed_ms\twebview_to_page_ms\tprocess_to_page_ms\tlauncher_hidden_mb\twebview_renderers_hidden_mb\tother_app_mb\n" > "$OUT/summary.tsv"

for c in $(seq 1 "$CYCLES"); do
  for hidden in 10 75 135; do
    echo "cycle $c: hidden ${hidden}s"
    wake; A shell am start -n "$PKG/.MainActivity" >/dev/null; sleep 4
    A logcat -c
    A shell monkey -p "$OTHER" -c android.intent.category.LEANBACK_LAUNCHER 1 >/dev/null 2>&1 || true
    sleep "$hidden"
    l=$(pss 'com\.weblauncher\.tv'); r=$(pss 'sandboxed_process'); o=$(pss "$OTHER")
    wake
    res=$(A shell am start -W -n "$PKG/.MainActivity")
    state=$(echo "$res" | sed -n 's/^LaunchState: //p'); total=$(echo "$res" | sed -n 's/^TotalTime: //p')
    sleep 6
    A logcat -d -s WebLauncher:I >> "$OUT/logcat.txt"
    st=$(A logcat -d -s WebLauncher:I | grep -o 'STARTUP .*' | tail -1)
    wv=$(echo "$st" | sed -n 's/.*"webViewToFirstFrameMs":\([0-9]*\).*/\1/p')
    pr=$(echo "$st" | sed -n 's/.*"processToFirstFrameMs":\([0-9]*\).*/\1/p')
    [ "$state" = "COLD" ] || pr="-"
    printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" "$c" "$hidden" "${state:-?}" "${total:-?}" "${wv:-already loaded}" "$pr" "$l" "$r" "$o" >> "$OUT/summary.tsv"
  done
done

# Back to the app defaults
A shell am start -n "$PKG/.MainActivity" --ez resetTuning true >/dev/null
echo; column -t -s $'\t' "$OUT/summary.tsv"; echo "Results: $OUT"
