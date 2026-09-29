import test from 'node:test';
import assert from 'node:assert/strict';
import { blindness, hpLossCalibration, fatalDecisions, classifyBlindnessCause, classifyWarning, CAUSES, CONTEXT_KINDS } from './metrics.mjs';

// Four failures this file exists to pin down, all of the same shape: the report was telling a
// confident story the log could not support, and the numbers it printed read as stronger
// evidence than the measurement behind them.
//
//   1. a warning that can only produce `partial` was counted as a CAUSE of `unknown`
//   2. the accuracy headline was dominated by rows where nothing happened
//   3. the cost of blindness was never measured at all
//   4. a death window could not say whether a potion was in hand
//
// SYNTHETIC EVENTS ONLY. The recorded run log is gitignored, so a test that reads it would fail
// on a clean checkout. Everything below is constructed in-process.

// `potions` is settable so a row can carry a list, carry an empty one, or omit the key entirely
// — the three states the fatal window has to tell apart.
const state = (hp, o = {}) => ({
  state_type: 'monster',
  run: { act: o.act ?? 1, floor: o.floor ?? 1, ascension: o.ascension ?? 0 },
  player: {
    hp, max_hp: 80, energy: o.energy ?? 3, block: o.block ?? 0,
    ...('potions' in o ? { potions: o.potions } : {}),
  },
  battle: { enemies: [{ entity_id: 'a', hp: 40, intents: [] }] },
  ...o.state,
});
const dec = (o = {}) => ({
  kind: 'decision',
  outcome: o.outcome ?? 'executed',
  time: '2026-01-01T00:00:00.000Z',
  state: state(o.hp ?? 50, o),
  chosen: {
    id: 'a0', label: o.label ?? 'Strike', command: { action: o.action ?? 'play_card' },
    forecast: o.forecast ?? { quality: 'partial', hpLoss: 0, survives: true, warnings: [] },
  },
});
const end = (o = {}) => ({
  kind: 'run_end', time: '2026-01-01T00:01:00.000Z',
  state: { state_type: 'game_over', run: { act: o.act ?? 1, floor: o.floor ?? 9, ascension: o.ascension ?? 7 }, player: { hp: o.hp ?? 0 } },
});
const unknown = (warnings = []) => ({ quality: 'unknown', hpLoss: null, hpAfter: null, survives: null, incoming: null, warnings });
const P = hpLoss => ({ quality: 'partial', hpLoss, survives: true, warnings: [] });

// Builds consecutive turns inside one room.
//
// The trap worth naming: a turn's HP cost lands on the FIRST decision of the NEXT turn, because
// that is the state the next turn was planned from. Both the play decision and the end_turn of
// turn k are measured against that single point, so each turn contributes two scored rows. The
// trailing decision closes the last turn so it is scorable, and is itself left unscored.
//
// Getting this backwards produces a fixture where every "actual" is negative and the numbers
// look plausible, which is the same failure mode the report is under repair for.
function turns(spec, o = {}) {
  const at = extra => dec({ hp: h, floor: o.floor ?? 1, ...(o.potions ? { potions: o.potions } : {}), ...extra });
  const ev = [];
  let h = o.hp ?? 60;
  for (const t of spec) {
    const f = t.unknown ? unknown(t.warnings ?? ['Some incoming attacks could not be parsed.']) : P(t.pred);
    ev.push(at({ forecast: f }));
    ev.push(at({ action: 'end_turn', forecast: f }));
    h -= t.actual ?? 0;
  }
  ev.push(at({ energy: 3, forecast: P(spec.at(-1)?.unknown ? 0 : (spec.at(-1)?.pred ?? 0)) }));
  return ev;
}
const loss = (pred, actual, warnings) => ({ pred, actual, warnings });
const blind = (actual, warnings) => ({ unknown: true, actual, warnings });

