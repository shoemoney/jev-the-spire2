import test from 'node:test';
import assert from 'node:assert/strict';
import {attributeDecisions, summarizeAttribution, attributeAndSummarize, wastedPotentialOf} from './attribute.mjs';

// The private run log is gitignored, so every test here builds the events it needs. Shapes are copied from
// .private/spire-runs: `state.battle.turn` is the phase name "player" and `state.battle.round` is the only
// thing that counts turns, only plan[0] is executed, and a dead enemy is simply missing from the next
// battle.enemies.

const enemy = (id, hp, extra = {}) => ({entity_id: id, name: extra.name ?? 'Nibbit', hp, max_hp: extra.maxHp ?? hp, block: extra.block ?? 0, status: extra.status ?? [], intents: extra.intents ?? [{type: 'Attack', label: '13'}]});
const combat = ({hp = 64, block = 0, energy = 3, enemies = [enemy('E0', 47)], round = 1, floor = 2, type = 'monster', maxHp = 80, ascension = 10} = {}) => ({
  state_type: type, battle: {round, turn: 'player', is_play_phase: true, enemies}, run: {act: 1, floor, ascension},
  player: {hp, max_hp: maxHp, block, energy, status: [], relics: [], potions: []},
});
const screen = (state_type, floor = 2, hp = 64) => ({state_type, run: {act: 1, floor, ascension: 10}, player: {hp, max_hp: 80, block: 0, energy: 0, status: [], relics: [], potions: []}});
const command = {action: 'play_card', card_index: 0, target: 'E0'};
const fc = (o = {}) => ({quality: 'partial', damage: 0, block: 0, incoming: 13, hpLoss: 13, hpAfter: 51, survives: true, ...o});
const cand = (id, o = {}) => ({id, command, label: id, details: {type: 'Attack', name: 'Strike', cost: '1', description: 'Deal 6 damage.'}, plan: [{label: id, command}], forecast: fc(o)});
const decision = ({state, chosen, candidates = [], outcome = 'executed', time = 't0'}) => ({kind: 'decision', time, outcome, state, chosen, candidates, answer: {type: 'choice', choice: chosen?.id ?? null, confidence: 0.3}});
const endTurn = ({state, forecast = fc(), time = 't0'}) => decision({state, time, chosen: {id: 'e0', command: {action: 'end_turn'}, label: 'End turn', plan: [{label: 'End turn', command: {action: 'end_turn'}}], forecast}, candidates: [{id: 'e0', command: {action: 'end_turn'}, label: 'End turn', plan: [{label: 'End turn', command: {action: 'end_turn'}}], forecast}]});
const runEnd = hp => ({kind: 'run_end', time: 'z', state: {state_type: 'game_over', run: {act: 1, floor: 2, ascension: 10}, player: {hp, max_hp: 80}}});
const play = (o) => decision({state: o.state ?? combat(), time: o.time, candidates: o.candidates ?? [], chosen: {id: o.id ?? 'p0', command, label: o.label ?? 'Strike', details: {type: o.cardType ?? 'Attack', name: 'Strike', cost: '1', description: o.description ?? 'Deal 6 damage.'}, plan: o.plan ?? [{label: 'Strike', command}], forecast: o.forecast ?? fc()}});
const labels = events => attributeDecisions(events).map(r => r.label);
const rowsOf = events => attributeDecisions(events);

test('an attack that dealt what its single-step plan claimed is positive progress, traced to the field that proves it', () => {
  const rows = rowsOf([play({state: combat(), forecast: fc({damage: 6, block: 0, hpLoss: 13}), candidates: [cand('p0', {damage: 6})]}), play({state: combat({energy: 2, enemies: [enemy('E0', 41)]}), time: 't1'})]);
  assert.equal(rows[0].label.progress, 1);
  assert.equal(rows[0].outcome.damageDealt, 6);
  assert.match(rows[0].rationale, /chosen\.forecast\.damage claimed 6/);
  assert.match(rows[0].rationale, /enemies\[\]\.hp fell by 6/);
  assert.equal(rows[0].actionKind, 'attack');
});

