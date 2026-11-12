// Skin bench (plan step M1.6): the scripted tour, hard gates, score and tier.
//   TV (authoritative): over ADB with `--es bench <skin>` (reference apps, in-memory settings) and `--es frameStats`.
//   Desktop (estimate): the same tour in headless Chrome for Testing, scored on render cost from a trace.
// The score is relative to the pinned reference skin `default` (plan revision R3), measured in the same session.
import { PKG } from './adb.mjs';

export const REFERENCE_SKIN = 'default';
export const BENCH_APPS = 50;
export const IDLE_SECONDS = 30;
/**
 * Rest after the tour before the idle window starts (plan revision R28, decision D24 b). A skin may move for up to
 * LIVE_SECONDS after a key (fish, fire, falling rain), then it must rest; the idle gate measures the rest.
 */
export const LIVE_SECONDS = 20;
export const IDLE_SETTLE_SECONDS = LIVE_SECONDS + 5;

/**
 * Hard gates (plan: Budget). `tv` = only measurable on the TV.
 * `relative`: the limit is that factor × the reference skin measured in the same session (R15), for metrics whose
 * absolute value drifts with the TV's state (default's cold start ranged 1407–1919 ms in one day).
 */
export const RELATIVE_LIMIT = 1.15;
/**
 * `smooth`: a smoothness gate (plan revision R27, decision D19 b). A skin that fails only these gets the tier
 * "Heavy": it can stutter on a slow TV, and the launcher uses it only when "Allow heavy skins" is on. The other
 * gates (idle frames, memory, cold start) protect the TV and stay hard: a skin that fails one has no tier.
 */
export const HEAVY_TIER = 'Heavy';
export const GATES = [
  // Per input, not per frame (R14): one slow first frame per key is built into the VU31's WebView, and a share of
  // frames would punish skins that draw fewer frames (a skin without transitions measured 68–89%).
  { metric: 'jankPerInput', label: 'Janky frames/input', limit: 1.5, unit: '', inclusive: true, smooth: true },
  // Rank-matched (R16): see p95Rank below.
  { metric: 'p95Ms', label: 'p95 frame', relative: RELATIVE_LIMIT, unit: 'ms', inclusive: true, smooth: true },
  { metric: 'keyP95Ms', label: 'Key latency p95', limit: 50, unit: 'ms', smooth: true },
  { metric: 'idleFps', label: 'Frames while idle', limit: 1, unit: '/s', inclusive: true, tv: true },
  { metric: 'pssMb', label: 'Total PSS', limit: 182, unit: 'MB', tv: true },
  { metric: 'firstFrameMs', label: 'First frame (cold)', relative: RELATIVE_LIMIT, unit: 'ms', inclusive: true, tv: true },
];
/**
 * Metrics in the score, with an offset added on both sides (jank: +0.5, so a 0 reference doesn't divide by zero).
 * The desktop can't see the TV's frame times (vsync-bound), memory or startup, and its key latency is dominated by
 * software raster in the headless GPU process (random ~200 ms stalls). So its estimate scores `renderMs` only:
 * main-frame (style, layout, paint) + compositor draw + raster time over the tour, from a Chrome trace.
 */
export const SCORED = { jankPerInput: 0.5, p95Ms: 0, keyP95Ms: 0, pssMb: 0, firstFrameMs: 0 };
export const SCORED_ESTIMATE = { renderMs: 0 };
export const TIERS = [{ name: 'Lite', min: 85 }, { name: 'Standard', min: 60 }, { name: 'Rich', min: 0 }];

/**
 * The tour (plan: 20 focus moves, 6 row changes, menu open/close, Home), as D-pad steps.
 * Each step: [key, count]. 'home' is the launcher's Home (Home pressed while on top).
 */
export const TOUR = [['right', 10], ['left', 10], ['down', 3], ['up', 3], ['menu', 1], ['back', 1], ['home', 1]];
const STEP_MS = 250;

// ---------------------------------------------------------------- pure helpers (unit-tested)
/**
 * Janky frames per input from per-frame rows [atMs, totalMs, deadlineMs, …]: frames less than 100 ms apart are one
 * burst, i.e. the response to one key press. Keys that change nothing (at a row's end) draw no frames and don't count.
 */
