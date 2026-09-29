// Single-call factored decisions.
//
// deliberate() asks Jev 2-5 times in SERIES (assess, review, then conditional
// end-turn / merchant / card-order passes). Measured on a live run: p50 5.7s,
// max 30s, while one isolated call answers in ~300ms. The round trips are the
// cost, not the model.
//
// Jev evaluates every question in one request in parallel and in isolation, so
// questions are close to free. Measured on a captured combat state from
// .private/spire-runs, same state, same candidates:
//
//    1 question  -> 0.50s  7209 tokens  $0.000303
//   13 questions -> 0.81s  7979 tokens  $0.000335
//   25 questions -> 0.45s  8709 tokens  $0.000366
//   29 questions -> 0.54s  8953 tokens  $0.000376
//
// So we send ONE request carrying the broad `move` choice plus two narrow nouls
// per candidate, and combine them here, where the weights are ours to tune and
// the reasoning is inspectable in the decision log.
//
// This follows TypeSafe's own guidance: Jev is a System One model, so a judgment
// needing several independent factors is decomposed into several System One
// questions and recombined in code, rather than asked as one broad question.

import { decisionQuestion } from './planner.mjs';
import { decisionFocus } from './decision-focus.mjs';
import { deckAssessment, deckUnavailableInstruction } from './deck-assessment.mjs';
import { compactRequest } from './compact-request.mjs';
import { refuseLethalChoice, completeFactors } from './learning/lethal-gate.mjs';

// v2 adds the safety gate and the refuse-to-recombine guard, routes the `move`
// question through decisionFocus, and rephrases the per-candidate nouls on boards
// with no battle.
//
// THE NOUL REPHRASING BREAKS COLLECTED FACTORS. Every safe/progress/waste noul
// recorded under v1 was the meaning of THAT sentence. A non-combat board now asks a
// different question than it used to, so a v1 reading and a v2 reading of `safe_a3`
// are not two measurements of one quantity - they are measurements of two different
// quantities filed under one key. Rows already stored in learning/attribute.mjs must
// be split by policy version before any of them is fitted against the other; a fitter
// handed the union will read the wording change as a relationship. The combat wording
// is byte-identical to v1, so combat rows stay comparable within their own board types.
export const FACTORED_VERSION = 'jev-single-call-factored-v2';

// A choice distribution over N candidates and an independent noul are not on the
// same scale: with 30 candidates the best `move` probability may be 0.20 while a
// noul sits at 0.95. Jev's documented failure mode 9 warns that a threshold
// tuned on one question type does not carry to another, so each signal is
// min-max normalised across the candidates before any of them are combined.
//
// Equal thirds because there is no labelled data yet to justify anything else.
// Weighting `move` above the others also double-counts survival, since the broad
// question already folds safety in, which let a pure-block line beat one that
// both survived and killed. To set these honestly, log decisions with the
// factors attached, label the runs that died, and fit the weights against that;
// until then an unequal split would be a guess wearing a number.
// `waste` is SUBTRACTED. It exists because the first version of this file scored
// 6/10 on the benchmark while the original policy's long review prose scored
// higher: every failure was a self-harm or dead-setup trap (Bloodletting on an
// empty hand, Fortifier, Pact's End). Those are a cost question, not a safety or
// progress question, so they need their own axis rather than more instruction
// text bolted onto the broad one.
// Swept 2026-09-23 over 14 configs on the 10 scored benchmark fixtures, then the
// two leaders re-run at n=100 each. Results, against the original multi-call
// `deliberate` policy measured on the same fixtures:
//
//   policy                    score      p50     calls
//   deliberate (original)     24/30      758ms   2.40
//   equal weights, waste 1/3  88/100     290ms   1.00
//   THIS (waste 1.0)          90/100     325ms   1.00
//
// waste at 1.0 makes the penalty a veto rather than a vote. It removes every
// self-harm failure (empty-hand Bloodletting, Fortifier), which the original
// policy still fails 3 times in 10. See ../SWEEP-FINDINGS.md, including the one
// fixture this loses on.
export const WEIGHTS = { move: 0.25, safe: 0.25, progress: 0.25, waste: 1 };

