// Unit tests for the skin API v1 validators.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, validateLayout, validateTokens, validateOptions, LIMITS } from '../../app/src/main/assets/web/core/validate.js';

const skinsDir = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'app', 'src', 'main', 'assets', 'web', 'skins');
const base = { id: 'x', name: 'X', version: '1.0.0', apiVersion: 1, level: 0 };

test('bundled skins are valid', async () => {
  for (const id of await readdir(skinsDir)) {
    const m = JSON.parse(await readFile(join(skinsDir, id, 'manifest.json'), 'utf8'));
    const r = validateManifest(m);
    assert.ok(r.ok, `${id}: ${r.errors.join('; ')}`);
    assert.equal(r.value.id, id);
    if (r.value.layout) {
      const l = validateLayout(JSON.parse(await readFile(join(skinsDir, id, r.value.layout), 'utf8')));
      assert.ok(l.ok, `${id} layout: ${l.errors.join('; ')}`);
      assert.deepEqual(l.warnings, []);
    }
  }
});

test('manifest: required fields and levels', () => {
  assert.ok(validateManifest(base).ok);
  for (const bad of [{ id: 'Bad Id' }, { version: '1' }, { apiVersion: 2 }, { level: 4 }, { name: '' }]) {
    assert.equal(validateManifest({ ...base, ...bad }).ok, false, JSON.stringify(bad));
  }
  assert.ok(validateManifest({ ...base, level: 3 }).ok, 'level 3 is supported since M2.1 (more in l3.test.mjs)');
});

test('manifest: paths stay inside the package', () => {
  for (const p of ['../x.css', '/abs.css', 'https://e.com/a.css', 'a\\b.css', 'x.js']) {
    assert.equal(validateManifest({ ...base, level: 1, styles: [p] }).ok, false, p);
  }
  assert.equal(validateManifest({ ...base, level: 2, layout: '../l.json' }).ok, false);
  assert.ok(validateManifest({ ...base, level: 1, styles: ['css/skin.css'] }).ok);
  assert.equal(validateManifest({ ...base, level: 1, styles: Array(LIMITS.styles + 1).fill('a.css') }).ok, false);
});

test('tokens: types are checked and url() is refused', () => {
  const ok = validateTokens({ accent: '#fff', radius: '1rem', focusScale: 1.1, gridColumns: 5, font: '"Inter", sans-serif', wallpaper: 'img/bg.webp' });
  assert.ok(ok.ok, ok.errors.join());
  for (const bad of [{ accent: 'url(https://e.com/x)' }, { focusScale: 2 }, { gridColumns: 1.5 }, { wallpaper: '../x.png' },
    { wallpaper: 'https://e.com/x.png' }, { radius: '1rem; color: red' }, { font: 'a;b' }]) {
    assert.equal(validateTokens(bad).ok, false, JSON.stringify(bad));
  }
  const unknown = validateTokens({ nope: 1 });
  assert.ok(unknown.ok);
  assert.equal(unknown.warnings.length, 1);
  assert.deepEqual(unknown.value, {});
});

test('layout: blocks, attributes, limits', () => {
  const good = { type: 'stack', children: [{ type: 'row', source: 'favourites' }, { type: 'settings' }] };
  assert.ok(validateLayout(good).ok);
  assert.equal(validateLayout({ type: 'stack', children: [{ type: 'clock' }] }).ok, false, 'needs a row or grid');
  assert.equal(validateLayout({ type: 'script' }).ok, false);
  assert.equal(validateLayout({ type: 'row', source: 'everything' }).ok, false);
  assert.equal(validateLayout({ type: 'grid', columns: 40 }).ok, false);
  assert.equal(validateLayout({ type: 'row', children: [] }).ok, false, 'row has no children');
  assert.equal(validateLayout({ type: 'stack', id: 'a', children: [{ type: 'grid', id: 'a' }] }).ok, false, 'duplicate id');
  assert.equal(validateLayout({ type: 'grid', class: 'a"><img' }).ok, false);
  const wide = { type: 'stack', children: Array.from({ length: LIMITS.layoutNodes + 1 }, () => ({ type: 'grid' })) };
  assert.equal(validateLayout(wide).ok, false);
  let deep = { type: 'grid' };
  for (let i = 0; i < LIMITS.layoutDepth; i++) deep = { type: 'stack', children: [deep] };
  assert.equal(validateLayout(deep).ok, false);
  const noSettings = validateLayout({ type: 'grid' });
  assert.ok(noSettings.ok);
  assert.match(noSettings.warnings[0], /settings/);
});

test('options: types, choices, ranges', () => {
  const r = validateOptions([
    { id: 'clock', type: 'toggle', label: 'Clock', default: true },
    { id: 'density', type: 'choice', label: 'Density', choices: ['compact', 'roomy'], default: 'roomy' },
    { id: 'tint', type: 'color', label: 'Tint', choices: [{ value: '#ff0000', label: 'Red' }] },
    { id: 'size', type: 'range', label: 'Size', min: 1, max: 2, step: 0.25, default: 9 },
  ]);
  assert.ok(r.ok, r.errors.join());
  assert.equal(r.value[1].default, 'roomy');
  assert.equal(r.value[2].default, '#ff0000');
  assert.equal(r.value[3].default, 2, 'default clamped');
  for (const bad of [
    [{ id: 'a', type: 'slider', label: 'A' }],
    [{ id: 'a', type: 'toggle' }],
    [{ id: 'a', type: 'choice', label: 'A', choices: [] }],
    [{ id: 'a', type: 'choice', label: 'A', choices: ['x y'] }],
    [{ id: 'a', type: 'color', label: 'A', choices: ['url(x)'] }],
    [{ id: 'a', type: 'range', label: 'A', min: 0, max: 100, step: 1 }],
    [{ id: 'a', type: 'toggle', label: 'A' }, { id: 'a', type: 'toggle', label: 'B' }],
  ]) assert.equal(validateOptions(bad).ok, false, JSON.stringify(bad));
});
