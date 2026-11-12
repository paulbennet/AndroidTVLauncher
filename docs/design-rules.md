# UI design rules (performance)

Derived from the probe on the Bravia VU31 ([probe-2026-11-08.md](probe-2026-11-08.md)): Mali-G31 GPU, 2 GB RAM,
pages rendered at 1920×1080. Rendering cost is Chromium raster/compositing on the 32-bit ARM CPU (app-side GPU time stays 3–5 ms). Re-check with `scripts/probe.sh` before breaking a rule.

## Do
- **Animate only `transform` and `opacity`.** These run on the compositor without repainting.
- **Paint effects once, then fade them.** For example, the focus ring is an inset `box-shadow` on `::after`, revealed with `opacity`.
- **Keep the page still at rest.** The idle home drew 0 frames; keep it that way (no ambient animation, a clock that ticks once a minute).
- **Change scroll position instantly** (`scrollTop`/`scrollLeft`), not with smooth scrolling.
- **Use small images.** Banners are 320×180 WebP and icons 160×160; pre-scale wallpapers. Large decoded bitmaps eat RAM.
- **Pause when hidden.** Native `onPause` stops WebView timers; don't start work in JS while the launcher is in the background.

## Don't
| Effect | Measured cost on the VU31 |
|---|---|
| `backdrop-filter` / blur (glass panels) | 84 ms median frame, 32 fps |
| A translucent fill on an element that moves (glass tiles) | ~15 ms compositor time on every frame of a focus move vs ~6 ms opaque (Tidepool, session 20). Pre-mix the glass colour over the background instead |
| A different radius per corner (`a b c d / e f g h`) on an element that moves | ~14 ms vs ~7 ms per frame with one radius (elliptical `40% / 50%` is fine) |
| A visible full-screen `<canvas>` (even a still one) | A GPU layer drawn on every frame, and the content painted above it needs layers too: ~+8 ms per frame. Show a still WebGL picture as a background image (`toBlob` → blob URL) |
| `box-shadow` on a rotated element, `clip-path` on a label | Re-raster ~40× and ~30× (desktop trace); Paper Cut p95 frame 120 → 52 ms without them |
| Sliding full-screen layers (parallax) | ~9 frames a second on Paper Cut: make it an opt-in "Depth motion" option |
| A shader drawn on every frame for 600 ms after each key | 8.7 janky frames per input (Tidepool). Draw once, when the focus rests |
| Animated `box-shadow` (glow, lift shadow) | 95 ms median, p95 642 ms, 16 fps |
| Many simultaneous animations (300 tiles) | 66 ms median, 17 fps |
| Full-screen WebGL shader / animated background | 69 ms median, 41 fps |
| Canvas 2D particle effects | 19 ms median, 27 fps |
| `will-change` on every tile | Extra GPU layers and memory; let Chrome promote only what animates |
| `overflow: hidden` + `border-radius` on tiles | Adds a mask layer; put the radius on the image instead |
| A second faded pseudo-element per tile (e.g. a focus bar under the ring) | p95 frame 39.5 ms vs 31.6 ms (default), over the 1.15× gate (Marquee, session 9) |
| Bigger tiles (`minimal`: 24rem favourites, 5 grid columns) | +0.25 janky frames per key vs default (1.31 vs 1.06); its colours alone cost nothing (session 10). Each focus move re-rasters the tile when the zoom ends, so cost grows with tile area |
| `LAYER_TYPE_HARDWARE` on the WebView | Worse: default p95 37.3 ms vs 31.8, 1.5 janky frames per key vs ~1.1 (session 10) |
| A large image that changes on every focus move (marquee/hero) | p95 frame 36.4 ms at 32rem wide, 33.0 ms at 26rem: keep it modest |

## Budgets
- Launcher scenes (focus moves, scrolling): under 8.5% janky frames (deadline-based). Run 2: focus 0.6%, scroll 0.0%.
- Memory: launcher process + WebView renderer under 182 MB, stretch goal under 136 MB.

## Lifecycle
- The launcher holds no memory for the app in front: after 60 s hidden the WebView and its renderer are gone, and after 2 min the process is gone.
  Don't rely on JS state surviving a return. Keep state in `localStorage` (favourites, hidden apps) and rebuild the UI from it.
- First paint after a rebuild should stay under about 1.5 s on the VU31. Keep `index.html` boot work small: no large JSON, no web fonts, no blocking scripts.
