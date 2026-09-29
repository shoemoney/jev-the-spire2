import {retaliationRule,applyRetaliation} from './retaliation.mjs';
import {facingDamage} from './facing.mjs';
import {potionTiming} from './potion-timing.mjs';
import {spendingRoutes} from './routes.mjs';
import {mechanicsReview} from './mechanics.mjs';
import {setupLinks} from './setup-links.mjs';
import {encounterBrief,deckSnapshot,visibleState} from './encounters.mjs';
import { actionsFor, factsFor, makeQuestion } from './actions.mjs';
import {retrieveMechanics, lookup} from './mechanics/retrieve.mjs';

export const POLICY_VERSION = 'jev-visible-v23-retaliation';
const amount = (powers, name) => (powers ?? []).filter(p => p.name?.toLowerCase() === name.toLowerCase()).reduce((n,p) => n + Number(p.amount ?? 0), 0);
const number = (text, regex, fallback = 0) => Number(text.match(regex)?.[1] ?? fallback);
const nameOf = c => (c.name ?? '').replace(/\+$/, '').toLowerCase();
const supportedCards = new Set(['beckon','strike','defend','bash','uppercut','setup strike','inflame','shrug it off','rage','bludgeon','whirlwind','stomp','dismantle','rampage','anger','breakthrough','offering','slimed','twin strike','conflagration','bully','unrelenting','mind blast','perfected strike','thunderclap','impervious','dominate','vicious','molten fist','stone armor','armaments','feel no pain','giant rock','toxic','iron wave','pommel strike','taunt','battle trance','toric toughness','pyre','drum of battle','relax','flame barrier','hemokinesis','restlessness','bloodletting','colossus','expect a fight',"pact's end"]);
const supportedPotions = new Set(['fysh oil','strength potion','flex potion','weak potion','fortifier','block potion','energy potion','fire potion','swift potion','dexterity potion','speed potion']);

// A knowledge-base reading may stand in for the allowlist ONLY when it was derived from the text the game is
// showing right now, which retrieve() reports as 'description' (an exact match on the live string) or
// 'stack-template' (a template re-derived from the live string). A name is not an effect: the corpus recorded
// Strike at 4/6/7/8/9 damage under one id, so a 'name' or 'name-ambiguous' hit would replay a remembered number
// onto a board that never printed it - the confidently wrong forecast this planner exists to prevent. Those
// return null here and the card falls through to the unsupported boundary with its Re-observe warning intact.
//
// Only a DAMAGE magnitude qualifies. Block, debuff, energy and exhaust parsing below is already generic over
// the same text, so promoting a KB card with no readable damage would add nothing while letting a card whose
// whole effect is unmodelled enter the forecast as a silent no-op that still spends its energy.
//
// The ambiguity check is structural, not a flag: retrieve() returns `{variants:[...]}` with no `variant` for
// an ambiguous name, so `!hit.variant` is the whole guard. The magnitude is type-checked rather than coerced,
// because Number(null) is a finite 0 and a coerced absent field is an invented zero.
const KB_LIVE_SOURCES = new Set(['description', 'stack-template']);
function kbMagnitude(name, text) {
  if (!text) return null;
  const hit = lookup(name, 'card', null, text);
  if (!hit?.variant || !KB_LIVE_SOURCES.has(hit.source)) return null;
  const {damage, hits} = hit.variant;
  if (typeof damage !== 'number' || !Number.isFinite(damage)) return null;
  return {damage, hits: typeof hits === 'number' && hits > 1 ? hits : 1, source: hit.source};
}
const knownPlayerPowers = new Set(['strength','dexterity','weak','frail','vulnerable','rage','plating','metallicize','free attack','vicious','feel no pain']);
const knownEnemyPowers = new Set(['strength','weak','vulnerable','slippery','plow','artifact']);
const knownRelics = new Set(['BURNING_BLOOD','VAJRA','GORGET','ORNAMENTAL_FAN','ANCHOR','STRAWBERRY','PEAR','MANGO','BAG_OF_PREPARATION','POTION_BELT','ARCANE_SCROLL','TUNING_FORK']);

// ONE source per intent, in priority order - the label first, the description only when the label does not
// parse. This comment used to claim the two were combined and that their disagreement became a two-point
// interval. The code never did either, and it still does not: the label branch returns before the description
// is read, and a label number is never compared against a description number.
//
// `alt` is the label's OWN second number - the parenthesised total in a `4x3 (12)` label - and it is set only
// when that total contradicts perHit*hits. Both numbers came from the same label, so a mismatch means one of
// the two the game printed is wrong and the truth is between them; forecast() then runs incomingMin/incomingMax
// across the two ends. The description branch always reports exact:true with alt:null, so a fallback reading is
// a point estimate, never a range.
//
// The merge was considered and deliberately left unimplemented. Across every attack intent in the 52 fixtures
// and the winning replay - 60 where both a label and a description parse - there are zero label-vs-description
// disagreements, so the branch could not be exercised, let alone validated, on any board in this repo. The two
// forms are also produced by different regexes, so a disagreement could mean a parsing artefact rather than a
// real conflict, and wiring one in would turn a wording difference into a widened damage interval. A board
// that has never been observed is not evidence that a reading is safe.
export function readIntentDamage(intent) {
  const label = parseIntentLabel(intent.label);
  if (label) return {perHit:label.perHit, hits:label.hits, alt:label.mismatch?label.total:null, exact:!label.mismatch, source:'intent label'};
  const said = String(intent.description??'').match(/(\d+) damage(?: (\d+) times?)?/i);
  if (said) return {perHit:Number(said[1]), hits:Number(said[2]??1), alt:null, exact:true, source:'intent description'};
  return null;
}

function initial(s) {
  const warnings = [];
  for (const p of s.player.status ?? []) if (!knownPlayerPowers.has(p.name.toLowerCase())) warnings.push(`Unmodeled player power: ${p.name}`);
  for (const e of s.battle.enemies) for (const p of e.status ?? []) if (!knownEnemyPowers.has(p.name.toLowerCase()) && retaliationRule(p)?.damage==null) warnings.push(`Unmodeled enemy power: ${p.name}`);
  for (const r of s.player.relics ?? []) if (!knownRelics.has(r.id)) warnings.push(`Unmodeled relic: ${r.name}`);
  const fan = (s.player.relics ?? []).find(r => r.id === 'ORNAMENTAL_FAN');
  const fanProgress = Number.isInteger(fan?.counter) ? fan.counter : null;
  if (fan && fanProgress === null) warnings.push('Ornamental Fan counter unavailable: forecast omits its extra block.');
  return {
    retaliationEvents:[],
    retaliationModifiers:(s.player.status??[]).some(p=>!['strength','dexterity','weak','frail','no energy gain','no draw','free attack'].includes(p.name.toLowerCase())),
    colossus:amount(s.player.status,'Colossus')>0,
    noEnergyGain:amount(s.player.status,'No Energy Gain')>0,
    exhaustCount:s.player.exhaust_pile_count ?? s.player.exhaust_pile?.length ?? 0,
    noDraw:amount(s.player.status,'No Draw')>0,
    unmovable:amount(s.player.status,'Unmovable')>0,
    ringing: (s.player.status??[]).some(p=>p.name==='Ringing' || /cannot play more than \d+ cards each turn/i.test(p.description??'')),
    energy: s.player.energy, hp: s.player.hp, block: s.player.block ?? 0,
    hand: structuredClone(s.player.hand).map(c => ({ ...c, sourceIndex: c.index })),
    potions: structuredClone(s.player.potions ?? []), enemies: structuredClone(s.battle.enemies),
    dexterityDelta: 0, frailFactor: amount(s.player.status,'Frail') > 0 ? .75 : 1,
    strengthDelta: 0, weakFactor: amount(s.player.status,'Weak') > 0 ? .75 : 1,
    feelNoPain:amount(s.player.status,'Feel No Pain'),
    vicious:amount(s.player.status,'Vicious'),
    rage: amount(s.player.status,'Rage'), plating: amount(s.player.status,'Plating'), metallicize: amount(s.player.status,'Metallicize'),
    attacks: 0, fan: Boolean(fan), fanProgress, steps: [], warnings,
    // Energy an unmodeled card may have consumed. Bounded-worst-case ranking
    // charges it, so an unknown card never scores as though it were free.
    unsupportedEnergy: 0,
    // Unknown interactions stop search expansion; never invent complete outcomes.
    unsupported: false, boundary: null, freeAttack: amount(s.player.status,'Free Attack') > 0,
    originalVulnerable:Object.fromEntries(s.battle.enemies.map(e=>[e.entity_id,amount(e.status,'Vulnerable')])),
    drawCount:s.player.draw_pile_count ?? 0, deck:s.player.deck ?? [],
    fork:(s.player.relics ?? []).find(r=>r.id==='TUNING_FORK')?.counter ?? null, stunned:[],
    cardDamage: 0, removedCharges: 0, extraStrength: 0,
  };
}

