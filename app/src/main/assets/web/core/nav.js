// Geometric D-pad navigation over every visible [data-nav] element inside the active scope.
// Up/Down: nearest line in that direction, then the closest item horizontally.
// Left/Right: same line (vertical overlap), nearest item in that direction.
// Skins never navigate themselves (plan decision 6): they only decide where elements are.
// The L3 skin SDK (sdk.js) imports candidates() and pick() so moves inside a skin frame use the same geometry.

let scope = document; // narrowed to the core overlay's shadow root while a menu is open

/** The focused element, looking through shadow roots (the core overlay lives in one). */
export function activeElement() {
  let a = document.activeElement;
  while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

export function candidates() {
  return Array.from(scope.querySelectorAll('[data-nav]')).filter(el => el.offsetParent !== null || el.getClientRects().length);
}

const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/** The element to move to from `from` in direction dir, among `among` (default: candidates()), or null. */
export function pick(from, dir, among = candidates()) {
  const r = from.getBoundingClientRect();
  const c = center(r);
  const list = [];
  for (const el of among) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    const bc = center(b);
    if (dir === 'left' || dir === 'right') {
      const overlap = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
      if (overlap < Math.min(r.height, b.height) * 0.3) continue;
      const gap = dir === 'right' ? bc.x - c.x : c.x - bc.x;
      if (gap <= 1) continue;
      list.push({ el, primary: gap, secondary: Math.abs(bc.y - c.y) });
    } else {
      const gap = dir === 'down' ? b.top - r.bottom : r.top - b.bottom;
      const centerGap = dir === 'down' ? bc.y - c.y : c.y - bc.y;
      if (centerGap <= 1 || gap < -r.height * 0.5) continue;
      list.push({ el, primary: Math.max(gap, 0), secondary: Math.abs(bc.x - c.x) });
    }
  }
  if (!list.length) return null;
  const minPrimary = Math.min(...list.map(i => i.primary)); // nearest line first (within 8 px)
  return list.filter(i => i.primary <= minPrimary + 8).sort((a, b) => a.secondary - b.secondary)[0].el;
}

/** Keep el visible: instant scrolling of its row (horizontal) and of its lx-scroll (vertical). */
function reveal(el) {
  const row = el.closest('lx-row');
  if (row) {
    const pad = 24;
    const er = el.getBoundingClientRect(), rr = row.getBoundingClientRect();
    if (er.right > rr.right - pad) row.scrollLeft += er.right - rr.right + pad;
    else if (er.left < rr.left + pad) row.scrollLeft -= rr.left + pad - er.left;
  }
  const sc = el.closest('lx-scroll');
  if (sc) {
    const pad = window.innerHeight * 0.08;
    const er = el.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    if (sc.firstElementChild && sc.firstElementChild.contains(el)) sc.scrollTop = 0;
    else if (er.bottom > sr.bottom - pad) sc.scrollTop += er.bottom - sr.bottom + pad;
    else if (er.top < sr.top + pad) sc.scrollTop -= sr.top + pad - er.top;
  }
}

export function focus(el) {
  if (!el) return false;
  el.focus({ preventScroll: true });
  reveal(el);
  return true;
}

export function move(dir) {
  const cur = activeElement();
  if (!cur || !cur.hasAttribute('data-nav') || !scope.contains(cur)) return focus(candidates()[0]);
  return focus(pick(cur, dir));
}

export function first() {
  const list = candidates();
  return focus(list.find(el => el.localName === 'lx-tile') || list[0]);
}

export function setScope(root) { scope = root || document; }
