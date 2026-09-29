// The policy that actually USES the cross-run store, so a run benefits from what previous runs learned.
//
// It is factored.mjs, unchanged, plus two additions. Nothing about the base scoring changes here, so a
// regression in this policy is a regression in one of the two things below and never a quiet drift in the
// weights the base policy already owns.
//
//   1. RECALL. The bounded context from learning/recall.mjs rides into the request under RECALL_STATE_KEY, so
//      the model is answering with the store's evidence in front of it instead of from nothing.
//
//   2. A SAFETY GATE the ranking cannot argue with. Memory is context, and context is advisory - the model is
//      free to disagree with a lesson. This gate is not: if the candidate the policy is about to take carries
//      a forecast that STATES it does not survive, and another candidate carries one that STATES it does, the
//      lethal one is refused.
//
// On where the gate's evidence comes from, precisely: it reads the FORECASTS ALREADY ATTACHED TO THIS
// BOARD, not the store. The store tells the model what happened last time; the forecasts tell the gate what
// this turn would do. Keeping the two apart in the log matters, because a forecast-based override that is
// later mistaken for a remembered lesson reads as experience when it is arithmetic, and arithmetic is exactly
// what can be checked. The store's corroboration of this failure is recorded alongside it as a fact, never
// as the reason the gate fired.
import {factoredQuestion, combine, WEIGHTS} from '../factored.mjs';
import {decisionQuestion} from '../planner.mjs';
import {compactRequest} from '../compact-request.mjs';
import {buildRecallContext, RECALL_LESSON_LIMIT} from './recall.mjs';

export const RECALL_POLICY_VERSION = 'jev-recall-v1';
export const RECALL_STATE_KEY = 'recalled_experience';

// A forecast counts as a statement about survival only when it names a quality AND actually states the
// verdict. planner.mjs sets `survives` to null whenever anything about the turn is uncertain, so a null is
// "not known" and must never be read as "dies" - nor, in the other direction, as "lives".
//
// `partial` is deliberately included. Its warnings are about the turn's damage being a bound rather than a
// total, not about survival being undecidable: the verdict is still the planner's arithmetic on a visible
// board. Across the 769-decision run log every scored candidate was `partial` (4091) or `unknown` (2085) and
// not one was `calculated`, and the recorded death was a `partial` `end_turn` with survives:false, hpAfter 0.
// A gate that only fired on `calculated` would have been a gate that never fires.
//
// `unknown` never counts, in either direction. Refusing a candidate because nothing is known about it would
// be an invented safety claim, which is worse than no gate at all.
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
 * Refuse a choice whose own forecast says it does not survive, when a better-ranked candidate's forecast
 * says it does.
 *
 * Both sides must be STATED. The alternative has to be a proven survivor, never merely an unmeasured one, so
 * the gate can only ever move toward evidence rather than away from a warning. `ranking` is walked in order,
 * so the swap lands on the best-scoring proven survivor rather than the first one found in the candidate list.
 * Returns the original choice untouched, with the reason, whenever the evidence does not support a swap.
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

// How many stored lessons independently record this exact failure. A fact about the store, reported for
// audit; it is never the reason the gate fires and never the reason it does not.
const CORROBORATING_KIND = 'chose-lethal-end-turn';
const pluralish = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const corroboration = (store, fired) => {
  if (!fired || !Array.isArray(store?.lessons)) return null;
  const matching = store.lessons.filter(lesson => lesson?.kind === CORROBORATING_KIND);
  if (!matching.length) return {lessons: 0, confirmations: 0, note: 'the store holds no lesson recording this failure kind; the override rests on this turn\'s forecasts alone'};
  const confirmations = matching.reduce((sum, lesson) => sum + (Number.isFinite(lesson.confirmations) ? lesson.confirmations : 0), 0);
  return {
    lessons: matching.length,
    confirmations,
    note: `${pluralish(matching.length, 'stored lesson')} independently record(s) taking a forecast-lethal end turn, with ${confirmations} distinct evidence record(s) between them; the override itself rests on this turn's forecasts`,
  };
};

const recallSummary = recall => ({
  present: recall.present,
  lessons: recall.lessons.length,
  lessonIds: recall.lessons.map(lesson => lesson.id),
  considered: recall.considered,
  skipped: recall.skipped,
  truncated: recall.truncated,
  history: recall.history,
  historyLine: recall.historyLine,
  note: recall.note,
});

// The refuse-to-score guard, ported from better-policy.mjs so that making THIS the default did not
// quietly weaken the default.
//
// betterDeliberate carries an all-or-nothing check: if the model did not answer the safety, progress
// and waste nouls for EVERY candidate, it declines to combine at all and falls back to Jev's broad
// `move` choice. That guard is load-bearing. With factors missing, `combine()` now votes 0 for the
// unmeasured axes - correct, and still a ranking built on an incomplete board. The reviewer measured a
// board where the model answered 2 of 4 candidates: this policy returned a five-candidate ranking and
// published `move.confidence = 0.7083`, a real-looking margin off a board where half the candidates
// had no safety, no progress and no waste reading at all. That is the exact failure this project exists
// to prevent - a confident number the evidence does not support - reintroduced through a commit titled
// "turn the flag on".
//
// So the guard travels with the policy. A partial board falls back to the broad choice, the fallback is
// named in `deliberation`, and the confidence that reaches the log is the broad answer's own, not a
// recombined margin. The safety gate is independent and still runs either way.
const FACTOR_PREFIXES = ['safe_', 'prog_', 'waste_'];
function completeFactors(candidates, answers) {
  return candidates.every(candidate => FACTOR_PREFIXES.every(prefix => {
    const value = answers[prefix + candidate.id]?.noul;
    return Number.isFinite(value) && value >= 0 && value <= 1;
  }));
}

