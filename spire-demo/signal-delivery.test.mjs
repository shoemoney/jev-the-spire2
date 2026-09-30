// A SIGNAL THAT REACHES NOTHING.
//
// The attrition verdict was built, unit-tested, committed, described in the run state, printed in
// the loop log, and delivered to ZERO requests for twelve iterations — because the policy function
// that receives the options object never destructured it. Every unit test passed, because every
// unit test called `perspectiveQuestion` directly with the argument, skipping the layer in between
// where it was dropped.
//
// That is the whole failure: the tested seam was not the broken one. This test exercises the real
// path — server's option shape -> policy -> question — because that is the path that was broken.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recallingDeliberate} from './learning/wire.mjs';

const combat = () => ({state_type: 'monster', run: {act: 1, floor: 6},
  player: {hp: 20, max_hp: 80, energy: 3, block: 0, gold: 0, status: [], relics: [], potions: [], hand: []},
  battle: {round: 3, turn: 'player', is_play_phase: true,
    enemies: [{entity_id: 'e1', name: 'B', hp: 200, block: 0, status: [], intents: []}]}});
const plans = [{id: 'a0', label: 'Strike', command: {action: 'play_card', card_index: 0}, details: {}, plan: []}];
const LOSING = {status: 'losing-on-attrition', turnsToLive: 4, turnsToKill: 33, why: '4 turns of life, 33 to finish the enemy'};

// The shape server.mjs actually constructs and hands to the policy.
const optionsAsServerSendsThem = fightAttrition => ({
  state: combat(), candidates: plans, recent: {}, memory: null, fightAttrition,
  ask: async q => ({model: 'stub', usage: {input_tokens: 1}, answers: {
    move: {type: 'choice', choice: 'a0', probabilities: {a0: 1}, confidence: 0.5},
    safe_a0: {noul: 0.5}, prog_a0: {noul: 0.5}, waste_a0: {noul: 0.5}},
    request: q}),
});

test('the attrition verdict reaches the request through the real policy path', async () => {
  const r = await recallingDeliberate(optionsAsServerSendsThem(LOSING));
  assert.match(r.request.questions.move.instructions, /LOST ON TIME/,
    'server.mjs hands this to the policy; the policy must forward it to the question');
});

test('with no verdict the request is unchanged — the signal is not always-on', async () => {
  const r = await recallingDeliberate(optionsAsServerSendsThem(null));
  assert.doesNotMatch(r.request.questions.move.instructions, /LOST ON TIME/,
    'an absent verdict must contribute nothing, not a vague worry');
});

test('the wiring is asserted on the source, so deleting the parameter fails this test', () => {
  // The behavioural test above would pass if the argument were threaded only in a test helper. This
  // one reads the shipped policy and fails if the parameter disappears from it, which is exactly the
  // regression that happened.
  const src = readFileSync(new URL('./learning/wire.mjs', import.meta.url), 'utf8');
  assert.match(src, /recallingDeliberate\(\{[\s\S]{0,400}?fightAttrition/, 'the policy must accept fightAttrition');
  // The forwarding assertion is on the BUILDER CHAIN, not one hop: the signal lives in
  // `decisionQuestion`, and `factored.factoredQuestion` is the hop that dropped it for twelve
  // iterations. Asserting only that `wire.mjs` mentions the name would pass while the value died
  // one layer down, which is exactly what happened.
  const factored = readFileSync(new URL('./factored.mjs', import.meta.url), 'utf8');
  assert.match(factored, /decisionQuestion\([^)]*fightAttrition/, 'factored must forward it to the base');
  const planner = readFileSync(new URL('./planner.mjs', import.meta.url), 'utf8');
  assert.match(planner, /attritionLine\(fightAttrition\)/, 'the base must actually attach it');
});
