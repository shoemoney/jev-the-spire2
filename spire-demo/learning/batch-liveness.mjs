import { writeFileSync, readFileSync } from 'node:fs';

// Three. It was measured, not chosen: on 2026-10-01 the batch absorbed FIVE consecutive
// `timeout waiting for death` failures as `continue` and then printed `n=1` as its result.
export const MAX_CONSECUTIVE_FAILURES = 3;

// A heartbeat is the ONLY thing that distinguishes a batch still accumulating from a batch that
// drained its run loop and is idling behind a keepAlive interval. Without it those two states are
// byte-identical from outside the process, which is how six and a half hours of nothing came to
// read as a loop that was working.
export function createLiveness({ pid, runs, path, clock = () => new Date() }) {
  const state = {
    pid, runs,
    startedAt: clock().toISOString(),
    status: 'live',
    run: 0,
    completed: 0,
    failed: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastEvent: 'start',
    finishedAt: null,
  };
  let lastError = null;

  const write = () => {
    state.updatedAt = clock().toISOString();
    try { writeFileSync(path, JSON.stringify(state, null, 2)); } catch { }
  };
  write();

  return {
    // Called on every successful run. Resets the consecutive counter, because the escalation is
    // about repetition and a success is the proof that the repetition stopped.
    beat(n, extra = {}) {
      state.run = n;
      state.completed += 1;
      state.consecutiveFailures = 0;
      state.lastError = null;
      state.lastEvent = 'run';
      Object.assign(state, extra);
      write();
    },
    // Returns `{escalate}` so the caller can shout instead of continuing. Same error text twice is
    // already a pattern; three times is a stall, and a stall that keeps being retried is how a
    // batch reports work it never did.
    fail(err) {
      const message = String(err?.message ?? err);
      const repeated = message === lastError;
      lastError = message;
      state.failed += 1;
      state.consecutiveFailures = repeated ? state.consecutiveFailures + 1 : 1;
      state.lastError = message;
      state.lastEvent = 'fail';
      if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) state.status = 'stalled';
      write();
      return { escalate: state.status === 'stalled', consecutiveFailures: state.consecutiveFailures };
    },
    // Poll-time liveness. This exists because beating only on run completion made a batch that was
    // twenty minutes INTO a run look identical to one that had died — measured live at `f2 monster
    // hp=80` with the heartbeat unchanged for 40s. It deliberately touches no counter: `completed`
    // and `failed` count runs, and a poll is not a run.
    tick(extra = {}) {
      state.lastEvent = 'tick';
      Object.assign(state, extra);
      write();
    },
    finish(summary = {}) {
      state.status = 'finished';
      state.finishedAt = clock().toISOString();
      Object.assign(state, summary);
      write();
    },
    state: () => ({ ...state }),
  };
}

export function readLiveness(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// Age alone is not a fault: a batch that has finished its run loop is legitimately old. Only a
// LIVE heartbeat that has stopped moving says anything is wrong.
export function isStale(hb, ms, clock = () => new Date()) {
  if (!hb) return true;
  if (hb.status !== 'live') return false;
  const updated = Date.parse(hb.updatedAt ?? hb.startedAt ?? '');
  if (Number.isNaN(updated)) return true;
  return clock().getTime() - updated > ms;
}