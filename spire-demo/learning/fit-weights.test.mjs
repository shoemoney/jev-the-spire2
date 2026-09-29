import test from 'node:test';
import assert from 'node:assert/strict';
import {fitWeights, fitFromEvents, observedTarget, FIT_VERSION, DEFAULT_GUARDS} from './fit-weights.mjs';
import {attributeAndSummarize} from './attribute.mjs';

// The run log is gitignored, so nothing here touches it. Every corpus below is SYNTHETIC and built from
// archetypes whose class rates are worked out by hand in the tests, because the whole claim being made is
// that the fitter reports the separation that is in the rows - so the tests have to know what it is.

const ROW = (i, {y, survival, progress, waste, w = 0.8, run = 'r1', deferred = false}) => ({
  index: i, runId: run, stateType: 'monster', act: 1, floor: 2, ascension: 10, room: `1/2#${run}`,
  outcome: {turn: {survived: y > 0, hpLost: y > 0 ? 0 : 13, source: `${run}:t`}, survivedTurn: y > 0, lethal: false, roomCleared: false},
  label: {
    survival, progress, waste,
    confidence: w, sampleWeight: w,
    axisConfidence: {survival: w, progress: w, waste: w},
    deferred,
    reasons: {survival: survival === null ? 'not observed' : null, progress: null, waste: null},
  },
});

/** Expand `[archetype, count]` pairs into rows. Order is fixed, so the corpus is byte-stable. */
const build = (archetypes, run = 'r1') => {
  const rows = [];
  let i = 0;
  for (const [a, n] of archetypes) for (let k = 0; k < n; k++) rows.push(ROW(i++, {...a, run}));
  return rows;
};

// Six archetypes. The target is signed (+1 survived / -1 did not), so an axis separation is the
// DIFFERENCE OF SIGNED MEANS, and the arithmetic below is worked out so it can be checked by hand:
//
//   safe: pos = T1(+1 x40) + T3(-1 x10) -> (40-10)/50   = +0.6
//         neg = T2(+1 x10) + T4(-1 x20) -> (10-20)/30   = -0.3333    gap 0.9333
//   prog: pos = T1..T4 -> (40+10-10-20)/80 = +0.25
//         neg = T5(+1 x5) + T6(-1 x15) -> (5-15)/20 = -0.5           gap 0.75
//
// So the true ranking is safe > progress, and a fitter that recovers it has recovered something real.
const SIGNAL = [
  [{y: 1, survival: 1, progress: 1, waste: 0}, 40],  // T1
  [{y: 1, survival: -1, progress: 1, waste: 0}, 10], // T2
  [{y: -1, survival: 1, progress: 1, waste: 0}, 10], // T3
  [{y: -1, survival: -1, progress: 1, waste: 0}, 20], // T4
  [{y: 1, survival: 0, progress: -1, waste: 0}, 5],  // T5
  [{y: -1, survival: 0, progress: -1, waste: 0}, 15], // T6
];

const twoRuns = archetypes => [...build(archetypes, 'r1'), ...build(archetypes, 'r2')];
const noNaN = (value, path = 'result') => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is not finite: ${value}`);
  else if (Array.isArray(value)) value.forEach((v, i) => noNaN(v, `${path}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) noNaN(v, `${path}.${k}`);
};

test('a clear signal produces weights that recover the ranking the rows actually contain', () => {
  const fit = fitWeights(twoRuns(SIGNAL));
  assert.equal(fit.fitted, true, fit.reason ?? JSON.stringify(fit.guardsHit));
  assert.ok(fit.axes.safe.fitted && fit.axes.progress.fitted);
  // Hand-computed above: safe gap 0.9333, progress gap 0.75. The ranking is the claim; the values are
  // checked too so a silently rescaled estimator cannot pass.
  assert.equal(fit.axes.safe.separation, 0.9333);
  assert.equal(fit.axes.progress.separation, 0.75);
  assert.equal(fit.weights.safe, 0.9333);
  assert.equal(fit.weights.progress, 0.75);
  assert.ok(fit.weights.safe > fit.weights.progress, 'the stronger signal gets the larger weight');
  assert.equal(fit.proportions.safe, 0.5544);
  assert.equal(fit.proportions.progress, 0.4456);
  assert.equal(fit.weights.move, null, 'move is never fitted: no counterfactual exists in the log');
  assert.match(fit.notes.move, /never played/);
  noNaN(fit);
});

