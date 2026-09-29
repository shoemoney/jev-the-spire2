// Feeds the planner mechanics for the entities in the CURRENT state only. Unknown is a normal answer:
// an entity the knowledge base has never seen comes back known:false so the caller can fall back to the
// game's own description text rather than going blind.
import {KNOWLEDGE, GLOSSARY} from './knowledge.mjs';
import {canonicalize} from './extract.mjs';

const PILE_CAP = 12;
// The corpus shows card numbers changing under a constant id (Strike was seen at 4/6/7/8/9 damage with
// is_upgraded:false), so a name alone does not identify an effect. The state carries the live description
// on every hand card, relic, potion and status - so that is the primary key and the name is only a fallback.
const EFFECT_FIELDS = ['damage', 'damageAll', 'damageFromBlock', 'damagePerExhaustedCard', 'hits', 'block', 'blockMultiplier', 'draw', 'energy', 'star', 'hpCost', 'heal', 'healAll', 'exhaust', 'exhaustCards', 'exhaustHand', 'exhaustRandom', 'vulnerable', 'weak', 'gains', 'appliesAll', 'enemyLoseStrength', 'enemyGainsStrength', 'allStarCostBonus', 'allNamedCardBonus', 'doubleNextAttack', 'unplayable', 'keywords', 'nextTurn', 'hooks', 'conditional', 'meta',
  // Power semantics: a per-stack magnitude and the fixed constants that sit beside it.
  'stacksScale', 'numberIsStack', 'stackValues', 'stackLinkedMagnitudeUnknown', 'template', 'summary',
  'turns', 'incomingPercent', 'outgoingPercentLoss', 'blockGainPercentLoss', 'attackBonus', 'attackPenalty', 'blockBonus', 'nextAttackBonus', 'thorns', 'hpLossCapPerTurn', 'hpLossClamp', 'onCardPlayedIncomingPercent'];

// A mutable single-kind entry (Strike) nests its readings under `variants`, and a multi-kind entry
// (Monarch's Gaze: a card and a power) nests kind-entries that may themselves nest readings. Both levels
// must be flattened, or a mutable card resolves to its bare header and reports no effect at all.
const variantsOf = entry => {
  if (!entry) return [];
  if (entry.variants) return entry.variants.flatMap(v => (v.variants ? variantsOf(v) : [v]));
  return [entry];
};

// A power's meaning is side-dependent ('Receive 50% more damage' inverts between player and enemy), so a
// variant recorded for the other side is never silently substituted.
function sideMatches(variant, side) {
  if (!side) return true;
  const seen = variant.side ?? (variant.sides ?? []);
  return !seen.length || seen.includes(side);
}

export function lookup(name, kind, side, description, stack) {
  const entry = KNOWLEDGE[name];
  if (!entry) return null;
  const variants = variantsOf(entry).filter(v => v.kind === kind);
  if (!variants.length) return null;
  const sided = variants.filter(v => sideMatches(v, side));
  if (!sided.length) return null;
  // 1. The live text the game is showing right now. Exact, and immune to in-run mutations.
  if (description) {
    const exact = sided.find(v => v.description === description);
    if (exact) return {entry, variant: exact, source: 'description'};
    // 2. A status bakes its current stack into its text, so the live amount re-derives the same template.
    // This turns "Increases attack damage by 7" into a per-stack reading plus the live stack of 7.
    if (stack) {
      const live = canonicalize(description, stack);
      const byTemplate = sided.find(v => v.template && v.template === live);
      if (byTemplate) return {entry, variant: byTemplate, source: 'stack-template'};
    }
  }
  // 3. Unambiguous name: one recorded text for this kind.
  if (sided.length === 1) return {entry, variant: sided[0], source: 'name'};
  // 4. The name is genuinely ambiguous. Hand back every observed text rather than picking one.
  return {entry, variants: sided, source: 'name-ambiguous'};
}

