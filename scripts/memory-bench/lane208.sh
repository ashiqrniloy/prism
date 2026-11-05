#!/usr/bin/env bash
# One plan 208 screen lane (plan 208 Task 5, 2026-11-04): the quick first read of the lane's non-series jobs, then the
# full run of every job in the lane. Both stages are supervised, so a crash, a halt or a closed quota window is
# restarted; the full run replays the quick prefix from the same answer and judge caches.
#
#   scripts/memory-bench/lane208.sh <name> <provider|-> <pace-per-minute> <full-job-ids>
#
# `provider` is `openrouter` for jobs an owner amendment routes there, or `-` for the job's own provider.
# Keys come from ~/.config/prism/live.env and never reach argv or the logs.
set -uo pipefail
name="$1"; provider="$2"; pace="$3"; full="$4"
cd "$(dirname "$0")/../.."
set -a; . "$HOME/.config/prism/live.env"; set +a
export PRISM_MEMORY_BENCH_PYTHON="$PWD/.cache/memory-bench/venv/bin/python3"
export PRISM_MEMORY_BENCH_FREE_PACE_PER_MINUTE="$pace"
unset PRISM_MEMORY_BENCH_JOURNAL PRISM_MEMORY_BENCH_208_SMOKE PRISM_MEMORY_BENCH_208_QUICK PRISM_MEMORY_BENCH_208_WORKER_PROVIDER
[ "$provider" != "-" ] && export PRISM_MEMORY_BENCH_208_WORKER_PROVIDER="$provider"
log=".cache/memory-bench/208/lane-$name.out"
quick=$(echo "$full" | tr ',' '\n' | grep -v '\.series-' | paste -sd, -)
echo "lane $name: quick=[$quick] full=[$full] at $(date -Is)" >> "$log"
if [ -n "$quick" ]; then
  PRISM_MEMORY_BENCH_208_QUICK=1 PRISM_MEMORY_BENCH_208_WORKER="$quick" \
    bun scripts/memory-bench/supervise.mjs --plan 208 --partition dev >> "$log" 2>&1
  echo "lane $name: quick read done at $(date -Is)" >> "$log"
fi
PRISM_MEMORY_BENCH_208_WORKER="$full" bun scripts/memory-bench/supervise.mjs --plan 208 --partition dev >> "$log" 2>&1
echo "lane $name: full run done at $(date -Is)" >> "$log"
