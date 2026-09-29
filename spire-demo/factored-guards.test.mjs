import test from 'node:test';
import assert from 'node:assert/strict';
import { factoredQuestion, factoredDeliberate } from './factored.mjs';

// The three guards this policy was missing, and the two boards it was answering blind on.
//
// Every `ask` here is a stub. No network, no model, and no invented state: the map board is the
// act-1 floor-12 board from the 2026-09-23 run log (ascension 3, 67/75 HP, options
// [Monster, Unknown, Monster, Elite, Elite]) - the decision that walked into an elite and, one
// floor later at 10/75 HP, four elites, and died.

const COMBAT_ONLY = /incoming attack|securing a kill|this turn/;
const mapState = { state_type: 'map', run: { act: 1, floor: 12, ascension: 3 },
  player: { hp: 67, max_hp: 75, gold: 120, deck: [], potions: [], relics: [] },
  map: { next_options: [
    { index: 0, col: 0, row: 12, type: 'Monster', leads_to: [{ col: 0, row: 13, type: 'Elite' }] },
    { index: 1, col: 1, row: 12, type: 'Unknown', leads_to: [] },
    { index: 2, col: 2, row: 12, type: 'Monster', leads_to: [] },
    { index: 3, col: 3, row: 12, type: 'Elite', leads_to: [{ col: 3, row: 13, type: 'Elite' }] },
    { index: 4, col: 4, row: 12, type: 'Elite', leads_to: [{ col: 4, row: 13, type: 'Monster' }] }] } };
const mapCandidates = mapState.map.next_options.map(o => ({ id: 'a' + o.index, label: `Travel to ${o.type}`,
  command: { action: 'choose_map_node', index: o.index }, details: o }));

const combatState = { state_type: 'monster', run: { act: 1, floor: 3, ascension: 1 },
  player: { hp: 12, max_hp: 80, block: 0, energy: 3, hand: [], relics: [], potions: [] },
  battle: { round: 1, turn: 'player', enemies: [{ entity_id: 'e1', name: 'G', hp: 30, block: 0, status: [], intents: [] }] } };
const plan = (id, survives, extra) => ({ id, label: id, command: { action: 'play_card', card_index: 0 },
  plan: [{ label: id }], details: { type: 'Attack' }, forecast: { quality: 'exact', survives, hpAfter: survives ? 12 : 0, damage: 10, ...extra } });
const lethal = plan('a1', false), safe = plan('a0', true);
const full = answers => ({ model: 'stub', answers });
const threePer = (cands, value = 0.5) => {
  const a = { move: { type: 'choice', choice: cands[0].id, probabilities: Object.fromEntries(cands.map(c => [c.id, 1 / cands.length])), confidence: 0.4 } };
  for (const c of cands) for (const p of ['safe_', 'prog_', 'waste_']) a[p + c.id] = { noul: value };
  return a;
};

test('a candidate whose own forecast STATES survives:false yields to one that STATES survives:true', async () => {
  const r = await factoredDeliberate({ state: combatState, candidates: [safe, lethal],
    ask: async () => full({ move: { type: 'choice', choice: 'a1', probabilities: { a0: 0.1, a1: 0.9 }, confidence: 0.9 } }) });
  assert.equal(r.answers.move.choice, 'a0', 'the lethal candidate is refused on its own stated forecast');
  assert.equal(r.safetyGate.overridden, true);
  assert.equal(r.safetyGate.from.id, 'a1');
  assert.equal(r.safetyGate.to.id, 'a0');
  assert.equal(r.deliberation.safetyGate.overridden, true);
  assert.match(r.safetyGate.reason, /survives:false/);
});

test('the gate delegates on a single-candidate board and reports it, rather than dropping it', async () => {
  // `deliberation` is null on this path, so the verdict has to live on the result itself. A refusal
  // that only ever reached the deliberation block would be a refusal nobody could see.
  const r = await factoredDeliberate({ state: combatState, candidates: [lethal],
    ask: async () => full({ move: { type: 'choice', choice: 'a1', probabilities: { a1: 1 }, confidence: 1 } }) });
  assert.equal(r.deliberation, null, 'one candidate is a forced choice, not a ranking');
  assert.ok(r.safetyGate, 'the gate still ran and its verdict is on the record');
  assert.equal(r.safetyGate.overridden, false, 'nothing to swap to');
  assert.match(r.safetyGate.reason, /no other candidate on this board states survives:true/);
});

test('the gate does NOT fire when nothing is known - refusing an unknown would be a guess', async () => {
  const blind = plan('a1', false, { quality: 'unknown' });
  const r = await factoredDeliberate({ state: combatState, candidates: [plan('a0', true, { quality: 'unknown' }), blind],
    ask: async () => full({ move: { type: 'choice', choice: 'a1', probabilities: { a0: 0.1, a1: 0.9 }, confidence: 0.9 } }) });
  assert.equal(r.answers.move.choice, 'a1', 'an `unknown` forecast states nothing, so it cannot be refused');
  assert.equal(r.safetyGate.overridden, false);
  assert.match(r.safetyGate.reason, /no survival claim was made/);
});

