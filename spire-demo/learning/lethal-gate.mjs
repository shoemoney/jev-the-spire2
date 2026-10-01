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
//
// It moves to a stated survivor when one exists, and on the board where EVERY stated plan
// dies it falls back to ranking the deaths - see LAST RESORT below, which is the only part
// of this file that chooses between plans that all say the player dies.

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

// A BOUNDED LETHAL VERDICT COUNTS AS STATED — FOR `false` ONLY.
//
// When an attack intent could not be read, the forecast reports `boundedLethal`: the intents that
// WERE read already exceed HP plus block, so the turn is dead whatever the unread ones are, because
// they can only add. That is arithmetic, and the gate has to be able to act on it: 18 lost fights
// carried no early lethal verdict at all, and this is where the verdict now comes from.
//
// ASYMMETRIC ON PURPOSE. `boundedLethal` is admitted for the `false` direction only and is never
// added to `STATED_QUALITIES`, so it can never license a claim that a plan SURVIVES. A floor
// proves death; it never proves safety.
const statesLethal = f => STATED_QUALITIES.has(f?.quality) || f?.boundedLethal === true;

/** `true`/`false` when the forecast states a survival verdict, `null` when it states nothing. */
export function statedSurvival(candidate) {
  const forecast = candidate?.forecast;
  if (!forecast || typeof forecast !== 'object') return null;
  // A bounded verdict is admitted for `false` and NOT for `true`: the floor can only ever prove
  // death, so `statesLethal` is checked first and the `true` direction still requires a fully
  // stated quality. A plan is never called a survivor on the strength of a bound.
  if (statesLethal(forecast) && forecast.survives === false) return false;
  if (!STATED_QUALITIES.has(forecast.quality)) return null;
  return typeof forecast.survives === 'boolean' ? forecast.survives : null;
}

/**
 * The candidates in the order THIS policy ranked them.
 *
 * The gate's job is to move to the BEST available survivor, so the order it is handed decides which
 * survivor it picks. Four call sites passed the raw candidate list, so it took the first survivor in
 * MENU order — and since the menu is now ordered by turn-completeness and damage, that is an
 * arbitrary choice dressed as a rescue rather than the model's preference.
 *
 * For a policy with a combined score, pass `scored`. For one that has none, this builds the same
 * ordering from the model's own choice probabilities — the closest thing to a ranking that policy
 * actually has. Candidates the model gave no probability to sort last rather than being dropped: a
 * policy that did not mention a candidate has not excluded it.
 */
export function rankingByProbability(answer, candidates) {
  const probabilities = answer?.probabilities ?? {};
  const ranked = candidates.filter(c => Number.isFinite(probabilities[c.id]));
  const unranked = candidates.filter(c => !Number.isFinite(probabilities[c.id]));
  return [...ranked.sort((a, b) => probabilities[b.id] - probabilities[a.id]), ...unranked];
}

