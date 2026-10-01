import test from 'node:test';
import assert from 'node:assert/strict';
import {refuseLethalChoice, statedSurvival, completeFactors, FACTOR_PREFIXES} from './lethal-gate.mjs';

// The last-resort tier: the board where EVERY candidate states it dies. PLAN.md measured the
// gate rescuing 1 of 30 lethal windows because in 29 of the 30 no candidate states it
// survives - unwinnable rooms, not mispicked winnable ones. These tests pin the one thing
// that tier is allowed to do (rank the deaths) and the four things it must never do (claim
// survival, act on a 1 hp difference, invent a plan, touch an unknown).
const candidate = (o) => ({id: 'x', label: 'Option', command: {action: 'play_card'}, forecast: {quality: 'unknown', survives: null}, ...o});
const dying = (id, hpAfter, extra = {}) => candidate({
  id, command: {action: 'play_card'},
  forecast: {quality: 'partial', survives: false, hpAfter, hpLoss: 10 - hpAfter, ...extra},
});
// The shape a REAL forecast has: `hpAfter` is `Math.max(0, hp - loss)` (planner.mjs:461), so
// it is clamped at zero and every lethal plan reads 0. This is the board the 29-of-30
// windows actually produce, and it is why hpLoss has to carry the margin there.
const clampedDying = (id, hpLoss, extra = {}) => candidate({
  id, command: {action: 'play_card'},
  forecast: {quality: 'partial', survives: false, hpAfter: 0, hpLoss, ...extra},
});

test('when every plan dies, the least-bad loss is chosen and the return says what it is', () => {
  const board = [dying('chosen', -6), dying('better', 0), dying('worst', -11)];
  const gate = refuseLethalChoice('chosen', board, board);
  assert.equal(gate.choice, 'better', 'the highest hpAfter is the death closest to not being one');
  assert.equal(gate.overridden, true);
  assert.equal(gate.lossRanking, true, 'the flag that stops `overridden` reading as "and it lived"');
  assert.deepEqual(gate.rankedAmong, ['better', 'chosen', 'worst']);
  assert.equal(gate.leastBad.id, 'better');
  assert.equal(gate.from.id, 'chosen');
  // The whole point: it moved, and it says in words that it moved among deaths.
  assert.match(gate.reason, /RANKING AMONG LOSSES/);
  assert.match(gate.reason, /not a survival claim/);
  assert.match(gate.reason, /no candidate here states survives:true/);
  assert.match(gate.reason, /every plan here still dies/);
});

test('a 1 hp difference is not evidence, and the tier leaves the choice alone', () => {
  const board = [dying('chosen', 0), dying('one-more', 1)];
  const gate = refuseLethalChoice('chosen', board, board);
  assert.equal(gate.choice, 'chosen', 'the choice the policy made is not disturbed by rounding');
  assert.equal(gate.overridden, false);
  // The ranking is still reported, because silence would read as "nothing to say" when in
  // fact the board does say which death is closer - it just does not say it convincingly.
  assert.equal(gate.lossRanking, true);
  assert.equal(gate.leastBad.id, 'one-more');
  assert.match(gate.reason, /RANKING AMONG LOSSES/);
  assert.match(gate.reason, /a 1 hp better margin on hpAfter, which is below the 2 hp this gate requires/);
  assert.match(gate.reason, /a gap the forecasts cannot distinguish is not evidence/);
});

test('identical margins are a tie, not a ranking, and a tie is not a reason to move', () => {
  const board = [dying('a', 0), dying('b', 0)];
  const gate = refuseLethalChoice('a', board, board);
  assert.equal(gate.choice, 'a');
  assert.equal(gate.overridden, false);
  assert.equal(gate.to, undefined, 'nothing was moved to, so there is no destination');
  assert.match(gate.reason, /RANKING AMONG LOSSES/);
  assert.match(gate.reason, /the policy already chose it, so nothing moved/);
});

