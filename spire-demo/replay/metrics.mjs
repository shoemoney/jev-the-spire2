// Offline replay metrics over a parsed JSONL run log. Pure functions: no I/O, no
// network, no globals. Unknown is never rendered as a number.
export const COMBAT_STATES = new Set(['monster', 'elite', 'boss']);

// TWO TAXONOMIES, and conflating them is the bug this split exists to prevent.
//
// planner.mjs sets `quality: uncertain ? 'unknown' : warnings.length ? 'partial' : 'calculated'`.
// A warning therefore moves a forecast to `partial` and can NEVER move it to `unknown`.
// Only the six branches of `uncertain` can. So:
//
//   CAUSES         - the branches that actually set `uncertain`. A hit here is a CAUSE of an
//                    unknown forecast, because without it the forecast would have been numeric.
//   CONTEXT_KINDS  - everything else a warning can mention. Present on a `partial` row and on
//                    an `unknown` row alike, so it is CONTEXT, not cause. Printing it under a
//                    total of unknowns reads as an explanation it cannot support: in the recorded
//                    corpus "Unmodeled relic" appears on 519 of 519 combat decisions, so its
//                    count equals the unknown count by arithmetic alone and explains nothing.

// Order is significant: the first matching pattern claims the warning.
// Order is significant: the first matching pattern claims the warning.
// 'other' is deliberately NOT a cause bucket. A warning naming no branch says nothing about why
// the forecast was unknown, and counting one per warning made `other` land on every unknown in
// the corpus — a second constant-true bucket wearing a cause's name. A decision with no branch
// named at all is reported once, as `unexplained`.
export const CAUSES = ['unparsedIncoming', 'unsupportedCard', 'unresolvedDeathEffect', 'positioningUnknown', 'lethalTurnRule'];

// Mirrors `planner.mjs`'s `uncertain` expression term by term.
const CAUSE_PATTERNS = [
  ['unparsedIncoming', /incoming attacks could not be (?:read|parsed)/i],
  ['unsupportedCard', /full consequences are not modeled|this card or play-limit interaction is not modeled|Energy gain amount could not be parsed|Retaliation timing or modifiers are unsupported/i],
  ['unresolvedDeathEffect', /death triggers remain unresolved|may not end combat|death effect/i],
  ['positioningUnknown', /Position-dependent incoming damage is not modeled/i],
  ['lethalTurnRule', /visible rule says the enemy taking its turn kills you/i],
];

export const CONTEXT_KINDS = ['unmodeledRelic', 'unmodeledPower', 'incomingIsBound', 'intentMismatch', 'other'];
const CONTEXT_PATTERNS = [
  ['unmodeledRelic', /^Unmodeled relic:/i],
  ['unmodeledPower', /^Unmodeled (?:player|enemy) power:/i],
  ['incomingIsBound', /^Incoming damage is a bound, not a total:/i],
  ['intentMismatch', /intent label disagrees with its own per-hit value and hit count/i],
];

/**
 * Which branch of `uncertain` a warning belongs to, or 'other' when it names none.
 * Returning 'other' means the planner went uncertain for a reason this log does not state —
 * an honest gap in the attribution, reported as `unexplained` rather than guessed at.
 */
export function classifyBlindnessCause(warning) {
  if (typeof warning !== 'string') return 'other';
  const t = warning.trim();
  for (const [cause, pattern] of CAUSE_PATTERNS) if (pattern.test(t)) return cause;
  return 'other';
}

/**
 * Every warning family present on a forecast, cause or not. Used for ATTACHED CONTEXT: what
 * conditions were true alongside the unknown. It is not an explanation and is never printed
 * as one.
 */
