import test from 'node:test';
import assert from 'node:assert/strict';
import { combine, factoredQuestion, factoredDeliberate, WEIGHTS } from './factored.mjs';

const candidates = [
  { id: 'a', label: 'Bash', command: { action: 'play_card', card_index: 0 }, plan: [], details: { description: '' }, forecast: {} },
  { id: 'b', label: 'Defend', command: { action: 'play_card', card_index: 1 }, plan: [], details: { description: '' }, forecast: {} },
  { id: 'c', label: 'End turn', command: { action: 'end_turn' }, plan: [], details: { description: '' }, forecast: {} },
];
const state = { state_type: 'monster', player: { hp: 30, max_hp: 80, energy: 3, hand: [] }, battle: { enemies: [] } };

test('a safe-but-unprogressive option loses to one that scores on both factors', () => {
  const { scored } = combine(candidates, {
    move: { type: 'choice', choice: 'b', probabilities: { a: 0.3, b: 0.5, c: 0.2 }, confidence: 0.4 },
    safe_a: { noul: 0.8 }, prog_a: { noul: 0.9 },
    safe_b: { noul: 0.9 }, prog_b: { noul: 0.1 },
    safe_c: { noul: 0.2 }, prog_c: { noul: 0.1 },
  });
  assert.equal(scored[0].id, 'a', 'progress factor should overturn a defensive plurality');
  assert.equal(scored.at(-1).id, 'c');
});

test('a fatal option cannot win on move probability alone', () => {
  const { scored } = combine(candidates, {
    move: { type: 'choice', choice: 'a', probabilities: { a: 0.9, b: 0.05, c: 0.05 }, confidence: 0.9 },
    safe_a: { noul: 0.01 }, prog_a: { noul: 0.99 },
    safe_b: { noul: 0.99 }, prog_b: { noul: 0.5 },
    safe_c: { noul: 0.5 }, prog_c: { noul: 0.0 },
  });
  const a = scored.find(s => s.id === 'a');
  assert.equal(a.parts.safe, 0, 'the least safe candidate contributes nothing from the safety factor');
  assert.ok(scored[0].score > 0);
});

test('missing nouls fall back to neutral rather than zero, so a capped candidate stays pickable', () => {
  const { scored, probabilities } = combine(candidates, {
    move: { type: 'choice', choice: 'c', probabilities: { a: 0.1, b: 0.1, c: 0.8 }, confidence: 0.7 },
  });
  assert.equal(scored[0].id, 'c');
  for (const c of candidates) assert.ok(probabilities[c.id] > 0, `${c.id} must stay pickable`);
  assert.equal(scored[0].parts.safe, WEIGHTS.safe * 0.5);
});

test('probabilities are a distribution and margin separates first from second', () => {
  const { probabilities, margin } = combine(candidates, {
    move: { type: 'choice', choice: 'a', probabilities: { a: 0.5, b: 0.3, c: 0.2 }, confidence: 0.5 },
    safe_a: { noul: 0.9 }, prog_a: { noul: 0.9 },
    safe_b: { noul: 0.5 }, prog_b: { noul: 0.5 },
    safe_c: { noul: 0.1 }, prog_c: { noul: 0.1 },
  });
  const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.01, `probabilities sum to ${sum}`);
  assert.ok(margin > 0);
});

test('one question per candidate factor is added, and the move question survives', () => {
  const q = factoredQuestion(state, candidates);
  assert.equal(q.questions.move.type, 'choice');
  for (const c of candidates) for (const f of ['safe_', 'prog_', 'waste_']) assert.equal(q.questions[f + c.id].type, 'noul');
  assert.equal(Object.keys(q.questions).length, 1 + candidates.length * 3);
  assert.equal(Object.keys(factoredQuestion(state, candidates, { waste: false }).questions).length, 1 + candidates.length * 2);
});

test('between otherwise identical options, the wasteful one loses', () => {
  const { scored } = combine(candidates, {
    move: { type: 'choice', choice: 'a', probabilities: { a: 0.4, b: 0.4, c: 0.2 }, confidence: 0.3 },
    safe_a: { noul: 0.8 }, prog_a: { noul: 0.6 }, waste_a: { noul: 0.9 },
    safe_b: { noul: 0.8 }, prog_b: { noul: 0.6 }, waste_b: { noul: 0.1 },
    safe_c: { noul: 0.4 }, prog_c: { noul: 0.3 }, waste_c: { noul: 0.5 },
  });
  assert.equal(scored[0].id, 'b', 'paying a cost with no collectable payoff must lose the tiebreak');
  assert.ok(scored.find(s => s.id === 'a').parts.waste < 0, 'waste contributes negatively');
});

