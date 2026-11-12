// @ts-check
// Constellation (level 3). Apps are stars: favourites form a constellation across the sky, the other apps are a
// field of fainter stars below it, TV inputs sit on the horizon. lx (the SDK) is set up before this module runs.
//
// Performance (docs/design-rules.md, measured on a Mali-G31 TV): the sky is rendered ONCE by three.js (sky.js,
// loaded after the first frame) into two canvases, then flattened into one background image; a focus move only
// changes transforms and opacity: the focused star scales, the card moves. With "Depth motion" on, the two sky
// layers also slide by different amounts (parallax). Nothing runs at rest except the clock, once a minute.

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const favRow = $('.favs'), recentBox = $('.recent'), appsBox = $('.apps'), inputsBox = $('.inputs'), lines = $('.lines'), card = $('.card');
const cardImg = /** @type {HTMLImageElement} */ ($('.card img')), cardMono = $('.card .mono');
const far = $('.layer.far'), near = $('.layer.near'), hills = $('.hills');
const SVG = 'http://www.w3.org/2000/svg';

/** Design coordinates are 1920×1080; the page is any 16:9 size. */
const W = 1920, H = 1080;
const px = (/** @type {number} */ v) => `${(v / W) * 100}vw`;
const py = (/** @type {number} */ v) => `${(v / W) * 100}vw`; // same unit: the page is 16:9

/** @type {Map<string, {x:number, y:number, el:HTMLElement}>} */
let placed = new Map();
/** @type {string[]} */
let favOrder = [];
let byId = new Map();

function hash(/** @type {string} */ s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967296; }
const initials = (/** @type {string} */ l) => l.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

/** A star element: glow, the 4-point spark, a ring for focus, and the name. */
function star(/** @type {string} */ id, /** @type {string} */ label, /** @type {string} */ kind, x, y) {
  const s = document.createElement('div');
  s.className = `star ${kind}`;
  s.dataset.nav = '';
  s.dataset.item = id;
  s.style.left = px(x);
  s.style.top = py(y);
  s.innerHTML = `<div class="glow"></div><div class="ring"></div><svg class="spark" viewBox="0 0 24 24"><use href="#spark"/></svg>`;
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = label;
  s.append(name);
  s.dataset.x = String(x); s.dataset.y = String(y); // positions live on the element: an app can be in Recent too
  placed.set(id, { x, y, el: s });
  return s;
}

/** Favourites along a gentle W across the upper sky (the shape of the release art). */
function favPositions(/** @type {number} */ n) {
  const wave = [0, 1, 1, 0];
  const x0 = n === 1 ? 1100 : 700, x1 = n === 1 ? 1100 : 1480; // the left column is the card slot
  return Array.from({ length: n }, (_, i) => ({
    x: n === 1 ? 960 : x0 + ((x1 - x0) * i) / (n - 1),
    y: 270 + 140 * wave[i % 4],
  }));
}

/** The other apps: a jittered grid, 7 per row, 110 px apart; the field scrolls when there are more rows. */
function appPositions(/** @type {any[]} */ apps) {
  const cols = 6, x0 = 200, dx = (1560 - x0) / (cols - 1), dy = 112;
  return apps.map((a, i) => {
    const c = i % cols, r = Math.floor(i / cols), j = hash(a.id), k = hash(a.id + '*');
    return { x: x0 + c * dx + (j - 0.5) * 70 + (r % 2 ? dx / 2 : 0) * 0.35, y: 46 + r * dy + (k - 0.5) * 36 };
  });
}

/** Recent apps: a small dipper at the right end of the sky (newest first). */
const RECENT = [[860, 118], [1110, 96], [1360, 118]];

lines.setAttribute('viewBox', `0 0 ${W} ${H}`);
const leader = document.createElementNS(SVG, 'line');
leader.setAttribute('class', 'leader');
function drawLines() {
  lines.innerHTML = '';
  if (favOrder.length < 2) return;
  const pts = favOrder.map(id => placed.get(id)).filter(Boolean);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const l = document.createElementNS(SVG, 'line');
    l.setAttribute('x1', String(a.x)); l.setAttribute('y1', String(a.y));
    l.setAttribute('x2', String(b.x)); l.setAttribute('y2', String(b.y));
    l.dataset.a = favOrder[i - 1]; l.dataset.b = favOrder[i];
    lines.append(l);
  }
}
function drawRecentLines(/** @type {number} */ n) {
  for (let i = 1; i < n; i++) {
    const l = document.createElementNS(SVG, 'line');
    l.setAttribute('x1', String(RECENT[i - 1][0])); l.setAttribute('y1', String(RECENT[i - 1][1]));
    l.setAttribute('x2', String(RECENT[i][0])); l.setAttribute('y2', String(RECENT[i][1]));
    l.setAttribute('class', 'faint');
    lines.append(l);
  }
}

