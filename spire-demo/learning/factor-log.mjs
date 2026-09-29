// Keeping the per-factor nouls in the decision log, so a later run can learn from this one.
//
// This exists because the log used to record only the SYNTHESISED answer — choice, probabilities,
// confidence — and threw away the safe_/prog_/waste_ readings the ranking was actually built from.
// That made the whole learning premise unfalsifiable: `learning/fit-weights.mjs` cannot fit against a
// corpus that does not contain the factors, the claim that some candidates were never asked could not
// be checked against the data, and the deadband's effect on the ranking could not be re-derived. It is
// the same failure as a benchmark that records only the winner: the evidence that would show the policy
// was wrong never gets written down.
//
// It is a separate module rather than a function inside `server.mjs` for one reason: `server.mjs` is
// the entrypoint, it opens a port on import, and an untestable helper in it is an unguarded helper.

/**
 * Pull the per-factor nouls out of a Jev reply.
 *
 * Only the factor questions are kept. The broad `move` answer is already recorded whole on the decision
 * event, and copying it here would duplicate it for no gain. Anything that is not a finite noul under a
 * `safe_`/`prog_`/`waste_` key is dropped rather than coerced — a factor that came back malformed is
 * missing evidence, and writing a number in its place is the fabrication this repo keeps refusing.
 *
 * Returns `undefined` rather than `{}` when there is nothing, so an event with no factors does not carry
 * a `factors: {}` that reads like "measured, and the answer was nothing".
 */
export function rawFactors(answers) {
  if (!answers || typeof answers !== 'object') return undefined;
  const out = {};
  for (const [id, answer] of Object.entries(answers)) {
    if (!/^(?:safe|prog|waste)_/.test(id)) continue;
    if (!answer || typeof answer !== 'object') continue;
    if (!Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) continue;
    out[id] = answer.noul;
  }
  return Object.keys(out).length ? out : undefined;
}

export default {rawFactors};
