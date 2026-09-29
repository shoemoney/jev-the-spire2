import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  MEMORY_VERSION, createStore, loadMemory, saveMemory, recordRun, recordEncounter, addLesson,
  retrieveLessons, extractLessons, parseRunLog, ingestLog, pruneStore, summarizeStore, encounterKey, intentDamage, incomingDamage,
} from './memory.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'jev-memory-'));
const at = (o = {}) => ({...o, clock: '2026-09-28T12:00:00.000Z'});
const evidence = (o = {}) => ({runId: 'r1', act: 1, floor: 12, kind: 'x', encounter: 'Byrdonis', ...o});
const lesson = (o = {}) => at({kind: 'death-was-readable', text: 'Died at floor 12 with 27 incoming', confidence: 0.9, evidence: evidence(), context: {act: 1, floor: 12, stateType: 'elite', encounters: ['Byrdonis']}, ...o});

test('a store round-trips through disk with its evidence intact', () => {
  const d = dir(), path = join(d, 'nested', 'memory.json');
  const store = createStore('2026-09-28T00:00:00.000Z');
  recordRun(store, {runId: 'r1', character: 'The Ironclad', ascension: 10, result: 'death', finalAct: 1, finalFloor: 14, hpLost: 85, decisions: 161});
  recordEncounter(store, 'elite:Wriggler', {win: false, hpLostBefore: 73, note: 'three of them'});
  assert.equal(addLesson(store, lesson()).stored, true);
  const saved = saveMemory(store, path);
  assert.equal(existsSync(saved.path), true);
  const loaded = loadMemory(path);
  assert.equal(loaded.status, 'loaded');
  assert.equal(loaded.store.runs.length, 1);
  assert.equal(loaded.store.runs[0].hpLost, 85);
  assert.equal(loaded.store.encounters['elite:Wriggler'].losses, 1);
  assert.equal(loaded.store.lessons.length, 1);
  assert.equal(loaded.store.lessons[0].evidence[0].incoming, undefined, 'the default evidence carries no incoming field, and none is invented on reload');
  rmSync(d, {recursive: true, force: true});
});

test('a missing file starts clean and says so; a corrupt one recovers without throwing or inventing', () => {
  const d = dir();
  const fresh = loadMemory(join(d, 'memory.json'));
  assert.equal(fresh.status, 'created');
  assert.equal(fresh.store.version, MEMORY_VERSION);
  assert.deepEqual(fresh.store.lessons, []);
  assert.match(fresh.note, /no memory file/);

  writeFileSync(join(d, 'memory.json'), '{"version":1,"lessons":[{');
  const broken = loadMemory(join(d, 'memory.json'));
  assert.equal(broken.status, 'corrupt');
  assert.deepEqual(broken.store.runs, []);
  assert.deepEqual(broken.store.lessons, []);
  assert.match(broken.note, /not valid JSON/);
  // The bad file is still there: recovery must not be a licence to overwrite evidence.
  assert.equal(existsSync(join(d, 'memory.json')), true);

  // A well-formed file holding the wrong shape is corrupt too, not a store.
  writeFileSync(join(d, 'array.json'), '[1,2,3]');
  assert.equal(loadMemory(join(d, 'array.json')).status, 'corrupt');
  rmSync(d, {recursive: true, force: true});
});

test('a version this build does not understand is reported, not guessed at', () => {
  const d = dir(), path = join(d, 'memory.json');
  writeFileSync(path, JSON.stringify({version: 99, lessons: [{id: 'l1', text: 'from the future'}], runs: []}));
  const r = loadMemory(path);
  assert.equal(r.status, 'version-mismatch');
  assert.match(r.note, /version 99/);
  assert.match(r.note, /will not guess/);
  assert.deepEqual(r.store.lessons, [], 'a foreign shape is not adopted as our own');
  // And the file on disk is untouched, so nothing is lost by the refusal.
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).lessons.length, 1);
  rmSync(d, {recursive: true, force: true});
});

