// The planner reads card text for its forecast but used to declare a card unsupported before reading it, so a
// card the knowledge base had already resolved was refused by the simulation while the same card was attached
// to the request with a verified number. These tests pin the gate that closes that gap, and - the point of the
// whole change - pin the cases where the knowledge base must NOT be allowed to supply a number.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectSequence, readIntentDamage, decisionCandidates} from './planner.mjs';
import {lookup} from './mechanics/retrieve.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url))).state;

// fresh-block is 1 energy against one Vantom (105 HP) carrying Vulnerable 3. Vulnerable multiplies each hit by
// 1.5, which turns a missing hit count into a visible number: 6 damage is 9 landed, and one hit reads 9 where
// two read 18. The three unmodelled relics are stripped so this board raises no warning of its own and a
// `partial` quality can only have come from the card under test.
const board = card => {
  const s = fixture('fresh-block');
  s.player.relics = s.player.relics.filter(r => r.id === 'BURNING_BLOOD');
  s.player.potions = [];
  s.player.hand = [{index: 0, can_play: true, ...card}];
  return s;
};
const attack = (name, description, target_type = 'AnyEnemy') =>
  board({name, type: 'Attack', cost: 1, target_type, description});
// The comment block immediately above `marker`, and nothing else. Slicing from position 0 would let any
// unrelated line further up the file satisfy an assertion about this comment.
const commentAbove = (src, marker) => {
  const lines = src.slice(0, src.indexOf(marker)).trimEnd().split('\n');
  let i = lines.length;
  while (i > 0 && lines[i - 1].trimStart().startsWith('//')) i--;
  return lines.slice(i).join('\n');
};

test('a card the knowledge base resolves from its LIVE description is simulated, not refused', () => {
  // retrieve() reports source 'description' here: the reading was derived from this exact string, so "twice"
  // arrives as hits:2 instead of falling through to the generic single-hit reading.
  assert.equal(lookup('Astral Pulse', 'card', null, 'Deal 6 damage to ALL enemies twice.').source, 'description');
  const s = attack('Astral Pulse', 'Deal 6 damage to ALL enemies twice.', 'AllEnemies');
  const f = projectSequence(s, ['Astral Pulse']);
  assert.notEqual(f.boundary, 'unsupported');
  assert.equal(f.damage, 18);              // 6 per hit, twice, each amplified 1.5x by Vulnerable
  assert.equal(f.energyLeft, 0);           // a costed play, not a card whose energy is merely unknown
  assert.equal(f.quality, 'partial');      // a recorded reading, so never advertised as 'calculated'
  // The same card through the path a caller actually uses.
  const p = decisionCandidates(s).find(x => x.plan?.[0]?.command?.action === 'play_card');
  assert.notEqual(p.forecast.boundary, 'unsupported');
});

test('a card the base knows only by NAME never contributes a remembered number', () => {
  // Bolas has exactly ONE recorded reading, so retrieve() hands it back with a real `variant` and damage:3 even
  // when the board is showing text the corpus never recorded - source 'name'. Only the source gate stops that 3
  // being replayed onto this text, and no fallback is invented in its place.
  const off = 'Deal 3 damage, then do something the corpus never recorded.';
  assert.equal(lookup('Bolas', 'card', null, off).source, 'name');
  assert.equal(lookup('Bolas', 'card', null, off).variant.damage, 3);
  // The card is no longer refused outright, because the GAME'S OWN DATA says Bolas is a real card
  // that deals damage. That is a statement about STRUCTURE, never about magnitude - so the number
  // must come from the text the board printed, and the 3 the corpus remembers must never appear.
  // These are the three magnitudes this fixture's enemy state produces (Vantom carries Vulnerable 1,
  // so each printed value lands one higher).
  const f = projectSequence(attack('Bolas', off), ['Bolas → Vantom']);
  assert.equal(f.damage, 4, 'damage comes from the printed 3, not the remembered 3 and not a guess');
  assert.notEqual(f.damage, 6, 'the recorded 3 plus Vulnerable is exactly what a remembered number looks like');
  assert.ok(f.warnings.some(w => /game.s own card data/.test(w)),
    'and the request must say the card was resolved structurally, so the omitted clause is visible');
  // The decisive property: a DIFFERENT printed number must produce a DIFFERENT forecast. If the
  // remembered reading were being applied anywhere, 9 and 22 would both read 4.
  assert.equal(projectSequence(attack('Bolas', 'Deal 9 damage.'), ['Bolas → Vantom']).damage, 13);
  assert.equal(projectSequence(attack('Bolas', 'Deal 22 damage.'), ['Bolas → Vantom']).damage, 33);
  // The same card with the recorded text IS simulated - the gate reads the text, not the name.
  assert.equal(projectSequence(attack('Bolas', 'Deal 3 damage. At the start of your next turn, return this to your Hand.'), ['Bolas → Vantom']).damage, 4);
});

