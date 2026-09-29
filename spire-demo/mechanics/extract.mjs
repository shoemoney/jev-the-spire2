// Generator: reads a run log and emits knowledge.mjs. Run: node spire-demo/mechanics/extract.mjs [logPath]
// The corpus is private and gitignored, so a clean clone CANNOT re-run this; knowledge.mjs is committed, so
// only regeneration needs the log. Point at one with argv[2], $SPIRE_RUN_LOG, or the pinned default.
// Everything in knowledge.mjs comes from verbatim game data in the log. Numbers are only emitted when a
// pattern is unambiguous; anything not matched leaves the field absent. Absence is the honest signal.
import {existsSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {basename, dirname, join, relative, resolve} from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const DEFAULT_LOG = join(REPO, '.private/spire-runs/2026-09-23T20-41-11.451Z.jsonl');
export const SAMPLE_LOG = join(HERE, 'sample-run.json');
// Two forms of the same path, because they answer different questions and only one of them is allowed to be
// absolute. rel() is read by a person sitting at this machine right now, so a path outside the repo stays
// absolute - that is the thing they can act on. sourceLabel() is written INTO a committed artifact, so it
// must be a pure function of which corpus was read, never of where the checkout happens to sit.
const rel = p => { const r = relative(REPO, p); return !r || r.startsWith('..') ? p : r; };
// The corpus lives outside some checkouts (a worktree reading the main clone's .private/), so keying this on
// a repo-relative path alone bakes the reader's home directory into a file every clone then carries. Anchor
// on the .private segment itself: the same log yields the same label from any checkout on any machine.
export function sourceLabel(p) {
  const priv = p.match(/(?:^|[/\\])\.private[/\\](.*)$/);
  if (priv) return `.private/${priv[1]}`;
  const r = relative(REPO, p);
  return r && !r.startsWith('..') ? r : basename(p);
}

// The game's own keyword glossary, harvested from the log. These are RULES, never entities: looking up
// 'Retain' must not return a card. A glossary entry may also disagree with the live card it describes
// (Sovereign Blade's glossary says 10 damage while the live card reads 15/17/22/24), so the glossary is
// deliberately kept out of KNOWLEDGE and never used to derive an entity's effects.
export const GLOSSARY_RULES = ['Block','Energy','Eternal','Ethereal','Exhaust','Forge','Innate','Plating','Replay','Retain','Sharp','Unplayable'];

// Per-stack idioms we are willing to defend. Anything else stays stacksScale:'unknown' rather than guessed.
const STACK_IDIOMS = [
  /increases?\s+[\w\s]+by\s+\d+/i,
  /receive\s+\d+%\s+more\s+damage/i,
  /deal\s+\d+%\s+less\s+damage/i,
  /gain\s+\d+%\s+less\s+block/i,
  /deals?\s+\d+\s+additional\s+damage/i,
];

const ICON = /\[([a-z_]*)icon\.png\]/g;
// The game writes [ironclad_energy_icon.png] and [regent_energy_icon.png] - the character varies, the
// suffix does not, so energy icons are matched by suffix and star icons by their exact name.
const countIcon = (s, kind) => kind === 'energy'
  ? [...s.matchAll(/\[[a-z_]*energy_icon\.png\]/g)].length
  : [...s.matchAll(new RegExp(`\\[${kind}_icon\\.png\\]`, 'g'))].length;

// Descriptions embed '[star_icon.png]' etc. Their internal '.' is never followed by whitespace, so splitting
// on a sentence-final period keeps icons intact.
const sentences = d => String(d ?? '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
const norm = v => (v == null || v === 'None' || v === '' ? null : v);

// One effect per match, appended to a bucket rather than overwritten, so 'Gain 5 Block. Next turn, gain 5
// Block.' yields both without either clobbering the other.
function put(target, key, value){ if(value == null) return false; (target[key]??=[]).push(value); return true; }

// RULES: each entry is [name, applies to, test, apply]. `test` returning true means the pattern was
// recognised; `apply` records what it learned. Order matters - most specific first.
const RULES = [
  // --- damage -------------------------------------------------------------
  ['damage:fromBlock', 'card', /deal\s+damage\s+equal\s+to\s+your\s+block/i, e => e.damageFromBlock = true],
  ['damage:perExhausted', 'any', /deal\s+(\d+)\s+damage\s+for\s+each\s+card\s+exhausted/i, (e,m) => e.damagePerExhaustedCard = +m[1]],
  ['damage:allHits', 'any', /deal\s+(\d+)\s+damage\s+to\s+all\s+enemies\s+twice/i, (e,m) => { e.damage = +m[1]; e.damageAll = true; e.hits = 2; }],
  ['damage:all', 'any', /deal\s+(\d+)\s+damage\s+to\s+all\s+enemies/i, (e,m) => { e.damage = +m[1]; e.damageAll = true; }],
  ['damage:twice', 'any', /deal\s+(\d+)\s+damage\s+twice/i, (e,m) => { e.damage = +m[1]; e.hits = 2; }],
  ['damage:times', 'any', /deal\s+(\d+)\s+damage(?:\s+to\s+all\s+enemies)?\s+(\d+)\s+times/i, (e,m) => { e.damage = +m[1]; e.hits = +m[2]; if(/all\s+enemies/i.test(m[0])) e.damageAll = true; }],
  ['damage:plain', 'any', /deal\s+(\d+)\s+damage/i, (e,m) => { e.damage = +m[1]; }],
  // --- block --------------------------------------------------------------
  ['block:triple', 'any', /triple\s+your\s+block/i, e => e.blockMultiplier = 3],
  ['block:gain', 'any', /gains?\s+(\d+)\s+block/i, (e,m) => e.block = +m[1]],
  ['turns', 'any', /for\s+(\d+)\s+turns?/i, (e,m) => e.turns = +m[1]],
  // --- debuffs applied to the target --------------------------------------
  ['debuff:weak+vulnerable', 'any', /apply\s+(\d+)\s+weak\s+and\s+(\d+)\s+vulnerable\s+to\s+all\s+enemies/i, (e,m) => { e.weak = +m[1]; e.vulnerable = +m[2]; e.appliesAll = true; }],
  ['debuff:vulnerable', 'any', /apply\s+(\d+)\s+vulnerable/i, (e,m,s) => { e.vulnerable = +m[1]; if(/to\s+all\s+enemies/i.test(s)) e.appliesAll = true; }],
  ['debuff:weak', 'any', /apply\s+(\d+)\s+weak\b/i, (e,m,s) => { e.weak = +m[1]; if(/to\s+all\s+enemies/i.test(s)) e.appliesAll = true; }],
  ['debuff:enemyLoseStrength', 'any', /(?:all\s+)?enemies?\s+lose\s+(\d+)\s+strength\s+this\s+turn/i, (e,m) => e.enemyLoseStrength = +m[1]],
  // "it loses 1 Strength", "Lose 9 Strength until the end of this turn" - the affected party is always the
  // enemy, so the magnitude is extractable even when the subject is a pronoun.
  ['debuff:losesStrength', 'any', /loses?\s+(\d+)\s+strength/i, (e,m) => e.enemyLoseStrength = +m[1]],
  ['debuff:enemyGainsStrength', 'any', /the\s+enemy\s+gains\s+(\d+)\s+strength/i, (e,m) => e.enemyGainsStrength = +m[1]],
  // --- self buffs. Flat gains are skipped when the clause is conditional. --
  ['gain:strength', 'any', /gains?\s+(\d+)\s+strength/i, (e,m,s) => { if(/for\s+each|whenever|for\s+all/i.test(s)) e.conditional = true; else (e.gains ??= {}).Strength = +m[1]; }],
  ['gain:dexterity', 'any', /gains?\s+(\d+)\s+dexterity/i, (e,m,s) => { if(/for\s+each|whenever|for\s+all/i.test(s)) e.conditional = true; else (e.gains ??= {}).Dexterity = +m[1]; }],
  ['gain:buffer', 'any', /gains?\s+(\d+)\s+buffer/i, (e,m) => (e.gains ??= {}).Buffer = +m[1]],
  ['gain:vigor', 'any', /gains?\s+(\d+)\s+vigor/i, (e,m,s) => { if(/for\s+each|whenever/i.test(s)) e.conditional = true; else (e.gains ??= {}).Vigor = +m[1]; }],
  ['gain:gold', 'any', /gains?\s+(\d+)\s+gold/i, (e,m) => (e.gains ??= {}).Gold = +m[1]],
  ['gain:plating', 'any', /gains?\s+(\d+)\s+plating/i, (e,m) => (e.gains ??= {}).Plating = +m[1]],
  // Power-scoped idioms. These only ever fire on status text, so they cannot misread a card.
  ['power:incoming', 'power', /receives?\s+(\d+)%\s+more\s+damage/i, (e,m) => e.incomingPercent = +m[1]],
  ['power:outgoing', 'power', /attacks?\s+deal\s+(\d+)%\s+less\s+damage/i, (e,m) => e.outgoingPercentLoss = +m[1]],
  ['power:frail', 'power', /gains?\s+(\d+)%\s+less\s+block/i, (e,m) => e.blockGainPercentLoss = +m[1]],
  ['power:attackBonus', 'power', /increases?\s+attack\s+damage\s+by\s+(\d+)/i, (e,m) => e.attackBonus = +m[1]],
  ['power:attackPenalty', 'power', /decreases?\s+attack\s+damage\s+by\s+(\d+)/i, (e,m) => e.attackPenalty = +m[1]],
  ['power:blockBonus', 'power', /increases?\s+block\s+gained\s+from\s+cards\s+by\s+(\d+)/i, (e,m) => e.blockBonus = +m[1]],
  ['power:nextAttack', 'power', /next\s+attack\s+deals?\s+(\d+)\s+additional\s+damage/i, (e,m) => e.nextAttackBonus = +m[1]],
  ['power:thorns', 'power', /deal\s+(\d+)\s+damage\s+back/i, (e,m) => e.thorns = +m[1]],
  ['power:hpCap', 'power', /cannot\s+lose\s+more\s+than\s+(\d+)\s+hp\s+each\s+turn/i, (e,m) => e.hpLossCapPerTurn = +m[1]],
  ['power:hpClamp', 'power', /only\s+loses?\s+(\d+)\s+hp\s+instead/i, (e,m) => e.hpLossClamp = +m[1]],
  ['power:enemySlow', 'power', /this\s+enemy\s+receives\s+(\d+)%\s+more\s+damage\s+from\s+attacks/i, (e,m) => e.onCardPlayedIncomingPercent = +m[1]],
  // --- draw / exhaust / hp -------------------------------------------------
  ['draw', 'any', /draw\s+(\d+)\s+cards?/i, (e,m) => e.draw = +m[1]],
  ['hp:cost', 'any', /lose\s+(\d+)\s+hp/i, (e,m) => e.hpCost = +m[1]],
  ['hp:heal', 'any', /heal\s+(\d+)\s+hp/i, (e,m) => e.heal = +m[1]],
  ['hp:healAll', 'any', /heal\s+all\s+hp/i, e => e.healAll = true],
  ['exhaust:hand', 'any', /exhaust\s+your\s+hand/i, e => e.exhaustHand = true],
  ['exhaust:n', 'any', /exhaust\s+(\d+)\s+cards?/i, (e,m) => { e.exhaustCards = +m[1]; if(/at\s+random/i.test(m[0])) e.exhaustRandom = true; }],
];

// Ongoing triggers, keyed to the task's hook vocabulary. A hook is only recorded when the sentence both
// names a trigger and a payload, so prose without numbers still lands as `grants` text rather than a guess.
const HOOKS = [
  [/\bat\s+the\s+start\s+of\s+each\s+combat/i, 'onCombatStart'],
  [/\bat\s+the\s+start\s+of\s+your\s+next\s+turn/i, 'onNextTurnStart'],
  [/\bat\s+the\s+start\s+of\s+your\s+turn/i, 'onTurnStart'],
  [/\bat\s+the\s+end\s+of\s+your\s+turn/i, 'onTurnEnd'],
  [/\bat\s+the\s+end\s+of\s+combat/i, 'onCombatEnd'],
  [/\bwhenever\s+you\s+play\s+an\s+attack/i, 'onAttackPlayed'],
  [/\bwhenever\s+you\s+play\s+a\s+card/i, 'onCardPlayed'],
  [/\bwhenever\s+you\s+draw\s+a\s+card/i, 'onCardDraw'],
  [/\bwhenever\s+a\s+card\s+is\s+exhausted/i, 'onCardExhausted'],
  [/\bwhenever\s+(?:an\s+)?enemy\s+dies/i, 'onEnemyDeath'],
  [/\bwhenever\s+you\s+are\s+attacked/i, 'onAttacked'],
  [/\bwhen\s+an\s+enemy\s+dies/i, 'onEnemyDeath'],
  [/\bwhen\s+hit\s+by\s+an\s+attack/i, 'onHitByAttack'],
  [/\bthe\s+first\s+time\b.*\bis\s+hit\s+each\s+turn/i, 'onFirstHitTakenEachTurn'],
  [/\bwhen\s+this\s+dies/i, 'onDeath'],
  [/\bupon\s+dying/i, 'onDeath'],
  [/\bwhenever\s+you\s+attack\s+an\s+enemy/i, 'onAttackDealt'],
  [/\bwhenever\s+you\s+enter\s+a\s+shop/i, 'onShopEnter'],
];

// Reads one description into effect semantics. Every returned number came from a matched pattern; the
// verbatim `description` is always carried so a consumer can fall back to the game's own words.
export function parseEffects(description, ctx = {}) {
  const kind = ctx.kind ?? 'card';
  const text = String(description ?? '');
  const effects = {}, rules = [];
  // A "Next turn," clause is NOT an immediate effect. 'Gain 11 Block. Next turn, gain 5 Block.' must yield
  // 11 now and 5 later, and 'Deal 12 damage. Next turn, draw 2 cards.' must not claim a draw of 2 now - so
  // deferred sentences are parsed into their own bucket and never touch the immediate fields.
  const deferred = new Set(), immediate = new Set();
  for (const s of sentences(text)) (/next\s+turn|next\s+time/i.test(s) ? deferred : immediate).add(s);
  const runRules = (set, into, prefix = '') => {
    for (const s of set) for (const [name, applies, test, apply] of RULES) {
      if (applies !== 'any' && applies !== kind) continue;
      const m = s.match(test); if (!m) continue;
      const before = JSON.stringify(into);
      apply(into, m, s);
      if (JSON.stringify(into) !== before) rules.push(`${prefix}${name}`);
    }
  };
  const nextTurn = {};
  runRules(immediate, effects);
  runRules(deferred, nextTurn, 'nextTurn:');
  for (const s of sentences(text)) {
    // 'Costs 1 less [energy]' is a discount, never a gain - icons are only counted inside a Gain clause.
    const gainClause = /\bgain\b/i.test(s) && !/\b(cost|costs|less)\b/i.test(s);
    const energy = gainClause ? countIcon(s, 'energy') : 0;
    const star = gainClause ? countIcon(s, 'star') : 0;
    const late = deferred.has(s);
    if (energy) { if (late) nextTurn.energy = energy; else put(effects, 'energy', energy); rules.push(late ? 'nextTurn:energy' : 'energy'); }
    if (star) { if (late) nextTurn.star = star; else put(effects, 'star', star); rules.push(late ? 'nextTurn:star' : 'star'); }
    // 'Every 3 turns, gain 1 energy' - an interval, kept as an explicit cadence rather than assumed per-turn.
    const every = s.match(/\bevery\s+(\d+)\s+(turns?|combats?)\b/i);
    const trigger = every && /^\s*every\b/i.test(s) ? 'onTurnStart' : HOOKS.find(([re]) => re.test(s))?.[1];
    if (trigger) {
      const hook = (effects.hooks ??= {})[trigger] ??= {};
      if (every) hook.every = {n: +every[1], unit: /turn/i.test(every[2]) ? 'turn' : 'combat'};
      const local = {};
      for (const [name, , test, apply] of RULES) {
        const m = s.match(test); if (!m) continue;
        const b = JSON.stringify(local); apply(local, m, s);
        if (JSON.stringify(local) === b) continue;
        for (const k of ['damage', 'block', 'heal', 'hpCost', 'draw', 'exhaustCards', 'energy', 'star', 'vulnerable', 'weak']) {
          if (local[k] != null) hook[k] = local[k];
        }
        if (local.gains) hook.gains = {...(hook.gains ?? {}), ...local.gains};
        if (local.damage != null && /all\s+enemies/i.test(s)) hook.damageAll = true;
      }
      // Icon-gated resources belong in the hook too, so a hook is self-describing without the card's own
      // effect leaking into it.
      if (energy && !late) hook.energy = energy;
      if (star && !late) hook.star = star;
      // Non-numeric payload ("procure a Potion-Shaped Rock") is kept as text, not guessed into a number.
      if (!Object.keys(hook).some(k => k !== 'every')) {
        const verb = s.match(/\b(?:procure|obtain|add|draw|transform|choose|upgrade)\s+(?:a|an|\d+|any)?\s*([\w\s-]+?)\.?\s*$/i);
        if (verb) hook.grants = verb[1].trim();
      }
      if (late) effects.deferredHooks = true;
    }
  }
  // 'Deal 9 damage. ... Exhaust.' - the card exhausts itself. Only a trailing sentence that is exactly
  // 'Exhaust' qualifies, so 'Exhaust 1 card at random.' is never read as self-exhaust.
  if (/(^|[.!?]\s*)exhaust\s*[.!?]?\s*$/i.test(text.trim())) { effects.exhaust = true; rules.push('exhaust:self'); }
  for (const word of ['Innate', 'Retain', 'Ethereal', 'Eternal', 'Unplayable', 'Forge', 'Sharp', 'Replay', 'Exhaust']) {
    if (new RegExp(`(^|[.!?]\\s*)${word}[.!?]?(\\s|$)`, 'i').test(text)) (effects.keywords ??= []).push(word);
  }
  if (/additional\s+time|extra\s+time/i.test(text)) { effects.doubleNextAttack = true; rules.push('doubleNextAttack'); }
  if (/next\s+attack\s+is\s+played\s+an\s+(?:extra|additional)\s+time/i.test(text)) { effects.doubleNextAttack = true; rules.push('doubleNextAttack'); }
  if (/for\s+ALL\s+your\s+cards\s+that\s+have\s+a\s+\[star_icon\.png\]\s+cost/i.test(text)) {
    const m = text.match(/deals?\s+(\d+)\s+additional\s+damage\s+for\s+ALL\s+your\s+cards\s+that\s+have\s+a\s+\[star_icon\.png\]\s+cost/i);
    if (m) { effects.allStarCostBonus = +m[1]; rules.push('allStarCostBonus'); }
  }
  if (/for\s+ALL\s+your\s+cards\s+containing/i.test(text)) {
    const m = text.match(/deals?\s+(\d+)\s+additional\s+damage\s+for\s+ALL\s+your\s+cards\s+containing/i);
    if (m) { effects.allNamedCardBonus = +m[1]; rules.push('allNamedCardBonus'); }
  }
  const selfDamage = text.match(/at\s+the\s+end\s+of\s+your\s+turn,\s*if\s+this\s+is\s+in\s+your\s+hand,\s*take\s+(\d+)\s+damage/i);
  if (selfDamage) {
    const hooks = (effects.hooks ??= {});
    hooks.onTurnEnd = {...hooks.onTurnEnd, selfDamage: +selfDamage[1]};
    rules.push('hook:selfDamage');
  }
  // 'Deal 7 damage for each card Exhausted' is per-card, not a flat 7 - publishing the flat number would
  // understate it by the hand size, so only the per-card magnitude survives.
  if (effects.damagePerExhaustedCard != null) delete effects.damage;
  // nextTurn collapsed from whichever clause produced it.
  for (const k of ['energy', 'star']) if (nextTurn[k] != null) { const v = nextTurn[k]; delete nextTurn[k]; if (v != null) nextTurn[k] = v; }
  for (const [k, v] of Object.entries(effects)) {
    if (Array.isArray(v) && k !== 'keywords' && k !== 'rules') effects[k] = v[v.length - 1];
  }
  const rest = {...effects};
  delete rest.nextTurn;
  const out = rest;
  if (nextTurn && Object.keys(nextTurn).length) out.nextTurn = nextTurn;
  if (out.keywords) {
    out.keywords = [...new Set(out.keywords)].sort();
    // 'Unplayable' is a playability gate rather than a rule reference, so it gets its own flag.
    if (out.keywords.includes('Unplayable')) out.unplayable = true;
  }
  out.rules = [...new Set(rules)].sort();
  // A pure text/keyword card keeps its meaning in `summary` rather than pretending to be modelled.
  const modelled = Object.keys(out).filter(k => !['keywords', 'rules', 'summary'].includes(k));
  if (!modelled.length) out.summary = text;
  return out;
}

// A status description normally bakes the CURRENT stack into its text ("...for 3 turns.", "Increases
// attack damage by 6."), so grouping on raw text yields one near-duplicate variant per stack. Replacing
// the stack number with a marker collapses them, and gives the entry a reusable template.
const SENTINEL = 987654;
export function canonicalize(description, amount) {
  const abs = Math.abs(amount ?? 0);
  let t = String(description ?? '');
  if (abs > 0) t = t.replace(new RegExp(`\\b${abs}\\b`, 'g'), '@').replace(/@(\s+)turn\b/g, '@$1turns');
  t = t.replace(/(\[[a-z_]*icon\.png\])(\1)+/g, (m, one) => `${one}#`);
  return t;
}

// A power's text mixes stack-dependent numbers (turn counts, "by N") with fixed constants (the 50% in
// Vulnerable). Parsing three ways separates them mechanically instead of by judgement: N->1 gives the
// canonical per-stack magnitude, N->SENTINEL marks which fields came from the stack position, and any
// field that never sees SENTINEL is a genuine constant.
// Walks a hook payload and reports which leaves hold SENTINEL, i.e. which numbers came from the stack
// position. Returns the payload with those leaves removed, so a stack-dependent magnitude is never
// published as if it were a constant.
function stripStackNumbers(obj) {
  const stackFields = [];
  const walk = (o, path) => {
    if (o == null || typeof o !== 'object') return o;
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (v === SENTINEL) { stackFields.push(path ? `${path}.${k}` : k); continue; }
      out[k] = v != null && typeof v === 'object' ? walk(v, path ? `${path}.${k}` : k) : v;
    }
    return out;
  };
  return [walk(obj, ''), stackFields];
}

export function parsePower(description, ctx) {
  const abs = Math.abs(ctx.amount ?? 0);
  const base = String(description ?? '');
  const template = canonicalize(base, ctx.amount);
  const one = parseEffects(abs > 0 ? base.replace(new RegExp(`\\b${abs}\\b`, 'g'), '1') : base, {kind: 'power'});
  const sentinel = abs > 0 ? parseEffects(base.replace(new RegExp(`\\b${abs}\\b`, 'g'), String(SENTINEL)), {kind: 'power'}) : one;
  const stackValues = [...new Set(ctx.stackValues ?? [])].sort((a, b) => a - b);
  const e = {template};
  e.numberIsStack = /@|#/.test(template);
  const perStack = {}, constant = {};
  const mark = (k, v) => { if (v == null) return; (sentinel[k] === SENTINEL ? perStack : constant)[k] = v; };
  for (const k of ['turns', 'incomingPercent', 'outgoingPercentLoss', 'blockGainPercentLoss', 'attackBonus', 'attackPenalty', 'blockBonus', 'nextAttackBonus', 'thorns', 'hpLossCapPerTurn', 'hpLossClamp', 'onCardPlayedIncomingPercent', 'block', 'damage', 'energy', 'star', 'hpCost', 'heal']) mark(k, one[k]);
  for (const [k, v] of Object.entries(one.gains ?? {})) (sentinel.gains?.[k] === SENTINEL ? perStack : constant)[`gain_${k}`] = v;
  if (e.numberIsStack) e.stackValues = stackValues.length ? stackValues : [abs].filter(n => n > 0);
  // A fixed number that is not the stack (Shrink's 30%, Vulnerable's 50%) is a genuine constant. A number
  // that IS the stack only counts as per-stack under a recognised idiom; otherwise Royalties' "gain 30
  // Gold" would be published as 1 gold per stack, which is a confident wrong number.
  const perStackIdiom = e.numberIsStack && STACK_IDIOMS.some(re => re.test(base));
  e.stacksScale = !e.numberIsStack ? false : perStackIdiom ? true : 'unknown';
  const [cleanHooks, stackHookFields] = stripStackNumbers(abs > 0 ? sentinel.hooks : one.hooks);
  if (e.stacksScale === true) {
    Object.assign(e, constant, perStack);
    if (one.hooks) e.hooks = one.hooks;
  } else {
    // A magnitude that came from the stack position is withheld when scaling is unproven; a number that is
    // not stack-derived (Shrink's 30%, Dexterity's per-stack block) is a genuine constant and is kept.
    const stackish = e.numberIsStack ? /^(turns|attackBonus|attackPenalty|blockBonus|nextAttackBonus|thorns)$/ : null;
    for (const [k, v] of Object.entries(constant)) if (!stackish?.test(k)) e[k] = v;
    if (cleanHooks) e.hooks = cleanHooks;
    if (Object.keys(perStack).length || stackHookFields.length) e.stackLinkedMagnitudeUnknown = true;
  }
  for (const k of ['exhaust', 'keywords', 'unplayable', 'doubleNextAttack', 'damageAll', 'conditional']) if (one[k] != null) e[k] = one[k];
  const informative = Object.keys(e).filter(k => !['template', 'numberIsStack', 'stacksScale', 'stackValues', 'stackLinkedMagnitudeUnknown', 'keywords', 'description', 'id', 'side', 'kind', 'name'].includes(k));
  if (!informative.length) e.summary = base;
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

// One entity's KB entry, merging every observation of it. A field survives only if every observation
// agreed on it; disagreements become `<field>Observed` plus a `varies` entry, so a mutated card reports a
// range instead of a confident single number.
// Fields copied verbatim from the log. Everything else on an entry came from a regex over that text, so
// confidence describes the EFFECTS, not the identity: a number the generator read out of a sentence is
// 'inferred' even though the sentence itself is real game data. 'partial' means the entity is known and
// its text is published, but nothing could be modelled from it.
const VERBATIM = new Set(['kind', 'name', 'side', 'sides', 'description', 'template', 'id', 'type', 'cost', 'target', 'rarity', 'isUpgraded', 'maxHpObserved', 'hpScaled', 'intentShapes', 'statusNames', 'counterObserved', 'observedAmounts', 'amountVariedWithInvariantText', 'mutable', 'varies', 'variants', 'numberIsStack', 'stacksScale', 'stackValues', 'stackLinkedMagnitudeUnknown', 'summary', 'confidence']);
function withConfidence(variant) {
  const keys = Object.keys(variant).filter(k => !VERBATIM.has(k));
  return {...variant, confidence: keys.length ? 'inferred' : 'partial'};
}

function merge(kind, observations, build, keyOf) {
  const groups = new Map();
  for (const o of observations) {
    const key = keyOf ? keyOf(o) : `${o.side ?? ''}|${o.description ?? ''}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }
  const variants = [...groups.values()].map(build).filter(Boolean).map(withConfidence);
  variants.sort((a, b) => (a.description ?? '').localeCompare(b.description ?? ''));
  const name = observations[0].name;
  const sides = [...new Set(observations.map(o => o.side).filter(Boolean))];
  // A side is only claimed at entry level when every observation agrees; otherwise each variant carries
  // its own side, because "Receive 50% more damage" means opposite things on the player and an enemy.
  const base = {kind, name, ...(sides.length === 1 ? {side: sides[0]} : {})};
  if (variants.length === 1) {
    const only = variants[0];
    const {description, ...fields} = only;
    return {...base, ...fields, description};
  }
  // Multiple distinct texts for one name: the number is not knowable from the name alone.
  const weakest = variants.some(v => v.confidence === 'partial') ? 'partial' : variants.every(v => v.confidence === 'verified') ? 'verified' : 'inferred';
  const out = {...base, mutable: true, variants, confidence: weakest};
  const scope = ['damage', 'block', 'hits', 'cost', 'energy', 'star', 'draw'];
  for (const f of scope) {
    const seen = [...new Set(variants.map(v => v[f]).filter(v => v != null))];
    if (seen.length > 1) { out[`${f}Observed`] = seen.sort((a, b) => a - b); out.varies = [...(out.varies ?? []), f]; }
  }
  // Each leaf repeats kind/name/side so a consumer that flattens to the leaves (as retrieve does) can still
  // tell a card reading from a power reading, and never has to fall back to the ambiguous header.
  out.variants = variants.map(v => ({...base, ...v, description: v.description, ...Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'description' && k !== 'rules' && k !== 'kind' && k !== 'name' && k !== 'side' && k !== 'sides'))}));
  out.varies = [...(out.varies ?? []), 'description'];
  return out;
}

const field = (obs, k) => obs.map(o => norm(o[k])).filter(v => v != null);
function unanimous(obs, k) { const v = field(obs, k); return v.length && new Set(v).size === 1 ? v[0] : undefined; }

function buildCardVariant(obs) {
  const first = obs[0];
  const e = {description: first.description, id: unanimous(obs, 'id'), type: unanimous(obs, 'type'), cost: norm(first.cost), target: unanimous(obs, 'target_type'), rarity: unanimous(obs, 'rarity')};
  e.cost = obs.every(o => norm(o.cost) === norm(first.cost)) ? norm(first.cost) : undefined;
  const upgraded = field(obs, 'is_upgraded');
  if (upgraded.length) e.isUpgraded = new Set(upgraded).size === 1 ? upgraded[0] : undefined;
  for (const [k, v] of Object.entries(parseEffects(first.description, {kind: 'card'}))) if (k !== 'rules') e[k] = v;
  // Keyword names straight off the game object, plus rule-words recovered from the text.
  const fromData = obs.flatMap(o => (o.keywords ?? []).map(k => k?.name)).filter(norm);
  if (fromData.length) e.keywords = [...new Set([...fromData, ...(e.keywords ?? [])])].sort();
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

function buildRelicVariant(obs) {
  const first = obs[0];
  const e = {description: first.description, id: unanimous(obs, 'id')};
  for (const [k, v] of Object.entries(parseEffects(first.description, {kind: 'relic'}))) if (k !== 'rules') e[k] = v;
  // Relics that only matter outside combat are flagged so the planner does not hunt for a combat hook.
  e.meta = /upon\s+pickup|every\s+other\s+combat|every\s+\d+\s+normal\s+combats|the\s+act\s+\d+\s+boss|enter\s+a\s+shop/i.test(first.description) || undefined;
  const counters = field(obs, 'counter');
  if (counters.length) e.counterObserved = [...new Set(counters)].sort((a, b) => a - b);
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

function buildPotionVariant(obs) {
  const first = obs[0];
  const e = {description: first.description, id: unanimous(obs, 'id'), target: unanimous(obs, 'target_type')};
  for (const [k, v] of Object.entries(parseEffects(first.description, {kind: 'potion'}))) if (k !== 'rules') e[k] = v;
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

function buildPowerVariant(obs) {
  const first = obs[0];
  // Every observation in the group shares a canonical template; they differ only in the stack number.
  const stackValues = obs.map(o => Math.abs(o.amount ?? 0)).filter(n => Number.isFinite(n) && n > 0);
  const sides = [...new Set(obs.map(o => o.side).filter(Boolean))].sort();
  // When the text never varies WHILE the game's own amount does, the text's numbers are constants whatever
  // amount says - publish them and flag the disagreement. With one amount this case does not apply, so
  // ordinary statuses still get their stack templated.
  const textInvariant = obs.every(o => o.description === first.description);
  const amounts = [...new Set(stackValues)];
  const amountDisagrees = textInvariant && amounts.length > 1;
  const e = {
    description: first.description, id: unanimous(obs, 'id'),
    ...(sides.length === 1 ? {side: sides[0]} : {sides}),
    ...(amountDisagrees ? {amountVariedWithInvariantText: true, observedAmounts: amounts.sort((a, b) => a - b)} : {}),
    ...parsePower(first.description, {amount: amountDisagrees ? 0 : first.amount, stackValues}),
  };
  for (const k of Object.keys(e)) if (e[k] === undefined) delete e[k];
  return e;
}

// Powers group on the stack-canonical template, so Vulnerable seen at 1/2/3 stacks is ONE entry. Two
// guards keep that honest: a description seen with two different amounts (the amount then does not track
// its own text, so the raw text keys the group), and side is recorded per group rather than split on.
function powerKeyFor(observations) {
  const amounts = new Map();
  for (const o of observations) {
    if (!amounts.has(o.description)) amounts.set(o.description, new Set());
    amounts.get(o.description).add(Math.abs(o.amount ?? 0));
  }
  const unstable = new Set([...amounts].filter(([, s]) => s.size > 1).map(([d]) => d));
  return o => unstable.has(o.description) ? o.description : canonicalize(o.description, o.amount);
}

function buildEnemy(observations) {
  const obs = observations[0];
  const maxHp = [...new Set(observations.flatMap(o => (o.maxHp == null ? [] : [o.maxHp])))].sort((a, b) => a - b);
  const intents = [];
  for (const o of observations) for (const i of o.intents ?? []) {
    const m = String(i.description ?? '').match(/attack\s+for\s+(\d+)\s+damage(?:\s+(\d+)\s+times)?/i);
    const shape = {type: i.type, title: i.title, label: i.label, ...(m ? {damage: +m[1], ...(m[2] ? {hits: +m[2]} : {})} : {})};
    if (!intents.some(x => JSON.stringify(x) === JSON.stringify(shape))) intents.push(shape);
  }
  const statuses = [...new Set(observations.flatMap(o => o.statusNames ?? []))].sort();
  // maxHpObserved / intentShapes / statusNames are copied straight from the log rather than parsed, so an
  // enemy entry is 'verified' in the sense that nothing here was inferred from prose.
  return {kind: 'enemy', name: obs.name, confidence: 'verified', maxHpObserved: maxHp, ...(maxHp.length > 1 ? {hpScaled: true} : {}), intentShapes: intents.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), statusNames: statuses};
}

// Reads every observation of every entity kind out of a run log.
export function readObservations(lines) {
  const cards = new Map(), relics = new Map(), potions = new Map(), powers = new Map(), enemies = new Map();
  const add = (map, name, obs) => { if (!name) return; if (!map.has(name)) map.set(name, []); map.get(name).push(obs); };
  const cardPools = st => [st.player?.hand, st.player?.draw_pile, st.player?.discard_pile, st.card_select?.cards, st.card_reward?.cards, st.bundle_select?.cards, st.hand_select?.cards];
  for (const line of lines) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    const st = o?.state; if (!st) continue;
    for (const pool of cardPools(st)) for (const c of pool ?? []) add(cards, c?.name, {name: c.name, description: c.description, id: c.id, type: c.type, cost: c.cost, target_type: c.target_type, rarity: c.rarity, is_upgraded: c.is_upgraded, keywords: c.keywords});
    for (const r of st.player?.relics ?? []) add(relics, r?.name, {name: r.name, description: r.description, id: r.id, counter: r.counter, keywords: r.keywords});
    for (const p of st.player?.potions ?? []) add(potions, p?.name, {name: p.name, description: p.description, id: p.id, target_type: p.target_type});
    for (const s of st.player?.status ?? []) add(powers, s?.name, {name: s.name, description: s.description, id: s.id, amount: s.amount, type: s.type, keywords: s.keywords, side: 'player'});
    for (const en of st.battle?.enemies ?? []) {
      if (en?.name) add(enemies, en.name, {name: en.name, maxHp: en.max_hp, intents: en.intents, statusNames: (en.status ?? []).map(s => s.name)});
      for (const s of en?.status ?? []) add(powers, s?.name, {name: s.name, description: s.description, id: s.id, amount: s.amount, type: s.type, keywords: s.keywords, side: 'enemy'});
    }
  }
  // The keyword glossary is collected for reference only. It is never merged into an entity's effects.
  const glossary = new Map();
  for (const pool of cards.values()) for (const o of pool) for (const k of o.keywords ?? []) if (k?.name && k?.description) glossary.set(k.name, k.description);
  return {cards, relics, potions, powers, enemies, glossary};
}

export function buildKnowledge(obs) {
  // A name can legitimately exist as two different things (Monarch's Gaze is a card AND a power, with
  // different text). Entries are collected per name and only collapsed later, so neither can clobber the
  // other and quietly hand a consumer the wrong kind's numbers.
  const byName = new Map(), counts = {};
  const emit = (map, kind, build, keyFor) => {
    for (const [name, list] of map) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(merge(kind, list, build, keyFor?.(list)));
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
  };
  emit(obs.cards, 'card', buildCardVariant);
  emit(obs.relics, 'relic', buildRelicVariant);
  emit(obs.potions, 'potion', buildPotionVariant);
  // Powers group on the stack-canonical template so Vulnerable seen at 1/2/3 stacks is ONE entry.
  emit(obs.powers, 'power', buildPowerVariant, powerKeyFor);
  for (const [name, list] of obs.enemies) { byName.set(name, [buildEnemy(list)]); counts.enemy = (counts.enemy ?? 0) + 1; }
  const KNOWLEDGE = {};
  for (const [name, list] of byName) {
    if (list.length === 1) { KNOWLEDGE[name] = list[0]; continue; }
    KNOWLEDGE[name] = {kind: 'multi', name, confidence: 'mixed', mutable: true, variants: list};
  }
  // A name that is both a card and a power is counted under both: they are two different entities.
  return {KNOWLEDGE, counts, GLOSSARY: Object.fromEntries([...obs.glossary].sort(([a], [b]) => a.localeCompare(b)))};
}

export function render({KNOWLEDGE, GLOSSARY}, meta) {
  const j = o => JSON.stringify(o, null, 1).replace(/\n\s*/g, ' ');
  const body = Object.keys(KNOWLEDGE).sort().map(n => `  ${JSON.stringify(n)}: ${j(KNOWLEDGE[n])},`).join('\n');
  return `// Generated by spire-demo/mechanics/extract.mjs from ${meta.source}. Do not hand-edit: re-run the generator.
// ${j(meta.counts)}. Every field below is either verbatim game data or a regex match on it; a number the
// generator could not read is absent, never guessed. Works with .private/ deleted.
export const META = ${j(meta)};
export const GLOSSARY = ${j(GLOSSARY)};
export const KNOWLEDGE = {
${body}
};
export default KNOWLEDGE;
`;
}

// A pick of entries that exercise the interesting shapes: a single-reading card, a mutated one, a relic
// hook, a power that separates its per-stack magnitude from a fixed constant, and a name that is two
// different things. Printed so a regeneration can be eyeballed without opening the file.
const SAMPLES = ['Bash', 'Strike', 'Sovereign Blade', 'Happy Flower', 'Vulnerable', 'Divine Right', 'Shrink', 'Monarch\'s Gaze'];
const shape = v => Object.fromEntries(Object.entries(v).filter(([k]) => !['description', 'variants', 'id', 'confidence', 'keywords', 'rules'].includes(k)));

// argv, then the env var, then the pinned corpus. A miss has to be actionable: the first thing anyone
// does on a fresh clone is run this, and a bare ENOENT buries the one fact they need (how to supply a log).
export function resolveLogPath(explicit = process.argv[2] ?? process.env.SPIRE_RUN_LOG ?? null) {
  return explicit ? resolve(explicit) : DEFAULT_LOG;
}

export function missingLogMessage(logPath) {
  return `No run log at ${rel(logPath)}.

The run log is private and intentionally NOT committed: *.jsonl is gitignored, so no
sample of the real corpus can ship in this repo. Nothing is broken - knowledge.mjs is
committed and needs no log. Only regenerating it does, and you need your own log.

Point at one with either of these:

  SPIRE_RUN_LOG=/path/to/run.jsonl node spire-demo/mechanics/extract.mjs
  node spire-demo/mechanics/extract.mjs /path/to/run.jsonl

The pinned default, if you have the corpus, is ${rel(DEFAULT_LOG)}.
For a smoke test, point at the committed ${rel(SAMPLE_LOG)} - it exercises
every kind but is a 2-decision fixture, not the corpus.`;
}

// JSONL (one decision per line) is the real format. A top-level JSON array is also accepted so a fixture
// can ship: .jsonl is gitignored, so no sample of the corpus can ever be committed. Lines are handed back
// as text so readObservations stays the single parser.
function readLogLines(text, label) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('[')) return text.split('\n').filter(Boolean);
  try { return JSON.parse(trimmed).map(r => JSON.stringify(r)); }
  catch (e) { throw new Error(`${label} starts with '[' but is not a valid JSON array of decisions: ${e.message}`); }
}

function main() {
  const logPath = resolveLogPath();
  if (!existsSync(logPath)) {
    console.error(missingLogMessage(logPath));
    process.exit(1);
  }
  const lines = readLogLines(readFileSync(logPath, 'utf8'), logPath);
  const obs = readObservations(lines);
  const built = buildKnowledge(obs);
  const kinds = Object.fromEntries(Object.entries(built.counts).sort());
  const meta = {
    source: sourceLabel(logPath), decisions: lines.length,
    counts: kinds, names: Object.keys(built.KNOWLEDGE).length, glossary: Object.keys(built.GLOSSARY).length,
    note: 'Effects are regex-derived from verbatim descriptions. Numbers that varied across the corpus are reported as <field>Observed with mutable:true instead of a single value.',
  };
  writeFileSync(join(HERE, 'knowledge.mjs'), render(built, meta));
  const readings = Object.values(built.KNOWLEDGE).flatMap(e => e.variants ? e.variants.flatMap(x => (x.variants ?? [x])) : [e]);
  const byConfidence = {};
  for (const r of readings) byConfidence[r.confidence] = (byConfidence[r.confidence] ?? 0) + 1;
  console.log(`source      ${meta.source}`);
  console.log(`decisions   ${meta.decisions}`);
  console.log(`names       ${meta.names} (${meta.glossary} glossary rules, ${readings.length} distinct readings)`);
  console.log('per kind    ' + Object.entries(kinds).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log('confidence  ' + Object.entries(byConfidence).map(([k, v]) => `${k}=${v}`).join('  '));
  console.log(`mutable     ${Object.values(built.KNOWLEDGE).filter(e => e.mutable).length} names whose numbers differed across the corpus`);
  console.log('samples:');
  for (const name of SAMPLES) {
    const e = built.KNOWLEDGE[name];
    if (!e) { console.log(`  ${name}: absent from this corpus`); continue; }
    const leaves = e.variants ? e.variants.flatMap(x => (x.variants ?? [x])) : [e];
    console.log(`  ${name} [${[...new Set(leaves.map(l => l.kind))].join('+')}] ${JSON.stringify(shape(leaves[0]))}`);
    if (leaves.length > 1) console.log(`      ${leaves.length} readings, e.g. ${JSON.stringify(leaves[0].description)}`);
  }
  return {built, meta};
}

// Run only when invoked directly, so importing this module for its parsers never rewrites knowledge.mjs.
// Both sides are realpath'd because argv[1] is whatever the caller typed: /tmp and /var are symlinks on
// macOS, so a raw compare against the already-resolved module URL silently skips main() and the generator
// exits 0 having printed nothing and written nothing - indistinguishable from a successful run.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  const self = fileURLToPath(import.meta.url);
  try { return realpathSync(process.argv[1]) === realpathSync(self); } catch { return resolve(process.argv[1]) === self; }
}
if (invokedDirectly()) main();
