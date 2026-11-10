# Launcher v1: skinnable, light, measured (analysis, 2026-11-09)

## The idea
1. Keep the launcher light.
2. Skins and customisation are pure web stack (HTML/CSS/JS).
3. Every skin must pass a performance budget.
4. Within that budget, skins can be as creative as an author likes.

Points 3 and 4 pull against each other. The plan has to make "creative but cheap" the easy path, and make the expensive path visible before it ships.

## Prior art for skins and budgets
| System | Skin model | Budget or guard | Lesson for us |
|---|---|---|---|
| Shopify Theme Store | Full themes (Liquid, CSS, JS) | Must average at least 60 on Lighthouse performance across 3 pages, run on a standard benchmark shop and checked in CI ([docs](https://shopify.dev/docs/storefronts/themes/best-practices/performance), [Lighthouse CI](https://shopify.dev/docs/storefronts/themes/tools/lighthouse-ci)) | A **gate on fixed reference data**, run automatically, is enforceable. Scoring on the author's own content isn't. |
| Steam CSS Loader / Decky | CSS over Steam's own DOM, plus a `theme.json` | None. Complex themes are reported to slow the UI ([GamingOnLinux](https://www.gamingonlinux.info/steam-deck/best-decky-loader-plugins)) | Theming another app's DOM is creative and popular, but it breaks on every update and nothing measures it. |
| Projectivy Launcher | Native; colours, fonts, icon packs, wallpaper plugins; themes since 4.71 ([APKMirror](https://www.apkmirror.com/apk/spocky/projectivy-launcher-android-tv)) | Native code bounds the cost | Most people want wallpaper, colours, icons and layout, not code. |
| Firefox OS 2.5 | Replaceable homescreen as a web app ([wiki](https://wiki.mozilla.org/Marketplace/Customizable_homescreens)) | Platform permissions | A homescreen that can change system settings is a security problem ([bug 1213777](https://bugzilla.mozilla.org/show_bug.cgi?id=1213777)). Keep privileged actions in the core. |
| davidr44 web launcher | One fixed web UI | Hand-tuned | No skins. Our probe already beats it on frames. |

## Proposed architecture: core + skin
```
┌ Native shell (Kotlin, ~60 KB, exists) ───────────────────────────────┐
│ apps / icons / launch · lifecycle + memory release · safe mode       │
│ skin store (app-private files) · bench harness (FrameMetrics, PSS)    │
└──────────────── bridge (trusted page only) ──────────────────────────┘
┌ Web core (trusted, ours) ────────────────────────────────────────────┐
│ data store: apps, favourites, rows, settings · focus engine (D-pad,  │
│ long press, key-up) · router (home/menu) · runtime perf guard ·      │
│ built-in Settings + "switch skin" UI that no skin can replace        │
└──────────────── skin API (versioned, capability-scoped) ─────────────┘
┌ Skin (author's) ─────────────────────────────────────────────────────┐
│ manifest.json · tokens · layout · CSS · optional JS · assets         │
└──────────────────────────────────────────────────────────────────────┘
```

### Skin levels (one format, each level optional)
| Level | Author writes | Creativity | Risk | Can be checked statically? |
|---|---|---|---|---|
| L0 Tokens | JSON: colours, fonts, radius, wallpaper, tile shape and size | low | none | yes, fully |
| L1 Style | CSS over **stable core components** (`<lx-row>`, `<lx-tile>`, parts and states) | medium | low | mostly |
| L2 Layout | Declarative layout from blocks (hero, rows, grid, clock, inputs, watch-next) plus CSS | high | low | mostly |
| L3 Script | Own DOM and JS, rendering core data, with focus through `data-focus` or the core engine | unlimited | high | no, only by measuring |

L1 and L2 cover most of the creative range (Steam-style transformations) without JS. L3 is the escape hatch.

### Where skin code runs
| Option | Isolation | Cost | Notes |
|---|---|---|---|
| Same document as the core | none: the skin can call the bridge and read everything | lowest | Acceptable only if skins are trusted |
| Sandboxed `<iframe sandbox="allow-scripts">`, opaque origin, `postMessage` API | real: no bridge, no storage, CSP `connect-src 'none'` | maybe +5–10 MB and one more document (to be measured) | WebView keeps it in the same renderer process; focus has to cross the frame boundary |
| L0–L2 run in the core document, L3 in a sandboxed iframe | mixed | low for most skins | **Recommended** if skins can come from other people |

## Performance score
Two checks, both run by tooling we ship:

**1. Static lint** (instant, on the PC and at install). Hard fails and warnings come from `docs/design-rules.md`:
- animated `box-shadow`, `filter`, `backdrop-filter`, layout properties (`width`, `top` …)
- `will-change` used on many elements
- perpetual animations while idle
- total asset bytes, decoded image pixels (w×h×4), font bytes, JS bytes, DOM nodes at a reference size of 50 apps

**2. Bench** (the authoritative check, on the TV; a desktop estimate uses Chrome CPU throttling calibrated against the TV). A scripted D-pad tour on **fixed reference data**:
- focus moves along rows and between rows
- open and close the menu
- return to Home
- 30 s idle

Measured:
| Metric | Source | Example gate (VU31) |
|---|---|---|
| Janky frames (deadline) during the tour | FrameMetrics | < 8.5% (current default skin: 0.8%) |
| p95 frame time | FrameMetrics | < 33 ms |
| Key → next frame latency | keydown → rAF | p95 < 50 ms |
| Frames drawn while idle | FrameMetrics | about 0 (no perpetual animation) |
| PSS, idle and after the tour | `getAppMemory` | < 182 MB total |
| First frame after a WebView rebuild | `STARTUP` | < 1.5 s |

**Score:** hard gates (pass or fail), plus 0–100 relative to the built-in skin **on the same device**. A ratio carries across TVs better than absolute milliseconds and partly cancels out noise; use the mean of 3 runs.

**Runtime guard** (in production, because a pass on the bench can still regress at home, through leaks, 200 apps or a 4K wallpaper):
- watch jank and PSS cheaply
- after N bad windows or 2 renderer crashes, fall back to the default skin and show why

## Gaps in the idea (to settle)
1. **Who writes skins and who installs them.** This decides the security model: trusted (same document) or sandboxed.
2. **What "light" means in numbers**, and on which devices: only the VU31, or any Android TV with relative budgets.
3. **Where the score is enforced:** an author tool, a gate at install, a runtime guard, or all three. A score on the author's PC isn't a score on the TV.
4. **Reference data.** Content-dependent cost (app count, wallpaper size) has to be benched on fixed data, with limits on user content.
5. **API contract and versioning.** Skins break when the core changes. Use `apiVersion` in the manifest and stable components with parts.
6. **Who owns focus and navigation.** If L3 skins write their own navigation, the remote feels different in each skin. A consistent remote suggests the core owns focus.
7. **Escape hatch.** A broken skin breaks Home. Needed: safe mode (a key combination or ADB), auto-fallback, and a Settings entry no skin can replace.
8. **Authoring loop.** Creativity needs fast iteration: live reload from the PC to the TV over the LAN, a desktop simulator with real-looking data, and score feedback while editing.
9. **Distribution.** Local zips, USB, a LAN upload page, a URL, or a gallery. Signing?
10. **Content beyond apps:** Watch Next, HDMI inputs, clock and weather (network), now playing. Each one is a data API plus a permission.
11. **Home ownership after boot**, still unresolved (`launcherx` wins). It blocks a daily-driver product regardless of skins.
12. **State across the memory lifecycle.** The WebView is destroyed after 60 s hidden, so skins must be stateless or persist through the core. Their timers die with it.
13. **Media in skins.** Video wallpapers and Lottie animations are expensive. Allow them only within budget, paused when not visible, never while an app is in front.
14. **Settings persistence and backup.** localStorage is per origin and is lost if the app's data is cleared. Export and import is needed.
