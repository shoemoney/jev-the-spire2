// The safety gate, and the refuse-to-recombine check, in a module neither of its
// callers owns.
//
// Both used to live only in wire.mjs. factored.mjs is the DEFAULT policy - 512 of the
// 560 decisions in the 2026-09-23 run log carry version `jev-single-call-factored-v1` -
// and it had neither guard, so that run walked into five fatal elites. Giving the
// default the same two guards the recall policy has means there must be ONE
// implementation, not a second copy that can drift.
//
// Importing them back out of wire.mjs would make factored.mjs <-> wire.mjs circular:
// wire.mjs already imports factoredQuestion, combine and WEIGHTS from here. ESM would
// resolve that today, because neither module reads the other's bindings during module
// init - but that resolution is a property of the current top-level statements rather
// than of the design, and a cycle that hands a live `undefined` at init time fails
// silently. A third module that both import cannot cycle.
//
// The gate is pure: it reads only the FORECASTS ALREADY ATTACHED TO THIS BOARD, never
// the cross-run store. The store tells the model what happened last time; the forecasts
// tell the gate what this turn would do. Keeping the two apart matters, because a
// forecast-based override later mistaken for a remembered lesson reads as experience
// when it is arithmetic - and arithmetic is exactly what can be checked.

// A forecast counts as a statement about survival only when it names a quality AND
// actually states the verdict. planner.mjs sets `survives` to null whenever anything
// about the turn is uncertain, so a null is "not known" and must never be read as
// "dies" - nor, in the other direction, as "lives".
//
// `partial` is deliberately included. Its warnings are about the turn's damage being a
// bound rather than a total, not about survival being undecidable: the verdict is still
// the planner's arithmetic on a visible board. Across the 769-decision run log every
// scored candidate was `partial` (4091) or `unknown` (2085) and not one was
// `calculated`, and the recorded death was a `partial` `end_turn` with survives:false,
// hpAfter 0. A gate that only fired on `calculated` would have been a gate that never
// fires.
//
// `unknown` never counts, in either direction. Refusing a candidate because nothing is
// known about it would be an invented safety claim, which is worse than no gate at all.
const STATED_QUALITIES = new Set(['calculated', 'exact', 'partial']);

/** `true`/`false` when the forecast states a survival verdict, `null` when it states nothing. */
export function statedSurvival(candidate) {
  const forecast = candidate?.forecast;
  if (!forecast || typeof forecast !== 'object') return null;
  if (!STATED_QUALITIES.has(forecast.quality)) return null;
  return typeof forecast.survives === 'boolean' ? forecast.survives : null;
}

const evidenceOf = candidate => {
  const forecast = candidate?.forecast ?? {};
  return {
    id: candidate?.id ?? null,
    label: candidate?.label ?? null,
    action: candidate?.command?.action ?? null,
    quality: forecast.quality ?? null,
    survives: forecast.survives ?? null,
    hpAfter: forecast.hpAfter ?? null,
    incoming: forecast.incoming ?? null,
    incomingExact: forecast.incomingExact ?? null,
  };
};

/**
 * Refuse a choice whose own forecast says it does not survive, when a better-ranked
 * candidate's forecast says it does.
 *
 * Both sides must be STATED. The alternative has to be a proven survivor, never merely
 * an unmeasured one, so the gate can only ever move toward evidence rather than away from
 * a warning. `ranking` is walked in order, so the swap lands on the best-scoring proven
 * survivor rather than the first one found in the candidate list. Returns the original
 * choice untouched, with the reason, whenever the evidence does not support a swap.
 */
export function refuseLethalChoice(choice, candidates = [], ranking = candidates) {
  const chosen = candidates.find(candidate => candidate?.id === choice);
  if (!chosen) return {choice, overridden: false, reason: 'the chosen candidate is not on this board'};
  const verdict = statedSurvival(chosen);
  if (verdict !== false) {
    const forecast = chosen.forecast ?? {};
    return {
      choice, overridden: false, from: evidenceOf(chosen),
      reason: verdict === null
        ? `no survival claim was made for this candidate (quality ${JSON.stringify(forecast.quality ?? null)}, survives ${JSON.stringify(forecast.survives ?? null)}), and nothing is inferred from an unknown`
        : `the chosen candidate's own forecast states it survives (quality "${forecast.quality}"), so there is no lethal forecast to refuse`,
    };
  }
  const byId = new Map(candidates.map(candidate => [candidate?.id, candidate]));
  const alternative = ranking
    .map(item => byId.get(item?.id ?? item))
    .find(candidate => candidate && candidate.id !== choice && statedSurvival(candidate) === true);
  if (!alternative) {
    return {
      choice, overridden: false, from: evidenceOf(chosen),
      reason: `candidate ${choice} states survives:false, but no other candidate on this board states survives:true, so refusing it would be a guess about an unknown rather than a reading`,
    };
  }
  return {
    choice: alternative.id, overridden: true, from: evidenceOf(chosen), to: evidenceOf(alternative),
    reason: `refused ${chosen.id} (${chosen.label ?? 'unlabelled'}, ${chosen.command?.action ?? 'unknown action'}) because its own forecast states survives:false at quality "${chosen.forecast.quality}"${chosen.forecast.hpAfter === null || chosen.forecast.hpAfter === undefined ? '' : ` with hpAfter ${chosen.forecast.hpAfter}`}; moved to ${alternative.id} (${alternative.label ?? 'unlabelled'}, ${alternative.command?.action ?? 'unknown action'}), the highest-ranked candidate whose forecast states survives:true at quality "${alternative.forecast.quality}"`,
  };
}

// The refuse-to-score guard. If the model did not answer the safety, progress and waste
// nouls for EVERY candidate, decline to combine and fall back to Jev's broad `move`
// choice, publishing ITS confidence rather than a recombined margin.
//
// That guard is load-bearing. `combine()` votes 0 for an unmeasured axis - correct, and
// still a ranking assembled from an incomplete board. The reviewer measured a board where
// the model answered 2 of 4 candidates: a policy without this guard returned a
// five-candidate ranking and published `move.confidence = 0.7083`, a real-looking margin
// off a board where half the candidates had no safety, no progress and no waste reading
// at all. That is the exact failure this project exists to prevent.
//
// The consequence worth naming: a board larger than the factoring cap leaves its tail
// candidates unasked, so it always falls back. That is the honest reading rather than a
// regression - the tail genuinely has no factors - and it is why MAX_FACTORED_CANDIDATES
// is set above the largest board ever observed.
const FACTOR_PREFIXES = ['safe_', 'prog_', 'waste_'];

export function completeFactors(candidates, answers = {}) {
  return candidates.every(candidate => FACTOR_PREFIXES.every(prefix => {
    const value = answers[prefix + candidate.id]?.noul;
    return Number.isFinite(value) && value >= 0 && value <= 1;
  }));
}

export default {refuseLethalChoice, statedSurvival, completeFactors};
