#!/usr/bin/env node
// Builds the tree-shaken three.js module that the three.js gallery skins import (`./vendor/three.module.js`).
// Run: npm run build:three (before lx pack of these skins). The output is git-ignored: it is a build product.
// One shared export list keeps one build; add an export here when a skin needs it.
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKINS = ['constellation', 'tidepool', 'papercut']; // the skins that import three.js
const EXPORTS = [
  'WebGLRenderer', 'Scene', 'PerspectiveCamera', 'OrthographicCamera', 'Points', 'Mesh', 'PlaneGeometry',
  'BufferGeometry', 'BufferAttribute', 'ShaderMaterial', 'MeshBasicMaterial', 'LineSegments', 'LineBasicMaterial',
  'CanvasTexture', 'Texture', 'Color', 'Vector2', 'AdditiveBlending', 'NormalBlending', 'SRGBColorSpace', 'LinearFilter',
];
const out = join(root, 'build', 'three.module.js');
mkdirSync(join(root, 'build'), { recursive: true });
const entry = join(root, 'build', 'three-entry.mjs');
writeFileSync(entry, `export { ${EXPORTS.join(', ')} } from 'three';\n`);
await build({ entryPoints: [entry], bundle: true, minify: true, format: 'esm', outfile: out, legalComments: 'eof', logLevel: 'warning' });
for (const id of SKINS) {
  const dir = join(root, 'gallery', 'skins', id);
  if (!existsSync(dir)) continue;
  mkdirSync(join(dir, 'vendor'), { recursive: true });
  copyFileSync(out, join(dir, 'vendor', 'three.module.js'));
}
console.log(`three.module.js -> ${SKINS.map(s => `gallery/skins/${s}/vendor/`).join(', ')}`);
