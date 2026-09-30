import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore, recordRun, addLesson} from './memory.mjs';
import {buildRecallContext, RECALL_MAX_BYTES} from './recall.mjs';

const at = (o = {}) => ({...o, clock: '2026-09-28T12:00:00.000Z'});
const lesson = (o = {}) => at({
  kind: 'death-was-readable',
  text: 'Ended a turn with the incoming intent already exceeding HP plus Block, and died to it.',
  confidence: 0.9,
  evidence: {runId: 'r1', act: 1, floor: 12, kind: 'x', encounter: 'Phrog Parasite'},
  context: {act: 1, floor: 12, stateType: 'elite', encounters: ['Phrog Parasite']},
  ...o,
});
const fight = (o = {}) => ({
  state_type: 'elite', run: {act: 1, floor: 12}, player: {hp: 2, max_hp: 80},
  battle: {enemies: [{entity_id: 'e0', name: 'Phrog Parasite', hp: 20, intents: []}]},
  ...o,
});

test('an empty store yields an honest empty context, not an invented lesson', () => {
  for (const store of [createStore('2026-09-28T00:00:00.000Z'), null, undefined, {lessons: 'not a list'}]) {
    const context = buildRecallContext(store, fight());
    assert.deepEqual(context.lessons, [], 'no lesson may be produced from nothing');
    assert.equal(context.history.runs, 0);
    assert.equal(context.history.deaths, 0);
    assert.equal(context.history.deepestFloor, null, 'a floor nobody reached is null, not 0');
    assert.equal(context.history.lessonsStored, 0);
    assert.match(context.historyLine, /no run has been ingested/);
    assert.match(context.gaps, /No completed run has been ingested/);
    assert.match(context.gaps, /unseen cards/);
    assert.ok(context.note.length > 0, 'an empty context still says why it is empty');
  }
  const missingStore = buildRecallContext(null, fight());
  const wrongShape = buildRecallContext({lessons: 'not a list'}, fight());
  assert.equal(missingStore.present, false);
  assert.equal(wrongShape.present, false);
  assert.match(missingStore.note, /no readable memory store/);
});

test('run-level stats describe the recorded history and nothing beyond it', () => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  recordRun(store, {runId: 'r1', result: 'death', finalAct: 1, finalFloor: 14});
  recordRun(store, {runId: 'r2', result: 'ended', finalAct: 2, finalFloor: 31});
  recordRun(store, {runId: 'r3', result: 'death', finalAct: 2, finalFloor: 27});
  const context = buildRecallContext(store, fight());
  assert.equal(context.history.runs, 3);
  assert.equal(context.history.deaths, 2);
  assert.equal(context.history.deepestFloor, 31);
  // The run prefix is unchanged; the per-class record now follows it, and on an empty store it says
  // so rather than reading as a 0% win rate.
  assert.match(context.historyLine, /^3 runs recorded, 2 deaths, deepest floor 31\./);
  assert.match(context.historyLine, /no encounter has been fought yet/);
});

test('a matching lesson arrives with its evidence count and the basis that earned it', () => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  recordRun(store, {runId: 'r1', result: 'death', finalAct: 1, finalFloor: 12});
  addLesson(store, lesson());
  addLesson(store, lesson({evidence: {runId: 'r2', act: 1, floor: 12, kind: 'x', encounter: 'Phrog Parasite'}}));
  const [first] = buildRecallContext(store, fight()).lessons;
  assert.equal(first.id, 'l0001');
  assert.match(first.text, /incoming intent already exceeding/);
  assert.equal(first.confidence > 0.9, true, 'two distinct evidence records raise confidence');
  assert.equal(first.confirmations, 2, 'confirmations count distinct evidence records, not repetitions');
  assert.ok(first.basis.includes('encounter:Phrog Parasite'), `basis was ${JSON.stringify(first.basis)}`);
  assert.equal(first.textClipped, undefined);
});

test('lessons that do not match this state are withheld and named as withheld', () => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  recordRun(store, {runId: 'r1', result: 'death', finalAct: 1, finalFloor: 40});
  addLesson(store, lesson({
    text: 'Died to a boss on act 3, which says nothing about an act 1 elite.',
    context: {act: 3, floor: 40, stateType: 'boss', encounters: ['The Guardian']},
    evidence: {runId: 'r1', act: 3, floor: 40, kind: 'x', encounter: 'The Guardian'},
  }));
  const context = buildRecallContext(store, fight());
  assert.deepEqual(context.lessons, []);
  assert.equal(context.considered, 1);
  assert.equal(context.skipped, 1);
  assert.match(context.gaps, /did not match this state and were withheld/);
  assert.match(context.note, /no stored lesson matches/);
});

