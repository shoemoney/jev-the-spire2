import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeRun,splitRuns,blindness,hpLossCalibration,fatalDecisions,classifyWarning,COMBAT_STATES} from './metrics.mjs';

// Synthetic events only. These tests never touch the private run log, so they
// pass on a clean checkout with no recordings present.
const state=(hp,o={})=>({state_type:'monster',run:{act:o.act??1,floor:o.floor??1,ascension:o.ascension??0},player:{hp,max_hp:80,energy:o.energy??3,block:o.block??0},battle:{enemies:[{entity_id:'a',hp:40,intents:[]}]},...o.state});
const dec=(o={})=>({kind:'decision',outcome:o.outcome??'executed',time:'2026-01-01T00:00:00.000Z',state:state(o.hp??50,o),chosen:{id:'a0',label:o.label??'Strike',command:{action:o.action??'play_card'},forecast:o.forecast??{quality:'partial',hpLoss:0,survives:true,warnings:[]}}});
const end=(o={})=>({kind:'run_end',time:'2026-01-01T00:01:00.000Z',state:{state_type:'game_over',run:{act:o.act??1,floor:o.floor??9,ascension:o.ascension??7},player:{hp:o.hp??0}}});
const unknown=(warnings)=>({quality:'unknown',hpLoss:null,hpAfter:null,survives:null,incoming:null,warnings});

test('a run that ends above zero hp is a win and records where it stopped',()=>{
  const s=summarizeRun([dec({hp:80,floor:3}),dec({hp:64,floor:5,action:'end_turn'}),end({hp:41,act:2,floor:20,ascension:9})]);
  assert.equal(s.outcome,'win');assert.equal(s.runCount,1);assert.equal(s.finalAct,2);assert.equal(s.finalFloor,20);assert.equal(s.ascension,9);
  assert.equal(s.decisions,2);assert.equal(s.combatDecisions,2);assert.equal(s.roomsVisited,2);assert.equal(s.hpStart,80);assert.equal(s.hpEnd,41);assert.equal(s.hpLost,39);
  assert.deepEqual(s.deathsByFloor,[]);
});
test('a run that ends at zero hp is a death and pins the floor',()=>{
  const s=summarizeRun([dec({hp:80}),dec({hp:12,action:'end_turn'}),end({hp:0,floor:14,ascension:10})]);
  assert.equal(s.outcome,'death');assert.equal(s.finalFloor,14);assert.equal(s.ascension,10);
  assert.equal(s.hpStart,80);assert.equal(s.hpEnd,0);assert.equal(s.hpLost,80);
  assert.deepEqual(s.deathsByFloor,[{floor:14,state_type:'game_over',hp:0}]);
});
test('no run_end is unfinished, never a win, and never a loss of 0',()=>{
  const s=summarizeRun([dec({hp:80}),dec({hp:60,action:'end_turn'})]);
  assert.equal(s.outcome,'unfinished');assert.equal(s.closedByRunEnd,false);assert.equal(s.deathsByFloor.length,0);
  // The last observed floor is still known, and reporting it is not a claim of victory.
  assert.equal(s.finalFloor,1);assert.equal(s.hpEnd,60);assert.equal(s.hpLost,20);
  // hp at the end is simply unknown, so hpLost must be null rather than 0.
  const u=summarizeRun([dec({hp:80}),dec({state:state(undefined),action:'end_turn'})]);
  assert.equal(u.hpEnd,null);assert.equal(u.hpLost,null);
});
test('non-combat states do not count as rooms or combat decisions',()=>{
  const s=summarizeRun([dec({state:{state_type:'map'},hp:80}),dec({hp:80}),end({hp:70})]);
  assert.equal(s.roomsVisited,1);assert.equal(s.combatDecisions,1);assert.equal(s.decisions,2);assert.equal(s.floorsVisited,1);
});
test('one file may hold several runs, and the summary never hides the earlier ones',()=>{
  const events=[dec({hp:80,floor:2}),end({hp:0,floor:2,ascension:3}),dec({hp:80,floor:7}),end({hp:0,floor:7,ascension:3})];
  assert.equal(splitRuns(events).length,2);
  const s=summarizeRun(events);
  assert.equal(s.runCount,2);assert.equal(s.runs.length,2);
  assert.equal(s.runs[0].finalFloor,2);assert.equal(s.runs[1].finalFloor,7);
  // The top-level fields describe the last run, as the name says.
  assert.equal(s.finalFloor,7);assert.equal(s.outcome,'death');
});

