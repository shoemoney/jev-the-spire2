// Outcome attribution: joins every logged decision to what the game actually did next.
//
// factored.mjs ships WEIGHTS = {move:.25, safe:.25, progress:.25, waste:1} under the comment
// "Equal thirds because there is no labelled data yet to justify anything else." THIS FILE IS THAT DATA.
//
// THE RULE THIS FILE EXISTS TO KEEP: a label is emitted only where a named field in the log shows what
// the action did. Everywhere else the value is null and `label.reasons` says which observation was
// missing. A fabricated neutral 0 is worse than a null, because a fitter cannot tell the two apart and
// will fit against the invented 0 as if it were measured - a whole run's worth of evidence that never
// happened would enter the weights. Measured zeros are kept and stay distinguishable: they carry the
// field path that proves the observation, a non-trivial confidence, and a sampleWeight, and the summary
// counts them apart from the unobserved.
//
// THREE FACTS ABOUT THE LOG THIS IS BUILT ON (measured on the 5 runs in .private/spire-runs, 769 decisions):
//
// 1. Only plan[0] runs. The mod executes `chosen.command`, one command per decision, and re-asks. Run 1's
//    first fight: a 3-step plan claiming forecast.damage 14, observed enemy HP 47 -> 41. Comparing observed
//    damage against a multi-step plan's forecast under-credits every plan longer than one step. For a
//    single-step plan the comparison agrees on 152/161 rows, so it is only used there.
// 2. `state.battle.turn` is the PHASE NAME ("player" or null), not an index. Only `state.battle.round`
//    numbers a turn. Reading `turn` as a turn index makes every row in the log claim to be turn "player".
// 3. A dead enemy is simply absent from the next `battle.enemies`, not marked dead. So the most valuable
//    progress signal - a kill - is the one that is hardest to measure, and enemies that VANISH or HEAL
//    both make a raw HP sum lie. Every damage figure here counts only entities present in both snapshots.
//
// TWO THINGS A FITTER HAS TO KNOW BEFORE USING THESE ROWS:
//
// `progress` measures REALISED against CLAIMED, because that is the only comparison the log supports. A plan
// that did exactly what it said scores +1 even if the thing it did was mediocre, and a plan that under-delivered
// scores negative even when the under-delivery was a forecast bug. It is a fidelity axis, not a value axis.
// `summary.forecastAccuracy` carries the other half, and the two are never combined here.
//
// `waste` is never -1. "The cost was repaid" is the progress axis's finding, and scoring it on two axes lets a
// single good attack count twice in a fit. The scale keeps the -1 slot for a lasting cost whose payoff is
// observable, which this log cannot supply: the failure mode factored.mjs describes (Bloodletting on an empty
// hand, Fortifier, Pact's End) appears once in 519 combat decisions here, so almost every waste label is 0 or
// null and that is the honest size of the evidence, not a bug in the axis.

import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const ATTRIBUTION_VERSION = 'outcome-attribution-v1';

const COMBAT_STATES = new Set(['monster', 'elite', 'boss']);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
// One decimal is enough resolution for a [-1,1] label and keeps the JSONL-readable output small.
const r3 = v => (typeof v === 'number' && Number.isFinite(v) ? Number(v.toFixed(3)) : null);
const roomKeyOf = st => `${st?.state_type ?? 'unknown'}:${num(st?.run?.act) ?? '?'}/${num(st?.run?.floor) ?? '?'}`;

const cmdSig = c => [c?.action ?? '', c?.card_index ?? '', c?.index ?? '', c?.target ?? ''].join('|');
const intentSig = enemies => (enemies ?? []).map(e => (e.intents ?? []).map(i => `${i.type}:${i.label}`).join(',')).join(';');
const enemyIds = (map, into) => { for (const id of map.keys()) into.push(id); return into; };

/** Split a raw event stream into runs. A `run_end` event closes one; without it no death is observable. */
function splitRuns(events) {
  const runs = [];
  let cur = {id: null, startedAt: null, endedAt: null, end: null, result: null, decisions: []};
  for (const [i, ev] of (events ?? []).entries()) {
    if (ev?.kind === 'run_end') {
      const st = ev.state ?? {};
      cur.endedAt = ev.time ?? null;
      cur.end = ev;
      cur.result = num(st.player?.hp) === 0 ? 'death' : 'ended';
      // Same id shape as learning/memory.mjs parseRunLog, so both halves of this loop name runs alike.
      cur.id = `${ev.time ?? 'run_end'}-${num(st.run?.act) ?? '?'}-${num(st.run?.floor) ?? '?'}`;
      runs.push(cur);
      cur = {id: null, startedAt: null, endedAt: null, end: null, result: null, decisions: []};
    } else if (ev?.kind === 'decision') {
      if (cur.id === null) { cur.id = `open-${ev.time ?? i}`; cur.startedAt = ev.time ?? null; }
      cur.decisions.push({ev, index: i});
    }
  }
  // An unterminated trailing run is kept, but with result=null: a log cut off mid-run shows no death.
  if (cur.decisions.length) runs.push(cur);
  return runs;
}

// A room is a maximal run of consecutive decisions sharing state_type + act/floor. Grouping consecutive
// rather than by key alone means a floor revisited later in a run is never merged into the earlier fight.
function groupRooms(run) {
  const rooms = [];
  for (const d of run.decisions) {
    const key = roomKeyOf(d.ev.state);
    const last = rooms[rooms.length - 1];
    if (last && last.key === key) { last.list.push(d); continue; }
    rooms.push({key, isCombat: COMBAT_STATES.has(d.ev.state?.state_type), list: [d]});
  }
  return rooms;
}

function snapshot(ev) {
  const st = ev?.state ?? {}, p = st.player ?? {}, b = st.battle ?? {};
  return {
    hp: num(p.hp), maxHp: num(p.max_hp), block: num(p.block), energy: num(p.energy),
    potions: Array.isArray(p.potions) ? p.potions.length : null,
    playerStatus: Array.isArray(p.status) ? p.status.length : null,
    enemies: new Map((Array.isArray(b.enemies) ? b.enemies : []).map(e => [e.entity_id, e])),
    intents: intentSig(b.enemies),
    round: num(b.round), turnPhase: b.turn ?? null,
  };
}

