// The Elite the route was already carrying, and the one thing this change is NOT allowed to do.
//
// Measured on the 2026-09-23 run: 57 executed map decisions, 14 offered an Elite, 6 were taken, and at
// act 1 floor 12 (asc 3, 67/75 HP) three of four options led to an Elite one row down while every
// label read `Travel to <type> (column <n>)`. `leads_to` was in `details` the whole time, unread.
//
// The measured shape sets the honesty rule these tests hold: all 117 populated `leads_to` in the log
// were exactly one row deep with a uniform row, so the entries are SIBLING BRANCHES, not a sequence.
// A RestSite beside an Elite is an alternative to it, never healing that lands first - asserting
// otherwise is how a label licenses walking into an elite at 10/75 HP on healing that is not coming.
import test from 'node:test';
import assert from 'node:assert/strict';
import {actionsFor} from './actions.mjs';

const bytes = s => Buffer.byteLength(s, 'utf8');
// The label rides inside a JSON criteria string in a request with a published per-decision size, so a
// route note that grew without bound would be a silent cost. This is a ceiling, not a target.
const LABEL_BYTE_CAP = 128;
const map = (next_options, player = {hp: 67, max_hp: 75}) => ({state_type: 'map', run: {act: 1, floor: 12, ascension: 3}, player, map: {next_options}});
const label = s => actionsFor(s).map(a => a.label);
const one = n => map([n]);
// The real act-1 floor-12 board, from the run log, asc 3 at 67/75 HP.
const FLOOR12 = map([
  {index: 0, col: 0, row: 12, type: 'Monster', leads_to: [{col: 0, row: 13, type: 'Elite'}]},
  {index: 1, col: 1, row: 12, type: 'Unknown', leads_to: [{col: 1, row: 13, type: 'Elite'}]},
  {index: 2, col: 2, row: 12, type: 'Monster', leads_to: [{col: 2, row: 13, type: 'Elite'}]},
  {index: 3, col: 3, row: 12, type: 'Elite', leads_to: [{col: 3, row: 13, type: 'Elite'}]},
  {index: 4, col: 6, row: 12, type: 'Elite', leads_to: [{col: 6, row: 13, type: 'Elite'}]},
]);

test('an Elite one row down is named in the label, not just left in details', () => {
  // The whole defect in one line: two options that were byte-identical before the change.
  const [monster, unknown] = label(FLOOR12);
  assert.match(monster, /elite/i, 'leads_to showed an Elite and the label hid it');
  assert.match(unknown, /elite/i, 'a hidden type whose room is still Unknown is exactly the trap');
  assert.notEqual(monster, unknown, 'two options that differ only in consequence must not read alike');
  assert.equal(actionsFor(FLOOR12)[0].details.route_risk.elite_ahead, true);
});

test('an option with no Elite ahead never claims one', () => {
  const [l] = label(one({index: 0, col: 2, row: 12, type: 'Monster', leads_to: [{col: 2, row: 13, type: 'RestSite'}]}));
  assert.doesNotMatch(l, /elite/i, "a clean route may not borrow another option's danger");
  assert.equal(actionsFor(one({index: 0, col: 2, type: 'Monster', leads_to: [{col: 2, type: 'RestSite'}]}))[0].details.route_risk.elite_ahead, false);
});

test('a rest BEFORE an elite is distinguished from one BESIDE it', () => {
  // Shallower rest: a genuine heal-then-fight order, so the order may be claimed.
  const before = actionsFor(one({index: 0, col: 0, type: 'Monster',
    leads_to: [{col: 0, row: 13, type: 'RestSite', leads_to: [{col: 0, row: 14, type: 'Elite'}]}]}))[0];
  assert.equal(before.details.route_risk.rest_before_elite, true);
  assert.match(before.label, /rest first/i);
  // Same row, which is what the log actually contains: a sibling branch, NOT healing that lands first.
  // This is the assertion that matters. The alternative - reporting a same-row rest as "before" - is
  // a confidently wrong claim that reads as a heal and would license an elite at 10/75 HP.
  const beside = actionsFor(one({index: 0, col: 0, type: 'Monster',
    leads_to: [{col: 0, row: 13, type: 'RestSite'}, {col: 1, row: 13, type: 'Elite'}]}))[0];
  assert.equal(beside.details.route_risk.rest_ahead, true);
  assert.equal(beside.details.route_risk.rest_before_elite, false);
  assert.doesNotMatch(beside.label, /rest first/i);
  assert.match(beside.label, /beside it not before/i);
});

test('NO option is ever dropped, reordered or filtered - the count is the whole guarantee', () => {
  // The risk this change carries: a route rule that quietly removes a choice is a different, much
  // larger change. A veto was not made and must not arrive through the label.
  const o = actionsFor(FLOOR12);
  assert.equal(o.length, 5, 'every option the game offered is still on the board');
  assert.deepEqual(o.map(a => a.command), [
    {action: 'choose_map_node', index: 0}, {action: 'choose_map_node', index: 1},
    {action: 'choose_map_node', index: 2}, {action: 'choose_map_node', index: 3},
    {action: 'choose_map_node', index: 4}]);
  // Including when every single option is dangerous - the case a filter would have gutted.
  const allElite = map(Array.from({length: 6}, (_, i) => ({index: i, col: i, type: 'Elite', leads_to: [{col: i, type: 'Elite'}]})));
  assert.equal(actionsFor(allElite).length, 6, 'a board of nothing but Elites keeps all six');
});

