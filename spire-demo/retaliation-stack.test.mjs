// A Thorns enemy blinded the entire candidate board: 105 of 105 Thorns objects in the corpus carry
// `amount`, and the number was discarded in favour of `null`, which is what marks a board unknown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retaliationRule, applyRetaliation } from './retaliation.mjs';

const THORNS = { name: 'Thorns', amount: 2, description: 'When hit by an attack, deal 2 damage back.' };

test("Thorns is priced from the power's own stack, not left null", () => {
  const r = retaliationRule(THORNS);
  assert.equal(r.damage, 2, "the number was in the state all along");
  assert.equal(r.fromStack, true);
});

test('a name with NO amount still supplies nothing', () => {
  // The original rule stands for this case: a name is not a number, and inventing one would be
  // exactly the failure this function exists to avoid.
  const r = retaliationRule({ name: 'Thorns', amount: null, description: 'When hit by an attack, deal damage back.' });
  assert.equal(r.damage, null, 'unpriced rather than guessed');
  assert.equal(r.fromStack, undefined);
});

test('a non-retaliation power is not retaliation at all', () => {
  assert.equal(retaliationRule({ name: 'Vulnerable', amount: 3, description: 'Takes 50% more damage.' }), null);
});

test('the exact-sentence path is unchanged', () => {
  const r = retaliationRule({ name: 'Spikes', description: 'Whenever this creature is attacked, deal 4 damage back to the attacker.' });
  assert.equal(r.damage, 4);
  assert.equal(r.fromText, true);
});

test('a single unblocked hit into a thorned enemy now costs HP instead of blinding the board', () => {
  const m = { block: 0, hp: 20, unsupported: false, warnings: [], rage: 0, fan: false, retaliationModifiers: false, retaliationEvents: [] };
  applyRetaliation(m, [{ hp: 30, status: [THORNS] }], { description: 'Deal 6 damage.' }, 1);
  assert.equal(m.unsupported, false, 'the board is not blind');
  assert.equal(m.boundary, undefined, 'and carries no retaliation_unknown boundary');
  assert.equal(m.hp, 18, 'the 2 damage back was actually charged');
  assert.equal(m.retaliationEvents.length, 1);
});

test('block still absorbs the retaliation before HP', () => {
  const m = { block: 5, hp: 20, unsupported: false, warnings: [], rage: 0, fan: false, retaliationModifiers: false, retaliationEvents: [] };
  applyRetaliation(m, [{ hp: 30, status: [THORNS] }], { description: 'Deal 6 damage.' }, 1);
  assert.equal(m.hp, 20, '2 damage was fully absorbed by block');
  assert.equal(m.block, 3);
});

test('genuinely ambiguous cases are STILL unknown', () => {
  // The fix must not turn every thorned board into a confident number. Multi-hit, area, and
  // modified-player cases remain unpriced, because the count of applications is not knowable.
  for (const [targets, hits, mods] of [
    [[{ hp: 30, status: [THORNS] }], 3, {}],
    [[{ hp: 30, status: [THORNS] }, { hp: 20, status: [] }], 1, {}],
    [[{ hp: 30, status: [THORNS] }], 1, { retaliationModifiers: true }],
  ]) {
    const m = { block: 0, hp: 20, unsupported: false, warnings: [], rage: 0, fan: false, retaliationModifiers: false, retaliationEvents: [], ...mods };
    applyRetaliation(m, targets, { description: 'Deal 6 damage.' }, hits);
    assert.equal(m.unsupported, true, 'multi-hit, area and modified-player remain unknown');
    assert.equal(m.boundary, 'retaliation_unknown');
  }
});
