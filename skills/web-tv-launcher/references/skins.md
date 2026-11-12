# Skins: from idea to a skin on the TV, and keeping it working

The complete, current reference is `docs/skin-api.md` in the repo (levels, manifest, tokens, options, layout
blocks, stable markup, level 3 SDK, lint rules, guard, bench, gallery). Read the section you need from it before
you write a manifest or layout by hand. This file is the workflow and the decisions around it.

You need the repo for `lx` (it is not on npm):
```bash
git clone https://github.com/paulbennet/AndroidTVLauncher && cd AndroidTVLauncher
npm ci && npx playwright-core install chromium
```

## 1. Decide the level (ask what the person wants first)
| They want | Level | Files |
|---|---|---|
| Other colours, sizes, wallpaper, font, columns | 0 | `manifest.json` with `tokens` |
| Different styling of tiles, rows, focus, clock | 1 | + `skin.css` (applied in `@layer skin`) |
| Different arrangement: hero area, side column, sections | 2 | + `layout.json` (blocks the core renders) |
| A screen of their own, with JavaScript (stage, shelves, animations) | 3 | `skin.html` + JS/CSS in a sandboxed iframe |
Choose the **lowest** level that does the job: it is faster on the TV, simpler, and the core keeps doing focus,
long press, menus and safety. Level 3 costs a postMessage round trip per key (the Shelf example is at 43 ms key
latency against a 50 ms gate).

Examples in the repo, read them first: `app/src/main/assets/web/skins/` → `minimal` (0), `default` (2, the
reference), `marquee` (2 showcase), `shelf` (3 showcase).

## 2. Create and preview
```bash
node tools/lx.mjs new my-skin --level 2 --name "My skin"   # folder name = id: lowercase, digits, "-"
node tools/lx.mjs dev my-skin --open                        # desktop preview with 50 reference apps, reloads on save
```
- The id must not be a bundled id (`default`, `minimal`, `marquee`, `shelf`): lint error `reserved-id`.
- Level 3: put `// @ts-check` at the top of `skin.js`; `lx.d.ts` (from `lx new`) gives editor checks of the `lx` SDK.
- Options (`manifest.options`): `toggle`, `choice` (values must be name tokens: `p1`, not `1`), `color`, `range`.
  The core shows them in **Launcher settings → Skin options** and passes the values to the skin.
- Design rules for the look and for speed: [skin-design.md](skin-design.md).

## 3. Check: lint, then bench
```bash
node tools/lx.mjs lint my-skin              # static + rendered checks, exit code 1 on errors
node tools/lx.mjs bench my-skin             # desktop estimate (render cost only, no gates)
node tools/lx.mjs bench my-skin --tv <ip>:5555   # the real check: ~6 min, release build on the TV
```
- **Lint errors block** packing and install. Each error names a rule; `docs/skin-api.md` → "Budget (lint rules)"
  says why. Common fixes: animate only `transform`/`opacity` (`animated-paint`, `animated-layout`); no
  `backdrop-filter`; no `transition: all`; no infinite animation at rest (`idle-animation`); images ≤ 1920×1080
  and ≤ 32 MB decoded in total; woff2 fonts only; nothing from the network (`external-url`).
- **Bench gates on the TV** (relative to `default` in the same session): janky frames per key ≤ 1.5, p95 frame
  ≤ 1.15 × default (rank-matched: each skin's k-th slowest frame, k = 5% of default's frames), key latency p95 < 50 ms, idle ≤ 1 frame/s (measured 25 s after the last key: a skin may move for 20 s after a key, then it must rest), total PSS < 182 MB, cold first frame ≤ 1.15 ×
  default. Score 100 = as fast as default. Tier: Lite ≥ 85, Standard ≥ 60, Rich = passes the gates; Heavy = only smoothness gates (jank, p95 frame, key
  latency) failed, and a TV uses the skin only with Launcher settings → Allow heavy skins on; a failed hard gate =
  no tier, and `lx pack --tv` refuses.
- `lx bench --tv` force-stops the launcher, which turns "Web Launcher home" off. It warns and prints the command to
  turn it on again; tell the TV's owner before you run it.
