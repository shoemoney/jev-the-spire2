// Two ways to price retaliation, and the difference between them is the whole point.
//
// 1. The exact visible sentence, which states its own number.
// 2. The power's OWN `amount` field — the game's value, read rather than inferred.
//
// What is still refused is a NAME with no number, and the original comment stands for that case
// only: "Names alone never supply damage." Thorns is not a name supplying a number. The state
// carries `amount: 2` on 105 of 105 Thorns objects in the recorded corpus, with the description
// reading "When hit by an attack, deal 2 damage back." The number was available every time and was
// discarded, which returned `{damage: null}`, which made `applyRetaliation` mark the whole candidate
// board `retaliation_unknown` — every attack into a thorned enemy became `quality:'unknown'` and
// `survives:null`, so the agent could not price a single option on those boards.
export function retaliationRule(power){
 const text=(power.description??'').trim();
 const match=text.match(/^Whenever this creature is attacked, deal (\d+) damage back to the attacker\.?$/i);
 if(match)return {damage:Number(match[1]),rule:text,fromText:true};
 const isRetaliation=/retaliat|thorns/i.test(power.name??'')||/damage back to the attacker|when(?:ever)? .*attack.*deal .*damage/i.test(text);
 if(!isRetaliation)return null;
 // The game's own stack, when it has one. Still refused without it: a name alone supplies nothing.
 if(Number.isFinite(power?.amount)&&power.amount>0)return {damage:power.amount,rule:text,fromStack:true};
 return {damage:null,rule:text};
}
export function applyRetaliation(m,targets,item,hits){
 const rules=targets.flatMap(e=>(e.status??[]).map(retaliationRule).filter(Boolean));
 if(!rules.length)return;
 const ambiguous=rules.some(r=>r.damage===null)||targets.length!==1||hits!==1||targets[0].hp<=0||m.rage>0||m.fan||/Gain \d+ Block/i.test(item.description??'')||m.retaliationModifiers;
 if(ambiguous){m.unsupported=true;m.boundary='retaliation_unknown';m.warnings.push('Retaliation timing or modifiers are unsupported for this action (including lethal, multi-hit, area or attack-triggered block interactions). Re-observe; survival is unknown.');return;}
 for(const r of rules){const absorbed=Math.min(m.block,r.damage);m.block-=absorbed;const lost=Math.min(Math.max(0,m.hp),r.damage-absorbed);m.hp-=lost;m.retaliationEvents.push({rule:r.rule,damage:r.damage,absorbed,hpLost:lost});if(m.hp<=0){m.boundary='player_dead';break;}}
}
