// @ts-check
// Live Aquarium (level 3). A still tank picture; fish (fish.js, a 2D canvas) swim for 20 s after each key, then
// rest, so nothing draws at rest. Apps are one row of tiles: favourites first, then the other apps. After 20 s
// without a key the row steps aside (ambient); the next focus move brings it back.
import { createLive, createAmbient } from './live.js';

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const favRow = $('.list.favs'), appsRow = $('.list.apps'), inputsBox = $('.inputs');
const initials = (/** @type {string} */ l) => l.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
let byId = new Map();

function tile(/** @type {any} */ a, /** @type {boolean} */ moving) {
  const t = document.createElement('div');
  t.className = 'tile' + (a.banner ? '' : ' icon');
  t.dataset.nav = ''; t.dataset.item = a.id;
  if (moving) t.dataset.moving = '';
  if (a.image) { const img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.src = a.image; t.append(img); }
  else { const m = document.createElement('div'); m.className = 'mono'; m.textContent = initials(a.label); t.append(m); }
  if (!a.banner) { const n = document.createElement('div'); n.className = 'name'; n.textContent = a.label; t.append(n); }
  return t;
}

lx.on('data', d => {
  byId = new Map(d.apps.map((/** @type {any} */ a) => [a.id, a]));
  const fav = new Set(d.favourites.map((/** @type {any} */ a) => a.id));
  favRow.replaceChildren(...d.favourites.map((/** @type {any} */ a) => tile(a, a.id === d.moving)));
  appsRow.replaceChildren(...d.apps.filter((/** @type {any} */ a) => !fav.has(a.id)).map((/** @type {any} */ a) => tile(a, false)));
  const items = (d.inputs || []).map((/** @type {any} */ i) => {
    const b = document.createElement('div');
    b.className = 'item'; b.dataset.nav = ''; b.dataset.item = i.id; b.textContent = i.label;
    if (i.connected) b.dataset.connected = '';
    return b;
  });
  const s = document.createElement('div');
  s.className = 'item'; s.dataset.nav = ''; s.dataset.action = 'settings'; s.textContent = 'Settings';
  inputsBox.replaceChildren(...items, s);
});

// ---------- fish and ambient ----------
let opts = { motion: 'key', fish: 'many', ambient: true };
/** @type {any} */
let fish = null;
const live = createLive((t, dt) => { if (fish) fish.draw(t, dt); });
const ambient = createAmbient(20);
/** A key was pressed or the launcher is back: the fish swim again and the row is shown. */
function wake() { live.kick(); ambient.wake(); }

lx.on('focus', el => {
  const a = el && el.dataset.item && byId.get(el.dataset.item);
  $('.title').textContent = a ? a.label : el && el.dataset.action === 'settings' ? 'Launcher settings' : el ? el.textContent || '' : '';
  wake();
});
lx.on('home', wake);
lx.on('resume', () => ambient.wake(true)); // the row comes back at once; motion only after a key (R28: rest when idle)
lx.on('visibility', hidden => { live.setHidden(hidden); if (!hidden) ambient.wake(true); });
lx.on('options', v => {
  opts = { motion: v.motion === 'off' ? 'off' : 'key', fish: v.fish === 'few' ? 'few' : 'many', ambient: v.ambient !== false };
  live.setEnabled(opts.motion !== 'off');
  ambient.setEnabled(opts.ambient);
  if (fish) { fish.setMany(opts.fish === 'many'); live.still(); }
  wake();
});
requestAnimationFrame(() => setTimeout(() => {
  import('./fish.js').then(async m => {
    fish = m.createFish(/** @type {HTMLCanvasElement} */ ($('.fish')), { many: opts.fish === 'many' });
    await fish.ready();
    live.still(); // the fish are in the tank from the start, also with motion off
    wake();
  }).catch(e => console.error('aquarium: fish failed', e)); // the still tank stays
}, 0));

// ---------- clock ----------
function tick() {
  const now = new Date();
  $('.time').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('.date').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}
tick();