// Bounds the request. Every candidate always keeps its `move` probability; only
// the extra per-candidate nouls are capped, so nothing becomes unpickable.
//
// Was 28, which silently switched the factoring OFF on the most crowded boards.
// Measured on a live run: 6% of decisions exceeded it and 7% of all candidates
// received no factor questions at all. It cost a run. At 7 HP against three
// Inklets telegraphing 17 damage, the top three candidates came back
// `safe=None prog=None waste=None` with confidence 0, so the pick was decided by
// nothing, and the agent died two decisions later.
//
// Raising it is close to free. Same 53-candidate board, four samples each:
//
//   cap 10   31 questions  18236 tok  $0.000766  median 487ms
//   cap 28   85 questions  23096 tok  $0.000970  median 457ms
//   cap 53  160 questions  29846 tok  $0.001254  median 491ms
//
// 160 questions answer as fast as 31 because Jev evaluates them in parallel.
// 64 sits above the largest board observed (53) while leaving headroom under the
// 64k request context; raise it further only with a token measurement in hand.
const MAX_FACTORED_CANDIDATES = 64;

// A factor only gets a vote when it actually separated the candidates. Observed
// on the beckon-play fixture: safe spanned 0.07-0.13, progress 0.05-0.08, waste
// 0.80-0.87. Plain min-max stretches a 0.01 raw difference into a full 0-to-1
// swing, so a factor with no opinion ends up deciding the ranking on noise.
// Below DEADBAND of raw spread the factor returns neutral for everyone and
// contributes nothing.
export const DEADBAND = 0.15;

function normalise(values, deadband = DEADBAND) {
  const present = [...values.values()].filter(v => typeof v === 'number');
  if (!present.length) return new Map();
  const lo = Math.min(...present), hi = Math.max(...present);
  const span = hi - lo;
  if (span < deadband) return new Map([...values].map(([id, v]) => [id, typeof v !== 'number' ? null : 0.5]));
  return new Map([...values].map(([id, v]) =>
    [id, typeof v !== 'number' ? null : (v - lo) / span]));
}

// The same three nouls in two phrasings, because one phrasing cannot be right for
// both kinds of board.
//
// v1 asked every candidate on every board whether it would "survive the displayed
// incoming attack this turn", whether it achieved "securing a kill", and whether a
// payoff needed "a card, a target, an energy amount or a number of remaining turns".
// There is no displayed incoming attack, no kill and no turn on a map board. The cost
// was measurable: at the act-1 floor-12 decision that chose an Elite, safe spanned
// 0.120, progress 0.090 and waste 0.080 - every one under DEADBAND of 0.15 - so all
// three factors returned a uniform 0.5 and the two Elites were ranked on the `move`
// probability alone, with no survival axis anywhere in the decision. The board had HP,
// potions, node `type` and `leads_to` in it the whole time and none of it was asked
// about. The non-combat phrasing asks what the board can actually answer: surviving the
// room being entered, and what the visible `leads_to` and HP say about it.
const COMBAT_NOULS = {
  safe: 'Given `state`, does taking the candidate identified by `candidate` leave the player able to survive the displayed incoming attack this turn? Answer no if it leaves lethal or near-lethal damage unblocked. Answer no if the candidate is not a legal action here.',
  progress: 'Given `state`, does taking the candidate identified by `candidate` make real progress toward winning the run, such as securing a kill, applying a debuff that pays off, or spending energy efficiently? Answer no if it merely survives the turn without advancing.',
  waste: 'Given `state`, does the candidate identified by `candidate` pay a lasting cost whose payoff cannot actually be collected here? Costs include losing HP, exhausting or discarding cards, and spending energy on setup. Answer yes if the payoff needs a card, a target, an energy amount or a number of remaining turns that the visible state does not supply, or if it forgoes an available decisive play such as a kill. Answer no when the payoff is collectable now.',
};

