// @ts-check
// Holiday (level 3). A still living-room picture; the glow of the fire, the tree lights and the snow behind the
// window (room.js, a 2D canvas) move for 20 s after each key, then rest, so nothing draws at rest. Apps are one row
// of tiles: favourites first, then the other apps. After 20 s without a key the row steps aside (ambient).
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
  const art = document.createElement('div'); art.className = 'art';
  if (a.image) { const img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.src = a.image; art.append(img); }
  else { const m = document.createElement('div'); m.className = 'mono'; m.textContent = initials(a.label); art.append(m); }
  const n = document.createElement('div'); n.className = 'name'; n.textContent = a.label;
  t.append(art, n);
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

// ---------- the motions of the room, and ambient ----------
/** @type {any} */
let room = null;
const live = createLive((t, dt) => { if (room) room.draw(t, dt); });
const ambient = createAmbient(20);
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
  live.setEnabled(v.motion !== 'off');
  ambient.setEnabled(v.ambient !== false);
  $('.glow').hidden = v.motion === 'off'; // off: the plain picture
  wake();
});
requestAnimationFrame(() => setTimeout(() => {
  import('./room.js').then(m => { room = m.createRoom(/** @type {HTMLCanvasElement} */ ($('.glow'))); live.still(); wake(); })
    .catch(e => console.error('holiday: room failed', e)); // the still room stays
}, 0));

// ---------- clock and greeting ----------
function greeting(/** @type {Date} */ d) {
  const m = d.getMonth(), day = d.getDate(), h = d.getHours();
  if (m === 11 && day >= 24 && day <= 26) return 'Merry Christmas';
  if ((m === 11 && day === 31) || (m === 0 && day === 1)) return 'Happy New Year';
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
}
function tick() {
  const now = new Date();
  $('.time').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('.greet').textContent = `${now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · ${greeting(now)}`;
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}
tick();
