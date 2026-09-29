// node spire-demo/replay/report.mjs [path-to-jsonl]
// Reads a recorded run log and prints the offline metrics. No network, ever.
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { summarizeRun, blindness, hpLossCalibration, fatalDecisions, classifyWarning } from './metrics.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = resolve(here, '../../.private/spire-runs');
const DEFAULT_NAME = '2026-09-23T20-41-11.451Z.jsonl';

const die = (msg, hint) => { console.error(`error: ${msg}${hint ? `\n  ${hint}` : ''}`); process.exit(1); };
// Unknown is rendered, never silently rounded to 0.
const n = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : 'unknown');
const hp = v => (typeof v === 'number' && Number.isFinite(v) ? `${v} hp` : 'unknown');
const pct = (a, b) => (a == null || b ? null : `${(a * 100).toFixed(1)}%`);
const f = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : 'unknown');
const row = cells => cells.map(c => String(c ?? '—').padEnd(14)).join('').trimEnd();

async function resolveTarget(arg) {
  if (arg) return resolve(arg);
  try {
    const names = (await readdir(RUNS_DIR)).filter(x => x.endsWith('.jsonl')).sort();
    if (names.includes(DEFAULT_NAME)) return resolve(RUNS_DIR, DEFAULT_NAME);
    if (!names.length) die(`no .jsonl run logs in ${RUNS_DIR}`, 'start the demo to record one, or pass a path: node spire-demo/replay/report.mjs <file>');
    return resolve(RUNS_DIR, names.at(-1));
  } catch (e) {
    die(`could not list ${RUNS_DIR} (${e.code ?? e.message})`, 'pass a path: node spire-demo/replay/report.mjs <file>');
  }
}

function parse(text, path) {
  const events = [];
  const lines = text.split('\n');
  let bad = 0;
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    try { events.push(JSON.parse(raw)); }
    catch (e) { bad += 1; if (bad <= 3) console.error(`  ! line ${i + 1} is not valid JSON, skipped (${e.message})`); }
  });
  if (bad > 3) console.error(`  ! ${bad} unparseable lines skipped in total`);
  if (!events.some(e => e?.kind === 'decision')) die(`${path} holds no decision records`, 'is this the right file? a run log starts with {"kind":"decision",...}');
  return { events, totalLines: lines.filter(l => l.trim()).length, bad };
}

function runsSection(summary) {
  console.log('\nRUNS');
  if (summary.runCount === 1) {
    const r = summary;
    console.log(`  1 run  outcome=${r.outcome}  reached A${n(r.finalAct)}F${n(r.finalFloor)}  ascension ${n(r.ascension)}`);
    console.log(`  rooms visited ${n(r.roomsVisited)}  floors seen ${n(r.floorsVisited)}  decisions ${n(r.decisions)} (${n(r.combatDecisions)} combat)`);
    console.log(`  hp ${n(r.hpStart)} -> ${n(r.hpEnd)}   total hp lost ${r.hpLost == null ? 'unknown' : n(r.hpLost)}`);
    return;
  }
  console.log(`  this file holds ${summary.runCount} consecutive runs (a run_end closes each one)`);
  console.log(`  ${row(['run', 'outcome', 'act', 'floor', 'ascension', 'rooms', 'decisions', 'combat', 'hp start', 'hp end', 'hp lost'])}`);
  summary.runs.forEach((r, i) => {
    console.log(`  ${row([i + 1, r.outcome, n(r.finalAct), n(r.finalFloor), n(r.ascension), n(r.roomsVisited), n(r.decisions), n(r.combatDecisions), n(r.hpStart), n(r.hpEnd), r.hpLost ?? 'unknown'])}`);
  });
  for (const r of summary.runs) for (const d of r.deathsByFloor) console.log(`  death recorded at A${n(d.floor)} (${d.state_type}) with ${hp(d.hp)}`);
  console.log(`  final run: reached A${n(summary.finalAct)}F${n(summary.finalFloor)}, ${n(summary.decisions)} decisions`);
}

function blindnessSection(b) {
  console.log('\nBLINDNESS — how often the agent had no usable forecast in combat');
  console.log(`  combat decisions            ${n(b.combatDecisions)}`);
  console.log(`  unknown forecast            ${n(b.unknown)}  (${pct(b.unknownRate) ?? 'n/a'})`);
  console.log(`  partial forecast            ${n(b.partial)}`);
  console.log(`  calculated forecast         ${n(b.calculated)}`);
  if (b.qualityUnreported) console.log(`  quality not reported        ${n(b.qualityUnreported)}`);
  console.log('  why the forecast was unknown (a decision can carry several causes):');
  for (const [cause, count] of Object.entries(b.byCause)) console.log(`    ${cause.padEnd(18)}${String(count).padStart(5)}`);
  console.log(`    ${'-> attributions'.padEnd(18)}${String(b.causeTotal).padStart(5)} across ${b.unknown} decisions${b.byCauseOverlaps ? ' (causes overlap; not a partition)' : ''}`);
  console.log(`  unexplained unknowns        ${n(b.unexplained)}  (no recognised cause)`);
  if (b.unmatchedWarnings) console.log(`  warnings matching no bucket ${n(b.unmatchedWarnings)}`);
  if (b.calculated === 0 && b.combatDecisions > 0) console.log('  note: this run never emitted an uncaveated combat forecast, so there is no "confident" tier to judge.');
}

