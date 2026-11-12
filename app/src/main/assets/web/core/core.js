// Web core: data, input, menus and Settings. Talks to the Android shell through window.AndroidLauncher
// (on desktop, the dev server injects mock.js). A level 0-2 skin only supplies tokens, CSS and a layout (see
// skins.js); a level 3 skin draws its own page in a sandboxed iframe and gets data over postMessage (sdk.js).
import * as nav from './nav.js';
import { loadSkin, applySkin, applyOptions, listSkins, buildLayout, DEFAULT_SKIN, SKIN_HOST } from './skins.js';
import { bridge } from './bridge.js';
import { qrSvg } from './qr.js';

const LONG_PRESS_MS = 600;
const FRAME_READY_MS = 6000; // a level 3 skin that hasn't said `ready` by then is replaced by the default skin
const PROTOCOL = 1;
const DEFAULT_FAVS = ['com.netflix.ninja', 'com.google.android.youtube.tv',
  'com.amazon.amazonvideo.livingroom', 'in.startv.hotstar'];
const params = new URLSearchParams(location.search);
const safeMode = params.has('safe');
// ?bench: skin bench (`lx bench`). Settings live in memory, so the user's favourites are neither read nor changed.
const benchMode = params.has('bench');
// ?guard=<reason>&culprit=<id>: the shell's runtime guard (RuntimeGuard.kt, M2.2) reloaded us with the default skin.
const GUARD_REASONS = {
  hang: 'it stopped responding',
  crash: 'it crashed the launcher twice',
  jank: 'it was too slow to draw',
  memory: 'it used too much memory',
};
const guardReason = GUARD_REASONS[params.get('guard')] ? params.get('guard') : null;
const guardCulprit = /^[a-z0-9-]{1,40}$/.test(params.get('culprit') || '') ? params.get('culprit') : null;

// ---------------------------------------------------------------- persistence (localStorage; may be unavailable)
const memory = new Map();
const store = benchMode ? {
  get: (key, fallback) => (memory.has(key) ? memory.get(key) : fallback),
  set: (key, value) => { memory.set(key, value); },
  remove: key => { memory.delete(key); },
} : {
  get(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v === null ? fallback : v; } catch (e) { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ } },
  remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
};

let apps = [];
let inputs = []; // TV inputs (M3.1): [{ id, label, kind: hdmi|av|tuner|other, connected }]
let favs = store.get('favs', null);
let hidden = store.get('hidden', []);
// Recently opened apps (M3.2, decision D4: Watch Next can't be read, so the launcher keeps its own history).
// Package names, newest first; only launches from this launcher; stored on the TV only.
const RECENT_MAX = 12;
let recent = store.get('recent', []);
let recentDirty = false;
let showHidden = false;
let moving = null; // pkg being reordered in favourites
let skin = null;   // { manifest, layout, ... } from loadSkin
let blocks = null; // data blocks of the built layout
let frame = null;  // level 3: { el, ready, ids, focused: { itemId, action } } (see "level 3 skin frame")
let ready = false;
const noBlocks = () => ({ lists: [], heroes: [], clocks: [], memories: [], captions: [] });

function loadInputs() {
  try { inputs = (JSON.parse(bridge.getInputs()) || []).filter(i => i && typeof i.id === 'string' && typeof i.label === 'string'); }
  catch (e) { inputs = []; }
}

function loadApps() {
  loadInputs();
  try { apps = JSON.parse(bridge.getApps()); } catch (e) { apps = []; }
  if (favs === null) { // first run: seed with common streaming apps that are installed
    const installed = new Set(apps.map(a => a.pkg));
    favs = DEFAULT_FAVS.filter(p => installed.has(p));
    store.set('favs', favs);
  }
}

const byPkg = pkg => apps.find(a => a.pkg === pkg);
const isFav = pkg => favs.includes(pkg);
const isHidden = pkg => hidden.includes(pkg);