test('the write is atomic: the target is replaced whole and no temp file survives', () => {
  const d = dir(), path = join(d, 'memory.json');
  const store = createStore('2026-09-28T00:00:00.000Z');
  addLesson(store, lesson());
  saveMemory(store, path);
  // A second, larger store must not leave any of the first one readable through the target.
  addLesson(store, at({text: 'A second lesson about a different fight', evidence: evidence({floor: 9})}));
  recordRun(store, {runId: 'r2', finalFloor: 9});
  saveMemory(store, path);
  assert.deepEqual(readdirSync(d), ['memory.json'], `temp files left behind: ${readdirSync(d)}`);
  const onDisk = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(onDisk.lessons.length, 2);
  assert.equal(onDisk.runs.length, 1);
  assert.ok(readFileSync(path, 'utf8').endsWith('\n'));
  // A crash mid-write leaves the previous store: simulate one by failing during the payload build.
  const cyclic = {...store};
  cyclic.self = cyclic;
  assert.throws(() => saveMemory(cyclic, path));
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).lessons.length, 2, 'the last good store survived the failed write');
  assert.deepEqual(readdirSync(d), ['memory.json']);
  rmSync(d, {recursive: true, force: true});
});

test('a repeated lesson increments its confirmation instead of piling up a near-copy', () => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  // One rule, one piece of text. Two runs that hit it produce byte-identical prose differing only in the
  // numbers inside - which is exactly the shape the store has to collapse.
  const text = 'Died with the incoming intent already on screen: the last end_turn faced # damage against # HP and # Block.';
  const first = addLesson(store, at({text, confidence: 0.9, evidence: evidence({runId: 'r1', floor: 12, incoming: 27, hp: 22, block: 5})}));
  assert.equal(first.deduped, false);
  const again = addLesson(store, at({
    text,
    confidence: 0.9,
    evidence: evidence({runId: 'r2', floor: 11, incoming: 27, hp: 22, block: 5}),
    context: {act: 1, floor: 11, stateType: 'elite', encounters: ['Byrdonis']},
  }));
  assert.equal(again.deduped, true);
  assert.equal(again.addedEvidence, 1);
  assert.equal(store.lessons.length, 1, 'a second run hitting the same rule is a confirmation, not a copy');
  assert.equal(store.lessons[0].evidence.length, 2);
  assert.equal(store.lessons[0].confirmations, 2);
  // The same run again adds nothing: confidence must not be manufacturable by re-ingesting.
  const repeat = addLesson(store, at({text, confidence: 0.9, evidence: evidence({runId: 'r1', floor: 12, incoming: 27, hp: 22, block: 5})}));
  assert.equal(repeat.deduped, true);
  assert.equal(repeat.addedEvidence, 0);
  assert.equal(store.lessons[0].evidence.length, 2);
  assert.ok(store.lessons[0].confidence <= 0.95, 'confidence is capped below certainty');
  // A different kind is a different lesson, even with identical words.
  addLesson(store, at({text, kind: 'unmodeled-enemy-power', evidence: evidence({runId: 'r3'})}));
  assert.equal(store.lessons.length, 2);
  // And a genuinely different lesson is not swept up by the digit-masking either.
  addLesson(store, at({text: 'Fought the whole fight with no survival estimate.', evidence: evidence({runId: 'r4'})}));
  assert.equal(store.lessons.length, 3);
  rmSync(dir(), {recursive: true, force: true});
});

test('a lesson with no evidence is refused, and so is one with no text', () => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  const bare = addLesson(store, at({kind: 'k', text: 'Entered an elite at floor 11 with no block available', confidence: 0.95, context: {act: 1, floor: 11, stateType: 'elite', encounters: []}}));
  assert.equal(bare.stored, false);
  assert.match(bare.reason, /no evidence/);
  assert.equal(store.lessons.length, 0);
  const empty = addLesson(store, at({text: '   ', evidence: evidence()}));
  assert.equal(empty.stored, false);
  assert.match(empty.reason, /needs text/);
  assert.equal(store.lessons.length, 0);
});