/**
 * The number the ENGINE claimed for the step that actually ran.
 *
 * Single-step plans: `chosen.forecast.damage` is the claim, and it agrees with observation on 152/161 of
 * the real log's single-step rows. Longer plans: the engine offered a single-step candidate carrying the
 * identical command in 146/146 measured cases, and that candidate's forecast is the claim for the step
 * that ran - still a forecast, cited by path and weighted lower. No comparable claim means no progress
 * score, rather than a score against a number that was never about this action.
 */
function damageClaim(chosen, candidates) {
  const fc = chosen?.forecast ?? null;
  const planLength = Array.isArray(chosen?.plan) ? chosen.plan.length : null;
  if (num(fc?.damage) !== null && planLength === 1) {
    return {value: fc.damage, source: 'planForecast', path: 'chosen.forecast.damage', confident: true};
  }
  const twins = (candidates ?? []).filter(c => (Array.isArray(c.plan) ? c.plan.length : null) === 1 &&
    cmdSig(c.command) === cmdSig(chosen?.command) && num(c.forecast?.damage) !== null);
  if (twins.length) {
    const i = (candidates ?? []).indexOf(twins[0]);
    return {value: twins[0].forecast.damage, source: 'singleStepCandidate', path: `candidates[${i}].forecast.damage`, confident: false};
  }
  return {value: null, source: null, path: null, confident: false};
}

// The observation window: the next decision in the SAME room, or the fact that there is none.
// A combat room followed by a non-combat state means the fight ended and the game moved on to rewards or
// the map - a win, read off the log rather than inferred from the step that is missing. A combat room with
// nothing after it means the run stopped there, and only the run_end event can say whether that was death.
function windowOf(rooms, ri, pos) {
  const room = rooms[ri], d = room.list[pos];
  if (pos + 1 < room.list.length) return {inRoom: true, d, next: room.list[pos + 1], roomCleared: false, afterRun: null};
  const after = rooms[ri + 1] ?? null;
  return {
    inRoom: false, d, next: null, afterRun: after ? after.list[0] : null,
    roomCleared: !!(after && !after.isCombat), afterIsCombat: !!(after && after.isCombat),
  };
}

/** Every delta the log can actually support between two in-room observations. */
function observe(a, b) {
  const out = {
    hpBefore: a.hp, hpAfter: b.hp,
    // Whether this window contains a single player action or a whole round. It decides what may be read off
    // it: between two plays the world stands still, so an intent change is the card's doing. Across a round
    // boundary the enemy has acted, so the same change is the enemy's own re-planning and blaming the card for
    // it would score every end_turn as if it had neutralised something.
    sameTurn: a.round != null && b.round != null ? a.round === b.round : null,
    actualHpLoss: a.hp !== null && b.hp !== null ? a.hp - b.hp : null,
    damageDealt: null, damageToBlock: null, damageUnobservable: null,
    blockGained: a.block !== null && b.block !== null ? b.block - a.block : null,
    energySpent: a.energy !== null && b.energy !== null ? a.energy - b.energy : null,
    potionSpent: a.potions !== null && b.potions !== null ? a.potions - b.potions : null,
    intentChanged: null, enemyStatusAdded: false, playerStatusAdded: false,
    targetsLost: [], enemiesJoined: [], enemyHealed: false, enemyBlockGained: false,
  };
  if (out.actualHpLoss === null) { out.damageUnobservable = 'state.player.hp is missing on one side of the window'; return out; }
  let hp = 0, blk = 0, present = 0;
  for (const [id, before] of a.enemies) {
    const after = b.enemies.get(id);
    if (!after) { out.targetsLost.push(id); continue; }
    present++;
    hp += Math.max(0, before.hp - after.hp);
    blk += Math.max(0, num(before.block) - num(after.block));
    if (after.hp > before.hp) out.enemyHealed = true;
    if (num(after.block) > num(before.block)) out.enemyBlockGained = true;
  }
  out.damageDealt = present ? hp : null;
  out.damageToBlock = present ? blk : null;
  out.intentChanged = a.intents !== b.intents;
  out.enemyStatusAdded = [...a.enemies].some(([id, e]) => (b.enemies.get(id)?.status ?? []).length > (e.status ?? []).length);
  out.playerStatusAdded = a.playerStatus !== null && b.playerStatus !== null && b.playerStatus > a.playerStatus;
  out.enemiesJoined = enemyIds(b.enemies, []);
  if (present === 0 && a.enemies.size) out.damageUnobservable = 'no enemy is present in both observations; the enemies changed identity between them';
  return out;
}

// What the action was, decided by what it OBSERVED rather than by what its card claimed to be.
function actionKindOf(chosen, obs) {
  const action = chosen?.command?.action ?? 'unknown';
  if (action === 'end_turn') return 'end_turn';
  if (action === 'use_potion') return 'potion';
  if (action !== 'play_card') return 'other';
  if ((obs?.damageDealt ?? 0) > 0) return 'attack';
  if ((obs?.blockGained ?? 0) > 0) return 'block';
  const t = chosen?.details?.type;
  return t === 'Attack' ? 'attack' : t === 'Skill' ? 'skill' : t === 'Power' ? 'power' : t === 'Status' ? 'status' : 'other';
}

// A payoff this decision can be held to. Deliberately excludes intent changes and enemy statuses unless the
// window holds a single player action - see observe().sameTurn.
const payoffOf = obs => (obs?.damageDealt ?? 0) > 0 || (obs?.damageToBlock ?? 0) > 0 || (obs?.blockGained ?? 0) > 0 ||
  obs?.playerStatusAdded === true || (obs?.sameTurn === true && (obs.intentChanged === true || obs.enemyStatusAdded === true));
