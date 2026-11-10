#!/usr/bin/env bash
# Build and install the launcher on the TV.  Usage: scripts/install.sh [debug|release]
set -eu
cd "$(dirname "$0")/.."
. scripts/env.sh
TYPE="${1:-debug}"
./gradlew "assemble${TYPE^}" --console=plain -q
APK="app/build/outputs/apk/$TYPE/app-$TYPE.apk"
"$ADB" connect "${TV:?set TV=host:port in scripts/env.local.sh}" >/dev/null
"$ADB" -s "$TV" install -r "$APK"
"$ADB" -s "$TV" shell am start -n com.weblauncher.tv/.MainActivity
