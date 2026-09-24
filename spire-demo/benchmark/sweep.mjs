// Parameter sweep: latency against decision quality, on fixed fixtures.
//
// Read-only replay. It never touches the game bridge and never executes an
// action, so a config can be scored without playing a run.
//
// Quality comes from benchmark/suite.mjs and fresh-suite.mjs, which grade the
// chosen FIRST ACTION against a known error for that fixture (do not play
// Hemokinesis at 1 HP, and so on). Their own wording: "Narrow first-action
// error check; not optimality or win probability." Ten scored fixtures exist, so
// this detects a config that got dumber. It cannot show one that plays better.
// Repeats exist because Jev is not deterministic: a config that fails one run in
// five is worse than one that never fails, and a single pass hides that.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cases, grade } from './suite.mjs';
import { freshCases, gradeFresh } from './fresh-suite.mjs';
import { decisionCandidates } from '../planner.mjs';
import { encounterMemory } from '../encounters.mjs';
import { factoredDeliberate } from '../factored.mjs';
import { hedged } from '../hedge.mjs';

const EQUAL = { move: 1 / 3, safe: 1 / 3, progress: 1 / 3, waste: 1 / 3 };
const NO_WASTE = { move: 1 / 3, safe: 1 / 3, progress: 1 / 3, waste: 0 };
const VETO = { move: 0.25, safe: 0.25, progress: 0.25, waste: 1 };

// Each entry changes ONE thing against `default`, so a difference can be
// attributed. The waste variants answer the quality question, the delay and
// attempt variants answer the latency question.
export const CONFIGS = [
  { name: 'default',        delayMs: 900, maxAttempts: 3, maxFactored: 28, weights: EQUAL },
  { name: 'no-waste',       delayMs: 900, maxAttempts: 3, maxFactored: 28, weights: NO_WASTE },
  { name: 'waste-veto',     delayMs: 900, maxAttempts: 3, maxFactored: 28, weights: VETO },
  { name: 'delay-500',      delayMs: 500, maxAttempts: 3, maxFactored: 28, weights: EQUAL },
  { name: 'delay-250',      delayMs: 250, maxAttempts: 3, maxFactored: 28, weights: EQUAL },
  { name: 'delay-250-x5',   delayMs: 250, maxAttempts: 5, maxFactored: 28, weights: EQUAL },
  { name: 'delay-400-x4',   delayMs: 400, maxAttempts: 4, maxFactored: 28, weights: EQUAL },
  { name: 'no-hedge',       delayMs: 900, maxAttempts: 1, maxFactored: 28, weights: EQUAL },
  { name: 'factors-12',     delayMs: 250, maxAttempts: 3, maxFactored: 12, weights: EQUAL },
  { name: 'move-heavy',     delayMs: 250, maxAttempts: 3, maxFactored: 28, weights: { move: 0.6, safe: 0.15, progress: 0.15, waste: 0.4 } },
  { name: 'veto-prog',      delayMs: 900, maxAttempts: 3, maxFactored: 28, weights: { move: 0.25, safe: 0.25, progress: 0.5, waste: 1 } },
  { name: 'veto-soft',      delayMs: 900, maxAttempts: 3, maxFactored: 28, weights: { move: 0.25, safe: 0.25, progress: 0.25, waste: 0.7 } },
  { name: 'progress-heavy', delayMs: 250, maxAttempts: 3, maxFactored: 28, weights: { move: 0.15, safe: 0.15, progress: 0.6, waste: 0.4 } },
];

const repeats = Number(process.argv.find(a => a.startsWith('--repeats='))?.split('=')[1] ?? 3);
const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]?.split(',');
const SPEND_CAP = Number(process.argv.find(a => a.startsWith('--cap='))?.split('=')[1] ?? 5);

const config = await readFile(new URL('../../.private/typesafe.cfg', import.meta.url), 'utf8').catch(() => '');
const key = process.env.OPENROUTER_API_KEY ?? config.match(/^api_key\s*=\s*"?([^"\r\n]+)"?/m)?.[1]?.trim();
if (!key) throw new Error('Missing OPENROUTER_API_KEY');

