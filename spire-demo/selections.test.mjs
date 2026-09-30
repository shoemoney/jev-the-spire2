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