// ───────────────────────────────────────────────────────────── ITEM 1
test('a warning that can only produce "partial" is never counted as a cause of "unknown"', () => {
  // planner.mjs: `quality: uncertain ? 'unknown' : warnings.length ? 'partial' : 'calculated'`.
  // An unmodelled relic is a warning, so it can demote a forecast to `partial` and can never
  // produce `unknown`. In the recorded corpus it is on every single combat decision, so its
  // count among the unknowns equals the unknown count by arithmetic and explains nothing.
  const b = blindness([dec({ forecast: unknown(['Unmodeled relic: Lava Rock']) })]);
  assert.equal(b.unknown, 1);
  assert.equal('unmodeledRelic' in b.byCause, false);
  assert.equal(b.byCause.unmodeledRelic, undefined);
  // Every cause bucket now corresponds to a branch that can set `uncertain`.
  for (const cause of CAUSES) assert.ok(cause in b.byCause, `${cause} missing from byCause`);
  // ...and no warning-only family is one of them. 'other' is excluded because it is the honest
  // "no branch matched" bucket, not a named condition.
  for (const kind of CONTEXT_KINDS) if (kind !== 'other') assert.equal(kind in b.byCause, false, `${kind} must not be a cause`);
  assert.equal(classifyBlindnessCause('Unmodeled relic: Lava Rock'), 'other');
  // The warning is not thrown away: it is reported as attached context instead.
  assert.equal(b.attachedContext.unmodeledRelic, 1);
  assert.equal(b.contextOnCombat.unmodeledRelic, 1);
});

test('every cause bucket is a branch of `uncertain`, and nothing else can reach one', () => {
  // Each of planner.mjs's `uncertain` terms, with the warning that term actually pushes.
  const terms = [
    ['unparsedIncoming', 'Some incoming attacks could not be read from either the intent label or its description, so this turn has no damage ceiling: Bash.'],
    ['unparsedIncoming', 'Some incoming attacks could not be parsed.'],
    ['unsupportedCard', 'Re-observe after Patter; full consequences are not modeled.'],
    ['unsupportedCard', 'Retaliation timing or modifiers are unsupported for this action. Re-observe; survival is unknown.'],
    ['unsupportedCard', 'Energy gain amount could not be parsed.'],
    ['unresolvedDeathEffect', 'Enemy death triggers remain unresolved: do not assume victory or survival. Re-observe the death effect.'],
    ['positioningUnknown', 'Position-dependent incoming damage is not modeled; targeting can change orientation. Survival is uncertain.'],
    ['lethalTurnRule', 'A visible rule says the enemy taking its turn kills you regardless of ordinary block. Attack-only HP estimates cannot establish survival.'],
  ];
  for (const [cause, warning] of terms) assert.equal(classifyBlindnessCause(warning), cause, warning);
  // The terms are mutually exclusive in effect, so a decision can still carry several: the
  // causes are not a partition and the report says so rather than implying they sum to `unknown`.
  const b = blindness([dec({ forecast: unknown(terms.map(([, w]) => w)) })]);
  assert.equal(b.unknown, 1);
  // One decision carrying all five branches is counted under each of them, so the causes are
  // not a partition and the report says so rather than implying they sum to `unknown`.
  assert.equal(b.causeTotal, 5);
  assert.equal(b.byCauseOverlaps, true);
  assert.equal(b.unexplained, 0);
  // A warning naming no branch leaves the cause unattributed rather than guessed at.
  assert.equal(blindness([dec({ forecast: unknown(['something nobody has seen before']) })]).unexplained, 1);
  // A context warning on its own leaves the unknown unexplained, because it caused nothing.
  const relicOnly = blindness([dec({ forecast: unknown(['Unmodeled player power: Vigor']) })]);
  assert.equal(relicOnly.unexplained, 1);
  assert.equal('other' in relicOnly.byCause, false);
  assert.equal(relicOnly.causeTotal, 0);
  assert.equal(relicOnly.attachedContext.unmodeledPower, 1);
  assert.equal(classifyWarning('Unmodeled player power: Vigor'), 'unmodeledPower');
});

