#!/usr/bin/env node
// lx — skin author tool for the Web TV Launcher (skin API v1, levels 0–3).
//   lx new  <dir> [--level 0|1|2|3] [--name "My skin"] scaffold a skin
//   lx dev  <dir> [--port 5180] [--apps 50] [--open]    preview with live reload
//   lx dev  <dir> --tv [host:port] | --lan host:port --pin N   live reload on the TV (installs on every save)
//   lx lint <dir> [--apps 50] [--json] [--shot file.png] static + rendered checks (Chrome for Testing)
//   lx bench <dir> [--tv [host:port]] [--runs 3] [--json]   frame/memory budget, score, tier
//   lx pack <dir> [--tv [host:port] | --from bench.json] [--out file.lxskin]  lint, bench, write score.json, zip
//   lx push <dir> [--tv host:port] [--open]              copy to the TV's dev skins folder (ADB)
//   lx install <dir|file.lxskin> [--tv host:port | --lan host:port --pin N] [--open]   install it (any build)
//   lx settings export [file] | import <file> [--tv host:port]   launcher settings (favourites, hidden, skin, options)
//   lx gallery build <out> <skin>... | serve <dir> [--tv] | set <url>   skin gallery (gallery.json, M4)
import { parseArgs } from 'node:util';
import { readFile, writeFile, readdir, stat, mkdir, copyFile, unlink } from 'node:fs/promises';
import { existsSync, watch } from 'node:fs';
import { join, resolve, basename, relative, sep } from 'node:path';
import { startServer, BUNDLED_SKINS, SKIN_ID } from './lib/server.mjs';
import { openPage } from './lib/browser.mjs';
import { zip, unzipEntry } from './lib/zip.mjs';
import { createHash } from 'node:crypto';
import { device, DEV_SKINS, PKG } from './lib/adb.mjs';
import * as bench from './lib/bench.mjs';
import { lintPackage, lintEntry, domStats, judgeDom, merge, LINT_VERSION, BUDGET } from '../app/src/main/assets/web/core/lint.js';
import { API_VERSION } from '../app/src/main/assets/web/core/validate.js';

const TOOL_VERSION = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const REFERENCE_APPS = 50;
const IMAGE = /\.(webp|avif|png|jpe?g|svg)$/i;

// `--tv` may come without an address ($TV or the only ADB device); parseArgs needs a value, so give it ''.
const argv = process.argv.slice(2).flatMap((a, i, all) => (a === '--tv' && (!all[i + 1] || all[i + 1].startsWith('-')) ? [a, ''] : [a]));
const { positionals, values: opt } = parseArgs({
  args: argv,
  allowPositionals: true,
  options: {
    level: { type: 'string', default: '1' }, name: { type: 'string' }, port: { type: 'string', default: '5180' },
    apps: { type: 'string', default: String(REFERENCE_APPS) }, open: { type: 'boolean' }, json: { type: 'boolean' },
    shot: { type: 'string' }, out: { type: 'string' }, tv: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    runs: { type: 'string', default: '3' }, from: { type: 'string' }, lan: { type: 'string' }, pin: { type: 'string' },
  },
});
const [cmd, dirArg] = positionals;
const tvFlag = opt.tv !== undefined;

function usage(code = 0) {
  console.log(`lx ${TOOL_VERSION} — skin author tool (skin API v${API_VERSION})
  lx new  <dir> [--level 0|1|2|3] [--name "My skin"]
  lx dev  <dir> [--port 5180] [--apps ${REFERENCE_APPS}] [--open]
  lx dev  <dir> --tv [host:port] | --lan host:port --pin 123456   live reload on the TV
  lx lint <dir> [--apps ${REFERENCE_APPS}] [--json] [--shot file.png]
  lx bench <dir> [--tv [host:port]] [--runs 3] [--json]
  lx pack <dir> [--tv [host:port] | --from bench.json] [--out file.lxskin]   --from: a saved lx bench --json result
  lx push <dir> [--tv host:port] [--open]
  lx install <dir|file.lxskin> [--tv host:port] [--open]      through the TV's ADB inbox
  lx install <dir|file.lxskin> --lan host:port --pin 123456    through the TV's Install skin page
  lx settings export [file] | import <file> [--tv host:port]   favourites, hidden apps, skin, options
  lx gallery build <out-dir> <skin-dir|file.lxskin>... [--name "My gallery"]   packages, previews, gallery.json
  lx gallery serve <dir> [--port 7191] [--tv]   serve it on 127.0.0.1 (the TV through adb reverse, debug builds)
  lx gallery set <https-url> [--tv host:port]   set the TV's skin gallery (no URL: remove it)
  TV: --tv, $TV or the only ADB device. Without --tv, bench is a desktop estimate.
Docs: docs/skin-api.md`);
  process.exit(code);
}

// ---------------------------------------------------------------- helpers
/** Authoring files that never go into a package: type declarations and editor config. */
const DEV_ONLY = /(\.d\.ts|^jsconfig\.json|^tsconfig\.json)$/;

