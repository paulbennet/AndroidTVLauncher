# Development

Everything an engineer needs beyond the [README](../README.md) quick start: code layout, build and signing, measuring
on a TV, and the technical limits. Skin authors: [skin-api.md](skin-api.md). Things that cost time: [gotchas.md](gotchas.md).

## Layout
| Path | What |
|---|---|
| `app/src/main/java/com/weblauncher/tv/MainActivity.kt` | Hosts the WebView; forwards Back, Menu, Home and resume to JS; manages memory while hidden (see below) |
| `.../LocalAssetClient.kt` | Serves `assets/web` at `https://launcher.local/` and app images at `/icon/<pkg>`; level 3 skin pages, the SDK and images at `https://skin.local/` (sandboxed iframe only, with CSP); blocks all other origins; rebuilds the WebView if its renderer dies |
| `.../LauncherBridge.kt` | `window.AndroidLauncher`: `getApps()`, `launch(pkg)`, `openAppInfo(pkg)`, `openSettings()`, `getDeviceInfo()`, plus probe helpers (`frameStatsStart/Stop`, `getAppMemory`, `getStartup`, `keepScreenOn`). Every call takes the page token first (WebView exposes the bridge to every frame); `core/bridge.js` adds it |
| `.../AppRepository.kt` | Lists Leanback and regular launcher apps; renders each banner (320×180) or icon to WebP, LRU-cached |
| `.../FrameStats.kt` | Per-frame times from FrameMetrics (the same data as `gfxinfo`): deadline-based jank and GPU time |
| `.../SkinStore.kt` | Lists and serves skins at `/skins/`: bundled, installed, and dev skins pushed with `lx push` (debug builds, or any build while benching) |
| `.../SkinInstaller.kt` | Installs `.lxskin` packages into `files/skins/<id>/` (archive checks, atomic replace), from the ADB inbox, the LAN page, an https URL or the system file picker; removes installed skins |
| `.../LanInstallServer.kt` | The LAN install page (`http://<tv>:7190/`, PIN), open only while **Install skin** is on screen |
| `.../RuntimeGuard.kt` | Runtime guard: reloads with the default skin when a skin hangs (ping watchdog), crashes the renderer twice, janks or uses too much memory |
| `.../ReferenceApps.kt` | The bench's 50 fixed reference apps (`--es bench <skin>`), the same as `mock.js?apps=50` |
| `app/src/main/assets/web/core/` | Web core: `core.js` (data, input, menus, Settings, level 3 frame host), `nav.js` (D-pad), `skins.js` (loader), `bridge.js` (token), `qr.js` (QR codes for Install skin), `sdk.js` (level 3 SDK, runs in the skin frame), `validate.js`, `lint.js`, `core.css`, `overlay.css` |
| `app/src/main/assets/web/skins/` | Bundled skins: `default` (level 2 reference), `minimal` (level 0), `marquee` (level 2 showcase), `shelf` (level 3 showcase) |
| `app/src/main/assets/web/` | Also `index.html`, `mock.js` (desktop only, `?apps=N` reference data), `probe.*` |
| `tools/lx.mjs` | Skin author tool: `new`, `dev`, `lint`, `bench`, `pack`, `push` ([docs/skin-api.md](skin-api.md)) |
| `docs/` | [Setup guide](setup-guide.md), [Gotchas](gotchas.md), [Prior art](research-webview-launchers.md), [probe results](probe-2026-11-08.md), [design rules](design-rules.md) |
| `site/` | GitHub Pages: the short install link (`/apk`) and a start page |
| `probe-results/` | Measurement runs from the TV (probe results, start-up, frame and app memory data) |

## Develop
```bash
npm install && npm test      # validator, lint and zip tests (lx tests use Chrome for Testing)
node tools/serve.mjs          # UI preview with mock apps at http://localhost:5173 (?skin=<id>, ?apps=50, ?safe=1)
. scripts/env.sh && ./gradlew assembleDebug
scripts/install.sh [release]  # build + adb install + start on the TV
```
Put your tool paths and the TV address in `scripts/env.local.sh` (git-ignored; see `scripts/env.sh`), for example
`export TV=192.168.1.20:5555`. Debug builds allow `chrome://inspect` on the TV's WebView.
Tests and `lx` use Chrome for Testing (`npx playwright-core install chromium`, or set `LX_CHROME`).

## Setting up a TV over ADB
The same two switches as **Set up this TV** ([setup-guide.md](setup-guide.md)), for scripts and test TVs:
```bash
adb shell appops set com.weblauncher.tv SYSTEM_ALERT_WINDOW allow
adb shell settings get secure enabled_accessibility_services
adb shell settings put secure enabled_accessibility_services <existing>:com.weblauncher.tv/.HomeWatchService
```
Keep any services already listed, joined with `:`. Only the TV's owner should change these.