test('unknown combat forecasts are classified by the cause each warning names',()=>{
  const events=[
    dec({forecast:unknown(['Unmodeled relic: Akabeko','Unmodeled player power: Vigor'])}),
    dec({forecast:unknown(['Some incoming attacks could not be parsed.'])}),
    dec({forecast:unknown(['Re-observe after Patter; full consequences are not modeled.'])}),
    dec({forecast:unknown(['Enemy death triggers remain unresolved: do not assume victory or survival.'])}),
    dec({forecast:{quality:'partial',hpLoss:0,survives:true,warnings:[]}}),
    dec({state:{state_type:'map'},forecast:unknown(['Unmodeled relic: Akabeko'])}),
  ];
  const b=blindness(events);
  assert.equal(b.combatDecisions,5);assert.equal(b.unknown,4);assert.equal(b.unknownRate,0.8);
  assert.equal(b.partial,1);assert.equal(b.calculated,0);assert.equal(b.qualityUnreported,0);
  assert.equal(b.byCause.unmodeledRelic,1);assert.equal(b.byCause.unmodeledPower,1);
  assert.equal(b.byCause.unparsedIncoming,1);assert.equal(b.byCause.unsupportedCard,1);assert.equal(b.byCause.other,1);
  // A decision attributed only to "other" counts as unexplained.
  assert.equal(b.unexplained,1);assert.equal(b.unmatchedWarnings,1);
  // A decision with two causes is counted under both, so the causes are not a partition.
  assert.equal(b.causeTotal,5);assert.equal(b.byCauseOverlaps,true);
  assert.equal(classifyWarning('Unmodeled enemy power: Skittish'),'unmodeledPower');
  assert.equal(classifyWarning('Retaliation timing or modifiers are unsupported for this action (including lethal, multi-hit, area or attack-triggered block interactions). Re-observe; survival is unknown.'),'unsupportedCard');
  assert.equal(classifyWarning('something nobody has seen before'),'other');
  assert.equal(classifyWarning(undefined),'other');
});
test('an unknown forecast with no recognised cause is reported, not smoothed away',()=>{
  const b=blindness([dec({forecast:unknown(['a warning no rule covers'])})]);
  assert.equal(b.unknown,1);assert.equal(b.byCause.other,1);assert.equal(b.unexplained,1);assert.equal(b.unmatchedWarnings,1);
  const none=blindness([dec({forecast:{quality:'unknown',hpLoss:null,warnings:[]}})]);
  assert.equal(none.byCause.other,0);assert.equal(none.unexplained,1);
});
test('blindness on a log with no combat reports an unknown rate, not zero',()=>{
  const b=blindness([dec({state:{state_type:'map'}}),end({hp:80})]);
  assert.equal(b.combatDecisions,0);assert.equal(b.unknown,0);assert.equal(b.unknownRate,null);
  assert.equal(blindness([]).unknownRate,null);
});