export function classifyWarning(warning) {
  if (typeof warning !== 'string') return 'other';
  const t = warning.trim();
  for (const [kind, pattern] of CONTEXT_PATTERNS) if (pattern.test(t)) return kind;
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
    ...(() => { const l = cumulativeHpLost(events, hpStart, endHp); return l === null ? {hpLost: null} : {hpLost: l.value, hpLossIsFloor: l.isFloor, hpLossGaps: l.gaps}; })(),
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
function cumulativeHpLost(events, hpStart, endHp) {
  // An unobservable end is not a zero loss. `hpStart - endHp` used to make this exact mistake in
  // reverse; the rule is the same either way: if the account cannot be closed, say so.
  if (hpStart == null || endHp == null) return null;
  let lost = 0, previous = null, gaps = 0;
  for (const event of events) {
    const hp = event?.state?.player?.hp;
    if (typeof hp !== 'number') { gaps++; continue; }
    if (previous !== null && hp < previous) lost += previous - hp;
    previous = hp;
  }
  // A gap in the middle means the sum is missing whatever happened across it, so it is a FLOOR,
  // not the total. Returning it as the total would be a confident under-count, and returning an
  // object where a number is expected is worse: an earlier draft did exactly that and the report
  // printed `[object Object]` in the hp-lost column. The number is always a number; the floor
  // flag travels beside it.
  if (gaps) return {value: lost, gaps, isFloor: true};
  return {value: lost, gaps, isFloor: false};
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
  const attachedContext = Object.fromEntries(CONTEXT_KINDS.map(c => [c, 0]));
  // How many combat decisions carried each context family, across the WHOLE corpus. A context
  // family present on every combat decision cannot separate unknown from partial, so its share
  // of the unknowns is an artefact of the corpus and not an explanation of them.
  const contextOnCombat = Object.fromEntries(CONTEXT_KINDS.map(c => [c, 0]));
  const byQuality = { calculated: 0, partial: 0, unknown: 0, unreported: 0 };
  // Blind and bounded are different failures, and a fix moves decisions from the
  // first into the second, so the two must be counted apart. `unbounded` is a
  // forecast that stayed unreadable and therefore keeps the flat ranking penalty.
  const byBound = { exact: 0, bounded: 0, unbounded: 0, unreported: 0 };
  let unknown = 0, unexplained = 0, unmatchedWarnings = 0, unmatchedCauseWarnings = 0;
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
    const warnings = Array.isArray(f?.warnings) ? f.warnings : [];
    const context = new Set(warnings.map(classifyWarning));
    // Context is tallied over every combat decision, unknown or not, and once per DECISION
    // rather than once per warning: a board with four unmodelled relics emits four warnings, and
    // counting them would let the share exceed the number of decisions it is a share of.
    for (const kind of context) contextOnCombat[kind] += 1;
    if (q !== 'unknown') continue;
    unknown += 1;
    const causes = new Set(warnings.map(classifyBlindnessCause).filter(c => c !== 'other'));
    // Inclusive attribution: causes overlap, so the total can exceed `unknown`.
    for (const cause of causes) byCause[cause] += 1;
    for (const kind of context) attachedContext[kind] += 1;
    // No branch named: the log does not say why, and that is reported rather than guessed at.
    if (causes.size === 0) unexplained += 1;
    unmatchedWarnings += warnings.filter(w => classifyWarning(w) === 'other').length;
    unmatchedCauseWarnings += warnings.filter(w => classifyBlindnessCause(w) === 'other').length;
  }
  const causeTotal = CAUSES.reduce((sum, c) => sum + byCause[c], 0);
  // Constant-true: the family is on every single combat decision, so it is true exactly when the
  // agent plays. Reported so a reader can dismiss it, rather than printed as a count that sits
  // under the unknown total and reads like an explanation. 'other' is excluded because it means
  // "no family matched" rather than naming a condition, so it is ubiquitous by construction.
  const constantTrueContext = combat.length
    ? CONTEXT_KINDS.filter(k => k !== 'other' && contextOnCombat[k] === combat.length)
    : [];
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
    attachedContext,
    contextOnCombat,
    constantTrueContext,
    unmatchedCauseWarnings,
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
function emptyBucket(label) { return { label, predicted: 0, actual: 0, count: 0, exact: 0, wrong: 0, trivialExact: 0, absError: 0 }; }

// How far short a prediction may fall and still be harmless. Under-predicting is the direction
// that kills: believing the turn costs 3 when it costs 8 is a different decision than the
// reverse. The exact cliff is a judgement, so it is named and reported rather than folded into
// a single error average that cannot tell the two directions apart.
export const LETHAL_UNDERSHOOT = 5;

// Walks forward to the boundary this scope measures against: the first decision of the next
// turn, or the very next decision for the 'step' scope. -1 when the room ended or the turn
// never closed, which means there is no actual to compare against — unknown, never zero.
function boundaryIndex(list, i, starts, scope) {
  if (scope !== 'turn') return i + 1 < list.length ? i + 1 : -1;
  let j = i + 1;
  while (j < list.length && !starts.has(j)) j += 1;
  return j < list.length ? j : -1;
}

// The realised hp loss for one decision under this scope, or null when the log does not
// support one. Runs for unknown forecasts too: no prediction was made, but the loss happened.
function realisedLoss(list, i, starts, scope, d) {
  const key = roomKey(d);
  const from = hpOf(d);
  const j = boundaryIndex(list, i, starts, scope);
  if (j < 0 || roomKey(list[j]) !== key || from == null || hpOf(list[j]) == null) return null;
  return from - hpOf(list[j]);
}

function calibrate({ events, scope }) {
  const list = executed(events);
  const starts = turnStartIndices(list);
  const buckets = BUCKETS.map(b => ({ ...emptyBucket(b.label), test: b.test }));
  const byQuality = {};
  let numeric = 0, unknownPredictions = 0, unresolvable = 0, scored = 0, exact = 0, absError = 0;
  // A predicted 0 met by an actual 0 is a forecast that was never asked a hard question: it
  // agrees with the outcome whether or not the planner understood anything. In the recorded
  // corpus these are the majority of scored rows, so a headline that includes them is mostly
  // reporting that nothing happened. They stay in the raw figures and leave the non-trivial one.
  let nonTrivialScored = 0, nonTrivialExact = 0, nonTrivialAbsError = 0;
  let underPredictions = 0, overPredictions = 0, lethalUndershoots = 0;
  // The cost of going blind, measured on the rows that went blind.
  let unknownResolved = 0, unknownUnresolved = 0, unknownAbs = 0, unknownLethal = 0;
  const unknownBuckets = BUCKETS.map(b => ({ label: b.label, count: 0, test: b.test }));
  const unknownWorst = { realised: null, act: null, floor: null };
  const errors = [];
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    if (!isCombat(d)) continue;
    const f = forecastOf(d);
    const predicted = f?.hpLoss ?? null;
    if (predicted == null) {
      // Admitted ignorance, not a wrong answer: a null forecast made no claim to miss. It stays
      // out of every accuracy denominator below. But the log DOES carry the HP either side of the
      // turn boundary, so what blindness cost is measurable, and skipping the measurement is how
      // the report ends up describing only the regime where the agent could see.
      unknownPredictions += 1;
      const realised = realisedLoss(list, i, starts, scope, d);
      if (realised === null) unknownUnresolved += 1;
      else {
        unknownResolved += 1; unknownAbs += Math.abs(realised);
        if (realised >= LETHAL_UNDERSHOOT) unknownLethal += 1;
        const slot = unknownBuckets.find(b => b.test(realised));
        if (slot) slot.count += 1;
        if (unknownWorst.realised === null || realised > unknownWorst.realised) {
          unknownWorst.realised = realised;
          unknownWorst.act = known(d.state?.run?.act);
          unknownWorst.floor = known(d.state?.run?.floor);
        }
      }
      continue;
    }
    if (!isNum(predicted)) { unresolvable += 1; continue; }
    numeric += 1;
    const key = roomKey(d);
    const from = hpOf(d);
    const j = boundaryIndex(list, i, starts, scope);
    // The room ended or the turn never closed: there is no actual to compare.
    if (j < 0 || roomKey(list[j]) !== key || from == null || hpOf(list[j]) == null) { unresolvable += 1; continue; }
    const actual = from - hpOf(list[j]);
    const err = Math.abs(predicted - actual);
    const ok = predicted === actual;
    const trivial = predicted === 0 && actual === 0;
    scored += 1; if (ok) exact += 1; absError += err;
    if (actual > predicted) {
      underPredictions += 1;
      if (actual - predicted >= LETHAL_UNDERSHOOT) lethalUndershoots += 1;
    } else if (actual < predicted) overPredictions += 1;
    if (!trivial) { nonTrivialScored += 1; if (ok) nonTrivialExact += 1; nonTrivialAbsError += err; }
    if (!ok) errors.push({ act: d.state.run.act, floor: d.state.run.floor, predicted, actual, absError: err, direction: actual > predicted ? 'under' : 'over', quality: f.quality ?? null, warnings: Array.isArray(f.warnings) ? f.warnings : [] });
    const bucket = buckets.find(b => b.test(predicted));
    if (bucket) {
      bucket.predicted += predicted; bucket.actual += actual; bucket.count += 1; bucket.absError += err;
      if (ok) { bucket.exact += 1; if (trivial) bucket.trivialExact += 1; } else bucket.wrong += 1;
    }
    const q = f.quality ?? 'unreported';
    const slot = byQuality[q] ?? (byQuality[q] = { scored: 0, exact: 0, wrong: 0 });
    slot.scored += 1; if (ok) slot.exact += 1; else slot.wrong += 1;
  }
  const combatDecisions = list.filter(isCombat).length;
  return {
    scope,
    combatDecisions,
    numericPredictions: numeric,
    unknownPredictions,
    unresolvableActual: unresolvable,
    scored,
    exact,
    wrong: scored - exact,
    exactRate: scored ? exact / scored : null,
    // How much of combat the scored rows actually cover. A percentage quoted without it reads
    // as a verdict on the whole corpus when it is a verdict on the part the log could score.
    coverage: combatDecisions ? scored / combatDecisions : null,
    meanAbsoluteError: scored ? absError / scored : null,
    meanSignedError: scored ? (buckets.reduce((s, b) => s + b.actual - b.predicted, 0) / scored) : null,
    // The headline that survives trivial zeros. Both figures are published: dropping the raw one
    // would read as a measured accuracy drop rather than a change of denominator.
    nonTrivial: {
      scored: nonTrivialScored,
      exact: nonTrivialExact,
      wrong: nonTrivialScored - nonTrivialExact,
      exactRate: nonTrivialScored ? nonTrivialExact / nonTrivialScored : null,
      meanAbsoluteError: nonTrivialScored ? nonTrivialAbsError / nonTrivialScored : null,
      trivialZeros: scored - nonTrivialScored,
    },
    // Direction matters and a signed mean hides it: an average that nets a safe overestimate
    // against a lethal underestimate describes neither.
    underPredictions,
    overPredictions,
    lethalUndershoots,
    underPredictionsAtLeast5: lethalUndershoots,
    lethalUndershootThreshold: LETHAL_UNDERSHOOT,
    byQuality,
    buckets: buckets.filter(b => b.count > 0).map(b => ({
      label: b.label, count: b.count, exact: b.exact, wrong: b.wrong, trivialExact: b.trivialExact,
      predicted: b.count ? b.predicted / b.count : null,
      actual: b.count ? b.actual / b.count : null,
      meanAbsoluteError: b.count ? b.absError / b.count : null,
    })),
    unknownLoss: {
      scope,
      rows: unknownPredictions,
      resolved: unknownResolved,
      unresolved: unknownUnresolved,
      meanRealisedLoss: unknownResolved ? unknownAbs / unknownResolved : null,
      atLeast5: unknownLethal,
      lethalThreshold: LETHAL_UNDERSHOOT,
      histogram: unknownBuckets.filter(b => b.count > 0).map(b => ({ label: b.label, count: b.count })),
      worst: unknownWorst.realised === null ? null : { ...unknownWorst },
    },
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
    // The regime that kills, published next to the regime that scored well.
    unknownLoss: turn.unknownLoss,
  };
}

