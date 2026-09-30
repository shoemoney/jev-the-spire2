// Each test is a bug this measurement actually had, in the scripts it replaced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overrideImpact } from './metrics.mjs';

const dec = (type, hp, changed, name = 'X') => ({
  kind: 'decision', outcome: 'executed',
  deliberation: { changed },
  state: { state_type: type, battle: { enemies: [{ name, hp }] } },
});
const learned = { kind: 'learned', note: 'interleaved and NOT a fight boundary' };

test('a fight survives interleaved non-decision events', () => {
  // Treating any non-decision event as a fight boundary cut every elite fight to a single row and
  // produced an empty result that read as "no data" rather than "broken measurement".
  const r = overrideImpact([dec('elite', 100, true), learned, dec('elite', 80, true), learned, dec('elite', 60, false), dec('elite', 40, false)]);
  assert.equal(r.fights, 1, 'one fight, not four fragments');
  assert.ok(r.decisions >= 3, 'and its decisions survive the interleaving');
});

test('a turn that dealt no damage is counted as zero, not dropped as missing', () => {
  // 200 -> 150 -> 150 gives deltas of 50 and 0. The zero has to be IN the denominator: dropping
  // no-damage turns would inflate every rate in this file, which is the same class of error as
  // `Number(null) || 0` turning "unmeasured" into "nothing was dealt".
  const r = overrideImpact([dec('boss', 200, false, 'B'), dec('boss', 150, false, 'B'), dec('boss', 150, false, 'B')]);
  assert.equal(r.decisions, 2, 'the first reading has nothing to compare against');
  assert.equal(r.unmatched.nAgreed, 2, 'both deltas are present, the zero included');
  assert.equal(r.unmatched.agreed, 25, '(50 + 0) / 2 - the zero is in the denominator');
});

test('an unmatched comparison is reported, and labelled as confounded', () => {
  // Every changed decision early, every agreed one late. The raw means differ wildly and mean
  // nothing, which is exactly why the raw figure is carried under `unmatched`.
  const ev = [dec('boss', 300, true), dec('boss', 200, true), dec('boss', 100, false), dec('boss', 90, false)];
  const r = overrideImpact(ev);
  assert.ok(r.unmatched.changed > r.unmatched.agreed, 'the confounded number is visibly larger');
  assert.equal(r.matchedDelta, null, 'and it is NOT offered as an answer, because no depth had both');
});

test('at a depth where both kinds occurred, the comparison is reported', () => {
  // Two fights, and at depth 0 one of them was overridden and the other was not.
  // The override sits at depth 1, not depth 0: depth 0 is the opening reading and has no
  // previous HP to measure a delta against, so a flag there carries no outcome at all. That is easy
  // to get wrong in a fixture and impossible to get wrong in the real data.
  const a = [dec('elite', 100, false, 'A'), dec('elite', 60, true, 'A'), dec('elite', 50, false, 'A'), dec('elite', 45, false, 'A')];
  const b = [dec('elite', 100, false, 'B'), dec('elite', 90, false, 'B'), dec('elite', 85, false, 'B'), dec('elite', 80, false, 'B')];
  // Two elite fights need a non-combat screen between them, or they are one fight - which is how
  // the earlier attempt produced "depth 0 has both kinds" out of a single fight's first row.
  const r = overrideImpact([...a, dec('rewards'), ...b]);
  const d0 = r.matched.find(m => m.depth === 1);
  assert.ok(d0, 'depth 1 has both kinds and must appear');
  assert.equal(d0.changed, 40, 'the overridden decision dealt 40');
  assert.equal(d0.agreed, 10, 'the agreed one dealt 10');
  assert.equal(d0.delta, 30, 'the per-bucket delta is always reported');
  // The POOLED figure is not. One bucket with two samples is exactly the case that produced a
  // confident `modelDelta: -7.000` on live data, and a mean of means gives a 1-sample bucket the
  // same vote as a 100-sample one.
  assert.equal(r.matchedDelta, null, 'one bucket is not enough evidence to pool');
});

test('the Waterfall Giant sentinel is excluded rather than read as a billion points of damage', () => {
  // A real recurring game state, seen five times. Excluded from arithmetic and left unexplained.
  const r = overrideImpact([dec('boss', 999999984, true, 'Waterfall Giant'), dec('boss', 999999900, true, 'Waterfall Giant'), dec('elite', 100, false), dec('elite', 90, false)]);
  assert.equal(r.decisions, 1, 'only the sane fight contributes a measured delta');
  assert.ok(!Number.isFinite(r.unmatched.changed) || r.unmatched.changed < 1000, 'and no billion-point swing appears');
});