test('the destination is as lethal as the plan it replaced, and is reported that way', () => {
  const board = [dying('chosen', -4), dying('better', 0)];
  const gate = refuseLethalChoice('chosen', board, board);
  assert.equal(gate.to.id, 'better');
  assert.equal(gate.to.survives, false, 'the destination is carried with its own survives:false');
  assert.equal(gate.to.hpAfter, 0, 'and hpAfter 0 is still death - it is not a survival claim');
  assert.equal(gate.to.hpAfter > 0, false);
  // No STRUCTURED field anywhere in the return may claim a survival: `from`, `to` and
  // `leastBad` are the evidence a reader takes as fact.
  for (const part of [gate.from, gate.to, gate.leastBad]) {
    assert.ok(part, 'every evidence block is present');
    assert.notEqual(part.survives, true);
  }
  // And the only place the string "survives:true" may appear is inside the denial.
  const claims = [...gate.reason.matchAll(/survives: ?true/gi)];
  assert.ok(claims.length > 0, 'the reason addresses the survival question head on');
  for (const claim of claims) {
    assert.match(gate.reason.slice(0, claim.index), /no candidate here states $/, 'each survives:true is a denial');
  }
});

test('with the real clamped forecasts, hpLoss carries the margin hpAfter cannot', () => {
  // Every plan reads hpAfter 0 because the planner clamps it, so the tier is silent unless
  // hpLoss is allowed to separate them. Without this the tier never fires on real data.
  const board = [clampedDying('chosen', 22), clampedDying('less-bad', 18), clampedDying('worst', 30)];
  const gate = refuseLethalChoice('chosen', board, board);
  assert.equal(gate.choice, 'less-bad', 'a smaller hpLoss at the same clamped hpAfter is a smaller overshoot');
  assert.equal(gate.overridden, true);
  assert.equal(gate.lossRanking, true);
  assert.match(gate.reason, /a 4 hp worse margin on hpLoss/, 'the log names the key it ranked on');
  assert.match(gate.reason, /RANKING AMONG LOSSES/);
  assert.equal(gate.to.hpAfter, 0, 'and the destination is still a death at 0');
  assert.equal(gate.to.survives, false);
  // The floor applies here too: 1 hp apart at the same clamped hpAfter is rounding.
  const tie = [clampedDying('chosen', 22), clampedDying('one-more', 21)];
  assert.equal(refuseLethalChoice('chosen', tie, tie).overridden, false, '1 hp of hpLoss is not a margin');
});

test('a plan that matches the best on both keys is the same death, and is not moved off', () => {
  const board = [clampedDying('chosen', 22), clampedDying('same-death', 22)];
  const gate = refuseLethalChoice('chosen', board, board);
  assert.equal(gate.choice, 'chosen');
  assert.equal(gate.overridden, false);
  assert.match(gate.reason, /the policy already chose it, so nothing moved/);
});

test('hpAfter ties and the chosen states no hpLoss, so there is no margin to move on', () => {
  const board = [
    candidate({id: 'chosen', forecast: {quality: 'partial', survives: false, hpAfter: 0, hpLoss: null}}),
    clampedDying('has-a-figure', 22),
  ];
  const gate = refuseLethalChoice('chosen', board, board);
  assert.equal(gate.choice, 'chosen');
  assert.equal(gate.overridden, false);
  assert.match(gate.reason, /no hpLoss stated on both to separate them, so there is no margin here/);
  assert.match(gate.reason, /will not move on one/);
});

test('an unknown board is untouched, because an unknown is not a death to rank', () => {
  const board = [
    dying('lethal', 0),
    candidate({id: 'mystery', forecast: {quality: 'unknown', survives: null, hpAfter: null}}),
    candidate({id: 'also-unknown', forecast: {quality: 'partial', survives: null, hpAfter: 40}}),
  ];
  const gate = refuseLethalChoice('lethal', board, board);
  assert.equal(gate.choice, 'lethal');
  assert.equal(gate.overridden, false);
  assert.equal(gate.lossRanking, undefined, 'there is no ranking, so there is no flag claiming one');
  // Unchanged reading: the original reason, which every existing caller already matches on.
  assert.match(gate.reason, /no other candidate on this board states survives:true/);
});

