// Some bridge card grids omit is_selected. Successful toggles are observable
// actions; retain them only within the same uninterrupted selection screen.
export function selectionState(state,events=[]){
 const c=state.card_select;
 if(state.state_type!=='card_select'||!c?.cards?.length||c.cards.some(x=>'is_selected' in x))return state;
 const signature=s=>JSON.stringify([s.run?.act,s.run?.floor,s.card_select?.prompt,s.card_select?.cards?.map(x=>[x.index,x.id,x.name])]);
 const key=signature(state),selected=new Set();
 // OLDEST FIRST. `view.events.unshift(entry)` puts the NEWEST event at index 0, so walking
 // `events` in order walks BACKWARDS through time — and the `break` below then fired on the newest
 // event, which is never a select_card, so the reconstruction bailed immediately and always
 // returned the state untouched. Measured on a live "Choose 3 cards to Enchant" screen: the bridge
 // never echoes `is_selected` (the key is simply absent), the agent selected and selected and
 // selected, the requirement of three was never met, and confirm was never offered. Reversing is the
 // whole fix; the loop logic below was right.
 // WALK THE SCREEN, NOT THE WHOLE HISTORY. This reversed the `break` once and fixed the symptom
 // (the newest-first order made it fire on the first non-select event) while leaving a worse bug:
 // `view.events` holds the entire run, so walking it oldest-first STARTS on some earlier screen,
 // whose signature differs, and the loop breaks on its first iteration having learned nothing. The
 // reconstruction therefore returned the state untouched on every single card grid that omits
 // `is_selected` — which is every one of them.
 //
 // Measured on a live `NDeckEnchantSelectScreen` ("Choose a card to Enchant", can_confirm true, no
 // selected field): the agent offered three `select_card` toggles and no Confirm, selected Inflame,
 // the game acknowledged "Toggling card selection: Inflame", and the agent selected Inflame again
 // 76 times, toggling it on and off and never once confirming. The confirmation candidate could
 // never appear because the agent never believed it had selected anything.
 //
 // So: skip everything until this screen is reached, then stop the moment it is left. The boundary
 // check is two-sided, and only the second side is a break.
 let onThisScreen = false;
 for(const e of [...events].reverse()){
  if(e.kind!=='decision'||e.outcome!=='executed')continue;
  const same=e.state?.state_type==='card_select'&&signature(e.state)===key;
  if(!same){ if(onThisScreen)break; else continue; }   // not here yet, or already past the end
  onThisScreen=true;
  if(e.chosen?.command?.action==='confirm_selection')continue;
  if(e.chosen?.command?.action!=='select_card')break;
  const i=e.chosen.command.index;if(selected.has(i))selected.delete(i);else selected.add(i);
 }
 if(!selected.size)return state;
 return {...state,card_select:{...c,selection_source:'Successful selection toggles in this uninterrupted screen',cards:c.cards.map(x=>({...x,is_selected:selected.has(x.index)}))}};
}
