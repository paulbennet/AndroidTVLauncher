# Skin API v1 (author guide)

A skin changes how the launcher looks, using JSON and CSS (levels 0–2) or a sandboxed page of its own with script (level 3). The core keeps ownership of:
- data (apps, favourites, hidden apps)
- remote navigation (D-pad, hold OK, Back, Home, Menu)
- menus and Launcher settings

The tooling lives in `tools/lx.mjs`. The plan and the reasons behind the rules are in [launcher-v1-plan.md](launcher-v1-plan.md).

## Quick start
```bash
npm install                                    # once: playwright-core, used by lx to drive Chrome for Testing
node tools/lx.mjs new my-skin --level 2 --name "My skin"   # --level 3: your own sandboxed page
node tools/lx.mjs dev my-skin --open           # live preview with 50 reference apps; reloads on save
node tools/lx.mjs lint my-skin                 # budget checks (static + rendered)
node tools/lx.mjs bench my-skin                # score and tier: desktop estimate (add --tv for the real check)
node tools/lx.mjs pack my-skin                 # lint, bench, write score.json, zip to my-skin-0.1.0.lxskin
node tools/lx.mjs install my-skin-0.1.0.lxskin --tv   # install on the TV (see Installing a skin)
```
To try a skin on the TV, push it over ADB (debug build: `scripts/install.sh debug`). `--open` previews it at once; to keep it, pick it in **Launcher settings → Skin**:
```bash
node tools/lx.mjs push my-skin --tv 192.168.1.20:5555 --open   # or set TV=host:port
```
`lx push` copies file by file into `/sdcard/Android/data/com.weblauncher.tv/files/skins/<id>/`. Don't use `adb push <folder>` from Windows: it drops or nests files in that folder.
If a skin breaks the screen, **hold Back for 5 seconds** to reopen with the default skin (safe mode). You can also run `adb shell am start -n com.weblauncher.tv/.MainActivity --ez safeMode true`.

## Installing a skin on the TV
Installed skins work on every build (release included) and stay until removed. Open **Launcher settings → Install skin** on the TV:

| Way | How |
|---|---|
| Phone or computer (LAN) | Scan the QR code or open the address shown (`http://<tv>:7190/`), enter the 6-digit PIN, pick the `.lxskin` file, or paste an `https://` link to one (the TV downloads it). From a computer: `lx install my-skin --lan 192.168.1.20:7190 --pin 123456` |
| ADB | `lx install my-skin --tv host:port [--open]` (a folder or a `.lxskin` file). It pushes the package to `Android/data/com.weblauncher.tv/files/inbox/` and asks the launcher to install it. Files left in the inbox are installed the next time the launcher comes to the front |
| USB | Only when the TV has a system file picker. The VU31 has none; the menu then says so |
| Skin gallery | **Install skin → Skin gallery** lists the skins of a gallery (see below), with a preview. Choose one, then **Install** or **Update to x.y.z** |

