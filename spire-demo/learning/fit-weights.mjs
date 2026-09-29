// Weight fitting: turns attributed outcomes into the numbers factored.mjs currently guesses.
//
// factored.mjs:61 ships `WEIGHTS = {move:.25, safe:.25, progress:.25, waste:1}` under the comment
// "Equal thirds because there is no labelled data yet to justify anything else." attribute.mjs is the
// labelled data that comment is waiting for. THIS FILE IS THE CONSUMER. It does not edit factored.mjs:
// it produces a weight object plus the provenance that has to travel with it, so that whoever adopts
// the numbers adopts the conditions they were measured under too.
//
// THE RULE THIS FILE EXISTS TO KEEP: a weight set that cannot be supported is not a weight set with a
// caveat attached, it is NO weight set. Every guard below returns `fitted:false` with `weights:null`.
// There is no partial-fallback, no prior, no shrinkage toward equal thirds, and no "here is a number
// anyway" path. A fitter that answers a question it cannot answer has cost more than it has saved, and
// the confidence is the part that does the damage downstream: a number in a WEIGHTS object reads as
// measured no matter what the comment above it says. PLAN.md:123 puts it plainly - "Fail loudly when
// there is not enough data to fit - never ship a number pretending to be learned."
//
// THE METHOD, and why it is this method and not regression.
//
//   For each axis A, compare the observed outcome rate of the rows A scored POSITIVE against the rows A
//   scored NEGATIVE, both as sampleWeight-weighted means. The gap is A's separation: how much this
//   corpus says that axis being right is worth, in outcome-rate units.
//
//   Rejected candidates were never played, so the log contains no counterfactual - there is nothing to
//   regress a counterfactual reward against. Separation is the most this data can support, and it is a
//   statement about THIS corpus rather than a claim about the game. Fitting anything richer (a
//   regression, a gradient step, a per-action-kind model) on one character's mostly-Act-1 deaths would
//   be fitting noise with a straight face.
//
// FOUR THINGS THIS FILE REFUSES TO DO.
//
// 1. Treat an unobserved axis as a zero. attribute.mjs emits null wherever no named field shows what the
//    action did, and nulls are NOT excluded observations - they are absent ones. A row whose waste is
//    null (the deferred-payoff rows, where a cost was spent and a delayed payoff is unobservable in this
//    window) is counted in `refused.unlabelled` and enters no fit. Measured zeros are kept: they are
//    evidence, and they are counted apart from the nulls in `axes[A].measuredZero`.
// 2. Weight every row equally. `label.sampleWeight` is the row's WEAKEST labelled axis confidence, by
//    the attribution file's own rule; a fit that ignores it promotes exactly the unattributable rows
//    that file was written to demote. Every mean below is sampleWeight-weighted, and the weight used is
//    published in provenance so the number can be recomputed by hand.
// 3. Fit `waste` like the others. It is SUBTRACTED in factored.mjs:137, so a fitted magnitude that came
//    out small does not make waste slightly unimportant, it silently converts a veto into a vote -
//    which is the exact regression the SWEEP-FINDINGS numbers in factored.mjs:52-57 were collected to
//    rule out. So the penalty is fitted on a different quantity (the drop in outcome rate among wasted
//    rows, `-separation`) and reported with its own sign convention, and a NEGATIVE penalty is never
//    emitted: if wasted rows did at least as well, the honest answer is that this corpus does not
//    support the axis, not a number that rewards wasting.
// 4. Fit `move`. `move` is the model's own probability for the chosen plan, and the log records that
//    number without ever recording what the plan would have been worth had it not been chosen.
//    attribute.mjs:487 wastedPotentialOf() is explicitly a FORECAST comparison, not an outcome, and
//    calling it one would be the same invented label this file exists to avoid. `move` is always null
//    with a reason attached.
//
// DETERMINISM: no RNG, no clock, no iteration order dependence, every emitted number rounded to 4dp and
// -0 flattened to 0. Same rows in, byte-identical object out. There is no seed because there is nothing
// to seed; `provenance.random` says so out loud rather than leaving a reader to wonder.

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {ATTRIBUTION_VERSION, attributeAndSummarize, parseJsonl, resolveLogPath} from './attribute.mjs';

export const FIT_VERSION = 'decision-weight-fit-v1';

/**
 * The three axes this fitter can speak to, and how each is used.
 *
 * `kind` is the whole reason they are not interchangeable. `additive` axes enter `combine()`'s sum;
 * `penalty` is multiplied and subtracted. A separation is only comparable within a kind, which is why
 * the additive axes are renormalised into `proportions` and the penalty is deliberately left out of it.
 */