const payoffList = obs => [
  (obs.damageDealt ?? 0) > 0 ? `${obs.damageDealt} enemy HP removed` : null,
  (obs.damageToBlock ?? 0) > 0 ? `${obs.damageToBlock} enemy block removed` : null,
  (obs.blockGained ?? 0) > 0 ? `${obs.blockGained} block gained` : null,
  obs.sameTurn === true && obs.intentChanged ? 'an enemy intent changed' : null,
  obs.sameTurn === true && obs.enemyStatusAdded ? 'a debuff landed' : null,
].filter(Boolean).join(', ');

// --------------------------------------------------------------------------------------------------------- turns

function turnGroups(room) {
  const groups = [];
  for (const d of room.list) {
    const round = num(d.ev.state?.battle?.round);
    const last = groups[groups.length - 1];
    if (last && last.round === round) { last.list.push(d); continue; }
    groups.push({round, list: [d]});
  }
  return groups;
}

// A turn's outcome is only observable across a round boundary: between two plays the world does not move,
// and the enemy phase that resolves `forecast.incoming` lands between the last play of round N and the first
// decision of round N+1. That pair is also the only place the run's deaths can be seen, and it is not the
// same pair as the play's own window - so the two are kept apart.
function turnResolution(groups, gi) {
  const g = groups[gi], nxt = groups[gi + 1];
  if (!nxt) return {observed: false, reason: 'no later round was observed in this room'};
  const last = g.list[g.list.length - 1];
  const a = snapshot(last.ev), b = snapshot(nxt.list[0].ev);
  const fc = last.ev.chosen?.forecast ?? null;
  const hpLost = a.hp !== null && b.hp !== null ? a.hp - b.hp : null;
  const closing = observe(a, b);
  // Enemy HP removed by the PLAYER during this turn, summed over the turn's own same-turn windows. Not the
  // closing decision's window, which spans the enemy phase: reading only that window makes a turn that dealt
  // plenty of damage look like a turn that dealt none, and every "HP paid for nothing" verdict inherits it.
  let turnEnemyHpRemoved = 0, unclean = closing.targetsLost.length > 0 || closing.enemyHealed === true;
  for (let i = 0; i < g.list.length - 1; i++) {
    const w = observe(snapshot(g.list[i].ev), snapshot(g.list[i + 1].ev));
    if (w.damageDealt === null) { unclean = true; continue; }
    turnEnemyHpRemoved += w.damageDealt;
    if (w.targetsLost.length || w.enemyHealed) unclean = true;
  }
  return {
    observed: true, round: g.round, closedBy: last.index,
    hpLost, hpAfter: b.hp, survived: hpLost === null ? null : b.hp > 0,
    blockAtEnd: a.block, blockAfter: b.block,
    forecastIncoming: num(fc?.incoming), forecastHpLoss: num(fc?.hpLoss), forecastSurvives: fc?.survives ?? null,
    forecastQuality: fc?.quality ?? null,
    turnEnemyHpRemoved, turnUnclean: unclean,
    source: `state.player.hp ${a.hp}->${b.hp} across state.battle.round ${g.round}->${num(nxt.round)}`,
  };
}

// ------------------------------------------------------------------------------------------------------- labels

function labelSurvival({run, obs, res, closesTurn, lethal}) {
  if (lethal) return {value: -1, confidence: 0.7, reason: null, evidence: `this decision handed over to the death: run ${run.id} ended with state.player.hp 0`};
  if (obs === null) return {value: null, confidence: 0, reason: 'no in-room next observation: the room ended on this decision'};
  if (!res || !res.observed) {
    return {value: null, confidence: 0, reason: `turn outcome not observed (${res?.reason ?? 'unknown'}): survival cannot be read from the log`};
  }
  const lost = res.hpLost;
  if (closesTurn) {
    if (lost === 0 && res.forecastIncoming !== null && res.forecastIncoming > 0) {
      return {value: 1, confidence: 0.85, reason: null, evidence: `${res.source}: observed HP loss 0 against forecast.incoming ${res.forecastIncoming}`};
    }
    if (lost === 0) return {value: 0, confidence: 0.6, reason: null, evidence: `${res.source}: observed HP loss 0, and no incoming attack was forecast`};
    return {value: 0, confidence: 0.8, reason: null, evidence: `${res.source}: observed HP loss ${lost}, the player survived the turn`};
  }
  if ((obs.blockGained ?? 0) > 0) {
    if (lost === 0 && res.forecastIncoming !== null && res.forecastIncoming > 0) {
      return {value: 1, confidence: 0.6, reason: null, evidence: `state.player.block +${obs.blockGained} here, and ${res.source} shows HP loss 0 against forecast.incoming ${res.forecastIncoming}`};
    }
    if (lost > 0) {
      // Block that is simply outgunned is not a survival failure: absorbing 5 of 13 is the block doing its job,
      // and calling it a mistake would train the weights against blocking at all. The one case that IS a
      // failure is enough block sitting on the board when the HP still went - and that is at least as likely a
      // forecast error as a bad decision, which is why the confidence sits low and the evidence says so.
      const held = res.blockAtEnd ?? 0, incoming = res.forecastIncoming;
      if (incoming !== null && held >= incoming) {
        return {value: -1, confidence: 0.5, reason: null, evidence: `state.player.block +${obs.blockGained} here and ${res.blockAtEnd} block was on the board against forecast.incoming ${incoming}, yet ${res.source} still lost ${lost} HP`};
      }
      return {value: 0, confidence: 0.5, reason: null, evidence: `state.player.block +${obs.blockGained} here absorbed part of the incoming; ${res.source} lost ${lost} HP with ${held} block against forecast.incoming ${incoming}`};
    }
    return {value: 0, confidence: 0.4, reason: null, evidence: `state.player.block +${obs.blockGained} here, turn resolved with no HP loss and no forecast incoming`};
  }
  return {value: 0, confidence: 0.3, reason: null, evidence: `no block gained (state.player.block delta ${obs.blockGained ?? 'n/a'}) and no HP paid (state.player.hp delta ${obs.actualHpLoss ?? 'n/a'}); ${res.source} resolved at HP loss ${lost}`};
}