// The sentence an auditor reads first. It states what memory contributed and what the gate did, separately,
// because those are two different kinds of claim and merging them would let a forecast reading pass as
// remembered experience.
function memoryEffect(recall, gate) {
  const memory = !recall.present
    ? 'memory contributed nothing: no readable store was supplied'
    : !recall.history.runs
      ? 'memory contributed nothing: no run has been ingested yet, so no lesson could be put in front of the model'
      : !recall.lessons
        ? `memory contributed nothing: ${recall.note}`
        : `memory put ${pluralish(recall.lessons, 'stored lesson')} in front of the model (${recall.lessonIds.join(', ')})` +
          (recall.skipped ? `, withholding ${pluralish(recall.skipped, 'lesson')} that do not match this state` : '') +
          (recall.truncated ? `, dropping ${pluralish(recall.truncated, 'lesson')} to stay inside the byte budget` : '');
  return gate.overridden
    ? `${memory}; the safety gate then overrode ${gate.from.id} and moved to ${gate.to.id} on the forecasts attached to this board - ${gate.reason}. Those forecasts are arithmetic on the visible state, not a lesson from the store.`
    : `${memory}; the safety gate did not fire: ${gate.reason}.`;
}

export async function recallingDeliberate({state, candidates, ask, onStage = () => {}, memory, limit = RECALL_LESSON_LIMIT}) {
  if (!candidates.length) throw new Error('No decision candidates');
  // `memory` arrives either as a bare store or as loadMemory()'s envelope, which is the same thing to read
  // but not the same thing to destructure - guessing wrong would silently discard every lesson.
  const store = memory && typeof memory === 'object' && !Array.isArray(memory.lessons) && memory.store ? memory.store : memory;
  const recall = buildRecallContext(store, state, {limit});
  // The summary is the single shape the log and the effect sentence both read, so a lesson count, a skip
  // count and a truncation count can never disagree between them.
  const summary = recallSummary(recall);
  // Attach AFTER compacting: the compactor rewrites candidate descriptors and interning tables, and a
  // context it knows nothing about has no business in that path.
  const question = compactRequest(factoredQuestion(state, candidates));
  question.state[RECALL_STATE_KEY] = recall;
  onStage(summary.lessons
    ? `Jev is scoring every option in one pass, with ${pluralish(summary.lessons, 'stored lesson')} in view`
    : 'Jev is scoring every option in one pass');
  const result = await ask(question);
  const answers = result.answers ?? {};
  const jevMove = answers.move;
  const base = {version: RECALL_POLICY_VERSION, calls: 1, recall: summary};

  // One candidate is a forced choice, not a ranking, so there is no combination to do and the gate has
  // nothing to move to. It is still reported: "no alternative existed" is worth having on the record.
  if (candidates.length <= 1) {
    const gate = refuseLethalChoice(candidates[0]?.id ?? null, candidates, candidates);
    return {
      ...result,
      answers,
      deliberation: {
        ...base,
        jevMove: {choice: jevMove?.choice ?? null, confidence: jevMove?.confidence ?? null},
        changed: false,
        safetyGate: gate.overridden ? {overridden: true, from: gate.from, to: gate.to, reason: gate.reason} : null,
        safetyGateReason: gate.reason,
        memoryCorroboration: corroboration(store, gate.overridden),
        memoryEffect: memoryEffect(summary, gate),
        ranking: null,
      },
    };
  }
  if (jevMove?.type !== 'choice') throw new Error('Missing Jev move choice');
  // Refuse to recombine a board the model only half-answered. Falling back to the broad `move` answer is
  // not a downgrade in confidence - it is the only reading on the board that is not assembled from
  // missing factors - and `factorFallback` says so in the log rather than leaving a clean ranking and a
  // confident margin to be read as evidence.
  const factorsComplete = completeFactors(candidates, answers);
  const {scored, probabilities, margin} = factorsComplete
    ? combine(candidates, answers, WEIGHTS)
    : {scored: null, probabilities: jevMove.probabilities ?? null, margin: jevMove.confidence ?? null};
  const best = factorsComplete ? scored[0] : {id: jevMove.choice};
  if (!candidates.some(candidate => candidate.id === best.id)) throw new Error('Invalid factored choice');
  const gate = refuseLethalChoice(best.id, candidates, scored ?? candidates);
  return {
    ...result,
    answers: {...answers, move: {type: 'choice', choice: gate.choice, probabilities, confidence: margin}},
    deliberation: {
      ...base,
      weights: WEIGHTS,
      factorsComplete,
      factorFallback: !factorsComplete,
      jevMove: {choice: jevMove.choice, confidence: jevMove.confidence},
      changed: jevMove.choice !== gate.choice,
      // The ranking is left as the scorer produced it. Rewriting it to match an override would hide which
      // candidate the gate actually overrode, which is the one fact a reader needs. It is null on a
      // fallback, because no ranking was produced.
      ranking: scored?.slice(0, 5) ?? null,
      safetyGate: gate.overridden ? {overridden: true, from: gate.from, to: gate.to, reason: gate.reason} : null,
      safetyGateReason: gate.reason,
      memoryCorroboration: corroboration(store, gate.overridden),
      memoryEffect: memoryEffect(summary, gate),
    },
  };
}

export default {recallingDeliberate, refuseLethalChoice, statedSurvival, RECALL_POLICY_VERSION, RECALL_STATE_KEY};
