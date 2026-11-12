// @ts-check
// The fish: six cut-out pictures (img/fish-*.webp, all facing left) drawn on a 2D canvas at 1280×720. Near fish are
// big and slow, a school of small fish keeps together in the distance. Drawn only while the scene is live (live.js).

const W = 1280, H = 720;
const KINDS = /** @type {const} */ (['idol', 'tang', 'clown', 'butterfly', 'silver', 'tetra']);

function load(/** @type {string} */ name) {
  const img = new Image();
  img.decoding = 'async';
  img.src = `img/fish-${name}.webp`;
  return img;
}

/** A small repeatable random source, so the tank looks the same after every start. */
function rng(seed = 7) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ many: boolean }} o
 */
export function createFish(canvas, o) {
  canvas.width = W; canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const sprites = Object.fromEntries(KINDS.map(k => [k, load(k)]));
  /** @type {{ img: HTMLImageElement, x: number, y: number, y0: number, v: number, size: number, phase: number, alpha: number }[]} */
  let fish = [];

  function populate(/** @type {boolean} */ many) {
    const r = rng();
    fish = [];
    // The school: far away, small, a little faded by the water.
    const school = (/** @type {string} */ kind, /** @type {number} */ n, /** @type {number} */ cx, /** @type {number} */ cy, /** @type {number} */ v) => {
      for (let i = 0; i < n; i++) {
        fish.push({ img: sprites[kind], x: cx + (r() - 0.5) * 260, y: 0, y0: cy + (r() - 0.5) * 90, v: v * (0.9 + r() * 0.2), size: 0.2 + r() * 0.07, phase: r() * 6.28, alpha: 0.78 });
      }
    };
    school('silver', many ? 9 : 5, 820, 150, -34);
    if (many) school('tetra', 6, 380, 300, 26);
    // Near fish: one of each, at their own depth.
    const near = [['idol', 420, 250, 22, 0.62], ['tang', 900, 330, -18, 0.56], ['butterfly', 1050, 170, 14, 0.4], ['clown', 250, 400, -12, 0.36]];
    for (const [kind, x, y, v, size] of near.slice(0, many ? 4 : 2)) {
      fish.push({ img: sprites[/** @type {string} */ (kind)], x: /** @type {number} */ (x), y: 0, y0: /** @type {number} */ (y), v: /** @type {number} */ (v), size: /** @type {number} */ (size), phase: r() * 6.28, alpha: 1 });
    }
    fish.sort((a, b) => a.size - b.size); // far fish first
  }
  populate(o.many);

  return {
    setMany(/** @type {boolean} */ many) { populate(many); },
    /** One frame: move by dt seconds and draw. */
    draw(/** @type {number} */ t, /** @type {number} */ dt) {
      ctx.clearRect(0, 0, W, H);
      for (const f of fish) {
        if (!f.img.complete || !f.img.naturalWidth) continue;
        const w = f.img.naturalWidth * f.size, h = f.img.naturalHeight * f.size;
        f.x += f.v * dt;
        if (f.v < 0 && f.x < -w) f.x = W + w; else if (f.v > 0 && f.x > W + w) f.x = -w; // swim round
        f.y = f.y0 + Math.sin(t * 0.5 + f.phase) * 9 * f.size * 2;
        ctx.globalAlpha = f.alpha;
        if (f.v > 0) { ctx.save(); ctx.translate(f.x, f.y); ctx.scale(-1, 1); ctx.drawImage(f.img, -w / 2, -h / 2, w, h); ctx.restore(); } // the pictures face left
        else ctx.drawImage(f.img, f.x - w / 2, f.y - h / 2, w, h);
      }
      ctx.globalAlpha = 1;
    },
    /** Resolves when every picture is decoded (or failed). */
    ready: () => Promise.all(Object.values(sprites).map(i => i.decode().catch(() => {}))),
  };
}
