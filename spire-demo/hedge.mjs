// Tail-latency hedging for Jev decision calls.
//
// The alpha decisions endpoint answers bimodally. Measured 2026-09-23, fifteen
// sequential calls with an identical payload:
//
//   fast  0.34 0.39 0.40 0.41 0.41 0.62 0.79
//   slow  7.07 7.94 10.59 10.60 14.52 14.83 15.98 16.20
//
// Nothing lands between 0.79s and 7.07s. A 40x gap with an empty middle is two
// serving paths, not load, so waiting longer on a slow one never helps. Firing a
// second identical request does, because the retry draws again:
//
//   sequential single call   p50 7.07s   7/15 under 1s   max 16.20s
//   staggered min-of-3       p50 0.47s   7/8  under 1s   max  3.19s
//
// Staggered rather than always-parallel: the first request alone wins about half
// the time, so most decisions still cost 1x. Input is $0.042/Mtok and output is
// free, so a spare attempt is worth roughly $0.0003.
//
// ONLY for idempotent reads. Jev decisions compute an answer and change nothing,
// so a duplicate is free of consequence. Never wrap a game command in this: a
// timeout on a mutating request can still mean it executed.

// Swept 2026-09-23. Kept at 900ms, and the sweep is why: across 480 graded
// decisions the endpoint stayed in its fast mode (p50 ~300ms, p99 ~650ms) and
// the hedge never fired once, so 900ms cost exactly nothing. Shortening it does
// not buy speed, it buys duplicate requests: delay 250 averaged 1.77 attempts
// per decision, 77% more spend, for no measurable latency gain. The delay
// belongs just above fast-mode p99 so the hedge stays pure insurance against
// the slow path rather than a standing tax.
export const HEDGE_DELAY_MS = 900;   // above the fast path's observed p99
export const MAX_ATTEMPTS = 3;

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); reject(signal.reason); }, { once: true });
});

// `attempt(signal)` must start one request and honour the abort signal.
// Resolves with the first success; rejects only if every attempt failed.
export async function hedged(attempt, { delayMs = HEDGE_DELAY_MS, maxAttempts = MAX_ATTEMPTS, signal } = {}) {
  const controllers = [];
  const stopOthers = () => { for (const c of controllers) c.abort(new Error('hedge: another attempt won')); };
  const failures = [];
  let launched = 0, settled = 0;

  return await new Promise((resolve, reject) => {
    let done = false;
    const finish = (fn, value) => { if (done) return; done = true; stopOthers(); fn(value); };
    const onOuterAbort = () => finish(reject, signal.reason ?? new Error('aborted'));
    signal?.addEventListener('abort', onOuterAbort, { once: true });

    const launch = () => {
      if (done || launched >= maxAttempts) return;
      const index = launched++;
      const controller = new AbortController();
      controllers.push(controller);
      attempt(controller.signal).then(
        value => finish(resolve, value),
        error => {
          settled++;
          if (controller.signal.aborted) return;          // lost the race, not a failure
          failures.push(error);
          // A real failure frees a slot, so try again immediately rather than
          // waiting out the stagger.
          if (launched < maxAttempts) launch();
          // Report the LAST failure, and carry the whole set. `failures[0]` is the earliest
          // attempt, which is the least informative one: attempt 1 is the one that times out when
          // the endpoint is in its slow mode, so a later attempt failing with an HTTP status or a
          // rate-limit message — the actually useful clue — was being thrown away every time.
          //
          // This is why 19 errors in the log are all the identical string "The operation was
          // aborted due to timeout" with nothing else attached: whichever attempt failed first set
          // the message, and the others that may have said something different were discarded.
          else if (settled >= launched) {
            const last = failures[failures.length - 1] ?? error;
            if (failures.length > 1) {
              const seen = [...new Set(failures.map(f => f?.message ?? String(f)))];
              last.message = `${last.message} [${failures.length} attempts: ${seen.join(' | ')}]`;
            }
            finish(reject, last);
          }
        });
      if (launched < maxAttempts) {
        sleep(delayMs, controller.signal).then(launch, () => {});
      }
      return index;
    };
    launch();
  });
}
