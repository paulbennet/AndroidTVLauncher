# Gotchas

Things that cost time while building and measuring this launcher. Most were found on a Sony Bravia VU31 (Google TV,
Android 14) and the Android TV 12 emulator; other TVs may differ.

## Google TV: boot, wake and the Home button
- **Settings screens can exist without a menu entry.** On the VU31, "Display over other apps" has no menu path, but
  `Settings.ACTION_MANAGE_OVERLAY_PERMISSION` opens it. The Setup screen opens these screens directly.
- **Package visibility (Android 11+):** to check whether Google TV home is installed, the app needs
  `<queries><package android:name="com.google.android.apps.tv.launcherx"/></queries>`; without it the check says no.
- **Google TV home (`com.google.android.apps.tv.launcherx`) always wins.** It has HOME priority 2. The Home role and
  `cmd package set-home-activity` are ignored, and disabling it can bring up a recovery screen instead. So this app
  opens itself on top: `BootReceiver` after boot, `HomeWatchService` (accessibility) when Google TV home comes to the
  front, and a key mapper app for the Home button.
- **`BOOT_COMPLETED` is late.** On the VU31 it arrived about 26 s after Google TV home was on screen.
- **A wake from standby sends no broadcast.** Google TV runs `launcherx/.coreservices.bootmode.DispatchActivity`
  ("power on behaviour") at sleep and at wake, and it goes to its home or back to the last app.
- **Starting an activity from the background** needs an exemption on Android 10+. `BootReceiver` uses "Display over
  other apps" (`SYSTEM_ALERT_WINDOW`), which TV Settings may not offer: grant it with
  `adb shell appops set com.weblauncher.tv SYSTEM_ALERT_WINDOW allow`. An accessibility service may start
  activities without it.
- **Accessibility window events:** when an activity starts, `TYPE_WINDOW_STATE_CHANGED` names its class. When an
  activity that already exists comes back to the front, the event names only a view class such as
  `android.widget.FrameLayout`. `HomeWatchService` remembers the last `launcherx` activity for that reason.
- **`am force-stop com.weblauncher.tv` turns the accessibility service off.** Android removes a force-stopped
  app's service from `enabled_accessibility_services`, and only the user can turn it on again. `adb install -r`
  keeps it. `lx bench --tv`, `scripts/probe.sh` and `scripts/release-test.sh` force-stop the app; they warn first and print the
  command that turns the service on again.
- **Key mapper apps** (for example Button Mapper) filter key events through their own accessibility service. On the
  VU31, OK and the arrows still came through at once. An ADB-injected Home key skips the key mapper: test the Home
  button with the real remote.
- **AppOps writes its file late.** After `appops set`, run `adb shell appops write-settings` before a hard kill of
  the emulator (`adb emu kill`), or the grant is lost.

## Remote and keys
- **A held button sends a keydown every ~50 ms, and WebView marks none of them as `repeat`.** Treat a keydown as a
  new press only when the key was up (see `okHeld` in `core/core.js`).
- **Back and Menu never reach page JS** from a WebView: `MainActivity.dispatchKeyEvent` forwards them.
- **ADB can't model a held button.** `input keyevent --duration` / `--longpress` sends no repeats, and the page gets
  keydown and keyup together at the release. Some TVs have no `--duration`, and `sendevent` needs root. To hold Back:
  `adb shell input keycombination -t 6000 KEYCODE_BACK KEYCODE_SHIFT_LEFT`. Test long presses with the real remote.

## WebView
- **`addJavascriptInterface` objects are injected into every frame,** a sandboxed skin frame too. Every bridge method
  takes the page token first (`core/bridge.js` adds it).
- **The renderer is an isolated process.** The app can't read its memory (`runningAppProcesses`, `/proc`); only
  `dumpsys meminfo` over ADB shows it.
- **`performance.memory` is rounded** and refreshed only about every 20 minutes, so a JS heap check is coarse.
- **FrameMetrics doesn't see script jank:** a busy page draws fewer frames, and those are on time. Key latency, or a
  rAF loop that counts late frames, catches it.
