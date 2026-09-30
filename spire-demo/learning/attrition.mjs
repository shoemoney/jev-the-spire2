// ATTRITION — two rates observed from the fight the agent is already in, compared as counts.
//
// The finding this exists for: across 18 lost fights, ZERO had a forecast saying `survives:false`
// in their first three decisions, and only 11% of decisions in a lost fight sat in a known-lethal
// state. The per-turn forecast is a verdict about THIS turn and the danger is cumulative, so the
// agent played every turn as though the fight were fine and then died on the turn it could not
// survive. This is the same failure class as every other bug this project has found — a number that
// is technically correct and practically misleading.
//
//   turnsToLive = hp / damageTakenPerTurn
//   turnsToKill = enemyHp / damageDealtPerTurn
//   losing on attrition  <=>  turnsToLive < turnsToKill
//
// NOTHING HERE IS INVENTED. Both rates are counted from observations of this fight, and the verdict
// is a comparison of two quotients. It is arithmetic on what the game has already said, exactly like
// `incomingMax` — a derived fact rather than a judgement about whether the agent is playing well.
//
// WHAT IT DELIBERATELY DOES NOT DO
// - It does not say the fight is WON. Running out of turns is a loss, not a win, and saying otherwise
//   would be the same confident-unsupported number this project exists to reject.
// - It does not judge the deck, the draws, or the agent's choices. It compares two rates.
// - On the first turn there is no rate yet, so it reports `unknown`. A first turn is not evidence of
//   anything, and a verdict invented from one observation is the bug, not the fix.

/** Minimum observations before a rate means anything. One turn is a sample of one. */
const MIN_TURNS = 2;

/**
 * Fold one observed turn into a running fight record.
 * @param {object} fight  accumulator, or null to start one
 * @param {{hp:number, dealt:number, enemyHp:number}} turn  what was observed at the END of that turn
 */
export function observeTurn(fight, turn) {
  const hp = Number(turn?.hp);
  const dealt = Number(turn?.dealt) || 0;
  const enemyHp = Number(turn?.enemyHp);
  if (!Number.isFinite(hp)) return fight;
  const next = fight ? { ...fight, turns: fight.turns + 1, dealt: fight.dealt + Math.max(0, dealt) } : {turns: 1, dealt: Math.max(0, dealt), startHp: hp, lastHp: hp, startEnemyHp: Number.isFinite(enemyHp) ? enemyHp : null, lastEnemyHp: Number.isFinite(enemyHp) ? enemyHp : null};
  next.lastHp = hp;
  if (Number.isFinite(enemyHp)) next.lastEnemyHp = enemyHp;
  // Damage actually absorbed this fight, from the first reading to now. Observed, never assumed.
  next.taken = Math.max(0, (next.startHp ?? hp) - hp);
  return next;
}

/**
 * The verdict. Returns a statement, never a plan.
 * @returns {{status:string, turnsToLive:number|null, turnsToKill:number|null, ...}}
 */
export function attrition(fight) {
  const unknown = (why) => ({status: 'unknown', why, turnsObserved: fight?.turns ?? 0});
  if (!fight || fight.turns < MIN_TURNS) return unknown('not enough turns observed to have a rate');
  const hp = fight.lastHp;
  if (!Number.isFinite(hp) || hp <= 0) return unknown('the player is already dead');
  const enemyHp = fight.lastEnemyHp;
  if (!Number.isFinite(enemyHp) || enemyHp <= 0) return unknown('the enemy is already down');

  const perTurnTaken = fight.taken / fight.turns;
  const perTurnDealt = fight.dealt / fight.turns;

  // A rate of zero is a FACT worth reporting, not a divide-by-zero to hide behind. If the agent has
  // taken nothing, turnsToLive is unbounded; saying so plainly beats inventing a number.
  const turnsToLive = perTurnTaken > 0 ? hp / perTurnTaken : null;
  const turnsToKill = perTurnDealt > 0 ? enemyHp / perTurnDealt : null;

  const base = {
    hp, enemyHp, perTurnTaken: round(perTurnTaken), perTurnDealt: round(perTurnDealt),
    turnsToLive: turnsToLive === null ? null : round(turnsToLive),
    turnsToKill: turnsToKill === null ? null : round(turnsToKill),
    turnsObserved: fight.turns,
  };
  if (turnsToLive === null) return {...base, status: 'unknowable', why: 'no damage has been taken yet, so there is no rate'};
  if (turnsToKill === null) return {...base, status: 'unknowable', why: 'no damage has been dealt yet, so there is no rate'};
  const margin = turnsToLive - turnsToKill;
  if (turnsToLive < turnsToKill) {
    return {...base, status: 'losing-on-attrition', why: `at the observed rate this fight has ${round(turnsToLive)} turns of life left and needs ${round(turnsToKill)} to finish the enemy`, margin: round(margin)};
  }
  return {...base, status: 'out-lasting-the-enemy', why: `at the observed rate there is enough life (${round(turnsToLive)} turns) to finish the enemy (${round(turnsToKill)} turns)`, margin: round(margin)};
}

const round = n => Math.round(n * 10) / 10;

/**
 * The sentence that rides in the request. One line, plain, and it says nothing the numbers do not.
 * Kept out of the ranking entirely — this informs, it does not score.
 */
export function attritionLine(a) {
  if (!a || a.status === 'unknown') return '';
  if (a.status === 'unknowable') return ` Fight arithmetic is not yet available: ${a.why}.`;
  if (a.status === 'losing-on-attrition') {
    return ` THIS FIGHT IS BEING LOST ON TIME, not on any single turn: ${a.why}. Every turn that does not cut into the enemy shortens the life that has to cover the rest of the fight.`;
  }
  return ` Fight arithmetic: ${a.why}.`;
}
