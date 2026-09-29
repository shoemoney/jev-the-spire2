// An unmeasured noul must contribute nothing, and must be distinguishable from a
// measured one. `normalise` returns null for a candidate that was never asked;
// combine used to let `?? 0.5` swallow that null and cast it as a full
// mid-confidence vote - the fabricated neutral that learning/attribute.mjs exists
// to keep out of the evidence, appearing one layer up in the scoring itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { combine, DEADBAND, WEIGHTS } from './factored.mjs';

const c = (...ids) => ids.map(id => ({ id }));
const move = probabilities => ({ type: 'choice', choice: 'a', probabilities });
const byId = scored => Object.fromEntries(scored.map(s => [s.id, s]));

test('an unmeasured factor contributes zero, not a mid vote', () => {
  // `c` is beyond MAX_FACTORED_CANDIDATES: the model was never asked about it.
  const { scored } = combine(c('a', 'b', 'c'), {
    move: move({ a: 0.4, b: 0.35, c: 0.25 }),
    safe_a: { noul: 0.2 }, safe_b: { noul: 0.9 },
    prog_a: { noul: 0.2 }, prog_b: { noul: 0.9 },
    waste_a: { noul: 0.1 }, waste_b: { noul: 0.1 },
  });
  const s = byId(scored);
  assert.equal(s.c.parts.safe, 0);
  assert.equal(s.c.parts.progress, 0);
  assert.notEqual(s.c.parts.safe, WEIGHTS.safe * 0.5, 'the fabricated mid vote must not come back');
  assert.deepEqual(s.c.unknown, ['safe', 'progress', 'waste'], 'and it must say so by name');
  // The measured candidates are untouched, so the fix is silence, not a rescale.
  assert.equal(s.b.parts.safe, WEIGHTS.safe);
  assert.deepEqual(s.b.unknown, []);
});

test('a measured 0.5 scores exactly as a measured 0.5, and is not read as unknown', () => {
  // 0.1 / 0.5 / 0.9 spans 0.8, past the deadband, so the middle candidate
  // normalises to exactly 0.5 - the same 0.125 the bug handed to an unmeasured
  // one. Same number, opposite claim about where it came from.
  const { scored } = combine(c('a', 'b', 'c'), {
    move: move({ a: 0.4, b: 0.35, c: 0.25 }),
    safe_a: { noul: 0.1 }, safe_b: { noul: 0.5 }, safe_c: { noul: 0.9 },
    prog_a: { noul: 0.1 }, prog_b: { noul: 0.5 }, prog_c: { noul: 0.9 },
    waste_a: { noul: 0.1 }, waste_b: { noul: 0.5 }, waste_c: { noul: 0.9 },
  });
  const s = byId(scored);
  assert.equal(s.b.n.safe, 0.5);
  assert.equal(s.b.parts.safe, WEIGHTS.safe * 0.5, 'a measured mid must keep its full vote');
  assert.equal(s.b.raw.safe, 0.5, 'and its honest measured value is still reported');
  assert.deepEqual(s.b.unknown, [], 'a measured 0.5 is not an unknown');
  // The audit invariant, which is what makes the two tellable apart at a glance.
  assert.notEqual(s.b.n.safe, null);
  assert.equal(s.b.unknown.includes('safe'), false);
});

test('the deadband still returns neutral for everyone, unchanged', () => {
  // beckon-play shape: every factor inside 0.06, so only `move` has an opinion.
  // The uniform 0.5 is deliberate - it keeps the score on one absolute scale
  // whatever the board - and a factor with no opinion must not vote on noise.
  const { scored } = combine(c('a', 'b', 'c'), {
    move: move({ a: 0.05, b: 0.90, c: 0.05 }),
    safe_a: { noul: 0.13 }, safe_b: { noul: 0.08 }, safe_c: { noul: 0.07 },
    prog_a: { noul: 0.08 }, prog_b: { noul: 0.06 }, prog_c: { noul: 0.05 },
    waste_a: { noul: 0.80 }, waste_b: { noul: 0.86 }, waste_c: { noul: 0.87 },
  });
  for (const s of scored) {
    assert.equal(s.n.safe, 0.5, 'a deadbanded measured factor is neutral, not zero');
    assert.equal(s.parts.safe, WEIGHTS.safe * 0.5);
    assert.deepEqual(s.unknown, [], 'everything was measured here, so nothing is unknown');
  }
  assert.ok(0.06 < DEADBAND, 'the fixture really is inside the deadband');
  // Uniform across candidates, so it cannot reorder anything.
  for (const f of ['safe', 'progress', 'waste']) {
    assert.equal(new Set(scored.map(s => s.parts[f])).size, 1, `${f} stays uniform`);
  }
  assert.equal(byId(scored).b.score - byId(scored).a.score, 0.25 * (0.90 - 0.05) / 0.85);
});

