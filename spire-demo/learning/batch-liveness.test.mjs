import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLiveness, readLiveness, isStale, MAX_CONSECUTIVE_FAILURES } from './batch-liveness.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'liveness-'));
const path = () => join(dir(), 'HEARTBEAT.json');

test('a live batch is readable and says so', () => {
  const p = path();
  const live = createLiveness({ pid: 1234, runs: 6, path: p });
  live.beat(1, { floor: 17 });
  const hb = readLiveness(p);
  assert.equal(hb.status, 'live');
  assert.equal(hb.pid, 1234);
  assert.equal(hb.run, 1);
  assert.equal(hb.floor, 17);
});

test('a batch that drains its run loop reports itself FINISHED', () => {
  // THE defect this exists for. On 2026-10-01 the batch completed 1 of 6 runs, printed its summary
  // and idled for 6.5 hours behind a keepAlive interval. `pgrep` said running, /api/status said
  // paused-but-fine, and the run file had not grown since 22:11. Nothing outside the process could
  // tell a finished batch from a working one, so six and a half hours of nothing read as progress.
  const p = path();
  const live = createLiveness({ pid: 1234, runs: 6, path: p });
  live.finish({ completed: 1, failed: 5 });
  const hb = readLiveness(p);
  assert.equal(hb.status, 'finished');
  assert.equal(hb.finishedAt !== null, true);
});

test('readLiveness returns null when there is no heartbeat, and does not throw', () => {
  // An absent heartbeat is evidence, not an error: it means the batch is not running at all.
  assert.equal(readLiveness(join(dir(), 'nope.json')), null);
});

test('three identical failures in a row mark the batch STALLED, not continuing', () => {
  // Five consecutive `timeout waiting for death` failures were absorbed as `continue` and the batch
  // reported `n=1` as if that were the result. A repeat is not a transient blip.
  const p = path();
  const live = createLiveness({ pid: 1, runs: 6, path: p });
  live.fail(new Error('timeout waiting for death'));
  assert.equal(readLiveness(p).status, 'live');
  live.fail(new Error('timeout waiting for death'));
  assert.equal(readLiveness(p).status, 'live');
  const third = live.fail(new Error('timeout waiting for death'));
  assert.equal(third.escalate, true);
  assert.equal(readLiveness(p).status, 'stalled');
});

test('a DIFFERENT failure resets the consecutive counter', () => {
  // The escalation is about repetition, not about having failed. One flaky read should not be able
  // to accumulate toward a stall across unrelated causes.
  const p = path();
  const live = createLiveness({ pid: 1, runs: 6, path: p });
  live.fail(new Error('timeout waiting for death'));
  live.fail(new Error('timeout waiting for death'));
  live.fail(new Error('bridge returned 502'));
  assert.equal(readLiveness(p).consecutiveFailures, 1);
  assert.equal(readLiveness(p).status, 'live');
});

test('a successful run clears the consecutive failure counter', () => {
  const p = path();
  const live = createLiveness({ pid: 1, runs: 6, path: p });
  live.fail(new Error('timeout waiting for death'));
  live.fail(new Error('timeout waiting for death'));
  live.beat(2, { floor: 25 });
  assert.equal(readLiveness(p).consecutiveFailures, 0);
});

test('isStale is what makes a silent batch detectable without reading the log', () => {
  const p = path();
  const hb = { updatedAt: new Date(Date.now() - 120_000).toISOString(), status: 'live' };
  assert.equal(isStale(hb, 60_000), true);
  assert.equal(isStale({ updatedAt: new Date().toISOString(), status: 'live' }, 60_000), false);
  // A FINISHED batch is not stale-and-wrong; it is a completed thing. Age must not read as a fault.
  assert.equal(isStale({ ...hb, status: 'finished' }, 60_000), false);
  assert.equal(isStale(null, 60_000), true);
});

test('the threshold is 3, and it is exported so the batch cannot quietly change it', () => {
  assert.equal(MAX_CONSECUTIVE_FAILURES, 3);
});

test('a corrupt heartbeat file reads as null instead of crashing the reader', () => {
  const p = path();
  writeFileSync(p, '{not json');
  assert.equal(readLiveness(p), null);
});

test('a heartbeat survives being read by something that never created it', () => {
  const p = path();
  const live = createLiveness({ pid: 7, runs: 6, path: p });
  live.beat(1);
  assert.equal(existsSync(p), true);
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(raw.pid, 7);
});

test('tick() moves updatedAt WITHOUT counting a completed run', () => {
  // The first version of this only beat on run COMPLETION, so a batch twenty minutes into a run
  // showed a heartbeat frozen since it started — which isStale would have reported as a dead batch.
  // Measured live: the batch was at `f2 monster hp=80` and the heartbeat had not moved in 40s. The
  // fix is a poll-time tick, and counting runs from it would have made `completed` a lie.
  const p = path();
  let t = Date.parse('2026-01-01T00:00:00.000Z');
  const live = createLiveness({ pid: 1, runs: 6, path: p, clock: () => new Date(t) });
  live.beat(1, { floor: 5 });
  const before = readLiveness(p);
  t += 4000;
  live.tick({ state_type: 'monster', floor: 2, hp: 80 });
  const after = readLiveness(p);
  assert.notEqual(after.updatedAt, before.updatedAt, 'tick must move updatedAt');
  assert.equal(after.completed, before.completed, 'tick must not count a completed run');
  assert.equal(after.failed, before.failed, 'tick must not count a failure');
  assert.equal(after.consecutiveFailures, 0);
  assert.equal(after.state_type, 'monster');
  assert.equal(after.floor, 2);
});

test('tick() alone keeps a long run from ever reading as stale', () => {
  const p = path();
  let t = Date.parse('2026-01-01T00:00:00.000Z');
  const live = createLiveness({ pid: 1, runs: 6, path: p, clock: () => new Date(t) });
  live.beat(1);
  // Twenty minutes of polling at 4s, with no run boundary crossed.
  for (let i = 0; i < 300; i++) { t += 4000; live.tick({ state_type: 'monster', floor: 2 }); }
  const hb = readLiveness(p);
  assert.equal(isStale(hb, 60_000, () => new Date(t)), false);
  assert.equal(hb.status, 'live');
});

test('a batch that never ticks IS stale — the detection still works', () => {
  // tick() must not paper over a genuinely dead batch: if the polling stops, age wins.
  const p = path();
  let t = Date.parse('2026-01-01T00:00:00.000Z');
  const live = createLiveness({ pid: 1, runs: 6, path: p, clock: () => new Date(t) });
  live.beat(1);
  t += 600_000;
  assert.equal(isStale(readLiveness(p), 60_000, () => new Date(t)), true);
});