// Three reviewers independently flagged that the gate treats a `partial` forecast as a proven
// survivor. Measured: 92.5% of combat decisions have a partial forecast claiming survives, and on
// 3,865 of them that is the ONLY survivor claim — so forbidding it would WITHHOLD up to 22 rescues
// and gain none. The defect is not the gate's behaviour, it is the log's claim about it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refuseLethalChoice, statedSurvival } from './lethal-gate.mjs';

const cand = (id, quality, survives) => ({ id, label: id, forecast: { quality, survives } });

test('a partial survivor claim is not described as a stated one', () => {
  // Both branches, because both overclaimed: the no-refusal branch and the override branch.
  const list = [cand('p0', 'partial', false), cand('p1', 'partial', true)];
  const g = refuseLethalChoice('p0', list, list);
  assert.equal(g.choice, 'p1', 'the rescue still happens — withholding it would cost a real decision');
  assert.match(g.reason, /CLAIMS survives:true/);
  assert.match(g.reason, /PARTIAL/);
  assert.match(g.reason, /UNPROVEN survivor/);
  const noRefuse = refuseLethalChoice('p1', list, list);
  assert.match(noRefuse.reason, /CLAIMS it survives/);
  assert.match(noRefuse.reason, /not a proven survivor/);
});

test('a complete forecast is still described as stating survival', () => {
  const g = refuseLethalChoice('p0', [cand('p0', 'calculated', false), cand('p1', 'calculated', true)], [cand('p0', 'calculated', false), cand('p1', 'calculated', true)]);
  const g2 = refuseLethalChoice('p0', [cand('p0', 'calculated', false), cand('p1', 'calculated', true)], [cand('p0', 'calculated', false), cand('p1', 'calculated', true)]);
  assert.match(g2.reason, /states survives:false at quality "calculated"/);
  assert.doesNotMatch(g2.reason, /UNPROVEN/);
  assert.doesNotMatch(g2.reason, /PARTIAL/);
});

test('an unknown stays unknown — nothing is inferred from it', () => {
  const g = refuseLethalChoice('p0', [cand('p0', 'unknown', null), cand('p1', 'unknown', null)], []);
  assert.match(g.reason, /nothing is inferred from an unknown/);
  assert.equal(statedSurvival({ forecast: { quality: 'unknown', survives: null } }), null);
});