// Pins both regimes explicitly so a weight change is a deliberate act. The
// shipped default is the veto: the sweep showed waste 1.0 removes every
// self-harm failure, where waste 1/3 still let Fortifier through sometimes.
test('the waste weight decides whether the penalty is a vote or a veto', () => {
  const answers = {
    move: { type: 'choice', choice: 'a', probabilities: { a: 0.7, b: 0.2, c: 0.1 }, confidence: 0.6 },
    safe_a: { noul: 0.9 }, prog_a: { noul: 0.9 }, waste_a: { noul: 0.98 },
    safe_b: { noul: 0.4 }, prog_b: { noul: 0.3 }, waste_b: { noul: 0.02 },
    safe_c: { noul: 0.1 }, prog_c: { noul: 0.1 }, waste_c: { noul: 0.5 },
  };
  const asVote = combine(candidates, answers, { move: 1 / 3, safe: 1 / 3, progress: 1 / 3, waste: 1 / 3 });
  assert.equal(asVote.scored[0].id, 'a', 'at 1/3 the penalty is outvoted by the three positives');

  const asVeto = combine(candidates, answers, WEIGHTS);
  assert.equal(WEIGHTS.waste, 1, 'shipped default is the veto weight');
  assert.equal(asVeto.scored[0].id, 'b', 'at 1.0 an uncollectable cost loses regardless');
});

test('probabilities stay a valid distribution when a score goes negative', () => {
  const { probabilities } = combine(candidates, {
    move: { type: 'choice', choice: 'a', probabilities: { a: 0, b: 0, c: 1 }, confidence: 1 },
    safe_a: { noul: 0 }, prog_a: { noul: 0 }, waste_a: { noul: 1 },
    safe_b: { noul: 0 }, prog_b: { noul: 0 }, waste_b: { noul: 1 },
    safe_c: { noul: 0 }, prog_c: { noul: 0 }, waste_c: { noul: 1 },
  });
  const sum = Object.values(probabilities).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 0.01, `sums to ${sum}`);
  for (const v of Object.values(probabilities)) assert.ok(v >= 0, 'no negative probability');
});

test('the whole decision costs exactly one round trip', async () => {
  let calls = 0;
  const result = await factoredDeliberate({ state, candidates, ask: async () => {
    calls++;
    return { model: 'jev-1.13', usage: { input_tokens: 10 }, answers: {
      move: { type: 'choice', choice: 'b', probabilities: { a: 0.3, b: 0.5, c: 0.2 }, confidence: 0.4 },
      safe_a: { noul: 0.8 }, prog_a: { noul: 0.9 },
      safe_b: { noul: 0.9 }, prog_b: { noul: 0.1 },
      safe_c: { noul: 0.2 }, prog_c: { noul: 0.1 } } };
  } });
  assert.equal(calls, 1);
  assert.equal(result.deliberation.calls, 1);
  assert.equal(result.answers.move.choice, 'a');
  assert.equal(result.deliberation.jevMove.choice, 'b', 'Jev\'s own pick is preserved, not overwritten');
  assert.equal(result.deliberation.changed, true);
});

test('a single candidate skips the factor questions entirely', async () => {
  let payload;
  const result = await factoredDeliberate({ state, candidates: [candidates[0]], ask: async p => {
    payload = p;
    return { model: 'jev-1.13', answers: { move: { type: 'choice', choice: 'a', probabilities: { a: 1 }, confidence: 1 } } };
  } });
  assert.equal(Object.keys(payload.questions).length, 1);
  assert.equal(result.deliberation, null);
});

test('a factor that did not separate the candidates does not get a vote', () => {
  // Shape taken from the beckon-play fixture: every safe/prog/waste answer
  // within 0.06 of its siblings, so only `move` carries information.
  const { scored } = combine(candidates, {
    move: { type: 'choice', choice: 'b', probabilities: { a: 0.05, b: 0.90, c: 0.05 }, confidence: 0.9 },
    safe_a: { noul: 0.13 }, prog_a: { noul: 0.08 }, waste_a: { noul: 0.80 },
    safe_b: { noul: 0.08 }, prog_b: { noul: 0.06 }, waste_b: { noul: 0.86 },
    safe_c: { noul: 0.07 }, prog_c: { noul: 0.05 }, waste_c: { noul: 0.87 },
  }, { move: 0.25, safe: 0.25, progress: 0.25, waste: 1 });
  assert.equal(scored[0].id, 'b', 'the only informative factor should decide');
  // A neutralised factor is identical for every candidate, so it shifts all
  // scores equally and cannot change the order.
  for (const f of ['safe', 'progress', 'waste']) {
    const values = new Set(scored.map(s => s.parts[f]));
    assert.equal(values.size, 1, `flat ${f} factor must be uniform across candidates`);
  }
});
