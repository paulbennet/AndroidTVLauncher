// M4: skin gallery (decision D7 b) and "Open at TV start" (D6 a) in the desktop preview, plus `lx gallery build`.
// Downloads, checksums and the boot start are native (SkinGallery.kt, BootReceiver.kt) and checked on a TV/emulator.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer } from '../lib/server.mjs';
import { openPage } from '../lib/browser.mjs';
import { unzipEntry } from '../lib/zip.mjs';

let srv, browser, page;
before(async () => { srv = await startServer({}); ({ browser, page } = await openPage()); });
after(async () => { await browser?.close(); await srv?.close(); });

const shadow = fn => page.evaluate(`(${fn})(document.querySelector('lx-overlay').shadowRoot)`);
const items = () => shadow(s => [...s.querySelectorAll('.item')].map(b => b.textContent));
const title = () => shadow(s => s.querySelector('.title').textContent);
const activate = label => page.evaluate(l => {
  const b = [...document.querySelector('lx-overlay').shadowRoot.querySelectorAll('.item')].find(x => x.textContent.startsWith(l));
  if (!b) throw new Error('no item ' + l);
  b._activate();
}, label);

const GALLERY = {
  ok: true, name: 'Test gallery', skipped: 1,
  skins: [
    { id: 'ember', name: 'Ember', version: '1.2.0', level: 1, author: 'Ann', description: 'Warm colours.', size: 4096, preview: true, tier: 'Lite', score: 93 },
    { id: 'tide', name: 'Tide', version: '0.1.0', level: 0, author: '', description: '', size: 0, preview: false, tier: null, score: null },
  ],
};

async function ready() {
  await page.goto(`${srv.url}/?apps=50`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
}

test('gallery URL: only https (or debug loopback); kept in settings export and checked on import', { timeout: 30000 }, async () => {
  await ready();
  const set = u => page.evaluate(x => JSON.parse(window.launcher.setGalleryUrl(x)), u);
  assert.equal((await set('ftp://example.com/g.json')).ok, false);
  assert.equal((await set('http://192.168.1.5/g.json')).ok, false, 'no http to the home network');
  assert.equal((await set('http://127.0.0.1:7191/gallery.json')).ok, true);
  assert.equal((await set('https://example.com/gallery.json')).ok, true);
  const exported = JSON.parse(await page.evaluate(() => window.launcher.exportSettings()));
  assert.equal(exported.galleryUrl, 'https://example.com/gallery.json');
  const bad = JSON.parse(await page.evaluate(s => window.launcher.importSettings(s), JSON.stringify({ ...exported, galleryUrl: 'javascript:alert(1)' })));
  assert.deepEqual(bad, { ok: false, error: 'galleryUrl must be an https:// link' });
  assert.equal((await set('')).ok, true);
  assert.equal(await page.evaluate(() => localStorage.getItem('galleryUrl')), null, 'empty removes it');
});

test('Skin gallery: not set, loading, list, entry, install; errors and leaving while loading', { timeout: 30000 }, async () => {
  await ready();
  await page.evaluate(() => window.launcher.onMenu());
  await activate('Launcher settings');
  await activate('Install skin');
  await activate('Skin gallery');
  assert.deepEqual(await items(), ['Use the Web TV Launcher gallery', 'Or set another link on the Install skin page (phone or computer)']);
  // One press sets the project's gallery (then it loads; the mock has no gallery yet, so it shows Loading…).
  await activate('Use the Web TV Launcher gallery');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('galleryUrl'))), 'https://paulbennet.github.io/AndroidTVLauncher/gallery/gallery.json');
  await ready();
  await page.evaluate(() => window.launcher.onMenu());
  await activate('Launcher settings');
  await activate('Install skin');

  await page.evaluate(() => window.launcher.setGalleryUrl('https://example.com/gallery.json'));
  await page.evaluate(g => { window.__gallery = g; }, GALLERY);
  await activate('Skin gallery');
  assert.deepEqual(await items(), ['Loading…']);
  await page.waitForFunction(() => document.querySelector('lx-overlay').shadowRoot.querySelector('.title').textContent.startsWith('Skin gallery ·'));
  assert.equal(await title(), 'Skin gallery · Test gallery');
  assert.deepEqual(await items(), ['EmberL1 · Lite', 'TideL0', 'Reload the gallery']);

  await activate('Ember');
  assert.equal(await title(), 'Ember');
  const body = await shadow(s => s.querySelector('.gallery').textContent);
  assert.match(body, /Version 1\.2\.0 · level 1 · by Ann/);
  assert.match(body, /Warm colours\./);
  assert.match(body, /4 KB · Lite \(score 93, the author's claim\)/);
  assert.equal(await shadow(s => s.querySelector('.gallery .preview').hidden), true, 'no preview until the shell has one');
  await activate('Install');
  assert.deepEqual(await page.evaluate(() => window.__galleryInstalls), ['ember']);

  // The list is cached: opening it again does not download it again.
  const loads = await page.evaluate(() => window.__galleryLoads);
  await page.evaluate(() => window.launcher.onMenu());
  await activate('Launcher settings');
  await activate('Install skin');
  await activate('Skin gallery');
  assert.equal(await page.evaluate(() => window.__galleryLoads), loads);
  await page.waitForFunction(() => document.querySelector('lx-overlay').shadowRoot.querySelector('.title').textContent.startsWith('Skin gallery ·'));

  // Errors are shown; Back while loading drops the late answer.
  await page.evaluate(() => { window.__gallery = { ok: false, error: 'the server answered 404' }; });
  await activate('Reload the gallery');
  await page.waitForFunction(() => document.querySelector('lx-overlay').shadowRoot.querySelector('.item').textContent.startsWith('Could not'));
  assert.deepEqual(await items(), ['Could not load the gallery: the server answered 404', 'Try again', 'Back']);
  await activate('Try again');
  await page.evaluate(() => window.launcher.onBack());
  await new Promise(r => setTimeout(r, 120));
  assert.equal(await shadow(s => s.querySelector('.menu').hidden), true, 'a late answer does not reopen the menu');
});

