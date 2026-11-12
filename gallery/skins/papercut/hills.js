// @ts-check
// Paper Cut hills, painted ONCE per time of day by three.js: one full-screen ShaderMaterial draws five layers of
// cut-paper hills (our own curves after the release art), with paper grain, a light edge on top of each sheet and a
// soft shadow under it. Three passes (far / mid / near) fill the page's three canvases; then the WebGL context is
// released. Parallax is done by CSS transforms in skin.js, so nothing is drawn per key or at rest.
import { WebGLRenderer, Scene, OrthographicCamera, Mesh, PlaneGeometry, ShaderMaterial, Color } from './vendor/three.module.js';

/** Five hill colours (back → front) per time of day (after reference B); the sky is a CSS gradient (skin.css). */
export const PALETTES = {
  day:   { hills: ['#7FB3D3', '#5E9DB5', '#3F8F8A', '#8DBE6A', '#4C9443'] },
  dusk:  { hills: ['#2F3760', '#575882', '#8A5572', '#C3644E', '#E89A79'] },
  night: { hills: ['#3D639A', '#34598E', '#2C4D7E', '#233F69', '#1A3054'] },
};

const frag = `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uHill[5];
  uniform int uFrom; uniform int uTo; uniform float uGrain; uniform float uAspect; uniform float uTop;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fibres(vec2 p) { return noise(p * 380.0) * 0.5 + noise(p * 90.0) * 0.3 + noise(vec2(p.x * 30.0, p.y * 600.0)) * 0.2; }
  // Hill tops (screen y from the top, 0..1) as gentle sums of sines.
  float top(int i, float x) {
    if (i == 0) return 0.40 + 0.030 * sin(x * 4.1 + 0.6) + 0.020 * sin(x * 9.3 + 1.7);
    if (i == 1) return 0.48 + 0.035 * sin(x * 3.3 + 2.4) + 0.018 * sin(x * 8.1 + 0.2);
    if (i == 2) return 0.57 + 0.035 * sin(x * 3.7 + 4.0) + 0.020 * sin(x * 7.7 + 2.9);
    if (i == 3) return 0.67 + 0.040 * sin(x * 2.9 + 1.1) + 0.016 * sin(x * 6.9 + 0.8);
    return 0.79 + 0.040 * sin(x * 2.4 + 3.3) + 0.018 * sin(x * 6.1 + 2.2);
  }
  void main() {
    vec2 uv = vec2(vUv.x, uTop + (1.0 - vUv.y) * (1.0 - uTop)); // y down, like the page; this canvas starts at uTop
    float x = uv.x * uAspect;
    vec4 col = vec4(0.0);
    for (int i = 0; i < 5; i++) {
      if (i < uFrom || i > uTo) continue;
      float t = top(i, x);
      float d = uv.y - t;                          // > 0 inside this sheet
      // Soft shadow this sheet casts on what is behind it (just above its edge).
      float sh = smoothstep(-0.03, 0.0, d) * (1.0 - smoothstep(0.0, 0.001, d)) * 0.35;
      col.rgb = mix(col.rgb, col.rgb * 0.62, sh * col.a);
      col.a = max(col.a, sh * 0.6);
      if (d > 0.0) {
        float g = (fibres(uv * vec2(uAspect, 1.0) + float(i) * 3.1) - 0.5) * uGrain;
        float edge = 1.0 - smoothstep(0.0, 0.006, d); // light catches the cut edge
        vec3 c = uHill[i] * (1.0 + g) + edge * 0.10;
        col = vec4(c, 1.0);
      }
    }
    gl_FragColor = vec4(col.rgb * col.a, col.a);
  }`;

/** Paints the far / mid / near canvases for one palette, then frees the GL context. */
export function paintHills(/** @type {HTMLCanvasElement[]} */ canvases, /** @type {any} */ pal, /** @type {number} */ grain) {
  const ratio = Math.min(devicePixelRatio || 1, 1.5);
  const box = /** @type {HTMLElement} */ (canvases[0].parentElement);
  const w = Math.round(box.clientWidth * ratio), h = Math.round(box.clientHeight * ratio);
  const gl = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas: gl, alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setClearColor(0x000000, 0);
  // Raw sRGB values: the shader writes them straight out, so no linear conversion (new Color('#hex') would convert).
  const col = (/** @type {string} */ s) => new Color(parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255);
  const uniforms = {
    uHill: { value: pal.hills.map(col) },
    uFrom: { value: 0 }, uTo: { value: 1 }, uGrain: { value: grain }, uAspect: { value: w / h }, uTop: { value: 0 },
  };
  const material = new ShaderMaterial({
    uniforms, transparent: true, premultipliedAlpha: true, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }', fragmentShader: frag,
  });
  const scene = new Scene(); scene.add(new Mesh(new PlaneGeometry(2, 2), material));
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  // far = 2 back hills, mid = 2 hills, near = the front hill. Each canvas covers only its band (from `top` down):
  // the compositor draws a canvas as one full quad, so empty sky would still cost fill rate on every frame.
  const passes = [[0, 1, 0.31], [2, 3, 0.47], [4, 4, 0.69]]; // top = the highest hill top minus its shadow
  passes.forEach(([from, to, top], i) => {
    const bh = Math.round(h * (1 - top));
    uniforms.uFrom.value = from; uniforms.uTo.value = to; uniforms.uTop.value = top;
    renderer.setSize(w, bh, false);
    renderer.render(scene, camera);
    const cv = canvases[i]; cv.width = w; cv.height = bh; cv.style.height = `${(1 - top) * 100}%`;
    const ctx = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    ctx.clearRect(0, 0, w, bh); ctx.drawImage(gl, 0, 0);
  });
  material.dispose(); renderer.dispose(); renderer.forceContextLoss();
}
