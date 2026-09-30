// THE CROSS-RUN RECORD REACHED ONE POLICY AND ONE SCREEN.
//
// The store holds `elite 29/52 won (56%)` — the agent's own measured elite record, accumulated over
// twenty runs. It was attached by `recallingDeliberate`, so it reached exactly one policy, and the
// default policy decided whether to walk into an elite with that number sitting unread in the store.
//
// The base question builder has TWO return paths. The non-combat one is where MAP decisions live —
// precisely the decision about whether to take an elite — and it returns early. Attaching to the
// combat branch alone would have reproduced the attrition bug on a different screen, which is the
// third time this loop a signal reached one of two paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionQuestion} from './planner.mjs';

const RECORD = {historyLine: '20 runs recorded. Own record: monster 547/576 (95%); elite 29/52 (56%)'};
const plan = extra => [{id: 'a0', label: 'X', command: {action: 'play_card', card_index: 0}, details: {}, plan: [], first_action_rules: '', ...extra}];
const mapState = {state_type: 'map', run: {act: 1, floor: 6},
  player: {hp: 20, max_hp: 80, gold: 0, status: [], relics: [], potions: [], hand: []},
  battle: {is_play_phase: true, round: 1, turn: 'player', enemies: []}};
const combatState = {...mapState, state_type: 'monster',
  player: {...mapState.player, energy: 3, block: 0},
  battle: {...mapState.battle, enemies: [{entity_id: 'e', name: 'B', hp: 99, block: 0, status: [], intents: []}]}};
const LOSING = {status: 'losing-on-attrition', turnsToLive: 4, turnsToKill: 33, why: 'x'};

test('the record reaches a MAP decision — the one that chooses whether to take an elite', () => {
  const q = decisionQuestion(mapState, plan({command: {action: 'choose_map_node', index: 0}, label: 'Travel'}), null, RECORD);
  assert.ok(q.state.recalled_experience, 'the map branch returns early and must still carry it');
  assert.match(q.state.recalled_experience.historyLine, /elite 29\/52/);
});

test('and the attrition note reaches BOTH paths, not just combat', () => {
  assert.match(decisionQuestion(mapState, plan({command: {action: 'choose_map_node', index: 0}}), LOSING, null).questions.move.instructions, /LOST ON TIME/);
  assert.match(decisionQuestion(combatState, plan(), LOSING, null).questions.move.instructions, /LOST ON TIME/);
});

test('with no record supplied, nothing is attached — the signal is not always-on', () => {
  const q = decisionQuestion(mapState, plan({command: {action: 'choose_map_node', index: 0}}), null, null);
  assert.equal(q.state.recalled_experience, undefined);
});