async function listFiles(dir) {
  const out = [];
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || DEV_ONLY.test(e.name)) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else out.push({ path: relative(dir, p).split(sep).join('/'), size: (await stat(p)).size });
    }
  }
  await walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function skinDir(arg) {
  if (!arg) usage(1);
  const dir = resolve(arg);
  if (!existsSync(join(dir, 'manifest.json'))) { console.error(`${arg}: no manifest.json (create one with: lx new ${arg})`); process.exit(1); }
  return dir;
}

const kb = n => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : (n / 1024).toFixed(1) + ' KB');

function sumStats(list) {
  const out = {};
  for (const s of list) for (const [k, v] of Object.entries(s)) out[k] = (out[k] || 0) + v;
  return out;
}

// ---------------------------------------------------------------- lint
async function runLint(dir, { apps = REFERENCE_APPS, shot } = {}) {
  const id = basename(dir);
  const files = await listFiles(dir);
  let manifest;
  try { manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')); }
  catch (e) { return merge(['package', { errors: [{ rule: 'manifest', message: 'manifest.json is not valid JSON: ' + e.message }], warnings: [], stats: {} }]); }

  const pkg = lintPackage(manifest, files);
  const parts = [['package', pkg]];
  const level3 = manifest.level === 3;
  if (level3 && files.some(f => f.path === (manifest.entry || 'skin.html'))) {
    const entry = manifest.entry || 'skin.html';
    parts.push(['entry', lintEntry(await readFile(join(dir, entry), 'utf8'), entry)]);
  }
  if (manifest.id !== id) pkg.errors.push({ rule: 'manifest', message: `id "${manifest.id}" must match the folder name "${id}"` });
  const bundledHere = resolve(BUNDLED_SKINS, id) === dir;
  if (!bundledHere && existsSync(join(BUNDLED_SKINS, id))) pkg.errors.push({ rule: 'reserved-id', message: `"${id}" is a bundled skin id; pick another` });
  if (pkg.errors.some(e => ['manifest', 'reserved-id'].includes(e.rule))) return merge(...parts);

  // Rendered checks: the real core page, the mock bridge and reference data, in headless Chrome for Testing.
  const srv = await startServer({ skins: bundledHere ? [] : [{ dir }] });
  const { browser, page } = await openPage();
  const load = { errors: [], warnings: [], stats: {} };
  page.on('console', m => {
    const t = m.text();
    if (/Content Security Policy/.test(t)) load.errors.push({ rule: 'external-load', message: t.replace(/\s+/g, ' ').slice(0, 200) });
    else if (t.startsWith('SKIN_FAILED')) load.errors.push({ rule: 'load', message: t.slice(12) });
  });
  try {
    await page.goto(`${srv.url}/?skin=${id}&apps=${apps}`);
    await page.waitForFunction(() => document.documentElement.dataset.state === 'ready' || /failed/.test(document.body.textContent), null, { timeout: 15000 });
    await page.waitForTimeout(1500); // let entrance animations finish before measuring "at rest"
    const loaded = await page.evaluate(() => document.documentElement.dataset.skin);
    if (loaded !== id) {
      if (!load.errors.length) load.errors.push({ rule: 'load', message: `the launcher fell back to "${loaded}"` });
    } else {
      // Level 3 links its CSS from its page, so every .css file is checked; its DOM lives in the skin frame.
      const styles = level3 ? files.map(f => f.path).filter(p => p.endsWith('.css')) : manifest.styles || [];
      const images = files.map(f => f.path).filter(p => IMAGE.test(p));
      const res = await page.evaluate(async ({ id, styles, images, level3 }) => {
        const L = await import('/core/lint.js');
        const base = new URL(`/skins/${id}/`, location.href).href;
        const css = [];
        for (const p of styles) css.push(L.lintCss(await (await fetch(base + p)).text(), base, p));
        const img = await L.lintImages(images.map(path => ({ path, url: base + path })));
        return { css, img, dom: level3 ? null : L.lintDom(document) };
      }, { id, styles, images, level3 });
      if (level3) {
        const frame = page.frames().find(f => f.url().includes('/__skin/'));
        res.dom = frame ? judgeDom(await frame.evaluate(domStats)) : { errors: [{ rule: 'load', message: 'no skin frame' }], warnings: [], stats: {} };
      }
      parts.push(['css', { errors: res.css.flatMap(c => c.errors), warnings: res.css.flatMap(c => c.warnings), stats: sumStats(res.css.map(c => c.stats)) }]);
      parts.push(['images', res.img], ['dom', res.dom]);
    }
    if (shot) await page.screenshot({ path: shot });
  } finally {
    await browser.close();
    await srv.close();
  }
  parts.push(['load', load]);
  const result = merge(...parts);
  result.skin = { id, name: manifest.name, version: manifest.version, level: manifest.level };
  return result;
}

function printLint(dir, r) {
  const s = r.skin || {};
  console.log(`\nlx lint ${relative(process.cwd(), dir) || '.'}  ${s.name ? `(${s.name}, level ${s.level})` : ''}`);
  for (const e of r.errors) console.log(`  ✖ ${e.rule.padEnd(18)} ${e.message}${e.where ? `  [${e.where}]` : ''}`);
  for (const w of r.warnings) console.log(`  ⚠ ${w.rule.padEnd(18)} ${w.message}${w.where ? `  [${w.where}]` : ''}`);
  const p = r.stats.package || {}, d = r.stats.dom, i = r.stats.images;
  const bits = [`${p.files ?? '?'} files, ${kb(p.bytes || 0)}`, `CSS ${kb(p.cssBytes || 0)}`];
  if (i) bits.push(`images ${i.images} (${kb(i.decodedBytes)} decoded)`);
  if (d) bits.push(`DOM ${d.domNodes}/${BUDGET.domNodes}`, `will-change ${d.willChangeElements}/${BUDGET.willChangeElements}`, `animations at rest ${d.runningAnimations}`);
  console.log(`  ${bits.join(' · ')}`);
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'} (${r.errors.length} errors, ${r.warnings.length} warnings)\n`);
}

// ---------------------------------------------------------------- commands
async function cmdNew(arg) {
  if (!arg) usage(1);
  const dir = resolve(arg), id = basename(dir);
  if (!SKIN_ID.test(id)) { console.error(`folder name "${id}" must be a skin id: lowercase letters, digits and "-"`); process.exit(1); }
  if (existsSync(join(dir, 'manifest.json'))) { console.error(`${arg} already has a manifest.json`); process.exit(1); }
  const level = Number(opt.level);
  if (![0, 1, 2, 3].includes(level)) { console.error('--level must be 0, 1, 2 or 3'); process.exit(1); }
  await mkdir(dir, { recursive: true });
  const manifest = {
    id, name: opt.name || id, version: '0.1.0', apiVersion: API_VERSION, level, author: '',
    description: '',
    tokens: { accent: '#f2a93b', radius: '0.7rem' },
  };
  if (level === 3) {
    // The level 3 starter is the test skin that copies the default look (tools/test/fixtures/l3-basic).
    delete manifest.tokens;
    manifest.entry = 'skin.html';
    manifest.options = [{ id: 'clockDate', type: 'toggle', label: 'Show date', default: true }];
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    for (const f of ['skin.html', 'skin.css']) await copyFile(new URL(`./test/fixtures/l3-basic/${f}`, import.meta.url), join(dir, f));
    // Editor help without a build step: JSDoc type checking against the SDK types (tools/types/lx.d.ts).
    const js = await readFile(new URL('./test/fixtures/l3-basic/skin.js', import.meta.url), 'utf8');
    await writeFile(join(dir, 'skin.js'), `// @ts-check\n/// <reference path="./lx.d.ts" />\n${js}`);
    await copyFile(new URL('./types/lx.d.ts', import.meta.url), join(dir, 'lx.d.ts'));
    console.log(`Created level 3 skin "${id}" in ${arg} (with lx.d.ts types for your editor)\nNext: lx dev ${arg} --open`);
    return;
  }
  if (level >= 1) manifest.styles = ['skin.css'];
  if (level >= 2) manifest.layout = 'layout.json';
  if (level >= 1) manifest.options = [{ id: 'compact', type: 'toggle', label: 'Compact tiles', default: false }];
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (level >= 1) {
    await writeFile(join(dir, 'skin.css'), `/* ${manifest.name}: rules here land in @layer skin and override the core look.
   Hooks: lx-* elements, [focused], [moving], [fav], [kind="banner|icon"], html[data-opt-*], --lx-* tokens.
   Budget: animate only transform and opacity; no backdrop-filter, no animated box-shadow/filter (docs/skin-api.md). */

lx-tile { border-radius: 1rem; }
lx-tile[focused] { transform: scale(1.1); }
html[data-opt-compact="on"] { --lx-tile-width: 16rem; --lx-grid-columns: 8; }
`);
  }
  if (level >= 2) await copyFile(join(BUNDLED_SKINS, 'default', 'layout.json'), join(dir, 'layout.json'));
  console.log(`Created level ${level} skin "${id}" in ${arg}\nNext: lx dev ${arg} --open`);
}

async function cmdDev(arg) {
  if (tvFlag || opt.lan) return devOnTv(skinDir(arg));
  const dir = skinDir(arg), id = basename(dir);
  const bundledHere = resolve(BUNDLED_SKINS, id) === dir;
  const srv = await startServer({ port: Number(opt.port), skins: bundledHere ? [] : [{ dir }], liveReload: true });
  const url = `${srv.url}/?skin=${id}&apps=${opt.apps}`;
  const check = async () => {
    try {
      const r = lintPackage(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')), await listFiles(dir));
      const msg = r.errors.map(e => `  ✖ ${e.rule}: ${e.message}${e.where ? ` [${e.where}]` : ''}`).join('\n');
      console.log(`[${new Date().toLocaleTimeString()}] reload${r.errors.length ? '\n' + msg : ' (package ok; run lx lint for the full check)'}`);
    } catch (e) { console.log(`[${new Date().toLocaleTimeString()}] reload  ✖ ${e.message}`); }
  };
  let timer;
  watch(dir, { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(() => { check(); srv.reload(); }, 150); });
  console.log(`lx dev: ${url}\nWatching ${arg}; the page reloads on save. Ctrl+C to stop.`);
  await check();
  if (opt.open) {
    const { page } = await openPage({ headless: false });
    await page.goto(url);
  }
}

async function cmdLint(arg) {
  const dir = skinDir(arg);
  const r = await runLint(dir, { apps: Number(opt.apps), shot: opt.shot });
  if (opt.json) console.log(JSON.stringify(r, null, 2)); else printLint(dir, r);
  process.exitCode = r.ok ? 0 : 1;
}

async function cmdPack(arg) {
  const dir = skinDir(arg);
  const r = await runLint(dir, { apps: REFERENCE_APPS });
  printLint(dir, r);
  if (!r.ok) { console.error('Not packed: fix the errors above.'); process.exitCode = 1; return; }
  const b = opt.from ? await savedBench(opt.from, r.skin.id) : await runBench(dir, benchOptions());
  printBench(dir, b);
  if (!b.estimate && !b.tier) { console.error('Not packed: a hard gate (idle frames, memory or cold start) failed on the TV.'); process.exitCode = 1; return; }
  if (b.tier === bench.HEAVY_TIER) console.log('Packed as Heavy: a smoothness gate failed. TVs use it only with "Allow heavy skins" on.');
  const { runsDetail, ...benchResult } = b;
  const score = {
    tool: 'lx', toolVersion: TOOL_VERSION, lintVersion: LINT_VERSION, apiVersion: API_VERSION,
    date: new Date().toISOString(), referenceApps: REFERENCE_APPS,
    lint: { ok: r.ok, errors: r.errors, warnings: r.warnings, stats: r.stats },
    bench: benchResult, tier: b.tier, tierEstimate: b.estimate, // the TV re-checks estimates (plan: Enforcement)
  };
  const entries = [];
  for (const f of await listFiles(dir)) if (f.path !== 'score.json') entries.push({ name: f.path, data: await readFile(join(dir, f.path)) });
  entries.push({ name: 'score.json', data: Buffer.from(JSON.stringify(score, null, 2)) });
  const out = resolve(opt.out || `${r.skin.id}-${r.skin.version}.lxskin`);
  const data = zip(entries);
  await writeFile(out, data);
  console.log(`Packed ${entries.length} files (${kb(data.length)}) → ${relative(process.cwd(), out)}`);
}

// Pushes file by file: on Windows, `adb push <folder>` into Android/data drops or nests files.
async function pushSkin(tv, dir, log = console.log) {
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  if (!SKIN_ID.test(manifest.id || '') || manifest.id !== basename(dir)) {
    console.error(`manifest id "${manifest.id}" must match the folder name "${basename(dir)}"`); process.exit(1);
  }
  if (existsSync(join(BUNDLED_SKINS, manifest.id))) { console.error(`"${manifest.id}" is a bundled skin id (reserved)`); process.exit(1); }
  const files = (await listFiles(dir)).filter(f => f.path !== 'score.json');
  const bad = files.filter(f => !/^[A-Za-z0-9._/-]{1,160}$/.test(f.path));
  if (bad.length) { console.error(`unsupported file names: ${bad.map(f => f.path).join(', ')}`); process.exit(1); }
  const remote = `${DEV_SKINS}/${manifest.id}`;
  const dirs = [...new Set(files.map(f => f.path.split('/').slice(0, -1).join('/')))].map(d => d ? `${remote}/${d}` : remote);
  tv.shell(`rm -rf ${remote} && mkdir -p ${dirs.join(' ')}`);
  for (const f of files) tv.push(join(dir, f.path), `${remote}/${f.path}`);
  log(`Pushed ${files.length} files to ${remote}`);
  return manifest;
}

async function cmdPush(arg) {
  const dir = skinDir(arg);
  const tv = device(opt.tv || process.env.TV || '');
  const manifest = await pushSkin(tv, dir);
  if (opt.open) {
    tv.run(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`, '--es', 'skin', manifest.id]);
    console.log(`Opened the launcher with "${manifest.id}" (preview; pick it in Launcher settings → Skin to keep it)`);
  } else {
    console.log('Pick it in Launcher settings → Skin, or run again with --open to preview it.');
  }
}

// ---------------------------------------------------------------- install (M2.3)
const INBOX = `/sdcard/Android/data/${PKG}/files/inbox`;

/** A skin folder (zipped here, without lint or bench: use lx pack for a scored package) or a .lxskin file. */
async function packageFor(arg) {
  if (!arg) usage(1);
  if (/\.(lxskin|zip)$/i.test(arg)) {
    const data = await readFile(resolve(arg));
    return { data, id: basename(arg).replace(/\.(lxskin|zip)$/i, '').replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'skin' };
  }
  const dir = skinDir(arg);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
  const entries = [];
  for (const f of await listFiles(dir)) entries.push({ name: f.path, data: await readFile(join(dir, f.path)) });
  return { data: zip(entries), id: manifest.id };
}

/**
 * Installs a package on the TV: over the LAN page (opt.lan + opt.pin) or the ADB inbox (opt.tv / $TV).
 * open: preview it afterwards (ADB only; with the TV's "Live reload for lx dev" on, the LAN page previews by itself).
 */
async function installOnTv(pkg, { open = false } = {}) {
  if (opt.lan) {
    if (!/^\d{6}$/.test(opt.pin || '')) return { ok: false, error: '--lan needs --pin with the 6-digit PIN shown on the TV (Launcher settings → Install skin)' };
    try {
      const res = await fetch(`http://${opt.lan}/install`, {
        method: 'POST', headers: { 'X-LX-PIN': opt.pin, 'Content-Type': 'application/octet-stream' }, body: pkg.data,
      });
      return await res.json();
    } catch (e) {
      return { ok: false, error: `the TV did not answer at ${opt.lan}. Open Launcher settings → Install skin on the TV (it closes after an install unless "Live reload for lx dev" is on).` };
    }
  }
  const tv = device(opt.tv || process.env.TV || '');
  const tmp = join(process.env.TEMP || process.env.TMPDIR || '.', `lx-${process.pid}.lxskin`);
  await writeFile(tmp, pkg.data);
  tv.shell(`mkdir -p ${INBOX}`);
  tv.run(['logcat', '-c']);
  tv.push(tmp, `${INBOX}/${pkg.id}.lxskin`);
  await unlink(tmp).catch(() => {});
  tv.run(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`, '--ez', 'installInbox', 'true']);
  let result = null;
  for (let i = 0; i < 120 && !result; i++) { // the TV lints the package first (up to 30 s)
    await new Promise(r => setTimeout(r, 250));
    const line = tv.run(['logcat', '-d', '-s', 'WebLauncher:*']).split('\n').find(l => l.includes('SKIN_INSTALL '));
    if (line) result = JSON.parse(line.slice(line.indexOf('SKIN_INSTALL ') + 13));
  }
  result ||= { ok: false, error: 'no answer from the TV (is the launcher installed and up to date?)' };
  if (result.ok && open) tv.run(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`, '--es', 'skin', result.id]);
  return result;
}

