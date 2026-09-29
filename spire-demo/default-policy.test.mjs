import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deliberate, policyStamp, resolvePolicy, gateReach, resolvePolicyName, POLICY_PRECEDENCE, DEFAULT_POLICY_NAME} from './deliberation.mjs';
import {recallingDeliberate} from './learning/wire.mjs';
import {factoredDeliberate} from './factored.mjs';
import {betterDeliberate} from './better-policy.mjs';
import {assistedDeliberate} from './experiment/assisted.mjs';
import {planBenefitDeliberate, persistentPlan} from './plan-benefit.mjs';

// Every policy server.mjs can resolve to, keyed by the name a decision is logged under.
const CHAIN = {recall: recallingDeliberate, better: betterDeliberate, factored: factoredDeliberate, assisted: assistedDeliberate, planBenefit: planBenefitDeliberate, deliberate};
const server = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');

// server.mjs cannot be imported: it starts a listener, reads credentials and creates a log
// directory. The chain is read out of its source instead - the same seam launcher-flags.test.mjs
// uses - so what is asserted here is the expression that actually ships.
const SHIPPED_FLAGS = Object.fromEntries([...server.matchAll(/const\s+(\w+Enabled)\s*=\s*process\.env\.(\w+)\s*===\s*'(\w+)'/g)].map(m => [m[1], [m[2], m[3]]]));

function shippedChain() {
  // The one `const` in server.mjs that is a first-match chain over all six policies. The `?` keeps
  // it from matching POLICY_CHAIN, which names the same six functions but chooses nothing.
  const expression = [...server.matchAll(/const\s+\w+\s*=\s*([^;]+);/g)].map(m => m[1])
    .find(expr => expr.includes('?') && Object.values(CHAIN).every(fn => expr.includes(fn.name)));
  assert.ok(expression, 'server.mjs must resolve the chain as one first-match expression over every policy');
  const bindings = {
    ...Object.fromEntries(Object.values(CHAIN).map(fn => [fn.name, fn])),
    ...Object.fromEntries(Object.keys(SHIPPED_FLAGS).map(name => [name, false])),
  };
  const names = [...new Set([...expression.matchAll(/[A-Za-z_$][\w$]*/g)].map(m => m[0]).filter(token => token in bindings))];
  // One parameter, destructured: `new Function` takes positional args, and a single object would
  // land in the FIRST parameter - a truthy value that short-circuits the chain to undefined and
  // makes the comparison below pass without ever evaluating the shipped expression.
  return new Function('bindings', `const {${names}}=bindings; return (${expression});`);
}

