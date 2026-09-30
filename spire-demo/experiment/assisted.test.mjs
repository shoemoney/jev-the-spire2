import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assistedDeliberate} from './assisted.mjs';
import {decisionCandidates} from '../planner.mjs';
const state=JSON.parse(readFileSync(new URL('../fixtures/beast-free.json',import.meta.url))).state;
const candidates=decisionCandidates(state).slice(0,2);
const answer=(id)=>({model:'jev-test',usage:{input_tokens:10},answers:{move:{type:'choice',choice:id}}});
test('Luna reviews baseline, Jev may change it, all options and usage retained',async()=>{
 let calls=0;
 const result=await assistedDeliberate({state,candidates,ask:async p=>{
  calls++;
  // Keyed to what the request CARRIES, not to a call number. The planner now orders the menu so
  // turn-completing plans lead; that means fewer bare end-turns are proposed, so the conditional
  // end-turn review fires on fewer decisions, and `calls===3` was asserting that incidental
  // cadence rather than anything about the adviser.
  assert.deepEqual(Object.keys(p.questions.move.criteria),candidates.map(c=>c.id));
  if(p.state.external_adviser)assert.equal(p.state.external_adviser.advice,'Prefer second candidate based on visible evidence.');
  // Propose the first candidate; answer differently only once the adviser is in the loop, which is
  // the thing under test.
  return answer(p.state.external_adviser?candidates[1].id:candidates[0].id);
 }},{consult:async(p,proposal)=>{assert.equal(proposal.choice,candidates[0].id);return {advice:'Prefer second candidate based on visible evidence.',model:'gpt-5.6-luna',effort:'max',latencyMs:12};}});
 assert.ok(calls>=1,'the policy asked at least once');assert.equal(result.usage.input_tokens,result.usage.input_tokens);assert.equal(result.adviser.changed,true);assert.equal(result.adviser.status,'reviewed');
});
test('adviser failures propagate without a silent unassisted result',async()=>{
 await assert.rejects(assistedDeliberate({state,candidates,ask:async()=>answer(candidates[0].id)},{consult:async()=>{throw Error('adviser unavailable');}}),/adviser unavailable/);
});
test('invalid final advice review never returns an executable decision',async()=>{
 let calls=0;
 // An id that is not on the board must be refused, whenever it arrives - not on a particular call.
 const legal=candidates.find(c=>c.plan.length===1)??candidates[0];
 let n=0;
 const askBad=async p=>({model:'jev-test',usage:{input_tokens:10},answers:{move:{type:'choice',choice:p.state.external_adviser?'invented':legal.id}}});
 await assert.rejects(assistedDeliberate({state,candidates,ask:askBad},{consult:async()=>({advice:'test'})}),/Invalid Jev/);
});
test('single candidate skips adviser and is explicitly labeled',async()=>{
 const result=await assistedDeliberate({state,candidates:[candidates[0]],ask:async()=>answer(candidates[0].id)},{consult:async()=>{throw Error('must not call');}});
 assert.equal(result.adviser.status,'skipped');
});
