// STUN IS NOT MODELLED, and the corpus says it costs the agent its boss fights:
//
//   boss fights where the boss telegraphed Stun : 6 fights  1w 5l   17%
//   boss fights with no Stun telegraph         : 15 fights  9w 6l   60%
//   win rate ratio, stunned vs not             : 0.28x
//
// `knownEnemyPowers` is ['strength','weak','vulnerable','slippery','plow','artifact'] — no stun — and
// the only Stun in planner.mjs is `bossStunned`, the BOSS being stunned by Plow, not the enemy
// stunning the PLAYER. So the agent forecasts as though it gets a turn, and it dies.
//
// The design rule this obeys: never invent a number. The NEXT turn's attack is not visible, so the
// forecast must not guess an amount for it — it must stop claiming survival, because survival now
// depends on a turn the planner cannot see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectSequence, decisionCandidates } from './planner.mjs';

const base = JSON.parse(readFileSync(new URL('./fixtures/beast-free.json', import.meta.url), 'utf8')).state;
const withStun = (stunned) => {
  const s = structuredClone(base);
  s.state_type = 'boss';
  s.battle = { round: 1, turn: 'player', is_play_phase: true, enemies: [{ entity_id: 'B1', name: 'Ceremonial Beast', hp: 200, max_hp: 252, block: 0, status: [], intents: [{ type: 'Stun', label: '', title: 'Stun', description: 'This enemy intends to Stun.' }, { type: 'Attack', label: '30', title: 'Attacking', description: 'This enemy intends to Attack for 30 damage.' }] }] };
  if (!stunned) s.battle.enemies[0].intents = [{ type: 'Attack', label: '30', title: 'Attacking', description: 'This enemy intends to Attack for 30 damage.' }];
  s.player = { ...s.player, hp: 60, max_hp: 80, block: 0, energy: 3 };
  s.hand = [{ index: 0, name: 'Strike', cost: '1', description: 'Deal 6 damage.', type: 'Attack', target_type: 'Enemy', can_play: true }];
  return s;
};

test('a board where the boss telegraphs Stun does NOT report a survival claim it cannot support', () => {
  const stunned = withStun(true);
  const cands = decisionCandidates(stunned);
  assert.ok(cands.length, 'the board produces candidates');
  for (const c of cands) {
    assert.notEqual(c.forecast.survives, true, `"${c.label}" claims survival on a board where the next turn is lost`);
  }
});

test('the Stun consequence is named in the warnings, not just implied', () => {
  const cands = decisionCandidates(withStun(true));
  const warns = (cands[0]?.forecast?.warnings ?? []).join(' | ');
  assert.match(warns, /[Ss]tun/, `the warning must name the mechanic; got: ${warns.slice(0, 160)}`);
  assert.match(warns, /turn/, 'and say that a turn is lost');
});

test('the same board WITHOUT Stun is unchanged and may still claim survival', () => {
  // The control: this must be a narrow change. If a plain Attack board also loses its survival
  // claim, the fix has broken every forecast rather than modelling one mechanic.
  const plain = withStun(false);
  const cands = decisionCandidates(plain);
  assert.ok(cands.length);
  assert.ok(cands.some(c => c.forecast.survives === true), 'a plain 30-damage telegraph at 60 HP with a Strike available may still be a survivable claim');
  const warns = (cands[0]?.forecast?.warnings ?? []).join(' ');
  assert.doesNotMatch(warns, /[Ss]tun/, 'and no Stun warning appears when nothing stuns');
});

void projectSequence;
