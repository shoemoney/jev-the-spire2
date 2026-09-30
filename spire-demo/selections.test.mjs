import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectionState} from './selections.mjs';
import {actionsFor} from './actions.mjs';
const s={state_type:'card_select',run:{act:1,floor:12},card_select:{prompt:'Choose 2 cards',cards:[{index:0,id:'A'},{index:1,id:'B'}],can_confirm:false}};
const e={kind:'decision',outcome:'executed',state:s,chosen:{command:{action:'select_card',index:0}}};
test('bridge missing selection flags preserves observed toggle without selecting it twice',()=>{
 const fixed=selectionState(s,[e]);assert.equal(fixed.card_select.cards[0].is_selected,true);// The selected card is offered back as a DESELECT, not re-offered as a fresh select - the guard
 // this test protects is that selectionState never marks the same card selected twice.
 const fx=actionsFor(fixed);assert.equal(fx.filter(x=>x.command.index===0).length,1);assert.match(fx.find(x=>x.command.index===0).label,/Deselect/);assert.equal(fx.some(x=>x.command.index===1),true);
 assert.equal(selectionState(s,[{...e,outcome:'preview'}]),s);
 assert.equal(selectionState(s,[{...e,state:{...s,run:{act:1,floor:13}}}]),s);
 assert.equal(selectionState(s,[e,e]),s);
});

test('enchant confirmation requires the prompted count despite premature bridge flag',()=>{
 const grid={...s,card_select:{prompt:'Choose 3 cards to Enchant.',can_confirm:true,cards:[{index:0,id:'A'},{index:1,id:'B'},{index:2,id:'C'},{index:3,id:'D'}]}};
 const toggle=i=>({kind:'decision',outcome:'executed',state:grid,chosen:{command:{action:'select_card',index:i}}});
 const confirm={...toggle(0),chosen:{command:{action:'confirm_selection'}}};
 assert.equal(actionsFor(grid).some(a=>a.command.action==='confirm_selection'),false);
 const two=selectionState(grid,[confirm,toggle(1),toggle(0)]);
 assert.deepEqual(actionsFor(two).map(a=>a.command.index),[0,1,2,3],'chosen cards come back as toggles and the rest can be added');
 const three=selectionState(grid,[toggle(2),confirm,toggle(1),toggle(0)]);
 const threeActions=actionsFor(three).map(a=>a.command.action);assert.ok(threeActions.includes('confirm_selection'),'three chosen unlocks confirm');assert.ok(threeActions.includes('select_card'),'and the selection can still be revised');
});

// THE REGRESSION THIS EXISTED FOR. `view.events.unshift(entry)` puts the NEWEST event at index 0,
// so reconstruction that walks `events` in order walks BACKWARDS through time — and the `break` on
// the first non-select event then fires on the newest one, so the reconstruction always bailed and
// returned the state untouched.
//
// Live symptom: the bridge never echoes `is_selected` on a Deck Enchant screen (the key is absent
// entirely), so the agent selected card after card, never satisfied "Choose 3 cards to Enchant",
// was never offered confirm, and the run sat on that overlay indefinitely.
test('selection is reconstructed from a newest-first event buffer', () => {
  const card = (index, id) => ({index, id, name: id});
  const screen = {
    state_type: 'card_select',
    run: {act: 1, floor: 15},
    card_select: {screen_type: 'NDeckEnchantSelectScreen', prompt: 'Choose 3 cards to Enchant.', can_confirm: true,
      cards: [card(0, 'A'), card(1, 'B'), card(2, 'C'), card(3, 'D')]},
  };
  const pick = index => ({kind: 'decision', outcome: 'executed', state: screen, chosen: {command: {action: 'select_card', index}}});
  // Exactly how server.mjs holds them: newest first.
  const newestFirst = [pick(2), pick(1), pick(0)];
  const fixed = selectionState(screen, newestFirst);
  const chosen = fixed.card_select.cards.filter(x => x.is_selected).map(x => x.id).sort();
  assert.deepEqual(chosen, ['A', 'B', 'C'], 'three picks are reconstructed and the screen can confirm');
  assert.equal(fixed.card_select.selection_source != null, true, 'and says where the state came from');
  // And it must be reversible: a toggle of an already-chosen card takes it back.
  const toggled = selectionState(screen, [pick(0), pick(1), pick(2), pick(0)]);
  assert.deepEqual(toggled.card_select.cards.filter(x => x.is_selected).map(x => x.id).sort(), ['B', 'C'],
    're-selecting a chosen card deselects it, which is what unsticks a wrong choice');
});

test('a screen whose bridge DOES report is_selected is left exactly as the bridge said', () => {
  const withFlags = {state_type: 'card_select', run: {act: 1, floor: 15},
    card_select: {prompt: 'Choose 3 cards to Enchant.', can_confirm: true,
      cards: [{index: 0, id: 'A', is_selected: true}, {index: 1, id: 'B', is_selected: false}]}};
  const pick = {kind: 'decision', outcome: 'executed', state: withFlags, chosen: {command: {action: 'select_card', index: 1}}};
  assert.equal(selectionState(withFlags, [pick]), withFlags, 'the bridge is the authority when it speaks');
});
