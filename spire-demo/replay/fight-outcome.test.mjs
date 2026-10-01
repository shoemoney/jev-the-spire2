// Each test below is a real wrong number this project reported about itself.
//
//   "6 boss fights, no kill"  -> A_KILL_THEN_A_LONG_WALK_TO_ACT_2_READS_AS_A_LOSS
//   "12 won, 0 lost"          -> A_DEATH_MID_FIGHT_INHERITED_BY_THE_NEXT_RUN
//
// Both came from inferring the outcome instead of reading the transition. These tests pin the
// transitions so the inference cannot come back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fightOutcomes, summariseFights } from './metrics.mjs';

const dec = (type, { name = 'Vantom', hp = 200, ...rest } = {}) => ({
  kind: 'decision',
  outcome: 'executed',
  state: { state_type: type, battle: COMBAT_ENEMIES(type, name, hp), ...rest },
});
const COMBAT_ENEMIES = (type, name, hp) =>
  ['monster', 'elite', 'boss'].includes(type) ? { enemies: [{ name, hp }] } : undefined;
const runEnd = (floor = 14) => ({ kind: 'run_end', state: { state_type: 'game_over', run: { act: 1, floor } } });

test('a kill followed by the long walk to the next act is a WIN, not a loss', () => {
  // The exact shape that produced "no kill": boss dies, then the run keeps playing for many
  // screens and ends 14 floors later. Grouping by run calls the whole thing a loss.
  const events = [
    dec('boss', { hp: 200 }),
    dec('boss', { hp: 27 }),
    dec('boss', { hp: 0 }),
    dec('rewards'), dec('card_reward'), dec('map'), dec('monster', { hp: 40 }),
    runEnd(31),
  ];
  const fights = fightOutcomes(events);
  assert.equal(fights.length, 2);
  assert.equal(fights[0].type, 'boss');
  assert.equal(fights[0].outcome, 'won', 'the boss died and the run continued — that is a win');
  assert.equal(fights[0].startHp, 200);
  assert.equal(fights[1].type, 'monster');
  assert.equal(fights[1].outcome, 'lost', 'the run died in THIS fight, not the boss one');
});

test('a death mid-fight is a loss and cannot be inherited by the next run', () => {
  // The exact shape that produced "12 won, 0 lost": the run ends inside the boss fight, and the
  // next run's first non-combat decision was read as "the boss died".
  const events = [
    dec('boss', { hp: 200 }), dec('boss', { hp: 150 }),
    runEnd(17),
    dec('char_select'), dec('map'), dec('monster', { hp: 30 }), runEnd(2),
  ];
  const fights = fightOutcomes(events);
  assert.equal(fights.length, 2);
  assert.equal(fights[0].outcome, 'lost');
  assert.equal(fights[1].outcome, 'lost');
  assert.equal(summariseFights(fights).won, 0, 'no decision may ever be counted as a win here');
});

test('an empty enemy list at the last combat screen still closes as a win', () => {
  const events = [dec('boss', { hp: 9 }), dec('boss', { hp: 0 }), dec('rewards')];
  assert.equal(fightOutcomes(events)[0].outcome, 'won');
});

test('a log that simply ends mid-fight is unresolved, never guessed at', () => {
  // An unobserved outcome must not render as a measured one. Defaulting this to `lost` is the
  // same class of bug as before, running the other direction.
  const fights = fightOutcomes([dec('boss', { hp: 120 })]);
  assert.equal(fights[0].outcome, 'unresolved');
  assert.equal(fights[0].closedBy, 'eof');
  assert.equal(summariseFights(fights).winRate, null, 'no closed fights means no rate, not 0%');
});

test('switching from a boss room to a monster room is two fights, not one', () => {
  const fights = fightOutcomes([
    dec('boss', { hp: 200 }), dec('rewards'), dec('map'), dec('monster', { hp: 30 }), dec('rewards'),
  ]);
  assert.deepEqual(fights.map(f => [f.type, f.outcome]), [['boss', 'won'], ['monster', 'won']]);
});

