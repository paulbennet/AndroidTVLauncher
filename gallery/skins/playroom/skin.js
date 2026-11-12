// @ts-check
// Playroom (level 3): toy blocks for children. Favourites are big building blocks; other apps stay behind the
// grown-up switch (option "All apps"). The mascot looks towards the focused block, smiles when an app opens
// (lx 'launch' event), and falls asleep after 10 minutes without a key. Only transform/opacity change on focus;
// the only timers are the clock (once a minute) and the sleep timer — nothing draws at rest.

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const favRow = $('.row.favs'), appsRow = $('.row.apps'), appsBox = $('.apps-row'), pupils = $('.mascot .pupils');
const COLOURS = ['red', 'yellow', 'green', 'purple', 'orange'];
const initials = (/** @type {string} */ l) => l.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

/** A building block with two studs, the app's picture and its name. */
function block(/** @type {any} */ a, /** @type {number} */ i, /** @type {string} */ size) {
  const b = document.createElement('div');
  b.className = `block ${size} ${COLOURS[i % COLOURS.length]}`;
  b.dataset.nav = '';
  b.dataset.item = a.id;
  const pic = document.createElement('div');
  pic.className = 'pic' + (a.banner ? ' banner' : '');
  if (a.image) { const img = document.createElement('img'); img.alt = ''; img.decoding = 'async'; img.src = a.image; pic.append(img); }
  else { pic.classList.add('mono'); pic.textContent = initials(a.label); }
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = a.label;
  b.append(pic, name);
  return b;
}

/** @type {any} */
let data = null;
let showAll = false;
function render() {
  if (!data) return;
  favRow.replaceChildren(...data.favourites.map((/** @type {any} */ a, /** @type {number} */ i) => block(a, i, 'big')));
  const fav = new Set(data.favourites.map((/** @type {any} */ a) => a.id));
  const rest = data.apps.filter((/** @type {any} */ a) => !fav.has(a.id));
  appsRow.replaceChildren(...(showAll ? rest.map((/** @type {any} */ a, /** @type {number} */ i) => block(a, i + 2, 'small')) : []));
  appsBox.hidden = !showAll;
  document.body.classList.toggle('show-all', showAll);
  document.body.classList.toggle('no-favs', !data.favourites.length);
}
lx.on('data', d => { data = d; render(); });
lx.on('options', v => {
  const s = v.allapps === 'show';
  if (s !== showAll) { showAll = s; render(); lx.refresh(); }
});

// ---------- mascot ----------
let sleepTimer = 0, happyTimer = 0;
function wake() {
  document.body.classList.remove('sleepy');
  clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => document.body.classList.add('sleepy'), 10 * 60 * 1000);
}
/** Pupils point at the focused block: a transform within the eye (compositor only). */
function look(/** @type {HTMLElement|null} */ el) {
  if (!el) return;
  const m = $('.mascot').getBoundingClientRect(), r = el.getBoundingClientRect();
  const dx = r.left + r.width / 2 - (m.left + m.width / 2), dy = r.top + r.height / 2 - (m.top + m.height * 0.45);
  const len = Math.hypot(dx, dy) || 1;
  pupils.style.transform = `translate(${(dx / len) * 14}px, ${(dy / len) * 10}px)`;
}
lx.on('focus', el => { wake(); look(el); });
lx.on('launch', () => {
  wake();
  document.body.classList.add('happy');
  clearTimeout(happyTimer);
  happyTimer = setTimeout(() => document.body.classList.remove('happy'), 2500);
});
lx.on('resume', () => { wake(); document.body.classList.remove('happy'); });
wake();

// ---------- greeting and the block clock ----------
function greeting(/** @type {number} */ h) {
  if (h >= 5 && h < 12) return 'Good morning! What shall we watch?';
  if (h >= 12 && h < 17) return 'Hi! What shall we watch?';
  if (h >= 17 && h < 20) return 'Good evening! What shall we watch?';
  return 'Bedtime soon! One more?';
}
function clockBlocks(/** @type {Date} */ now) {
  const parts = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).formatToParts(now);
  const out = [];
  for (const p of parts) {
    if (p.type === 'hour' || p.type === 'minute') out.push({ t: p.value, k: 'digit' });
    else if (p.type === 'dayPeriod') out.push({ t: p.value.toLowerCase().replace(/\./g, ''), k: 'period' });
    else if (p.value.trim() === ':') out.push({ t: ':', k: 'colon' });
  }
  const box = $('.clock');
  box.replaceChildren(...out.map((o, i) => {
    const b = document.createElement('div');
    b.className = `cblock ${o.k} ${COLOURS[i % COLOURS.length]}`;
    b.textContent = o.t;
    return b;
  }));
  box.setAttribute('aria-label', now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
}
function tick() {
  const now = new Date();
  clockBlocks(now);
  $('.greet').textContent = greeting(now.getHours());
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}
tick();