test('too few rows returns no weight object at all, not a fabricated one', () => {
  // Three rows, two runs, both classes present on both axes - everything but the volume is in order, so
  // volume is the only thing that can be refusing here.
  const thin = [
    ROW(0, {y: 1, survival: 1, progress: 1, waste: 0, run: 'r1'}),
    ROW(1, {y: -1, survival: -1, progress: 1, waste: 0, run: 'r1'}),
    ROW(2, {y: 1, survival: 1, progress: 1, waste: 0, run: 'r2'}),
  ];
  const fit = fitWeights(thin);
  assert.equal(fit.sampleSize.rowsUsedInAtLeastOneAxis, 3);
  assert.equal(fit.guardsHit.some(g => g.reason === 'single-run-corpus'), false, 'the corpus guard is not what fires here');
  assert.equal(fit.fitted, false);
  assert.equal(fit.reason, 'too-few-rows');
  assert.equal(fit.weights, null, 'a refusal must not leave a weight-shaped hole to fill in');
  assert.equal(fit.proportions, null);
  assert.equal(fit.notes, null);
  assert.match(fit.guardsHit.find(g => g.reason === 'too-few-rows').detail, /3 rows reached a fit; 12 required/);
  noNaN(fit);
});

test('an empty corpus refuses rather than returning zeros', () => {
  const fit = fitWeights([]);
  assert.equal(fit.fitted, false);
  assert.equal(fit.reason, 'no-rows');
  assert.equal(fit.weights, null);
  noNaN(fit);
});

test('an all-one-class axis refuses: no division by an empty class, and no NaN anywhere', () => {
  // Every row scores survival=+1. The negative class is empty, so the separation is undefined rather than
  // zero - and the difference matters, because zero would be emitted as a fitted weight.
  const oneSided = build([[{y: 1, survival: 1, progress: 0, waste: 0}, 20], [{y: -1, survival: 1, progress: 0, waste: 0}, 20]], 'r1')
    .concat(build([[{y: 1, survival: 1, progress: 0, waste: 0}, 20], [{y: -1, survival: 1, progress: 0, waste: 0}, 20]], 'r2'));
  const fit = fitWeights(oneSided);
  assert.equal(fit.axes.safe.fitted, false);
  assert.equal(fit.axes.safe.reason, 'one-sided');
  assert.equal(fit.axes.safe.negative, 0);
  assert.equal(fit.axes.safe.weight, null);
  assert.equal(fit.axes.safe.separation, null, 'an undefined separation is null, not 0');
  assert.equal(fit.fitted, false);
  assert.equal(fit.weights, null);
  noNaN(fit);
});

test('a target that never varies refuses instead of dividing by a constant', () => {
  // Every turn was survived, so there is no negative class on the target at all. Every axis would come
  // out at exactly 0, which looks like a finding and is not one.
  const allSurvived = twoRuns([[{y: 1, survival: 1, progress: 1, waste: 0}, 25], [{y: 1, survival: -1, progress: -1, waste: 0}, 25]]);
  const fit = fitWeights(allSurvived);
  assert.equal(fit.guardsHit.some(g => g.reason === 'degenerate-target'), true);
  assert.equal(fit.fitted, false);
  assert.equal(fit.weights, null);
  assert.match(fit.guardsHit.find(g => g.reason === 'degenerate-target').detail, /both need/);
  noNaN(fit);
});

test('a single-run corpus refuses: one run describes one character\'s deaths, not a policy', () => {
  const fit = fitWeights(build(SIGNAL));
  assert.equal(fit.guardsHit.some(g => g.reason === 'single-run-corpus'), true);
  assert.equal(fit.reason, 'single-run-corpus');
  assert.equal(fit.weights, null);
  assert.match(fit.guardsHit.find(g => g.reason === 'single-run-corpus').detail, /one character/);
});

