// @ts-check
// Tidepool caustic light: a three.js ShaderMaterial at 960×540, drawn once when the focus rests and BAKED into the
// sea floor: floor + light become one opaque full-size picture (a WebP blob), the background image of .floor.
// Measured on the VU31: a 600 ms shader burst per key cost 8.7 janky frames per input; any visible full-screen
// canvas is a GPU layer that made every frame of a focus move ~15 ms slower (everything painted above it needs
// layers too); and a separate, scaled light image over the floor made each key's repaint slower. Only
// "Living water" (opt-in) shows a live canvas over the plain floor, redrawn about 20 times a second.
import { WebGLRenderer, Scene, OrthographicCamera, Mesh, PlaneGeometry, ShaderMaterial, Vector2 } from './vendor/three.module.js';

const W = 960, H = 540, STEP = 0.9; // pattern time moved on per focus change

const fragmentShader = `
  precision mediump float;
  uniform float uTime; uniform vec3 uTint; uniform float uStrength; uniform vec2 uRes;
  varying vec2 vUv;
  // Our own caustic pattern: three drifting layers of folded sine interference; bright where the folds meet.
  float caustic(vec2 p, float t) {
    float v = 0.0;
    for (int k = 0; k < 3; k++) {
      float fk = float(k);
      vec2 q = p * (1.5 + fk * 0.75) + vec2(t * (0.11 + fk * 0.05), -t * (0.08 + fk * 0.035));
      q += 0.42 * vec2(sin(q.y * 1.6 + t * 0.9), cos(q.x * 1.25 - t * 0.7));
      float a = abs(sin(q.x) + sin(q.y) + sin((q.x + q.y) * 0.71));
      v += pow(max(0.0, 1.0 - a * 0.62), 7.0);
    }
    return v;
  }
  void main() {
    vec2 uv = vUv;
    // A floor seen from above: the pattern gets smaller towards the back (top), strongest on the floor.
    float depth = mix(2.6, 0.9, uv.y);
    vec2 p = vec2((uv.x - 0.5) * uRes.x / uRes.y * depth, uv.y * 2.2 * depth) * 3.0;
    float c = caustic(p, uTime);
    float floorMask = smoothstep(0.62, 0.05, uv.y) * 0.9 + 0.12;
    float light = c * floorMask * uStrength;
    vec3 col = mix(vec3(0.55, 1.0, 0.95), uTint, 0.65) * light;
    float a = clamp(light, 0.0, 0.85);
    gl_FragColor = vec4(col, a); // premultiplied: col already scales with light
  }`;

export function createWater(/** @type {HTMLElement} */ box, /** @type {HTMLElement} */ floor, /** @type {any} */ opts) {
  const canvas = /** @type {HTMLCanvasElement} */ (box.querySelector('canvas')); // living water only
  const floorImg = new Image(); floorImg.crossOrigin = 'anonymous'; // the frame's origin is opaque: CORS, or toBlob fails
  floorImg.src = 'img/seafloor.webp';
  const pic = document.createElement('canvas'); // floor + light, freed after each bake
  canvas.width = W; canvas.height = H;
  const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
  const gl = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas: gl, alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = { uTime: { value: 7.0 }, uTint: { value: [1, 0.45, 0.38] }, uStrength: { value: 1.0 }, uRes: { value: new Vector2(W, H) } };
  const material = new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, premultipliedAlpha: true,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader,
  });
  scene.add(new Mesh(new PlaneGeometry(2, 2), material));

  let speed = 1, living = false, paused = false, off = false, timer = 0, url = '', seq = 0;
  function setFloor(/** @type {string} */ u) {
    if (url) URL.revokeObjectURL(url);
    url = u;
    floor.style.backgroundImage = u ? `url("${u}")` : ''; // '' = the plain floor from skin.css
  }
  /** Renders the pattern once: into the live canvas, or baked into the floor picture. */
  function draw() {
    if (off) { setFloor(''); return; }
    renderer.render(scene, camera);
    if (living) { ctx.clearRect(0, 0, W, H); ctx.drawImage(gl, 0, 0); return; }
    const r = Math.min(devicePixelRatio || 1, 1.5), w = Math.round(innerWidth * r), h = Math.round(innerHeight * r);
    pic.width = w; pic.height = h;
    const x = /** @type {CanvasRenderingContext2D} */ (pic.getContext('2d'));
    x.fillStyle = '#031B26'; x.fillRect(0, 0, w, h);
    if (floorImg.naturalWidth) { // like CSS `center / cover`
      const s = Math.max(w / floorImg.naturalWidth, h / floorImg.naturalHeight);
      const dw = floorImg.naturalWidth * s, dh = floorImg.naturalHeight * s;
      x.drawImage(floorImg, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    x.drawImage(gl, 0, 0, w, h);
    const n = ++seq;
    pic.toBlob(b => {
      if (b && n === seq && !living && !off) setFloor(URL.createObjectURL(b)); // else a newer picture is on its way
    }, 'image/webp', 0.9); // WebP is encoded off the main thread (PNG in main-thread idle time)
    pic.width = pic.height = 1; // toBlob already has its copy: free the 1920×1080 bitmap
  }
  function tickLiving() {
    timer = 0;
    if (!living || paused) return;
    uniforms.uTime.value += 0.025 * speed; draw();
    timer = window.setTimeout(tickLiving, 50); // ~20 fps is enough for slow water
  }
  function configure(/** @type {any} */ o) {
    speed = o.caustics === 'calm' ? 0.45 : 1;
    uniforms.uStrength.value = o.caustics === 'calm' ? 0.75 : 1.0;
    const was = living, wasOff = off;
    off = o.caustics === 'off';
    living = !!o.living && !off;
    box.classList.toggle('live', living);
    if (living) { setFloor(''); if (!timer) tickLiving(); } // the live canvas lights the plain floor
    if ((was && !living) || off !== wasOff) draw(); // back to the still picture, or caustics turned on or off
  }
  configure(opts);
  if (floorImg.complete) draw(); else floorImg.addEventListener('load', () => draw(), { once: true });
  return {
    configure,
    burst(/** @type {number[]} */ tint) {
      uniforms.uTint.value = tint; uniforms.uTime.value += STEP * speed;
      draw();
    },
    pause(/** @type {boolean} */ p) { paused = p; if (!p && living && !timer) tickLiving(); },
  };
}