test('a lone lethal candidate is still not overridden, because there is nothing to rank it against', () => {
  const gate = refuseLethalChoice('end', [dying('end', 0)], [dying('end', 0)]);
  assert.equal(gate.overridden, false);
  assert.equal(gate.choice, 'end');
  assert.match(gate.reason, /no other candidate on this board states survives:true/);
});

test('the chosen plan that states it dies but never says by how much is left alone', () => {
  const board = [
    candidate({id: 'chosen', forecast: {quality: 'partial', survives: false}}),
    dying('measurable', 0),
    dying('measurable-2', -7),
  ];
  const gate = refuseLethalChoice('chosen', board, board);
  assert.equal(gate.choice, 'chosen', 'unmeasurable is not the same as worst');
  assert.equal(gate.overridden, false);
  assert.equal(gate.leastBad.id, 'measurable', 'the ranking is still reported');
  assert.equal(gate.rankedAmong.length, 2, 'the unmeasurable plan is not ranked, because it has no margin');
  assert.match(gate.reason, /carries no hpAfter, so there is no margin to compare/);
  assert.match(gate.reason, /will not move on a comparison it cannot make/);
});

test("a gap inside the forecasts' own incomingMin/incomingMax bracket is not a reason to move", () => {
  // Both plans' damage is a BOUND, not a total, and the bounds overlap across the 4 hp gap
  // between them - so the gap is inside the uncertainty the planner already disclosed and
  // ranking on it would be ranking noise.
  const board = [
    dying('chosen', -3, {incomingMin: 12, incomingMax: 20, incomingExact: false}),
    dying('better', 1, {incomingMin: 10, incomingMax: 15, incomingExact: false}),
  ];
  const gate = refuseLethalChoice('chosen', board, board);
  assert.equal(gate.choice, 'chosen');
  assert.equal(gate.overridden, false);
  assert.match(gate.reason, /widened to the widest incomingMin\/incomingMax bracket/);
  assert.match(gate.reason, /a 4 hp better margin on hpAfter, which is below the 8 hp this gate requires/);

  // The same 4 hp gap with exact forecasts IS material: the bracket is a point, so there is
  // no disclosed uncertainty left to hide inside.
  const exact = [
    dying('chosen', -3, {incomingMin: 12, incomingMax: 12, incomingExact: true}),
    dying('better', 1, {incomingMin: 10, incomingMax: 10, incomingExact: true}),
  ];
  assert.equal(refuseLethalChoice('chosen', exact, exact).overridden, true);
});

test('a board offering the only potion is ranked ONTO it, and the log never calls that survival', () => {
  // The safety case in PLAN.md's terms: the least-bad loss burns the only potion. The tier is
  // allowed to prefer it - it is an option the POLICY already put on the board - but it may
  // not spend anything itself, and the log must be unmistakably a ranking of deaths.
  const board = [
    candidate({id: 'fight', label: 'Attack', command: {action: 'play_card'}, forecast: {quality: 'partial', survives: false, hpAfter: -2, hpLoss: 22}}),
    candidate({id: 'potion', label: 'Drink blood', command: {action: 'use_potion'}, forecast: {quality: 'partial', survives: false, hpAfter: 0, hpLoss: 20}}),
  ];
  const gate = refuseLethalChoice('fight', board, board);
  assert.equal(gate.choice, 'potion');
  assert.equal(gate.lossRanking, true);
  // Still death. hpAfter 0 after drinking the potion is a death, and the log says so.
  assert.equal(gate.to.survives, false);
  assert.equal(gate.to.hpAfter, 0);
  assert.match(gate.reason, /an option this board already offered - nothing was spent, nothing was invented/);
  assert.match(gate.reason, /every plan here still dies/);
  // Every "survives:true" in the reason must sit inside the negation, never as a claim.
  const claims = [...gate.reason.matchAll(/survives: ?true/gi)];
  assert.ok(claims.length > 0, 'the reason does address the survival question head on');
  for (const claim of claims) {
    assert.match(gate.reason.slice(0, claim.index), /no candidate here states $/, 'each survives:true is a denial');
  }
});

