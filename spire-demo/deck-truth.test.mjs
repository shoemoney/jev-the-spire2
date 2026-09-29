import test from 'node:test';
import assert from 'node:assert/strict';
import {perspectiveQuestion,reviewQuestion} from './deliberation.mjs';
import {deckAssessment,deckAssessmentInstruction} from './deck-assessment.mjs';
import {decisionCandidates} from './planner.mjs';
// Synthetic card rewards: the bridge sends piles and counts but no permanent deck, so the
// blind state is the real shape and the sighted one is the regression guard for a patched build.
const offers=[{name:'Bash',cost:2,description:'Deal 8 damage.'},{name:'Heavy Blade',cost:2,description:'Deal 14 damage. Costs 1 energy.'}];
const blind={state_type:'card_reward',run:{act:1,floor:5,ascension:1},player:{hp:70,max_hp:75,block:0,energy:3,max_energy:3,gold:99,status:[],relics:[{name:'Bronze Scales',description:'At the start of each turn, gain 3 Block.'}],potions:[{slot:0,name:'Block Potion'}],max_potion_slots:2,draw_pile:[{name:'Strike',cost:1,description:'Deal 6 damage.'}],discard_pile:[{name:'Defend',cost:1,description:'Gain 5 Block.'}],exhaust_pile:[]},card_reward:{cards:offers,can_skip:true}};
const sighted=structuredClone(blind);
sighted.player.deck=[{name:'Strike',cost:1,description:'Deal 6 damage.'},{name:'Strike',cost:1,description:'Deal 6 damage.'},{name:'Defend',cost:1,description:'Gain 5 Block.'},{name:'Bash',cost:2,description:'Deal 8 damage.'}];
// The deck guidance is appended to these roles only; the rest of the card-reward screen never had it.
const carriers=['move','synergy','resources','deck_need'];
const all=questions=>Object.entries(questions).map(([role,q])=>[role,q.instructions]);
const carried=questions=>carriers.map(role=>[role,questions[role].instructions]);
const pass=state=>{const candidates=decisionCandidates(state);return {candidates,q:perspectiveQuestion(state,candidates),r:reviewQuestion(state,candidates,{answers:{move:{type:'choice',choice:candidates[0].id}}})};};

test('an absent deck is stated as absent and never becomes a source to reason from',()=>{
 const {q}=pass(blind);assert.equal(q.state.deck_assessment.available,false);
 for(const [,instructions] of all(q.questions))assert.doesNotMatch(instructions,/deck_assessment/);
 for(const [role,instructions] of carried(q.questions)){
  assert.doesNotMatch(instructions,/deck_assessment/,role);
  assert.match(instructions,/permanent deck is not included/,role);
 }
});

test('the unavailable assessment stays in the payload and carries no deck-shaped values',()=>{
 const {q,r}=pass(blind);
 assert.equal(q.state.deck_assessment.available,false);assert.equal(r.state.deck_assessment.available,false);
 assert.deepEqual(Object.keys(q.state.deck_assessment),['available','note']);
 for(const key of ['size','cards','costs','duplicates','conditionalCards','exhaustSupport','offers','energy'])
  assert.ok(!Object.hasOwn(q.state.deck_assessment,key),'unavailable assessment must not report '+key);
 assert.doesNotMatch(JSON.stringify(q.state.deck_assessment),/Strike|Defend/);
});

test('a real deck keeps the original bottleneck instruction unchanged in both passes',()=>{
 const {q,r}=pass(sighted);assert.equal(q.state.deck_assessment.available,true);
 for(const [role,instructions] of [...carried(q.questions),['review.move',r.questions.move.instructions]]){
  assert.ok(instructions.includes(deckAssessmentInstruction),role);
  assert.match(instructions,/Use deck_assessment to identify the largest current bottleneck before choosing a reward\./,role);
 }
 assert.match(q.questions.deck_need.instructions,/from the supplied deck and observations/);
});

test('every offered card and Skip stays selectable and none is steered toward skipping',()=>{
 for(const state of [blind,sighted]){
  const {candidates,q}=pass(state);
  assert.equal(candidates.length,3);
  const skip=candidates.find(c=>c.command.action==='skip_card_reward');assert.ok(skip,'Skip must be a real candidate');
  for(const [role,question] of Object.entries(q.questions)){
   if(role==='deck_need')continue;
   assert.deepEqual(Object.keys(question.criteria),candidates.map(c=>c.id),role+' lost choices');
   assert.doesNotMatch(question.instructions,/(?:^|[. ])(?:prefer|choose|default to|take|opt for)\s+(?:the\s+)?skip/i,role);
  }
 }
 // The blind path has to say why Skip is not the default, or nothing here is left to reason from.
 for(const [,instructions] of carried(pass(blind).q.questions))assert.match(instructions,/not a reason to skip by default/);
});

test('deckAssessment never invents a deck the state does not carry',()=>{
 for(const state of [{},blind,{state_type:'card_reward',player:{draw_pile:blind.player.draw_pile,discard_pile:blind.player.discard_pile,max_energy:3}}]){
  const a=deckAssessment(state);
  assert.equal(a.available,false);
  assert.equal(a.cards,undefined);assert.equal(a.size,undefined);assert.equal(a.energy,undefined);
  assert.match(a.note,/do not infer missing cards/);
 }
 // An empty array is a deck that says so; a missing key is a deck that is not visible.
 const empty=deckAssessment({player:{deck:[]}});
 assert.equal(empty.available,true);assert.equal(empty.size,0);assert.deepEqual(empty.costs,{});
});
