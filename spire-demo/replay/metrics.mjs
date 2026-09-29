// Offline replay metrics over a parsed JSONL run log. Pure functions: no I/O, no
// network, no globals. Unknown is never rendered as a number.
export const COMBAT_STATES = new Set(['monster', 'elite', 'boss']);
export const CAUSES = ['unparsedIncoming', 'unmodeledRelic', 'unmodeledPower', 'unsupportedCard', 'other'];

// Order is significant: the first matching pattern claims the warning.
const CAUSE_PATTERNS = [
  ['unparsedIncoming', /incoming attacks could not be parsed/i],
  ['unmodeledRelic', /^Unmodeled relic:/i],
  ['unmodeledPower', /^Unmodeled (?:player|enemy) power:/i],
  ['unsupportedCard', /^Re-observe after .+; full consequences are not modeled\.|^Retaliation timing or modifiers are unsupported/i],
];
export function classifyWarning(warning) {
  if (typeof warning !== 'string') return 'other';
  for (const [cause, pattern] of CAUSE_PATTERNS) if (pattern.test(warning.trim())) return cause;
  return 'other';
}
const isCombat = e => COMBAT_STATES.has(e?.state?.state_type);
const forecastOf = e => e?.chosen?.forecast ?? null;
const qualityOf = e => forecastOf(e)?.quality ?? null;
const hpOf = e => e?.state?.player?.hp ?? null;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
// Distinguishes a measured 0 from a value the log never captured.
const known = v => (isNum(v) ? v : null);
export function roomKey(e) {
  if (!isCombat(e)) return null;
  const run = e.state?.run;
  if (!isNum(run?.act) || !isNum(run?.floor)) return null;
  return `${run.act}:${run.floor}:${e.state.state_type}`;
}
const roomLabel = key => { const [act, floor, type] = String(key).split(':'); return `A${act}F${floor} ${type}`; };

// The log can hold several consecutive runs appended to one file; a death ends
// a run. Each slice keeps the run_end that closed it so nothing is dropped.
export function splitRuns(events) {
  const out = [];
  let cur = [];
  for (const e of events) {
    cur.push(e);
    if (e?.kind === 'run_end') { out.push(cur); cur = []; }
  }
  if (cur.some(e => e?.kind === 'decision')) out.push(cur);
  return out;
}
const decisionsOf = events => events.filter(e => e?.kind === 'decision');
const endOf = events => events.findLast(e => e?.kind === 'run_end') ?? null;

// A prediction only took effect if it was executed, so calibration pairs only
// walk the executed chain.
const executed = events => decisionsOf(events).filter(e => e.outcome === 'executed');
function turnStartIndices(list) {
  const starts = new Set();
  for (let i = 1; i < list.length; i++) if (list[i - 1]?.chosen?.command?.action === 'end_turn') starts.add(i);
  return starts;
}

function summarizeSlice(events) {
  const decisions = decisionsOf(events);
  const end = endOf(events);
  const last = decisions.at(-1) ?? null;
  const terminal = end?.state ?? last?.state ?? null;
  const endHp = known(hpOf(end)) ?? known(hpOf(last));
  const hpStart = known(hpOf(decisions[0]));
  const rooms = new Set();
  for (const d of decisions) { const k = roomKey(d); if (k) rooms.add(k); }
  const combat = decisions.filter(isCombat);
  const floors = new Set();
  for (const d of decisions) {
    const run = d.state?.run;
    if (isNum(run?.act) && isNum(run?.floor)) floors.add(`${run.act}:${run.floor}`);
  }
  // No run_end means we never saw a terminal state; calling that a win invents one.
  const outcome = end == null ? 'unfinished' : endHp == null ? 'unknown' : endHp <= 0 ? 'death' : 'win';
  return {
    outcome,
    roomsVisited: rooms.size,
    floorsVisited: floors.size,
    finalFloor: known(terminal?.run?.floor),
    finalAct: known(terminal?.run?.act),
    ascension: known(terminal?.run?.ascension),
    decisions: decisions.length,
    combatDecisions: combat.length,
    hpStart,
    hpEnd: endHp,
    // CUMULATIVE HP actually lost, summed across every observed drop. This used to be
    // `hpStart - endHp`, which is not a loss: every run in the corpus started at 64 and ended
    // at 0, so the column printed the same 64 five times and read like a measurement. The two
    // numbers differ wherever a run healed at a rest site, which is exactly where the old one
    // was most misleading. `hpNetChange` keeps the old arithmetic, named for what it is.
    hpLost: cumulativeHpLost(events, hpStart),
    hpNetChange: hpStart == null || endHp == null ? null : hpStart - endHp,
    hpHealed: cumulativeHpHealed(events),
    deathsByFloor: endHp === 0 ? [{ floor: known(terminal?.run?.floor), state_type: terminal?.state_type ?? null, hp: endHp }] : [],
    closedByRunEnd: end != null,
  };
}

