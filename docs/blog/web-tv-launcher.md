---
title: "Your Android TV home screen is a web page now: an open launcher anyone can reskin"
published: true
description: "People customise their Android TVs with Claude these days. As a frontend dev of more than ten years, I built a home screen made of HTML, CSS and JS, with a speed budget, so everyone can build on it."
tags: androidtv, webdev, opensource, ai
cover_image: https://paulbennet.github.io/AndroidTVLauncher/blog/cover.png
canonical_url: https://paulbennet.github.io/AndroidTVLauncher/blog/
---

![Nine skins for Web TV Launcher](https://paulbennet.github.io/AndroidTVLauncher/blog/skins.gif)

People have started to customise their Android TVs with AI agents. They connect Claude to the TV over ADB, remove
the apps they don't want, change the settings, and put in another launcher. It works, and I did the same with my
Sony Bravia. But every time, the result stops at "a different launcher that someone else designed".

I have built web front ends for more than ten years. When I looked at my TV's home screen, I saw a list of
tiles, a focus ring, a clock and a few rows. That is a web page. So I asked: what if the home screen *is* a web page,
and anyone who can write HTML and CSS (or ask an agent to write it) can make their own?

This post is about **Web TV Launcher**, the open source result. I built it together with Claude Code, and this is
what I learned on the way.

## What it is

- A home screen for **Android TV and Google TV**: a small Kotlin shell (the APK is about 170 KB) with a WebView. The
  whole UI is plain HTML, CSS and JavaScript.
- **Skins** change everything you see. There are four levels: colour tokens, CSS on the stable components, your own
  layout file, or your own sandboxed page with JavaScript (frameworks are allowed).
- A **skin gallery**: the TV installs skins from a link, from your phone over the local network, or from a QR code.
- **An agent skill** for Claude Code, Codex and other agents, so your agent knows how to set up the TV, make a skin,
  measure it and publish it.
- No ads, no analytics, no account. MIT licence.

## The hard part: a TV is not a laptop

My TV is a Sony Bravia VU31: Google TV, Android 14, a Mali-G31 GPU and **2 GB of RAM**. Google's own home screen
already uses most of it. A web page that runs well on a laptop can stutter on this TV, and a home screen that
stutters is worse than no change at all.

So the launcher does not trust skins. It measures them:

- **`lx lint`** checks the package: file and image sizes, CSS rules, and animations that run when nothing happens.
- **`lx bench --tv`** runs the skin on the real TV against the default skin: janky frames per key press, the p95
  frame time, key latency, frames while idle, memory and cold start.
- From that, each skin gets a **score and a tier**: Lite, Standard or Rich. A skin that fails only a smoothness gate
  is **Heavy**: the TV uses it only when its owner turns on "Allow heavy skins". A skin that draws frames while
  idle, uses too much memory or starts slowly gets no tier, and `lx pack` refuses to pack it.
- At run time, a guard goes back to the default skin when a skin hangs, crashes or uses too much memory. Hold Back
  for 5 seconds for safe mode.

Skins also can't hurt you: they have no network, can't call the native bridge, and can open only the apps the core
gave them, and only when you press OK.

## What I learned about drawing on a slow TV

I benched every idea on the TV, not on my desktop. Some results surprised me:

- **Transparency costs a lot.** A translucent tile that moves cost about 15 ms per frame. The same tile, opaque,
  cost about 6 ms.
- **One border radius, not four.** A different radius per corner cost about 14 ms against 7 ms with one radius.
- **A full-screen canvas is expensive even when it is still.** It is a GPU layer, and it forces layers for
  everything above it. Paint the scene once, save it as one opaque picture, and show that.
- **Don't zoom the focused tile.** A scale transform re-rasters a big tile on every key. Lift it a little instead.
- **"Nothing happens" must mean zero frames.** The idle gate counts every frame at rest. Even a slow fade of the
  app row is enough to fail it.
- **Measure many times.** A single run on the TV can be 50% off. The bench interleaves the default skin and the new
  skin (default, skin, default, skin …) and uses medians.

All of these are in [docs/design-rules.md](https://github.com/paulbennet/AndroidTVLauncher/blob/main/docs/design-rules.md)
and [docs/gotchas.md](https://github.com/paulbennet/AndroidTVLauncher/blob/main/docs/gotchas.md), so you don't have
to find them again.

## Nine skins to start from

To test the API, I made nine skins that each try a different idea: a night sky, a sea floor, cut paper, a live
aquarium, a cosy winter room, falling code, a terminal, a Bauhaus poster and a toy box for children. Some use
three.js, some are only CSS. The live ones move for 20 seconds after a key and then rest, so the TV stays quiet.

They show the budget honestly: Bauhaus, Phosphor and Playroom are Lite; Constellation is Standard; the live and 3D
skins are Heavy on my 2 GB TV. The scores are on the
[showcase page](https://paulbennet.github.io/AndroidTVLauncher/skins/).

The sea floor, aquarium and winter-room pictures are AI-generated, and the notices file says so. The app banners in
the pictures are placeholders from the desktop preview.

## How to try it

On the TV:

1. Install **Downloader** from the Play Store, open `paulbennet.github.io/AndroidTVLauncher/apk` in it, and install.
2. Open **Web Launcher** and follow **Set up this TV**.
3. Open **Launcher settings → Install skin → Skin gallery → Use the Web TV Launcher gallery**, and pick a skin.

To make your own skin:

```bash
git clone https://github.com/paulbennet/AndroidTVLauncher && cd AndroidTVLauncher
npm ci && npx playwright-core install chromium
node tools/lx.mjs new my-skin --level 2 --name "My skin"
node tools/lx.mjs dev my-skin --open        # live preview on the desktop
node tools/lx.mjs dev my-skin --tv          # live on the TV over ADB, about 1 s per save
node tools/lx.mjs pack my-skin --tv         # benched on your TV, ready to share
```

Or let your agent do it:

```bash
claude plugin marketplace add paulbennet/AndroidTVLauncher
claude plugin install web-tv-launcher@web-tv-launcher
```

Then ask it something like "make me a skin that looks like an old train departure board".

## Building it with Claude

I wrote the plan, made the decisions and tested on the TV; Claude Code wrote most of the code and the tests, ran the
benches over ADB, and kept the docs current. Two things made that work well. First, numbers: every "this feels slow"
became a bench result, so the agent could try a fix and prove it. Second, written rules: each trap we found went
into `gotchas.md` and the agent skill, so the next session (or your agent) does not fall into it again.

## Limits

- Google TV home shows for about a second before Web Launcher comes back (after a wake, or on Home without a key
  mapper app).
- Each key press costs WebView 25–30 ms on the first frame on a Mali-G31; skins can't remove that.
- Video stays in the native apps (web DRM is Widevine L3 only). It is not on Google Play.

## Build on it

It is MIT licensed, and the skin API is documented. I would love to see what you make: a skin, a gallery of your
own, or a fix for a TV I don't have. Open an issue with a link to your skin.

- Repo: [github.com/paulbennet/AndroidTVLauncher](https://github.com/paulbennet/AndroidTVLauncher)
- Skins: [paulbennet.github.io/AndroidTVLauncher/skins](https://paulbennet.github.io/AndroidTVLauncher/skins/)
- Skin guide: [docs/skin-api.md](https://github.com/paulbennet/AndroidTVLauncher/blob/main/docs/skin-api.md)
