// META.decisions is a count of DECISIONS. It shipped as 778 for a corpus holding 770: the generator wrote
// lines.length, so every run_end and every error record interleaved into the log was counted as a decision,
// and the number drifted off the file it names the moment the log grew by one more record. The count is also
// printed to the operator, so the wrong number reached a human reading the CLI.
//
// Every expectation below is DERIVED from a fixture, never typed in, because a pinned literal is exactly
// what let the wrong number survive: it only fails if someone hand-edits the number rather than the code.
// The one literal that does appear (the committed capture) is labelled a capture and says why.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {countDecisions, readLogLines, SAMPLE_LOG} from './extract.mjs';
import {META} from './knowledge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const GENERATOR = readFileSync(join(HERE, 'extract.mjs'), 'utf8');
const line = o => JSON.stringify(o);
const decision = extra => line({kind: 'decision', outcome: 'executed', ...extra});
const runEnd = extra => line({kind: 'run_end', ...extra});
const error = extra => line({kind: 'error', ...extra});

test('META.decisions counts only kind:"decision" records - run_end and error are not decisions', () => {
  // The real log's own mix: many decisions, a few of each other kind, all in one file.
  const lines = [decision(), decision(), decision(), runEnd(), runEnd(), runEnd(), error(), error(), error()];
  assert.equal(lines.length, 9, 'the fixture really does hold nine records');
  assert.equal(countDecisions(lines), 3, 'but only three of them are decisions');
  // The shipped bug restated as a test: nine lines, three decisions, and lines.length would answer 9.
  assert.notEqual(countDecisions(lines), lines.length, 'the count is not the line count');
  // Dropping each non-decision kind is the only thing that moves the number, so the exclusion is real rather
  // than the decision count being accidentally right.
  assert.equal(countDecisions(lines.filter(l => !l.includes('run_end'))), 3);
  assert.equal(countDecisions([decision(), runEnd(), error()]), 1);
  assert.equal(countDecisions([]), 0);
});

test('a record with no kind is not a decision, however decision-shaped its payload', () => {
  // This is what the committed fixture looks like on disk, and what real JSONL must keep meaning.
  assert.equal(countDecisions([line({outcome: 'executed', state: {player: {hp: 5}}})]), 0);
  assert.equal(countDecisions([line({outcome: 'executed'}), decision()]), 1);
  // A kind that is present but is not the string "decision" is not a decision either: the predicate is an
  // equality on the exact tag, not "has some kind" and not a case-insensitive match.
  assert.equal(countDecisions([line({kind: 'Decision'}), line({kind: 'decisions'}), line({kind: ''}), line({kind: null})]), 0);
  // A line that will not parse is skipped rather than thrown on: readObservations skips it, so counting it
  // as a decision would make the count depend on parse failures the rest of the pipeline ignores.
  assert.equal(countDecisions(['not json at all', '', '   ', decision()]), 1);
});

test('the committed sample reads as the two-decision fixture its own error message promises', () => {
  // Built on the committed fixture, never on the private log: this has to run in a clean clone.
  const raw = readFileSync(SAMPLE_LOG, 'utf8');
  const lines = readLogLines(raw, SAMPLE_LOG);
  assert.equal(lines.length, 2, 'the fixture holds two records');
  assert.equal(countDecisions(lines), 2, 'and both count as decisions');
  // Why that is true despite the count being strict: the records on disk carry no tag of their own, and the
  // ARRAY form is documented as a list of decisions, so readLogLines - already the one place that normalises
  // format - applies that meaning to an untagged record. Real JSONL gets no such pass.
  for (const r of JSON.parse(raw)) assert.ok(!('kind' in r), 'the fixture records carry no kind on disk');
  // Only records with NO kind are tagged. One that declares itself is left exactly as written, so an array
  // fixture holding a run_end or an error still cannot inflate the count.
  assert.equal(countDecisions(readLogLines('[{"kind":"run_end"},{"outcome":"executed"},{"kind":"error"}]', 'x')), 1);
  // And the untagged-JSONL case the array pass must not leak into.
  assert.equal(countDecisions(readLogLines('{"outcome":"executed"}\n{"kind":"decision"}', 'x')), 1);
  // The count tracks the corpus, not the entities: two decisions still yield a multi-entity corpus, so a
  // number borrowed from KNOWLEDGE would be wrong in the other direction.
  assert.ok(META.names > 0 && META.decisions !== META.names, 'decisions is not an entity count');
});

test('the committed corpus META.decisions is a FROZEN CAPTURE, and it is labelled one', () => {
  // The two options were: re-derive the count from the file META.source names, or declare it a capture. This
  // is a CAPTURE, because META.source is a .jsonl: gitignored, private, and absent from every clone, so no
  // test here can read it and a re-deriving assertion could only ever pass on the machine that wrote it.
  assert.equal(existsSync(join(REPO, META.source)), false, 'the named source is genuinely absent, so this cannot be re-derived offline');
  assert.ok(META.source.endsWith('.jsonl'), 'and it names a jsonl, which is why');
  // 770 is what the real corpus holds: 779 records, of which 5 are run_end and 4 are error. It was verified
  // by regenerating from that log, and the regenerated corpus is byte-identical to the committed one apart
  // from this field - so this literal is a capture of a real derivation, not an aspiration.
  assert.equal(META.decisions, 770);
  // Pinned away from both numbers this bug could have produced, so it cannot silently go back to either.
  assert.notEqual(META.decisions, 778, 'not the old line count of the corpus as generation saw it');
  assert.notEqual(META.decisions, 779, 'not the line count of the corpus as it stands now');
  assert.ok(Number.isInteger(META.decisions) && META.decisions > 0, 'and it is a real count, not a placeholder');
  // Whatever the number is, the corpus it describes is not empty and is self-consistent - so the assertion
  // above is not pinning a number against an otherwise-empty artifact.
  const counted = Object.values(META.counts).reduce((a, b) => a + b, 0);
  assert.ok(counted >= META.names && META.names > 0, 'the capture describes a real corpus');
});

test('the CLI prints the number it stored, so the two cannot drift apart', () => {
  // Asserted on the SOURCE rather than by shelling out: the generator rewrites the committed corpus when it
  // runs, and a test must never be able to write it. What matters is that the printed line reads META and
  // not a second count computed on the spot.
  const printed = GENERATOR.match(/console\.log\(`decisions\s+\$\{([\w.]+)\}`\)/);
  assert.ok(printed, 'the CLI still prints a decisions line');
  assert.equal(printed[1], 'meta.decisions', 'it prints the value it stored');
  // Tested with a boolean rather than assert.match so a failure names the field instead of dumping the whole
  // generator into the report.
  assert.ok(/decisions: countDecisions\(lines\)/.test(GENERATOR), 'META.decisions is the counted value');
});

test('the shipped idiom - decisions: lines.length - does not come back', () => {
  // The regression itself. It shipped as lines.length, which counted run_end and error records as decisions;
  // nothing else in META may fall back to a raw line count either, since every line here is one record read.
  assert.ok(!/decisions:\s*lines\.length/.test(GENERATOR), 'decisions is not a line count');
  const assignments = [...GENERATOR.matchAll(/^\s*(?:source|counts|names|glossary|[a-zA-Z]+):\s*lines\.length\b/gm)];
  assert.deepEqual(assignments.map(m => m[0].trim()), [], 'no META field is a raw line count');
});