function cost(card, m) {
  if (m.freeAttack && card.type === 'Attack') return 0;
  if (card.cost === 'X') return m.energy;
  const value = Number(card.cost);
  if (!Number.isFinite(value)) return Infinity;
  return Math.max(0, value - (nameOf(card) === 'stomp' ? m.attacks : 0));
}

function available(m, rootState) {
  const virtual = { ...rootState, player: { ...rootState.player, energy:m.energy, hand:m.hand.map((c,i) => ({
    ...c, index:i, can_play: cost(c,m) <= m.energy && (c.can_play || (/energy/i.test(c.unplayable_reason ?? '') && !/BlockedByHook/i.test(c.unplayable_reason ?? ''))),
  })), potions:m.potions }, battle:{...rootState.battle,enemies:m.enemies} };
  return actionsFor(virtual);
}

function hit(m, enemy, value, attack) {
  if (enemy.hp <= 0) return;
  let damage = Math.max(0, value);
  if (attack && amount(enemy.status,'Vulnerable') > 0) damage = Math.floor(damage * 1.5);
  for(const power of enemy.status??[]) {
    const cap=(power.description??'').match(/Reduce all damage taken and HP (?:loss|lost)(?:\s+.*?)?\s+to (\d+)/i);
    if(cap)damage=Math.min(damage,Number(cap[1]));
  }
  const blocked = Math.min(enemy.block ?? 0, damage);
  enemy.block = (enemy.block ?? 0) - blocked; damage -= blocked;
  const slippery = (enemy.status ?? []).find(p => p.name.toLowerCase() === 'slippery' && p.amount > 0);
  if (damage > 0 && slippery) { damage = 1; slippery.amount--; m.removedCharges++; }
  const lost = Math.min(enemy.hp, damage); enemy.hp -= lost; m.cardDamage += lost;
  const plow=(enemy.status??[]).find(p=>p.name.toLowerCase()==='plow');
  if(plow && enemy.hp<=plow.amount && !m.stunned.includes(enemy.entity_id)) {
    m.stunned.push(enemy.entity_id);
    enemy.status=enemy.status.filter(p=>!['plow','strength'].includes(p.name.toLowerCase()));
  }
}

function applyPower(enemy, name, n) {
  if(enemy.hp<=0)return false;
  enemy.status ??= [];
  const artifact=enemy.status.find(p=>p.name.toLowerCase()==='artifact'&&p.amount>0);
  if(artifact){artifact.amount--;return false;}
  const existing = enemy.status.find(p => p.name.toLowerCase() === name.toLowerCase());
  if (existing) existing.amount += n;
  else enemy.status.push({name,amount:n});
  return true;
}

