// Skin CSS url() paths (levels 1–2): relative paths resolve inside the skin package, never against the page, and a
// path that would leave the package is dropped. Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { startServer } from '../lib/server.mjs';
import { openPage } from '../lib/browser.mjs';

const fixture = name => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
let srv, browser, page;
before(async () => { srv = await startServer({ skins: [{ dir: fixture('url-skin') }] }); ({ browser, page } = await openPage()); });
after(async () => { await browser?.close(); await srv?.close(); });

test('skin CSS url() resolves inside the skin package', { timeout: 30000 }, async () => {
  const bad = [], ok = [];
  page.on('response', r => { const u = r.url().replace(srv.url, ''); (r.status() >= 400 ? bad : ok).push(u); });
  await page.goto(`${srv.url}/?apps=50&skin=url-skin`);
  await page.waitForFunction(() => document.documentElement.dataset.state === 'ready');
  await page.waitForTimeout(500);
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector('lx-bg')).backgroundImage);
  assert.match(bg, /\/skins\/url-skin\/img\/dot\.svg/, bg);
  assert.ok(ok.includes('/skins/url-skin/img/dot.svg'), ok.join(' '));
  assert.deepEqual(bad.filter(u => /dot\.svg|escape\.svg/.test(u)), []);
  const after = await page.evaluate(() => getComputedStyle(document.querySelector('lx-root'), '::after').backgroundImage);
  assert.ok(!/escape\.svg/.test(after), `a path out of the package is dropped: ${after}`);
});