test('block that absorbed the incoming is positive survival; block that was on the board and the HP still went is negative', () => {
  const defend = (blockGain, hpAfter) => [
    play({id: 'd0', cardType: 'Skill', description: `Gain ${blockGain} Block.`, label: 'Defend', forecast: fc({damage: 0, block: blockGain, incoming: 13, hpLoss: 0, survives: true, hpAfter: 64}), candidates: [cand('d0', {damage: 0, block: blockGain})]}),
    endTurn({state: combat({energy: 2, block: blockGain})}),
    play({state: combat({hp: hpAfter, block: 0, round: 2}), time: 't2'}),
  ];
  const held = rowsOf(defend(13, 64))[0];
  assert.equal(held.label.survival, 1, 'the incoming was fully absorbed');
  assert.match(held.evidence.survival, /forecast\.incoming 13/);
  // 20 block on the board against 13 incoming and 13 HP still gone: something the decision did not account for.
  const failed = rowsOf(defend(20, 51))[0];
  assert.equal(failed.label.survival, -1);
  assert.match(failed.evidence.survival, /20 block was on the board/);
  // Block that is simply outgunned is the card doing its job, not a survival failure.
  const outgunned = rowsOf(defend(5, 56))[0];
  assert.equal(outgunned.label.survival, 0);
  assert.match(outgunned.evidence.survival, /absorbed part of the incoming/);
});

test('a decision whose outcome never executed carries no label at all', () => {
  for (const outcome of ['game_rejected', 'stale_rejected', 'cancelled', 'preview']) {
    const rows = rowsOf([decision({state: combat(), outcome, chosen: {id: 'p0', command, label: 'Strike', plan: [{label: 'x', command}], forecast: fc({damage: 6})}, candidates: [cand('p0', {damage: 6})]}), play({state: combat({energy: 2, enemies: [enemy('E0', 41)]}), time: 't1'})]);
    assert.deepEqual([rows[0].label.survival, rows[0].label.progress, rows[0].label.waste], [null, null, null], outcome);
    assert.equal(rows[0].label.confidence, 0, outcome);
    assert.equal(rows[0].label.sampleWeight, 0, outcome);
    assert.match(rows[0].label.reasons.progress, new RegExp(`outcome ${outcome}`));
  }
});

test('a decision whose next observation is a different room is unattributable, not a fabricated neutral', () => {
  // Non-combat screen: there is no combat window to observe at all, and 0 would be a fiction.
  const screenRows = rowsOf([decision({state: screen('map', 3), chosen: {id: 'm0', command: {action: 'choose_map_node', index: 2}, label: 'Travel', plan: []}}), decision({state: combat({floor: 4}), time: 't1', chosen: {id: 'p0', command, plan: [{label: 'x', command}], forecast: fc()}})]);
  assert.deepEqual([screenRows[0].label.survival, screenRows[0].label.progress, screenRows[0].label.waste], [null, null, null]);
  assert.equal(screenRows[0].label.confidence, 0);
  assert.match(screenRows[0].label.reasons.survival, /state_type map is not a combat state/);
  // A combat room followed straight by another combat room is not a clear, so nothing is claimed from it.
  const combatRows = rowsOf([endTurn({state: combat()}), decision({state: combat({floor: 5, type: 'elite'}), time: 't1', chosen: {id: 'p0', command, plan: [{label: 'x', command}], forecast: fc()}})]);
  assert.equal(combatRows[0].outcome.roomCleared, false);
  assert.equal(combatRows[0].label.progress, null);
  assert.equal(combatRows[0].outcome.runEnded, false);
  // A combat room followed by the rewards screen IS a win, and it is read off the log rather than assumed.
  const won = rowsOf([play({state: combat(), forecast: fc({damage: 6})}), decision({state: screen('rewards', 2, 64), time: 't1', chosen: {id: 'r0', command: {action: 'claim_reward'}, plan: []}})]);
  assert.equal(won[0].outcome.roomCleared, true);
  assert.equal(won[0].label.progress, 1);
});