function apply(m0, a) {
  const m = structuredClone(m0);
  m.steps.push(a);
  if (a.command.action === 'end_turn') { m.boundary = 'end_turn'; return m; }
  const potion = a.command.action === 'use_potion';
  const item = potion ? m.potions.find(p => p.slot === a.command.slot) : m.hand[a.command.card_index];
  if (!item) return null;
  const name = nameOf(item), text = item.description ?? '';
  // The allowlist is 49 hand-maintained names; the knowledge base had already resolved 159 entities and was
  // attached to every request while never consulted for a SIMULATION, so a card the agent was handed a verified
  // number for was refused right here, and every such forecast went unknown on a card we can actually read.
  // kbMagnitude() gates that read to the live text and returns null rather than a remembered number, so the
  // branch below still owns every card the board does not pin down.
  const listed = (potion ? supportedPotions : supportedCards).has(name);
  const kb = listed || potion ? null : kbMagnitude(item.name, text);
  if (!listed && !kb) {
    m.boundary = 'unsupported'; m.unsupported = true;
    m.unsupportedEnergy += potion ? 0 : cost(item,m);
    m.warnings.push(`Re-observe after ${item.name}; full consequences are not modeled.`);
    return m;
  }
  // A simulated KB card is still a recorded reading, not a modelled effect, and the planner parses only some
  // clauses of any card's text. Say so, so quality stays 'partial' instead of claiming 'calculated'.
  if (kb) m.warnings.push(`${item.name} is simulated from a recorded reading of this exact description; a clause it states that the planner does not model is omitted.`);
  const replayCount = !potion ? number(text,/\bReplay (\d+)\b/i) : 0;
  // Only the fully understood plain Strike replay is modeled. Other replayed
  // effects may draw, change costs, exhaust, or alter targets between plays.
  if(replayCount && (name!=='strike' || !/^Deal \d+ damage\.\s*Replay \d+\.?$/i.test(text.trim()) || replayCount>10 || m.freeAttack || m.ringing)) {
    m.unsupported=true;m.boundary='unsupported';m.unsupportedEnergy+=cost(item,m);
    m.warnings.push('Replay effects require a fresh observation; this card or play-limit interaction is not modeled.');
    return m;
  }
  const spent = potion ? 0 : cost(item,m);
  if (spent > m.energy) return null;
  m.energy -= spent;
  if (potion) m.potions = m.potions.filter(p => p.slot !== item.slot);
  else m.hand.splice(a.command.card_index,1);
  if(name!=='beckon')m.hp -= number(text,/Lose (\d+) HP/i);
  if (m.hp <= 0) { m.boundary = 'player_dead'; return m; }
  if(name==='restlessness') {
    if(m.hand.length===0) {
      if(!m.noEnergyGain)m.energy+=(text.match(/\[[^\]]*energy_icon[^\]]*\]/g)??[]).length;
      if(!m.noDraw){m.boundary='draw';m.warnings.push('Empty-hand condition met; re-observe unknown drawn cards.');}
    } else m.warnings.push('Empty-hand condition not met: this play grants no draw or energy and gives up retaining the card.');
    return m;
  }
  if(name==="pact's end" && m.exhaustCount<number(text,/If you have (\d+) or more/i,3)) {
    m.warnings.push('Exhaust-pile threshold not met: this card deals no damage.');
    return m;
  }
  const isAttack = !potion && item.type === 'Attack';
  const targets = item.target_type === 'AnyEnemy' ? m.enemies.filter(e => e.entity_id === a.command.target) : m.enemies.filter(e => e.hp > 0);
  for(let replay=0;replay<=replayCount;replay++){
  if(replay && (m.hp<=0 || targets.every(e=>e.hp<=0)))break;
  let retaliationHits=0;
  // A KB card takes both numbers from its reading rather than the generic regex, so a hit count the allowlist
  // names no rule for ("twice") is not read as one hit. On every card reading the corpus holds, `damage` equals
  // the live text's own "Deal (\d+) damage" number (measured: 0 disagreements across 119 card readings), so this
  // changes the number of hits and never the damage per hit - which is what keeps the Strength/Weak adjustment
  // below correct, since a hand description already carries the player's current Strength.
  const damageMatch = name==='flame barrier' ? null : name==='mind blast' ? [null,String(m.drawCount)] : text.match(/Deal (\d+) damage/i);
  if (kb || damageMatch) {
    let dmg = kb ? kb.damage : Number(damageMatch[1]);
    if (isAttack) {
      // Hand descriptions already include the player's current Strength/Weak.
      // Add only the change from simulated setup actions, never Strength twice.
      dmg += Math.floor(m.strengthDelta * m.weakFactor);
      if (m.weakFactor !== 1 && (m.strengthDelta || targets.some(e => amount(e.status,'Vulnerable')))) {
        m.warnings.push('Weak/Vulnerable rounding may differ by 1 damage per hit.');
      }
    }
    for (const e of targets) {
      const hits = kb ? kb.hits : name === 'whirlwind' ? spent : name==='twin strike' ? 2 : name==='conflagration' ? number(text,/damage to ALL enemies (\d+) times/i,4) : name === 'dismantle' && amount(e.status,'Vulnerable') > 0 ? 2 : 1;
      retaliationHits=hits;
      const bonus=name==='bully' ? number(text,/Deals (\d+) additional damage/i)*(amount(e.status,'Vulnerable')-(m.originalVulnerable[e.entity_id]??0)) : 0;
      for (let i=0; i<hits && e.hp>0; i++) hit(m,e,dmg+bonus,isAttack);
    }
  }
  if(isAttack){
    applyRetaliation(m,targets,item,retaliationHits);
    if(m.unsupported||m.hp<=0)return m;
  }
  if (isAttack) {
    m.attacks++; m.block += m.rage;
    if(m.freeAttack) { m.freeAttack=false; m.boundary='free_attack_consumed'; m.warnings.push('Re-read card costs after consuming Free Attack.'); }
    if (m.fan && m.fanProgress !== null && (m.fanProgress + m.attacks) % 3 === 0) m.block += 4;
  }
  }
  if(!potion && item.type==='Skill' && m.fork!==null) { m.fork++; if(m.fork%10===0)m.block+=7; }
  if(name==='flame barrier')m.warnings.push('Immediate block included; retaliation damage and any kills during enemy attacks are omitted. Incoming may be overestimated.');
  if(name==='fortifier')m.block*=3;
  if(name==='colossus')m.colossus=true;
  if(name==='expect a fight'){if(!m.noEnergyGain)m.energy+=m.hand.filter(c=>c.type==='Attack').length;m.noEnergyGain=true;}
  if(name==='unrelenting')m.freeAttack=true;
  // Rage's text describes block on subsequent attacks, not block on cast.
  if(name==='pyre')m.warnings.push('Pyre grants energy at the start of future turns, not when played; no immediate energy or protection is forecast.');
  if(name==='relax')m.warnings.push('Relax draw and energy arrive next turn, not now. They cannot rescue lethal incoming damage this turn.');
  if(name==='toric toughness')m.warnings.push('Only immediate Toric Toughness block is included; later-turn block does not prevent damage this turn.');
  if(name==='stone armor')m.plating+=number(text,/Gain (\d+) Plating/i);
  if (name === 'feel no pain') m.feelNoPain+=number(text,/gain (\d+) Block/i);
  else if (name === 'rage') m.rage += number(text,/gain (\d+) Block/i);
  else {
    const baseBlock=number(text,/Gain (\d+) Block/i);
    if(baseBlock) m.block += baseBlock + (!potion ? Math.floor(m.dexterityDelta*m.frailFactor) : 0);
  }
  if(potion && ['dexterity potion','speed potion','fysh oil'].includes(name)) {
    m.dexterityDelta += number(text,/(?:Gain|and) (\d+) Dexterity/i);
    m.warnings.push('Dexterity affects subsequent block cards, not existing block. Temporary Dexterity only benefits cards played before it expires.');
    if(m.frailFactor!==1)m.warnings.push('Frail rounding on simulated Dexterity may differ by 1 block.');
  }
  if(name==='flex potion')m.warnings.push('Temporary Strength applies only to attacks before this turn ends; no future-turn benefit is forecast.');
  const gainStrength = name==='dominate'?0:number(text,/Gain (\d+) Strength/i);
  m.strengthDelta += gainStrength; m.extraStrength += gainStrength;
  if (name === 'energy potion' || name === 'bloodletting') {
    const icons = (text.match(/\[[^\]]*energy_icon[^\]]*\]/g) ?? []).length;
    const gain = number(text,/Gain (\d+) Energy/i,icons);
    if (!gain) { m.unsupported = true; m.warnings.push('Energy gain amount could not be parsed.'); }
    if(!m.noEnergyGain)m.energy += gain;
    if(name==='bloodletting' && m.hand.length===0)m.warnings.push('Bloodletting leaves an empty hand: added energy cannot play another card without a separate draw or card-generation effect. HP cost is paid immediately.');
  }
  if(name==='bloodletting' && /Gain \d+ Tainted/i.test(text)) {
    m.unsupported=true;m.boundary='unsupported';
    m.warnings.push('Bloodletting energy and HP cost are included, but added Tainted consequences require a fresh observation.');
  }
  if (name === 'offering' && !m.noEnergyGain) m.energy += number(text,/Gain (\d+) Energy/i,(text.match(/\[[^\]]*energy_icon[^\]]*\]/g)??[]).length);
  if (!potion && /(?:^|[.!]\s*)Exhaust\.?$/i.test(text.trim())) {m.block+=m.feelNoPain;m.exhaustCount++;}
  if(name==='armaments'){m.boundary='upgrade';m.warnings.push('Armaments block is included; re-observe card upgrades before continuing.');}
  for (const e of targets) {
    const weak = number(text,/Apply (\d+) Weak/i), vuln = number(text,/Apply (\d+) Vulnerable/i);
    if (weak) applyPower(e,'Weak',weak);
    let applied=false;
    if (vuln) applied=applyPower(e,'Vulnerable',vuln);
    if(name==='molten fist' && amount(e.status,'Vulnerable')>0)applied=applyPower(e,'Vulnerable',amount(e.status,'Vulnerable'));
    if(name==='dominate'){
      const gain=number(text,/Gain (\d+) Strength/i)*amount(e.status,'Vulnerable');
      m.strengthDelta+=gain;m.extraStrength+=gain;
    }
    if(applied && m.vicious>0 && !m.noDraw){m.boundary='draw';m.warnings.push('Vicious draws unknown cards: re-observe before continuing.');}

  }
  if(name==='vicious')m.vicious+=number(text,/draw (\d+) card/i,1);
  if (name!=='vicious' && name!=='relax' && !m.noDraw && /Draw \d+ cards?/i.test(text)) { m.boundary = 'draw'; m.warnings.push('Stops before unknown drawn cards; re-observe before continuing.'); }
  if(name==='battle trance')m.noDraw=true;
  if(!potion && m.unmovable && /Gain \d+ Block/i.test(text) && name!=='rage' && name!=='feel no pain'){m.boundary='block_modifier_consumed';m.warnings.push('Re-read live block values after Unmovable: first-card doubling must not be reused.');}
  if(!potion && /\bBound\b/.test(text)){m.boundary='bound_card_played';m.warnings.push('Bound card played: re-observe remaining card legality before continuing.');}
  if(!potion && m.ringing){m.boundary='card_play_limit';m.warnings.push('A visible power limits card plays; re-observe legality after this card instead of assuming remaining plays.');}
  // A departure is not a kill: do not trigger the minion's on-death effects.
  const minionRule=e=>(e.status??[]).some(p=>/^Minions abandon combat without their leader\.?$/i.test((p.description??'').trim()));
  const leaders=m.enemies.filter(e=>!minionRule(e));
  const leaderDeathUncertain=leaders.some(e=>(e.status??[]).some(p=>/when killed|upon dying|on death|when this dies|would be defeated|reviv|resurrect|transform/i.test(p.description??'')));
  if(leaders.length===1 && leaders[0].hp<=0 && !leaderDeathUncertain && !m.unsupported){
    for(const e of m.enemies.filter(e=>e.hp>0 && minionRule(e))){e.hp=0;e.departedWithLeader=leaders[0].entity_id;}
  }
  if (m.enemies.every(e => e.hp <= 0)) {
    const deathEffects=m.enemies.filter(e=>!e.departedWithLeader).flatMap(e=>(e.status??[]).filter(p=>/when killed|upon dying|on death|when this dies|would be defeated|revives?/i.test(p.description??'')));
    m.boundary=deathEffects.length?'death_effect':'combat_won';
    if(deathEffects.length){m.deathUnresolved=true;m.warnings.push('Enemy death triggers remain unresolved: do not assume victory or survival. Re-observe the death effect.');}
  }
  if (m.hp <= 0) m.boundary = 'player_dead';
  return m;
}