// A second, independent reading of "does this policy gate", written here rather than imported: a
// test that asks the code under test whether the code under test is right proves nothing.
function gatesByItsOwnLights(fn, seen = new Set()) {
  if (seen.has(fn)) return false;
  seen.add(fn);
  if (/\brefuseLethalChoice\s*\(/.test(String(fn))) return true;
  return Object.values(CHAIN).some(other => other !== fn && new RegExp(`\\b${other.name}\\s*\\(`).test(String(fn)) && gatesByItsOwnLights(other, seen));
}

// A board with an empty hand, so `deliberate` takes neither its end-turn recheck nor its card-order
// review and the call count below measures the gate's cost exactly: none.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/beast-free.json', import.meta.url))).state;
const state = {...fixture, player: {...fixture.player, hand: [], potions: []}};
const lethal = {id: 'end', label: 'End turn', command: {action: 'end_turn'}, details: {}, forecast: {quality: 'partial', survives: false, hpAfter: 0, incoming: 16}};
const survivor = {id: 'guard', label: 'Defend', command: {action: 'play_card', card_index: 1}, details: {}, forecast: {quality: 'partial', survives: true, hpAfter: 12}};
const unstated = {id: 'mystery', label: 'Play', command: {action: 'play_card', card_index: 0}, details: {}, forecast: {quality: 'unknown', survives: null, hpAfter: null}};
const alwaysPick = pick => async payload => ({model: 'test', usage: {input_tokens: 5}, answers: Object.fromEntries(Object.keys(payload.questions).map(role => [role, {type: 'choice', choice: pick, confidence: 0.4}]))});

test('with no environment at all the default is named and its gate is computed, not assumed', () => {
  const resolved = resolvePolicy({}, CHAIN);
  assert.deepEqual(resolved, {policyName: 'deliberate', gate: 'active', gateVia: 'deliberate'});
  assert.equal(resolved.policyName, DEFAULT_POLICY_NAME);
  // Still the deliberate multi-call upstream policy, not a silent swap for a one-call one. That
  // swap changes latency and cost on every live run, and the game bridge is down, so it needs a
  // played run behind it - the gate was the half of this that needed no such permission.
  assert.equal(CHAIN[resolved.policyName], deliberate);
  assert.equal(resolvePolicyName({}), 'deliberate');
  // Flag values are compared strictly, so the strings a shell leaves behind stay off.
  assert.equal(resolvePolicyName({SPIRE_RECALL: '0'}), 'deliberate');
  assert.equal(resolvePolicyName({SPIRE_RECALL: 'true'}), 'deliberate');
  assert.equal(resolvePolicyName({SPIRE_ADVISER: 'Luna'}), 'deliberate');
  assert.equal(resolvePolicyName({SPIRE_ADVISER: 'luna'}), 'assisted');
});

test('the precedence table names the same variables and values server.mjs reads', () => {
  // If the table drifts from the constants, every name this file reports is fiction.
  assert.deepEqual(Object.values(SHIPPED_FLAGS).sort(), POLICY_PRECEDENCE.map(([variable, value]) => [variable, value]).sort());
});

test('the shipped chain and the exported resolver pick the same policy for all 32 flag combinations', () => {
  const ship = shippedChain();
  for (let mask = 0; mask < 1 << POLICY_PRECEDENCE.length; mask++) {
    const env = {};
    POLICY_PRECEDENCE.forEach(([variable, value], bit) => { if (mask & 1 << bit) env[variable] = value; });
    const flags = Object.fromEntries(Object.entries(SHIPPED_FLAGS).map(([name, [variable, value]]) => [name, env[variable] === value]));
    const running = ship({...flags, ...Object.fromEntries(Object.values(CHAIN).map(fn => [fn.name, fn]))});    assert.ok(Object.values(CHAIN).includes(running), 'the shipped chain must only ever return a chained policy');
    // The name is taken from the FUNCTION's identity, so this cannot drift from what would run.
    assert.equal(policyStamp(running, CHAIN).policyName, resolvePolicy(env, CHAIN).policyName, `env ${JSON.stringify(env)}`);
  }
});

test('the gate status is read from each policy in the chain, by call and by delegation', () => {
  for (const [name, fn] of Object.entries(CHAIN)) {
    const callsTheGateItself = /\brefuseLethalChoice\s*\(/.test(String(fn));
    assert.equal(callsTheGateItself, ['recall', 'better', 'factored', 'deliberate'].includes(name), `${name} applies the guard directly`);
    const reach = gateReach(name, CHAIN);
    assert.equal(reach.gate, 'active', `${name} is gated`);
    assert.equal(reach.gate, gatesByItsOwnLights(fn) ? 'active' : 'absent', `${name} disagrees with a second reading of its source`);
  }
  // planBenefit and assisted never call the gate: they wrap `deliberate`, which does. A derivation
  // that only reads a policy's own body reports them ungated, and a hand-written status list has to
  // be edited by hand the day one of them stops delegating.
  for (const name of ['planBenefit', 'assisted']) {
    const reach = gateReach(name, CHAIN);
    assert.equal(reach.via, 'deliberate', `${name} gates through deliberate`);
    assert.deepEqual(reach.path, [name, 'deliberate']);
  }
  assert.deepEqual(gateReach('deliberate', CHAIN), {gate: 'active', via: 'deliberate', path: ['deliberate']});
});

test('a policy that reaches no guard reports absent rather than claiming safety', () => {
  // persistentPlan is real code out of a policy module that gates nothing.
  const ungated = {deliberate: persistentPlan};
  assert.equal(gateReach('deliberate', ungated).gate, 'absent');
  assert.deepEqual(policyStamp(persistentPlan, ungated), {policyName: 'deliberate', gate: 'absent', gateVia: null});
  // A name nobody registered is "unproven", not a crash: this is the line that makes an ungated
  // default visible in a run log instead of invisible in a green one.
  assert.equal(gateReach('nope', CHAIN).gate, 'absent');
  assert.deepEqual(policyStamp(persistentPlan, CHAIN), {policyName: 'unknown', gate: 'absent', gateVia: null});
});

test('a decision carries the resolved policy and the gate status that produced it', () => {
  for (const [name, fn] of Object.entries(CHAIN)) {
    const stamp = policyStamp(fn, CHAIN);
    assert.equal(stamp.policyName, name);
    assert.equal(stamp.gate, 'active');
  }
  // The stamp is spread into the event, which every outcome reuses - executed, preview, cancelled,
  // stale_rejected, game_rejected - so a run log can answer for all of them, not only the happy one.
  assert.match(server, /const stamp=policyStamp\(policy,POLICY_CHAIN\)/);
  assert.match(server, /policy: POLICY_VERSION, \.\.\.stamp,/);
  assert.match(server, /activePolicy: source\.activePolicy/);
  assert.match(server, /gate: e\.gate \?\? null/);
  // Named before the first decision is paid for, not buried in a log nobody reads.
  assert.match(server, /lethal gate \$\{resolvedPolicy\.gate\}/);
});

test('deliberate yields a stated-lethal choice to a stated survivor, without another model call', async () => {
  let calls = 0;
  const r = await deliberate({state, candidates: [lethal, survivor], ask: async payload => { calls++; return alwaysPick('end')(payload); }});
  assert.equal(calls, 2, 'the gate is arithmetic over forecasts the planner already attached to this board');
  assert.equal(r.answers.move.choice, 'guard');
  assert.equal(r.safetyGate.overridden, true);
  assert.equal(r.safetyGate.from.id, 'end');
  assert.equal(r.safetyGate.to.id, 'guard');
  assert.match(r.deliberation.safetyGate.reason, /refused end .*survives:false.*moved to guard/s);
  assert.equal(r.deliberation.changed, true);
});

test('nothing is inferred in the other direction either: a stated survivor does not displace an unstated choice', async () => {
  let calls = 0;
  const r = await deliberate({state, candidates: [unstated, survivor], ask: async payload => { calls++; return alwaysPick('mystery')(payload); }});
  assert.equal(calls, 2);
  assert.equal(r.answers.move.choice, 'mystery', 'a proven survivor is available; the gate still must not read an unknown as a verdict');
  assert.equal(r.safetyGate.overridden, false);
  assert.match(r.safetyGate.reason, /nothing is inferred from an unknown/);
  assert.equal(r.deliberation.safetyGate, null, 'no refusal happened, so none is published');
});

test('a forced single-candidate board still publishes a verdict', async () => {
  const r = await deliberate({state, candidates: [lethal], ask: async () => ({usage: {}, answers: {move: {type: 'choice', choice: 'end'}}})});
  assert.equal(r.deliberation, null);
  assert.equal(r.safetyGate.overridden, false);
  assert.match(r.safetyGate.reason, /no other candidate on this board states survives:true/);
});
