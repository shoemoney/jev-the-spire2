// The gate's own comment said the `true` direction requires a fully stated quality. The code did not
// enforce it, and 3,246 of 3,332 executed `partial` forecasts claimed survival while carrying an
// unmodeled relic or power warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statedSurvival } from './lethal-gate.mjs';

const fc = (quality, survives, extra = {}) => ({ forecast: { quality, survives, warnings: ['x'], ...extra } });

test('a partial forecast may NOT license a claim of survival', () => {
  assert.equal(statedSurvival(fc('partial', true)), null, 'warnings mean the account is incomplete');
  assert.equal(statedSurvival(fc('partial', false)), false, 'but a floor still proves death');
});

test('a complete forecast states survival in both directions', () => {
  assert.equal(statedSurvival(fc('calculated', true)), true);
  assert.equal(statedSurvival(fc('calculated', false)), false);
  assert.equal(statedSurvival(fc('exact', true)), true);
});

test('an unknown forecast states nothing at all', () => {
  assert.equal(statedSurvival(fc('unknown', true)), null);
  assert.equal(statedSurvival(fc('unknown', false)), null);
});

test('boundedLethal still proves death without any stated quality', () => {
  assert.equal(statedSurvival({ forecast: { quality: 'unknown', survives: false, boundedLethal: true } }), false);
});

test('a missing or malformed forecast states nothing rather than throwing', () => {
  for (const c of [null, undefined, {}, { forecast: null }, { forecast: 'nope' }, { forecast: {} }])
    assert.equal(statedSurvival(c), null);
});
