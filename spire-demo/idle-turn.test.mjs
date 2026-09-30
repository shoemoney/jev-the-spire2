// Block against nothing prevents nothing.
//
// Measured on a live elite: the agent blocked on 10 turns where the enemy had NO attack intent at
// all — incoming 0. On one of them it held 3 energy with a 7-damage plan on the menu and chose a
// 0-damage Defend. The planner's ranking was correct on every one of those boards; the model was
// picking defence because the request only ever framed survival as valuable and never said that
// block against no attack is free but useless.
import test from 'node:test';
import assert from 'node:assert/strict';
import {makeQuestion} from './actions.mjs';

const board = (intents) => ({
  state_type: 'monster',
  player: {hp: 43, max_hp: 80, energy: 1, block: 0, hand: []},
  battle: {is_play_phase: true, round: 1, turn: 'player',
    enemies: [{entity_id: 'e1', name: 'Sewer Clam', hp: 58, block: 0, status: [], intents}]},
});
const plan = [{id: 'a0', label: 'Defend', command: {action: 'play_card', card_index: 0}, details: {}}];
const ATTACK = [{type: 'attack', label: '9x1', description: 'Deal 9 damage.'}];
const IDLE = [{type: 'Buff', label: '', title: 'Empower', description: 'This enemy intends to use a Buff.'}];
const idle = makeQuestion(board(IDLE), plan).questions.move.instructions;

test('a turn with no attack incoming says so, and says block is worth nothing on it', () => {
  assert.match(idle, /No enemy is attacking this turn/);
  assert.match(idle, /prevents nothing/i);
  assert.match(idle, /reserve Block for a turn that actually has an attack coming/i);
});

test('a turn WITH an attack incoming carries no such claim', () => {
  const attacked = makeQuestion(board(ATTACK), plan).questions.move.instructions;
  assert.doesNotMatch(attacked, /No enemy is attacking this turn/,
    'telling the model nothing is incoming while something is would be the exact failure class this repo exists to prevent');
});

test('the notice adds no option and removes none', () => {
  const q = makeQuestion(board(IDLE), plan);
  assert.equal(Object.keys(q.questions.move.criteria).length, plan.length, 'it is a statement, not a choice');
  assert.deepEqual(Object.keys(q.questions.move.criteria), plan.map(p => p.id));
});

test('the same candidates and criteria come out with and without the notice', () => {
  // The planner's menu already led with the damage plan on these boards. Nothing here changes
  // scoring or the option set; it only stops the request implying that defence is valuable when
  // nothing is attacking. Asserted by comparing an attacking board to an idle one: same candidates,
  // same criteria, different instruction text.
  const idleQ = makeQuestion(board(IDLE), plan);
  const attackQ = makeQuestion(board(ATTACK), plan);
  assert.deepEqual(idleQ.questions.move.criteria, attackQ.questions.move.criteria);
  assert.notEqual(idleQ.questions.move.instructions, attackQ.questions.move.instructions,
    'and the text is genuinely the only thing that differs');
});
