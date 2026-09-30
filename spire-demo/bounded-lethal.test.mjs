// A BOUND CAN STILL PROVE DEATH.
//
// When an attack intent cannot be read, the forecast used to report `survives: null` — and a null
// incoming makes the gate silent. 18 lost fights in the corpus carried no early lethal verdict at
// all, and this is where that came from. The readable intents are still a floor on the damage, and
// if the floor alone exceeds HP plus block the turn is dead whatever the unread ones turn out to be,
// because they can only add. That is arithmetic over printed numbers.
import test from 'node:test';
import assert from 'node:assert/strict';
import {statedSurvival, refuseLethalChoice} from './learning/lethal-gate.mjs';
import {projectSequence} from './planner.mjs';

const plan = (f, id = 'a') => ({id, label: 'End turn', command: {action: 'end_turn'}, plan: [], forecast: f});

test('a floor that already exceeds HP plus block is a stated death, not an unknown', () => {
  assert.equal(statedSurvival(plan({quality: 'unknown', survives: false, boundedLethal: true})), false,
    'the gate must be able to act on it');
});

test('the admission is ASYMMETRIC: a floor never proves survival', () => {
  assert.equal(statedSurvival(plan({quality: 'unknown', survives: true, boundedLethal: true})), null,
    'a lower bound can only ever prove death; calling a plan safe on it is the same class of error');
  assert.equal(statedSurvival(plan({quality: 'unknown', survives: null})), null, 'no bound, no verdict');
  assert.equal(statedSurvival(plan({quality: 'partial', survives: false})), false, 'the old path is unchanged');
});

test('a bounded lethal plan yields to a stated survivor', () => {
  const lethal = plan({quality: 'unknown', survives: false, boundedLethal: true}, 'a');
  const safe = plan({quality: 'partial', survives: true, hpAfter: 12}, 'b');
  const r = refuseLethalChoice('a', [lethal, safe], [lethal, safe]);
  assert.equal(r.overridden, true, 'this is the case that was silent before');
  assert.equal(r.choice, 'b');
});

test('the bound is published so the reason can be read', () => {
  const s = {state_type: 'monster', run: {act: 1, floor: 6},
    player: {hp: 12, max_hp: 80, energy: 1, block: 0, relics: [{id: 'BURNING_BLOOD', name: 'Burning Blood'}], potions: [], status: [], hand: []},
    battle: {round: 2, turn: 'player', is_play_phase: true, enemies: [{entity_id: 'e1', name: 'X', hp: 200, block: 0, status: [],
      intents: [{type: 'attack', label: '4x3 (12)', description: 'Deal 12 damage.'}, {type: 'attack', label: '?%^&', description: ''}]}]}};
  const f = projectSequence(s, ['End turn']);
  assert.equal(f.incoming, null, 'the exact total is genuinely unknown');
  assert.equal(f.incomingLowerBound, 12, 'but 12 is still definitely coming');
  assert.equal(f.boundedLethal, true, 'and 12 against 12 HP with no block proves the turn lethal');
  assert.equal(f.survives, false, 'so the verdict is stated rather than blanked');
});
