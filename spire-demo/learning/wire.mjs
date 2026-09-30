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
// The gate and the refuse-to-recombine check live in learning/lethal-gate.mjs because
// factored.mjs - the default policy - needs the same two, and importing them back from
// here would close a cycle. Re-exported so this module's callers and its tests are
// unaffected by where the implementation now sits.
import {refuseLethalChoice, statedSurvival, completeFactors, rankingByProbability, FACTOR_PREFIXES} from './lethal-gate.mjs';
export {refuseLethalChoice, statedSurvival, completeFactors};

export const RECALL_POLICY_VERSION = 'jev-recall-v1';
export const RECALL_STATE_KEY = 'recalled_experience';

// How many stored lessons independently record this exact failure. A fact about the
// store, reported for audit; it is never the reason the gate fires and never the reason
// it does not.
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

// The refuse-to-score guard, `completeFactors`, moved to learning/lethal-gate.mjs so the
// default policy shares one implementation rather than a second copy that can drift. See
// that file for why the guard exists and what a board without it published.

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

// `fightAttrition` was being handed to this function by server.mjs and silently dropped: the
// parameter did not exist, so the whole loss-on-time signal — built, tested, and shipped as the
// answer to "0 of 18 lost fights were warned early" — never reached a single request. It is the
// third signal in this project to be built correctly and connected to nothing.
export async function recallingDeliberate({state, candidates, ask, onStage = () => {}, memory, fightAttrition, limit = RECALL_LESSON_LIMIT}) {
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
  const question = compactRequest(factoredQuestion(state, candidates, {}, fightAttrition));
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
    const gate = refuseLethalChoice(candidates[0]?.id ?? null, candidates, rankingByProbability(result.answers?.move, candidates));
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
  const factorsComplete = completeFactors(candidates, answers, FACTOR_PREFIXES);
  const {scored, probabilities, margin, unmeasured} = factorsComplete
    ? combine(candidates, answers, WEIGHTS)
    : {scored: null, probabilities: jevMove.probabilities ?? null, margin: jevMove.confidence ?? null, unmeasured: null};
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
      // combine() builds a tally of which axes went unmeasured per candidate, for candidates that fall
      // outside the top-five `ranking` and would otherwise be invisible in the log. It was returned and
      // read by nobody. On THIS path it is now usually empty - the factorFallback guard above means
      // combine() only runs on a board where every candidate was asked - so it is carried explicitly
      // rather than left as a return value no caller destructures.
      unmeasured: unmeasured ?? null,
      safetyGate: gate.overridden ? {overridden: true, from: gate.from, to: gate.to, reason: gate.reason} : null,
      safetyGateReason: gate.reason,
      memoryCorroboration: corroboration(store, gate.overridden),
      memoryEffect: memoryEffect(summary, gate),
    },
  };
}

export default {recallingDeliberate, refuseLethalChoice, statedSurvival, RECALL_POLICY_VERSION, RECALL_STATE_KEY};
