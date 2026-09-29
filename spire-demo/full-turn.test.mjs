import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planCandidates,projectSequence} from './planner.mjs';
import {actionsFor} from './actions.mjs';
const fixture=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url))).state;
// A hand with three 1-cost cards and 3 energy: the old search could only offer
// prefixes of it, and its own assumption string called each one "this prefix,
// followed by ending the turn" — so "End turn" read as the only way to spend it.
const card=(name,type,description,cost=1,index=0,target_type='AnyEnemy')=>({index,name,type,cost,description,target_type,can_play:true});
const spare=(over={})=>({run:{act:1,floor:1},state_type:'monster',
  player:{hp:40,block:0,energy:3,gold:0,draw_pile_count:5,discard_pile_count:0,exhaust_pile_count:0,deck:[],status:[],potions:[],
    hand:[card('Strike','Attack','Deal 6 damage.',1,0),card('Defend','Skill','Gain 5 Block.',1,1,'Self'),card('Strike','Attack','Deal 6 damage.',1,2)]},
  battle:{is_play_phase:true,turn:'player',round:1,enemies:[{entity_id:'a',name:'Rock',hp:100,block:0,status:[],intents:[{type:'Attack',label:'9',description:'This enemy intends to Attack for 9 damage.'}]}]},...over});

test('a hand with spare energy now produces candidates that actually spend it',()=>{
  const plans=planCandidates(spare());
  const spent=plans.filter(p=>p.turnComplete&&p.forecast.energyLeft===0);
  assert.ok(spent.length>0,'at least one candidate spends the whole turn');
  // Three 1-cost cards means three card plays. Whether the turn then ends
  // explicitly is a second choice the pass leaves open, and both are whole turns.
  assert.ok(spent.every(p=>p.plan.filter(a=>a.command.action==='play_card').length===3),'spending three 1-cost cards is three plays');
  // The prefix it replaced is still offered, and is still only a prefix.
  const prefix=plans.find(p=>p.label==='Strike → Rock'&&p.forecast.energyLeft===2);
  assert.ok(prefix);assert.equal(prefix.turnComplete,false);
});

test('turnComplete is true only when the turn genuinely closed',()=>{
  const plans=planCandidates(spare());
  for(const p of plans) {
    // A whole turn either ends the turn itself or leaves nothing affordable.
    if(!p.turnComplete)continue;
    assert.ok(p.plan.at(-1).command.action==='end_turn'||p.forecast.energyLeft===0||p.forecast.boundary==='combat_won',`${p.label} claims a whole turn with energy in hand`);
    assert.notEqual(p.completionReason,'search-prefix');
  }
  // And the converse holds for the prefix beside it: same first action, one
  // card shorter, and it never borrows the completed reading.
  const bare=plans.find(p=>p.label==='Defend');
  assert.equal(bare.turnComplete,false);assert.equal(bare.completionReason,'search-prefix');
  assert.equal(bare.forecast.energyLeft,2);
});

test('a card that draws unknown cards truncates the turn and says why',()=>{
  const s=spare();
  s.player.hand=[card('Shrug It Off','Skill','Gain 8 Block. Draw 1 card.',1,0,'Self'),card('Defend','Skill','Gain 5 Block.',1,1,'Self')];
  const plans=planCandidates(s);
  const drew=plans.filter(p=>p.command.action==='play_card'&&p.details?.name==='Shrug It Off');
  assert.ok(drew.length);
  for(const p of drew){
    assert.equal(p.turnComplete,false);
    assert.match(p.completionReason,/^(boundary:draw|search-prefix)$/);
    if(p.completionReason.startsWith('boundary:')){
      assert.equal(p.forecast.boundary,'draw');
      assert.match(p.forecast.assumption,/drawn cards are unknown/);
      assert.doesNotMatch(p.forecast.assumption,/Forecast for a WHOLE turn/);
    }
  }
  // The pure-prefix path is still honest about the same draw.
  const f=projectSequence(s,['Shrug It Off']);
  assert.equal(f.boundary,'draw');assert.equal(f.turnComplete,false);
});