const lintLines = r => ((r.lint && r.lint.errors) || []).map(e => `  ✖ ${e.rule}: ${e.message}${e.where ? ` [${e.where}]` : ''}`).join('\n');

async function cmdInstall(arg) {
  const pkg = await packageFor(arg);
  const result = await installOnTv(pkg, { open: opt.open });
  if (result.ok) console.log(`Installed "${result.name}" ${result.version} (${result.id}, level ${result.level}) ${kb(pkg.data.length)}${opt.open && !opt.lan ? '; opened it' : ''}`);
  else { console.error(`Not installed: ${result.error}${result.lint ? '\n' + lintLines(result) : ''}`); process.exitCode = 1; }
}

/** `lx dev <dir> --tv | --lan host:port --pin N`: on every save, install on the TV and show it there. */
async function devOnTv(dir) {
  const via = opt.lan ? `the TV's LAN page at ${opt.lan}` : 'ADB';
  console.log(`lx dev: installing ${basename(dir)} on the TV through ${via} on every save. Ctrl+C to stop.`);
  if (opt.lan) console.log('On the TV: Launcher settings → Install skin → Live reload for lx dev: On.');
  let busy = false, again = false, timer;
  const run = async () => {
    if (busy) { again = true; return; }
    busy = true;
    const t0 = Date.now();
    try {
      const r = await installOnTv(await packageFor(dir), { open: true });
      const time = `[${new Date().toLocaleTimeString()}]`;
      if (r.ok) console.log(`${time} ${r.version} on the TV in ${((Date.now() - t0) / 1000).toFixed(1)} s${r.lint && r.lint.warnings && r.lint.warnings.length ? ` (${r.lint.warnings.length} lint warnings)` : ''}`);
      else console.log(`${time} not installed: ${r.error}${r.lint ? '\n' + lintLines(r) : ''}`);
    } catch (e) {
      console.log(`[${new Date().toLocaleTimeString()}] ✖ ${e.message}`);
    }
    busy = false;
    if (again) { again = false; run(); }
  };
  watch(dir, { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(run, 300); });
  await run();
}

