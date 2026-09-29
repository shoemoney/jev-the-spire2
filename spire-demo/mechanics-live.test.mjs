// mechanics/ held 159 resolved entities - damage, block and debuff counts parsed out of the game's own
// descriptions - with no consumer anywhere on the live path. These tests hold the one thing that is easy to
// break silently: the context has to be ON the request every policy sends, bounded, and structurally unable
// to invent an effect for a card the corpus never recorded.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {decisionCandidates, decisionQuestion, mechanicsContext, MECHANICS_STATE_KEY, MECHANICS_BYTE_CAP} from './planner.mjs';
import {factoredQuestion} from './factored.mjs';
import {compactRequest} from './compact-request.mjs';
import {KNOWLEDGE} from './mechanics/knowledge.mjs';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')).state;
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const COMBAT = new Set(['monster','elite','boss']);
const combatFixtures = () => readdirSync(new URL('./fixtures/', import.meta.url)).filter(file => {
  if (!file.endsWith('.json')) return false;
  try { return COMBAT.has(fixture(file.slice(0, -5)).state_type); } catch { return false; }
});
const player = over => ({hp:30, energy:3, hand:[], relics:[], potions:[], status:[], draw_pile:[], discard_pile:[], exhaust_pile:[], deck:[], ...over});
const combat = (hand = []) => ({state_type:'monster', battle:{enemies:[{entity_id:'E0', name:'Kin Follower', hp:20, max_hp:30, intents:[], status:[]}]}, player:player({hand})});
const card = (name, description, over = {}) => ({name, description, type:'Attack', cost:'1', target_type:'AnyEnemy', ...over});

test('the live request carries resolved effects for the entities actually in this state', () => {
  const state = fixture('kin-pressure'), request = compactRequest(decisionQuestion(state, decisionCandidates(state)));
  const mechanics = request.state[MECHANICS_STATE_KEY];
  assert.ok(mechanics, 'the request every policy sends must carry the context');
  // Structured semantics, not the game's prose restated. That is the whole point: the model reads a number
  // the agent already resolved instead of parsing "Deal 8 damage. Apply 2 Vulnerable." out of a description.
  const bash = mechanics.entities.find(e => e.name === 'Bash');
  assert.equal(bash.known, true);
  assert.equal(bash.effects.damage, 8);
  assert.equal(bash.effects.vulnerable, 2);
  // Only what is on this board. The corpus holds well over a hundred names; a state may never import the rest.
  assert.ok(Object.keys(KNOWLEDGE).length > 100);
  const onBoard = new Set([...(state.player?.hand ?? []), ...(state.player?.relics ?? []), ...(state.player?.potions ?? []), ...(state.player?.status ?? []), ...state.battle.enemies.flatMap(e => [e, ...(e.status ?? [])])].map(e => e?.name).filter(Boolean));
  for (const entity of mechanics.entities) assert.ok(onBoard.has(entity.name), `${entity.name} was attached but is not on this board`);
  // The counts describe the list that actually travelled, so they can never disagree with it.
  assert.equal(mechanics.counts.listed, mechanics.entities.length);
  assert.equal(mechanics.counts.known + mechanics.counts.unknown, mechanics.counts.listed);
  assert.equal(mechanics.counts.found - mechanics.counts.merged - mechanics.counts.dropped, mechanics.counts.listed);
});

test('every policy that builds a request inherits the context from the base', () => {
  // deliberate(), factoredDeliberate(), betterDeliberate() and recallingDeliberate() all reach Jev through
  // decisionQuestion(), and factoredQuestion() is that base plus per-candidate nouls. One attach on the base
  // is what makes the multi-call upstream path benefit too, not only the one-call fast policies.
  const state = fixture('kin-pressure'), candidates = decisionCandidates(state);
  const base = decisionQuestion(state, candidates).state[MECHANICS_STATE_KEY];
  assert.deepEqual(factoredQuestion(state, candidates).state[MECHANICS_STATE_KEY], base);
  assert.ok(base.counts.found > 0);
});

test('an entity the corpus has never seen is reported unknown, never given an effect', () => {
  const state = combat([card('Shockwave', 'Apply 10 Weak and 10 Vulnerable to ALL enemies. Exhaust.', {type:'Skill'})]);
  assert.equal(KNOWLEDGE.Shockwave, undefined, 'the card must stay outside the corpus or this proves nothing');
  const mechanics = mechanicsContext(state);
  const entry = mechanics.entities.find(e => e.name === 'Shockwave');
  assert.ok(entry, 'an unread card has to still be attached, flagged - not quietly omitted');
  assert.equal(entry.known, false);
  assert.equal(entry.effects, null, 'a plausible default is exactly how a wrong effect gets played');
  assert.equal(entry.confidence, 'unknown');
  assert.equal(entry.source, 'unknown');
  // The game's own text travels, so the model has evidence to read instead of a blank.
  assert.match(entry.description, /Apply 10 Weak and 10 Vulnerable/);
  // It is named in the unknown list, and the count is the count on the board - the board also holds a
  // Kin Follower the corpus never saw, so a hard-coded 1 here would pass while the count drifted.
  assert.ok(mechanics.unknown.includes('Shockwave'), 'an unread entity has to be named, not just counted');
  assert.deepEqual([...mechanics.unknown].sort(), mechanics.entities.filter(e => !e.known).map(e => e.name).sort());
  assert.equal(mechanics.counts.unknown, mechanics.entities.filter(e => !e.known).length);
  assert.equal(mechanics.counts.known, 0);
});