test('a forecast that was wrong stays in the forecast column and does not become the decision label', () => {
  // The strike lands its 6. The turn then costs 8 HP the forecast said would be 0. The decision is scored on
  // what it did; the miss is reported by the summary's forecast accuracy block and nowhere else.
  const events = [
    play({state: combat(), forecast: fc({damage: 6, incoming: 0, hpLoss: 0, hpAfter: 64}), candidates: [cand('p0', {damage: 6})]}),
    endTurn({state: combat({energy: 2, enemies: [enemy('E0', 41)]}), forecast: fc({damage: 0, incoming: 0, hpLoss: 0, hpAfter: 64, survives: true})}),
    play({state: combat({hp: 56, block: 0, round: 2, enemies: [enemy('E0', 41)]}), time: 't2'}),
  ];
  const rows = rowsOf(events);
  assert.equal(rows[0].label.progress, 1, 'the attack delivered its claim');
  assert.equal(rows[1].outcome.turn.hpLost, 8, 'the miss is observable at the turn resolution');
  const {summary} = attributeAndSummarize(events);
  assert.equal(summary.forecastAccuracy.optimistic, 1, 'the turn cost 8 HP the forecast said would cost 0');
  assert.equal(summary.forecastAccuracy.pessimistic, 0);
  assert.equal(rows[0].forecast.incoming, 0, 'the wrong number is still published in the forecast column');
});

test('only plan[0] runs, so a multi-step plan is scored against the single-step candidate for that same command', () => {
  // Run 1 of the real log: a 3-step plan claiming 14, of which only Strike (6) executed. A plan forecast of 14
  // is not a claim about this action and must never be the thing progress is measured against.
  const multi = [{label: 'Strike', command}, {label: 'Defend', command: {action: 'play_card', card_index: 2}}];
  const rows = rowsOf([
    play({plan: multi, forecast: fc({damage: 14}), candidates: [cand('s0', {damage: 6}), {...cand('p9', {damage: 14}), plan: multi}]}),
    play({state: combat({energy: 2, enemies: [enemy('E0', 41)]}), time: 't1'}),
  ]);
  assert.equal(rows[0].forecast.damageClaimSource, 'singleStepCandidate');
  assert.equal(rows[0].forecast.damageClaim, 6);
  assert.equal(rows[0].forecast.damageClaimPath, 'candidates[0].forecast.damage');
  assert.equal(rows[0].label.progress, 1, 'dealt 6 of a 6 claim, not 6 of 14');
  // With no single-step candidate to compare against there is no claim, so the only thing left is the damage
  // the log did observe - a real payoff, credited at half confidence because nothing vouches for the number.
  const unclaimed = rowsOf([play({plan: multi, forecast: fc({damage: 14}), candidates: [{id: 'p9', plan: multi, command, forecast: fc({damage: 14})}]}), play({state: combat({energy: 2, enemies: [enemy('E0', 41)]}), time: 't1'})]);
  assert.equal(unclaimed[0].forecast.damageClaim, null);
  assert.equal(unclaimed[0].label.progress, 1, '6 enemy HP really came off');
  assert.equal(unclaimed[0].label.axisConfidence.progress, 0.5, 'an unbenchmarked payoff is not worth a comparable one');
  assert.match(unclaimed[0].evidence.progress, /payoff without a benchmark/);
  // Damage the log cannot see is never scored, whatever the plan claimed.
  const unseen = rowsOf([play({plan: multi, forecast: fc({damage: 14}), candidates: [{id: 'p9', plan: multi, command, forecast: fc({damage: 14})}]}), play({state: combat({energy: 2, enemies: [enemy('E0', 47)]}), time: 't1'})]);
  assert.equal(unseen[0].label.progress, null, 'nothing was removed and nothing is claimed');
  assert.match(unseen[0].label.reasons.progress, /no damage claim and no damage was observed/);
});

test('a vanished target is unobservable damage, not a plan that did nothing', () => {
  const rows = rowsOf([play({forecast: fc({damage: 6}), candidates: [cand('p0', {damage: 6})]}), play({state: combat({energy: 2, enemies: []}), time: 't1'})]);
  assert.match(rows[0].label.reasons.progress, /E0 is absent from the next battle\.enemies/);
  assert.equal(rows[0].label.progress, null);
  assert.deepEqual(rows[0].outcome.targetsLost, ['E0']);
});

