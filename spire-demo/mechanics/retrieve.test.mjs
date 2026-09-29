import test from 'node:test';
import assert from 'node:assert/strict';
import {retrieveMechanics, lookup} from './retrieve.mjs';
import {KNOWLEDGE} from './knowledge.mjs';

const card = (name, description, extra = {}) => ({name, description, type: 'Attack', cost: '1', target_type: 'AnyEnemy', ...extra});
const state = (over = {}) => ({player: {hand: [], relics: [], potions: [], status: [], draw_pile: [], discard_pile: [], ...over.player}, ...over});

test('an unseen entity comes back known:false instead of throwing or going blank', () => {
  const r = retrieveMechanics(state({player: {hand: [card('Shockwave', 'Apply 10 Weak and 10 Vulnerable to ALL enemies. Exhaust.')]}}));
  assert.equal(r.entities.length, 1);
  const [e] = r.entities;
  assert.equal(e.name, 'Shockwave');
  assert.equal(e.known, false);
  assert.equal(e.effects, null);
  assert.equal(e.confidence, 'unknown');
  assert.deepEqual(r.unknown, ['Shockwave']);
  // The game's own text still travels, so a caller can fall back to it instead of going blind.
  assert.equal(e.description, 'Apply 10 Weak and 10 Vulnerable to ALL enemies. Exhaust.');
  assert.equal(lookup('Shockwave', 'card', null, null), null);
});

test('only entities present in the state are returned', () => {
  const r = retrieveMechanics(state({
    player: {hand: [card('Bash', 'Deal 8 damage. Apply 2 Vulnerable.')], relics: [{name: 'Akabeko', description: 'At the start of each combat, gain 8 Vigor.'}], potions: [{name: 'Fortifier', description: 'Triple your Block.'}], status: [{name: 'Strength', description: 'Increases attack damage by 3.', amount: 3}]},
    battle: {enemies: [{name: 'Byrdonis', hp: 57, max_hp: 90, intents: [{type: 'Attack', label: '21'}], status: [{name: 'Territorial', description: "At the end of Byrdonis's turn, it gains 1 Strength.", amount: 1}]}]},
  }));
  const names = r.entities.map(e => e.name);
  assert.deepEqual(names, ['Bash', 'Akabeko', 'Fortifier', 'Strength', 'Byrdonis', 'Territorial']);
  for (const name of names) assert.ok(KNOWLEDGE[name], `${name} was returned but is not in the knowledge base`);
  // Nothing from the wider corpus may leak in: 159 names exist, 6 are in this state.
  assert.ok(Object.keys(KNOWLEDGE).length > 100);
  assert.equal(r.entities.length, 6);
  assert.equal(r.counts.unknown, 0);
});

test('the live description outranks the knowledge base for a mutated card', () => {
  // Strike was recorded at 4/6/7/8/9 damage, so the name alone is ambiguous; the text is not.
  const nine = retrieveMechanics(state({player: {hand: [card('Strike', 'Deal 9 damage.')]}})).entities[0];
  assert.equal(nine.known, true);
  assert.equal(nine.source, 'description');
  assert.equal(nine.effects.damage, 9);
  const four = retrieveMechanics(state({player: {hand: [card('Strike', 'Deal 4 damage.')]}})).entities[0];
  assert.equal(four.effects.damage, 4);
  // A reading never observed is reported as ambiguous, never as a number the corpus does not support.
  const invented = retrieveMechanics(state({player: {hand: [card('Strike', 'Deal 3 damage.')]}})).entities[0];
  assert.equal(invented.source, 'name-ambiguous');
  assert.equal(invented.effects.damage, undefined);
  assert.equal(invented.effects.readings.length, 5);
  assert.equal(invented.effects.matchedLiveText, false);
});

test('a name that is two things is never served the other one\'s numbers', () => {
  const cardRead = retrieveMechanics(state({player: {hand: [card("Monarch's Gaze", 'Whenever you attack an enemy, it loses 1 Strength this turn.', {type: 'Power'})]}})).entities[0];
  assert.equal(cardRead.kind, 'card');
  assert.equal(cardRead.effects.enemyLoseStrength, 1);
  const powerRead = retrieveMechanics(state({player: {status: [{name: "Monarch's Gaze", description: 'Lose 1 Strength until the end of this turn.', amount: 1}]}})).entities[0];
  assert.equal(powerRead.kind, 'power');
  assert.equal(powerRead.effects.damage, undefined);
  assert.equal(lookup("Monarch's Gaze", 'relic', null, null), null);
});

