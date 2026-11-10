// Skin lint (skin API v1). Rules come from docs/design-rules.md (costs measured on the VU31).
// The parts, so each caller uses what it can run:
//   lintPackage(manifest, files)  pure: sizes and file types               (Node, WebView at install, lx)
//   lintEntry(html, path)         pure: a level 3 entry page                (Node, WebView at install, lx)
//   lintCss(text, baseURL)        needs CSSOM (CSSStyleSheet)               (WebView at install, lx in Chrome)
//   lintDom(doc)                  needs the skin rendered with reference data (lx only); = judgeDom(domStats(doc))
//   lintStatic(base, manifest, files)  all of the above but lintDom, fetching from `base`   (WebView at install, M2.4)
// Each returns { errors: Finding[], warnings: Finding[], stats } with Finding = { rule, message, where? }.
import { validateManifest, validateLayout } from './validate.js';

export const LINT_VERSION = 1;

/** Starting limits (plan "Performance budget"); calibrated on the TV in M1.6. */
export const BUDGET = {
  packageBytes: 5 * 1024 * 1024,
  jsBytes: 150 * 1024,
  cssBytes: 60 * 1024,
  fontFiles: 2,
  fontBytes: 300 * 1024,
  decodedImageBytes: 32 * 1024 * 1024,
  imagePixels: 1920 * 1080,          // per image: the TV renders at 1920×1080
  domNodes: 1500,                    // with 50 reference apps
  willChangeElements: 8,
  infiniteAnimations: 0,             // running at rest; the idle page must draw no frames
  runningAnimationsAtRest: 2,
};

const IMAGE = /\.(webp|avif|png|jpe?g|svg)$/i;
const FONT = /\.woff2$/i;
const ALLOWED = /\.(json|css|webp|avif|png|jpe?g|svg|woff2|md|txt)$/i;

// Properties whose change costs layout or a repaint every frame when animated or transitioned.
const LAYOUT = ['width', 'height', 'min-width', 'min-height', 'max-width', 'max-height', 'top', 'left', 'right', 'bottom',
  'inset', 'margin', 'padding', 'border', 'border-width', 'border-radius', 'font-size', 'line-height', 'letter-spacing',
  'gap', 'flex', 'flex-basis', 'grid-template-columns', 'grid-template-rows', 'outline', 'outline-width'];
const PAINT_HEAVY = ['box-shadow', 'filter', 'backdrop-filter', 'text-shadow', 'clip-path', 'mask', 'background',
  'background-position', 'background-size'];
const CHEAP = ['transform', 'opacity', 'translate', 'scale', 'rotate', 'visibility'];

const f = (rule, message, where) => (where ? { rule, message, where } : { rule, message });
const empty = () => ({ errors: [], warnings: [], stats: {} });

/**
 * manifest: parsed manifest.json. files: [{ path, size }] (paths relative to the package root).
 */
export function lintPackage(manifest, files) {
  const r = empty();
  const m = validateManifest(manifest);
  for (const e of m.errors) r.errors.push(f('manifest', e));
  for (const w of m.warnings) r.warnings.push(f('manifest', w));

  const s = { files: files.length, bytes: 0, cssBytes: 0, jsBytes: 0, fontFiles: 0, fontBytes: 0, images: 0 };
  for (const { path, size } of files) {
    s.bytes += size;
    if (path.endsWith('.css')) s.cssBytes += size;
    else if (/\.m?js$/i.test(path)) s.jsBytes += size;
    else if (FONT.test(path)) { s.fontFiles++; s.fontBytes += size; }
    else if (IMAGE.test(path)) s.images++;
    const level3 = m.value?.level === 3;
    if (/\.m?js$/i.test(path) && !level3) r.errors.push(f('no-script', 'scripts are only allowed in level 3 skins', path));
    else if (/\.html?$/i.test(path) && !level3) r.warnings.push(f('file-type', 'HTML pages are only used by level 3 skins', path));
    else if (!ALLOWED.test(path) && !/\.(m?js|html?)$/i.test(path) && path !== 'score.json') r.warnings.push(f('file-type', 'not used by the launcher', path));
    if (/\.(ttf|otf|woff)$/i.test(path)) r.errors.push(f('font-format', 'use woff2 fonts', path));
  }
  const over = (rule, value, limit, what) => {
    if (value > limit) r.errors.push(f(rule, `${what} ${kb(value)} is over the ${kb(limit)} budget`));
  };
  over('package-size', s.bytes, BUDGET.packageBytes, 'package');
  over('css-size', s.cssBytes, BUDGET.cssBytes, 'CSS');
  over('js-size', s.jsBytes, BUDGET.jsBytes, 'JS');
  over('font-size', s.fontBytes, BUDGET.fontBytes, 'fonts');
  if (s.fontFiles > BUDGET.fontFiles) r.errors.push(f('font-files', `${s.fontFiles} font files; the budget is ${BUDGET.fontFiles}`));
  for (const p of m.value?.styles || []) if (!files.some(x => x.path === p)) r.errors.push(f('missing-file', 'listed in manifest.styles but missing', p));
  if (m.value?.entry && !files.some(x => x.path === m.value.entry)) r.errors.push(f('missing-file', 'manifest.entry (level 3 page) is missing', m.value.entry));
  if (m.value?.layout && !files.some(x => x.path === m.value.layout)) r.errors.push(f('missing-file', 'listed in manifest.layout but missing', m.value.layout));
  const wp = m.value?.tokens?.wallpaper;
  if (wp && !files.some(x => x.path === wp)) r.errors.push(f('missing-file', 'tokens.wallpaper file is missing', wp));
  r.stats = s;
  return r;
}