async function cmdSettings(action) {
  const file = positionals[2];
  const tv = device(opt.tv || process.env.TV || '');
  const waitFor = async tag => {
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 250));
      const line = tv.run(['logcat', '-d', '-s', 'WebLauncher:*']).split('\n').find(l => l.includes(tag + ' '));
      if (line) return line.slice(line.indexOf(tag + ' ') + tag.length + 1).trim();
    }
    return null;
  };
  tv.run(['logcat', '-c']);
  if (action === 'export') {
    tv.run(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`, '--ez', 'exportSettings', 'true']);
    const r = await waitFor('SETTINGS_EXPORT');
    const remote = r && /ok=true path=(\S+)/.exec(r)?.[1];
    if (!remote) { console.error(`Not exported: ${r || 'no answer from the TV'}`); process.exitCode = 1; return; }
    const out = resolve(file || 'launcher-settings.json');
    tv.run(['pull', remote, out]);
    tv.shell(`rm ${remote}`);
    console.log(`Exported launcher settings → ${relative(process.cwd(), out)}`);
  } else if (action === 'import') {
    if (!file) usage(1);
    tv.shell(`mkdir -p ${INBOX}`);
    tv.push(resolve(file), `${INBOX}/settings.json`);
    tv.run(['shell', 'am', 'start', '-n', `${PKG}/.MainActivity`, '--ez', 'importSettings', 'true']);
    const r = await waitFor('SETTINGS_IMPORT');
    const j = r ? JSON.parse(r) : { ok: false, error: 'no answer from the TV' };
    if (j.ok) console.log('Imported; the launcher reloads.'); else { console.error(`Not imported: ${j.error}`); process.exitCode = 1; }
  } else usage(1);
}

// ---------------------------------------------------------------- skin gallery (M4, decision D7 b)
const GALLERY_FORMAT = 'web-launcher-gallery';
const PREVIEW = /\.(webp|png|jpe?g)$/i;

/**
 * `lx gallery build <out-dir> <skin-dir|file.lxskin>... [--name "My gallery"]`: writes the packages, a preview
 * image for each and gallery.json into out-dir, ready for any static https host.
 * A skin folder is linted (errors stop the build), zipped and shot in Chrome for Testing (1280×720 JPEG).
 * A .lxskin (from lx pack, with its score) keeps its score; a picture next to it with the same name is its preview.
 */
async function galleryBuild(outArg, inputs) {
  if (!outArg || !inputs.length) usage(1);
  const out = resolve(outArg);
  await mkdir(out, { recursive: true });
  const skins = [];
  for (const arg of inputs) {
    let data, manifest, score = null, preview = null;
    if (/\.(lxskin|zip)$/i.test(arg)) {
      data = await readFile(resolve(arg));
      manifest = JSON.parse(unzipEntry(data, 'manifest.json')?.toString('utf8') || 'null');
      try { score = JSON.parse(unzipEntry(data, 'score.json')?.toString('utf8') || 'null'); } catch (e) { /* no score */ }
      const base = resolve(arg).replace(/\.(lxskin|zip)$/i, '');
      preview = ['.webp', '.png', '.jpg', '.jpeg'].map(x => base + x).find(existsSync) || null;
    } else {
      const dir = skinDir(arg);
      manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
      preview = join(out, `${manifest.id}-${manifest.version}.jpg`);
      const r = await runLint(dir, { apps: REFERENCE_APPS, shot: preview });
      if (!r.ok) { printLint(dir, r); console.error(`Not added: ${manifest.id} has lint errors.`); process.exitCode = 1; return; }
      data = (await packageFor(dir)).data;
    }
    if (!manifest || !SKIN_ID.test(manifest.id || '')) { console.error(`${arg}: no valid manifest.json`); process.exitCode = 1; return; }
    if (existsSync(join(BUNDLED_SKINS, manifest.id))) { console.error(`${arg}: "${manifest.id}" is a bundled skin id (reserved)`); process.exitCode = 1; return; }
    const pkgName = `${manifest.id}-${manifest.version}.lxskin`;
    await writeFile(join(out, pkgName), data);
    let previewName;
    if (preview) {
      previewName = `${manifest.id}-${manifest.version}${preview.slice(preview.lastIndexOf('.')).toLowerCase()}`;
      if (resolve(preview) !== join(out, previewName)) await copyFile(preview, join(out, previewName));
      if ((await stat(join(out, previewName))).size > 512 * 1024) console.log(`  ⚠ ${previewName} is over 512 KB: the TV won't show it`);
    }
    const entry = {
      id: manifest.id, name: manifest.name || manifest.id, version: manifest.version, level: manifest.level,
      author: manifest.author || '', description: manifest.description || '',
      package: pkgName, sha256: createHash('sha256').update(data).digest('hex'), size: data.length,
    };
    if (previewName) entry.preview = previewName;
    if (score?.tier) { entry.tier = score.tier; if (Number.isFinite(score.bench?.score)) entry.score = score.bench.score; }
    skins.push(entry);
    console.log(`  ${entry.id} ${entry.version} (L${entry.level}) ${kb(data.length)}${previewName ? ' + preview' : ''}${entry.tier ? ` · ${entry.tier}` : ''}`);
  }
  const index = { format: GALLERY_FORMAT, version: 1, name: opt.name || basename(out), updated: new Date().toISOString(), skins };
  await writeFile(join(out, 'gallery.json'), JSON.stringify(index, null, 2));
  console.log(`Wrote ${skins.length} skins → ${relative(process.cwd(), join(out, 'gallery.json'))}. Put the folder on any https host.`);
}