// Describes the final run; `runs` carries every run when the file held more than
// one, so a five-death file is never summarised as a single attempt.
/**
 * Total HP actually lost across the run: every observed drop between consecutive decisions,
 * within one run, and only downward. Restoring and card-loss effects that push HP back up are
 * counted separately rather than netted off, because a run that bleeds 90 and heals 30 has not
 * "lost 60" - it has lost 90 and recovered 30, and those are different facts about play.
 *
 * Consecutive observations can belong to different rooms, and a room transition does not heal
 * anyone, so the sum is taken across the whole run rather than per room.
 */
function cumulativeHpLost(events, hpStart) {
  if (hpStart == null) return null;
  let lost = 0, previous = null;
  for (const event of events) {
    const hp = event?.state?.player?.hp;
    if (typeof hp !== 'number') continue;
    if (previous !== null && hp < previous) lost += previous - hp;
    previous = hp;
  }
  return lost;
}

function cumulativeHpHealed(events) {
  let healed = 0, previous = null;
  for (const event of events) {
    const hp = event?.state?.player?.hp;
    if (typeof hp !== 'number') continue;
    if (previous !== null && hp > previous) healed += hp - previous;
    previous = hp;
  }
  return healed;
}

export function summarizeRun(events) {
  const slices = splitRuns(events);
  const runs = slices.map(summarizeSlice);
  const last = runs.at(-1) ?? summarizeSlice([]);
  return { ...last, runCount: runs.length, runs };
}

export function blindness(events) {
  const combat = decisionsOf(events).filter(isCombat);
  const byCause = Object.fromEntries(CAUSES.map(c => [c, 0]));
  const byQuality = { calculated: 0, partial: 0, unknown: 0, unreported: 0 };
  // Blind and bounded are different failures, and a fix moves decisions from the
  // first into the second, so the two must be counted apart. `unbounded` is a
  // forecast that stayed unreadable and therefore keeps the flat ranking penalty.
  const byBound = { exact: 0, bounded: 0, unbounded: 0, unreported: 0 };
  let unknown = 0, unexplained = 0, unmatchedWarnings = 0;
  for (const d of combat) {
    const f = forecastOf(d);
    const q = f?.quality;
    if (q === 'calculated' || q === 'partial' || q === 'unknown') byQuality[q] += 1;
    else byQuality.unreported += 1;
    // A bounded forecast is a usable one: still rankable on its interval. Counted
    // for every combat decision, not only the unknown ones, so the tier can be
    // watched as it fills and not mistaken for a subset of blindness.
    if (f === null) byBound.unreported += 1;
    else if (f.incomingExact === true) byBound.exact += 1;
    else if (isNum(f.incomingMin) && isNum(f.incomingMax)) byBound.bounded += 1;
    else byBound.unbounded += 1;
    if (q !== 'unknown') continue;
    unknown += 1;
    const warnings = Array.isArray(f?.warnings) ? f.warnings : [];
    const hits = new Set(warnings.map(classifyWarning));
    // Inclusive attribution: causes overlap, so the total can exceed `unknown`.
    for (const cause of hits) byCause[cause] += 1;
    if (hits.size === 0 || (hits.size === 1 && hits.has('other'))) unexplained += 1;
    unmatchedWarnings += warnings.filter(w => classifyWarning(w) === 'other').length;
  }
  const causeTotal = CAUSES.reduce((sum, c) => sum + byCause[c], 0);
  return {
    combatDecisions: combat.length,
    unknown,
    unknownRate: combat.length ? unknown / combat.length : null,
    partial: byQuality.partial,
    calculated: byQuality.calculated,
    qualityUnreported: byQuality.unreported,
    bounded: byBound.bounded,
    boundedRate: combat.length ? byBound.bounded / combat.length : null,
    unbounded: byBound.unbounded,
    exact: byBound.exact,
    boundUnreported: byBound.unreported,
    byBound,
    byCause,
    causeTotal,
    byCauseOverlaps: causeTotal > unknown,
    unexplained,
    unmatchedWarnings,
  };
}

// forecast.assumption states the number covers the prefix PLUS ending the turn,
// so a turn-boundary comparison is the only like-for-like test. The adjacent-step
// scope is reported beside it, labelled, because it is the other reading and it
// disagrees with the forecast's own definition.
const BUCKETS = [
  { label: '0', test: p => p === 0 },
  { label: '1-4', test: p => p >= 1 && p <= 4 },
  { label: '5-9', test: p => p >= 5 && p <= 9 },
  { label: '10-19', test: p => p >= 10 && p <= 19 },
  { label: '20+', test: p => p >= 20 },
];
function emptyBucket(label) { return { label, predicted: 0, actual: 0, count: 0, exact: 0, wrong: 0, absError: 0 }; }