test('low-sampleWeight rows move the fit less than high-sampleWeight rows', () => {
  // Same labels, same counts, same targets. Only the weights differ: the 4 rows that AGREE with the
  // signal carry weight 9 and the 4 that contradict it carry weight 1. A fit that treated every row
  // equally would land on 0, which is the answer "this axis means nothing" - reached from a corpus where
  // the axis in fact separates perfectly. Only the weighting tells the two apart.
  const mixed = [
    [{y: 1, survival: 1, progress: 0, waste: 0, w: 9}, 20],
    [{y: -1, survival: 1, progress: 0, waste: 0, w: 1}, 20],
    [{y: -1, survival: -1, progress: 0, waste: 0, w: 9}, 20],
    [{y: 1, survival: -1, progress: 0, waste: 0, w: 1}, 20],
  ];
  const weighted = fitWeights(twoRuns(mixed));
  const unweighted = fitWeights(twoRuns(mixed), {weightBy: 'uniform'});
  assert.equal(weighted.axes.safe.fitted, true);
  assert.equal(weighted.axes.safe.positiveRate, 0.8);
  assert.equal(weighted.axes.safe.contrastRate, -0.8);
  // 1.6 exceeds the [-1,1] a rate gap can span, because the two classes are perfectly separated and each
  // mean sits outside [0,1]. The raw separation is preserved and the WEIGHT is clamped, so the reader can
  // see that the corpus separated these classes completely rather than reading a tidy 1.0 as a measured
  // perfect score.
  assert.equal(weighted.axes.safe.separation, 1.6);
  assert.equal(weighted.axes.safe.weight, 1, 'clamped into [0,1]');
  assert.equal(unweighted.axes.safe.separation, 0, 'unweighted: the same rows cancel to nothing');
  assert.equal(weighted.axes.safe.weight > unweighted.axes.safe.weight, true);
  assert.ok(weighted.sampleSize.weightMass > unweighted.sampleSize.weightMass);
  assert.match(weighted.axes.safe.detail, /outcome-rate units/);
});

test('an unlabelled row never enters the fit as a zero, and stays countable against a measured zero', () => {
  // The distinction attribute.mjs goes to some length to preserve: a 0 with a field path behind it is
  // evidence, and a null is the absence of one. The deferred rows below are the file's own case - a cost
  // spent against a payoff this log cannot see. They are refused twice over, which is the point: the
  // labeller already set their sampleWeight to 0, and this fitter independently drops them for having no
  // label. Neither check depends on the other.
  const rows = [
    ...build([[{y: 1, survival: 1, progress: 0, waste: 0}, 8], [{y: -1, survival: -1, progress: 0, waste: 0}, 8]], 'r1'),
    ...build([[{y: 1, survival: 1, progress: 0, waste: 0}, 8], [{y: -1, survival: -1, progress: 0, waste: 0}, 8]], 'r2'),
  ];
  for (let k = 0; k < 6; k++) {
    rows.push(ROW(rows.length, {y: 1, survival: null, progress: 0, waste: null, w: 0, deferred: true}));
  }
  const fit = fitWeights(rows);
  assert.equal(fit.refused.deferredPayoffRows, 6);
  assert.equal(fit.refused.noAxisLabel, 12, '6 rows x 2 null axes, counted where they were dropped');
  assert.equal(fit.refused.noUsableWeight, 6, 'the same 6 rows, dropped again for carrying no weight');
  assert.equal(fit.axes.safe.zeroClass, 0);
  assert.equal(fit.axes.safe.rows, 32, 'the 16 measured rows per run entered; the 6 nulls did not');
  assert.equal(fit.axes.safe.positive, 16);
  assert.equal(fit.axes.safe.negative, 16);
  // The counts reconcile: every row is accounted for by exactly one of these four buckets.
  assert.equal(fit.axes.safe.rows + fit.axes.safe.noTarget + fit.axes.safe.noLabel + fit.axes.safe.noWeight, 38);
  // waste kept its 32 measured ZEROS ("spent, and converted into something measurable") and lost the 6
  // nulls, which is the whole difference the axis is about: a penalty has to be fitted against the rows
  // that spent and got a payoff, and here there is no waste>0 row to compare them to.
  assert.equal(fit.axes.waste.rows, 32);
  assert.equal(fit.axes.waste.zeroClass, 32);
  assert.equal(fit.axes.waste.noLabel, 6);
  assert.equal(fit.axes.waste.positive, 0);
  assert.equal(fit.axes.waste.fitted, false);
  assert.equal(fit.axes.waste.reason, 'one-sided');
  noNaN(fit);
});

