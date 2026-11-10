// tools/types/lx.d.ts: the level 3 starter and the bundled Shelf skin type-check against it, and mistakes show up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const dts = join(root, 'tools', 'types', 'lx.d.ts');
const check = files => {
  try {
    execFileSync(process.execPath, [tsc, '--noEmit', '--allowJs', '--checkJs', '--target', 'es2022', '--lib', 'es2022,dom',
      '--module', 'esnext', '--moduleResolution', 'bundler', ...files], { encoding: 'utf8' });
    return '';
  } catch (e) { return String(e.stdout || e.message); }
};

test('lx new --level 3 writes lx.d.ts and a skin.js that type-checks; packages leave the types out', { timeout: 60000 }, async () => {
  const dir = join(await mkdtemp(join(tmpdir(), 'lx-types-')), 'typed-skin');
  execFileSync(process.execPath, [join(root, 'tools', 'lx.mjs'), 'new', dir, '--level', '3'], { encoding: 'utf8' });
  assert.ok((await readdir(dir)).includes('lx.d.ts'));
  assert.equal(check([join(dir, 'skin.js')]), '');
  const out = execFileSync(process.execPath, [join(root, 'tools', 'lx.mjs'), 'lint', dir], { encoding: 'utf8' });
  assert.match(out, /PASS \(0 errors, 0 warnings\)/, 'lx.d.ts is not part of the package');
});

test('the bundled Shelf skin type-checks; a wrong event name or field is an error', { timeout: 60000 }, async () => {
  assert.equal(check([dts, join(root, 'app/src/main/assets/web/skins/shelf/skin.js')]), '');
  const bad = join(await mkdtemp(join(tmpdir(), 'lx-types-')), 'bad.js');
  await writeFile(bad, "// @ts-check\nlx.on('dat', d => {});\nlx.on('data', d => d.apps[0].name);\n");
  const errors = check([dts, bad]);
  assert.match(errors, /"dat"/);
  assert.match(errors, /Property 'name' does not exist/);
});
