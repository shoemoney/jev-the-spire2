// Provenance of the generated file: the header must describe the corpus it sits on, and the generator must
// fail usefully when the private log is gone. knowledge.mjs is generated, so the strongest claim available
// without the log is that render() on the committed data reproduces the committed bytes exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, copyFileSync, mkdtempSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {render, resolveLogPath, missingLogMessage, sourceLabel, SAMPLE_LOG} from './extract.mjs';
import {KNOWLEDGE, GLOSSARY, META} from './knowledge.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const GENERATOR = join(HERE, 'extract.mjs');
const committed = readFileSync(join(HERE, 'knowledge.mjs'), 'utf8');
// Line 2 of the generated file is "counts. Every field below ..." - pull the counts back out as an object.
const headerCounts = src => JSON.parse(src.split('\n')[1].replace(/^\/\/\s*/, '').split('. Every field')[0]);

// The real CLI, for the paths that exit before writing anything (the existsSync check precedes the write,
// so a missing log can never touch knowledge.mjs).
function runCli(args = [], env = {}) {
  const r = spawnSync(process.execPath, [GENERATOR, ...args], {
    encoding: 'utf8', env: {...process.env, SPIRE_RUN_LOG: '', ...env},
  });
  return r;
}

// A copy in a temp dir, for the one case that DOES write: knowledge.mjs lands beside the copy, so a smoke
// test can never clobber the committed file.
function runCliWriting(args = [], env = {}) {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'extract-cli-'));
  copyFileSync(GENERATOR, join(dir, 'extract.mjs'));
  const r = spawnSync(process.execPath, [join(dir, 'extract.mjs'), ...args], {encoding: 'utf8', env: {...process.env, SPIRE_RUN_LOG: '', ...env}});
  return {...r, dir, written: () => readFileSync(join(dir, 'knowledge.mjs'), 'utf8')};
}

test('the private corpus is genuinely absent here, so "works without .private" is not a vacuous claim', () => {
  assert.equal(existsSync(join(REPO, '.private')), false);
  assert.equal(existsSync(join(REPO, META.source)), false);
});

test('knowledge.mjs imports and answers with no .private/ present', () => {
  assert.equal(Object.keys(KNOWLEDGE).length, META.names);
  assert.ok(KNOWLEDGE.Bash, 'a real entity is readable');
  assert.ok(GLOSSARY.Block, 'the glossary is readable');
});

test('generated header prints real per-kind counts, never [object Object]', () => {
  assert.ok(!committed.includes('[object Object]'), 'no interpolated Object reached the file');
  assert.equal(headerCounts(committed).card, META.counts.card);
  assert.equal(headerCounts(committed).power, META.counts.power);
});

test('the counts the header describes are the META the module exports', () => {
  assert.deepEqual(headerCounts(committed), META.counts);
  assert.deepEqual(Object.keys(META.counts).sort(), ['card', 'enemy', 'potion', 'power', 'relic']);
  const sum = Object.values(META.counts).reduce((a, b) => a + b, 0);
  assert.ok(sum >= META.names, 'every name is counted under at least one kind');
});

test('the committed file is exactly what the generator emits: render() is a pure function of (data, meta)', () => {
  assert.equal(committed, render({KNOWLEDGE, GLOSSARY}, META));
});

// render() above is fed META, so it proves the BODY and can never notice a bad META.source. sourceLabel() is
// the function that decides what source says, and it is the one that regressed: keying provenance on a
// repo-relative path bakes the reader's home directory into a committed artifact the moment the log is read
// from a sibling checkout, which is exactly how a worktree regenerates. These pin it to the corpus instead.
test('sourceLabel names the corpus, not the checkout it was read from', () => {
  const corpus = '.private/spire-runs/2026-09-23T20-41-11.451Z.jsonl';
  assert.equal(sourceLabel(`/Users/someone/elsewhere/repo/${corpus}`), corpus);
  assert.equal(sourceLabel(`/tmp/nested/deep/repo/${corpus}`), corpus);
  assert.equal(sourceLabel(`/${corpus}`), corpus, 'even a bare absolute path normalises');
  assert.equal(sourceLabel(SAMPLE_LOG), 'spire-demo/mechanics/sample-run.json', 'an in-repo log is repo-relative');
  assert.equal(sourceLabel('/somewhere/else/run-2026.jsonl'), 'run-2026.jsonl', 'an external log keeps no absolute form');
  for (const p of [`/Users/someone/elsewhere/repo/${corpus}`, SAMPLE_LOG, '/somewhere/else/run-2026.jsonl']) {
    assert.ok(!sourceLabel(p).startsWith('/'), `no absolute path reached a committed file: ${p}`);
  }
});

