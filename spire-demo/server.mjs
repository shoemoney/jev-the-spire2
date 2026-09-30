import {facingState} from './facing.mjs';
import {selectionState} from './selections.mjs';
import {encounterBrief,encounterMemory} from './encounters.mjs';
import http from 'node:http';
import {rewardState} from './rewards.mjs';
import {deliberate, resolvePolicy, policyStamp} from './deliberation.mjs';
import {planBenefitDeliberate,persistentPlan} from './plan-benefit.mjs';
const planBenefitEnabled=process.env.SPIRE_PLAN_BENEFIT==='1';
import {assistedDeliberate} from './experiment/assisted.mjs';
const lunaEnabled=process.env.SPIRE_ADVISER==='luna';
import {factoredDeliberate} from './factored.mjs';
const factoredEnabled=process.env.SPIRE_SINGLE_CALL==='1';
import {betterDeliberate} from './better-policy.mjs';
const betterPolicyEnabled=process.env.SPIRE_BETTER_POLICY==='1';
import {recallingDeliberate} from './learning/wire.mjs';
import {loadMemory, saveMemory, ingestLog, pruneStore, summarizeStore} from './learning/memory.mjs';
const recallEnabled=process.env.SPIRE_RECALL==='1';
// The chain the ternary in step() selects from, keyed by name. The order still lives in that
// ternary, untouched, because it is the shipped truth - this map only names what it picks, and
// default-policy.test.mjs evaluates the ternary itself over all 32 flag combinations to prove the
// two agree. Without a name, a decision log records a `policy` constant (POLICY_VERSION, a planner
// version string) and nothing at all about which guard produced the choice.
const POLICY_CHAIN={recall:recallingDeliberate,better:betterDeliberate,factored:factoredDeliberate,assisted:assistedDeliberate,planBenefit:planBenefitDeliberate,deliberate};
const resolvedPolicy=resolvePolicy(process.env,POLICY_CHAIN);
import {hedged} from './hedge.mjs';
const hedgeEnabled=process.env.SPIRE_HEDGE!=='0';
if(lunaEnabled&&planBenefitEnabled)throw Error('Choose one experiment at a time: Luna or plan-benefit.');
import { readFile, mkdir, appendFile, writeFile, rename } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
const execFile = promisify(execFileCb);
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { actionsFor, fingerprint, factsFor } from './actions.mjs';
import {rawFactors} from './learning/factor-log.mjs';
import {observeTurn, attrition} from './learning/attrition.mjs';
import { decisionCandidates, decisionQuestion, POLICY_VERSION } from './planner.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4317);
const bridge = 'http://127.0.0.1:15526';
const logDir = resolve(root, '../.private/spire-runs');
await mkdir(logDir, { recursive: true, mode: 0o700 });
let apiKey = process.env.TYPESAFE_API_KEY;
if (!apiKey) {
  const config = await readFile(resolve(root, '../.private/typesafe.cfg'), 'utf8').catch(() => '');
  apiKey = config.match(/^api_key\s*=\s*"?([^"\r\n]+)"?/m)?.[1]?.trim();
}
const snapshotFile = resolve(logDir, 'session.json');
const saved = JSON.parse(await readFile(snapshotFile, 'utf8').catch(() => 'null'));
const sessionId = saved?.sessionId ?? new Date().toISOString().replaceAll(':', '-');
const logFile = resolve(logDir, `${sessionId}.jsonl`);
// Cross-run memory. A missing or unreadable file is a normal first run: loadMemory hands back a clean store
// and says why, so the server still boots and no lesson is invented. Only loaded when the flag is on, so
// leaving SPIRE_RECALL unset behaves exactly as before - no read, no write, no file.
const memoryPath = resolve(root, '../.private/learning/memory.json');
const memoryLoad = recallEnabled ? loadMemory(memoryPath) : null;
let memoryStore = memoryLoad?.store ?? null;
if (memoryLoad && memoryLoad.status !== 'loaded') console.log(`Memory: ${memoryLoad.status} - ${memoryLoad.note}`);
const MAX_DECISIONS = Number(process.env.MAX_DECISIONS ?? 2000);
const MAX_INPUT_TOKENS = Number(process.env.MAX_INPUT_TOKENS ?? 10000000);
const view = {
  mode: 'paused', connected: false, configured: Boolean(apiKey), state: null,
  decisions: 0, actions: 0, inputTokens: 0, latencyMs: 0, model: null,
  message: 'Ready. Start a normal singleplayer run in the game, then press Autoplay.',
  events: [], sessionId, maxDecisions: MAX_DECISIONS, maxInputTokens: MAX_INPUT_TOKENS,
};
// A restart is how you get ANOTHER session — the budget message says so — so a restart must not
// carry the spent budget across with it. It did: the restore copied `decisions` and `inputTokens`
// out of the snapshot while re-raising the limits, so a server started after hitting the cap came
// straight back up already over it, paused, with "restart the server" as the only offered remedy.
// An instruction that cannot be followed is a bug, and it stops the loop silently: the agent just
// stops deciding and the log stops growing, which looks exactly like a game that has gone quiet.
//
// What survives a restart is the FIGHT context (so a mid-fight restart does not lose the attrition
// accumulator) and the on-disk memory, which is loaded separately. What does not survive is the
// meter.
if (saved) Object.assign(view, saved, {
  mode: 'paused', connected: false, configured: Boolean(apiKey),
  maxDecisions: MAX_DECISIONS, maxInputTokens: MAX_INPUT_TOKENS,
  decisions: 0, inputTokens: 0,
  message: 'Session restored. Press Autoplay to resume.',
});
view.planBenefitEnabled=planBenefitEnabled;
view.betterPolicyEnabled=betterPolicyEnabled;
view.recallEnabled=recallEnabled;
// Surfaced in /api/status and the sidecar so an ungated configuration is visible before the first
// decision is paid for, not discoverable afterwards in a log nobody reads.
view.activePolicy=resolvedPolicy;
view.memory=memoryStore?summarizeStore(memoryStore):null;
view.adviser=lunaEnabled?'gpt-5.6-luna:max':null;
let generation = 0, busy = false, lastExecuted = '', latestState = null, waitingSince = 0, nextDecisionAt = 0;