// ---------------------------------------------------------------- core overlay (shadow root, plan revision R1)
const overlay = (() => {
  const host = document.createElement('lx-overlay');
  // Inline !important beats any skin stylesheet, so a skin cannot hide or move the core UI.
  host.setAttribute('style', ['display:block', 'position:fixed', 'inset:0', 'z-index:2147483647', 'pointer-events:none',
    'visibility:visible', 'opacity:1', 'transform:none', 'filter:none', 'clip-path:none', 'contain:strict']
    .map(d => d + ' !important').join(';'));
  // Open mode so nav.activeElement() can look inside; no skin script runs in this document (L3 is sandboxed).
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<link rel="stylesheet" href="/core/overlay.css">
    <div class="root">
      <div class="menu" hidden><div class="card"><div class="title"></div><div class="body" hidden></div><div class="items"></div></div></div>
      <div class="toast" hidden></div>
    </div>`;
  const q = s => shadow.querySelector(s);
  return { host, shadow, menu: q('.menu'), title: q('.title'), body: q('.body'), items: q('.items'), toast: q('.toast') };
})();

// ---------------------------------------------------------------- rendering
function imageUrl(app) {
  if (window.__isMock) return window.__mockImages[app.pkg] || null;
  return '/icon/' + encodeURIComponent(app.pkg);
}

function hue(str) { let h = 0; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }

function initials(app) {
  const el = document.createElement('div');
  el.className = 'lx-initials';
  el.style.background = `hsl(${hue(app.pkg)} 45% 38%)`;
  el.textContent = app.label.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return el;
}

function img(cls, src) {
  const i = document.createElement('img');
  i.className = cls; i.alt = ''; i.decoding = 'async'; i.loading = 'lazy'; i.src = src;
  return i;
}

/** <lx-tile kind="banner|icon" data-pkg [fav] [moving] [focused]> — stable markup, see docs/skin-api.md. */
function tile(app, where) {
  const t = document.createElement('lx-tile');
  t.tabIndex = -1;
  t.setAttribute('data-nav', '');
  t.setAttribute('role', 'button');
  t.setAttribute('aria-label', app.label);
  t.dataset.pkg = app.pkg;
  t.dataset.where = where;
  const url = imageUrl(app);
  if (app.hasBanner && url) {
    t.setAttribute('kind', 'banner');
    t.appendChild(img('lx-banner', url));
  } else {
    t.setAttribute('kind', 'icon');
    const wrap = document.createElement('div');
    wrap.className = 'lx-icon-wrap';
    if (url) {
      const i = img('lx-icon', url);
      i.onerror = () => i.replaceWith(initials(app));
      wrap.appendChild(i);
    } else {
      wrap.appendChild(initials(app));
    }
    const name = document.createElement('div');
    name.className = 'lx-name'; name.textContent = app.label;
    wrap.appendChild(name);
    t.appendChild(wrap);
  }
  if (isFav(app.pkg)) t.setAttribute('fav', '');
  const dot = document.createElement('span'); dot.className = 'lx-fav-dot'; t.appendChild(dot);
  if (moving === app.pkg && where === 'favourites') t.setAttribute('moving', '');
  t._activate = () => (moving ? stopMoving() : launch(app));
  return t;
}

// Simple line icons for input tiles (inline SVG: no image to decode, recoloured by CSS currentColor).
const INPUT_ICONS = {
  hdmi: '<path d="M3 8h18v5l-3 3H6l-3-3z"/><path d="M7 11h10"/>',
  av: '<circle cx="7" cy="12" r="3"/><circle cx="17" cy="12" r="3"/><path d="M7 12h0M17 12h0"/>',
  tuner: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M9 2l3 4 3-4"/>',
  other: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
};

/** <lx-tile kind="input" data-input="<id>" data-input-kind="hdmi|av|tuner|other" [connected]> (M3.1) */
function inputTile(input) {
  const t = document.createElement('lx-tile');
  t.tabIndex = -1;
  t.setAttribute('data-nav', '');
  t.setAttribute('role', 'button');
  t.setAttribute('aria-label', input.label);
  t.setAttribute('kind', 'input');
  t.dataset.input = input.id;
  t.dataset.inputKind = INPUT_ICONS[input.kind] ? input.kind : 'other';
  t.dataset.where = 'inputs';
  if (input.connected) t.setAttribute('connected', '');
  const wrap = document.createElement('div');
  wrap.className = 'lx-icon-wrap';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('class', 'lx-input-icon');
  icon.innerHTML = INPUT_ICONS[t.dataset.inputKind];
  const name = document.createElement('div');
  name.className = 'lx-name'; name.textContent = input.label;
  wrap.append(icon, name);
  t.append(wrap);
  t._activate = () => openInput(input);
  return t;
}

function openInput(input) {
  if (!bridge.openInput || !bridge.openInput(input.id)) toast(`Can't open ${input.label}`);
}

function listFor(source) {
  if (source === 'inputs') return inputs;
  if (source === 'recent') return recent.map(byPkg).filter(a => a && (showHidden || !isHidden(a.pkg)));
  if (source === 'favourites') return favs.map(byPkg).filter(Boolean);
  return apps.filter(a => showHidden || !isHidden(a.pkg));
}

function render() {
  if (frame) return postData();
  const active = nav.activeElement();
  const keep = active && active.dataset && active.dataset.pkg ? { pkg: active.dataset.pkg, where: active.dataset.where } : null;
  const keepInput = active && active.dataset && active.dataset.input;

  for (const b of blocks.lists) {
    let list = listFor(b.source);
    if (b.limit) list = list.slice(0, b.limit);
    b.el.replaceChildren(...list.map(a => (b.source === 'inputs' ? inputTile(a) : tile(a, b.source))));
    const section = b.el.closest('lx-section');
    if (section && (b.source === 'recent' || b.source === 'inputs')) section.toggleAttribute('lx-empty', !list.length);
    const count = section?.querySelector(':scope > .lx-title .lx-count');
    if (count && b.source === 'apps') {
      count.textContent = `· ${list.length}` + (hidden.length && !showHidden ? ` (${hidden.length} hidden)` : '');
    }
  }

  if (keepInput) {
    const el = document.querySelector(`lx-tile[data-input="${CSS.escape(keepInput)}"]`);
    if (el) { nav.focus(el); return; }
  }
  if (keep) {
    const el = document.querySelector(`lx-tile[data-where="${keep.where}"][data-pkg="${CSS.escape(keep.pkg)}"]`)
      || document.querySelector(`lx-tile[data-pkg="${CSS.escape(keep.pkg)}"]`);
    if (el) { nav.focus(el); return; }
  }
  if (!overlay.menu.hidden) return;
  const now = nav.activeElement();
  if (!now || now === document.body) nav.first();
}

function showFocused(el) {
  const input = el && el.dataset && el.dataset.input ? inputs.find(i => i.id === el.dataset.input) : null;
  if (input) {
    for (const c of blocks.captions) c.textContent = '';
    for (const h of blocks.heroes) { h.art.removeAttribute('src'); h.title.textContent = input.label; }
    return;
  }
  const app = el && el.dataset && el.dataset.pkg ? byPkg(el.dataset.pkg) : null;
  for (const c of blocks.captions) c.textContent = app && app.hasBanner ? app.label : '';
  if (!app) return;
  for (const h of blocks.heroes) {
    const url = imageUrl(app);
    if (url) h.art.src = url; else h.art.removeAttribute('src');
    h.title.textContent = app.label;
  }
}

// ---------------------------------------------------------------- actions
function launch(app) {
  if (!bridge.launch(app.pkg)) { toast(`Can't open ${app.label}`); return; }
  recent = [app.pkg, ...recent.filter(p => p !== app.pkg)].slice(0, RECENT_MAX);
  store.set('recent', recent);
  recentDirty = true; // re-rendered when the launcher comes back, not while the app opens
}

function removeRecent(app) {
  recent = recent.filter(p => p !== app.pkg);
  store.set('recent', recent);
  render();
}

function toggleFav(app) {
  favs = isFav(app.pkg) ? favs.filter(p => p !== app.pkg) : [...favs, app.pkg];
  store.set('favs', favs);
  render();
  toast(isFav(app.pkg) ? `Added ${app.label} to Favourites` : `Removed ${app.label} from Favourites`);
}

function toggleHidden(app) {
  hidden = isHidden(app.pkg) ? hidden.filter(p => p !== app.pkg) : [...hidden, app.pkg];
  store.set('hidden', hidden);
  render();
  toast(isHidden(app.pkg) ? `Hid ${app.label}` : `${app.label} is visible again`);
}

function startMoving(app) {
  moving = app.pkg;
  render();
  nav.focus(document.querySelector(`lx-tile[data-where="favourites"][data-pkg="${CSS.escape(app.pkg)}"]`));
  toast('Left / Right to move · OK to finish');
}

function stopMoving() {
  moving = null;
  store.set('favs', favs);
  render();
}

function shiftFav(delta) {
  const i = favs.indexOf(moving), j = i + delta;
  if (i < 0 || j < 0 || j >= favs.length) return;
  [favs[i], favs[j]] = [favs[j], favs[i]];
  render();
}

// ---------------------------------------------------------------- menus (core overlay)
let menuReturn = null;
let menuOnClose = null; // called when this menu closes or another one replaces it

/** items: [{ label, value?, current?, info?, run? }]; opts: { body?: Node shown above the items, onClose?() } */
function openMenu(title, items, opts = {}) {
  if (overlay.menu.hidden) menuReturn = nav.activeElement();
  endMenu();
  menuOnClose = opts.onClose || null;
  overlay.title.textContent = title;
  overlay.body.replaceChildren(...(opts.body ? [opts.body] : []));
  overlay.body.hidden = !opts.body;
  overlay.items.replaceChildren(...items.map(it => {
    const b = document.createElement('button');
    b.className = 'item' + (it.current ? ' current' : '') + (it.info ? ' info' : '');
    b.setAttribute('data-nav', '');
    const label = document.createElement('span'); label.textContent = it.label; b.appendChild(label);
    if (it.value !== undefined) { const v = document.createElement('span'); v.className = 'value'; v.textContent = it.value; b.appendChild(v); }
    b._activate = it.info ? () => {} : () => { if (!it.keepOpen) closeMenu(); it.run && it.run(); };
    return b;
  }));
  overlay.menu.hidden = false;
  nav.setScope(overlay.shadow);
  nav.focus(overlay.items.querySelector('.current') || overlay.items.firstElementChild);
}

function endMenu() {
  const fn = menuOnClose;
  menuOnClose = null;
  if (fn) try { fn(); } catch (e) { /* ignore */ }
}

function closeMenu() {
  endMenu();
  overlay.menu.hidden = true;
  nav.setScope(null);
  if (menuReturn && document.contains(menuReturn)) nav.focus(menuReturn); else nav.first();
}

function appMenu(pkg, where) {
  const app = byPkg(pkg);
  if (!app) return;
  const items = [{ label: 'Open', run: () => launch(app) }];
  if (where === 'recent') items.push({ label: 'Remove from Recent', run: () => removeRecent(app) });
  items.push({ label: isFav(app.pkg) ? 'Remove from Favourites' : 'Add to Favourites', run: () => toggleFav(app) });
  if (isFav(app.pkg)) items.push({ label: 'Move in Favourites', run: () => startMoving(app) });
  items.push({ label: isHidden(app.pkg) ? 'Unhide app' : 'Hide app', run: () => toggleHidden(app) });
  items.push({ label: 'App info', run: () => bridge.openAppInfo(app.pkg) });
  items.push({ label: 'Launcher settings', keepOpen: true, run: () => settingsMenu() }); // always reachable, whatever the skin hides
  openMenu(app.label, items);
}

function deviceInfo() {
  try { return JSON.parse(bridge.getDeviceInfo()); } catch (e) { return {}; }
}

function settingsMenu() {
  const info = deviceInfo();
  const m = skin.manifest;
  const items = [
    { label: 'Skin', value: safeMode ? `${m.name} (safe mode)` : m.name, keepOpen: true, run: skinsMenu },
    { label: 'Install skin', keepOpen: true, run: installMenu },
  ];
  const setup = setupState();
  if (setup && setup.googleTv) items.push({ label: 'Set up this TV', value: setup.homeWatch ? 'Done' : 'Not done', keepOpen: true, run: setupMenu });
  else {
    const boot = bootState();
    if (boot) items.push({ label: 'Open at TV start', value: !boot.enabled ? 'Off' : boot.allowed ? 'On' : 'On · needs permission', keepOpen: true, run: bootMenu });
  }
  if (m.options.length && !safeMode) items.push({ label: 'Skin options', value: `${m.options.length}`, keepOpen: true, run: optionsMenu });
  items.push({ label: 'Allow heavy skins', value: allowHeavy() ? 'On · they can stutter' : 'Off', keepOpen: true, run: () => setAllowHeavy(!allowHeavy()) });
  items.push(
    { label: 'Android settings', run: () => bridge.openSettings() },
    { label: showHidden ? 'Hide hidden apps' : `Show hidden apps (${hidden.length})`, run: () => { showHidden = !showHidden; render(); } },
    { label: 'Run performance probe', run: () => { location.href = '/probe.html'; } },
    { label: 'Reload app list', run: () => { loadApps(); render(); toast(`${apps.length} apps`); } },
    { label: 'Reset favourites and hidden apps', run: () => { favs = null; hidden = []; store.set('hidden', []); store.remove('favs'); loadApps(); render(); } },
    ...(recent.length ? [{ label: `Clear recent apps (${recent.length})`, run: () => { recent = []; store.set('recent', []); render(); } }] : []),
    { label: `About · v${info.version} · ${info.model} · SDK ${info.sdk}${info.webview ? ` · WebView ${info.webview}${info.webview < 99 ? ' (old)' : ''}` : ''}`, info: true },
  );
  openMenu('Launcher settings', items);
}

async function skinsMenu() {
  const list = await listSkins();
  const current = safeMode ? null : skin.manifest.id;
  openMenu('Skin', list.map(s => ({
    label: s.name, value: `L${s.level} · ${s.source}${badgeText(s.badge)}`, current: s.id === current,
    keepOpen: heavyBlocked(s.badge), run: () => useSkin(s.id, s.badge),
  })));
}

// ---------------------------------------------------------------- heavy skins (R27, decision D19 b)
// A package whose score.json says tier "Heavy" failed a smoothness gate in `lx bench --tv`: it can stutter on a slow
// TV. The launcher uses such a skin only when the owner turned "Allow heavy skins" on (off by default, per TV: the
// setting is not part of a settings export).
const HEAVY_TIER = 'Heavy';
const allowHeavy = () => store.get('allowHeavy', false) === true;
const heavyBlocked = badge => !!badge && badge.tier === HEAVY_TIER && !allowHeavy();
const HEAVY_HELP = 'This skin is Heavy: it can stutter on slow TVs. To use it, turn on Launcher settings → Allow heavy skins.';

/** Switches to a skin, unless it is Heavy and heavy skins are not allowed. */
function useSkin(id, badge) {
  if (heavyBlocked(badge)) { toast(HEAVY_HELP, 7000); return; }
  switchSkin(id);
}

async function setAllowHeavy(on) {
  store.set('allowHeavy', on);
  if (!on && !safeMode && skin.manifest.id !== DEFAULT_SKIN) {
    const me = (await listSkins()).find(s => s.id === skin.manifest.id);
    if (me && heavyBlocked(me.badge)) { switchSkin(DEFAULT_SKIN); return; } // the active skin is Heavy
  }
  settingsMenu();
}

/** The first start after a settings import (it can name a Heavy skin): such a skin is not kept. */
async function heavyCheck() {
  if (!store.get('heavyCheck', false)) return;
  store.remove('heavyCheck');
  if (benchMode || safeMode || params.has('skin') || skin.manifest.id === DEFAULT_SKIN || allowHeavy()) return;
  const me = (await listSkins()).find(s => s.id === skin.manifest.id);
  if (!me || !heavyBlocked(me.badge)) return;
  toast(`"${skin.manifest.name}" is a Heavy skin and heavy skins are off. Using the default skin.`, 5000);
  setTimeout(() => switchSkin(DEFAULT_SKIN), 2500);
}

/**
 * The score badge (M2.4): the tier the package's score.json claims (lx pack), marked when it is only a desktop
 * estimate or was measured on another TV model, plus the TV's own install-time lint warnings.
 */
function badgeText(b) {
  if (!b) return '';
  let out = '';
  if (b.tier && b.lintOk !== false) {
    const norm = m => String(m || '').replace(/_/g, ' ').trim().toLowerCase();
    const here = norm(deviceInfo().model);
    out += ` · ${b.tier}${b.estimate ? ' (estimate)' : b.device && here && norm(b.device) !== here ? ' (other TV)' : ''}`;
  } else {
    out += ' · no score';
  }
  if (b.warnings) out += ` · ${b.warnings} warning${b.warnings === 1 ? '' : 's'}`;
  return out;
}

// ---------------------------------------------------------------- skin install (M2.3)
/** "Install skin": while it is on screen the TV serves its LAN upload page (LanInstallServer.kt). */
function installMenu() {
  endMenu(); // a previous Install skin screen closes its LAN page first, then this one opens it again
  let info = {};
  try { info = JSON.parse(bridge.installOpen()) || {}; } catch (e) { /* ignore */ }
  const body = document.createElement('div');
  body.className = 'install';
  if (info.lan) {
    const qr = qrSvg(info.lan.url);
    qr.classList.add('qr');
    const text = document.createElement('div');
    text.className = 'how';
    const line = (t, cls) => { const p = document.createElement('p'); if (cls) p.className = cls; p.textContent = t; text.append(p); return p; };
    line('On a phone or computer on the same network, scan the code or open');
    line(info.lan.url, 'url');
    line('PIN').append(Object.assign(document.createElement('b'), { className: 'pin', textContent: info.lan.pin }));
    body.append(qr, text);
  } else {
    body.textContent = 'This TV has no network address. Connect it to your home network to install from a phone or computer.';
  }
  const items = [
    { label: 'Skin gallery', value: store.get('galleryUrl', '') ? '' : 'not set', keepOpen: true, run: galleryMenu },
    { label: 'Install from the ADB inbox', keepOpen: true,
      run: () => { if (!bridge.installInbox()) toast('The ADB inbox is empty. From a computer: lx install <skin> --tv', 5000); } },
    info.picker ? { label: 'Install from a file (USB)', keepOpen: true, run: () => bridge.installFromPicker() }
      : { label: 'USB: this TV has no file picker', info: true },
    { label: 'Remove a skin', keepOpen: true, run: removeSkinMenu },
  ];
  if (info.lan) items.push({
    label: 'Live reload for lx dev', value: info.dev ? 'On' : 'Off', keepOpen: true,
    run: () => { bridge.installDevMode(!info.dev); installMenu(); },
  });
  installScreen = true;
  openMenu('Install skin', items, { body, onClose: () => { installScreen = false; bridge.installClose(); } });
}
let installScreen = false; // "Install skin" is on screen (its LAN page is open)

/** LanInstallServer closed the page after too many wrong PINs. */
function onInstallLocked() {
  if (installScreen) closeMenu();
  toast('Install page closed: too many wrong PINs. Open Install skin again for a new PIN.', 7000);
}

function onInstallPin(pin) {
  const el = overlay.body.querySelector('.pin');
  if (el) el.textContent = pin;
}

async function onSkinInstalled(r) {
  if (!ready || !r) return;
  if (!r.ok) { toast(`Not installed: ${r.error}`, 6000); return; }
  if (r.dev) { location.replace('/index.html?skin=' + encodeURIComponent(r.id)); return; } // lx dev: preview at once
  const active = !safeMode && skin.manifest.id === r.id;
  const back = installScreen; // came in while Install skin was open: "Not now" goes back there
  const entry = (await listSkins()).find(s => s.id === r.id);
  const items = [
    { label: active ? 'Reload it now' : 'Use it now', keepOpen: heavyBlocked(entry && entry.badge), run: () => useSkin(r.id, entry && entry.badge) },
    back ? { label: 'Install another', keepOpen: true, run: installMenu } : { label: 'Not now' },
  ];
  const badge = badgeText(entry && entry.badge).replace(/^ · /, '');
  if (badge) items.push({ label: `Score: ${badge}`, info: true });
  if (heavyBlocked(entry && entry.badge)) items.push({ label: HEAVY_HELP, info: true });
  for (const w of ((r.lint && r.lint.warnings) || []).slice(0, 3)) items.push({ label: `⚠ ${w.message}${w.where ? ` [${w.where}]` : ''}`, info: true });
  openMenu(`Installed "${r.name}" ${r.version}`, items);
}

// Install-time lint (M2.4, plan decision 3): SkinInstaller.kt unpacks a package to /staged/<stage>/ and asks
// here, every 3 s until it gets an answer. lint.js is loaded only when a skin is installed.
const checkedStages = new Set();
async function checkStaged(stage) {
  if (!ready || !stage || !/^[0-9a-f]{12}$/.test(stage.id) || checkedStages.has(stage.id)) return;
  checkedStages.add(stage.id);
  let r;
  try {
    const { lintStatic } = await import('./lint.js');
    const base = new URL(`/staged/${stage.id}/`, location.href).href;
    let manifest = null;
    try { manifest = JSON.parse(await (await fetch(base + 'manifest.json')).text()); } catch (e) { /* lintPackage reports it */ }
    r = await lintStatic(base, manifest, stage.files || []);
  } catch (e) {
    r = { errors: [{ rule: 'lint', message: 'the lint could not run: ' + e.message }], warnings: [] };
  }
  console.log(`SKIN_LINT ${stage.id} errors=${r.errors.length} warnings=${r.warnings.length}`);
  bridge.stagedChecked(stage.id, JSON.stringify({ ok: !r.errors.length, errors: r.errors.slice(0, 20), warnings: r.warnings.slice(0, 50) }));
}

// ---------------------------------------------------------------- settings export / import (M2.4)
const SETTINGS_FORMAT = 'web-launcher-settings';
const PKG_NAME = /^[A-Za-z0-9._]{1,200}$/;

/** Favourites, hidden apps, the active skin and every skin's option values, as JSON text. */
function exportSettings() {
  const skinOptions = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith('skinOptions.')) skinOptions[k.slice(12)] = store.get(k, {});
    }
  } catch (e) { /* storage unavailable */ }
  return JSON.stringify({
    format: SETTINGS_FORMAT, version: 1, exportedAt: new Date().toISOString(),
    skin: store.get('skin', DEFAULT_SKIN), favs: store.get('favs', null), hidden: store.get('hidden', []), recent: store.get('recent', []), galleryUrl: store.get('galleryUrl', ''), skinOptions,
  });
}

