#!/usr/bin/env bash
# Plan 218.3 Task 12: start the decision screen as a restartable systemd --user unit (owner, 2026-11-19: on the free
# route, model call failures never end the run, and it always resumes). Exit 6 (jobs missing below the ceiling) and any
# crash restart after 5 minutes and resume from the checkpoint rows; exit 0 (done or paused by --pause), 3 (a stop for
# the owner: a guardrail miss, the ceiling) and 5 (started while paused) do not restart.
#   bash scripts/memory-bench/session-bench/screen-unit.sh <log-file>
set -euo pipefail
log="${1:?usage: screen-unit.sh <log-file>}"
cd "$(dirname "$0")/../../.."
exec systemd-run --user --unit=prism-218-3-session-bench-screen --collect --working-directory="$PWD" --setenv=PATH="$PATH" \
  -p Restart=on-failure -p RestartSec=300 -p "RestartPreventExitStatus=3 5" -p StartLimitIntervalSec=0 \
  -p StandardOutput="append:$log" -p StandardError="append:$log" \
  bun scripts/memory-bench/session-bench/screen.mjs --live
