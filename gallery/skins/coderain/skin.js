// @ts-check
// Code Rain (level 3). The rain (rain.js, a 2D canvas) falls for 20 s after each key, then holds still, so nothing
// draws at rest. Apps are "portals" in one line across the middle: favourites first, then the other apps. Nothing in
// the page moves on focus; the focused portal gets brighter and its stream lights up on the canvas.
import { createLive } from './live.js';

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const favRow = $('.list.favs'), appsRow = $('.list.apps'), inputsBox = $('.inputs');
const initials = (/** @type {string} */ l) => l.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

function portal(/** @type {any} */ a, /** @type {boolean} */ moving) {
  const p = document.createElement('div');
  p.className = 'portal' + (a.banner ? '' : ' icon');
  p.dataset.nav = ''; p.dataset.item = a.id;
  if (moving) p.dataset.moving = '';
  const pic = document.createElement('div'); pic.className = 'pic';
  if (a.image) { const img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.src = a.image; pic.append(img); }
  else { const m = document.createElement('div'); m.className = 'mono'; m.textContent = initials(a.label); pic.append(m); }
  const n = document.createElement('div'); n.className = 'name'; n.textContent = a.label;
  p.append(pic, n);
  return p;
}

lx.on('data', d => {
  const fav = new Set(d.favourites.map((/** @type {any} */ a) => a.id));
  favRow.replaceChildren(...d.favourites.map((/** @type {any} */ a) => portal(a, a.id === d.moving)));
  appsRow.replaceChildren(...d.apps.filter((/** @type {any} */ a) => !fav.has(a.id)).map((/** @type {any} */ a) => portal(a, false)));
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

// ---------- the rain ----------
let opts = { colour: 'green', dense: true };
/** @type {any} */
let rain = null;
const live = createLive((t, dt) => { if (rain) rain.draw(t, dt); });

function focusShare(/** @type {HTMLElement|null} */ el) {
  if (!el || !el.classList.contains('portal')) return -1;
  const b = el.getBoundingClientRect();
  return (b.left + b.width / 2) / innerWidth;
}
lx.on('focus', el => { if (rain) rain.setFocus(focusShare(el)); live.kick(); });
lx.on('home', () => live.kick());
// No motion on 'resume' or when shown again: only a key starts it (R28: rest when idle).
lx.on('launch', () => live.kick());
lx.on('visibility', hidden => live.setHidden(hidden));
lx.on('options', v => {
  opts = { colour: ['amber', 'ice'].includes(v.colour) ? v.colour : 'green', dense: v.density !== 'light' };
  live.setEnabled(v.motion !== 'off');
  if (rain) { rain.rebuild(opts); live.still(); }
  live.kick();
});
requestAnimationFrame(() => setTimeout(() => {
  import('./rain.js').then(async m => {
    rain = m.createRain(/** @type {HTMLCanvasElement} */ ($('.rain')), opts);
    await rain.ready();
    rain.setFocus(focusShare(lx.focused));
    live.still(); // the rain is on screen from the start, also with motion off
    live.kick();
  }).catch(e => console.error('coderain: rain failed', e)); // the black page with the portals stays
}, 0));

// ---------- clock ----------
function tick() {
  const now = new Date();
  $('.time').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}
tick();