test('the summary reports a real rate and splits by type', () => {
  const fights = fightOutcomes([
    dec('boss', { hp: 200 }), dec('rewards'),
    dec('boss', { hp: 200 }), runEnd(17),
    dec('monster', { hp: 30 }), dec('rewards'),
  ]);
  const s = summariseFights(fights);
  assert.equal(s.total, 3);
  assert.equal(s.won, 2);
  assert.equal(s.lost, 1);
  assert.equal(s.unresolved, 0);
  assert.equal(Number((s.winRate * 100).toFixed(1)), 66.7);
  assert.deepEqual(s.byType.boss, { total: 2, won: 1, lost: 1, unresolved: 0, winRate: 0.5 });
  assert.deepEqual(s.byType.monster, { total: 1, won: 1, lost: 0, unresolved: 0, winRate: 1 });
});

test('a malformed log does not throw and does not invent a fight', () => {
  const fights = fightOutcomes([null, {}, { kind: 'decision' }, { kind: 'decision', state: {} }, runEnd()]);
  assert.equal(fights.length, 0, 'no combat screen means no fight, and no exception either');
});

test('ascension is recorded ON the fight, and unknown is not the difficulty 0', () => {
  // A0 and A10 fights pooled into one rate move for reasons that have nothing to do with the
  // policy. In the real corpus every boss win is A0 and both A10 boss fights are losses, so a
  // pooled 42% hides the only fact worth acting on.
  const withAsc = (asc) => (type, o = {}) => ({ ...dec(type, o), state: { ...dec(type, o).state, run: { ascension: asc } } });
  const events = [
    withAsc(0)('boss', { hp: 200 }), withAsc(0)('rewards'),
    withAsc(10)('boss', { hp: 200 }), runEnd(17),
    dec('monster', { hp: 30 }), dec('rewards'),   // no run block at all -> unknown
  ];
  const s = summariseFights(fightOutcomes(events));
  assert.deepEqual(s.byAscension['0'], { total: 1, won: 1, lost: 0, unresolved: 0, winRate: 1 });
  assert.deepEqual(s.byAscension['10'], { total: 1, won: 0, lost: 1, unresolved: 0, winRate: 0 });
  assert.equal(s.byAscension.unknown.total, 1, 'a missing ascension is its own bucket, not 0');
  assert.deepEqual(
    s.atAscension['10'].boss,
    { total: 1, won: 0, lost: 1, unresolved: 0, winRate: 0 },
    'the hard difficulty must be reportable on its own',
  );
});

test('a fight records WHEN and ON WHAT CODE it was played, and a mid-fight upgrade does not fork it', () => {
  // The guard for the mistake that cost iteration 63: a corpus spanning many versions of the
  // codebase answered "how are we doing" with a blend of old and new, and 94 warnings from a
  // parser fixed days earlier read as a live bug. A fight that cannot name its code version can
  // be misread forever, so the stamp is part of the record rather than something the caller
  // remembers to join.
  const stamped = (t, sha) => ({ time: t, code: { sha }, ...dec('boss', { hp: 100 }) });
  const fights = fightOutcomes([
    stamped('2026-09-23T10:00:00.000Z', 'aaa111'),
    stamped('2026-09-23T10:01:00.000Z', 'aaa111'),
    // the process was rebuilt mid-fight. The fight did not end, so it does not split, and it is
    // attributed to the code it STARTED on — a fight half-played by two versions is not a fight
    // half-played by either.
    stamped('2026-09-30T10:00:00.000Z', 'bbb222'),
    dec('rewards'),
  ]);
  assert.equal(fights.length, 1, 'a code change mid-fight is not a new fight');
  assert.equal(fights[0].code, 'aaa111');
  assert.equal(fights[0].day, '09-23');
  assert.equal(fights[0].decisions, 3);

  const two = fightOutcomes([
    stamped('2026-09-23T10:00:00.000Z', 'aaa111'), dec('rewards'),
    stamped('2026-09-30T10:00:00.000Z', 'bbb222'), dec('rewards'),
  ]);
  assert.equal(two.length, 2);
  assert.equal(two[1].code, 'bbb222');
  assert.equal(two[1].day, '09-30');
});