test('a context family that holds on every combat decision is named constant-true', () => {
  const relic = ['Unmodeled relic: Lava Rock'];
  const all = blindness(Array.from({ length: 3 }, () => dec({ forecast: unknown(relic) })));
  assert.deepEqual(all.constantTrueContext, ['unmodeledRelic']);
  assert.equal(all.contextOnCombat.unmodeledRelic, all.combatDecisions);
  // One row without it and the family stops being constant-true: detected, not hardcoded.
  const nearly = blindness([
    ...Array.from({ length: 2 }, () => dec({ forecast: unknown(relic) })),
    dec({ forecast: unknown(['Some incoming attacks could not be parsed.']) }),
  ]);
  assert.deepEqual(nearly.constantTrueContext, []);
  assert.equal(nearly.contextOnCombat.unmodeledRelic, 2);
  assert.equal(nearly.combatDecisions, 3);
  // With no combat decisions there is no corpus, so no family is claimed to be constant.
  assert.deepEqual(blindness([]).constantTrueContext, []);
  assert.equal(blindness([]).constantTrueContext.length, 0);
});

// ───────────────────────────────────────────────────────────── ITEM 2
test('non-trivial exactness is published and separates itself from raw exactness', () => {
  // Two turns where nothing happens (predicted 0, 0 landed — a forecast that agrees whether or
  // not the planner understood anything) and two where 6 and 4 land. The trivial rows are
  // legitimately scored; they just do not belong in a headline about being right.
  const t = hpLossCalibration(turns([loss(0, 0), loss(0, 0), loss(6, 6), loss(4, 4)])).turn;
  // Both figures are published. Dropping the raw one would read as a measured accuracy drop
  // rather than a change of denominator.
  assert.equal(t.scored, 8);
  assert.equal(t.exact, 8);
  assert.equal(t.exactRate, 1);
  assert.equal(t.nonTrivial.scored, 4);
  assert.equal(t.nonTrivial.exact, 4);
  assert.equal(t.nonTrivial.exactRate, 1);
  assert.equal(t.nonTrivial.trivialZeros, 4);
  // The denominators differ, and that difference is the whole point.
  assert.notEqual(t.nonTrivial.scored, t.scored);
  assert.notEqual(t.nonTrivial.trivialZeros, 0);

  // A wrong non-trivial row drags the honest figure down while raw exactness still reads high.
  const mixed = hpLossCalibration(turns([loss(0, 0), loss(0, 0), loss(6, 6), loss(6, 9)])).turn;
  assert.equal(mixed.scored, 8);
  assert.equal(mixed.exact, 6);
  assert.equal(mixed.exactRate, 6 / 8);
  assert.equal(mixed.nonTrivial.scored, 4);
  assert.equal(mixed.nonTrivial.exact, 2);
  assert.equal(mixed.nonTrivial.exactRate, 0.5);
  assert.ok(mixed.nonTrivial.exactRate < mixed.exactRate);
  // The trivial rows are exactly what propped the raw figure up.
  assert.equal(mixed.nonTrivial.trivialZeros, 4);
  assert.equal(mixed.meanAbsoluteError, (3 * 2) / 8);
  assert.ok(mixed.nonTrivial.meanAbsoluteError > mixed.meanAbsoluteError);

  // With nothing non-trivial scored the honest figure is unknown: not 0%, and not 100%.
  const allTrivial = hpLossCalibration(turns([loss(0, 0), loss(0, 0)])).turn;
  assert.equal(allTrivial.nonTrivial.scored, 0);
  assert.equal(allTrivial.nonTrivial.trivialZeros, 4);
  assert.equal(allTrivial.nonTrivial.exactRate, null);
  assert.equal(allTrivial.nonTrivial.meanAbsoluteError, null);
  assert.equal(allTrivial.exactRate, 1);
});

