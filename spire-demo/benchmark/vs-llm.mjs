// Jev against a frontier LLM on the same decisions.
//
// Same fixtures, same state, same candidate list, same grader. The only thing
// that differs is what answers the question:
//
//   jev    one /api/alpha/decisions request carrying a choice plus three nouls
//          per candidate, all evaluated in parallel, combined in our code
//   llm    one chat-completions request that must emit a candidate id as JSON,
//          which we then parse
//
// The LLM gets its best case: no reasoning preamble demanded, a tight token
// cap, and the same pre-computed forecasts Jev sees. Parse failures are counted
// rather than retried, because avoiding them is the entire pitch for a decision
// primitive over a text generator.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { cases, grade } from './suite.mjs';
import { freshCases, gradeFresh } from './fresh-suite.mjs';
import { decisionCandidates, decisionQuestion } from '../planner.mjs';
import { encounterMemory } from '../encounters.mjs';
import { factoredDeliberate } from '../factored.mjs';
import { hedged } from '../hedge.mjs';

const MODELS = (process.argv.find(a => a.startsWith('--models='))?.split('=')[1]
  ?? 'anthropic/claude-fable-5.1').split(',');
let LLM_MODEL = MODELS[0];
const repeats = Number(process.argv.find(a => a.startsWith('--repeats='))?.split('=')[1] ?? 5);
const REASONING = process.argv.includes('--reasoning');
const key = process.env.OPENROUTER_API_KEY;
if (!key) throw new Error('Missing OPENROUTER_API_KEY');

const scored = [...cases.filter(c => c.check), ...freshCases.filter(c => c.check)];
const post = (path, body, signal) => fetch('https://openrouter.ai/api/' + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify(body), signal: signal ?? AbortSignal.timeout(240000),
});

async function runJev(state, candidates) {
  let attempts = 0, cost = 0;
  const ask = payload => hedged(async signal => {
    attempts++;
    const r = await post('alpha/decisions', payload, AbortSignal.any([signal, AbortSignal.timeout(45000)]));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    cost += j.usage?.cost ?? 0;
    return j;
  });
  const result = await factoredDeliberate({ state, candidates, ask });
  return { id: result.answers?.move?.choice, attempts, cost, parsed: true };
}

async function runLlm(state, candidates) {
  // Identical information to what Jev receives: the same trimmed state and the
  // same per-candidate forecast blobs, straight off decisionQuestion.
  const q = decisionQuestion(state, candidates);
  const prompt = `You are choosing the next action in Slay the Spire 2.

STATE:
${JSON.stringify(q.state).slice(0, 24000)}

CANDIDATES (id: details):
${Object.entries(q.questions.move.criteria).map(([id, d]) => `${id}: ${d}`).join('\n').slice(0, 16000)}

${q.questions.move.instructions}

Reply with ONLY minified JSON: {"choice":"<candidate id>"}. No prose, no markdown fence.`;
  // Fable 5.1 refuses `reasoning: {enabled:false}` outright: "Reasoning is
  // mandatory for this endpoint and cannot be disabled." effort:'low' is the
  // fastest it will go and returns 0 reasoning tokens. An earlier run here used
  // max_tokens 64 and scored 2/10, but that was this harness starving the answer
  // of budget, not the model failing.
  const r = await post('v1/chat/completions', {
    model: LLM_MODEL, max_tokens: 24000, temperature: 0,
    reasoning: { effort: REASONING ? 'high' : 'low' },
    messages: [{ role: 'user', content: prompt }],
  });

  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  const text = j.choices?.[0]?.message?.content ?? '';
  const cost = j.usage?.cost ?? 0;
  // Empty content almost always means the budget went to reasoning, not that the
  // model failed to answer. Record the evidence so a parse-failure rate can be
  // audited instead of believed.
  const finish = j.choices?.[0]?.finish_reason;
  const reasoningTokens = j.usage?.completion_tokens_details?.reasoning_tokens;
  // The fence-stripping regex Jev exists to delete. Kept so a parse failure is
  // counted honestly rather than papered over with a retry.
  const m = text.replace(/```json|```/g, '').match(/\{[^{}]*"choice"[^{}]*\}/);
  let id = null, parsed = false;
  try { id = JSON.parse(m?.[0] ?? '').choice; parsed = typeof id === 'string'; } catch {}
  return { id, attempts: 1, cost, parsed, raw: text.slice(0, 120), finish, reasoningTokens };
}