test('a prediction is scored against the next turn, so a known-wrong number is caught',()=>{
  // One room, two turns. Turn 1 ends with hp 50, the enemy lands 7, so both of
  // turn 1's predictions of 10 are wrong. Turn 2 predicts 3 and 3 land.
  const events=[
    dec({hp:50,forecast:{quality:'partial',hpLoss:10,survives:true,warnings:[]}}),
    dec({hp:50,action:'end_turn',forecast:{quality:'partial',hpLoss:10,survives:true,warnings:[]}}),
    dec({hp:43,energy:3,forecast:{quality:'partial',hpLoss:3,survives:true,warnings:[]}}),
    dec({hp:43,action:'end_turn',forecast:{quality:'partial',hpLoss:3,survives:true,warnings:[]}}),
    dec({hp:40,energy:3,forecast:{quality:'partial',hpLoss:3,survives:true,warnings:[]}}),
  ];
  const c=hpLossCalibration(events);
  assert.equal(c.scope,'turn');
  assert.equal(c.turn.scored,4);assert.equal(c.turn.exact,2);assert.equal(c.turn.wrong,2);
  assert.equal(c.turn.meanAbsoluteError,1.5);
  assert.equal(c.turn.meanSignedError,-1.5);
  assert.deepEqual(c.turn.byQuality.partial,{scored:4,exact:2,wrong:2});
  assert.equal(c.calculatedWrong,0);
  assert.deepEqual(c.turn.errors.map(e=>[e.predicted,e.actual,e.absError]),[[10,7,3],[10,7,3]]);
  // The other reading of "actual" disagrees, which is why the scope is explicit.
  assert.equal(c.step.scored,4);assert.equal(c.step.exact,1);assert.equal(c.step.wrong,3);assert.equal(c.step.meanAbsoluteError,4);
  const b=c.turn.buckets.find(x=>x.label==='10-19');
  assert.equal(b.count,2);assert.equal(b.exact,0);assert.equal(b.wrong,2);assert.equal(b.predicted,10);assert.equal(b.actual,7);assert.equal(b.meanAbsoluteError,3);
  assert.equal(c.turn.buckets.find(x=>x.label==='0'),undefined);
});
test('null predictions are counted apart from wrong ones, and never scored as zero',()=>{
  const P=hpLoss=>({quality:'partial',hpLoss,survives:true,warnings:[]});
  // Turn 1 predicts 10 and 7 lands. Turn 2's closing decision is unknown. Turn 2
  // then predicts 3 and 3 lands, and turn 3 predicts 0 and 0 lands.
  const events=[
    dec({hp:50,forecast:P(10)}),
    dec({hp:50,action:'end_turn',forecast:unknown(['Unmodeled relic: Lava Rock'])}),
    dec({hp:43,energy:3,forecast:P(3)}),
    dec({hp:43,action:'end_turn',forecast:P(3)}),
    dec({hp:40,energy:3,forecast:P(0)}),
    dec({hp:40,action:'end_turn',forecast:P(0)}),
    dec({hp:40,energy:3,forecast:P(0)}),
  ];
  const t=hpLossCalibration(events).turn;
  assert.equal(t.numericPredictions,6);
  assert.equal(t.unknownPredictions,1);
  assert.equal(t.unresolvableActual,1);
  assert.equal(t.scored,5);assert.equal(t.exact,4);assert.equal(t.wrong,1);
  assert.equal(t.meanAbsoluteError,0.6);
  assert.equal(t.buckets.find(x=>x.label==='0').count,2);
  assert.equal(t.buckets.find(x=>x.label==='0').exact,2);
  assert.equal(t.buckets.find(x=>x.label==='10-19').wrong,1);
  // The one null prediction is absent from every bucket, so it inflates neither side.
  assert.equal(t.buckets.reduce((s,b)=>s+b.count,0),5);
});
test('a forecast with no resolvable turn boundary is unresolvable, not wrong',()=>{
  // The room ends after this decision, so no actual exists to compare against.
  const t=hpLossCalibration([dec({hp:50,forecast:{quality:'partial',hpLoss:9,survives:true,warnings:[]}}),end({hp:50,floor:4})]).turn;
  assert.equal(t.numericPredictions,1);assert.equal(t.unresolvableActual,1);
  assert.equal(t.scored,0);assert.equal(t.wrong,0);assert.equal(t.meanAbsoluteError,null);assert.deepEqual(t.errors,[]);
  assert.equal(t.buckets.length,0);
});
test('a rejected decision is not treated as something that happened',()=>{
  const P=hpLoss=>({quality:'partial',hpLoss,survives:true,warnings:[]});
  const events=[
    dec({hp:50,outcome:'stale_rejected',forecast:P(99)}),
    dec({hp:50,action:'end_turn',forecast:P(6)}),
    dec({hp:44,energy:3,forecast:P(0)}),
  ];
  const t=hpLossCalibration(events).turn;
  // The rejected 99 never entered the executed chain, so it is never scored.
  assert.equal(t.numericPredictions,2);assert.equal(t.scored,1);assert.equal(t.exact,1);assert.equal(t.wrong,0);
  assert.deepEqual(t.buckets.map(b=>[b.label,b.count,b.exact]),[['5-9',1,1]]);
});
test('calibration separates the confidence tiers so a confident wrong number stands out',()=>{
  const wrong={quality:'calculated',hpLoss:10,survives:true,warnings:[]};
  const t=hpLossCalibration([
    dec({hp:50,forecast:wrong}),dec({hp:50,action:'end_turn',forecast:wrong}),
    dec({hp:44,energy:3,forecast:wrong}),dec({hp:44,action:'end_turn',forecast:wrong}),
    dec({hp:42,energy:3,forecast:wrong}),
  ]).turn;
  assert.equal(t.scored,4);assert.equal(t.wrong,4);
  assert.deepEqual(t.byQuality.calculated,{scored:4,exact:0,wrong:4});
  assert.equal(hpLossCalibration([
    dec({hp:50,forecast:wrong}),dec({hp:50,action:'end_turn',forecast:wrong}),
    dec({hp:44,energy:3,forecast:wrong}),dec({hp:44,action:'end_turn',forecast:wrong}),
    dec({hp:42,energy:3,forecast:wrong}),
  ]).calculatedWrong,4);
});