export const DEFAULT_AXES = {
  safe: {label: 'survival', kind: 'additive'},
  progress: {label: 'progress', kind: 'additive'},
  waste: {label: 'waste', kind: 'penalty'},
};

export const DEFAULT_GUARDS = {
  // Rows that reach at least one axis fit. Below this, any separation is a mean over a handful of
  // points, and attribute.mjs's own summary refuses to print a mean without its count for that reason.
  minRows: 12,
  // Rows needed in EACH of an axis's positive and contrast class. This is the guard that makes an
  // all-one-class corpus refuse instead of dividing by an empty group.
  minPerClass: 4,
  // ...and the same class must not be a SLIVER of the contrast. A bare count is not enough: 5 rows out of
  // 446 clears `minPerClass` and then produces a separation of 2.0 - the theoretical maximum, meaning
  // "perfectly separated" - out of five data points. That is a number with no error bar, and it is the
  // shape of the confidence this project keeps having to walk back. Measured on the real corpus, where it
  // is the difference between reporting `safe: 1` and reporting nothing.
  minClassShare: 0.2,
  // A fit from a single run is a description of one character's deaths. PLAN.md:142-145 calls this out
  // directly, and one run cannot support a weight that will be applied to the next one.
  minRuns: 2,
  // The target must vary in BOTH directions, by this many rows each. An all-one-class target has no
  // variance to fit against; every axis would come out at 0 or at a divide-by-zero, and both look like
  // a finding. And as with the classes above, the minority side must be a real share of the whole: the
  // real corpus survives 471 turns and dies 5, and a target that lopsided has nothing to separate.
  minTargetPositives: 4,
  minTargetNegatives: 4,
  minTargetShare: 0.2,
  // Total sampleWeight mass. Guards against a large-looking corpus of rows that are all near-zero
  // confidence, where a mean is computed over numbers too small to carry it.
  minWeightMass: 6,
};

export const DEFAULT_TARGET = 'turnOrRoom';

export const DEFAULT_OPTIONS = {axes: DEFAULT_AXES, target: DEFAULT_TARGET, weightBy: 'sampleWeight', guards: DEFAULT_GUARDS, maxRunIds: 12};

