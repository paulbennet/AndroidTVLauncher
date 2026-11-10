// Skin loader (skin API v1): manifest -> tokens, options, styles, layout (levels 0-2), or the entry page (level 3).
// Skins never run script in this document. Their CSS goes into @layer skin; their layout is built by the core from
// known blocks. Level 3 skins run in a sandboxed iframe on the skin host (see core.js mountFrame and sdk.js).
import { validateManifest, validateLayout, kebab } from './validate.js';
import { bridge } from './bridge.js';

export const DEFAULT_SKIN = 'default';
const supports = (p, v) => CSS.supports(p, v);

// On the TV, skin files are read through a synchronous bridge call. Boot then never waits on fetch(), so the
// WebView does not paint an empty page before the launcher (that paint cost ~400 ms on the VU31).
// Elsewhere (lx dev, lint, desktop preview) it uses fetch(). Both return a value `await` can take.
const native = bridge && bridge.readSkinText ? bridge : null;

/** Origin (and path) that serves level 3 skin pages. On the TV a separate site (https://skin.local/); on the desktop
 *  server /__skin/ on the other loopback name (localhost <-> 127.0.0.1), so the frame is cross-site there too. */
export const otherLoopback = host => (/^localhost(:|$)/.test(host) ? host.replace('localhost', '127.0.0.1') : host.replace(/^127\.0\.0\.1/, 'localhost'));
export const SKIN_HOST = window.AndroidLauncher && !window.__isMock ? 'https://skin.local/'
  : `${location.protocol}//${otherLoopback(location.host)}/__skin/`;
const SKIN_FILE = /^\/skins\/([a-z0-9-]+)\/(.+\.(?:json|css))$/;

function readSync(url) {
  const m = native && SKIN_FILE.exec(url);
  if (!m) return null;
  const text = native.readSkinText(m[1], m[2]);
  if (text == null) throw new Error(`${url}: not found`);
  return text;
}

function getText(url) {
  const text = readSync(url);
  if (text != null) return text;
  return fetch(url, { cache: 'no-store' }).then(res => {
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.text();
  });
}

function getJson(url) {
  const text = readSync(url);
  if (text != null) return JSON.parse(text);
  return getText(url).then(t => JSON.parse(t));
}

/** Parse skin CSS, then re-serialise it inside @layer skin. Re-serialising means unbalanced braces in the
 *  source cannot escape the layer; baseURL makes url() resolve inside the skin package (plan revision R2). */
// Engines before Chromium 99 drop every @layer block (old TVs without WebView updates, M4). There the shell
// serves core.css unlayered too, and the skin sheet, adopted after it, still wins selectors of equal weight.
export const LAYERS = typeof CSSLayerBlockRule !== 'undefined';

function layeredSheet(cssText, baseURL) {
  const probe = new CSSStyleSheet({ baseURL });
  probe.replaceSync(cssText); // @import is ignored by replaceSync
  const rules = Array.from(probe.cssRules, r => r.cssText).join('\n');
  const sheet = new CSSStyleSheet({ baseURL });
  sheet.replaceSync(LAYERS ? `@layer skin {\n${rules}\n}` : rules);
  return { sheet, rules: probe.cssRules.length };
}

/** Fetch and validate everything a skin needs. Throws with readable messages on invalid skins. */
export async function loadSkin(id) {
  const base = `/skins/${encodeURIComponent(id)}/`;
  const m = validateManifest(await getJson(base + 'manifest.json'), supports);
  if (!m.ok) throw new Error(`${id}: ${m.errors.join('; ')}`);
  const manifest = m.value;
  if (manifest.id !== id) throw new Error(`${id}: manifest id is "${manifest.id}"`);

  if (manifest.level === 3) {
    const warnings = m.warnings;
    if (warnings.length) console.warn(`skin ${id}: ${warnings.join('; ')}`);
    return { manifest, layout: null, sheets: [], base, warnings, frameUrl: SKIN_HOST + encodeURIComponent(id) + '/' + manifest.entry };
  }

  // Skins without a layout (levels 0 and 1) use the default skin's layout.
  const layoutUrl = manifest.layout ? base + manifest.layout : `/skins/${DEFAULT_SKIN}/layout.json`;
  const l = validateLayout(await getJson(layoutUrl));
  if (!l.ok) throw new Error(`${id} layout: ${l.errors.join('; ')}`);

  const baseURL = new URL(base, location.href).href;
  const sheets = [];
  for (const path of manifest.styles) sheets.push(layeredSheet(await getText(base + path), baseURL).sheet);

  const warnings = [...m.warnings, ...l.warnings];
  if (warnings.length) console.warn(`skin ${id}: ${warnings.join('; ')}`);
  return { manifest, layout: l.value, sheets, base, warnings };
}

