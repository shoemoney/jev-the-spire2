// A one-call policy that gives each screen its own decision criteria and uses
// bounded observations from the current run. Keep factored.mjs as the baseline.
import { decisionQuestion } from './planner.mjs';
import { factoredQuestion, combine, WEIGHTS } from './factored.mjs';
import { decisionFocus } from './decision-focus.mjs';
import { deckAssessment } from './deck-assessment.mjs';
import { compactRequest } from './compact-request.mjs';

export const BETTER_POLICY_VERSION = 'jev-contextual-fast-v1';
const isCombat = state => ['monster', 'elite', 'boss'].includes(state.state_type);
const factorNames = ['safe_', 'prog_', 'waste_'];

export function betterQuestion(state, candidates, recent = []) {
  const combat = isCombat(state);
  const question = combat && candidates.length > 1
    ? factoredQuestion(state, candidates)
    : decisionQuestion(state, candidates);
  const focus = decisionFocus(state);
  question.state.recent_observations = recent;
  question.state.decision_focus = focus.name;

  if (state.state_type === 'card_reward') {
    question.state.deck_assessment = deckAssessment(state);
  }
  if (focus.instructions.move) {
    question.questions.move.instructions += ' ' + focus.instructions.move;
  }

  return compactRequest(question);
}

function completeFactors(candidates, answers) {
  return candidates.every(candidate => factorNames.every(prefix => {
    const value = answers[prefix + candidate.id]?.noul;
    return Number.isFinite(value) && value >= 0 && value <= 1;
  }));
}

// A short plan's forecast assumes ending immediately after that plan. Override
// only an actual end-turn action and only when both comparisons are calculated.
export function avoidCertainFatalEndTurn(choice, candidates, ranking = candidates) {
  const selected = candidates.find(candidate => candidate.id === choice);
  if (selected?.command?.action !== 'end_turn' || selected.forecast?.quality !== 'calculated' || selected.forecast.survives !== false) {
    return { choice, overridden: false };
  }
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const alternative = ranking.map(item => byId.get(item.id)).find(candidate =>
    candidate && candidate.id !== choice && candidate.forecast?.quality === 'calculated' && candidate.forecast.survives === true);
  return alternative
    ? { choice: alternative.id, overridden: true, reason: 'Calculated end turn is fatal; a calculated surviving continuation is available.' }
    : { choice, overridden: false };
}

export async function betterDeliberate({ state, candidates, recent = [], ask, onStage = () => {} }) {
  if (!candidates.length) throw new Error('No decision candidates');
  onStage('Jev is comparing the current options');
  const result = await ask(betterQuestion(state, candidates, recent));
  const answers = result.answers ?? {};
  const modelMove = answers.move;
  if (modelMove?.type !== 'choice' || !candidates.some(candidate => candidate.id === modelMove.choice)) {
    throw new Error('Invalid Jev move choice');
  }

  const combat = isCombat(state) && candidates.length > 1;
  const factorsComplete = combat && completeFactors(candidates, answers);
  // If the model omitted a factor, do not award that candidate a free pass on
  // the waste veto. Fall back to Jev's broad choice for this decision.
  const combined = factorsComplete ? combine(candidates, answers, WEIGHTS) : null;
  const ranking = combined?.scored ?? [...candidates].sort((a, b) =>
    (modelMove.probabilities?.[b.id] ?? 0) - (modelMove.probabilities?.[a.id] ?? 0));
  const proposed = combined?.scored[0].id ?? modelMove.choice;
  const safety = avoidCertainFatalEndTurn(proposed, candidates, ranking);
  const finalMove = {
    ...modelMove,
    choice: safety.choice,
    ...(combined ? { probabilities: combined.probabilities, confidence: combined.margin } : {}),
  };
  return {
    ...result,
    answers: { ...answers, move: finalMove },
    deliberation: {
      version: BETTER_POLICY_VERSION, calls: 1, focus: decisionFocus(state).name,
      factorsComplete: combat ? factorsComplete : null,
      factorFallback: combat && !factorsComplete,
      safetyOverride: safety.overridden ? safety.reason : null,
      jevMove: { choice: modelMove.choice, confidence: modelMove.confidence },
      changed: modelMove.choice !== safety.choice,
      ranking: combined?.scored.slice(0, 5) ?? null,
    },
  };
}