test('retrieval caps at the limit and ranks the matching lesson above the non-matching one', () => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  addLesson(store, at({
    kind: 'unmodeled-enemy-power', text: 'Low confidence', confidence: 0.95,
    evidence: evidence({runId: 'r9', encounter: 'Hexaghost'}), context: {act: 3, floor: 44, stateType: 'boss', encounters: ['Hexaghost']},
  }));
  addLesson(store, at({
    kind: 'death-was-readable', text: 'Died to Byrdonis with 27 incoming against 22 HP', confidence: 0.6,
    evidence: evidence({runId: 'r1'}), context: {act: 1, floor: 12, stateType: 'elite', encounters: ['Byrdonis']},
  }));
  addLesson(store, at({
    kind: 'multi-hit-killer', text: 'Wriggler buffed twice before it killed', confidence: 0.65,
    evidence: evidence({runId: 'r2', floor: 14, encounter: 'Wriggler'}),
    context: {act: 1, floor: 14, stateType: 'elite', encounters: ['Wriggler']},
  }));
  const state = {state_type: 'elite', run: {act: 1, floor: 12}, battle: {enemies: [{name: 'Byrdonis'}, {name: 'Byrdonis'}]}};
  const r = retrieveLessons(store, {state, limit: 5});
  assert.equal(r.lessons.length, 2, 'the act 3 boss lesson is not about this fight');
  assert.equal(r.lessons[0].lesson.context.encounters[0], 'Byrdonis', 'the encounter hit outranks the higher confidence');
  assert.ok(r.lessons[0].basis.some(b => b.startsWith('encounter:')), `no encounter basis in ${r.lessons[0].basis}`);
  assert.equal(r.skipped, 1);
  assert.match(r.skippedDetail[0].reason, /does not match this state/);
  assert.equal(retrieveLessons(store, {state, limit: 1}).lessons.length, 1);
  assert.equal(retrieveLessons(store, {state, limit: 0}).lessons.length, 0);
  // Uses are counted on the lessons actually served. The act 3 boss lesson is still at zero: it was
  // considered and rejected every time and never put in front of anyone. The two retrievals with a
  // non-zero limit served the Byrdonis lesson; the limit:0 call served nothing, so it counted nothing.
  assert.equal(r.lessons[0].lesson.uses, 2, 'a retrieval that returns nothing is not a use');
  assert.ok(r.lessons[0].lesson.lastUsedAt);
  assert.equal(store.lessons.find(l => l.context.encounters.includes('Hexaghost')).uses, 0);
});

test('a lesson with no matching evidence is not returned as relevant, and an empty result is honest', () => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  addLesson(store, at({
    kind: 'death-was-readable', text: 'A lesson about a floor 44 boss', confidence: 0.99,
    evidence: evidence({runId: 'r1', act: 3, floor: 44, encounter: 'Hexaghost'}),
    context: {act: 3, floor: 44, stateType: 'boss', encounters: ['Hexaghost']},
  }));
  const elsewhere = retrieveLessons(store, {state: {state_type: 'monster', run: {act: 1, floor: 2}, battle: {enemies: [{name: 'Nibbit'}]}}});
  assert.deepEqual(elsewhere.lessons, []);
  assert.match(elsewhere.note, /no stored lesson matches/);
  assert.equal(elsewhere.considered, 1);
  assert.equal(elsewhere.skipped, 1);
  // A state with no battle at all is still matched on type+floor, and said so in the basis.
  const noBattle = retrieveLessons(store, {state: {state_type: 'map', run: {act: 3, floor: 45}}});
  assert.deepEqual(noBattle.lessons, [], 'state_type differs, so nothing is claimed');
  const sameShape = retrieveLessons(store, {state: {state_type: 'boss', run: {act: 3, floor: 44}, battle: {enemies: [{name: 'Hexaghost'}]}}});
  assert.equal(sameShape.lessons.length, 1);
  assert.equal(sameShape.lessons[0].evidence.length, 1, 'evidence travels with the lesson so the claim is checkable');
});

