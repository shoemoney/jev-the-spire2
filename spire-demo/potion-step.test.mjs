// A potion has to be reachable as a STEP, not only as a first action.
//
// Every candidate used to be rooted at a single action, so "drink, then block, then survive" could
// not be proposed at all: the potion was on the menu and nothing in the search reached for it. On
// 2026-09-29 the agent stood at 24 HP against 39 incoming and ended the turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {decisionCandidates} from './planner.mjs';

const base = () => JSON.parse(readFileSync(new URL('./fixtures/beast-potion.json', import.meta.url), 'utf8')).state;
// The real in-game text carries the resolved number: the game's data has `{Block}` as a placeholder
// and the printed card is what fills it in. Using the template here would test a string the board
// never prints.
const board = (hp, incoming, potionText = 'Gain 12 Block.') => {
  const s = base();
  s.player.potions = [{slot: 0, name: 'Block Potion', target_type: 'AnyPlayer', can_use_in_combat: true, description: potionText}];
  s.player.hp = hp; s.player.energy = 0; s.player.block = 0; s.player.hand = [];
  s.battle.enemies = [{entity_id: 'e1', name: 'Cultist', hp: 60, block: 0, status: [],
    intents: [{type: 'attack', label: `${incoming}x1`, description: `Deal ${incoming} damage.`}]}];
  return s;
};
const potionPlans = c => c.filter(x => x.plan?.some(p => /Potion/.test(p.label)));
const survivors = c => potionPlans(c).filter(x => x.forecast?.survives === true);

test('a potion that turns a lost turn into a survived one is proposed', () => {
  const c = decisionCandidates(board(20, 30));
  const endTurn = c.find(x => x.command?.action === 'end_turn');
  assert.equal(endTurn.forecast.survives, false, 'the bare turn is lost — otherwise this proves nothing');
  assert.ok(survivors(c).length, 'a surviving potion line must be on the menu');
  assert.equal(survivors(c)[0].forecast.hpAfter, 2, '20 HP + 12 block against 30 leaves 2');
});

test('a potion that cannot save the turn is not dressed up as if it could', () => {
  // 24 + 12 = 36 < 39. Drinking it is still better than nothing, but the forecast must not claim survival.
  const c = decisionCandidates(board(24, 39));
  assert.equal(potionPlans(c).length, 2, 'the option is offered');
  assert.equal(survivors(c).length, 0, 'and it is correctly reported as still lethal');
});