test('measured zeros and unlabelled rows are counted apart, and an all-zero axis refuses rather than vanishing', () => {
  const zeros = [
    ...build([[{y: 1, survival: 0, progress: 0, waste: 0}, 8], [{y: -1, survival: 0, progress: 0, waste: 0}, 8]], 'r1'),
    ...build([[{y: 1, survival: 0, progress: 0, waste: 0}, 8], [{y: -1, survival: 0, progress: 0, waste: 0}, 8]], 'r2'),
  ];
  for (let k = 0; k < 4; k++) zeros.push(ROW(zeros.length, {y: 1, survival: null, progress: null, waste: null, w: 0}));
  const fit = fitWeights(zeros);
  assert.equal(fit.axes.safe.zeroClass, 32, 'a measured 0 is evidence and is kept, 32 of them');
  assert.equal(fit.axes.safe.noLabel, 4, 'a null is not evidence and is not kept');
  assert.equal(fit.axes.safe.reason, 'one-sided', 'all-measured-zero has neither a positive nor a negative class to compare');
  assert.equal(fit.axes.safe.weight, null);
  assert.equal(fit.axes.safe.contrast, 'positive-vs-negative', 'an additive axis contrasts against the opposite sign');
  noNaN(fit);
});

// A corpus where the two additive axes track the target exactly (so they fit cleanly and the test is only
// about the third axis), with the waste label deliberately correlated - or deliberately not correlated -
// with the outcome. survival and progress are both set equal to the target, so their separations are
// 1 - (-1) = 2 and their weights clamp to 1. The four counts are the waste>0 / waste=0 splits within the
// target-positive and target-negative groups, which is where the whole correlation lives.
const wasteCorpus = ({wastePos, noWastePos, wasteNeg, noWasteNeg}) => [
  ...build([[{y: 1, survival: 1, progress: 1, waste: 1}, wastePos], [{y: 1, survival: 1, progress: 1, waste: 0}, noWastePos]], 'r1'),
  ...build([[{y: -1, survival: -1, progress: -1, waste: 1}, wasteNeg], [{y: -1, survival: -1, progress: -1, waste: 0}, noWasteNeg]], 'r2'),
];

test('waste is fitted as a PENALTY against the zero class, never as a symmetric fourth weight', () => {
  // Two things are being checked, and the second is the one that is easy to get wrong. waste is never -1
  // in this corpus (attribute.mjs:33-37), so its only meaningful contrast is against the ZERO class -
  // "spent and got nothing measurable" against "spent and got something". A positive-against-negative
  // penalty fit would find an empty class in every corpus this project will ever produce.
  //
  // Arithmetic, by hand: waste>0 = 10 at +1 and 15 at -1 -> -0.2.  waste=0 = 10 at +1 and 5 at -1 -> +0.3333.
  // separation = -0.5333, and the PENALTY is its negation because combine() subtracts it.
  const fit = fitWeights(wasteCorpus({wastePos: 10, noWastePos: 10, wasteNeg: 15, noWasteNeg: 5}));
  assert.equal(fit.axes.waste.contrast, 'positive-vs-zero');
  assert.equal(fit.axes.waste.negative, 0, 'there are no negative waste labels to compare against, by design');
  assert.equal(fit.axes.waste.positive, 25);
  assert.equal(fit.axes.waste.zeroClass, 15);
  assert.equal(fit.axes.waste.fitted, true, fit.axes.waste.detail);
  assert.equal(fit.axes.waste.positiveRate, -0.2);
  assert.equal(fit.axes.waste.contrastRate, 0.3333);
  assert.equal(fit.axes.waste.separation, -0.5333);
  assert.equal(fit.fitted, true, JSON.stringify(fit.guardsHit));
  assert.equal(fit.weights.waste, 0.5333, 'the penalty is the NEGATED separation');
  assert.ok(fit.weights.waste > 0, 'a negative penalty would reward the thing the axis exists to punish');
  assert.equal(fit.weights.safe, 1);
  assert.equal(fit.weights.progress, 1);
  assert.ok(fit.weights.waste < fit.weights.safe, 'and it is on a different scale from the additive pair, which is the point');
  assert.equal(fit.proportions.waste, undefined, 'a penalty is not part of the additive split');
  assert.deepEqual(Object.keys(fit.proportions).sort(), ['progress', 'safe']);
  assert.match(fit.axes.waste.detail, /SUBTRACTED/);
  assert.match(fit.axes.waste.detail, /never -1 in this corpus/);
  noNaN(fit);
});

