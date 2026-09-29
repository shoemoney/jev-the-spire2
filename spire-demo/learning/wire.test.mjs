import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStore, recordRun, addLesson} from './memory.mjs';
import {recallingDeliberate, refuseLethalChoice, statedSurvival, RECALL_STATE_KEY, RECALL_POLICY_VERSION} from './wire.mjs';

const state = JSON.parse(readFileSync(new URL('../fixtures/fresh-block.json', import.meta.url), 'utf8')).state;
const candidate = (o) => ({id: 'x', label: 'Option', command: {action: 'play_card'}, details: {}, plan: [], forecast: {quality: 'unknown', survives: null}, ...o});
const lethalEnd = candidate({id: 'end', label: 'End turn', command: {action: 'end_turn'}, forecast: {quality: 'partial', survives: false, hpAfter: 0, incoming: 16}});
const surviving = candidate({id: 'live', label: 'Block', forecast: {quality: 'partial', survives: true, hpAfter: 9, incoming: 16}});
const board = [lethalEnd, surviving];

// A stub, never the network. `factorAnswers` is shaped to reproduce the recorded failure: the model's own
// broad choice and every factor point at the lethal end turn, which is exactly what put the agent on it in
// the logged run.
const factorAnswers = (preferred, board) => {
  const probabilities = Object.fromEntries(board.map(c => [c.id, c.id === preferred ? 1 : 0]));
  const answers = {move: {type: 'choice', choice: preferred, probabilities, confidence: 0.9}};
  for (const candidate of board) {
    answers['safe_' + candidate.id] = {noul: 0.5};
    answers['prog_' + candidate.id] = {noul: 0.5};
    answers['waste_' + candidate.id] = {noul: 0.5};
  }
  return answers;
};
// The lethal end turn wins on the broad question and ties on every factor, so `combine` puts it on top
// without the stub having to lie about a factor.
const prefersLethal = board => async () => {
  const answers = factorAnswers('end', board);
  for (const id of board.map(c => c.id)) {
    answers['safe_' + id] = {noul: 1};
    answers['prog_' + id] = {noul: 1};
    answers['waste_' + id] = {noul: 1};
  }
  return {model: 'jev-stub', usage: {input_tokens: 10}, answers};
};
const askCapturing = board => {
  const seen = [];
  const inner = prefersLethal(board);
  const ask = async payload => { seen.push(payload); return inner(); };
  ask.seen = seen;
  return ask;
};
const storeWith = (lessons = []) => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  recordRun(store, {runId: 'r1', result: 'death', finalAct: state.run?.act ?? 1, finalFloor: state.run?.floor ?? 1});
  for (const lesson of lessons) addLesson(store, lesson);
  return store;
};

test('a candidate whose own forecast says it dies yields to a proven survivor', async () => {
  const result = await recallingDeliberate({state, candidates: board, ask: prefersLethal(board), memory: storeWith()});
  assert.equal(result.answers.move.choice, 'live');
  assert.equal(result.deliberation.safetyGate.overridden, true);
  assert.equal(result.deliberation.safetyGate.from.id, 'end');
  assert.equal(result.deliberation.safetyGate.from.survives, false);
  assert.equal(result.deliberation.safetyGate.from.hpAfter, 0);
  assert.equal(result.deliberation.safetyGate.from.quality, 'partial');
  assert.equal(result.deliberation.safetyGate.to.id, 'live');
  assert.equal(result.deliberation.safetyGate.to.survives, true);
  assert.match(result.deliberation.safetyGate.reason, /refused end .*survives:false.*moved to live/s);
  assert.match(result.deliberation.memoryEffect, /the safety gate then overrode end and moved to live/);
});

test('a calculated forecast is treated exactly like a partial one', () => {
  const calculated = candidate({id: 'end', command: {action: 'end_turn'}, forecast: {quality: 'calculated', survives: false}});
  const safe = candidate({id: 'live', forecast: {quality: 'calculated', survives: true}});
  assert.equal(refuseLethalChoice('end', [calculated, safe], [calculated, safe]).choice, 'live');
  assert.equal(statedSurvival(calculated), false);
  assert.equal(statedSurvival(safe), true);
  assert.equal(statedSurvival(candidate({id: 'e', forecast: {quality: 'exact', survives: false}})), false, 'exact is a stated reading too');
});

