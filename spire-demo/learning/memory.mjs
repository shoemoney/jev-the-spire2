// Cross-run memory for the decision agent. The agent plays, writes its decisions to a JSONL log and
// otherwise starts every run from the same fixed policy - so nothing it learned in run 1 reaches run 2.
// This is the store that closes that loop, and the retrieval that feeds it back in at decision time.
//
// THE RULE THIS FILE EXISTS TO KEEP: a lesson with no evidence is not a lesson. Every lesson carries the
// record that produced it, and retrieval refuses to serve a lesson whose evidence does not describe the
// state in front of it. An honestly empty result beats a confident guess, because the agent will believe
// whatever comes back here.
import {readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, unlinkSync, readdirSync} from 'node:fs';
import {dirname, resolve} from 'node:path';

export const MEMORY_VERSION = 1;
export const DEFAULT_MEMORY_PATH = '.private/learning/memory.json';

// A lesson's text is written by a human-readable generator, so two runs that hit the same failure produce
// near-identical prose that differs only in the numbers inside it ("died at floor 12" vs "died at floor
// 11"). Deduping on the raw text would file those as separate lessons and the store would grow a pile of
// near-copies nobody reads. Masking digits first makes them one lesson with five pieces of evidence, which
// is what they actually are.
const normalize = text => String(text ?? '')
  .toLowerCase()
  .replace(/\d+(?:\.\d+)?/g, '#')
  .replace(/[^a-z#]+/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

const nowIso = clock => (clock ? new Date(clock).toISOString() : new Date().toISOString());
const num = (v, fallback = null) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// Confidence is earned, not asserted: a lesson the evidence only weakly supports is stored near the floor
// and can never outrank a well-evidenced one, however recently it was used.
const confidenceOf = v => clamp(num(v, 0.2) ?? 0.2, 0, 1);

export function createStore(clock) {
  const at = nowIso(clock);
  return {version: MEMORY_VERSION, createdAt: at, updatedAt: at, runs: [], encounters: {}, lessons: [], stats: {runsRecorded: 0, lessonsStored: 0, lessonConfirmations: 0, ingestions: 0}};
}

function normalizeStore(raw, at) {
  const base = createStore(at);
  const store = {
    ...base,
    version: MEMORY_VERSION,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : base.createdAt,
    updatedAt: at,
    runs: Array.isArray(raw.runs) ? raw.runs.filter(r => r && typeof r === 'object') : [],
    encounters: raw.encounters && typeof raw.encounters === 'object' ? {...raw.encounters} : {},
    lessons: Array.isArray(raw.lessons) ? raw.lessons.filter(l => l && typeof l === 'object') : [],
    stats: {...base.stats, ...(raw.stats && typeof raw.stats === 'object' ? raw.stats : {})},
  };
  for (const lesson of store.lessons) {
    if (!Array.isArray(lesson.evidence)) lesson.evidence = [];
    if (num(lesson.confidence) === null) lesson.confidence = 0.2;
    if (num(lesson.uses) === null) lesson.uses = 0;
    if (num(lesson.confirmations) === null) lesson.confirmations = lesson.evidence.length;
  }
  return store;
}

// Never throw on a bad store and never invent content. A missing file is a normal first run; a corrupt or
// future-versioned file is reported as exactly that, with the reason, so a caller can decide whether to
// back the file up rather than silently overwriting whatever was there.
export function loadMemory(path = DEFAULT_MEMORY_PATH, {clock} = {}) {
  const target = resolve(path);
  if (!existsSync(target)) return {store: createStore(clock), status: 'created', note: `no memory file at ${target}; started a clean store`, path: target};
  let text;
  try {
    text = readFileSync(target, 'utf8');
  } catch (err) {
    return {store: createStore(clock), status: 'unreadable', note: `could not read ${target}: ${err.message}; started a clean store, existing file left untouched`, path: target};
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return {store: createStore(clock), status: 'corrupt', note: `${target} is not valid JSON (${err.message}); started a clean store, existing file left untouched`, path: target};
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {store: createStore(clock), status: 'corrupt', note: `${target} does not contain a memory object; started a clean store`, path: target};
  }
  if (num(raw.version) !== MEMORY_VERSION) {
    return {store: createStore(clock), status: 'version-mismatch', note: `${target} is version ${JSON.stringify(raw.version)}; this build reads version ${MEMORY_VERSION} and will not guess at a foreign shape, so a clean store was returned and the file was left untouched`, path: target};
  }
  return {store: normalizeStore(raw, nowIso(clock)), status: 'loaded', note: `loaded ${target}`, path: target};
}

// Write to a sibling temp file and rename over the target. A crash mid-write therefore leaves the previous
// store intact rather than a half-written file that reads as corruption on the next load.
export function saveMemory(store, path = DEFAULT_MEMORY_PATH) {
  const target = resolve(path);
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  mkdirSync(dirname(target), {recursive: true});
  store.version = MEMORY_VERSION;
  store.updatedAt = store.updatedAt ?? nowIso();
  const payload = `${JSON.stringify(store, null, 2)}\n`;
  try {
    writeFileSync(tmp, payload, 'utf8');
    renameSync(tmp, target);
  } catch (err) {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* the temp file is already gone */ }
    throw new Error(`could not save memory to ${target}: ${err.message}`);
  }
  return {path: target, bytes: Buffer.byteLength(payload), tmp};
}

// Which fight is this? The corpus shows an encounter as several same-named enemies at once (three
// Phantasmal Gardeners), so a single enemy name would file three different fights under one key.
export function encounterKey(state) {
  const kind = state?.state_type;
  if (kind !== 'monster' && kind !== 'elite') return null;
  const names = [...new Set((state?.battle?.enemies ?? []).map(e => e?.name).filter(Boolean))].sort();
  if (!names.length) return null;
  return `${kind}:${names.join('+')}`;
}

export function recordEncounter(store, key, summary = {}) {
  if (!key) return null;
  const at = nowIso(summary.clock);
  const entry = store.encounters[key] ?? {name: key, seen: 0, wins: 0, losses: 0, avgHpLostBefore: null, notes: []};
  entry.seen = (num(entry.seen) ?? 0) + 1;
  if (summary.win === true) entry.wins = (num(entry.wins) ?? 0) + 1;
  if (summary.win === false) entry.losses = (num(entry.losses) ?? 0) + 1;
  const lost = num(summary.hpLostBefore);
  // Running mean, not a last-write overwrite: a single 80-HP fight must not erase the shape of 30 others.
  const prior = entry.avgHpLostBefore;
  const n = entry.seen - 1;
  entry.avgHpLostBefore = lost === null ? prior : (prior === null || prior === undefined ? lost : (prior * n + lost) / entry.seen);
  const note = typeof summary.note === 'string' ? summary.note.trim() : '';
  if (note && !entry.notes.includes(note)) {
    entry.notes.push(note);
    if (entry.notes.length > 4) entry.notes = entry.notes.slice(-4);
  }
  entry.lastSeenAt = at;
  store.encounters[key] = entry;
  return entry;
}

export function recordRun(store, summary = {}) {
  const record = {
    runId: summary.runId ?? null,
    startedAt: summary.startedAt ?? null,
    character: summary.character ?? null,
    ascension: num(summary.ascension),
    result: summary.result ?? null,
    finalAct: num(summary.finalAct),
    finalFloor: num(summary.finalFloor),
    hpLost: num(summary.hpLost),
    decisions: num(summary.decisions, 0) ?? 0,
    deathCause: summary.deathCause ?? null,
    deathFloor: num(summary.deathFloor),
    deathEncounter: summary.deathEncounter ?? null,
  };
  // A run with no id and no progress is not a run. Storing it would let a placeholder row look like a
  // data point in the stats, which is exactly the confident-wrong-number failure this store must not have.
  if (!record.runId && record.finalFloor === null) return null;
  const at = nowIso(summary.clock);
  const prior = store.runs.find(r => r.runId && r.runId === record.runId);
  if (prior) Object.assign(prior, record, {updatedAt: at});
  else store.runs.push({...record, recordedAt: at});
  store.stats.runsRecorded = store.runs.length;
  return record;
}

const evidenceSignature = evidence => [
  evidence?.runId ?? '',
  evidence?.encounter ?? '',
  evidence?.act ?? '',
  evidence?.floor ?? '',
  evidence?.kind ?? '',
].join('|');

export function addLesson(store, lesson = {}) {
  const text = typeof lesson.text === 'string' ? lesson.text.trim() : '';
  const kind = typeof lesson.kind === 'string' && lesson.kind.trim() ? lesson.kind.trim() : 'observation';
  if (!text) return {stored: false, reason: 'a lesson needs text; without it there is nothing to retrieve or act on'};
  const evidence = (Array.isArray(lesson.evidence) ? lesson.evidence : [lesson.evidence])
    .filter(e => e && typeof e === 'object' && e !== lesson)
    .map(e => ({...e}));
  if (!evidence.length) {
    return {stored: false, reason: 'a lesson with no evidence is not a lesson; nothing was written'};
  }
  const key = `${kind}|${normalize(text)}`;
  const at = nowIso(lesson.clock);
  const existing = store.lessons.find(l => l.key === key);
  if (existing) {
    const sig = new Set((existing.evidence ?? []).map(evidenceSignature));
    const added = evidence.filter(e => !sig.has(evidenceSignature(e)));
    for (const e of added) {
      existing.evidence.push(e);
      sig.add(evidenceSignature(e));
    }
    // Confirmations count DISTINCT evidence records, so re-ingesting the same run cannot manufacture
    // confidence. Confidence then rises with corroboration and is capped, never scaled past certainty.
    existing.confirmations = (num(existing.confirmations, 0) ?? 0) + added.length;
    existing.confidence = clamp(confidenceOf(lesson.confidence ?? existing.confidence) + added.length * 0.05, 0, 0.95);
    existing.observations = (num(existing.observations, 0) ?? 0) + 1;
    existing.updatedAt = at;
    store.stats.lessonConfirmations += added.length;
    return {stored: true, deduped: true, lesson: existing, addedEvidence: added.length};
  }
  const stored = {
    id: lesson.id ?? `l${String(store.lessons.length + 1).padStart(4, '0')}`,
    key,
    createdAt: at,
    updatedAt: at,
    kind,
    text,
    evidence: evidence.slice(0, 12),
    confidence: confidenceOf(lesson.confidence),
    confirmations: evidence.length,
    observations: 1,
    uses: 0,
    lastUsedAt: null,
    ...(lesson.context && typeof lesson.context === 'object' ? {context: lesson.context} : {}),
  };
  store.lessons.push(stored);
  store.stats.lessonsStored = store.lessons.length;
  return {stored: true, deduped: false, lesson: stored, addedEvidence: evidence.length};
}

// ---------------------------------------------------------------------------------------------- retrieval

const scoreLesson = (lesson, current, now) => {
  const ctx = lesson.context ?? {};
  const basis = [];
  let score = 0;
  const enemyNames = new Set(current.enemyNames);
  // A merged lesson is read next to records from several fights, and its context is the FIRST one that
  // created it. Matching on context alone would hide a lesson from the very fight it is about as soon as
  // two runs hit the same rule, so every evidence record's encounter counts as a match too.
  const declared = new Set(ctx.encounters ?? []);
  const fromEvidence = (lesson.evidence ?? []).map(e => String(e.encounter ?? '')).filter(Boolean).flatMap(s => s.split('+')).filter(Boolean);
  const overlaps = [...new Set([...declared, ...fromEvidence])].filter(name => enemyNames.has(name));
  if (overlaps.length) {
    score += 3 * Math.min(overlaps.length, 2);
    basis.push(`encounter:${overlaps.join('+')}`);
  }
  const sameType = !!ctx.stateType && ctx.stateType === current.stateType;
  const sameAct = num(ctx.act) !== null && ctx.act === current.act;
  const floorDistance = num(ctx.floor) === null || num(current.floor) === null ? null : Math.abs(ctx.floor - current.floor);
  if (sameType) { score += 2; basis.push(`state_type:${ctx.stateType}`); }
  if (sameAct) { score += 1; basis.push('act'); }
  if (floorDistance !== null) {
    if (floorDistance <= 2) { score += 2; basis.push(`floor±${floorDistance}`); }
    else if (floorDistance <= 10) { score += 2 * (1 - floorDistance / 10); basis.push(`floor±${floorDistance}`); }
  }
  score += 2 * confidenceOf(lesson.confidence);
  const stamp = lesson.lastUsedAt ?? lesson.createdAt;
  const ageDays = Math.max(0, (Date.parse(now) - (Date.parse(stamp) || 0)) / 86400000);
  score += 1 / (1 + ageDays);
  score += 0.5 * Math.min(num(lesson.confirmations, 1) ?? 1, 4);
  // A lesson is only RELEVANT when the evidence describes a fight like this one. Sharing an act is not
  // enough - "died at floor 14 to a 17-damage intent" has nothing to say to a floor 2 Nibbit at full HP,
  // and serving it there would be the store padding a prompt rather than informing it. So the gate is
  // an encounter-name hit, or the same kind of state within ten floors. Everything else is skipped out loud.
  const hardMatch = overlaps.length > 0
    || (sameType && floorDistance !== null && floorDistance <= 10);
  return {score, basis, hardMatch};
};

const currentContext = state => ({
  stateType: state?.state_type ?? null,
  act: num(state?.run?.act),
  floor: num(state?.run?.floor),
  enemyNames: [...new Set((state?.battle?.enemies ?? []).map(e => e?.name).filter(Boolean))],
});

/**
 * The lessons worth putting in front of the model right now.
 *
 * Returns `{lessons, considered, skipped, note}`. `lessons` holds at most `limit` entries, best first, and
 * each carries the `basis` that earned its place plus the evidence it rests on. A lesson whose context
 * does not match the current state is counted in `skipped` with the reason - never dressed up as relevant.
 * When nothing matches, `lessons` is empty and the note says so; the caller must handle that as a normal
 * outcome rather than filling the gap with a guess.
 */
export function retrieveLessons(store, {state, limit = 5, clock} = {}) {
  const now = nowIso(clock);
  const cap = Math.max(0, num(limit, 5) ?? 5);
  if (!state) {
    const ranked = store.lessons.map(l => ({lesson: l, score: confidenceOf(l.confidence), basis: ['no-state:confidence-only'], hardMatch: true}))
      .sort((a, b) => b.score - a.score).slice(0, cap);
    for (const entry of ranked) {
      entry.lesson.uses = (num(entry.lesson.uses, 0) ?? 0) + 1;
      entry.lesson.lastUsedAt = now;
    }
    return {lessons: ranked, considered: store.lessons.length, skipped: store.lessons.length - ranked.length, note: 'no current state supplied; ranked on confidence alone'};
  }
  const current = currentContext(state);
  const scored = [];
  const skipped = [];
  for (const lesson of store.lessons) {
    const {score, basis, hardMatch} = scoreLesson(lesson, current, now);
    if (!hardMatch) { skipped.push({id: lesson.id, text: lesson.text, reason: `context does not match this state (${JSON.stringify(lesson.context ?? null)} vs act ${current.act} floor ${current.floor} ${current.stateType ?? 'no-type'})`}); continue; }
    scored.push({lesson, score, basis});
  }
  scored.sort((a, b) => b.score - a.score || String(a.lesson.id).localeCompare(String(b.lesson.id)));
  const lessons = scored.slice(0, cap);
  for (const entry of lessons) {
    entry.lesson.uses = (num(entry.lesson.uses, 0) ?? 0) + 1;
    entry.lesson.lastUsedAt = now;
    entry.evidence = (entry.lesson.evidence ?? []).slice(0, 3);
  }
  return {
    lessons,
    considered: store.lessons.length,
    skipped: skipped.length,
    skippedDetail: skipped.slice(0, 5),
    note: lessons.length
      ? `${lessons.length} of ${store.lessons.length} stored lessons match act ${current.act} floor ${current.floor} ${current.stateType ?? '(no type)'}`
      : `no stored lesson matches act ${current.act} floor ${current.floor} ${current.stateType ?? '(no type)'}; returning nothing rather than a guess`,
  };
}

// ------------------------------------------------------------------------------------------ extraction

// The intent label is the game's own statement of what it will do next turn, and it is the one number in
// the state that is not a model output. Reading it is arithmetic on game data, so a lesson built on it can
// be stated with confidence. Formats observed in the corpus: "12" and "4x3 (12)".
// The label is a string, so it is parsed here rather than through the numeric-only helper: a capture group
// handed to that helper is rejected as "not a number" and the whole intent silently reads as unreadable.
export function intentDamage(intent) {
  const label = intent?.label;
  if (label === undefined || label === null) return null;
  const text = String(label).trim();
  const multi = /^(\d+)\s*x\s*(\d+)\s*(?:\(\s*(\d+)\s*\))?$/.exec(text);
  if (multi) {
    const hits = Number(multi[1]), times = Number(multi[2]);
    // The parenthesised total is the game's own figure and wins; hits x times is the fallback, and it is
    // only used when both factors are positive so a malformed label cannot become a damage number.
    if (multi[3] !== undefined && Number.isFinite(Number(multi[3]))) return Number(multi[3]);
    return hits > 0 && times > 0 ? hits * times : null;
  }
  return /^\d+$/.test(text) ? Number(text) : null;
}

export function incomingDamage(battle) {
  if (!battle?.enemies?.length) return null;
  let total = 0, sawAttack = false;
  for (const enemy of battle.enemies) {
    for (const intent of enemy.intents ?? []) {
      if (intent?.type !== 'Attack') continue;
      const damage = intentDamage(intent);
      if (damage === null) continue;
      sawAttack = true;
      total += damage;
    }
  }
  return sawAttack ? total : null;
}

const chosenForecast = event => {
  const choice = event?.answer?.choice;
  const candidate = (event?.candidates ?? []).find(c => c?.id === choice);
  return (candidate?.forecast ?? {}) && typeof candidate?.forecast === 'object' ? candidate.forecast : {};
};

const fightWindow = (events, act, floor) => events.filter(e => {
  const type = e?.state?.state_type;
  return (type === 'monster' || type === 'elite') && e?.state?.run?.act === act && e?.state?.run?.floor === floor;
});

/**
 * Turn a finished run into candidate lessons, each with the records that justify it.
 *
 * Every rule below states a fact that can be read straight off the logged game state. Where the evidence is
 * not there - no end_turn decision, no intent label, no death - the rule returns nothing rather than a
 * plausible-sounding generalisation, because a lesson the evidence does not carry is a lie the agent will
 * later act on with confidence.
 */
export function extractLessons(runSummary = {}, events = []) {
  const {runId, act, floor} = {runId: runSummary.runId ?? null, act: num(runSummary.finalAct), floor: num(runSummary.finalFloor)};
  const died = runSummary.result === 'death' || (num(runSummary.hpLost) !== null && runSummary.hpLost > 0);
  const out = [];
  if (num(act) === null || num(floor) === null || !events.length) return {lessons: [], refused: ['a run needs a final act and floor and its decision events before any lesson can be evidenced']};

  const fight = fightWindow(events, act, floor);
  const context = {act, floor, stateType: fight.length ? fight[0].state.state_type : runSummary.deathEncounterType ?? null, encounters: [...new Set((fight[0]?.state?.battle?.enemies ?? []).map(e => e?.name).filter(Boolean))].sort()};

  // 1. The death was readable. The final turn's own intent display already exceeded HP + Block.
  const turnEndings = fight.filter(e => e?.chosen?.command?.action === 'end_turn');
  const last = turnEndings[turnEndings.length - 1];
  if (died && last) {
    const player = last.state.player ?? {};
    const incoming = incomingDamage(last.state.battle);
    const hp = num(player.hp), block = num(player.block, 0) ?? 0, maxHp = num(player.max_hp);
    if (incoming !== null && hp !== null && incoming >= hp + block) {
      out.push({
        kind: 'death-was-readable',
        text: 'Ended a turn with the incoming intent already exceeding HP plus Block, and died to it: the lethal number was on the board before the turn was handed over.',
        confidence: 0.9,
        context,
        evidence: {runId, act, floor, kind: 'fatal-end-turn', encounter: context.encounters.join('+'), incoming, hp, block, maxHp, hpAfter: hp - Math.max(0, incoming - block), decisionsInFight: fight.length},
      });
    }
    // 2. The one end_turn whose own forecast said it was lethal, taken anyway.
    const forecast = chosenForecast(last);
    if (forecast.survives === false || num(forecast.hpAfter) === 0) {
      out.push({
        kind: 'chose-lethal-end-turn',
        text: 'Ended a turn the planner\'s own forecast marked as lethal (survives:false / hpAfter 0) and died that turn.',
        confidence: 0.6,
        context,
        evidence: {runId, act, floor, kind: 'forecast-said-lethal', encounter: context.encounters.join('+'), survives: forecast.survives, hpAfter: forecast.hpAfter, incoming: forecast.incoming, forecastQuality: forecast.quality},
      });
    }
  }

  if (died && fight.length) {
    // 3. Entered the fight already critical. Fight-start HP, not end-of-run HP.
    const first = fight[0].state.player ?? {};
    const startHp = num(first.hp), maxHp = num(first.max_hp);
    if (startHp !== null && maxHp !== null && maxHp > 0 && startHp / maxHp <= 0.3) {
      out.push({
        kind: 'entered-fight-critical',
        text: 'Entered a fight below 30% max HP, which is the HP the death fight was started with.',
        confidence: 0.75,
        context,
        evidence: {runId, act, floor, kind: 'fight-start-hp', encounter: context.encounters.join('+'), hp: startHp, maxHp, hpPct: Math.round((startHp / maxHp) * 100)},
      });
    }
    // 4. The fight was largely decided blind: most chosen candidates carried no survival estimate.
    // Three decisions is the floor. One blind choice is an ordinary unmodelled state, not a pattern, and a
    // lesson built on a single observation is an anecdote wearing a lesson's clothes.
    const blind = fight.filter(e => {
      const f = chosenForecast(e);
      return f.quality === 'unknown' || f.survives === undefined;
    });
    if (fight.length >= 3 && blind.length / fight.length >= 0.6) {
      out.push({
        kind: 'decided-blind',
        text: 'Fought a whole fight with no survival estimate on the chosen candidate, so the move was picked off the board alone.',
        confidence: 0.8,
        context,
        evidence: {runId, act, floor, kind: 'blind-choices', encounter: context.encounters.join('+'), blind: blind.length, decisions: fight.length, blindPct: Math.round((blind.length / fight.length) * 100)},
      });
    }
    // 5. An enemy power the forecaster explicitly did not model was live during the death fight.
    const unmodeled = new Set();
    for (const e of fight) for (const warning of chosenForecast(e).warnings ?? []) {
      const match = /^Unmodeled enemy power: (.+)$/.exec(String(warning));
      if (match) unmodeled.add(match[1]);
    }
    if (unmodeled.size) {
      out.push({
        kind: 'unmodeled-enemy-power',
        text: 'Died to an enemy the forecaster explicitly could not model, with the unmodeled warning live for the whole fight.',
        confidence: 0.7,
        context,
        evidence: {runId, act, floor, kind: 'unmodeled-power', encounter: context.encounters.join('+'), powers: [...unmodeled].sort(), decisionsInFight: fight.length},
      });
    }
    // 6. The killing intent was multi-hit, a shape the label encodes compactly ("4x3 (12)").
    const shapes = new Set();
    for (const e of fight) for (const enemy of e.state.battle?.enemies ?? []) for (const intent of enemy.intents ?? []) {
      if (intent?.type === 'Attack' && /^\d+x\d+ \(\d+\)$/.test(String(intent.label ?? ''))) shapes.add(String(intent.label));
    }
    if (shapes.size) {
      out.push({
        kind: 'multi-hit-killer',
        text: 'Died against a multi-hit intent; the hit count, not the total, is what has to be planned around.',
        confidence: 0.65,
        context,
        evidence: {runId, act, floor, kind: 'multi-hit-intent', encounter: context.encounters.join('+'), labels: [...shapes].sort()},
      });
    }
  }
  return {lessons: out, refused: out.length ? [] : ['no rule found evidence in this run; nothing was written']};
}

/**
 * Read a JSONL run log into one record per run: {summary, events}.
 *
 * Events are kept PER RUN rather than pooled. The corpus has two separate runs that both die on act 1
 * floor 14, so a flat pool would hand run 2's extraction run 0's death fight and file one run's evidence
 * against another run's lesson.
 */
export function parseRunLog(text) {
  const runs = [];
  let current = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.kind === 'decision') { current.push(entry); continue; }
    if (entry?.kind !== 'run_end') continue;
    const run = entry.state?.run ?? {};
    const player = entry.state?.player ?? {};
    const final = current[current.length - 1]?.state;
    runs.push({
      summary: {
        runId: `${entry.time}-a${run.act}-f${run.floor}`,
        startedAt: current[0]?.time ?? null,
        character: player.character ?? null,
        ascension: num(run.ascension),
        result: num(player.hp) === 0 ? 'death' : 'ended',
        finalAct: num(run.act),
        finalFloor: num(run.floor),
        hpLost: num(player.max_hp) === null ? null : num(player.max_hp) - num(player.hp, 0),
        decisions: current.length,
        deathCause: entry.state?.game_over?.message ?? null,
        deathFloor: num(run.floor),
        deathEncounter: (final?.battle?.enemies ?? []).map(e => e?.name).filter(Boolean).sort().join('+') || null,
      },
      events: current,
    });
    current = [];
  }
  return {runs, summaries: runs.map(r => r.summary)};
}

