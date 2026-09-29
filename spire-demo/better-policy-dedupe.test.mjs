import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decisionCandidates } from './planner.mjs';
import { WEIGHTS } from './factored.mjs';
import { betterQuestion, betterDeliberate } from './better-policy.mjs';
import { completeFactors, FACTOR_PREFIXES } from './learning/lethal-gate.mjs';
import { deckAwareMoveInstruction } from './learning/deck-directive.mjs';
import { deckUnavailableInstruction } from './deck-assessment.mjs';

const source = name => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const fixture = name => JSON.parse(source(`fixtures/${name}.json`)).state;
const withoutDeck = () => { const s = fixture('deck-reward'); delete s.player.deck; return s; };
const mapState = { state_type: 'map', run: { act: 2 }, player: { hp: 30, max_hp: 80 }, map: { nodes: [], next_options: [] } };
// The phrases the card-reward FOCUS uses to demand a comparison against the deck. Not
// "permanent deck" alone: the base prompt and the correction both say that, and neither
// is the defect. The defect is demanding the comparison the board cannot support.
const DEMANDS_DECK = [/actual permanent deck/, /Compare every offered card and Skip against/];
const demandsDeck = text => DEMANDS_DECK.some(pattern => pattern.test(text ?? ''));
const move = state => betterQuestion(state, decisionCandidates(state)).questions.move.instructions;

// ONE implementation. This file used to define its own `completeFactors` over a private
// copy of the prefixes, and that copy was correct only because this policy happens to
// always ask `waste_*`. The moment anything asked the guard with `waste: 0` it would
// report an incomplete board on every decision - falling back to the broad answer forever
// while still publishing a score. Asserted on the SOURCE, because the defect IS a second
// definition; no behavioural test can see it.
test('the refuse-to-recombine guard is imported, not redefined', () => {
  const src = source('better-policy.mjs');
  assert.doesNotMatch(src, /function completeFactors/,
    'better-policy.mjs must not define its own completeFactors');
  assert.doesNotMatch(src, /const factorNames/,
    'and must not keep a private copy of the factor prefixes');
  assert.match(src, /import\s*\{[^}]*\bcompleteFactors\b[^}]*\}\s*from\s*'\.\/learning\/lethal-gate\.mjs'/,
    'it must come from the canonical module');
  assert.match(src, /import\s*\{[^}]*\bFACTOR_PREFIXES\b[^}]*\}\s*from\s*'\.\/learning\/lethal-gate\.mjs'/,
    'and the prefixes it demands must be the canonical FACTOR_PREFIXES');
  assert.deepEqual(FACTOR_PREFIXES, ['safe_', 'prog_', 'waste_']);
});

test('a card reward with no deck is never told to judge against the deck', () => {
  const state = withoutDeck();
  const question = betterQuestion(state, decisionCandidates(state));
  // The bridge sends no `player.deck` (0 of 775 logged records), so the assessment on
  // THIS SAME REQUEST reports the gap...
  assert.equal(question.state.deck_assessment.available, false);
  // ...and the request must not also demand a comparison against the deck it lacks.
  // Contradicting instructions are worse than either alone: the model is asked to
  // reconcile them rather than read a fact, and the request still carries a score.
  assert.equal(demandsDeck(question.questions.move.instructions), false,
    'move instructions must not demand the comparison the board cannot support');
  assert.match(question.questions.move.instructions, /The permanent deck is not included in this request/);
  // The judgement is not simply dropped - take-or-skip is still on the table, and the
  // absence is explicitly not a licence to default to Skip.
  assert.match(question.questions.move.instructions, /Compare every offered card and Skip/);
  assert.match(question.questions.move.instructions, /not a reason to skip by default/);
});

test('a card reward WITH a deck keeps its real focus, unchanged', () => {
  // The regression the fix must not cause: silencing a capability that is genuinely
  // available. `fixtures/deck-reward.json` ships a 21-card deck, so this board CAN be
  // judged against the actual deck and must be.
  const state = fixture('deck-reward');
  const question = betterQuestion(state, decisionCandidates(state));
  assert.equal(question.state.deck_assessment.available, true);
  assert.equal(demandsDeck(question.questions.move.instructions), true,
    'a board that supplies the deck still gets the deck-comparison criteria');
  assert.match(question.questions.move.instructions, /A small starter deck is not automatically a strong deck/);
  assert.doesNotMatch(question.questions.move.instructions, /The permanent deck is not included in this request/,
    'the unavailability text belongs only on a board with no deck');
  // The suppressed-then-restored focus must be the SAME text the focus module holds.
  assert.ok(question.questions.move.instructions.includes('A small starter deck is not automatically a strong deck.'));
});

