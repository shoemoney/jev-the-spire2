#!/bin/zsh
set -eu
demo_dir="$(cd "$(dirname "$0")" && pwd)"
app_dir="$demo_dir/../.private/Jev Companion.app"

# The shipped learning path, resolved in one place so the effective values can be printed below.
# SPIRE_RECALL turns on cross-run memory plus the end_turn safety gate in learning/wire.mjs;
# SPIRE_BETTER_POLICY is the policy it falls back to when recall is off. Both default to 1 so the
# intended policy is what a contributor actually gets, and both stay overridable without editing
# this file: server.mjs enables a flag only on an exact `=== '1'`, so `SPIRE_RECALL=0` - here or
# on `node spire-demo/server.mjs` - leaves the gate off.
spire_policy_env() {
  print -r -- "SPIRE_RECALL=${SPIRE_RECALL:-1} SPIRE_BETTER_POLICY=${SPIRE_BETTER_POLICY:-1}"
}
eval "export ${$(spire_policy_env)}"
print -r -- "Jev companion: ${$(spire_policy_env)}"
if [[ ! -d "$app_dir" ]]; then
  zsh "$demo_dir/native/build.sh"
fi
if ! curl -fsS --max-time 2 http://127.0.0.1:4317/api/sidecar >/dev/null; then
  node_bin="$(command -v node || true)"
  if [[ -z "$node_bin" ]] && [[ -d "$HOME/.nvm/versions/node" ]]; then
    # Plain glob rather than zsh's (N) qualifier so the script also parses under `bash -n`; the
    # directory check above keeps an absent nvm tree from being an unmatched-pattern error, and
    # the `[[ -x ]]` guard keeps a non-executable match from winning. Last match is the highest
    # version, same as before.
    for candidate in "$HOME"/.nvm/versions/node/*/bin/node; do
      [[ -x "$candidate" ]] && node_bin="$candidate"
    done
  fi
  if [[ -z "$node_bin" ]]; then
    echo 'Node.js is required. Install Node 22+ and try again.'
    read -r '?Press Return to close.'
    exit 1
  fi
  nohup "$node_bin" "$demo_dir/server.mjs" > "$demo_dir/../.private/spire-server.log" 2>&1 &
  for attempt in {1..20}; do
    if curl -fsS --max-time 1 http://127.0.0.1:4317/api/sidecar >/dev/null 2>&1; then break; fi
    sleep 0.25
  done
fi
open "$app_dir"