/** Checks and applies exported settings, then reloads. Returns JSON text { ok, error? }. */
function importSettings(text) {
  const no = error => JSON.stringify({ ok: false, error });
  let s;
  try { s = JSON.parse(text); } catch (e) { return no('not JSON'); }
  if (!s || s.format !== SETTINGS_FORMAT || s.version !== 1) return no('not a launcher settings file (version 1)');
  const pkgs = v => Array.isArray(v) && v.length <= 500 && v.every(p => typeof p === 'string' && PKG_NAME.test(p));
  if (s.favs !== null && !pkgs(s.favs)) return no('favs must be a list of package names');
  if (!pkgs(s.hidden)) return no('hidden must be a list of package names');
  if (s.recent !== undefined && !pkgs(s.recent)) return no('recent must be a list of package names');
  if (s.galleryUrl !== undefined && (typeof s.galleryUrl !== 'string' || (s.galleryUrl && !GALLERY_URL.test(s.galleryUrl)))) return no('galleryUrl must be an https:// link');
  if (typeof s.skin !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(s.skin)) return no('skin must be a skin id');
  const opts = s.skinOptions;
  const value = v => typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 80);
  if (!opts || typeof opts !== 'object' || Array.isArray(opts) || Object.keys(opts).length > 100) return no('skinOptions must be an object');
  for (const [id, vals] of Object.entries(opts)) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id) || !vals || typeof vals !== 'object' || Array.isArray(vals)
      || Object.keys(vals).length > 16 || !Object.values(vals).every(value)) return no(`skinOptions.${id.slice(0, 40)} is not valid`);
  }
  if (s.favs === null) store.remove('favs'); else store.set('favs', s.favs);
  store.set('hidden', s.hidden);
  if (s.recent !== undefined) store.set('recent', s.recent.slice(0, RECENT_MAX));
  if (s.galleryUrl) store.set('galleryUrl', s.galleryUrl); else if (s.galleryUrl === '') store.remove('galleryUrl');
  store.set('skin', s.skin); // a skin that isn't on this TV falls back to the default one at load
  store.set('heavyCheck', true); // the next start drops it if it is Heavy and heavy skins are off
  for (const [id, vals] of Object.entries(opts)) store.set('skinOptions.' + id, vals);
  console.log('SETTINGS_IMPORTED ' + JSON.stringify({ favs: s.favs ? s.favs.length : null, hidden: s.hidden.length, skin: s.skin }));
  setTimeout(() => location.replace('/index.html'), 300);
  return JSON.stringify({ ok: true });
}