// On a non-combat board `safe` is about the ROOM, not a turn: HP and potions against
// what entering costs, judged from the node type and the visible `leads_to` chain. It
// must not say "incoming attack this turn" - there is no turn - because a question the
// board cannot answer is answered from priors, and priors are not evidence.
//
// THE VOCABULARY MUST MATCH THE BOARD. This text is about a MAP: `leads_to`, node
// `type`, the visible path. Spraying it over every non-combat screen is the same defect
// one level down - a shop or a card reward has no nodes and no leads_to, so the model
// is asked to reason from a structure that is not in the payload and answers from
// priors. `isCombat()` is false for EVERYTHING non-combat, so routing all of it here
// leaked map vocabulary onto 94 of the 119 non-combat decisions in the recorded run
// (card_reward 25, rewards 34, event 13, rest_site 9, shop 6, card_select 4,
// hand_select 3). A board that is not a map gets the neutral screen phrasing, which
// names nothing the board does not have.
const MAP_NOULS = {
  safe: 'Given `state`, does taking the candidate identified by `candidate` leave the player able to survive the room being entered and the rooms it visibly leads to? Judge it from current HP against `max_hp`, held potions, and the `type` and `leads_to` of the nodes on the visible path; count a forced fight after a rest site as a fight before the rest site, not after it. Answer no if it walks into a room this player cannot currently survive. Answer no if the candidate is not a legal action here.',
  progress: 'Given `state`, does taking the candidate identified by `candidate` make real progress toward winning the run, such as advancing toward the boss, reaching a reward or upgrade, or spending gold on something the deck needs? Answer no if it merely leaves the run where it already was. Judge only from visible rooms, visible connections and current resources; unknown rooms stay unknown.',
  waste: 'Given `state`, does the candidate identified by `candidate` pay a lasting cost whose payoff cannot actually be collected here? Costs include spending gold, using a potion, discarding or declining a permanent improvement, and taking a room that forces a harder fight later. Answer yes if the payoff needs gold, a potion slot, a reward or a room that the visible state does not supply, or if it forgoes an available decisive option. Answer no when the payoff is collectable now.',
};

// For every non-combat screen that is not the map. Says what the candidate DOES, in
// terms the screen actually supplies, and never names a node, a path or a deck.
const SCREEN_NOULS = {
  safe: 'Given `state`, does taking the candidate identified by `candidate` leave the player able to afford it, with current HP against `max_hp`, the resources the screen spends, and the risk the visible state states? Judge only from what `state` supplies about this screen. Answer no if the candidate is not a legal action here, or if the visible state states a cost this player cannot currently pay. If the screen states nothing about risk, answer from what it does state rather than from a general prior.',
  progress: 'Given `state`, does taking the candidate identified by `candidate` make real progress toward winning the run on THIS screen - taking a lasting improvement, resolving something that is actually resolved, or moving the run forward - rather than leaving the run exactly as it was? Judge only from what `state` supplies on this screen. Answer no if it merely declines an available improvement for no stated reason.',
  waste: 'Given `state`, does the candidate identified by `candidate` pay a lasting cost whose payoff cannot actually be collected here? Costs include spending gold or a potion, discarding something, or declining a lasting improvement. Answer yes if the payoff needs a card, a target, a gold amount or a number of remaining turns that the visible state does not supply, or if it forgoes an available decisive option. Answer no when the payoff is collectable now.',
};

const isMapBoard = state => state?.state_type === 'map';

export const isCombat = state => ['monster', 'elite', 'boss'].includes(state?.state_type);