const r4 = n => Number.isFinite(n) ? Number(n.toFixed(4)) : null;
// -0 and 0 are equal under === but not under Object.is, and `Object.is(a,-0)` in a deep-equal assertion
// fails on an otherwise identical object. Flattening it here is what makes "run it twice" actually pass.
const norm = n => { const v = r4(n); return Object.is(v, -0) ? 0 : v; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const uniq = xs => [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const isNum = v => typeof v === 'number' && Number.isFinite(v);

/**
 * The observed outcome a row is scored against, in {-1, +1, null}.
 *
 * Read ONLY from fields the log recorded about what happened, never from the labels being fitted. That
 * separation is what keeps the fit from regressing the axes against themselves.
 *
 *   turnSurvived  - the row's own turn resolved and the player was still standing. Narrow and clean.
 *   roomCleared   - the row closed its room and the fight was won, or the run died on it. Wider, but
 *                   `roomCleared` is `false` on every non-closing row, so it only carries a value on one
 *                   row per room; used alone it is far too sparse to fit on.
 *   turnOrRoom     - the union, which is the default. The extra rows it adds are room outcomes.
 *
 * KNOWN ENTANGLEMENT, stated rather than hidden: the `survival` label is itself derived from the same
 * turn resolution `turnSurvived` reads, so the survival separation is partly definitional and must not be
 * read as a discovery. It is flagged per axis (`tautologicalWithTarget`) and called out in provenance.
 * A caller who wants the survival number to mean something has to give a target further out than one
 * turn - which this corpus does not have enough of.
 */
export function observedTarget(row, targetName = DEFAULT_TARGET) {
  const t = row?.outcome?.turn ?? null;
  const survived = row?.outcome?.survivedTurn;
  const useTurn = t && typeof t.survived === 'boolean';
  const useRoom = !useTurn;
  if (targetName === 'turnSurvived') {
    return typeof survived === 'boolean' ? (survived ? 1 : -1) : null;
  }
  if (useTurn) return t.survived ? 1 : -1;
  if (targetName !== 'turnOrRoom' && targetName !== 'roomOutcome') return null;
  if (!useRoom) return null;
  if (row?.outcome?.lethal === true) return -1;
  if (row?.outcome?.roomCleared === true) return 1;
  return null;
}

/** The weight one row carries into one axis, under the chosen weighting mode. */
function weightFor(row, axis, labelName, weightBy) {
  if (weightBy === 'uniform') return 1;
  const label = row?.label ?? {};
  const w = weightBy === 'axisConfidence' ? label.axisConfidence?.[labelName] : label.sampleWeight;
  return isNum(w) && w > 0 ? w : 0;
}

/** The row's own weight, for the corpus-level totals. Same rules, without an axis in hand. */
function rowWeight(row, weightBy) {
  if (weightBy === 'uniform') return 1;
  const w = row?.label?.sampleWeight;
  return isNum(w) && w > 0 ? w : 0;
}

/** sampleWeight-weighted mean of `y` over `{y, w}` pairs. null when there is no mass to average. */
function weightedRate(pairs) {
  let mass = 0, acc = 0;
  for (const {y, w} of pairs) {
    if (!isNum(w) || w <= 0) continue;
    mass += w; acc += w * y;
  }
  if (mass <= 0) return {rate: null, mass: 0};
  return {rate: acc / mass, mass};
}

/**
 * Fit one axis. Returns a record either way - a fit or a refusal are the same shape on purpose, so a
 * caller reading the result cannot accidentally treat a missing axis as a zero.
 *
 * THE CONTRAST DEPENDS ON THE AXIS KIND, and getting this wrong is not a detail. `attribute.mjs:33-37`
 * states that `waste` is never -1 in this log: the axis has only the classes 1 ("a cost paid and
 * unconverted") and 0 ("a cost paid and converted into a measured payoff"). A penalty axis compared
 * positive-against-negative would therefore find an empty class in every corpus this project will ever
 * produce, and refuse forever for a reason that has nothing to do with the data. Its meaningful contrast
 * is positive-against-ZERO: "spent and got nothing" against "spent and got something measurable". The
 * additive axes have both directions and are compared positive-against-negative as expected. `contrast`
 * is published on the record so a reader never has to guess which comparison produced a number.
 */
function fitAxis(name, spec, rows, targets, {labelName, weightBy, guards}) {
  const label = labelName;
  const considered = rows.filter(r => targets.get(r) !== null);
  const noTarget = rows.length - considered.length;
  // Rule 1: a null label is an ABSENT observation. It is counted and then dropped, never coerced to 0.
  const labelled = considered.filter(r => isNum(r.label?.[label]));
  const usable = labelled.filter(r => weightFor(r, name, label, weightBy) > 0);
  // The three reasons a row does not reach this axis's fit, counted apart so the total reconciles:
  // rows + noTarget + noLabel + noWeight === rows.length.
  const noLabel = considered.length - labelled.length;
  const noWeight = labelled.length - usable.length;
  const refusedRows = rows.length - usable.length;
  // Rule 2 lives here: every mean below is over sampleWeight, so a low-confidence row cannot outvote a
  // well-observed one. The pairs are built per axis because the mode may weight them differently.
  const pairs = list => list.map(r => ({y: targets.get(r), w: weightFor(r, name, label, weightBy)}));
  const positive = usable.filter(r => r.label[label] > 0);
  const negative = usable.filter(r => r.label[label] < 0);
  const zeros = usable.filter(r => r.label[label] === 0);
  const contrastSide = spec.kind === 'penalty' ? zeros : negative;
  const contrast = spec.kind === 'penalty' ? 'positive-vs-zero' : 'positive-vs-negative';
  const base = {
    axis: name, label, kind: spec.kind, contrast, rows: usable.length,
    positive: positive.length, negative: negative.length, zeroClass: zeros.length,
    // Rows that carried no evidence for this axis at all. Kept beside `zeroClass` because the difference
    // is the whole point: one is an observation, the other is the absence of one, and a fitter that
    // cannot tell them apart will fit a fabricated neutral.
    noTarget, noLabel, noWeight, refused: refusedRows,
    weightBy, separation: null, weight: null, fitted: false, reason: null, detail: null,
  };

  if (usable.length < guards.minRows) {
    return {...base, reason: 'too-few-rows', detail: `${usable.length} rows carry a ${label} label with usable weight; ${guards.minRows} required`};
  }
  const sideName = spec.kind === 'penalty' ? 'zero' : 'negative';
  const sideTotal = positive.length + contrastSide.length;
  const smallerShare = sideTotal ? Math.min(positive.length, contrastSide.length) / sideTotal : 0;
  if (positive.length < guards.minPerClass || contrastSide.length < guards.minPerClass) {
    return {
      ...base, reason: 'one-sided',
      detail: `positive ${positive.length}, ${sideName} ${contrastSide.length}; an axis with no rows on the ${sideName} side has no ${contrast} separation to measure, and dividing by it would produce a number with no meaning (${guards.minPerClass} required on each side)`,
    };
  }
  if (smallerShare < guards.minClassShare) {
    // The count guard passed and the number would still be meaningless. Said separately so the report can
    // distinguish "there was no minority class" from "there was one, and it was far too small to carry a
    // separation" - the second is the more interesting failure and the easier one to miss.
    return {
      ...base, reason: 'imbalanced-class', smallerShare: norm(smallerShare),
      detail: `the ${sideName} class holds ${contrastSide.length} of the ${sideTotal} rows in this ${contrast}, a share of ${norm(smallerShare)} against a required ${guards.minClassShare}. Enough rows to divide by, nowhere near enough to have an error bar: a separation computed from this is a number with no uncertainty attached to it.`,
    };
  }
  const pos = weightedRate(pairs(positive));
  const neg = weightedRate(pairs(contrastSide));
  if (pos.rate === null || neg.rate === null) {
    return {...base, reason: 'no-weight-mass', detail: 'one side of the contrast carries zero total sampleWeight, so its mean is undefined'};
  }
  const separation = norm(pos.rate - neg.rate);
  const measured = {
    ...base, separation, positiveRate: norm(pos.rate), contrastRate: norm(neg.rate),
    positiveMass: norm(pos.mass), contrastMass: norm(neg.mass),
  };

  if (spec.kind === 'penalty') {
    // Rule 3, both halves. A penalty is fitted from the HARM a label does, so it is `-separation`, and it
    // is clamped at zero: a corpus in which wasted rows did at least as well has not measured a small
    // penalty, it has failed to measure one.
    if (separation >= 0) {
      return {...measured, reason: 'waste-not-predictive', detail: `waste>0 rows scored ${norm(pos.rate)} on the target against ${norm(neg.rate)} for waste=0 - this corpus does not show the waste axis costing anything, so no penalty is emitted`};
    }
    return {
      ...measured, fitted: true,
      weight: norm(clamp(-separation, 0, 1)),
      detail: `waste>0 rows score ${norm(pos.rate)} against ${norm(neg.rate)} for waste=0; the penalty is -separation = ${norm(-separation)}, SUBTRACTED at factored.mjs:137, not added to the other weights. The zero class is the contrast because waste is never -1 in this corpus (attribute.mjs:33-37).`,
    };
  }
  // Additive axis. A separation at or below zero means the axis points the wrong way on this corpus. That
  // is a real finding and it is reported, but it is not emitted as a negative weight: a negative `safe`
  // would make the sum in combine() reward the option that got you hurt.
  if (separation <= 0) {
    return {...measured, reason: 'axis-inverted', detail: `rows scoring ${label}>0 did no better on the target (${norm(pos.rate)}) than rows scoring ${label}<0 (${norm(neg.rate)}); no negative weight is emitted`};
  }
  return {
    ...measured, fitted: true,
    weight: norm(clamp(separation, 0, 1)),
    detail: `rows scoring ${label}>0 reached ${norm(pos.rate)} on the target against ${norm(neg.rate)} for ${label}<0; the weight is that gap, in outcome-rate units`,
  };
}

const GUARD_ORDER = ['no-rows', 'too-few-rows', 'single-run-corpus', 'degenerate-target', 'imbalanced-target', 'insufficient-weight-mass', 'no-fittable-axis'];

function corpusOf(rows) {
  const runIds = uniq(rows.map(r => r.runId ?? 'unknown'));
  return {
    rowsIn: rows.length,
    runs: runIds.length,
    runIds: runIds.slice(0, DEFAULT_OPTIONS.maxRunIds),
    runIdsTruncated: runIds.length > DEFAULT_OPTIONS.maxRunIds,
    acts: uniq(rows.map(r => r.act).filter(v => v !== null && v !== undefined)),
    floors: uniq(rows.map(r => r.floor).filter(v => v !== null && v !== undefined)),
    stateTypes: uniq(rows.map(r => r.stateType ?? 'unknown')),
    ascensions: uniq(rows.map(r => r.ascension).filter(v => v !== null && v !== undefined)),
    combatRows: rows.filter(r => ['monster', 'elite', 'boss'].includes(r.stateType)).length,
    rowsThatEndedTheRun: rows.filter(r => r.outcome?.lethal === true).length,
  };
}

/**
 * Fit decision weights from attributed rows.
 *
 * @param {Array} labelledRows  output of `attributeAndSummarize(...).rows`
 * @param {object} [options]
 * @param {object} [options.axes]    name -> {label, kind}; defaults to DEFAULT_AXES
 * @param {string} [options.target]  'turnOrRoom' | 'turnSurvived' | 'roomOutcome'
 * @param {string} [options.weightBy] 'sampleWeight' | 'axisConfidence' | 'uniform'
 * @param {object} [options.guards]  overrides for DEFAULT_GUARDS
 * @returns {{version:string, fitted:boolean, reason:string|null, weights:object|null, proportions:object|null,
 *            sampleSize:object, refused:object, axes:object, guards:object, provenance:object}}
 */
export function fitWeights(labelledRows, options = {}) {
  const opts = {...DEFAULT_OPTIONS, ...options};
  const axes = {...DEFAULT_AXES, ...(options.axes ?? {})};
  const guards = {...DEFAULT_GUARDS, ...(options.guards ?? {})};
  const target = opts.target;
  const rows = Array.isArray(labelledRows) ? labelledRows : [];

  // The observed target for every row, computed once and read by every axis and every count. A Map
  // rather than a field written back onto the row: the fitter does not mutate its input, so calling it
  // twice on the same array cannot make the second call differ from the first.
  const targets = new Map(rows.map(row => [row, observedTarget(row, target)]));

  const axisNames = Object.keys(axes);
  const axisRecords = {};
  for (const name of axisNames) {
    const record = fitAxis(name, axes[name], rows, targets, {labelName: axes[name].label, weightBy: opts.weightBy, guards});
    // Set on the record rather than at the return site so provenance reads the same value the caller sees.
    record.tautologicalWithTarget = axes[name].label === 'survival' && (target === 'turnSurvived' || target === 'turnOrRoom');
    axisRecords[name] = record;
  }

  const fittedAxes = axisNames.filter(n => axisRecords[n].fitted);
  const usedRows = rows.filter(r => targets.get(r) !== null && axisNames.some(n => isNum(r.label?.[axes[n].label]) && weightFor(r, n, axes[n].label, opts.weightBy) > 0));
  const runIds = new Set(usedRows.map(r => r.runId ?? 'unknown'));
  const targetPositives = usedRows.filter(r => targets.get(r) > 0).length;
  const targetNegatives = usedRows.filter(r => targets.get(r) < 0).length;
  const weightMass = usedRows.reduce((a, r) => a + rowWeight(r, opts.weightBy), 0);

  const corpus = corpusOf(rows);
  const targetTotal = targetPositives + targetNegatives;
  const targetShare = targetTotal ? Math.min(targetPositives, targetNegatives) / targetTotal : 0;
  const sampleSize = {
    rowsIn: rows.length,
    rowsWithAnObservedTarget: rows.filter(r => targets.get(r) !== null).length,
    rowsUsedInAtLeastOneAxis: usedRows.length,
    runsUsed: runIds.size,
    targetPositives, targetNegatives,
    // The two shares, published because they are the difference between a fit and a refusal and there is
    // no way to reconstruct them from the counts without re-deriving the whole thing.
    targetShare: norm(targetShare),
    weightMass: norm(weightMass),
    meanSampleWeight: rows.length ? norm(rows.reduce((a, r) => a + (isNum(r.label?.sampleWeight) ? r.label.sampleWeight : 0), 0) / rows.length) : null,
  };
  const refused = {
    // Split by cause, not by vibe. A row excluded because its OUTCOME was never observed is a different
    // fact from a row excluded because its LABEL was never emitted, and both are different from
    // attribute.mjs's own `deferred` flag for a cost spent against a payoff this log cannot see. None of
    // them became a zero anywhere above.
    noObservedTarget: rows.filter(r => targets.get(r) === null).length,
    noAxisLabel: axisNames.reduce((a, n) => a + axisRecords[n].noLabel, 0),
    noUsableWeight: rows.filter(r => axisNames.every(n => !isNum(r.label?.[axes[n].label]) || weightFor(r, n, axes[n].label, opts.weightBy) <= 0)).length,
    deferredPayoffRows: rows.filter(r => r.label?.deferred === true).length,
  };
  // Every guard is evaluated and reported, and `reason` is the first that failed in a FIXED order, so the
  // refusal a caller logs is the same one on every run and across every ordering of the input.
  const guardsHit = [];
  if (rows.length === 0) guardsHit.push({reason: 'no-rows', detail: 'no rows were supplied'});
  if (usedRows.length < guards.minRows) guardsHit.push({reason: 'too-few-rows', detail: `${usedRows.length} rows reached a fit; ${guards.minRows} required`});
  if (runIds.size < guards.minRuns) guardsHit.push({reason: 'single-run-corpus', detail: `${runIds.size} distinct run(s) behind these rows; ${guards.minRuns} required, because one run describes one character's deaths rather than a policy`});
  if (targetPositives < guards.minTargetPositives || targetNegatives < guards.minTargetNegatives) {
    guardsHit.push({reason: 'degenerate-target', detail: `target ${target} is +1 on ${targetPositives} rows and -1 on ${targetNegatives}; both need ${guards.minTargetPositives}. A target that never varies gives every axis a separation of 0 or a division by zero, and both read like a finding.`});
  }
  // The count guard above catches a target that does not vary; this one catches one that varies by five
  // rows. The real corpus is 471 survived turns against 5 deaths, and a fit against a 1%-minority target is
  // a fit against almost a constant.
  if (targetTotal > 0 && targetShare < guards.minTargetShare) {
    guardsHit.push({
      reason: 'imbalanced-target', share: norm(targetShare),
      detail: `the minority direction of target ${target} holds ${Math.min(targetPositives, targetNegatives)} of ${targetTotal} rows, a share of ${norm(targetShare)} against a required ${guards.minTargetShare}. The target is nearly a constant, so every separation measured against it is a comparison between almost the same number twice.`,
    });
  }
  if (weightMass < guards.minWeightMass) guardsHit.push({reason: 'insufficient-weight-mass', detail: `total sampleWeight mass ${norm(weightMass)} is below ${guards.minWeightMass}`});
  if (fittedAxes.length === 0) guardsHit.push({reason: 'no-fittable-axis', detail: `no axis produced a weight: ${axisNames.map(n => `${n}=${axisRecords[n].reason}`).join(', ')}`});

  const fitted = guardsHit.length === 0;
  const reason = fitted ? null : GUARD_ORDER.find(r => guardsHit.some(g => g.reason === r));

  // Only ever assembled when `fitted` is true. There is deliberately no `weights` object in the refusal
  // path: not `{}`, not the incumbent, not a shrunk copy of it.
  let weights = null, proportions = null, notes = null;
  if (fitted) {
    // Same key set as factored.mjs's WEIGHTS, so this can be read against it field for field. Pure
    // numbers and nulls: the explanation of every null lives in `notes`, beside the object, so a caller
    // spreading `weights` into WEIGHTS does not drag a paragraph along with it.
    const weightKeys = [...new Set([...Object.keys(DEFAULT_AXES), ...axisNames])];
    weights = Object.fromEntries(weightKeys.map(k => [k, axisRecords[k]?.fitted ? axisRecords[k].weight : null]));
    weights.move = null;
    notes = {move: MOVE_WHY};
    for (const k of weightKeys) {
      if (k === 'move' || weights[k] !== null) continue;
      notes[k] = `not fitted: ${axisRecords[k]?.reason ?? 'no axis record'}. ${axisRecords[k]?.detail ?? ''}`.trim();
    }
    const additiveTotal = fittedAxes.filter(n => axes[n].kind === 'additive').reduce((a, n) => a + axisRecords[n].weight, 0);
    // The additive axes share one sum in combine(), so their RELATIVE size is the part that transfers to
    // factored.mjs's 0.25/0.25/0.25 slot. The penalty is left out on purpose - it is subtracted, and
    // dividing a veto by a vote would recreate the bug the SWEEP numbers were gathered to rule out.
    proportions = {};
    for (const n of axisNames) {
      if (axes[n].kind !== 'additive' || !axisRecords[n].fitted) continue;
      proportions[n] = additiveTotal > 0 ? norm(axisRecords[n].weight / additiveTotal) : 0;
    }
    const propTotal = Object.values(proportions).reduce((a, b) => a + b, 0);
    if (propTotal > 0) for (const k of Object.keys(proportions)) proportions[k] = norm(proportions[k] / propTotal);
    if (Object.values(proportions).every(v => v === 0)) proportions = {};
  }

  return {
    version: FIT_VERSION, fitted, reason,
    weights, proportions, notes,
    sampleSize, refused, guards, guardsHit,
    target,
    axes: axisRecords,
    provenance: provenanceOf({rows, corpus, sampleSize, refused, guards, target, weightBy: opts.weightBy, axisRecords, axes, fitted}),
  };
}

const MOVE_WHY = 'the log records the chosen plan\'s own probability but never what that plan would have been worth had it not been chosen; rejected candidates were never played, so there is no outcome to fit move against. attribute.mjs wastedPotentialOf() is a FORECAST comparison and is deliberately not used as one.';

function provenanceOf({rows, corpus, sampleSize, refused, guards, target, weightBy, axisRecords, axes, fitted}) {
  return {
    fitVersion: FIT_VERSION,
    attributionVersion: ATTRIBUTION_VERSION,
    // The corpus is the claim's scope. Read this line before reading the weights: everything below is
    // conditional on it.
    corpus,
    sampleSize,
    refused,
    // The thresholds are part of the result, not a private implementation detail: "we fitted a weight"
    // means nothing without the bar that let it through, and a reader who wants a stricter fit needs to
    // know these are overridable and by how much.
    guards,
    target: {
      name: target,
      definition: 'observed turn survival, widened to room outcomes when the turn never resolved; read from outcome.turn.survived / outcome.survivedTurn / outcome.lethal / outcome.roomCleared only, never from the labels being fitted',
      entangledAxes: Object.keys(axes).filter(n => axisRecords[n].tautologicalWithTarget),
    },
    // The per-axis arithmetic travels with the weights, so a number is never separated from the counts
    // and the contrast that produced it. `sampleWeight` alone is not enough to recompute a fit; the class
    // sizes and which class was compared against are part of what the number means.
    axes: Object.fromEntries(Object.entries(axisRecords).map(([n, a]) => [n, {
      label: a.label, kind: a.kind, contrast: a.contrast, rows: a.rows,
      positive: a.positive, negative: a.negative, zeroClass: a.zeroClass,
      noTarget: a.noTarget, noLabel: a.noLabel, noWeight: a.noWeight,
      positiveRate: a.positiveRate ?? null, contrastRate: a.contrastRate ?? null,
      separation: a.separation, weight: a.weight, fitted: a.fitted, reason: a.reason, detail: a.detail,
      tautologicalWithTarget: a.tautologicalWithTarget,
    }])),
    method: {
      estimator: 'sampleWeight-weighted separation of the observed target between each axis\'s positive and negative label classes',
      why: 'the log holds no counterfactual - a rejected candidate was never played - so a regression has no reward to regress against. A class-mean gap is the most this data can support.',
      weightBy,
      iteration: 'none; closed form, no optimiser, no stopping criterion',
      random: {rngUsed: false, seed: null, note: 'there is no stochastic step in this fitter, so there is nothing to seed; provenance is emitted for that reason and not for symmetry with the rest of the pipeline'},
    },
    // Read these as part of the number, not as a footnote to it.
    confounds: [
      `The corpus is ${corpus.runs} run(s) across act(s) ${corpus.acts.join(',') || '?'} and ${corpus.stateTypes.join(', ')} - the labelled data in this project comes from a small number of runs of one character, mostly Act 1. A weight fitted here is a description of those runs and is NOT a general fact about the game.`,
      'PLAN.md:142-145: "The logged run is not a win-rate sample... Fitting weights to it risks overfitting to one player\'s mistakes." These weights are that fit, and they inherit that risk in full.',
      'No counterfactual exists in the data. The axes are descriptive of what was chosen, never of what was passed over, so nothing here can say a different choice would have scored higher.',
      'The `survival` axis is derived from the same turn resolution the default target reads, so its separation is partly definitional. Treat it as a consistency check on the labelling, not as a discovery about how much safety is worth.',
      'The `progress` axis is a FIDELITY axis, not a value axis (attribute.mjs:28-31): it compares realised damage against the plan\'s own claim, so a plan that did exactly what it said scores +1 even when what it did was mediocre, and a plan that under-delivered scores negative even when the under-delivery was a forecast bug. The other half of that story is attribute.mjs\'s summary.forecastAccuracy, which is kept separate there and is kept out of this fit too.',
      'The `waste` axis is never -1 in this corpus (attribute.mjs:33-37), so its penalty rests entirely on the distinction between rows scored 1 and rows scored 0, with no observed case of a lasting cost whose payoff was visible. A small sample here is the honest size of the evidence, not a bug in the axis.',
      'Rows are correlated within a run, a room and a turn. The weighted means treat them as independent samples, so the effective sample size is smaller than the row count and the separations are correspondingly less certain than they look.',
    ],
    limits: {
      whatThisIs: 'a description of which axes moved the observed outcome on THIS corpus, with the corpus named',
      whatThisIsNot: 'a validated policy parameter, a win-rate improvement, or a claim about any run outside these rows',
      adoption: fitted
        ? 'these numbers may be written into WEIGHTS only alongside this provenance, and only for the corpus described above. A weight fitted on 2 runs and applied to the 3rd is a guess with a decimal point.'
        : 'no weights were produced. The current equal-thirds in factored.mjs remain a guess, and this fit has not improved on that. Shipping the incumbent is a separate decision, made knowingly.',
    },
  };
}

/**
 * Raw events -> attributed rows -> fitted weights. The end-to-end path, and the reason this file
 * imports attribute.mjs at all: the row shape has to stay in step with the labeller, and the only way to
 * guarantee that is to call the labeller.
 */
export function fitFromEvents(events, options = {}) {
  const {rows, summary} = attributeAndSummarize(events ?? []);
  const fit = fitWeights(rows, options);
  return {...fit, summary, attribution: {rows: summary.rows, runs: summary.runs, attributable: summary.attributable, deferredPayoffRows: summary.deferredPayoffRows}};
}

export function fitFromLogText(text, options = {}) {
  return fitFromEvents(parseJsonl(text), options);
}

const pad = (s, n) => String(s).padEnd(n);
const numOut = v => (v === null || v === undefined ? 'n/a' : String(v).padStart(5));

export function formatFit(fit) {
  const w = (l = '') => console.log(l);
  w(`weight fit  ${fit.version}   (attribution ${fit.provenance.attributionVersion})`);
  w(`corpus  ${fit.provenance.corpus.runs} run(s)  ${fit.provenance.corpus.rowsIn} rows  acts [${fit.provenance.corpus.acts.join(',')}]  ${fit.provenance.corpus.stateTypes.join(', ')}`);
  w(`target  ${fit.target}   weightBy ${fit.provenance.method.weightBy}   rng used: ${fit.provenance.method.random.rngUsed}   seed: ${fit.provenance.method.random.seed}`);
  w(`used    ${fit.sampleSize.rowsUsedInAtLeastOneAxis} rows in >=1 axis  (target +1 on ${fit.sampleSize.targetPositives}, -1 on ${fit.sampleSize.targetNegatives})  weightMass ${fit.sampleSize.weightMass}`);
  w(`refused ${fit.refused.noObservedTarget} no observed outcome, ${fit.refused.noAxisLabel} rows with no axis label, ${fit.refused.noUsableWeight} with no usable weight, ${fit.refused.deferredPayoffRows} deferred-payoff rows`);
  w('');
  w(`  ${pad('axis', 10)}${pad('label', 10)}${pad('kind', 10)}${pad('contrast', 20)}${numOut('rows').padStart(5)}${numOut('pos').padStart(6)}${numOut('neg').padStart(6)}${numOut('zero').padStart(6)}${numOut('nolab').padStart(7)}  ${pad('separation', 11)}${pad('weight', 7)}`);
  for (const [name, a] of Object.entries(fit.axes)) {
    w(`  ${pad(name, 10)}${pad(a.label, 10)}${pad(a.kind, 10)}${pad(a.contrast, 20)}${numOut(a.rows).padStart(5)}${numOut(a.positive).padStart(6)}${numOut(a.negative).padStart(6)}${numOut(a.zeroClass).padStart(6)}${numOut(a.noLabel).padStart(7)}  ${pad(numOut(a.separation), 11)}${pad(numOut(a.weight), 7)}${a.fitted ? '' : `[${a.reason}]`}`);
  }
  w('');
  if (fit.fitted) {
    w(`FITTED   ${JSON.stringify(fit.weights)}`);
    w(`  proportions, additive axes only: ${JSON.stringify(fit.proportions)}`);
    for (const [k, v] of Object.entries(fit.notes ?? {})) w(`  ${k}: null - ${v}`);
  } else {
    w(`REFUSED   ${fit.reason}`);
    for (const g of fit.guardsHit) w(`  - ${g.reason}: ${g.detail}`);
    w('  No weight object was produced. The equal-thirds in factored.mjs are still a guess, and this run');
    w('  did not do better than that. Nothing here should be written into WEIGHTS.');
  }
  w('');
  w('CONFOUNDS (the numbers above are conditional on all of these)');
  for (const c of fit.provenance.confounds) w(`  - ${c}`);
  return fit;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const path = resolveLogPath();
  if (!path) {
    console.error(`No run log found. Pass a path as argv[2], set SPIRE_RUN_LOG, or put a .jsonl in .private/spire-runs/.`);
    process.exit(1);
  }
  formatFit(fitFromLogText(readFileSync(path, 'utf8')));
}

export default {fitWeights, fitFromEvents, fitFromLogText, formatFit, observedTarget, FIT_VERSION, DEFAULT_AXES, DEFAULT_GUARDS, DEFAULT_TARGET};