/**
 * A level 3 entry page (pure, regex based). The skin page's CSP blocks all of this anyway; lint says why it
 * doesn't work: inline scripts and handlers never run, and nothing loads from outside the package.
 */
export function lintEntry(html, path = 'skin.html') {
  const r = empty();
  const s = { scripts: 0, inlineScripts: 0 };
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    s.scripts++;
    if (!/\bsrc\s*=/i.test(m[1]) && m[2].trim()) { s.inlineScripts++; r.errors.push(f('inline-script', 'inline scripts never run (CSP); move the code to a .js file', path)); }
  }
  if (/<[^>]+\son[a-z]+\s*=/i.test(html)) r.errors.push(f('inline-handler', 'on…= attributes never run (CSP); use addEventListener', path));
  for (const m of html.matchAll(/\b(?:src|href|srcset|poster|data)\s*=\s*["']?\s*((?:https?:)?\/\/[^"'\s>]+)/gi))
    r.errors.push(f('external-url', `${m[1]} is outside the package (skins have no network)`, path));
  if (/<base\b/i.test(html)) r.errors.push(f('base-tag', '<base> is not allowed (CSP base-uri none)', path));
  r.stats = s;
  return r;
}

const kb = n => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');

function props(list) {
  return list.split(',').map(s => s.trim().split(/\s+/)[0].toLowerCase()).filter(Boolean);
}

function costOf(prop) {
  if (prop === 'all') return 'all properties';
  if (CHEAP.includes(prop) || prop.startsWith('--')) return null;
  if (PAINT_HEAVY.some(p => prop === p || prop.startsWith(p + '-'))) return 'paint';
  if (LAYOUT.some(p => prop === p || prop.startsWith(p + '-'))) return 'layout';
  if (prop === 'none') return null;
  return 'repaint';
}

/** Lint one stylesheet's text. baseURL: where the sheet lives (for url() checks). */
export function lintCss(text, baseURL, file = 'skin.css') {
  const r = empty();
  const s = { rules: 0, willChangeRules: 0, keyframes: 0, infiniteAnimations: 0, fontFaces: 0 };
  if (/@import\b/i.test(text)) r.errors.push(f('no-import', '@import is ignored; list every file in manifest.styles', file));

  let sheet;
  try {
    sheet = new CSSStyleSheet({ baseURL });
    sheet.replaceSync(text);
  } catch (e) {
    r.errors.push(f('css-parse', String(e.message || e), file));
    r.stats = s;
    return r;
  }
  const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  const opened = (bare.match(/{/g) || []).length, closed = (bare.match(/}/g) || []).length;
  if (opened !== closed) r.errors.push(f('css-braces', `unbalanced braces ({ ${opened}, } ${closed}); rules after the error are dropped`, file));

  const keyframes = new Map(); // name -> animated properties
  const animated = [];         // [{ names, selector, infinite }]

  function checkUrls(cssText, where) {
    for (const m of cssText.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
      const u = m[2];
      if (/^data:/i.test(u)) continue;
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(u) || u.startsWith('/') || u.split('/').includes('..'))
        r.errors.push(f('external-url', `url(${u}) must be a relative path inside the package`, where));
    }
  }

  function walk(rules) {
    for (const rule of rules) {
      s.rules++;
      if (rule instanceof CSSKeyframesRule) {
        s.keyframes++;
        const set = new Set();
        for (const k of rule.cssRules) for (let i = 0; i < k.style.length; i++) set.add(k.style[i]);
        keyframes.set(rule.name, set);
        continue;
      }
      if (rule instanceof CSSFontFaceRule) { s.fontFaces++; checkUrls(rule.cssText, '@font-face'); continue; }
      if (rule.cssRules && !(rule instanceof CSSStyleRule)) { walk(rule.cssRules); continue; } // @media, @layer, @supports …
      if (!(rule instanceof CSSStyleRule)) continue;
      const st = rule.style, sel = rule.selectorText;
      checkUrls(rule.cssText, sel);
      if (/\blx-overlay\b/.test(sel)) r.warnings.push(f('core-ui', 'the core overlay cannot be styled by skins', sel));

      const bf = st.getPropertyValue('backdrop-filter') || st.getPropertyValue('-webkit-backdrop-filter');
      if (bf && bf !== 'none') r.errors.push(f('backdrop-filter', 'backdrop-filter measured 84 ms per frame on the VU31', sel));
      const filter = st.getPropertyValue('filter');
      if (/blur\(/.test(filter)) r.warnings.push(f('filter-blur', 'blur() is expensive to raster; pre-blur the image instead', sel));
      if (st.getPropertyValue('mix-blend-mode') && st.getPropertyValue('mix-blend-mode') !== 'normal')
        r.warnings.push(f('blend-mode', 'mix-blend-mode forces extra compositing passes', sel));
      if (st.getPropertyValue('background-attachment') === 'fixed') r.warnings.push(f('fixed-background', 'background-attachment: fixed repaints on scroll', sel));
      if (st.getPropertyValue('scroll-behavior') === 'smooth') r.warnings.push(f('smooth-scroll', 'smooth scrolling drops frames on the TV; the core scrolls instantly', sel));

      const wc = st.getPropertyValue('will-change');
      if (wc && wc !== 'auto') {
        s.willChangeRules++;
        if (/lx-tile|lx-row|lx-grid/.test(sel) && !/\[focused\]|:focus/.test(sel))
          r.warnings.push(f('will-change', 'will-change on every tile adds a GPU layer each; let Chrome promote what animates', sel));
      }

      const tp = st.getPropertyValue('transition-property');
      const td = st.getPropertyValue('transition-duration');
      if (tp && td && !/^0s(,\s*0s)*$/.test(td)) {
        for (const p of props(tp)) {
          const cost = costOf(p);
          if (cost === 'all properties') r.errors.push(f('transition-all', 'transition: all animates paint and layout properties; list transform/opacity', sel));
          else if (cost === 'layout' || cost === 'paint') r.errors.push(f('animated-' + cost, `transition of ${p} costs ${cost} every frame; animate transform/opacity`, sel));
          else if (cost) r.warnings.push(f('animated-repaint', `transition of ${p} repaints every frame`, sel));
        }
      }
      const an = st.getPropertyValue('animation-name');
      if (an && an !== 'none') {
        const count = st.getPropertyValue('animation-iteration-count');
        const infinite = /infinite/.test(count);
        if (infinite) s.infiniteAnimations++;
        animated.push({ names: props(an), selector: sel, infinite });
      }
    }
  }
  walk(sheet.cssRules);

  for (const a of animated) {
    for (const n of a.names) {
      const set = keyframes.get(n);
      if (!set) continue;
      for (const p of set) {
        const cost = costOf(p);
        if (cost === 'layout' || cost === 'paint') r.errors.push(f('animated-' + cost, `@keyframes ${n} animates ${p} (${cost} every frame)`, a.selector));
        else if (cost) r.warnings.push(f('animated-repaint', `@keyframes ${n} animates ${p} (repaint every frame)`, a.selector));
      }
    }
    if (a.infinite) r.warnings.push(f('infinite-animation', 'an infinite animation keeps the TV drawing while idle; the bench fails skins that draw at rest', a.selector));
  }
  r.stats = s;
  return r;
}

/**
 * Checks on the rendered page (skin applied, reference data, focus settled). Call after the page has been idle
 * for a moment so entrance animations have finished.
 */
export function lintDom(doc = document) {
  return judgeDom(domStats(doc));
}

/** Raw numbers of a rendered page. Self-contained (no outer names), so `lx` can run it inside a level 3 skin frame. */
export function domStats(doc = document) {
  const all = doc.getElementsByTagName('*');
  const s = { domNodes: all.length, willChangeElements: 0, runningAnimations: 0, infiniteAnimations: 0, tiles: doc.querySelectorAll('lx-tile, [data-item]').length };
  const view = doc.defaultView;
  for (const el of all) {
    const wc = view.getComputedStyle(el).willChange;
    if (wc && wc !== 'auto') s.willChangeElements++;
  }
  for (const a of doc.getAnimations()) {
    if (a.playState !== 'running') continue;
    s.runningAnimations++;
    if (a.effect && a.effect.getComputedTiming().iterations === Infinity) s.infiniteAnimations++;
  }
  return s;
}

/** Findings for domStats() numbers. */
export function judgeDom(s) {
  const r = empty();
  if (s.domNodes > BUDGET.domNodes) r.errors.push(f('dom-size', `${s.domNodes} elements; the budget is ${BUDGET.domNodes} with ${s.tiles} tiles`));
  if (s.willChangeElements > BUDGET.willChangeElements) r.errors.push(f('will-change', `${s.willChangeElements} elements use will-change; the budget is ${BUDGET.willChangeElements}`));
  if (s.infiniteAnimations > BUDGET.infiniteAnimations) r.errors.push(f('idle-animation', `${s.infiniteAnimations} infinite animations run at rest; the idle launcher must draw no frames`));
  else if (s.runningAnimations > BUDGET.runningAnimationsAtRest) r.warnings.push(f('idle-animation', `${s.runningAnimations} animations still running after the page settled`));
  r.stats = s;
  return r;
}

/** Decoded size of the package's images (browser: createImageBitmap). urls: [{ path, url }] */
export async function lintImages(urls) {
  const r = empty();
  const s = { images: 0, decodedBytes: 0 };
  for (const { path, url } of urls) {
    try {
      const blob = await (await fetch(url)).blob();
      let w, h;
      if (/svg/.test(blob.type) || path.endsWith('.svg')) { w = 0; h = 0; } // vector: rasterised at use size
      else { const bmp = await createImageBitmap(blob); w = bmp.width; h = bmp.height; bmp.close(); }
      s.images++;
      s.decodedBytes += w * h * 4;
      if (w * h > BUDGET.imagePixels) r.errors.push(f('image-size', `${w}×${h} is larger than the 1920×1080 screen; pre-scale it`, path));
    } catch (e) {
      r.errors.push(f('image-decode', 'cannot be decoded', path));
    }
  }
  if (s.decodedBytes > BUDGET.decodedImageBytes) r.errors.push(f('image-memory', `images decode to ${kb(s.decodedBytes)}; the budget is ${kb(BUDGET.decodedImageBytes)}`));
  r.stats = s;
  return r;
}

/**
 * The static lint the TV runs at install (plan decision 3, M2.4): everything except the rendered DOM checks.
 * base: URL of the unpacked package (ends with "/"). manifest: parsed manifest.json. files: [{ path, size }].
 */
export async function lintStatic(base, manifest, files) {
  const parts = [['package', lintPackage(manifest, files)]];
  const has = p => files.some(x => x.path === p);
  const text = async p => (await fetch(base + p)).text();
  const level3 = manifest && manifest.level === 3;
  const entry = (manifest && manifest.entry) || 'skin.html';
  if (level3 && has(entry)) parts.push(['entry', lintEntry(await text(entry), entry)]);
  if (manifest && manifest.level === 2 && typeof manifest.layout === 'string' && has(manifest.layout)) {
    const r = empty();
    let layout = null;
    try { layout = JSON.parse(await text(manifest.layout)); } catch (e) { r.errors.push(f('layout', 'not valid JSON', manifest.layout)); }
    if (layout) {
      const v = validateLayout(layout);
      for (const e of v.errors) r.errors.push(f('layout', e, manifest.layout));
      for (const w of v.warnings) r.warnings.push(f('layout', w, manifest.layout));
    }
    parts.push(['layout', r]);
  }
  const styles = level3 ? files.map(x => x.path).filter(p => p.endsWith('.css'))
    : (Array.isArray(manifest && manifest.styles) ? manifest.styles : []).filter(p => typeof p === 'string' && has(p));
  const css = [];
  for (const p of styles) css.push(lintCss(await text(p), base, p));
  parts.push(['css', { errors: css.flatMap(c => c.errors), warnings: css.flatMap(c => c.warnings), stats: {} }]);
  parts.push(['images', await lintImages(files.map(x => x.path).filter(p => IMAGE.test(p)).map(path => ({ path, url: base + path })))]);
  return merge(...parts);
}

/** Merge results from the parts above. */
export function merge(...parts) {
  const out = { errors: [], warnings: [], stats: {} };
  for (const [name, p] of parts) {
    out.errors.push(...p.errors);
    out.warnings.push(...p.warnings);
    out.stats[name] = p.stats;
  }
  out.ok = out.errors.length === 0;
  return out;
}