test('fatal decisions are the window before each death and say how blind it was',()=>{
  const events=[
    dec({hp:50,floor:2,forecast:{quality:'partial',hpLoss:4,survives:true,warnings:[]}}),
    dec({hp:46,floor:2,action:'end_turn',forecast:{quality:'partial',hpLoss:4,survives:true,warnings:[]}}),
    dec({hp:42,floor:3,action:'end_turn',forecast:unknown(['Unmodeled relic: Lava Rock'])}),
    dec({hp:42,floor:3,action:'end_turn',forecast:unknown(['Some incoming attacks could not be parsed.','Unmodeled relic: Lava Rock'])}),
    dec({hp:30,floor:3,action:'end_turn',forecast:unknown(['Unmodeled enemy power: Skittish'])}),
    dec({hp:30,floor:3,action:'end_turn',forecast:unknown(['Unmodeled relic: Lava Rock'])}),
    dec({hp:12,floor:3,action:'end_turn',forecast:unknown(['Unmodeled relic: Lava Rock'])}),
    end({hp:0,floor:3,ascension:10}),
  ];
  const [d]=fatalDecisions(events);
  assert.equal(d.act,1);assert.equal(d.floor,3);assert.equal(d.ascension,10);assert.equal(d.hpAtDeath,0);
  assert.equal(d.decisions.length,5);
  assert.equal(d.decisions.at(-1).label,'Strike');
  assert.equal(d.decisions.at(-1).quality,'unknown');
  assert.equal(d.unknown,5);assert.equal(d.partial,0);assert.equal(d.calculated,0);
  assert.equal(d.anyUnknown,true);assert.equal(d.anyLowConfidence,true);
  assert.equal(d.decisions[0].position,1);
  assert.equal(d.decisions[0].room,'1:3:monster');
  assert.deepEqual(d.decisions[0].warnings,['Unmodeled relic: Lava Rock']);
  // A null prediction is reported as null, not as 0.
  assert.equal(d.decisions[0].predictedHpLoss,null);assert.equal(d.decisions[0].predictedSurvives,null);
  // A non-combat decision inside the window keeps its state_type instead of a fake room,
  // and a map decision really does carry no forecast, so its quality is unknown, not partial.
  const map={kind:'decision',outcome:'executed',state:{state_type:'map',run:{act:1,floor:3,ascension:0},player:{hp:12}},chosen:{command:{action:'choose_map_node'},label:'Travel'}};
  const withMap=fatalDecisions([...events.slice(0,7),map,...events.slice(7)])[0];
  assert.equal(withMap.decisions.at(-1).state_type,'map');assert.equal(withMap.decisions.at(-1).room,null);
  assert.equal(withMap.decisions.at(-1).quality,null);assert.equal(withMap.decisions.at(-1).predictedHpLoss,null);assert.equal(withMap.unreported,1);
});
test('a shorter window and a death the agent saw coming both report honestly',()=>{
  const events=[
    dec({hp:50,floor:3,action:'end_turn',forecast:{quality:'partial',hpLoss:14,survives:false,warnings:['Unmodeled player power: Royalties']}}),
    dec({hp:50,floor:3,action:'end_turn',forecast:{quality:'partial',hpLoss:14,survives:false,warnings:['Unmodeled player power: Royalties']}}),
    end({hp:0,floor:3,ascension:3}),
  ];
  const [d]=fatalDecisions(events,1);
  assert.equal(d.decisions.length,1);
  assert.equal(d.unknown,0);assert.equal(d.partial,1);assert.equal(d.anyUnknown,false);
  assert.equal(d.anyLowConfidence,true);
  assert.equal(d.decisions[0].predictedHpLoss,14);assert.equal(d.decisions[0].predictedSurvives,false);
  assert.equal(fatalDecisions([dec({hp:50})]).length,0);
  assert.equal(fatalDecisions([]).length,0);
  assert.equal(fatalDecisions(null).length,0);
});
test('combat state types are the ones the game uses for a fight',()=>{
  assert.deepEqual([...COMBAT_STATES].sort(),['boss','elite','monster']);
  for (const t of ['map','event','shop','rest_site','treasure','card_reward','hand_select','card_select','game_over'])
    assert.equal(COMBAT_STATES.has(t),false);
});
test('no metric invents a number where the log recorded none',()=>{
  const events=[dec({hp:50,forecast:{quality:'calculated',hpLoss:0,survives:true,warnings:[]}}),end({hp:0,floor:2})];
  const s=summarizeRun(events);assert.equal(s.hpLost,50);
  const b=blindness(events);assert.equal(b.unknown,0);assert.equal(b.unknownRate,0);
  const t=hpLossCalibration(events).turn;
  assert.equal(t.numericPredictions,1);assert.equal(t.unresolvableActual,1);
  assert.equal(t.meanAbsoluteError,null);assert.equal(t.meanSignedError,null);
  assert.equal(fatalDecisions([])[0],undefined);
});