// ---------------------------------------------------------------- skin gallery (M4, decision D7 b)
// SkinGallery.kt downloads and checks the gallery.json (the WebView has no network, R23); this page only shows it.
// The URL is set from the Install skin page on a phone, over ADB (lx gallery set) or by a settings import.
const GALLERY_URL = /^(https:\/\/|http:\/\/127\.0\.0\.1[:/])\S{1,490}$/; // loopback works on debug builds only
let galleryList = null;      // the last loaded index: { url, name, skins: [...] }
let galleryPending = null;   // the URL being loaded while "Loading…" is on screen
let galleryPreviewFor = null; // "<id>@<version>" of the entry on screen, waiting for its preview

function setGalleryUrl(url) {
  url = String(url == null ? '' : url).trim();
  if (url && !GALLERY_URL.test(url)) return JSON.stringify({ ok: false, error: 'the link must start with https://' });
  if (url) store.set('galleryUrl', url); else store.remove('galleryUrl');
  galleryList = null;
  if (ready) toast(url ? 'Skin gallery set' : 'Skin gallery removed');
  console.log('GALLERY_URL ' + (url || '(none)'));
  return JSON.stringify({ ok: true, url });
}

/** The project's own gallery on GitHub Pages: one press sets it (the user can still set any other link). */
const OFFICIAL_GALLERY = 'https://paulbennet.github.io/AndroidTVLauncher/gallery/gallery.json';