test('HP taken at the enemy phase is damage received, not a cost the decision paid', () => {
  // The bug this guards: reading the across-boundary HP delta as self-harm filed 95% of end_turn decisions as
  // waste +1, which would have taught the weights that ending a turn is a sin. The verdict has to come from
  // what the whole TURN achieved, not from the closing decision's own window.
  const struckThenEnded = [
    play({state: combat(), forecast: fc({damage: 6}), candidates: [cand('p0', {damage: 6})]}),
    endTurn({state: combat({energy: 2, enemies: [enemy('E0', 41)]}), forecast: fc({damage: 0, hpLoss: 13, hpAfter: 51})}),
    play({state: combat({hp: 51, round: 2, enemies: [enemy('E0', 41)]}), time: 't2'}),
  ];
  const rows = rowsOf(struckThenEnded);
  assert.equal(rows[1].outcome.actualHpLoss, 13);
  assert.equal(rows[1].outcome.sameTurn, false);
  assert.equal(rows[1].label.waste, null, 'the turn removed 6 enemy HP, so the HP it paid bought something');
  assert.equal(rows[1].label.survival, 0, 'alive at 51 HP after a resolved turn');
  assert.equal(rows[1].outcome.turn.forecastHpLoss, 13);
  // The same closing decision, in a turn that achieved nothing, is the honest positive.
  const idleTurn = rowsOf([endTurn({state: combat(), forecast: fc({damage: 0, hpLoss: 13, hpAfter: 51})}), play({state: combat({hp: 51, round: 2}), time: 't2'})]);
  assert.equal(idleTurn[0].label.waste, 1, '13 HP paid, nothing on the board removed');
  assert.match(idleTurn[0].evidence.waste, /enemies\[\]\.hp unchanged across the whole turn/);
});

test('an intent change across a round boundary is the enemy re-planning, not the card neutralising it', () => {
  const base = combat({energy: 2});
  const next = combat({round: 2, block: 0});
  const rows = rowsOf([endTurn({state: base}), decision({state: {...next, battle: {...next.battle, enemies: [enemy('E0', 47, {intents: [{type: 'Defend', label: '5'}]})]}}, time: 't1', chosen: {id: 'e0', command: {action: 'end_turn'}, plan: [{label: 'x', command: {action: 'end_turn'}}], forecast: fc()}})]);
  assert.equal(rows[0].outcome.intentChanged, true);
  assert.equal(rows[0].outcome.sameTurn, false);
  assert.equal(rows[0].label.progress, null, 'nothing may be credited to the decision for it');
});

test('a cost spent with no visible payoff is refused, not scored as waste', () => {
  // "At the end of combat, gain 30 Gold" is the shape the axis was invented for and also the shape that would
  // be poisoned by it: the payoff exists, this log just cannot see it.
  const rows = rowsOf([
    play({id: 'r0', cardType: 'Skill', label: 'Royalties', description: 'At the end of combat, gain 30 Gold.', forecast: fc({damage: 0})}),
    play({state: combat({energy: 2}), time: 't1'}),
  ]);
  assert.equal(rows[0].outcome.energySpent, 1);
  assert.equal(rows[0].label.waste, null);
  assert.equal(rows[0].label.deferred, true);
  assert.match(rows[0].label.reasons.waste, /absence of a payoff is not evidence of waste/);
  // A card that costs HP and buys nothing observable IS waste, and that one has evidence behind it.
  const dead = rowsOf([
    play({id: 'b0', cardType: 'Power', label: 'Bloodletting', description: 'Lose 3 HP.', forecast: fc({damage: 0})}),
    play({state: combat({energy: 2, hp: 61}), time: 't1'}),
  ]);
  assert.equal(dead[0].label.waste, 1);
  assert.match(dead[0].evidence.waste, /state\.player\.hp -3/);
});

