// Each test below is a real wrong number this project reported about itself.
//
//   "6 boss fights, no kill"  -> A_KILL_THEN_A_LONG_WALK_TO_ACT_2_READS_AS_A_LOSS
//   "12 won, 0 lost"          -> A_DEATH_MID_FIGHT_INHERITED_BY_THE_NEXT_RUN
//
// Both came from inferring the outcome instead of reading the transition. These tests pin the
// transitions so the inference cannot come back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fightOutcomes, summariseFights } from './metrics.mjs';

const dec = (type, { name = 'Vantom', hp = 200, ...rest } = {}) => ({
  kind: 'decision',
  outcome: 'executed',
  state: { state_type: type, battle: COMBAT_ENEMIES(type, name, hp), ...rest },
});
const COMBAT_ENEMIES = (type, name, hp) =>
  ['monster', 'elite', 'boss'].includes(type) ? { enemies: [{ name, hp }] } : undefined;
const runEnd = (floor = 14) => ({ kind: 'run_end', state: { state_type: 'game_over', run: { act: 1, floor } } });

test('a kill followed by the long walk to the next act is a WIN, not a loss', () => {
  // The exact shape that produced "no kill": boss dies, then the run keeps playing for many
  // screens and ends 14 floors later. Grouping by run calls the whole thing a loss.
  const events = [
    dec('boss', { hp: 200 }),
    dec('boss', { hp: 27 }),
    dec('boss', { hp: 0 }),
    dec('rewards'), dec('card_reward'), dec('map'), dec('monster', { hp: 40 }),
    runEnd(31),
  ];
  const fights = fightOutcomes(events);
  assert.equal(fights.length, 2);
  assert.equal(fights[0].type, 'boss');
  assert.equal(fights[0].outcome, 'won', 'the boss died and the run continued — that is a win');
  assert.equal(fights[0].startHp, 200);
  assert.equal(fights[1].type, 'monster');
  assert.equal(fights[1].outcome, 'lost', 'the run died in THIS fight, not the boss one');
});

test('a death mid-fight is a loss and cannot be inherited by the next run', () => {
  // The exact shape that produced "12 won, 0 lost": the run ends inside the boss fight, and the
  // next run's first non-combat decision was read as "the boss died".
  const events = [
    dec('boss', { hp: 200 }), dec('boss', { hp: 150 }),
    runEnd(17),
    dec('char_select'), dec('map'), dec('monster', { hp: 30 }), runEnd(2),
  ];
  const fights = fightOutcomes(events);
  assert.equal(fights.length, 2);
  assert.equal(fights[0].outcome, 'lost');
  assert.equal(fights[1].outcome, 'lost');
  assert.equal(summariseFights(fights).won, 0, 'no decision may ever be counted as a win here');
});

test('an empty enemy list at the last combat screen still closes as a win', () => {
  const events = [dec('boss', { hp: 9 }), dec('boss', { hp: 0 }), dec('rewards')];
  assert.equal(fightOutcomes(events)[0].outcome, 'won');
});

test('a log that simply ends mid-fight is unresolved, never guessed at', () => {
  // An unobserved outcome must not render as a measured one. Defaulting this to `lost` is the
  // same class of bug as before, running the other direction.
  const fights = fightOutcomes([dec('boss', { hp: 120 })]);
  assert.equal(fights[0].outcome, 'unresolved');
  assert.equal(fights[0].closedBy, 'eof');
  assert.equal(summariseFights(fights).winRate, null, 'no closed fights means no rate, not 0%');
});

test('switching from a boss room to a monster room is two fights, not one', () => {
  const fights = fightOutcomes([
    dec('boss', { hp: 200 }), dec('rewards'), dec('map'), dec('monster', { hp: 30 }), dec('rewards'),
  ]);
  assert.deepEqual(fights.map(f => [f.type, f.outcome]), [['boss', 'won'], ['monster', 'won']]);
});

test('the summary reports a real rate and splits by type', () => {
  const fights = fightOutcomes([
    dec('boss', { hp: 200 }), dec('rewards'),
    dec('boss', { hp: 200 }), runEnd(17),
    dec('monster', { hp: 30 }), dec('rewards'),
  ]);
  const s = summariseFights(fights);
  assert.equal(s.total, 3);
  assert.equal(s.won, 2);
  assert.equal(s.lost, 1);
  assert.equal(s.unresolved, 0);
  assert.equal(Number((s.winRate * 100).toFixed(1)), 66.7);
  assert.deepEqual(s.byType.boss, { total: 2, won: 1, lost: 1, unresolved: 0, winRate: 0.5 });
  assert.deepEqual(s.byType.monster, { total: 1, won: 1, lost: 0, unresolved: 0, winRate: 1 });
});

test('a malformed log does not throw and does not invent a fight', () => {
  const fights = fightOutcomes([null, {}, { kind: 'decision' }, { kind: 'decision', state: {} }, runEnd()]);
  assert.equal(fights.length, 0, 'no combat screen means no fight, and no exception either');
});