function galleryMenu() {
  const url = store.get('galleryUrl', '');
  if (!url) {
    openMenu('Skin gallery', [
      { label: 'Use the Web TV Launcher gallery', keepOpen: true, run: () => { store.set('galleryUrl', OFFICIAL_GALLERY); galleryList = null; galleryMenu(); } },
      { label: 'Or set another link on the Install skin page (phone or computer)', keepOpen: true, run: installMenu },
    ]);
    return;
  }
  if (galleryList && galleryList.url === url) { showGallery(galleryList); return; }
  openMenu('Skin gallery', [{ label: 'Loading…', info: true }], { onClose: () => { galleryPending = null; } });
  galleryPending = url;
  if (!bridge.galleryLoad(url)) onGallery({ ok: false, error: 'this TV could not start the download' });
}

/** SkinGallery.load() result: { ok, name, skins } or { ok: false, error }. */
function onGallery(r) {
  if (!ready || !r) return;
  const url = galleryPending;
  if (!url) return; // the user left the Loading… screen
  galleryPending = null;
  if (!r.ok) {
    openMenu('Skin gallery', [
      { label: `Could not load the gallery: ${r.error}`, info: true },
      { label: 'Try again', keepOpen: true, run: galleryMenu },
      { label: 'Back', keepOpen: true, run: installMenu },
    ]);
    return;
  }
  galleryList = { url, name: r.name || '', skins: Array.isArray(r.skins) ? r.skins : [] };
  showGallery(galleryList);
}

async function showGallery(g) {
  const have = new Map((await listSkins()).filter(s => s.source === 'installed').map(s => [s.id, s]));
  const items = g.skins.map(s => {
    const mine = have.get(s.id);
    const state = !mine ? '' : mine.version === s.version ? ' · installed' : ` · update ${mine.version} → ${s.version}`;
    return { label: s.name, value: `L${s.level}${s.tier ? ' · ' + s.tier : ''}${state}`, keepOpen: true, run: () => galleryEntry(s, mine) };
  });
  if (!items.length) items.push({ label: 'This gallery has no skins for this launcher', info: true });
  items.push({ label: 'Reload the gallery', keepOpen: true, run: () => { galleryList = null; galleryMenu(); } });
  openMenu(g.name ? `Skin gallery · ${g.name}` : 'Skin gallery', items);
}

