// Level 3 (sandboxed script skins, plan M2.1): manifest, entry lint, and the frame in Chrome for Testing.
// Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '../../app/src/main/assets/web/core/validate.js';
import { lintEntry, lintPackage } from '../../app/src/main/assets/web/core/lint.js';
import { startServer } from '../lib/server.mjs';
import { openPage } from '../lib/browser.mjs';

const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const base = { id: 'my-skin', name: 'My skin', version: '0.1.0', apiVersion: 1 };

test('level 3 manifests: entry defaults to skin.html and must be a relative .html path', () => {
  assert.equal(validateManifest({ ...base, level: 3 }).value.entry, 'skin.html');
  assert.equal(validateManifest({ ...base, level: 3, entry: 'ui/main.html' }).value.entry, 'ui/main.html');
  for (const entry of ['../x.html', '/x.html', 'https://x/a.html', 'x.js']) assert.equal(validateManifest({ ...base, level: 3, entry }).ok, false, entry);
  assert.ok(validateManifest({ ...base, level: 3, styles: ['a.css'] }).warnings.some(w => /ignore styles/.test(w)));
  assert.equal(validateManifest({ ...base, level: 1 }).value.entry, null);
});

test('package lint: scripts and pages only at level 3; the entry must exist', () => {
  const files = [{ path: 'manifest.json', size: 10 }, { path: 'skin.js', size: 10 }, { path: 'skin.html', size: 10 }];
  const l1 = lintPackage({ ...base, level: 1 }, files);
  assert.ok(l1.errors.some(e => e.rule === 'no-script'));
  assert.ok(l1.warnings.some(w => w.rule === 'file-type' && w.where === 'skin.html'));
  assert.deepEqual(lintPackage({ ...base, level: 3 }, files).errors, []);
  assert.ok(lintPackage({ ...base, level: 3, entry: 'main.html' }, files).errors.some(e => e.rule === 'missing-file'));
});

test('entry lint: inline script, handlers, outside URLs, <base>', () => {
  const rules = html => lintEntry(html).errors.map(e => e.rule);
  assert.deepEqual(rules('<script type="module" src="skin.js"></script><div data-nav data-item="a"></div>'), []);
  assert.deepEqual(rules('<script>go()</script>'), ['inline-script']);
  assert.deepEqual(rules('<div onclick="go()"></div>'), ['inline-handler']);
  assert.deepEqual(rules('<img src="https://cdn.example/a.png">'), ['external-url']);
  assert.deepEqual(rules('<link rel="stylesheet" href="//cdn.example/a.css">'), ['external-url']);
  assert.deepEqual(rules('<base href="/">'), ['base-tag']);
});

// ---------------------------------------------------------------- in the browser
let srv, browser, page, logs;
before(async () => {
  srv = await startServer({ skins: ['l3-basic', 'l3-hostile', 'l3-broken', 'l3-janky'].map(n => ({ dir: fixture(n) })) });
  ({ browser, page } = await openPage());
  page.on('console', m => logs.push(m.text()));
  // Tests open apps; the Recent row (M3.2) would then shift the focus order of later tests.
  await page.context().addInitScript(() => { try { localStorage.removeItem('recent'); } catch (e) { /* opaque frame */ } });
});
after(async () => { await browser?.close(); await srv?.close(); });

