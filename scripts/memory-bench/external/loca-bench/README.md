# LOCA-Bench adapter (plan 218.1 Task 4)

Pinned fetch, locked environment, the `seam.py` sidecar that serves one LOCA-Bench instance to a Prism agent, the
calibration arm (`loca-react`, upstream's own ReAct loop) and the pilot that sizes Task 5's screen. Upstream is
untrusted code: it lives in `~/.cache/prism/loca-bench/code-<commit>`, its Python runs with `python3 -I` from a venv
built only from `lock/`, and nothing upstream is vendored here.

| Path | Role |
|---|---|
| `fetch.mjs` | Clones upstream at commit `8b6fac49…`, checks the MIT `LICENSE` by hash, refuses any other tree (changed HEAD, local changes, a `.env`). Builds `env-<locks hash>/` from the committed locks: Python 3.12 venv (`lock/requirements.lock`, `--require-hashes`, resolved as of the commit date 2026-04-29), a separate `excel-mcp-server` venv (`lock/excel.lock`), the two npm MCP servers (`lock/node-package-lock.json`, `npm ci --ignore-scripts`), the `cl100k_base` tiktoken file by hash, and a `.pth` naming the checkout (what upstream's `pip install -e .` does). |
| `seam.py` | The sidecar. `serve` builds one instance exactly as upstream's `run_single_task` does (environment class, data generation, MCP servers, `MCPTool`, `ToolEnvWrapperOpenAI`) and answers the Prism agent's tool calls over stdio with upstream's own observations; `claim_done` (or an answer without a tool call) runs the instance's evaluator. Server commands that would download at run time (`npx`, `uvx`, `uv run`) are rewritten to the locked installs; any other command is refused. `react` runs upstream's own ReAct loop (the calibration arm). `self-check` asserts the upstream lines it relies on. |
| `adapter.mjs` | Prism as the scaffold: one agent per instance, LOCA's tools forwarded to the sidecar, the arm's memory from `armMemory` at the package defaults, budget B as the model's context window. Rows hold ids, counts and rewards only. |
| `pilot.mjs` | `--offline` (scripted model, every arm, one instance per task family) and the paid `--live` pilot under `LOCA_PILOT_RULE`, approved in the gate record (`locaBenchPilot`) before any call; `--score` writes `docs/_evidence/memory-bench/218/loca-bench-pilot.json`. |
| `lock/` | The environment locks. A new lock is a new environment directory; the pin itself changes only by a criteria amendment. |

Usage, pins and validation results: `scripts/memory-bench/README.md`, section "External suite: LOCA-Bench".
Tests: `bun test scripts/memory-bench/external/loca-bench` (the pinned-checkout checks run when the checkout is present).