test('coverage states how much of combat the accuracy figures actually cover', () => {
  // Two scorable turns, then a second room whose turn never closes: it is still combat, and it
  // is not covered. The percentage alone would read as a verdict on the whole corpus.
  const t = hpLossCalibration([
    ...turns([loss(3, 3), loss(3, 3)]),
    dec({ hp: 40, floor: 2, forecast: P(9) }),
    end({ hp: 40, floor: 2 }),
  ]).turn;
  assert.equal(t.scored, 4);
  // The trailing decision of the fixture and the second room's decision are both unscoreable.
  assert.equal(t.unresolvableActual, 2);
  assert.equal(t.combatDecisions, 6);
  assert.equal(t.coverage, 4 / 6);
  // Nothing to cover: unknown, not a confident 0% and not a confident 100%.
  assert.equal(hpLossCalibration([]).turn.coverage, null);
  assert.equal(hpLossCalibration([dec({ state: { state_type: 'map' } })]).turn.coverage, null);
});

test('under- and over-prediction are counted apart, and under-prediction by >=5 hp is broken out', () => {
  // A signed mean nets a safe overestimate against a lethal underestimate and describes
  // neither, so the two directions are counted separately and the lethal one is named.
  const t = hpLossCalibration(turns([
    loss(9, 4),   // over-predicted by 5
    loss(7, 5),   // over-predicted by 2
    loss(1, 7),   // under-predicted by 6 — the direction that kills
    loss(5, 9),   // under-predicted by 4 — short, but under the threshold
  ])).turn;
  assert.equal(t.scored, 8);
  assert.equal(t.exact, 0);
  assert.equal(t.wrong, 8);
  assert.equal(t.overPredictions, 4);
  assert.equal(t.underPredictions, 4);
  assert.equal(t.lethalUndershootThreshold, 5);
  // Two rows per turn, so the one lethal undershoot is counted twice and the 4-short one never is.
  assert.equal(t.underPredictionsAtLeast5, 2);
  assert.equal(t.underPredictionsAtLeast5, t.lethalUndershoots);
  assert.equal(t.underPredictionsAtLeast5, t.errors.filter(e => e.direction === 'under' && e.actual - e.predicted >= 5).length);
  // Every wrong row is labelled with the direction it failed in, and the two agree.
  assert.equal(t.errors.filter(e => e.direction === 'under').length, 4);
  assert.equal(t.errors.filter(e => e.direction === 'over').length, 4);
  assert.equal(t.overPredictions + t.underPredictions, t.wrong);

  // A perfect forecast has no wrong rows in either direction, and a zero is not a wrong row.
  const clean = hpLossCalibration(turns([loss(0, 0), loss(0, 0)])).turn;
  assert.equal(clean.underPredictions, 0);
  assert.equal(clean.overPredictions, 0);
  assert.equal(clean.underPredictionsAtLeast5, 0);
  assert.deepEqual(clean.errors, []);
  // The trivial bucket is marked, so "count 151, exact 151" cannot read as a hard-won score.
  const zero = clean.buckets.find(b => b.label === '0');
  assert.equal(zero.count, 4);
  assert.equal(zero.exact, 4);
  assert.equal(zero.trivialExact, 4);
  assert.equal(clean.buckets.find(b => b.label === '1-4'), undefined);
  // A bucket with a non-trivial perfect score reports no trivial exact rows in it.
  const hard = hpLossCalibration(turns([loss(6, 6)])).turn;
  assert.equal(hard.buckets.find(b => b.label === '5-9').trivialExact, 0);
  assert.equal(hard.buckets.find(b => b.label === '5-9').exact, 2);
});