async function open(id) {
  logs = [];
  await page.goto(`${srv.url}/?skin=${id}&apps=50`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready', null, { timeout: 15000 });
  return page.frames().find(f => f.url().includes('/__skin/'));
}
const focusedIn = frame => frame.evaluate(() => {
  const el = document.querySelector('[focused]');
  return el && (el.dataset.item || el.dataset.action);
});
async function press(key) { await page.keyboard.press(key); await page.waitForTimeout(120); }

test('l3-basic: the core keeps the keys, the frame moves focus, OK and Menu act on its focus', { timeout: 60000 }, async () => {
  const frame = await open('l3-basic');
  assert.ok(frame, 'skin frame present');
  assert.match(frame.url(), /^http:\/\/127\.0\.0\.1:\d+\/__skin\/l3-basic\/skin\.html$/, 'cross-site skin host');
  assert.equal(await page.evaluate(() => {
    const f = document.querySelector('iframe');
    return [f.getAttribute('sandbox'), f.hasAttribute('inert'), getComputedStyle(f).pointerEvents].join(' ');
  }), 'allow-scripts true none');
  assert.equal(await focusedIn(frame), 'com.netflix.ninja', 'first item focused');
  await press('ArrowRight');
  assert.equal(await focusedIn(frame), 'com.google.android.youtube.tv');
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY', 'focus stays in the core page');

  await press('Enter');
  assert.deepEqual(await page.evaluate(() => window.__launched), ['com.google.android.youtube.tv']);

  await page.evaluate(() => window.launcher.onMenu());
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.querySelector('lx-overlay').shadowRoot.querySelector('.title').textContent), 'YouTube');
  await press('ArrowDown'); // moves inside the core menu, not the frame
  assert.equal(await focusedIn(frame), 'com.google.android.youtube.tv');
  await page.evaluate(() => window.launcher.onBack()); // closes the menu
  await page.evaluate(() => window.launcher.onBack()); // home: first item again
  await page.waitForTimeout(100);
  assert.equal(await focusedIn(frame), 'com.netflix.ninja');

  await press('ArrowUp'); // the Settings pill (data-action="settings"): OK opens Launcher settings
  assert.equal(await focusedIn(frame), 'settings');
  await press('Enter');
  assert.equal(await page.evaluate(() => document.querySelector('lx-overlay').shadowRoot.querySelector('.title').textContent), 'Launcher settings');
});

test('l3-hostile: no parent, storage, network, popups or navigation; stolen focus comes back; unknown ids rejected', { timeout: 60000 }, async t => {
  // The focus guard listens for the window's blur, and a page without window focus never blurs. On a headless CI
  // runner it has none, so emulate focus (CDP) and wait for the result, not a fixed time.
  await page.bringToFront();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const frame = await open('l3-hostile');
  for (let t = 0; t < 5000 && !logs.some(l => l.startsWith('L3_FOCUS_RECLAIMED')); t += 100) await page.waitForTimeout(100);
  await page.waitForTimeout(300);
  const r = await frame.evaluate(() => window.__results);
  for (const k of ['parentDocument', 'topLocation', 'localStorage', 'cookie', 'bridge', 'openWindow', 'topNavigate', 'fetchCore', 'fetchExternal', 'imageExternal', 'bridgeCall', 'webrtc', 'webSocket'])
    assert.match(r[k], /^blocked/, `${k}: ${r[k]}`);
  assert.equal(r.claimed, true);
  // What matters: the frame doesn't keep the focus (it would get the remote's keys). Where the browser lets the steal
  // happen (Windows, Android WebView), the guard must have taken it back. Linux headless Chrome may not move the
  // focus at all, and then there is nothing to reclaim.
  if (!logs.some(l => l.startsWith('L3_FOCUS_RECLAIMED'))) {
    const parentActive = await page.evaluate(() => document.activeElement.tagName);
    const frameFocused = await frame.evaluate(() => document.hasFocus());
    t.diagnostic(`no reclaim log: parent activeElement=${parentActive}, frame hasFocus=${frameFocused}`);
    assert.ok(parentActive !== 'IFRAME' && !frameFocused, `focus steal noticed (parent activeElement=${parentActive}, frame hasFocus=${frameFocused})`);
  }
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'BODY');
  assert.ok(logs.some(l => l === 'L3_REJECTED focused com.evil.app'));
  await press('Enter'); // its last report was an id the core never sent, and `activate` is not a message
  assert.deepEqual(await page.evaluate(() => window.__launched), []);
  await press('ArrowRight'); // a real move reports a real item again
  await press('Enter');
  assert.equal((await page.evaluate(() => window.__launched)).length, 1);
});

test('l3-broken: a frame that never says ready is replaced by the default skin', { timeout: 30000 }, async () => {
  await open('l3-broken');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), 'default');
  assert.equal(await page.evaluate(() => document.querySelectorAll('iframe').length), 0);
  assert.ok(logs.some(l => /^SKIN_FAILED l3-broken: it did not start/.test(l)));
});

