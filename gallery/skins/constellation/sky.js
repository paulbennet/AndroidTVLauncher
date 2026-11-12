// @ts-check
// The Constellation sky, drawn with three.js ONCE (at start and when an option changes) into the two 2D canvases
// of the page: `far` (dim stars, the Milky Way, faint background constellations) and `near` (bright stars with
// spikes). The WebGL context is released right after, so nothing stays on the GPU and nothing draws at rest;
// focus moves only slide the two canvases (CSS transforms in skin.js).
import {
  WebGLRenderer, Scene, PerspectiveCamera, Points, BufferGeometry, BufferAttribute, ShaderMaterial,
  NormalBlending, LineSegments, LineBasicMaterial, Color,
} from './vendor/three.module.js';

const W = 1920, H = 1080, FOV = 50;

function rng(seed) { // mulberry32: the same sky every time
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gauss = r => { let u = 0, v = 0; while (u === 0) u = r(); while (v === 0) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/** Design pixel (x, y) at depth z → world position (the camera looks down −z from the origin). */
function world(x, y, z) {
  const h = Math.tan((FOV * Math.PI) / 360) * -z, w = h * (W / H);
  return [((x / W) * 2 - 1) * w, (1 - (y / H) * 2) * h, z];
}

const SKIES = {
  night: { star: ['#F4F1E8', '#CFD8FF', '#FFE9B8'], band: '#8C86E8', density: 1 },
  deep:  { star: ['#FFFFFF', '#BFD2FF', '#FFD9A8'], band: '#6F7BE0', density: 1.35 },
  dawn:  { star: ['#FFF4E4', '#FFD1C2', '#FFE7A6'], band: '#C88BD6', density: 0.75 },
};

const material = spike => new ShaderMaterial({
  transparent: true, depthWrite: false, blending: NormalBlending, premultipliedAlpha: true, // output is premultiplied
  uniforms: { uSpike: { value: spike } },
  vertexShader: `
    attribute float size; attribute float alpha; attribute vec3 tint;
    varying vec3 vTint; varying float vAlpha; varying float vSize;
    void main() {
      vTint = tint; vAlpha = alpha; vSize = size;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = size;
    }`,
  fragmentShader: `
    uniform float uSpike; varying vec3 vTint; varying float vAlpha; varying float vSize;
    void main() {
      vec2 p = gl_PointCoord - 0.5;
      float d = length(p);
      float core = vSize < 4.0 ? smoothstep(0.5, 0.15, d) : pow(smoothstep(0.5, 0.0, d), 2.2);
      float s = uSpike * step(5.0, vSize);
      float spike = s * (max(0.0, 1.0 - abs(p.x) * 22.0) * smoothstep(0.5, 0.05, abs(p.y))
                       + max(0.0, 1.0 - abs(p.y) * 22.0) * smoothstep(0.5, 0.05, abs(p.x)));
      float a = clamp(core + spike * 0.7, 0.0, 1.0) * vAlpha;
      gl_FragColor = vec4(vTint * a, a);
    }`,
});

/** A Points object from [x, y, z, size, alpha, colour] rows in design pixels. */
function points(rows, spike, ratio) {
  const n = rows.length, pos = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n), tint = new Float32Array(n * 3);
  const c = new Color();
  rows.forEach(([x, y, z, s, a, col], i) => {
    pos.set(world(x, y, z), i * 3); size[i] = Math.max(s * ratio, 1.6); alpha[i] = a; // < 1.6 px points vanish
    c.set(col); tint.set([c.r, c.g, c.b], i * 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('size', new BufferAttribute(size, 1));
  g.setAttribute('alpha', new BufferAttribute(alpha, 1));
  g.setAttribute('tint', new BufferAttribute(tint, 3));
  return new Points(g, material(spike));
}

/** Faint background constellations (decoration only, like the release art): segments between dots. */
const DECOR = [
  [[300, 360], [330, 266], [470, 210], [445, 320], [300, 360]],
  [[1440, 128], [1500, 64], [1560, 128]],
  [[1430, 824], [1530, 780], [1615, 796], [1705, 724]],
];

function farScene(sky, milkyway, ratio) {
  const r = rng(7), rows = [];
  const count = Math.round(1100 * sky.density);
  for (let i = 0; i < count; i++) {
    const big = r() < 0.08;
    rows.push([r() * W, r() * H, -10, (big ? 3.2 : 1.4) + r() * 1.4, big ? 0.85 : 0.35 + r() * 0.35, sky.star[Math.floor(r() * 3)]]);
  }
  if (milkyway) { // a band from lower left to upper right, densest in the middle
    const nx = 0.37, ny = 0.93; // unit normal of the band
    for (let i = 0; i < Math.round(9000 * sky.density); i++) {
      const t = r(), spread = 60 + 80 * Math.sin(Math.PI * t), off = gauss(r) * spread;
      const x = -60 + t * (W + 120), y = 960 - t * 860;
      const fade = Math.max(0, 1 - Math.abs(off) / (2.4 * spread));
      rows.push([x + nx * off, y + ny * off, -10, 1.6 + r() * 1.8, (0.35 + r() * 0.5) * fade, r() < 0.75 ? sky.band : sky.star[1]]);
    }
    for (let i = 0; i < 260; i++) { // a soft haze along the band: big, very faint points
      const t = r(), off = gauss(r) * 50, x = -60 + t * (W + 120), y = 960 - t * 860;
      rows.push([x + nx * off, y + ny * off, -10, 60 + r() * 60, 0.05, sky.band]);
    }
  }
  for (const shape of DECOR) for (const [x, y] of shape) rows.push([x, y, -10, 5.5, 0.9, sky.star[2]]);
  const scene = new Scene();
  scene.add(points(rows, 0.0, ratio));
  const seg = [];
  for (const shape of DECOR) for (let i = 1; i < shape.length; i++) seg.push(...world(...shape[i - 1], -10), ...world(...shape[i], -10));
  const lg = new BufferGeometry();
  lg.setAttribute('position', new BufferAttribute(new Float32Array(seg), 3));
  scene.add(new LineSegments(lg, new LineBasicMaterial({ color: sky.band, transparent: true, opacity: 0.45 })));
  return scene;
}

function nearScene(sky, ratio) {
  const r = rng(11), rows = [];
  for (let i = 0; i < Math.round(150 * sky.density); i++) {
    const s = r() < 0.18 ? 6 + r() * 5 : 2.2 + r() * 2.2;
    rows.push([r() * W, r() * H * 0.9, -4, s, 0.7 + r() * 0.3, sky.star[Math.floor(r() * 3)]]);
  }
  const scene = new Scene();
  scene.add(points(rows, 1.0, ratio));
  return scene;
}

/** Renders both layers at the canvases' pixel size, then frees the WebGL context. */
export function paintSky(far, near, { sky = 'night', milkyway = true } = {}) {
  const look = SKIES[sky] || SKIES.night;
  const ratio = Math.min(devicePixelRatio || 1, 1.5);
  const sizeOf = cv => [Math.round(cv.clientWidth * ratio), Math.round(cv.clientHeight * ratio)];
  const [w, h] = sizeOf(far);
  const gl = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas: gl, alpha: true, antialias: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 0);
  const camera = new PerspectiveCamera(FOV, W / H, 0.1, 100);
  // Point sizes are in design pixels; scale them to this canvas.
  const scale = (w / W);
  for (const [cv, scene] of [[far, farScene(look, milkyway, scale)], [near, nearScene(look, scale)]]) {
    renderer.render(scene, camera);
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(gl, 0, 0);
    cv.dataset.painted = '1';
    scene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
  renderer.dispose();
  renderer.forceContextLoss();
}