test('the gate stays silent when nothing is known, rather than inventing a safety claim', async () => {
  const blind = [
    candidate({id: 'a', forecast: {quality: 'unknown', survives: null, hpAfter: null}}),
    candidate({id: 'b', forecast: {quality: 'unknown', survives: null, hpAfter: null}}),
  ];
  for (const choice of ['a', 'b']) {
    const gate = refuseLethalChoice(choice, blind, blind);
    assert.equal(gate.overridden, false);
    assert.equal(gate.choice, choice);
    assert.match(gate.reason, /nothing is inferred from an unknown/);
    assert.equal(gate.from.survives, null);
  }
  // A null `survives` with a calculated-looking quality is still not a claim.
  assert.equal(statedSurvival(candidate({id: 'a', forecast: {quality: 'calculated', survives: null}})), null);
  assert.equal(statedSurvival(candidate({id: 'a', forecast: {survives: false}})), null, 'no quality, no claim');
  assert.equal(statedSurvival(candidate({id: 'a'})), null, 'no forecast, no claim');

  const result = await recallingDeliberate({state, candidates: blind, ask: async () => ({model: 'jev-stub', answers: factorAnswers('a', blind)}), memory: storeWith()});
  assert.equal(result.deliberation.safetyGate, null);
  assert.match(result.deliberation.memoryEffect, /the safety gate did not fire:.*nothing is inferred from an unknown/s);
  // The word "safe" must never be claimed about a choice nothing is known about.
  assert.doesNotMatch(result.deliberation.memoryEffect, /is safe|safer|proved safe|safety claim/i);
});

test('a lone lethal candidate is not refused, because refusing it would be a guess', () => {
  const only = [lethalEnd];
  const gate = refuseLethalChoice('end', only, only);
  assert.equal(gate.overridden, false);
  assert.equal(gate.choice, 'end');
  assert.match(gate.reason, /no other candidate on this board states survives:true/);
  // The same holds when alternatives exist but every one of them is unmeasured.
  const unmeasured = [lethalEnd, candidate({id: 'mystery', forecast: {quality: 'unknown', survives: null}})];
  assert.equal(refuseLethalChoice('end', unmeasured, unmeasured).overridden, false);
});

test('a non-lethal choice is left completely alone', async () => {
  const safe = [surviving, candidate({id: 'other', forecast: {quality: 'partial', survives: true, hpAfter: 4}})];
  // The broad question prefers the second option outright, so the ranking is unambiguous.
  const result = await recallingDeliberate({state, candidates: safe, ask: async () => ({model: 'jev-stub', answers: factorAnswers('other', safe)}), memory: storeWith()});
  assert.equal(result.deliberation.safetyGate, null);
  assert.match(result.deliberation.safetyGateReason, /states it survives/);
  assert.doesNotMatch(result.deliberation.memoryEffect, /the safety gate then overrode/);
  // And the ranking is untouched by a gate that did not fire.
  assert.equal(result.deliberation.ranking[0].id, result.answers.move.choice);
});

test('the swap lands on the highest-ranked proven survivor, not the first one listed', () => {
  const ranked = [
    candidate({id: 'end', command: {action: 'end_turn'}, forecast: {quality: 'partial', survives: false}}),
    candidate({id: 'listed-first', forecast: {quality: 'partial', survives: true}}),
    candidate({id: 'ranked-best', forecast: {quality: 'partial', survives: true}}),
  ];
  const gate = refuseLethalChoice('end', ranked, [{id: 'end'}, {id: 'ranked-best'}, {id: 'listed-first'}]);
  assert.equal(gate.choice, 'ranked-best');
  assert.equal(gate.to.id, 'ranked-best');
});

