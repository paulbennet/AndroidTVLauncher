#!/usr/bin/env node
// Writes the skin showcase from the gallery index: site/skins/index.html (GitHub Pages) and docs/showcase.md.
// Run after `lx gallery build site/gallery …` (npm run gallery does both). Texts come from gallery.json and EXTRA.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = 'https://paulbennet.github.io/AndroidTVLauncher';
const GALLERY_URL = `${PAGES}/gallery/gallery.json`;
const REPO = 'https://github.com/paulbennet/AndroidTVLauncher';

/** What each skin shows off: one line per skin, for people who make skins. */
const EXTRA = {
  constellation: 'three.js sky painted once, then flattened to one picture; stars as focus targets placed by hand.',
  tidepool: 'three.js caustic light baked into the sea-floor picture when the focus rests; opaque "glass" pebbles.',
  papercut: 'three.js paper hills painted once per time of day; follows the clock (day, dusk, night).',
  phosphor: 'Level 1: only CSS on the default layout. Static glow and scanlines, three colours.',
  bauhaus: 'Level 2: its own layout file plus CSS. Flat shapes, no pictures, the fastest skin here.',
  playroom: 'Level 2 for children: big blocks, a mascot that looks at the focused block.',
  aquarium: 'Live for 20 s after a key: fish cut-outs drawn on a canvas over a still tank, then the scene rests.',
  holiday: 'Live for 20 s after a key: fire glow, tree lights and snow over a still photo of the room.',
  coderain: 'Live for 20 s after a key: three depths of glyph rain from sprite sheets; apps are portals in the rain.',
};
const TIER_TEXT = {
  Lite: 'Lite: as fast as the default skin',
  Standard: 'Standard: passes every gate',
  Rich: 'Rich: passes every gate',
  Heavy: 'Heavy: can stutter on slow TVs (needs “Allow heavy skins”)',
};

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const g = JSON.parse(await readFile(join(root, 'site/gallery/gallery.json'), 'utf8'));
const skins = g.skins;

// ---------------------------------------------------------------- site/skins/index.html
const cards = skins.map(s => `
  <article class="card">
    <img src="../gallery/${esc(s.preview)}" alt="${esc(s.name)} on a TV" loading="lazy" width="1280" height="720">
    <div class="text">
      <h2>${esc(s.name)}</h2>
      <p class="meta">Level ${s.level}${s.tier ? ` · <span class="tier tier-${esc(s.tier.toLowerCase())}">${esc(s.tier)}</span>` : ''}${s.score != null ? ` · score ${s.score}` : ''} · ${Math.max(1, Math.round(s.size / 1024))} KB</p>
      <p>${esc(s.description)}</p>
      ${EXTRA[s.id] ? `<p class="how">${esc(EXTRA[s.id])}</p>` : ''}
    </div>
  </article>`).join('');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Web TV Launcher skins</title>