test('an empty or malformed log reports nulls, not zeroes', () => {
  for (const ev of [[], [null, {}], [{ kind: 'decision' }]]) {
    const r = overrideImpact(ev);
    assert.equal(r.matchedDelta, null, 'no comparison is available, so none is reported');
    assert.equal(r.decisions, 0);
  }
});

// The A/B reader. Compared against the confounded `overrideImpact` on the SAME data, because the
// whole point is that these are two different questions and reading the wrong one is the failure.
import { abImpact } from './metrics.mjs';

const armed = (type, hp, arm, name = 'X') => ({
  kind: 'decision', outcome: 'executed',
  deliberation: { changed: arm === 'scorer', abArm: arm },
  state: { state_type: type, battle: { enemies: [{ name, hp }] } },
});

test('abImpact separates the arms and reports null until both appear at a depth', () => {
  const only = abImpact([armed('elite', 100, 'model'), armed('elite', 80, 'model'), armed('elite', 70, 'model')]);
  assert.equal(only.modelDelta, null, 'one arm only is not a comparison');
  assert.equal(only.unmatched.nModel, 2);
  assert.equal(only.unmatched.nScorer, 0);
});

test('a single bucket never pools, however extreme its delta', () => {
  const a = [armed('elite', 100, 'model', 'A'), armed('elite', 60, 'model', 'A'), armed('elite', 50, null, 'A')];
  const b = [armed('elite', 100, 'scorer', 'B'), armed('elite', 90, 'scorer', 'B'), armed('elite', 85, null, 'B')];
  const r = abImpact([...a, { kind: 'decision', outcome: 'executed', state: { state_type: 'rewards' } }, ...b]);
  const d1 = r.matched.find(m => m.depth === 1);
  assert.ok(d1, 'depth 1 has both arms');
  assert.equal(d1.model, 40, 'the model arm dealt 40');
  assert.equal(d1.scorer, 10, 'the scorer arm dealt 10');
  assert.equal(d1.delta, 30, 'the per-bucket delta is always reported');
  assert.equal(r.modelDelta, null, 'but one bucket does not pool');
  assert.deepEqual(r.evidence, { buckets: 1, minBuckets: 8, samples: 2, minSamples: 200 },
    'and the read-out says why, so a reader need not re-derive it');
});

test('an unarmed decision is excluded rather than counted as either arm', () => {
  // The gate overrides an armed decision, and scorer/model agreement needs no arm. Counting either
  // as an arm would put decisions in a bucket they were never assigned to.
  const r = abImpact([armed('elite', 100, 'model'), armed('elite', 90, null), armed('elite', 85, null)]);
  assert.equal(r.decisions, 0);
  assert.equal(r.modelDelta, null);
});

test('the floors clear once there are enough depths AND enough samples, and then it pools', () => {
  // Build 9 depths, each with both arms and enough samples, and the pooled figure must appear.
  // Then the same shape with too few depths must not. One assertion each way, on the real reader.
  // Two SEPARATE fights per depth, one all-model and one all-scorer, so the same depth index
  // holds samples from both arms. Alternating the arms inside one fight puts them at different
  // depths and produces no matched bucket at all - which is the trap, and it cost this test twice.
  const build = (depths, perArm) => {
    const ev = [];
    for (let arm of ['model', 'scorer']) {
      for (let d = 0; d < depths; d++) {
        ev.push(armed('elite', 1000 + d * 10, arm, arm + d));
        for (let i = 0; i < perArm; i++) ev.push(armed('elite', 1000 + d * 10 - (i + 1), arm, arm + d));
        ev.push({ kind: 'decision', outcome: 'executed', state: { state_type: 'rewards' } });
      }
    }
    return ev;
  };
  const thin = abImpact(build(3, 4));
  assert.ok(thin.evidence.buckets >= 1, 'buckets exist even when thin');
  assert.equal(thin.modelDelta, null, 'but three depths do not clear the floor');

  const thick = abImpact(build(10, 20));
  assert.ok(thick.evidence.buckets >= 8, `ten depths clears the bucket floor (got ${thick.evidence.buckets})`);
  assert.ok(thick.evidence.samples >= 200, `and the sample floor (got ${thick.evidence.samples})`);
  assert.equal(typeof thick.modelDelta, 'number', 'so a pooled figure is finally reported');
  assert.ok(Math.abs(thick.modelDelta) < 5, 'and here the two arms are identical, so it is near zero');
});
