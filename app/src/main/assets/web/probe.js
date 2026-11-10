// WebView capability + performance probe. Targets come from docs/research-webview-launchers.md.
(function () {
  'use strict';

  // Same token wrapper as core/bridge.js (plan revision R16): the shell puts the token into this page's HTML.
  const bridge = (() => {
    const raw = window.AndroidLauncher;
    if (!raw) return {};
    const meta = document.querySelector('meta[name="lx-token"]');
    const token = meta ? meta.content : '';
    const out = {};
    for (const k of ['getDeviceInfo', 'getAppMemory', 'frameStatsStart', 'frameStatsStop', 'keepScreenOn']) {
      if (typeof raw[k] === 'function') out[k] = (...a) => raw[k](token, ...a);
    }
    return out;
  })();
  const hasNativeFrames = typeof bridge.frameStatsStart === 'function';
  // jankPct: deadline-missed frames (davidr44 reported 8.5% of frames > 16.6 ms; we hold missed deadlines to the same bar).
  const TARGETS = { jankPct: 8.5, davidr44SlowPct: 8.5, davidr44MedianMs: 10, totalMemMb: 182, stretchMemMb: 136 };
  const SCENARIO_MS = 6000;
  const WARMUP_MS = 600;

  const results = {
    when: new Date().toISOString(), ua: navigator.userAgent, nativeFrames: hasNativeFrames,
    targets: TARGETS, env: {}, features: {}, media: {}, scenarios: [],
  };

  const $ = id => document.getElementById(id);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const timeout = (p, ms = 4000) => Promise.race([p, sleep(ms).then(() => 'timeout')]);
  const json = s => { try { return JSON.parse(s); } catch (e) { return null; } };
  const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? '—' : Number(n).toFixed(d));

  function status(text) { $('status').textContent = text; }

  function row(tbody, cells, verdict) {
    const tr = document.createElement('tr');
    for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }
    if (verdict !== undefined) {
      const td = document.createElement('td');
      td.textContent = verdict === null ? 'info' : verdict ? 'PASS' : 'MISS';
      td.className = verdict === null ? 'na' : verdict ? 'pass' : 'miss';
      tr.appendChild(td);
    }
    $(tbody).appendChild(tr);
  }
  const yesNo = v => (v === true ? 'yes' : v === false ? 'no' : String(v));

  // ---------------------------------------------------------------- device
  function probeEnv() {
    const e = results.env;
    e.chromium = (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || 'unknown';
    e.screen = `${screen.width}×${screen.height}`;
    e.viewport = `${innerWidth}×${innerHeight} @ dpr ${devicePixelRatio}`;
    e.cores = navigator.hardwareConcurrency;
    e.deviceMemoryGb = navigator.deviceMemory;
    const d = bridge.getDeviceInfo ? json(bridge.getDeviceInfo()) : null;
    if (d) Object.assign(e, { model: d.model, sdk: d.sdk, availMemMb: d.availMemMb, totalMemMb: d.totalMemMb });
    const app = bridge.getAppMemory ? json(bridge.getAppMemory()) : null;
    if (app) e.appMemAtStart = app;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl');
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        e.gpu = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
        e.gpuVendor = gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
        e.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      } else e.gpu = 'no WebGL';
    } catch (err) { e.gpu = 'error: ' + err.message; }

    const show = [['Model', e.model], ['Android SDK', e.sdk], ['Chromium', e.chromium], ['Screen', e.screen],
      ['Viewport', e.viewport], ['CPU cores', e.cores], ['deviceMemory (GB)', e.deviceMemoryGb],
      ['RAM free / total (MB)', d ? `${d.availMemMb} / ${d.totalMemMb}` : '—'],
      ['App PSS at start (MB)', app ? app.appPssMb : '—'],
      ['GPU', `${e.gpuVendor || ''} ${e.gpu || ''}`.trim()], ['Max texture', e.maxTextureSize]];
    for (const [k, v] of show) row('t-env', [k, v == null ? '—' : String(v)]);
  }

  // ---------------------------------------------------------------- features
  async function probeFeatures() {
    const f = results.features;
    const css = {
      'backdrop-filter': 'backdrop-filter: blur(4px)',
      'container queries': 'container-type: inline-size',
      ':has()': 'selector(:has(a))',
      'view-transition-name': 'view-transition-name: a',
      'anchor positioning': 'anchor-name: --a',
      'scroll-driven animations': 'animation-timeline: scroll()',
      'oklch()': 'color: oklch(50% 0.1 200)',
      'subgrid': 'grid-template-columns: subgrid',
      'content-visibility': 'content-visibility: auto',
      'text-wrap: balance': 'text-wrap: balance',
    };
    for (const [name, cond] of Object.entries(css)) {
      f['css ' + name] = CSS.supports(cond.startsWith('selector') ? cond : `(${cond})`);
    }
    try {
      const sheet = new CSSStyleSheet(); sheet.replaceSync('.a { .b { color: red } }');
      f['css nesting'] = !!(sheet.cssRules[0].cssRules && sheet.cssRules[0].cssRules.length === 1);
    } catch (e) { f['css nesting'] = false; }

    const c = document.createElement('canvas');
    const gl2 = c.getContext('webgl2');
    f['WebGL2'] = !!gl2;
    if (gl2) { const l = gl2.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); }
    f['WebGPU adapter'] = navigator.gpu
      ? await timeout(navigator.gpu.requestAdapter().then(a => !!a).catch(() => false), 3000) : false;
    f['View Transitions API'] = 'startViewTransition' in document;
    f['Web Animations'] = 'animate' in Element.prototype;
    f['Popover API'] = 'popover' in HTMLElement.prototype;
    f['OffscreenCanvas'] = typeof OffscreenCanvas !== 'undefined';
    f['WebCodecs VideoDecoder'] = typeof VideoDecoder !== 'undefined';
    f['ImageDecoder'] = typeof ImageDecoder !== 'undefined';
    f['WebAssembly'] = typeof WebAssembly !== 'undefined';
    try {
      f['WASM SIMD'] = WebAssembly.validate(new Uint8Array(
        [0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    } catch (e) { f['WASM SIMD'] = false; }
    f['Web Workers'] = typeof Worker !== 'undefined';
    f['SharedArrayBuffer'] = typeof SharedArrayBuffer !== 'undefined';
    f['IndexedDB'] = 'indexedDB' in window;
    try { localStorage.setItem('_p', '1'); localStorage.removeItem('_p'); f['localStorage'] = true; } catch (e) { f['localStorage'] = false; }
    f['MediaSource'] = typeof MediaSource !== 'undefined';
    f['EME'] = typeof navigator.requestMediaKeySystemAccess === 'function';
    f['Media Session'] = 'mediaSession' in navigator;
    f['Picture-in-Picture'] = 'pictureInPictureEnabled' in document;
    f['Gamepad API'] = 'getGamepads' in navigator;
    f['Speech synthesis'] = 'speechSynthesis' in window;
    f['Speech recognition'] = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
    f['performance.memory'] = !!performance.memory;

    for (const [k, v] of Object.entries(f)) row('t-feat', [k, yesNo(v)]);
  }

  // ---------------------------------------------------------------- media
  async function probeMedia() {
    const m = results.media;
    const hdr = { hdrMetadataType: 'smpteSt2086', colorGamut: 'rec2020', transferFunction: 'pq' };
    const video = [
      ['H.264 1080p30', 'video/mp4; codecs="avc1.640028"', 1920, 1080, 30, 8e6],
      ['H.264 4K30', 'video/mp4; codecs="avc1.640033"', 3840, 2160, 30, 25e6],
      ['HEVC 4K60 Main10', 'video/mp4; codecs="hvc1.2.4.L153.B0"', 3840, 2160, 60, 40e6],
      ['HEVC 4K60 HDR10', 'video/mp4; codecs="hvc1.2.4.L153.B0"', 3840, 2160, 60, 40e6, hdr],
      ['VP9 4K60 Profile 0', 'video/webm; codecs="vp09.00.51.08"', 3840, 2160, 60, 30e6],
      ['VP9 4K60 Profile 2 HDR', 'video/webm; codecs="vp09.02.51.10.01.09.16.09.00"', 3840, 2160, 60, 30e6, hdr],
      ['AV1 1080p60', 'video/mp4; codecs="av01.0.09M.08"', 1920, 1080, 60, 10e6],
      ['AV1 4K60 10-bit', 'video/mp4; codecs="av01.0.13M.10"', 3840, 2160, 60, 30e6],
    ];
    for (const [name, type, width, height, framerate, bitrate, extra] of video) {
      const mse = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type);
      let info = null;
      if (navigator.mediaCapabilities) {
        info = await timeout(navigator.mediaCapabilities.decodingInfo({
          type: 'media-source',
          video: Object.assign({ contentType: type, width, height, framerate, bitrate }, extra || {}),
        }).catch(e => ({ error: e.message })), 3000);
      }
      m[name] = { mse, supported: info && info.supported, smooth: info && info.smooth, powerEfficient: info && info.powerEfficient };
      const r = m[name];
      row('t-media', [name, r.supported ? `yes${r.smooth ? ' · smooth' : ''}${r.powerEfficient ? ' · HW' : ''}` : (mse ? 'MSE only' : 'no')]);
    }
    const audio = [['AAC', 'audio/mp4; codecs="mp4a.40.2"'], ['Opus', 'audio/webm; codecs="opus"'],
      ['AC-3', 'audio/mp4; codecs="ac-3"'], ['E-AC-3 (DD+)', 'audio/mp4; codecs="ec-3"']];
    for (const [name, type] of audio) {
      m[name] = typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported(type);
      row('t-media', [name, yesNo(m[name])]);
    }

    m['HDR display (dynamic-range: high)'] = matchMedia('(dynamic-range: high)').matches;
    m['Wide gamut (color-gamut: p3)'] = matchMedia('(color-gamut: p3)').matches;
    row('t-media', ['HDR display', yesNo(m['HDR display (dynamic-range: high)'])]);
    row('t-media', ['Wide gamut (p3)', yesNo(m['Wide gamut (color-gamut: p3)'])]);

    m['Widevine'] = 'unavailable';
    if (navigator.requestMediaKeySystemAccess) {
      for (const robustness of ['HW_SECURE_ALL', 'HW_SECURE_DECODE', 'SW_SECURE_DECODE', 'SW_SECURE_CRYPTO']) {
        const ok = await timeout(navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
          initDataTypes: ['cenc'],
          videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.640028"', robustness }],
        }]).then(() => true).catch(() => false), 4000);
        if (ok === true) { m['Widevine'] = robustness; break; }
        if (ok === 'timeout') { m['Widevine'] = 'timeout'; break; }
      }
    }
    row('t-media', ['Widevine (best robustness)', m['Widevine']]);
  }

  // ---------------------------------------------------------------- scenarios
  const hue = i => (i * 47) % 360;
  function tiles(n, cls = '') {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const t = document.createElement('div');
      t.className = 'pt ' + cls;
      t.style.background = `linear-gradient(135deg, hsl(${hue(i)} 60% 42%), hsl(${hue(i) + 40} 55% 28%))`;
      t.textContent = 'App ' + (i + 1);
      frag.appendChild(t);
    }
    return frag;
  }
  function grid(n, cls) { const g = document.createElement('div'); g.className = 'pgrid'; g.appendChild(tiles(n, cls)); return g; }

  // Moves a focus class across a 36-tile grid every 150 ms, like holding a D-pad arrow.
  function focusScenario(name, cls, launcherLike) {
    return {
      name, launcherLike,
      setup(stage) {
        const g = grid(36); stage.appendChild(g);
        const items = g.children; let i = 0; items[0].classList.add(cls);
        const id = setInterval(() => { items[i].classList.remove(cls); i = (i + 1) % items.length; items[i].classList.add(cls); }, 150);
        return { teardown: () => clearInterval(id) };
      },
    };
  }

  const SCENARIOS = [
    { name: 'Idle home (static grid)', launcherLike: true, setup(stage) { stage.appendChild(grid(24)); } },
    focusScenario('D-pad focus: shadow transition (v0.1 style)', 'focus-old', false),
    focusScenario('D-pad focus: ring fade (current style)', 'focus', true),
    {
      name: 'Grid scrolling (120 tiles)', launcherLike: true,
      setup(stage) {
        const sc = document.createElement('div'); sc.className = 'pscroll'; sc.appendChild(grid(120)); stage.appendChild(sc);
        return { tick: t => { const max = sc.scrollHeight - sc.clientHeight; const p = (t / 4000) % 2; sc.scrollTop = max * (p < 1 ? p : 2 - p); } };
      },
    },
    {
      name: 'Compositor stress (300 animated tiles)', launcherLike: false,
      setup(stage) { const g = grid(300, 'spin'); g.style.gridTemplateColumns = 'repeat(20, 1fr)'; g.style.gap = '0.5rem'; stage.appendChild(g); },
    },
    {
      name: 'Backdrop blur (6 glass panels)', launcherLike: false,
      setup(stage) {
        const bg = document.createElement('div'); bg.className = 'blurbg'; stage.appendChild(bg);
        for (let i = 0; i < 6; i++) {
          const p = document.createElement('div'); p.className = 'glass';
          p.style.left = `${6 + (i % 3) * 30}rem`; p.style.top = `${8 + Math.floor(i / 3) * 18}rem`; stage.appendChild(p);
        }
        return { tick: t => { bg.style.transform = `translate(${Math.sin(t / 700) * 8}%, ${Math.cos(t / 900) * 8}%)`; } };
      },
    },
    {
      name: 'Animated box-shadows (40 tiles, paint-heavy)', launcherLike: false,
      setup(stage) { stage.appendChild(grid(40, 'glow')); },
    },
    {
      name: 'Canvas 2D (2000 particles)', launcherLike: false,
      setup(stage) {
        const c = document.createElement('canvas'); stage.appendChild(c);
        c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
        const ctx = c.getContext('2d');
        const P = Array.from({ length: 2000 }, () => ({ x: Math.random() * c.width, y: Math.random() * c.height, vx: Math.random() * 4 - 2, vy: Math.random() * 4 - 2, h: Math.random() * 360 }));
        return {
          tick: () => {
            ctx.fillStyle = '#0c1020'; ctx.fillRect(0, 0, c.width, c.height);
            for (const p of P) {
              p.x = (p.x + p.vx + c.width) % c.width; p.y = (p.y + p.vy + c.height) % c.height;
              ctx.fillStyle = `hsl(${p.h} 80% 60%)`; ctx.fillRect(p.x, p.y, 4, 4);
            }
          },
        };
      },
    },
    {
      name: 'WebGL full-screen shader', launcherLike: false,
      setup(stage) {
        const c = document.createElement('canvas'); stage.appendChild(c);
        c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
        const gl = c.getContext('webgl');
        if (!gl) return {};
        const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
        const prog = gl.createProgram();
        gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }'));
        gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `precision mediump float; uniform float t; uniform vec2 r;
          void main(){ vec2 u = gl_FragCoord.xy / r; float v = sin(u.x*10.+t) + sin(u.y*12.+t*1.3) + sin((u.x+u.y)*8.+t*.7);
          gl_FragColor = vec4(.5+.5*sin(v), .5+.5*sin(v+2.), .5+.5*sin(v+4.), 1.); }`));
        gl.linkProgram(prog); gl.useProgram(prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const ut = gl.getUniformLocation(prog, 't'), ur = gl.getUniformLocation(prog, 'r');
        gl.viewport(0, 0, c.width, c.height); gl.uniform2f(ur, c.width, c.height);
        return {
          tick: t => { gl.uniform1f(ut, t / 1000); gl.drawArrays(gl.TRIANGLES, 0, 3); },
          teardown: () => { const l = gl.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); },
        };
      },
    },
  ];

  function measureRaf(ms, tick) {
    return new Promise(resolve => {
      const gaps = []; let last = 0; const start = performance.now();
      function frame(t) {
        if (tick) tick(t);
        if (last) gaps.push(t - last);
        last = t;
        if (t - start < ms) requestAnimationFrame(frame); else resolve(gaps);
      }
      requestAnimationFrame(frame);
    });
  }

  function rafStats(gaps) {
    if (!gaps.length) return {};
    const s = [...gaps].sort((a, b) => a - b);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const vsync = s[Math.floor(s.length / 2)];
    return {
      fps: 1000 / mean, frames: gaps.length,
      medianMs: vsync, p95Ms: s[Math.floor((s.length - 1) * 0.95)],
      // rAF intervals are vsync-quantised: >1.5 vsync means at least one dropped frame.
      droppedPct: gaps.filter(g => g > vsync * 1.5).length * 100 / gaps.length,
    };
  }

  const freeMem = () => { const d = bridge.getDeviceInfo ? json(bridge.getDeviceInfo()) : null; return d ? d.availMemMb : null; };

  async function runScenario(sc) {
    status(`Running: ${sc.name}`);
    const stage = $('stage');
    stage.replaceChildren(); stage.hidden = false;
    const label = document.createElement('div'); label.className = 'label'; label.textContent = sc.name; stage.appendChild(label);
    const ctl = sc.setup(stage) || {};
    await measureRaf(WARMUP_MS, ctl.tick);
    const memBefore = freeMem();
    if (hasNativeFrames) bridge.frameStatsStart();
    const raf = rafStats(await measureRaf(SCENARIO_MS, ctl.tick));
    const nat = hasNativeFrames ? json(bridge.frameStatsStop()) : null;
    const memAfter = freeMem();
    const app = bridge.getAppMemory ? json(bridge.getAppMemory()) : null;
    if (ctl.teardown) ctl.teardown();
    stage.replaceChildren(); stage.hidden = true;

    const useNative = !!(nat && nat.frames);
    const src = useNative ? nat : { frames: raf.frames, medianMs: raf.medianMs, p95Ms: raf.p95Ms, slowPct: raf.droppedPct };
    // Primary metric: deadline-based jank (native, Android 12+); else frames over 16.6 ms; else rAF drops.
    const jank = useNative && nat.jankPct != null ? nat.jankPct : src.slowPct;
    const pass = sc.launcherLike ? jank < TARGETS.jankPct : null;
    const r = { name: sc.name, launcherLike: sc.launcherLike, native: nat, raf, jankPct: jank, freeMemBeforeMb: memBefore, freeMemAfterMb: memAfter, app, pass };
    results.scenarios.push(r);
    row('t-scen', [sc.name, String(src.frames), fmt(src.medianMs) + ' ms', fmt(src.p95Ms) + ' ms',
      fmt(jank) + ' %', fmt(src.slowPct) + ' %', useNative && nat.gpuMedianMs != null ? fmt(nat.gpuMedianMs) + ' ms' : '—',
      fmt(raf.fps, 0), memBefore != null ? `${memAfter - memBefore} MB` : '—'], pass);
    await sleep(300);
  }

  // ---------------------------------------------------------------- output
  function emit() {
    const s = JSON.stringify(results);
    const size = 3000, n = Math.ceil(s.length / size);
    for (let i = 0; i < n; i++) console.log(`PROBE_RESULT ${i + 1}/${n} ${s.slice(i * size, (i + 1) * size)}`);
    console.log('PROBE_DONE');
  }

  async function run() {
    if (bridge.keepScreenOn) bridge.keepScreenOn(true);
    try {
      status('Device info…'); probeEnv();
      status('Web features…'); await probeFeatures();
      status('Media & DRM…'); await probeMedia();
      for (const sc of SCENARIOS) await runScenario(sc);
      const launcher = results.scenarios.filter(s => s.launcherLike);
      const ok = launcher.every(s => s.pass);
      results.verdict = ok ? 'PASS' : 'MISS';
      const v = $('verdict');
      v.textContent = `Launcher scenarios: ${launcher.filter(s => s.pass).length}/${launcher.length} meet target`;
      v.className = 'verdict ' + (ok ? 'pass' : 'miss');
      status(`Done · ${hasNativeFrames ? 'native FrameMetrics' : 'rAF only (desktop/mock: not comparable to TV)'} · target: <${TARGETS.jankPct}% janky frames in launcher scenarios`);
    } catch (e) {
      results.error = String(e && e.stack || e);
      status('Probe error: ' + e.message);
    }
    if (bridge.keepScreenOn) bridge.keepScreenOn(false);
    emit();
  }

  // ---------------------------------------------------------------- keys / shell hooks
  const back = () => { location.href = 'index.html'; };
  window.launcher = { onBack: back, onHome: back, onMenu() {}, onResume() {}, onAppsChanged() {}, toast() {} };
  document.addEventListener('keydown', e => {
    const sc = $('results');
    if (e.key === 'ArrowDown') { sc.scrollTop += innerHeight * 0.25; e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sc.scrollTop -= innerHeight * 0.25; e.preventDefault(); }
    else if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); back(); }
  });

  setTimeout(run, 800);
})();
