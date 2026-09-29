// The safety gate, and the refuse-to-recombine check, in a module neither of its
// callers owns.
//
// Both used to live only in wire.mjs, and factored.mjs had neither - which is how 512 of
// the 560 decisions in the 2026-09-23 run log (version `jev-single-call-factored-v1`)
// reached five fatal elites unguarded. Giving both policies the same two guards means
// there is ONE implementation, not a second copy that can drift.
//
// That 512/560 figure is what RAN on 2026-09-23. It is not what is configured. The chain in
// server.mjs:176 is a first match, and its order is
//   SPIRE_RECALL -> SPIRE_BETTER_POLICY -> SPIRE_SINGLE_CALL -> SPIRE_ADVISER=luna ->
//   SPIRE_PLAN_BENEFIT -> deliberate
// so `factoredDeliberate` is OPT-IN via SPIRE_SINGLE_CALL=1, the companion launcher selects
// `recallingDeliberate` ahead of it, and a bare `node spire-demo/server.mjs` with no
// environment at all lands on `deliberate` - which calls neither this gate nor
// `completeFactors` and never calls `combine()`. Do not read the historical share as a
// statement about the default; it is evidence about one recorded run.
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
// the planner's arithmetic on a visible board. Across the 770 decisions in the run log every
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
export const FACTOR_PREFIXES = ['safe_', 'prog_', 'waste_'];

// `required` is the list of factor prefixes the question ACTUALLY asked. It is not hardcoded,
// because `factoredQuestion` only asks `waste_*` when `weights.waste > 0`, and
// `benchmark/sweep.mjs:23` ships a `NO_WASTE` arm with `waste: 0`. A guard that demanded
// `waste_*` regardless would report `factorsComplete:false` on EVERY board for that arm —
// the policy would silently fall back to the broad choice forever while still printing a
// score, and nothing would notice. Demand only what was asked.
export function completeFactors(candidates, answers = {}, required = ['safe_', 'prog_', 'waste_']) {
  if (!required.length) return true;
  return candidates.every(candidate => required.every(prefix => {
    const value = answers[prefix + candidate.id]?.noul;
    return Number.isFinite(value) && value >= 0 && value <= 1;
  }));
}

export default {refuseLethalChoice, statedSurvival, completeFactors, FACTOR_PREFIXES};
