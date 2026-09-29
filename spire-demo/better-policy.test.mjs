import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decisionCandidates } from './planner.mjs';
import { betterQuestion, betterDeliberate, avoidCertainFatalEndTurn } from './better-policy.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')).state;

test('card rewards use deck-specific guidance and bounded recent observations', () => {
  const state = fixture('deck-reward');
  const candidates = decisionCandidates(state);
  const recent = { turnHistory: Array.from({ length: 8 }, (_, round) => ({ round })), recentDeckDecisions: [{ action: 'Skip' }] };
  const question = betterQuestion(state, candidates, recent);
  assert.equal(Object.keys(question.questions).join(','), 'move');
  assert.match(question.questions.move.instructions, /Compare every offered card and Skip/);
  assert.equal(question.state.deck_assessment.available, true);
  assert.equal(question.state.recent_observations.turnHistory.length, 6);
  assert.equal(question.state.recent_observations.recentDeckDecisions.length, 1);
  assert.ok(!Object.keys(question.questions).some(key => key.startsWith('safe_')));
});

test('map and shop decisions receive different screen-specific instructions', () => {
  const player = { hp: 30, max_hp: 80, gold: 100, hand: [] };
  const candidates = [{ id: 'a', label: 'First', command: { action: 'proceed' }, details: {} }, { id: 'b', label: 'Second', command: { action: 'shop_purchase' }, details: {} }];
  const map = betterQuestion({ state_type: 'map', run: { act: 2 }, player, map: { nodes: [], next_options: [] } }, candidates);
  const shop = betterQuestion({ state_type: 'shop', player, shop: { items: [] } }, candidates);
  assert.match(map.questions.move.instructions, /visible map connections/);
  assert.match(shop.questions.move.instructions, /current budget/);
  assert.doesNotMatch(map.questions.move.instructions, /current budget/);
  assert.doesNotMatch(shop.questions.move.instructions, /visible map connections/);
});

test('combat carries recent observations and retains the tested waste check', () => {
  const state = fixture('fresh-block');
  const candidates = decisionCandidates(state).slice(0, 2);
  const question = betterQuestion(state, candidates, { unfinishedPlan: { proposedRemaining: ['Defend'] } });
  assert.equal(question.questions.safe_p0.type, 'noul');
  assert.match(question.questions.waste_p0.instructions.question, /payoff cannot actually be collected here/);
  assert.deepEqual(question.state.recent_observations.unfinishedPlan.proposedRemaining, ['Defend']);
});

test('an unassessed candidate cannot escape the waste check', async () => {
  const state = fixture('fresh-block');
  const candidates = decisionCandidates(state).slice(0, 2);
  const answer = { type: 'choice', choice: candidates[0].id, probabilities: { [candidates[0].id]: 0.7, [candidates[1].id]: 0.3 }, confidence: 0.7 };
  const result = await betterDeliberate({ state, candidates, ask: async () => ({ model: 'jev-test', answers: {
    move: answer, [`safe_${candidates[0].id}`]: { noul: 0.8 }, [`prog_${candidates[0].id}`]: { noul: 0.8 }, [`waste_${candidates[0].id}`]: { noul: 0.8 },
  } }) });
  assert.equal(result.deliberation.factorFallback, true);
  assert.equal(result.answers.move.choice, answer.choice);
  assert.deepEqual(result.answers.move.probabilities, answer.probabilities);
});

test('only a calculated lethal end turn yields to a calculated surviving option', () => {
  const end = { id: 'end', command: { action: 'end_turn' }, forecast: { quality: 'calculated', survives: false } };
  const safe = { id: 'safe', command: { action: 'play_card' }, forecast: { quality: 'calculated', survives: true } };
  assert.deepEqual(avoidCertainFatalEndTurn('end', [end, safe], [end, safe]).choice, 'safe');
  assert.equal(avoidCertainFatalEndTurn('end', [{ ...end, forecast: { quality: 'partial', survives: false } }, safe], [end, safe]).choice, 'end');
  assert.equal(avoidCertainFatalEndTurn('end', [end, { ...safe, forecast: { quality: 'unknown', survives: null } }], [end, safe]).choice, 'end');
  assert.equal(avoidCertainFatalEndTurn('safe', [end, safe], [end, safe]).choice, 'safe');
});

test('new policy uses one request and records a calculated safety override', async () => {
  const state = fixture('fresh-block');
  const candidates = [
    { id: 'end', label: 'End turn', command: { action: 'end_turn' }, details: {}, plan: [], forecast: { quality: 'calculated', survives: false } },
    { id: 'block', label: 'Block', command: { action: 'play_card', card_index: 0 }, details: {}, plan: [], forecast: { quality: 'calculated', survives: true } },
  ];
  let calls = 0;
  const result = await betterDeliberate({ state, candidates, ask: async () => {
    calls++;
    return { model: 'jev-test', answers: {
      move: { type: 'choice', choice: 'end', probabilities: { end: 0.9, block: 0.1 }, confidence: 0.9 },
      safe_end: { noul: 0.5 }, prog_end: { noul: 0.5 }, waste_end: { noul: 0.5 },
      safe_block: { noul: 0.5 }, prog_block: { noul: 0.5 }, waste_block: { noul: 0.5 },
    } };
  } });
  assert.equal(calls, 1);
  assert.equal(result.answers.move.choice, 'block');
  assert.equal(result.deliberation.factorsComplete, true);
  assert.match(result.deliberation.safetyOverride, /Calculated end turn is fatal/);
});
