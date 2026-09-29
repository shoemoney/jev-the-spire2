import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {projectSequence,planPreference,readIntentDamage} from './planner.mjs';
const fixture=name=>JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url))).state;
// 13 hp against a 12..13 incoming bound. Block Potion (12) plus Defend (5) out-blocks
// the ceiling; Block Potion plus Strike does not, and both used to be untellable.
const rock=(label,description)=>({run:{act:1,floor:1},state_type:'monster',
  player:{hp:13,block:0,energy:3,gold:0,draw_pile_count:5,discard_pile_count:0,exhaust_pile_count:0,deck:[],status:[],
    potions:[{id:'BLOCK_POTION',name:'Block Potion',description:'Gain 12 Block.',slot:0,can_use_in_combat:true,target_type:'AnyPlayer'}],
    hand:[{index:0,name:'Strike',cost:'0',description:'Deal 9 damage.',type:'Attack',target_type:'AnyEnemy',can_play:true},
          {index:1,name:'Defend',cost:'1',description:'Gain 5 Block.',type:'Skill',target_type:'Self',can_play:true}]},
  battle:{is_play_phase:true,turn:'player',round:1,enemies:[{entity_id:'a',name:'Rock',hp:100,block:0,status:[],intents:[{type:'Attack',label,description}]}]}});
const says=n=>`This enemy intends to Attack for ${n} damage 3 times.`;
const POCKET=['Block Potion','Defend'], PUNGE=['Block Potion','Strike → Rock'];
const kinds=['attack','defense','setup','conserve'];
const rank=(s,seq)=>kinds.map(k=>planPreference(s,seq,k));

