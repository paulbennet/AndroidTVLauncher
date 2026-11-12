# Launcher v1: implementation plan (2026-11-09)

The background and options are in [launcher-v1-analysis.md](launcher-v1-analysis.md). This plan records the decisions from the brainstorm and the build order.

## Decisions
| # | Topic | Decision |
|---|---|---|
| 1 | Skin authors | Anyone, and skins are shared. Treat skin code as untrusted from day one. |
| 2 | Levels | L0 tokens, L1 component CSS, L2 layout blocks, and L3 full JS, all in one package format. |
| 3 | Enforcement | The author tool runs the full lint and the bench. The TV re-runs the static lint at install, and a **runtime guard** falls back to the default skin when a skin regresses. |
| 4 | Devices | VU31 first. Scores are relative to the built-in skin on the same device, so other TVs work later. |
| 5 | Install paths | LAN upload page, URL or QR code, ADB or USB, and skins bundled in the APK. |
| 6 | Focus | The **core always owns** D-pad navigation, long press, Back, Home and Menu. Skins mark items as focusable and style the focus states. |
| 7 | Content APIs | HDMI inputs, Watch Next, now playing and notifications, and clock. **Weather is dropped:** skins have no network (decision 10), and there is no core weather block in v1. |
| 8 | Phasing | Skins first (M1 → M4 below). |
| 9 | Authoring | Plain HTML/CSS/JS with shipped `.d.ts` types and no build step. Frameworks are allowed in L3, and their bytes count against the budget. |
| 10 | Skin network | **None.** The CSP blocks every connection. Only the core may use the network, to download a skin from a URL. |
| 11 | Budget | Hard gates everyone must pass, plus a 0–100 score shown as **Lite / Standard / Rich**. |
| 12 | Skin options | Skins declare an options schema in the manifest. The core renders it in its own Settings and passes the values to the skin. |
| 13 | Bundled skins | Default (today's UI), Minimal L0, Showcase L2, Showcase L3. |
| 14 | Home ownership | Deferred. Keep Button Mapper for now. |

## Architecture
### Skin package
```
my-skin.lxskin (zip)
  manifest.json   id, name, version, apiVersion: 1, level 0-3, author, tokens{}, options[], styles[], layout?, entry?
  layout.json     L2: tree of blocks (hero, row, grid, clock, inputs, watchnext, nowplaying, spacer, group)
  skin.css        L1/L2: inside @layer skin; may target core components, attributes and custom properties only
  skin.html/.js   L3: runs in a sandboxed iframe with the SDK shim injected
  assets/         images (webp/avif/png/svg), fonts (woff2)
  score.json      written by `lx pack`: lint result, bench result, tier, tool version, device
```
They are installed to app-private `files/skins/<id>/<version>/`, and only one skin is active at a time.

### Serving and isolation
| Host | Serves | Policy |
|---|---|---|
| `https://launcher.local/` | core page, core components, and L0–L2 skin CSS, layout and assets (`/skins/<id>/…`) | Bridge available. CSP `connect-src 'none'`, except core endpoints. Skin CSS is **injected into `@layer skin`**, never as `<script>`. |
| `https://skin.local/` | L3 skin files, SDK shim, app images | Loaded in `<iframe sandbox="allow-scripts" inert>` (opaque origin, no storage). The bridge needs a token the frame can't read (R16). CSP: only `https://skin.local/`, `connect-src 'none'`, no inline script, `frame-ancestors https://launcher.local`. `pointer-events: none`; the core takes the focus back if the frame grabs it (R17). |

- **Core components** are light-DOM custom elements: `lx-hero`, `lx-row`, `lx-grid`, `lx-tile`, `lx-clock`, `lx-inputs`, `lx-watchnext`, `lx-nowplaying`. They have documented attributes (`focused`, `moving`, `kind`), custom properties (`--lx-*`) and slots. Light DOM keeps style recalculation cheap, and `@layer core, skin` makes skins win over core styles predictably.
- **L3 protocol** (`postMessage`, versioned):
  - core → skin: `data` (apps, favourites, moving …), `options`, `nav {dir}`, `home`, `resume`, `visibility`
  - skin → core: `ready`, `focused {itemId, action}` (R18: no `activate` or `menu`; OK and Menu act on the last reported focus)
  - The SDK shim runs the same `nav.js` geometry inside the frame, so a move needs no round trip. The core checks that an `itemId` is one it sent, so a skin can launch only items it was given.
- **State:** skins are stateless. The core persists focus, options and favourites, which survive the WebView release after 60 s and the process exit after 2 min.

### Performance budget
- **Static lint.** One JS module, run in Chrome for Testing by the author tool and in the WebView at install. It parses with CSSOM (`CSSStyleSheet.replaceSync`), so no parser has to ship.
  - Hard fails:
    - `backdrop-filter`
    - animated or transitioned `filter`, `box-shadow`, or layout properties
    - `infinite` animations on more than N elements
    - `will-change` on more than 8 elements
    - `@import` or `url()` pointing outside the package
  - Size limits (starting values, calibrated in M1):

    | Item | Limit |
    |---|---|
    | Package | ≤ 5 MB |
    | JS | ≤ 512 KB (was 150 KB; raised in session 18 for three.js, decision D14) |
    | CSS | ≤ 60 KB |
    | Fonts | ≤ 2 files, ≤ 300 KB |
    | Decoded images | ≤ 32 MB (w×h×4 summed) |
    | DOM | ≤ 1500 nodes with 50 reference apps |
- **Bench**, on fixed reference data (50 apps, 3 inputs, 6 watch-next items). The tour:
  - 20 focus moves in a row
  - 6 row changes
  - open and close the menu
  - Home
  - 30 s idle

  Metrics come from FrameMetrics, keydown→rAF and PSS:

  | Hard gate | Limit |
  |---|---|
  | Janky frames per input (R14) | ≤ 1.5 |
  | p95 frame (R15) | ≤ 1.15 × default, same session |
  | Key latency p95 | < 50 ms |
  | Frames drawn while idle | ≤ 1 per second |
  | Total PSS | < 182 MB |
  | First frame after a cold start (R15) | ≤ 1.15 × default, same session |
- **Score and tier.** Score = 100 × the geometric mean of default/skin for each metric, capped at 1.
  - **Lite** ≥ 85, **Standard** ≥ 60, **Rich** passes the gates only.
  - **Heavy** = only smoothness gates failed (janky frames per key, p95 frame, key latency): the skin can stutter on a slow TV, and a TV uses it only with **Launcher settings → Allow heavy skins** on (off by default). (R27)
  - The score uses the median of 3 runs (R11).
  - The desktop estimate scores render cost from a Chrome trace, and gates are TV-only (R12). It is marked as an estimate until it is run with `--tv`.
- **Runtime guard** (shell `RuntimeGuard.kt` and core, R20): fall back to the default skin, save it as the choice, and show the reason when the skin:
  - hangs: no answer to a ping for 8 s (every skin)
  - crashes the renderer twice in 10 min (every skin)
  - janks: 3 bad 10 s windows after input in a row (FrameMetrics > 3 janky frames per key, or > 6 late script frames per key)
  - uses too much memory: app PSS > 150 MB or JS heap > 64 MB, in 2 samples 60 s apart
  - **Safe mode:** hold Back for 5 s, or `adb shell am start … --ez safeMode true`.

### Author tool `lx` (Node, uses Playwright with Chrome for Testing)
| Command | Does |
|---|---|
| `lx new <name> --level N` | Scaffold with types (`lx.d.ts`) |
| `lx dev <dir> [--tv]` | Desktop simulator with reference data and live reload. With `--tv`, live reload on the TV through the LAN upload endpoint |
| `lx lint <dir>` | Static lint |
| `lx bench <dir> [--tv]` | Bench: desktop estimate (render cost), or authoritative on the TV over ADB (gates, score, tier) |
| `lx pack <dir> [--tv]` | Lint, bench, write `score.json`, zip to `.lxskin` |
| `lx push <dir> [--tv] [--open]` | Copy to the TV's dev skins folder over ADB (debug builds); `--open` previews it (added in session 3) |

## Milestones
### M1: core and skin system, L0–L2 (no new permissions)
1. Split today's UI into the **web core** (data store, focus engine, router, core Settings, menu) and the **default skin**.
2. Core components and `@layer` styling. Manifest parser with `apiVersion`. Skin loader for L0, L1 and L2.
3. Skin store in the native shell (`files/skins`), with bundled skins copied from assets. Serve `/skins/<id>/…`.
4. Options schema, rendered in core Settings. Skin switcher, and safe mode.
5. `lint.js` (shared), plus `lx new/dev/lint/pack` (desktop only).
6. Bench harness: reuse `FrameStats` and `probe.sh` for the scripted tour, with `lx bench --tv` over ADB. Calibrate the throttle factor.
7. Bundled skins: Default and Minimal L0.

Done when the default skin, rebuilt on the skin system, matches the prototype's numbers on the TV (focus jank about 0.8%, idle about 140 MiB), and switching skins and safe mode work with the remote.

### M2: L3 sandbox, guard and install paths
1. `skin.local` host, sandboxed iframe, SDK shim, `postMessage` protocol with `itemId` validation. Measure the iframe's memory cost.
2. Runtime guard and automatic fallback.
3. Install paths:
   - **LAN upload page**: a ServerSocket open only while "Install skin" is on screen, with a 6-digit PIN shown on the TV. It also serves `lx dev --tv` live reload.
   - **URL / QR**: the core downloads, which adds the `INTERNET` permission.
   - **ADB inbox**: `Android/data/<pkg>/files/inbox`.
   - **USB**: through the SAF picker, if the TV has one.
4. Install-time lint and the score badge. Export and import of settings (favourites, options, active skin).
5. Bundled skins: Showcase L2 and Showcase L3.

### M3: content APIs
1. HDMI inputs: `TvInputManager`, with a passthrough launch.
2. Watch Next: `TvContract.WatchNextPrograms`. **Risk:** read access may be restricted on Google TV, so verify on the VU31 first.
3. Now playing and notifications: `NotificationListenerService` and `MediaSessionManager`, with the grant through `cmd notification allow_listener` over ADB.
4. Clock block. Matching core components and L3 data messages.

### M4: later
Home ownership at boot (on-device ADB, the Free My TV approach), a remote gallery, and other TVs.

## Risks to check early
- **L3 iframe cost** in memory and frames on the VU31 (M2, step 1). If it is too high, L3 becomes "Rich only" or is limited to one iframe.
- **Watch Next** and **notification listener** access on Google TV 14.
- **No SAF picker** on many TVs. USB install may need a file browser of our own, or ADB only.
- **Desktop-to-TV calibration** may not hold across all scenarios. The TV bench stays the authoritative check.
- **Bench noise:** run 3 times, with margins of about 1 sd from the 4-run baseline.

## Revisions after self-review (2026-11-09)
| # | Change | Why |
|---|---|---|
| R1 | Core UI (menus, Settings, toast) lives in a **shadow root** on a host with inline `!important` positioning. The app menu always includes **Launcher settings**. **Native safe mode** (hold Back 5 s, or `--ez safeMode true`) reloads with the bundled default skin. | Skin CSS can hide anything in the light DOM, even `html { opacity: 0 }`. The only escape hatch a skin can't touch is one triggered natively. |
| R2 | Skin CSS is applied as a constructable `CSSStyleSheet({ baseURL })` wrapped in `@layer skin { … }`, with no `@import`. The lint parses the same sheet. | Relative `url()` resolves inside the package, the layer order is guaranteed, and parsing happens once. |
| R3 | The score is relative to a **pinned reference skin** (bundled `default` at `apiVersion` 1), not whatever the default becomes later. | Otherwise every change to the default skin would shift every score. |
| R4 | Bundled skin ids are reserved. An installed skin can't shadow `default` or `minimal`. | Safe mode and the reference skin stay trusted. |
| R5 | CSP `<meta>` in `index.html` (`default-src 'self'`, no inline scripts), plus the native 403 for other hosts. | Defence in depth: neither layout text nor CSS can load anything external. |
| R6 | Installed skins go in `files/skins/<id>/` (one version per id). Debug builds also read `Android/data/<pkg>/files/skins/` (writable with `adb push`). | Gives an authoring loop on the TV in M1, before the M2 install paths exist. |
| R7 | Manifest, layout and token validation is a pure module (`core/validate.js`) with `node:test` unit tests. | It runs in the WebView, in Node (`lx lint`) and in tests. |
| R8 | D3 is closed: no weather in v1. | Skins have no network, and there is no core weather block. |
| R9 | Boot never yields before the first frame: `core.js` is `<script type="module" async blocking="render">` in `<head>`, the active skin's JSON/CSS come from the synchronous bridge call `readSkinText(id, path)`, and `index.html` has no desktop-only script (the dev server injects `mock.js`). | On the VU31, an empty first paint costs ~500 ms and a classic `mock.js` cost ~550 ms of parser time. With R9, release cold start equals the prototype. |
| R10 | Back-hold safe mode uses a 5 s timer from key-down, not key-repeat events. | Injected keys (and possibly some remotes) send no repeats while held, so the old check never fired. |
| R11 | Bench results are the **median** of the runs, not the mean. | On the desktop, one disturbed run moved key latency from ~18 to ~70 ms. |
| R12 | The desktop estimate has no CPU throttle. It scores only `renderMs` (main frame + `Display::DrawAndSwap` + raster, from a Chrome trace), and every gate is TV-only. | rAF frame times are vsync-bound on the desktop: a paint-heavy skin and the default both showed ~1% jank. Desktop key latency has random ~200 ms stalls from software raster in the headless GPU process. `renderMs` is stable (±8%) and shows paint cost: a box-shadow + `drop-shadow()` skin cost 285 ms vs 80–93 ms. |
| R13 | `--es bench <skin>` (any build) serves 50 fixed reference apps (`ReferenceApps.kt`, same as `mock.js?apps=50`), opens `?skin=<id>&bench`, and lets SkinStore read dev skins. The page keeps settings in memory when `?bench` is set. | Timings are only valid on release builds, which otherwise ignore dev skins. Benching must not read or change the user's favourites. Only ADB can write `Android/data` on Android 11+, and skins are untrusted by design. |
| R14 | The jank gate counts **janky frames per input** (≤ 1.5): janky frames divided by the number of frame bursts (frames < 100 ms apart, one per key press that changes the screen). It replaces "< 8.5% of frames". Decision D4, session 4. | On the VU31 the first frame after every key misses its deadline (25–30 ms, WebView draw) in every CSS variant tried. The default skin measures ~1.2 per input and a skin without transitions ~0.9; as a share of frames these were 13% and 68–89%, which ranked the cheaper skin far worse. |
| R15 | The p95 frame and cold first-frame gates are **relative**: at most 1.15 × the default skin measured in the same bench session. Decision D5, session 4. | Both absolute limits (33 ms, 1.5 s) sat inside the default skin's own noise: p95 31.4–31.6 ms, cold start 1407–1919 ms in one day. With them, minimal (an L0 recolour of default, score 96) got no tier. |
| R16 | Every bridge method takes a **per-page token** first. `LocalAssetClient` puts a fresh token in each main-frame HTML response (`<meta name="lx-token">`) and refuses core HTML in subframes; `core/bridge.js` adds it to every call. | Android WebView injects `addJavascriptInterface` objects into all frames, so a sandboxed L3 frame would otherwise get `launch()`, `getApps()` and the rest. The frame is cross-origin and can't read the top page. |
| R17 | The core watches for the skin frame taking focus (window `blur`) and takes it back; more than 3 times in 10 s replaces the skin with the default one. A frame with no `ready` within 6 s is replaced too. | In Chrome for Testing, `element.focus()` inside an `inert`, sandboxed, cross-site iframe still moved focus there, and the remote's keys with it. |
| R18 | Skin → core messages are only `ready` and `focused {itemId, action}`. OK, hold OK and Menu act on the last reported focus; `action` can only be `settings`. | A skin can then launch only an app the core sent, and only when the user presses OK. `activate`/`menu` messages would let a skin launch at any time. |
| R19 | Desktop skin host: `/__skin/` on the other loopback name (localhost ↔ 127.0.0.1), so the frame is cross-site as on the TV. `lx` runs Chrome without site isolation, so the frame shares the page's renderer as in WebView. | Same security behaviour and a comparable render/memory cost on the desktop. |
| R20 | Runtime guard as built: native ping watchdog (hang), renderer deaths (crash), FrameMetrics **and** a core rAF late-frame count (jank), app PSS and JS heap (memory). Jank and memory skip `default`, safe mode and the bench. A trip reloads `?guard=<reason>&culprit=<id>`, and the core saves `default` if the culprit was the saved skin. | Measured in session 6: a busy loop in the L3 frame blocks the core too (one renderer thread), so only native code can get out. FrameMetrics doesn't see script jank (`l3-janky`: 1.17 janky frames per key, but 16.5 late rAF frames). The isolated renderer's PSS can't be read from the app, so the plan's "PSS over the gate" becomes app PSS plus JS heap. |
| R21 | The app has `INTERNET` (LAN install page, URL downloads), so skin frames lose WebRTC: `sdk.js` deletes the `RTC*` globals before skin code runs, and skin responses turn DNS prefetching off. The LAN page needs a PIN, checks the Host header and is open only while Install skin is on screen. USB install only when a real file picker resolves. | Measured in session 7: with `INTERNET`, `RTCPeerConnection` in the sandboxed frame reached a public STUN server; CSP doesn't cover WebRTC. The frame has no other realm to restore it from (child frames are cross-origin, workers and popups are blocked). The VU31 has no picker, only a stub. |
| R22 | The install-time lint runs **in the page** before the new version is swapped in: SkinInstaller stages the package at `/staged/<stage>/`, and the page runs `lintStatic` (no DOM render) and answers through the bridge. Any error rejects the package. The badge shows the tier the package's `score.json` claims, marked "estimate" or "other TV". | `lintCss` needs CSSOM and `lintImages` needs image decoding: only the WebView has both, and it is the same `lint.js` that `lx` runs. The TV can't bench at install, so the score stays the author's claim, labelled as such. |
| R24 | Old engines: on a WebView before Chromium 99 (no `@layer`), LocalAssetClient serves `core.css` without its layer and `skins.js` adds none; empty Recent/Inputs sections are hidden with an `lx-empty` attribute set by `render()`, not `:has()` (105). About shows the WebView version. | Measured in session 14 on the Android TV 12 emulator (WebView 91, no updates without Play): every `@layer` block was dropped and the page was unstyled. Many older TVs never update their WebView. |
| R25 | Every native download (URL install, gallery index, previews, packages) follows redirects by hand, at most 3, and checks each hop (https or debug loopback, public host). Gallery packages must match the index's SHA-256 and manifest id. | `HttpURLConnection` followed redirects before the host check, so a public link could make the TV request a device on the home network. The gallery index comes from a host the user named, but its packages may live elsewhere. |
| R26 | The p95 frame gate is **rank-matched** (decision D17 a, session 20): both skins are judged by their k-th slowest tour frame, k = 5% of the frames the reference drew (8 of ~146). A skin that drew fewer than k frames counts the missing ones as 0 ms. | A plain p95 of the skin's own frames punished skins that draw few frames: Phosphor drew 51 frames vs 146, so its p95 was one of default's slowest few (73.7 ms, failed). |
| R27 | Tier **Heavy** and the setting **Allow heavy skins** (decision D19 b, session 20). The smoothness gates (janky frames per input, p95 frame, key latency) no longer refuse a package: a skin that fails only those is packed as `Heavy`. The launcher switches to a Heavy skin only when the owner turned the setting on (off by default, stored per TV, not in a settings export); turning it off while a Heavy skin is active goes back to the default skin. Idle frames, memory and cold start stay hard gates. | Rich skins (WebGL pictures, glass, big art) can look right and still miss a smoothness gate on a Mali-G31 TV. The owner of a fast TV, or one who accepts stutter, can choose them; nobody gets one by accident. The hard gates protect the TV itself (battery of frames at rest, memory, start time). The tier is the package's own claim, like every score badge. |
| R28 | A skin may move for up to **20 s after a key** (`LIVE_SECONDS`), then it must rest. `lx bench --tv` waits 25 s after the tour before it measures idle frames (decision D24 b, session 21). The idle gate stays hard. | Live Aquarium, Holiday and Code Rain move by default (D23 b: fish, fire, falling rain). A scene that never rests costs power all day on a TV that shows the home screen; one that rests after 20 s keeps the gate meaningful. |
| R23 | The WebView has no network: `androidx.webkit` ProxyController points it at a dead proxy (`127.0.0.1:9`). Every page is served by LocalAssetClient, and downloads are native. | Measured in session 11: with `INTERNET`, a skin's `<link rel=preconnect>` opened a TCP connection to another host. CSP doesn't cover preconnect, and a JS block can't catch parser-made links. The proxy closes this and any other channel CSP misses. |

## Progress tracker
Status: ✅ done · 🟡 in progress · ⬜ not started · ⏸ deferred

| Step | Status | Notes |
|---|---|---|
| M1.1 Split the UI into web core + default skin | ✅ | `core/` (core.js, nav.js, skins.js, validate.js, core.css, overlay.css), `skins/default`. Checked on the desktop and on the TV. |
| M1.2 Core components, `@layer`, manifest, L0–L2 loader | ✅ | Light-DOM `lx-*` blocks, `@layer core, skin`, R1/R2/R5 working: a hostile test skin can't hide the overlay, escape its layer, `@import` or load external images |
| M1.3 Native skin store, `/skins/` serving | ✅ | `SkinStore.kt` handles bundled, installed and dev skins; `tools/serve.mjs` mirrors it (`SKINS_DIR`). Dev path checked on the TV with `lx push` |
| M1.4 Options schema, skin switcher, safe mode | ✅ | Switcher and options menu checked on the desktop. On the TV: `--ez safeMode true`, and Back held 6 s (not 3 s) both open the default skin (R10) |
| M1.5 `lint.js` + `lx new/dev/lint/pack/push` | ✅ | `core/lint.js` (package, CSS, DOM and image checks) and `tools/lx.mjs`. `lx push [--open]` copies a skin to the TV over ADB; `lx dev --tv` needs the M2 LAN endpoint |
| M1.6 Bench harness (`lx bench --tv`), throttle calibration | ✅ | `lx bench [--tv]` and `pack` work on the TV (release, 3+3 runs, stable). Desktop estimate agrees roughly (minimal 92–100 vs TV 98; heavy 32 vs TV 20). Gates: jank per input (R14, D4); p95 and cold start relative to default (R15, D5). Throttle calibration replaced by R12 (no throttle). Confirmed on the TV: minimal passes every gate, score 94, Lite |
| M1.7 Bundled skins: Default, Minimal L0 | ✅ | Both pass lint; Default passes the exit check |
| — Cold-start regression vs the prototype | ✅ | Closed by R9. Release, 8 runs each: process → first frame 1389 ms vs prototype 1384 ms |
| M1 exit check on the TV (no regression vs the prototype) | ✅ | Release, same real-page focus tour, 3 runs each: jank 9.9–10.3% vs prototype 10.3–11.1%; idle PSS ~143 vs ~141 MiB. The "0.8%" in the plan came from `probe.html`'s synthetic scene and isn't comparable |
| — Focus-move jank ~10% on the real page (design rule: < 8.5%) | ✅ | Closed in session 10 as a platform limit: the WebView draw of the first frame after a key (25–30 ms) can't be removed from CSS; a hardware layer made it worse. The gate is per key (R14). Older notes: cause found (session 4, frame breakdown). (1) The first frame after every key misses its deadline in every variant: 25–30 ms, mostly in COMMAND_ISSUE (WebView draw). (2) The default skin adds ~4 frames when its 120 ms zoom ends (layer drop). (3) "Janky %" rises when a skin draws fewer frames. See the session 4 table |
| M2.1 L3 sandbox + SDK shim + iframe cost | ✅ | Session 5 (desktop) and 6 (TV). TV bench `l3-basic` vs `default`: PSS +2 MB, key p95 40 vs 23 ms, cold start +63 ms, score 89 Lite. Token, CSP and focus guard checked in WebView |
| M2.2 Runtime guard | ✅ | Session 6 (R20). On the TV: hang, crash, memory and script jank each trip with their test skin; `l3-basic` doesn't |
| M2.3 Install paths (LAN, URL/QR, ADB inbox, USB) | ✅ | Session 7 (R21). On the TV: ADB inbox, LAN page (PIN, Host check, phone upload), URL (https, errors), QR; USB only with a real picker (none on the VU31). `lx install` |
| M2.4 Install-time lint, badge, settings export | ✅ | Session 8 (R22). On the TV: bad-skin rejected with its first lint error, badge "Lite (estimate)", settings export/import over ADB and LAN |
| M2.5 Showcase L2 + L3 skins | ✅ | Session 9. Bundled `marquee` (L2, TV score 95 Lite) and `shelf` (L3, 87 Lite); all gates pass on the TV |
| M3.1 HDMI inputs | ✅ | Session 12. `InputRepository` (TvInputManager, no permission), passthrough/channels intent; `source: "inputs"` rows; L3 `d.inputs` (`input:` ids, validated by the core). On the TV: HDMI 1–3 / ARC, Video, Channels; OK opens HDMI 1 |
| M3.2 Watch Next → Recent | ✅ | Watch Next can't be read (session 12: `ACCESS_ALL_EPG_DATA` is signature/privileged). Decision D4 (a): a Recent row from the launcher's own launches (`source: "recent"`, L3 `d.recent`), session 13. On the TV: opening YouTube adds it |
| M3.3 Now playing + notifications | ⏭ | Dropped by the user (decision D5 c, session 13): it would need notification access to every notification on the TV |
| M3.4 Clock block, L3 data | ✅ | The clock block exists since M1; L3 data now carries `recent` and `inputs` (session 13). M3 is complete |
| M4.1 Open at TV start (decision D6 a) | ✅ | Session 14. `BootReceiver` (BOOT_COMPLETED) opens the launcher when "Display over other apps" is allowed (user grant over ADB) and **Open at TV start** is on (default). On the Android TV 12 emulator: skipped without the grant, opened on top of the stock home with it. On the VU31 (session 14, user's grant, one reboot): `BOOT_OPEN started=true`, `BOOT_OPEN shown`, the launcher is the top activity; first frame 6.3 s after its process start (the TV is still busy with boot work) |
| M4.2 Skin gallery, TV side (decision D7 b) | ✅ | Session 14. `SkinGallery.kt`, Install skin → Skin gallery, LAN "Gallery link", `--es galleryUrl`, `galleryUrl` in settings, `lx gallery build/serve/set`. On the emulator through `lx gallery serve --tv`: list, preview, install, checksum mismatch refused. No public gallery yet |
| M4.3 Other TVs (decision D8 a) | ✅ | Session 14. Android TV 12 emulator (API 31, WebView 91): unstyled page found and fixed (R24); apps, menus, gallery and boot open work |
| **v1.0 closed** | ✅ | Session 15. Version 1.0.0 (versionCode 2), local tag `v1.0`. Final review, 48 tests, 4 bundled skins lint clean, signed release (v2 scheme) installed on the VU31 over the old build: settings and the overlay grant kept, cold start 1.42–1.46 s |
| M5.1 Release gallery skins (6 + 3) | 🟡 | Sessions 19–21. Nine skins packed with VU31 scores (release, 3+3 runs, R26–R28) in `dist/gallery/` and built into `site/gallery/` + `site/skins/` + `docs/showcase.md`: Bauhaus 100 Lite, Phosphor 100 Lite, Playroom 90 Lite, Constellation 82 Standard, Paper Cut 84 Heavy, Tidepool 77 Heavy, Aquarium 52 Heavy, Holiday 47 Heavy, Code Rain 28 Heavy (all hard gates pass). Version 1.3.0, notices done. Not yet: export, push, tag v1.3.0 (CI builds the APK, Pages deploys `site/`) |
| M4.4 Open on Google TV home (session 17, decision D2 b) | ✅ | v1.0.1 (versionCode 3). `HomeWatchService` (accessibility, `launcherx` window-state events only, no window content). On the VU31: reboot → launcher 1.7 s after Google home (BootReceiver alone: 26 s); `am start` Google home → back in ~1 s. The user turned it on over ADB (next to Button Mapper's service) |