test('the deck branch is one helper, not a second copy', () => {
  // `factored.mjs` carries the identical branch and needs the identical fix. Two inlined
  // copies is exactly how this path ended up still carrying a bug the other had fixed.
  const withDeck = deckAwareMoveInstruction(fixture('deck-reward'));
  assert.notEqual(withDeck, deckUnavailableInstruction);
  assert.ok(demandsDeck(withDeck), 'and it is the real deck-comparison focus');
  assert.equal(deckAwareMoveInstruction(withoutDeck()), deckUnavailableInstruction);
  // Only card rewards name a deck, so every other screen keeps its own focus untouched.
  const mapFocus = deckAwareMoveInstruction(mapState);
  assert.match(mapFocus, /visible map connections/);
  assert.equal(demandsDeck(mapFocus), false);
  assert.equal(deckAwareMoveInstruction({ state_type: 'boss', run: {}, player: {} }), undefined,
    'a focus with no move instruction stays absent rather than gaining a default');
  // better-policy.mjs CONSUMES the helper rather than re-inlining the condition. Pinned
  // to the call site, not to the import: an import that nothing reads satisfies a weaker
  // check and leaves the unconditional append sitting right underneath it.
  const src = source('better-policy.mjs');
  assert.match(src, /const moveInstruction = deckAwareMoveInstruction\(state\)/,
    'the appended instruction must come from the shared helper');
  assert.doesNotMatch(src, /const moveInstruction = focus\.instructions\.move/,
    'the unconditional append is the bug this file exists to prevent');
  assert.doesNotMatch(src, /card_reward' && !deckAvailable/,
    'the branch must not be re-inlined here');
});

test('the guard demands exactly the prefixes the question asked', async () => {
  const state = fixture('fresh-block');
  const candidates = decisionCandidates(state).slice(0, 2);
  const answered = ids => Object.fromEntries(ids.flatMap(id => FACTOR_PREFIXES
    .map(prefix => [`${prefix}${id}`, { noul: 0.5 }])));
  const broad = { type: 'choice', choice: candidates[0].id,
    probabilities: { [candidates[0].id]: 0.6, [candidates[1].id]: 0.4 }, confidence: 0.6 };
  const run = answers => betterDeliberate({ state, candidates,
    ask: async () => ({ model: 'jev-test', answers: { move: broad, ...answers } }) });

  // The full canonical prefix set, answered for both candidates.
  const complete = await run(answered(candidates.map(c => c.id)));
  assert.equal(complete.deliberation.factorsComplete, true);
  assert.equal(complete.deliberation.factorFallback, false);
  assert.ok(complete.deliberation.ranking, 'and a real ranking came out of it');

  // One missing prefix anywhere and the board is refused, rather than recombined from a
  // factor nobody measured.
  const short = answered(candidates.map(c => c.id));
  delete short[`${FACTOR_PREFIXES[2]}${candidates[1].id}`];
  const partial = await run(short);
  assert.equal(partial.deliberation.factorsComplete, false);
  assert.equal(partial.deliberation.factorFallback, true);
  assert.equal(partial.deliberation.ranking, null);
});

test('a NO_WASTE-shaped board is not reported incomplete', async () => {
  // The arm this policy must not be able to break. `factoredQuestion` only asks
  // `waste_*` when `weights.waste > 0` and `benchmark/sweep.mjs:23` ships a `NO_WASTE`
  // arm with `waste: 0`; demanding `waste_*` anyway reports `factorsComplete:false` on
  // EVERY board for that arm, so the policy falls back to the broad choice forever while
  // still printing a score, and nothing notices.
  const state = fixture('fresh-block');
  const candidates = decisionCandidates(state).slice(0, 2);
  const noWasteAsked = ['safe_', 'prog_'];
  const answers = Object.fromEntries(candidates.flatMap(c => noWasteAsked
    .map(prefix => [`${prefix}${c.id}`, { noul: 0.5 }])));

  // Why the shape is unreachable THROUGH THIS POLICY today: its weights ask for waste.
  assert.ok((WEIGHTS.waste ?? 0) > 0, 'the full set is what this policy asks for today');
  assert.equal(completeFactors(candidates, answers, FACTOR_PREFIXES), false,
    'the same board IS incomplete against the full set - which is why the prefix list cannot be hardcoded');
  assert.equal(completeFactors(candidates, answers, noWasteAsked), true,
    'and is complete against only the prefixes such an arm asks for');
  assert.equal(completeFactors(candidates, answers, []), true, 'nothing asked, nothing missing');

  // Having asked waste on this board, a waste-less answer set must still fall back - the
  // guard follows the question, and the question asked all three.
  const broad = { type: 'choice', choice: candidates[0].id,
    probabilities: { [candidates[0].id]: 0.6, [candidates[1].id]: 0.4 }, confidence: 0.6 };
  const result = await betterDeliberate({ state, candidates,
    ask: async () => ({ model: 'jev-test', answers: { move: broad, ...answers } }) });
  assert.equal(result.deliberation.factorsComplete, false);
  assert.equal(result.deliberation.factorFallback, true);
  assert.equal(result.answers.move.choice, broad.choice, 'the broad answer, not an invented score');
});