// The key the cross-run record rides under. Defined here because the BASE question builder attaches
// it: it was defined in wire.mjs and attached by wire.mjs, so only the recall policy ever saw it and
// the default policy decided elite routes with no knowledge of the agent's own elite record — which
// reads 29/52 won, 56% — sitting unused in the store. Same shape as the attrition bug: a signal
// attached at one call site instead of the base, so every other policy silently went without it.
export const RECALL_STATE_KEY = 'recalled_experience';

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
        : (forecast.quality === 'partial'
          ? `the chosen candidate's own forecast CLAIMS it survives, but that claim is PARTIAL - the forecast carries warnings, so it is not a proven survivor and the gate is treating an unproven claim as safety`
          : `the chosen candidate's own forecast states it survives (quality "${forecast.quality}"), so there is no lethal forecast to refuse`),
    };
  }
  const byId = new Map(candidates.map(candidate => [candidate?.id, candidate]));
  const alternative = ranking
    .map(item => byId.get(item?.id ?? item))
    .find(candidate => candidate && candidate.id !== choice && statedSurvival(candidate) === true);
  // A stated survivor always wins, and when there is one this function returns the shape it
  // has always returned, byte for byte. The last-resort tier below is only ever reached on
  // the board where NO candidate states it survives.
  if (!alternative) {
    const lastResort = rankLethalLosses(chosen, choice, candidates, ranking);
    if (lastResort) return lastResort;
    return {
      choice, overridden: false, from: evidenceOf(chosen),
      reason: `candidate ${choice} states survives:false, but no other candidate on this board states survives:true, so refusing it would be a guess about an unknown rather than a reading`,
    };
  }
  return {
    choice: alternative.id, overridden: true, from: evidenceOf(chosen), to: evidenceOf(alternative),
    reason: `refused ${chosen.id} (${chosen.label ?? 'unlabelled'}, ${chosen.command?.action ?? 'unknown action'}) because its own forecast states survives:false at quality "${chosen.forecast.quality}"${chosen.forecast.hpAfter === null || chosen.forecast.hpAfter === undefined ? '' : ` with hpAfter ${chosen.forecast.hpAfter}`}; moved to ${alternative.id} (${alternative.label ?? 'unlabelled'}, ${alternative.command?.action ?? 'unknown action'}), the highest-ranked candidate whose forecast CLAIMS survives:true at quality "${alternative.forecast.quality}"${alternative.forecast.quality === 'partial' ? " — a PARTIAL claim, carrying warnings, so this is an UNPROVEN survivor and the gate is acting on an unproven safety claim" : ""}`,
  };
}

// ---------------------------------------------------------------------------------------
// LAST RESORT - a ranking among LOSSES, for the board where every stated plan dies.
// ---------------------------------------------------------------------------------------
// PLAN.md measured this gate rescuing 1 of 30 lethal windows, because in 29 of those 30 EVERY
// known plan dies. Those are unwinnable rooms, not mispicked winnable ones, so a refusal has
// nowhere to move to: the gate reports that nothing states survives:true and stops, which is
// the only honest thing it could say. It is also why the safety story was thinnest exactly
// where the deaths were - the one mechanism that can tell a death from a worse death had no
// tier for the all-lethal board.
//
// So this tier ranks the deaths and reports the LEAST BAD one. Three things it is not:
//
//   1. Not a survival claim. `hpAfter: 0` is still death, and so is every other value here.
//      Nothing in the return sets, implies, or reports `survives: true`; the destination's
//      own `to.survives` is carried through as the `false` the forecast stated, and the
//      reason says in words that this is a ranking of losses and that no candidate on the
//      board claims survival. `lossRanking` is a separate flag beside `overridden` for the
//      same reason: a reader skimming `overridden: true` must not read it as "and it lived".
//   2. Not a new action. It ranks only candidates the board ALREADY carries, so it cannot
//      spend a potion, exhaust a card, or reach for a line nobody proposed. A board that
//      offers a `use_potion` candidate may be re-ranked ONTO it - that is the policy
//      choosing an option it was already offered, not the gate spending anything.
//   3. Not a nudge. A tie is not evidence, and a gap inside the forecasts' own uncertainty
//      is not evidence either, so both leave the choice exactly where the policy put it.

// How far apart two lethal plans have to be before moving between them means anything.
//
// The floor is 2 hp, not 1, because 1 hp is the width of the rounding noise this planner
// produces by itself: a self-contradicting "4x3 (13)" intent that says 12 comes back as
// incomingMin 12 / incomingMax 13 (see bounds.test.mjs), so two forecasts 1 hp apart are not
// evidence of a real difference - they are the arithmetic disagreeing with itself by one.
// Moving on that is how this tier would make play WORSE, which is the one outcome it must
// never cause, so 1 hp is never material at any confidence.
//
// Above the floor, the gap must also clear the forecasts' OWN uncertainty. A forecast that
// is not exact announces it: it brackets the turn's damage between `incomingMin` and
// `incomingMax` and warns that the figure is "a bound, not a total" (planner.mjs), and
// `incomingExact` is the flag saying the bracket is a point. Ranking two plans whose
// forecasts overlap across that bracket ranks noise the planner already disclosed, so a gap
// no wider than the widest bracket on the board is not a reason to move. Exact forecasts
// carry no such uncertainty, which is why they are left to the floor alone rather than
// being treated as unknowable.
const LOSS_MARGIN_HP = 2;