const rows = [];
for (let r = 0; r < repeats; r++) {
  for (const test of scored) {
    const raw = await readFile(new URL('../fixtures/' + test.fixture + '.json', import.meta.url), 'utf8');
    const fixture = JSON.parse(raw);
    const state = fixture.state;
    const candidates = decisionCandidates(state);
    const arms = [['jev', runJev], ...MODELS.map(m => [m, (st, ca) => { LLM_MODEL = m; return runLlm(st, ca); }])];
    for (const [policy, fn] of arms) {
      const started = Date.now();
      let row = { policy, model: policy === 'jev' ? 'typesafe/jev-1.13' : policy, fixture: test.fixture, repeat: r };
      try {
        const out = await fn(state, candidates);
        const chosen = candidates.find(c => c.id === out.id);
        row = { ...row, ms: Date.now() - started, cost: out.cost, attempts: out.attempts, parsed: out.parsed,
          finish: out.finish, reasoningTokens: out.reasoningTokens,
          status: !out.parsed ? 'parse-fail' : !chosen ? 'invalid-id'
            : (test.fixture.startsWith('fresh-') ? gradeFresh : grade)(test, chosen).status,
          label: chosen?.label, raw: out.raw };
      } catch (e) {
        row = { ...row, ms: Date.now() - started, cost: 0, attempts: 1, status: 'error', error: e.message };
      }
      rows.push(row);
      process.stdout.write(row.status === 'pass' ? '.' : row.status === 'fail' ? 'F' : '!');
    }
  }
}

const pct = (v, p) => { v = [...v].sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(v.length * p))]; };
console.log('\n');
const summary = ['jev', ...MODELS].map(p => {
  const mine = rows.filter(x => x.policy === p);
  const lat = mine.map(x => x.ms);
  const s = { policy: p, model: mine[0]?.model, n: mine.length,
    pass: mine.filter(x => x.status === 'pass').length,
    fail: mine.filter(x => x.status === 'fail').length,
    parseFail: mine.filter(x => x.status === 'parse-fail' || x.status === 'invalid-id').length,
    errors: mine.filter(x => x.status === 'error').length,
    p50: pct(lat, 0.5), p90: pct(lat, 0.9), max: Math.max(...lat),
    cost: Number(mine.reduce((a, x) => a + (x.cost ?? 0), 0).toFixed(5)) };
  console.log(`${p.padEnd(4)} ${String(s.model).padEnd(26)} n=${s.n} pass=${s.pass}/${s.n} p50=${s.p50}ms p90=${s.p90}ms max=${s.max}ms parse-fail=${s.parseFail} err=${s.errors} cost=$${s.cost}`);
  return s;
});
const j = summary[0];
console.log('\n' + 'model'.padEnd(34) + 'score   p50      p90      $/decision  vs-jev-speed');
for (const s2 of summary.sort((a, b) => b.pass - a.pass || a.p50 - b.p50)) {
  console.log(String(s2.policy).padEnd(34) +
    `${s2.pass}/${s2.n}`.padEnd(8) + `${s2.p50}ms`.padEnd(9) + `${s2.p90}ms`.padEnd(9) +
    `$${(s2.cost / s2.n).toFixed(5)}`.padEnd(12) + `${(s2.p50 / j.p50).toFixed(1)}x`);
}

await mkdir(new URL('../../.private/', import.meta.url), { recursive: true });
await writeFile(new URL('../../.private/vs-llm-results.json', import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), llmModel: LLM_MODEL, repeats, summary, rows }, null, 2));
console.log('Saved .private/vs-llm-results.json');
