// @ts-check
// Tidepool (level 3). Glass pebbles over a sea floor (img/seafloor.webp). water.js (three.js) draws caustic light
// once the focus rests, tinted by the focused app's banner, as a still picture; nothing draws at rest
// unless the user turns on "Living water". Focus itself only changes transform and opacity.

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const favRow = $('.row.favs'), appsRow = $('.row.apps'), pills = $('.pills');
const heroImg = /** @type {HTMLImageElement} */ ($('.hero-art img')), heroMono = $('.hero-art .mono');
const initials = (/** @type {string} */ l) => l.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
let byId = new Map(), favIds = /** @type {string[]} */ ([]);

/** A pebble: the app's banner (or icon) set in a rounded glass stone. Its roundness varies a little per app. */
function pebble(/** @type {any} */ a) {
  const p = document.createElement('div');
  p.className = 'pebble';
  p.dataset.nav = '';
  p.dataset.item = a.id;
  let h = 0; for (const c of a.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  p.style.setProperty('--r1', `${38 + (h % 13)}%`);
  const art = document.createElement('div');
  art.className = 'art' + (a.banner ? ' banner' : '');
  if (a.image) { const img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.src = a.image; img.crossOrigin = 'anonymous'; art.append(img); }
  else { art.classList.add('mono'); art.textContent = initials(a.label); }
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = a.label;
  p.append(art, name);
  return p;
}

lx.on('data', d => {
  byId = new Map(d.apps.map((/** @type {any} */ a) => [a.id, a]));
  favIds = d.favourites.map((/** @type {any} */ a) => a.id);
  const fav = new Set(favIds);
  favRow.replaceChildren(...d.favourites.map(pebble));
  appsRow.replaceChildren(...d.apps.filter((/** @type {any} */ a) => !fav.has(a.id)).map(pebble));
  const inputs = (d.inputs || []).map((/** @type {any} */ i) => {
    const b = document.createElement('div');
    b.className = 'pill'; b.dataset.nav = ''; b.dataset.item = i.id; b.textContent = i.label;
    if (i.connected) b.dataset.connected = '';
    return b;
  });
  const gear = document.createElement('div');
  gear.className = 'pill gear'; gear.dataset.nav = ''; gear.dataset.action = 'settings';
  gear.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>Settings';
  pills.replaceChildren(...inputs, gear);
});

// ---------- hero: the focused app ----------
function hero(/** @type {HTMLElement|null} */ el) {
  const a = el && el.dataset.item && byId.get(el.dataset.item);
  const hasApp = !!a;
  $('.hero').classList.toggle('empty', !hasApp);
  if (!a) {
    $('.hero .title').textContent = el && el.dataset.action === 'settings' ? 'Launcher settings' : (el ? el.textContent || '' : '');
    $('.hero .kicker').textContent = el && el.dataset.item ? 'INPUT' : '';
    heroImg.hidden = true; heroMono.hidden = true;
    return;
  }
  const i = favIds.indexOf(a.id);
  $('.hero .kicker').textContent = i >= 0 && el.closest('.favs') ? `FAVOURITE · ${i + 1} OF ${favIds.length}` : 'APP';
  $('.hero .title').textContent = a.label;
  if (a.image) { heroImg.src = a.image; heroImg.hidden = false; heroMono.hidden = true; $('.hero-art').classList.toggle('icon', !a.banner); }
  else { heroImg.hidden = true; heroMono.hidden = false; heroMono.textContent = initials(a.label); }
}

// ---------- caustic light (three.js), after the first frame ----------
const probe = document.createElement('canvas'); probe.width = probe.height = 8;
const pctx = /** @type {CanvasRenderingContext2D} */ (probe.getContext('2d', { willReadFrequently: true }));
/** The banner's average colour, made brighter (8×8 sample); null if the image can't be read. */
function tintOf(/** @type {HTMLElement|null} */ el) {
  const img = /** @type {HTMLImageElement|null} */ (el && el.querySelector('img'));
  if (!img || !img.complete || !img.naturalWidth) return null;
  try {
    pctx.clearRect(0, 0, 8, 8); pctx.drawImage(img, 0, 0, 8, 8);
    const d = pctx.getImageData(0, 0, 8, 8).data; let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4, m = Math.max(r, g, b) / n || 1, k = 255 / m;
    return [Math.min(1, (r / n) * k / 255), Math.min(1, (g / n) * k / 255), Math.min(1, (b / n) * k / 255)];
  } catch { return null; }
}

let opts = { caustics: 'lively', tint: true, living: false, water: 'deep' };
/** @type {any} */
let water = null;
let lastEl = /** @type {HTMLElement|null} */ (null);
const DEFAULT_TINT = [1.0, 0.45, 0.38]; // coral, like the release art
let kickTimer = 0;
/** New caustics for the focused app once the focus rests (600 ms), so a picture never lands during a focus move. */
function kick() {
  if (!water || opts.caustics === 'off') return;
  clearTimeout(kickTimer);
  kickTimer = window.setTimeout(() => {
    if (water && opts.caustics !== 'off') water.burst((opts.tint && tintOf(lastEl)) || DEFAULT_TINT);
  }, 600);
}
lx.on('focus', el => {
  lastEl = el; hero(el); kick();
  const img = el && /** @type {HTMLImageElement|null} */ (el.querySelector('img'));
  if (img && !img.complete) img.addEventListener('load', () => { if (lastEl === el) kick(); }, { once: true }); // banner not decoded yet
});
lx.on('options', v => {
  opts = { caustics: v.caustics || 'lively', tint: v.tint !== false, living: v.living === true, water: v.water || 'deep' };
  if (water) { water.configure(opts); kick(); } else startWater();
});
lx.on('visibility', hidden => { if (water) water.pause(hidden); });
let waterStarted = false;
/** three.js and the first picture, after the first frame; only once caustics are on. */
function startWater() {
  if (waterStarted || opts.caustics === 'off') return;
  waterStarted = true;
  import('./water.js').then(m => { water = m.createWater($('.caustics'), $('.floor'), opts); kick(); })
    .catch(e => console.error('tidepool: caustics failed', e)); // the still sea floor stays
}
requestAnimationFrame(() => setTimeout(startWater, 0));

// ---------- clock ----------
function tick() {
  const now = new Date();
  const t = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('.time').textContent = t;
  $('.time').classList.toggle('long', t.length > 5); // 12 h ("04:15 AM") needs a smaller size in the bubble
  $('.date').textContent = now.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}
tick();