test('the recall context rides into the request, and says so when memory is empty', async () => {
  const ask = askCapturing(board);
  await recallingDeliberate({state, candidates: board, ask, memory: storeWith()});
  const [payload] = ask.seen;
  const recall = payload.state[RECALL_STATE_KEY];
  assert.ok(recall, 'the request carries the recall context under its own key');
  assert.equal(typeof recall.historyLine, 'string');
  assert.match(payload.state.forecast_scope, /Plans are short prefixes/);

  for (const memory of [undefined, null, createStore('2026-09-28T00:00:00.000Z'), {store: createStore('2026-09-28T00:00:00.000Z')}]) {
    const empty = await recallingDeliberate({state, candidates: board, ask: prefersLethal(board), memory});
    const context = empty.deliberation.recall;
    assert.equal(context.lessons, 0);
    assert.match(empty.deliberation.memoryEffect, /memory contributed nothing/);
    assert.match(empty.deliberation.safetyGate.reason, /refused end/);
  }
  // The envelope loadMemory() hands back is unwrapped, not mistaken for a store with no lessons in it.
  assert.equal((await recallingDeliberate({state, candidates: board, ask: prefersLethal(board), memory: {store: storeWith(), status: 'loaded'}})).deliberation.recall.present, true);
  assert.equal((await recallingDeliberate({state, candidates: board, ask: prefersLethal(board), memory: undefined})).deliberation.recall.present, false);
  assert.equal((await recallingDeliberate({state, candidates: board, ask: prefersLethal(board), memory: createStore('2026-09-28T00:00:00.000Z')})).deliberation.recall.present, true);
});