test('act proximity alone is not relevance: a floor 2 fight is not served floor 14 death lessons', () => {
  // Measured on the real corpus: 5 death lessons all sit on floors 9-14. Serving any of them to an early
  // floor-2 monster would be the store padding the prompt, which is worse than returning nothing.
  const store = createStore('2026-09-28T00:00:00.000Z');
  addLesson(store, at({
    kind: 'death-was-readable', text: 'Died with the incoming intent already on screen', confidence: 0.95,
    evidence: evidence({runId: 'r1', floor: 14, encounter: 'Inklet'}), context: {act: 1, floor: 14, stateType: 'monster', encounters: ['Inklet']},
  }));
  const early = retrieveLessons(store, {state: {state_type: 'monster', run: {act: 1, floor: 2}, battle: {enemies: [{name: 'Nibbit'}]}}});
  assert.deepEqual(early.lessons, [], 'same act, same state type, twelve floors away - not relevant');
  assert.equal(early.skipped, 1);
  // Nine floors is inside the window, so it is served, and the basis says why.
  const near = retrieveLessons(store, {state: {state_type: 'monster', run: {act: 1, floor: 5}, battle: {enemies: [{name: 'Nibbit'}]}}});
  assert.equal(near.lessons.length, 1);
  assert.ok(near.lessons[0].basis.includes('floor±9'));
  // A named encounter beats the floor window: the Inklet lesson still applies to a second Inklet fight.
  const sameEncounter = retrieveLessons(store, {state: {state_type: 'monster', run: {act: 1, floor: 2}, battle: {enemies: [{name: 'Inklet'}]}}});
  assert.equal(sameEncounter.lessons.length, 1);
  assert.ok(sameEncounter.lessons[0].basis.some(b => b.startsWith('encounter:')));
});

test('a merged lesson still matches a later fight it has evidence from, not just the first', () => {
  // Two runs die to the same RULE against different enemies. The lesson's context freezes on the first
  // one, so matching on context alone would hide it from the second fight - the very fight it is about.
  const store = createStore('2026-09-28T00:00:00.000Z');
  const text = 'Died to an enemy the forecaster explicitly could not model.';
  addLesson(store, at({text, kind: 'unmodeled-enemy-power', evidence: evidence({runId: 'r1', floor: 9, encounter: 'Skulking Colony'}), context: {act: 1, floor: 9, stateType: 'elite', encounters: ['Skulking Colony']}}));
  addLesson(store, at({text, kind: 'unmodeled-enemy-power', evidence: evidence({runId: 'r2', floor: 12, encounter: 'Phantasmal Gardener'}), context: {act: 1, floor: 12, stateType: 'elite', encounters: ['Phantasmal Gardener']}}));
  assert.equal(store.lessons.length, 1, 'one rule, one lesson');
  assert.equal(store.lessons[0].evidence.length, 2);
  assert.equal(store.lessons[0].context.encounters[0], 'Skulking Colony', 'context is the first fight that produced it');
  const r = retrieveLessons(store, {state: {state_type: 'elite', run: {act: 1, floor: 12}, battle: {enemies: [{name: 'Phantasmal Gardener'}]}}});
  assert.equal(r.lessons.length, 1, 'the Gardener evidence is a match even though the context says Colony');
  assert.ok(r.lessons[0].basis.some(b => b === 'encounter:Phantasmal Gardener'), `basis was ${r.lessons[0].basis}`);
});

