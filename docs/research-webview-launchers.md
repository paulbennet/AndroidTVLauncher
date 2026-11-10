# WebView-based TV launchers — prior art (researched 2026-11-08)

Very few launchers take this approach. Only one Android TV home screen is a true WebView + HTML launcher, and it is a hobby project.
The figures below are the authors' own measurements, not ours.

## Projects

| Project | UI tech | Why it matters | Maturity |
|---|---|---|---|
| [davidr44/android-tv-web-launcher](https://github.com/davidr44/android-tv-web-launcher) | WebView + vanilla JS; Java bridge `window.AndroidTV`; assets served from an intercepted origin | Closest match to our design, also on a Sony Bravia (Android TV 10). Shows HDMI inputs as apps, plus watch time | MIT, 0 stars, 5 commits |
| Bridge Launcher ([XDA](https://xdaforums.com/t/app-8-0-bridge-launcher-create-your-own-android-launcher-using-html-js-and-css.4650680/)) | Phone launcher; HTML/JS/CSS UI, TypeScript API types, dev mock | Reference for bridge API design (thread returned 403; known from search summary only) | Unknown |
| [piermark/omarchytv](https://github.com/piermark/omarchytv) | WebView (tested on WebView 138); separate saver / web / watchdog processes | Multi-TV themed launcher; documents per-brand quirks for setting Home (TCL, Philips, Fire OS) | MIT, 495 stars, 2.14.0-beta (2026-11-05) |
| [simbasjungles/free-my-tv](https://github.com/simbasjungles/free-my-tv) | Native Canvas on Android; HTML only on LG / Samsung | Performance benchmark and the boot-to-home fix | MIT, 6.1k stars |
| [nktnet1/webview-kiosk](https://github.com/nktnet1/webview-kiosk), [Fully Kiosk](https://www.fully-kiosk.com/docs/en/features/all) | WebView kiosk that can act as Home | Kiosk, not a TV launcher | AGPL-3.0 / commercial |
| [Philips hospitality TVs](https://www.philips.co.uk/p-p/43HFL5011T_12/professional-tv) | HTML dashboard as the home screen | Commercial hotel TVs use the same idea | Android 5.1 era |

Directory of open-source TV launchers: [cleanyourtv.org/open-source](https://cleanyourtv.org/open-source).

## Benchmarks → our targets

| Home screen | RAM | Frames | Source |
|---|---|---|---|
| Google TV stock | 242 MB | — | Free My TV / davidr44 |
| davidr44 (WebView) | 182 MB = app 111 + page 71; ~110 MB under memory pressure | median 10 ms, 90% ≤ 15 ms, **8.5% > 16.6 ms** | davidr44 README |
| Free My TV (native) | 96 MB | 60 fps, every frame ≤ 16.6 ms | README; TCL Google TV, Android 14 |
| Arc Launcher on our VU31 | 59–71 MB PSS | — | `sony-bravia-vu31/CHANGELOG.md` |

**Targets for this launcher** (checked by `probe.html` / `scripts/probe.sh`):
- Frames: under 8.5% slower than 16.6 ms and a median of 10 ms or less in the launcher-like scenarios (to beat davidr44).
- Memory: under 182 MB total (app + WebView renderer). Stretch goal: under 136 MB, the RAM Google TV home (105 MB) and its coreservices (31 MB) used on the VU31.

## Ideas worth borrowing
- **Boot / Home ownership (Free My TV):** the app connects to the TV's own ADB at `127.0.0.1:5555` with its own key and runs `cmd package set-home-activity`. It disables stock home with `pm disable-user`. A watchdog process restores stock home after 3 crashes in 5 minutes, and a check at boot keeps the choice across updates. On the VU31, disabling `launcherx` made `setupwraith/.RecoveryActivity` take over, so verify this before relying on it.
- **Memory pressure (davidr44):** destroy and rebuild the WebView on trim-memory callbacks. Keep pre-blurred backgrounds at 960×540. *(Done 2026-11-08: release at 60 s hidden with `WebViewRenderProcess.terminate()`, process exit at 2 min; see probe-2026-11-08.md.)*
- **OK on release (davidr44):** act on key-up, and only when the key-down also happened in the launcher, so a held OK doesn't leak into the launched app. *(We already act on key-up; we still need the "key-down was ours" check.)*
- **HDMI inputs as tiles (davidr44):** use `TvInputManager`, launch with `TvContract.buildChannelUriForPassthroughInput`, and track signal with `TvInputCallback`.
- **Continue Watching (Free My TV):** read Android TV's Watch Next list. Now Playing comes from a notification listener.
- **Secrets (Free My TV):** push API tokens over ADB into app-private storage and never bundle them in the APK.
- **Recovery UX:** offer one action that restores the stock home.