test('decisions written before the code stamp are unstamped, not attributed to the newest sha', () => {
  // Folding unstamped records into whatever version is current would silently credit old runs to
  // new code — the exact conflation the stamp exists to prevent.
  const s = summariseFights(fightOutcomes([dec('boss', { hp: 50 }), dec('rewards')]));
  assert.deepEqual(Object.keys(s.byCode), ['unstamped']);
  assert.equal(s.byCode.unstamped.won, 1);
  assert.deepEqual(s.byCode.unstamped.days, [null]);
});

test('byCode groups and names the days each version played, so old and new never blend', () => {
  const at = (t, sha, dirty = 0) => ({ time: t, code: { sha, dirty }, ...dec('monster', { hp: 40 }) });
  const s = summariseFights(fightOutcomes([
    at('2026-09-24T09:00:00.000Z', 'aaa111'), dec('rewards'),
    at('2026-09-24T09:01:00.000Z', 'aaa111'), dec('rewards'),
    at('2026-09-30T09:00:00.000Z', 'bbb222'), dec('rewards'),
    at('2026-09-30T09:01:00.000Z', 'bbb222'), dec('rewards'),
  ]));
  assert.equal(s.byCode['aaa111 dirty=0'].total, 2);
  assert.deepEqual(s.byCode['aaa111 dirty=0'].days, ['09-24']);
  assert.equal(s.byCode['bbb222 dirty=0'].total, 2);
  assert.deepEqual(s.byCode['bbb222 dirty=0'].days, ['09-30']);
});

test('byCode splits one sha at two dirty counts, because a dirty tree is not that commit', () => {
  // The key here was sha alone while `server.mjs:100` records `dirty` beside every sha precisely so
  // an unreproducible run is identifiable. Keying on the commit merged two different policies into
  // one bucket and reported it as one version — the identical mistake fixed in abImpact and
  // overrideImpact, in the third reader that groups by code.
  const at = (t, sha, dirty) => ({ time: t, code: { sha, dirty }, ...dec('monster', { hp: 40 }) });
  const s = summariseFights(fightOutcomes([
    at('2026-09-30T09:00:00.000Z', 'ccc333', 2), dec('rewards'),
    at('2026-09-30T09:01:00.000Z', 'ccc333', 5), dec('rewards'),
  ]));
  assert.deepEqual(Object.keys(s.byCode), ['ccc333 dirty=2', 'ccc333 dirty=5'],
    'two working trees, two versions, not one');
});

test('an absent difficulty reports null rather than a 0% rate', () => {
  // 0 wins and 0 fights is not a failure and is not a success; it is no data.
  const s = summariseFights([]);
  assert.equal(s.winRate, null);
  assert.equal(s.atAscension.undefined, undefined);
  const only = summariseFights(fightOutcomes([dec('boss', { hp: 9 })]));
  assert.equal(only.atAscension.unknown.boss.winRate, null, 'no closed boss fight -> no rate');
});

test('a fight records the board at the moment it was lost, and how blind the agent was', () => {
  // The outcome says the fight was lost. These say what the agent was looking at, which is the
  // difference between "10 losses" and "10 losses for these five reasons".
  const enemy = (hp, intents) => ({ name: 'Waterfall Giant', hp, intents });
  const at = (hp, ph, intents) => ({
    kind: 'decision', outcome: 'executed',
    chosen: { forecast: { quality: 'unknown' } },
    state: { state_type: 'boss', battle: { enemies: [enemy(hp, intents)] }, player: { hp: ph, block: 0 } },
  });
  const events = [
    { ...at(240, 60, [{ type: 'Attack', label: '42' }]), chosen: { forecast: { quality: 'calculated' } } },
    at(20, 11, [{ type: 'Attack', label: '42' }]),
    runEnd(17),
  ];
  const [f] = fightOutcomes(events);
  assert.equal(f.outcome, 'lost');
  assert.equal(f.name, 'Waterfall Giant');
  assert.equal(f.startHp, 240);
  assert.equal(f.endHp, 11, 'the board is captured at the LAST decision, not the first');
  assert.deepEqual(f.intentLabels, ['42'], 'incoming damage is a string in intents[].label');
  assert.equal(f.multiHitIntents, 0);
  assert.equal(f.unknownForecasts, 1, 'exactly the decisions the planner refused to forecast');
});

