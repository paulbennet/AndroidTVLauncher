# Designing a skin: the look, the TV, and the cost of every pixel

Read with `docs/design-rules.md` (measured costs on a 2 GB Google TV with a Mali-G31 GPU).

## Ask first
- Who watches, from how far, in what light? A family room at 3 m needs larger type and stronger focus than a desk.
- What matters most on the first screen: favourites, inputs (HDMI), recent apps, a clock, a picture?
- Any brand colours, fonts or pictures? Are any pictures private (personal photos)? Then the skin must stay private:
  install it only on that TV, never in a gallery or a public repo, and use copies with the location and camera data
  removed, scaled to the screen size (≤ 1920×1080).

## 10-foot UI basics
- Design at 1920×1080; the page also runs at 960×540 CSS px with DPR 2. Keep ~5% safe margins (old TVs overscan).
- Text: body ≥ 24 px at 1080p, titles 40 px+; high contrast (WCAG AA 4.5:1 for text), no thin weights on dark
  photos without a scrim.
- **Focus must be obvious** from across the room: a ring or a clear scale (1.05–1.1) plus a colour change. Never
  only a subtle shadow. One focused thing at a time.
- Remote first: every action reachable with arrows + OK; long press (hold OK) is the app menu; Back goes home.
  Place focusable items in a grid or clear rows so each direction has an obvious target (the core moves by
  direction cones).
- Use the core blocks and stable hooks (`docs/skin-api.md` → "Stable markup and hooks") so focus, menus and the
  Settings entry keep working; always keep a way to **Launcher settings** (the core adds it to every app menu).

## Performance rules (measured; lint enforces most of them)
- **Animate only `transform` and `opacity`.** Paint properties (`box-shadow`, `filter`, `background`, sizes,
  positions) repaint every frame on this GPU.
- **No `backdrop-filter`** (84 ms per frame). Avoid big blurs, blend modes, fixed backgrounds, smooth scrolling.
- **What moves is opaque, with one radius.** A translucent ("glass") fill on a moving tile, or a different radius per
  corner, cost the VU31 ~8 ms more on every frame. Pre-mix glass colours over the background. No `box-shadow` on
  rotated elements and no `clip-path` on labels (they re-raster). Zoom (`scale`) re-rasters big tiles when it ends:
  lift them with `translate` instead.
- **No visible full-screen canvas.** Draw WebGL once, `toBlob()` it and show it as a CSS background image; redraw
  when the focus rests (~600 ms), not per key. Parallax of full-screen layers belongs behind an opt-in option.
- **Idle means zero frames:** no infinite animations at rest. Animate on focus change, then stop. A live scene (fish,
  fire, rain) may move for at most 20 s after a key, then it rests (see `gallery/skins/aquarium/live.js`).
- Short focus transitions (≤ 150 ms); one layer per tile at most; ≤ 8 elements with `will-change`.
- Images: WebP/AVIF, pre-scaled (banners 320×180, icons 160×160, wallpaper 1920×1080 max), ≤ 32 MB decoded total.
- Few DOM nodes (< 1500 with 50 apps). Don't add a second faded pseudo-element per tile (measured: p95 frame up 25%).
- Fonts: woff2, ≤ 2 files, ≤ 300 KB; system fonts (Roboto on Android TV) cost nothing.
- Level 3: keep per-focus work tiny (each key is a round trip to the core); reuse the tile's image URL instead of
  decoding new ones; WebGL is possible but draw only on focus change (one frame), never a continuous loop.
- The first frame after each key costs 25–30 ms of WebView draw time no matter what; budget the rest.

## Make it adjustable
Offer 1–4 options (`manifest.options`): accent colour, density/size, show names under icons, a picture choice.
Options are cheaper than separate skins, and users find them in **Launcher settings → Skin options**.

## Check the design on the real TV
`lx dev --tv` while you design (1 s per save). Look from the sofa, in the evening light, with the real remote.
Then `lx bench --tv`: aim for **Lite** (score ≥ 85); Standard is fine for heavier art; no tier means it will feel
slow and the guard may replace it.