- Near a gate? Run it again (3+3 runs is the default, single runs are noisy) and look at which metric moved.

## 4. Try it on the TV
```bash
node tools/lx.mjs dev my-skin --tv <ip>:5555       # live: installs and shows the skin on every save (~1 s)
node tools/lx.mjs push my-skin --tv <ip>:5555 --open   # one copy as a dev skin (debug builds, or while benching)
node tools/lx.mjs install my-skin --tv <ip>:5555 --open # a real install through the TV's ADB inbox (any build)
```
Without ADB: on the TV **Launcher settings → Install skin** shows `http://<tv>:7190/` with a QR code and a 6-digit
PIN; upload the `.lxskin` from a phone or computer, or `node tools/lx.mjs install my-skin --lan <tv>:7190 --pin 123456`.
Test with the real remote: every row, long press (app menu), Back, Home, Settings, skin options, the clock across a
minute, and a return from another app after 2+ minutes (cold start).

## 5. Pack and publish
```bash
node tools/lx.mjs pack my-skin --tv <ip>:5555      # lint + bench + score.json + my-skin-<version>.lxskin
```
- Bump `version` in `manifest.json` for every release of the skin; the TV replaces an installed skin with the same id.
- Share the `.lxskin` file directly (chat, web page, GitHub release). Users install it from **Install skin** (phone
  upload, an `https://` link, QR code) or with `lx install`.
- A gallery (many skins with previews): `node tools/lx.mjs gallery build out/ my-skin other-skin` writes
  `gallery.json`, packages and previews; host `out/` on any **https** static host (GitHub Pages works); users set it
  in **Install skin → Skin gallery** (or `lx gallery set https://…/gallery.json --tv`). Test locally with
  `lx gallery serve out/ --tv` (debug build). Limits: index 256 KB / 200 skins, preview 512 KB, package 5 MB.
- **Never publish a skin that contains private photos** (personal pictures, faces, home): install those only on the
  owner's TV with `lx install` or the LAN page.

## 6. Debug a skin on the TV
| Symptom | Look at | Usual cause |
|---|---|---|
| TV shows the default skin and a message | `GUARD_TRIP reason=… culprit=…` | `hang` (busy loop ≥ 8 s, level 3), `crash` (renderer died twice), `jank` (3 slow 10 s windows), `memory` (> 150 MB app PSS or > 64 MB JS heap, twice) |
| "Skin … failed to load" | `SKIN_FAILED`, `SKIN_LINT` | Install-time lint error, missing file, bad manifest |
| Level 3 page replaced by the default skin at start | No `ready` from the frame within 6 s | The page didn't load the SDK: wrong `entry`, a script error before the SDK runs, or inline script (CSP blocks it; use files) |
| Level 3 app menu or OK does nothing | `L3_REJECTED focused …` | The page reported an item id the core never sent: use the ids from `lx` data |
| Focus can't reach an item | — | The core moves focus by direction cones (`pick()`): place focusable items where a direction reaches them |
| Colours/styles ignored on an old TV | WebView version (Launcher settings → About) | WebView < 99 has no `@layer`; a more specific core selector can win |
| Fine on desktop, slow on TV | `lx bench --tv` | Paint-heavy CSS, big images, shadows/blur, too many elements (`dom-size` > 1500) |
- Debug builds expose the WebView to DevTools: `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`
  then open `chrome://inspect` (or Playwright `connectOverCDP`). Skin CSS is in `document.adoptedStyleSheets`.
- Safe mode on the TV: hold **Back** 5 s.

## 7. Maintain
- After a launcher update: `lx lint` and `lx bench --tv` again; check `apiVersion` in the manifest against
  `docs/skin-api.md`.
- Keep the stable hooks (`docs/skin-api.md` → "Stable markup and hooks"); don't style internal classes that aren't
  listed, they can change.
- Re-pack (bump `version`) after any change; keep `score.json` from a TV bench, not only the desktop estimate.
- Keep a skin's source in git; the `.lxskin` is a build product.
