// @ts-check
// The small motions of the living room, drawn on a 2D canvas over the still picture: the glow of the fire flickers
// and sparks rise, the tree lights twinkle, snow falls behind the window. Positions follow img/room.webp in a
// 1280×720 frame; the canvas is 960×540 (soft light needs no more) and glows are pre-drawn sprites, so a frame
// makes no new gradients (memory on the VU31). Drawn only while the scene is live (live.js).

const W = 1280, H = 720, SCALE = 0.75;
const FIRE = { x: 436, y: 352 };                          // the flames in the fireplace
const TREE = { x: 880, top: 18, bottom: 356, half: 138 }; // a triangle of lights
const WINDOW = { x: 1066, y: 0, w: 214, h: 284 };         // the glass

function rng(seed = 11) { return () => (seed = (seed * 16807) % 2147483647) / 2147483647; }

/** A soft round glow, white to transparent, 64 px across: tinted per colour once. */
function sprite(/** @type {string} */ rgb) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = /** @type {CanvasRenderingContext2D} */ (c.getContext('2d'));
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, `rgba(${rgb}, 1)`); g.addColorStop(1, `rgba(${rgb}, 0)`);
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return c;
}

export function createRoom(/** @type {HTMLCanvasElement} */ canvas) {
  canvas.width = Math.round(W * SCALE); canvas.height = Math.round(H * SCALE);
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0); // draw in 1280×720 units
  /** @type {Record<string, HTMLCanvasElement>} */
  const sprites = {};
  const r = rng();
  const lights = Array.from({ length: 46 }, () => {
    const k = Math.sqrt(r()); // more lights lower down, where the tree is wide
    return { x: TREE.x + (r() - 0.5) * 2 * TREE.half * k, y: TREE.top + (TREE.bottom - TREE.top) * k, phase: r() * 6.28, speed: 0.8 + r() * 1.6, warm: r() < 0.8 };
  });
  const flakes = Array.from({ length: 70 }, () => ({ x: r() * WINDOW.w, y: r() * WINDOW.h, v: 14 + r() * 22, drift: (r() - 0.5) * 8, size: 0.8 + r() * 1.4, phase: r() * 6.28 }));
  const sparks = Array.from({ length: 7 }, () => ({ x: 0, y: 0, v: 0, life: 0, age: 9 }));

  function glowDot(/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ radius, /** @type {string} */ rgb, /** @type {number} */ a) {
    const s = sprites[rgb] || (sprites[rgb] = sprite(rgb));
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.drawImage(s, x - radius, y - radius, radius * 2, radius * 2);
  }

  return {
    draw(/** @type {number} */ t, /** @type {number} */ dt) {
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      // Fire: a warm glow that breathes with three sines, on the flames and on the hearth in front.
      const f = 0.55 + 0.18 * Math.sin(t * 9.1) + 0.14 * Math.sin(t * 14.7 + 1.3) + 0.1 * Math.sin(t * 23.3 + 0.4);
      glowDot(FIRE.x, FIRE.y, 70, '255, 150, 50', 0.30 * f);
      glowDot(FIRE.x + 6 * Math.sin(t * 6.3), FIRE.y - 18, 42, '255, 205, 110', 0.34 * f);
      glowDot(FIRE.x, FIRE.y + 60, 190, '255, 120, 40', 0.10 * f);
      for (const s of sparks) {
        s.age += dt;
        if (s.age > s.life) { s.x = FIRE.x + (r() - 0.5) * 50; s.y = FIRE.y - 10; s.v = 26 + r() * 30; s.life = 0.8 + r() * 1.4; s.age = 0; }
        s.y -= s.v * dt; s.x += Math.sin(t * 5 + s.v) * 6 * dt;
        glowDot(s.x, s.y, 3, '255, 190, 90', 0.9 * (1 - s.age / s.life));
      }
      // Tree lights: each one fades up and down at its own pace.
      for (const l of lights) {
        const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * l.speed + l.phase)) ** 2;
        glowDot(l.x, l.y, 7, l.warm ? '255, 214, 140' : '255, 244, 220', a);
      }
      // Snow: only behind the glass.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.beginPath(); ctx.rect(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h); ctx.clip();
      ctx.fillStyle = 'rgba(235, 242, 255, 0.85)';
      for (const k of flakes) {
        k.y += k.v * dt; k.x += (k.drift + Math.sin(t + k.phase) * 5) * dt;
        if (k.y > WINDOW.h) { k.y = -2; k.x = r() * WINDOW.w; }
        ctx.beginPath(); ctx.arc(WINDOW.x + ((k.x % WINDOW.w) + WINDOW.w) % WINDOW.w, WINDOW.y + k.y, k.size, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    },
  };
}