export function factoredQuestion(state, candidates, { maxFactored = MAX_FACTORED_CANDIDATES, waste = true } = {}) {
  const base = decisionQuestion(state, candidates);
  const factored = candidates.slice(0, maxFactored);
  const questions = { ...base.questions };
  // The broad `move` question carries the screen's own criteria. decisionFocus holds
  // them for map, shop, campfire, card reward, hand select and divination; combat and
  // every other board fall through to `{name:'General', instructions:{}}` and are
  // left byte-identical, so the `move` distribution WEIGHTS was fitted against does
  // not move on the combat boards that fit produced.
  //
  // Without this, a map decision fell through to the generic text in actions.mjs,
  // which never mentions HP, survival or Elites. On the 2026-09-23 run that is the
  // whole story: at act1 floor 12, ascension 3, 67/75 HP, options
  // [Monster, Unknown, Monster, Elite, Elite], the policy took the Elite. At floor 13
  // with 10/75 HP the options were four Elites and an Unknown, and it took an Elite
  // and died.
  //
  // Only this board's own focus is applied. The Route block is NOT bolted onto every
  // board's `move` question: it would bias one distribution on shop, campfire and
  // card-reward screens too, and a screen-specific criterion is only an improvement
  // on the screen it was written for.
  // The card-reward focus is written entirely in terms of the permanent deck: "Compare every
  // offered card and Skip against the actual permanent deck... A small starter deck is not
  // automatically a strong deck." The bridge does not send one - `player.deck` is present in 0
  // of 775 logged records, so `deckAssessment` reports `available:false` on every card reward.
  // So the focus is SUPPRESSED on that board rather than supplemented: appending the correction
  // alongside it leaves a request that says both "judge against the actual deck" and "the deck is
  // not included", which is worse than either alone, because the model is asked to reconcile a
  // contradiction instead of reading a fact. `deckUnavailableInstruction` carries the same
  // take-or-skip judgement the focus was reaching for, grounded in what the board does supply.
  const deckAvailable = deckAssessment(state)?.available !== false;
  const focus = decisionFocus(state);
  if (focus.instructions.move) {
    if (state?.state_type === 'card_reward' && !deckAvailable) questions.move.instructions += ' ' + deckUnavailableInstruction;
    else questions.move.instructions += ' ' + focus.instructions.move;
  }
  const phrased = isCombat(state) ? COMBAT_NOULS : isMapBoard(state) ? MAP_NOULS : SCREEN_NOULS;
  for (const c of factored) {
    questions['safe_' + c.id] = { type: 'noul', instructions: { candidate: c.id, question: phrased.safe } };
    questions['prog_' + c.id] = { type: 'noul', instructions: { candidate: c.id, question: phrased.progress } };
    if (waste) questions['waste_' + c.id] = { type: 'noul', instructions: { candidate: c.id, question: phrased.waste } };
  }
  return { ...base, questions };
}

// Combines the three signals into one ranking. Returns the full working so the
// decision log shows why a candidate won, not just that it did.
//
// A factor nobody measured contributes NOTHING, and says so in the returned
// working. `normalise` hands back null for a candidate that has no answer, and
// the old `?? 0.5` swallowed that null and turned it into a full mid-confidence
// vote - indistinguishable from a candidate genuinely measured at 0.5. On the
// board in the DONE command that promoted a candidate nobody had asked about to
// the TOP of the ranking, on 0.125 of invented evidence.
//
// This is the rule learning/attribute.mjs was written to keep ("a fabricated
// neutral 0 is worse than a null, because a fitter cannot tell the two apart")
// and the one learning/wire.mjs applies to an `unknown` forecast: it counts in
// neither direction rather than inventing a claim. The scoring layer was doing
// the thing the labelling layer exists to prevent.
//
// THE THREE AXES DO NOT SHARE A RATIONALE, so they do not share a line:
//   safe / progress  -> 0. Silence, not a mid vote. These are ADDED, so the
//     fabricated 0.5 was pure upside for whoever went unmeasured - up to a
//     third of the whole score, on the two axes that decide whether the agent
//     survives and whether the run advances. Zero also keeps every weight
//     meaning its share of a fixed total. Reallocating a silent factor's weight
//     to the axes that did answer would invent a second, larger fabrication.
//   waste            -> 0 penalty, UNCHANGED. This one is SUBTRACTED, so 0 is
//     the fail-safe direction: an unmeasured cost blocks nothing. Charging a
//     cost we cannot substantiate would itself be an invented safety claim, and
//     at the shipped veto weight 1.0 a fabricated full penalty would let one
//     unanswered noul outrank a plan whose cost WAS measured and clean - the
//     exact inverse of preferring a plan the policy cannot evaluate.
//     The free pass is real and is why better-policy.mjs goes further and
//     refuses to score at all when factors are incomplete. That guard is left
//     where it is; this is the scoring layer, not the policy layer.
//
// Known interaction, kept rather than papered over: a factor that is BOTH
// deadbanded and partly unmeasured charges its uniform 0.5 to the candidates
// that were measured and 0 to the one that was not, so the unknown candidate
// sits 0.5*weight below a board the factor had no opinion on. Zeroing the
// deadband too would fix that and break the thing the deadband is for - every
// board's score and margin staying on one absolute scale no matter how many
// factors had an opinion.
const vote = (normalised, weight) => typeof normalised === 'number' ? normalised * weight : 0;

