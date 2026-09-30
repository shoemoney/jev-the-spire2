#!/usr/bin/env node
// FIGHT OUTCOMES — the one correct way to read a run log.
//
// Written because this session produced THREE wrong headline numbers from three separate bugs, and
// every one of them was a measurement mistake rather than a code mistake:
//
//   1. "the agent never skips" — parsed `command.action`, which is not the field. It skips 37%.
//   2. "the potion was spent on a floor-3 mob" — read the wrong run's log file.
//   3. "90 fights, 50 lost — half of all fights die" — matched deaths by FLOOR. Floors repeat:
//      one death at floor 6 had eleven distinct fights sharing it. The truth was 12 of 102 lost.
//
// The floor-matching bug is the dangerous one, because it produced a number that was wrong in the
// direction that looks alarming, and it also HID a real pattern: once outcomes are derived by
// ORDERING, blocking streaks show 95% -> 87% -> 80% by streak length, which is exactly what the
// person watching the game had already spotted by eye.
//
// THE RULE: a fight is lost iff the run ENDS during it. That is an ordering fact about the log and
// nothing else. Never infer it from a floor number, an encounter name, or a heuristic.
//
// Usage: node .private/loop/fight-outcomes.mjs [path-to-jsonl ...]   (defaults to all of them)
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';

const COMBAT = new Set(['monster', 'elite', 'boss']);

/** A fight's identity inside one log file. Never a bare floor — floors repeat within a run. */
const fightKey = state => {
  const run = state?.run ?? {};
  const enemies = ((state?.battle ?? {}).enemies ?? [])
    .filter(e => (e?.hp ?? 0) > 0)
    .map(e => e.name)
    .sort()
    .join('+');
  return enemies ? `${run.act ?? '?'}:${run.floor ?? '?'}:${enemies}` : null;
};

const blockingStreak = decisions => {
  let longest = 0, current = 0;
  for (const d of decisions) {
    const blocks = /Defend/.test(d?.chosen?.label ?? '');
    current = blocks ? current + 1 : 0;
    if (current > longest) longest = current;
  }
  return longest;
};

export function fightOutcomes(events) {
  const fights = [];
  let current = [], key = null;
  const flush = died => { if (current.length) fights.push({decisions: current, died}); current = []; key = null; };
  for (const event of events) {
    const state = event?.state;
    if (event?.kind === 'decision' && event?.outcome === 'executed' && COMBAT.has(state?.state_type)) {
      const k = fightKey(state);
      if (!k) continue;
      if (key !== null && k !== key) flush(false);
      key = k;
      current.push(event);
    } else if (event?.kind === 'run_end') {
      // The run ended while a fight was open: THAT fight is the one that killed it.
      flush(true);
    }
  }
  flush(false);
  return fights.map(f => ({
    died: f.died,
    decisions: f.decisions.length,
    streak: blockingStreak(f.decisions),
    hp: f.decisions.at(-1)?.state?.player?.hp ?? null,
  }));
}

export function summarize(events) {
  const fights = fightOutcomes(events);
  const byStreak = {};
  for (const f of fights) {
    const bucket = f.streak >= 3 ? '3+ consecutive' : f.streak === 2 ? '2 consecutive' : '1 or none';
    byStreak[bucket] ??= {won: 0, lost: 0};
    byStreak[bucket][f.died ? 'lost' : 'won'] += 1;
  }
  // ASCENSION GATING. The bridge's `character_select` screen exposes no ascension control — its
  // options are character IDs, back and confirm — so every run started through the API is Ascension
  // 0 unless a SAVE carried a higher one. That is not a detail: the session that produced the first
  // boss kill ran entirely at Ascension 0 while every earlier run was Ascension 10, and the
  // "improvement" was reported before anyone checked. A number that can silently change difficulty
  // must not be summarised without it.
  const ascensions = {};
  for (const e of events) {
    const a = e?.state?.run?.ascension;
    if (Number.isFinite(a)) ascensions[a] = (ascensions[a] ?? 0) + 1;
  }
  const levels = Object.keys(ascensions).map(Number).sort((a, b) => a - b);
  return {
    fights: fights.length,
    won: fights.filter(f => !f.died).length,
    lost: fights.filter(f => f.died).length,
    byStreak,
    runs: events.filter(e => e?.kind === 'run_end').length,
    floors: events.filter(e => e?.kind === 'run_end').map(e => e?.state?.run?.floor).filter(Number.isFinite),
    ascensions,
    singleDifficulty: levels.length <= 1,
    // A mixed-difficulty summary is still true, but it cannot be compared to a single-level one.
    comparable: levels.length <= 1,
  };
}

const dir = '.private/spire-runs';
const args = process.argv.slice(2);
const files = args.length ? args : readdirSync(dir).filter(f => f.endsWith('.jsonl')).map(f => join(dir, f));
const merged = [];
for (const f of files) {
  for (const line of readFileSync(f, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { merged.push(JSON.parse(line)); } catch { /* skip a torn line */ }
  }
}
const s = summarize(merged);
const floors = s.floors;
const levels = Object.keys(s.ascensions).map(Number).sort((a, b) => a - b);
console.log(`files ${files.length} · runs ${s.runs} · fights ${s.fights}`);
if (levels.length > 1) {
  console.log(`  !! MIXED ASCENSION ${JSON.stringify(s.ascensions)} — these fights are NOT a like-for-like sample.`);
  console.log('     The bridge cannot set ascension (character_select has no control for it), so fresh runs are Ascension 0');
  console.log('     and only a resumed SAVE can carry 10. Report per-ascension, never pooled.');
} else {
  console.log(`  ascension: ${levels[0] ?? 'unknown'}`);
}
console.log(`  WON ${s.won}   LOST ${s.lost}   (${(s.won / Math.max(1, s.fights) * 100).toFixed(0)}% won)`);
console.log(`  floors at death: ${floors.join(', ')}  best ${floors.length ? Math.max(...floors) : '-'}`);
console.log('\nFIGHT OUTCOME BY LONGEST BLOCKING STREAK');
for (const k of ['1 or none', '2 consecutive', '3+ consecutive']) {
  const v = s.byStreak[k];
  if (!v) continue;
  const t = v.won + v.lost;
  console.log(`  ${k.padEnd(16)} won ${String(v.won).padStart(3)}  lost ${String(v.lost).padStart(3)}   (${(v.won / t * 100).toFixed(0)}% won, n=${t})`);
}