// Attack intents render as `4x3 (12)`, not just `4x3`; the old regex only read the bare
// perHitxhits form, so every real multi-hit intent failed to parse and blanked the whole
// forecast. A parenthesised total that contradicts perHit*hits is reported as a mismatch
// rather than resolved: a confidently wrong incoming total is worse than an uncertain one.
export function parseIntentLabel(label) {
  const m = String(label ?? '').trim().replace(/\.$/, '').trim()
    .match(/^(\d+)\s*(?:[x×]\s*(\d+))?(?:\s*\(\s*(\d+)\s*\))?$/i);
  if (!m) return null;
  const perHit = Number(m[1]), hits = Number(m[2] ?? 1), product = perHit * hits;
  return {perHit, hits, total: m[3] === undefined ? product : Number(m[3]), mismatch: m[3] !== undefined && Number(m[3]) !== product};
}

// A turn is not a prefix. Search stops at maxDepth, at a beam edge, or the
// moment a card draws unknown cards — and the old forecast claimed all three
// were "this prefix, followed by ending the turn", so a menu of fragments read
// as a calendar of whole turns. The calendar was always one card short: a
// 12-HP state with 3 energy was offered "Defend, Defend, Strike, End turn"
// while a fourth Defend sat in hand.
//
// A plan is turnComplete only when the turn genuinely closes: the plan ends it,
// the fight is won, or nothing affordable is left. Every other ending is a
// prefix, and a prefix is labelled as one rather than dressed up as a turn.
// Potions are deliberately not played by the completion pass: holding one is a
// real decision about the run, not a card to be spent to fill a turn out.
const TURN_REASONS = {
  'end-turn':'the plan itself ends the turn',
  'combat-won':'the fight is over, so no turn remains',
  'energy-exhausted':'no card left is affordable with the energy in hand',
  'no-playable-cards':'no card left is playable',
};
// Every non-complete reason, phrased for the assumption string. These plans stay
// turnComplete:false and are never rounded up into a finished turn. Each carries
// its own consequence too, because "truncated" alone would imply unspent cards
// in every case — and after a potion-cleared plan no card is left at all.
const TURN_CUTS = {
  'depth-limit':['the completion pass ran out of steps before the turn could close','cards and energy may remain unspent'],
  'potions-remaining':['every card is spent, but a potion still works and could extend this turn','no card remains unspent, yet the turn is not over'],
  'search-prefix':['this is a search prefix, never extended to a turn end','cards and energy may remain unspent'],
  'draw':['the turn stops at a draw, and the drawn cards are unknown','the cards after this point are unknown'],
  'unsupported':['the turn stops at a card whose consequences are not modeled','the effects after this point are unknown'],
  'death_effect':['the turn stops at an unresolved enemy death effect','what the death effect does is unknown'],
  'player_dead':['the turn stops because the player dies','nothing further can be played'],
};
function completion(m, complete, reason) { m.turn = {turnComplete:complete, completionReason:reason}; return m; }

// Greedily extend a partial plan to a real turn end, ranking each continuation
// with the SAME preference() the search already uses — this changes which plans
// get generated, never how any of them is scored. Each step takes the best
// surviving continuation; a step that opens a boundary (a draw, an unmodeled
// card, a death effect) is taken only when nothing else is on offer, and then
// the turn is reported as cut short rather than quietly rounded off.
function completeTurn(m0, s) {
  // Playing a card always removes it from hand, so the visible hand and potions
  // bound the pass exactly; the counter only stops a pathological cycle.
  const budget = Math.max(8, m0.hand.length + m0.potions.length);
  let m = m0, played = 0;
  while (!m.boundary && played < budget) {
    const continuations = available(m, s)
      .filter(a => a.command.action === 'play_card')
      .map(a => apply(m, a))
      .filter(Boolean);
    if (!continuations.length) break;
    m = continuations.toSorted((a,b) => preference(b,s,'attack') - preference(a,s,'attack'))[0];
    played++;
  }
  if (m.boundary === 'end_turn') return completion(m, true, 'end-turn');
  if (m.boundary === 'combat_won') return completion(m, true, 'combat-won');
  // A boundary is the honest reason a turn cannot be finished. It is never
  // rounded up into "complete", because the cards after it are unknown.
  if (m.boundary) return completion(m, false, `boundary:${m.boundary}`);
  if (played >= budget) return completion(m, false, 'depth-limit');
  // No card is left to play, but the turn is not over while a potion still
  // works. That is neither a finished turn nor a depth cut, and calling it
  // either one is how a prefix gets presented as a calendar.
  if (available(m, s).some(a => a.command.action === 'use_potion')) return completion(m, false, 'potions-remaining');
  return completion(m, true, m.energy > 0 || !m.hand.length ? 'no-playable-cards' : 'energy-exhausted');
}

// The verdict for a plan that was never offered a completion pass — a bare
// legal action, or a beam prefix. It is a prefix by construction unless the
// turn is provably over, and it says so rather than borrowing a certainty it
// has not earned.
function turnVerdict(m) {
  if (m.boundary === 'end_turn') return {turnComplete:true, completionReason:'end-turn'};
  if (m.boundary === 'combat_won') return {turnComplete:true, completionReason:'combat-won'};
  if (m.boundary) return {turnComplete:false, completionReason:`boundary:${m.boundary}`};
  return {turnComplete:false, completionReason:'search-prefix'};
}