test('extraction only produces a lesson when the log carries the evidence for it', () => {
  const endTurn = (o) => ({
    kind: 'decision',
    candidates: [{id: 'a0', forecast: o.forecast ?? {quality: 'unknown', warnings: o.warnings ?? []}}],
    answer: {choice: 'a0', confidence: o.confidence ?? 0.2},
    chosen: {command: {action: o.action ?? 'play_card'}},
    state: {state_type: 'elite', run: {act: 1, floor: 12}, player: {hp: o.hp, max_hp: 80, block: o.block}, battle: {round: o.round ?? 1, enemies: [{name: 'Byrdonis', hp: 40, max_hp: 90, intents: [{type: 'Attack', label: o.label}]}]}},
  });
  const summary = {runId: 'r1', result: 'death', finalAct: 1, finalFloor: 12, hpLost: 80};
  const blind = [
    endTurn({hp: 22, block: 0, action: 'play_card'}),
    endTurn({hp: 22, block: 5, action: 'play_card'}),
    endTurn({hp: 22, block: 5, action: 'play_card'}),
    endTurn({hp: 22, block: 5, action: 'end_turn', label: '9x3 (27)'}),
  ];
  const {lessons} = extractLessons(summary, blind);
  const kinds = lessons.map(l => l.kind);
  assert.ok(kinds.includes('death-was-readable'));
  assert.ok(kinds.includes('entered-fight-critical'));
  assert.ok(kinds.includes('decided-blind'));
  assert.ok(kinds.includes('multi-hit-killer'));
  for (const l of lessons) {
    assert.ok(l.evidence && Object.keys(l.evidence).length, `${l.kind} has no evidence`);
    assert.ok(l.confidence > 0 && l.confidence <= 0.95);
  }
  // A single blind decision is not a pattern, so it is refused rather than stated as a fight-long habit.
  const one = extractLessons(summary, [endTurn({hp: 22, block: 0, action: 'end_turn', label: '9'})]);
  assert.ok(!one.lessons.some(l => l.kind === 'decided-blind'), 'one observation is an anecdote, not a lesson');
  // The lesson text is the RULE and the numbers live in the evidence. A merged lesson is read next to
  // records from several runs, so text quoting one run's figures would present them as the general case.
  // (The 30% in the low-HP rule is the rule's own threshold, not this run's measurement.)
  for (const l of lessons) {
    const measured = l.evidence.hp ?? l.evidence.incoming ?? l.evidence.blindPct ?? l.evidence.hpPct;
    if (measured !== undefined) assert.ok(!l.text.includes(String(measured)), `lesson text quotes this run's ${measured}: ${l.text}`);
  }
  const lethal = extractLessons(summary, [endTurn({hp: 22, block: 5, action: 'end_turn', label: '9x3 (27)', forecast: {survives: false, hpAfter: 0, incoming: 27, quality: 'partial', warnings: ['Unmodeled enemy power: Territorial']}})]);
  assert.ok(lethal.lessons.some(l => l.kind === 'chose-lethal-end-turn'));
  assert.ok(lethal.lessons.some(l => l.kind === 'unmodeled-enemy-power'));
  // A run with no events yields nothing at all, and says why.
  const none = extractLessons({runId: 'r2', result: 'death', finalAct: 1, finalFloor: 12}, []);
  assert.deepEqual(none.lessons, []);
  assert.match(none.refused[0], /needs a final act and floor/);
  // A win with no death fight has no evidence for any of the death rules.
  const won = extractLessons({runId: 'r3', result: 'ended', finalAct: 1, finalFloor: 9, hpLost: 0}, [endTurn({hp: 60, block: 0, action: 'end_turn', label: '9'})]);
  assert.deepEqual(won.lessons, []);
  assert.match(won.refused[0], /nothing was written/);
});