test('a damage value the corpus never recorded is refused rather than invented', () => {
  // Strike was recorded at 4/6/7/8/9. "Deal 3 damage." matches none of them, so the entry must carry every
  // reading and no single number - a published 3 would be indistinguishable downstream from a correct one.
  const mechanics = mechanicsContext(combat([card('Strike', 'Deal 3 damage.')])), [entry] = mechanics.entities;
  assert.equal(entry.known, true);
  assert.equal(entry.source, 'name-ambiguous');
  assert.equal(entry.effects.damage, undefined);
  assert.equal(entry.effects.mutable, true);
  assert.equal(entry.effects.matchedLiveText, false);
  assert.ok(entry.effects.readings.length > 1, 'every observed reading travels, not a pick');
  assert.equal(JSON.stringify(mechanics).includes('"damage":3'), false, 'no invented number anywhere in the payload');
  // A recorded reading still resolves, so the refusal is about the unread value and nothing else.
  assert.equal(mechanicsContext(combat([card('Strike', 'Deal 9 damage.')])).entities[0].effects.damage, 9);
});

test('the context is byte-bounded, and the bound is enforced rather than advisory', () => {
  let truncated = 0;
  for (const file of combatFixtures()) {
    const context = mechanicsContext(fixture(file.slice(0, -5)));
    if (!context) continue;
    assert.ok(bytes(context) <= MECHANICS_BYTE_CAP, `${file} built ${bytes(context)} bytes against a ${MECHANICS_BYTE_CAP} cap`);
    if (context.counts.dropped) truncated++;
  }
  // The cap has to actually bite, or "enforced" is only true of a cap nothing ever approaches.
  assert.ok(truncated > 0, 'no fixture was truncated, so the budget was never exercised');
  // A tighter cap drops entities and says how many, rather than shipping an oversized payload - and what
  // survives is the resolved semantics, not a list of bare names.
  const tight = mechanicsContext(fixture('kin-pressure'), 900);
  assert.ok(tight.counts.dropped > 0);
  assert.equal(tight.counts.listed, tight.entities.length);
  assert.equal(tight.counts.found - tight.counts.merged - tight.counts.dropped, tight.counts.listed);
  assert.ok(bytes(tight) <= 900);
  assert.ok(tight.entities.some(e => e.known && e.effects));
  // A cap too small for even one entity omits the key entirely. Publishing a counts block that does not
  // describe what was attached is the same confidently-wrong-value failure, one layer up.
  assert.equal(mechanicsContext(fixture('kin-pressure'), 10), null);
  assert.equal(mechanicsContext(fixture('kin-pressure'), 0), null);
});

test('the context rides compaction unchanged and grows no interning table', () => {
  const state = fixture('kin-pressure'), candidates = decisionCandidates(state);
  const request = compactRequest(decisionQuestion(state, candidates));
  assert.ok(request.state[MECHANICS_STATE_KEY], 'compaction must carry the context through, not strip it');
  assert.ok(Object.keys(request.state.forecast_references ?? {}).length > 0, 'this fixture must exercise interning, or the next assertion proves nothing');
  // Compaction is a fixed point on it. The compactor walks candidate_details, card_order_review,
  // state.state.player and recent_observations and has no path into this key, so a second pass cannot
  // rewrite it into - or out of - the interning tables.
  assert.deepEqual(compactRequest(request).state[MECHANICS_STATE_KEY], request.state[MECHANICS_STATE_KEY]);
  // The load-bearing one: strip the key BEFORE compacting and the compactor's output must be byte-identical.
  // If the knowledge base had been injected into an interned structure, this is where it would show.
  const bare = decisionQuestion(state, candidates);
  delete bare.state[MECHANICS_STATE_KEY];
  const without = compactRequest(bare);
  for (const key of ['forecast_references', 'candidate_details', 'card_order_review', 'order_references'])
    assert.equal(JSON.stringify(without.state[key] ?? null), JSON.stringify(request.state[key] ?? null), `compacting ${key} changed without the context attached`);
  assert.equal(JSON.stringify(without.questions), JSON.stringify(request.questions));
});

test('a state with nothing to resolve attaches no context at all', () => {
  // A card reward is a real decision with a real request, and the knowledge base has nothing to say about
  // it, so the key is absent rather than an empty counts block the model would have to interpret.
  const reward = fixture('deck-reward');
  assert.equal(reward.battle, undefined);
  assert.equal(mechanicsContext(reward), null);
  assert.equal(Object.hasOwn(compactRequest(decisionQuestion(reward, decisionCandidates(reward))).state, MECHANICS_STATE_KEY), false);
  // In combat, but with nothing the corpus can name: omitted for the same reason, and decided by the entity
  // count rather than by the shape of the state.
  assert.equal(mechanicsContext({state_type:'monster', battle:{enemies:[{entity_id:'E0', hp:20, max_hp:30, intents:[]}]}, player:player()}), null);
  assert.equal(mechanicsContext(null), null);
});
