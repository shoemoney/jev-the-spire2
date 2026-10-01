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
// `widths` overrides the pad for cells that hold variable-length text (a room key, an action
// name, a potion list). Truncating them would be a lie; padding to a floor is not.
const row = (cells, widths = []) => cells.map((c, i) => String(c ?? '—').padEnd(widths[i] ?? 14)).join('').trimEnd();

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
  console.log(`  unknown forecast            ${n(b.unknown)}  (${pct(b.unknownRate) ?? 'n/a'} POOLED — see the split below)`);
  // The pooled rate is not a rate any single difficulty had. Measured across the corpus it is 5.3%
  // against A0 2.9%, A10 10.0% and A3 75.6% — a 26x spread averaged into one figure, so it moves
  // whenever a session's difficulty mix changes and the agent's behaviour has not changed at all.
  // Printing it alone is how the earlier "19.8% blind" reading got quoted.
  const asc = Object.entries(b.unknownRateByAscension ?? {});
  if (asc.length) {
    console.log('  by difficulty — the pooled figure above is none of these:');
    for (const [k, v] of asc.sort((a, z) => String(a[0]).localeCompare(String(z[0]))))
      console.log(`    ${k.padEnd(18)}${n(v.combatDecisions).padStart(8)} combat   ${pct(v.unknownRate) ?? 'n/a'} unknown`);
  }
  console.log(`  partial forecast            ${n(b.partial)}`);
  console.log(`  calculated forecast         ${n(b.calculated)}`);
  if (b.qualityUnreported) console.log(`  quality not reported        ${n(b.qualityUnreported)}`);
  console.log('  why the forecast was unknown — only the planner branches that set "unknown" qualify:');
  for (const [cause, count] of Object.entries(b.byCause)) console.log(`    ${cause.padEnd(18)}${String(count).padStart(5)}`);
  console.log(`    ${'-> attributions'.padEnd(18)}${String(b.causeTotal).padStart(5)} across ${b.unknown} decisions${b.byCauseOverlaps ? ' (causes overlap; not a partition)' : ''}`);
  console.log(`  unexplained unknowns        ${n(b.unexplained)}  (no branch of the log states why)`);
  if (b.unmatchedCauseWarnings) console.log(`  warnings naming no branch    ${n(b.unmatchedCauseWarnings)}`);
  // The warnings that are NOT causes, and why. A warning can only ever make a forecast
  // 'partial', so its presence on an 'unknown' row is coincidence of the same board, not
  // explanation — and a family present on every combat decision explains nothing at all.
  // 'other' is a catch-all, not a condition, so it is reported once below instead of listed here.
  console.log('  attached context, NOT a cause (a warning can only make a forecast "partial"):');
  for (const [kind, count] of Object.entries(b.attachedContext)) {
    if (!count || kind === 'other') continue;
    const on = b.contextOnCombat?.[kind];
    const share = b.combatDecisions ? on === b.combatDecisions : false;
    const note = share
      ? `  <- on ${on}/${b.combatDecisions} combat decisions, i.e. ALWAYS: carries no information, explains nothing`
      : `  <- on ${on ?? 'unknown'}/${b.combatDecisions} combat decisions`;
    console.log(`    ${kind.padEnd(18)}${String(count).padStart(5)}${note}`);
  }
  if (b.constantTrueContext?.length) console.log(`  constant-true context families (useless as causes): ${b.constantTrueContext.join(', ')}`);
  if (b.unmatchedWarnings) console.log(`  warnings matching no context family ${n(b.unmatchedWarnings)}`);
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
  console.log(`  scored                      ${n(t.scored)}   of ${n(t.combatDecisions)} combat decisions (${pct(t.coverage) ?? 'n/a'} coverage)`);
  console.log('  ALL scored rows (published unchanged, so no reader has to take the figure below on trust):');
  console.log(`    exact                     ${n(t.exact)}   (${pct(t.exactRate) ?? 'n/a'})`);
  console.log(`    mean absolute error       ${f(t.meanAbsoluteError)} hp`);
  console.log(`    mean signed error         ${f(t.meanSignedError)} hp   (negative = forecast predicted more damage than landed)`);
  // The headline. Half the corpus is "predicted 0, 0 landed", which agrees whether or not the
  // planner understood the board, so it is excluded here and kept above.
  const nt = t.nonTrivial;
  console.log('  NON-TRIVIAL rows only (dropping the ' + n(nt?.trivialZeros) + ' that predicted 0 and had 0 land):');
  console.log(`    exact                     ${n(nt?.exact)}/${n(nt?.scored)}   (${pct(nt?.exactRate) ?? 'n/a'})`);
  console.log(`    mean absolute error       ${f(nt?.meanAbsoluteError)} hp`);
  // A signed mean nets a safe overestimate against a lethal underestimate. Split them.
  console.log(`  direction of the ${n(t.wrong)} wrong rows (an average cannot show this):`);
  console.log(`    over-predicted            ${n(t.overPredictions)}   predicted MORE than landed`);
  console.log(`    under-predicted           ${n(t.underPredictions)}   predicted LESS than landed`);
  console.log(`    of those, short by >=${n(t.lethalUndershootThreshold)} hp  ${n(t.underPredictionsAtLeast5)}   <- the direction that kills`);
  console.log('  by declared forecast quality:');
  const quals = Object.entries(t.byQuality);
  if (!quals.length) console.log('    no scored forecast declared a quality');
  for (const [q, v] of quals) console.log(`    ${q.padEnd(12)}scored ${String(v.scored).padStart(4)}  exact ${String(v.exact).padStart(4)}  WRONG ${String(v.wrong).padStart(4)}`);
  console.log(`  uncaveated "calculated" forecasts that proved wrong: ${n(c.calculatedWrong)}`);
  console.log('  by predicted magnitude:');
  console.log(`    ${row(['bucket', 'count', 'exact', 'wrong', 'mean pred', 'mean actual', 'mae'])}`);
  for (const b of t.buckets) {
    console.log(`    ${row([b.label, b.count, b.exact, b.wrong, f(b.predicted), f(b.actual), f(b.meanAbsoluteError)])}`);
    // The 0 bucket reads as a perfect score. Say what it is made of instead of letting it stand.
    if (b.trivialExact) console.log(`    ${''.padEnd(14)}all ${b.trivialExact} exact row(s) here predicted 0 and had 0 land — the trivial agreement, not a hard call`);
  }
  if (t.errors.length) {
    console.log('  the wrong forecasts, ranked by size:');
    const worst = [...t.errors].sort((a, b) => b.absError - a.absError).slice(0, 5);
    for (const e of worst) console.log(`    A${e.act}F${e.floor}  predicted ${e.predicted}  actual ${e.actual}  [${e.direction === 'under' ? 'SHORT by ' + (e.actual - e.predicted) + ' hp' : 'over by ' + (e.predicted - e.actual) + ' hp'}] [${e.quality ?? 'quality unknown'}] context: ${e.warnings[0] ?? 'no warning recorded'}`);
    const causes = {};
    for (const e of t.errors) for (const w of e.warnings) { const k = classifyWarning(w); causes[k] = (causes[k] ?? 0) + 1; }
    console.log(`  context attached to wrong forecasts (NOT causes — a warning cannot make a forecast unknown): ${Object.entries(causes).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  }
  console.log('  for contrast, the other reading of "actual" (this decision -> the very next decision, ignoring turn end):');
  console.log(`    scored ${n(s.scored)}  exact ${n(s.exact)}  wrong ${n(s.wrong)}  mean absolute error ${f(s.meanAbsoluteError)} hp`);
  console.log('    that scope disagrees with the forecast\'s stated meaning, so it is reported, not trusted.');
  unknownLossSection(c.unknownLoss);
}

// The rows scored above are the rows the agent could see. These are the ones it could not, and
// the accuracy figures deliberately exclude them — a null forecast is admitted ignorance, not a
// wrong answer. That is the right treatment for the percentages and the wrong one for the
// consequences: the log carries the HP either side of the turn boundary regardless, so the cost
// of being blind is a measurement, not an unknown. It was computed nowhere before.
function unknownLossSection(u) {
  console.log('\nTHE COST OF BLINDNESS — realised hp loss on the rows with no forecast at all');
  if (!u || !u.rows) { console.log('  not measured'); return; }
  console.log(`  unknown-forecast rows        ${n(u.rows)}   (excluded from every accuracy figure above, correctly)`);
  console.log(`  realised loss measurable     ${n(u.resolved)}   no turn boundary in the log: ${n(u.unresolved)}`);
  console.log(`  mean realised loss           ${f(u.meanRealisedLoss)} hp   <- the turn the agent could not predict cost this much`);
  console.log(`  lost >= ${n(u.lethalThreshold)} hp on a blind turn   ${n(u.atLeast5)}   of ${n(u.resolved)}`);
  if (u.histogram?.length) {
    console.log(`  distribution of realised loss: ${u.histogram.map(h => `${h.label} hp: ${h.count}`).join('   ')}`);
  }
  if (u.worst) console.log(`  worst blind turn: A${n(u.worst.act)}F${n(u.worst.floor)}, ${n(u.worst.realised)} hp landed unpredicted`);
}

function fatalSection(deaths) {
  console.log(`\nFATAL DECISIONS — the last decisions before each death`);
  if (!deaths.length) { console.log('  no run_end in this log, so no death window to inspect'); return; }
  for (const d of deaths) {
    console.log(`\n  death at A${n(d.act)}F${n(d.floor)} (ascension ${n(d.ascension)}), hp at death: ${n(d.hpAtDeath)}`);
    console.log(`    last ${d.decisions.length} decisions: ${d.unknown} unknown, ${d.partial} partial, ${d.calculated} calculated, ${d.unreported} no quality`);
    console.log(`    preceded by an unknown forecast: ${d.anyUnknown ? 'YES' : 'no'}   low-confidence (unknown or partial): ${d.anyLowConfidence ? 'YES' : 'no'}`);
    // What was in the potion belt. "no healing available" is the usual reason a lethal board is
    // called unwinnable, and until this column existed the tool could not confirm or refute it.
    // `== null` covers undefined too: an absent field is UNKNOWN, and falling through to "the
    // belt was recorded and empty" would state a measurement nobody made.
    const held = d.decisions.flatMap(x => Array.isArray(x.potions) ? x.potions : []);
    const beltUnknown = d.decisions.some(x => x.potions == null);
    const names = [...new Set(held.map(p => p.name).filter(Boolean))];
    if (names.length) console.log(`    potions in hand in that window: ${names.join(', ')}`);
    else if (beltUnknown) console.log('    potions in hand in that window: none visible — the log recorded no potion list');
    else console.log('    potions in hand in that window: none — the belt was recorded and empty');
    const W = [14, 14, 14, 14, 14, 14, 14, 18, 30];
    console.log(`    ${row(['room', 'hp', 'blk', 'nrg', 'quality', 'pred loss', 'survives', 'action', 'potions'], W)}`);
    for (const x of d.decisions) {
      console.log(`    ${row([x.room ?? x.state_type, x.hp ?? '—', x.block ?? '—', x.energy ?? '—', x.quality ?? 'none', x.predictedHpLoss ?? 'unknown', x.predictedSurvives ?? 'unknown', x.action, potionsCell(x.potions)], W)}`);
    }
    const causes = new Set();
    for (const x of d.decisions) for (const w of x.warnings) causes.add(classifyWarning(w));
    if (causes.size) console.log(`    context named in that window (NOT causes of the unknown): ${[...causes].join(', ')}`);
  }
}

// null / undefined / [] / [names] are four different findings and must not be flattened into one
// string. Absent means the log never carried a potion list, which is not the same claim as an
// empty belt — on a death window that difference is the whole question.
function potionsCell(potions) {
  if (potions == null) return 'none visible';
  if (!Array.isArray(potions)) return 'unreadable';
  if (!potions.length) return 'none held';
  return potions.map(p => `${p?.name ?? 'unnamed'}(s${p?.slot ?? '?'}${p?.usable === true ? ',usable' : p?.usable === false ? ',no' : ''})`).join('+');
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