test('the assumption string says which of the two it is, for every candidate',()=>{
  for(const s of [spare(),fixture('slippery'),fixture('survival'),fixture('drum-draw'),fixture('waterfall-lethal')]) for(const p of planCandidates(s)) {
    const scope=p.forecast.assumption.split('Known-effects estimate')[0];
    if(p.turnComplete){assert.match(scope,/Forecast for a WHOLE turn/,p.label);assert.doesNotMatch(scope,/TRUNCATED/);}
    else{assert.match(scope,/TRUNCATED prefix, NOT a whole turn/,p.label);assert.doesNotMatch(scope,/WHOLE turn/);}
    // The label a caller reads and the reason it carries must agree.
    assert.equal(p.turnComplete,p.forecast.turnComplete);
    assert.equal(p.completionReason,p.forecast.completionReason);
  }
});

test('REGRESSION: the recorded best-known answers stay reachable in the menu',()=>{
  // Pure reachability, and nothing else: these four lines hold both before and
  // after the completion pass, so a future change that quietly drops a learned
  // line from the menu fails here. Completing turns must never cost one.
  const sl=planCandidates(fixture('slippery'));
  assert.ok(sl.some(p=>p.plan[0].label==='Rage'&&p.plan.some(a=>a.label==='Energy Potion')&&p.plan.some(a=>a.label==='Whirlwind')),'slippery energy-before-damage line');
  const ff=planCandidates(fixture('final-form'));
  assert.ok(ff.some(p=>p.forecast.boundary==='death_effect'&&p.forecast.damage===65),'final-form affordable form defeat');
  const inf=planCandidates(fixture('infection-lethal'));
  assert.ok(inf.some(p=>p.label==='Strike → Wriggler → Defend'&&p.forecast.survives===true),'infection-lethal surviving line');
  for(const a of actionsFor(fixture('slippery')))assert.ok(sl.some(p=>JSON.stringify(p.command)===JSON.stringify(a.command)),'every immediate legal action stays on offer');
});

test('those same learned answers are now labelled by how far they actually get',()=>{
  // The defeat is still not victory: reaching the kill is not closing the turn,
  // because the death effect itself is unresolved.
  const kill=planCandidates(fixture('final-form')).find(p=>p.forecast.boundary==='death_effect'&&p.forecast.damage===65);
  assert.equal(kill.forecast.survives,null);
  assert.equal(kill.turnComplete,false);
  assert.equal(kill.completionReason,'boundary:death_effect');
  // The energy-before-damage line now spends its energy instead of stopping.
  const rage=planCandidates(fixture('slippery')).find(p=>p.plan[0].label==='Rage'&&p.plan.some(a=>a.label==='Energy Potion')&&p.plan.some(a=>a.label==='Whirlwind'));
  assert.equal(rage.plan[0].label,'Rage','energy still comes first');
});

test('a whole turn is never a bound dressed as a total, and null stays null',()=>{
  const s=spare();
  s.battle.enemies[0].intents=[{type:'Attack',label:'?!',description:'This enemy intends to Attack.'}];
  for(const p of planCandidates(s)){
    assert.equal(p.forecast.incomingMax,null,'an unreadable attack still has no ceiling on a completed turn');
    assert.equal(p.forecast.survives,null);assert.equal(p.forecast.hpLossUpper,null);
    assert.notEqual(p.forecast.quality,'calculated');
  }
  // Completion bought no certainty it did not have: the closed turn reads
  // exactly as unknown as the prefix beside it.
  const closed=planCandidates(s).find(p=>p.turnComplete);
  assert.ok(closed);assert.equal(closed.forecast.incomingMax,null);
  assert.match(closed.forecast.assumption,/incomingMin\/incomingMax bracket/);
});
