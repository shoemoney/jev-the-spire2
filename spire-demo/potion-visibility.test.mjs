// POTIONS WERE INVISIBLE TO THE RANKER.
//
// `apply()` read `listed || potion ? null : ...`, which sent every potion down an eleven-name
// hand-written allowlist and nothing else. The corpus has shown twenty-nine distinct potion types,
// so eighteen were invisible — and an unlisted potion marks the play `unsupported`, which blanks
// the forecast and blinds the lethal gate for the whole turn.
//
// What this asserts is the HONEST outcome, not "everything works": a plainly-modelled potion
// simulates, and a trigger-based one stays refused rather than being simulated wrongly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSequence} from './planner.mjs';

const board = (name, description) => ({
  state_type: 'elite', run: {act: 1, floor: 6},
  player: {hp: 8, max_hp: 80, energy: 1, block: 0, relics: [{id: 'BURNING_BLOOD', name: 'Burning Blood'}],
    status: [], hand: [], potions: [{slot: 0, name, target_type: 'AnyPlayer', can_use_in_combat: true, description}]},
  battle: {round: 2, turn: 'player', is_play_phase: true,
    enemies: [{entity_id: 'e1', name: 'X', hp: 99, block: 0, status: [], intents: [{type: 'attack', label: '20x1', description: 'Deal 20 damage.'}]}]},
});

test('a plainly modelled potion is simulated instead of blinding the turn', () => {
  for (const [name, description] of [
    ['Block Potion', 'Gain 12 Block.'],
    ['Swift Potion', 'Draw 3 cards.'],
    ['Speed Potion', 'Gain 5 Dexterity. At the end of your turn, lose 5 Dexterity.'],
  ]) {
    const f = projectSequence(board(name, description), [name]);
    assert.notEqual(f.quality, 'unknown', `${name} must not blind the forecast`);
    assert.notEqual(f.boundary, 'unsupported', `${name} must not be refused as unmodelled`);
  }
});

test('a trigger-based potion stays refused rather than simulated wrongly', () => {
  // Fairy in a Bottle reads "when your HP would be reduced to 0 ... heal to 30%". The planner has
  // no clause for a trigger at zero, so promoting it would produce a confident wrong number — the
  // exact failure this project exists to prevent. Unknown is the correct answer here.
  const f = projectSequence(board('Fairy in a Bottle',
    'When your HP would be reduced to 0, instead this potion is discarded and you heal to 30% of your max HP.'), ['Fairy in a Bottle']);
  assert.equal(f.quality, 'unknown');
  assert.equal(f.survives, null, 'and states no survival claim rather than a fabricated one');
});

test('an unreadable potion is still refused', () => {
  const f = projectSequence(board('??? Mystery', 'gibberish that says nothing'), ['??? Mystery']);
  assert.equal(f.boundary, 'unsupported');
});