/** Sets the TV's gallery URL over ADB (empty: removes it). */
function gallerySetOnTv(tv, url) {
  const q = `'${String(url).replace(/'/g, `'\\''`)}'`; // adb shell joins arguments into one remote shell line
  tv.shell(`am start -n ${PKG}/.MainActivity --es galleryUrl ${q}`);
}

/**
 * `lx gallery serve <dir> [--port 7191] [--tv]`: serves the folder on 127.0.0.1 for testing. With --tv the TV reaches
 * it through `adb reverse` (debug builds accept http://127.0.0.1) and its gallery URL is set to it.
 */
async function galleryServe(dirArg) {
  const dir = resolve(dirArg || '.');
  if (!existsSync(join(dir, 'gallery.json'))) { console.error(`${dirArg}: no gallery.json (make one with lx gallery build)`); process.exitCode = 1; return; }
  const port = Number(opt.port === '5180' ? 7191 : opt.port);
  const { createServer } = await import('node:http');
  const types = { json: 'application/json', lxskin: 'application/zip', zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  createServer(async (req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
    const ok = /^[A-Za-z0-9._-]{1,120}$/.test(name) && !name.startsWith('.');
    const file = ok ? join(dir, name) : null;
    if (!file || !existsSync(file)) { res.writeHead(404).end(); console.log(`  404 ${req.url}`); return; }
    res.writeHead(200, { 'Content-Type': types[name.split('.').pop().toLowerCase()] || 'application/octet-stream' });
    res.end(await readFile(file));
    console.log(`  200 ${req.url}`);
  }).listen(port, '127.0.0.1');
  const url = `http://127.0.0.1:${port}/gallery.json`;
  console.log(`Serving ${relative(process.cwd(), dir) || '.'} at ${url}. Ctrl+C to stop.`);
  if (tvFlag) {
    const tv = device(opt.tv || process.env.TV || '');
    tv.run(['reverse', `tcp:${port}`, `tcp:${port}`]);
    gallerySetOnTv(tv, url);
    console.log('The TV reaches it through adb reverse (debug builds only). On the TV: Install skin → Skin gallery.');
  }
}