<meta name="description" content="Skins for Web TV Launcher, a home screen for Android TV and Google TV. Install them from the TV in two presses.">
<style>
  :root { color-scheme: dark; --bg: #0f0e14; --card: #1a1822; --fg: #efeaf7; --muted: #aaa2bd; --accent: #f2a93b; --line: #2c2938; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 17px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
  header, main, footer { max-width: 76rem; margin: 0 auto; padding: 0 16px; }
  header { padding-top: 2.6rem; }
  h1 { font-size: clamp(1.8rem, 4vw, 2.6rem); margin: 0 0 .3rem; letter-spacing: -.01em; }
  .lead { color: var(--muted); margin: 0 0 1.6rem; max-width: 46rem; }
  a { color: var(--accent); }
  code { font-size: .92em; overflow-wrap: anywhere; background: var(--card); padding: .1em .35em; border-radius: .3em; }
  .steps { background: var(--card); border: 1px solid var(--line); border-radius: 12px; padding: 1.1rem 1.3rem; margin-bottom: 2.2rem; }
  .steps h2 { font-size: 1.1rem; margin: 0 0 .5rem; }
  .steps ol { margin: 0; padding-left: 1.3rem; } .steps li { margin: .3rem 0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr)); gap: 1.4rem; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; }
  .card img { width: 100%; height: auto; aspect-ratio: 16 / 9; object-fit: cover; display: block; background: #000; }
  .text { padding: .9rem 1.1rem 1.1rem; }
  .text h2 { font-size: 1.25rem; margin: 0; }
  .meta { color: var(--muted); font-size: .9rem; margin: .15rem 0 .6rem; }
  .text p { margin: .4rem 0 0; }
  .how { color: var(--muted); font-size: .92rem; }
  .tier { font-weight: 600; color: var(--fg); }
  .tier-heavy { color: #ffb38a; }
  .tiers { color: var(--muted); font-size: .92rem; margin: 2rem 0 0; }
  footer { color: var(--muted); font-size: .9rem; padding-top: 2rem; padding-bottom: 3rem; }
</style>
</head>
<body>
<header>
  <h1>Skins for Web TV Launcher</h1>
  <p class="lead">${skins.length} skins that each try a different idea: a night sky, a sea floor, cut paper, a terminal, a poster,
  a toy box, an aquarium, a winter room and falling code. All of them are free, run without network access and were
  measured on a real 2 GB Android TV.</p>
  <section class="steps">
    <h2>Install one on your TV</h2>
    <ol>
      <li>Install Web TV Launcher first: <a href="../">how to set it up</a>.</li>
      <li>On the TV, open <strong>Launcher settings → Install skin → Skin gallery</strong> and pick
          <strong>Use the Web TV Launcher gallery</strong>.</li>
      <li>Choose a skin and press <strong>Install</strong>, then <strong>Use it now</strong>.</li>
    </ol>
    <p>Older launcher versions: open <strong>Install skin</strong>, scan the code with your phone and paste this link in
    “Gallery link”: <code>${GALLERY_URL}</code></p>
  </section>
</header>
<main>
  <div class="grid">${cards}
  </div>
  <p class="tiers">Tiers come from <code>lx bench --tv</code> on a Sony Bravia (Mali-G31, 2 GB). <strong>Lite</strong>,
  <strong>Standard</strong> and <strong>Rich</strong> pass every gate. <strong>Heavy</strong> skins failed only a
  smoothness gate: the TV uses them only when you turn on <strong>Launcher settings → Allow heavy skins</strong>.</p>
</main>
<footer>
  Make your own: <a href="${REPO}/blob/main/docs/skin-api.md">skin guide</a> ·
  source of these skins: <a href="${REPO}/tree/main/gallery/skins">gallery/skins</a> ·
  <a href="${REPO}">Web TV Launcher on GitHub</a>
</footer>
</body>
</html>
`;
await mkdir(join(root, 'site/skins'), { recursive: true });
await writeFile(join(root, 'site/skins/index.html'), html);

// ---------------------------------------------------------------- docs/showcase.md
const md = `# Skin showcase

${skins.length} skins in the project's gallery, each a different idea and technique. Live page with pictures:
[${PAGES}/skins/](${PAGES}/skins/). The sources are in [\`gallery/skins/\`](../gallery/skins/).

## Install from the TV
1. **Launcher settings → Install skin → Skin gallery → Use the Web TV Launcher gallery.**
2. Pick a skin, **Install**, then **Use it now**.

On a launcher older than 1.3.0, set the gallery link on the Install skin page (phone or computer):
\`${GALLERY_URL}\`.

## The skins
| | Skin | Level | Tier | What it shows |
|---|---|---|---|---|
${skins.map(s => `| <img src="${PAGES}/gallery/${s.preview}" width="240" alt=""> | **${s.name}** | ${s.level} | ${s.tier ? TIER_TEXT[s.tier] || s.tier : '—'}${s.score != null ? ` (score ${s.score})` : ''} | ${s.description} ${EXTRA[s.id] || ''} |`).join('\n')}

Tiers and scores come from \`lx bench --tv\` on a Sony Bravia VU31 (Mali-G31, 2 GB), relative to the default skin.
A **Heavy** skin failed only a smoothness gate (janky frames per key, p95 frame or key latency); the TV uses it only
with **Launcher settings → Allow heavy skins** on. The hard gates (idle frames, memory, cold start) pass for every
skin here. Live skins move for 20 s after a key and then rest (plan revision R28).

## Rebuild the gallery
\`\`\`bash
npm run build:three
for s in gallery/skins/*/; do node tools/lx.mjs pack "$s" --tv --out "dist/gallery/$(basename "$s").lxskin"; done
npm run gallery
\`\`\`
\`npm run gallery\` takes the packages in \`dist/gallery/\` (with a preview picture of the same name next to each), writes
\`site/gallery/\` and regenerates this page and \`site/skins/index.html\`. Pages publishes \`site/\` on push.
`;
await writeFile(join(root, 'docs/showcase.md'), md);
console.log(`showcase: ${skins.length} skins → site/skins/index.html, docs/showcase.md`);
