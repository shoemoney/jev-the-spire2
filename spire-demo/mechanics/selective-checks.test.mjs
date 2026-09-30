// `mechanicsReview` ships nine prose checks on EVERY decision — about 2.4 KB, a fifth of the wire
// on an ordinary trash-mob turn — and eight of them open with a precondition. These pin the
// relevance filter, and in particular the failure mode that would matter most: losing a safety
// instruction because its trigger could not be matched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relevantChecks } from './selective-checks.mjs';
import { mechanicsReview, ALL_CHECKS } from '../mechanics.mjs';

const board = (enemies) => ({
  battle: { enemies: enemies ?? [{ entity_id: 'E1', hp: 40, intents: [{ type: 'Attack', label: '9' }], status: [] }] },
  player: { status: [] },
});

test('a trash-mob board does not receive checks for minion leaders or revival', () => {
  // The REAL check texts, not placeholders: the filter matches on what each check says, so a
  // synthetic 'a','b','c' is correctly kept by the unknown-check fallback and proves nothing.
  const all = ALL_CHECKS;
  assert.equal(all.length, 8, 'the full set is what the filter starts from');
  const kept = relevantChecks(board(), all);
  assert.ok(!kept.some(t => /leader/i.test(t)), 'no minion-leader check without minions');
  assert.ok(!kept.some(t => /revival/i.test(t)), 'no revival check without a revival rule');
  assert.equal(kept.length, 3, 'a trash mob keeps only the three that can apply');
  assert.ok(kept.some(t => /supplied triggers fire/i.test(t)), 'the always-on trigger check survives');
  assert.ok(kept.some(t => /repeated behavior/i.test(t)), 'the repeated-behaviour check survives');
});

test('a visible revival rule earns the revival check', () => {
  const s = board([{ entity_id: 'E1', hp: 40, intents: [], status: [{ name: 'Come Back', description: 'Revives when another enemy lives' }] }]);
  const t = 'When a visible revival rule depends on other enemies remaining alive, compare temporary attack prevention with the need to finish the remaining enemies inside the stated revival window. Use observed HP and available damage; repeatedly defeating one target may make no lasting progress. Do not assume unseen revival timers or future draws.';
  assert.equal(relevantChecks(s, [t]).length, 1);
});

test('two living enemies earn the compare-after-a-kill check; one does not', () => {
  const t = 'Compare remaining enemies and their visible attacks after a kill, including death effects. If a relevant interaction is unmodeled, survival remains uncertain.';
  assert.equal(relevantChecks(board(), [t]).length, 0, 'one enemy: not relevant');
  assert.equal(relevantChecks(board([{ entity_id: 'A', hp: 10 }, { entity_id: 'B', hp: 10 }]), [t]).length, 1, 'two enemies: relevant');
});

test('a visible destroy-after-attacking rule earns its check', () => {
  const t = 'If an intent explicitly says the enemy will be destroyed after attacking, compare surviving that attack against spending energy on further damage. Do not assume its displayed HP must be depleted again; use the stated destruction timing, without inventing immunity or an automatic win.';
  assert.equal(relevantChecks(board(), [t]).length, 0, 'no such rule on the board');
  const s = board([{ entity_id: 'A', hp: 10, intents: [{ type: 'Attack', label: '9', description: 'will be destroyed after attacking' }], status: [] }]);
  assert.equal(relevantChecks(s, [t]).length, 1);
});

test('an unrecognised check is KEPT, never dropped for being unplaceable', () => {
  // The failure mode that would matter most: silently losing a safety instruction because the
  // trigger could not be matched is worse than carrying one instruction too many.
  const t = 'some entirely new instruction nobody anticipated';
  assert.deepEqual(relevantChecks(board(), [t]), [t]);
});

test('a richer board earns more checks, so the filter is reading the board and not a fixed list', () => {
  const mob = mechanicsReview(board()).checks.length;
  const pair = mechanicsReview(board([{ entity_id: 'A', hp: 10 }, { entity_id: 'B', hp: 10 }])).checks.length;
  const revive = mechanicsReview(board([{ entity_id: 'A', hp: 10, status: [{ name: 'X', description: 'Revives later' }] }, { entity_id: 'B', hp: 10 }])).checks.length;
  assert.ok(mob < pair && pair < revive, `expected mob < two enemies < revival board, got ${mob}/${pair}/${revive}`);
});

test('every check text is preserved verbatim — this filters, it never rewrites or truncates', () => {
  const all = mechanicsReview(board()).checks;
  for (const c of all) assert.ok(typeof c === 'string' && c.length > 20, 'a check is a whole sentence, not a fragment');
  assert.ok(all.length < ALL_CHECKS.length, `an ordinary board should not carry all of them (got ${all.length}/${ALL_CHECKS.length})`);
  assert.equal(all.length, 3, 'a trash mob keeps exactly the three that can apply to it');
});
