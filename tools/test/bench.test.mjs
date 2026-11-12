import { test } from 'node:test';
import assert from 'node:assert/strict';
import { percentile, median, medianMetrics, checkGates, score, tierFor, summarize, jankPerInput, kthSlowest, rescore, LIVE_SECONDS, IDLE_SETTLE_SECONDS, IDLE_SECONDS } from '../lib/bench.mjs';

const ok = { jankPerInput: 1, p95Ms: 20, keyP95Ms: 20, idleFps: 0.1, pssMb: 140, firstFrameMs: 1300 };

test('percentile and median', () => {
  assert.equal(percentile([5, 1, 4, 2, 3], 0.5), 3);
  assert.equal(percentile([], 0.95), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test('medianMetrics ignores one disturbed run', () => {
  const m = medianMetrics([{ keyP95Ms: 18 }, { keyP95Ms: 200 }, { keyP95Ms: 20, pssMb: 140 }]);
  assert.equal(m.keyP95Ms, 20);
  assert.equal(m.pssMb, 140);
});

test('gates: strict and inclusive limits; advisory for estimates', () => {
  const g = checkGates({ ...ok, jankPerInput: 1.6, p95Ms: 23.1, idleFps: 1 }, { reference: ok });
  assert.equal(g.find(x => x.metric === 'jankPerInput').ok, false);
  assert.equal(g.find(x => x.metric === 'p95Ms').ok, false); // limit 1.15 × 20 = 23
  assert.equal(checkGates({ ...ok, jankPerInput: 1.5 }).find(x => x.metric === 'jankPerInput').ok, true);
  assert.equal(g.find(x => x.metric === 'idleFps').ok, true);
  const e = checkGates({ jankPerInput: 1, p95Ms: 20, keyP95Ms: 20 }, { estimate: true });
  assert.ok(e.every(x => x.ok === null));
});

test('score: 100 when equal or better, lower when worse; jank offset avoids divide by zero', () => {
  assert.equal(score(ok, ok), 100);
  assert.equal(score({ ...ok, pssMb: 100 }, ok), 100);
  assert.equal(score({ ...ok, jankPerInput: 0 }, { ...ok, jankPerInput: 0 }), 100);
  const worse = score({ ...ok, p95Ms: 40, pssMb: 280 }, ok);
  assert.ok(worse < 85 && worse > 60, String(worse));
});

test('tiers follow the score only when the gates pass', () => {
  assert.equal(tierFor(90, true), 'Lite');
  assert.equal(tierFor(70, true), 'Standard');
  assert.equal(tierFor(10, true), 'Rich');
  assert.equal(tierFor(90, false), null);
  const s = summarize({ skinRuns: [ok, ok, ok], refRuns: [ok, ok, ok], estimate: false });
  assert.deepEqual([s.gatesOk, s.score, s.tier], [true, 100, 'Lite']);
});

test('desktop estimates score render cost only', () => {
  const desk = { ...ok, renderMs: 80 };
  assert.equal(score({ ...desk, firstFrameMs: 3000, pssMb: 400, keyP95Ms: 200 }, desk, { estimate: true }), 100);
  assert.equal(score({ ...desk, renderMs: 320 }, desk, { estimate: true }), 25);
  assert.ok(score({ ...ok, firstFrameMs: 3000 }, ok) < 100);
});

test('jankPerInput: frames within 100 ms form one burst; keys that draw nothing do not count', () => {
  // two key presses: burst 1 has 2 janky of 3 frames, burst 2 none
  const rows = [[0, 30, 16.7], [17, 20, 16.7], [34, 10, 16.7], [600, 10, 16.7], [617, 10, 16.7]];
  assert.equal(jankPerInput(rows), 1);
  assert.equal(jankPerInput([]), null);
  // a skin without transitions: one janky frame per key is 1.0 per input (it was ~90% as a share of frames)
  assert.equal(jankPerInput([[0, 30, 16.7], [500, 30, 16.7], [1000, 10, 16.7]]), 0.67);
});

test('relative gates follow the reference measured in the same session (R15)', () => {
  // session 4 on the TV: minimal 33.8 ms / 1514 ms vs default 31.6 ms / 1495 ms failed the old absolute 33 ms / 1.5 s
  const g = checkGates({ ...ok, p95Ms: 33.8, firstFrameMs: 1514 }, { reference: { ...ok, p95Ms: 31.6, firstFrameMs: 1495 } });
  assert.deepEqual(g.filter(x => x.relative).map(x => [x.limit, x.ok]), [[36.3, true], [1719.2, true]]);
  const slow = checkGates({ ...ok, firstFrameMs: 1800 }, { reference: { ...ok, firstFrameMs: 1495 } });
  assert.equal(slow.find(x => x.metric === 'firstFrameMs').ok, false);
  assert.equal(checkGates(ok).find(x => x.metric === 'p95Ms').ok, null); // no reference: not checked
});

test('jankPerInput: frames < 100 ms apart are one key press (same cases as RuntimeGuardTest.kt)', () => {
  const rows = pairs => pairs.map(([at, janky]) => [at, janky ? 30 : 10, 16.6]);
  const threeKeys = [0, 500, 1000].flatMap(t => [[t, true], [t + 16, false], [t + 33, false]]);
  assert.equal(jankPerInput(rows(threeKeys)), 1);
  assert.equal(jankPerInput(rows([[0, true], [99, true], [198, false], [299, true], [600, true], [700, false]])), 1.33);
  assert.equal(jankPerInput(rows([[0, false], [300, false], [600, false]])), 0);
  assert.equal(jankPerInput([]), null);
});

test('p95 frame is rank-matched to the reference (R16): a skin that draws fewer frames is not penalised', () => {
  // default: 140 frames, the 7 slowest at 60 ms (its p95); Phosphor-like skin: 50 frames, 3 at 60 ms, rest 20 ms
  const ref = Array.from({ length: 140 }, (_, i) => (i < 7 ? 60 : 25));
  const few = Array.from({ length: 50 }, (_, i) => (i < 3 ? 60 : 20));
  assert.equal(kthSlowest(few, 7), 20);
  assert.equal(kthSlowest([30, 10], 7), 0); // fewer frames than the rank: the missing frames cost nothing
  const run = frameMs => ({ ...ok, p95Ms: frameMs === few ? 60 : 60, frameMs });
  const s = summarize({ skinRuns: [run(few)], refRuns: [run(ref)], estimate: false });
  assert.equal(s.p95Rank, 7);
  assert.equal(s.reference.p95Ms, 60);
  assert.equal(s.skin.p95Ms, 20); // the old p95 of its own 50 frames was 60 ms
  assert.equal(s.gates.find(g => g.metric === 'p95Ms').ok, true);
  // more frames than the reference: the same rank is compared, so extra slow frames count
  const many = Array.from({ length: 300 }, (_, i) => (i < 15 ? 80 : 20));
  assert.equal(summarize({ skinRuns: [run(many)], refRuns: [run(ref)] }).skin.p95Ms, 80);
  // runs without frame lists (desktop, old JSON) keep their own p95
  assert.equal(summarize({ skinRuns: [ok], refRuns: [ok] }).skin.p95Ms, 20);
});

test('Heavy tier (R27): only smoothness gates failed; a hard gate still means no tier', () => {
  const run = over => ({ ...ok, ...over });
  const heavy = summarize({ skinRuns: [run({ jankPerInput: 2.4, keyP95Ms: 80 })], refRuns: [ok], estimate: false });
  assert.deepEqual([heavy.gatesOk, heavy.hardOk, heavy.tier], [false, true, 'Heavy']);
  for (const over of [{ pssMb: 200 }, { idleFps: 5 }, { firstFrameMs: 3000 }, { pssMb: 200, jankPerInput: 3 }]) {
    const s = summarize({ skinRuns: [run(over)], refRuns: [ok], estimate: false });
    assert.deepEqual([s.hardOk, s.tier], [false, null], JSON.stringify(over));
  }
  assert.equal(tierFor(90, false), null); // two arguments: as before
  assert.equal(tierFor(90, false, true), 'Heavy');
});

test('idle is measured after the live window (R28): a skin may move for 20 s after a key, then it rests', async () => {
  assert.equal(LIVE_SECONDS, 20);
  assert.ok(IDLE_SETTLE_SECONDS > LIVE_SECONDS, 'the idle window must start after the motion ends');
  const src = await (await import('node:fs/promises')).readFile(new URL('../lib/bench.mjs', import.meta.url), 'utf8');
  const run = src.slice(src.indexOf('export async function tvRun'));
  assert.ok(run.indexOf('IDLE_SETTLE_SECONDS') > -1 && run.indexOf('IDLE_SETTLE_SECONDS') < run.indexOf('IDLE_SECONDS * 1000'), 'tvRun waits before the idle window');
  assert.equal(IDLE_SECONDS, 30);
});

test('rescore (lx pack --from): a saved result gets the current gates and tier; a file without runs is refused', () => {
  const slow = { ...ok, p95Ms: 30 }; // fails only the p95 gate (smoothness)
  const saved = { skinId: 'x', estimate: false, tier: null, gatesOk: false, notes: ['old'], runsDetail: { skin: [slow, slow, slow], reference: [ok, ok, ok] } };
  const b = rescore(saved);
  assert.equal(b.tier, 'Heavy');
  assert.equal(b.hardOk, true);
  assert.deepEqual(b.notes, ['old']);
  assert.deepEqual(saved.notes, ['old'], 'the saved object is not changed');
  assert.throws(() => rescore({ skin: ok, reference: ok }), /runsDetail/);
});