/** Ingest a whole run log into a store: every run recorded, every lesson extracted and deduplicated. */
export function ingestLog(store, text) {
  const {runs} = parseRunLog(text);
  const added = [];
  const refused = [];
  for (const {summary, events} of runs) {
    recordRun(store, summary);
    // Encounters are counted per FIGHT, keyed by floor as well as by enemy set: a run can meet the same
    // enemy twice (two Leaf Slime rooms in one run), and keying by enemy alone would file them as one
    // fight and average their costs into a number that describes neither.
    const fights = new Map();
    for (const event of events) {
      const type = event?.state?.state_type;
      if (type !== 'monster' && type !== 'elite') continue;
      const key = encounterKey(event.state);
      if (!key) continue;
      const run = event.state.run ?? {};
      const fightKey = `${key}@a${run.act}f${run.floor}`;
      const existing = fights.get(fightKey);
      const isOpening = (event.state.battle?.round ?? 1) <= 1;
      if (!existing) fights.set(fightKey, {key, opening: event, last: event});
      else {
        if (isOpening) existing.opening = event;
        existing.last = event;
      }
    }
    for (const [fightKey, fight] of fights) {
      const start = fight.opening;
      const hpBefore = num(start.state.player?.hp), maxHp = num(start.state.player?.max_hp);
      const last = fight.last.state.run ?? {};
      const isDeathFight = last.act === summary.finalAct && last.floor === summary.finalFloor;
      recordEncounter(store, fight.key, {win: !isDeathFight, hpLostBefore: maxHp !== null && hpBefore !== null ? maxHp - hpBefore : null});
    }
    const {lessons, refused: why} = extractLessons(summary, events);
    refused.push(...why);
    for (const candidate of lessons) {
      const result = addLesson(store, candidate);
      if (result.stored) added.push(result);
      else refused.push(`${candidate.kind}: ${result.reason}`);
    }
  }
  store.stats.ingestions = (num(store.stats.ingestions, 0) ?? 0) + 1;
  return {runs: runs.length, added: added.length, deduplicated: added.filter(a => a.deduped).length, refused};
}