test('intent labels are read as the game states them, and an unreadable one is null rather than a guess', () => {
  assert.equal(intentDamage({type: 'Attack', label: '27'}), 27);
  assert.equal(intentDamage({type: 'Attack', label: '4x3 (12)'}), 12);
  assert.equal(intentDamage({type: 'Attack', label: '3x4'}), 12);
  assert.equal(intentDamage({type: 'Attack', label: '???'}), null);
  assert.equal(intentDamage({type: 'Attack', label: ''}), null);
  assert.equal(intentDamage({type: 'Buff', label: ''}), null);
  assert.equal(incomingDamage({enemies: [{intents: [{type: 'Attack', label: '4'}, {type: 'Attack', label: '3x3 (9)'}]}]}), 13);
  assert.equal(incomingDamage({enemies: [{intents: [{type: 'Buff', label: ''}]}]}), null, 'no attack intent is not zero incoming');
  assert.equal(incomingDamage(undefined), null);
  // Three same-named enemies are one encounter fight, not three.
  assert.equal(encounterKey({state_type: 'elite', battle: {enemies: [{name: 'Wriggler'}, {name: 'Wriggler'}, {name: 'Wriggler'}]}}), 'elite:Wriggler');
  assert.equal(encounterKey({state_type: 'map'}), null);
});

test('encounter stats accumulate a mean and note what was dropped', () => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  recordEncounter(store, 'elite:Wriggler', {win: true, hpLostBefore: 20, note: 'killed it'});
  recordEncounter(store, 'elite:Wriggler', {win: false, hpLostBefore: 60, note: 'killed it'});
  const e = store.encounters['elite:Wriggler'];
  assert.equal(e.seen, 2);
  assert.equal(e.wins, 1);
  assert.equal(e.losses, 1);
  assert.equal(e.avgHpLostBefore, 40, 'a second fight moves the mean, it does not overwrite it');
  assert.deepEqual(e.notes, ['killed it'], 'a repeated note is not a second note');
  recordEncounter(store, null, {win: true});
  assert.equal(Object.keys(store.encounters).length, 1);
});

test('a run with neither an id nor progress is refused rather than stored as a data point', () => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  assert.equal(recordRun(store, {}), null);
  assert.equal(store.runs.length, 0);
  assert.equal(recordRun(store, {runId: 'r1', finalFloor: 14, result: 'death'}).runId, 'r1');
  recordRun(store, {runId: 'r1', finalFloor: 15, result: 'death', hpLost: 80});
  assert.equal(store.runs.length, 1, 're-recording the same run updates it in place');
  assert.equal(store.runs[0].finalFloor, 15);
});

test('ingesting a log records every run, deduplicates lessons and keeps repeat fights apart', () => {
  const fight = (t, floor, names, round = 1) => JSON.stringify({
    time: t, kind: 'decision',
    candidates: [{id: 'a0', forecast: {quality: 'unknown', warnings: []}}], answer: {choice: 'a0', confidence: 0.1},
    chosen: {command: {action: round === 1 ? 'play_card' : 'end_turn'}},
    state: {state_type: 'monster', run: {act: 1, floor}, player: {hp: 60, max_hp: 80, block: 0}, battle: {round, enemies: names.map(name => ({name, intents: [{type: 'Attack', label: '4x4 (16)'}]}))}},
  });
  // Two separate Fuzzy Wurm Crawler fights, then a run that ends in a fatal end_turn.
  const log = [
    fight('a', 2, ['Fuzzy Wurm Crawler']), fight('b', 2, ['Fuzzy Wurm Crawler'], 2),
    fight('c', 5, ['Fuzzy Wurm Crawler']), fight('d', 5, ['Fuzzy Wurm Crawler'], 2),
    fight('e', 9, ['Skulking Colony']), fight('f', 9, ['Skulking Colony'], 3),
    JSON.stringify({time: 'g', kind: 'run_end', state: {state_type: 'game_over', run: {act: 1, floor: 9, ascension: 10}, player: {character: 'The Ironclad', hp: 0, max_hp: 80}}}),
  ].join('\n');
  const store = createStore('2026-09-28T00:00:00.000Z');
  const result = ingestLog(store, log);
  assert.equal(result.runs, 1);
  assert.equal(store.runs.length, 1);
  // Two separate Fuzzy Wurm Crawler fights, not one - keying by enemy alone would average them together.
  assert.equal(store.encounters['monster:Fuzzy Wurm Crawler'].seen, 2);
  assert.equal(store.encounters['monster:Fuzzy Wurm Crawler'].wins, 2);
  const fatal = store.encounters['elite:Skulking Colony'] ?? store.encounters['monster:Skulking Colony'];
  assert.equal(fatal.losses, 1, 'the fight the run died in is a loss');
  // The same rule fires on both fights and becomes one lesson with two pieces of evidence.
  const multi = store.lessons.find(l => l.kind === 'multi-hit-killer');
  assert.equal(store.lessons.length, 1, 'one rule, one lesson');
  assert.equal(multi.confirmations, 1, 'both runs hit the same fight, so one evidence record');
  assert.ok(store.stats.runsRecorded === 1);
});

