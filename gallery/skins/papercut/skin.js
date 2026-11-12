// @ts-check
// Paper Cut (level 3). A cut-paper diorama: hills.js (three.js) paints three depth layers once per time of day;
// focus moves them by different amounts with CSS transforms (parallax). Cards are pinned paper; the focused card
// stands straight and lifts. Nothing draws at rest.

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const favRow = $('.row.favs'), appsRow = $('.row.apps'), labels = $('.labels');
const layers = [$('.layer.far'), $('.layer.mid'), $('.layer.near')], scene = $('.scene');
const initials = (/** @type {string} */ l) => l.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
let byId = new Map(), favIds = /** @type {string[]} */ ([]);

/** A pinned paper card with the app's banner (or icon and name). Each card leans a little, the same way each time. */
function card(/** @type {any} */ a, /** @type {boolean} */ moving) {
  const c = document.createElement('div');
  c.className = 'card';
  c.dataset.nav = '';
  c.dataset.item = a.id;
  if (moving) c.dataset.moving = '';
  let h = 0; for (const ch of a.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  c.style.setProperty('--tilt', `${((h % 9) - 4) * 0.5}deg`);
  const art = document.createElement('div');
  art.className = 'art' + (a.banner ? ' banner' : '');
  if (a.image) { const img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.src = a.image; art.append(img); }
  else { art.classList.add('mono'); art.textContent = initials(a.label); }
  if (!a.banner) { const n = document.createElement('div'); n.className = 'name'; n.textContent = a.label; art.append(n); }
  const pin = document.createElement('i');
  pin.className = 'pin';
  const face = document.createElement('div'); // the paper; the shadow is .card::before (a plain shape, see skin.css)
  face.className = 'face';
  face.append(art, pin);
  c.append(face);
  return c;
}

/** A taped paper label (inputs and Settings). */
function label(/** @type {string} */ text, /** @type {Record<string, string>} */ data) {
  const b = document.createElement('div');
  b.className = 'tag'; b.dataset.nav = '';
  Object.assign(b.dataset, data);
  const t = document.createElement('span'); t.textContent = text; // above the terracotta ::before
  b.append(t);
  return b;
}

lx.on('data', d => {
  byId = new Map(d.apps.map((/** @type {any} */ a) => [a.id, a]));
  favIds = d.favourites.map((/** @type {any} */ a) => a.id);
  const fav = new Set(favIds);
  favRow.replaceChildren(...d.favourites.map((/** @type {any} */ a) => card(a, a.id === d.moving)));
  appsRow.replaceChildren(...d.apps.filter((/** @type {any} */ a) => !fav.has(a.id)).map((/** @type {any} */ a) => card(a, false)));
  const inputs = (d.inputs || []).map((/** @type {any} */ i) => {
    const t = label(i.label, { item: i.id });
    if (i.connected) t.dataset.connected = '';
    return t;
  });
  labels.replaceChildren(...inputs, label('Settings', { action: 'settings' }));
});

// ---------- the focused thing's name, and parallax ----------
function title(/** @type {HTMLElement|null} */ el) {
  const a = el && el.dataset.item && byId.get(el.dataset.item);
  $('.title').textContent = a ? a.label : el && el.dataset.action === 'settings' ? 'Launcher settings' : el ? el.textContent || '' : '';
  $('.hint').textContent = a ? 'OK to open · hold OK for more' : 'OK to open'; // inputs and Settings have no app menu
}
function parallax(/** @type {HTMLElement|null} */ el) {
  if (!el || !opts.depth) return;
  const r = el.getBoundingClientRect();
  const nx = (r.left + r.width / 2) / innerWidth - 0.5, ny = (r.top + r.height / 2) / innerHeight - 0.5;
  const rem = innerWidth / 120;
  [0.7, 1.6, 2.8].forEach((k, i) => {
    layers[i].style.transform = `translate(${(-nx * k * rem).toFixed(1)}px, ${(-ny * k * 0.5 * rem).toFixed(1)}px)`;
  });
}
lx.on('focus', el => { title(el); parallax(el); });

// ---------- time of day, options, hills ----------
let opts = { time: 'auto', birds: true, grain: 'strong', depth: false };
let painted = '';
/** @type {any} */
let hills = null;
function timeOfDay() {
  if (opts.time !== 'auto') return opts.time;
  const h = new Date().getHours();
  return h >= 6 && h < 16 ? 'day' : h >= 16 && h < 19 ? 'dusk' : 'night';
}
const timeKey = () => `${timeOfDay()}/${opts.grain}`;
function paint() {
  const tod = timeOfDay();
  document.documentElement.dataset.tod = tod;
  const key = `${tod}/${opts.grain}`;
  if (!hills) return;
  try {
    if (key !== painted) {
      painted = key;
      hills.paintHills(layers.map(l => /** @type {HTMLCanvasElement} */ (l.querySelector('canvas'))), hills.PALETTES[tod], opts.grain === 'soft' ? 0.07 : 0.16);
      document.body.classList.add('hills-ready');
    }
    if (opts.depth) document.body.classList.remove('flat'); else flatten();
  } catch (e) { console.error('papercut: hills failed', e); } // the flat sky gradient stays
}

/**
 * Without depth motion, the whole scene (sky, sun, birds, trees, three hill layers) becomes ONE background image.
 * On the VU31 every canvas is a GPU layer that the compositor draws on every frame; six full-screen layers made each
 * frame of a card animation take ~65 ms. One image painted into the page costs nothing per frame.
 */
let flatUrl = '';
function flatten() {
  const r = Math.min(devicePixelRatio || 1, 1.5);
  const c = document.createElement('canvas');
  c.width = Math.round(innerWidth * r); c.height = Math.round(innerHeight * r);
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const root = getComputedStyle(document.documentElement);
  const sky = x.createLinearGradient(0, 0, 0, c.height * 0.7);
  sky.addColorStop(0, root.getPropertyValue('--sky0').trim()); sky.addColorStop(1, root.getPropertyValue('--sky1').trim());
  x.fillStyle = sky; x.fillRect(0, 0, c.width, c.height);
  for (const layer of layers) for (const el of layer.children) {
    if (el instanceof HTMLCanvasElement) {
      const b = el.getBoundingClientRect();
      x.setTransform(1, 0, 0, 1, 0, 0);
      if (el.width) x.drawImage(el, b.left * r, b.top * r, b.width * r, b.height * r);
      continue;
    }
    for (const shape of el.querySelectorAll('circle, path')) {
      const st = getComputedStyle(shape);
      if (st.display === 'none' || /** @type {any} */ (shape).getClientRects().length === 0) continue;
      const m = /** @type {SVGGraphicsElement} */ (shape).getScreenCTM();
      if (!m) continue;
      x.setTransform(m.a * r, m.b * r, m.c * r, m.d * r, m.e * r, m.f * r);
      let path;
      if (shape.tagName === 'circle') {
        path = new Path2D();
        const n = (/** @type {string} */ a) => Number(shape.getAttribute(a));
        path.arc(n('cx'), n('cy'), n('r'), 0, Math.PI * 2);
      } else path = new Path2D(shape.getAttribute('d') || '');
      if (shape.classList.contains('moon-cut')) { // cut the crescent with the sky itself, so no edge shows
        const p = new Path2D(); p.addPath(path, new DOMMatrix([m.a * r, m.b * r, m.c * r, m.d * r, m.e * r, m.f * r]));
        x.setTransform(1, 0, 0, 1, 0, 0); x.fillStyle = sky; x.fill(p);
        continue;
      }
      if (st.fill !== 'none') { x.fillStyle = st.fill; x.fill(path); }
      const sw = parseFloat(st.strokeWidth);
      if (st.stroke !== 'none' && sw > 0) { x.strokeStyle = st.stroke; x.lineWidth = sw; x.stroke(path); }
    }
  }
  c.toBlob(b => {
    if (!b || opts.depth) return;
    if (flatUrl) URL.revokeObjectURL(flatUrl);
    flatUrl = URL.createObjectURL(b);
    scene.style.backgroundImage = `url("${flatUrl}")`;
    document.body.classList.add('flat');
  }, 'image/png');
}
lx.on('options', v => {
  opts = { time: v.time || 'auto', birds: v.birds !== false, grain: v.grain || 'strong', depth: v.depth === true };
  if (!opts.depth) for (const l of layers) l.style.transform = '';
  paint();
});
requestAnimationFrame(() => setTimeout(() => {
  import('./hills.js').then(m => { hills = m; paint(); }).catch(e => console.error('papercut: hills failed', e));
}, 0));

// ---------- clock and greeting ----------
function tick() {
  const now = new Date(), h = now.getHours();
  $('.time').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 21 ? 'Good evening' : 'Good night';
  $('.greet').textContent = `${now.toLocaleDateString([], { weekday: 'long' })} · ${part}`;
  if (painted !== timeKey()) paint(); // "Follow the clock" moves on at 06:00, 16:00 and 19:00
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}
tick();