function labelProgress({obs, claim, roomCleared, closesRoom, lethal, targetLost}) {
  if (lethal) return {value: null, confidence: 0, reason: 'the run ended on this decision; no in-room observation of what the room then did'};
  if (closesRoom && roomCleared) return {value: 1, confidence: 0.7, reason: null, evidence: 'this decision ended the fight: the next state is a non-combat state_type with state.player.hp > 0'};
  if (obs === null) return {value: null, confidence: 0, reason: 'no in-room next observation, so the damage this action dealt is unobservable'};
  if (obs.sameTurn === false) {
    return {value: null, confidence: 0, reason: 'the window spans the enemy phase (state.battle.round advanced), so the enemy HP change belongs to the enemy, not to this decision'};
  }
  // The chosen target is gone from the next state, so whatever happened to it - a kill, a Thorns, a departure -
  // left no field behind. Scoring 0 damage here is how a killing blow gets filed as a plan that did nothing.
  if (targetLost) {
    return {value: null, confidence: 0, reason: `the chosen target ${targetLost} is absent from the next battle.enemies, so the damage dealt to it is unobservable (it may well have died)`};
  }
  if (obs.damageUnobservable) return {value: null, confidence: 0, reason: `damage unobservable: ${obs.damageUnobservable}`};
  const dealt = obs.damageDealt ?? 0;
  const claimed = claim.value;
  const absorbed = (obs.damageToBlock ?? 0) > 0 ? `, with a further ${obs.damageToBlock} absorbed by state.battle.enemies[].block` : '';
  if (claimed === null) {
    if (dealt > 0) {
      return {value: 1, confidence: 0.5, reason: null, evidence: `state.battle.enemies[].hp fell by ${dealt} in this window, but no comparable forecast claim exists (${claim.source ?? 'no single-step claim'}), so this is a payoff without a benchmark`};
    }
    return {value: null, confidence: 0, reason: 'the plan forecast carries no damage claim and no damage was observed, so neither credit nor blame has a field behind it'};
  }
  if (claimed > 0) {
    const v = clamp(2 * (dealt / claimed) - 1, -1, 1);
    return {
      value: r3(v), confidence: claim.confident ? 0.9 : 0.7, reason: null,
      evidence: `${claim.path} claimed ${claimed} for the executed step; state.battle.enemies[].hp fell by ${dealt}${absorbed}`,
    };
  }
  // The claim is zero damage, so progress has to be non-damage: a neutralised intent or an applied debuff.
  if (obs.intentChanged || obs.enemyStatusAdded) {
    return {value: 1, confidence: 0.7, reason: null, evidence: `${claim.path} claimed 0 damage; the payoff is visible in battle.enemies[].intents (changed=${obs.intentChanged}) and .status (added=${obs.enemyStatusAdded})`};
  }
  if ((obs.blockGained ?? 0) > 0 || obs.playerStatusAdded) {
    return {value: 0, confidence: 0.6, reason: null, evidence: `${claim.path} claimed 0 damage; observed state.player.block +${obs.blockGained ?? 0} and no enemy change`};
  }
  return {value: null, confidence: 0, reason: 'no damage claimed, no block gained and no enemy change observed'};
}

function labelWaste({obs, res, closesTurn, forecast}) {
  if (obs === null) return {value: null, confidence: 0, reason: 'no in-room next observation, so the payoff for anything spent is unobservable'};
  const spentHP = obs.actualHpLoss > 0;
  const spentEnergy = (obs.energySpent ?? 0) > 0;
  // Only a same-turn window can carry a cost the decision itself paid. Across the enemy phase the HP delta is
  // damage RECEIVED, so the self-harm rule must not fire there - reading it that way labels every turn that
  // actually took a hit as self-harm, which is how 95% of end_turn decisions came out as pure waste.
  if (obs.sameTurn === true && spentHP && !payoffOf(obs)) {
    return {value: 1, confidence: 0.9, reason: null, evidence: `state.player.hp -${obs.actualHpLoss} in this same-turn window with no block gained, no enemy HP or block removed, no intent change and no status applied`};
  }
  // A cost this decision paid. Across the enemy phase the HP delta is damage received, so it is not a cost
  // and an end_turn that simply took a hit has spent nothing that could be wasted.
  const spentCost = (obs.sameTurn === true && spentHP) || spentEnergy || (obs.potionSpent ?? 0) > 0;
  // Turn-level self-harm: HP was actually paid and no enemy lost HP anywhere in the turn. Gated on the turn
  // being clean, because an enemy that vanished or healed can hide real damage behind a zero sum.
  if (closesTurn && res?.observed && res.hpLost > 0 && res.turnEnemyHpRemoved === 0 && res.turnUnclean === false && res.forecastHpLoss !== null && res.forecastHpLoss > 0) {
    return {value: 1, confidence: 0.7, reason: null, evidence: `${res.source}: ${res.hpLost} HP paid against forecast.hpLoss ${res.forecastHpLoss} with state.battle.enemies[].hp unchanged across the whole turn`};
  }
  if (spentCost) {
    if (!payoffOf(obs)) {
      // The tempting label here is waste +1 for "a card played that changed nothing", and it is the wrong
      // one: 21 of the 33 in-window no-payoff rows in the real log are cards whose payoff is delayed ("At the
      // end of combat, gain 30 Gold", "At the start of your turn, gain 1 energy", "Draw 6 cards"), which this
      // log cannot observe at all. Scoring them as waste would teach the weights to punish exactly the cards
      // that pay off later, so the row is flagged for review instead of scored.
      return {
        value: null, confidence: 0, deferred: true,
        reason: 'a resource was spent and nothing is visible in-window; absence of a payoff is not evidence of waste, because a delayed payoff (end of combat, next turn) is unobservable here',
      };
    }
    return {value: 0, confidence: 0.7, reason: null, evidence: `spent ${obs.energySpent > 0 ? `${obs.energySpent} energy` : 'HP or a potion'} and converted it into a measured payoff (${payoffList(obs)})`};
  }
  return {value: null, confidence: 0, reason: 'no energy and no HP were spent, so there is nothing here that could be wasted'};
}
// --------------------------------------------------------------------------------------------------- attribution