test('an enemy that blocks or heals is not read as damage this plan failed to deal', () => {
  // The strike hit 6 block: no HP came off, and the evidence says where the damage actually went.
  const blocked = rowsOf([
    play({state: combat({enemies: [enemy('E0', 47, {block: 6})]}), forecast: fc({damage: 6}), candidates: [cand('p0', {damage: 6})]}),
    play({state: combat({energy: 2, enemies: [enemy('E0', 47)]}), time: 't1'}),
  ]);
  assert.equal(blocked[0].outcome.enemyHealed, false);
  assert.equal(blocked[0].outcome.damageDealt, 0);
  assert.equal(blocked[0].outcome.damageToBlock, 6);
  assert.equal(blocked[0].label.progress, -1, 'claimed 6, no HP came off');
  assert.match(blocked[0].evidence.progress, /6 absorbed by state\.battle\.enemies\[\]\.block/);
  // A healing enemy moves the other way, and must not become a negative damage figure either.
  const healed = rowsOf([play({forecast: fc({damage: 6}), candidates: [cand('p0', {damage: 6})]}), play({state: combat({energy: 2, enemies: [enemy('E0', 53, {maxHp: 60})]}), time: 't1'})]);
  assert.equal(healed[0].outcome.enemyHealed, true);
  assert.equal(healed[0].outcome.damageDealt, 0);
  assert.ok(healed[0].outcome.damageDealt >= 0, 'damage is never negative, whatever the enemy did');
});

test('a run that ends in death marks the window it died in, and only the decision that handed over', () => {
  const events = [
    play({state: combat({hp: 7, energy: 3, enemies: [enemy('E0', 13)]}), forecast: fc({damage: 6, incoming: null, hpLoss: null, survives: null, hpAfter: null, quality: 'unknown'})}),
    endTurn({state: combat({hp: 7, energy: 2, enemies: [enemy('E0', 7)]}), forecast: fc({damage: 0, incoming: null, hpLoss: null, survives: null, hpAfter: null, quality: 'unknown'})}),
    runEnd(0),
  ];
  const rows = rowsOf(events);
  assert.equal(rows[1].outcome.lethal, true);
  assert.equal(rows[1].label.survival, -1);
  assert.equal(rows[1].label.progress, null, 'nothing in-room was ever observed after the death');
  assert.equal(rows[0].outcome.lethal, false, 'the play before it is in the room, not the hand-over');
  assert.equal(rows[0].outcome.inLethalRoom, true);
  assert.equal(rows[0].label.survival, null, 'the round after it never happened, so survival is unreadable');
  const {summary} = attributeAndSummarize(events);
  assert.equal(summary.runsThatEndedInDeath, 1);
  assert.equal(summary.lethalWindows.lethal, 1);
});

