// Attrition is arithmetic on this fight, not a judgement about how the agent is playing.
//
// It exists for a measured reason: 18 lost fights, ZERO with a `survives:false` forecast in their
// first three decisions, and only 11% of their decisions in a known-lethal state. The per-turn
// forecast covers THIS turn; the danger is cumulative, so the agent never saw it coming.
import test from 'node:test';
import assert from 'node:assert/strict';
import {observeTurn, attrition, attritionLine} from './attrition.mjs';

const fight = turns => turns.reduce((f, t) => observeTurn(f, t), null);

test('a first turn is not evidence, and says so', () => {
  const a = attrition(fight([{hp: 80, dealt: 10, enemyHp: 100}]));
  assert.equal(a.status, 'unknown');
  assert.equal(attritionLine(a), '', 'and contributes no sentence to the request at all');
});

test('outlasting the enemy is reported as a fact, never as a win', () => {
  // Rates are measured FROM THE FIRST OBSERVED TURN, because HP before the first observation is not
  // something this process ever saw. Asserting against the fight's true entry HP would be asserting
  // a number the agent does not have — so the expectation below is derived from the first reading.
  const a = attrition(fight([
    {hp: 76, dealt: 12, enemyHp: 88}, {hp: 72, dealt: 12, enemyHp: 76},
    {hp: 68, dealt: 12, enemyHp: 64}, {hp: 64, dealt: 12, enemyHp: 52},
  ]));
  assert.equal(a.status, 'out-lasting-the-enemy');
  assert.equal(a.perTurnTaken, 3, '12 HP lost across 4 observed turns');
  assert.equal(a.turnsToLive, 21.3, '64 HP left at 3/turn');
  assert.equal(a.turnsToKill, 4.3, '52 enemy HP at 12/turn');
  assert.doesNotMatch(attritionLine(a), /\bwin\b|\bwinning\b|will survive/i,
    'running out of turns is a loss, not a win, and saying so would be the bug this exists to catch');
});

test('losing on time is named plainly', () => {
  // 20 HP losing 5/turn = 4 turns of life; enemy 200 HP at 6/turn = 33 turns to kill.
  const a = attrition(fight([
    {hp: 15, dealt: 6, enemyHp: 194}, {hp: 10, dealt: 6, enemyHp: 188},
    {hp: 5, dealt: 6, enemyHp: 182},
  ]));
  assert.equal(a.status, 'losing-on-attrition');
  assert.ok(a.turnsToLive < a.turnsToKill);
  assert.match(attritionLine(a), /LOST ON TIME/);
  assert.match(attritionLine(a), /does not cut into the enemy/);
});

test('a zero rate is a fact to report, not a divide-by-zero to hide behind', () => {
  const a = attrition(fight([{hp: 80, dealt: 0, enemyHp: 100}, {hp: 80, dealt: 0, enemyHp: 100}]));
  assert.equal(a.status, 'unknowable');
  assert.equal(a.turnsToLive, null);
  assert.match(a.why, /no damage has been taken/);
  assert.equal(Number.isNaN(a.turnsToLive), false, 'a null is reported as null, never as NaN');
});

test('damage already taken is observed, not inferred', () => {
  const f = fight([{hp: 80, dealt: 5, enemyHp: 100}, {hp: 60, dealt: 5, enemyHp: 95}]);
  assert.equal(f.taken, 20, '20 HP is the difference between the first reading and now');
  const a = attrition(f);
  assert.equal(a.perTurnTaken, 10, 'and the rate divides it by the turns actually observed');
});

test('a dead player and a dead enemy are both unknown, not verdicts', () => {
  assert.equal(attrition(fight([{hp: 0, dealt: 5, enemyHp: 90}, {hp: 0, dealt: 5, enemyHp: 90}])).status, 'unknown');
  assert.equal(attrition(fight([{hp: 40, dealt: 50, enemyHp: 0}, {hp: 40, dealt: 0, enemyHp: 0}])).status, 'unknown');
});

// The signal only matters if it actually REACHES the decision. It was first wired inside the
// card-reward branch — where it can never fire, because attrition is a combat idea and card rewards
// are not combat. Caught by building the probe before committing to the wiring.
test('the attrition line reaches the combat questions, and stays off a card reward', async () => {
  const {decisionQuestion} = await import('../planner.mjs');
  const {factoredQuestion} = await import('../factored.mjs');
  const combat = {state_type: 'monster', run: {act: 1, floor: 6},
    player: {hp: 20, max_hp: 80, gold: 0, status: [], relics: [], potions: []},
    battle: {round: 3, turn: 'player', is_play_phase: true,
      enemies: [{entity_id: 'e1', name: 'B', hp: 200, block: 0, status: [], intents: []}]}};
  const cands = [{id: 'a0', label: 'Strike', command: {action: 'play_card', card_index: 0}, details: {}}];
  const losing = {status: 'losing-on-attrition', turnsToLive: 4, turnsToKill: 33, why: '4 turns of life, 33 to finish the enemy'};

  const q = decisionQuestion(combat, cands, losing);
  assert.match(q.questions.move.instructions, /LOST ON TIME/, 'the base question must carry it');
  // and through the SHIPPED policy's builder, which is the hop that dropped it for 12 iterations
  const f = factoredQuestion(combat, cands, {}, losing);
  assert.match(f.questions.move.instructions, /LOST ON TIME/, 'factored must forward it to the base');

  const unknown = decisionQuestion(combat, cands, {status: 'unknown'});
  assert.doesNotMatch(unknown.questions.move.instructions, /LOST ON TIME/,
    'an unknown verdict must contribute nothing at all, not a vague worry');
});
