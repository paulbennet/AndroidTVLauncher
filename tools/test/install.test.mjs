// "Install skin" screen (M2.3) in the desktop preview: QR + address + PIN while open, LAN page closed after.
// The installs themselves are native (SkinInstaller.kt, LanInstallServer.kt) and checked on the TV.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { startServer } from '../lib/server.mjs';
import { openPage } from '../lib/browser.mjs';

let srv, browser, page;
before(async () => { srv = await startServer({}); ({ browser, page } = await openPage()); });
after(async () => { await browser?.close(); await srv?.close(); });

const activate = label => page.evaluate(l => {
  const b = [...document.querySelector('lx-overlay').shadowRoot.querySelectorAll('.item')].find(x => x.textContent.startsWith(l));
  if (!b) throw new Error('no item ' + l);
  b._activate();
}, label);

test('Install skin shows a scannable QR code, the address and the PIN; leaving closes the LAN page', { timeout: 30000 }, async () => {
  await page.goto(`${srv.url}/?apps=50`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  await page.evaluate(() => window.launcher.onMenu());
  await activate('Launcher settings');
  await activate('Install skin');
  const r = await page.evaluate(() => {
    const s = document.querySelector('lx-overlay').shadowRoot;
    return { title: s.querySelector('.title').textContent, url: s.querySelector('.install .url')?.textContent,
      pin: s.querySelector('.install .pin')?.textContent, open: window.__installOpen,
      items: [...s.querySelectorAll('.item')].map(b => b.textContent) };
  });
  assert.equal(r.title, 'Install skin');
  assert.equal(r.url, 'http://192.168.1.20:7190/');
  assert.equal(r.pin, '123456');
  assert.equal(r.open, true);
  assert.deepEqual(r.items, ['Skin gallerynot set', 'Install from the ADB inbox', 'USB: this TV has no file picker', 'Remove a skin', 'Live reload for lx devOff']);

  const shot = await page.locator('lx-overlay .qr').screenshot();
  const png = await page.evaluate(async b64 => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return { w: img.width, h: img.height, px: Array.from(g.getImageData(0, 0, img.width, img.height).data) };
  }, shot.toString('base64'));
  assert.equal(jsQR(Uint8ClampedArray.from(png.px), png.w, png.h)?.data, 'http://192.168.1.20:7190/', 'QR on screen decodes');

  await page.evaluate(() => window.launcher.onInstallPin('654321'));
  assert.equal(await page.evaluate(() => document.querySelector('lx-overlay').shadowRoot.querySelector('.pin').textContent), '654321');

  await page.evaluate(() => window.launcher.onBack());
  assert.equal(await page.evaluate(() => window.__installOpen), false, 'LAN page closed with the menu');

  await page.evaluate(() => window.launcher.onSkinInstalled({ ok: true, id: 'my-skin', name: 'My skin', version: '1.0.0', level: 1 }));
  assert.equal(await page.evaluate(() => document.querySelector('lx-overlay').shadowRoot.querySelector('.title').textContent), 'Installed "My skin" 1.0.0');
  await page.evaluate(() => window.launcher.onBack());
  await page.evaluate(() => window.launcher.onSkinInstalled({ ok: false, error: 'no manifest.json at the top of the package' }));
  assert.match(await page.evaluate(() => document.querySelector('lx-overlay').shadowRoot.querySelector('.toast').textContent), /Not installed: no manifest/);
});