function calibrationSection(c) {
  const t = c.turn, s = c.step;
  console.log('\nHP-LOSS CALIBRATION — predicted hp loss vs what actually happened');
  console.log('  scope "turn": the log\'s own forecast.assumption says the number covers the played prefix PLUS ending');
  console.log('  the turn, so the actual is measured at the first decision of the next turn in the same room.');
  console.log(`  numeric predictions         ${n(t.numericPredictions)}`);
  console.log(`  unknown (null) predictions  ${n(t.unknownPredictions)}   <- admitted ignorance, not scored, never counted as wrong`);
  console.log(`  no actual available         ${n(t.unresolvableActual)}   (room ended or the turn never closed)`);
  console.log(`  scored                      ${n(t.scored)}`);
  console.log(`  exact                       ${n(t.exact)}   (${pct(t.scored ? t.exact / t.scored : null) ?? 'n/a'})`);
  console.log(`  wrong                       ${n(t.wrong)}   (${pct(t.scored ? t.wrong / t.scored : null) ?? 'n/a'})`);
  console.log(`  mean absolute error         ${f(t.meanAbsoluteError)} hp`);
  console.log(`  mean signed error           ${f(t.meanSignedError)} hp   (negative = forecast predicted more damage than landed)`);
  console.log('  by declared forecast quality:');
  const quals = Object.entries(t.byQuality);
  if (!quals.length) console.log('    no scored forecast declared a quality');
  for (const [q, v] of quals) console.log(`    ${q.padEnd(12)}scored ${String(v.scored).padStart(4)}  exact ${String(v.exact).padStart(4)}  WRONG ${String(v.wrong).padStart(4)}`);
  console.log(`  uncaveated "calculated" forecasts that proved wrong: ${n(c.calculatedWrong)}`);
  console.log('  by predicted magnitude:');
  console.log(`    ${row(['bucket', 'count', 'exact', 'wrong', 'mean pred', 'mean actual', 'mae'])}`);
  for (const b of t.buckets) console.log(`    ${row([b.label, b.count, b.exact, b.wrong, f(b.predicted), f(b.actual), f(b.meanAbsoluteError)])}`);
  if (t.errors.length) {
    console.log('  the wrong forecasts, ranked by size:');
    const worst = [...t.errors].sort((a, b) => b.absError - a.absError).slice(0, 5);
    for (const e of worst) console.log(`    A${e.act}F${e.floor}  predicted ${e.predicted}  actual ${e.actual}  [${e.quality ?? 'quality unknown'}] ${e.warnings[0] ?? 'no warning recorded'}`);
    const causes = {};
    for (const e of t.errors) for (const w of e.warnings) { const k = classifyWarning(w); causes[k] = (causes[k] ?? 0) + 1; }
    console.log(`  warnings attached to wrong forecasts: ${Object.entries(causes).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  }
  console.log('  for contrast, the other reading of "actual" (this decision -> the very next decision, ignoring turn end):');
  console.log(`    scored ${n(s.scored)}  exact ${n(s.exact)}  wrong ${n(s.wrong)}  mean absolute error ${f(s.meanAbsoluteError)} hp`);
  console.log('    that scope disagrees with the forecast\'s stated meaning, so it is reported, not trusted.');
}

function fatalSection(deaths) {
  console.log(`\nFATAL DECISIONS — the last decisions before each death`);
  if (!deaths.length) { console.log('  no run_end in this log, so no death window to inspect'); return; }
  for (const d of deaths) {
    console.log(`\n  death at A${n(d.act)}F${n(d.floor)} (ascension ${n(d.ascension)}), hp at death: ${n(d.hpAtDeath)}`);
    console.log(`    last ${d.decisions.length} decisions: ${d.unknown} unknown, ${d.partial} partial, ${d.calculated} calculated, ${d.unreported} no quality`);
    console.log(`    preceded by an unknown forecast: ${d.anyUnknown ? 'YES' : 'no'}   low-confidence (unknown or partial): ${d.anyLowConfidence ? 'YES' : 'no'}`);
    console.log(`    ${row(['room', 'hp', 'blk', 'nrg', 'quality', 'pred loss', 'survives', 'action'])}`);
    for (const x of d.decisions) {
      console.log(`    ${row([x.room ?? x.state_type, x.hp ?? '—', x.block ?? '—', x.energy ?? '—', x.quality ?? 'none', x.predictedHpLoss ?? 'unknown', x.predictedSurvives ?? 'unknown', x.action])}`);
    }
    const causes = new Set();
    for (const x of d.decisions) for (const w of x.warnings) causes.add(classifyWarning(w));
    if (causes.size) console.log(`    causes named in that window: ${[...causes].join(', ')}`);
  }
}

const path = await resolveTarget(process.argv[2]);
let text;
try { text = await readFile(path, 'utf8'); }
catch (e) { die(`cannot read ${path} (${e.code ?? e.message})`, 'check the path, or run with no argument to use the default run log'); }

console.log('JEV THE SPIRE 2 — OFFLINE REPLAY REPORT');
console.log(`source  ${path}`);
const { events, totalLines, bad } = parse(text, path);
const kinds = {};
for (const e of events) kinds[e.kind ?? 'unknown'] = (kinds[e.kind ?? 'unknown'] ?? 0) + 1;
console.log(`parsed  ${totalLines} non-empty lines -> ${Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(', ')}${bad ? ` (${bad} skipped)` : ''}`);
console.log('offline: no network calls were made.');

const summary = summarizeRun(events);
runsSection(summary);
blindnessSection(blindness(events));
calibrationSection(hpLossCalibration(events));
fatalSection(fatalDecisions(events));
console.log('');
