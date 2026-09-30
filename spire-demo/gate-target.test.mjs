// THE GATE RESCUED AN ARBITRARY SURVIVOR.
//
// The gate's job is to move to the BEST available survivor, so the ORDER it is handed decides which
// one it picks. Four of seven call sites passed the raw candidate list. Since iteration 9 the menu is
// ordered by turn-completeness and then damage — so "first survivor in menu order" meant "whatever
// the menu happened to put first", which is an arbitrary choice wearing the costume of a rescue.
import test from 'node:test';
import assert from 'node:assert/strict';
import {refuseLethalChoice, rankingByProbability} from './learning/lethal-gate.mjs';

const lethal = {id: 'p0', label: 'Defend', command: {action: 'end_turn'}, forecast: {quality: 'partial', survives: false, hpAfter: 0}};
const firstInMenu = {id: 'p1', label: 'Block hard', command: {action: 'play_card'}, forecast: {quality: 'partial', survives: true, hpAfter: 30}};
const preferred = {id: 'p2', label: 'Block a little', command: {action: 'play_card'}, forecast: {quality: 'partial', survives: true, hpAfter: 4}};
const board = [lethal, firstInMenu, preferred];

test("the gate moves to the survivor the MODEL ranked first, not the one the menu listed first", () => {
  const answer = {probabilities: {p0: 0.2, p1: 0.35, p2: 0.45}};
  assert.equal(refuseLethalChoice('p0', board, rankingByProbability(answer, board)).choice, 'p2',
    "p2 is the model's preference even though p1 is listed first");
});

test('passing the raw menu order really does pick the wrong one — the regression this fixes', () => {
  assert.equal(refuseLethalChoice('p0', board, board).choice, 'p1',
    'this is the old behaviour, kept as a guard so the test above is known to discriminate');
});

test('a candidate the model gave no probability to sorts last, not dropped', () => {
  const silent = {id: 'p3', label: 'Unmentioned', command: {action: 'play_card'}, forecast: {quality: 'partial', survives: true, hpAfter: 20}};
  const ranked = rankingByProbability({probabilities: {p0: 0.1, p1: 0.9}}, [silent, firstInMenu, lethal]);
  assert.equal(ranked[0].id, 'p1', 'the highest-probability candidate ranks first');
  assert.equal(ranked.at(-1).id, 'p3', 'and the unmentioned one sorts LAST rather than being excluded');
  assert.equal(ranked.length, 3, 'nothing is dropped');
});

test('with no probabilities at all the order is simply preserved', () => {
  const ranked = rankingByProbability({}, board);
  assert.deepEqual(ranked.map(c => c.id), board.map(c => c.id), 'no information, no rearrangement');
});
