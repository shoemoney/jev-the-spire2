// "Apply Vulnerable" is an EFFECT; "Vulnerable enemies take an additional 25% damage" is a
// PREREQUISITE. A bare /vulnerable/i could not tell them apart, so the four cards that APPLY the
// debuff were recorded as requiring it - inverted semantics on exactly the cards the rest of the
// deck cashes in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAME_DATA, byName } from './game-data.mjs';

const APPLY = ['Bash', 'Tremble', 'Uppercut', 'Thunderclap'];
const CONDITIONAL = ['Colossus', 'Cruelty'];

test('a card that APPLIES Vulnerable does not require it', () => {
  for (const n of APPLY) {
    const e = byName(n);
    assert.ok(e, `${n} is in the knowledge base`);
    assert.match(e.template, /Vulnerable/i, `${n} really does mention Vulnerable`);
    assert.equal(e.requires, null, `${n} applies the debuff, so it cannot require it`);
  }
});

test('a card whose VALUE depends on the debuff keeps its prerequisite', () => {
  // The reason the CONDITIONS table exists at all: Colossus's first sentence is the worthless
  // half, and the second clause is the entire reason anyone plays it.
  for (const n of CONDITIONAL) assert.equal(byName(n).requires, 'an enemy is Vulnerable', n);
});

test('an effect and a condition in the SAME card are read separately', () => {
  // "Deal 6 damage and apply Vulnerable. If the enemy is Vulnerable, hits twice." is one card with
  // one effect and one prerequisite, and only the second is a condition.
  const both = Object.values(GAME_DATA).find(e =>
    /apply[^\n]*Vulnerable/i.test(e?.template ?? '') && /if the enemy is Vulnerable/i.test(e?.template ?? ''));
  if (!both) return;  // no such card in this build; the rule is covered by the two tests above
  assert.equal(both.requires, 'an enemy is Vulnerable', 'the prerequisite survived the effect sentence');
});

test('applying a debuff anywhere in a card is not a prerequisite', () => {
  // Dominate is legitimately BOTH: "Apply Vulnerable. Gain Strength for each Vulnerable." It applies
  // the debuff and scales off it, so a prerequisite is a fair reading of the second sentence. The
  // rule is about the APPLICATORS, not about cards that happen to mention the word twice.
  //
  // The markup has to be stripped before matching, or the clause reads as
  // "for each [gold]Vulnerable[/gold]" and never matches "for each vulnerable" - the same shape of
  // mistake as the extractor itself: pattern-matching formatted text as if it were prose.
  const plain = t => String(t ?? '').replace(/\[\/?(?:gold|blue)\]/g, '');
  const wrong = Object.values(GAME_DATA).filter(e => {
    const t = plain(e?.template);
    return e.requires === 'an enemy is Vulnerable' && /\bapply|applies\b/i.test(t)
      && !/if the enemy is vulnerable|from vulnerable enemies|vulnerable enemies take|for each vulnerable/i.test(t);
  });
  assert.deepEqual(wrong.map(e => e.name), [], 'no card both applies Vulnerable and claims to need it');
  // And the dual card keeps its reading rather than being flattened to nothing.
  assert.equal(byName('Dominate').requires, 'an enemy is Vulnerable', 'Dominate applies AND scales off it');
});