/**
 * Turn a parsed event stream into one labelled row per logged decision.
 *
 * Every row exists, including the ones that get no label, because "we looked and there was nothing" and
 * "we never looked" are different facts and a fitter has to be able to count the second one.
 */
export function attributeDecisions(events) {
  const rows = [];
  for (const run of splitRuns(events)) {
    const rooms = groupRooms(run);
    for (const [ri, room] of rooms.entries()) {
      const groups = turnGroups(room);
      // Every decision in the room needs its round group, not just the first one in it: a play in the middle
      // of a turn is judged against that turn's resolution just as much as the end_turn that closed it.
      const giOf = new Map(groups.flatMap((g, i) => g.list.map(d => [d.index, i])));
      for (const [pos, d] of room.list.entries()) {
        rows.push(buildRow({run, room, rooms, ri, pos, d, groups, giOf}));
      }
    }
  }
  return rows;
}

function buildRow({run, room, rooms, ri, pos, d, groups, giOf}) {
  const ev = d.ev, st = ev.state ?? {}, chosen = ev.chosen ?? null, forecast = chosen?.forecast ?? null;
  const win = windowOf(rooms, ri, pos);
  const closesRoom = pos === room.list.length - 1;
  const executed = ev.outcome === 'executed';
  // The run stopping in this room, with the run_end event reporting 0 HP, is the only death evidence there is.
  const lethal = closesRoom && !win.afterRun && run.result === 'death';

  const a = snapshot(ev);
  const obs = win.inRoom ? observe(a, snapshot(win.next.ev)) : null;
  const res = room.isCombat && giOf.has(d.index) ? turnResolution(groups, giOf.get(d.index)) : null;
  const closesTurn = !!res && res.observed && res.closedBy === d.index;

  const claim = damageClaim(chosen, ev.candidates);
  // The chosen target's fate is the one that matters, and a vanished enemy is the commonest way damage becomes
  // unobservable in this log: a dead enemy simply is not in the next state.
  const targetLost = chosen?.command?.target && obs?.targetsLost?.includes(chosen.command.target) ? chosen.command.target : null;
  // The run's LAST room is where the death happened; every decision in it sits inside a lethal window, but
  // only the decision the run stopped on actually handed over to it. The room-level flag is kept beside
  // `lethal` so a fitter can weight the room without being told those decisions all killed the run.
  const inLethalRoom = room.isCombat && ri === rooms.length - 1 && run.result === 'death';
  const notExecuted = {value: null, confidence: 0, reason: `outcome ${ev.outcome}: nothing was executed, so there is no consequence to attribute`};
  const notCombat = why => ({value: null, confidence: 0, reason: `state_type ${st.state_type ?? 'unknown'} ${why}`});

  const survival = !room.isCombat
    ? notCombat('is not a combat state; the survival axis is defined over state.player.hp across a combat round')
    : !executed ? notExecuted
      : labelSurvival({run, obs, res, closesTurn, lethal});
  const progress = !room.isCombat
    ? notCombat('has no battle.enemies; the progress axis is defined over observed enemy HP')
    : !executed ? notExecuted
      : labelProgress({obs, claim, roomCleared: win.roomCleared, closesRoom, lethal, targetLost});
  const waste = !room.isCombat
    ? notCombat('has no in-room window, so nothing spent there could be checked for a payoff')
    : !executed ? notExecuted
      : labelWaste({obs, res, closesTurn, forecast});

  const axisConfidence = {survival: r3(survival.confidence), progress: r3(progress.confidence), waste: r3(waste.confidence)};
  const labelled = Object.entries(axisConfidence).filter(([k]) => ({survival, progress, waste})[k].value !== null);
  // A row's weight is bounded by its WEAKEST labelled axis. Weighting by the strongest would let a row with
  // one well-observed axis carry a null axis into a fit as if both were measured.
  const sampleWeight = r3(labelled.length ? Math.min(...labelled.map(([, c]) => c)) : 0);
  const confidence = r3(labelled.length ? sampleWeight : 0);

  return {
    index: d.index, runId: run.id, stateType: st.state_type ?? 'unknown',
    act: num(st.run?.act), floor: num(st.run?.floor), ascension: num(st.run?.ascension),
    // state.battle.turn is the phase name, not a number. See fact 2 in the header.
    turn: num(st.battle?.round), turnPhase: st.battle?.turn ?? null,
    room: room.key, loggedOutcome: ev.outcome ?? null,
    chosenId: chosen?.id ?? null, chosenLabel: chosen?.label ?? null,
    action: chosen?.command?.action ?? null, actionKind: actionKindOf(chosen, obs), cardType: chosen?.details?.type ?? null,
    target: chosen?.command?.target ?? null,
    targetName: chosen?.command?.target ? (a.enemies.get(chosen.command.target)?.name ?? null) : null,
    candidatesOffered: ev.candidates?.length ?? 0,
    forecast: {
      quality: forecast?.quality ?? null,
      predictedHpLoss: num(forecast?.hpLoss), incoming: num(forecast?.incoming),
      incomingExact: num(forecast?.incoming), survives: forecast?.survives ?? null,
      damage: num(forecast?.damage), block: num(forecast?.block), hpAfter: num(forecast?.hpAfter),
      damageClaim: claim.value, damageClaimSource: claim.source, damageClaimPath: claim.path,
    },
    jevConfidence: num(ev.answer?.confidence), jevChoice: ev.answer?.choice ?? null,
    outcome: {
      hpBefore: obs?.hpBefore ?? a.hp, hpAfter: obs?.hpAfter ?? null,
      actualHpLoss: obs?.actualHpLoss ?? null, damageDealt: obs?.damageDealt ?? null,
      damageToBlock: obs?.damageToBlock ?? null, damageTaken: obs?.actualHpLoss == null ? null : Math.max(0, obs.actualHpLoss),
      // Whether this window is one player action or a whole round. Everything about the enemy is unreadable
      // across a round boundary, which is why it is published rather than left for a fitter to guess.
      sameTurn: obs?.sameTurn ?? null,
      blockGained: obs?.blockGained ?? null, energySpent: obs?.energySpent ?? null, potionSpent: obs?.potionSpent ?? null,
      survivedTurn: closesTurn ? (res?.observed ? res.survived : null) : lethal ? false : null,
      lethal, inLethalRoom,
      // Only a combat room being followed by a non-combat state is a cleared fight. Claiming it for the
      // rewards and map screens would inflate the count with rows that were never fights.
      roomCleared: room.isCombat && closesRoom ? win.roomCleared : false,
      runEnded: closesRoom && !win.afterRun,
      intentChanged: obs?.intentChanged ?? null, targetsLost: obs?.targetsLost ?? [], enemyHealed: obs?.enemyHealed ?? null,
      turn: res && res.observed ? {hpLost: res.hpLost, survived: res.survived, blockAtEnd: res.blockAtEnd, forecastIncoming: res.forecastIncoming, forecastHpLoss: res.forecastHpLoss, forecastSurvives: res.forecastSurvives, source: res.source} : null,
    },
    label: {
      survival: survival.value, progress: progress.value, waste: waste.value,
      confidence, sampleWeight, axisConfidence,
      // True when a cost was spent, nothing was observable in-window, and the row was refused a waste label
      // rather than guessed at. Present so the refusals can be found without re-reading every rationale.
      deferred: !!(waste.deferred || progress.deferred),
      reasons: {survival: survival.reason, progress: progress.reason, waste: waste.reason},
    },
    evidence: {survival: survival.evidence, progress: progress.evidence, waste: waste.evidence},
    rationale: [survival.evidence, progress.evidence, waste.evidence].filter(Boolean).join(' | ') ||
      [survival.reason, progress.reason, waste.reason].filter(Boolean).join(' | '),
  };
}

