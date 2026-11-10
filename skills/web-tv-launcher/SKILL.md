---
name: web-tv-launcher
description: Set up, use, develop, troubleshoot and make skins for Web TV Launcher, a skinnable HTML/CSS/JS home screen for Android TV and Google TV (package com.weblauncher.tv, repo paulbennet/AndroidTVLauncher). Use when someone wants to install it on a TV (also non-engineers, step by step), replace Google TV home, build or test the repo, design, build, lint, bench, pack, publish, install, test or debug a launcher skin (.lxskin, lx tool), or solve a new problem with the launcher on a TV.
license: MIT
compatibility: Works in any agent that reads SKILL.md. TV tasks need the TV plus, for engineers, adb over the network; repo and skin tasks need git, Node 20+ and (for APK builds) JDK 17 and the Android SDK.
metadata:
  version: "1.1.1"
  repository: https://github.com/paulbennet/AndroidTVLauncher
---

# Web TV Launcher

Web TV Launcher is an Android TV home screen whose whole UI is a web page (HTML/CSS/JS) inside a small Kotlin
WebView shell. Its look comes from **skins**: from a few colour tokens (level 0) up to a full sandboxed JS page
(level 3). Skins are linted and benched against a performance budget with the `lx` tool.

Repo: https://github.com/paulbennet/AndroidTVLauncher · Package: `com.weblauncher.tv` · Logcat tag: `WebLauncher`
· Short install link: `paulbennet.github.io/AndroidTVLauncher/apk` · Contributions: issues only.

## First: who are you helping, and with what?
Ask if it is not clear. Then load only the reference you need:

| Task | Read |
|---|---|
| Put it on a TV for someone who is **not** an engineer (only the TV and its remote) | [references/setup-tv.md](references/setup-tv.md) |
| Set up a TV **over ADB**, build the APK, run tests, change the launcher code | [references/develop.md](references/develop.md) |
| **Make a skin**: design, build, preview, lint, bench, pack, publish, install, test, debug, maintain | [references/skins.md](references/skins.md), then [references/skin-design.md](references/skin-design.md) for the look and the performance rules |
| Something doesn't work (known problems, by symptom) | [references/troubleshooting.md](references/troubleshooting.md) and `scripts/tv-doctor.sh` |
| A problem nobody has documented yet | [references/new-problems.md](references/new-problems.md) |

The full project docs are in the repo (`docs/`) and online at
`https://raw.githubusercontent.com/paulbennet/AndroidTVLauncher/main/docs/<file>.md`: `setup-guide.md`,
`skin-api.md` (the complete skin reference), `development.md`, `gotchas.md`, `design-rules.md`,
`launcher-v1-plan.md`. When this skill and the docs disagree, the docs on `main` win: they are newer.

## Rules for the agent (always)
1. **TV security settings belong to the TV's owner.** Turning on the accessibility service ("Web Launcher home"),
   "Display over other apps", "Install unknown apps" or developer options changes the TV's security. Explain what
   each one does and let the person do it, or run the ADB command only after they clearly say yes for that TV.
2. **Never `am force-stop com.weblauncher.tv` on a TV in daily use.** Android then turns "Web Launcher home" off, and
   only the owner can turn it on again. `adb install -r` keeps it. `lx bench --tv`, `scripts/probe.sh` and
   `scripts/release-test.sh` force-stop the app: they warn first; tell the person before you run them.
3. **Read before you change.** Use `scripts/tv-doctor.sh` (read-only) before any fix on a TV.
4. **Don't factory-reset, uninstall Google TV home, or disable system apps.** Disabling Google TV home can leave a
   TV on a recovery screen. This launcher covers Google TV home; it does not remove it.
5. **Private pictures stay private.** A skin with personal photos must be installed only on that TV (ADB or LAN
   page), never packed into a public gallery, a bundled skin or a repo.
6. **Measure on the TV, not the desktop.** Desktop numbers are only an estimate.
7. **Report what you found.** New problems and fixes go to the person and, with their OK, into an issue
   (pull requests are off): see [references/new-problems.md](references/new-problems.md).

## How it works (enough to reason about new problems)
- **Shell (Kotlin, `app/src/main/java/com/weblauncher/tv/`):** `MainActivity` hosts one WebView and forwards
  Back, Menu, Home and resume to the page. `LocalAssetClient` serves the page at `https://launcher.local/` and level
  3 skins at `https://skin.local/` (sandboxed iframe, CSP), and blocks every other origin; a dead proxy also blocks
  the network for the page. `LauncherBridge` (`window.AndroidLauncher`) needs a per-page token on every call.
  `SkinStore`/`SkinInstaller` keep skins (bundled in the APK, installed in app storage, dev skins on
  `/sdcard/Android/data/com.weblauncher.tv/files/skins/` for debug builds and benches). `LanInstallServer` is the
  phone upload page `http://<tv>:7190/` with a 6-digit PIN, open only while **Install skin** is on screen.
  `RuntimeGuard` falls back to the default skin when a skin hangs, crashes, janks or uses too much memory.
- **Google TV home (`com.google.android.apps.tv.launcherx`) can't be replaced, only covered:**
  `HomeWatchService` (accessibility, sees only launcherx window events) opens the launcher ~1 s after Google TV
  home appears (boot, wake, Home); `BootReceiver` opens it after boot if "Display over other apps" is allowed.
- **Web core (`app/src/main/assets/web/core/`):** `core.js` owns data, D-pad navigation (`nav.js`), long press
  (hold OK = app menu), menus, Launcher settings and **Set up this TV**; `skins.js` loads skins;
  `sdk.js` runs inside level 3 skins; `lint.js`/`validate.js` are shared with the `lx` tool.
- **Memory:** hidden 60 s → WebView freed; hidden 2 min → process ends; cold start ~1.4–1.6 s on a 2 GB TV.
- **Safe mode:** hold **Back** for 5 s, or `adb shell am start -n com.weblauncher.tv/.MainActivity --ez safeMode true`.

## Log markers (logcat tag `WebLauncher`)
`STARTUP` (timings), `SKIN` / `SKIN_FAILED` / `SKIN_LINT`, `GUARD`, `GUARD_TRIP reason=… culprit=…`,
`GUARD_FALLBACK`, `GUARD_MEMORY`, `HOME_WATCH connected|opened|ignored|paused`, `BOOT_OPEN`, `SAFE_MODE`,
`SKIN_INSTALL`, `SKIN_REMOVE`, `LAN_INSTALL`, `GALLERY_*`, `SETTINGS_EXPORT|IMPORT(ED)`, `WEBVIEW_BUILT`,
`WEBVIEW_RELEASED`, `PROCESS_EXIT`, `L3_REJECTED`, `L3_FOCUS_RECLAIMED`, `FRAME_STATS`.
Read them with `adb logcat -d -s WebLauncher` (add `-v time`).
