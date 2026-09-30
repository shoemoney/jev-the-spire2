// The assignment function for the scorer-vs-model A/B. Split out so it can be tested without a model
// call, and so the split logic is a named, testable thing rather than a ternary inside a policy.
//
// Deterministic and interleaved. The unit is (battle signature, turn index) so that both arms are
// assigned across the whole corpus rather than one arm owning whole fights — otherwise the two arms
// would see different boards and the comparison would confound again, which is the entire problem
// this experiment exists to solve.
const hash32 = str => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

// Off unless explicitly enabled. An experiment that is on by default measures the production
// behaviour of a system nobody agreed to change, which is how experiments end up being "always on"
// years later with the control arm unreachable.
const enabled = /^(1|true|yes|on)$/i.test(String(process.env.SPIRE_AB_MODEL ?? ''));

export const abExperiment = {
  enabled,
  // Returns 'model' or 'scorer' — or null when there is nothing to choose between, because the
  // scorer and the model already agree and overriding nothing means the arms are identical.
  armFor(candidates, scored, jevMove) {
    if (!scored?.length || !jevMove?.choice) return null;
    if (scored[0]?.id === jevMove.choice) return null;
    // Signature from the candidate set, not from a clock: a clock makes the split irreproducible,
    // and an irreproducible experiment cannot be re-run to check its own result.
    const sig = candidates.map(c => c.id).join('|') + `#${candidates.length}`;
    return (hash32(sig) & 1) === 0 ? 'model' : 'scorer';
  },
};

export { hash32 };