test('an incomplete factor board is not recombined; the broad answer\'s own confidence is published', async () => {
  const cands = [plan('a0', true), plan('a1', true), plan('a2', true)];
  const answers = threePer(cands);
  delete answers.waste_a1; // one candidate never asked its waste noul
  const r = await factoredDeliberate({ state: combatState, candidates: cands, ask: async () => full(answers) });
  assert.equal(r.deliberation.factorsComplete, false);
  assert.equal(r.deliberation.factorFallback, true);
  assert.equal(r.deliberation.ranking, null, 'no ranking may be published from missing factors');
  assert.equal(r.answers.move.confidence, 0.4, "the published confidence is the broad answer's own, not a recombined margin");
  assert.equal(r.answers.move.choice, 'a0', "it falls back to the broad move answer");
});

test('a complete factor board recombines normally and the best plan wins', async () => {
  const cands = [plan('a0', true), plan('a1', true), plan('a2', true)];
  const answers = threePer(cands);
  // a2 is safe, progressive and not wasteful; a0 and a1 pay an uncollectable cost. All three are
  // fully answered, so the board recombines and the spread exceeds the deadband on every axis.
  Object.assign(answers, { safe_a2: { noul: 0.95 }, prog_a2: { noul: 0.95 }, waste_a2: { noul: 0.02 } });
  for (const id of ['a0', 'a1']) Object.assign(answers, { ['safe_' + id]: { noul: 0.1 }, ['prog_' + id]: { noul: 0.1 }, ['waste_' + id]: { noul: 0.9 } });
  const r = await factoredDeliberate({ state: combatState, candidates: cands, ask: async () => full(answers) });
  assert.equal(r.deliberation.factorsComplete, true);
  assert.equal(r.deliberation.factorFallback, false);
  assert.ok(Array.isArray(r.deliberation.ranking) && r.deliberation.ranking.length === 3);
  assert.equal(r.answers.move.choice, 'a2', 'the safe, progressive, non-wasteful plan wins a complete board');
  assert.notEqual(r.answers.move.confidence, 0.4, 'a recombined board publishes a recombined margin, not the broad one');
});

test('a map board\'s move instructions carry elite risk AND hp/survival guidance', () => {
  const move = factoredQuestion(mapState, mapCandidates).questions.move.instructions;
  assert.match(move, /elite/i, 'the map screen must name the thing that killed the run');
  assert.match(move, /hp|surviv|risk/i);
});

test('a card_reward board is not narrowed to a single option by the route text', () => {
  const state = { ...mapState, state_type: 'card_reward', rewards: { cards: [] } };
  const cands = [{ id: 'c0', label: 'Skip', command: { action: 'skip_card_reward' }, details: {} },
                 { id: 'c1', label: 'Take card', command: { action: 'select_card', index: 0 }, details: {} }];
  const move = factoredQuestion(state, cands).questions.move.instructions;
  assert.doesNotMatch(move, /Act 2 route preference|spending_routes to compare/, 'route text belongs to the map screen only');
  assert.doesNotMatch(move, /the only safe route/i, 'a reward screen must not collapse to one option');
  assert.deepEqual(Object.keys(factoredQuestion(state, cands).questions.move.criteria), ['c0', 'c1'],
    'the full choice set stays on the board');
  assert.match(move, /Skip|every offered card/i, 'the screen\'s own criteria, not the route\'s');
});

test('non-combat nouls carry no combat-only concept; combat boards keep the combat phrasing', () => {
  const room = factoredQuestion(mapState, mapCandidates).questions;
  for (const [key, q] of Object.entries(room)) {
    if (key === 'move') continue;
    assert.doesNotMatch(q.instructions.question, COMBAT_ONLY, `${key} still asks about a fight that is not happening`);
  }
  assert.match(room.safe_a3.instructions.question, /hp|potion|leads_to|surviv/i, 'room safety is judged from HP, potions and the visible path');
  // Each combat axis keeps its OWN v1 marker. The waste noul never mentioned an incoming attack, so
  // holding it to the safe noul's marker would be an assertion about a phrase that was never there.
  const combat = factoredQuestion(combatState, [safe, lethal]).questions;
  assert.match(combat.safe_a0.instructions.question, /incoming attack this turn/);
  assert.match(combat.prog_a0.instructions.question, /securing a kill/);
  assert.match(combat.waste_a0.instructions.question, /a number of remaining turns/);
});

test('a real map board (act1 floor12, asc3, 67/75 hp, two Elites) produces elite-aware instructions', () => {
  // The options on this board were [Monster, Unknown, Monster, Elite, Elite] and the policy took the Elite.
  const move = factoredQuestion(mapState, mapCandidates).questions.move.instructions;
  assert.equal(mapState.map.next_options.filter(o => o.type === 'Elite').length, 2);
  assert.match(move, /elite/i, 'the screen names the room type that killed the run');
  assert.match(move, /Compare current HP/);
});