test('every label is bounded, every weight is finite and non-negative, and nothing is scored without a reason', () => {
  const events = [
    play({state: combat(), forecast: fc({damage: 6}), candidates: [cand('p0', {damage: 6})]}),
    endTurn({state: combat({energy: 2, enemies: [enemy('E0', 41)]})}),
    play({state: combat({hp: 51, round: 2, enemies: [enemy('E0', 41)]}), time: 't2'}),
    decision({state: screen('rewards'), time: 't3', chosen: {id: 'r0', command: {action: 'claim_reward'}, plan: []}}),
    decision({state: screen('map', 3), time: 't4', chosen: {id: 'm0', command: {action: 'choose_map_node'}, plan: []}}),
    runEnd(0),
  ];
  const rows = rowsOf(events);
  for (const r of rows) {
    for (const axis of ['survival', 'progress', 'waste']) {
      const v = r.label[axis];
      if (v !== null) assert.ok(v >= -1 && v <= 1, `${axis} ${v} in range`);
      if (v === null) assert.ok(r.label.reasons[axis], `a null ${axis} must name the missing observation`);
      assert.ok(r.label.confidence >= 0 && r.label.confidence <= 1, 'confidence in 0..1');
      assert.ok(Number.isFinite(r.label.sampleWeight) && r.label.sampleWeight >= 0, 'sampleWeight finite and >= 0');
    }
    // A row that scored nothing must not carry weight, and a row that scored must cite a field.
    const scored = ['survival', 'progress', 'waste'].some(a => r.label[a] !== null);
    assert.equal(r.label.sampleWeight > 0, scored, `index ${r.index} weight matches whether anything was scored`);
    if (scored) assert.match(r.rationale, /(state\.|candidates\[|run )/, `index ${r.index} rationale names a field`);
  }
  assert.equal(rows.filter(r => r.label.confidence === 1).length, 0, 'no row is silently maximally confident');
});

test('the summary reports coverage with every mean, and separates the forecast comparison from the outcomes', () => {
  const events = [
    play({state: combat(), forecast: fc({damage: 6}), candidates: [cand('p0', {damage: 6}), cand('p1', {damage: 12, hpAfter: 60, survives: true})]}),
    play({state: combat({energy: 2, enemies: [enemy('E0', 41)]}), time: 't1'}),
    decision({state: screen('rewards'), time: 't2', chosen: {id: 'r0', command: {action: 'claim_reward'}, plan: []}}),
  ];
  const {rows, summary} = attributeAndSummarize(events);
  assert.equal(summary.rows, 3);
  assert.equal(summary.combatRows, 2);
  assert.equal(summary.nonCombatRows, 1);
  // Both combat rows are attributable - the second one closed the fight - and the rewards screen is not.
  assert.equal(summary.attributable.rows, 2, 'the rewards screen is not attributable');
  assert.ok(summary.attributable.share < 1, 'the unattributable share is published, not hidden');
  assert.equal(summary.attributable.perAxis.waste.labelled, 1);
  assert.equal(summary.attributable.perAxis.waste.measuredZero, 1, 'energy spent into a measured payoff: a real zero');
  assert.equal(summary.attributable.perAxis.waste.unobserved, 2);
  for (const group of [summary.byActionKind, summary.byStateType, summary.byFloor, summary.byAscension]) {
    for (const v of Object.values(group)) for (const axis of ['survival', 'progress', 'waste']) {
      assert.equal(typeof v[axis].labelled, 'number', 'every mean is printed with its own count');
      assert.equal(typeof v[axis].measuredZero, 'number', 'measured zeros are counted apart from the unobserved');
    }
  }
  assert.equal(summary.byStateType.monster.rows, 2);
  // Better FORECAST on the table, never a claim about what would have happened.
  assert.equal(summary.wastedPotential.rows, 1);
  assert.equal(summary.wastedPotential.kind, 'forecast comparison only, not an outcome');
  assert.deepEqual(rows[0].wastedPotential.betterOn, ['hpAfter', 'damage']);
});

test('a chosen forecast that carries no numbers is an absent forecast, not a dominated one', () => {
  const absent = {kind: 'decision', chosen: {id: 'p0', command, plan: [{label: 'x', command}], forecast: fc({damage: null, hpAfter: null, survives: null, quality: 'unknown'})}, candidates: [cand('p1', {damage: 6, hpAfter: 60, survives: true})]};
  assert.equal(wastedPotentialOf(absent).kind, 'chosenForecastAbsent');
  const dominated = {...absent, chosen: {...absent.chosen, forecast: fc({damage: 2, hpAfter: 60, survives: true})}};
  assert.equal(wastedPotentialOf(dominated).kind, 'dominated');
  // A rejected plan that trades damage for safety is not "better" on every axis, and must not be counted.
  const traded = {kind: 'decision', chosen: {id: 'p0', command, plan: [{label: 'x', command}], forecast: fc({damage: 12, hpAfter: 40, survives: false})}, candidates: [cand('p1', {damage: 4, hpAfter: 60, survives: true})]};
  assert.equal(wastedPotentialOf(traded), null);
});

test('an empty or log-free input summarises to nothing rather than to a confident zero', () => {
  const {rows, summary} = attributeAndSummarize([]);
  assert.deepEqual(rows, []);
  assert.equal(summary.rows, 0);
  assert.equal(summary.attributable.share, null);
  assert.equal(summary.attributable.perAxis.survival.mean, null);
  assert.deepEqual(summary.wastedPotential, {kind: 'forecast comparison only, not an outcome', rows: 0, chosenForecastAbsent: 0, shareOfRows: null, shareOfCombatRows: null});
});
