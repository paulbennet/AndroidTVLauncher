// Integration tests: `lx lint` renders skins in headless Chrome for Testing.  Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
async function lint(dir) {
  try {
    const { stdout } = await run(process.execPath, ['tools/lx.mjs', 'lint', dir, '--json'], { cwd: root });
    return { code: 0, r: JSON.parse(stdout) };
  } catch (e) {
    return { code: e.code, r: JSON.parse(e.stdout) };
  }
}

test('bundled skins pass lint', { timeout: 60000 }, async () => {
  for (const id of ['default', 'minimal', 'marquee', 'shelf']) {
    const { code, r } = await lint(`app/src/main/assets/web/skins/${id}`);
    assert.equal(code, 0, `${id}: ${JSON.stringify(r.errors)}`);
    assert.equal(r.stats.dom.tiles >= 50, true, 'rendered with reference data');
  }
});

test('bad fixture fails with the expected rules', { timeout: 60000 }, async () => {
  const { code, r } = await lint('tools/test/fixtures/bad-skin');
  assert.equal(code, 1);
  const got = new Set(r.errors.map(e => e.rule));
  for (const rule of ['backdrop-filter', 'transition-all', 'animated-paint', 'external-url', 'will-change', 'idle-animation', 'external-load'])
    assert.ok(got.has(rule), `missing ${rule}; got ${[...got]}`);
});

test('level 3: l3-basic passes lint (DOM checked inside the skin frame), and lx new --level 3 scaffolds a passing skin', { timeout: 90000 }, async () => {
  const basic = await lint('tools/test/fixtures/l3-basic');
  assert.equal(basic.code, 0, JSON.stringify(basic.r.errors));
  assert.ok(basic.r.stats.dom.tiles >= 50, 'frame rendered the reference apps');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const tmp = await mkdtemp(join(tmpdir(), 'lx-'));
  try {
    const dir = join(tmp, 'my-l3');
    await run(process.execPath, ['tools/lx.mjs', 'new', dir, '--level', '3'], { cwd: root });
    const made = await lint(dir);
    assert.equal(made.code, 0, JSON.stringify(made.r.errors));
    assert.equal(made.r.skin.level, 3);
  } finally { await rm(tmp, { recursive: true, force: true }); }
});
