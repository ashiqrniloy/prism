# Cache parity runner

`run.mjs` answers one question: on the same model, does Prism keep its prompt cache as warm as the reference
coding agent (pi) does over a real coding task? It is operator tooling (plan 215 Tasks 23–24), never part of
`bun run test` or `release:gate`.

```bash
export PRISM_LIVE_ENV_FILE=~/.config/prism/live.env   # private (0600); COMMAND_CODE_API_KEY, OLLAMA_API_KEY
export PRISM_LIVE_PROVIDER_TESTS=1 PRISM_LIVE_CACHE_PARITY=1
timeout 3600 bun scripts/cache-parity/run.mjs --provider commandcode --model claude-haiku-5-5 --runs 3
timeout 3600 bun scripts/cache-parity/run.mjs --provider ollama-cloud --model gemma4:31b --runs 3 [--route native|openai]
# → docs/_evidence/cache-parity/<provider>-<model>-<date>.{json,md}

# all four cells, the gate and the one rerun of an inconclusive cell (the manifest row release/cache-parity)
PRISM_LIVE_STRICT=1 timeout 7200 bun scripts/cache-parity/live.mjs   # → docs/_evidence/cache-parity/gate-<date>.json
```

Cells: Command Code (chat `minimax/minimax-m3.1-flash`, Responses `gpt-5.6-luna`, Messages `claude-haiku-5-5`) and
Ollama Cloud (`gemma4:31b`). Hyper, OpenCode Go and OpenRouter are deferred to after 0.13.0.

## What a run does

For each of `--runs` (default 3) and each harness (`prism`, `pi`; the order alternates):

1. copies `fixture/` (a 17-file order-pricing library with one failing test) into a temp directory and `git init`s it;
2. starts `scripts/wire-proxy.mjs` on loopback with `--usage-log` and a per-run request ceiling;
3. runs the harness with its base URL pointed at the proxy, with `task.md` as the prompt;
4. runs `bun test` in the copy, and checks that `test/` is byte-identical to the template. Only then is the task `solved`;
5. reads the proxy log (the only source of the metrics) and cross-checks the harness's own usage.

| Harness | How it is started |
| --- | --- |
| `prism` | `prism-driver.ts`: the reference host's one-shot `run --agent coding` with the provider package's `baseUrl` set to the proxy, `approval: "auto"`, and no `memory` (so no experimental package). The host's default coding worker has 13 tools; pi has 4. That difference is the shipped product's, and it is in the report. |
| `pi` | `pi -p --mode json --no-session --no-extensions -e <extension> --no-mcp --no-skills --no-prompt-templates --no-context-files --no-approve --model <provider>/<id> --thinking medium`, with a run-scoped `PI_CODING_AGENT_DIR`. Command Code uses `COMMANDCODE_API_BASE`. pi-ollama-cloud ignores every base-URL override, so the run uses a scratch **copy** of the extension with its one base-URL constant changed to the proxy. |

Both harnesses carry a per-run id in the system prompt (Prism through the workspace `AGENTS.md`, pi through
`--append-system-prompt`) so a prefix cached by an earlier run cannot make the first request look warm.

## Metrics

From the proxy log only: `requests`, `promptTokens = Σ inputTokens` (inclusive of cache tokens), `cacheRead`,
`cacheWrite`, `hitRate = cacheRead / promptTokens`, `firstTurnExcludedHitRate` (requests 2..n), `taskSolved`.

Per cell the report gives each harness's median and range over runs, then a verdict:

| Verdict | Meaning |
| --- | --- |
| `pass` | Prism's median `hitRate` is at least pi's, over solved runs |
| `behind` | Prism's median is lower. Investigate before changing code (plan 215 Task 24) |
| `inconclusive` | Either harness solved fewer than two of three runs, so the comparison would measure a failed task. Rerun once |
| `usage_mismatch` | A Prism run's `turn.completed` usage differs from the proxy for some request. A Prism bug in the normalizer or codec |
| `budget_exceeded` | The cell reached its request ceiling; what ran is reported |
| `reference_config_mutated` | `~/.pi/agent` changed during a run; the cell stops |

A pi run whose own `message_end` usage (`input + cacheRead + cacheWrite`) disagrees with the proxy is recorded as
`piCrossCheck: "mismatch"` and does not fail the cell.

## The gate

`live.mjs` runs every enabled cell through `runCell` and applies `parityGate` (`metrics.mjs`): every conclusive cell must be `pass` (Prism's median `hitRate` at least pi's, no tolerance) and no Prism run may report `usage_mismatch`. `behind`, `usage_mismatch`, `budget_exceeded` and `reference_config_mutated` fail in every mode; `inconclusive` and `unmeasurable` fail in strict mode (`PRISM_LIVE_STRICT=1`); `deferred` cells (Hyper, OpenCode Go, paid OpenRouter) never fail. An `inconclusive` cell is rerun once; every attempt keeps its own report. Without `pi` or a pi extension the row skips with a reason.

`kilo-cli-reference.mjs` is separate: it runs the Kilo CLI headless on plan 203's three-turn fixture (free model, Chat) and records the reuse ratio under `docs/_evidence/cache-probe/`.

## Budget

At most `runs × harnesses × 20` requests per cell: 120 for 3 × 2. The proxy returns 429 without contacting the
upstream after 20 requests in one run (or the cell's remaining budget, if less), and a run that reaches it is
marked `ceiling`. Actual requests against the ceiling are in every report.

## Safety

- The proxy listens on loopback only.
- pi's override files are written into the run's temp directory, never the repository. A stat signature of `~/.pi/agent` (path, size, mtime; no file is read, so `auth.json` is never opened) is taken before and after each run.
- Keys reach children through the environment only (a child gets its own provider's key and nothing else), never as arguments.
- Child stdout and stderr are scanned for every credential-shaped value of the environment before anything is stored, and the report is scanned again before it is written.

## Offline tests

`bun test scripts/cache-parity/run.test.mjs` runs the whole runner against a fake upstream and scripted
harnesses. No key, no network, no `pi`.