test('a missing or malformed leads_to neither throws nor invents a consequence', () => {
  // Each of these must survive, and none may report an Elite the game did not actually name.
  for (const node of [
    {index: 0, col: 0, type: 'Monster'},
    {index: 0, col: 0, type: 'Monster', leads_to: []},
    {index: 0, col: 0, type: 'Monster', leads_to: null},
    {index: 0, col: 0, type: 'Monster', leads_to: 'Elite'},
    {index: 0, col: 0, type: 'Monster', leads_to: {type: 'Elite'}},
    {index: 0, col: 0, type: 'Monster', leads_to: [null, 7, {}, {type: 42}, {type: 'Elite-ish'}]},
  ]) {
    const [a] = actionsFor(one(node));
    assert.equal(a.command.index, node.index, 'the option survives a malformed route');
    assert.equal(a.details.route_risk.elite_ahead, false, `junk was read as an Elite: ${JSON.stringify(node.leads_to)}`);
    // The elite claim is the route note, and it is gated on the exact type. The label still echoes
    // whatever the game named (an `Elite-ish` room is a room the game showed), so the assertion is
    // on the note rather than on the substring - `Elite-ish` is not an elite fight.
    assert.doesNotMatch(a.label, /no rest before|rest first|rest beside/i, 'a route naming no Elite gained an elite note');
  }
  // A well-formed Elite inside a list of junk still counts - the guard skips the junk, not the real node.
  assert.equal(actionsFor(one({index: 0, col: 0, type: 'Monster', leads_to: [null, {type: 'Elite'}]}))[0].details.route_risk.elite_ahead, true);
  // A route the game did not supply is reported as absent, never filled in.
  const [absent] = actionsFor(one({index: 0, col: 0, type: 'Monster'}));
  assert.deepEqual(absent.details.route_risk, {ahead: [], elite_ahead: false, rest_ahead: false, rest_before_elite: false});
  assert.match(absent.label, /no room shown ahead/i, 'an unknown route says so rather than implying safety');
});

test('the label stays inside the request byte bound, on the worst board the log contains', () => {
  for (const s of [FLOOR12, map(Array.from({length: 6}, (_, i) => ({index: i, col: i, type: 'Monster', leads_to: [{col: i, type: 'Elite'}, {col: i, type: 'RestSite'}]})))]) {
    for (const l of label(s)) {
      assert.ok(bytes(l) <= LABEL_BYTE_CAP, `${bytes(l)} bytes exceeds the ${LABEL_BYTE_CAP} cap: ${l}`);
    }
  }
  // The cap has to bind somewhere, or "bounded" is only true of a bound nothing approaches.
  assert.ok(bytes(label(FLOOR12).at(-1)) > 40, 'the real label carries real content');
});

test('a plain Monster with nothing ahead still gets a usable label', () => {
  // Regression: the enrichment must not swallow the original label, which names room and column.
  const [l] = label(one({index: 0, col: 6, row: 12, type: 'Monster'}));
  assert.match(l, /^Travel to Monster \(column 6\)/);
  assert.match(l, /67\/75 HP/, 'the HP fraction rides along so risk is read against the player');
  assert.equal(actionsFor(one({index: 0, col: 6, type: 'Monster'}))[0].details.hp_fraction, 67 / 75);
  // No HP on the payload is not a crash and not an invented number.
  const [bare] = label(map([{index: 0, col: 0, type: 'Monster'}], {}));
  assert.doesNotMatch(bare, /HP/);
  assert.equal(actionsFor(map([{index: 0, col: 0, type: 'Monster'}], {hp: 5, max_hp: 0}))[0].details.hp_fraction, null);
});

test('a rest on a DIFFERENT branch never claims to precede an elite', () => {
  // The same defect as the same-row sibling case, one level deeper, and it survived because only
  // the shallower shape had a test. Comparing the minimum depth of each type across the subtree says
  // a campfire at depth 1 on one branch precedes an Elite at depth 2 on ANOTHER, and the branch the
  // agent takes to the Elite has no campfire on it.
  const divergent = one({ index: 0, col: 0, type: 'Monster', leads_to: [
    { col: 0, row: 13, type: 'RestSite', leads_to: [{ col: 0, row: 14, type: 'Monster' }] },
    { col: 1, row: 13, type: 'Monster', leads_to: [{ col: 1, row: 14, type: 'Elite' }] },
  ] });
  const risk = actionsFor(divergent)[0].details.route_risk;
  assert.equal(risk.rest_ahead, true, 'a rest does exist on the map');
  assert.equal(risk.elite_ahead, true, 'and so does an elite');
  assert.equal(risk.rest_before_elite, false, 'but not on the same path, so no heal may be claimed');
  assert.doesNotMatch(actionsFor(divergent)[0].label, /rest first/i);
});

test('a rest still precedes an elite when EVERY elite path passes one', () => {
  // The true case must survive the stricter rule, or the fix has simply disabled the guidance.
  const both = one({ index: 0, col: 0, type: 'Monster', leads_to: [
    { col: 0, row: 13, type: 'RestSite', leads_to: [{ col: 0, row: 14, type: 'Elite' }] },
    { col: 1, row: 13, type: 'RestSite', leads_to: [{ col: 1, row: 14, type: 'Elite' }] },
  ] });
  assert.equal(actionsFor(both)[0].details.route_risk.rest_before_elite, true);
});
