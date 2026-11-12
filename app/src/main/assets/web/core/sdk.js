// Skin SDK shim for level 3 skins (skin API v1). The launcher serves it from the skin host and puts it first in
// every skin page, before the skin's own scripts. It runs inside the sandboxed skin iframe.
//
// The core owns the remote (plan decision 6): it sends `nav {dir}` and this shim moves the focus with the same
// geometry as the core (nav.js), so a move costs no round trip. Focus here is the [focused] attribute, never DOM
// focus (the frame is inert). The shim reports every focus change to the core, and the core acts on OK and Menu
// itself, so a skin can only launch an app the core sent it, and only when the user presses OK.
//
// Protocol (postMessage, every message is { lx: 1, type, ... }):
//   core → skin: data {apps, favourites, moving}, options {values}, nav {dir}, home, resume, visibility {hidden}
//   skin → core: ready, focused {itemId, action}
(() => {
  'use strict';
  // The app has the INTERNET permission (LAN install page, URL downloads, M2.3), and WebRTC is the one way out that
  // the frame's CSP doesn't cover (R21). Remove it before any skin script runs. The frame has no other realm to get
  // it back from: child frames are cross-origin (sandbox without allow-same-origin), and workers and popups are blocked.
  for (const k of Object.getOwnPropertyNames(window)) {
    if (/^(webkit)?RTC/.test(k)) try { delete window[k]; } catch (e) { /* not configurable */ }
  }
  const V = 1;
  const handlers = Object.create(null);
  let pick = null;          // nav.js pick(), loaded below
  let current = null;       // focused element
  let currentId = null;     // its data-item, and which occurrence of that id it was (an app can be in two lists)
  let currentNth = 0;
  let data = null;

  const post = (type, body) => parent.postMessage({ lx: V, type, ...body }, '*');
  const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());

  function emit(type, arg) {
    for (const fn of handlers[type] || []) {
      try { fn(arg); } catch (e) { console.error(`lx.on('${type}') handler failed:`, e); }
    }
  }

  const visible = el => el.offsetParent !== null || el.getClientRects().length > 0;
  const items = () => Array.from(document.querySelectorAll('[data-nav]')).filter(visible);
  const byId = id => Array.from(document.querySelectorAll(`[data-item="${CSS.escape(id)}"]`));

  function report() {
    post('focused', {
      itemId: current && current.dataset.item != null ? current.dataset.item : null,
      action: current && current.dataset.action ? current.dataset.action : null,
    });
  }

  function setFocus(el) {
    if (el !== current) {
      if (current) current.removeAttribute('focused');
      current = el || null;
      if (current) {
        current.setAttribute('focused', '');
        current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        currentId = current.dataset.item != null ? current.dataset.item : null;
        currentNth = currentId != null ? Math.max(0, byId(currentId).indexOf(current)) : 0;
      }
      emit('focus', current);
    }
    report();
  }

  function first() {
    const list = items();
    return list.find(el => el.dataset.item != null) || list[0] || null;
  }

  /** Keep focus on the same item after the skin re-rendered (after `data`, or when the skin calls lx.refresh()). */
  function restore() {
    let el = null;
    if (data && data.moving) el = document.querySelector(`[data-list="favourites"] [data-item="${CSS.escape(data.moving)}"]`);
    if (!el && current && current.isConnected && visible(current)) el = current;
    if (!el && currentId != null) { const same = byId(currentId).filter(visible); el = same[Math.min(currentNth, same.length - 1)] || null; }
    if (!el) el = first();
    if (el !== current && current) current.removeAttribute('focused');
    if (el === current) { report(); return; }
    setFocus(el);
  }

  function move(dir) {
    if (!pick) return report();
    if (!current || !current.isConnected) return setFocus(first());
    const next = pick(current, dir, items());
    if (next) setFocus(next); else report(); // still answer, so the core can time the key
  }

  function home() {
    document.scrollingElement && (document.scrollingElement.scrollTop = 0);
    for (const el of document.querySelectorAll('[data-list], [data-scroll]')) { el.scrollLeft = 0; el.scrollTop = 0; }
    setFocus(first());
  }

  /** Options reach CSS as html[data-opt-<id>] and --lx-opt-<id>, like levels 1–2. */
  function applyOptions(values) {
    const root = document.documentElement;
    for (const [id, v] of Object.entries(values || {})) {
      if (!/^[a-zA-Z][a-zA-Z0-9]{0,39}$/.test(id)) continue;
      root.setAttribute('data-opt-' + kebab(id), typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));
      if (typeof v !== 'boolean') root.style.setProperty('--lx-opt-' + kebab(id), String(v));
    }
  }

  window.addEventListener('message', e => {
    if (e.source !== parent || !e.data || e.data.lx !== V) return;
    const m = e.data;
    switch (m.type) {
      case 'data': data = m; emit('data', m); restore(); break;
      case 'options': applyOptions(m.values); emit('options', m.values || {}); break;
      case 'nav': if (['up', 'down', 'left', 'right'].includes(m.dir)) move(m.dir); break;
      case 'home': home(); emit('home'); break;
      case 'resume': emit('resume'); break;
      case 'launch': emit('launch', typeof m.itemId === 'string' ? m.itemId : null); break;
      case 'visibility': emit('visibility', !!m.hidden); break;
    }
  });

  window.lx = Object.freeze({
    version: V,
    /** type: data | options | focus | home | resume | visibility */
    on(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    /** Call after rendering outside a `data` handler (for example after an async step). */
    refresh: restore,
    get data() { return data; },
    get focused() { return current; },
  });

  // nav.js is a module; this file is a classic script so window.lx exists before the skin's scripts run.
  const navUrl = new URL('nav.js', document.currentScript.src).href;
  const loaded = new Promise(r => (document.readyState === 'complete' ? r() : addEventListener('load', r, { once: true })));
  Promise.all([import(navUrl), loaded]).then(([nav]) => { pick = nav.pick; post('ready', {}); },
    e => console.error('lx sdk: could not load nav.js', e));
})();