- **The first frame after every key** costs 25–30 ms of WebView draw time on the VU31 (Mali-G31). CSS can't remove
  it, and a hardware layer on the WebView made it worse. Gate jank per key, not as a percentage.
- **Old TVs whose WebView gets no updates** (the Android TV 12 emulator ships Chromium 91) lack `@layer` (99+).
- **The web layer gets Widevine L3 only** (`SW_SECURE_CRYPTO`), so DRM video stays in native apps.
- **A sandboxed frame's CSP can't use `'self'`:** write the skin host out in full.
- **Debug builds can be driven over DevTools:**
  `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`, then
  `chromium.connectOverCDP('http://127.0.0.1:9333')` (Playwright).

## Measuring on the TV
- **Measure release builds.** Debug builds add JIT CPU load.
- **Wake the TV first** (`adb shell input keyevent KEYCODE_WAKEUP`). Behind the Google TV screensaver (`dreamx`)
  the launcher starts but draws no frame, `requestAnimationFrame` stops, and intents with extras do nothing.
- **Network ADB stops in standby.** After `KEYCODE_SLEEP` over ADB, the TV can be reached again only after someone
  presses Power on the remote.
- **Cold start is slow right after an install** (background compile) and after a long idle. Use 3 or more runs, and
  drop the first.
- **logd can drop lines in the first seconds after boot.** `ActivityTaskManager: START … from uid <app uid>` is a
  more reliable sign of an activity start than the app's own log.
- **Desktop numbers don't predict the TV.** rAF intervals and key latency on a PC say little; only the render time
  agrees roughly.
- **`atrace` needs a small buffer** (`-b 4096`) on a 2 GB TV.
- **Package stubs:** `cmd package resolve-activity` can say "No activity found" for `OPEN_DOCUMENT` while the app's
  own query finds Android TV's stub (`frameworkpackagestubs`). Filter it out.

## Skins
- A skin id equal to a bundled one (`default`, `minimal`, `marquee`, `shelf`) fails lint (`reserved-id`).
- Choice option values must be name tokens (`p1`, not `1`).
- The core moves focus with a direction cone (`pick()`): put focusable items where a direction can reach them.
- Skin CSS is applied with `document.adoptedStyleSheets`, so it doesn't show as `<link>` in DevTools.
- In level 3, every move is a postMessage round trip: keep the work per focus change small. The Shelf showcase is
  at 43 ms key latency, near the 50 ms gate.
- The first focus can come before a banner image is decoded: read colours from it again on `load`.
- An editor that saves through a temporary file (for example `sed -i`) can make `lx dev` see that file for a moment.

## Development
- `npm test` needs the glob `tools/test/*.test.mjs`; a directory argument fails on Node 24.
- Tests and `lx` need Chrome for Testing (`npx playwright-core install chromium`, or set `LX_CHROME`).
- The Skin menu is async: tests must wait for its title before they read the items.
- Node's `server.close()` waits for keep-alive connections, and a browser page still open on the server can hold one
  for a long time: the test then times out. The test server calls `closeAllConnections()` too.
- Headless Chrome on a Linux CI runner doesn't let a sandboxed frame take the focus (`focus()` does nothing), so the
  focus guard's window `blur` never fires there. The `l3-hostile` test accepts that, and checks only that the frame
  doesn't end up with the focus. On Windows and in Android WebView the steal happens and the guard takes it back.
- Menus replace each other: end the previous screen first (`endMenu()`), or its `onClose` runs late.
- Line endings are LF. Some Windows tools write CRLF.
- `gh skill install` (no version) reads the **newest release tag**, not `main`: after a skill change, cut a release
  (push a `v*` tag; `release.yml` also builds the APK). Don't use `gh skill publish` to tag: it makes its own release,
  which has no APK, and the short install link needs one in the newest release.

## Signing
- **Back up the release key and `keystore.properties`.** An APK signed with another key can't update the installed
  app: the TV must uninstall it, and that deletes the launcher's data (export it first: `lx settings export --tv`).