test('memory corroboration is reported as a fact and never as the reason the gate fired', async () => {
  const lesson = {
    kind: 'chose-lethal-end-turn',
    text: 'Ended a turn the planner\'s own forecast marked as lethal (survives:false / hpAfter 0) and died that turn.',
    confidence: 0.6,
    evidence: {runId: 'r1', act: state.run?.act ?? 1, floor: state.run?.floor ?? 1, kind: 'forecast-said-lethal', encounter: 'Wriggler'},
    context: {act: state.run?.act ?? 1, floor: state.run?.floor ?? 1, stateType: state.state_type, encounters: (state.battle?.enemies ?? []).map(e => e.name).filter(Boolean)},
    clock: '2026-09-28T12:00:00.000Z',
  };
  const result = await recallingDeliberate({state, candidates: board, ask: prefersLethal(board), memory: storeWith([lesson])});
  assert.equal(result.deliberation.memoryCorroboration.lessons, 1);
  assert.equal(result.deliberation.memoryCorroboration.confirmations, 1);
  assert.match(result.deliberation.recall.note, /stored lessons match|match/);
  assert.match(result.deliberation.memoryEffect, /memory put 1 stored lesson in front of the model/);
  // The gate's own sentence must attribute the override to the forecasts, not to the store.
  assert.match(result.deliberation.memoryEffect, /Those forecasts are arithmetic on the visible state, not a lesson from the store/);

  const unrecorded = await recallingDeliberate({state, candidates: board, ask: prefersLethal(board), memory: storeWith()});
  assert.match(unrecorded.deliberation.memoryCorroboration.note, /the override rests on this turn's forecasts alone/);
});

test('the return shape is exactly what server.mjs consumes', async () => {
  const result = await recallingDeliberate({state, candidates: board, ask: prefersLethal(board), memory: storeWith()});
  // server.mjs: view.model = result.model; then result.answers?.move must be a choice on a real candidate id.
  assert.equal(result.model, 'jev-stub');
  assert.deepEqual(result.usage, {input_tokens: 10});
  const move = result.answers.move;
  assert.equal(move.type, 'choice');
  assert.ok(board.some(c => c.id === move.choice), `choice ${move.choice} is not on the board`);
  assert.equal(typeof move.confidence, 'number');
  const probabilities = Object.values(move.probabilities);
  assert.ok(probabilities.every(p => typeof p === 'number' && p >= 0));
  assert.ok(Math.abs(probabilities.reduce((a, b) => a + b, 0) - 1) < 0.01, 'probabilities still sum to one');
  // server.mjs logs deliberation verbatim, so it has to be JSON-safe with no undefined-only fields.
  assert.doesNotThrow(() => JSON.stringify(result.deliberation));
  const d = result.deliberation;
  assert.equal(d.version, RECALL_POLICY_VERSION);
  assert.equal(d.calls, 1);
  assert.equal(d.jevMove.choice, 'end', "the model's own choice is preserved, not overwritten in place");
  assert.equal(d.changed, true);
  assert.ok(Array.isArray(d.ranking) && d.ranking.length > 0);
});

test('a single-candidate board still runs and still reports the gate honestly', async () => {
  const result = await recallingDeliberate({state, candidates: [lethalEnd], ask: async () => ({model: 'jev-stub', answers: {move: {type: 'choice', choice: 'end', confidence: 0.4}}}), memory: storeWith()});
  assert.equal(result.answers.move.choice, 'end');
  assert.equal(result.deliberation.safetyGate, null);
  assert.equal(result.deliberation.ranking, null);
  assert.match(result.deliberation.safetyGateReason, /no other candidate on this board states survives:true/);
  assert.doesNotThrow(() => JSON.stringify(result.deliberation));
});

test('an empty board is rejected rather than answered with a guess', async () => {
  await assert.rejects(() => recallingDeliberate({state, candidates: [], ask: prefersLethal(board), memory: storeWith()}), /No decision candidates/);
});

// The launcher default was swapped to this policy in the same cycle that removed the 0.5 fallback, and
// the swap silently dropped betterDeliberate's all-or-nothing factor guard. A board where the model
// answered 2 of 4 candidates produced a five-candidate ranking and published `confidence 0.7083` — a
// real-looking margin computed from a board where half the candidates had no safety, no progress and no
// waste reading. This is the project's own named failure mode, so the guard is pinned here.
test('a half-answered board is not recombined into a confident ranking', async () => {
  const candidates = ['a', 'b', 'c', 'd'].map((id, i) => ({
    id, label: `plan ${id}`, command: {action: 'play_card', card_index: i},
    plan: [{label: `plan ${id}`, command: {action: 'play_card', card_index: i}}],
    details: {description: `plan ${id}`},
    forecast: {quality: 'partial', survives: true, hpAfter: 12, incoming: 17, incomingExact: true},
  }));
  const answers = {
    move: {type: 'choice', choice: 'd', probabilities: {a: 0.2, b: 0.25, c: 0.25, d: 0.3}, confidence: 0.31},
    // Only `a` and `b` were asked. `c` and `d` have no safety, progress or waste reading at all.
    safe_a: {noul: 0.9}, prog_a: {noul: 0.9}, waste_a: {noul: 0.1},
    safe_b: {noul: 0.1}, prog_b: {noul: 0.1}, waste_b: {noul: 0.9},
  };
  const r = await recallingDeliberate({
    state: {state_type: 'elite', run: {act: 1, floor: 12}, player: {hp: 12, max_hp: 86}, battle: {enemies: []}},
    candidates, recent: {}, memory: createStore(),
    ask: async () => ({model: 'stub', answers, usage: {input_tokens: 1}}),
  });
  assert.equal(r.deliberation.factorsComplete, false, 'an incomplete board must be reported as incomplete');
  assert.equal(r.deliberation.factorFallback, true, 'and must fall back rather than recombine');
  assert.equal(r.deliberation.ranking, null, 'no ranking may be published from missing factors');
  assert.equal(r.answers.move.confidence, 0.31,
    'the confidence that reaches the log is the broad answer\'s own, not a recombined margin');
});

test('a fully-answered board still recombines normally', async () => {
  const candidates = ['a', 'b', 'c', 'd'].map((id, i) => ({
    id, label: `plan ${id}`, command: {action: 'play_card', card_index: i},
    plan: [{label: `plan ${id}`, command: {action: 'play_card', card_index: i}}],
    details: {description: `plan ${id}`},
    forecast: {quality: 'partial', survives: true, hpAfter: 12, incoming: 17, incomingExact: true},
  }));
  const answers = {move: {type: 'choice', choice: 'd', probabilities: {a: 0.2, b: 0.25, c: 0.25, d: 0.3}, confidence: 0.31}};
  for (const [id, safe, prog] of [['a', 0.9, 0.9], ['b', 0.1, 0.1], ['c', 0.5, 0.5], ['d', 0.5, 0.5]]) {
    answers[`safe_${id}`] = {noul: safe};
    answers[`prog_${id}`] = {noul: prog};
    answers[`waste_${id}`] = {noul: 0.2};
  }
  const r = await recallingDeliberate({
    state: {state_type: 'elite', run: {act: 1, floor: 12}, player: {hp: 12, max_hp: 86}, battle: {enemies: []}},
    candidates, recent: {}, memory: createStore(),
    ask: async () => ({model: 'stub', answers, usage: {input_tokens: 1}}),
  });
  assert.equal(r.deliberation.factorsComplete, true);
  assert.equal(r.deliberation.factorFallback, false);
  assert.ok(Array.isArray(r.deliberation.ranking) && r.deliberation.ranking.length === 4,
    'a complete board produces a full ranking');
  assert.equal(r.answers.move.choice, 'a', 'the safest, most progressive plan wins a complete board');
});