/**
 * Did a rejected candidate have a strictly better FORECAST than the one that ran?
 *
 * This is a forecast comparison and nothing else. The rejected plans were never played, so their real
 * outcomes are unknowable from this log; treating a better forecast as a better outcome is the counterfactual
 * this file refuses to invent. Kept because it is the one signal that can say the picker left something on
 * the table without pretending to know what the something was worth.
 */
export function wastedPotentialOf(ev) {
  const chosen = ev.chosen ?? null, fc = chosen?.forecast ?? null;
  if (!fc || !Array.isArray(ev.candidates)) return null;
  const chosenKey = [fc.survives ? 1 : 0, num(fc.hpAfter) ?? -1, num(fc.damage) ?? -1];
  // A chosen forecast with no numbers in it is an ABSENT forecast, not a bad one. Ranking it against a real
  // candidate would call 72 of the 206 hits a missed opportunity when the engine had simply declined to
  // answer (forecast.quality "unknown", which is 160 rows of the final rooms where it died). Counted apart.
  if (chosenKey[1] === -1 && chosenKey[2] === -1 && chosenKey[0] === 0) {
    return {kind: 'chosenForecastAbsent', betterOn: [], alternativeForecast: null, chosenForecast: {survives: fc.survives ?? null, hpAfter: num(fc.hpAfter), damage: num(fc.damage)}};
  }
  // Pareto dominance, not strict superiority: an alternative that is better on safety and no worse on damage
  // is the one worth flagging. Requiring it to beat the chosen plan on every axis at once hides almost every
  // real trade, because the whole point of a second candidate is that it trades something.
  const key = f => [f?.survives ? 1 : 0, num(f?.hpAfter) ?? -1, num(f?.damage) ?? -1];
  const better = ev.candidates.filter(c => c.id !== chosen.id && c.forecast && key(c.forecast).every((v, i) => v >= chosenKey[i]) && key(c.forecast).some((v, i) => v > chosenKey[i]));
  if (!better.length) return null;
  const best = better.reduce((a, b) => (key(b.forecast).some((v, i) => v > key(a.forecast)[i]) ? b : a));
  return {
    kind: 'dominated', id: best.id, label: best.label ?? null,
    chosenForecast: {survives: fc.survives ?? null, hpAfter: num(fc.hpAfter), damage: num(fc.damage)},
    alternativeForecast: {survives: best.forecast.survives ?? null, hpAfter: num(best.forecast.hpAfter), damage: num(best.forecast.damage)},
    betterOn: ['survives', 'hpAfter', 'damage'].filter((k, i) => key(best.forecast)[i] > chosenKey[i]),
  };
}

// ------------------------------------------------------------------------------------------------------ summary

const mean = xs => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(3)) : null);

// Counts per axis, and the mean both unweighted and weighted by sampleWeight. `measuredZero` is kept
// beside `unobserved` on purpose: a 0 with a field path behind it is evidence, and a fitter must be able to
// tell it from the rows that were never observed.
function axisStats(values) {
  const present = values.filter(v => v !== null && v !== undefined);
  return {
    labelled: present.length, unobserved: values.length - present.length,
    measuredZero: present.filter(v => v === 0).length,
    positive: present.filter(v => v > 0).length, negative: present.filter(v => v < 0).length,
    mean: mean(present),
  };
}

