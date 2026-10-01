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
  // `versions`/`versionsComparable` were added by the cycle-2 fix. This assertion refusing the
  // change is the system working: the shape is load-bearing, so it is widened here explicitly rather
  // than the assertion being relaxed. One bucket of one sample is still not a pool, and now the
  // read-out also says how many policy builds the samples came from — which is how a caller learns
  // that "one bucket" might be one bucket of SEVEN different policies.
  assert.deepEqual(r.evidence, { buckets: 1, minBuckets: 8, samples: 2, minSamples: 200, versions: 1, versionsWithSamples: 1, versionsComparable: 0 },
    'and the read-out says why, so a reader need not re-derive it');
  // versionsComparable is 0, not 1, and the distinction matters: this version IS two-armed, but its
  // single bucket is below the floor so it cannot contribute to a pool. "Comparable" therefore means
  // "can contribute a figure", not merely "has both arms" — the count is about pooling, not balance.
  // versionsWithSamples was added because versions and versionsComparable were the same number on the
  // real corpus whenever every logged version had produced arms — and were NOT when the experiment
  // was off for part of the log, where 13 versions were reported and 8 held zero samples. Two counts
  // that are equal when they happen to coincide, and different when it matters, are what a reader
  // needs; one number silently covering both cases is what made "13 policy versions" wrong.
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

// ─── CYCLE 2. The pooled A/B number was comparing different versions of the policy ───────────────
//
// MEASURED on the real corpus (2026-10-01): 1,302 armed decisions spanning EIGHT code shas, three
// of which contributed scorer samples only (model=0). Depth-matched per version:
//
//   6b97d6b  buckets=33  model=267 scorer=300  delta=-0.546
//   ed4e395  buckets=20  model= 54 scorer= 54  delta=+0.227   <-- OPPOSITE SIGN
//   740dad9  buckets=14  model= 30 scorer= 35  delta=-1.001
//   ab28c5e  buckets=10  model= 15 scorer= 18  delta=-3.313
//   44188b6  buckets= 4  model= 10 scorer=  7  delta=-7.250
//
// Pooled, that averages to -0.004 — which is what the state file reported as "CONVERGED TO NULL".
// It is not a null. It is opposing signs at magnitudes spanning 13x, averaged into a number that
// reads like a clean result. Depth-matching was supposed to control for fight length; it cannot
// control for the policy having CHANGED, because the bucket key is depth and depth is not version.
const versioned = (type, hp, arm, sha, name = 'X', dirty = 0) => ({
  kind: 'decision', outcome: 'executed', code: { sha, dirty },
  deliberation: { changed: arm === 'scorer', abArm: arm },
  state: { state_type: type, battle: { enemies: [{ name, hp }] } },
});

// `depths` distinct depths for one version, `perArm` samples per arm per depth. `dirty` is the
// working-tree dirtiness the run was logged on, which is part of the policy's identity.
function buildVersion(sha, depths, perArm, modelDamage, scorerDamage, dirty = 0) {
  const ev = [];
  for (const [arm, dmg] of [['model', modelDamage], ['scorer', scorerDamage]]) {
    for (let d = 0; d < depths; d++) {
      let hp = 1000 + d * 10;
      ev.push(versioned('elite', hp, arm, sha, `${arm}${sha}${d}`, dirty));
      for (let i = 0; i < perArm; i++) { hp -= dmg; ev.push(versioned('elite', hp, arm, sha, `${arm}${sha}${d}`, dirty)); }
      ev.push({ kind: 'decision', outcome: 'executed', state: { state_type: 'rewards' } });
    }
  }
  return ev;
}

test('two versions with OPPOSITE effects must not average into a clean null', () => {
  // Version A: the scorer deals far more damage. Version B: the model deals more. Pooled by depth
  // alone these cancel to ~0 and the reader reports "no difference found", which is the exact shape
  // of the bad headline. A reader that cannot see this is worse than no reader.
  const events = [
    ...buildVersion('aaa1111', 10, 20, 1, 8),   // scorer much better here
    ...buildVersion('bbb2222', 10, 20, 8, 1),   // model better here
  ];
  const r = abImpact(events);
  assert.ok(r.byVersion.length === 2, `both versions are reported separately (got ${r.byVersion.length})`);
  const a = r.byVersion.find(v => v.sha === 'aaa1111');
  const b = r.byVersion.find(v => v.sha === 'bbb2222');
  assert.ok(a.modelDelta < 0, 'version A: scorer dealt more, so modelDelta is negative');
  assert.ok(b.modelDelta > 0, 'version B: model dealt more, so modelDelta is positive');
  assert.equal(r.signsAgree, false, 'and the reader says the signs disagree');
  assert.equal(r.poolingValid, false, 'so a pooled figure over these versions is not a result');
});

test('a single version reports no byVersion split and stays pooling-valid', () => {
  // The existing behaviour must survive for the ordinary case: one policy version, signs trivially
  // agree. Otherwise this fix breaks every reader that was working.
  const r = abImpact(buildVersion('ccc3333', 10, 20, 1, 1));
  assert.equal(r.byVersion.length, 1);
  assert.equal(r.signsAgree, true);
  assert.equal(r.poolingValid, true);
});