// ---------------------------------------------------------------------------------------------- payload

/**
 * Cap the store. This is injected into a model request, so unbounded growth is a cost and a distraction,
 * not just disk. Everything dropped is named in the return value - a silently truncated store reads as a
 * complete one.
 */
export function pruneStore(store, {maxRuns = 20, maxLessons = 60, maxEncounters = 80, maxEvidence = 12} = {}) {
  const dropped = {runs: [], lessons: [], encounters: [], evidence: 0};
  if (store.runs.length > maxRuns) {
    const kept = store.runs.slice(-maxRuns);
    dropped.runs = store.runs.slice(0, store.runs.length - maxRuns).map(r => r.runId);
    store.runs = kept;
  }
  if (store.lessons.length > maxLessons) {
    // Weakest confirmation first, then least recently used, then oldest - so the casualties are taken off
    // the FRONT. Sorting this descending would drop the best-evidenced lessons and keep the noise, which is
    // the one thing a memory store must never do.
    const ordered = [...store.lessons].sort((a, b) => (confidenceOf(a.confidence) - confidenceOf(b.confidence)) || String(a.lastUsedAt ?? a.createdAt).localeCompare(String(b.lastUsedAt ?? b.createdAt)));
    const doomed = new Set(ordered.slice(0, ordered.length - maxLessons).map(l => l.id));
    dropped.lessons = store.lessons.filter(l => doomed.has(l.id)).map(l => ({id: l.id, text: l.text, confirmations: l.confirmations}));
    store.lessons = store.lessons.filter(l => !doomed.has(l.id));
  }
  for (const lesson of store.lessons) {
    if ((lesson.evidence?.length ?? 0) > maxEvidence) {
      dropped.evidence += lesson.evidence.length - maxEvidence;
      lesson.evidence = lesson.evidence.slice(-maxEvidence);
    }
  }
  const keys = Object.keys(store.encounters);
  if (keys.length > maxEncounters) {
    const ordered = keys.sort((a, b) => String(store.encounters[a].lastSeenAt ?? '').localeCompare(String(store.encounters[b].lastSeenAt ?? '')));
    const doomed = new Set(ordered.slice(0, ordered.length - maxEncounters));
    dropped.encounters = [...doomed];
    for (const key of doomed) delete store.encounters[key];
  }
  return {dropped, bytes: Buffer.byteLength(JSON.stringify(store))};
}