export function combine(candidates, answers, weights = WEIGHTS) {
  const move = answers.move;
  if (move?.type !== 'choice') throw new Error('Missing Jev move choice');
  const raw = new Map(), safe = new Map(), prog = new Map(), waste = new Map();
  for (const c of candidates) {
    raw.set(c.id, move.probabilities?.[c.id] ?? 0);
    safe.set(c.id, answers['safe_' + c.id]?.noul ?? null);
    prog.set(c.id, answers['prog_' + c.id]?.noul ?? null);
    waste.set(c.id, answers['waste_' + c.id]?.noul ?? null);
  }
  const nMove = normalise(raw), nSafe = normalise(safe), nProg = normalise(prog), nWaste = normalise(waste);
  const scored = candidates.map(c => {
    // `n` is the vote as the model gave it, null where there was no answer, so a
    // reader can see the zero-vote rather than infer it from a number that looks
    // measured. The check is one-directional and must stay so: `n[f] === null`
    // implies `parts[f] === 0`, but not the reverse, because a candidate that
    // measured LOWEST is a real vote that also lands on zero. `n`, `raw` and
    // `unknown` are what keep "measured zero" and "never asked" tellable apart.
    const n = { move: nMove.get(c.id) ?? null, safe: nSafe.get(c.id) ?? null,
      progress: nProg.get(c.id) ?? null, waste: nWaste.get(c.id) ?? null };
    const parts = {
      move: vote(n.move, weights.move),
      safe: vote(n.safe, weights.safe),
      progress: vote(n.progress, weights.progress),
      // `|| 0` folds the -0 that negating a zero vote produces, so an
      // unmeasured cost reads as 0 in the log rather than -0. No other value
      // changes: a real penalty stays negative and a real vote stays positive.
      waste: -vote(n.waste, weights.waste ?? 0) || 0,
    };
    return { id: c.id, label: c.label, parts, n,
      unknown: Object.keys(n).filter(f => n[f] === null),
      raw: { move: raw.get(c.id), safe: safe.get(c.id), progress: prog.get(c.id), waste: waste.get(c.id) },
      score: parts.move + parts.safe + parts.progress + parts.waste };
  }).sort((a, b) => b.score - a.score);

  // Tally for the decision log, because `ranking` only carries the top five and
  // an unmeasured candidate that landed sixth is otherwise invisible. The
  // 2026-09-23 live run had 7% of candidates with no factor answers at all.
  const unmeasured = {};
  for (const s of scored) for (const f of s.unknown) (unmeasured[f] ??= []).push(s.id);

  // The waste penalty can push a score below zero, so shift to non-negative
  // before normalising or the distribution stops being one.
  //
  // The shift is RELATIVE to the board's spread, not a flat 1e-6. Silencing an
  // unmeasured factor leaves bottom candidates sitting exactly ON the floor, and
  // a flat epsilon then gets rounded away by the 4dp below - a candidate at the
  // floor shares 1e-6 of ~0.25, i.e. 0.0000, and becomes unpickable. That is the
  // regression factored.test.mjs guards ("a capped candidate stays pickable"):
  // dropping the fabricated vote must not cost a candidate its reachability.
  const floor = Math.min(0, ...scored.map(s => s.score));
  const spread = Math.max(...scored.map(s => s.score)) - floor;
  const eps = Math.max(1e-6, spread * 1e-3);
  const shifted = scored.map(s => s.score - floor + eps);
  const total = shifted.reduce((sum, v) => sum + v, 0);
  const probabilities = Object.fromEntries(scored.map((s, i) =>
    [s.id, total > 0 ? Number((shifted[i] / total).toFixed(4)) : 1 / scored.length]));
  // Margin between first and second, not Jev's own confidence, which stays
  // under deliberation.jevMove so the two are never confused.
  const margin = scored.length > 1 ? scored[0].score - scored[1].score : 1;
  return { scored, probabilities, margin: Number(margin.toFixed(4)), unmeasured };
}