function galleryEntry(s, mine) {
  const body = document.createElement('div');
  body.className = 'gallery';
  const pic = document.createElement('img');
  pic.className = 'preview'; pic.alt = ''; pic.hidden = true;
  const text = document.createElement('div');
  const line = t => { if (t) { const p = document.createElement('p'); p.textContent = t; text.append(p); } };
  line(`Version ${s.version} · level ${s.level}${s.author ? ` · by ${s.author}` : ''}`);
  line(s.description);
  if (s.tier === HEAVY_TIER) line(allowHeavy() ? 'Heavy: it can stutter on slow TVs.' : HEAVY_HELP);
  line([s.size ? `${Math.max(1, Math.round(s.size / 1024))} KB` : '', s.tier ? `${s.tier}${s.score != null ? ` (score ${s.score}, the author's claim)` : ''}` : ''].filter(Boolean).join(' · '));
  body.append(pic, text);
  const action = !mine ? 'Install' : mine.version === s.version ? 'Install again' : `Update to ${s.version}`;
  openMenu(s.name, [
    { label: action, run: () => { if (bridge.galleryInstall(s.id)) toast(`Installing ${s.name}…`, 5000); else toast(`Can't install ${s.name}`); } },
    { label: 'Back', keepOpen: true, run: () => showGallery(galleryList) },
  ], { body, onClose: () => { galleryPreviewFor = null; } });
  galleryPreviewFor = s.id + '@' + s.version;
  if (s.preview) bridge.galleryPreview(s.id);
}

function onGalleryPreview(id, ok) {
  if (!ok || !galleryPreviewFor || galleryPreviewFor.split('@')[0] !== id) return;
  const pic = overlay.body.querySelector('.gallery .preview');
  if (!pic) return;
  pic.src = `/gallery/preview/${encodeURIComponent(id)}?v=${encodeURIComponent(galleryPreviewFor.split('@')[1])}`;
  pic.hidden = false;
}

// ---------------------------------------------------------------- open at TV start (M4, decision D6 a)
function bootState() {
  if (typeof bridge.getBootOpen !== 'function') return null;
  try { return JSON.parse(bridge.getBootOpen()); } catch (e) { return null; }
}

function bootMenu() {
  const b = bootState();
  if (!b) return;
  const body = document.createElement('div');
  body.className = 'boot';
  const line = (t, cls) => { const p = document.createElement('p'); if (cls) p.className = cls; p.textContent = t; body.append(p); };
  line('After the TV starts, this launcher opens on top of the Google TV home screen.');
  if (!b.allowed) {
    line('The TV must allow this launcher to open by itself ("Display over other apps"). From a computer with ADB, run once:');
    line('adb shell appops set com.weblauncher.tv SYSTEM_ALERT_WINDOW allow', 'cmd');
  }
  const setup = setupState();
  openMenu('Open at TV start', [
    { label: b.enabled ? 'Turn off' : 'Turn on', keepOpen: true, run: () => { bridge.setBootOpen(!b.enabled); bootMenu(); } },
    { label: 'Back', keepOpen: true, run: setup && setup.googleTv ? setupMenu : settingsMenu },
  ], { body });
}

// ---------------------------------------------------------------- Set up this TV (session 18, decision D10)
// Google TV keeps its own home screen, so a new user must turn on two things in TV Settings. This screen says what
// is still off and opens the right Settings screen; no computer or ADB needed. It opens once by itself.
let setupShown = false; // the Setup screen is on screen: refresh it when the user comes back from TV Settings

function setupState() {
  if (typeof bridge.getSetup !== 'function') return null;
  try { return JSON.parse(bridge.getSetup()); } catch (e) { return null; }
}

function openSetupScreen(which, hint) {
  if (bridge.openSetupScreen(which)) toast(hint, 8000);
  else toast('This TV has no such Settings screen.', 5000);
}

function setupMenu() {
  const s = setupState();
  if (!s) return;
  const body = document.createElement('div');
  body.className = 'boot';
  const line = t => { const p = document.createElement('p'); p.textContent = t; body.append(p); };
  line(s.homeWatch
    ? 'Done: Web Launcher opens instead of Google TV home, after the TV starts or wakes and when you press Home.'
    : 'Google TV keeps its own home screen. Turn on "Web Launcher home" once, and Web Launcher opens instead: after the TV starts or wakes, and when you press Home.');
  line('It only sees when Google TV home opens. It can\'t read the screen or what you type.');
  const items = [
    {
      label: '1. Open instead of Google TV home', value: s.homeWatch ? 'On' : 'Off · open Settings', keepOpen: true,
      run: () => openSetupScreen('accessibility', 'Go down to Services → Web Launcher home → turn it on. Then press Back.'),
    },
    {
      label: '2. Faster start after the TV starts', value: s.overlay ? 'On' : 'Optional · open Settings', keepOpen: true,
      run: () => openSetupScreen('overlay', 'Pick Web Launcher → allow "Display over other apps". Then press Back.'),
    },
    { label: 'Open at TV start', value: s.bootOpen ? 'On' : 'Off', keepOpen: true, run: bootMenu },
    { label: 'The Home button shows Google TV home for a moment', value: 'Tip', keepOpen: true, run: homeButtonTip },
    { label: s.homeWatch ? 'Close' : 'Later', run: () => {} },
  ];
  openMenu('Set up this TV', items, { body, onClose: () => { setupShown = false; store.set('setupSeen', true); } });
  setupShown = true; // after openMenu: it ends the previous screen, which may be this one
}

function homeButtonTip() {
  const body = document.createElement('div');
  body.className = 'boot';
  const p = document.createElement('p');
  p.textContent = 'With "Web Launcher home" on, Home first shows Google TV home, then Web Launcher about a second later. '
    + 'To skip that, install a button-mapping app (for example Button Mapper from the Play Store) and set Home → Web Launcher.';
  body.append(p);
  openMenu('Home button', [{ label: 'Back', keepOpen: true, run: setupMenu }], { body });
}

/** Opens Set up this TV once, on a Google TV where the main step is still off. */
function maybeFirstRunSetup() {
  if (benchMode || safeMode || store.get('setupSeen', false) || !overlay.menu.hidden) return;
  const s = setupState();
  if (s && s.googleTv && !s.homeWatch) setupMenu();
}

async function removeSkinMenu() {
  const installed = (await listSkins()).filter(s => s.source === 'installed');
  if (!installed.length) { openMenu('Remove a skin', [{ label: 'No installed skins', info: true }, { label: 'Back', keepOpen: true, run: installMenu }]); return; }
  openMenu('Remove a skin', installed.map(s => ({
    label: s.name, value: s.version, keepOpen: true,
    run: () => openMenu(`Remove "${s.name}"?`, [
      { label: 'Remove', run: () => removeSkin(s.id) },
      { label: 'Cancel', keepOpen: true, run: removeSkinMenu },
    ]),
  })));
}

function removeSkin(id) {
  if (!bridge.removeSkin(id)) { toast('Could not remove the skin'); return; }
  forgetSkin(id);
  if (!safeMode && skin.manifest.id === id) switchSkin(DEFAULT_SKIN);
  else toast('Skin removed');
}

function switchSkin(id) {
  store.set('skin', id);
  location.replace('/index.html'); // a reload is the simplest clean state; ~1 s, same as a WebView rebuild
}

function optionValues() { return store.get('skinOptions.' + skin.manifest.id, {}); }

function setOption(o, value) {
  const values = { ...optionValues(), [o.id]: value };
  store.set('skinOptions.' + skin.manifest.id, values);
  applyOptions(skin.manifest.options, values);
  postOptions();
}

function optionsMenu() {
  const values = optionValues();
  const shown = o => {
    const v = o.id in values ? values[o.id] : o.default;
    if (o.type === 'toggle') return v ? 'On' : 'Off';
    if (o.choices) return (o.choices.find(c => c.value === v) || {}).label || String(v);
    return String(v);
  };
  openMenu('Skin options', skin.manifest.options.map(o => ({
    label: o.label, value: shown(o), keepOpen: true,
    run: () => {
      if (o.type === 'toggle') { setOption(o, !(o.id in values ? values[o.id] : o.default)); optionsMenu(); return; }
      const choices = o.choices || Array.from({ length: Math.round((o.max - o.min) / o.step) + 1 },
        (_, i) => { const v = +(o.min + i * o.step).toFixed(4); return { value: v, label: String(v) }; });
      const cur = o.id in values ? values[o.id] : o.default;
      openMenu(o.label, choices.map(c => ({
        label: c.label, current: c.value === cur, keepOpen: true,
        run: () => { setOption(o, c.value); optionsMenu(); },
      })));
    },
  })));
}

// ---------------------------------------------------------------- status: clock + memory + toast
const clockFmt = { time: { hour: 'numeric', minute: '2-digit' }, date: { weekday: 'long', day: 'numeric', month: 'long' } };
function tickClock() {
  const now = new Date();
  for (const c of blocks.clocks) {
    c.time.textContent = now.toLocaleTimeString([], clockFmt.time);
    c.date.textContent = now.toLocaleDateString([], clockFmt.date);
  }
  clearTimeout(tickClock.t);
  if (blocks.clocks.length) tickClock.t = setTimeout(tickClock, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
}

function updateMemory() {
  if (!blocks.memories.length) return;
  const info = deviceInfo();
  for (const el of blocks.memories) {
    if (info.availMemMb == null) { el.textContent = ''; continue; }
    el.textContent = `${info.availMemMb} MB free`;
    el.toggleAttribute('low', info.lowMemory || info.availMemMb < 300);
  }
}

let toastTimer;
function toast(msg, ms = 2200) {
  overlay.toast.textContent = msg; overlay.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { overlay.toast.hidden = true; }, ms);
}

// ---------------------------------------------------------------- input
const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
let okTimer = null, longFired = false, okHeld = false;

function activate(el) { if (el && el._activate) el._activate(); }

function contextFor(el) {
  if (!overlay.menu.hidden) return;
  if (frame) {
    const id = frame.focused.itemId;
    if (id && frame.ids.has(id) && !id.startsWith(INPUT_PREFIX)) appMenu(id); else settingsMenu();
    return;
  }
  if (!el) return;
  if (el.dataset && el.dataset.pkg) appMenu(el.dataset.pkg, el.dataset.where);
  else settingsMenu(); // Menu key anywhere else opens Launcher settings
}

/** OK: the core acts on what is focused. In a level 3 skin that is the item the frame last reported. */
function ok() {
  if (!frame || !overlay.menu.hidden) return activate(nav.activeElement());
  if (moving) return stopMoving();
  const { itemId, action } = frame.focused;
  if (action === 'settings') return settingsMenu();
  if (itemId && frame.ids.has(itemId) && itemId.startsWith(INPUT_PREFIX)) {
    const input = inputs.find(i => INPUT_PREFIX + i.id === itemId);
    if (input) framePost({ type: 'launch', itemId }); // lets the skin react (e.g. a mascot) before the app opens
    return input && openInput(input);
  }
  const app = itemId && frame.ids.has(itemId) ? byPkg(itemId) : null;
  if (app) { framePost({ type: 'launch', itemId }); launch(app); }
}

// ---------------------------------------------------------------- runtime guard, script side (M2.2, R20)
// The shell's FrameMetrics windows see slow drawing, not slow script: a busy page just delivers fewer frames, and
// those are on time. So for 10 s after a key, a rAF loop counts the frames that came late. Every frame, the skin's
// included, shares this main thread. Not for the default skin, safe mode or the bench.
const GUARD_WINDOW_MS = 10000, GUARD_LATE_PER_KEY = 6, GUARD_WINDOWS = 3, GUARD_MIN_KEYS = 3;
let guardWin = null, guardBad = 0;
function guardKey() {
  if (safeMode || benchMode || !skin || skin.manifest.id === DEFAULT_SKIN || document.hidden) return;
  if (!guardWin) {
    const w = guardWin = { keys: 0, late: 0, last: 0, end: performance.now() + GUARD_WINDOW_MS };
    const tick = t => {
      if (guardWin !== w) return;
      const gap = t - w.last;
      if (w.last && gap > 25 && gap < 1000) w.late += Math.round(gap / 16.7) - 1; // > 1 s: paused, not jank
      w.last = t;
      if (t < w.end) requestAnimationFrame(tick); else guardEnd(w);
    };
    requestAnimationFrame(tick);
  }
  guardWin.keys++;
}
function guardEnd(w) {
  guardWin = null;
  if (w.keys < GUARD_MIN_KEYS) return;
  const perKey = Math.round((w.late / w.keys) * 10) / 10;
  guardBad = perKey > GUARD_LATE_PER_KEY ? guardBad + 1 : 0;
  console.log(`GUARD_SCRIPT lateFramesPerKey=${perKey} keys=${w.keys} inRow=${guardBad}`);
  if (guardBad >= GUARD_WINDOWS) { guardBad = 0; fallbackToDefault(GUARD_REASONS.jank); }
}
document.addEventListener('keydown', guardKey, true);
document.addEventListener('visibilitychange', () => { if (document.hidden) guardWin = null; });

document.addEventListener('keydown', e => {
  if (!ready) return;
  const dir = DIRS[e.key];
  if (dir) {
    e.preventDefault();
    if (moving && (dir === 'left' || dir === 'right')) shiftFav(dir === 'left' ? -1 : 1);
    else if (!moving && frame && overlay.menu.hidden) framePost({ type: 'nav', dir });
    else if (!moving) nav.move(dir);
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    // While OK is held a remote sends a keydown every ~50 ms, and WebView may not mark them as repeats. So a
    // keydown counts only when OK was up: else, after the long-press menu opened, the next keydown would start a
    // new press and its keyup would also activate the item (session 17).
    if (e.repeat || okHeld) return;
    okHeld = true;
    longFired = false;
    okTimer = setTimeout(() => { okTimer = null; longFired = true; contextFor(nav.activeElement()); }, LONG_PRESS_MS);
    return;
  }
  if (e.key === 'ContextMenu') { e.preventDefault(); launcher.onMenu(); return; }
  if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack') {
    e.preventDefault(); launcher.onBack();
  }
});

// An app opened while OK was held takes its keyup: forget the press.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  clearTimeout(okTimer); okTimer = null; okHeld = false; longFired = false;
});

