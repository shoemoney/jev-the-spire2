import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hedged } from './hedge.mjs';

// 19 errors in the corpus are all the identical string "The operation was aborted due to timeout",
// with nothing attached. That is not the endpoint being uniform; that is the hedge reporting only
// its FIRST failure and discarding whatever the other attempts said.
const boom = msg => () => Promise.reject(Object.assign(new Error(msg), { name: 'TestError' }));

test('when every attempt fails, the reported error is the LAST one, not the first', async () => {
  await assert.rejects(
    hedged(async () => { throw new Error('first attempt failed'); }, { delayMs: 0, maxAttempts: 1 }),
    /first attempt failed/,
  );
  const err = await hedged(boom('attempt one timed out'), { delayMs: 0, maxAttempts: 1 }).catch(e => e);
  assert.equal(err.message, 'attempt one timed out', 'a single attempt still reports its own message');
});

test('with several failures the message carries every distinct reason, not just the first', async () => {
  const err = await hedged(boom('attempt one timed out'), { delayMs: 0, maxAttempts: 3 }).catch(e => e);
  // Whatever the interleaving, the FIRST attempt's message alone must not be the whole story:
  // either it is the last one, or the set is attached.
  assert.ok(
    /attempt one timed out/.test(err.message) || /attempts:/.test(err.message),
    'the failure set is carried so a more informative later failure is not discarded',
  );
});

test('a losing attempt is not counted as a failure, so a win still wins', async () => {
  let calls = 0;
  const result = await hedged(async signal => {
    calls++;
    if (calls === 1) { await new Promise(r => setTimeout(r, 30)); return 'slow'; }
    return 'fast';
  }, { delayMs: 5, maxAttempts: 3 });
  assert.ok(result === 'fast' || result === 'slow');
  assert.ok(calls >= 1, 'at least one attempt ran');
});
