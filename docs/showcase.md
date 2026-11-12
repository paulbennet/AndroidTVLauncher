# Skin showcase

9 skins in the project's gallery, each a different idea and technique. Live page with pictures:
[https://paulbennet.github.io/AndroidTVLauncher/skins/](https://paulbennet.github.io/AndroidTVLauncher/skins/). The sources are in [`gallery/skins/`](../gallery/skins/).

## Install from the TV
1. **Launcher settings → Install skin → Skin gallery → Use the Web TV Launcher gallery.**
2. Pick a skin, **Install**, then **Use it now**.

On a launcher older than 1.3.0, set the gallery link on the Install skin page (phone or computer):
`https://paulbennet.github.io/AndroidTVLauncher/gallery/gallery.json`.
If that link does not load, the same gallery is mirrored at `https://cdn.jsdelivr.net/gh/paulbennet/AndroidTVLauncher@main/site/gallery/gallery.json`.

## The skins
| | Skin | Level | Tier | What it shows |
|---|---|---|---|---|
| <img src="https://paulbennet.github.io/AndroidTVLauncher/gallery/constellation-1.0.0.jpg" width="240" alt=""> | **Constellation** | 3 | Standard: passes every gate (score 82) | Your apps as a night-sky map. Favourites form a bright constellation, other apps are fainter stars, and a three.js sky that can move in depth as you fly from star to star. three.js sky painted once, then flattened to one picture; stars as focus targets placed by hand. |
| <img src="https://paulbennet.github.io/AndroidTVLauncher/gallery/tidepool-1.0.0.jpg" width="240" alt=""> | **Tidepool** | 3 | Heavy: can stutter on slow TVs (needs “Allow heavy skins”) (score 77) | A calm deep-sea pool: glass pebbles for your apps, and caustic light (three.js) that takes the colour of the app you pick. three.js caustic light baked into the sea-floor picture when the focus rests; opaque "glass" pebbles. |
| <img src="https://paulbennet.github.io/AndroidTVLauncher/gallery/papercut-1.0.0.jpg" width="240" alt=""> | **Paper Cut** | 3 | Heavy: can stutter on slow TVs (needs “Allow heavy skins”) (score 84) | A hand-made paper diorama: layered paper hills (three.js) that follow the time of day, pinned paper cards for your apps, and optional depth motion. three.js paper hills painted once per time of day; follows the clock (day, dusk, night). |
| <img src="https://paulbennet.github.io/AndroidTVLauncher/gallery/aquarium-1.0.0.jpg" width="240" alt=""> | **Live Aquarium** | 3 | Heavy: can stutter on slow TVs (needs “Allow heavy skins”) (score 52) | A planted reef tank fills the screen; fish swim for a while after each key press, then rest. Your apps sit in one quiet row, and the row steps aside when you only watch. Live for 20 s after a key: fish cut-outs drawn on a canvas over a still tank, then the scene rests. |
| <img src="https://paulbennet.github.io/AndroidTVLauncher/gallery/holiday-1.0.0.jpg" width="240" alt=""> | **Holiday** | 3 | Heavy: can stutter on slow TVs (needs “Allow heavy skins”) (score 47) | A cosy living room on a winter evening: the fire flickers, the tree lights twinkle and snow falls outside for a while after each key press. Your apps sit in one quiet row. Live for 20 s after a key: fire glow, tree lights and snow over a still photo of the room. |
| <img src="https://paulbennet.github.io/AndroidTVLauncher/gallery/coderain-1.0.0.jpg" width="240" alt=""> | **Code Rain** | 3 | Heavy: can stutter on slow TVs (needs “Allow heavy skins”) (score 28) | Streams of glowing code fall in depth over a dark floor. Each app is a stream that ends in its picture and name; the rain falls for a while after each key press, then holds still. Live for 20 s after a key: three depths of glyph rain from sprite sheets; apps are portals in the rain. |
| <img src="https://paulbennet.github.io/AndroidTVLauncher/gallery/phosphor-1.0.0.jpg" width="240" alt=""> | **Phosphor** | 1 | Lite: as fast as the default skin (score 100) | A 1980s green-screen terminal as your home screen. Level 1: only CSS on the launcher's own layout, no scripts. Level 1: only CSS on the default layout. Static glow and scanlines, three colours. |
| <img src="https://paulbennet.github.io/AndroidTVLauncher/gallery/bauhaus-1.0.0.jpg" width="240" alt=""> | **Bauhaus** | 2 | Lite: as fast as the default skin (score 100) | A 1920s poster as your home screen: a giant clock over a red circle, primary-colour blocks with one shape each, and the focused app set vertically. Level 2: a layout file and CSS. Level 2: its own layout file plus CSS. Flat shapes, no pictures, the fastest skin here. |
| <img src="https://paulbennet.github.io/AndroidTVLauncher/gallery/playroom-1.0.0.jpg" width="240" alt=""> | **Playroom** | 3 | Lite: as fast as the default skin (score 90) | A toy box for children: chunky building blocks, a clock made of toy blocks and a friendly mascot that looks at what you pick. Other apps stay behind a grown-up switch. Level 2 for children: big blocks, a mascot that looks at the focused block. |

Tiers and scores come from `lx bench --tv` on a Sony Bravia VU31 (Mali-G31, 2 GB), relative to the default skin.
A **Heavy** skin failed only a smoothness gate (janky frames per key, p95 frame or key latency); the TV uses it only
with **Launcher settings → Allow heavy skins** on. The hard gates (idle frames, memory, cold start) pass for every
skin here. Live skins move for 20 s after a key and then rest (plan revision R28).

## Rebuild the gallery
```bash
npm run build:three
for s in gallery/skins/*/; do node tools/lx.mjs pack "$s" --tv --out "dist/gallery/$(basename "$s").lxskin"; done
npm run gallery
```
`npm run gallery` takes the packages in `dist/gallery/` (with a preview picture of the same name next to each), writes
`site/gallery/` and regenerates this page and `site/skins/index.html`. Pages publishes `site/` on push.