function render(/** @type {any} */ d) {
  placed = new Map();
  byId = new Map(d.apps.map((/** @type {any} */ a) => [a.id, a]));
  const favs = d.favourites.slice(0, 8);
  favOrder = favs.map((/** @type {any} */ a) => a.id);
  const favSet = new Set(favOrder);
  favRow.replaceChildren(...favs.map((/** @type {any} */ a, /** @type {number} */ i) => {
    const p = favPositions(favs.length)[i];
    const s = star(a.id, a.label, 'fav', p.x, p.y);
    if (d.moving === a.id) s.dataset.moving = '';
    return s;
  }));
  const recent = (d.recent || []).slice(0, RECENT.length);
  recentBox.replaceChildren(...recent.map((/** @type {any} */ a, /** @type {number} */ i) => {
    const s = star(a.id, a.label, 'app recent', RECENT[i][0], RECENT[i][1]);
    s.dataset.where = 'recent';
    return s;
  }));
  $('.recent-title').hidden = !recent.length;
  const rest = d.apps.filter((/** @type {any} */ a) => !favSet.has(a.id));
  const pos = appPositions(rest);
  appsBox.replaceChildren(...rest.map((/** @type {any} */ a, /** @type {number} */ i) => star(a.id, a.label, 'app', pos[i].x, pos[i].y)));
  appsBox.style.height = py((pos.length ? Math.max(...pos.map(p => p.y)) : 0) + 70);
  inputsBox.replaceChildren(...(d.inputs || []).map((/** @type {any} */ i) => {
    const b = document.createElement('div');
    b.className = 'input';
    b.dataset.nav = '';
    b.dataset.item = i.id;
    if (i.connected) b.dataset.connected = '';
    b.textContent = i.label;
    return b;
  }));
  $('.horizon').hidden = !(d.inputs || []).length;
  drawLines();
  drawRecentLines(recent.length);
  lines.append(leader);
}

/** The card next to the focused star: the app's own banner (or icon), its name and the hint. */
function showCard(/** @type {HTMLElement|null} */ el) {
  const id = el && el.dataset.item;
  const a = id && byId.get(id);
  if (!a || !el.dataset.x) { card.hidden = true; leader.classList.remove('on'); return; }
  const p = { x: Number(el.dataset.x), y: Number(el.dataset.y) };
  card.hidden = false;
  const fav = favOrder.indexOf(id);
  const inRecent = el.dataset.where === 'recent';
  $('.card .kicker').textContent = inRecent ? 'RECENT' : fav >= 0 && el.classList.contains('fav') ? `FAVOURITE · ${fav + 1} OF ${favOrder.length}` : 'APP';
  $('.card .title').textContent = a.label;
  if (a.image) { cardImg.src = a.image; cardImg.hidden = false; cardMono.hidden = true; card.classList.toggle('icon', !a.banner); }
  else { cardImg.hidden = true; cardMono.hidden = false; cardMono.textContent = initials(a.label); card.classList.add('icon'); }
  const cw = 420, gap = 56, ch = card.offsetHeight * (W / innerWidth) || 350; // real height, design px
  const field = el.closest('.field');
  card.classList.remove('right', 'above', 'below');
  leader.classList.remove('on');
  if (field) {
    // Field stars: the card goes above the star (below it if there is no room), so the row stays readable.
    const top = 576 - field.scrollTop * (W / innerWidth) + p.y;
    const left = Math.min(Math.max(p.x - cw / 2, 40), W - cw - 40);
    const above = top - gap - ch > 150;
    card.style.transform = `translate(${px(left)}, ${py(above ? top - gap - ch : top + gap)})`;
    card.classList.add(above ? 'above' : 'below');
    card.style.setProperty('--notch', px(p.x - left));
    return;
  }
  // Favourites and Recent: the card sits in the left column next to the constellation (like the release art);
  // a thin gold leader line joins it to the star when the star is not the first one.
  const left = 96, y = 205;
  card.style.transform = `translate(${px(left)}, ${py(y)})`;
  const lx0 = left + cw, ly0 = y + ch / 2, gapToStar = p.x - lx0;
  leader.setAttribute('x1', String(lx0 + 14)); leader.setAttribute('y1', String(ly0));
  leader.setAttribute('x2', String(p.x - 46)); leader.setAttribute('y2', String(p.y));
  leader.classList.toggle('on', gapToStar > 160);
}

