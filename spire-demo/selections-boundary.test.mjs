// A live NDeckEnchantSelectScreen deadlock: the agent selected the same card 76 times, toggling it
// on and off and never confirming, because it never believed it had selected anything.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionState } from './selections.mjs';

const grid = {
  state_type: 'card_select',
  run: { act: 2, floor: 22 },
  card_select: {
    screen_type: 'NDeckEnchantSelectScreen', prompt: 'Choose a card to Enchant.',
    can_confirm: true, can_cancel: false,
    cards: [{ index: 0, id: 'c0', name: 'Stampede' }, { index: 1, id: 'c1', name: 'Inflame' }, { index: 2, id: 'c2', name: 'Aggression' }],
  },
};
// The bridge omits `is_selected` entirely on this grid, which is what makes the reconstruction
// necessary in the first place.
assert.ok(!('is_selected' in grid.card_select.cards[0]));
const sel = (i) => ({ kind: 'decision', outcome: 'executed', state: grid, chosen: { command: { action: 'select_card', index: i } } });
const other = () => ({ kind: 'decision', outcome: 'executed', state: { state_type: 'monster', run: { act: 1, floor: 3 }, battle: { enemies: [{ hp: 9 }] } }, chosen: { command: { action: 'end_turn' } } });

test('an earlier event from a different screen does not stop the reconstruction', () => {
  // The bug: the walk started at the oldest event in the WHOLE run, whose signature differed, and
  // broke on iteration one having learned nothing - so the state came back untouched every time.
  const events = [other(), other(), sel(1)];
  const out = selectionState(grid, events);
  assert.equal(out.card_select.selection_source, 'Successful selection toggles in this uninterrupted screen');
  assert.deepEqual(out.card_select.cards.filter(c => c.is_selected).map(c => c.name), ['Inflame']);
});

test('selecting the same card twice leaves it unselected, not stuck on', () => {
  const out = selectionState(grid, [sel(1), sel(1)]);
  assert.deepEqual(out.card_select.cards.filter(c => c.is_selected), [], 'a toggle is a toggle');
});

test('a grid that DOES expose is_selected is left exactly as the game reported it', () => {
  const explicit = { ...grid, card_select: { ...grid.card_select, cards: grid.card_select.cards.map(c => ({ ...c, is_selected: c.index === 2 })) } };
  assert.equal(selectionState(explicit, [sel(1)]), explicit, 'no reconstruction over a real reading');
});

test('no selections means the state comes back untouched', () => {
  assert.equal(selectionState(grid, [other(), other()]), grid);
});