// The bracket width a forecast admits to. Missing bracket fields are 0, not Infinity: a
// forecast that states no bracket has disclosed no uncertainty, and demanding evidence
// against an unstated bracket would silence the tier entirely rather than make it cautious.
const bracketOf = forecast => {
  const low = forecast?.incomingMin, high = forecast?.incomingMax;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return 0;
  return Math.max(0, high - low);
};

// A death is rankable only when it STATES it and carries a margin to rank on. An `unknown`
// is not a death to rank, and a stated death with no hpAfter is a death with no margin -
// inventing one is the guess this module exists not to make.
const rankableLoss = candidate =>
  statedSurvival(candidate) === false && Number.isFinite(candidate?.forecast?.hpAfter);

// Highest hpAfter first: that is the death that came closest to not being one, so it is the
// one most likely to be a mis-read bound rather than a settled death. Ties fall to the lower
// hpLoss - the same comparison one axis down - and then to the caller's own ranking, because
// the list is built in ranking order and sort() is stable. That keeps this tier parallel to
// the survivor path above, which also breaks ties by the caller's ranking.
const byLeastBadLoss = (a, b) =>
  (b.forecast.hpAfter - a.forecast.hpAfter)
  || ((Number.isFinite(a.forecast.hpLoss) ? a.forecast.hpLoss : Infinity)
    - (Number.isFinite(b.forecast.hpLoss) ? b.forecast.hpLoss : Infinity));

const describe = (id, candidate) =>
  `${id} (${candidate.label ?? 'unlabelled'}, ${candidate.command?.action ?? 'unknown action'})`
  + ` at hpAfter ${candidate.forecast.hpAfter}, hpLoss ${Number.isFinite(candidate.forecast.hpLoss) ? candidate.forecast.hpLoss : 'unstated'}`;

/**
 * Build the last-resort verdict for an all-lethal board, or `null` when there is nothing
 * to rank - which leaves the caller on the "no other candidate states survives:true"
 * reading it has always used.
 *
 * `null` comes back for every board that must not move: a lone lethal candidate, a board
 * whose alternatives are all `unknown`, and a chosen candidate that states it dies without
 * saying by how much. Each is a case where the evidence is thin, and thin evidence means
 * leaving the decision alone.
 */