function forecast(m, s) {
  // Every attack contributes a floor and a ceiling instead of a point. The floor
  // is what the readable intents prove will land; the ceiling is the most those
  // same readings allow. They are equal for every attack the planner fully
  // understands, so a fully readable turn is numerically unchanged.
  let incomingMin = 0, incomingMax = 0, parsed = true, mismatched = false, unreadable = [];
  for (const e of m.enemies.filter(e => e.hp > 0)) {
    if(m.stunned.includes(e.entity_id))continue;
    const before = s.battle.enemies.find(x => x.entity_id === e.entity_id);
    for (const intent of e.intents ?? []) {
      if (!/attack|deathblow/i.test(intent.type) && !/attack.*\d+ damage/i.test(intent.description??'')) continue;
      const read = readIntentDamage(intent);
      // No visible source names this attack's damage, so no ceiling exists and
      // the whole turn stays unscoreable. Never widen the range to hide that.
      if (!read) { parsed = false; unreadable.push(`${e.name}: ${intent.type??'attack'} ${JSON.stringify(intent.label??'')}`); continue; }
      let perHit = read.perHit;
      if (amount(before?.status,'Weak') === 0 && amount(e.status,'Weak') > 0) perHit = Math.floor(perHit*.75);
      if(m.colossus && amount(e.status,'Vulnerable')>0)perHit=Math.floor(perHit*.5);
      // A self-contradicting label names two numbers the game printed, so the
      // truth is one of them: the interval runs between them, whichever is larger.
      // Pinning the floor at the product would overstate what provably lands.
      const product = perHit * read.hits;
      incomingMin += read.alt == null ? product : Math.min(product, read.alt);
      incomingMax += read.alt == null ? product : Math.max(product, read.alt);
      if (!read.exact) { parsed = false; mismatched = true; }
    }
  }
  const bounded = unreadable.length === 0;
  const defeatedEnemies = s.battle.enemies.filter(e=>e.hp>0 && m.enemies.some(after=>after.entity_id===e.entity_id && after.hp<=0 && !after.departedWithLeader)).map(e=>({
    id:e.entity_id,name:e.name,
    attackRemoved:(e.intents??[]).reduce((sum,i)=>{
      if(!/attack|deathblow/i.test(i.type??'') && !/attack.*\d+ damage/i.test(i.description??''))return sum;
      const hit=parseIntentLabel(i.label);
      return hit && !hit.mismatch && sum!==null ? sum+hit.perHit*hit.hits : null;
    },0),
    deathRules:(e.status??[]).filter(p=>/when killed|upon dying|on death|when this dies|would be defeated|revives?/i.test(p.description??'')).map(p=>p.description),
  }));
  const block = m.block + m.plating + m.metallicize;
  const positioningUnknown = [...(s.player.status??[]),...s.battle.enemies.flatMap(e=>e.status??[])].some(p=>/from behind|orientation/i.test(p.description??''));
  const lethalTurnRule=m.enemies.filter(e=>e.hp>0&&!m.stunned.includes(e.entity_id)).flatMap(e=>e.status??[]).some(p=>/takes? (?:its|their) turn.*(?:you.*die|kill you)/i.test(p.description??''));
  const facingProjection=positioningUnknown?facingDamage(s,m.steps,m.enemies):null;
  const facingEffectsChanged=m.enemies.some(e=>JSON.stringify(e.status)!==JSON.stringify(s.battle.enemies.find(x=>x.entity_id===e.entity_id)?.status));
  const facingUsable=facingProjection&&!facingEffectsChanged&&!m.unsupported;
  // A usable facing projection is already an interval, so take both of its ends
  // rather than only the conservative one it publishes.
  if(facingUsable){incomingMin=facingProjection.incomingMin;incomingMax=facingProjection.incomingMax;}
  // An unresolved orientation can raise any surviving attack by a visible
  // percentage, so no ceiling exists until a facing projection resolves it.
  // Publishing the displayed total as the ceiling would be a bound posing as a
  // fact, so such a turn stays unscoreable and keeps the flat ranking penalty.
  const ceilingKnown = bounded && !(positioningUnknown && !facingUsable);
  const boundMin = facingUsable ? facingProjection.incomingMin : incomingMin;
  const boundMax = ceilingKnown ? (facingUsable ? facingProjection.incomingMax : incomingMax) : null;
  // `incoming` keeps the value every existing consumer already reads: the exact
  // total when the intents are fully readable, otherwise one end of the range.
  // A facing review keeps its documented conservative upper bound, because that
  // is the number the turn review already compares against.
  const incoming = ceilingKnown ? (facingUsable ? boundMax : boundMin) : null;
  // Exact means the intent arithmetic is complete, not that the turn is won: an
  // unmodeled card or an unreadable label each widen what the reading supports,
  // and each is reported rather than absorbed into the number.
  const incomingExact = ceilingKnown && !mismatched && !m.unsupported;
  const uncertain = lethalTurnRule || (positioningUnknown&&!facingUsable) || m.unsupported || m.deathUnresolved || defeatedEnemies.some(e=>e.deathRules.length) || !parsed;
  const endTurnCardDamage = m.enemies.some(e=>e.hp>0) ? m.hand.reduce((sum,c)=>sum+(/At the end of your turn, if this is in your Hand, take (\d+) damage/i.test(c.description??'') ? number(c.description,/take (\d+) damage/i) : 0),0) : 0;
  const endTurnCardHpLoss = m.enemies.some(e=>e.hp>0) ? m.hand.reduce((sum,c)=>sum+number(c.description,/At the end of your turn, if this is in your Hand,\s+lose (\d+) HP/i),0) : 0;
  // Two loss figures, never one: what the readable intents prove will land, and
  // what the whole interval allows. They are equal whenever incomingExact, so an
  // exact forecast keeps the single number it always had.
  const unblocked = inc => endTurnCardHpLoss + Math.max(0, inc + endTurnCardDamage - block);
  const projectedLoss = unblocked(incoming ?? 0);
  const loss = Math.max(0,s.player.hp-m.hp) + projectedLoss;
  const lossUpper = boundMax === null ? null : Math.max(0,s.player.hp-m.hp) + unblocked(boundMax);
  const warnings = [...new Set(m.warnings)];
  // Settled before the forecast is published so every field a caller might read
  // carries the same verdict. A prefix is never dressed up as a whole turn.
  const turn = m.turn ?? turnVerdict(m);
  // The prefix disclosure deliberately does NOT enter `warnings`: warnings set
  // `quality`, and a prefix is not a less certain estimate, it is a different
  // object. Labelling it in the assumption and the two fields below leaves the
  // existing caveat ladder exactly as calibrated.
  // A boundary reason names what stopped the turn; every other cut reason is a
  // statement about the plan itself. Unknown stays unknown either way.
  const key=turn.completionReason.startsWith('boundary:')?turn.completionReason.slice('boundary:'.length):turn.completionReason;
  const cut=TURN_CUTS[key]??[`the turn stops at the ${key.replace(/-/g,' ')} boundary`,'what happens after this point is unknown'];
  const scope = turn.turnComplete
    ? `Forecast for a WHOLE turn: this plan plays out the cards worth playing until ${TURN_REASONS[turn.completionReason]}, so the figures below are this turn's end state and not a prefix. A potion still held is a separate decision this plan does not make.`
    : `Forecast for a TRUNCATED prefix, NOT a whole turn: this plan stops early because ${cut[0]}, so ${cut[1]}, and the figures below end the turn at this exact point. Extend it from a fresh observation before treating it as the turn.`;
  if(lethalTurnRule)warnings.push('A visible rule says the enemy taking its turn kills you regardless of ordinary block. Attack-only HP estimates cannot establish survival; prevent that turn using a supported kill or stated interruption.');
  if(positioningUnknown&&!facingUsable)warnings.push('Position-dependent incoming damage is not modeled; targeting can change orientation. Survival is uncertain.');
  if (!parsed) warnings.push(unreadable.length ? `Some incoming attacks could not be read from either the intent label or its description, so this turn has no damage ceiling: ${unreadable.join('; ')}.` : 'Some incoming attacks could not be parsed.');
  if (mismatched) warnings.push('An attack intent label disagrees with its own per-hit value and hit count; incoming damage is uncertain, not estimated.');
  // A bound must never read as a total. One warning covers every inexact reason,
  // and its presence also keeps `quality` from ever claiming 'calculated'.
  if (!incomingExact) warnings.push(`Incoming damage is a bound, not a total: the readable intents prove at least ${boundMin} and at most ${boundMax ?? 'an unbounded amount, so this turn cannot be ranked against another'}. Compare plans on surviving incomingMax, and do not read the single incoming figure as the damage that will land.`);
  return {
    ...(facingUsable?{facingProjection}:{}),
    ...(positioningUnknown?{facingReview:{lastTargetedAction:[...m.steps].reverse().find(a=>a.command?.target)??null,note:facingUsable?'Use facingProjection for the candidate final direction; incoming uses its conservative upper bound. Facing evidence comes from executed actions; re-observe after every action.':'Visible rules say targeting changes orientation. Compare the final target with each surviving attacker before ending. Current facing and unmodified attack values are not supplied, so do not multiply displayed intents again or assume exact damage after turning. Reserve an affordable targeted card or potion when a final turn can reduce incoming damage; re-observe live intents after it. Untargeted block or area damage is not evidence of turning.'}}:{}),
    damage: m.unsupported ? null : m.cardDamage,
    block: m.unsupported ? null : block,
    incoming, incomingMin: boundMin, incomingMax: boundMax, incomingExact,
    endTurnCardDamage, endTurnCardHpLoss,
    defeatedEnemies,
    retaliationEvents:m.retaliationEvents,
    departedMinions:m.enemies.filter(e=>e.departedWithLeader).map(e=>({id:e.entity_id,name:e.name,leader:e.departedWithLeader,reason:'Visible rule: abandons combat without its leader; departure is not a death.'})),
    delayedDeathEffects:m.enemies.filter(e=>!e.departedWithLeader).flatMap(e=>(e.status??[]).filter(p=>/when killed|upon dying|on death|when this dies|would be defeated|revives?/i.test(p.description??'')).map(p=>({enemy:e.name,rule:p.description,note:'Not included in current-turn attack total; death may not end combat.'}))),
    hpLoss: uncertain ? null : loss,
    hpAfter: uncertain ? null : Math.max(0,s.player.hp-loss),
    survives: uncertain ? null : m.hp > projectedLoss,
    // The pessimistic end of the bound, for ranking a plan whose survival cannot
    // be stated outright. Null whenever there is no ceiling to test against.
    hpLossUpper: lossUpper,
    survivesUpper: boundMax === null ? null : m.hp > unblocked(boundMax),
    bossStunned:m.stunned.length>0, bossThresholds:m.enemies.flatMap(e=>(e.status??[]).filter(p=>p.name.toLowerCase()==='plow').map(p=>({enemy:e.name,damageToStun:Math.max(0,e.hp-p.amount)}))),
    energyLeft:m.unsupported ? null : m.energy, slipperyRemoved:m.removedCharges, strengthGained:m.extraStrength,
    quality:uncertain?'unknown':warnings.length?'partial':'calculated',
    boundary:m.boundary, warnings,
    turnComplete:turn.turnComplete, completionReason:turn.completionReason,
    assumption:`${scope} Known-effects estimate; unmodeled interactions are omitted when marked partial. Displayed damage intents and explicit end-of-turn damage from remaining hand; no prediction of hidden draws or future turns. Extra block from an unavailable Fan counter is omitted. incomingMin/incomingMax bracket the turn\'s attack damage; when incomingExact is true they are equal and incoming is the total. Otherwise incoming is one end of that range (the provable floor, or a facing review\'s conservative ceiling) and incomingMax is the ceiling: compare plans on surviving it, never on the single incoming figure. hpLossUpper and survivesUpper are the same pessimistic reading taken through to HP. A null bound means the damage could not be read at all, not zero.`,
  };
}