test('a scorer-only version is reported rather than silently pooled in', () => {
  // Three of the eight shas in the real corpus had model=0. Pooled, their samples still counted
  // toward the comparison against a model sample from a DIFFERENT version, which is not a
  // comparison at all. They must be visible as unbalanced.
  const events = [
    ...buildVersion('ddd4444', 10, 20, 1, 1),
    ...buildVersion('eee5555', 10, 20, 1, 1).map(e => (e.deliberation ? { ...e, deliberation: { ...e.deliberation, abArm: 'scorer' } } : e)),
  ];
  const r = abImpact(events);
  const solo = r.byVersion.find(v => v.sha === 'eee5555');
  assert.equal(solo.nModel, 0, 'the scorer-only version is visible');
  assert.equal(solo.nScorer > 0, true);
  assert.equal(solo.comparable, false, 'and marked not comparable');
  // The first version of this test asserted poolingValid === false here, on the reasoning that a
  // dropped version invalidates the read. That is backwards, and the test was wrong rather than the
  // code: excluding a one-armed build from the pool is what makes the remaining pool valid. The
  // honest signal is not "invalid" but "fewer versions than you think" — which is why the count is
  // reported rather than a boolean.
  assert.equal(r.poolingValid, true, 'excluding a one-armed build makes the remaining pool valid, not invalid');
  assert.equal(r.evidence.versions, 2, 'but both builds are visible');
  assert.equal(r.evidence.versionsComparable, 1, 'and the read-out says only one of them counted');
});

test('the headline number is null when pooling is invalid, so it cannot be quoted', () => {
  const events = [
    ...buildVersion('fff6666', 10, 20, 1, 8),
    ...buildVersion('9998888', 10, 20, 8, 1),
  ];
  const r = abImpact(events);
  assert.equal(r.modelDelta, null, 'a null that means "do not read this", not "no difference"');
  assert.equal(r.evidence.versions, 2);
  assert.equal(r.evidence.versionsComparable, 2, 'both are fully two-armed — it is the SIGN that voids the pool');
});

test('within-version deltas are reported even when the pooled figure is withheld', () => {
  // The per-version numbers ARE the result. Withholding the pool must not withhold the evidence.
  const events = [
    ...buildVersion('aaa1111', 10, 20, 1, 8),
    ...buildVersion('bbb2222', 10, 20, 8, 1),
  ];
  const r = abImpact(events);
  for (const v of r.byVersion) {
    assert.equal(typeof v.modelDelta, 'number', `${v.sha} has its own figure`);
    assert.ok(v.buckets >= 8, `${v.sha} cleared the bucket floor on its own`);
  }
});

// A COMMITTED sha is not a policy. `server.mjs` records `dirty` beside every sha precisely because a
// run logged on a commit with uncommitted edits cannot be reproduced from that commit, and says so
// in its own comment. Keying versions on sha alone therefore treats one commit with two different
// working trees as ONE policy — the same class of error as depth-matching a policy that had changed,
// only one level up, and invisible for the same reason: the key looked finer-grained than it was.
//
// On the real corpus `abbd694` appears at dirty=2 and dirty=5, so it is two policies under one name.
test('one sha at two dirty counts is TWO policy versions, not one', () => {
  const events = [
    ...buildVersion('ccc3333', 10, 20, 1, 8),
    ...buildVersion('ccc3333', 10, 20, 8, 1, 5),   // SAME sha, different working tree, OPPOSITE sign
  ];
  const r = abImpact(events);
  const rows = r.byVersion.filter(v => v.sha === 'ccc3333');
  assert.equal(rows.length, 2, `the dirty split is visible, got ${rows.length} row(s)`);
  assert.deepEqual(rows.map(v => v.dirty).sort(), [0, 5], 'and each row names its own dirty count');
  assert.equal(r.modelDelta, null, 'opposite signs across two policies must not average into a result');
});

// `versions` and `versionsComparable` were the same number whenever every logged version happened to
// have produced arms, and diverged when it did not: 13 versions reported, 8 of them holding zero
// armed samples because the experiment was off for those runs. A reader counting versions to judge
// how much evidence exists was counting bookkeeping as if it were evidence.
test('versions that produced no armed samples are counted apart from versions that did', () => {
  // One version with both arms, and one logged entirely while the experiment was off.
  const withArms = buildVersion('ddd4444', 10, 20, 1, 8);
  const unarmed = withArms.map(e => ({ ...e, deliberation: { ...e.deliberation, abArm: null } }));
  unarmed.forEach(e => { e.code = { ...e.code, sha: 'eee5555' }; });
  const r = abImpact([...withArms, { kind: 'decision', outcome: 'executed', state: { state_type: 'rewards' } }, ...unarmed]);
  assert.equal(r.evidence.versions, 2, 'both versions appear in the log');
  assert.equal(r.evidence.versionsWithSamples, 1, 'only one of them produced a single armed decision');
  assert.equal(r.evidence.versionsComparable, 1, 'and only one can back the pooled figure');
});
