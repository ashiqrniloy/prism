# Command Code live acceptance — 2026-10-27 (UTC)

Plan 205 Task 5, on the owner's machine, with `COMMAND_CODE_API_KEY` in `~/.config/prism/live.env`
(mode `0600`, verified with `stat` before the run; the file is loaded with
`PRISM_LIVE_ENV_FILE=~/.config/prism/live.env`). No credential value is copied into this file.

Models (the row defaults, all three wired in `scripts/live-matrix.json`):

| Wire | Model | Route | Notes |
| --- | --- | --- | --- |
| Chat Completions | `minimax/minimax-m3.1-flash` | `openai` | text, tools, JSON Schema, image |
| Responses | `gpt-5.6-luna` | `responses` | text, tools, JSON Schema, image, reasoning |
| Anthropic Messages | `claude-haiku-5-5` | `anthropic` | text, tools, adaptive thinking, cache-control, image |

## Steps

| # | Step | Result | Requests |
| --- | --- | --- | --- |
| 1 | `PRISM_LIVE_STRICT=1 PRISM_LIVE_FILTER=providers/commandcode bun run test:live` | pass — 20 pass, 0 fail, 3 skip (the warm-prefix cache probe, one per route, is deliberately absent from this row; plan 184 owns it). 23 tests across `live.test.ts` and `live-agent.test.ts`. The shared runner covered text, two-turn tool loop with thinking/reasoning replay, structured output on Chat and Responses, abort before the first request, and the error path with no secret in the message; the per-wire kernel smoke below added the multi-turn agent, image, and ZDR legs | 28 inference, 1 catalog |
| 2 | Kernel smoke, one `createAgent` session per wire (`live-agent.test.ts`) | pass — same agent, three runs per wire: turn 1 called an `echo_value` tool at `thinkingLevel: "high"` and kept the tool result; turn 2 answered `7` from that result; turn 3 sent a 64×64 red PNG and answered `red`. Status `completed` every time; the serialized results contain no API key. Passing the catalog entry (not a bare ref) is required for the image gate — a bare ref carries no `capabilities.input` until the caller reads the catalog | 12 |
| 3 | ZDR pair (`x-cmd-zdr: 1`) | pass — `minimax/minimax-m3.1-flash` returned `done`; `poolside/laguna-s-2.1-free` returned the mapped **422** with the hint “The zdr flag requires a zero-data-retention upstream this model does not have: set zdr: false or choose a model that declares one.”, no upstream body and no key in the message | 2 |
| 4 | `provider-probe.mjs --turns 4`, one per wire (Task 3 evidence, not re-run here) | pass — reuse **0.997** Chat, **1.002** Responses, **1.000** Messages, all over the Task 3 thresholds; evidence in `docs/_evidence/cache-probe/commandcode-*-2026-10-27.json` | 12 (recorded in Task 3) |
| 5 | Leak scan | pass — the runner's `assertNoSecretLeak` on every scenario, the kernel smoke's serialized-result check, and `bun scripts/scan-secrets.mjs` over this file and the report all come back clean | 0 |

The first strict attempt passed 15/15 before the kernel smoke existed; the two `live-agent` iterations
then found D1 below. The table's 28 requests are the final acceptance run only.

## Defects found by this task, each fixed with a test

- **D1 — discovered models dropped image capability.** `GET /provider/v1/models` advertises endpoints and
  context windows, not modalities, and `mapCommandCodeModel` only declared image for the family heuristics
  (`claude-*`, `gpt-5.6*`, names containing `vision`). `minimax/minimax-m3.1-flash` therefore reached the
  kernel codec without `capabilities.input: ["text","image"]`, and the codecs' capability gate refused the
  image with “model does not declare image input capability” — even though the same model answers images
  live. Fixed by mapping the reference catalog's vision ids (installed `pi-commandcode-provider` 0.7.10,
  `MODEL_INPUT_MODALITIES`, 71 ids) into `capabilities.input` in `src/models.ts`. Test:
  `commandcode_discovered_models_declare_image_only_for_vision_upstreams` (a vision id maps to
  `["text","image"]`, an unknown id stays `["text"]`). The kernel smoke passes the catalog entry to the
  agent, which is the documented host flow (`agent.models.list()` → pick → run); a bare `provider/model`
  ref stays text-only until the host does that, which is kernel-wide behavior, not a Command Code defect.

## Request and spend accounting

| Leg | Inference requests |
| --- | --- |
| Shared runner (text, tool loop + thinking replay, structured, abort, error; 3 wires) | 14 |
| Kernel smoke (3 runs × 3 wires) | 12 |
| ZDR pair | 2 |
| **Final acceptance run** | **28** |

The plan's ceiling is 60 requests and an approved $0.30; the final run is 28. Test iteration across the
task (two failed `live-agent` passes, the first strict pass, and six direct ZDR/vision probes) adds about
45 more requests. At the published rates (Chat $0.15/$0.60, Responses $0.20/$1.20, Messages $0.10/$0.50 per
million input/output, ~2k input and <200 output tokens per request) the whole task spent **≈ $0.04**, well
under the ceiling; the recorded final run is ≈ $0.015. Catalog `GET /models` calls are not inference and
are counted separately (1 per run plus one per provider registration).

## Security

- `live.env` mode `0600` checked before anything ran; the key is read only through
  `COMMAND_CODE_API_KEY` and never printed by the runner, the tests, or this evidence.
- `bun scripts/scan-secrets.mjs` over this file and `docs/_evidence/live-matrix-report.md`: clean.
- The evidence records model ids, test names, request counts, and reuse figures only.