function preference(m,s,kind) {
  const f=forecast(m,s);
  // No ceiling on this turn's damage: every candidate's outcome turns on a number
  // that was never read, so none of them can be told apart. The flat penalty is
  // the honest answer here, and the only place a null is allowed to stand in for
  // a number — widening the range to rank anyway would be inventing damage.
  if(f.incomingMax===null)return -10000;
  // Otherwise rank on the pessimistic end of the bound: a plan earns its place by
  // surviving the worst the interval allows, and only then by what it adds. Being
  // a bound is never itself a penalty, or a wide-but-readable plan would be buried
  // under a narrow one describing the very same danger.
  const safety=f.survivesUpper?0:-10000;
  const loss=f.hpLossUpper??0, damage=f.damage??0, gained=f.strengthGained, slippery=f.slipperyRemoved;
  // Charge an unmodeled card its cost: the bounded worst case is that it did nothing.
  const energy=m.energy-m.unsupportedEnergy;
  const potionsUsed=m.steps.filter(a=>a.command.action==='use_potion').length;
  if(kind==='setup')return safety+energy*8+gained*8+m.rage*3+slippery*4-loss*2-potionsUsed*2;
  if(kind==='conserve')return safety+damage*2-loss*8+slippery*5-potionsUsed*18;
  if(kind==='defense')return safety-loss*20+damage+gained*2;
  return safety+damage*3+slippery*6-loss*5+gained*5;
}

