// The store is a library; a decision request is a budget. This is the join between them: the handful of
// lessons retrieval could DEFEND as matching the state in front of us, the run-level shape of the history,
// and - the part that matters most - an explicit account of what the store cannot tell the model.
//
// The rule this file exists to keep: memory that is empty says so, and memory that does not match says that
// too. A request padded with plausible-sounding history is worse than an empty one, because the model cannot
// tell the difference between a lesson that was retrieved because it matched and one that was retrieved
// because the prompt had room. So relevance is decided by memory.mjs and merely reported here, and the
// payload is hard-bounded in bytes - a store that grows without limit must not grow a request with it.
import {retrieveLessons} from './memory.mjs';

export const RECALL_LESSON_LIMIT = 5;
export const RECALL_MAX_BYTES = 3000;
// A single lesson is prose written to be read whole. Past this length it is clipped, and the clipping is
// LABELLED, because half a sentence that reads as a complete claim is the exact failure this file avoids.
const LESSON_TEXT_MAX = 400;

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sizeOf = value => Buffer.byteLength(JSON.stringify(value));

// What the store is structurally blind to, stated the same way for every state. This is not modesty: a model
// handed five confident lessons will act on them as if they described the turn in front of it, and the one
// thing past runs genuinely cannot record is anything the game never showed the agent.
const STRUCTURAL_GAP = 'The store holds only what past decisions and their outcomes recorded: it says nothing about unseen cards, unmodelled enemy powers, or any part of a future turn.';

/**
 * The small, model-facing view of what past runs learned.
 *
 * Returns `{lessons, history, historyLine, gaps, note, ...}`. `lessons` holds at most `limit` entries, each
 * with the `basis` that earned it, its confidence, and how many distinct evidence records back it. The whole
 * object is bounded to `maxBytes`: lessons are dropped whole, from the bottom of the ranking, until it fits,
 * and the number dropped is reported in `truncated` so a trimmed context never reads as a complete one.
 *
 * With nothing stored, or nothing matching, every lesson field is empty and `note` says which of the two it
 * was. No lesson is ever written, reworded or inferred here.
 */