test('META.source is portable, so the committed corpus carries no machine path', () => {
  assert.equal(META.source, '.private/spire-runs/2026-09-23T20-41-11.451Z.jsonl');
  assert.ok(!META.source.startsWith('/'), 'META.source is not an absolute path');
  assert.ok(!META.source.includes('..'), 'META.source has no escape out of the repo');
  assert.ok(!committed.includes('/Users/'), 'no home directory leaked anywhere into the generated file');
  assert.ok(committed.split('\n')[0].includes(META.source), 'the header names the same source META exports');
});

test('SPIRE_RUN_LOG is honoured as the input path, and a run driven by it really writes', () => {
  const r = runCliWriting([], {SPIRE_RUN_LOG: SAMPLE_LOG});
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /sample-run\.json/, 'the summary reports the log it actually read');
  assert.ok(existsSync(join(r.dir, 'knowledge.mjs')), 'a resolved input produces a file');
  const out = r.written();
  assert.ok(out.length > 0, 'and it is not empty');
  assert.match(out, /export const KNOWLEDGE = \{\n {2}"/, 'and it is not truncated to a header');
});

test('with no resolvable input the generator writes NO knowledge.mjs, not an empty one', () => {
  // Run against a temp copy so a regression in the guard cannot destroy the committed corpus. The guard is
  // identical either way, so this measures the same thing at zero blast radius. Checking "not empty" would
  // be the weaker claim: the only correct outcome is that the file is never created.
  for (const args of [[], ['/nope/missing.jsonl']]) {
    const r = runCliWriting(args);
    assert.equal(r.status, 1, `expected a non-zero exit for ${JSON.stringify(args)}`);
    assert.equal(existsSync(join(r.dir, 'knowledge.mjs')), false, 'no knowledge.mjs was created');
    // Exit 1 alone does not prove the guard is there: a bare readFileSync crash also exits 1 and also writes
    // nothing, so this assertion passes against the exact bug it is meant to catch. The refusal has to be the
    // designed one - named, actionable, no stack trace.
    assert.match(r.stderr, /No run log at/, 'the refusal is the generator speaking, not a crash');
    assert.match(r.stderr, /SPIRE_RUN_LOG/, 'and it says how to supply a log');
    assert.ok(!/ENOENT|\.mjs:\d+/.test(r.stderr), 'no raw stack trace leaked');
  }
  // And the committed artifact is untouched by a no-input run in place.
  const before = readFileSync(join(HERE, 'knowledge.mjs'), 'utf8');
  const r = runCli();
  assert.equal(r.status, 1);
  assert.equal(readFileSync(join(HERE, 'knowledge.mjs'), 'utf8'), before, 'committed corpus is byte-stable');
});

test('resolveLogPath prefers argv, then SPIRE_RUN_LOG, then the pinned default', () => {
  assert.equal(resolveLogPath('/tmp/a.jsonl'), '/tmp/a.jsonl');
  assert.equal(resolveLogPath(), join(REPO, '.private/spire-runs/2026-09-23T20-41-11.451Z.jsonl'));
  assert.match(missingLogMessage(join(REPO, 'nope.jsonl')), /nope\.jsonl/);
});

test('with no log available the generator names SPIRE_RUN_LOG instead of throwing ENOENT', () => {
  const r = runCli();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SPIRE_RUN_LOG/);
  assert.match(r.stderr, /No run log at/);
  assert.match(r.stderr, /spire-demo\/mechanics\/sample-run\.json/, 'points at the smoke-test fixture');
  assert.ok(!/ENOENT/.test(r.stderr), 'no raw stack trace leaked');
  assert.equal(r.stdout, '', 'nothing was written');
});

test('a bad path passed either way is reported, not thrown', () => {
  for (const r of [runCli(['/nope/missing.jsonl']), runCli([], {SPIRE_RUN_LOG: '/nope/from-env.jsonl'})]) {
    assert.equal(r.status, 1);
    assert.match(r.stderr, /No run log at/);
  }
});

test('the committed sample drives a full generation, and its header is honest too', () => {
  assert.ok(SAMPLE_LOG.endsWith('.json'), '*.jsonl is gitignored, so the sample ships as .json');
  const before = readFileSync(join(HERE, 'knowledge.mjs'), 'utf8');
  const r = runCliWriting([SAMPLE_LOG]);
  assert.equal(r.status, 0, r.stderr);
  const out = r.written();
  const meta = JSON.parse(out.split('\n')[3].replace('export const META = ', '').replace(/;$/, ''));
  assert.equal(meta.decisions, 2);
  assert.deepEqual(meta.counts, {card: 3, enemy: 2, potion: 1, power: 3, relic: 2});
  assert.ok(!out.includes('[object Object]'));
  assert.deepEqual(headerCounts(out), meta.counts);
  // Two readings of Vulnerable at 2 and 3 stacks collapse into one entry that admits its own variance,
  // which is the shape the committed corpus shows and the private log alone cannot be checked against.
  assert.ok(out.includes('"amountVariedWithInvariantText": true'), 'stacking variance is reported, not guessed');
  assert.equal(readFileSync(join(HERE, 'knowledge.mjs'), 'utf8'), before, 'the smoke test wrote nothing committed');
});