/** The small, model-facing view. Counts first, then the lessons worth reading, then what was left out. */
export function summarizeStore(store, {maxLessons = 8, maxEvidence = 2} = {}) {
  const order = [...store.lessons].sort((a, b) => (confidenceOf(b.confidence) - confidenceOf(a.confidence)) || (num(b.uses, 0) - num(a.uses, 0)));
  return {
    version: store.version,
    updatedAt: store.updatedAt,
    runs: store.stats.runsRecorded ?? store.runs.length,
    lessons: store.lessons.length,
    encounters: Object.keys(store.encounters).length,
    deaths: store.runs.filter(r => r.result === 'death').length,
    top: order.slice(0, maxLessons).map(l => ({text: l.text, confidence: confidenceOf(l.confidence), confirmations: l.confirmations, uses: num(l.uses, 0) ?? 0, evidence: (l.evidence ?? []).slice(0, maxEvidence)})),
    omitted: Math.max(0, order.length - maxLessons),
    note: 'Lessons are deduplicated across runs; confirmations counts distinct evidence records, not repetitions. A lesson with no evidence is never stored.',
  };
}

export default {loadMemory, saveMemory, createStore, recordRun, recordEncounter, addLesson, retrieveLessons, extractLessons, parseRunLog, ingestLog, pruneStore, summarizeStore, encounterKey, incomingDamage, intentDamage, MEMORY_VERSION, DEFAULT_MEMORY_PATH};
