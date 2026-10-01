import { createHash } from 'node:crypto';
import { parseIntentLabel, readIntentDamage } from './planner.mjs';
import { deckAssessment, deckUnavailableInstruction } from './deck-assessment.mjs';

export function fingerprint(state) {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

// Every selectable answer is constructed from the current game state. Jev
// chooses an ID; it never supplies arbitrary HTTP endpoints or action arguments.
// Explicit user exclusion: never acquire Sword of Stone.
const excludedRelic = x => [x.name,x.relic_name,x.id,x.relic_id].some(v => /^(?:the )?sword(?: of| and the) stone$/i.test(String(v??'').replaceAll('_',' ')));

// THE ONLY ROUTE EVIDENCE THE GAME GIVES IS `leads_to`, AND IT WAS BEING DROPPED ON THE FLOOR.
// The label named the destination room and nothing else, so a System-One scorer was handed three
// identically-labelled `Travel to Monster (column N)` options while the Elite one row below them sat
// unread in `details`. Measured on 2026-09-23: 57 executed map decisions, 14 offered an Elite, 6 were
// taken, and at act 1 floor 12 (asc 3, 67/75 HP) three of four options led to an Elite.
//
// THE MEASURED SHAPE DECIDES WHAT MAY BE CLAIMED. All 117 populated options were exactly one row
// deep and every row within a list was uniform, so the entries in `leads_to` are SIBLING BRANCHES,
// never a sequence. A RestSite listed beside an Elite is therefore an ALTERNATIVE to it, not
// healing that lands first - so this reports a rest as "before" only when it is strictly shallower,
// the same rule `factored.mjs` and `decision-focus.mjs` already state. Only the immediate children
// are named in the label: a deeper `leads_to` may be walked to order the branch, but a label must
// never describe a room the game has not shown.
const ROUTE_MAX_DEPTH = 4;
export function routeAhead(node) {
  const immediate = [];
  let eliteAhead = false, restAhead = false;
  // `rest_before_elite` is a claim about a PATH, not about two depths that happen to exist somewhere
  // in the subtree. Taking the minimum depth of each type across all branches compares a campfire on
  // one branch against an Elite on another, and reports a heal that is not on the Elite's path:
  //
  //   branch A: RestSite -> Monster
  //   branch B: Monster -> Elite
  //
  // min-depth gives restDepth 1 and eliteDepth 2, so the old code claimed "rest first" while the
  // branch that actually leads to the Elite contains no campfire at all. A same-row sibling case was
  // already covered by a test; this is the same defect one level deeper, and it survived because
  // only the shallower shape was pinned.
  //
  // The claim is therefore only made when EVERY path that reaches an Elite passes a RestSite first.
  // One Elite path without a campfire is enough to withhold it, because the agent chooses a path and
  // the prompt cannot say which.
  let elitePaths = 0, elitePathsWithPriorRest = 0;
  const visit = (nodes, depth, seenRest) => {
    if (depth > ROUTE_MAX_DEPTH) return;
    for (const n of Array.isArray(nodes) ? nodes : []) {
      if (!n || typeof n !== 'object' || typeof n.type !== 'string') continue;
      // The rest flag is a property of the PATH BELOW this node, never of its siblings. Assigning
      // `seenRest = true` in place leaked a RestSite into whatever came after it in the same array,
      // so the same board answered differently depending on the order the children were listed —
      // and a RestSite listed before an Elite manufactured a heal on the Elite's path. That is the
      // defect this whole function is about, reintroduced one line down.
      const belowSawRest = seenRest || n.type === 'RestSite';
      if (n.type === 'Elite') {
        eliteAhead = true;
        elitePaths++;
        if (belowSawRest) elitePathsWithPriorRest++;
      }
      if (n.type === 'RestSite') restAhead = true;
      if (depth === 0 && !immediate.includes(n.type)) immediate.push(n.type);
      visit(n.leads_to, depth + 1, belowSawRest);
    }
  };
  visit(node?.leads_to, 0, false);
  return { ahead: immediate, elite_ahead: eliteAhead, rest_ahead: restAhead,
           // Zero elite paths means nothing to precede, so this is false and never vacuously true.
           rest_before_elite: elitePaths > 0 && elitePathsWithPriorRest === elitePaths };
}

// A rest and an elite at the SAME depth are alternatives, not a heal-then-fight order. Saying
// "rest first" there would be the single most damaging thing this label could invent: it would
// license walking into an elite at 10/75 HP on the strength of healing that is not coming.
const routeNote = r => !r.elite_ahead ? ''
  : r.rest_before_elite ? ', rest first'
  : r.rest_ahead ? ', rest beside it not before'
  : ', no rest before';
const hp = s => { const {hp: cur, max_hp: max} = s.player ?? {};
  return Number.isFinite(cur) && Number.isFinite(max) && max > 0 ? { cur, max, fraction: cur / max } : null; };
const hpNote = h => h ? ` · ${h.cur}/${h.max} HP` : '';
export function actionsFor(s) {
  const out = [];
  const add = (action, args = {}, label = action, details = {}) =>
    out.push({ id: `a${out.length}`, command: { action, ...args }, label, details });
  const list = (items, action, field = 'index', filter = () => true) => {
    for (const x of items ?? []) if (filter(x)) add(action, { [field]: x.index }, x.name ?? x.title ?? x.description ?? `${action} ${x.index}`, x);
  };
  const proceed = (allowed) => { if (allowed) add('proceed', {}, 'Continue to the map'); };
  const combat = ['monster', 'elite', 'boss'].includes(s.state_type);
  if (combat) {
    if (!s.battle?.is_play_phase || s.battle?.turn !== 'player') return [];
    const enemies = (s.battle.enemies ?? []).filter(e => e.hp > 0);
    const targeted = (item, action, args) => {
      if (item.target_type === 'AnyEnemy') {
        for (const e of enemies) add(action, { ...args, target: e.entity_id }, `${item.name} → ${e.name}`, item);
      } else if (action === 'use_potion' && ['AnyPlayer', 'AnyAlly'].includes(item.target_type)) {
        // STS2MCP's singleplayer potion handler resolves these to player.Creature.
        add(action, args, item.name, item);
      } else if (['None', 'Self', 'AllEnemies', 'RandomEnemy'].includes(item.target_type)) {
        add(action, args, item.name, item);
      }
    };
    for (const c of s.player?.hand ?? []) if (c.can_play) targeted(c, 'play_card', { card_index: c.index });
    for (const p of s.player?.potions ?? []) if (p.can_use_in_combat) targeted(p, 'use_potion', { slot: p.slot });
    add('end_turn', {}, 'End turn');
  } else switch (s.state_type) {
    case 'crystal_sphere': {
      const sphere=s.crystal_sphere??{};
      for(const tool of ['big','small']) if(sphere['can_use_'+tool+'_tool'] && sphere.tool!==tool)
        add('crystal_sphere_set_tool',{tool},'Select '+tool+' divination tool');
      if(['big','small'].includes(sphere.tool) && sphere['can_use_'+sphere.tool+'_tool'])
        for(const c of sphere.cells??[]) if(c.is_clickable)
          add('crystal_sphere_click_cell',{x:c.x,y:c.y},`Reveal tile (${c.x}, ${c.y}) with ${sphere.tool} tool`);
      if(sphere.can_proceed)add('crystal_sphere_proceed',{},'Finish divination');
      break;
    }
    case 'map': {
      // LABEL ENRICHMENT ONLY. Nothing here drops, vetoes, reorders or filters an option, and the
      // candidate count is byte-identical to before. A veto is a DIFFERENT change and is not made:
      // four of the six elites taken in the recorded run were forced (no alternative existed), and a
      // filter could only have changed 2 of 6 decisions. Act-1 elite relics are the main source of
      // scaling damage. Adding the consequence can only inform.
      //
      // The previous version of this comment also claimed "none of the five runs ever reached a
      // boss, so there is no evidence in the corpus that skipping elites is right". Both halves were
      // stale and a review caught it. The corpus now holds boss kills, an Act 2 floor 31 death, and
      // a measured elite record.
      //
      // What the record actually says, from the tested fight-outcome module rather than from a
      // summary: 20 elite fights, 12 won, 8 lost - 60%, not the 32% the review quoted. Elites are
      // not close to unwinnable. The measured pattern is ENTRY, not the fight: 12 of 20 elite
      // fights were entered at 20 HP or less, against a monster win rate near 92%. So the lever is
      // not "elites are bad" and the fix is not a blanket veto, which the forced-elite count rules
      // out; it is the state the agent is in when it commits. That is a claim worth measuring
      // before acting on, and it is not what either this comment or the review said.
      const health = hp(s);
      for (const n of s.map?.next_options ?? []) {
        const risk = routeAhead(n);
        const label = `Travel to ${n.type} (column ${n.col})`
          + (risk.ahead.length ? ` → ${risk.ahead.join('/')} next` : ' → no room shown ahead')
          + routeNote(risk) + hpNote(health);
        add('choose_map_node', { index: n.index }, label,
          { ...n, route_risk: risk, hp_fraction: health ? health.fraction : null });
      }
      break;
    }
    case 'event':
      if (s.event?.in_dialogue) add('advance_dialogue', {}, 'Advance dialogue');
      else list(s.event?.options, 'choose_event_option', 'index', x => !x.is_locked && !/\b(?:obtain|gain|receive|take) (?:the )?sword of stone\b/i.test(x.description??''));
      break;
    case 'rewards': {
      const beltFull = (s.player?.potions?.length ?? 0) >= (s.player?.max_potion_slots ?? 3);
      list(s.rewards?.items, 'claim_reward', 'index', x => !excludedRelic(x) && (x.type !== 'potion' || !beltFull));
      // Collect rewards before proceeding; choosing a card still allows skipping.
      if (!out.length) proceed(s.rewards?.can_proceed);
      break;
    }
    case 'card_reward':
      list(s.card_reward?.cards, 'select_card_reward', 'card_index');
      if (s.card_reward?.can_skip) add('skip_card_reward', {}, 'Skip');
      break;
    case 'rest_site':
      list(s.rest_site?.options, 'choose_rest_option', 'index', x => x.is_enabled);
      proceed(s.rest_site?.can_proceed); break;
    case 'shop': case 'fake_merchant': {
      const shop = s.shop ?? s.fake_merchant?.shop;
      const full = (s.player?.potions?.length ?? 0) >= (s.player?.max_potion_slots ?? 3);
      for (const item of shop?.items ?? []) {
        if (excludedRelic(item) || !item.is_stocked || !item.can_afford || (item.category === 'potion' && full)) continue;
        const name = item.card_name ?? item.relic_name ?? item.potion_name ?? item.name ?? (item.category === 'card_removal' ? 'Remove a card' : item.category);
        add('shop_purchase', {index:item.index}, `${name} — ${item.price} gold`, {...item, gold_after_purchase:(s.player?.gold ?? 0)-item.price});
      }
      // The bridge's proceed action first closes the inventory. can_proceed
      // only describes the button behind it, which is disabled while shopping.
      proceed(shop?.can_proceed || (Array.isArray(shop?.items) && !shop?.error)); break;
    }
    case 'treasure':
      list(s.treasure?.relics, 'claim_treasure_relic', 'index', x=>!excludedRelic(x));
      if (!out.length) proceed(s.treasure?.can_proceed);
      break;
    case 'hand_select': {
      const h = s.hand_select;
      if (h?.can_confirm) add('combat_confirm_selection', {}, 'Confirm selection');
      if (!h?.can_confirm || /any number/i.test(h?.prompt ?? '')) list(h?.cards, 'combat_select_card', 'card_index', x => !(h?.selected_cards ?? []).some(c => c.index === x.index));
      break;
    }
    case 'card_select': {
      const c = s.card_select;
      // HOW MANY THIS SCREEN WANTS. The old pattern matched only "Choose N cards to Enchant.", so an
      // UPGRADE screen ("Choose a card to Upgrade.") matched nothing, `required` was null, and the
      // count was never enforced — the screen was treated as "confirm whenever the bridge feels like
      // it". Generalised: any "Choose N card(s)", and a screen that asks for a single card wants ONE.
      const wantN = c?.prompt?.match(/\bchoose\s+(\d+)\s+cards?\b/i);
      const wantOne = /\bchoose\s+a\s+card\b/i.test(c?.prompt ?? '')
        || /\bchoose\s+one\s+card\b/i.test(c?.prompt ?? '');
      const required = wantN ? Number(wantN[1]) : (wantOne ? 1 : null);
      const selected = c?.cards?.filter(x=>x.is_selected).length ?? 0;
      const satisfied = required === null || selected >= required;
      const ready = Boolean(c?.can_confirm) && satisfied;
      // EVERY card is offered, selected ones included, because `select_card` TOGGLES on a grid
      // screen (vendor api-reference.md, `select_card`: "toggles selection"). Offering only the
      // unselected ones made the screen a dead end: a bad selection could not be undone, only
      // confirmed. Measured live — a Deck Enchant screen sat on "Choose 3 cards to Enchant" with
      // nine confirms executed and the screen never advanced, because the only legal move was to
      // confirm the selection it had already got wrong. Selected cards are labelled as the
      // deselect they are, so the label never claims a card is being added when it is being removed.
      // CONFIRM FIRST ONCE THE SCREEN IS SATISFIED. Same lesson as the combat menu: a plan the reader
      // never reaches is not on the menu. Measured on an upgrade screen — the agent toggled cards for
      // TWENTY-TWO decisions while `confirm_selection` sat at the bottom of thirteen identical-looking
      // "Select Strike" entries. Confirming alone advances the screen, verified by hand against the
      // bridge. The cards stay offered, because on an unsatisfied screen picking one is the whole task.
      // A grid that omits is_selected and has an acknowledged-but-unreported selection is still a
      // screen waiting on a confirm. Without this the Confirm option never appears and the agent
      // re-selects the same card forever.
      if (ready || c?.selection_ambiguous) add('confirm_selection', {}, 'Confirm selected cards');
      for (const x of c?.cards ?? []) {
        if (x?.index === undefined || x?.index === null) continue;
        add('select_card', {index: x.index},
          x.is_selected ? `Deselect ${x.name}` : `Select ${x.name}`, x);
      }
      if (c?.can_skip) add('cancel_selection', {}, 'Skip selection');
      break;
    }
    case 'bundle_select':
      if (s.bundle_select?.can_confirm) add('confirm_bundle_selection', {}, 'Confirm this bundle');
      else list(s.bundle_select?.bundles, 'select_bundle');
      break;
    case 'relic_select':
      list(s.relic_select?.relics, 'select_relic', 'index', x=>!excludedRelic(x));
      if (s.relic_select?.can_skip) add('skip_relic_selection', {}, 'Skip relic');
      break;
    // Menus and unknown overlays stop safely instead of abandoning a save,
    // selecting multiplayer, changing profiles, or starting another run.
  }
  return out;
}

const attackingIntents = s => (s.battle?.enemies ?? []).filter(e => e.hp > 0)
  .flatMap(e => e.intents ?? [])
  .filter(i => /attack|deathblow/i.test(i.type) || /attack.*\d+ damage/i.test(i.description ?? ''));

// The labels are what the model reads; the count is the authority when the list is capped.
const UNREAD_LABEL_CAP = 8;

// A field named for a total must hold the total or nothing. 0 is a claim that the
// game showed no damage; an unread intent means the number is unknown, and
// publishing a partial sum as the total is how a printed 12 read as a harmless 0
// next to an `all_attack_labels_parsed:false` the model had no reason to distrust.
export function factsFor(s) {
  const intents = attackingIntents(s);
  let low = 0, high = 0, contradictory = 0, labelsParsed = true;
  const unread = [];
  for (const intent of intents) {
    // The game prints multi-hit attacks as `4x3 (12)`. The planner's reader is the
    // single parser; a second, narrower regex here is what zeroed a 12-damage attack.
    // Label readability is recorded even for an intent the description cannot rescue:
    // all_attack_labels_parsed names the labels, so a '?' must fail it either way.
    if (!parseIntentLabel(intent.label)) labelsParsed = false;
    const read = readIntentDamage(intent);
    if (!read) { unread.push(String(intent.label ?? '').replace(/\[.*?\]/g, '').trim() || String(intent.type)); continue; }
    const product = read.perHit * read.hits;
    if (read.alt === null) { low += product; high += product; }
    // Two printed numbers disagree: the truth is one of them, so carry the interval
    // rather than picking the one that reads best.
    else { contradictory++; low += Math.min(product, read.alt); high += Math.max(product, read.alt); }
  }
  // An unread intent has no upper bound at all, so neither does the board: a max
  // summed over the readable intents only would be the same partial sum again.
  const known = unread.length === 0;
  const single = known && low === high ? low : null;
  const block = s.player?.block ?? 0;
  return {
    displayed_incoming_attack_total: single,
    displayed_incoming_attack_min: known ? low : null,
    displayed_incoming_attack_max: known ? high : null,
    // THE LOWER BOUND, ALWAYS. `low` sums the intents we COULD read. It is a floor on the damage
    // this turn will actually take, and it is exact whenever every intent read (where it equals the
    // total). It is published even when something is unread, because "we know at least this much is
    // coming" is strictly more useful than the null it used to be buried under — and it is enough to
    // prove a turn lethal on its own: if the floor alone exceeds HP plus block, the unread intents
    // cannot rescue it, because they can only add.
    //
    // 18 lost fights in the corpus contained no early lethal forecast at all, and this is the number
    // that would have supplied one. It is arithmetic over printed numbers, not a guess.
    displayed_incoming_attack_lower_bound: Math.max(0, low),
    attack_intents_read: intents.length - unread.length,
    attack_intents_unread: unread.length,
    contradictory_attack_labels: contradictory,
    unread_attack_labels: unread.slice(0, UNREAD_LABEL_CAP),
    all_attack_labels_parsed: labelsParsed,
    displayed_block_gap: single === null ? null : Math.max(0, single - block),
    // The same idea against block: a floor on the damage that will get through.
    displayed_block_gap_lower_bound: Math.max(0, low - block),
    note: 'Arithmetic over displayed attack intents only, not a combat simulation. Powers, redirection, and actions can change damage. Card descriptions are supplied by the game. Never assume hidden draw order.'
      + ' A null total means the damage could not be read, not that there is none: read attack_intents_unread and unread_attack_labels for what is missing, and unread_attack_labels is capped at ' + UNREAD_LABEL_CAP + ' so the count is the authority.'
      + ' Where min and max differ, two printed numbers disagree and the truth lies between them.',
  };
}

export function makeQuestion(state, actions) {
  if (!actions.length || actions.length > 255) throw new Error('Unsupported action count');
  const facts = factsFor(state);
  // A null the request never explains is indistinguishable from a zero the request
  // invented, so an unread board says so in words as well as in the field.
  // NO ATTACK IS COMING. Measured: the agent blocked on 10 turns where the enemy had no attack
  // intent at all, incoming 0 - including one with 3 energy and a 7-damage plan on the menu, where
  // it chose a 0-damage Defend. The planner's ranking was RIGHT on those boards; the model was
  // choosing defence because the request only ever framed survival as worth having, and never said
  // that block against nothing prevents nothing. That is a derived fact from the visible intents, not
  // advice, so it belongs in the request rather than in the ranking.
  const idleNotice = facts.displayed_incoming_attack_total === 0 && (state?.battle?.is_play_phase ?? false)
    ? ' No enemy is attacking this turn, so Block prevents nothing here and its energy is better spent on damage or setup. Prefer a plan that deals damage; reserve Block for a turn that actually has an attack coming.'
    : '';
  const unreadNotice = facts.displayed_incoming_attack_total === null
    ? ' This board\'s incoming attack damage could not be read, so displayed_incoming_attack_total and displayed_block_gap are null: that is unknown, not zero. Compare protection by what each card actually blocks, and do not treat the missing total as licence to ignore the turn.'
    : '';
  // This note is a CLAIM about what the request contains, so it may only be made when it is true.
  // The bridge does not send a permanent deck - `player.deck` is absent in every logged record - but
  // `makeQuestion` is also the base every policy builds on, and a state that DOES carry one (a replay
  // fixture, a future bridge build, the documented `deck-state.patch`) must not be told its deck is
  // missing. Asserting an absence that does not hold is the same defect as asserting a value that
  // does not, only quieter.
  const deckNote = state?.state_type === 'card_reward' && deckAssessment(state)?.available === false
    ? deckUnavailableInstruction
    : '';
  return {
    model: 'typesafe/jev-1.13',
    state: { game: 'Slay the Spire 2', objective: 'Win this complete run without human gameplay decisions.', state, facts },
    questions: { move: {
      type: 'choice',
      instructions: 'Choose the next legal action that best advances winning the run. Infer how cards and relics interact from their visible rules. Compare each choice, including skip when offered, using current capabilities, costs, consistency and needs. Follow the actual selection prompt. No fixed archetype or encounter strategy is prescribed. Choose only a supplied ID. '
        + deckNote
        + unreadNotice
        + idleNotice,
      criteria: Object.fromEntries(actions.map(a => [a.id, JSON.stringify({ action: a.command, label: a.label, details: a.details })])),
    } },
  };
}
