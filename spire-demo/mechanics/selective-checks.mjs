// `mechanicsReview` ships nine prose checks on EVERY decision — about 2.4 KB, a fifth of the wire
// on an ordinary trash-mob turn — and eight of them open with a precondition ("If an intent
// explicitly says...", "If visible minion rules say..."). Sending a rule for a situation the board
// does not contain is not free: it competes for the model's attention with the board that IS
// there, and the ninth check is not a check at all.
//
// So each check is kept only when its own stated precondition is visible in the state. The always-
// on ones stay. This is a relevance filter, not a cap: nothing is truncated mid-sentence and
// nothing is ranked, so a check that matters is never dropped for being long.
//
// A check whose precondition cannot be determined from the state is KEPT. Absence of evidence is
// not evidence of absence, and silently dropping a safety check because the parser could not see
// its trigger would be the worst possible failure mode for exactly this kind of instruction.
const ALWAYS = new Set([1, 3]);

export function relevantChecks(state, all) {
  const visible = JSON.stringify(state ?? {}).toLowerCase();
  const has = (...words) => words.some(w => visible.includes(w));
  return all
    .map((text, i) => ({ text, i }))
    .filter(({ i, text }) => {
      if (ALWAYS.has(i)) return true;
      // Each conditional check, matched on the situation it names rather than on index alone, so
      // reordering the array cannot silently attach a check to the wrong trigger.
      if (/destroyed after attacking|destroyed after it attacks/i.test(text)) return has('destroy');
      if (/abandon combat without their leader|minion rules/i.test(text)) return has('abandon', 'minion', 'leader');
      if (/revival rule/i.test(text)) return has('reviv', 'resurrect', 'return to combat');
      if (/Compare remaining enemies and their visible attacks after a kill/i.test(text)) {
        return (state?.battle?.enemies ?? []).filter(e => (e?.hp ?? 0) > 0).length > 1;
      }
      if (/If ending now is lethal/i.test(text)) return has('lethal', 'die', 'death');
      if (/distinguish repeated behavior/i.test(text)) return true;
      // Unknown check: keep it. An instruction we cannot place is not an instruction to drop.
      return true;
    })
    .map(({ text }) => text);
}