test('the context is bounded in bytes, and dropping lessons to fit is reported', () => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  for (let i = 0; i < 40; i++) {
    recordRun(store, {runId: `r${i}`, result: 'death', finalAct: 1, finalFloor: 12});
    addLesson(store, at({
      kind: `kind-${i}`,
      text: `Lesson ${i}: ` + 'the planner took an end turn its own forecast had already called lethal, and the turn was fatal. '.repeat(4),
      confidence: 0.5 + i / 100,
      evidence: {runId: `r${i}`, act: 1, floor: 12, kind: `k${i}`, encounter: 'Phrog Parasite'},
      context: {act: 1, floor: 12, stateType: 'elite', encounters: ['Phrog Parasite']},
    }));
  }
  const generous = buildRecallContext(store, fight(), {maxBytes: 1e9});
  assert.equal(generous.lessons.length, 5, 'the default limit holds when the budget is not the binding constraint');
  assert.equal(generous.truncated, 0);
  assert.equal(generous.considered, 40, 'retrieval considered every stored lesson, not just the ones carried');

  // Under the real default budget the long lessons are trimmed, and the trim is reported rather than hidden.
  const bounded = buildRecallContext(store, fight());
  assert.ok(bounded.lessons.length < 5, 'the byte budget is doing the work these long lessons force it to');
  assert.equal(bounded.lessons.length + bounded.truncated, 5);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= RECALL_MAX_BYTES);
  assert.equal(bounded.considered, 40, 'trimming the payload does not shrink what was considered');

  for (const maxBytes of [500, 900, 1500, 4000]) {
    const context = buildRecallContext(store, fight(), {maxBytes});
    const shell = Buffer.byteLength(JSON.stringify(buildRecallContext(store, fight(), {maxBytes: 1e9, limit: 0})));
    assert.ok(Buffer.byteLength(JSON.stringify(context)) <= Math.max(maxBytes, shell),
      `maxBytes ${maxBytes} was not honoured`);
    assert.equal(context.lessons.length + context.truncated, 5, 'every lesson is either carried or reported as dropped');
    assert.ok(context.gaps.length > 0 && context.note.length > 0, 'the honesty fields survive every budget');
  }
  const starved = buildRecallContext(store, fight(), {maxBytes: 200});
  assert.deepEqual(starved.lessons, []);
  assert.equal(starved.truncated, 5);
  assert.match(starved.gaps, /unseen cards/, 'the disclaimer is the last thing to go, never the first');
});

test('an over-long lesson is clipped and says so instead of trailing off mid-claim', () => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  recordRun(store, {runId: 'r1', result: 'death', finalAct: 1, finalFloor: 12});
  addLesson(store, lesson({text: 'Because '.repeat(200)}));
  const [first] = buildRecallContext(store, fight()).lessons;
  assert.equal(first.textClipped, true);
  assert.ok(first.text.length <= 401, `clipped text was ${first.text.length} chars`);
  assert.ok(first.text.endsWith('…'));
  // Nothing was withheld here, so gaps carries only the standing limit - it must not imply a skip that did
  // not happen, and it must not imply history that does not exist either.
  assert.equal(buildRecallContext(store, fight()).skipped, 0);
  assert.match(buildRecallContext(store, fight()).gaps, /^The store holds only what past decisions/);
});

test('the context survives a real save/load round trip on disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jev-recall-'));
  const path = join(dir, 'nested', 'memory.json');
  const store = createStore('2026-09-28T00:00:00.000Z');
  recordRun(store, {runId: 'r1', result: 'death', finalAct: 1, finalFloor: 12});
  addLesson(store, lesson());
  // Written by hand rather than through saveMemory, which memory.test.mjs already covers: what is under
  // test here is the recall view over a stored file, and the server hands this policy the same shape.
  mkdirSync(join(dir, 'nested'), {recursive: true});
  writeFileSync(path, JSON.stringify(store));
  const loaded = buildRecallContext(JSON.parse(readFileSync(path, 'utf8')), fight());
  assert.equal(loaded.lessons.length, 1);
  assert.equal(loaded.history.runs, 1);
  assert.equal(loaded.history.deaths, 1);
  rmSync(dir, {recursive: true, force: true});
});

// The class record is the one part of the request that exists ONLY because earlier runs are
// remembered. Measured over 8 Ascension-10 runs: elites won 9 of 25, normals 111 of 121 — and the
// route label already said "Elite next, no rest before" and was walked past anyway.
test('the recall payload carries the agent\'s own win rate by fight class', () => {
  const store = {
    version: 1,
    runs: [{runId: 'r1', result: 'death', finalFloor: 12}, {runId: 'r2', result: 'death', finalFloor: 9}],
    lessons: [],
    encounters: {
      'monster:Nibbit': {seen: 10, wins: 10, losses: 0, avgHpLostBefore: 15},
      'elite:Byrdonis': {seen: 4, wins: 0, losses: 4, avgHpLostBefore: 17},
    },
  };
  const c = buildRecallContext(store, {state_type: 'map', run: {act: 1, floor: 6}, player: {hp: 20, max_hp: 91}});
  const byClass = Object.fromEntries(c.encounterRecord.map(r => [r.class, r]));
  assert.equal(byClass.monster.wins, 10, 'the record is counted, not asserted');
  assert.equal(byClass.monster.winRate, 100);
  assert.equal(byClass.elite.winRate, 0, 'a 0-for-4 record must not be smoothed away');
  assert.equal(byClass.elite.losses, 4);
  assert.match(c.recordLine, /elite 0\/4 won \(0%\)/, 'and it is stated in the line the model reads');
  assert.match(c.historyLine, /Own record:/);
});

test('no encounters means no record, and it says so rather than claiming 0%', () => {
  const c = buildRecallContext({version: 1, runs: [{runId: 'r1', result: 'death', finalFloor: 3}], lessons: [], encounters: {}}, {state_type: 'map'});
  assert.deepEqual(c.encounterRecord, [], 'nothing fought, nothing claimed');
  assert.match(c.recordLine, /no encounter has been fought yet/);
  assert.doesNotMatch(c.historyLine, /0%/, 'an empty record must never read as a 0% win rate');
});

test('an encounter with no wins and no losses seen is not counted', () => {
  const c = buildRecallContext({version: 1, runs: [{runId: 'r1', result: 'death', finalFloor: 3}], lessons: [],
    encounters: {'elite:Ghost': {seen: 0, wins: 0, losses: 0, avgHpLostBefore: null}}}, {state_type: 'map'});
  assert.deepEqual(c.encounterRecord, [], 'a zero-sample encounter carries no information');
});
