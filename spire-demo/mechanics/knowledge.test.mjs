import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEffects, canonicalize, parsePower} from './extract.mjs';
import {KNOWLEDGE, GLOSSARY, META} from './knowledge.mjs';

// Every description below is verbatim from the run log, so these assert against the real corpus text.
const E = (d, kind = 'card') => parseEffects(d, {kind});
const leaves = e => (e.variants ? e.variants.flatMap(leaves) : [e]);
const ALL = Object.values(KNOWLEDGE).flatMap(leaves);

test('reads damage, block and buffs out of real card text', () => {
  assert.deepEqual(pick(E('Deal 8 damage. Apply 2 Vulnerable.')), {damage: 8, vulnerable: 2});
  assert.deepEqual(pick(E('Gain 5 Block.')), {block: 5});
  assert.deepEqual(pick(E('Deal 13 damage. Apply 1 Weak. Apply 1 Vulnerable.')), {damage: 13, weak: 1, vulnerable: 1});
  assert.deepEqual(pick(E('Gain 6 Block. Apply 1 Vulnerable.')), {block: 6, vulnerable: 1});
  // The game ships its own keyword list on the card object; the entry carries that verbatim.
  assert.deepEqual(KNOWLEDGE['Bash'].variants.find(v => v.description === 'Deal 8 damage. Apply 2 Vulnerable.').keywords, ['Vulnerable']);
  assert.deepEqual(leaves(KNOWLEDGE['Defend']).map(v => v.keywords), [['Block'], ['Block'], ['Block']]);
  assert.equal(E('Deal damage equal to your Block.').damageFromBlock, true);
  assert.equal(E('Deal damage equal to your Block.').damage, undefined);
  assert.equal(E('Draw 6 cards.').draw, 6);
  assert.equal(E('Lose 3 HP.').hpCost, 3);
  assert.equal(E('Lose 2 HP. Gain 16 Block.').block, 16);
  assert.equal(E('Lose 6 HP. Gain 3 Energy.').hpCost, 6);
});

test('multi-hit and all-enemy damage keep their scope, and a variable count stays absent', () => {
  assert.deepEqual(pick(E('Deal 5 damage twice.')), {damage: 5, hits: 2});
  assert.deepEqual(pick(E('Deal 6 damage to ALL enemies twice.')), {damage: 6, damageAll: true, hits: 2});
  assert.deepEqual(pick(E('Deal 4 damage and apply 1 Vulnerable to ALL enemies.')), {damage: 4, vulnerable: 1, appliesAll: true});
  // 'X times' is chosen by the player: a number would be a fabrication.
  assert.equal(E('Deal 5 damage to ALL enemies X times.').hits, undefined);
  assert.equal(E('Deal 5 damage to ALL enemies X times.').damage, 5);
  // Per-card scaling must not also publish a flat number, which would understate it by the hand size.
  const ff = E('Exhaust your Hand. Deal 7 damage for each card Exhausted. Exhaust.');
  assert.equal(ff.damagePerExhaustedCard, 7);assert.equal(ff.damage, undefined);assert.equal(ff.exhaust, true);
});

test('self-exhaust is read only from a trailing clause, never from exhausting a card', () => {
  assert.equal(E('Deal 18 damage. Exhaust 1 card at random.').exhaust, undefined);
  assert.equal(E('Exhaust 1 card. Draw 2 cards.').exhaust, undefined);
  assert.equal(E('Gain 7 Block. Exhaust 1 card at random.').exhaust, undefined);
  assert.equal(E('Apply 3 Vulnerable. Exhaust.').exhaust, true);
  assert.equal(E('Draw 1 card. Exhaust.').exhaust, true);
  assert.equal(E('Put every Rare card from your Draw Pile into your Hand. Exhaust.').exhaust, true);
  assert.equal(E('Exhaust your Hand. Add 1 random card into your Hand for each card Exhausted.').exhaust, undefined);
});

test('icon resources are counted, and a cost discount is never read as a gain', () => {
  assert.equal(E('Gain [regent_energy_icon.png][regent_energy_icon.png].').energy, 2);
  assert.equal(E('Gain [ironclad_energy_icon.png][ironclad_energy_icon.png][ironclad_energy_icon.png]. Exhaust.').energy, 3);
  assert.equal(E('Gain [star_icon.png].').star, 1);
  assert.equal(E('Gain 8 Block. Gain [star_icon.png].').star, 1);
  assert.equal(E('Gain 8 Block. Gain [star_icon.png].').block, 8);
  // 'Costs 1 less [energy]' is a discount, not a gain.
  const stomp = E('Deal 12 damage to ALL enemies. Costs 1 less [ironclad_energy_icon.png] for each Attack played this turn.');
  assert.equal(stomp.damage, 12);assert.equal(stomp.energy, undefined);
});