const scored = [...cases.filter(c => c.check), ...freshCases.filter(c => c.check)];
let spend = 0;

async function runOne(cfg, test) {
  const raw = await readFile(new URL('../fixtures/' + test.fixture + '.json', import.meta.url), 'utf8');
  const fixture = JSON.parse(raw);
  const state = fixture.state;
  const candidates = decisionCandidates(state);
  const recent = encounterMemory(state, fixture.history ?? []);
  let attempts = 0, cost = 0;
  const started = Date.now();
  const ask = payload => hedged(async signal => {
    attempts++;
    const r = await fetch('https://openrouter.ai/api/alpha/decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const json = await r.json();
    cost += json.usage?.cost ?? 0;
    return json;
  }, { delayMs: cfg.delayMs, maxAttempts: cfg.maxAttempts });

  try {
    const result = await factoredDeliberate({ state, candidates, ask, weights: cfg.weights, maxFactored: cfg.maxFactored });
    const chosen = candidates.find(c => c.id === result.answers?.move?.choice);
    if (!chosen) throw new Error('Invalid choice');
    const g = (test.fixture.startsWith('fresh-') ? gradeFresh : grade)(test, chosen);
    return { config: cfg.name, fixture: test.fixture, ms: Date.now() - started, attempts, cost,
      status: g.status, label: chosen.label, candidates: candidates.length };
  } catch (e) {
    return { config: cfg.name, fixture: test.fixture, ms: Date.now() - started, attempts, cost, status: 'error', error: e.message };
  } finally {
    spend += cost;
  }
}

const pct = (v, p) => v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : null;
const rows = [];
const chosen = CONFIGS.filter(c => !only || only.includes(c.name));

for (const cfg of chosen) {
  for (let r = 0; r < repeats; r++) {
    for (const test of scored) {
      if (spend > SPEND_CAP) throw new Error(`Spend cap $${SPEND_CAP} reached at $${spend.toFixed(4)}`);
      const row = await runOne(cfg, test);
      rows.push({ ...row, repeat: r });
      process.stdout.write(`${row.status === 'pass' ? '.' : row.status === 'fail' ? 'F' : 'E'}`);
    }
  }
  const mine = rows.filter(x => x.config === cfg.name);
  const lat = mine.map(x => x.ms).sort((a, b) => a - b);
  console.log(`\n${cfg.name.padEnd(15)} n=${mine.length} p50=${pct(lat, 0.5)} p90=${pct(lat, 0.9)} max=${lat.at(-1)} ` +
    `pass=${mine.filter(x => x.status === 'pass').length}/${mine.length} ` +
    `err=${mine.filter(x => x.status === 'error').length} ` +
    `attempts=${(mine.reduce((s, x) => s + x.attempts, 0) / mine.length).toFixed(2)} ` +
    `cost=$${mine.reduce((s, x) => s + x.cost, 0).toFixed(4)}`);
}

const summary = chosen.map(cfg => {
  const mine = rows.filter(x => x.config === cfg.name);
  const lat = mine.map(x => x.ms).sort((a, b) => a - b);
  return { ...cfg, n: mine.length, p50: pct(lat, 0.5), p90: pct(lat, 0.9), max: lat.at(-1),
    pass: mine.filter(x => x.status === 'pass').length,
    fail: mine.filter(x => x.status === 'fail').length,
    errors: mine.filter(x => x.status === 'error').length,
    meanAttempts: Number((mine.reduce((s, x) => s + x.attempts, 0) / mine.length).toFixed(2)),
    cost: Number(mine.reduce((s, x) => s + x.cost, 0).toFixed(5)) };
});

const out = new URL('../../.private/', import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL('sweep-results.json', out), JSON.stringify({
  generatedAt: new Date().toISOString(), repeats, scoredFixtures: scored.length,
  qualityScope: 'Narrow first-action error check on 10 fixtures; not optimality or win probability.',
  summary, rows }, null, 2));
console.log(`\nSaved .private/sweep-results.json  total spend $${spend.toFixed(4)}`);
