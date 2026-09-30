import {byName as gameData} from './gamedata/game-data.mjs';

// WHAT THE GAME'S OWN DATA SAYS EACH OFFERED CARD DOES.
//
// The bridge sends no deck, so the card-reward decision is made with nothing to compare the offer
// against — and the measured result of that is a deck of Strike, Defend, Tremble, Blood Wall and
// Taunt, with Blood Wall, Cinder, Whirlwind, Molten Fist and a Skip taken along the way. At
// Ascension 10 that deck loses: elites are 10-for-26 on this policy, and a deck with no damage
// basis cannot kill one however much it blocks.
//
// So each offered card is annotated from the game's OWN localization, which classifies all 1,784
// entities. This is STRUCTURE, never a magnitude — the templates carry no numbers — and it is
// reported as a fact about the card, not as a recommendation. The choice stays the model's; what
// changes is that it is no longer choosing blind.
//
// The one thing this must never become is a hidden policy that quietly picks for the model. It is
// attached to the payload and named in the instruction; the model can still take Blood Wall.
export function offerEffects(cards) {
  return (cards ?? []).map(card => {
    const entry = gameData(card?.name);
    if (!entry?.effects) return {name: card?.name ?? null, known: false};
    const kinds = Object.keys(entry.effects).filter(k => k !== 'placeholders');
    return {name: card.name, known: true, effects: kinds.length ? kinds : null, text: entry.plain ?? null};
  });
}

import {exhaustSupport} from './exhaust-support.mjs';
import {deckSnapshot} from './encounters.mjs';
export function deckAssessment(state){
 const deck=deckSnapshot(state);
 if(!deck.available)return {available:false,note:'Deck unavailable; do not infer missing cards.'};
 const baseName=n=>(n??'').replace(/\+$/,'').toLowerCase();
 const conditional=deck.cards.filter(c=>/whenever|every|if |when |at the start|at the end/i.test(c.description??''));
 return {exhaustSupport:exhaustSupport(deck.cards,deck.relics),available:true,size:deck.size,energy:deck.energy,
  costs:deck.cards.reduce((a,c)=>{const k=String(c.cost);a[k]=(a[k]??0)+c.copies;return a;},{}),
  duplicates:deck.cards.filter(c=>c.copies>1).map(c=>({name:c.name,copies:c.copies,rule:c.description})),
  conditionalCards:conditional.map(c=>({name:c.name,copies:c.copies,rule:c.description})),
  offers:(state.card_reward?.cards??[]).map(c=>({name:c.name,cost:c.cost,rule:c.description,existingCopies:deck.cards.filter(d=>baseName(d.name)===baseName(c.name)).reduce((n,d)=>n+d.copies,0)})),
  note:'Counts describe the actual permanent deck; no hidden information or card rankings. Cost buckets are printed costs, not effective energy demand. Conditional cards include both trigger sources and payoffs: distinguish them using their full rules. A payoff is not its own enabler. Count only effects explicitly producing the required trigger, including restrictions and self-exhaust versus exhausting other cards. Missing support is a cost, not an automatic ban; assess standalone value too.'};
}
// The bridge sends piles and counts but no permanent deck, so the assessment can be a
// stated gap. Name the gap in prose, never as a field to read, and never as a deck list:
// an unstated absence invites a default to Skip, and a stated one still leaves the choice open.
export const deckUnavailableInstruction='The permanent deck is not included in this request, and the accompanying deck assessment reports that gap rather than its contents. Treat the absence as a missing observation, not as an empty, small, weak, energy-hungry or complete deck, and do not infer cards, copies, costs or combinations from memory or from the draw and discard piles. Judge the reward from what IS visible: each offered card\'s own text and printed cost, the relics, potions and open potion slots, current HP and energy, the map and run position, and the supplied observations. Compare every offered card and Skip on that evidence. Missing deck information is a reason for caution, not a reason to skip by default, and a card that plainly fills a visible need is a real improvement.';
export const deckAssessmentInstruction='Use deck_assessment to identify the largest current bottleneck before choosing a reward. Compare each offered card and Skip against that bottleneck. For a conditional payoff, identify actual trigger-producing cards or relics and whether enough triggers exist for existing copies before adding another. For a duplicate, explain its marginal improvement rather than repeating why the first copy is useful. Compare reliable output per draw and playable energy costs, including cards that do nothing until setup. Do not assume future enablers. A reward need not solve every weakness, and Skip preserves existing weaknesses. The bottleneck assessment is a fallible hypothesis, not a forced choice or a vote.';

/**
 * WHAT THE RUN HAS ACTUALLY SHOWN YOU — the best deck evidence available when the bridge sends none.
 *
 * The bridge's card-reward state carries no deck, no pile counts and no hand: `block, character,
 * gold, hp, max_hp, max_potion_slots, potions, relics, status` and nothing else. So the reward
 * decision cannot see whether the deck is bloated, and Skip is the option that looks safe when you
 * know nothing. Measured across 49 rewards: Skip taken 18 times, 37%.
 *
 * This is NOT the deck and must never be presented as it. It is the set of distinct card names the
 * agent has actually SEEN this run — from hands the game dealt and cards it played. A card never
 * drawn is missing from it, so this is a floor on the deck, not a census of it. Its only job is to
 * make "I have seen 9 distinct cards and been offered a 10th" say something instead of nothing, and
 * to say plainly that it is a floor.
 */
export function seenCardEvidence(seen, offered) {
  const names = [...new Set((seen ?? []).map(c => String(c ?? '').replace(/\+$/, '')).filter(Boolean))].sort();
  if (!names.length) return undefined;
  const at = offered ?? names.length;
  return {
    distinctCardsSeenThisRun: names.length,
    floor: true,
    note: 'a FLOOR on the deck, not the deck: cards never drawn do not appear here. It cannot show bloat.',
    names: names.slice(0, 40),
    ...(names.length > 40 ? {namesOmitted: names.length - 40} : {}),
  };
}