// A death window is where "we had nothing" and "the log never said" have to be told apart. A
// missing `potions` key is UNKNOWN, so this returns null; a present but empty list is a real
// measurement of an empty hand and returns []. Collapsing the two is how a report ends up
// claiming a healing potion was unavailable when the recording simply never carried one.
function potionsOf(player) {
  const list = player?.potions;
  if (!Array.isArray(list)) return null;
  return list.map(p => ({
    slot: isNum(p?.slot) ? p.slot : null,
    name: typeof p?.name === 'string' ? p.name : null,
    // Absent is null, not false: "not usable" and "not recorded" are different claims.
    usable: typeof p?.can_use_in_combat === 'boolean' ? p.can_use_in_combat : null,
  }));
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
          // null when the log recorded no potion list, [] when it recorded an empty one.
          potions: potionsOf(d.state?.player),
        };
      }),
    };
  }).filter(d => d.closedByRunEnd);
}

// FIGHT OUTCOMES — the one thing the corpus could always answer and never did.
//
// The loop reported how DEEP a run got (floors) but never whether a fight was WON, because a
// win and a loss look identical in a per-run summary: both end with a `run_end` eventually. Two
// wrong numbers came out of hand-rolled attempts to infer it, and they disagreed:
//
//   "6 boss fights, no kill"  grouped every run's boss sequence and called it a loss whenever the
//                             run ended — which is exactly what happens AFTER a kill, on the long
//                             walk to the next act. The one real kill read as a loss.
//   "12 won, 0 lost"          scanned past the end of a run, so the NEXT run's first non-combat
//                             decision was read as "the boss died". Every completed fight read as
//                             a win.
//
// The fix is not a better heuristic; it is to use the transition the log actually records. A
// fight is WON when the screen leaves combat and the run continues, LOST when `run_end` arrives
// while still in combat, and UNRESOLVED when neither is observed. A kill is the easiest kind of
// fact in this whole log to read and we were inferring it.
//
// An intent that telegraphs no damage is not an unreadable intent. In the corpus 1589 of 4592
// intents are Buff/Defend/Debuff/Summon/Stun, all with an empty label, and 895 of THOSE are Buffs.
// A first draft counted every non-numeric label as unparseable and reported the agent as blind on
// 47% of all decisions, loss and win alike. Both halves of that were wrong: an empty label on a
// Buff is correct, and blindness uncorrelated with losing is not blindness worth fixing. Only
// intent types that actually telegraph damage are counted, and among those the corpus contains
// exactly two label shapes — a plain integer and `NxM` — with zero prose anywhere.
const DAMAGE_INTENT_TYPES = new Set(['Attack', 'AttackDebuff', 'AttackDefend', 'AttackBuff']);