## Memory while hidden
| Hidden for | What happens | Return to launcher (measured) |
|---|---|---|
| under 60 s | Nothing; WebView timers are paused | 0.1–0.2 s |
| 60 s | WebView destroyed and its renderer terminated (frees ~50–100 MB) | page in 0.8–1.3 s |
| 2 min | Process ends (frees the remaining ~70–94 MB) | cold start, page in ~1.5 s |

To tune without rebuilding:
```bash
adb shell am start -n com.weblauncher.tv/.MainActivity --el releaseDelayMs 60000 --el exitDelayMs 120000
```
`exitDelayMs 0` means never exit; `--ez resetTuning true` restores the defaults.
Details are in [docs/probe-2026-11-08.md](probe-2026-11-08.md).

## Measuring on the TV
| Script | Measures |
|---|---|
| `scripts/probe.sh` | Cold start, then `probe.html`: web features, codecs and DRM, 9 rendering scenarios; plus meminfo and gfxinfo |
| `node tools/probe-summary.mjs --since <run>` | Mean ± sd across probe runs (single runs are noisy, so use 3 or more) |
| `scripts/release-test.sh` | Heavy page, 75 s hidden, return: checks the WebView release |
| `scripts/return-test.sh [cycles]` | Return timing and hidden memory after 10 s, 75 s and 135 s behind YouTube |

Skins are measured with `lx bench --tv` ([skin-api.md](skin-api.md#bench-score-and-tier)). Follow
[design-rules.md](design-rules.md): animate only transform and opacity, with no blur or animated shadows.

**Measured** (Sony Bravia VU31: Google TV, Android 14, Mali-G31, 2 GB RAM; release builds; default skin; `lx bench`
with 50 reference apps, 3 or more runs; 2026-11-09 to 2026-11-10):

| | Default skin | Gate for other skins |
|---|---|---|
| Cold start, process → first frame | 1.39–1.56 s | ≤ 1.15 × default |
| Total PSS (app + WebView renderer) | 144–150 MB | < 182 MB |
| Janky frames per key | 1.06–1.13 | ≤ 1.5 |
| p95 frame during the focus tour | 31–32 ms | ≤ 1.15 × default |
| Key latency p95 | 23 ms | < 50 ms |
| Frames drawn while idle | 0.13 per second | ≤ 1 per second |

For comparison, Google TV's own home used about 136 MB on the same TV (home 105 MB + coreservices 31 MB), and it
stays in memory; this launcher frees its WebView after 60 s hidden and ends its process after 2 minutes (above).
The first frame after every key costs 25–30 ms of WebView draw time on this GPU; CSS can't remove it, so jank is
gated per key ([gotchas.md](gotchas.md#webview)).
The scripts send `KEYCODE_WAKEUP`, and the probe keeps the screen on, because ADB activity doesn't stop Google TV's screensaver.

## Release signing
Release and debug builds are signed with the project key when `keystore.properties` exists in the project root (git-ignored):
```
storeFile=C:/Users/<you>/.weblauncher/release.jks
storePassword=…
keyAlias=weblauncher
keyPassword=…
```
Without it they fall back to the Android debug key. **Back up `release.jks` and `keystore.properties`.** An app signed with another key can't update the installed one; the TV must uninstall it first, and that deletes the launcher's data (export it first: `lx settings export --tv`).

## Toolchain
JDK 17, Android SDK (platform 34, build-tools 34), Gradle 8.7 wrapper, AGP 8.5.2, Kotlin 1.9.24, Node 20+.
CI (`.github/workflows/ci.yml`) runs the tests and both builds; pushing a `v*` tag runs `release.yml`, which signs
the APK with the project key from repository secrets and attaches it to a GitHub release.

## Known limits
- **Google TV home can't be replaced, only covered.** It has HOME priority 2, and the Home role and
  `set-home-activity` are ignored. So this launcher opens itself on top: **Web Launcher home** (`HomeWatchService`,
  an accessibility service that gets only window-state events from `launcherx` and can't read window content) about
  1 s after Google TV home comes to the front (boot, wake, Home), and `BootReceiver` after boot when "Display over
  other apps" is allowed. Google TV home is therefore visible for about a second; a key mapper app (Home → this app)
  skips that for the Home button. `BOOT_COMPLETED` comes about 26 s after boot on the VU31, and a wake from standby
  sends no broadcast at all, so the service does most of the work.
- A force-stop of the app turns the service off (Android's rule); an app update keeps it.
- Not on Google Play: Play allows accessibility services mainly for users with disabilities.
- Old TVs whose WebView gets no updates (the Android TV 12 emulator ships Chromium 91): `@layer` needs 99, so the launcher drops the layers there (R24). Skins still apply, but a more specific core selector can win over a skin rule. About in Launcher settings shows the WebView version.
- The web layer gets Widevine L3 only (`SW_SECURE_CRYPTO`), so DRM video stays in native apps.