// ---------------------------------------------------------------- M2.4: install-time lint, badge, settings
const fixture = name => new URL(`./fixtures/${name}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
import { readdir, stat, mkdtemp, writeFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function filesOf(dir, sub = '') {
  const out = [];
  for (const e of await readdir(join(dir, sub), { withFileTypes: true })) {
    const p = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await filesOf(dir, p)); else out.push({ path: p, size: (await stat(join(dir, p))).size });
  }
  return out;
}

test('install-time lint: the page lints /staged/<stage>/ and reports to the shell', { timeout: 60000 }, async () => {
  const scored = await mkdtemp(join(tmpdir(), 'lx-scored-'));
  await cp(fixture('l3-basic'), join(scored, 'scored-skin'), { recursive: true });
  const dir = join(scored, 'scored-skin');
  const m = JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, 'manifest.json'), 'utf8'));
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...m, id: 'scored-skin' }));
  await writeFile(join(dir, 'score.json'), JSON.stringify({ tier: 'Lite', tierEstimate: true, lint: { ok: true }, bench: { score: 92 } }));
  const s2 = await startServer({
    staged: { '0123456789ab': fixture('bad-skin'), 'abcdef012345': fixture('l3-basic') },
    skins: [{ dir }],
  });
  try {
    await page.goto(`${s2.url}/?apps=50`);
    await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
    const files = { bad: await filesOf(fixture('bad-skin')), good: await filesOf(fixture('l3-basic')) };
    await page.evaluate(f => { window.launcher.checkStaged({ id: '0123456789ab', files: f.bad }); window.launcher.checkStaged({ id: 'abcdef012345', files: f.good }); }, files);
    await page.waitForFunction(() => window.__staged && Object.keys(window.__staged).length === 2, null, { timeout: 15000 });
    const r = await page.evaluate(() => window.__staged);
    assert.equal(r['0123456789ab'].ok, false, 'bad-skin has lint errors');
    assert.ok(r['0123456789ab'].errors.length > 0);
    assert.equal(r.abcdef012345.ok, true, JSON.stringify(r.abcdef012345.errors));
    await page.evaluate(() => window.launcher.checkStaged({ id: 'not-a-stage', files: [] }));

    // Badge: the score.json claim in the Skin menu.
    await page.evaluate(() => window.launcher.onMenu());
    await activate('Launcher settings');
    await activate('Skin');
    await page.waitForFunction(() => document.querySelector('lx-overlay').shadowRoot.querySelector('.title').textContent === 'Skin');
    const values = await page.evaluate(() => [...document.querySelector('lx-overlay').shadowRoot.querySelectorAll('.item')].map(b => b.textContent));
    assert.ok(values.some(v => /L3 · dev · Lite \(estimate\)$/.test(v)), values.join(' | '));
    assert.ok(values.some(v => /^Default.*bundled$/.test(v)), values.join(' | '));
  } finally { await s2.close(); }
});

test('settings export and import round trip; bad files are refused', { timeout: 30000 }, async () => {
  await page.goto(`${srv.url}/?apps=50`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  await page.evaluate(() => {
    localStorage.setItem('favs', JSON.stringify(['com.netflix.ninja']));
    localStorage.setItem('hidden', JSON.stringify(['com.android.tv.settings']));
    localStorage.setItem('skinOptions.default', JSON.stringify({ clockDate: false }));
  });
  const exported = JSON.parse(await page.evaluate(() => window.launcher.exportSettings()));
  assert.equal(exported.format, 'web-launcher-settings');
  assert.deepEqual(exported.favs, ['com.netflix.ninja']);
  assert.deepEqual(exported.skinOptions, { default: { clockDate: false } });

  const bad = [
    '{}', 'nope', JSON.stringify({ ...exported, favs: ['<script>'] }), JSON.stringify({ ...exported, skin: '../x' }),
    JSON.stringify({ ...exported, skinOptions: { default: { a: { nested: 1 } } } }),
  ];
  for (const b of bad) assert.equal(JSON.parse(await page.evaluate(t => window.launcher.importSettings(t), b)).ok, false, b);

  await page.evaluate(() => localStorage.clear());
  const nav = page.waitForNavigation();
  assert.equal(JSON.parse(await page.evaluate(t => window.launcher.importSettings(t), JSON.stringify(exported))).ok, true);
  await nav;
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('hidden'))), ['com.android.tv.settings']);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('skinOptions.default'))), { clockDate: false });
});

// ---------------------------------------------------------------- Recent (M3.2 replacement, decision D4)
test('recent: launches fill a Recent row (newest first, no duplicates) after returning; remove, clear, export', { timeout: 60000 }, async () => {
  await page.goto(`${srv.url}/?apps=50`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${srv.url}/?apps=50`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  const row = () => page.evaluate(() => [...document.querySelectorAll('lx-row[source="recent"] lx-tile')].map(t => t.dataset.pkg));
  const shown = () => page.evaluate(() => getComputedStyle(document.querySelector('lx-section.recent')).display !== 'none');
  assert.deepEqual(await row(), []);
  assert.equal(await shown(), false, 'empty: hidden');
  await page.keyboard.press('Enter'); await page.waitForTimeout(100); // Netflix
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await page.waitForTimeout(100); // YouTube
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter'); await page.waitForTimeout(100); // Netflix again
  assert.deepEqual(await row(), [], 'not re-rendered while the app opens');
  await page.evaluate(() => window.launcher.onResume());
  assert.deepEqual(await row(), ['com.netflix.ninja', 'com.google.android.youtube.tv']);
  assert.equal(await shown(), true);

  await page.keyboard.press('ArrowDown'); await page.waitForTimeout(50); // Favourites -> Recent
  assert.equal(await page.evaluate(() => document.querySelector('[focused]').dataset.where), 'recent');
  await page.evaluate(() => window.launcher.onMenu());
  await activate('Remove from Recent');
  assert.deepEqual(await row(), ['com.google.android.youtube.tv']);
  const exported = JSON.parse(await page.evaluate(() => window.launcher.exportSettings()));
  assert.deepEqual(exported.recent, ['com.google.android.youtube.tv']);

  await page.evaluate(() => window.launcher.onMenu());
  await activate('Launcher settings');
  await activate('Clear recent apps (1)');
  assert.deepEqual(await row(), []);
});