async function cmdGallery(action) {
  const rest = positionals.slice(2);
  if (action === 'build') return galleryBuild(rest[0], rest.slice(1));
  if (action === 'serve') return galleryServe(rest[0]);
  if (action === 'set') {
    const url = rest[0] ?? '';
    if (url && !/^https:\/\//.test(url) && !/^http:\/\/127\.0\.0\.1[:/]/.test(url)) { console.error('The gallery link must start with https://'); process.exitCode = 1; return; }
    gallerySetOnTv(device(opt.tv || process.env.TV || ''), url);
    console.log(url ? `Gallery set to ${url}` : 'Gallery removed');
    return;
  }
  usage(1);
}

// ---------------------------------------------------------------- bench
const benchOptions = () => ({
  tv: tvFlag, runs: Math.max(1, Number(opt.runs) || 3),
});

/** Benches the skin in `dir` against the reference skin, interleaved (ref, skin, ref, skin, …) to cancel drift. */
async function runBench(dir, { tv: onTv = false, runs = 3, log = console.log } = {}) {
  const id = basename(dir);
  const ref = bench.REFERENCE_SKIN;
  const bundledHere = resolve(BUNDLED_SKINS, id) === dir;
  const order = [];
  for (let i = 0; i < runs; i++) { order.push(ref); if (id !== ref) order.push(id); }
  const results = { [ref]: [], [id]: [] };
  const notes = [];
  let deviceInfo;

  if (onTv) {
    const tv = device(opt.tv || process.env.TV || '');
    deviceInfo = bench.tvInfo(tv);
    if (!deviceInfo.appVersion) throw new Error(`${PKG} is not installed on the TV (scripts/install.sh release)`);
    if (deviceInfo.debuggable) notes.push('debug build: ART runs JIT-only, so timings are slower and noisier. Use a release build (scripts/install.sh release).');
    if (bundledHere) notes.push(`"${id}" is bundled: the TV benches the copy inside the installed APK.`);
    else await pushSkin(tv, dir, log);
    const homeWatch = bench.homeWatchWarning(tv);
    if (homeWatch) { log(`WARNING: ${homeWatch}`); notes.push(homeWatch); }
    log(`Bench on ${deviceInfo.model} (Android ${deviceInfo.android}, WebView ${deviceInfo.webView}, launcher ${deviceInfo.appVersion}${deviceInfo.debuggable ? ' debug' : ''}): ${order.length} runs of ~1 min`);
    try {
      for (const [i, s] of order.entries()) {
        log(`  run ${i + 1}/${order.length}: ${s}`);
        results[s].push(await bench.tvRun(tv, s, { log }));
      }
    } finally { bench.tvRestore(tv); }
  } else {
    deviceInfo = { model: 'desktop estimate' };
    const srv = await startServer({ skins: bundledHere ? [] : [{ dir }] });
    const { browser, page } = await openPage();
    log(`Desktop estimate (Chrome for Testing, render cost from a trace): ${order.length} runs`);
    try {
      for (const [i, s] of order.entries()) {
        log(`  run ${i + 1}/${order.length}: ${s}`);
        results[s].push(await bench.desktopRun(page, `${srv.url}/?skin=${s}&apps=${bench.BENCH_APPS}&bench`, s));
      }
    } finally { await browser.close(); await srv.close(); }
  }
  const summary = bench.summarize({ skinRuns: results[id], refRuns: results[ref], estimate: !onTv });
  return {
    skinId: id, date: new Date().toISOString(), estimate: !onTv, device: deviceInfo, runs, referenceSkin: ref, referenceApps: bench.BENCH_APPS,
    tour: bench.TOUR, idleSeconds: onTv ? bench.IDLE_SECONDS : null, notes,
    ...summary, runsDetail: { skin: results[id], reference: results[ref] },
  };
}

/**
 * `lx pack --from <file>`: a result saved with `lx bench <dir> --tv --json > file`, so a skin that did not change
 * is not measured again. It is scored again with today's gates; a result for another skin is refused.
 */
async function savedBench(file, id) {
  const saved = JSON.parse(await readFile(file, 'utf8'));
  if (saved.skinId && saved.skinId !== id) throw new Error(`${file} is a bench of "${saved.skinId}", not "${id}"`);
  const b = bench.rescore(saved);
  b.notes.push(`from a saved bench (${relative(process.cwd(), resolve(file))}${saved.date ? ', ' + saved.date.slice(0, 10) : ''}); scored with today's gates`);
  return b;
}

function printBench(dir, b) {
  const unit = u => (u === '%' || u === '/s' ? u : ' ' + u);
  const fmt = (v, u) => (v == null ? '—' : `${v}${unit(u)}`);
  console.log(`\nlx bench ${relative(process.cwd(), dir) || '.'}  ${b.estimate ? '(desktop ESTIMATE; run with --tv for the real check)' : `(${b.device.model}, ${b.runs} runs each)`}`);
  console.log(`  ${'metric'.padEnd(20)}${'skin'.padStart(10)}${b.referenceSkin.padStart(10)}   gate`);
  if (b.estimate) {
    console.log(`  ${'Render cost'.padEnd(20)}${fmt(b.skin.renderMs, 'ms').padStart(10)}${fmt(b.reference.renderMs, 'ms').padStart(10)}   (scored)`);
    console.log(`  Hard gates (frames, key latency, idle, memory, cold start) are checked with --tv only.`);
  }
  for (const g of b.estimate ? [] : b.gates) {
    const mark = g.ok === null ? '' : g.ok ? '  ✔' : g.smooth ? '  ✖ (smoothness)' : '  ✖ (hard)';
    console.log(`  ${g.label.padEnd(20)}${fmt(g.value, g.unit).padStart(10)}${fmt(b.reference[g.metric], g.unit).padStart(10)}   ${g.inclusive ? '≤' : '<'} ${g.limit ?? '—'}${unit(g.unit)}${g.relative ? ` (${g.relative}× ${b.referenceSkin})` : ''}${mark}`);
  }
  if (b.p95Rank) console.log(`  p95 frame = the ${b.p95Rank}th slowest frame of each skin (5% of ${b.referenceSkin}'s frames, R16)`);
  for (const n of b.notes) console.log(`  ⚠ ${n}`);
  const tier = !b.tier ? 'none (a hard gate failed)' : b.tier === bench.HEAVY_TIER ? 'Heavy (a smoothness gate failed; needs "Allow heavy skins" on the TV)'
    : `${b.tier}${b.estimate ? ' (estimate)' : ''}`;
  console.log(`  Score ${b.score ?? '—'}/100 vs ${b.referenceSkin} · tier ${tier}\n`);
}

async function cmdBench(arg) {
  const dir = skinDir(arg);
  const b = await runBench(dir, { ...benchOptions(), log: opt.json ? () => {} : console.log });
  if (opt.json) console.log(JSON.stringify(b, null, 2)); else printBench(dir, b);
  process.exitCode = b.estimate || b.tier ? 0 : 1; // Heavy is a result, not an error
}

if (opt.help || !cmd) usage(0);
const commands = { new: cmdNew, dev: cmdDev, lint: cmdLint, bench: cmdBench, pack: cmdPack, push: cmdPush, install: cmdInstall, settings: cmdSettings, gallery: cmdGallery };
if (!commands[cmd]) { console.error(`unknown command "${cmd}"`); usage(1); }
try {
  await commands[cmd](dirArg);
} catch (e) {
  console.error(`lx ${cmd}: ${e.message}`);
  process.exitCode = 1;
}
