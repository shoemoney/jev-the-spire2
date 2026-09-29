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

// Every module a person (or a cron job, or a fresh clone) can be told to run, and therefore every module
// that has to exist in the committed tree or the documented command is a lie.
//
// The list is not maintained by hand. It is derived from the entrypoints below PLUS every `spire-demo/…
// .mjs` path named in a package.json script, and a separate test fails if a script target is ever added
// without walking its graph. That gap was live: `npm run report` and `npm run benchmark:dry` were
// documented, wired to report.mjs and benchmark/run.mjs, and covered by no entrypoint at all, so
// benchmark/run.mjs reached the tree through nothing. A hand-written list cannot catch the next script
// someone adds; a derived one can, and that is the whole reason this file exists rather than a `ls`.
const HAND_PICKED = [
  'spire-demo/server.mjs',            // npm start, and the thing every other decision path hangs off
  'spire-demo/replay/report.mjs',     // offline grading report
  'spire-demo/learning/attribute.mjs',// outcome attribution CLI; now also reached via fit-weights below
  'spire-demo/learning/fit-weights.mjs', // weight fitter CLI; imports attribute.mjs, so that file is live
];

/**
 * Every concrete `spire-demo/….mjs` path a package.json script names, from every script.
 *
 * Globs are excluded deliberately: `npm test` names `spire-demo/**\/*.test.mjs`, which is a pattern over
 * test files rather than one module, and treating it as an entrypoint would either fail on the literal
 * path or, worse, "pass" by walking nothing. A pattern's real coverage is asserted by a different test
 * below, which checks it against the actual file list.
 */
function scriptTargets() {
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};
  const targets = new Set();
  for (const command of Object.values(scripts)) {
    for (const match of String(command).matchAll(/spire-demo\/[\w./-]*\.mjs/g)) {
      if (!/[*?]/.test(match[0])) targets.add(match[0]);
    }
  }
  return [...targets].sort();
}

const ENTRYPOINTS = [...new Set([...HAND_PICKED, ...scriptTargets()])].sort();

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

test('every module a package.json script runs is walked by the entrypoint check above', {skip: inRepo() ? false : 'not a git repository'}, () => {
  // The half of the guarantee that does not exist without this test. ENTRYPOINTS is derived from the
  // scripts, so today this passes by construction - which is exactly why it needs a test: the derivation
  // is the thing that has to keep holding, and `npm run report` / `npm run benchmark:dry` were outside
  // the list until it was derived rather than typed. The day someone writes `node spire-demo/whatever.mjs`
  // into a script, this file starts walking whatever.mjs's import graph on the next run, with no edit here.
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts ?? {};
  const derived = scriptTargets();
  assert.ok(derived.length >= 2, `expected the scripts to name at least a couple of modules, found ${derived.length}`);
  // Assert the derivation is actually wired up rather than accidentally self-satisfying: the set the
  // other tests walk has to be a superset of what the scripts name.
  for (const target of derived) {
    assert.ok(ENTRYPOINTS.includes(target), `${target} is named by a package.json script but is not in ENTRYPOINTS`);
    assert.ok(existsSync(join(root, target)), `${target} is named by a package.json script but does not exist on disk`);
  }
  // And the specific gap that prompted the derivation, named so it cannot be quietly removed again.
  assert.ok(derived.includes('spire-demo/report.mjs'), 'npm run report must be covered');
  assert.ok(derived.includes('spire-demo/benchmark/run.mjs'), 'npm run benchmark:dry must be covered');
  assert.ok(scripts.report && scripts['benchmark:dry'], 'the scripts this test exists for have been renamed; update it');
});

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
