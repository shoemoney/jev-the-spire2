import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionFocus} from './decision-focus.mjs';
import {decisionCandidates} from './planner.mjs';
import {perspectiveQuestion,reviewQuestion} from './deliberation.mjs';

// This test used to assert the OPPOSITE of what it should have. It required `Act 2 route
// preference` in both passes AND that acts 1 and 3 did NOT carry it — which meant the elite
// guidance was silent in Act 1, where the data says 19 of 20 deaths happen and elites are the
// worst class at 11/34 won. A review found it; the gate was an act-2 assumption nobody checked
// against where the agent actually dies.
test('route preference reaches both passes in EVERY act, without banning unavoidable elites',()=>{
  const s={state_type:'map',run:{act:1},player:{hp:14,max_hp:80,gold:200,deck:[],potions:[],relics:[]},map:{next_options:[{index:0,type:'Elite',col:0,row:1},{index:1,type:'Monster',col:1,row:1}]}};
  const cs=decisionCandidates(s),p=perspectiveQuestion(s,cs),r=reviewQuestion(s,cs,{answers:{move:{type:'choice',choice:cs[0].id}}});
  for(const q of [p.questions.move,p.questions.survival,p.questions.resources,r.questions.move]){
   assert.match(q.instructions,/Route preference: prefer paths with fewer elites/);
   assert.match(q.instructions,/healing or shopping comes before danger/);
   assert.match(q.instructions,/When elites are unavoidable/);
   assert.deepEqual(Object.keys(q.criteria),cs.map(c=>c.id));
  }
  // It is a route preference, not a rule that elites are always bad.
  assert.match(p.questions.move.instructions,/Do not choose a worse overall survival route merely to reduce the elite count/);
  assert.match(p.questions.move.instructions,/Keep all routes available/);

  // An UNFORCED elite is still on the menu: guidance never removes a choice.
  s.map.next_options=s.map.next_options.slice(0,1);assert.equal(decisionCandidates(s)[0].command.index,0);

  // Every act gets it, because every act is where the agent dies.
  for(const act of [1,2,3,4]){
   assert.match(JSON.stringify(decisionFocus({...s,run:{act}})),/fewer elites/,`act ${act} must carry the route guidance`);
  }
  // And it stays off screens that are not about choosing a route.
  assert.doesNotMatch(JSON.stringify(decisionFocus({...s,state_type:'elite'})),/fewer elites/);
});
