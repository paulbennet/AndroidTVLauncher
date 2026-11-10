// The agent skill and plugin manifests (skills/web-tv-launcher, .claude-plugin, plugin.json, .codex-plugin,
// .agents/plugins): valid frontmatter for every agent, links that resolve, one version everywhere, and commands that
// the repo really has. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const skillDir = join(root, 'skills', 'web-tv-launcher');
const read = p => readFileSync(join(root, p), 'utf8');
const json = p => JSON.parse(read(p));

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(m, 'SKILL.md starts with YAML frontmatter');
  const out = {}; let key = null;
  for (const line of m[1].split('\n')) {
    const top = line.match(/^([a-z][a-z-]*):\s*(.*)$/);
    if (top) { key = top[1]; out[key] = top[2]; } else if (key && /^\s+\S/.test(line)) out[key] += '\n' + line;
  }
  return out;
}

test('SKILL.md frontmatter works in every agent (agentskills.io rules)', () => {
  const fm = frontmatter(readFileSync(join(skillDir, 'SKILL.md'), 'utf8'));
  // Outside Claude Code only these keys are accepted; any other key is a hard error there.
  for (const k of Object.keys(fm)) assert.ok(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'].includes(k), `portable key: ${k}`);
  assert.equal(fm.name, 'web-tv-launcher', 'name matches the folder');
  assert.match(fm.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(fm.description.length > 50 && fm.description.length <= 1024, `description length ${fm.description.length}`);
  assert.ok(!/[<>]/.test(fm.description), 'no angle brackets in the description');
  assert.ok(fm.compatibility.length <= 500);
  assert.ok(readFileSync(join(skillDir, 'SKILL.md'), 'utf8').split('\n').length < 500, 'SKILL.md under 500 lines');
});

test('skill links and repo paths resolve', () => {
  const files = ['SKILL.md', ...readdirSync(join(skillDir, 'references')).map(f => `references/${f}`)];
  for (const f of files) {
    const md = readFileSync(join(skillDir, f), 'utf8');
    for (const [, link] of md.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
      if (/^https?:/.test(link)) continue;
      assert.ok(existsSync(join(dirname(join(skillDir, f)), link)), `${f}: ${link}`);
    }
    // Repo files the skill names in backticks must exist (docs, scripts, source files).
    for (const [, p] of md.matchAll(/`((?:docs|scripts|tools|app\/src\/main)\/[\w./-]+\.(?:md|sh|mjs|js|kt|xml))`/g))
      assert.ok(existsSync(join(root, p)) || existsSync(join(skillDir, p)), `${f}: repo or skill path ${p}`);
    for (const [, d] of md.matchAll(/docs\/([\w-]+\.md)/g)) assert.ok(existsSync(join(root, 'docs', d)), `${f}: docs/${d}`);
  }
});

test('lx commands named by the skill exist', () => {
  const usage = read('tools/lx.mjs');
  const md = [readFileSync(join(skillDir, 'SKILL.md'), 'utf8'), ...readdirSync(join(skillDir, 'references')).map(f => readFileSync(join(skillDir, 'references', f), 'utf8'))].join('\n');
  const cmds = new Set([...md.matchAll(/lx(?:\.mjs)? (new|dev|lint|bench|pack|push|install|settings|gallery)\b/g)].map(m => m[1]));
  assert.ok(cmds.size >= 8, [...cmds].join(','));
  for (const c of cmds) assert.match(usage, new RegExp(`\\n  lx ${c}\\b`), `lx ${c} in lx usage`);
});

test('one version in the app, the skill and every plugin manifest', () => {
  const app = read('app/build.gradle.kts').match(/versionName = "([^"]+)"/)[1];
  const skill = frontmatter(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).metadata.match(/version:\s*"([^"]+)"/)[1];
  const versions = {
    skill, claudePlugin: json('.claude-plugin/plugin.json').version,
    claudeMarketplace: json('.claude-plugin/marketplace.json').plugins[0].version,
    plugin: json('plugin.json').version, codexPlugin: json('.codex-plugin/plugin.json').version,
  };
  for (const [k, v] of Object.entries(versions)) assert.equal(v, app, `${k} ${v} = app ${app}`);
});

test('marketplaces point at this repo as the plugin', () => {
  const claude = json('.claude-plugin/marketplace.json');
  assert.equal(claude.plugins[0].name, json('.claude-plugin/plugin.json').name);
  assert.equal(claude.plugins[0].source, './');
  assert.ok(claude.owner && claude.owner.name);
  const codex = json('.agents/plugins/marketplace.json');
  assert.equal(codex.plugins[0].name, json('plugin.json').name);
  assert.equal(codex.plugins[0].source.path, './');
  assert.ok(['AVAILABLE', 'INSTALLED_BY_DEFAULT'].includes(codex.plugins[0].policy.installation));
  assert.ok(existsSync(join(root, '.claude-plugin', 'icon.png')));
});

test('tv-doctor.sh is valid bash and changes nothing on the TV', () => {
  const sh = readFileSync(join(skillDir, 'scripts', 'tv-doctor.sh'), 'utf8');
  // Read-only: no settings writes, appops writes, installs, force-stops, key events or reboots.
  for (const bad of [/settings put/, /appops set/, /\binstall\b(?! web-launcher\.apk)/, /force-stop/, /input keyevent/, /\breboot\b/, /\bpm (disable|uninstall|clear)/, /\brm\b/])
    assert.ok(!bad.test(sh.replace(/^#.*$/gm, '').replace(/echo ".*"/g, '').replace(/line "[^"]*" "[^"]*"/g, '')), `doctor must not use ${bad}`);
  try { execFileSync('bash', ['-n', join(skillDir, 'scripts', 'tv-doctor.sh')]); } catch (e) { assert.fail(`bash -n: ${e.stderr}`); }
});