test('a status whose text bakes in its stack resolves through the template', () => {
  // 'Increases attack damage by 7' was never recorded, but 7 stacks of the recorded reading is exact.
  const r = retrieveMechanics(state({battle: {enemies: [{name: 'Skulking Colony', hp: 40, max_hp: 80, intents: [], status: [{name: 'Strength', description: 'Increases attack damage by 7.', amount: 7}]}]}}));
  const str = r.entities.find(e => e.name === 'Strength');
  assert.equal(str.known, true);
  assert.equal(str.source, 'stack-template');
  assert.equal(str.effects.attackBonus, 1, 'the reading is per stack');
  assert.equal(str.effects.stack, 7, 'so 7 stacks of 1 is the live total');
  assert.equal(str.effects.stacksScale, true);
  assert.equal(str.effects.side, undefined);
  // Without a stack there is nothing to substitute, but the side still disambiguates: only the
  // 'Increases' reading can ever be on the player, so it resolves by name rather than staying ambiguous.
  const noStack = retrieveMechanics(state({player: {status: [{name: 'Strength', description: 'Increases attack damage by 7.'}]}})).entities[0];
  assert.equal(noStack.source, 'name');
  assert.equal(noStack.effects.attackBonus, 1);
  assert.equal(noStack.effects.damage, undefined);
  // The enemy side has both readings available, so the same card stays ambiguous there.
  assert.equal(lookup('Strength', 'power', 'enemy', 'Increases attack damage by 7.', 7).source, 'stack-template');
  assert.equal(lookup('Strength', 'power', 'enemy', 'Increases attack damage by 7.', null).source, 'name-ambiguous');
});

test('a power is resolved for the side it is on', () => {
  const enemy = retrieveMechanics(state({battle: {enemies: [{name: 'Nibbit', hp: 30, max_hp: 47, intents: [], status: [{name: 'Vulnerable', description: 'Receive 50% more damage from Attacks for 3 turns.', amount: 3}]}]}})).entities;
  const vuln = enemy.find(e => e.name === 'Vulnerable');
  assert.equal(vuln.kind, 'power');
  assert.equal(vuln.effects.incomingPercent, 50);
  assert.equal(vuln.effects.turns, 1, 'turns is per stack, so 3 stacks means 3 turns');
  assert.deepEqual(vuln.effects.stackValues, [1, 2, 3]);
  assert.equal(vuln.effects.stack, 3, 'the live stack count travels with the reading');
  // 'Receive 50% more damage' inverts between the two sides, so the wrong side is not substituted.
  assert.equal(lookup('Vulnerable', 'power', 'player', null), null);
});

test('duplicate hand cards collapse but keep their multiplicity', () => {
  const r = retrieveMechanics(state({player: {hand: [card('Strike', 'Deal 9 damage.'), card('Strike', 'Deal 9 damage.'), card('Bash', 'Deal 8 damage. Apply 2 Vulnerable.')]}}));
  assert.equal(r.entities.length, 2);
  assert.equal(r.entities[0].instances, 2);
  assert.equal(r.entities[1].instances, undefined);
});

test('piles are summarised by name and truncation is stated, never silent', () => {
  const draw = Array.from({length: 20}, (_, i) => ({name: `Card ${i}`}));
  const r = retrieveMechanics(state({player: {draw_pile: draw, discard_pile: [{name: 'Strike'}]}, battle: {enemies: []}}));
  assert.equal(r.piles.draw.total, 20);
  assert.equal(r.piles.draw.listed.length, 12);
  assert.equal(r.piles.draw.truncated, 8);
  assert.equal(r.piles.draw.listed[0].known, false);
  assert.equal(r.piles.discard.listed[0].known, true);
  // Pile entries are names only, so the payload stays small.
  assert.equal(r.piles.draw.listed[0].effects, null);
});

test('degenerate states are tolerated and the glossary stays small', () => {
  assert.deepEqual(retrieveMechanics(undefined).entities, []);
  assert.deepEqual(retrieveMechanics({}).entities, []);
  assert.equal(retrieveMechanics({}).piles, undefined);
  const r = retrieveMechanics(state({player: {hand: [card('Dazed', 'Unplayable. Ethereal.')], relics: [{name: 'Sovereign Blade'}]}}));
  assert.equal(r.entities[0].known, true);
  assert.ok(r.entities[0].effects.unplayable);
  // The relic has no description, so it resolves by name and contributes no glossary.
  assert.equal(r.glossary.Ethereal, 'If this card is in your Hand at the end of this turn, it is Exhausted.');
  assert.ok(Object.keys(r.glossary).length <= 4, `glossary leaked: ${Object.keys(r.glossary)}`);
  assert.equal(r.counts.known + r.counts.unknown, r.counts.entities);
});
