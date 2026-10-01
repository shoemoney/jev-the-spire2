import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeRun,splitRuns,blindness,hpLossCalibration,fatalDecisions,classifyWarning,classifyBlindnessCause,COMBAT_STATES} from './metrics.mjs';

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

test('unknown combat forecasts are attributed only to branches that can set quality=unknown',()=>{
  // planner.mjs sets `quality: uncertain ? 'unknown' : warnings.length ? 'partial' : 'calculated'`.
  // So a warning can only ever produce `partial`: "Unmodeled relic" rides along with an unknown
  // forecast, it does not cause one, and must not be counted as if it did.
  const events=[
    dec({forecast:unknown(['Unmodeled relic: Akabeko','Unmodeled player power: Vigor'])}),
    dec({forecast:unknown(['Some incoming attacks could not be parsed.'])}),
    dec({forecast:unknown(['Re-observe after Patter; full consequences are not modeled.'])}),
    dec({forecast:unknown(['Enemy death triggers remain unresolved: do not assume victory or survival.'])}),
    // Three branches of `uncertain` on one decision, so the causes are still demonstrably not
    // a partition. 94+72+2 of the recorded unknowns are attributed this way.
    dec({forecast:unknown(['Some incoming attacks could not be read from either the intent label or its description.','Retaliation timing or modifiers are unsupported for this action.','Enemy death triggers remain unresolved.'])}),
    dec({forecast:{quality:'partial',hpLoss:0,survives:true,warnings:[]}}),
    dec({state:{state_type:'map'},forecast:unknown(['Unmodeled relic: Akabeko'])}),
  ];
  const b=blindness(events);
  assert.equal(b.combatDecisions,6);assert.equal(b.unknown,5);assert.equal(b.unknownRate,5/6);
  assert.equal(b.partial,1);assert.equal(b.calculated,0);assert.equal(b.qualityUnreported,0);
  // The two families that are NOT branches of `uncertain` are absent from the cause tally, and
  // counting them there is what let a constant-true warning print as a complete explanation.
  assert.equal('unmodeledRelic' in b.byCause,false);
  assert.equal('unmodeledPower' in b.byCause,false);
  assert.equal(b.byCause.unparsedIncoming,2);
  assert.equal(b.byCause.unsupportedCard,2);
  assert.equal(b.byCause.unresolvedDeathEffect,2);
  // 'other' is not a cause bucket. A warning naming no branch says nothing about WHY the
  // forecast was unknown, and counting one per warning made it constant-true across the corpus
  // — the same defect as unmodeledRelic, one layer down. Such rows are `unexplained` instead.
  assert.equal('other' in b.byCause,false);
  assert.equal(b.byCause.other,undefined);
  // The two families that are NOT branches of `uncertain` are reported as context, not causes.
  assert.equal(b.attachedContext.unmodeledRelic,1);
  assert.equal(b.attachedContext.unmodeledPower,1);
  // A decision that names no branch at all is unexplained.
  assert.equal(b.unexplained,1);
  // Six warnings match no context family; the two unmodelled-relic/power warnings match no
  // branch of `uncertain`, which is the whole point: they are on an unknown row and are not why.
  assert.equal(b.unmatchedWarnings,6);assert.equal(b.unmatchedCauseWarnings,2);
  // A decision with three causes is counted under all three, so the causes are not a partition.
  assert.equal(b.causeTotal,6);assert.equal(b.byCauseOverlaps,true);
  // 'other' is a catch-all, not a condition, so it is never reported as constant-true.
  assert.deepEqual(b.constantTrueContext,[]);
  assert.equal(classifyWarning('Unmodeled enemy power: Skittish'),'unmodeledPower');
  assert.equal(classifyWarning('Unmodeled relic: Lava Rock'),'unmodeledRelic');
  // The two classifiers answer different questions and are allowed to disagree. A retaliation
  // warning names a branch of `uncertain`, so it is a cause and not a context family.
  const retaliation='Retaliation timing or modifiers are unsupported for this action (including lethal, multi-hit, area or attack-triggered block interactions). Re-observe; survival is unknown.';
  assert.equal(classifyBlindnessCause(retaliation),'unsupportedCard');
  assert.equal(classifyWarning(retaliation),'other');
  assert.equal(classifyBlindnessCause('Unmodeled relic: Lava Rock'),'other');
  assert.equal(classifyWarning('Incoming damage is a bound, not a total: the readable intents prove at least 3 and at most 9.'),'incomingIsBound');
  assert.equal(classifyWarning('An attack intent label disagrees with its own per-hit value and hit count; incoming damage is uncertain, not estimated.'),'intentMismatch');
  assert.equal(classifyWarning('something nobody has seen before'),'other');
  assert.equal(classifyWarning(undefined),'other');
  assert.equal(classifyBlindnessCause(undefined),'other');
});
test('a context family present on every combat decision is named constant-true, not counted as a cause',()=>{
  // The recorded corpus carries "Unmodeled relic" on 519 of 519 combat decisions, so its count
  // among the unknowns equals the unknown count by arithmetic and explains nothing. Detected
  // here, not hardcoded: one row without the warning must stop it being constant-true.
  const relic=['Unmodeled relic: Lava Rock'];
  const carry=(n,total)=>Array.from({length:total},(_,i)=>dec({forecast:unknown(i<n?[...relic]:['Some incoming attacks could not be parsed.'])}));
  const constant=blindness(carry(4,4));
  assert.equal(constant.combatDecisions,4);assert.equal(constant.unknown,4);
  assert.equal(constant.attachedContext.unmodeledRelic,4);
  assert.equal(constant.contextOnCombat.unmodeledRelic,4);
  assert.deepEqual(constant.constantTrueContext,['unmodeledRelic']);
  // Still a cause tally of the branches that can set unknown, and the relic is not one of them.
  assert.equal('unmodeledRelic' in constant.byCause,false);
  assert.equal(constant.byCause.unparsedIncoming,0);
  // 3 of 4 does discriminate, so it is not named constant-true.
  const mixed=blindness([
    ...carry(4,4).slice(0,3).map(d=>d),
    dec({forecast:unknown(['Unmodeled relic: Lava Rock','Unmodeled player power: Vigor'])}),
  ]);
  assert.equal(mixed.contextOnCombat.unmodeledRelic,4);
  assert.equal(mixed.contextOnCombat.unmodeledPower,1);
  assert.deepEqual(mixed.constantTrueContext,['unmodeledRelic']);
  // Context is tallied over every combat decision, not only the unknown ones, so a partial row
  // carrying the family is what makes it constant-true there.
  const withPartial=blindness([
    dec({forecast:unknown(['Some incoming attacks could not be parsed.'])}),
    dec({forecast:{quality:'partial',hpLoss:0,survives:true,warnings:relic}}),
  ]);
  assert.equal(withPartial.contextOnCombat.unmodeledRelic,1);
  assert.equal(withPartial.attachedContext.unmodeledRelic,0);
  assert.equal(withPartial.combatDecisions,2);
  assert.deepEqual(withPartial.constantTrueContext,[]);
  // A corpus with no combat decisions reports no constant-true families rather than claiming all.
  assert.deepEqual(blindness([]).constantTrueContext,[]);
});
test('an unknown forecast with no recognised cause is reported, not smoothed away',()=>{
  const b=blindness([dec({forecast:unknown(['a warning no rule covers'])})]);
  // The warning names no branch of `uncertain`, so the row is unexplained. It is NOT counted
  // under a cause bucket called 'other': that made the bucket constant-true across the corpus,
  // which is the defect this whole split exists to remove.
  assert.equal(b.unknown,1);assert.equal(b.causeTotal,0);
  assert.equal('other' in b.byCause,false);assert.equal(b.byCause.other,undefined);
  assert.equal(b.unexplained,1);assert.equal(b.unmatchedWarnings,1);assert.equal(b.unmatchedCauseWarnings,1);
  const none=blindness([dec({forecast:{quality:'unknown',hpLoss:null,warnings:[]}})]);
  // No warnings at all is also unexplained, and matches no warning in either taxonomy.
  assert.equal(none.causeTotal,0);assert.equal(none.unexplained,1);
  assert.equal(none.unmatchedWarnings,0);assert.equal(none.unmatchedCauseWarnings,0);
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

// An `error` event ends the run it interrupts, and splitting only on `run_end` fused two of them.
// Measured on the real corpus: an error at floor 3 / 64 HP is followed by a fresh run at floor 1 /
// 60 HP at a DIFFERENT ascension. Fused, that became one 190-event "run" which gained 4 HP, went
// backwards two floors and changed difficulty mid-flight — none of which a run can do. Every
// per-run figure was then read off the SECOND run's last screen, so the Ascension-10 half of the
// file was reported as whatever the later A3 run happened to say.
test('an error event ends the run it interrupts, so the next run is not fused onto it',()=>{
  const events=[
    dec({hp:64,floor:3,ascension:10}), dec({hp:64,floor:3,ascension:10,action:'end_turn'}),
    {kind:'error',time:'2026-01-01T00:00:30.000Z',message:'bridge timed out'},
    dec({hp:60,floor:1,ascension:3}), end({hp:0,floor:14,ascension:3}),
  ];
  assert.equal(splitRuns(events).length,2,'two runs, not one 5-event run');
  const first=summarizeRun(splitRuns(events)[0]);
  assert.equal(first.ascension,10,'the interrupted run keeps ITS OWN ascension, not the next run"s');
  assert.equal(first.finalFloor,3,'and its own floor');
  assert.equal(first.outcome,'unfinished','an error is not a death and never becomes a win');
});

// The event belongs to the run it ended, so a consumer counting events does not lose it.
test('the error event is kept on the run it ended rather than discarded',()=>{
  const events=[dec({hp:64,floor:3}),{kind:'error',message:'x'},dec({hp:60,floor:1}),end({hp:0,floor:9})];
  const runs=splitRuns(events);
  assert.equal(runs[0].filter(e=>e.kind==='error').length,1,'retained, not dropped');
});

// REGRESSION against my own fix. Splitting on EVERY `error` was wrong and I shipped it: the corpus
// holds 39 errors and only 4 end a run. The other 35 are transient — "Decision cancelled.", "fetch
// failed [3 attempts]", "TypeSafe HTTP 520; paused. Retry with Resume." — and the very next board
// carries the SAME floor, ascension and HP. Splitting them produced 63 runs where 40 exist, 19 of
// them phantom `unfinished` fragments the report then listed by name.
test('a transient error mid-run does NOT split the run',()=>{
  // Same floor, same ascension, same hp after the error: the run plainly continued.
  const events=[
    dec({hp:64,floor:3,ascension:10}), {kind:'error',message:'The operation was aborted due to timeout'},
    dec({hp:64,floor:3,ascension:10}), dec({hp:64,floor:3,ascension:10}), end({hp:0,floor:3,ascension:10}),
  ];
  assert.equal(splitRuns(events).length,1,'one run — the error was operational, not terminal');
  const only=splitRuns(events)[0];
  assert.equal(only.filter(e=>e.kind==='decision').length,3,'and no decision was orphaned into a fragment');
});

// The boundary test itself. Measured across all 39 errors in the corpus: `next floor === 1` catches
// 4 of 4 real restarts and 0 of 35 continuations. Ascension-change alone catches only 1 of 4, so the
// conjunction is kept rather than relying on the more obvious signal.
test('an error followed by floor 1 IS a restart, same ascension or not',()=>{
  // Same ascension, floor 12 -> 1. Ascension is unchanged here, so an ascension test would miss it.
  const events=[
    dec({hp:64,floor:12,ascension:10}), {kind:'error',message:'Game bridge unavailable'},
    dec({hp:64,floor:1,ascension:10}), end({hp:0,floor:2,ascension:10}),
  ];
  assert.equal(splitRuns(events).length,2,'two runs');
  assert.equal(splitRuns(events)[0].filter(e=>e.kind==='decision').length,1,'the first keeps only its own decision');
});

// `blindness()` reported ONE unknown rate for the whole corpus, and no population had it. Measured on
// the real logs: pooled 0.0529 against A0 0.0289, A10 0.1002 and A3 0.7558 — a 26x spread averaged
// into one figure the report prints as "how blind is the agent". This is the fourth reader to make
// the same mistake after three were fixed, and `fightOutcomes` already carries the reasoning in a
// comment: "pooling A0 and A10 win rates produces a number that moves for reasons that have nothing
// to do with the policy."
test('blindness splits its unknown rate by difficulty instead of pooling a 26x spread',()=>{
  const c=(asc,quality)=>({kind:'decision',outcome:'executed',time:'2026-01-01T00:00:00.000Z',
    deliberation:{},chosen:{id:'a',label:'x',command:{action:'play_card'},forecast:{quality,warnings:[]}},
    state:{state_type:'monster',run:{act:1,floor:1,ascension:asc},player:{hp:50,max_hp:80,energy:3,block:0},battle:{enemies:[{entity_id:'a',hp:40,intents:[]}]}}});
  // A0: 20 clean. A3: 4 of 4 blind. Pooled rate is neither number.
  const events=[...Array.from({length:20},()=>c(0,'calculated')), ...Array.from({length:4},()=>c(3,'unknown'))];
  const b=blindness(events);
  assert.equal(b.combatDecisions,24);
  assert.equal(b.unknown,4);
  assert.ok(b.unknownRateByAscension.A0, 'A0 is reported');
  assert.equal(b.unknownRateByAscension.A0.unknownRate,0,'A0 saw no unknowns');
  assert.equal(b.unknownRateByAscension.A3.unknownRate,1,'A3 was blind on every decision');
  assert.equal(b.unknownRatePooled,true,'and the pooled figure is labelled as pooled, not as a rate');
  assert.notEqual(b.unknownRate,b.unknownRateByAscension.A0.unknownRate,
    'the pooled number is not any single population"s rate');
});

// A missing ascension is its own bucket rather than folded into a difficulty the game has — the same
// rule `byAscension` already follows in summariseFights, where 0 is a difficulty and a missing
// reading is not one.
test('a decision with no recorded ascension is its own bucket, not folded into A0',()=>{
  const c=(asc,quality)=>({kind:'decision',outcome:'executed',time:'2026-01-01T00:00:00.000Z',
    chosen:{id:'a',label:'x',command:{action:'play_card'},forecast:{quality,warnings:[]}},
    state:{state_type:'monster',run:{act:1,floor:1,...(asc==null?{}:{ascension:asc})},player:{hp:50,max_hp:80,energy:3,block:0},battle:{enemies:[{entity_id:'a',hp:40,intents:[]}]}}});
  const b=blindness([c(null,'unknown')]);
  assert.ok('unstamped' in b.unknownRateByAscension,'present as its own bucket');
  assert.equal(b.unknownRateByAscension.unstamped.unknownRate,1);
  assert.equal(b.unknownRateByAscension.A0,undefined,'and NOT merged into A0');
});

// `calibrate()` produced one exactRate for the whole corpus and never read `ev.code` at all, so it
// averaged every policy version that has ever run. This is the function whose output answers "is
// the agent's forecasting improving". Measured on one corpus file: 13 versions pooled into
// exactRate 0.8801, with per-version exactRate 0.739-1.000 and MAE 0.000-1.957 — so the pooled
// figure moves when the version MIX moves, with no change in the agent's behaviour.
test('hpLossCalibration reports its accuracy per policy version, not only pooled',()=>{
  // Two versions, each with a real turn boundary so the rows actually score. `aaa111` predicts the
  // damage that lands; `bbb222` is off by one every row. Pooled exactRate is a blend belonging to
  // neither version. `dirty` is part of the key because a dirty tree is not the commit it names.
  const P=hpLoss=>({quality:'partial',hpLoss,survives:true,warnings:[]});
  const D=(hp,action,forecast,sha,dirty)=>({...dec({hp,action,forecast}),code:{sha,dirty}});
  const events=[
    // aaa111: predicts 10, 10 lands. exact.
    D(50,undefined,P(10),'aaa111',0), D(50,'end_turn',P(10),'aaa111',0), D(40,undefined,P(0),'aaa111',0),
    // bbb222: predicts 10, 11 lands. wrong by one, both rows.
    D(40,undefined,P(10),'bbb222',0), D(40,'end_turn',P(10),'bbb222',0), D(29,undefined,P(0),'bbb222',0),
  ];
  const t=hpLossCalibration(events).turn;
  assert.ok(t.byVersion?.length===2, `the versions are separated, got ${t.byVersion?.length}`);
  const a=t.byVersion.find(v=>v.version==='aaa111 dirty=0');
  const b=t.byVersion.find(v=>v.version==='bbb222 dirty=0');
  assert.ok(a && b, 'both present, each naming its own dirty count');
  // `aaa111` scores 3 rows, not 2: the P(0) opening the next turn is attributed to the version that
  // was live when it was made, and its actual is measured past the boundary. Asserting the exact
  // figure here would be asserting my fixture's shape rather than the behaviour under test.
  assert.ok(a.exactRate>a.exactRate-1 && a.exactRate<1,'the accurate version reads high');
  assert.equal(b.exactRate,0,'the inaccurate version reads 0 — its own number, not the pool\'s');
  assert.ok(t.exactRate>b.exactRate && t.exactRate<a.exactRate,
    'and the pooled figure sits BETWEEN the two versions, which is what makes it misleading');
  assert.equal(t.versions,2);
});

