// Aggregate several scripts/probe.sh runs into one markdown summary (mean ± sd per scenario).
// Usage: node tools/probe-summary.mjs probe-results/<run1> probe-results/<run2> ...
//        node tools/probe-summary.mjs --since 2026-11-08_223244     (all runs at or after that folder name)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
let dirs;
if (args[0] === '--since') {
  dirs = readdirSync('probe-results').filter(d => d >= args[1]).sort().map(d => join('probe-results', d));
} else dirs = args;
dirs = dirs.filter(d => existsSync(join(d, 'probe.json')));
if (!dirs.length) { console.error('no runs with probe.json'); process.exit(1); }

const read = (d, f) => { try { return readFileSync(join(d, f), 'utf8'); } catch { return ''; } };

// meminfo summary lists RSS then PSS for each process; PSS is always the smaller value.
function pssMb(text, pattern) {
  const vals = text.split('\n').filter(l => pattern.test(l))
    .map(l => Number((l.match(/([\d,]+)K:/) || [])[1]?.replace(/,/g, ''))).filter(Boolean);
  return vals.length ? Math.min(...vals) / 1024 : NaN;
}

const stat = xs => {
  const v = xs.filter(x => Number.isFinite(x));
  if (!v.length) return { mean: NaN, sd: NaN, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(v.length - 1, 1));
  return { mean, sd, n: v.length, min: Math.min(...v), max: Math.max(...v) };
};
const f = (s, d = 1) => (s.n ? `${s.mean.toFixed(d)} ± ${s.sd.toFixed(d)}` : '—');

const runs = dirs.map(d => ({ dir: d, r: JSON.parse(read(d, 'probe.json')), d }));
const names = runs[0].r.scenarios.map(s => s.name);

console.log(`Runs (${runs.length}): ${dirs.map(d => d.split(/[\\/]/).pop()).join(', ')}\n`);
console.log('| Scenario | Median ms | p95 ms | Janky % | > 16.6 ms % | GPU med ms | rAF fps | Pass |');
console.log('|---|---|---|---|---|---|---|---|');
for (const name of names) {
  const ss = runs.map(x => x.r.scenarios.find(s => s.name === name)).filter(Boolean);
  const nat = k => stat(ss.map(s => s.native?.[k]));
  const passes = ss.filter(s => s.pass === true).length, judged = ss.filter(s => s.pass !== null && s.pass !== undefined).length;
  console.log(`| ${name} | ${f(nat('medianMs'))} | ${f(nat('p95Ms'))} | ${f(stat(ss.map(s => s.jankPct)))} | ${f(nat('slowPct'))} | ${f(nat('gpuMedianMs'))} | ${f(stat(ss.map(s => s.raf?.fps)), 0)} | ${judged ? `${passes}/${judged}` : 'info'} |`);
}

const mem = phase => {
  const app = stat(runs.map(x => pssMb(read(x.d, `meminfo-summary-${phase}.txt`), /com\.weblauncher\.tv/)));
  const web = stat(runs.map(x => pssMb(read(x.d, `meminfo-summary-${phase}.txt`), /sandboxed_process/)));
  const tot = stat(runs.map(x => pssMb(read(x.d, `meminfo-summary-${phase}.txt`), /com\.weblauncher\.tv/)
    + pssMb(read(x.d, `meminfo-summary-${phase}.txt`), /sandboxed_process/)));
  return `| ${phase} | ${f(app, 0)} | ${f(web, 0)} | ${f(tot, 0)} (max ${tot.max?.toFixed(0)}) |`;
};
console.log('\n| Memory PSS (MB) | Launcher | WebView renderer | Total |\n|---|---|---|---|');
console.log(mem('idle'));
console.log(mem('after-probe'));

const cold = stat(runs.map(x => Number((read(x.d, 'cold-start.txt').match(/TotalTime: (\d+)/) || [])[1])));
const first = stat(runs.map(x => { try { return JSON.parse(read(x.d, 'startup.txt').replace(/^STARTUP /, '')).processToFirstFrameMs; } catch { return NaN; } }));
console.log(`\nCold start (am start -W TotalTime): ${f(cold, 0)} ms · process start → first frame: ${f(first, 0)} ms`);