export function buildRecallContext(store, state, {limit = RECALL_LESSON_LIMIT, maxBytes = RECALL_MAX_BYTES} = {}) {
  // A store that is absent, or is not shaped like one, is treated as empty rather than trusted. A caller
  // that hands over the wrong object gets an honest empty context, not a crash halfway through a run.
  const readable = Array.isArray(store?.lessons) && Array.isArray(store?.runs);
  const runs = readable ? store.runs : [];
  const lessons = readable ? store.lessons : [];
  const encounters = store?.encounters && typeof store.encounters === 'object' ? store.encounters : {};
  const deaths = runs.filter(run => run?.result === 'death').length;
  const floors = runs.map(run => run?.finalFloor).filter(isNum);
  const history = {
    runs: runs.length,
    deaths,
    deepestFloor: floors.length ? Math.max(...floors) : null,
    lessonsStored: lessons.length,
    encountersSeen: Object.keys(encounters).length,
  };

  // THE AGENT'S OWN RECORD BY FIGHT CLASS. Not a prior and not a guide's opinion - the arithmetic of
  // every fight this exact policy has actually played, from the store. Measured across 8 Ascension-10
  // runs: normals 121 seen / 111 won at ~20 HP; ELITES 25 seen / 9 WON at ~30 HP. Elites are won 36% of
  // the time, and four of eight runs died to one.
  //
  // This exists because the route LABEL was not enough. The map already said "Elite next, no rest
  // before" and the agent walked in at 20 HP anyway, because knowing a thing is not the same as
  // weighing it. This is the one piece of the decision that only exists because earlier runs are
  // remembered, and it is the strongest evidence available about what is actually killing the run.
  //
  // Reported as a RECORD and not a verdict. A 0-for-4 against one elite is four observations, and a
  // class total of 25 is not a law - act-1 elite relics are a real source of scaling, and no run in
  // this corpus has ever reached a boss, so nothing here can say elites should be skipped outright.
  const classRecord = {};
  for (const [key, entry] of Object.entries(encounters)) {
    const cls = String(key).split(':')[0];
    const seen = isNum(entry?.seen) ? entry.seen : 0;
    if (seen <= 0) continue;
    const bucket = classRecord[cls] ??= {seen: 0, wins: 0, losses: 0, hpCostSum: 0, hpCostSamples: 0, distinct: 0};
    bucket.seen += seen;
    bucket.wins += isNum(entry?.wins) ? entry.wins : 0;
    bucket.losses += isNum(entry?.losses) ? entry.losses : 0;
    bucket.distinct += 1;
    if (isNum(entry?.avgHpLostBefore)) { bucket.hpCostSum += entry.avgHpLostBefore * seen; bucket.hpCostSamples += seen; }
  }
  const encounterRecord = Object.entries(classRecord)
    .map(([cls, b]) => ({
      class: cls,
      seen: b.seen,
      wins: b.wins,
      losses: b.losses,
      winRate: b.seen ? Math.round((b.wins / b.seen) * 100) : null,
      avgHpCost: b.hpCostSamples ? Number((b.hpCostSum / b.hpCostSamples).toFixed(1)) : null,
      distinctEncounters: b.distinct,
    }))
    .sort((a, b) => b.seen - a.seen);
  const recordLine = encounterRecord.length
    ? encounterRecord.map(r => `${r.class} ${r.wins}/${r.seen} won (${r.winRate}%)${r.avgHpCost === null ? '' : `, ${r.avgHpCost} HP average cost`}`).join('; ')
    : 'no encounter has been fought yet, so there is no record to weigh';
  const historyLine = runs.length
    ? `${plural(history.runs, 'run')} recorded, ${history.deaths} death${history.deaths === 1 ? '' : 's'}, deepest floor ${history.deepestFloor ?? 'unknown'}. Own record: ${recordLine}`
    : 'no run has been ingested yet, so there is no history to draw on';

  const retrieval = readable
    ? retrieveLessons(store, {state, limit})
    : {lessons: [], considered: 0, skipped: 0, note: 'no readable memory store was supplied, so nothing is claimed about past runs'};

  const kept = retrieval.lessons.map(entry => {
    const lesson = entry.lesson ?? {};
    const text = String(lesson.text ?? '');
    const clipped = text.length > LESSON_TEXT_MAX;
    return {
      id: lesson.id ?? null,
      text: clipped ? `${text.slice(0, LESSON_TEXT_MAX)}…` : text,
      ...(clipped ? {textClipped: true} : {}),
      confidence: isNum(lesson.confidence) ? lesson.confidence : null,
      confirmations: isNum(lesson.confirmations) ? lesson.confirmations : 0,
      basis: Array.isArray(entry.basis) ? entry.basis : [],
    };
  });

  const note = !readable
    ? retrieval.note
    : !runs.length
      ? `memory is empty: ${plural(history.lessonsStored, 'lesson')} stored, 0 runs ingested, and nothing is being claimed about past runs`
      : retrieval.note;

  const gaps = [
    !runs.length
      ? 'No completed run has been ingested, so nothing here is evidence about this character, this ascension or this act.'
      : retrieval.skipped
        ? `${plural(retrieval.skipped, 'stored lesson')} did not match this state and were withheld rather than included.`
        : null,
    STRUCTURAL_GAP,
  ].filter(Boolean).join(' ');

  // The fixed half of the payload - the honesty fields - is what must survive a tight budget, so it sets
  // the floor: a maxBytes below this size is honoured by keeping the disclaimer and dropping every lesson.
  const build = chosen => ({
    present: readable,
    lessons: chosen,
    history,
    // The class record travels with the payload so a decision can weigh it. It is small, it is
    // always true of the store it came from, and it is the one thing in the request that exists ONLY
    // because earlier runs are remembered.
    encounterRecord,
    recordLine,
    historyLine,
    considered: retrieval.considered,
    skipped: retrieval.skipped,
    truncated: kept.length - chosen.length,
    gaps,
    note,
  });
  const floor = sizeOf(build([]));
  const budget = Math.max(isNum(maxBytes) ? maxBytes : RECALL_MAX_BYTES, floor);
  let chosen = kept;
  for (;;) {
    const payload = build(chosen);
    if (sizeOf(payload) <= budget) return payload;
    chosen = chosen.slice(0, -1);
  }
}

export default {buildRecallContext, RECALL_LESSON_LIMIT, RECALL_MAX_BYTES};
