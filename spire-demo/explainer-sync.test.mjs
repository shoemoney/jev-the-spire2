import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const MD = join(DOCS, 'INTERVIEW-EXPLAINER.md');
const DOCX = join(DOCS, 'INTERVIEW-EXPLAINER.docx');
const PDF = join(DOCS, 'INTERVIEW-EXPLAINER.pdf');
const MAX = 1 << 26;

const squash = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

const mdRaw = readFileSync(MD, 'utf8');

const mdUnits = mdRaw
  .replace(/<!--[\s\S]*?-->/g, '')
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'))
  .map(l => l.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
             .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
             .replace(/[`*_]/g, ''))
  .map(l => l.replace(/\s+/g, ' ').trim())
  .filter(l => l.length >= 45)
  .map(squash);

const mdRecordedCount = mdRaw.match(/passes \*\*(\d+) tests\*\*/);

function docxText() {
  const xml = execFileSync('unzip', ['-p', DOCX, 'word/document.xml'],
    {encoding: 'utf8', maxBuffer: MAX});
  return squash(xml.replace(/<[^>]*>/g, ' '));
}

function pdfText() {
  try {
    return squash(execFileSync('pdftotext', [PDF, '-'],
      {encoding: 'utf8', maxBuffer: MAX}));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

const REMOVED = '333 tests';

for (const [label, path, extract] of [
  ['.docx', DOCX, docxText],
  ['.pdf', PDF, pdfText],
]) {
  test(`the exported ${label} still carries the explainer source`, t => {
    assert.ok(existsSync(path), `${path} is missing from the repo`);
    const text = extract();
    if (text === null) {
      t.skip(`${label} text not extracted: pdftotext is not installed on this machine`);
      return;
    }
    assert.ok(mdUnits.length >= 15,
      `only ${mdUnits.length} prose units parsed out of the markdown; the parser regressed`);
    const missing = mdUnits.filter(u => !text.includes(u));
    assert.deepEqual(missing, [],
      `${missing.length} of ${mdUnits.length} passages from ${MD} are absent from ${label} — ` +
      `the binary is stale, regenerate it (see the command at the top of the markdown). ` +
      `First missing: ${missing[0] ? missing[0].slice(0, 90) : 'n/a'}`);
  });

  test(`the ${label} carries the test count the source records`, t => {
    assert.ok(mdRecordedCount,
      'the markdown no longer records a "passes **N tests**" count to check against');
    const text = extract();
    if (text === null) {
      t.skip(`${label} text not extracted: pdftotext is not installed on this machine`);
      return;
    }
    assert.ok(text.includes(squash(`${mdRecordedCount[1]} tests`)),
      `${label} does not carry the "${mdRecordedCount[1]} tests" figure recorded in the markdown — ` +
      `someone edited the count and did not regenerate the binary.`);
  });

  test(`the ${label} does not carry the count the source dropped`, t => {
    const text = extract();
    if (text === null) {
      t.skip(`${label} text not extracted: pdftotext is not installed on this machine`);
      return;
    }
    assert.ok(!text.includes(squash(REMOVED)),
      `${label} still contains "${REMOVED}", a figure the markdown no longer records — ` +
      `it was exported from an older revision of the source.`);
  });
}

test('the recorded figure is a dated reading, not a claim of a fixed suite size', () => {
  const line = mdRaw.split('\n').find(l => /passes \*\*\d+ tests\*\*/.test(l));
  assert.ok(line, 'the recorded-count line is gone from the markdown');
  assert.match(line, /measured on \d{4}-\d{2}-\d{2} with `npm test`/,
    'the recorded count lost its measurement date');
  assert.match(line, /re-run the suite rather than trusting the number recorded here/,
    'the recorded count lost its "re-run rather than trust this" disclaimer');
});