test('waste that does not predict harm is refused rather than emitted as a negative penalty', () => {
  // Wasted rows did no worse, so separation is POSITIVE and the penalty would come out negative. That is
  // a number that rewards wasting, which is the one thing this axis must never do. The object is still
  // emitted - because safe and progress did fit - with waste null and a reason, not with a wrong sign.
  const fit = fitWeights(wasteCorpus({wastePos: 10, noWastePos: 5, wasteNeg: 10, noWasteNeg: 15}));
  assert.equal(fit.axes.waste.fitted, false);
  assert.equal(fit.axes.waste.reason, 'waste-not-predictive');
  assert.equal(fit.axes.waste.separation, 0.5, 'wasted rows did no worse; the separation is positive');
  assert.equal(fit.fitted, true, JSON.stringify(fit.guardsHit));
  assert.equal(fit.weights.waste, null, 'this corpus did not measure a penalty, so none is claimed');
  assert.match(fit.notes.waste, /not fitted: waste-not-predictive/);
  assert.equal(fit.weights.safe, 1);
  noNaN(fit);
});

test('a class that clears the count guard but is a sliver of the contrast still refuses', () => {
  // This is the failure the share guard exists for, and it is not hypothetical: it is exactly what the
  // real 5-run log produced before the guard was added. 44 positive rows against 5 negative clears
  // minPerClass:4 comfortably, and the separation it yields is 2.0 - the theoretical maximum, i.e.
  // "perfectly separated" - computed from five data points. A number with no error bar on it, printed with
  // the same confidence as any other, is the exact shape of the thing this file refuses to emit.
  const sliver = [
    ...build([[{y: 1, survival: 1, progress: 0, waste: 0}, 22], [{y: 1, survival: -1, progress: 0, waste: 0}, 2]], 'r1'),
    ...build([[{y: 1, survival: 1, progress: 0, waste: 0}, 22], [{y: -1, survival: -1, progress: 0, waste: 0}, 3]], 'r2'),
  ];
  const fit = fitWeights(sliver, {axes: {safe: {label: 'survival', kind: 'additive'}}});
  assert.ok(fit.axes.safe.rows > DEFAULT_GUARDS.minPerClass * 2, 'the count guard would NOT have caught this');
  assert.equal(fit.axes.safe.negative, 5, 'five rows on the minority side, exactly as in the real log');
  assert.equal(fit.axes.safe.reason, 'imbalanced-class');
  assert.equal(fit.axes.safe.smallerShare, 0.102, '5 of 49');
  assert.equal(fit.axes.safe.separation, null, 'the separation is not even computed - there is nothing to compare');
  assert.equal(fit.axes.safe.weight, null);
  assert.match(fit.axes.safe.detail, /have an error bar/);
  assert.equal(fit.weights, null);
  noNaN(fit);
});

test('a target that is nearly a constant refuses, however many rows it has', () => {
  // 124 rows, 118 of them survived. Every count guard passes - 118 and 6 both clear minTargetPositives:4 -
  // and the target still is not varying. This is the real corpus's shape (471 vs 5), and against it any
  // separation is a comparison between almost the same number twice.
  const lopsided = twoRuns([[{y: 1, survival: 1, progress: 1, waste: 0}, 59], [{y: -1, survival: -1, progress: 1, waste: 0}, 3]]);
  const fit = fitWeights(lopsided);
  assert.ok(fit.sampleSize.rowsUsedInAtLeastOneAxis > 100, 'plenty of rows');
  assert.ok(fit.sampleSize.targetNegatives >= DEFAULT_GUARDS.minTargetNegatives, 'and enough on both sides to pass the count guard');
  assert.equal(fit.guardsHit.some(g => g.reason === 'degenerate-target'), false, 'the count guard does not catch this');
  assert.equal(fit.guardsHit.some(g => g.reason === 'imbalanced-target'), true, 'the share guard does');
  assert.equal(fit.reason, 'imbalanced-target');
  assert.equal(fit.sampleSize.targetShare, 0.0484, '6 of 124');
  assert.equal(fit.weights, null);
  assert.match(fit.guardsHit.find(g => g.reason === 'imbalanced-target').detail, /nearly a constant/);
  noNaN(fit);
});

