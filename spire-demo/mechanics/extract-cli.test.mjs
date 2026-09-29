// Provenance of the generated file: the header must describe the corpus it sits on, and the generator must
// fail usefully when the private log is gone. knowledge.mjs is generated, so the strongest claim available
// without the log is that render() on the committed data reproduces the committed bytes exactly.
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, copyFileSync, mkdtempSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {render, resolveLogPath, missingLogMessage, SAMPLE_LOG} from './extract.mjs';
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
function runCliWriting(args = []) {
  const dir = mkdtempSync(join(process.env.TMPDIR ?? '/tmp', 'extract-cli-'));
  copyFileSync(GENERATOR, join(dir, 'extract.mjs'));
  const r = spawnSync(process.execPath, [join(dir, 'extract.mjs'), ...args], {encoding: 'utf8', env: {...process.env, SPIRE_RUN_LOG: ''}});
  return {...r, written: () => readFileSync(join(dir, 'knowledge.mjs'), 'utf8')};
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

test('with no log available the generator names SPIRE_RUN_LOG instead of throwing ENOENT', () => {
  const r = runCli();
  assert.equal(r.status, 1);
  assert.match(r.stderr, /SPIRE_RUN_LOG/);
  assert.match(r.stderr, /No run log at/);
  assert.match(r.stderr, /spire-demo\/mechanics\/sample-run\.json/, 'points at the smoke-test fixture');
  assert.ok(!/ENOENT/.test(r.stderr), 'no raw stack trace leaked');
  assert.equal(r.stdout, '', 'nothing was written');
});

test('resolveLogPath prefers argv, then SPIRE_RUN_LOG, then the pinned default', () => {
  assert.equal(resolveLogPath('/tmp/a.jsonl'), '/tmp/a.jsonl');
  assert.equal(resolveLogPath(), join(REPO, '.private/spire-runs/2026-09-23T20-41-11.451Z.jsonl'));
  assert.match(missingLogMessage(join(REPO, 'nope.jsonl')), /nope\.jsonl/);
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