test('a deferred clause never leaks into the immediate effect', () => {
  const gl = E('Gain 11 Block. Next turn, gain 5 Block.');
  assert.equal(gl.block, 11);assert.deepEqual(gl.nextTurn, {block: 5});
  const gs = E('Deal 12 damage. Next turn, draw 2 cards.');
  assert.equal(gs.draw, undefined);assert.equal(gs.nextTurn.draw, 2);
  const heg = E('Deal 15 damage. Next turn, gain [regent_energy_icon.png][regent_energy_icon.png].');
  assert.equal(heg.energy, undefined);assert.equal(heg.nextTurn.energy, 2);
  const cache = E('Gain [star_icon.png]. Next turn, gain [star_icon.png][star_icon.png][star_icon.png].');
  assert.equal(cache.star, 1);assert.equal(cache.nextTurn.star, 3);
});

test('relic hooks carry their cadence, payload and non-numeric grants', () => {
  assert.deepEqual(E('At the start of each combat, deal 9 damage to ALL enemies.', 'relic').hooks, {onCombatStart: {damage: 9, damageAll: true}});
  assert.deepEqual(E('At the end of combat, heal 6 HP.', 'relic').hooks, {onCombatEnd: {heal: 6}});
  assert.deepEqual(E('At the start of each combat, gain 8 Vigor.', 'relic').hooks, {onCombatStart: {gains: {Vigor: 8}}});
  assert.deepEqual(E('At the start of each combat, gain [star_icon.png][star_icon.png][star_icon.png].', 'relic').hooks, {onCombatStart: {star: 3}});
  assert.deepEqual(E('Every 3 turns, gain [regent_energy_icon.png].', 'relic').hooks, {onTurnStart: {every: {n: 3, unit: 'turn'}, energy: 1}});
  assert.deepEqual(E('At the start of each combat, procure a Potion-Shaped Rock.', 'relic').hooks, {onCombatStart: {grants: 'Potion-Shaped Rock'}});
  // A conditional self-gain is not a flat one.
  assert.equal(E('Apply 1 Vulnerable. Gain 1 Strength for each Vulnerable on the enemy. Exhaust.').gains, undefined);
  assert.equal(E('Gain 7 Vigor.').gains.Vigor, 7);
});

test('a power separates its per-stack magnitude from its fixed constants', () => {
  const vul = parsePower('Receive 50% more damage from Attacks for 1 turn.', {amount: 1, stackValues: [1, 2, 3]});
  assert.equal(vul.incomingPercent, 50);assert.equal(vul.turns, 1);assert.equal(vul.stacksScale, true);
  assert.equal(vul.template, 'Receive 50% more damage from Attacks for @ turns.');
  const weak = parsePower('Attacks deal 25% less damage for 3 turns.', {amount: 3, stackValues: [3]});
  assert.equal(weak.outgoingPercentLoss, 25);assert.equal(weak.turns, 1);
  const str = parsePower('Increases attack damage by 6.', {amount: 6, stackValues: [6]});
  assert.equal(str.attackBonus, 1);assert.equal(str.stacksScale, true);
  const vig = parsePower('Your next Attack deals 8 additional damage.', {amount: 8, stackValues: [8]});
  assert.equal(vig.nextAttackBonus, 1);
});

test('a magnitude that merely equals the stack is withheld rather than published per-stack', () => {
  // 'gain 30 Gold' with a stack of 30 is a total; publishing 1 gold per stack would be a wrong number.
  const roy = parsePower('At the end of combat, gain 30 Gold.', {amount: 30, stackValues: [30]});
  assert.equal(roy.stacksScale, 'unknown');
  assert.equal(roy.stackLinkedMagnitudeUnknown, true);
  assert.equal(JSON.stringify(roy.gains ?? {}).includes('30'), false);
  assert.equal(roy.stackValues[0], 30);
  assert.equal(roy.template, 'At the end of combat, gain @ Gold.');
  // A number that is NOT the stack is a real constant and must survive.
  const shrink = parsePower('While Shrinker Beetle is alive, your Attacks deal 30% less damage.', {amount: -1});
  assert.equal(shrink.outgoingPercentLoss, 30);assert.equal(shrink.stacksScale, false);
  // Stack counts collapse to one reading instead of one variant per stack.
  assert.equal(canonicalize('Receive 50% more damage from Attacks for 1 turn.', 1), canonicalize('Receive 50% more damage from Attacks for 3 turns.', 3));
});

test('the glossary is a rule table and never becomes an entity', () => {
  for (const rule of ['Retain', 'Exhaust', 'Ethereal', 'Forge', 'Plating']) assert.equal(KNOWLEDGE[rule], undefined);
  assert.equal(GLOSSARY.Retain, 'Retained cards are not discarded at the end of turn.');
  assert.equal(GLOSSARY.Ethereal, 'If this card is in your Hand at the end of this turn, it is Exhausted.');
});

