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
  assert.equal(d0.delta, 30);
  assert.equal(r.matchedDelta, 30, 'one bucket, so the pooled delta is that bucket');
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
