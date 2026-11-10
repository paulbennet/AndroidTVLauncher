# Engineers: ADB setup, build, test, change the launcher

Full reference: `docs/development.md` (code layout, memory tuning, measuring, signing, limits) and `docs/gotchas.md`.

## Connect to a TV
```bash
adb connect <tv-ip>:5555          # network debugging on (Developer options); accept the prompt on the TV
adb devices                       # "device", not "unauthorized"/"offline"
```
- "unauthorized": accept "Allow network debugging" on the TV (tick "Always allow from this computer").
- "offline" / timeouts after the TV slept: **network ADB stops in standby.** Someone must press Power on the remote;
  then `adb connect` again. Don't send `KEYCODE_SLEEP` unless someone can wake the TV.
- The TV's address can change (DHCP). Find it in TV Settings → Network, or `adb mdns services`.
- Wake the screen before anything you measure: `adb shell input keyevent KEYCODE_WAKEUP`.

## Install and set up a TV over ADB
```bash
adb install -r web-launcher.apk   # from https://github.com/paulbennet/AndroidTVLauncher/releases/latest
adb shell am start -n com.weblauncher.tv/.MainActivity
```
Then **Set up this TV** on screen, or (only with the owner's yes, see SKILL.md rule 1):
```bash
adb shell appops set com.weblauncher.tv SYSTEM_ALERT_WINDOW allow                 # optional: open at boot
adb shell settings get secure enabled_accessibility_services                       # keep what is there
adb shell settings put secure enabled_accessibility_services '<existing>:com.weblauncher.tv/.HomeWatchService'
```
If the list was `null` or empty, use only `com.weblauncher.tv/.HomeWatchService`. Never drop other services (for
example a key mapper's). Check: `adb logcat -d -s WebLauncher | grep HOME_WATCH` shows `HOME_WATCH connected`.
- "App not installed" / `INSTALL_FAILED_UPDATE_INCOMPATIBLE`: the installed copy has another signing key. Export
  settings first (`node tools/lx.mjs settings export --tv`), then `adb uninstall com.weblauncher.tv`.
- `appops write-settings` after `appops set` if you will hard-kill an emulator right after.

## Work on the repo
```bash
git clone https://github.com/paulbennet/AndroidTVLauncher && cd AndroidTVLauncher
npm ci && npx playwright-core install chromium     # tests and lx drive Chrome for Testing
npm test                                           # node --test "tools/test/*.test.mjs" (glob, not a folder)
node tools/serve.mjs                               # http://localhost:5173/?apps=50 (&skin=<id>, &safe=1, &googletv)
```
- The desktop preview uses `app/src/main/assets/web/mock.js` instead of the native bridge. Add a mock for every new
  bridge method, and tests in `tools/test/` (Playwright with `playwright-core`; see `tools/lib/browser.mjs`).
- `?googletv` makes the mock act like a Google TV with nothing set up (shows **Set up this TV**).

## Build the APK
Needs JDK 17 and the Android SDK (platform 34, build-tools 34). Put local paths in `scripts/env.local.sh`
(git-ignored), for example `export JAVA_HOME=…; export ANDROID_HOME=…; export TV=192.168.1.20:5555`, then:
```bash
. scripts/env.sh
./gradlew assembleRelease testReleaseUnitTest      # app/build/outputs/apk/release/app-release.apk
scripts/install.sh release                         # build + install + start on $TV
```
- Without `keystore.properties` both builds use the Android debug key (fine for your own TV; it can't update a
  release-signed install). With it, both use the project key. **Back up the key**: a lost key means uninstalling on
  every TV.
- Measure speed only on **release** builds; debug builds add JIT load. Debug builds allow `chrome://inspect`.
- Behind a TLS-inspecting proxy on Windows, Java needs `-Djavax.net.ssl.trustStoreType=Windows-ROOT` (put it in
  `~/.gradle/gradle.properties` as `systemProp.javax.net.ssl.trustStoreType=Windows-ROOT`).

## Change the launcher: where things are
| Change | Files |
|---|---|
| Menus, navigation, long press, Settings, Set up this TV | `app/src/main/assets/web/core/core.js`, `nav.js` |
| Skin loading and isolation | `core/skins.js`, `LocalAssetClient.kt`, `core/sdk.js` (level 3) |
| Lint rules (shared by the TV and `lx`) | `core/lint.js`, `core/validate.js` |
| Native features for the page | `LauncherBridge.kt` (+ `core/bridge.js` adds the token; + `mock.js`) |
| Boot, Google TV home | `BootReceiver.kt`, `HomeWatchService.kt`, `res/xml/home_watch.xml` |
| Skin install paths | `SkinInstaller.kt`, `LanInstallServer.kt`, `SkinGallery.kt` |
| Guard limits | `RuntimeGuard.kt`, guard part of `core.js` |
| Author tool | `tools/lx.mjs`, `tools/lib/*.mjs` |
Rules: every bridge method takes the token first (WebView injects the bridge into every frame, skins too); keep skins
without network; bump `versionCode`/`versionName` in `app/build.gradle.kts` for a release.

## Verify a change on the TV
1. `scripts/install.sh release`, then read `adb logcat -d -s WebLauncher` (`STARTUP`, `SKIN`, errors).
2. Drive it with keys: `adb shell input keyevent KEYCODE_DPAD_RIGHT|KEYCODE_DPAD_CENTER|KEYCODE_BACK|KEYCODE_MENU`.
   ADB can't hold a key (no repeats); test long presses with the real remote.
3. Prefer logs (`ActivityTaskManager: START …`, `WebLauncher` markers) over screenshots: a screenshot of someone's
   launcher can show their private wallpaper or photos. If you take one (`adb exec-out screencap -p > s.png`), keep
   it local and delete it.
4. Speed: `node tools/lx.mjs bench app/src/main/assets/web/skins/default --tv` (a bundled skin is benched by its
   folder; it warns because it force-stops the app, see SKILL.md rule 2). Compare with the numbers in
   `docs/development.md` → "Measuring on the TV".

## CI and releases
`.github/workflows/ci.yml` runs `npm test` and both Gradle builds. A `v*` tag runs `release.yml`: it signs with the
project key from repository secrets (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`), checks it
isn't the debug key, and publishes `web-launcher.apk` (fixed name, used by the short link), a versioned copy and
`SHA256SUMS.txt`. `pages.yml` publishes `site/` (the `/apk` short link).