// ───────────────────────────────────────────────────────────── ITEM 3
test('unknown rows get a realised loss figure while staying out of the exactness denominator', () => {
  // Two blind turns that each eat 14 hp, then one sighted turn scored normally.
  const c = hpLossCalibration(turns([
    blind(14), blind(14), loss(6, 6),
  ]));
  const t = c.turn;
  // The blindness cost is measured even though no forecast was made.
  assert.notEqual(c.unknownLoss, null);
  assert.notEqual(c.unknownLoss, undefined);
  assert.equal(c.unknownLoss.rows, 4);
  assert.equal(c.unknownLoss.resolved, 4);
  assert.equal(c.unknownLoss.unresolved, 0);
  assert.equal(c.unknownLoss.meanRealisedLoss, 14);
  assert.equal(c.unknownLoss.atLeast5, 4);
  assert.deepEqual(c.unknownLoss.histogram, [{ label: '10-19', count: 4 }]);
  assert.deepEqual(c.unknownLoss.worst, { realised: 14, act: 1, floor: 1 });
  // ...and none of that leaks into the accuracy figures. A null forecast is admitted ignorance,
  // not a wrong answer, so it is not scored, not bucketed and not averaged in.
  assert.equal(t.unknownPredictions, 4);
  assert.equal(t.scored, 2);
  assert.equal(t.exact, 2);
  assert.equal(t.wrong, 0);
  assert.equal(t.meanAbsoluteError, 0);
  assert.equal(t.nonTrivial.scored, 2);
  assert.equal(t.buckets.reduce((s, b) => s + b.count, 0), 2);
  assert.deepEqual(t.errors, []);
  // 14 hp unpredicted appears as neither an error nor an accuracy figure. It is its own number.
  assert.ok(!t.errors.some(e => e.absError === 14));
  assert.equal(t.unknownLoss.atLeast5, 4);
  // The blind turns are not counted in `numericPredictions` — none of them was numeric. The three
  // that are numeric are the two decisions of the sighted turn plus the fixture's trailing row.
  assert.equal(t.numericPredictions, 3);
});

test('an unresolvable blind turn is counted as unmeasured, not as a zero loss', () => {
  // The blind row's room never closes a turn, so no actual exists. That is unknown.
  const c = hpLossCalibration([
    ...turns([blind(14)]),
    dec({ hp: 40, floor: 2, forecast: unknown(['Some incoming attacks could not be parsed.']) }),
    end({ hp: 40, floor: 2 }),
  ]);
  assert.equal(c.unknownLoss.rows, 3);
  assert.equal(c.unknownLoss.resolved, 2);
  assert.equal(c.unknownLoss.unresolved, 1);
  // Three blind rows, one unmeasured: the mean is over the two that were measured, and the
  // shortfall is stated rather than absorbed.
  assert.equal(c.unknownLoss.meanRealisedLoss, 14);
  assert.equal(c.unknownLoss.unresolved, 1);
  // Zero rows measured is not a mean of zero, and an empty histogram is not "nothing was lost".
  const none = hpLossCalibration([
    dec({ hp: 60, floor: 1, forecast: unknown(['Some incoming attacks could not be parsed.']) }),
    end({ hp: 60, floor: 1 }),
  ]);
  assert.equal(none.unknownLoss.rows, 1);
  assert.equal(none.unknownLoss.resolved, 0);
  assert.equal(none.unknownLoss.unresolved, 1);
  assert.equal(none.unknownLoss.meanRealisedLoss, null);
  assert.deepEqual(none.unknownLoss.histogram, []);
  assert.equal(none.unknownLoss.worst, null);
  assert.equal(none.unknownLoss.atLeast5, 0);
  // A corpus with no unknown forecasts reports no rows rather than a fabricated cost.
  const clean = hpLossCalibration(turns([loss(0, 0)]));
  assert.equal(clean.unknownLoss.rows, 0);
  assert.equal(clean.unknownLoss.resolved, 0);
  assert.equal(clean.unknownLoss.meanRealisedLoss, null);
  assert.equal(hpLossCalibration([]).unknownLoss.rows, 0);
  assert.notEqual(hpLossCalibration([]).unknownLoss, null);
});