function rankLethalLosses(chosen, choice, candidates, ranking) {
  const byId = new Map(candidates.map(candidate => [candidate?.id, candidate]));
  // Walk `ranking` so ties keep the policy's order, and drop anything off this board.
  const losses = [...new Map(
    ranking.map(item => byId.get(item?.id ?? item)).filter(rankableLoss).map(c => [c.id, c]),
  ).values()];
  if (losses.length < 2) return null; // nothing to be less bad than
  const ranked = losses.sort(byLeastBadLoss);
  const best = ranked[0];
  const current = ranked.find(candidate => candidate.id === choice) ?? null;
  // The distance the CHOICE would have to travel to reach the least-bad loss, measured in HP
  // on the FIRST key that actually separates them.
  //
  // hpAfter alone is not enough, and the reason is in the planner: `hpAfter` is
  // `Math.max(0, hp - loss)` (planner.mjs), so it is CLAMPED AT ZERO and every stated-lethal
  // plan in a real forecast reads `hpAfter: 0`. On the boards this tier was added for - the
  // 29 of 30 where every known plan dies - hpAfter is therefore flat across the whole board
  // and separates nothing, and a margin read off it alone would leave the tier permanently
  // inert. When hpAfter ties, hpLoss carries the margin instead: it is the same quantity in
  // the same HP units, and with the player at a known HP a lower hpLoss IS a smaller
  // overshoot, which is the smaller lethal margin by another name.
  //
  // So the two keys are the same measurement at different resolutions, not a preference
  // order, and the threshold below is in HP either way.
  const hpLossOf = candidate => (Number.isFinite(candidate.forecast.hpLoss) ? candidate.forecast.hpLoss : null);
  const separatesOnHpAfter = current !== null && best.forecast.hpAfter !== current.forecast.hpAfter;
  const gap = current === null ? null
    : separatesOnHpAfter
      ? best.forecast.hpAfter - current.forecast.hpAfter
      : (hpLossOf(current) !== null && hpLossOf(best) !== null ? hpLossOf(current) - hpLossOf(best) : null);
  // A tie the two keys cannot break is not a margin at all, so it can never be material.
  const required = Math.max(LOSS_MARGIN_HP, ...ranked.map(candidate => bracketOf(candidate.forecast)));
  // A chosen plan that states it dies but never says by how much is unmeasurable, not worst.
  // The ranking is still reported, but nothing is moved on a comparison that cannot be made.
  const moved = current !== null && best.id !== choice && gap !== null && gap >= required;

  // One prefix on every outcome, because a log reader who sees only the first clause must
  // not be able to mistake any of them for a survival claim.
  const head = `every plan this gate can rank on this board states it dies: there is no surviving plan to refuse. This is a RANKING AMONG LOSSES, not a survival claim - no candidate here states survives:true, and the least-bad loss is still a loss. Least-bad loss is ${describe(best.id, best)}`;
  // Name the key the gap was read on: a reader comparing this to the two hpAfter figures in
  // the log has to be able to see why the comparison was made on hpLoss instead.
  const on = separatesOnHpAfter ? 'hpAfter' : 'hpLoss';
  const bar = `the ${required} hp this gate requires (a ${LOSS_MARGIN_HP} hp floor, widened to the widest incomingMin/incomingMax bracket the forecasts admit)`;
  const reason = moved
    ? `${head}; the policy chose ${describe(choice, current)}, a ${gap} hp worse margin on ${on}, past ${bar}. Re-ranked onto ${best.id}, an option this board already offered - nothing was spent, nothing was invented, and every plan here still dies.`
    : current === null
      ? `${head}; the policy's own ${choice} states it dies but carries no hpAfter, so there is no margin to compare and this gate will not move on a comparison it cannot make. The choice stands.`
      : gap === null
        ? `${head}; the policy chose ${describe(choice, current)} and the two plans agree on hpAfter with no hpLoss stated on both to separate them, so there is no margin here and this gate will not move on one. The choice stands.`
        : best.id === choice
          ? `${head}; the policy already chose it, so nothing moved - the only thing this board can say is which death is closest, and the policy found the same one.`
          : `${head}; the policy chose ${describe(choice, current)}, a ${gap} hp better margin on ${on}, which is below ${bar}, so the choice stands - a gap the forecasts cannot distinguish is not evidence.`;

  return {
    choice: moved ? best.id : choice,
    overridden: moved,
    from: evidenceOf(chosen),
    // `to` is the destination ONLY when one was chosen, and it carries the forecast's own
    // `survives: false` - the evidence that the plan it moved to dies as well.
    ...(moved ? {to: evidenceOf(best)} : {}),
    // The separate flag. `overridden` alone reads as "and it lived"; this cannot be misread.
    lossRanking: true,
    leastBad: evidenceOf(best),
    rankedAmong: ranked.map(candidate => candidate.id),
    reason,
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

export default {refuseLethalChoice, statedSurvival, completeFactors, rankingByProbability, FACTOR_PREFIXES};