// Bounded search proposes options; Jev alone chooses among them. Keep every
// immediate legal action plus diverse continuations for each first action.
export function planCandidates(s, { maxDepth=6, beamWidth=256, maxPlans=64 }={}) {
  const roots=actionsFor(s);
  if(!s.battle || !s.player?.hand)return roots;
  const start=initial(s), singles=roots.map(a=>apply(start,a)).filter(Boolean);
  const keyOf=m=>JSON.stringify(m.steps.map(a=>a.command));
  let frontier=singles, all=[...singles], expanded=0;
  for(let depth=1;depth<maxDepth;depth++) {
    const next=[];
    for(const m of frontier) {
      if(m.boundary)continue;
      for(const a of available(m,s)) {
        if(++expanded>6000)break;
        const child=apply(m,a);if(child)next.push(child);
      }
      if(expanded>6000)break;
    }
    all.push(...next);
    const groups=[];
    // Preserve exploration from each original action, including potions.
    for(const root of roots) {
      const group=next.filter(m=>m.steps[0].id===root.id);
      const kept=[];
      for(const kind of ['attack','defense','setup','conserve']) {
        for(const best of group.toSorted((a,b)=>preference(b,s,kind)-preference(a,s,kind)).slice(0,2))
          if(!kept.includes(best))kept.push(best);
      }
      // Reserve a beam slot for a plan that closes the turn. A prefix reaching
      // maxDepth is not evidence that the turn ended there, and the beam used
      // to spend every one of its slots on prefixes. The completion pass is
      // what makes a plan closable, so it is run here: without it this slot
      // would look reserved while reserving nothing.
      const closed=group.map(m=>completeTurn(m,s)).filter(m=>m.turn.turnComplete)
        .toSorted((a,b)=>preference(b,s,'attack')-preference(a,s,'attack'))[0];
      if(closed&&!kept.includes(closed))kept.push(closed);
      groups.push(kept);
    }
    frontier=[];
    for(let i=0;i<8;i++) for(const group of groups) if(group[i] && frontier.length<beamWidth)frontier.push(group[i]);
    if(!frontier.length || expanded>6000)break;
  }
  // Search reaches a turn boundary rather than a depth limit. Every first
  // action is extended to a real turn end by completeTurn, and the strongest
  // ordering-sensitive prefixes are extended too, so the menu offers whole
  // turns in genuinely different card orders and not just one greedy line.
  const closed=[];
  const seenClosed=new Set(singles.map(keyOf));
  const addClosed=seed=>{
    if(!seed||seed.boundary&&seed.boundary!=='end_turn')return;
    const turn=completeTurn(seed,s);
    if(turn.steps.length<2||!turn.turn.turnComplete)return;
    const key=keyOf(turn);
    if(seenClosed.has(key))return;
    seenClosed.add(key);closed.push(turn);
  };
  for(const root of roots)addClosed(singles.find(m=>m.steps[0].id===root.id));
  for(const kind of ['attack','defense']) for(const root of roots)
    addClosed(all.filter(m=>m.steps.length>1&&m.steps[0].id===root.id).toSorted((a,b)=>preference(b,s,kind)-preference(a,s,kind))[0]);
  // The best whole turns claim the reserved share first; a menu of prefixes is
  // what made "End turn" look like the only option while energy sat in hand.
  closed.sort((a,b)=>preference(b,s,'attack')-preference(a,s,'attack'));
  const cap=Math.max(maxPlans,singles.length);
  // Whole turns may take at most half the free room, so the per-kind
  // exploration this search has always offered is never crowded out by them.
  const prefixCap=Math.max(singles.length,cap-Math.ceil(Math.min(closed.length,cap-singles.length)/2));
  const selected=[...singles], seen=new Set(singles.map(keyOf));
  for(const kind of ['attack','defense','conserve']) for(const root of roots) {
    const group=all.filter(m=>m.steps.length>1 && m.steps[0].id===root.id).toSorted((a,b)=>preference(b,s,kind)-preference(a,s,kind));
    for(const m of group) {
      const key=keyOf(m);
      if(seen.has(key))continue;
      if(selected.length>=prefixCap)break;
      seen.add(key);selected.push(m);break;
    }
  }
  for(const m of closed) {
    if(selected.length>=cap)break;
    const key=keyOf(m);
    if(seen.has(key)) {
      // The very same command sequence can arrive twice: once as a beam prefix
      // that happened to stop at a turn end, and once completed. The completed
      // reading is the true one, so it replaces the prefix in place rather than
      // being dropped — a plan must never be shown as shorter than it is.
      const at=selected.findIndex(x=>keyOf(x)===key);
      if(at>=0)selected[at]=m;
      continue;
    }
    seen.add(key);selected.push(m);
  }
  return selected.map((m,i)=>{
    const f=forecast(m,s);
    return {
      id:`p${i}`,command:m.steps[0].command,label:m.steps.map(a=>a.label).join(' → '),
      details:m.steps[0].details,
      plan:m.steps.map(a=>({label:a.label,command:a.command})), forecast:f,
      turnComplete:f.turnComplete, completionReason:f.completionReason,
    };
  });
}

// Offline opt-in: rebuild complete plans with Rage before attacks, preserving
// original card identity as hand indices shift. Baseline candidates are untouched.
export function withRageReorders(s,candidates,{maxExtra=16}={}) {
  const added=[],seen=new Set(candidates.map(c=>JSON.stringify(c.plan?.map(p=>p.command))));
  for(const candidate of candidates){
    if(added.length>=maxExtra)break;
    if(!candidate.plan || candidate.plan.length<2)continue;
    let m=initial(s);const identities=[];let valid=true;
    for(const step of candidate.plan){
      if(m.boundary){valid=false;break;}
      const a=available(m,s).find(a=>JSON.stringify(a.command)===JSON.stringify(step.command));
      if(!a){valid=false;break;}
      identities.push({action:a.command.action,source:a.details?.sourceIndex,target:a.command.target,slot:a.command.slot,name:a.details?.name,type:a.details?.type});
      m=apply(m,a);if(!m){valid=false;break;}
    }
    if(!valid)continue;
    const index=identities.findIndex(a=>a.action==='play_card'&&a.name?.replace(/\+$/,'')==='Rage');
    if(index<1||!identities.slice(0,index).some(a=>a.type==='Attack'))continue;
    const ordered=[identities[index],...identities.filter((_,i)=>i!==index)];m=initial(s);
    for(const id of ordered){
      if(m.boundary){valid=false;break;}
      const a=available(m,s).find(a=>a.command.action===id.action && (id.action==='play_card'?a.details?.sourceIndex===id.source&&a.command.target===id.target:id.action==='use_potion'?a.command.slot===id.slot&&a.command.target===id.target:true));
      if(!a){valid=false;break;}m=apply(m,a);if(!m){valid=false;break;}
    }
    if(!valid)continue;
    const key=JSON.stringify(m.steps.map(a=>a.command));if(seen.has(key))continue;
    seen.add(key);let id='rage-reorder-'+added.length;while(candidates.some(c=>c.id===id))id+='x';
    added.push({id,command:m.steps[0].command,label:m.steps.map(a=>a.label).join(' → '),details:m.steps[0].details,plan:m.steps.map(a=>({label:a.label,command:a.command})),forecast:forecast(m,s),reorderedFrom:candidate.id});
  }
  return [...candidates,...added];
}

// The ranking the bounded search sorts candidates with, exposed on its own so
// the numbers that decide which plans are kept can be checked directly. It runs
// the identical initial/apply/preference path the search uses, so a test here is
// a statement about the real ranking and not a re-implementation of it.
export function planPreference(s, labels, kind) {
  let m = initial(s);
  for (const label of labels) {
    if (m.boundary) throw new Error(`Cannot project past ${m.boundary}`);
    const action = available(m,s).find(a => a.label===label);
    if (!action) throw new Error(`Action not available: ${label}`);
    m = apply(m, action);
  }
  return preference(m, s, kind);
}

export function projectSequence(s, labels) {  let m=initial(s);
  for(const label of labels) {
    if(m.boundary)throw new Error(`Cannot project past ${m.boundary}`);
    const action=available(m,s).find(a=>a.label===label);
    if(!action)throw new Error(`Action not available: ${label}`);
    m=apply(m,action);
  }
  return forecast(m,s);
}

export function decisionWarnings(s,c) {
  const notes=[]; const a=c.command;
  const playable=(s.player.hand??[]).filter(x=>x.can_play);
  if(a.action==='end_turn' && playable.length)notes.push(`Ends turn with ${s.player.energy} energy and playable cards: ${playable.map(x=>x.name+' ('+x.cost+')').join(', ')}. Compare their damage and Rage block before ending.`);
  if(a.action==='use_potion' && (s.player.potions??[]).find(p=>p.slot===a.slot)?.name==='Block Potion' && factsFor(s).displayed_incoming_attack_total===0)notes.push('No displayed incoming attack: this Block Potion currently prevents zero attack damage. Save it unless another stated mechanic justifies use.');
  return notes;
}
const isCombat = s => ['monster','elite','boss'].includes(s.state_type);
export function decisionCandidates(s) { return isCombat(s) ? planCandidates(s) : actionsFor(s); }

