#!/usr/bin/env bash
# Plan 210 Task 5 (gate C-1): keep the campaign running until its journal says it is done.
# A kill from outside (systemd-oomd, a closed terminal, a reboot of the shell) costs only wall time: the campaign
# resumes from its journal, answer and judge checkpoints. The run lives in its own systemd scope with a memory cap,
# so memory pressure stops the campaign, never the user's terminal.
#
#   setsid nohup scripts/memory-bench/c1-supervise.sh <waves> >> .cache/memory-bench/210-supervise.log 2>&1 &
#
# <waves> is required ("1", "2", "3" or a list such as "1,2"): the owner starts each wave explicitly (gate C-1
# amendment 6). Jobs of other waves stay in the journal and are reported deferred.
set -uo pipefail
cd "$(dirname "$0")/../.."
WAVES=${1:?usage: c1-supervise.sh <waves, e.g. 1 or 1,2>}
export PRISM_MEMORY_BENCH_210_WAVES="$WAVES"
JOURNAL=.cache/memory-bench/210/journal.json
LOG=.cache/memory-bench/210-campaign.log
MEMORY_MAX=${PRISM_MEMORY_BENCH_210_MEMORY_MAX:-40G}
PARALLEL=${PRISM_MEMORY_BENCH_210_PARALLEL_ARMS:-6}
set -a
# shellcheck disable=SC1090
source "$HOME/.config/prism/live.env"
set +a
unset PRISM_MEMORY_BENCH_210_SMOKE PRISM_MEMORY_BENCH_210_JOBS
for run in $(seq 1 200); do
  echo "$(date -Is) supervise: waves $WAVES, run $run (MemoryMax=$MEMORY_MAX, parallel arms $PARALLEL)"
  systemd-run --user --scope --quiet --unit="prism-210-c1-$run-$$" -p MemoryMax="$MEMORY_MAX" -p MemorySwapMax=4G \
    timeout 1209600 bun scripts/memory-bench/campaign.mjs --plan 210 --partition dev --parallel-arms "$PARALLEL" >>"$LOG" 2>&1
  code=$?
  status=$(python3 -c "import json;print(json.load(open('$JOURNAL')).get('status',''))" 2>/dev/null || echo unknown)
  echo "$(date -Is) supervise: exit $code, journal status '$status'"
  case "$status" in
    finished | budget-exhausted | token-ceiling) exit 0 ;;
  esac
  sleep 60
done
echo "$(date -Is) supervise: gave up after 200 runs"
exit 1
