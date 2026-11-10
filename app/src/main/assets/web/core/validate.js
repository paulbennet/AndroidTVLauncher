// Pure validation of skin manifests, layouts, tokens and options (skin API v1).
// No DOM access: runs in the WebView, in Node (`lx lint`) and in unit tests (tools/test).
// Every validator returns { ok, errors: string[], warnings: string[], value } where value is the normalised input.

export const API_VERSION = 1;
export const LIMITS = { layoutNodes: 64, layoutDepth: 8, styles: 4, options: 16, text: 80, choices: 12 };

const SKIN_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NAME_TOKEN = /^[A-Za-z_][A-Za-z0-9_-]{0,39}$/;          // layout id / class names
const PATH = /^(?![/\\])(?!.*\.\.)(?!.*:)[A-Za-z0-9._/-]{1,120}$/; // relative, inside the package
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const FONT = /^[A-Za-z0-9 ,"'-]{1,120}$/;
const SOURCES = ['favourites', 'apps', 'inputs', 'recent'];

/** Layout blocks. attrs: list of allowed values, 'text', or 'int:min:max'. */
export const BLOCKS = {
  stack:    { children: true, attrs: { dir: ['row', 'column'] } },
  scroll:   { children: true },
  section:  { children: true, attrs: { title: 'text' } },
  row:      { attrs: { source: SOURCES, limit: 'int:1:200', empty: 'text' } },
  grid:     { attrs: { source: SOURCES, columns: 'int:1:12', limit: 'int:1:500' } },
  hero:     {},
  clock:    { attrs: { date: ['on', 'off'] } },
  memory:   {},
  settings: { attrs: { label: 'text' } },
  caption:  {},
  text:     { attrs: { text: 'text' } },
  spacer:   {},
};

/** Design tokens -> CSS custom properties (--lx-<kebab-name>). */
export const TOKENS = {
  bg: 'color', bg2: 'color', bg3: 'color', glow: 'color', text: 'color', textDim: 'color',
  card: 'color', accent: 'color', onAccent: 'color', ring: 'color', moving: 'color',
  radius: 'length', gap: 'length', padX: 'length', tileWidth: 'length', ringWidth: 'length',
  focusScale: 'number:1:1.3', gridColumns: 'int:1:12', font: 'font', wallpaper: 'path',
};

export const OPTION_TYPES = ['toggle', 'choice', 'color', 'range'];

export const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

function result() { return { ok: true, errors: [], warnings: [], value: null }; }
function fail(r, msg) { r.ok = false; r.errors.push(msg); }
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => typeof v === 'string' && v.length <= LIMITS.text;

function checkAttr(spec, v) {
  if (Array.isArray(spec)) return spec.includes(v);
  if (spec === 'text') return text(v);
  if (spec.startsWith('int:')) {
    const [, lo, hi] = spec.split(':').map(Number);
    return Number.isInteger(v) && v >= lo && v <= hi;
  }
  return false;
}

// Lenient fallback when CSS.supports is unavailable (Node). The WebView passes the real CSS.supports.
const fallbackSupports = (prop, v) => typeof v === 'string' && v.length <= 60 && !/[;{}<>\\]|url\s*\(/i.test(v);

/** tokens: object of TOKENS keys. supports(prop, value) is CSS.supports in a browser. */
export function validateTokens(tokens, supports = fallbackSupports) {
  const r = result();
  r.value = {};
  if (tokens === undefined) return r;
  if (!isObj(tokens)) { fail(r, 'tokens must be an object'); return r; }
  for (const [k, v] of Object.entries(tokens)) {
    const kind = TOKENS[k];
    if (!kind) { r.warnings.push(`unknown token "${k}" ignored`); continue; }
    let good;
    if (kind === 'color') good = typeof v === 'string' && !/url\s*\(/i.test(v) && supports('color', v);
    else if (kind === 'length') good = typeof v === 'string' && !/url\s*\(/i.test(v) && supports('width', v);
    else if (kind === 'font') good = typeof v === 'string' && FONT.test(v);
    else if (kind === 'path') good = typeof v === 'string' && PATH.test(v);
    else good = checkNumber(kind, v);
    if (good) r.value[k] = v; else fail(r, `token "${k}": invalid ${kind} value ${JSON.stringify(v)}`);
  }
  return r;
}

function checkNumber(kind, v) {
  const [type, lo, hi] = kind.split(':');
  if (type === 'int') return Number.isInteger(v) && v >= +lo && v <= +hi;
  if (type === 'number') return typeof v === 'number' && v >= +lo && v <= +hi;
  return false;
}

/** layout: tree of { type, id?, class?, children?, ...attrs }. */
export function validateLayout(layout) {
  const r = result();
  let nodes = 0;
  const ids = new Set();
  const counts = {};

  function walk(n, depth, where) {
    if (!isObj(n)) { fail(r, `${where}: block must be an object`); return null; }
    if (++nodes > LIMITS.layoutNodes) { if (nodes === LIMITS.layoutNodes + 1) fail(r, `layout has more than ${LIMITS.layoutNodes} blocks`); return null; }
    if (depth > LIMITS.layoutDepth) { fail(r, `${where}: nested deeper than ${LIMITS.layoutDepth}`); return null; }
    const spec = BLOCKS[n.type];
    if (!spec) { fail(r, `${where}: unknown block type ${JSON.stringify(n.type)}`); return null; }
    counts[n.type] = (counts[n.type] || 0) + 1;
    const out = { type: n.type };
    for (const [k, v] of Object.entries(n)) {
      if (k === 'type') continue;
      if (k === 'id') {
        if (typeof v !== 'string' || !NAME_TOKEN.test(v)) fail(r, `${where}: invalid id ${JSON.stringify(v)}`);
        else if (ids.has(v)) fail(r, `${where}: duplicate id "${v}"`);
        else { ids.add(v); out.id = v; }
      } else if (k === 'class') {
        const list = typeof v === 'string' ? v.split(/\s+/).filter(Boolean) : null;
        if (!list || list.length > 8 || !list.every(c => NAME_TOKEN.test(c))) fail(r, `${where}: invalid class ${JSON.stringify(v)}`);
        else out.class = list;
      } else if (k === 'children') {
        if (!spec.children) { fail(r, `${where}: "${n.type}" cannot have children`); continue; }
        if (!Array.isArray(v)) { fail(r, `${where}: children must be an array`); continue; }
        out.children = v.map((c, i) => walk(c, depth + 1, `${where}.${n.type}[${i}]`)).filter(Boolean);
      } else if (spec.attrs && k in spec.attrs) {
        if (checkAttr(spec.attrs[k], v)) out[k] = v;
        else fail(r, `${where}: "${n.type}.${k}" has invalid value ${JSON.stringify(v)}`);
      } else {
        r.warnings.push(`${where}: unknown attribute "${n.type}.${k}" ignored`);
      }
    }
    return out;
  }

  r.value = walk(layout, 1, 'layout');
  if (r.ok && !counts.row && !counts.grid) fail(r, 'layout must contain at least one row or grid of apps');
  if (r.ok && !counts.settings) r.warnings.push('no settings block: Launcher settings stays reachable from the app menu (hold OK)');
  return r;
}

/** options: [{ id, type, label, default, choices?, min?, max?, step? }] */
export function validateOptions(options, supports = fallbackSupports) {
  const r = result();
  r.value = [];
  if (options === undefined) return r;
  if (!Array.isArray(options)) { fail(r, 'options must be an array'); return r; }
  if (options.length > LIMITS.options) fail(r, `more than ${LIMITS.options} options`);
  const seen = new Set();
  options.slice(0, LIMITS.options).forEach((o, i) => {
    const where = `options[${i}]`;
    if (!isObj(o)) return fail(r, `${where}: must be an object`);
    if (typeof o.id !== 'string' || !NAME_TOKEN.test(o.id) || seen.has(o.id)) return fail(r, `${where}: invalid or duplicate id`);
    seen.add(o.id);
    if (!OPTION_TYPES.includes(o.type)) return fail(r, `${where}: type must be one of ${OPTION_TYPES.join(', ')}`);
    if (!text(o.label) || !o.label) return fail(r, `${where}: label required (max ${LIMITS.text} chars)`);
    const out = { id: o.id, type: o.type, label: o.label };
    if (o.type === 'toggle') {
      out.default = o.default === true;
    } else if (o.type === 'choice' || o.type === 'color') {
      const ch = o.choices;
      if (!Array.isArray(ch) || !ch.length || ch.length > LIMITS.choices) return fail(r, `${where}: 1–${LIMITS.choices} choices required`);
      const norm = ch.map(c => (isObj(c) ? c : { value: c, label: String(c) }));
      for (const c of norm) {
        const okValue = o.type === 'color'
          ? typeof c.value === 'string' && !/url\s*\(/i.test(c.value) && supports('color', c.value)
          : typeof c.value === 'string' && NAME_TOKEN.test(c.value);
        if (!okValue || !text(c.label)) return fail(r, `${where}: invalid choice ${JSON.stringify(c)}`);
      }
      out.choices = norm.map(c => ({ value: c.value, label: c.label || c.value }));
      out.default = out.choices.some(c => c.value === o.default) ? o.default : out.choices[0].value;
    } else { // range
      const { min, max, step = 1 } = o;
      if (![min, max, step].every(Number.isFinite) || min >= max || step <= 0 || (max - min) / step > LIMITS.choices)
        return fail(r, `${where}: range needs min < max and at most ${LIMITS.choices} steps`);
      Object.assign(out, { min, max, step, default: Number.isFinite(o.default) ? Math.min(max, Math.max(min, o.default)) : min });
    }
    r.value.push(out);
  });
  return r;
}

/** manifest.json of a skin package. */
export function validateManifest(m, supports = fallbackSupports) {
  const r = result();
  if (!isObj(m)) { fail(r, 'manifest must be a JSON object'); return r; }
  const v = {};
  if (typeof m.id !== 'string' || !SKIN_ID.test(m.id)) fail(r, 'id: lowercase letters, digits and "-", max 40');
  else v.id = m.id;
  if (!text(m.name) || !m.name) fail(r, 'name required (max 80 chars)'); else v.name = m.name;
  if (typeof m.version !== 'string' || !VERSION.test(m.version)) fail(r, 'version must look like 1.0.0'); else v.version = m.version;
  if (m.apiVersion !== API_VERSION) fail(r, `apiVersion must be ${API_VERSION}`); else v.apiVersion = m.apiVersion;
  if (![0, 1, 2, 3].includes(m.level)) fail(r, 'level must be 0, 1, 2 or 3');
  else v.level = m.level;
  v.author = text(m.author) ? m.author : '';
  v.description = typeof m.description === 'string' ? m.description.slice(0, 200) : '';

  const styles = m.styles === undefined ? [] : m.styles;
  if (!Array.isArray(styles) || styles.length > LIMITS.styles || !styles.every(p => typeof p === 'string' && PATH.test(p) && p.endsWith('.css')))
    fail(r, `styles: up to ${LIMITS.styles} relative .css paths`);
  else v.styles = styles;
  if (m.layout !== undefined && !(typeof m.layout === 'string' && PATH.test(m.layout) && m.layout.endsWith('.json')))
    fail(r, 'layout: relative .json path');
  else v.layout = m.layout || null;

  // Level 3: the skin's own page (default skin.html), run in a sandboxed iframe on the skin host.
  if (m.entry !== undefined && !(typeof m.entry === 'string' && PATH.test(m.entry) && m.entry.endsWith('.html')))
    fail(r, 'entry: relative .html path');
  else v.entry = v.level === 3 ? (m.entry || 'skin.html') : null;
  if (v.level !== 3 && m.entry !== undefined) r.warnings.push('entry is only used by level 3 skins');
  if (v.level === 3 && (v.styles?.length || v.layout)) r.warnings.push('level 3 skins ignore styles and layout; link CSS from the entry page');

  if (v.level === 0 && (v.styles?.length || v.layout)) r.warnings.push('level 0 skins should only use tokens');
  if (v.level === 1 && v.layout) r.warnings.push('a layout makes this a level 2 skin');

  for (const [key, fn] of [['tokens', validateTokens], ['options', validateOptions]]) {
    const sub = fn(m[key], supports);
    r.errors.push(...sub.errors); r.warnings.push(...sub.warnings);
    if (!sub.ok) r.ok = false;
    v[key] = sub.value;
  }
  r.value = v;
  return r;
}