// ---------------------------------------------------------------- long press on OK (session 17)
test('long press OK opens the app menu and does not launch, also when held keydowns are not marked as repeats', { timeout: 30000 }, async () => {
  await page.goto(`${srv.url}/?apps=50`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${srv.url}/?apps=50`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  const recent = () => page.evaluate(() => JSON.parse(localStorage.getItem('recent') || '[]'));
  const menuOpen = () => page.evaluate(() => !document.querySelector('lx-overlay').shadowRoot.querySelector('.menu, [role=dialog]')?.hidden
    && [...document.querySelector('lx-overlay').shadowRoot.querySelectorAll('.item')].some(x => x.offsetParent));
  // A held remote button: keydowns every 50 ms for 1.2 s, then keyup. `repeat` as a real remote / WebView may send it.
  const hold = repeat => page.evaluate(async rep => {
    const send = (type, r) => document.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', repeat: r, bubbles: true, cancelable: true }));
    send('keydown', false);
    for (let t = 0; t < 1200; t += 50) { await new Promise(r => setTimeout(r, 50)); send('keydown', rep); }
    send('keyup', false);
  }, repeat);
  for (const rep of [false, true]) {
    await hold(rep);
    await page.waitForTimeout(100);
    assert.ok(await menuOpen(), `menu open (repeat=${rep})`);
    assert.deepEqual(await recent(), [], `not launched (repeat=${rep})`);
    await page.evaluate(() => window.launcher.onBack());
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  assert.equal((await recent()).length, 1, 'a short press still launches');
});

// ---------------------------------------------------------------- Set up this TV (session 18, decision D10)
test('Set up this TV: opens once on a Google TV, opens TV Settings screens, shows the new state on return', { timeout: 30000 }, async () => {
  const title = () => page.evaluate(() => { const o = document.querySelector('lx-overlay').shadowRoot; return o.querySelector('.menu')?.hidden === false || !o.querySelector('.menu') ? o.querySelector('.title').textContent : null; });
  const values = () => page.evaluate(() => [...document.querySelector('lx-overlay').shadowRoot.querySelectorAll('.item')].map(b => b.textContent));
  const menuHidden = () => page.evaluate(() => document.querySelector('lx-overlay').shadowRoot.querySelector('.menu').hidden);
  await page.goto(`${srv.url}/?apps=50`);
  await page.evaluate(() => localStorage.clear());

  // Not a Google TV: no prompt, and Launcher settings keeps "Open at TV start".
  await page.goto(`${srv.url}/?apps=50`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  await page.waitForTimeout(1800);
  assert.equal(await menuHidden(), true, 'no prompt without Google TV');
  await page.evaluate(() => window.launcher.onMenu());
  await activate('Launcher settings');
  assert.ok((await values()).some(v => v.startsWith('Open at TV start')));
  await page.evaluate(() => window.launcher.onBack());

  // Google TV, nothing on: the Setup screen opens by itself once.
  await page.goto(`${srv.url}/?apps=50&googletv`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  await page.waitForFunction(() => document.querySelector('lx-overlay').shadowRoot.querySelector('.title').textContent === 'Set up this TV', null, { timeout: 4000 });
  assert.ok((await values()).some(v => v.includes('Off · open Settings')));
  await activate('1. Open instead of Google TV home');
  assert.deepEqual(await page.evaluate(() => window.__setupOpened), ['accessibility']);
  await page.evaluate(() => { window.__setup = { homeWatch: true }; window.launcher.onResume(); }); // back from TV Settings
  assert.ok((await values()).some(v => v.startsWith('1. Open instead of Google TV home') && v.endsWith('On')), 'refreshed on return');
  await activate('2. Faster start after the TV starts');
  assert.deepEqual(await page.evaluate(() => window.__setupOpened), ['accessibility', 'overlay']);
  await activate('Close');
  assert.equal(await menuHidden(), true);

  // Seen once: no prompt on the next start, even with the step off again; Launcher settings still has it.
  await page.goto(`${srv.url}/?apps=50&googletv`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  await page.waitForTimeout(1800);
  assert.equal(await menuHidden(), true, 'shown only once');
  await page.evaluate(() => window.launcher.onMenu());
  await activate('Launcher settings');
  assert.ok((await values()).some(v => v.startsWith('Set up this TV') && v.endsWith('Not done')));
  await activate('Set up this TV');
  assert.equal(await title(), 'Set up this TV');
});

test('a Heavy skin is used only when "Allow heavy skins" is on (R27)', { timeout: 60000 }, async () => {
  const box = await mkdtemp(join(tmpdir(), 'lx-heavy-'));
  const dir = join(box, 'heavy-skin');
  await cp(fixture('l3-basic'), dir, { recursive: true });
  const m = JSON.parse(await (await import('node:fs/promises')).readFile(join(dir, 'manifest.json'), 'utf8'));
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ ...m, id: 'heavy-skin', name: 'Heavy Skin' }));
  await writeFile(join(dir, 'score.json'), JSON.stringify({ tier: 'Heavy', tierEstimate: false, lint: { ok: true }, bench: { score: 55 } }));
  const s2 = await startServer({ skins: [{ dir }] });
  const title = t => page.waitForFunction(x => document.querySelector('lx-overlay').shadowRoot.querySelector('.title').textContent === x, t);
  const loaded = () => page.evaluate(() => document.documentElement.dataset.skin);
  const open = async () => {
    await page.goto(`${s2.url}/?apps=50`);
    await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
    await page.evaluate(() => window.launcher.onMenu());
    await activate('Launcher settings');
  };
  try {
    await page.goto(`${s2.url}/?apps=50`);
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('setupSeen', 'true'); });
    // Off (the default): picking the skin does nothing but explain.
    await open();
    await activate('Skin'); await title('Skin');
    await activate('Heavy Skin');
    await page.waitForTimeout(600);
    assert.equal(await loaded(), 'default');
    assert.match(await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('*')].map(e => e.shadowRoot ? e.shadowRoot.textContent : '').join(' ')), /Allow heavy skins/);
    // On: the skin loads.
    await open();
    await activate('Allow heavy skins'); await title('Launcher settings');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('allowHeavy'))), true);
    await activate('Skin'); await title('Skin');
    const nav = page.waitForNavigation();
    await activate('Heavy Skin');
    await nav;
    await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
    assert.equal(await loaded(), 'heavy-skin');
    // Off again while it is active: back to the default skin.
    await page.evaluate(() => window.launcher.onMenu());
    await activate('Launcher settings');
    const nav2 = page.waitForNavigation();
    await activate('Allow heavy skins');
    await nav2;
    await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
    assert.equal(await loaded(), 'default');
    // A settings import that names a Heavy skin, with the setting off: the skin is dropped after the start.
    const exported = JSON.parse(await page.evaluate(() => window.launcher.exportSettings()));
    const nav3 = page.waitForNavigation();
    assert.equal(JSON.parse(await page.evaluate(t => window.launcher.importSettings(t), JSON.stringify({ ...exported, skin: 'heavy-skin' }))).ok, true);
    await nav3;
    await page.waitForFunction(() => document.documentElement.dataset.skin === 'default' && document.documentElement.dataset.state === 'ready', null, { timeout: 20000 });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('skin'))), 'default');
  } finally { await s2.close(); await page.evaluate(() => localStorage.clear()).catch(() => {}); }
});