/** Parallax: the far layer moves a little, the near layer more, against the focus. Compositor-only. */
function parallax(/** @type {HTMLElement|null} */ el) {
  if (!el || !opts.depth) return;
  const r = el.getBoundingClientRect();
  const nx = (r.left + r.width / 2) / innerWidth - 0.5, ny = (r.top + r.height / 2) / innerHeight - 0.5;
  far.style.transform = `translate(${px(-nx * 18)}, ${py(-ny * 10)})`;
  near.style.transform = `translate(${px(-nx * 46)}, ${py(-ny * 24)})`;
  hills.style.transform = `translateX(${px(-nx * 10)})`;
}

function highlightLines(/** @type {string|undefined} */ id) {
  for (const l of lines.children) l.classList.toggle('lit', !!id && (/** @type {any} */ (l).dataset.a === id || /** @type {any} */ (l).dataset.b === id));
}

lx.on('data', d => render(d));
lx.on('focus', el => { showCard(el); parallax(el); highlightLines(el && el.dataset.item); });

// ---------- sky (three.js), after the first frame ----------
let opts = { sky: 'night', milkyway: true, depth: false };
/** @type {null | ((o: any) => void)} */
let paint = null;
const sky = $('.sky');
let flatUrl = '';
/**
 * Without depth motion, the two sky canvases and the hills become ONE background image of .sky. On the VU31 every
 * canvas is a full-screen GPU layer drawn on every frame, and the content above it needs layers too.
 */
function flatten() {
  const r = Math.min(devicePixelRatio || 1, 1.5), box = sky.getBoundingClientRect();
  const c = document.createElement('canvas');
  c.width = Math.round(box.width * r); c.height = Math.round(box.height * r);
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  for (const cv of /** @type {HTMLCanvasElement[]} */ ([far, near])) {
    const b = cv.getBoundingClientRect();
    x.globalAlpha = Number(getComputedStyle(cv).opacity) || 1;
    if (cv.width) x.drawImage(cv, (b.left - box.left) * r, (b.top - box.top) * r, b.width * r, b.height * r);
  }
  for (const path of hills.querySelectorAll('path')) {
    const m = /** @type {SVGGraphicsElement} */ (/** @type {unknown} */ (path)).getScreenCTM();
    if (!m) continue;
    const st = getComputedStyle(path);
    x.setTransform(m.a * r, m.b * r, m.c * r, m.d * r, (m.e - box.left) * r, (m.f - box.top) * r);
    x.globalAlpha = Number(st.opacity) || 1; x.fillStyle = st.fill;
    x.fill(new Path2D(path.getAttribute('d') || ''));
  }
  c.toBlob(b => {
    if (!b || opts.depth) return;
    if (flatUrl) URL.revokeObjectURL(flatUrl);
    flatUrl = URL.createObjectURL(b);
    sky.style.backgroundImage = `url("${flatUrl}")`;
    document.body.classList.add('flat');
  }, 'image/png'); // lossless: the stars are single pixels
}
function paintAll() {
  if (!paint) return;
  paint(opts);
  if (opts.depth) document.body.classList.remove('flat'); else flatten();
}
lx.on('options', v => {
  opts = { sky: v.sky || 'night', milkyway: v.milkyway !== false, depth: v.depth === true };
  if (!opts.depth) for (const l of [far, near, hills]) l.style.transform = '';
  paintAll();
});
requestAnimationFrame(() => setTimeout(() => {
  import('./sky.js').then(m => { paint = o => m.paintSky(far, near, o); paintAll(); document.body.classList.add('sky-ready'); })
    .catch(e => console.error('constellation: sky failed', e)); // the CSS sky stays; the launcher works without it
}, 0));
lx.on('resume', () => { if (paint && !far.dataset.painted) paintAll(); });

// ---------- clock ----------
function tick() {
  const now = new Date();
  $('.time').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('.date').textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
  setTimeout(tick, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}
tick();
