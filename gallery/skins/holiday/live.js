// @ts-check
// "Live for a while": a scene that moves for some seconds after a key, then rests (the launcher's idle gate: no
// frames at rest). Also the ambient mode: after the same rest time the app row steps aside (body.ambient).

/**
 * @param {(t: number, dt: number) => void} draw  draws one frame; t and dt in seconds
 * @param {{ seconds?: number, fps?: number }} [o]
 */
export function createLive(draw, { seconds = 20, fps = 20 } = {}) {
  let until = 0, timer = 0, last = 0, hidden = false, enabled = true;
  function frame() {
    timer = 0;
    const now = performance.now();
    if (!enabled || hidden || now > until) return; // rest: the last picture stays
    draw(now / 1000, Math.min(0.2, (now - last) / 1000));
    last = now;
    timer = window.setTimeout(() => requestAnimationFrame(frame), 1000 / fps);
  }
  return {
    /** A key was pressed (or the launcher came back): move for `seconds` more. */
    kick() {
      until = performance.now() + seconds * 1000;
      if (!timer && enabled && !hidden) { last = performance.now(); timer = window.setTimeout(() => requestAnimationFrame(frame), 0); }
    },
    /** One frame now, also when motion is off (the first picture, an option change). */
    still() { const now = performance.now(); draw(now / 1000, 0); last = now; },
    setEnabled(/** @type {boolean} */ on) { enabled = on; },
    setHidden(/** @type {boolean} */ h) { hidden = h; },
  };
}

/** Adds body.ambient after `seconds` without wake(); wake() removes it. */
export function createAmbient(seconds = 20) {
  let timer = 0, enabled = true;
  return {
    /** `instant`: show the row at once, without the fade (the launcher came back; no frames for a fade). */
    wake(instant = false) {
      if (instant && document.body.classList.contains('ambient')) {
        document.body.classList.add('instant');
        requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove('instant')));
      }
      document.body.classList.remove('ambient');
      clearTimeout(timer);
      if (enabled) timer = window.setTimeout(() => document.body.classList.add('ambient'), seconds * 1000);
    },
    setEnabled(/** @type {boolean} */ on) { enabled = on; if (!on) { clearTimeout(timer); document.body.classList.remove('ambient'); } },
  };
}