test('waste stays fail-safe: an unmeasured cost is charged nothing', () => {
  // waste is SUBTRACTED, so its unknown direction is the permissive one and it is
  // deliberately NOT the same choice as safe/progress. Charging a cost nobody
  // measured would be an invented safety claim, and at the shipped veto weight
  // 1.0 it would let one unanswered noul outrank a plan whose cost was measured
  // and clean - the exact inverse of preferring a plan we cannot evaluate.
  const board = c('a', 'b', 'c');
  const factors = {
    move: move({ a: 0.4, b: 0.35, c: 0.25 }),
    safe_a: { noul: 0.9 }, safe_b: { noul: 0.9 }, safe_c: { noul: 0.9 },
    prog_a: { noul: 0.9 }, prog_b: { noul: 0.9 }, prog_c: { noul: 0.9 },
    waste_a: { noul: 0.98 }, waste_b: { noul: 0.02 },
    // no waste_c: never asked.
  };
  const s = byId(combine(board, factors).scored);
  assert.equal(s.c.parts.waste, 0, 'unknown waste is no penalty, not a full one');
  assert.ok(s.c.unknown.includes('waste'), 'and it is still reported as unknown, not as a clean 0');
  // a measured 0.02 costs nothing but is still a measurement - same part, and
  // `unknown` is the only thing that tells them apart. That is the whole point.
  assert.equal(s.b.parts.waste, 0);
  assert.equal(s.b.unknown.includes('waste'), false);
  assert.equal(s.a.parts.waste, -WEIGHTS.waste, 'a real cost is still charged in full');

  // The free pass, pinned by counterfactual rather than by a hand-waved ordering:
  // the SAME board with c's cost measured at the maximum it could carry demotes c
  // below b. So the only reason c is not demoted is that nothing was charged.
  const charged = byId(combine(board, { ...factors, waste_c: { noul: 0.98 } }).scored);
  assert.equal(charged.c.parts.waste, -WEIGHTS.waste, 'the same candidate, measured, is charged in full');
  assert.equal(s.c.score - charged.c.score, WEIGHTS.waste, 'the whole free pass is the veto weight');
  assert.ok(s.c.score > charged.c.score, 'an unmeasured cost never sinks its own candidate');
  assert.equal(WEIGHTS.waste, 1, 'shipped default is the veto weight, where this matters most');
});

test('the working exposes the zero-vote so a reader can audit it', () => {
  // Five measured candidates and two past the cap. `move` is the only axis that
  // separates them cleanly: the measured candidates score positive on all three
  // factors, while f and g collect only their move share - so they sort between
  // the strong and the weak measured candidates rather than at the bottom.
  // Deliberately: an unmeasured candidate is NOT punished for being unmeasured
  // (see the waste test), so where it lands is a property of the board, not a
  // rule. What must hold everywhere is that each zero part is labelled.
  const { scored, unmeasured } = combine(c('a', 'b', 'c', 'd', 'e', 'f', 'g'), {
    move: move({ a: 0.20, b: 0.18, c: 0.16, d: 0.14, e: 0.12, f: 0.06, g: 0.04 }),
    safe_a: { noul: 0.90 }, safe_b: { noul: 0.85 }, safe_c: { noul: 0.80 }, safe_d: { noul: 0.75 }, safe_e: { noul: 0.70 },
    prog_a: { noul: 0.90 }, prog_b: { noul: 0.85 }, prog_c: { noul: 0.80 }, prog_d: { noul: 0.75 }, prog_e: { noul: 0.70 },
    waste_a: { noul: 0.05 }, waste_b: { noul: 0.10 }, waste_c: { noul: 0.15 }, waste_d: { noul: 0.20 }, waste_e: { noul: 0.25 },
    // f and g are past the cap and were never asked.
  });
  for (const s of scored) for (const f of ['safe', 'progress', 'waste']) {
    // One direction only, and deliberately: an unknown NEVER contributes, so
    // null implies a zero part. The converse is false and must stay false - a
    // candidate that measured lowest is a real vote that legitimately lands on
    // zero, and `n`/`raw`/`unknown` are what keep the two tellable apart.
    if (s.n[f] === null) assert.equal(s.parts[f], 0, `${s.id}.${f}: unknown contributes nothing`);
    assert.equal(s.unknown.includes(f), s.n[f] === null, `${s.id}.${f}: flagged exactly when null`);
    if (s.n[f] === null) assert.equal(s.raw[f], null, `${s.id}.${f}: raw stays honestly null`);
    else assert.equal(typeof s.raw[f], 'number');
  }
  // The measured minimum is a zero part that is NOT unknown: same number as a
  // silent factor, opposite claim, and only `n`/`raw` can tell them apart.
  assert.equal(byId(scored).a.n.waste, 0);
  assert.equal(byId(scored).a.parts.waste, 0);
  assert.equal(byId(scored).a.unknown.includes('waste'), false);
  for (const s of scored.filter(x => x.unknown.length)) {
    assert.deepEqual(s.unknown.sort(), ['progress', 'safe', 'waste']);
  }
  assert.equal(scored.filter(s => s.unknown.length).length, 2);
  assert.deepEqual(byId(scored).a.unknown, []);
  // The tally is what a decision log reads: `ranking` carries only the top five,
  // and where the unmeasured pair lands is board-dependent, so the log cannot be
  // made to reveal them by construction - only the tally can, every time.
  for (const f of ['safe', 'progress', 'waste']) assert.deepEqual(unmeasured[f].sort(), ['f', 'g']);
  assert.equal(unmeasured.move, undefined, 'move is answered for every candidate, always');
});

