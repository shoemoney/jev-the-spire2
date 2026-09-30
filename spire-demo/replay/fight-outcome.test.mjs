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
  assert.deepEqual(s.byType.boss, { won: 1, lost: 1, unresolved: 0 });
  assert.deepEqual(s.byType.monster, { won: 1, lost: 0, unresolved: 0 });
});

test('a malformed log does not throw and does not invent a fight', () => {
  const fights = fightOutcomes([null, {}, { kind: 'decision' }, { kind: 'decision', state: {} }, runEnd()]);
  assert.equal(fights.length, 0, 'no combat screen means no fight, and no exception either');
});
