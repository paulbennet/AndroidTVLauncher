#!/usr/bin/env bash
# Web TV Launcher: read-only health check of a TV over ADB. It changes nothing on the TV.
# Usage: bash tv-doctor.sh [host:port]      (no argument: the only attached ADB device)
#        ADB=/path/to/adb bash tv-doctor.sh 192.168.1.20:5555
set -u
ADB="${ADB:-adb}"
PKG=com.weblauncher.tv
TARGET="${1:-${TV:-}}"

command -v "$ADB" >/dev/null 2>&1 || [ -x "$ADB" ] || { echo "adb not found: install Android platform-tools or set ADB=/path/to/adb"; exit 2; }
if [ -n "$TARGET" ]; then
  case "$TARGET" in *:*) "$ADB" connect "$TARGET" >/dev/null 2>&1 ;; esac
  A() { "$ADB" -s "$TARGET" "$@" 2>/dev/null | tr -d '\r'; }
else
  A() { "$ADB" "$@" 2>/dev/null | tr -d '\r'; }
fi
sh() { A shell "$@"; }

state="$(A get-state)"
if [ "$state" != "device" ]; then
  echo "TV not reachable (state: ${state:-none})."
  echo "- TV in standby? Network ADB stops while it sleeps: press Power on the remote, then run this again."
  echo "- 'unauthorized'? Accept 'Allow network debugging' on the TV."
  echo "- Address changed? TV Settings -> Network shows it."
  exit 1
fi

line() { printf '%-26s %s\n' "$1" "$2"; }
echo "== TV"
line "model" "$(sh getprop ro.product.manufacturer) $(sh getprop ro.product.model)"
line "android" "$(sh getprop ro.build.version.release) (SDK $(sh getprop ro.build.version.sdk))"
line "uptime" "$(sh uptime | sed 's/^ *//')"
wv="$(sh dumpsys webviewupdate | sed -n 's/.*Current WebView package (name, version): (\(.*\)).*/\1/p' | head -1)"
line "webview" "${wv:-unknown}"
line "screen" "$(sh dumpsys power | sed -n 's/.*mWakefulness=\([A-Za-z]*\).*/\1/p' | head -1)"

echo "== Web Launcher"
pkg="$(sh dumpsys package $PKG)"
if ! printf '%s' "$pkg" | grep -q "versionName="; then
  line "installed" "no  -> install web-launcher.apk (see setup-tv.md or develop.md)"
  exit 0
fi
line "version" "$(printf '%s' "$pkg" | sed -n 's/.*versionName=\([^ ]*\).*/\1/p' | head -1) (code $(printf '%s' "$pkg" | sed -n 's/.*versionCode=\([0-9]*\).*/\1/p' | head -1))"
printf '%s' "$pkg" | grep -q "DEBUGGABLE" && line "build" "debug (timings are slower)" || line "build" "release"
gtv="no"; sh pm path com.google.android.apps.tv.launcherx | grep -q package: && gtv="yes"
line "google tv home present" "$gtv"
a11y="$(sh settings get secure enabled_accessibility_services)"
case ":$a11y" in *:$PKG/*) line "web launcher home" "on" ;; *) line "web launcher home" "OFF  -> Set up this TV, step 1 (the TV owner turns it on)" ;; esac
line "accessibility list" "${a11y:-null}"
line "display over other apps" "$(sh appops get $PKG SYSTEM_ALERT_WINDOW | sed 's/;.*//')"
line "in front" "$(sh dumpsys activity activities | sed -n 's/.*topResumedActivity=ActivityRecord{[^ ]* [^ ]* \([^ ]*\).*/\1/p' | head -1)"
pid="$(sh pidof $PKG)"; line "process" "${pid:-not running}"
if [ -n "$pid" ]; then
  line "memory (app PSS)" "$(sh dumpsys meminfo $PKG | sed -n 's/^ *TOTAL PSS: *\([0-9]*\).*/\1 KB/p;s/^ *TOTAL *\([0-9]*\) .*/\1 KB/p' | head -1)"
fi

echo "== Recent WebLauncher log (last 40 marker lines)"
sh logcat -d -v time -s WebLauncher | grep -E "STARTUP|SKIN|GUARD|HOME_WATCH|BOOT_OPEN|SAFE_MODE|INSTALL|GALLERY|SETTINGS|WEBVIEW|PROCESS_EXIT|L3_|FAILED|Error|error" | tail -40
echo "== Recent activity starts"
sh logcat -d -v time | grep "ActivityTaskManager: START" | tail -8 | cut -c1-220
echo "== Crashes (crash buffer, $PKG)"
sh logcat -d -b crash | grep -A3 "$PKG" | tail -20
echo "(read-only: nothing was changed on the TV)"
