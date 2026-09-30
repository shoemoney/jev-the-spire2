// The scorer-vs-model A/B. Every test here is a way this experiment could silently be invalid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abExperiment, hash32 } from './ab-experiment.mjs';

const scored = [{ id: 'p3' }, { id: 'p1' }];
const cands = n => Array.from({ length: n }, (_, i) => ({ id: 'p' + i }));

test('the experiment is off unless explicitly enabled', () => {
  // On by default would mean measuring a behaviour nobody agreed to change, and the control arm
  // becomes unreachable the first time somebody likes the result.
  assert.equal(abExperiment.enabled, /^(1|true|yes|on)$/i.test(String(process.env.SPIRE_AB_MODEL ?? '')));
});

test('no arm is assigned when the scorer and the model already agree', () => {
  // Assigning here would put the same choice in both arms and dilute the comparison with noise.
  assert.equal(abExperiment.armFor(cands(3), scored, { choice: 'p3' }), null);
});

test('the split is deterministic — the same board always lands in the same arm', () => {
  // A clock-based split is irreproducible, and an irreproducible experiment cannot be re-run to
  // check its own result.
  const a = cands(7), first = abExperiment.armFor(a, scored, { choice: 'p1' });
  for (let i = 0; i < 5; i++) assert.equal(abExperiment.armFor(cands(7), scored, { choice: 'p1' }), first);
});

test('the split is interleaved across boards, not whole fights', () => {
  // If one arm owned whole fights, the two arms would see different boards — the exact confounding
  // the experiment exists to remove.
  const counts = { model: 0, scorer: 0 };
  for (let n = 2; n < 60; n++) {
    const arm = abExperiment.armFor(cands(n), scored, { choice: 'p1' });
    if (arm) counts[arm]++;
  }
  assert.ok(counts.model > 5 && counts.scorer > 5, `both arms used across boards: ${JSON.stringify(counts)}`);
  assert.ok(Math.abs(counts.model - counts.scorer) <= 12, 'and neither arm dominates');
});

test('a missing ranking or a missing model choice assigns no arm rather than guessing', () => {
  assert.equal(abExperiment.armFor(cands(3), null, { choice: 'p1' }), null);
  assert.equal(abExperiment.armFor(cands(3), scored, null), null);
  assert.equal(abExperiment.armFor(cands(3), scored, { choice: null }), null);
});

test('the hash is stable and well spread', () => {
  assert.equal(hash32('abc'), hash32('abc'));
  const seen = new Set(Array.from({ length: 200 }, (_, i) => hash32('board' + i) & 1));
  assert.deepEqual([...seen].sort(), [0, 1], 'both parities occur');
});
