import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const demo = dirname(fileURLToPath(import.meta.url));
const launcherPath = join(demo, 'Open Jev Companion.command');
const launcher = readFileSync(launcherPath, 'utf8');
const server = readFileSync(join(demo, 'server.mjs'), 'utf8');

// The launcher's defaulting seam, extracted so it can be exercised without starting the game.
// A .command file is a shell script, not a module, so the source of `spire_policy_env` is lifted
// out verbatim and sourced here. If the launcher stops defaulting a flag, this stops seeing it.
function spirePolicyEnv() {
  const body = /spire_policy_env\(\) \{\n([\s\S]*?)\n\}/.exec(launcher);
  assert.ok(body, 'launcher must define spire_policy_env() as the single place flags are defaulted');
  return body[1];
}

// Resolve the launcher's effective env the way the shell does: `${VAR:-1}` yields the existing
// non-empty value, else the default. Passing an already-set SPIRE_RECALL through unchanged is the
// whole point - a contributor's `SPIRE_RECALL=0` must survive, not be re-defaulted to 1.
function effectiveEnv(env = {}) {
  const script = `spire_policy_env() {\n${spirePolicyEnv()}\n}\neval "export \${$(spire_policy_env)}"\nprint -r -- "SPIRE_RECALL=$SPIRE_RECALL SPIRE_BETTER_POLICY=$SPIRE_BETTER_POLICY"`;
  const out = execFileSync('zsh', ['-c', script], {
    env: {PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env},
    encoding: 'utf8',
  });
  const resolved = Object.fromEntries(out.trim().split(/\s+/).map(pair => pair.split(/=(.*)/s)));
  return {recall: resolved.SPIRE_RECALL, better: resolved.SPIRE_BETTER_POLICY};
}

test('the launcher turns recall on by default, so the safety gate is live in the shipped path', () => {
  const {recall} = effectiveEnv();
  assert.equal(recall, '1');
});

test('an explicit SPIRE_RECALL=0 survives defaulting and reaches the server as off', () => {
  const {recall} = effectiveEnv({SPIRE_RECALL: '0'});
  assert.equal(recall, '0');
  // `:-` only substitutes on unset-or-empty, so this is the branch that keeps a contributor's
  // opt-out. An explicit 1 stays 1 too - neither direction is rewritten.
  assert.equal(effectiveEnv({SPIRE_RECALL: '1'}).recall, '1');
  assert.equal(effectiveEnv({SPIRE_RECALL: ''}).recall, '1');
});

test('SPIRE_BETTER_POLICY keeps its own default and stays independently overridable', () => {
  // Regression: recall's default must not have displaced or aliased the existing flag.
  assert.equal(effectiveEnv().better, '1');
  assert.equal(effectiveEnv({SPIRE_BETTER_POLICY: '0'}).better, '0');
  // And turning one off must not disturb the other.
  const off = effectiveEnv({SPIRE_RECALL: '0'});
  assert.deepEqual(off, {recall: '0', better: '1'});
});

test('server.mjs enables a flag only on an exact 1, so the string "0" is off, not truthy', () => {
  // Read the precedence out of the source rather than booting the server: the whole safety story
  // rests on this being `=== '1'` and not a truthiness test, which would read "0" as enabled.
  const flag = /const recallEnabled\s*=\s*process\.env\.SPIRE_RECALL\s*(===|==|!==|!=)\s*(['"])(.*?)\2\s*;/.exec(server);
  assert.ok(flag, 'server.mjs must resolve SPIRE_RECALL from the environment at module scope');
  assert.equal(flag[1], '===', 'must be a strict comparison, or SPIRE_RECALL=0 would enable the gate');
  assert.equal(flag[3], '1');

  // The same shape gates betterDeliberate, so both flags share the precedence being asserted.
  const better = /const betterPolicyEnabled\s*=\s*process\.env\.SPIRE_BETTER_POLICY\s*===?\s*(['"])1\1\s*;/.exec(server);
  assert.ok(better, 'server.mjs must resolve SPIRE_BETTER_POLICY the same strict way');

  // Recorded precedence, and what it means for the flag the launcher now defaults on.
  const enabled = v => v === '1';
  assert.equal(enabled('1'), true);
  assert.equal(enabled('0'), false);
  assert.equal(enabled(''), false);
  assert.equal(enabled(undefined), false);
  assert.equal(enabled('true'), false, 'only the exact string 1 enables it');

  // The gate the recall path routes through, and the chain order that makes recall win over
  // betterDeliberate. Both must exist or the default would silently buy nothing.
  assert.match(server, /recallEnabled\s*\?\s*recallingDeliberate\s*:\s*betterPolicyEnabled\s*\?\s*betterDeliberate/);
  assert.match(launcher, /SPIRE_RECALL/);
});

test('the launcher shell script is syntactically valid', () => {
  // bash -n is the gate; the file is also run by zsh, so both parsers must accept it.
  for (const shell of ['bash', 'zsh']) {
    const args = shell === 'bash' ? ['-n', launcherPath] : ['-n', launcherPath];
    execFileSync(shell, args, {stdio: 'pipe'});
  }
});