test('a board where nobody supplied a factor still ranks, from move alone', () => {
  // `normalise` returns an EMPTY Map when nothing was measured, so every lookup
  // is undefined rather than null - the other half of the bug's two paths. It
  // must still produce a ranking, no throw and no NaN: `move` is answered for
  // every candidate by construction, so the board is ranked, not abandoned.
  const board = c('a', 'b', 'c');
  const { scored, probabilities, margin, unmeasured } = combine(board, {
    move: move({ a: 0.5, b: 0.3, c: 0.2 }),
  });
  const s = byId(scored);
  for (const x of scored) {
    assert.deepEqual(x.unknown, ['safe', 'progress', 'waste']);
    assert.equal(x.raw.safe, null, 'raw stays honestly null');
    for (const f of ['safe', 'progress', 'waste']) assert.equal(x.parts[f], 0);
    assert.ok(Number.isFinite(x.score), 'no NaN leaked into the score');
    assert.ok(Number.isFinite(probabilities[x.id]), 'and none into the distribution');
  }
  // Ranked on the one axis that answered, in the model's own order.
  assert.deepEqual(scored.map(x => x.id), ['a', 'b', 'c']);
  assert.equal(s.a.parts.move, 0.25, 'the full move weight, unopposed');
  assert.equal(s.b.parts.move, 0.25 * (0.3 - 0.2) / 0.3);
  assert.equal(margin, Number((0.25 * (0.5 - 0.3) / 0.3).toFixed(4)), 'margin, as rounded for the log');
  assert.deepEqual(Object.keys(probabilities), ['a', 'b', 'c']);
  for (const f of ['safe', 'progress', 'waste']) assert.deepEqual(unmeasured[f], ['a', 'b', 'c']);
  // The old code would have handed all three of them a fabricated 0.5 mid vote.
  assert.notEqual(s.a.parts.safe, WEIGHTS.safe * 0.5);
});

test('combine still throws on a missing or non-choice move answer', () => {
  // The guard is `move?.type !== 'choice'`, the first statement in combine, so
  // these are rejected before a single factor is read. Its scope is deliberate
  // and unchanged: it does not vet `choice` or `probabilities` (that is
  // factoredDeliberate's job), it only refuses to score without a choice.
  const board = c('a', 'b');
  const factors = { safe_a: { noul: 0.9 }, safe_b: { noul: 0.9 } };
  assert.throws(() => combine(board, factors), /Missing Jev move choice/);
  assert.throws(() => combine(board, { ...factors, move: null }), /Missing Jev move choice/);
  assert.throws(() => combine(board, { ...factors, move: { noul: 0.5 } }), /Missing Jev move choice/);
  assert.throws(() => combine(board, { ...factors, move: { probabilities: { a: 1, b: 0 } } }), /Missing Jev move choice/);
  // And the same board with a real choice scores, so the guard is not vacuous.
  assert.equal(combine(board, { ...factors, move: { type: 'choice', choice: 'a', probabilities: { a: 0.6, b: 0.4 } } })
    .scored[0].id, 'a');
});