test('the 4/6/7/8/9 Strike hazard: an ambiguous name yields readings, never one remembered number', () => {
  // The reason name-only resolutions are refused: one id, five recorded values. retrieve() returns every reading
  // and no `variant`, which is the structural form the gate tests for.
  const hit = lookup('Strike', 'card', null, 'Deal 77 damage to a mystery target at dawn.');
  assert.equal(hit.source, 'name-ambiguous');
  assert.equal(hit.variant, undefined);
  assert.deepEqual(hit.variants.map(v => v.damage), [4, 6, 7, 8, 9]);
  // An off-allowlist ambiguous card used to stay unsupported. It no longer has to: the game's own
  // data says Sovereign Blade is a real card that deals damage, which is a statement about STRUCTURE.
  // What must never happen is one of its remembered readings being chosen. So the property to pin is
  // not a literal number - the planner's own clause parsing decides that - but that the forecast
  // TRACKS THE LIVE TEXT and is a function of it, never a constant recovered from the name.
  assert.equal(lookup('Sovereign Blade', 'card', null, 'Deal 5 damage.').source, 'name-ambiguous');
  const at = hp => projectSequence(attack('Sovereign Blade', `Deal ${hp} damage.`), ['Sovereign Blade → Vantom']).damage;
  const observed = [5, 9, 18, 40].map(at);
  assert.equal(new Set(observed).size, observed.length,
    `each printed value must give a distinct forecast — got ${JSON.stringify(observed)}`);
  assert.ok(observed.every((v, i) => i === 0 || v > observed[i - 1]),
    `and the forecast must rise with the printed value — got ${JSON.stringify(observed)}`);
  assert.ok(observed.every(v => Number.isInteger(v) && v > 0));
  // Strike itself is allowlisted, so it is read from the live text - and the number is the text's, not a
  // remembered one. 12 is chosen because it survives: `damage` is HP actually removed, so a lethal hit would
  // read as the target's remaining HP and hide which number produced it. 18 = 12 amplified 1.5x, and 18 is in
  // none of the five recorded Strike readings.
  const live = 'Deal 12 damage. Then the air goes still.';
  assert.equal(lookup('Strike', 'card', null, live).source, 'name-ambiguous');
  assert.equal(projectSequence(attack('Strike', live), ['Strike → Vantom']).damage, 18);
  // Had the planner picked one of the five recorded Strike readings instead, the landed damage on this same
  // board would be 4/6/7/8/9 amplified and floored: 6, 9, 10, 12, 13. 18 is none of them.
  assert.ok(![4, 6, 7, 8, 9].map(n => Math.floor(n * 1.5)).includes(18));
});

test('a card the base has never seen is unchanged', () => {
  assert.equal(lookup('Unmodeled attack', 'card', null, 'Deal 41 damage.'), null);
  const f = projectSequence(attack('Unmodeled attack', 'Deal 41 damage.'), ['Unmodeled attack → Vantom']);
  assert.equal(f.boundary, 'unsupported');
  assert.equal(f.damage, null);
  assert.equal(f.quality, 'unknown');
  assert.equal(f.energyLeft, null);
});

test('the generic text parsing still applies to a plain card', () => {
  const f = projectSequence(attack('Strike+', 'Deal 9 damage.'), ['Strike+ → Vantom']);
  assert.equal(f.damage, 13);              // 9 amplified 1.5x by Vulnerable, one hit - no knowledge base involved
  assert.equal(f.quality, 'calculated');  // and so carries none of the knowledge-base caveat
  assert.equal(f.warnings.length, 0);
});

test('the readIntentDamage comment states the priority the code implements', () => {
  const src = readFileSync(new URL('./planner.mjs', import.meta.url), 'utf8');
  const comment = commentAbove(src, 'export function readIntentDamage');
  // The comment used to claim the label and the description were combined into a two-point interval. Pin the
  // contract it must state instead of banning words: the honest comment has to be allowed to say the merge was
  // considered and left out, and a keyword ban would reject exactly that sentence.
  assert.match(comment, /label first|priority order/i);
  assert.match(comment, /only when the label does not\s+parse|fallback/i);
  assert.match(comment, /is not compared|never compared/i);
  // The code agrees with it. A parseable label wins outright and the description is never read.
  assert.deepEqual(readIntentDamage({label: '28', description: 'This enemy intends to Attack for 41 damage.'}),
    {perHit: 28, hits: 1, alt: null, exact: true, source: 'intent label'});
  assert.equal(readIntentDamage({label: '???', description: 'This enemy intends to Attack for 41 damage.'}).source, 'intent description');
  // `alt` is the label's OWN parenthesised total, not the description's number: a 4x3 (99) label contradicts
  // itself and widens to 99, while the description's 12 is never consulted. This is the specific claim the old
  // comment got wrong, and it is the whole reason the merge stays unimplemented.
  const label = readIntentDamage({label: '4x3 (99)', description: 'This enemy intends to Attack for 12 damage.'});
  assert.equal(label.alt, 99);
  assert.equal(label.exact, false);
  assert.equal(readIntentDamage({label: '4x3 (12)', description: 'x'}).alt, null);
});