export function jankPerInput(rows) {
  if (!rows?.length) return null;
  let bursts = 0, janky = 0, last = -Infinity;
  for (const [at, total, deadline] of rows) {
    if (at - last > 100) bursts++;
    last = at;
    if (deadline > 0 && total > deadline) janky++;
  }
  return Math.round((janky / bursts) * 100) / 100;
}

export function percentile(values, p) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * p)];
}

/** The k-th slowest frame (k from 1). A skin that drew fewer than k frames: the missing frames cost 0 ms. */
export function kthSlowest(frameMs, k) {
  return [...frameMs].sort((a, b) => b - a)[k - 1] ?? 0;
}

/**
 * Rank-matched p95 frame (plan revision R16, decision D17): both skins are judged by their k-th slowest frame, where
 * k = 5% of the frames the reference drew. A plain p95 of the skin's own frames punished skins that draw few frames
 * (Phosphor: 51 frames vs 146, so its p95 was one of the default skin's slowest few). Null without frame lists.
 */
export function p95Rank(refRuns) {
  const n = median(refRuns.map(r => r.frameMs?.length).filter(Boolean));
  return n ? Math.max(1, Math.ceil(n * 0.05)) : null;
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median of each metric over runs (plan revision R11: one disturbed run must not move the result). */
export function medianMetrics(runs) {
  const out = {};
  for (const k of new Set(runs.flatMap(r => Object.keys(r)))) {
    const xs = runs.map(r => r[k]).filter(v => typeof v === 'number');
    out[k] = xs.length ? round(median(xs), 2) : null;
  }
  return out;
}

/** Gates on the TV; for a desktop estimate they are advisory only (`ok` null). `reference`: for relative limits. */
export function checkGates(metrics, { estimate = false, reference = {} } = {}) {
  return GATES.map(g => {
    const value = metrics[g.metric];
    const base = reference[g.metric];
    const limit = g.relative ? (typeof base === 'number' ? Math.round(base * g.relative * 10) / 10 : null) : g.limit;
    const skipped = value == null || limit == null || estimate;
    const ok = skipped ? null : (g.inclusive ? value <= limit : value < limit);
    return { ...g, limit, value: value ?? null, ok };
  });
}

/** 100 × geometric mean of reference/skin per scored metric, each capped at 1. */
export function score(skin, ref, { estimate = false } = {}) {
  const ratios = [];
  for (const [k, offset] of Object.entries(estimate ? SCORED_ESTIMATE : SCORED)) {
    const a = ref[k], b = skin[k];
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (b + offset <= 0) { ratios.push(1); continue; }
    ratios.push(Math.min(1, (a + offset) / (b + offset)));
  }
  if (!ratios.length) return null;
  return Math.round(100 * Math.exp(mean(ratios.map(Math.log))));
}

/** `hardOk` (default: same as gatesOk): no gate other than the smoothness ones failed. */
export function tierFor(points, gatesOk, hardOk = gatesOk) {
  if (!hardOk || points == null) return null;
  if (!gatesOk) return HEAVY_TIER;
  return TIERS.find(t => points >= t.min).name;
}

/** Bench summary from the per-run metrics of the skin and the reference skin. */
export function summarize({ skinRuns, refRuns, estimate }) {
  const k = p95Rank(refRuns);
  const ranked = runs => runs.map(({ frameMs, ...r }) => (k && Array.isArray(frameMs) ? { ...r, p95OwnMs: r.p95Ms, p95Ms: kthSlowest(frameMs, k) } : r));
  const skin = medianMetrics(ranked(skinRuns));
  const reference = medianMetrics(ranked(refRuns));
  const gates = checkGates(skin, { estimate, reference });
  const gatesOk = gates.every(g => g.ok !== false);
  const hardOk = gates.every(g => g.ok !== false || g.smooth);
  const points = score(skin, reference, { estimate });
  return { skin, reference, gates, gatesOk, hardOk, score: points, tier: tierFor(points, gatesOk, hardOk), p95Rank: k };
}

/**
 * A saved `lx bench --json` result, scored again with today's gates and tiers (`lx pack --from`). The runs stay as
 * measured; only the verdict follows the current rules. Throws when the file has no runs.
 */
export function rescore(saved) {
  const d = saved && saved.runsDetail;
  if (!d || !Array.isArray(d.skin) || !Array.isArray(d.reference) || !d.skin.length || !d.reference.length) {
    throw new Error('not an `lx bench --json` result: runsDetail.skin and runsDetail.reference are missing');
  }
  return { ...saved, notes: [...(saved.notes || [])], ...summarize({ skinRuns: d.skin, refRuns: d.reference, estimate: !!saved.estimate }) };
}

// ---------------------------------------------------------------- TV (ADB)
const KEYCODE = { right: 22, left: 21, down: 20, up: 19, menu: 82, back: 4 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const START = `am start -n ${PKG}/.MainActivity`;

function tourScript() {
  const sec = (STEP_MS / 1000).toFixed(2);
  return TOUR.map(([key, n]) => (key === 'home'
    ? `${START} >/dev/null 2>&1; sleep 1`
    : `for i in $(seq 1 ${n}); do input keyevent ${KEYCODE[key]}; sleep ${sec}; done`)).join('; ');
}

const logLine = (log, tag) => {
  const lines = log.split('\n').filter(l => l.includes(tag + ' '));
  if (!lines.length) return null;
  const last = lines[lines.length - 1];
  return last.slice(last.indexOf(tag + ' ') + tag.length + 1).trim();
};

async function waitLog(tv, tag, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    const v = logLine(tv.run(['logcat', '-d', '-s', 'WebLauncher:I']), tag);
    if (v) return v;
  }
  return null;
}

/** App process + its WebView renderer(s), from `dumpsys meminfo` (Total PSS by process), in MB. */
function pssMb(tv) {
  const out = tv.shell('dumpsys meminfo');
  const start = out.indexOf('Total PSS by process'), end = out.indexOf('Total PSS by OOM');
  const block = out.slice(start, end > start ? end : undefined);
  let kb = 0;
  for (const m of block.matchAll(/([\d,]+)K: (\S+) \(pid/g)) {
    if (m[2] === PKG || m[2].includes('sandboxed_process')) kb += Number(m[1].replace(/,/g, ''));
  }
  return kb / 1024;
}

export function tvInfo(tv) {
  const prop = p => tv.shell(`getprop ${p}`).trim();
  const pkg = tv.shell(`dumpsys package ${PKG}`);
  const wv = tv.shell('dumpsys webviewupdate');
  return {
    model: prop('ro.product.model'), android: prop('ro.build.version.release'),
    webView: (wv.match(/Current WebView package \(name, version\): \(([^,]+), ([^)]+)\)/) || [])[2] || null,
    appVersion: (pkg.match(/versionName=(\S+)/) || [])[1] || null,
    debuggable: /flags=\[[^\]]*DEBUGGABLE/.test(pkg),
  };
}

/** One bench run of `id` on the TV: cold start, tour, idle, PSS. Returns metrics. */
export async function tvRun(tv, id, { log = () => {}, detail = false } = {}) {
  tv.shell('input keyevent KEYCODE_WAKEUP'); // the screensaver stops rAF
  tv.shell(`am force-stop ${PKG}`);
  await sleep(800);
  tv.run(['logcat', '-c']);
  tv.shell(`${START} --es bench ${id}`);
  const startup = await waitLog(tv, 'STARTUP', 20000);
  if (!startup) throw new Error(`${id}: no STARTUP log within 20 s (is the TV awake and the launcher installed?)`);
  const s = JSON.parse(startup);
  if (s.skin !== id) throw new Error(`${id}: the launcher loaded "${s.skin}" instead (missing on the TV, or failed to load; try lx push)`);
  if (s.apps !== BENCH_APPS) throw new Error(`${id}: ${s.apps} apps instead of ${BENCH_APPS} (launcher build without the bench extra?)`);
  await sleep(3000); // images decode, entrance animations end

  tv.run(['logcat', '-c']);
  tv.shell(`${START} --es frameStats start`);
  const tourStart = Date.now();
  tv.shell(tourScript());
  await sleep(800);
  tv.shell(`${START} --es frameStats stopDetail`);
  const tour = JSON.parse(await waitLog(tv, 'FRAME_STATS', 5000) || '{}');
  // Every tour frame (FrameStats.stop with detail), written to a file because it is too long for logcat.
  const frameRows = JSON.parse(tv.shell(`cat /sdcard/Android/data/${PKG}/files/frames.json`) || '{}').frameRows || [];
  const keys = JSON.parse(await waitLog(tv, 'BENCH_KEYS', 3000) || '[]');
  const perInput = jankPerInput(frameRows);
  log(`    tour: ${tour.frames} frames, ${perInput} janky per input (${round(tour.jankPct)}%), ${keys.length} keys`);

  await sleep(IDLE_SETTLE_SECONDS * 1000); // motion after the last key ends first (R28)
  tv.run(['logcat', '-c']);
  tv.shell(`${START} --es frameStats start`);
  await sleep(IDLE_SECONDS * 1000);
  tv.shell(`${START} --es frameStats stop`);
  const idle = JSON.parse(await waitLog(tv, 'FRAME_STATS', 5000) || '{}');

  return {
    frameMs: frameRows.map(r => r[1]), // for the rank-matched p95 (R16)
    jankPerInput: perInput, jankPct: tour.jankPct ?? null, p95Ms: tour.p95Ms ?? null, p99Ms: tour.p99Ms ?? null, frames: tour.frames ?? 0,
    keyP95Ms: percentile(keys, 0.95), idleFps: round((idle.frames ?? 0) / IDLE_SECONDS, 2),
    pssMb: round(pssMb(tv)), firstFrameMs: s.processToFirstFrameMs ?? null,
    ...(detail ? { frameRows, tourMs: Date.now() - tourStart } : {}),
  };
}

/**
 * The bench force-stops the launcher, and Android then turns its accessibility service (HomeWatchService) off. Only
 * the user may turn it on again. Returns a warning with the command that restores today's list, or null.
 */
export function homeWatchWarning(tv) {
  const list = tv.shell('settings get secure enabled_accessibility_services').trim();
  if (!list.split(':').some(s => s.startsWith(`${PKG}/`))) return null;
  return 'Web Launcher home (accessibility) is on. This bench force-stops the launcher, and Android then turns the '
    + 'service off. Turn it on again afterwards (TV Settings → Accessibility), or run:\n'
    + `  adb shell settings put secure enabled_accessibility_services ${list}`;
}

/** Leaves the TV on the normal launcher (a new process: reference mode off). */
export function tvRestore(tv) {
  tv.shell(`am force-stop ${PKG}`);
  tv.shell(START);
}

// ---------------------------------------------------------------- desktop (estimate)
const KEY = { right: 'ArrowRight', left: 'ArrowLeft', down: 'ArrowDown', up: 'ArrowUp', menu: 'ContextMenu', back: 'Escape' };

/** One desktop run: load, then the tour under a Chrome trace; returns the render cost. `page` is a Playwright page. */
export async function desktopRun(page, url, id) {
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready', null, { timeout: 20000 });
  const loaded = await page.evaluate(() => document.documentElement.dataset.skin);
  if (loaded !== id) throw new Error(`${id}: the launcher fell back to "${loaded}"`);
  await page.waitForTimeout(2000); // images decode, entrance animations end
  const cdp = await page.context().newCDPSession(page);
  const trace = [];
  cdp.on('Tracing.dataCollected', d => { for (const e of d.value) if (e.ph === 'X' && e.dur && RENDER_EVENTS.has(e.name)) trace.push(e.dur); });
  await cdp.send('Tracing.start', { transferMode: 'ReportEvents', categories: TRACE_CATEGORIES });
  for (const [key, n] of TOUR) {
    for (let i = 0; i < n; i++) {
      if (key === 'home') await page.evaluate(() => window.launcher.onHome());
      else await page.keyboard.press(KEY[key]);
      await page.waitForTimeout(STEP_MS);
    }
  }
  const traced = new Promise(r => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.end');
  await traced;
  await cdp.detach();
  return { renderMs: round(trace.reduce((a, b) => a + b, 0) / 1000) };
}

// Style/layout/paint on the main thread, compositor draw (where shadows, filters and blends cost), and raster.
// Measured with a paint-heavy test skin: DrawAndSwap ~160 ms vs ~15 ms for the default skin, stable across runs.
const RENDER_EVENTS = new Set(['ProxyMain::BeginMainFrame', 'Display::DrawAndSwap', 'RasterDecoderImpl::DoRasterCHROMIUM']);
const TRACE_CATEGORIES = 'devtools.timeline,cc,gpu,viz';
