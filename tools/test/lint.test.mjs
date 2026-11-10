// Unit tests for the Node-runnable parts of core/lint.js and the .lxskin zip writer.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { lintPackage, merge, BUDGET } from '../../app/src/main/assets/web/core/lint.js';
import { zip } from '../lib/zip.mjs';

const manifest = { id: 'x', name: 'X', version: '1.0.0', apiVersion: 1, level: 1, styles: ['skin.css'] };
const rules = r => r.errors.map(e => e.rule).sort();

test('lintPackage: clean package passes', () => {
  const r = lintPackage(manifest, [{ path: 'manifest.json', size: 200 }, { path: 'skin.css', size: 2000 }]);
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.cssBytes, 2000);
});

test('lintPackage: budgets, missing files, scripts, fonts', () => {
  const r = lintPackage({ ...manifest, layout: 'layout.json', tokens: { wallpaper: 'bg.webp' } }, [
    { path: 'skin.js', size: 10 },
    { path: 'big.css', size: BUDGET.cssBytes + 1 },
    { path: 'a.woff2', size: 200 * 1024 }, { path: 'b.woff2', size: 200 * 1024 }, { path: 'c.woff2', size: 1 },
    { path: 'old.ttf', size: 1 },
    { path: 'huge.png', size: BUDGET.packageBytes },
  ]);
  assert.deepEqual(rules(r), ['css-size', 'font-files', 'font-format', 'font-size', 'missing-file', 'missing-file', 'missing-file', 'no-script', 'package-size']);
});

test('lintPackage: invalid manifest is reported', () => {
  assert.deepEqual(rules(lintPackage({ ...manifest, apiVersion: 9 }, [])).slice(0, 1), ['manifest']);
});

test('merge collects errors and stats', () => {
  const m = merge(['a', { errors: [{ rule: 'x', message: '' }], warnings: [], stats: { n: 1 } }], ['b', { errors: [], warnings: [], stats: {} }]);
  assert.equal(m.ok, false);
  assert.deepEqual(m.stats, { a: { n: 1 }, b: {} });
});

test('zip: entries round-trip', () => {
  const data = Buffer.from('lx-tile { color: red; }\n'.repeat(50));
  const z = zip([{ name: 'skin.css', data }, { name: 'tiny.json', data: Buffer.from('{}') }]);
  assert.equal(z.readUInt32LE(0), 0x04034b50);
  const method = z.readUInt16LE(8), csize = z.readUInt32LE(18), nlen = z.readUInt16LE(26);
  const body = z.subarray(30 + nlen, 30 + nlen + csize);
  assert.equal(method, 8);
  assert.deepEqual(inflateRawSync(body), data);
  assert.equal(z.readUInt32LE(z.length - 22), 0x06054b50);
  assert.equal(z.readUInt16LE(z.length - 22 + 10), 2);
});
