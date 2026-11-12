// @ts-check
// Code rain on a 2D canvas at 1280×720: streams of glyphs at three depths (far: small and dim, near: large and
// bright) fall over a dark floor that mirrors them faintly. Glyphs come from small sprite sheets, one per depth
// (drawImage is much cheaper than fillText for ~1500 glyphs a frame). Our own glyph set: digits, letters, shapes.
// Drawn only while the scene is live (live.js); at rest the last picture stays.

const W = 1280, H = 720, FLOOR = 500; // the floor starts at y = FLOOR
const GLYPHS = '0123456789ABCDEFGHKLMNPRSTVXZ+=<>*:/□△◇○'; // digits, letters, a few shapes
const COLOURS = { green: ['#35E66B', '#E6FFEA'], amber: ['#F2B03A', '#FFF4DC'], ice: ['#6FD6FF', '#EAF9FF'] };
const LAYERS = [ // size px, streams (dense), speed px/s, alpha
  { size: 9, n: 90, speed: 34, alpha: 0.34 },
  { size: 15, n: 42, speed: 62, alpha: 0.62 },
  { size: 26, n: 14, speed: 104, alpha: 1 },
];

function rng(seed = 5) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

/** A sprite sheet: row 0 = body colour, row 1 = head colour; one cell per glyph. */
function sheet(/** @type {number} */ size, /** @type {string[]} */ colours) {
  const c = document.createElement('canvas');
  const cell = Math.ceil(size * 1.25);
  c.width = cell * GLYPHS.length; c.height = cell * 2;
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  x.font = `${size}px "JetBrains Mono", monospace`; x.textAlign = 'center'; x.textBaseline = 'middle';
  colours.forEach((col, row) => {
    x.fillStyle = col;
    [...GLYPHS].forEach((g, i) => x.fillText(g, i * cell + cell / 2, row * cell + cell / 2));
  });
  return { canvas: c, cell };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ colour: string, dense: boolean }} o
 */
export function createRain(canvas, o) {
  canvas.width = W; canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const r = rng();
  let colours = COLOURS.green, sheets = /** @type {{ canvas: HTMLCanvasElement, cell: number }[]} */ ([]);
  /** @type {{ layer: number, x: number, y: number, len: number, v: number, glyphs: number[], flip: number }[]} */
  let streams = [];
  let focusX = -1; // canvas x of the focused portal, or -1

  function build(/** @type {{ colour: string, dense: boolean }} */ opt) {
    colours = COLOURS[/** @type {keyof typeof COLOURS} */ (opt.colour)] || COLOURS.green;
    sheets = LAYERS.map(l => sheet(l.size, colours));
    streams = [];
    LAYERS.forEach((l, layer) => {
      const n = Math.round(l.n * (opt.dense ? 1 : 0.55));
      for (let i = 0; i < n; i++) {
        const len = 8 + Math.floor(r() * 16);
        streams.push({ layer, x: r() * W, y: r() * (FLOOR + 300) - 150, len, v: l.speed * (0.7 + r() * 0.6), glyphs: Array.from({ length: len }, () => Math.floor(r() * GLYPHS.length)), flip: r() });
      }
    });
  }
  build(o);

  function drawStream(/** @type {typeof streams[0]} */ s, /** @type {number} */ boost) {
    const l = LAYERS[s.layer], sh = sheets[s.layer], step = l.size * 1.18, cell = sh.cell;
    for (let i = 0; i < s.len; i++) {
      const y = s.y - i * step;
      if (y < -cell || y > FLOOR) continue;
      const head = i === 0;
      ctx.globalAlpha = Math.min(1, l.alpha * boost * (head ? 1 : (1 - i / s.len) * 0.85));
      ctx.drawImage(sh.canvas, s.glyphs[i] * cell, head ? cell : 0, cell, cell, s.x - cell / 2, y - cell / 2, cell, cell);
    }
  }

  return {
    rebuild: build,
    /** The focused portal's centre as a share of the page width (0..1), or -1: its stream is brighter. */
    setFocus(/** @type {number} */ share) { focusX = share < 0 ? -1 : share * W; },
    draw(/** @type {number} */ t, /** @type {number} */ dt) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      for (const s of streams) {
        s.y += s.v * dt;
        const l = LAYERS[s.layer];
        if (s.y - s.len * l.size * 1.18 > FLOOR) { s.y = -r() * 120; s.x = r() * W; }
        s.flip += dt * 3;
        if (s.flip > 1) { s.flip = 0; s.glyphs[Math.floor(r() * s.len)] = Math.floor(r() * GLYPHS.length); } // a glyph changes now and then
        drawStream(s, 1);
      }
      // The stream of the focused portal: a near stream at its x, brighter, always in view.
      if (focusX >= 0) {
        const sh = sheets[2], cell = sh.cell, step = LAYERS[2].size * 1.18;
        for (let i = 0; i < 9; i++) {
          const y = 28 + ((t * 60 + i * step) % (9 * step));
          ctx.globalAlpha = 0.35 + 0.65 * (y / (9 * step + 28));
          ctx.drawImage(sh.canvas, ((i * 7 + Math.floor(t * 2)) % GLYPHS.length) * cell, cell, cell, cell, focusX - cell / 2, y - cell / 2, cell, cell);
        }
      }
      // The floor: the near streams leave short dim streaks on it (no copy of the canvas: that needs a full extra
      // bitmap every frame), then it fades to black, with a soft horizon line.
      ctx.globalAlpha = 0.16;
      for (const s of streams) {
        if (s.layer !== 2) continue;
        const sh = sheets[2], cell = sh.cell;
        for (let i = 0; i < 4; i++) ctx.drawImage(sh.canvas, s.glyphs[i] * cell, 0, cell, cell, s.x - cell / 2, FLOOR + 8 + i * cell * 0.9, cell, cell * 0.8);
      }
      ctx.globalAlpha = 1;
      const fade = ctx.createLinearGradient(0, FLOOR, 0, H);
      fade.addColorStop(0, 'rgba(0, 0, 0, 0)'); fade.addColorStop(1, 'rgba(0, 0, 0, 0.92)');
      ctx.fillStyle = fade; ctx.fillRect(0, FLOOR, W, H - FLOOR);
      const glow = ctx.createLinearGradient(0, FLOOR - 26, 0, FLOOR + 26);
      glow.addColorStop(0, 'rgba(0, 0, 0, 0)'); glow.addColorStop(0.5, colours[0] + '38'); glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow; ctx.fillRect(0, FLOOR - 26, W, 52);
    },
    /** Resolves when the skin font is ready (the sprite sheets need it). */
    ready: () => document.fonts.load('26px "JetBrains Mono"').then(() => build(o), () => {}),
  };
}