// ---------------------------------------------------------------- runtime guard (M2.2): the page side of RuntimeGuard.kt
async function openGuarded(query, saved) {
  logs = [];
  await page.goto(`${srv.url}/?apps=50`);
  await page.evaluate(s => localStorage.setItem('skin', JSON.stringify(s)), saved);
  await page.goto(`${srv.url}/?apps=50&${query}`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready', null, { timeout: 15000 });
  return page.evaluate(() => ({
    skin: document.documentElement.dataset.skin,
    saved: JSON.parse(localStorage.getItem('skin')),
    toast: document.querySelector('lx-overlay').shadowRoot.textContent,
    active: window.__activeSkin,
  }));
}

test('guard reload: default skin, the culprit is no longer saved, the reason is shown', { timeout: 30000 }, async () => {
  const r = await openGuarded('guard=hang&culprit=l3-basic', 'l3-basic');
  assert.equal(r.skin, 'default');
  assert.equal(r.saved, 'default', 'saved skin reset');
  assert.match(r.toast, /Skin "l3-basic" was turned off: it stopped responding/);
  assert.deepEqual(r.active, { id: 'default', measured: true });
  assert.ok(logs.some(l => l === 'GUARD_FALLBACK {"reason":"hang","culprit":"l3-basic"}'));
});

test('guard reload: another culprit (a preview) leaves the saved skin alone; unknown reasons are ignored', { timeout: 30000 }, async () => {
  const r = await openGuarded('guard=crash&culprit=l3-hostile', 'l3-basic');
  assert.equal(r.skin, 'default');
  assert.equal(r.saved, 'l3-basic');
  assert.match(r.toast, /crashed the launcher twice/);
  const u = await openGuarded('guard=nonsense&culprit=l3-basic', 'l3-basic');
  assert.equal(u.skin, 'l3-basic');
  assert.equal(u.saved, 'l3-basic');
  assert.deepEqual(u.active, { id: 'l3-basic', measured: true });
});

test('core fallback of the saved skin saves the default skin; the bench is never measured by the guard', { timeout: 30000 }, async () => {
  const r = await openGuarded('', 'l3-broken');
  assert.equal(r.skin, 'default');
  assert.equal(r.saved, 'default');
  await page.goto(`${srv.url}/?apps=50&skin=l3-basic&bench`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready', null, { timeout: 15000 });
  assert.deepEqual(await page.evaluate(() => window.__activeSkin), { id: 'l3-basic', measured: false });
});

test('script jank: 3 windows of late frames after key presses turn the skin off (l3-janky)', { timeout: 60000 }, async () => {
  await open('l3-janky');
  for (let w = 0; w < 3; w++) {
    for (const k of ['ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowLeft']) await press(k);
    await page.waitForTimeout(10500 - 4 * 120);
  }
  await page.waitForTimeout(500);
  const script = logs.filter(l => l.startsWith('GUARD_SCRIPT'));
  assert.equal(script.length, 3, script.join('\n'));
  assert.ok(script.every(l => Number(/lateFramesPerKey=([\d.]+)/.exec(l)[1]) > 6), script.join('\n'));
  assert.ok(logs.some(l => l === 'SKIN_FAILED l3-janky: it was too slow to draw'));
  assert.equal(await page.evaluate(() => document.documentElement.dataset.skin), 'default');
});

// ---------------------------------------------------------------- bundled showcase skins (M2.5)
test('shelf (bundled L3 showcase): moves focus, updates its stage, groups A–Z, Settings pill works', { timeout: 60000 }, async () => {
  const frame = await open('shelf');
  assert.ok(frame, 'shelf frame');
  const stage = () => frame.evaluate(() => document.querySelector('.title').textContent);
  assert.equal(await stage(), 'Netflix');
  await press('ArrowRight');
  assert.equal(await stage(), 'YouTube');
  await press('ArrowDown'); // into the A–Z shelf
  const id = await focusedIn(frame);
  assert.ok(id && !['com.netflix.ninja', 'com.google.android.youtube.tv'].includes(id), `moved into the shelf (${id})`);
  assert.ok((await frame.evaluate(() => document.querySelectorAll('.group .letter').length)) > 5, 'grouped by letter');
  await page.evaluate(() => window.launcher.onBack()); // home
  await page.waitForTimeout(100);
  await press('ArrowUp'); // from Favourites up to the stage's Settings pill
  assert.equal(await focusedIn(frame), 'settings');
  assert.equal(await stage(), 'Settings');
  await press('Enter');
  assert.equal(await page.evaluate(() => document.querySelector('lx-overlay').shadowRoot.querySelector('.title').textContent), 'Launcher settings');
});

test('marquee (bundled L2 showcase): the marquee follows the focus; options change its look', { timeout: 60000 }, async () => {
  logs = [];
  await page.goto(`${srv.url}/?skin=marquee&apps=50`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  const hero = () => page.evaluate(() => document.querySelector('#stage .lx-hero-title').textContent);
  assert.equal(await hero(), 'Netflix');
  await press('ArrowRight');
  assert.equal(await hero(), 'YouTube');
  const art = await page.evaluate(() => getComputedStyle(document.querySelector('#stage .lx-hero-art')).width);
  await page.evaluate(() => { document.documentElement.dataset.optStage = 'compact'; });
  assert.ok(parseFloat(await page.evaluate(() => getComputedStyle(document.querySelector('#stage .lx-hero-art')).width)) < parseFloat(art), 'compact is smaller');
  const gridRight = await page.evaluate(() => document.querySelector('lx-grid').getBoundingClientRect().right);
  assert.ok(gridRight <= await page.evaluate(() => innerWidth), 'grid fits the screen');
});

// ---------------------------------------------------------------- TV inputs (M3.1)
test('inputs (default skin): a row of input tiles after Favourites; OK opens the input; the option and the bench hide it', { timeout: 60000 }, async () => {
  await page.goto(`${srv.url}/?apps=50`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  const tiles = () => page.evaluate(() => [...document.querySelectorAll('lx-row[source="inputs"] lx-tile')].map(t => `${t.dataset.input}:${t.hasAttribute('connected')}`));
  assert.deepEqual(await tiles(), ['hdmi1:true', 'hdmi2:false', 'hdmi3:false', 'tuner:true']);
  await press('ArrowDown'); // Favourites -> Inputs
  assert.equal(await page.evaluate(() => document.querySelector('[focused]').dataset.input), 'hdmi1');
  await press('Enter');
  assert.deepEqual(await page.evaluate(() => window.__inputs), ['hdmi1']);
  await page.evaluate(() => { document.documentElement.dataset.optInputs = 'off'; });
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('lx-section.inputs')).display), 'none');
  await page.goto(`${srv.url}/?apps=50&bench`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  assert.deepEqual(await tiles(), []);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('lx-section.inputs')).display), 'none', 'no inputs: no section');
});

test('inputs (shelf, level 3): the frame gets "input:" items; OK opens only inputs the core sent', { timeout: 60000 }, async () => {
  const frame = await open('shelf');
  const ids = await frame.evaluate(() => lx.data.inputs.map(i => i.id));
  assert.deepEqual(ids, ['input:hdmi1', 'input:hdmi2', 'input:hdmi3', 'input:tuner']);
  await press('ArrowDown'); // Favourites -> Inputs
  assert.equal(await focusedIn(frame), 'input:hdmi1');
  assert.equal(await frame.evaluate(() => document.querySelector('.title').textContent), 'HDMI 1');
  await press('Enter');
  assert.deepEqual(await page.evaluate(() => window.__inputs), ['hdmi1']);
  await frame.evaluate(() => parent.postMessage({ lx: 1, type: 'focused', itemId: 'input:evil', action: null }, '*'));
  await page.waitForTimeout(100);
  await press('Enter');
  assert.deepEqual(await page.evaluate(() => window.__inputs), ['hdmi1'], 'an input id the core never sent does nothing');
});