test('an exact forecast returns the number it always returned, and the bound collapses onto it',()=>{
  for(const [name,seq,expected] of [['waterfall-deathblow',['End turn'],57],['weak-potion',['Flame Barrier'],20],
    ['weak-potion',['Weak Potion → Vantom','Flame Barrier'],14],['relax-lethal',['Relax'],26],['survival',['Block Potion','Uppercut → Vantom','Strike → Vantom'],8],
    ['beast-energy',['Strike → Ceremonial Beast'],22],['infection-lethal',['Strike → Wriggler','Defend'],8],['direct-hp-loss',['Defend','Defend'],0]]){
    const f=projectSequence(fixture(name),seq);
    assert.equal(f.incoming,expected,`${name} ${seq}`);
    assert.equal(f.incomingMin,expected);assert.equal(f.incomingMax,expected);
    assert.equal(f.incomingExact,true);assert.equal(f.hpLossUpper,f.hpLoss);assert.equal(f.survivesUpper,f.survives);
  }
  const s=fixture('final-form');
  assert.equal(projectSequence(s,['Colossus+']).incoming,60);
  s.battle.enemies[0].status.push({name:'Vulnerable',amount:1});
  const halved=projectSequence(s,['Colossus+']);
  assert.equal(halved.incoming,30);assert.equal(halved.incomingMax,30);assert.equal(halved.incomingExact,true);
});
test('a self-contradicting label becomes an interval, and two plans it tied are told apart',()=>{
  const s=rock('4x3 (13)',says('12')),block=projectSequence(s,POCKET),punge=projectSequence(s,PUNGE);
  // Both forecasts are quality 'unknown', which is exactly the branch that used to
  // return -10000 for every kind: under null these two candidates could not differ.
  assert.equal(block.quality,'unknown');assert.equal(punge.quality,'unknown');
  assert.equal(block.incoming,12);assert.equal(block.incomingMin,12);assert.equal(block.incomingMax,13);
  assert.equal(block.incomingExact,false);
  assert.notEqual(planPreference(s,POCKET,'defense'),planPreference(s,PUNGE,'defense'));
  assert.notEqual(planPreference(s,POCKET,'attack'),planPreference(s,PUNGE,'attack'));
  // Blocking 12 against a 12..13 range is a genuinely different plan from blocking 5:
  // only the first survives the ceiling, and survival is what the ranking leads with.
  assert.equal(block.survivesUpper,true);assert.equal(block.hpLossUpper,0);
  assert.equal(punge.survivesUpper,true);assert.equal(punge.hpLossUpper,1);
  assert.equal(planPreference(s,['End turn'],'defense'),-10000-13*20);
  for(const kind of kinds)assert.ok(planPreference(s,POCKET,kind)>-10000,`${kind} escaped the flat penalty`);
});
test('a bound is labelled as a bound: it warns, and never claims a calculated quality',()=>{
  for(const [label,description] of [['4x3 (13)',says('12')],['?!','This enemy intends to Attack.'],['4x10 (13)',says('12')]]){
    const f=projectSequence(rock(label,description),['End turn']);
    assert.equal(f.incomingExact,false,label);
    assert.notEqual(f.quality,'calculated',label);
    assert.ok(f.warnings.some(w=>/bound, not a total/.test(w)),`${label} warns that the number is a bound`);
    assert.ok(f.warnings.some(w=>/incomingMax/.test(w)),`${label} says which end to rank on`);
    assert.match(f.assumption,/incomingMin\/incomingMax bracket/);
  }
  // The lower printed number is the floor when the total undercuts the product:
  // pinning the floor at 4x10 would claim 40 provably lands when the game also said 13.
  const wide=projectSequence(rock('4x10 (13)',says('12')),['End turn']);
  assert.equal(wide.incoming,13);assert.equal(wide.incomingMin,13);assert.equal(wide.incomingMax,40);
});
test('a wider ceiling ranks the same plan worse, so being bounded is not itself a penalty',()=>{
  const tight=rock('4x3 (13)',says('12')),wide=rock('4x3 (37)',says('12'));
  assert.equal(projectSequence(tight,['End turn']).incomingMin,12);
  assert.equal(projectSequence(wide,['End turn']).incomingMin,12);
  assert.equal(projectSequence(wide,['End turn']).incomingMax,37);
  // Same floor, ceiling 13 against 37: the ranking must read the ceiling rather than
  // charge a constant for the number being a bound, and a bounded plan still beats
  // an unreadable one instead of tying it at the bottom.
  const unreadable=rock('?!','This enemy intends to Attack.');
  assert.equal(planPreference(unreadable,['Block Potion','Defend'],'defense'),-10000);
  for(const kind of kinds){
    assert.ok(planPreference(tight,['Block Potion','Defend'],kind)>planPreference(wide,['Block Potion','Defend'],kind),kind);
    assert.ok(planPreference(tight,['Block Potion','Defend'],kind)>-10000,kind);
    assert.equal(planPreference(unreadable,['Block Potion','Defend'],kind),-10000,kind);
  }
  // The escape is earned, not free: a bound whose interval happens to be a single
  // point scores on the same terms as an exact forecast, and nothing else moves it.
  const exact=rock('12',says('12')),closed=rock('4x3 (12)',says('12'));
  assert.equal(projectSequence(closed,['End turn']).incomingExact,true);
  assert.deepEqual(rank(exact,POCKET),rank(closed,POCKET));
});
test('an unreadable attack fakes no ceiling and keeps the flat penalty, and never publishes a zero',()=>{
  const f=projectSequence(rock('?!','This enemy intends to Attack.'),['End turn']);
  assert.equal(f.incomingMax,null);assert.equal(f.incoming,null);assert.equal(f.incomingMin,0);
  assert.equal(f.hpLossUpper,null);assert.equal(f.survivesUpper,null);assert.equal(f.survives,null);
  assert.equal(f.incomingExact,false);assert.notEqual(f.quality,'calculated');
  assert.ok(f.warnings.some(w=>/no damage ceiling/.test(w)));
  assert.ok(f.warnings.some(w=>/unbounded/.test(w)));
  for(const kind of kinds)assert.equal(planPreference(rock('?!','This enemy intends to Attack.'),['End turn'],kind),-10000,kind);
  // An unreadable label is still an attack we can SEE. Giving up on it entirely is
  // what turned 30.8% of recorded decisions into a menu of identical nulls.
  assert.equal(readIntentDamage({label:'?!',description:'This enemy intends to Attack.'}),null);
});
test('the intent description is a second reading, and it turns a blind turn into an exact one',()=>{
  assert.deepEqual(readIntentDamage({label:'4x3 (13)',description:'x'}),{perHit:4,hits:3,alt:13,exact:false,source:'intent label'});
  assert.deepEqual(readIntentDamage({label:'??',description:'It will attack for 7 damage 2 times.'}),{perHit:7,hits:2,alt:null,exact:true,source:'intent description'});
  assert.equal(readIntentDamage({label:'??',description:'It will attack.'}),null);
  const s=rock('4x3 (17)',says('12')),f=projectSequence(s,['End turn']);
  assert.equal(f.incoming,12);assert.equal(f.incomingMin,12);assert.equal(f.incomingMax,17);
  assert.equal(f.incomingExact,false);
  // The same 12x3 attack, now only describable: the ceiling is gone but the number
  // is not, so the turn becomes rankable and exact instead of a null in the menu.
  const said=projectSequence(rock('?!',says('12')),['End turn']);
  assert.equal(said.incoming,36);assert.equal(said.incomingMin,36);assert.equal(said.incomingMax,36);
  assert.equal(said.incomingExact,true);assert.equal(said.quality,'calculated');assert.deepEqual(said.warnings,[]);
  // Two enemies, one readable and one only describable: the interval accumulates
  // across attackers instead of the whole forecast being thrown away.
  const mixed=rock('?!',says('12'));mixed.battle.enemies.push({entity_id:'b',name:'Fisk',hp:80,block:0,status:[],intents:[{type:'Attack',label:'9',description:'This enemy intends to Attack for 9 damage.'}]});
  const both=projectSequence(mixed,['End turn']);
  assert.equal(both.incoming,45);assert.equal(both.incomingMin,45);assert.equal(both.incomingMax,45);assert.equal(both.incomingExact,true);
});
test('an unresolved orientation has no ceiling rather than a comforting one',()=>{
  const s=rock('12',says('12'));s.player.status=[{name:'Surrounded',description:'Receive 50% more damage if attacked from behind. Use targeting cards or potions to change your orientation.'}];
  const f=projectSequence(s,['End turn']);
  assert.equal(f.incomingMax,null);assert.equal(f.incoming,null);assert.equal(f.incomingMin,12);
  assert.equal(f.survives,null);assert.notEqual(f.quality,'calculated');
  assert.ok(f.warnings.some(w=>/Position-dependent/.test(w)));
  for(const kind of kinds)assert.equal(planPreference(s,['End turn'],kind),-10000,kind);
});