test('an additive axis that points the wrong way is reported, not emitted as a negative weight', () => {
  // Rows scoring survival>0 did WORSE. A negative `safe` would make combine() reward the option that got
  // you hurt, so the axis is refused and the finding is left in `detail` where a human can read it.
  const inverted = [
    ...build([[{y: -1, survival: 1, progress: 0, waste: 0}, 10], [{y: 1, survival: -1, progress: 0, waste: 0}, 10]], 'r1'),
    ...build([[{y: -1, survival: 1, progress: 0, waste: 0}, 10], [{y: 1, survival: -1, progress: 0, waste: 0}, 10]], 'r2'),
  ];
  const fit = fitWeights(inverted, {axes: {safe: {label: 'survival', kind: 'additive'}}});
  assert.equal(fit.axes.safe.reason, 'axis-inverted');
  assert.equal(fit.axes.safe.separation, -2, 'positive class at -1, negative class at +1');
  assert.equal(fit.axes.safe.weight, null);
  assert.equal(fit.fitted, false);
  assert.equal(fit.weights, null);
  noNaN(fit);
});

test('the fit is deterministic: same rows in, deep-equal object out', () => {
  const rows = twoRuns(SIGNAL);
  assert.deepEqual(fitWeights(rows), fitWeights(rows));
  assert.deepEqual(fitWeights(rows), fitWeights(structuredClone(rows)));
  // And the serialisation is byte-identical, which is the property that actually matters downstream.
  assert.equal(JSON.stringify(fitWeights(rows)), JSON.stringify(fitWeights(rows)));
});

test('provenance names the corpus it is conditional on, and the limits that come with it', () => {
  const fit = fitWeights(twoRuns(SIGNAL));
  const p = fit.provenance;
  assert.equal(p.fitVersion, FIT_VERSION);
  assert.equal(p.corpus.runs, 2);
  assert.equal(p.corpus.rowsIn, 200);
  assert.deepEqual(p.corpus.acts, [1]);
  assert.deepEqual(p.corpus.stateTypes, ['monster']);
  assert.deepEqual(p.corpus.ascensions, [10]);
  assert.equal(p.sampleSize.rowsUsedInAtLeastOneAxis, 200);
  assert.equal(p.refused.deferredPayoffRows, 0);
  assert.equal(p.target.name, 'turnOrRoom');
  assert.deepEqual(p.target.entangledAxes, ['safe'], 'the survival/target entanglement is named, not buried');
  assert.equal(p.axes.safe.tautologicalWithTarget, true);
  assert.equal(p.method.weightBy, 'sampleWeight');
  assert.equal(p.method.random.rngUsed, false);
  assert.equal(p.method.random.seed, null);
  assert.equal(p.guards.minPerClass, DEFAULT_GUARDS.minPerClass);
  assert.equal(p.guards, fit.guards);
  // The confound text is the point of the file, so it is asserted rather than trusted to exist.
  const confounds = p.confounds.join(' ');
  assert.match(confounds, /PLAN\.md/);
  assert.match(confounds, /NOT a general fact about the game/);
  assert.match(confounds, /one character/);
  assert.match(confounds, /No counterfactual/);
  assert.match(confounds, /FIDELITY axis/);
  assert.match(confounds, /correlated within a run/);
  assert.match(p.limits.adoption, /alongside this provenance/);
  assert.match(p.limits.whatThisIsNot, /win-rate improvement/);
});

test('a refusal states plainly that the incumbent is still a guess', () => {
  const fit = fitWeights(build(SIGNAL));
  assert.equal(fit.fitted, false);
  assert.match(fit.provenance.limits.adoption, /remain a guess/);
  assert.match(fit.provenance.limits.adoption, /has not improved on that/);
});

test('the target is read from observed outcome fields, never from the labels being fitted', () => {
  const row = ROW(0, {y: 1, survival: -1, progress: -1, waste: 1});
  assert.equal(observedTarget(row, 'turnSurvived'), 1, 'the turn survived whatever the labels say about it');
  assert.equal(observedTarget({...row, outcome: {turn: null, survivedTurn: null, lethal: true, roomCleared: false}}, 'turnOrRoom'), -1);
  assert.equal(observedTarget({...row, outcome: {turn: null, survivedTurn: null, lethal: false, roomCleared: true}}, 'turnOrRoom'), 1);
  assert.equal(observedTarget({...row, outcome: {turn: null, survivedTurn: null, lethal: false, roomCleared: false}}, 'turnOrRoom'), null);
  assert.equal(observedTarget({...row, outcome: {turn: null, survivedTurn: null, lethal: false, roomCleared: false}}, 'turnSurvived'), null);
});