const pick = (v, extra = {}) => {
  if (!v) return null;
  const effects = {};
  for (const f of EFFECT_FIELDS) if (v[f] != null) effects[f] = v[f];
  return {...effects, ...extra};
};

function describe(name, kind, side, description, extra) {
  const hit = lookup(name, kind, side, description, extra?.stack);
  if (!hit) return {name, kind, known: false, confidence: 'unknown', effects: null, source: 'unknown'};
  // The variant's own confidence is the precise one: a mutable entry's header can only be 'mixed'.
  const base = {name, kind, ...(side ? {side} : {}), known: true, confidence: (hit.variant ?? hit.variants?.[0])?.confidence ?? hit.entry.confidence ?? 'unknown', source: hit.source, effects: null};
  if (hit.variants) {
    // Ambiguous by name, and the live text matched none of the readings. Publishing any single reading's
    // numbers here would be exactly the confident-wrong-value failure this retrieval exists to prevent, so
    // only the full set of readings travels.
    base.effects = {...extra, mutable: true, matchedLiveText: false, readings: hit.variants.map(v => ({description: v.description, ...pick(v)}))};
    return base;
  }
  base.effects = pick(hit.variant, extra);
  return base;
}

const pile = (cards, cap = PILE_CAP) => {
  const names = [...new Set((cards ?? []).map(c => c?.name).filter(Boolean))];
  const out = names.slice(0, cap).map(n => ({name: n, kind: 'card', known: !!lookup(n, 'card', null, null), effects: null}));
  return {listed: out, total: names.length, truncated: Math.max(0, names.length - cap)};
};

export function retrieveMechanics(state) {
  const player = state?.player ?? {};
  const battle = state?.battle;
  const entities = [], unknown = [];
  const add = e => { entities.push(e); if (!e.known) unknown.push(e.name); };
  // Hand cards resolve on their live description, so a mutated card reports what it does right now.
  for (const card of player.hand ?? []) {
    if (!card?.name) continue;
    const prior = entities.find(e => e.name === card.name && e.kind === 'card' && e.description === card.description);
    if (prior) { prior.instances = (prior.instances ?? 1) + 1; continue; }
    add({...describe(card.name, 'card', null, card.description, {type: card.type ?? undefined, cost: card.cost ?? undefined, target: card.target_type ?? undefined}), description: card.description});
  }
  for (const relic of player.relics ?? []) if (relic?.name) add(describe(relic.name, 'relic', null, relic.description));
  for (const potion of player.potions ?? []) if (potion?.name) add(describe(potion.name, 'potion', null, potion.description));
  for (const s of player.status ?? []) if (s?.name) add(describe(s.name, 'power', 'player', s.description, {stack: s.amount ?? undefined}));
  for (const enemy of battle?.enemies ?? []) {
    if (enemy?.name) add(describe(enemy.name, 'enemy', null, null, {hp: enemy.hp, maxHp: enemy.max_hp}));
    for (const s of enemy?.status ?? []) if (s?.name) add(describe(s.name, 'power', 'enemy', s.description, {stack: s.amount ?? undefined}));
  }
  // Only the glossary terms the returned entities actually mention - the rules behind their keywords.
  const glossary = {};
  for (const e of entities) for (const k of e.effects?.keywords ?? []) if (GLOSSARY[k]) glossary[k] = GLOSSARY[k];
  const piles = battle ? {draw: pile(player.draw_pile), discard: pile(player.discard_pile)} : undefined;
  return {
    entities, unknown, glossary,
    counts: {entities: entities.length, known: entities.length - unknown.length, unknown: unknown.length},
    ...(piles ? {piles} : {}),
    note: 'Effects are regex-derived from the game\'s own description text. An absent field means the generator could not read it - not that the effect is zero. Live descriptions outrank the knowledge base, so a mutated card is reported at its current value.',
  };
}
export default retrieveMechanics;
