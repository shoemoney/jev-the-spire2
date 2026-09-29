import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIntentLabel} from './planner.mjs';
// Every one of the 97 failing labels from the 769-decision run log, verbatim.
const observed=['4x3 (12)','1x3 (3)','5x3 (15)','5x4 (20)','2x4 (8)','3x2 (6)','4x4 (16)','3x3 (9)','12x2 (24)','16x2 (32)','7x3 (21)','9x3 (27)','8x2 (16)'];
test('the parenthesised multi-hit form that blanked the forecast parses to its parts',()=>{
  assert.deepEqual(parseIntentLabel('4x3 (12)'),{perHit:4,hits:3,total:12,mismatch:false});
  assert.deepEqual(parseIntentLabel('12'),{perHit:12,hits:1,total:12,mismatch:false});
  assert.deepEqual(parseIntentLabel('4x3'),{perHit:4,hits:3,total:12,mismatch:false});
  for(const l of observed){const r=parseIntentLabel(l);assert.ok(r,`${l} must parse`);assert.equal(r.mismatch,false,`${l} agrees with itself`);assert.equal(r.perHit*r.hits,r.total,`${l} total`);}
  assert.deepEqual(observed.map(l=>parseIntentLabel(l).total),[12,3,15,20,8,6,16,9,24,32,21,27,16]);
});
test('ASCII x, capital X, unicode multiplication sign, spacing and a trailing period are one label',()=>{
  for(const l of ['4x3','4X3','4×3','4x 3','4 x 3','  4x3  ','4x3 (12).',' 4x3 (12) ','4x3(12)','4 x 3 ( 12 )'])
    assert.deepEqual(parseIntentLabel(l),{perHit:4,hits:3,total:12,mismatch:false},`${JSON.stringify(l)}`);
  assert.deepEqual(parseIntentLabel('4x3.'),{perHit:4,hits:3,total:12,mismatch:false});
});
test('a total that contradicts perHit*hits is flagged, never silently resolved',()=>{
  const r=parseIntentLabel('4x3 (13)');
  assert.equal(r.perHit,4);assert.equal(r.hits,3);
  assert.equal(r.total,13);assert.equal(r.mismatch,true);
  assert.ok(parseIntentLabel('5x3 (15)').mismatch===false);
  assert.ok(parseIntentLabel('5x3 (99)').mismatch===true);
  assert.ok(parseIntentLabel('5x3 (0)').mismatch===true);
});
test('unparseable labels return null instead of a guess',()=>{
  for(const l of ['','   ','Attack','4x','x3','4x3 (','(12)','4x3x2','4x3 12','4x3. (12)','4xX3','4X×3','1..2',null,undefined])
    assert.equal(parseIntentLabel(l),null,`${JSON.stringify(l)} must not parse`);
});
