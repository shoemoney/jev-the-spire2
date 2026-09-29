// The decision log is the only evidence a future run has. These tests exist because the log used to
// record the synthesised answer and discard the factors the ranking was built from — which made every
// downstream claim about the policy unfalsifiable rather than merely unverified.
import test from 'node:test';
import assert from 'node:assert/strict';
import {rawFactors} from './factor-log.mjs';

test('every per-factor noul is kept, in full', () => {
  const answers = {
    move: {type: 'choice', choice: 'p0', probabilities: {p0: 0.5, p1: 0.5}, confidence: 0.4},
    safe_p0: {noul: 0.93}, prog_p0: {noul: 0.11}, waste_p0: {noul: 0.02},
    safe_p1: {noul: 0.20}, prog_p1: {noul: 0.74}, waste_p1: {noul: 0.31},
  };
  assert.deepEqual(rawFactors(answers), {
    safe_p0: 0.93, prog_p0: 0.11, waste_p0: 0.02,
    safe_p1: 0.20, prog_p1: 0.74, waste_p1: 0.31,
  });
});

test('the broad move answer is not duplicated', () => {
  const answers = {move: {type: 'choice', choice: 'p0', probabilities: {p0: 1}, confidence: 0.9}, safe_p0: {noul: 0.5}};
  const kept = rawFactors(answers);
  assert.ok(!('move' in kept), 'move is already recorded whole on the event');
});

test('a factor that never came back is absent, not zero', () => {
  // The exact board that exposed the missing guard: half the candidates answered, half did not.
  const answers = {move: {type: 'choice', choice: 'd'}, safe_a: {noul: 0.9}, safe_b: {noul: 0.1}};
  const kept = rawFactors(answers);
  assert.deepEqual(Object.keys(kept).sort(), ['safe_a', 'safe_b']);
  assert.ok(!('safe_c' in kept), 'an unasked candidate must not appear as a zero reading');
  assert.ok(!('prog_a' in kept) && !('waste_a' in kept), 'missing axes are missing, not zero');
});

test('a malformed factor is dropped rather than coerced', () => {
  const answers = {
    move: {type: 'choice', choice: 'p0'},
    safe_p0: {noul: 0.5},
    safe_p1: {noul: null},      // the model declined
    safe_p2: {noul: 'high'},    // not a number at all
    safe_p3: {},                // no noul field
    prog_p4: {noul: 1.4},       // outside the documented range
  };
  assert.deepEqual(rawFactors(answers), {safe_p0: 0.5},
    'only a usable reading survives; a fabricated 0 would be indistinguishable from a measurement');
});

test('nothing to record is undefined, not an empty object', () => {
  // `factors: {}` on an event reads as "measured, and the answer was nothing" to whatever reads it next.
  assert.equal(rawFactors({move: {type: 'choice', choice: 'p0'}}), undefined);
  assert.equal(rawFactors({}), undefined);
  assert.equal(rawFactors(undefined), undefined);
  assert.equal(rawFactors(null), undefined);
  assert.equal(rawFactors('not an object'), undefined);
});

test('a factor tally is enough to recompute the ranking offline', () => {
  // The point of the whole file: with move + factors, combine() is reproducible. Without factors it is not.
  const answers = {
    move: {type: 'choice', choice: 'p0', probabilities: {p0: 0.6, p1: 0.4}, confidence: 0.5},
    safe_p0: {noul: 0.9}, prog_p0: {noul: 0.8}, waste_p0: {noul: 0.1},
    safe_p1: {noul: 0.2}, prog_p1: {noul: 0.3}, waste_p1: {noul: 0.8},
  };
  const kept = rawFactors(answers);
  for (const id of ['p0', 'p1']) {
    for (const axis of ['safe', 'prog', 'waste']) {
      assert.ok(typeof kept[`${axis}_${id}`] === 'number', `${axis}_${id} is needed to re-score ${id} offline`);
    }
  }
});