test('every committed entry has the required shape and no unusable value', () => {
  const kinds = new Set(['card', 'relic', 'potion', 'power', 'enemy', 'multi']);
  const confidences = new Set(['inferred', 'verified', 'partial', 'mixed']);
  assert.ok(ALL.length > 100, `expected a populated knowledge base, got ${ALL.length}`);
  for (const name of Object.keys(KNOWLEDGE)) {
    const entry = KNOWLEDGE[name];
    assert.equal(entry.name, name, `${name} must be keyed by its own name`);
    assert.ok(kinds.has(entry.kind), `${name} has kind ${entry.kind}`);
    assert.ok(confidences.has(entry.confidence), `${name} has confidence ${entry.confidence}`);
    // An enemy entry's HP range and intents are copied from the log, so it is 'verified' with no description.
    if (entry.kind === 'enemy') { assert.ok(entry.maxHpObserved.length > 0, `${name} needs an observed HP range`); continue; }
    for (const leaf of leaves(entry)) {
      assert.ok(kinds.has(leaf.kind), `${name} leaf has kind ${leaf.kind}`);
      assert.equal(leaf.name, name, `${name} leaf must repeat its own name`);
      assert.ok(confidences.has(leaf.confidence), `${name} leaf has confidence ${leaf.confidence}`);
      // A leaf is modelled ('inferred'), copied verbatim ('verified') or text-only ('partial') - and a
      // text-only leaf must still publish the game's own words rather than nothing at all.
      if (leaf.confidence === 'partial') assert.ok(leaf.description || leaf.summary, `${name} partial leaf has no text`);
      if (leaf.kind === 'power') assert.ok(leaf.template, `${name} power needs its stack template`);
    }
  }
});

test('no entry carries a placeholder, a sentinel, or a number its own text does not contain', () => {
  for (const leaf of ALL) {
    const serialised = JSON.stringify(leaf);
    assert.equal(serialised.includes('987654'), false, `${leaf.name} leaked the parse sentinel`);
    assert.equal(/\bundefined\b/.test(serialised.replace(/"[^"]*":null/g, '')), false, `${leaf.name} serialised an undefined value`);
    assert.equal(serialised.includes('NaN'), false, `${leaf.name} serialised NaN`);
    for (const [k, v] of Object.entries(leaf)) assert.notEqual(v, undefined, `${leaf.name}.${k}`);
  }
});

test('a name whose readings disagree publishes the range, never one confident number', () => {
  // The corpus shows Strike at 4/6/7/8/9 damage under one id with is_upgraded:false throughout.
  const strike = KNOWLEDGE['Strike'];
  assert.equal(strike.mutable, true);
  assert.equal(strike.damage, undefined, 'a mutated card must not publish a single damage');
  assert.deepEqual(strike.damageObserved, [4, 6, 7, 8, 9]);
  assert.ok(strike.varies.includes('damage'));
  for (const leaf of leaves(strike)) assert.equal(leaf.confidence, 'inferred');
  // A card with one recorded reading is the plain case and does publish its number.
  assert.equal(KNOWLEDGE['Whirlwind'].mutable, undefined);
  assert.equal(KNOWLEDGE['Whirlwind'].damage, 5);
  assert.equal(KNOWLEDGE['Twin Strike'].hits, 2);
  assert.equal(KNOWLEDGE['Bash'].mutable, true);
  assert.deepEqual(KNOWLEDGE['Bash'].damageObserved, [5, 6, 8, 12]);
  assert.equal(KNOWLEDGE['Wrought in War'].damage, undefined);
  assert.deepEqual(KNOWLEDGE['Wrought in War'].damageObserved, [7, 9, 15]);
});

test('a name that is two different things keeps both readings apart', () => {
  for (const name of ['Monarch\'s Gaze', 'Dying Star', 'Genesis', 'Royalties', 'Parry', 'Sword Sage', 'Crush Under']) {
    const kinds = new Set(leaves(KNOWLEDGE[name]).map(l => l.kind));
    assert.ok(kinds.has('card') && kinds.has('power'), `${name} should keep both a card and a power reading`);
  }
  // A card's damage must never be served for the power of the same name, or vice versa.
  const gaze = KNOWLEDGE['Monarch\'s Gaze'];
  const card = gaze.variants.find(v => v.kind === 'card');
  assert.equal(card.damage, undefined);
  assert.equal(JSON.stringify(card).includes('lose 1 Strength') || /Strength/.test(card.keywords.join()), true);
});

test('META records the corpus the file was generated from', () => {
  assert.equal(META.counts.card, 89);
  assert.equal(META.counts.relic, 16);
  assert.equal(META.counts.potion, 11);
  assert.equal(META.counts.enemy, 22);
  assert.ok(META.counts.power >= 28);
  assert.match(META.source, /spire-runs/);
});

function pick(e) { const {rules, summary, ...rest} = e; return rest; }