export async function factoredDeliberate({ state, candidates, ask, onStage = () => {}, weights = WEIGHTS, maxFactored = MAX_FACTORED_CANDIDATES }) {
  // One candidate is a forced choice, not a ranking, so there is no combination to
  // do. The gate still runs: with one candidate nothing can be swapped TO, so the only
  // honest verdicts are "no alternative existed" and "no claim was made", and both are
  // worth having. `deliberation` stays null here, which is why the verdict is published
  // on the result itself - a refusal that only ever reached the deliberation block
  // would be a refusal nobody could see on the one path that has no deliberation.
  if (candidates.length <= 1) {
    const result = await ask(compactRequest(decisionQuestion(state, candidates)));
    return { ...result, safetyGate: refuseLethalChoice(candidates[0]?.id ?? null, candidates, candidates), deliberation: null };
  }
  onStage('Jev is scoring every option in one pass');
  const wasteAsked = (weights.waste ?? 0) > 0;
  const result = await ask(compactRequest(factoredQuestion(state, candidates, { maxFactored, waste: wasteAsked })));
  const answers = result.answers ?? {};
  const jevMove = answers.move;
  if (jevMove?.type !== 'choice') throw new Error('Missing Jev move choice');

  // Only the factors that were actually ASKED can be complete. `waste_*` is not asked when
  // `weights.waste` is 0 - and `benchmark/sweep.mjs` ships exactly such an arm - so demanding
  // it unconditionally would report an incomplete board for every decision and quietly reduce
  // the policy to the broad answer forever, while still printing a score that looks fine.
  const askedPrefixes = wasteAsked ? ['safe_', 'prog_', 'waste_'] : ['safe_', 'prog_'];

  // Refuse to recombine a board the model only half-answered. Falling back to the broad
  // `move` answer is not a downgrade in confidence - it is the only reading on this
  // board that is not assembled from missing factors - and `factorFallback` says so in
  // the log rather than leaving a clean ranking and a confident margin to be read as
  // evidence. See learning/lethal-gate.mjs for the measurement behind this.
  const factorsComplete = completeFactors(candidates, answers, askedPrefixes);
  const combined = factorsComplete ? combine(candidates, answers, weights) : null;
  const probabilities = combined ? combined.probabilities : (jevMove.probabilities ?? null);
  const confidence = combined ? combined.margin : (jevMove.confidence ?? null);
  const proposed = factorsComplete ? combined.scored[0].id : jevMove.choice;
  if (!candidates.some(c => c.id === proposed)) throw new Error('Invalid factored choice');

  // The gate is independent of the guard above and runs on both paths. It is walked over
  // the recombine ranking, so a swap lands on the best-scoring PROVEN survivor rather
  // than the first one in the candidate list; on a fallback, where no ranking exists, it
  // walks the candidate list and says so in `safetyGateReason`.
  const gate = refuseLethalChoice(proposed, candidates, combined?.scored ?? candidates);
  return {
    ...result,
    answers: { ...answers, move: { type: 'choice', choice: gate.choice, probabilities, confidence } },
    safetyGate: gate,
    deliberation: {
      version: FACTORED_VERSION, calls: 1, weights, maxFactored,
      factorsComplete,
      factorFallback: !factorsComplete,
      jevMove: { choice: jevMove.choice, confidence: jevMove.confidence },
      changed: jevMove.choice !== gate.choice,
      factorsAsked: Object.keys(answers).length - 1,
      // Left as the scorer produced it. Rewriting it to match an override would hide
      // which candidate the gate actually overrode, which is the one fact a reader
      // needs. Null on a fallback, because no ranking was produced.
      ranking: combined?.scored.slice(0, 5) ?? null,
      // Which axes went unmeasured per candidate, including candidates below the
      // top-five cut. Empty on any board combine() saw, so it is carried rather than
      // returned as a value no caller destructures.
      unmeasured: combined?.unmeasured ?? null,
      safetyGate: gate.overridden ? { overridden: true, from: gate.from, to: gate.to, reason: gate.reason } : null,
      safetyGateReason: gate.reason,
    },
  };
}