function groupStats(rows, keyOf) {
  const buckets = new Map();
  for (const r of rows) {
    const k = keyOf(r);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  const out = {};
  for (const [k, list] of buckets) {
    out[k] = {
      rows: list.length,
      // Share of rows in this bucket carrying any evidence-backed axis. The count beside it is the point:
      // a mean over a handful of rows is not a finding.
      attributable: Number((list.filter(r => ['survival', 'progress', 'waste'].some(a => r.label[a] !== null)).length / list.length).toFixed(3)),
      meanSampleWeight: r3(list.reduce((a, r) => a + r.label.sampleWeight, 0) / list.length),
      survival: axisStats(list.map(r => r.label.survival)),
      progress: axisStats(list.map(r => r.label.progress)),
      waste: axisStats(list.map(r => r.label.waste)),
    };
  }
  return out;
}

/**
 * Aggregate health of a labelled set. The share of rows that are attributable is the headline number here,
 * not the means: a mean over 12 rows is not a finding, and printing it without the count is how a fitted
 * weight ends up resting on three data points.
 */
export function summarizeAttribution(labelled) {
  const rows = labelled ?? [];
  const combat = rows.filter(r => COMBAT_STATES.has(r.stateType));
  const isLabelled = r => ['survival', 'progress', 'waste'].some(a => r.label[a] !== null);
  const reasons = {};
  for (const r of rows) {
    for (const a of ['survival', 'progress', 'waste']) {
      const why = r.label.reasons?.[a];
      if (why) reasons[why] = (reasons[why] ?? 0) + 1;
    }
  }

  // Only a turn whose outcome was actually observed can score the forecast that claimed it. A row with no
  // resolved turn is left out of this count rather than counted as a miss. Keyed by the turn, not the row:
  // every play in a turn resolves the same enemy phase, so counting rows would report 327 "turns" for 118.
  const turnKey = r => `${r.runId}|${r.room}|${r.outcome?.turn?.source}`;
  const byTurn = new Map();
  for (const r of rows) {
    if (r.forecast.predictedHpLoss === null || r.outcome?.turn?.hpLost == null) continue;
    if (!byTurn.has(turnKey(r))) byTurn.set(turnKey(r), r);
  }
  const resolvedTurns = [...byTurn.values()];
  const survivesChecks = resolvedTurns.filter(r => r.forecast.survives !== null);


  return {
    version: ATTRIBUTION_VERSION,
    rows: rows.length,
    runs: new Set(rows.map(r => r.runId)).size,
    runsThatEndedInDeath: new Set(rows.filter(r => r.outcome?.lethal).map(r => r.runId)).size,
    combatRows: combat.length,
    nonCombatRows: rows.length - combat.length,
    combatByType: {monster: combat.filter(r => r.stateType === 'monster').length, elite: combat.filter(r => r.stateType === 'elite').length, boss: combat.filter(r => r.stateType === 'boss').length},
    loggedOutcomes: rows.reduce((a, r) => { a[r.loggedOutcome ?? 'unknown'] = (a[r.loggedOutcome ?? 'unknown'] ?? 0) + 1; return a; }, {}),
    rowsWithNothingExecuted: rows.filter(r => r.loggedOutcome !== 'executed').length,
    attributable: {
      // A row counts as attributable if ANY axis carries an evidence-backed value.
      rows: rows.filter(isLabelled).length,
      share: rows.length ? Number((rows.filter(isLabelled).length / rows.length).toFixed(3)) : null,
      combatShare: combat.length ? Number((combat.filter(isLabelled).length / combat.length).toFixed(3)) : null,
      meanSampleWeight: r3(rows.reduce((a, r) => a + r.label.sampleWeight, 0) / Math.max(1, rows.length)),
      perAxis: {
        survival: axisStats(rows.map(r => r.label.survival)),
        progress: axisStats(rows.map(r => r.label.progress)),
        waste: axisStats(rows.map(r => r.label.waste)),
      },
    },
    refusedBecause: Object.entries(reasons).sort((a, b) => b[1] - a[1]).map(([reason, n]) => ({n, reason})),
    byActionKind: groupStats(combat, r => r.actionKind),
    byStateType: groupStats(combat, r => r.stateType),
    // Boss vs normal, the split a weight fitter will actually ask for.
    byRoomRole: groupStats(combat, r => (r.stateType === 'boss' ? 'boss' : r.stateType === 'elite' ? 'elite' : 'normal')),
    byFloor: groupStats(rows, r => `${r.act}/${r.floor}`),
    byAscension: groupStats(rows, r => String(r.ascension)),
    // Rows where a resource was spent and nothing was observable in-window. Not scored, but named: this is the
    // review queue for anyone who wants to extend the waste axis to delayed payoffs.
    deferredPayoffRows: rows.filter(r => r.label.deferred).length,
    wastedPotential: (() => {
      // FORECAST COMPARISON ONLY. A rejected candidate was never played, so this is not an outcome claim.
      const dominated = rows.filter(r => r.wastedPotential?.kind === 'dominated').length;
      return {
        kind: 'forecast comparison only, not an outcome',
        rows: dominated,
        // Rows where the engine returned no usable numbers for the plan it ran. Excluded from the count above,
        // because a better forecast than an absent one is not a missed opportunity.
        chosenForecastAbsent: rows.filter(r => r.wastedPotential?.kind === 'chosenForecastAbsent').length,
        shareOfRows: rows.length ? Number((dominated / rows.length).toFixed(3)) : null,
        shareOfCombatRows: combat.length ? Number((dominated / combat.length).toFixed(3)) : null,
      };
    })(),
    forecastAccuracy: {
      // Observed HP loss across a resolved turn against the forecast that claimed it. A wrong forecast is not
      // a bad decision, which is exactly why it is reported here and never folded into a label. The two error
      // names are about the FORECAST, named by which way it was wrong rather than by which way it pointed.
      resolvedTurns: resolvedTurns.length,
      hpLossExact: resolvedTurns.filter(r => r.forecast.predictedHpLoss === r.outcome.turn.hpLost).length,
      // The forecast promised more damage than arrived: the turn turned out cheaper than advertised.
      pessimistic: resolvedTurns.filter(r => r.forecast.predictedHpLoss > r.outcome.turn.hpLost).length,
      // The forecast promised less damage than arrived: the turn cost more than advertised.
      optimistic: resolvedTurns.filter(r => r.forecast.predictedHpLoss < r.outcome.turn.hpLost).length,
      survivesChecked: survivesChecks.length,
      survivesAgreed: survivesChecks.filter(r => !!r.forecast.survives === !!r.outcome.turn.survived).length,
    },
    lethalWindows: {
      lethal: rows.filter(r => r.outcome?.lethal).length,
      inLethalRoom: rows.filter(r => r.outcome?.inLethalRoom).length,
      roomsCleared: rows.filter(r => r.outcome?.roomCleared).length,
    },
  };
}

/** Convenience: raw events -> labelled rows -> summary, with the wastedPotential pass folded in. */
export function attributeAndSummarize(events) {
  const rows = attributeDecisions(events);
  for (const r of rows) r.wastedPotential = wastedPotentialOf(events[r.index]);
  return {rows, summary: summarizeAttribution(rows)};
}

// ----------------------------------------------------------------------------------------------------------- CLI

export function parseJsonl(text) {
  const events = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* a torn final line is not a row */ }
  }
  return events;
}