/** Apply tokens, option values and styles. Returns the CSS custom properties set (for tests and lint). */
export function applySkin(skin, optionValues) {
  const root = document.documentElement;
  const { manifest } = skin;
  root.dataset.skin = manifest.id;
  for (const [k, v] of Object.entries(manifest.tokens)) {
    const value = k === 'wallpaper' ? `url("${new URL(skin.base + v, location.href).href}")` : String(v);
    root.style.setProperty('--lx-' + kebab(k), value);
  }
  applyOptions(manifest.options, optionValues);
  document.adoptedStyleSheets = [...skin.sheets];
}

/** Options reach CSS as html[data-opt-<id>] attributes and --lx-opt-<id> properties. */
export function applyOptions(options, values = {}) {
  const root = document.documentElement;
  for (const o of options) {
    const v = o.id in values ? values[o.id] : o.default;
    const attr = 'data-opt-' + kebab(o.id);
    if (o.type === 'toggle') root.setAttribute(attr, v ? 'on' : 'off');
    else root.setAttribute(attr, String(v));
    if (o.type === 'color' || o.type === 'range') root.style.setProperty('--lx-opt-' + kebab(o.id), String(v));
  }
}

export async function listSkins() {
  try { return await getJson('/skins/index.json'); } catch (e) { return []; }
}

// ---------------------------------------------------------------- layout -> DOM

/**
 * Builds the layout tree. Data blocks (row, grid, hero, clock, memory, caption, settings) are returned in
 * `blocks` so the core can fill them. All text from the layout goes through textContent.
 */
export function buildLayout(layout) {
  const blocks = { lists: [], heroes: [], clocks: [], memories: [], captions: [] };

  function make(n) {
    const el = document.createElement('lx-' + n.type);
    if (n.id) el.id = n.id;
    if (n.class) el.classList.add(...n.class);
    switch (n.type) {
      case 'stack': if (n.dir) el.setAttribute('dir', n.dir); break;
      case 'section': {
        const h = document.createElement('h2');
        h.className = 'lx-title';
        h.textContent = n.title || '';
        const count = document.createElement('span');
        count.className = 'lx-count';
        h.append(' ', count);
        el.appendChild(h);
        break;
      }
      case 'row': case 'grid':
        el.setAttribute('source', n.source || 'apps');
        if (n.type === 'row') el.setAttribute('empty', n.empty ?? 'Hold OK on any app to add it here.');
        if (n.columns) el.style.setProperty('--lx-grid-columns', String(n.columns));
        blocks.lists.push({ el, source: n.source || 'apps', limit: n.limit || 0 });
        break;
      case 'hero': {
        const art = document.createElement('img');
        art.className = 'lx-hero-art'; art.alt = ''; art.decoding = 'async';
        const title = document.createElement('div');
        title.className = 'lx-hero-title';
        el.append(art, title);
        blocks.heroes.push({ el, art, title });
        break;
      }
      case 'clock': {
        if (n.date) el.setAttribute('date', n.date);
        const time = document.createElement('div'); time.className = 'lx-time'; time.textContent = '--:--';
        const date = document.createElement('div'); date.className = 'lx-date';
        el.append(time, date);
        blocks.clocks.push({ time, date });
        break;
      }
      case 'memory': blocks.memories.push(el); break;
      case 'caption': el.setAttribute('aria-live', 'polite'); blocks.captions.push(el); break;
      case 'settings':
        el.setAttribute('data-nav', ''); el.tabIndex = -1; el.setAttribute('role', 'button');
        el.textContent = n.label || 'Settings';
        break;
      case 'text': el.textContent = n.text || ''; break;
    }
    for (const c of n.children || []) el.appendChild(make(c));
    return el;
  }

  const root = document.createElement('lx-root');
  root.appendChild(document.createElement('lx-bg'));
  root.appendChild(make(layout));
  return { root, blocks };
}
