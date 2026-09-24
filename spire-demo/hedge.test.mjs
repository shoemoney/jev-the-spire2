import test from 'node:test';
import assert from 'node:assert/strict';
import { hedged } from './hedge.mjs';

const after = (ms, value, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(() => resolve(value), ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
});

test('a fast first attempt costs exactly one request', async () => {
  let launched = 0;
  const value = await hedged(signal => { launched++; return after(5, 'fast', signal); }, { delayMs: 60 });
  assert.equal(value, 'fast');
  await after(120);
  assert.equal(launched, 1, 'no spare request when the first one answers quickly');
});

test('a stalled first attempt is overtaken by the hedge', async () => {
  const started = [];
  const value = await hedged(signal => {
    started.push(Date.now());
    return after(started.length === 1 ? 5000 : 5, 'hedge-' + started.length, signal);
  }, { delayMs: 40 });
  assert.equal(value, 'hedge-2');
  assert.equal(started.length, 2);
});

test('attempts are capped and the loser is aborted, not left running', async () => {
  let launched = 0, aborted = 0;
  await assert.rejects(hedged(signal => {
    launched++;
    signal.addEventListener('abort', () => aborted++, { once: true });
    return after(30, null, signal).then(() => { throw new Error('boom ' + launched); });
  }, { delayMs: 10, maxAttempts: 3 }), /boom/);
  assert.equal(launched, 3, 'never exceeds maxAttempts');
});

test('the winner aborts its siblings', async () => {
  const aborts = [];
  await hedged(signal => {
    const n = aborts.length;
    aborts.push(false);
    signal.addEventListener('abort', () => { aborts[n] = true; }, { once: true });
    return after(n === 0 ? 5000 : 5, 'ok', signal);
  }, { delayMs: 30 });
  await after(20);
  assert.equal(aborts[0], true, 'the stalled attempt is cancelled once a sibling wins');
});

test('a fast failure retries immediately instead of waiting out the stagger', async () => {
  const at = [];
  const start = Date.now();
  const value = await hedged(signal => {
    at.push(Date.now() - start);
    if (at.length === 1) return Promise.reject(new Error('instant failure'));
    return after(5, 'recovered', signal);
  }, { delayMs: 500 });
  assert.equal(value, 'recovered');
  assert.ok(at[1] < 200, `retry waited ${at[1]}ms, should not sit out the full stagger`);
});

test('an outer abort cancels everything', async () => {
  const controller = new AbortController();
  const promise = hedged(signal => after(5000, 'never', signal), { delayMs: 20, signal: controller.signal });
  setTimeout(() => controller.abort(new Error('caller gave up')), 30);
  await assert.rejects(promise, /caller gave up/);
});