test('ascension is recorded ON the fight, and unknown is not the difficulty 0', () => {
  // A0 and A10 fights pooled into one rate move for reasons that have nothing to do with the
  // policy. In the real corpus every boss win is A0 and both A10 boss fights are losses, so a
  // pooled 42% hides the only fact worth acting on.
  const withAsc = (asc) => (type, o = {}) => ({ ...dec(type, o), state: { ...dec(type, o).state, run: { ascension: asc } } });
  const events = [
    withAsc(0)('boss', { hp: 200 }), withAsc(0)('rewards'),
    withAsc(10)('boss', { hp: 200 }), runEnd(17),
    dec('monster', { hp: 30 }), dec('rewards'),   // no run block at all -> unknown
  ];
  const s = summariseFights(fightOutcomes(events));
  assert.deepEqual(s.byAscension['0'], { total: 1, won: 1, lost: 0, unresolved: 0, winRate: 1 });
  assert.deepEqual(s.byAscension['10'], { total: 1, won: 0, lost: 1, unresolved: 0, winRate: 0 });
  assert.equal(s.byAscension.unknown.total, 1, 'a missing ascension is its own bucket, not 0');
  assert.deepEqual(
    s.atAscension['10'].boss,
    { total: 1, won: 0, lost: 1, unresolved: 0, winRate: 0 },
    'the hard difficulty must be reportable on its own',
  );
});

test('an absent difficulty reports null rather than a 0% rate', () => {
  // 0 wins and 0 fights is not a failure and is not a success; it is no data.
  const s = summariseFights([]);
  assert.equal(s.winRate, null);
  assert.equal(s.atAscension.undefined, undefined);
  const only = summariseFights(fightOutcomes([dec('boss', { hp: 9 })]));
  assert.equal(only.atAscension.unknown.boss.winRate, null, 'no closed boss fight -> no rate');
});

test('a fight records the board at the moment it was lost, and how blind the agent was', () => {
  // The outcome says the fight was lost. These say what the agent was looking at, which is the
  // difference between "10 losses" and "10 losses for these five reasons".
  const enemy = (hp, intents) => ({ name: 'Waterfall Giant', hp, intents });
  const at = (hp, ph, intents) => ({
    kind: 'decision', outcome: 'executed',
    chosen: { forecast: { quality: 'unknown' } },
    state: { state_type: 'boss', battle: { enemies: [enemy(hp, intents)] }, player: { hp: ph, block: 0 } },
  });
  const events = [
    { ...at(240, 60, [{ type: 'Attack', label: '42' }]), chosen: { forecast: { quality: 'calculated' } } },
    at(20, 11, [{ type: 'Attack', label: '42' }]),
    runEnd(17),
  ];
  const [f] = fightOutcomes(events);
  assert.equal(f.outcome, 'lost');
  assert.equal(f.name, 'Waterfall Giant');
  assert.equal(f.startHp, 240);
  assert.equal(f.endHp, 11, 'the board is captured at the LAST decision, not the first');
  assert.deepEqual(f.intentLabels, ['42'], 'incoming damage is a string in intents[].label');
  assert.equal(f.multiHitIntents, 0);
  assert.equal(f.unknownForecasts, 1, 'exactly the decisions the planner refused to forecast');
});

test('a multi-hit Attack counts against parser coverage; a Buff with no label does not', () => {
  // This is the parser's coverage, measured on the real field. Reading `battle.intents` (which
  // does not exist) made this an empty array on every loss and it looked like a measurement.
  //
  // The distinction is not cosmetic. Counting every non-numeric label reported the agent as blind
  // on 47% of all decisions — but 1589 of 4592 corpus intents are Buff/Defend/Summon/Stun whose
  // label is empty BECAUSE they telegraph no damage. Counting those made a correct screen look
  // like a failed parse.
  const at = (type, label) => ({
    kind: 'decision', outcome: 'executed', chosen: { forecast: { quality: 'unknown' } },
    state: { state_type: 'monster', battle: { enemies: [{ name: 'Nibbit', hp: 40, intents: [{ type, label }] }] }, player: { hp: 20, block: 0 } },
  });
  const f = fightOutcomes([
    at('Attack', '12'), at('Buff', ''), at('Attack', '3x3 (9)'), at('Defend', ''), runEnd(3),
  ])[0];
  assert.deepEqual(f.intentLabels, [''], 'intentLabels is the board at death: the LAST turn');
  assert.equal(f.multiHitIntents, 1, 'only the 3x3 Attack counts; the two empty non-damage telegraphs do not');
  assert.equal(f.intentsSeen, 4);
  assert.equal(f.unknownForecasts, 4);
});

test('an empty intent list is distinguishable from an unparsed one', () => {
  // Otherwise "the enemy telegraphed nothing" and "we failed to read the telegraph" print the same.
  const bare = { kind: 'decision', outcome: 'executed', chosen: {}, state: { state_type: 'monster', battle: { enemies: [{ name: 'X', hp: 1, intents: [] }] }, player: { hp: 5 } } };
  const [f] = fightOutcomes([bare, runEnd(2)]);
  assert.deepEqual(f.intentLabels, []);
  assert.equal(f.multiHitIntents, 0, 'no intent is not an unreadable intent');
});