test('a multi-hit Attack counts against parser coverage; a Buff with no label does not', () => {
  // This is the parser's coverage, measured on the real field. Reading `battle.intents` (which
  // does not exist) made this an empty array on every loss and it looked like a measurement.
  //
  // The distinction is not cosmetic. Counting every non-numeric label reported the agent as blind
  // on 47% of all decisions — but 1589 of 4592 corpus intents are Buff/Defend/Summon/Stun whose
  // label is empty BECAUSE they telegraph no damage. Counting those made a correct screen look
  // like a failed parse.
  const at = (type, label) => ({
    kind: 'decision', outcome: 'executed', chosen: { forecast: { quality: 'unknown' } },
    state: { state_type: 'monster', battle: { enemies: [{ name: 'Nibbit', hp: 40, intents: [{ type, label }] }] }, player: { hp: 20, block: 0 } },
  });
  const f = fightOutcomes([
    at('Attack', '12'), at('Buff', ''), at('Attack', '3x3 (9)'), at('Defend', ''), runEnd(3),
  ])[0];
  assert.deepEqual(f.intentLabels, [''], 'intentLabels is the board at death: the LAST turn');
  assert.equal(f.multiHitIntents, 1, 'only the 3x3 Attack counts; the two empty non-damage telegraphs do not');
  assert.equal(f.intentsSeen, 4);
  assert.equal(f.unknownForecasts, 4);
});

test('an empty intent list is distinguishable from an unparsed one', () => {
  // Otherwise "the enemy telegraphed nothing" and "we failed to read the telegraph" print the same.
  const bare = { kind: 'decision', outcome: 'executed', chosen: {}, state: { state_type: 'monster', battle: { enemies: [{ name: 'X', hp: 1, intents: [] }] }, player: { hp: 5 } } };
  const [f] = fightOutcomes([bare, runEnd(2)]);
  assert.deepEqual(f.intentLabels, []);
  assert.equal(f.multiHitIntents, 0, 'no intent is not an unreadable intent');
});

// The resource lens. Half the combat deaths happen with a hand that cannot block, while the agent
// blocks when it can — the first thing this project has measured that the decision layer cannot fix
// by choosing differently.
import { fatalPosition } from './metrics.mjs';

const c = (type, { hp = 20, energy = 1, hand = [], label = 'Strike' } = {}) => ({
  kind: 'decision', outcome: 'executed', chosen: { label },
  state: { state_type: type, battle: { enemies: [{ name: 'X', hp: 50 }] }, player: { hp, energy, hand } },
});
const end = () => ({ kind: 'run_end', state: { run: { act: 1, floor: 3 } } });

test('a hand with no block card is counted, and a hand with one is counted separately', () => {
  // The FATAL board is what is measured. Two deaths, so both shapes appear.
  const r = fatalPosition([
    c('elite', { hand: [{ name: 'Strike', cost: 1 }, { name: 'Strike', cost: 1 }] }),
    end(),
    c('elite', { hand: [{ name: 'Defend', cost: 1 }], label: 'Defend' }),
    end(),
  ]);
  assert.equal(r.deaths, 2);
  assert.equal(r.noBlockCard, 1, 'one death with a hand that cannot block');
  assert.equal(r.hadBlockCard, 1);
  assert.equal(r.blockAffordable, 1);
  assert.equal(r.choseBlock, 1, 'and a block was played when one was reachable');
});

test('an unaffordable block card does not count as a way to survive', () => {
  // Bash is a 2-cost attack. At 1 energy it is not a block the agent can reach, and counting it
  // would have hidden the real half of these deaths behind a regex.
  const r = fatalPosition([c('boss', { energy: 1, hand: [{ name: 'Bash', cost: 2 }] }), end()]);
  assert.equal(r.noBlockCard, 0, 'a block card was in hand');
  assert.equal(r.blockAffordable, 0, 'but not one the agent could pay for');
  assert.equal(r.hadBlockCard, 1);
});

test('a run_end with no combat board before it is not counted', () => {
  assert.equal(fatalPosition([c('map'), end()]).deaths, 0);
});