document.addEventListener('keyup', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  if (okTimer) { clearTimeout(okTimer); okTimer = null; }
  const pressed = okHeld; // a keyup without its keydown (OK pressed before the page was ready): ignore
  okHeld = false;
  if (pressed && !longFired) ok();
  longFired = false;
});

// Pointer support for the desktop preview (detail > 0: a real click, not a key-synthesised one).
document.addEventListener('click', e => {
  if (e.detail === 0 || !ready) return;
  const el = e.composedPath().find(n => n.hasAttribute && n.hasAttribute('data-nav'));
  if (el) { nav.focus(el); activate(el); }
  else if (!overlay.menu.hidden && !e.composedPath().includes(overlay.shadow.querySelector('.card'))) closeMenu();
});
document.addEventListener('contextmenu', e => {
  e.preventDefault();
  const el = e.composedPath().find(n => n.hasAttribute && n.hasAttribute('data-nav'));
  if (el && ready) { nav.focus(el); contextFor(el); }
});

// [focused] is the stable focus hook for skins (light DOM only; the overlay styles itself with :focus).
document.addEventListener('focusin', e => {
  const el = e.target;
  if (el === overlay.host) {
    const inner = nav.activeElement();
    if (inner && inner.scrollIntoView) inner.scrollIntoView({ block: 'nearest' });
    return;
  }
  el.setAttribute('focused', '');
  if (blocks) showFocused(el);
});
document.addEventListener('focusout', e => { if (e.target !== overlay.host) e.target.removeAttribute('focused'); });

// ---------------------------------------------------------------- level 3 skin frame (plan M2.1, revision R16)
// The skin page runs on the skin host in <iframe sandbox="allow-scripts">: opaque origin, no storage, no bridge
// (the bridge needs this page's token), no popups or top navigation. It is inert and ignores the pointer, so the
// core keeps every key. The core sends data and options; the frame's SDK moves focus and reports it back.
function frameElement(url) {
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('inert', '');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  f.className = 'lx-skin-frame';
  f.setAttribute('style', ['position:fixed', 'inset:0', 'width:100%', 'height:100%', 'border:0', 'margin:0', 'padding:0',
    'pointer-events:none', 'background:transparent'].map(d => d + ' !important').join(';'));
  f.src = url;
  return f;
}

function framePost(msg) {
  if (frame && frame.ready && frame.el.contentWindow) frame.el.contentWindow.postMessage({ lx: PROTOCOL, ...msg }, '*');
}

/** Level 3 item ids for TV inputs: "input:" + the input id (app ids are package names, which have no ":"). */
const INPUT_PREFIX = 'input:';

function frameItem(a) {
  const image = window.__isMock ? window.__mockImages[a.pkg] || null : `${SKIN_HOST}__icon/${encodeURIComponent(a.pkg)}`;
  return { id: a.pkg, label: a.label, banner: !!a.hasBanner, image, fav: isFav(a.pkg) };
}

function postData() {
  if (!frame || !frame.ready) return;
  const list = listFor('apps'), favList = listFor('favourites');
  const inputItems = inputs.map(i => ({ id: INPUT_PREFIX + i.id, label: i.label, kind: i.kind, connected: !!i.connected }));
  // The only ids the frame may report (and OK may open).
  frame.ids = new Set([...favList.map(a => a.pkg), ...list.map(a => a.pkg), ...inputItems.map(i => i.id)]);
  framePost({
    type: 'data', apps: list.map(frameItem), favourites: favList.map(frameItem), recent: listFor('recent').map(frameItem), inputs: inputItems, moving,
    hiddenCount: showHidden ? 0 : hidden.length,
  });
}

function postOptions() {
  if (!frame) return;
  const values = safeMode ? {} : optionValues();
  framePost({ type: 'options', values: Object.fromEntries(skin.manifest.options.map(o => [o.id, o.id in values ? values[o.id] : o.default])) });
}

window.addEventListener('message', e => {
  if (!frame || e.source !== frame.el.contentWindow) return;
  const m = e.data;
  if (!m || typeof m !== 'object' || m.lx !== PROTOCOL) return;
  if (m.type === 'ready' && !frame.ready) {
    frame.ready = true;
    postOptions();
    postData();
    frame.resolveReady(true);
  } else if (m.type === 'focused' && frame.ready) {
    const itemId = typeof m.itemId === 'string' && frame.ids.has(m.itemId) ? m.itemId : null;
    if (m.itemId != null && !itemId) console.warn('L3_REJECTED focused ' + String(m.itemId).slice(0, 80));
    frame.focused = { itemId, action: m.action === 'settings' ? 'settings' : null };
    if (!document.documentElement.dataset.state) document.documentElement.dataset.state = 'ready';
    if (frame.onFocused) frame.onFocused();
  }
});
document.addEventListener('visibilitychange', () => framePost({ type: 'visibility', hidden: document.hidden }));

// `inert` does not stop a skin from calling focus() inside its own frame (checked in Chrome for Testing), and a
// focused frame would get the remote's keys. The window blurs when that happens: take the focus straight back.
let lastCoreFocus = null;
const steals = []; // times of reclaimed focus; a skin that keeps grabbing it is replaced
document.addEventListener('focusin', e => { if (!frame || e.target !== frame.el) lastCoreFocus = nav.activeElement(); }, true);
window.addEventListener('blur', () => setTimeout(() => {
  if (!frame || document.activeElement !== frame.el) return;
  frame.el.blur();
  if (lastCoreFocus && lastCoreFocus.isConnected) nav.focus(lastCoreFocus);
  console.warn('L3_FOCUS_RECLAIMED');
  const now = performance.now();
  steals.push(now);
  while (steals.length && now - steals[0] > 10000) steals.shift();
  if (steals.length > 3) { steals.length = 0; fallbackToDefault('it kept taking the focus from the launcher'); }
}, 0));