test('a blind turn that cost nothing is still recorded as a measured zero', () => {
  // The distinction the whole section rests on: 0 hp lost on a blind turn is a real, measured
  // zero and belongs in the histogram. Absent stays absent.
  const c = hpLossCalibration(turns([blind(0), blind(12)]));
  assert.equal(c.unknownLoss.resolved, 4);
  assert.equal(c.unknownLoss.meanRealisedLoss, 6);
  assert.equal(c.unknownLoss.atLeast5, 2);
  assert.deepEqual(c.unknownLoss.histogram, [{ label: '0', count: 2 }, { label: '10-19', count: 2 }]);
  assert.deepEqual(c.unknownLoss.worst, { realised: 12, act: 1, floor: 1 });
  // Every bucket of the same ladder the scored rows use, so the two are comparable.
  const spread = hpLossCalibration(turns([blind(0), blind(3), blind(7), blind(14), blind(25)]));
  assert.deepEqual(spread.unknownLoss.histogram, [
    { label: '0', count: 2 }, { label: '1-4', count: 2 }, { label: '5-9', count: 2 },
    { label: '10-19', count: 2 }, { label: '20+', count: 2 },
  ]);
  assert.equal(spread.unknownLoss.atLeast5, 6);
});

// ───────────────────────────────────────────────────────────── ITEM 4
const POTION = { name: 'Fire Potion', slot: 0, can_use_in_combat: true, description: 'Deal 20 damage.' };

test('a fatal-window row exposes the potions held, slot by slot', () => {
  const events = [
    dec({ hp: 30, floor: 3, potions: [POTION, { name: 'Fortifier', slot: 1, can_use_in_combat: true }], forecast: P(0) }),
    dec({ hp: 30, action: 'end_turn', floor: 3, potions: [POTION, { name: 'Fortifier', slot: 1, can_use_in_combat: true }], forecast: unknown(['Some incoming attacks could not be parsed.']) }),
    end({ hp: 0, floor: 3 }),
  ];
  const [d] = fatalDecisions(events);
  assert.equal(d.decisions.length, 2);
  const last = d.decisions.at(-1);
  assert.notEqual(last.potions, undefined);
  assert.equal(Array.isArray(last.potions), true);
  assert.equal(last.potions.length, 2);
  assert.deepEqual(last.potions[0], { slot: 0, name: 'Fire Potion', usable: true });
  assert.deepEqual(last.potions[1], { slot: 1, name: 'Fortifier', usable: true });
  // Only the fields the report claims to show; the description is not invented away either.
  assert.deepEqual(Object.keys(last.potions[0]).sort(), ['name', 'slot', 'usable']);
  // The field is present on every row of the window, not just the last.
  assert.deepEqual(d.decisions[0].potions.length, 2);
});

test('undefined potions read as "none visible", never as an empty hand', () => {
  // The log did not record a potion list. That is UNKNOWN: it does not mean the belt was empty,
  // and printing [] would claim the agent had nothing to heal with on a board that killed it.
  const events = [
    dec({ hp: 30, floor: 3, forecast: P(0) }),
    dec({ hp: 30, action: 'end_turn', floor: 3, forecast: P(0) }),
    end({ hp: 0, floor: 3 }),
  ];
  const [d] = fatalDecisions(events);
  for (const row of d.decisions) {
    assert.equal(row.potions, null);
    assert.notEqual(row.potions, undefined);
    assert.notEqual(Array.isArray(row.potions), true);
  }
  // A recorded empty belt is a measurement of zero, and is NOT the same thing.
  const empty = fatalDecisions([
    dec({ hp: 30, floor: 3, potions: [], forecast: P(0) }),
    dec({ hp: 30, action: 'end_turn', floor: 3, potions: [], forecast: P(0) }),
    end({ hp: 0, floor: 3 }),
  ])[0];
  for (const row of empty.decisions) {
    assert.deepEqual(row.potions, []);
    assert.notEqual(row.potions, null);
  }
  // Both together in one window: the two states must stay distinguishable row by row.
  const both = fatalDecisions([
    dec({ hp: 30, floor: 3, potions: [POTION], forecast: P(0) }),
    dec({ hp: 30, action: 'end_turn', floor: 3, forecast: P(0) }),
    end({ hp: 0, floor: 3 }),
  ])[0];
  assert.equal(both.decisions[0].potions.length, 1);
  assert.equal(both.decisions[1].potions, null);
});