const LOG_DIR = '.private/spire-runs';

export function resolveLogPath(explicit = process.argv[2] ?? process.env.SPIRE_RUN_LOG ?? null) {
  if (explicit) return resolve(explicit);
  const files = readdirSync(LOG_DIR).filter(f => f.endsWith('.jsonl')).sort();
  if (!files.length) return null;
  return resolve(LOG_DIR, files.at(-1));
}

const pad = (s, n) => String(s).padEnd(n);
const numOut = v => (v === null || v === undefined ? '  -  ' : String(v).padStart(5));
const axisLine = (name, s) => `  ${pad(name, 22)} ${numOut(s.labelled)} ${numOut(s.unobserved)} ${numOut(s.measuredZero)} ${numOut(s.positive)} ${numOut(s.negative)} ${numOut(s.mean)}`;

function printSummary(events, path) {
  const {rows, summary} = attributeAndSummarize(events);
  const w = (l = '') => console.log(l);
  w(`outcome attribution  ${ATTRIBUTION_VERSION}`);
  w(`log  ${path}`);
  w(`rows ${summary.rows}   runs ${summary.runs} (ended in death ${summary.runsThatEndedInDeath})   combat ${summary.combatRows}   non-combat ${summary.nonCombatRows}`);
  w(`combat by type  monster ${summary.combatByType.monster}  elite ${summary.combatByType.elite}  boss ${summary.combatByType.boss}`);
  w('');
  w(`ATTRIBUTABLE  ${summary.attributable.rows}/${summary.rows} rows (${pct(summary.attributable.share)})   of combat rows ${pct(summary.attributable.combatShare)}   mean sampleWeight ${summary.attributable.meanSampleWeight}`);
  w('  axis                 labelled  unobsv  zeros    pos    neg    mean');
  for (const a of ['survival', 'progress', 'waste']) w(axisLine(a, summary.attributable.perAxis[a]));
  w('');
  w('BY ACTION KIND (combat rows only)');
  w('  kind            rows   surv    prog   waste   |  labelled rows  surv  prog waste');
  for (const [k, v] of Object.entries(summary.byActionKind).sort((a, b) => b[1].rows - a[1].rows)) {
    w(`  ${pad(k, 12)} ${numOut(v.rows)} ${numOut(v.survival.mean)} ${numOut(v.progress.mean)} ${numOut(v.waste.mean)}   |  ${numOut(v.survival.labelled)} ${numOut(v.progress.labelled)} ${numOut(v.waste.labelled)}`);
  }
  w('');
  w('BY ROOM ROLE (normal = monster)');
  for (const [k, v] of Object.entries(summary.byRoomRole)) {
    w(`  ${pad(k, 12)} rows ${numOut(v.rows)}  surv ${numOut(v.survival.mean)} (${v.survival.labelled})  prog ${numOut(v.progress.mean)} (${v.progress.labelled})  waste ${numOut(v.waste.mean)} (${v.waste.labelled})`);
  }
  w('');
  w('BY ASCENSION');
  for (const [k, v] of Object.entries(summary.byAscension)) {
    w(`  asc ${pad(k, 6)} rows ${numOut(v.rows)}  attributable ${numOut(v.attributable)}  prog mean ${numOut(v.progress.mean)} (${v.progress.labelled})`);
  }
  w('');
  w('BY FLOOR');
  for (const [k, v] of Object.entries(summary.byFloor).sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, {numeric: true}))) {
    w(`  ${pad(k, 8)} rows ${numOut(v.rows)}  attributable ${numOut(v.attributable)}  surv ${numOut(v.survival.mean)} (${v.survival.labelled})  prog ${numOut(v.progress.mean)} (${v.progress.labelled})`);
  }
  w('');
  w('REFUSED TO LABEL, and why');
  for (const r of summary.refusedBecause.slice(0, 12)) w(`  ${numOut(r.n)}  ${r.reason}`);
  w('');
  const f = summary.forecastAccuracy;
  w(`FORECAST vs OUTCOME (kept separate on purpose)`);
  w(`  resolved turns ${f.resolvedTurns}   hpLoss exact ${f.hpLossExact}   pessimistic (promised more pain than arrived) ${f.pessimistic}   optimistic (promised less) ${f.optimistic}   survives agreed ${f.survivesAgreed}/${f.survivesChecked}`);
  w(`  wastedPotential ${summary.wastedPotential.rows} rows (${pct(summary.wastedPotential.shareOfCombatRows)} of combat)  -  ${summary.wastedPotential.kind}`);
  w(`  and ${summary.wastedPotential.chosenForecastAbsent} more rows where the chosen plan's own forecast carried no numbers, so no alternative could be called better`);
  w(`  spent with no in-window payoff, refused a waste label: ${summary.deferredPayoffRows} rows`);
  w('');
  w(`LETHAL  decisions that handed over to the death ${summary.lethalWindows.lethal}   decisions inside a room where the run died ${summary.lethalWindows.inLethalRoom}   decisions that closed a cleared room ${summary.lethalWindows.roomsCleared}`);
  return {rows, summary};
}

const pct = v => (v === null || v === undefined ? '  n/a' : `${Math.round(v * 100)}%`);

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const path = resolveLogPath();
  if (!path) {
    console.error(`No run log found. Pass a path, set SPIRE_RUN_LOG, or put a .jsonl in ${LOG_DIR}/.`);
    process.exit(1);
  }
  printSummary(parseJsonl(readFileSync(path, 'utf8')), path);
}

export default {attributeDecisions, summarizeAttribution, attributeAndSummarize, wastedPotentialOf, parseJsonl, resolveLogPath, ATTRIBUTION_VERSION};