test('the tier never invents a plan: the answer is always an id already on the board', () => {
  const board = [dying('a', -5), dying('b', -1), dying('c', -9)];
  for (const choice of ['a', 'b', 'c']) {
    const gate = refuseLethalChoice(choice, board, board);
    assert.ok(board.some(c => c.id === gate.choice), `${choice} -> ${gate.choice} is a real candidate`);
  }
  // And a ranking order naming something off the board is ignored, not honoured.
  const gate = refuseLethalChoice('a', board, [{id: 'invented'}, {id: 'b'}, {id: 'a'}]);
  assert.equal(gate.choice, 'b');
  assert.ok(!gate.rankedAmong.includes('invented'));
});

test('REGRESSION: the proven-survivor path is unchanged, byte for byte', () => {
  // The exact return object refuseLethalChoice produced before the last-resort tier existed.
  // If a future change to the tier edits the survivor branch, this stops matching.
  const end = candidate({id: 'end', label: 'End turn', command: {action: 'end_turn'}, forecast: {quality: 'partial', survives: false, hpAfter: 0, hpLoss: 16}});
  const live = candidate({id: 'live', label: 'Block', forecast: {quality: 'partial', survives: true, hpAfter: 9, hpLoss: 7}});
  const gate = refuseLethalChoice('end', [end, live], [end, live]);
  assert.deepEqual(gate, {
    choice: 'live',
    overridden: true,
    from: {id: 'end', label: 'End turn', action: 'end_turn', quality: 'partial', survives: false, hpAfter: 0, incoming: null, incomingExact: null},
    to: {id: 'live', label: 'Block', action: 'play_card', quality: 'partial', survives: true, hpAfter: 9, incoming: null, incomingExact: null},
    // The survivor branch's WORDING changed deliberately on 2026-10-01, and this tripwire is why
    // that is a recorded decision rather than a silent edit. Three reviewers independently reported
    // that "states survives:true" reads as a PROVEN survivor when the forecast is `partial` — a
    // quality that means "carries warnings". Measured first: 92.5% of combat decisions carry a
    // partial survivor claim and on 3,865 of them it is the ONLY survivor, so FORBIDDING it would
    // withhold up to 22 real rescues and gain none. The defect was the log's claim, not the gate's
    // behaviour, so the gate still acts and now says what it actually did. The structure — from, to,
    // overridden — is still pinned below, which is what this test exists to protect.
    reason: 'refused end (End turn, end_turn) because its own forecast states survives:false at quality "partial" with hpAfter 0; moved to live (Block, play_card), the highest-ranked candidate whose forecast CLAIMS survives:true at quality "partial" — a PARTIAL claim, carrying warnings, so this is an UNPROVEN survivor and the gate is acting on an unproven safety claim',
  });
  // A survivor still beats a better-margin loss: the proven-survival tier is checked first.
  const mixed = [dying('lethal', -8), live];
  assert.equal(refuseLethalChoice('lethal', mixed, mixed).choice, 'live');
  assert.equal(statedSurvival(live), true);
});

test('the other two exports are untouched by the tier', () => {
  assert.equal(statedSurvival(dying('d', 0)), false);
  assert.equal(statedSurvival(candidate({id: 'u'})), null);
  const answers = {};
  for (const prefix of FACTOR_PREFIXES) answers[prefix + 'd'] = {noul: 0.5};
  assert.equal(completeFactors([dying('d', 0)], answers, FACTOR_PREFIXES), true);
  assert.equal(completeFactors([dying('d', 0)], {}, FACTOR_PREFIXES), false);
});