// `unresolved` is a real bucket, not a hedge, but it is now narrow on purpose. It means the log
// did not observe how the fight ended: the file ended mid-combat, or a combat room was replaced
// by another combat room with no non-combat screen between them (suspicious data). It does NOT
// mean "some screen I did not enumerate", because enumerating screens is how this function got
// the first four boss kills wrong.
const POST_COMBAT_STATES = new Set([
  'rewards', 'card_reward', 'treasure', 'rest', 'map', 'shop', 'char_select', 'game_over',
]);

export function fightOutcomes(events) {
  const fights = [];
  let open = null;

  for (const ev of events) {
    const kind = ev?.kind;
    const state = ev?.state ?? {};
    const type = state.state_type ?? null;

    if (kind === 'run_end') {
      // A run that ends mid-combat died in it. This is the ONLY loss signal, and it is
      // unambiguous. Reset so the next run cannot inherit or invent a fight.
      if (open) { open.outcome = 'lost'; open.closedBy = 'run_end'; fights.push(open); open = null; }
      continue;
    }
    if (kind !== 'decision') continue;

    if (COMBAT_STATES.has(type)) {
      if (!open || open.type !== type) {
        // A different combat room is a different fight, even in the same run.
        if (open) { open.outcome = 'unresolved'; open.closedBy = 'superseded'; fights.push(open); }
        const enemies = Array.isArray(state.battle?.enemies) ? state.battle.enemies : [];
        open = {
          type,
          name: enemies[0]?.name ?? null,
          startHp: Number.isFinite(enemies[0]?.hp) ? enemies[0].hp : null,
          // Ascension belongs ON the fight, not beside it. Pooling A0 and A10 win rates produces a
          // number that moves for reasons that have nothing to do with the policy, and the whole
          // reason this project keeps records is to know whether the POLICY is improving.
          //
          // The split is not academic. In the recorded corpus the agent has killed 5 bosses and
          // every one is Ascension 0, while both Ascension 10 boss fights are losses. Reported as
          // a single pool, that reads as a 42% boss win rate — which is true, useless, and would
          // hide the only fact worth acting on: the difficulty the policy actually has to survive
          // is where it has never won.
          ascension: Number.isFinite(state.run?.ascension) ? state.run.ascension : null,
          decisions: 0,
          endHp: null,
          blockAtEnd: null,
          intentLabels: [],
          multiHitIntents: 0,
          intentsSeen: 0,
          unknownForecasts: 0,
          outcome: 'unresolved',
          closedBy: null,
        };
      }
      open.decisions += 1;
      // Facts about HOW the fight went, captured while the state is in hand. The outcome alone
      // says the fight was lost; these say what the agent was facing when it was, which is the
      // difference between "10 losses" and "10 losses for these five reasons".
      //
      // Written on EVERY decision so the surviving value is the LAST one — the board at the
      // moment of death. A first draft captured only when `decisions === 1`, which recorded the
      // opening board and labelled it `endHp`; the name would have been a lie.
      const p = state.player ?? {};
      open.endHp = Number.isFinite(p.hp) ? p.hp : null;
      open.blockAtEnd = Number.isFinite(p.block) ? p.block : null;
      // Incoming damage is NOT a number anywhere in the state. `battle.enemies[].intents[]` holds
      // `{type, label, title, description}` and the damage lives in `label` as a STRING ("12"),
      // with the same number repeated in prose. A first draft read `battle.intents` — which does
      // not exist — and so recorded an empty incoming list on every single loss and called it a
      // measurement. An always-empty array is the most convincing wrong number there is.
      //
      // Recording the RAW label alongside the parsed number is the point: the gap between them is
      // exactly the parser's coverage, which is what decides whether the agent can see the turn
      // coming at all. An intent whose label is not a plain integer is a turn the planner had to
      // guess about or refuse.
      const intents = (Array.isArray(state.battle?.enemies) ? state.battle.enemies : [])
        .flatMap(e => (Array.isArray(e?.intents) ? e.intents : []));
      // Two different quantities, deliberately not the same field:
      //   intentLabels   the board at the moment of death — overwritten each turn, so the value
      //                   that survives is the LAST one. What the agent faced as it died.
      //   multiHitIntents how many of those telegraphs were NOT a plain integer — accumulated,
      //                   because "could the planner read the telegraph in this fight" is a
      //                   property of the fight, not of its final turn. Keeping only the last
      //                   turn's value reports 0 or 1 for a 30-turn fight and looks like a clean
      //                   read.
      open.intentLabels = intents.map(i => (typeof i?.label === 'string' ? i.label : null));
      open.multiHitIntents += intents.filter(i => {
        if (!DAMAGE_INTENT_TYPES.has(i?.type)) return false;   // Buff/Defend/Summon telegraph no damage
        return !/^\d+$/.test(typeof i?.label === 'string' ? i.label : '');
      }).length;
      open.intentsSeen += intents.length;
      // How often the agent was flying blind in this fight. `quality: 'unknown'` is the planner
      // saying it could not compute a forecast — not a near-miss and not a bad guess, a refusal.
      // A fight the agent was blind through is a fight whose outcome cannot fairly be blamed on
      // the policy, so the count belongs next to the outcome.
      const q = ev.chosen?.forecast?.quality;
      open.unknownForecasts += q === 'unknown' ? 1 : 0;
      continue;
    }

    if (open) {
      // ANY transition out of a combat screen, with the run still alive, ends the fight as a
      // win — a win is a POSITIVE observation and does not need a whitelist to be recognised.
      //
      // The first draft of this function did whitelist post-combat screens, and it silently
      // turned 4 real boss kills into `unresolved` because `card_select` was missing. Every one
      // of the 4 had `enemies: 0` and followed a monster/event/shop/rest screen, i.e. a reward
      // pick, so the whitelist had been guessing at exactly what the transition already states.
      // A whitelist here is the same bug wearing a different hat: it makes a KNOWN outcome
      // depend on having enumerated the ways it can be observed.
      open.outcome = 'won';
      open.closedBy = `screen:${type}`;
      fights.push(open);
      open = null;
    }
  }
  if (open) { open.outcome = 'unresolved'; open.closedBy = 'eof'; fights.push(open); }
  return fights;
}