test('Open at TV start: state in Launcher settings, the ADB command when not allowed, on/off', { timeout: 30000 }, async () => {
  await ready();
  await page.evaluate(() => window.launcher.onMenu());
  await activate('Launcher settings');
  assert.ok((await items()).includes('Open at TV startOn · needs permission'));
  await activate('Open at TV start');
  assert.equal(await shadow(s => s.querySelector('.boot .cmd').textContent), 'adb shell appops set com.weblauncher.tv SYSTEM_ALERT_WINDOW allow');
  await activate('Turn off');
  assert.equal(await page.evaluate(() => window.__bootOpen), false);
  assert.deepEqual(await items(), ['Turn on', 'Back']);
  await activate('Back');
  assert.ok((await items()).includes('Open at TV startOff'));
});

test('lx gallery build: packages, previews and a gallery.json whose checksums match', { timeout: 60000 }, async () => {
  const out = await mkdtemp(join(tmpdir(), 'lx-gallery-'));
  const lx = new URL('../lx.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const fixture = new URL('./fixtures/l3-basic', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  execFileSync(process.execPath, [lx, 'gallery', 'build', out, fixture, '--name', 'Fixtures'], { stdio: 'pipe' });
  const g = JSON.parse(await readFile(join(out, 'gallery.json'), 'utf8'));
  assert.equal(g.format, 'web-launcher-gallery');
  assert.equal(g.version, 1);
  assert.equal(g.name, 'Fixtures');
  const [s] = g.skins;
  assert.equal(s.id, 'l3-basic');
  const data = await readFile(join(out, s.package));
  assert.equal(createHash('sha256').update(data).digest('hex'), s.sha256);
  assert.equal(s.size, data.length);
  assert.equal(JSON.parse(unzipEntry(data, 'manifest.json').toString('utf8')).id, 'l3-basic');
  const jpg = await readFile(join(out, s.preview));
  assert.deepEqual([...jpg.subarray(0, 3)], [0xff, 0xd8, 0xff], 'preview is a JPEG');
  assert.ok(jpg.length < 512 * 1024, 'preview fits the TV limit');
});