// ---------------------------------------------------------------- hooks called by the native shell
window.launcher = {
  toast,
  onBack() {
    if (!ready) return;
    if (!overlay.menu.hidden) return closeMenu();
    if (moving) return stopMoving();
    if (frame) return framePost({ type: 'home' });
    for (const s of document.querySelectorAll('lx-scroll')) s.scrollTop = 0;
    for (const r of document.querySelectorAll('lx-row')) r.scrollLeft = 0;
    nav.first();
  },
  onMenu() { if (ready) contextFor(nav.activeElement()); },
  onHome() {
    if (!ready) return;
    if (!overlay.menu.hidden) closeMenu();
    if (moving) stopMoving();
    this.onBack();
  },
  onResume() {
    if (!ready) return;
    updateMemory(); tickClock();
    if (recentDirty) { recentDirty = false; render(); }
    if (setupShown && !overlay.menu.hidden) setupMenu(); // back from TV Settings: show what changed
    framePost({ type: 'resume' });
  },
  onAppsChanged() { if (ready) { loadApps(); render(); } },
  onInputsChanged() { if (ready) { loadInputs(); render(); } },
  onSkinInstalled,
  onInstallPin,
  onInstallLocked,
  checkStaged,
  exportSettings,
  importSettings,
  setGalleryUrl,
  onGallery,
  onGalleryPreview,
};

// ---------------------------------------------------------------- bench probes (?bench only)
if (benchMode) {
  // Key latency: keydown → the next animation frame (plan gate: p95 < 50 ms). Back and Menu are native, not keydowns.
  // In a level 3 skin a move is done when the frame reports the new focus, so arrows wait for that reply.
  const keyMs = [];
  const pending = [];
  const done = t => requestAnimationFrame(() => keyMs.push(Math.round((performance.now() - t) * 10) / 10));
  document.addEventListener('keydown', e => {
    if (frame && frame.ready && DIRS[e.key] && overlay.menu.hidden && !moving) pending.push(e.timeStamp);
    else done(e.timeStamp);
  }, true);
  window.__benchFrameReply = () => { if (pending.length) done(pending.shift()); };
  window.__bench = { keyMs };
  // Called by the shell after `--es frameStats stop`; `lx bench --tv` reads it from logcat.
  window.launcher.benchReport = () => {
    console.log('BENCH_KEYS ' + JSON.stringify(keyMs));
    keyMs.length = 0;
  };
}

// ---------------------------------------------------------------- boot
/** Show skin s: tokens, options and styles, then its layout (levels 0-2) or its frame (level 3). */
function mountSkin(s) {
  skin = s;
  guardWin = null;
  guardBad = 0;
  applySkin(s, safeMode ? {} : optionValues());
  if (frame) { frame.el.remove(); frame = null; }
  if (s.manifest.level === 3) {
    blocks = noBlocks();
    let resolveReady;
    const whenReady = new Promise(r => { resolveReady = r; });
    frame = { el: frameElement(s.frameUrl), ready: false, ids: new Set(), focused: { itemId: null, action: null }, resolveReady, whenReady };
    if (benchMode) frame.onFocused = () => window.__benchFrameReply();
    document.body.replaceChildren(frame.el, overlay.host);
  } else {
    const built = buildLayout(s.layout);
    blocks = built.blocks;
    document.body.replaceChildren(built.root, overlay.host);
    for (const el of document.querySelectorAll('lx-settings')) el._activate = settingsMenu;
  }
  console.log('SKIN ' + JSON.stringify({ id: s.manifest.id, level: s.manifest.level, safeMode, warnings: s.warnings.length }));
  // Runtime guard: the shell checks jank and memory only for a skin the user chose (not safe mode, not the bench).
  try { bridge?.setActiveSkin?.(s.manifest.id, !safeMode && !benchMode); } catch (e) { /* ignore */ }
}

/** The saved skin is `id` and it misbehaved: go back to the default skin for good (the user can pick it again). */
function forgetSkin(id) {
  if (id && id !== DEFAULT_SKIN && store.get('skin', DEFAULT_SKIN) === id) store.set('skin', DEFAULT_SKIN);
}

/** Replace the active skin with the default one; if it was the saved choice, the default one is saved instead. */
async function fallbackToDefault(reason) {
  const id = skin.manifest.id;
  console.error(`SKIN_FAILED ${id}: ${reason}`);
  forgetSkin(id);
  mountSkin(await loadSkin(DEFAULT_SKIN));
  render();
  tickClock();
  updateMemory();
  nav.first();
  toast(`Skin "${id}" stopped: ${reason}. Using the default skin.`, 5000);
}

async function boot() {
  const marks = { coreStart: Math.round(performance.now()) }; // ms since navigation start
  // ?skin=<id> previews a skin for this load only (used by `lx dev` / `lx lint`); it is not saved.
  const preview = params.get('skin');
  if (guardReason) {
    console.warn('GUARD_FALLBACK ' + JSON.stringify({ reason: guardReason, culprit: guardCulprit }));
    forgetSkin(guardCulprit);
  }
  const wanted = safeMode || guardReason ? DEFAULT_SKIN : (preview && /^[a-z0-9-]{1,40}$/.test(preview) ? preview : store.get('skin', DEFAULT_SKIN));
  let fallbackReason = null;
  let loaded;
  try {
    loaded = await loadSkin(wanted);
  } catch (e) {
    console.error('SKIN_FAILED ' + e.message);
    fallbackReason = e.message;
    loaded = await loadSkin(DEFAULT_SKIN);
  }
  mountSkin(loaded);
  marks.skinLoaded = Math.round(performance.now());

  ready = true;
  const t0 = performance.now();
  loadApps();
  const t1 = performance.now();
  render();
  marks.renderParts = { layoutAttached: Math.round(t0 - marks.skinLoaded), loadApps: Math.round(t1 - t0), render: Math.round(performance.now() - t1) };
  tickClock();
  updateMemory();
  setInterval(updateMemory, 30000);
  nav.first();
  marks.rendered = Math.round(performance.now());

  if (frame) {
    const ok = await Promise.race([frame.whenReady, new Promise(r => setTimeout(() => r(false), FRAME_READY_MS))]);
    if (ok) marks.frameReady = Math.round(performance.now());
    else await fallbackToDefault(`it did not start within ${FRAME_READY_MS / 1000} s`);
  }
  if (!frame) document.documentElement.dataset.state = 'ready';
  if (safeMode) toast('Safe mode: default skin. Pick a skin in Launcher settings → Skin.', 5000);
  else if (guardReason && (!guardCulprit || guardCulprit === DEFAULT_SKIN)) toast(`The launcher was restarted: ${GUARD_REASONS[guardReason]}.`, 6000);
  else if (guardReason) toast(`Skin "${guardCulprit}" was turned off: ${GUARD_REASONS[guardReason]}. Using the default skin.`, 6000);
  else if (fallbackReason) toast(`Skin "${wanted}" failed to load; using the default skin.`, 5000);
  setTimeout(maybeFirstRunSetup, 1500); // after the first frames, so the start-up timing is not affected
  setTimeout(heavyCheck, 1500);

  // Startup timing for scripts/probe.sh: process start / activity create -> first rendered frame.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!bridge.getStartup) return;
    try {
      const s = JSON.parse(bridge.getStartup());
      console.log('STARTUP ' + JSON.stringify({
        processToFirstFrameMs: s.nowMs - s.processStartMs,
        activityToFirstFrameMs: s.nowMs - s.activityCreateMs,
        webViewToFirstFrameMs: s.webViewCreateMs ? s.nowMs - s.webViewCreateMs : null,
        apps: apps.length, skin: skin.manifest.id,
        page: { ...marks, firstFrame: Math.round(performance.now()) },
      }));
    } catch (e) { /* ignore */ }
  }));
}

// core.js runs from <head>; the body is normally parsed long before the module arrives.
const bodyReady = document.body ? null : new Promise(r => document.addEventListener('DOMContentLoaded', r, { once: true }));
(bodyReady ? bodyReady.then(boot) : boot()).catch(e => { console.error('BOOT_FAILED ' + (e && e.stack || e)); document.body.textContent = 'Launcher failed to start: ' + e.message; });
