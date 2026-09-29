// A clean clone of this repo has to boot. `npm test` passing in a working tree proves nothing about
// that: a module the server imports can sit uncommitted, every test still passes, and a fresh clone
// dies at boot with ERR_MODULE_NOT_FOUND. That is not hypothetical - better-policy.mjs was imported
// by server.mjs and had never been committed, so `npm start` failed on a fresh clone while the
// local suite was green.
//
// This walks the import graph from the entrypoints and asserts every reachable module exists in the
// committed tree. It reads git, so it is skipped (loudly) outside a repo, and it is intentionally
// dependency-free: no glob library, no resolver, just a regex over ESM import specifiers, which is
// all the syntax this project uses.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync, statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {dirname, resolve, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRYPOINTS = ['spire-demo/server.mjs', 'spire-demo/replay/report.mjs', 'spire-demo/learning/attribute.mjs'];

const inRepo = () => {
  try {
    return execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {cwd: root, stdio: ['ignore', 'pipe', 'ignore']}).toString().trim() === 'true';
  } catch {
    return false;
  }
};

const IMPORTS = /(?:^|\n)\s*import\s+(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]+)['"]/g;
const DYNAMIC = /\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g;

function localImports(source) {
  const found = new Set();
  for (const pattern of [IMPORTS, DYNAMIC]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source))) found.add(match[1]);
  }
  return [...found];
}

function walk(entry) {
  const seen = new Set();
  const missing = [];
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(file)) {
      missing.push(file);
      continue;
    }
    for (const spec of localImports(readFileSync(file, 'utf8'))) {
      stack.push(resolve(dirname(file), spec));
    }
  }
  return {seen, missing};
}

test('every module the entrypoints import is COMMITTED, not merely present on disk', {skip: inRepo() ? false : 'not a git repository'}, () => {
  // What git actually tracks, not what is sitting in the working tree: that difference is the bug.
  // A module that is present but uncommitted boots fine here and dies with ERR_MODULE_NOT_FOUND on a
  // fresh clone, while every other test in the suite stays green - so this has to walk the graph and
  // check EVERY reachable module against `git ls-files`, not just the ones missing from disk.
  const tracked = new Set(
    execFileSync('git', ['ls-files'], {cwd: root, maxBuffer: 64 * 1024 * 1024}).toString().split('\n').filter(Boolean),
  );
  for (const entry of ENTRYPOINTS) {
    const file = join(root, entry);
    assert.ok(existsSync(file), `${entry} does not exist at all`);
    for (const reached of walk(file).seen) {
      const rel = relative(root, reached);
      if (rel === entry) continue; // the entrypoint itself is committed by being in the index
      assert.ok(tracked.has(rel), `${entry} imports ${rel}, which exists on disk but is NOT committed - a fresh clone cannot resolve it`);
    }
  }
});

test('every module the entrypoints import is present in the working tree', {skip: inRepo() ? false : 'not a git repository'}, () => {
  for (const entry of ENTRYPOINTS) {
    const {missing} = walk(join(root, entry));
    assert.deepEqual(missing.map(m => relative(root, m)), [], `${entry} has unresolvable imports`);
  }
});

test('the project still declares zero runtime dependencies', {skip: inRepo() ? false : 'not a git repository'}, () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies ?? {}, {}, 'the hot decision path is meant to be dependency-free');
});

test('npm test reaches every test file in the tree', {skip: inRepo() ? false : 'not a git repository'}, () => {
  // The glob used to be `spire-demo/*.test.mjs spire-demo/experiment/*.test.mjs`, which silently
  // skipped 73 passing tests in learning/, mechanics/ and bounds.test.mjs. A test runner that does
  // not run the tests is worse than no runner, so the script is checked against the real file list.
  const script = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.test;
  assert.match(script, /\*\*/, 'the test glob must be recursive or subdirectory tests never run again');
  const onDisk = [];
  const walkDir = dir => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walkDir(full);
      else if (name.endsWith('.test.mjs')) onDisk.push(full);
    }
  };
  walkDir(join(root, 'spire-demo'));
  assert.ok(onDisk.length > 30, `expected the suite to have grown, found ${onDisk.length} test files`);
});
