// Shelf: level 3 showcase. lx (the SDK) is set up before this module runs; see docs/skin-api.md "Level 3".
// All drawing happens when data or options change. A focus move only updates the stage (text, and the image the
// focused tile already shows, so nothing new is decoded). Nothing runs at rest but the clock, once a minute.
const $ = s => document.querySelector(s);
const favRow = $('[data-list="favourites"]'), shelf = $('[data-list="apps"]'), inputRow = $('.row.inputs'), recentRow = $('.row.recent');
const art = $('.art'), artImg = $('.art img'), mono = $('.art .mono');
let byId = new Map();
/** @type {Map<string, LxSkin.Input>} */
let inputById = new Map();
let data = null;
let grouped = true;

const initials = label => label.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
function hue(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

function tile(a, moving) {
  const t = document.createElement('div');
  t.className = 'tile';
  t.dataset.nav = '';
  t.dataset.item = a.id;
  if (a.fav) t.dataset.fav = '';
  if (moving === a.id) t.dataset.moving = '';
  if (a.banner && a.image) {
    const img = document.createElement('img');
    img.className = 'banner'; img.alt = ''; img.decoding = 'async'; img.src = a.image;
    t.append(img);
    return t;
  }
  const wrap = document.createElement('div');
  wrap.className = 'icon-wrap';
  let icon;
  if (a.image) {
    icon = document.createElement('img');
    icon.className = 'icon'; icon.alt = ''; icon.decoding = 'async'; icon.src = a.image;
  } else {
    icon = document.createElement('div');
    icon.className = 'initials'; icon.textContent = initials(a.label);
    icon.style.background = `hsl(${hue(a.id)} 40% 40%)`;
  }
  const name = document.createElement('div');
  name.className = 'name'; name.textContent = a.label;
  wrap.append(icon, name);
  t.append(wrap);
  return t;
}

const ICONS = {
  hdmi: '<path d="M3 8h18v5l-3 3H6l-3-3z"/><path d="M7 11h10"/>',
  av: '<circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/>',
  tuner: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9 2l3 4 3-4"/>',
  other: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
};

/** @param {LxSkin.Input} i */
function inputTile(i) {
  const t = document.createElement('div');
  t.className = 'tile';
  t.dataset.nav = '';
  t.dataset.item = i.id;
  if (i.connected) t.dataset.connected = '';
  const wrap = document.createElement('div');
  wrap.className = 'icon-wrap';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('class', 'input-icon');
  icon.innerHTML = ICONS[i.kind] || ICONS.other;
  const name = document.createElement('div');
  name.className = 'name'; name.textContent = i.label;
  wrap.append(icon, name);
  t.append(wrap);
  return t;
}

/** Apps by first letter (A–Z, then "#" for everything else), each group sorted by name. */
function groups(apps) {
  const out = new Map();
  const sorted = [...apps].sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  for (const a of sorted) {
    const c = a.label.trim().charAt(0).toUpperCase();
    const key = c >= 'A' && c <= 'Z' ? c : '#';
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(a);
  }
  return [...out].sort(([x], [y]) => Number(x === '#') - Number(y === '#') || x.localeCompare(y));
}

function render() {
  if (!data) return;
  const d = data;
  byId = new Map([...d.favourites, ...d.apps].map(a => [a.id, a]));
  inputById = new Map((d.inputs || []).map(i => [i.id, i]));
  favRow.replaceChildren(...d.favourites.map(a => tile(a, d.moving)));
  recentRow.replaceChildren(...(d.recent || []).map(a => tile(a, null)));
  $('.recent-title').hidden = !(d.recent || []).length;
  inputRow.replaceChildren(...(d.inputs || []).map(inputTile));
  $('.inputs-title').hidden = !(d.inputs || []).length;
  shelf.classList.toggle('flat', !grouped);
  if (grouped) {
    shelf.replaceChildren(...groups(d.apps).map(([letter, list]) => {
      const g = document.createElement('div');
      g.className = 'group';
      const l = document.createElement('div');
      l.className = 'letter'; l.textContent = letter;
      const tiles = document.createElement('div');
      tiles.className = 'tiles';
      tiles.append(...list.map(a => tile(a, null)));
      g.append(l, tiles);
      return g;
    }));
  } else {
    shelf.replaceChildren(...d.apps.map(a => tile(a, null)));
  }
  $('.count').textContent = `${d.apps.length} apps` + (d.hiddenCount ? ` · ${d.hiddenCount} hidden` : '');
}

lx.on('data', d => { data = d; render(); });

lx.on('options', v => {
  const g = v.groups !== false;
  if (g !== grouped) { grouped = g; render(); lx.refresh(); }
});

function stage(kicker, title, image, kind, letters) {
  $('.kicker').textContent = kicker;
  $('.title').textContent = title;
  if (image) artImg.src = image; else artImg.removeAttribute('src');
  art.className = 'art' + (kind ? ' ' + kind : '');
  mono.textContent = letters || '';
}

lx.on('focus', el => {
  if (el && el.dataset.action === 'settings') return stage('Launcher', 'Settings', null, 'mono-only', '⚙');
  const input = el && inputById.get(el.dataset.item);
  if (input) return stage(input.connected ? 'Input' : 'Input · nothing connected', input.label, null, 'mono-only', '⏻');
  const a = el && byId.get(el.dataset.item);
  if (!a) return;
  const kicker = a.fav ? 'Favourite' : 'App';
  if (!a.image) stage(kicker, a.label, null, 'mono-only', initials(a.label));
  else stage(kicker, a.label, a.image, a.banner ? '' : 'icon');
});

/** @type {{ time: Intl.DateTimeFormatOptions, date: Intl.DateTimeFormatOptions }} */
const fmt = { time: { hour: 'numeric', minute: '2-digit' }, date: { weekday: 'long', day: 'numeric', month: 'long' } };
const greeting = h => (h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening');
function tick() {
  const now = new Date();
  $('.time').textContent = now.toLocaleTimeString([], fmt.time);
  $('.date').textContent = now.toLocaleDateString([], fmt.date);
  $('.greeting').textContent = greeting(now.getHours());
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}
tick();