- The LAN page exists only while **Install skin** is on screen (10 minutes at most). It answers only on the TV's own address, and it needs the PIN. Five wrong PINs give a new one, and every install gives a new one too.
- Checks at install: at most 5 MB packed, 16 MB unpacked, 400 files. Safe file names only. `manifest.json` at the top, with a valid id that is not a built-in one (`default`, `minimal`, `marquee`, `shelf`), `apiVersion: 1` and level 0–3.
- Then the TV runs the **static lint** (the same `lint.js` as `lx lint`, without the rendered DOM checks): package, manifest, layout, CSS, the level 3 entry page and images. Any lint error rejects the skin, and the TV shows the first one (`lx install` prints it). Warnings are kept and counted in the Skin menu.
- A new version of an installed skin replaces the old one in one step; a rejected one changes nothing.
- **Score badge.** The Skin menu shows the tier that the package's `score.json` claims (`lx pack` writes it): `Lite`, `Standard` or `Rich`. It is marked `(estimate)` for a desktop bench and `(other TV)` when it was measured on another TV model. "no score" means the package has no `score.json`. Pack with `lx pack my-skin --tv` for a real TV score.
- **Settings backup.** The LAN page also saves and restores the launcher settings (favourites, hidden apps, the skin, every skin's options) as `launcher-settings.json`. Over ADB: `lx settings export [file] --tv` and `lx settings import <file> --tv`.
- **Install skin → Remove a skin** deletes an installed skin. If it was the active one, the launcher goes back to the default skin.
- **Live reload on the TV:** `lx dev my-skin --tv` installs the skin through ADB on every save and shows it (about 1 s; any build). Without ADB: on the TV turn on **Install skin → Live reload for lx dev**, then run `lx dev my-skin --lan 192.168.1.20:7190 --pin 123456`. The page then stays open (1 hour at most, or until another app comes to the front), the PIN stays the same, and every save shows at once as a preview.
- `lx push` (dev skins, debug builds) still works too.

### Skin gallery (gallery.json)
A gallery is a folder of static files on any `https://` host: `gallery.json`, the packages and their previews. There is no built-in gallery. Set its link on the TV's LAN page ("Gallery link"), with `lx gallery set https://…/gallery.json --tv`, or in a settings import (`galleryUrl`).

```json
{ "format": "web-launcher-gallery", "version": 1, "name": "My gallery",
  "skins": [ { "id": "ember", "name": "Ember", "version": "1.0.0", "level": 1, "author": "Ann", "description": "Warm colours.",
               "package": "ember-1.0.0.lxskin", "sha256": "<64 hex>", "size": 4096, "preview": "ember-1.0.0.jpg",
               "tier": "Lite", "score": 93 } ] }
```
- `lx gallery build <out-dir> <skin-dir|file.lxskin>... [--name "My gallery"]` writes all of this. A skin folder is linted (errors stop the build), zipped and shot in Chrome for Testing (1280×720 JPEG). A `.lxskin` from `lx pack` keeps its `tier` and `score`; a picture with the same name next to it is its preview.
- `lx gallery serve <dir> --tv` serves it on `127.0.0.1:7191` and points a **debug** build at it through `adb reverse`, to test a gallery before you publish it.
- The TV downloads everything natively (the launcher page has no network). Limits: `gallery.json` 256 KB and 200 skins; a preview 512 KB, PNG, JPEG or WebP (checked by its bytes); a package 5 MB. `package` and `preview` are relative to `gallery.json` or full `https://` links; redirects are followed at most 3 times and only to public `https://` hosts.
- An entry with a bad `id` (or a built-in one), `version`, `level` or `sha256` is left out. The package must match `sha256` and have the same `id` in its manifest. Then the usual install checks and the lint run. `tier` and `score` are the author's claim, shown as such.

## Examples to start from
The bundled skins in `app/src/main/assets/web/skins/` are readable examples; each passes the lint and the TV bench (Lite).

| Skin | Level | Shows |
|---|---|---|
| `minimal` | 0 | Tokens only: colours, sizes, columns |
| `marquee` | 2 | A layout of its own (`hero` marquee for the focused app, a side column with the clock), CSS on the stable hooks, `choice`/`color`/`toggle` options |
| `shelf` | 3 | Its own page: a side rail, a stage for the focused app, an A–Z shelf built in JS, a night and a paper theme |

## Levels
| Level | Files | What you can change |
|---|---|---|
| 0 | `manifest.json` (tokens) | Colours, radius, spacing, tile size, focus scale, grid columns, font, wallpaper |
| 1 | + `skin.css` | Any style of the core elements below (applied in `@layer skin`, which wins over the core) |
| 2 | + `layout.json` | Which blocks appear and how they nest, plus your own ids and classes to style |
| 3 | own page: `skin.html` + JS/CSS | Everything inside the screen, drawn by your own page in a sandboxed iframe (see [Level 3](#level-3-your-own-page-sandboxed)) |

## Package
```
my-skin/                 folder name = id (lowercase letters, digits, "-")
  manifest.json
  skin.css               any name; list it in manifest.styles (max 4 files, no @import)
  layout.json            level 2
  img/…  fonts/…         webp/avif/png/jpg/svg, woff2 only
```
All paths are relative and must stay inside the package. Nothing can load from the network: the page's CSP blocks it, and lint reports it. At level 3, WebRTC is removed from your page as well (`RTCPeerConnection` is undefined), DNS prefetching is off, and the WebView has no network at all (connections such as `<link rel=preconnect>` fail).

## manifest.json
```json
{
  "id": "my-skin", "name": "My skin", "version": "0.1.0", "apiVersion": 1, "level": 2,
  "author": "", "description": "",
  "tokens": { "accent": "#f2a93b", "radius": "0.7rem", "wallpaper": "img/bg.webp" },
  "styles": ["skin.css"],
  "layout": "layout.json",
  "options": [
    { "id": "compact", "type": "toggle", "label": "Compact tiles", "default": false },
    { "id": "density", "type": "choice", "label": "Density", "choices": ["cosy", "roomy"], "default": "roomy" },
    { "id": "tint", "type": "color", "label": "Accent", "choices": [{ "value": "#4fd1a5", "label": "Mint" }] },
    { "id": "zoom", "type": "range", "label": "Focus zoom", "min": 1, "max": 1.2, "step": 0.05, "default": 1.08 }
  ]
}
```

### Tokens → CSS custom properties
`1rem` is 1/96 of the screen width, so sizes look the same on any TV.

| Token | Property | Default |
|---|---|---|
| `bg`, `bg2`, `bg3` | `--lx-bg`, `--lx-bg2`, `--lx-bg3` (background gradient) | dark violet |
| `glow` | `--lx-glow` (radial highlight) | amber at 10% |
| `text`, `textDim` | `--lx-text`, `--lx-text-dim` | |
| `card` | `--lx-card` (tile background) | |
| `accent`, `onAccent` | `--lx-accent`, `--lx-on-accent` | amber |
| `ring`, `moving` | `--lx-ring` (focus ring), `--lx-moving` (reorder ring) | accent, light blue |
| `radius`, `gap`, `padX` | `--lx-radius`, `--lx-gap`, `--lx-pad-x` | 0.7rem, 1.4rem, 4.5rem |
| `tileWidth`, `ringWidth` | `--lx-tile-width` (row tiles), `--lx-ring-width` | 20.6rem, 0.22rem |
| `focusScale` | `--lx-focus-scale` (1–1.3) | 1.08 |
| `gridColumns` | `--lx-grid-columns` (1–12) | 6 |
| `font` | `--lx-font` (font-family list; load fonts with `@font-face` in level 1+) | Roboto |
| `wallpaper` | `--lx-wallpaper` (package image, at most 1920×1080) | none |

### Options
- The core shows options in **Launcher settings → Skin options** and saves them per skin.
- In CSS, every option appears as `html[data-opt-<id>]`: `on`/`off` for toggles, or the chosen value.
- Colour and range options also set `--lx-opt-<id>`.
- Ids written in camelCase become kebab-case: `clockDate` becomes `data-opt-clock-date`.

## layout.json (level 2)
A tree of blocks. Every block takes optional `id` and `class` (names: letters, digits, `_`, `-`). Limits: 64 blocks, 8 levels deep, and at least one `row` or `grid`.

| Block | Element | Attributes | Notes |
|---|---|---|---|
| `stack` | `lx-stack` | `dir`: `row`/`column`; `children` | Flex container |
| `scroll` | `lx-scroll` | `children` | Vertical scroller. The core keeps the focused tile visible |
| `section` | `lx-section` | `title`; `children` | Heading `h2.lx-title` with `.lx-count` |
| `row` | `lx-row` | `source`: `favourites`/`apps`/`recent`/`inputs`, `limit`, `empty` | Horizontal list, scrolled by the core |
| `grid` | `lx-grid` | `source`, `columns` (1–12), `limit` | |

`source: "recent"` lists apps recently opened from the launcher (newest first, up to 12; stored on the TV only; "Remove from Recent" in the app menu, "Clear recent apps" in Launcher settings). An empty Recent section is hidden.

`source: "inputs"` lists the TV's inputs (HDMI, AV, the tuner) as `<lx-tile kind="input" data-input="…" data-input-kind="hdmi|av|tuner|other" [connected]>` with an `svg.lx-input-icon` and `.lx-name`; OK opens the input. A section whose inputs row is empty (not a TV, or while benching) is hidden. `[connected]` means fully connected: the VU31 reports "standby" for every input, so it rarely shows.
| `hero` | `lx-hero` | | Focused app: `img.lx-hero-art`, `.lx-hero-title` |
| `clock` | `lx-clock` | `date`: `on`/`off` | `.lx-time`, `.lx-date`, updated once a minute |
| `memory` | `lx-memory` | | Free RAM chip; `[low]` when memory is low |
| `settings` | `lx-settings` | `label` | Focusable button that opens Launcher settings |
| `caption` | `lx-caption` | | Name of the focused banner app |
| `text` | `lx-text` | `text` | Static text |
| `spacer` | `lx-spacer` | | `flex: 1` |

Every layout is wrapped in `lx-root`, which also holds `lx-bg` (the background layer). Skins without a layout use the default skin's `layout.json`.

## Level 3: your own page (sandboxed)
A level 3 skin is a web page of its own: HTML, CSS and JavaScript (frameworks allowed; their bytes count against the 150 KB JS budget). Start from the template with `lx new my-skin --level 3`. It includes `lx.d.ts`: with `// @ts-check` at the top of `skin.js`, editors such as VS Code check your use of `lx` (event names, the fields of `data`) without a build step. `lx.d.ts` is never packed.

```
my-skin/
  manifest.json          "level": 3, optional "entry" (default skin.html); styles and layout are ignored
  skin.html              link your CSS and scripts with relative paths
  skin.js  skin.css  img/…
```

**How it runs**
- The core loads `entry` in `<iframe sandbox="allow-scripts">` from a separate host (`https://skin.local/` on the TV, `/__skin/` on the other loopback name in `lx dev`).
- The page has an opaque origin. Storage, cookies, popups, forms, top navigation, the parent page and the Android bridge are all out of reach.
- Its CSP allows only the skin host: no network (`connect-src 'none'`), no inline `<script>`, no `on…=` attributes, no `eval`. Inline styles are allowed.
- The frame is inert and never has keyboard focus. If your page calls `focus()`, the core takes the focus back; a skin that keeps doing it is replaced by the default skin.
- The core still owns the remote, Settings, menus and app launches. If your page hasn't loaded the SDK and said `ready` within 6 s, the default skin is shown instead. A page that stops responding is caught by the [runtime guard](#runtime-guard-on-the-tv).

**The SDK (`window.lx`)** is put in front of your page before your scripts run:

| API | Does |
|---|---|
| `lx.on('data', d => …)` | The apps to show. `d.apps` (all visible apps) and `d.favourites`: `[{ id, label, banner, image, fav }]`; `d.recent`: recently opened apps (newest first); `d.inputs`: TV inputs `[{ id: "input:…", label, kind, connected }]` (OK on `data-item="<id>"` opens one); `d.moving` (id being reordered, or null); `d.hiddenCount`. Sent at start and on every change. Render synchronously in the handler, or call `lx.refresh()` afterwards |
| `lx.on('focus', el => …)` | The focused element changed (it also has the `[focused]` attribute) |
| `lx.on('options', values => …)` | Skin option values (also `html[data-opt-*]` and `--lx-opt-*`, like levels 1–2) |
| `lx.on('home' \| 'resume' \| 'visibility', …)` | Home/Back pressed (focus is already on the first item), launcher shown again, page hidden or shown |
| `lx.refresh()` | Re-apply focus after you re-rendered outside a `data` handler |
| `lx.data`, `lx.focused` | The last data message, the focused element |

**Markup contract.** The SDK moves the focus with the core's own D-pad geometry, over elements you mark:

| Attribute | Meaning |
|---|---|
| `data-nav` | Focusable |
| `data-item="<id>"` | An app from `data`; OK launches it, holding OK or Menu opens its app menu |
| `data-action="settings"` | OK opens Launcher settings |
| `data-list="favourites"` / `data-list="apps"` | A list container; reset to the start on Home. While reordering, focus follows the moving app in `favourites` |
| `data-scroll` | Another scroller to reset on Home |
| `[focused]` | Set by the SDK on the focused element; style it (the SDK also calls `scrollIntoView({ block: 'nearest' })`; use `scroll-margin` for room) |

The core launches only ids it sent, and only when the user presses OK. A page can't launch anything by itself.

## Stable markup and hooks (levels 1–2)
```html
<lx-tile kind="banner" data-pkg="com.netflix.ninja" data-where="favourites" fav focused>
  <img class="lx-banner">
  <span class="lx-fav-dot"></span>
</lx-tile>
<lx-tile kind="icon" data-pkg="…" data-where="apps">
  <div class="lx-icon-wrap"><img class="lx-icon"> <!-- or div.lx-initials --><div class="lx-name">Play Store</div></div>
  <span class="lx-fav-dot"></span>
</lx-tile>
```

| Hook | Meaning |
|---|---|
| `[focused]` | On the focused tile or settings button (prefer it to `:focus`) |
| `[moving]` | Tile being reordered in Favourites |
| `[fav]` | App is a favourite |
| `[kind="banner"]`, `[kind="icon"]` | Tile shows a TV banner, or an icon and name |
| `html[data-skin="<id>"]` | Active skin |
| `html[data-opt-*]` | Skin options |

The core's menus, Settings and messages live in a protected layer (`lx-overlay`) that skins cannot style or hide.

## Budget (lint rules)
`lx lint` runs these checks. The costs behind them were measured on the Bravia VU31 ([design-rules.md](design-rules.md)).

| Rule | Error when |
|---|---|
| `backdrop-filter` | Any `backdrop-filter` (84 ms per frame) |
| `transition-all` | `transition: all` or a transition with no property list |
| `animated-paint`, `animated-layout` | Transition or `@keyframes` on `box-shadow`, `filter`, `background`, sizes, positions … (animate `transform` and `opacity` only) |
| `idle-animation` | An infinite animation running at rest (the idle launcher must draw no frames) |
| `will-change` | More than 8 elements with `will-change` |
| `dom-size` | More than 1500 elements with 50 reference apps |
| `external-url`, `external-load`, `no-import` | Anything outside the package |
| `image-size`, `image-memory` | An image larger than 1920×1080, or more than 32 MB of decoded images in total |
| `package-size`, `css-size`, `font-size`, `font-files`, `font-format` | Over 5 MB package, 60 KB CSS, 300 KB or 2 font files, or a font that isn't woff2 |
| `no-script` | Any `.js` file below level 3 |
| `inline-script`, `inline-handler`, `base-tag` | Level 3 entry page: inline `<script>` code, `on…=` attributes, or `<base>` (the CSP blocks them) |
| `missing-file` | A file named in the manifest (`styles`, `layout`, `entry`, wallpaper) is missing |

Warnings (shown, not blocking) cover:
- `blur()` filters
- blend modes
- fixed backgrounds
- smooth scrolling
- `will-change` on every tile
- transitions that repaint

## Runtime guard (on the TV)
The bench is a promise; the guard checks it while people use the launcher. When the running skin misbehaves, the launcher reloads with the default skin, shows why, and saves the default skin as the choice (pick yours again in Launcher settings → Skin).

| Trips when | Checked for |
|---|---|
| The page doesn't answer for 8 s (a busy loop in a level 3 page blocks the launcher too: they share one thread) | every skin |
| The WebView renderer dies twice within 10 minutes | every skin |
| 3 key-press windows in a row (10 s each, from the first key) are slow: more than 3 janky frames per key press (twice the bench gate), or more than 6 frames per key press that came late because script blocked the page | chosen skins, not `default` |
| Two samples in a row (one per minute while the launcher is in front) over 150 MB app process PSS or 64 MB JS heap | chosen skins, not `default` |

Nothing is measured in safe mode, while benching, or while another app is in front. Logcat (tag `WebLauncher`) shows `GUARD_TRIP reason=… culprit=…`; the page logs `GUARD_FALLBACK`.

## Bench (score and tier)
`lx bench` runs a fixed tour against the bundled `default` skin, interleaved, 3 runs each (median):
20 focus moves, 6 row changes, menu open and close, Home, then 30 s idle. It uses 50 reference apps.

| Hard gate (TV) | Limit |
|---|---|
| Janky frames per input (frames that miss their deadline, per key press that changes the screen) | ≤ 1.5 |
| p95 frame | ≤ 1.15 × `default` in the same session |
| Key latency p95 (keydown → next frame) | < 50 ms |
| Frames drawn while idle | ≤ 1 per second |
| Total PSS (app + WebView renderer) | < 182 MB |
| First frame after a cold start | ≤ 1.15 × `default` in the same session |

**Score** = 100 × the geometric mean of default ÷ skin for each metric, each capped at 1, so matching the default gives 100.
**Tier:** Lite ≥ 85, Standard ≥ 60, Rich = passes the gates. A failed gate means no tier, and `lx pack --tv` refuses to pack.

- `lx bench my-skin --tv [host:port]` is the real check:
  - It pushes the skin and starts the launcher with `--es bench <id>`, which uses reference apps and keeps settings in memory, so your favourites stay untouched.
  - It takes about 1 minute per run, 6 runs.
  - Use a **release** build (`scripts/install.sh release`); a debug build works but warns that its timings are slower.
- `lx bench my-skin` without `--tv` is a desktop **estimate**:
  - It scores only render cost: style, layout, paint, compositor draw and raster time over the tour, from a Chrome trace.
  - Gates are not checked.
  - Paint-heavy CSS shows up clearly. For example, large box-shadows plus `drop-shadow()` on every tile cost about 3× the default skin's render time and score about 30.
- `lx pack` writes the result into `score.json` (`bench`, `tier`, `tierEstimate`). Add `--tv` to pack with the TV's result.