test('rows that carry no observed target at all are counted and excluded, not defaulted', () => {
  const rows = twoRuns([[{y: 1, survival: 1, progress: 1, waste: 0}, 10], [{y: -1, survival: -1, progress: 1, waste: 0}, 10]]);
  for (let k = 0; k < 5; k++) {
    rows.push({...ROW(rows.length, {y: 1, survival: 1, progress: 1, waste: 0, run: 'r1'}), outcome: {turn: null, survivedTurn: null, lethal: false, roomCleared: false}});
  }
  const fit = fitWeights(rows);
  assert.equal(fit.refused.noObservedTarget, 5);
  assert.equal(fit.sampleSize.rowsWithAnObservedTarget, 40);
  assert.equal(fit.sampleSize.rowsUsedInAtLeastOneAxis, 40, 'a row with no observed outcome cannot inform a fit against one');
  noNaN(fit);
});

// The end-to-end path. This is what makes attribute.mjs a consumer rather than a bystander: fit-weights
// calls the labeller, so the row shape cannot drift away from the thing producing it. It asserts the
// SHAPE of the hand-off and the honesty of the refusals, not that a fit happens - on a handful of
// synthetic fights the honest answer is a refusal, and the test says so.
test('the end-to-end path consumes attribute.mjs rows without inventing anything from them', () => {
  const enemy = (id, hp) => ({entity_id: id, name: 'Nibbit', hp, max_hp: hp, block: 0, status: [], intents: [{type: 'Attack', label: '13'}]});
  const combat = (hp, enemyHp) => ({
    state_type: 'monster', battle: {round: 1, turn: 'player', is_play_phase: true, enemies: [enemy('E0', enemyHp)]},
    run: {act: 1, floor: 2, ascension: 10}, player: {hp, max_hp: 80, block: 0, energy: 3, status: [], relics: [], potions: []},
  });
  const command = {action: 'play_card', card_index: 0, target: 'E0'};
  const forecast = {quality: 'partial', damage: 6, block: 0, incoming: 13, hpLoss: 13, hpAfter: 51, survives: true};
  const events = [];
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < 8; i++) {
      const won = i % 2 === 0;
      events.push({
        kind: 'decision', time: `t${r}-${i}`, outcome: 'executed', state: combat(64, 47),
        chosen: {id: `p${i}`, command, label: 'Strike', details: {type: 'Attack', name: 'Strike', cost: '1'}, plan: [{label: 'Strike', command}], forecast},
        candidates: [{id: `p${i}`, command, label: 'Strike', plan: [{label: 'Strike', command}], forecast}],
        answer: {type: 'choice', choice: `p${i}`, confidence: 0.3},
      });
      events.push({
        kind: 'decision', time: `t${r}-${i}b`, outcome: 'executed', state: combat(64 - (won ? 0 : 13), won ? 41 : 47),
        chosen: {id: `e${i}`, command: {action: 'end_turn'}, label: 'End turn', plan: [{label: 'End turn', command: {action: 'end_turn'}}], forecast},
        candidates: [{id: `e${i}`, command: {action: 'end_turn'}, label: 'End turn', plan: [{label: 'End turn', command: {action: 'end_turn'}}], forecast}],
        answer: {type: 'choice', choice: `e${i}`, confidence: 0.3},
      });
    }
    events.push({kind: 'run_end', time: `z${r}`, state: {state_type: 'game_over', run: {act: 1, floor: 2, ascension: 10}, player: {hp: 51, max_hp: 80}}});
  }

  const {rows, summary} = attributeAndSummarize(events);
  assert.equal(rows.length, 32);
  assert.ok(summary.attributable.rows > 0, 'the labeller found something to attribute in these events');

  const fit = fitWeights(rows);
  assert.equal(fit.version, FIT_VERSION);
  assert.equal(fit.provenance.attributionVersion, 'outcome-attribution-v1');
  assert.equal(fit.provenance.corpus.runs, 2);
  assert.ok(fit.axes.safe, 'every configured axis is reported whether or not it fitted');
  // 32 rows of two one-enemy fights is nowhere near the 12-row / 4-per-class / 2-run bar with a
  // meaningful target, so the honest outcome is a refusal. If this ever flips to fitted:true, the guard
  // thresholds have been loosened and this assertion is the thing that noticed.
  assert.equal(fit.fitted, false, '32 synthetic rows must not be enough to justify a weight');
  assert.equal(fit.weights, null);
  assert.ok(fit.guardsHit.length > 0);
  noNaN(fit);

  // Determinism holds on real labeller output too, not just on hand-built rows.
  assert.deepEqual(fitWeights(rows), fitWeights(rows));
});