function calibrate({ events, scope }) {
  const list = executed(events);
  const starts = turnStartIndices(list);
  const buckets = BUCKETS.map(b => ({ ...emptyBucket(b.label), test: b.test }));
  const byQuality = {};
  let numeric = 0, unknownPredictions = 0, unresolvable = 0, scored = 0, exact = 0, absError = 0;
  const errors = [];
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (!isCombat(d)) continue;
    const f = forecastOf(d);
    const predicted = f?.hpLoss ?? null;
    if (predicted == null) { unknownPredictions += 1; continue; }
    if (!isNum(predicted)) { unresolvable += 1; continue; }
    numeric += 1;
    const key = roomKey(d);
    const from = hpOf(d);
    let j = i + 1;
    if (scope === 'turn') while (j < list.length && !starts.has(j)) j += 1;
    // The room ended or the turn never closed: there is no actual to compare.
    if (j >= list.length || roomKey(list[j]) !== key || from == null || hpOf(list[j]) == null) { unresolvable += 1; continue; }
    const actual = from - hpOf(list[j]);
    const err = Math.abs(predicted - actual);
    const ok = predicted === actual;
    scored += 1; if (ok) exact += 1; absError += err;
    if (!ok) errors.push({ act: d.state.run.act, floor: d.state.run.floor, predicted, actual, absError: err, quality: f.quality ?? null, warnings: Array.isArray(f.warnings) ? f.warnings : [] });
    const bucket = buckets.find(b => b.test(predicted));
    if (bucket) { bucket.predicted += predicted; bucket.actual += actual; bucket.count += 1; bucket.absError += err; if (ok) bucket.exact += 1; else bucket.wrong += 1; }
    const q = f.quality ?? 'unreported';
    const slot = byQuality[q] ?? (byQuality[q] = { scored: 0, exact: 0, wrong: 0 });
    slot.scored += 1; if (ok) slot.exact += 1; else slot.wrong += 1;
  }
  return {
    scope,
    combatDecisions: list.filter(isCombat).length,
    numericPredictions: numeric,
    unknownPredictions,
    unresolvableActual: unresolvable,
    scored,
    exact,
    wrong: scored - exact,
    meanAbsoluteError: scored ? absError / scored : null,
    meanSignedError: scored ? (buckets.reduce((s, b) => s + b.actual - b.predicted, 0) / scored) : null,
    byQuality,
    buckets: buckets.filter(b => b.count > 0).map(b => ({
      label: b.label, count: b.count, exact: b.exact, wrong: b.wrong,
      predicted: b.count ? b.predicted / b.count : null,
      actual: b.count ? b.actual / b.count : null,
      meanAbsoluteError: b.count ? b.absError / b.count : null,
    })),
    errors,
  };
}

export function hpLossCalibration(events) {
  const all = Array.isArray(events) ? events : [];
  const turn = calibrate({ events: all, scope: 'turn' });
  const step = calibrate({ events: all, scope: 'step' });
  return {
    turn,
    step,
    scope: 'turn',
    // A confident wrong number is the failure this metric exists to catch.
    confidentWrong: (turn.byQuality.calculated?.wrong ?? 0) + (turn.byQuality.partial?.wrong ?? 0),
    calculatedWrong: turn.byQuality.calculated?.wrong ?? 0,
  };
}

export function fatalDecisions(events, n = 5) {
  const all = Array.isArray(events) ? events : [];
  return splitRuns(all).map(slice => {
    const end = slice.findLast(e => e?.kind === 'run_end') ?? null;
    const decisions = decisionsOf(slice);
    if (end == null) return { closedByRunEnd: false, decisions: [], unknown: 0, partial: 0, calculated: 0, anyUnknown: false };
    const endAt = slice.indexOf(end);
    const before = decisions.filter(d => slice.indexOf(d) < endAt);
    const window = before.slice(-Math.max(0, n));
    const tally = { calculated: 0, partial: 0, unknown: 0, unreported: 0 };
    for (const d of window) {
      const q = qualityOf(d);
      if (q === 'calculated' || q === 'partial' || q === 'unknown') tally[q] += 1; else tally.unreported += 1;
    }
    return {
      closedByRunEnd: true,
      act: known(end.state?.run?.act),
      floor: known(end.state?.run?.floor),
      ascension: known(end.state?.run?.ascension),
      hpAtDeath: known(hpOf(end)),
      ...tally,
      anyUnknown: tally.unknown > 0,
      anyLowConfidence: tally.unknown + tally.partial > 0,
      decisions: window.map((d, i) => {
        const f = forecastOf(d);
        return {
          position: i + 1,
          room: roomKey(d),
          state_type: d.state?.state_type ?? null,
          hp: known(hpOf(d)),
          block: known(d.state?.player?.block),
          energy: known(d.state?.player?.energy),
          action: d.chosen?.command?.action ?? null,
          label: d.chosen?.label ?? null,
          quality: f?.quality ?? null,
          predictedHpLoss: f?.hpLoss ?? null,
          predictedSurvives: f?.survives ?? null,
          warnings: Array.isArray(f?.warnings) ? f.warnings : [],
        };
      }),
    };
  }).filter(d => d.closedByRunEnd);
}

export { roomLabel };