test('the run log parses per run, so two runs dying on the same floor never cross-contaminate', () => {
  const death = t => JSON.stringify({time: t, kind: 'run_end', state: {state_type: 'game_over', run: {act: 1, floor: 14, ascension: 10}, player: {character: 'The Ironclad', hp: 0, max_hp: 85}}});
  const decision = t => JSON.stringify({time: t, kind: 'decision', state: {state_type: 'monster', run: {act: 1, floor: 14}, battle: {enemies: [{name: 'Inklet'}]}}});
  // The corpus really does contain two deaths on act 1 floor 14. A pooled event list would let one run's
  // lesson be evidenced by the other run's fight.
  const {runs, summaries} = parseRunLog([decision('a'), death('b'), decision('c'), death('d'), 'not json\n'].join('\n'));
  assert.equal(runs.length, 2);
  assert.equal(summaries.length, 2);
  assert.equal(runs[0].events.length, 1);
  assert.equal(runs[1].events.length, 1);
  assert.notEqual(runs[0].summary.runId, runs[1].summary.runId);
  assert.equal(summaries[0].result, 'death');
  assert.equal(summaries[0].hpLost, 85);
  assert.equal(summaries[0].deathEncounter, 'Inklet');
  // extractLessons on a run with no combat events refuses rather than reaching for another run's.
  assert.deepEqual(extractLessons(runs[1].summary, runs[1].events).lessons, []);
  assert.equal(parseRunLog('').summaries.length, 0);
});

test('pruning caps the payload and names every casualty', () => {
  const store = createStore('2026-09-28T00:00:00.000Z');
  for (let i = 0; i < 5; i++) recordRun(store, {runId: `r${i}`, finalFloor: i});
  const lessons = [
    ['Fought the whole fight with no survival estimate.', 0.2],
    ['Died against a multi-hit intent.', 0.45],
    ['Died to an enemy the forecaster could not model.', 0.7],
    ['Ended a turn the planner marked as lethal.', 0.95],
  ];
  for (const [text, confidence] of lessons) addLesson(store, at({text, confidence, evidence: evidence({runId: `r${text.length}`}), context: {act: 1, floor: 12, stateType: 'elite', encounters: []}}));
  for (let i = 0; i < 4; i++) recordEncounter(store, `elite:E${i}`, {win: true});
  const {dropped} = pruneStore(store, {maxRuns: 2, maxLessons: 2, maxEncounters: 2});
  assert.deepEqual(dropped.runs, ['r0', 'r1', 'r2'], 'the oldest runs go first');
  assert.equal(dropped.lessons.length, 2);
  assert.equal(store.runs.length, 2);
  assert.equal(store.lessons.length, 2);
  assert.equal(Object.keys(store.encounters).length, 2);
  // The best-evidenced lessons are the ones kept.
  assert.ok(store.lessons.every(l => l.confidence >= 0.25), `kept a weak lesson: ${store.lessons.map(l => l.confidence)}`);
  const view = summarizeStore(store, {maxLessons: 1});
  assert.equal(view.top.length, 1);
  assert.equal(view.omitted, 1);
  assert.match(view.note, /no evidence is never stored/);
});
