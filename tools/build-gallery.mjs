#!/usr/bin/env node
// npm run gallery: builds site/gallery/ from the packages in dist/gallery/ (from `lx pack --tv`, each with a preview
// picture of the same name), then regenerates the showcase (tools/showcase.mjs). See docs/showcase.md.
import { readdirSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist', 'gallery');
if (!existsSync(dist)) { console.error('dist/gallery/ is missing: pack the skins first (docs/showcase.md)'); process.exit(1); }
const ORDER = ['constellation', 'tidepool', 'papercut', 'aquarium', 'holiday', 'coderain', 'phosphor', 'bauhaus', 'playroom'];
const pkgs = readdirSync(dist).filter(f => f.endsWith('.lxskin'))
  .sort((a, b) => (ORDER.indexOf(a.replace(/\.lxskin$/, '')) + 1 || 99) - (ORDER.indexOf(b.replace(/\.lxskin$/, '')) + 1 || 99));
if (!pkgs.length) { console.error('no .lxskin in dist/gallery/'); process.exit(1); }
rmSync(join(root, 'site', 'gallery'), { recursive: true, force: true });
const run = args => execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
run(['tools/lx.mjs', 'gallery', 'build', 'site/gallery', ...pkgs.map(p => join('dist', 'gallery', p)), '--name', 'Web TV Launcher']);
run(['tools/showcase.mjs']);
