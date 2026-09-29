import test from 'node:test';
import assert from 'node:assert/strict';
import {factsFor, makeQuestion} from './actions.mjs';
import {deckUnavailableInstruction} from './deck-assessment.mjs';

const board=(intents,block=0)=>({state_type:'monster',player:{block},battle:{enemies:[{entity_id:'LIVE_0',hp:30,intents}]}});
const atk=(label,extra={})=>({type:'Attack',label,...extra});

test('a multi-hit label the game printed as `4x3 (12)` counts 12, not 0',()=>{
  const f=factsFor(board([atk('4x3 (12)')],5));
  assert.equal(f.displayed_incoming_attack_total,12);
  assert.equal(f.displayed_incoming_attack_min,12);assert.equal(f.displayed_incoming_attack_max,12);
  assert.equal(f.displayed_block_gap,7);
  assert.equal(f.all_attack_labels_parsed,true);
  assert.equal(f.attack_intents_read,1);assert.equal(f.attack_intents_unread,0);
});

test('the block gap comes from the corrected total, not from a sum that skipped a label',()=>{
  const two=board([atk('4x3 (12)'),atk('5')],5);
  assert.equal(factsFor(two).displayed_incoming_attack_total,17);
  assert.equal(factsFor(two).displayed_block_gap,12);
  assert.equal(factsFor(board([atk('4x3 (12)')],12)).displayed_block_gap,0);
  assert.equal(factsFor(board([atk('9')],0)).displayed_block_gap,9);
});

test('an unread attack is unknown, never a zero wearing a total\'s name',()=>{
  const f=factsFor(board([atk('4x3 (12)'),atk('?')],5));
  assert.equal(f.displayed_incoming_attack_total,null);
  assert.equal(f.displayed_block_gap,null);
  // The other three would be a partial sum presented as the whole, which is the original defect.
  assert.equal(f.displayed_incoming_attack_min,null);assert.equal(f.displayed_incoming_attack_max,null);
  assert.equal(f.attack_intents_read,1);assert.equal(f.attack_intents_unread,1);
  assert.deepEqual(f.unread_attack_labels,['?']);
  assert.equal(f.all_attack_labels_parsed,false);
});

test('a board where every attack reads publishes a real total',()=>{
  const f=factsFor(board([atk('12'),atk('4x3'),atk('3 x 2'),atk('9',{type:'AttackDebuff'})],0));
  assert.equal(f.displayed_incoming_attack_total,39);
  assert.equal(f.displayed_block_gap,39);
  assert.equal(f.all_attack_labels_parsed,true);
  assert.equal(f.attack_intents_unread,0);assert.equal(f.contradictory_attack_labels,0);
});

test('regression: the forms that already parsed still parse, and dead enemies stay out',()=>{
  assert.equal(factsFor(board([atk('12')])).displayed_incoming_attack_total,12);
  assert.equal(factsFor(board([atk('4x3')])).displayed_incoming_attack_total,12);
  assert.equal(factsFor(board([atk('4 × 3')])).displayed_incoming_attack_total,12);
  assert.equal(factsFor(board([atk('4x3.')])).displayed_incoming_attack_total,12);
  assert.equal(factsFor(board([atk('8',{type:'Defend'})])).displayed_incoming_attack_total,0);
  const dead={state_type:'monster',player:{block:0},battle:{enemies:[{entity_id:'DEAD',hp:0,intents:[atk('4x3 (12)')]}]}};
  assert.equal(factsFor(dead).displayed_incoming_attack_total,0);
});

test('two printed numbers that disagree become an interval, not a chosen one',()=>{
  const f=factsFor(board([atk('5x3 (99)')],0));
  assert.equal(f.displayed_incoming_attack_total,null);
  assert.equal(f.displayed_incoming_attack_min,15);assert.equal(f.displayed_incoming_attack_max,99);
  assert.equal(f.contradictory_attack_labels,1);
  assert.equal(f.displayed_block_gap,null);
});

test('an unread label rescued by its own description still yields a total',()=>{
  const f=factsFor(board([atk('?',{description:'Deal 6 damage 3 times.'})]),0);
  assert.equal(f.displayed_incoming_attack_total,18);
  assert.equal(f.all_attack_labels_parsed,false);
  assert.equal(f.attack_intents_unread,0);
});

test('the count is the authority when more unread labels exist than are listed',()=>{
  const many=Array.from({length:12},(_,i)=>atk(`?${i}`));
  const f=factsFor(board(many));
  assert.equal(f.attack_intents_unread,12);
  assert.equal(f.unread_attack_labels.length,8);
  assert.match(f.note,/count is the authority/);
});

test('the generic move instruction never asserts a deck the bridge does not send',()=>{
  const q=makeQuestion({state_type:'map',map:{next_options:[{index:0,type:'combat'}]}},[{id:'a0',command:{action:'choose_map_node',index:0},label:'Combat'}]);
  const t=q.questions.move.instructions;
  assert.ok(!/current deck|the deck\b|permanent deck is|current cards/i.test(t.replace(deckUnavailableInstruction,'')),t);
  assert.ok(t.includes(deckUnavailableInstruction));
  assert.match(t,/not included in this request/);
});

test('a null total is explained in the request text, so it is not read as zero',()=>{
  const unread=board([atk('?',{description:'Something happens.'})]);
  const read=board([atk('4x3 (12)')]);
  const q1=makeQuestion(unread,[{id:'a0',command:{action:'end_turn'},label:'End turn'}]);
  const q2=makeQuestion(read,[{id:'a0',command:{action:'end_turn'},label:'End turn'}]);
  assert.match(q1.questions.move.instructions,/that is unknown, not zero/);
  assert.doesNotMatch(q2.questions.move.instructions,/unknown, not zero/);
  assert.equal(q1.state.facts.displayed_incoming_attack_total,null);
  assert.equal(q2.state.facts.displayed_incoming_attack_total,12);
});