// WHICH CODE wrote this run. The log accumulated across dozens of iterations of this codebase, so
// "the corpus" is a mix of versions and nothing in the records said so. That cost a whole
// investigation: 94 "incoming attacks could not be parsed" warnings looked like a live bug until
// they were dated, and every one was from a parser fixed days earlier. A log entry that does not
// name its own code version is a log entry that can be misread forever.
//
// `dirty` matters as much as the sha. A run recorded on a commit with uncommitted edits cannot be
// reproduced from that commit, so the flag is recorded rather than smoothed over — a dirty run is
// honestly labelled as unreproducible instead of quietly attributed to HEAD.
const codeStamp = await (async () => {
  const head = (await execFile('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).catch(() => ({ stdout: '' }))).stdout.trim() || null;
  const dirty = head ? (await execFile('git', ['status', '--porcelain'], { cwd: root }).catch(() => ({ stdout: '' }))).stdout.trim().split('\n').filter(Boolean).length : null;
  return { sha: head, dirty: dirty && dirty > 0 ? dirty : 0 };
})();
view.code = codeStamp;
async function log(event) {
  const entry = { time: new Date().toISOString(), code: codeStamp, ...event };
  view.events.unshift(entry); view.events.length = Math.min(view.events.length, 60);
  await appendFile(logFile, JSON.stringify(entry) + '\n', { mode: 0o600 });
  await writeFile(snapshotFile + '.tmp', JSON.stringify(view), { mode: 0o600 });
  await rename(snapshotFile + '.tmp', snapshotFile);
}
// Fold this run back into the cross-run store so the next run starts from it. The session log already holds
// every decision of the run and its run_end line is written before this is called, so the file parses into
// this run's own records. Re-reading a run that is already stored deduplicates by run id and by evidence, so
// a second run_end in one session cannot inflate a confirmation count. A failure here is reported and
// swallowed: losing a run's lessons is recoverable, ending the run over it is not.
async function learnFromThisRun() {
  if (!memoryStore) return;
  try {
    const learned = ingestLog(memoryStore, await readFile(logFile, 'utf8'));
    const pruned = pruneStore(memoryStore);
    const saved = saveMemory(memoryStore, memoryPath);
    view.memory = summarizeStore(memoryStore);
    view.message = `Run learned from: ${learned.runs} run(s) read, ${learned.added} new lesson(s), ${learned.deduplicated} already known.`;
    await log({ kind: 'learned', runs: learned.runs, lessonsAdded: learned.added, lessonsDeduplicated: learned.deduplicated, refused: learned.refused, dropped: pruned.dropped, bytes: saved.bytes, path: memoryPath });
  } catch (error) {
    view.message = `Run ended, but learning from it failed: ${error.message}`;
    await log({ kind: 'learn_error', message: error.message });
  }
}
async function gameRequest(path = '/api/v1/singleplayer', command) {
  const response = await fetch(bridge + path, {
    method: command ? 'POST' : 'GET',
    headers: command ? { 'Content-Type': 'application/json' } : {},
    body: command ? JSON.stringify(command) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json();
  if (!response.ok || data.error || data.status === 'error') throw new Error(data.error ?? data.message ?? `Game HTTP ${response.status}`);
  return data;
}
function stop(message) { generation++; view.mode = 'paused'; view.message = message; }
function sidecarView(source = view) {
  const decisions = source.events.filter(e => e.kind === 'decision' && ['executed', 'preview'].includes(e.outcome));
  const compact = e => {
    const candidates = e.candidates ?? actionsFor(e.state);
    return {
      memory:e.memory??null, encounter:encounterBrief(e.state), deliberation:e.deliberation ?? null, time: e.time, label: e.chosen.plan?.[0]?.label ?? e.chosen.label, plan: e.chosen.plan ?? null, forecast: e.chosen.forecast ?? null, policy: e.policy ?? "jev-actions-v1", policyName: e.policyName ?? null, gate: e.gate ?? null, description: e.chosen.details?.description ?? e.chosen.details?.card_description ?? '',
      action: e.chosen.command.action, confidence: e.answer.confidence, latencyMs: e.latencyMs,
      outcome: e.outcome, floor: e.state.run?.floor, facts: factsFor(e.state),
      options: Object.entries(e.answer.probabilities ?? {}).map(([id, probability]) => ({
        id, probability, label: candidates.find(a => a.id === id)?.label ?? id, plan: candidates.find(a => a.id === id)?.plan ?? null, forecast: candidates.find(a => a.id === id)?.forecast ?? null, chosen: id === e.answer.choice,
      })).sort((a,b) => b.probability - a.probability),
    };
  };
  const compactDecisions = decisions.map(compact);
  return { adviser:source.adviser, review: source.review ?? null, policy: POLICY_VERSION, activePolicy: source.activePolicy ?? null, betterPolicyEnabled:source.betterPolicyEnabled, mode: source.mode, message: source.message, connected: source.connected, pending: source.pending ?? null,
    model: source.model, actions: source.actions, inputTokens: source.inputTokens, run: source.state?.run,
    player: source.state?.player ? { hp: source.state.player.hp, maxHp: source.state.player.max_hp, energy: source.state.player.energy, block: source.state.player.block } : null,
    room: source.state?.state_type, decisions: compactDecisions.slice(0, 8), spotlight: compactDecisions.find(e => e.options.length > 1) ?? compactDecisions[0] ?? null };
}
async function observe() {
  const s = selectionState(await gameRequest(),view.events);
  latestState = s; view.state = s; view.connected = true;
  return s;
}
async function step(token, preview = false) {
  if (busy || Date.now() < nextDecisionAt) return;
  busy = true;
  try {
    const s = await observe();
    if (s.state_type === 'game_over') {
      stop(s.player?.hp <= 0 ? 'Run ended in defeat.' : 'Run ended. Verify the result in the game.');
      await log({ kind: 'run_end', state: s }); await learnFromThisRun(); return;
    }
    // The bridge briefly reports unknown while entering a room or opening a selection.
    // Poll without issuing mutations, but retain a bounded stop for genuinely stuck screens.
    if (s.state_type === 'unknown') {
      waitingSince ||= Date.now();
      if (Date.now() - waitingSince > 45000) stop('Unknown screen persisted for 45 seconds. Check the game, then resume.');
      else view.message = 'Waiting for the room transition to finish…';
      return;
    }
    if (['menu', 'overlay'].includes(s.state_type)) {
      stop(`Waiting at ${s.state_type}. Resolve this screen in the game, then resume.`); return;
    }
    const planningState=facingState(s,view.events);
    const actions = decisionCandidates(rewardState(planningState,view.events));
    if (!actions.length) {
      waitingSince ||= Date.now();
      if (Date.now() - waitingSince > 45000) stop('No playable actions for 45 seconds. Check the game screen, then resume.');
      else view.message = 'Waiting for the next playable state…';
      return;
    }
    const hash = fingerprint(s);
    if (hash === lastExecuted) {
      waitingSince ||= Date.now();
      if (Date.now() - waitingSince > 45000) stop('The game did not change after the last action. Check the screen before resuming.');
      else view.message = 'Waiting for the game to finish the last action…';
      return;
    }
    waitingSince = 0;
    // Card effects update energy, piles and hand at different animation frames.
    // Require a quiet observation interval before paying for a new decision.
    await new Promise(resolve => setTimeout(resolve, 700));
    if (token !== generation) return;
    if (fingerprint(await observe()) !== hash) { view.message = 'Waiting for animations to settle…'; return; }
    if (view.decisions >= MAX_DECISIONS || view.inputTokens >= MAX_INPUT_TOKENS) {
      stop('Session budget reached. Restart the server to begin another session.'); return;
    }
    if (!apiKey) throw new Error('Missing TYPESAFE_API_KEY or private TypeSafe configuration.');
    view.message = 'Jev is choosing…';
    view.pending = { startedAt: Date.now(), options: actions.length };
    const start = performance.now();
    const memory=encounterMemory(s,view.events);
    // What this run has actually SHOWN: every distinct card the game dealt into a hand, plus every
    // card the agent played or was offered. The bridge sends no deck and no pile counts at a card
    // reward, so this is the only deck evidence that exists - and it is a FLOOR, not a census. Skip
    // was taken in 18 of 49 rewards because Skip is the option that looks safe when you know nothing.
    // KEYED TO THE RUN, NOT THE FLOOR. This was act+floor, so the set was wiped on every room
    // change and "distinctCardsSeenThisRun" was really "distinct cards seen since the last door".
    // The bridge gives no run id on the singleplayer path, so a run is approximated by its opening
    // position: act 1 floor 0-3 is a run start, and anything after is the same run continuing.
    const _act=planningState?.run?.act??1, _floor=planningState?.run?.floor??0;
    const runKey = (_act===1 && _floor<=3) ? 'r:1' : `r:${_act}`;
    // An ARRAY, not a Set. `view` is persisted to session.json and restored verbatim, and JSON has no
    // Set — a restored Set comes back as `{}`, which is not iterable, and `[...view.seenCards]` threw
    // "is not iterable" and killed the decision loop on every restart after this feature landed. An
    // array round-trips through JSON intact, and the dedupe is what the Set was for anyway.
    if(view.runKey!==runKey||!Array.isArray(view.seenCards)){view.runKey=runKey;view.seenCards=[];view.offeredCards=[];}
    const seen = new Set(view.seenCards);
    const offered = new Set(Array.isArray(view.offeredCards)?view.offeredCards:[]);
    // SEEN IS NOT OFFERED. Cards dealt into a hand, and cards the bridge actually reports in the
    // permanent deck, are evidence of deck membership. A card merely OFFERED at a reward is not —
    // it may be declined, and it never was in the deck. Merging the two made the number a lower
    // bound on nothing, which is how a field labelled `floor:true` ended up not being a floor.
    for(const c of [...(planningState?.player?.hand??[]), ...(planningState?.player?.deck??[])])
      if(c?.name) seen.add(String(c.name).replace(/\+$/,''));
    for(const c of (planningState?.card_reward?.cards??[]))
      if(c?.name) offered.add(String(c.name).replace(/\+$/,''));
    view.seenCards=[...seen];
    view.offeredCards=[...offered];
    // ATTRITION, accumulated PER TURN and reset per FIGHT. Keyed on the fight (act, floor, enemy
    // names) because a turn is the unit a fight is measured in - the mistake of reading "61
    // decisions" as a war of attrition when it was 11 turns.
    const liveEnemies=((planningState?.battle?.enemies)??[]).filter(e=>(e?.hp??0)>0);
    const fightKey=liveEnemies.length
      ? `${(planningState?.run?.act??'a')}:${(planningState?.run?.floor??0)}:`+liveEnemies.map(e=>e.name).sort().join('+')
      : null;
    if(fightKey===null){view.fightKey=null;view.fightAccum=null;view.fightLastRound=null;view.fightPending=null;}
    else{
      if(view.fightKey!==fightKey){view.fightKey=fightKey;view.fightAccum=null;view.fightLastRound=null;view.fightPending=null;}
      const round=(planningState?.battle?.round??0);
      // Tracked per ENTITY, not as a sum. Summing live enemy HP conflates two different things: a
      // hit reduces the sum, and an enemy leaving the set reduces it too, with no damage dealt. A
      // fight measured 85 -> 73 and reported `dealt: 18` — 6 points of that was an enemy leaving,
      // not the agent hitting anything, so the kill rate ran high and made fights look like they
      // were ending sooner than they did.
      //
      // Per entity_id, the remaining HP of an enemy that is no longer present is counted as dealt.
      // The raw state carries no flag distinguishing a kill from a departure, and inventing one
      // would be a guess; a kill is overwhelmingly the case, and a vanished enemy that was NOT
      // killed can only make this figure an UPPER bound. The bound is stated rather than hidden,
      // because the alternative — silently dropping the entity — is a lower bound that is wrong in
      // the same direction and gives no reason why.
      const byId=new Map(((planningState?.battle?.enemies)??[]).map(e=>[e.entity_id,e]));
      if(round!==view.fightLastRound){
        if(view.fightPending){
          // The agent's actions execute BETWEEN observations, so there is no reading of the enemy
          // at the instant a turn ends — a turn's damage first appears in the next turn's opening
          // reading. The comparable pair is consecutive TURN STARTS.
          const before=view.fightPending.startById??{};
          let observed=0, anySeen=false;
          for(const [id,hp] of Object.entries(before)){
            if(!Number.isFinite(hp))continue;
            anySeen=true;
            const now=byId.get(id)?.hp;
            observed+=Math.max(0,hp-(Number.isFinite(now)?now:0));
          }
          view.fightAccum=observeTurn(view.fightAccum,{
            hp:(planningState?.player?.hp)??null,
            dealt:anySeen?observed:null,
            enemyHp:liveEnemies.reduce((n,e)=>n+(e.hp??0),0)});
        }
        view.fightLastRound=round;
        view.fightPending={startById:Object.fromEntries([...byId].map(([id,e])=>[id,e.hp])),endHp:(planningState?.player?.hp)??null};
      } else if(view.fightPending){
        view.fightPending.endHp=(planningState?.player?.hp)??view.fightPending.endHp;
      }
    }
    if(planBenefitEnabled)memory.persistentPlan=persistentPlan(s,view.events);
    // First match wins. Bound to a name so the decision below can be stamped with the policy that
    // actually produced it, named by FUNCTION IDENTITY rather than by re-reading the env.
    const policy=recallEnabled?recallingDeliberate:betterPolicyEnabled?betterDeliberate:factoredEnabled?factoredDeliberate:lunaEnabled?assistedDeliberate:planBenefitEnabled?planBenefitDeliberate:deliberate;
    const stamp=policyStamp(policy,POLICY_CHAIN);
    const result = await policy({state:planningState,candidates:actions,
      recent:memory,
      memory:memoryStore,
      seenCards:view.seenCards,
      attrition:attrition(view.fightAccum),
      onStage:stage=>{view.message=stage;view.pending.stage=stage;},
      ask:async payload=>{
        if(token!==generation)throw Error('Decision cancelled.');
        if(view.inputTokens>=MAX_INPUT_TOKENS||view.decisions>=MAX_DECISIONS)throw Error('Session budget reached.');
        // Decision calls compute an answer and change nothing, so a duplicate
        // in flight is safe. Game commands below are NOT hedged.
        const body=JSON.stringify(payload);
        // MEASURE THE WIRE, not the objects. A 26k-input-token decision was traced to a 71.7 KB
        // LOGGED candidate list, and the logged list is not the request — the planner may trim it
        // into something far smaller, in which case that whole analysis pointed at the wrong
        // thing. Reasoning about which of the two it is would repeat the error; the byte count of
        // the actual body settles it, and costs one field.
        //
        // Per-part, because a single total cannot say WHICH part to cut.
        const partBytes=Object.fromEntries(Object.entries(payload).map(([k,v])=>[k,v==null?0:JSON.stringify(v).length]));
        // One level deeper into `state`, because the logged state is 4 KB and 45 KB is what the
        // model receives: the payload WRAPS it with encounter/deck/facts/mechanics/setup parts.
        // Which of those six is the bloat is not answerable by reading the planner — they are not
        // exported — and one level of nesting settles it for a couple of bytes per decision.
        const statePartBytes=(payload&&typeof payload.state==='object'&&payload.state)
          ?Object.fromEntries(Object.entries(payload.state).map(([k,v])=>[k,JSON.stringify(v??null).length])):null;
        view.requestBytes=body.length; view.requestPartBytes=partBytes; view.requestStateBytes=statePartBytes;
        const attempt=async signal=>{
          view.hedgeAttempts=(view.hedgeAttempts??0)+1;
          const r=await fetch('https://openrouter.ai/api/alpha/decisions',{
            method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},
            body,signal:AbortSignal.any([signal,AbortSignal.timeout(30000)]),
          });
          if(!r.ok)throw Error(`TypeSafe HTTP ${r.status}; paused. Retry with Resume.`);
          return await r.json();
        };
        const result=hedgeEnabled?await hedged(attempt):await attempt(new AbortController().signal);
        view.decisions++;view.inputTokens+=result.usage?.input_tokens??0;
        return result;
      }});
    view.latencyMs = Math.round(performance.now() - start);
    view.model = result.model;
    const answer = result.answers?.move;
    const chosen = actions.find(a => a.id === answer?.choice);
    if (!chosen || answer?.type !== 'choice') throw new Error('Jev returned an invalid action ID.');
    // `...stamp` on EVERY outcome - executed, preview, cancelled, stale_rejected, game_rejected -
    // so a run log always answers which policy and which guard produced each decision. `policy`
    // stays POLICY_VERSION: it is a planner version, not the policy that ran.
    // `attrition` is what the model was TOLD about the fight. It was passed into the policy and
    // computed fresh every decision, but never written to the record — so the one learning signal
    // the agent reasons with could not be audited, replayed, or measured after the fact, and a bug
    // in it would have been invisible forever. The fix that made `dealt` observed in iteration 65
    // was unfalsifiable until this was logged: there was no way to check it on real data.
    const event = { kind: 'decision', adviser:result.adviser??null, runAdviser:view.adviser, policy: POLICY_VERSION, ...stamp, memory, deliberation:result.deliberation, attrition:attrition(view.fightAccum), fightAccum:view.fightAccum, requestBytes:view.requestBytes??null, requestPartBytes:view.requestPartBytes??null, requestStateBytes:view.requestStateBytes??null, state: s, chosen, candidates: actions, answer, factors: rawFactors(result.answers), model: result.model, usage: result.usage, latencyMs: view.latencyMs, preview };
    if (token !== generation) { await log({ ...event, outcome: 'cancelled' }); return; }
    if (preview) { await log({ ...event, outcome: 'preview' }); view.message = `Preview: ${chosen.label}`; return; }
    const fresh = await observe();
    if (fingerprint(fresh) !== hash) { await log({ ...event, outcome: 'stale_rejected' }); view.message = 'State changed; asking again.'; return; }
    if (token !== generation) return;
    // Never retry a mutating request automatically: a timeout can still mean it executed.
    let outcome;
    try { outcome = await gameRequest('/api/v1/singleplayer', chosen.command); }
    catch (error) {
      // These explicit validation errors happen before enqueueing in STS2MCP.
      // Observe anew and ask a fresh question; never resend the old command.
      if (/^card_index \d+ out of range|^Card '.+' cannot be played:|^Not in play phase|^Player actions are currently disabled|^Cannot end turn while a card/.test(error.message)) {
        await log({ ...event, outcome: 'game_rejected', message: error.message });
        lastExecuted = ''; nextDecisionAt = Date.now() + 1500;
        view.message = 'Game rejected a stale action; waiting for fresh state.'; return;
      }
      throw error;
    }
    lastExecuted = hash; view.actions++; view.message = chosen.label;
    nextDecisionAt = Date.now() + 1200;
    await log({ ...event, outcome: 'executed', result: outcome });
  } catch (error) {
    stop(error.message === 'fetch failed' ? 'Game bridge unavailable. Launch Slay the Spire 2 with STS2_MCP enabled.' : error.message);
    await log({ kind: 'error', message: view.message });
  } finally { busy = false; view.pending = null; }
}

// Sequential runner: at most one model request and one action in flight.
setInterval(async () => {
  if (busy) return;
  if (view.mode === 'running') await step(generation);
  else try { await observe(); } catch { view.connected = false; }
}, 600).unref();

const server = http.createServer(async (req, res) => {
  const json = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  // Bind to loopback and reject cross-origin controls / DNS rebinding.
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return json(403, { error: 'Invalid host' });
  if (req.headers.origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin)) return json(403, { error: 'Invalid origin' });
  try {
    if (req.method === 'GET' && req.url === '/api/status') return json(200, view);
    if (req.method === 'GET' && req.url === '/api/sidecar') return json(200, sidecarView());
    if (req.method === 'GET' && req.url.startsWith('/api/plan-review')) {
      const review = JSON.parse(await readFile(resolve(logDir, 'plan-review.json'), 'utf8'));
      const name = new URL(req.url, 'http://localhost').searchParams.get('case') ?? 'slippery';
      const item = review.cases.find(c => c.name === name);
      if (!item) return json(404, {error:'Replay not found'});
      return json(200, sidecarView({mode:'review', connected:true, pending:null, model:item.event.model, actions:0,
        inputTokens:item.event.usage.input_tokens, state:item.event.state, events:[item.event],
        message:'Recorded-state evaluation. No game actions executed.',
        review:{name:item.name, originalChoice:item.originalChoice, baselineChoice:item.baselineChoice, evaluatedAt:review.evaluatedAt},
      }));
    }
    if (req.method === 'POST') {
      if (req.headers['x-spire-control'] !== '1') return json(403, { error: 'Missing control header' });
      if (req.url === '/api/pause') { stop('Paused. You can take over in the game.'); return json(200, { ok: true }); }
      if (req.url === '/api/run') {
        if (!apiKey) return json(400, { error: 'Missing API key' });
        generation++; waitingSince = 0; lastExecuted = ''; view.mode = 'running'; view.message = 'Autoplay enabled';
        return json(200, { ok: true });
      }
      if (req.url === '/api/step' || req.url === '/api/preview') {
        if (busy) return json(409, { error: 'Wait for the current decision to finish' });
        stop('Single decision'); const token = generation;
        void step(token, req.url === '/api/preview'); return json(200, { ok: true });
      }
    }
    if (req.method === 'GET' && ['/', '/sidecar'].includes(req.url?.split('?')[0])) {
      res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      return res.end(await readFile(resolve(root, req.url.startsWith('/sidecar') ? 'sidecar.html' : 'index.html')));
    }
    json(404, { error: 'Not found' });
  } catch { json(500, { error: 'Local server error' }); }
});
// Named in the banner, not buried in the log: which policy answers a decision is a property of the
// launch, and so is whether that policy refuses a lethal choice. Printed before any decision is paid
// for, because a gate that is only discoverable in a run log has already run unguarded.
server.listen(port, '127.0.0.1', () => console.log(`Jev plays the Spire: http://127.0.0.1:${port}\nPolicy: ${resolvedPolicy.policyName} - lethal gate ${resolvedPolicy.gate}${resolvedPolicy.gateVia ? ` (applied by ${resolvedPolicy.gateVia})` : ''}\nKey configured: ${Boolean(apiKey)}\nDecision log: ${logFile}`));
process.on('SIGINT', () => { stop('Stopped'); server.close(); process.exit(0); });