export function summariseFights(fights) {
  const tally = { won: 0, lost: 0, unresolved: 0 };
  for (const f of fights) tally[f.outcome] = (tally[f.outcome] ?? 0) + 1;
  const closed = tally.won + tally.lost;
  return {
    ...tally,
    total: fights.length,
    // null, not 0: with no closed fights there is no rate to report.
    winRate: closed === 0 ? null : tally.won / closed,
    byType: Object.fromEntries(
      [...new Set(fights.map(f => f.type))].sort().map(t => [t, group(fights, f => f.type === t)]),
    ),
    // The same split by difficulty. `null` is a real key here, meaning the log recorded no
    // ascension for those fights — kept as its own bucket instead of being folded into 0,
    // because 0 is a difficulty the game has and a missing reading is not one.
    byAscension: Object.fromEntries(
      [...new Set(fights.map(f => String(f.ascension)))].sort().map(a => [
        a === 'null' ? 'unknown' : a,
        group(fights, f => String(f.ascension) === a),
      ]),
    ),
    // The pair that answers "is the policy actually getting better": the same fight at the
    // difficulty that is supposed to be hard. Present as null rather than 0 when absent, so an
    // empty cell can never read as a total failure — or as a success.
    atAscension: Object.fromEntries(
      [...new Set(fights.map(f => String(f.ascension)))].sort().map(a => {
        const g = group(fights, f => String(f.ascension) === a);
        return [a === 'null' ? 'unknown' : a, { ...g, boss: group(fights.filter(f => f.type === 'boss'), f => String(f.ascension) === a) }];
      }),
    ),
  };
}

const group = (fights, pred) => {
  const won = fights.filter(f => pred(f) && f.outcome === 'won').length;
  const lost = fights.filter(f => pred(f) && f.outcome === 'lost').length;
  const unresolved = fights.filter(f => pred(f) && f.outcome === 'unresolved').length;
  const closed = won + lost;
  return { total: fights.filter(pred).length, won, lost, unresolved, winRate: closed === 0 ? null : won / closed };
};

export { roomLabel };