test('a potion missing its usability flag is unknown, not reported as unusable', () => {
  // `can_use_in_combat: false` and "never recorded" are different claims, and on a death window
  // the difference decides whether a heal was available.
  const [d] = fatalDecisions([
    dec({ hp: 30, floor: 3, potions: [
      { name: 'Fire Potion', slot: 0 },
      { name: 'Mystery Flask', slot: 1, can_use_in_combat: false },
    ], forecast: P(0) }),
    dec({ hp: 30, action: 'end_turn', floor: 3, potions: [], forecast: P(0) }),
    end({ hp: 0, floor: 3 }),
  ]);
  assert.equal(d.decisions[0].potions[0].usable, null);
  assert.equal(d.decisions[0].potions[0].slot, 0);
  assert.equal(d.decisions[0].potions[0].name, 'Fire Potion');
  assert.equal(d.decisions[0].potions[1].usable, false);
  // A non-array `potions` is a malformed record, not a hand with nothing in it.
  const junk = fatalDecisions([
    dec({ hp: 30, floor: 3, potions: 'none', forecast: P(0) }),
    dec({ hp: 30, action: 'end_turn', floor: 3, forecast: P(0) }),
    end({ hp: 0, floor: 3 }),
  ])[0];
  assert.equal(junk.decisions[0].potions, null);
});

// The four claims, asserted together against one corpus so a regression in any of them shows up
// as a single failure with the whole picture attached.
test('one synthetic corpus cannot make any of the four claims the report used to make', () => {
  // A blind turn that eats 20 hp, a trivial turn, a hard turn that is short by 7, and a potion
  // in the belt throughout.
  const POTION_HELD = [POTION];
  const events = [
    ...turns([blind(20), loss(0, 0), loss(6, 13)], { potions: POTION_HELD }),
    end({ hp: 0, floor: 1 }),
  ];
  const b = blindness(events);
  const c = hpLossCalibration(events);
  // 1. The relic is on every combat decision and is not a cause of any unknown.
  assert.equal(b.combatDecisions, 7);
  assert.equal(b.contextOnCombat.unmodeledRelic, 0);
  assert.deepEqual(b.constantTrueContext, []);
  assert.equal(b.unknown, 2);
  assert.equal('unmodeledRelic' in b.byCause, false);
  assert.equal(b.byCause.unparsedIncoming, 2);

  // 2. Accuracy is published both ways, and the trivial row does not carry the headline.
  assert.equal(c.turn.scored, 4);
  assert.equal(c.turn.exact, 2);
  assert.equal(c.turn.nonTrivial.scored, 2);
  assert.equal(c.turn.nonTrivial.exact, 0);
  assert.equal(c.turn.nonTrivial.trivialZeros, 2);
  assert.equal(c.turn.underPredictions, 2);
  assert.equal(c.turn.overPredictions, 0);
  assert.equal(c.turn.underPredictionsAtLeast5, 2);

  // 3. The blind turns' realised loss is measured: 20 hp, twice, and it is not an error.
  assert.equal(c.unknownLoss.rows, 2);
  assert.equal(c.unknownLoss.resolved, 2);
  assert.equal(c.unknownLoss.meanRealisedLoss, 20);
  assert.equal(c.unknownLoss.atLeast5, 2);
  assert.deepEqual(c.turn.errors.map(e => e.absError), [7, 7]);

  // 4. The death window can finally see what was in the belt. `turns()` gives every decision the
  // same belt, so the whole window carries the potion; the trailing row proves it is a list.
  const [d] = fatalDecisions(events);
  assert.ok(d.decisions.length > 0);
  for (const row of d.decisions) {
    assert.equal(Array.isArray(row.potions), true);
    assert.equal(row.potions[0].name, 'Fire Potion');
    assert.equal(row.potions[0].usable, true);
  }
});
