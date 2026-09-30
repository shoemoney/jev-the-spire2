// Build the game-data index from the raw localization dump.
//
// The dump is the game's OWN text, recovered from its resource pack. Every description is a
// TEMPLATE: the numbers are placeholders like {Damage:diff()} resolved against the card's live
// stat, which differs by upgrade. So this yields the EFFECT STRUCTURE for every entity in the
// game - what kind of thing a card does - while the magnitude must come from the observed state.
//
// This is the fix for the largest measured blindness cause: the planner used to know only the
// 159 entities it happened to see in its own runs, and treated every other card as `unsupported`,
// which blanked the whole board's forecast. There are 1,784.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(HERE, 'raw-localization.json'), 'utf8'));

// A placeholder tells you the EFFECT and nothing about the magnitude: {Damage:diff()} is the card's
// own damage stat, which changes with upgrade. The token before the colon names the quantity.
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9_]*)(?::[^}]*)?\}/g;
const CLEAN = /\[\/?[a-z_ ]+\]|\{[A-Za-z][A-Za-z0-9_]*(?::[^}]*)?\}/g;

const KIND = {
  damage: ['Damage'], block: ['Block'], vulnerable: ['Vulnerable', 'VulnerablePower'],
  weak: ['Weak', 'WeakPower'], strength: ['Strength', 'StrengthPower'],
  dexterity: ['Dexterity', 'DexterityPower'], energy: ['Energy'], cards: ['Cards'],
  heal: ['Heal'], gold: ['Gold'], blockNextTurn: ['BlockNextTurn', 'BlockNextTurnPower'],
  poison: ['Poison', 'PoisonPower'], thorns: ['Thorns', 'ThornsPower'],
  metallicize: ['Metallicize', 'MetallicizePower'], plating: ['Plating', 'PlatingPower'],
  regen: ['Regen', 'RegenPower'], vigor: ['VigorPower'], stars: ['Star', 'Stars'],
};

// PROSE FORMS. The placeholder table above only sees `{Token}` substitutions, and a lot of the game
// writes its effect as English instead — Fairy in a Bottle reads "When your HP would be reduced to 0,
// instead this potion is discarded and you heal to 30%", with no `{Heal}` anywhere. So a potion whose
// whole value is its prose was classified as having no effect at all.
//
// That matters more than it sounds: eleven potion types are named in a hand-written allowlist, the
// corpus has shown twenty-nine, and an unlisted potion marks the play `unsupported` — which blanks
// the forecast and blinds the lethal gate. The survival items were among the invisible ones.
const PROSE = [
  [/heal(?:s|ing)? to/i, 'heal'],
  [/heal for/i, 'heal'],
  [/\bDraw\s+\d+\b|\bDraw\s+cards?\b/i, 'draw'],   // "Draw Pile" is a zone, not an effect
  [/\bUpgrade\b/i, 'upgrade'],
  [/add into your/i, 'cardsInHand'],
  [/random potions/i, 'randomPotion'],
  [/Play the top/i, 'repeat'],
  [/cannot be used|unplayable/i, 'unplayable'],
  [/choose .* random /i, 'cardsInHand'],
];

function classify(text) {
  const effects = {};
  for (const [effect, tokens] of Object.entries(KIND)) {
    for (const t of tokens) {
      if (text.includes(`{${t}`) || text.includes(`{${t}}`)) { (effects[effect] ??= []).push(t); break; }
    }
  }
  for (const [re, effect] of PROSE) {
    if (re.test(text)) (effects[effect] ??= []).push('prose');
  }
  for (const m of text.matchAll(PLACEHOLDER)) {
    (effects.placeholders ??= new Set()).add(m[1]);
  }
  if (effects.placeholders) effects.placeholders = [...effects.placeholders].sort();
  return Object.keys(effects).length ? effects : null;
}

// THE CLAUSE THAT DECIDES WHETHER A CARD IS WORTH PLAYING.
//
// Colossus reads "Gain 12 Block. You receive 50% less damage from VULNERABLE enemies this turn.",
// and the first sentence is the worthless half. The classifier below read only effect keywords, so it
// recorded Colossus as a plain block card and dropped the sentence that is the entire reason anyone
// plays it. Measured on a live run: 6 of 9 Colossus plays were made with NO enemy Vulnerable, so the
// defining clause was inert - and the worst was against the Act 1 boss at 12 incoming with nothing
// vulnerable on the board.
//
// 292 entities carry conditional text. The second clause of a card is routinely the whole card, so it
// is captured and labelled rather than discarded.
const CONDITIONS = [
  [/vulnerable/i, 'an enemy is Vulnerable'],
  [/weak(?:ened)?/i, 'an enemy is Weak'],
  [/whenever you play a card/i, 'a card is played'],
  [/at the end of your turn/i, 'the turn ends'],
  [/at the start of your turn/i, 'the turn begins'],
  [/if this is in your hand/i, 'the card stays in hand'],
  [/each time this is played/i, 'the card is replayed'],
];
function conditionOf(text) {
  for (const [re, needs] of CONDITIONS) if (re.test(text)) return needs;
  return null;
}

const index = {};
for (const [id, entry] of Object.entries(raw)) {
  const description = (entry.description ?? '').replace(CLEAN, ' ').replace(/\s+/g, ' ').trim();
  if (!description && !entry.title) continue;
  index[id] = {
    name: entry.title ?? null,
    lore: entry.lore ?? null,
    // The template is kept verbatim: it is what the game prints, and the planner needs to know a
    // number is a placeholder rather than a value it can use.
    template: entry.description ?? null,
    plain: description || null,
    effects: classify(entry.description ?? ''),
    // What has to be true for this card to do the thing it is known for. Null means unconditional,
    // which is a claim about the text and not about how good the card is.
    requires: conditionOf(entry.description ?? ''),
    confidence: entry.description ? 'game-data' : 'title-only',
  };
}

const out = `// GENERATED by spire-demo/gamedata/extract.mjs from the game's own localization.
// Do not hand-edit. ${Object.keys(index).length} entities, recovered from the resource pack.
//
// Descriptions are TEMPLATES. \`{Damage:diff()}\` is the card's own damage stat and changes with
// upgrade, so the template says the EFFECT and never a magnitude. Any number a decision needs must
// come from the observed state; a number read out of a template would be an invented one.
export const GAME_DATA = ${JSON.stringify(index)};

export const GAME_DATA_COUNT = ${Object.keys(index).length};
export const byName = name => GAME_DATA[String(name ?? '').replace(/\\+$/, '').trim().toUpperCase().replace(/[ '\\-]/g, '_')] ?? null;
export default {GAME_DATA, GAME_DATA_COUNT, byName};
`;
writeFileSync(join(HERE, 'game-data.mjs'), out);
console.log(`game-data.mjs: ${Object.keys(index).length} entities, ${Buffer.byteLength(out)} bytes`);
const kinds = {};
for (const v of Object.values(index)) for (const e of Object.keys(v.effects ?? {})) kinds[e] = (kinds[e] ?? 0) + 1;
console.log('effect coverage:', JSON.stringify(kinds));
