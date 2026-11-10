// Level 3 copy of the default look. lx (the SDK) is set up before this module runs.
const $ = s => document.querySelector(s);
const favRow = $('[data-list="favourites"]'), grid = $('[data-list="apps"]'), caption = $('.caption');
let byId = new Map();

function initials(label) {
  return label.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

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
  } else {
    const wrap = document.createElement('div');
    wrap.className = 'icon-wrap';
    let icon;
    if (a.image) {
      icon = document.createElement('img');
      icon.className = 'icon'; icon.alt = ''; icon.decoding = 'async'; icon.src = a.image;
    } else {
      icon = document.createElement('div');
      icon.className = 'initials'; icon.textContent = initials(a.label);
    }
    const name = document.createElement('div');
    name.className = 'name'; name.textContent = a.label;
    wrap.append(icon, name);
    t.append(wrap);
  }
  return t;
}

lx.on('data', d => {
  byId = new Map([...d.favourites, ...d.apps].map(a => [a.id, a]));
  favRow.replaceChildren(...d.favourites.map(a => tile(a, d.moving)));
  grid.replaceChildren(...d.apps.map(a => tile(a, null)));
  $('.count').textContent = `· ${d.apps.length}` + (d.hiddenCount ? ` (${d.hiddenCount} hidden)` : '');
});

lx.on('focus', el => {
  const a = el && byId.get(el.dataset.item);
  caption.textContent = a && a.banner ? a.label : '';
});

const fmt = { time: { hour: 'numeric', minute: '2-digit' }, date: { weekday: 'long', day: 'numeric', month: 'long' } };
function tick() {
  const now = new Date();
  $('.time').textContent = now.toLocaleTimeString([], fmt.time);
  $('.date').textContent = now.toLocaleDateString([], fmt.date);
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}
tick();