// The knowledge base in mechanics/ is 159 resolved entities - damage, block, debuff counts parsed out of
// the game's own descriptions - and it existed with no consumer, so every policy was reading card prose and
// re-deriving numbers the agent already had verified. decisionQuestion() is the one place that reaches all
// of them: deliberate(), factoredDeliberate(), betterDeliberate() and recallingDeliberate() all build their
// request through it, and factoredQuestion() is that base plus per-candidate nouls, so a single attach here
// covers the one-call fast policies AND the multi-call upstream path.
//
// WHY IT ATTACHES BEFORE compactRequest(), WHICH IS THE OPPOSITE OF learning/wire.mjs. wire.mjs has to
// attach late because its recall context is a late-arriving argument with no business reshaping the
// request. This one is built from the same state the compactor is about to walk, and compactRequest() only
// ever rewrites four structures: state.state.player piles, recent_observations, candidate_details (and the
// forecast_references interned out of it) and card_order_review. `mechanics` is a fifth top-level key that
// none of those can reach, so it reaches Jev byte-identical either side of the compactor. That is asserted,
// not assumed - see mechanics-live.test.mjs, which strips the key before compacting and requires the
// compactor's output to be identical byte for byte, interning tables included.
//
// A per-decision byte budget, because $/decision and latency are published claims and this rides every call.
// Measured across the 50 combat fixtures: the median request is 52,171 bytes and the largest is 151,518, so
// the cap is under 4% of a median request - but a percentage of a big request is the flattering half of the
// story, and against the smallest board (18,755 bytes) it is 9.5%. The honest median addition is 1,945 bytes,
// ~540 tokens; the largest is 2,054 including the JSON key. The budget is met by DROPPING entities in value
// order and publishing the drop - never by inventing a value and never by slicing a string mid-sentence.
export const MECHANICS_STATE_KEY = 'mechanics';
export const MECHANICS_BYTE_CAP = 2048;

// The safety contract, and the reason this key is worth its bytes: an absent field means the generator could
// not read it, known:false means no reading exists at all, and `mutable` means the corpus recorded several
// readings so the entity publishes all of them instead of picking one. The counts are described in place
// because a counts block the model has to interpret is a counts block it can misread.
const MECHANICS_NOTE = 'Resolved effects for the entities on this board, parsed from the game\'s own descriptions. An absent field means the generator could not read it, NOT zero. known:false = no reading exists, so use that entity\'s own description in state.state. mutable = every reading on record, not a choice. counts: found (on the board) / listed (attached here) / dropped (left out to fit the byte budget - read those in state.state).';

// `description` rides for an UNKNOWN entity only. That is the one case where it is the only effect evidence
// there is; a known entity's effects already encode its text and the full text is still in state.state.
// `piles` is dropped outright: it is a name-only listing of the draw and discard piles that state.state
// already carries, and it is the one part of retrieveMechanics() that would read pile order at all.
const projectMechanics = entity => ({name:entity.name,kind:entity.kind,...(entity.side?{side:entity.side}:{}),
  known:entity.known,confidence:entity.confidence,source:entity.source,
  ...(entity.known?{}:{description:entity.description??null}),
  ...(entity.instances>1?{instances:entity.instances}:{}),effects:entity.effects});

// What survives the budget. A resolved effect first, because it is the one thing on this key the model
// cannot get anywhere else on the request; then a known entity that resolved to nothing; then an unknown
// one, whose name and description are both already in state.state and whose real contribution - "expect no
// number here" - is carried by the unknown count whether or not the entry itself fits. `effects` is tested
// for CONTENT, not truthiness: a known entry the corpus resolved to an empty object is evidence-free, and
// under a tight budget it must not outrank one that actually carries a number.
const mechanicsValue = entity => entity.known ? (Object.keys(entity.effects ?? {}).length ? 0 : 1) : 2;

/**
 * The knowledge base's resolved semantics for the entities in THIS state, bounded to `cap` bytes.
 *
 * retrieveMechanics() already does the part that matters most - it only returns entities present in this
 * state, and an entity it has never seen comes back known:false with effects:null - so none of that is
 * re-derived here. On top it merges entries whose projection is byte-identical (two enemies each carrying
 * the same Strength), which is lossless because `name` is part of the projection key, so only the same name
 * with the same everything can collapse, and the instance count carries the multiplicity.
 *
 * Returns null when there is nothing to say - no battle, no entities, or a cap too small to hold a single
 * one. Omitting the key beats publishing a counts block that does not describe what was attached, which is
 * the same confidently-wrong-value failure one layer up.
 */
export function mechanicsContext(state, cap = MECHANICS_BYTE_CAP) {
  if(!state?.battle)return null;
  const retrieved = retrieveMechanics(state), found = retrieved.counts.entities;
  if(!found)return null;
  const byProjection = new Map();
  for(const entity of retrieved.entities){
    const projected = projectMechanics(entity), key = JSON.stringify(projected), prior = byProjection.get(key);
    if(prior)prior.instances = (prior.instances??1)+1; else byProjection.set(key,projected);
  }
  const merged = [...byProjection.values()].toSorted((a,b)=>mechanicsValue(a)-mechanicsValue(b));
  const build = kept => {
    // The glossary is re-derived from the KEPT entities, not from the whole retrieval: a rule explaining a
    // keyword the budget dropped would be context about something the model cannot see.
    const glossary = {};
    for(const entity of kept)for(const keyword of entity.effects?.keywords??[])if(retrieved.glossary[keyword])glossary[keyword]=retrieved.glossary[keyword];
    const unknown = kept.filter(e=>!e.known).length;
    return {entities:kept,
      counts:{found,listed:kept.length,known:kept.length-unknown,unknown,merged:found-byProjection.size,dropped:byProjection.size-kept.length},
      unknown:[...new Set(kept.filter(e=>!e.known).map(e=>e.name))],glossary,note:MECHANICS_NOTE};
  };
  let kept = merged, context = build(kept);
  while(kept.length && Buffer.byteLength(JSON.stringify(context))>cap){kept = kept.slice(0,-1);context = build(kept);}
  return kept.length ? context : null;
}

export function decisionQuestion(s,candidates) {
  s=visibleState(s);
  if(!isCombat(s)){const q=makeQuestion(s,candidates);q.state.encounter=encounterBrief(s);q.state.deck=deckSnapshot(s);q.state.spending_routes=spendingRoutes(s);return q;}
  const mechanics = mechanicsContext(s);
  return {
    model:'typesafe/jev-1.13',
    state:{game:'Slay the Spire 2',objective:'Win the run. Survive the current turn and preserve useful resources.',state:s,encounter:encounterBrief(s),deck:deckSnapshot(s),facts:factsFor(s),policy:POLICY_VERSION,setup_dependencies:setupLinks(s),mechanics_review:mechanicsReview(s),...(mechanics?{[MECHANICS_STATE_KEY]:mechanics}:{}),potion_timing:potionTiming(s),
      forecast_scope:'Plans are short prefixes, not complete optimal turns. Forecasts assume ending after the prefix. Null means unknown, not zero. Partial outcomes have explicit caveats. Do not treat displayed card damage as actual damage through enemy powers. When incomingExact is false, incomingMin and incomingMax bracket the turn\'s damage: prefer a plan that survives incomingMax, and do not read the single incoming figure as what will land. A bounded plan is a usable plan — rank it on its bound instead of setting it aside.'},
    questions:{move:{type:'choice',
      instructions:'Choose the next action or short plan that best advances winning the run. Derive tactics from visible rules, intents, cards and observations. Calculations are aids, not guaranteed outcomes; partial estimates omit stated effects and null means unknown. Evaluate tradeoffs over the encounter, not only the current turn. Only the FIRST action executes, followed by a fresh observation. Choose only among supplied IDs.',
      criteria:Object.fromEntries(candidates.map(c=>[c.id,JSON.stringify({sequence:c.plan,forecast:c.forecast,first_action_rules:c.details.description})])),
    }},
  };
}
