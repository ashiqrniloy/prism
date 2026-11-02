# Phase 11 Part K — prompt-cache parity with pi

## Objectives

- Prove that the providers shipped in 0.13.0 get a prompt-cache hit rate at least as high as a reference agent harness on the same model and workload. The reference is **pi** (`pi` 1.3.0, already on the dev machine with Hyper and OpenCode Go configured), run headless, for both providers (owner decision 2026-10-16, replacing the earlier Crush/OpenCode choice).
- Catch prefix-breaking regressions offline: consecutive provider requests must keep their tools, system prompt, and earlier messages byte-identical on the wire, not only at the request level.
- Measure all harnesses the same way: through the plan 182 wire proxy, which reads usage from the raw upstream responses. The same measurement also checks that Prism's own reported usage matches what the upstream reported.

## Expected Outcome

- `prefixStabilityConformance` (in `@arnilo/prism/testing`) accepts an `encode` function. It asserts that the encoded `tools`, `system`, and `messages[0..n-1]` of request *n* equal those of request *n+1*. All four shipped packages run it in their tests.
- `bun scripts/cache-parity/run.mjs --provider hyper --model <id>` runs one scripted coding task in a fixture repository through Prism (`apps/prism-agent`), then through `pi -p` (headless) on the same model. It writes `docs/_evidence/cache-parity/<provider>-<model>-<date>.{json,md}`.
- A `release/cache-parity` live-matrix row runs the comparison for one model per route on Hyper and OpenCode Go, plus an opt-in pinned Anthropic OpenRouter cell gated by `PRISM_LIVE_OPENROUTER_PAID=1`. `docs/_evidence/cache-parity-0.13.0.md` records Prism ≥ reference for every enabled conclusive cell; unauthorized OpenRouter measurements stay explicitly deferred.

**0.13.0 release path — plan 184 of 181–187.** Start it when plan 201 is complete (step 17; see `plans/README.md`); this plan is step 18 of 21. When it is complete, continue with plan 185. Plans 181–201 run strictly in step order, and nothing runs in parallel. Plan 194 (added 2026-10-17) changes what this plan measures:
- the reference host now compacts on a measured trigger
- it clears stale tool results in batches (`fold.clearAtLeastTokens`)
- it recovers from context overflow

The parity cells run with that host configuration, and a fold batch or a compaction is an expected prefix change, not a regression.

This plan is a pre-publish part of roadmap **Phase 11**. It adds a test helper option and benchmark tooling, and changes no kernel contract, so it has **no phase review**. **Task 1 is a read-only check** of pi: its version, how to run it headless against the wire proxy without changing the owner's pi configuration, and where it puts cache markers. Plan 186's acceptance run includes this plan's gate. Prism's credentials come from `~/.config/prism/live.env` (`HYPER_API_KEY`, `OPENCODE_GO_API_KEY`). pi uses the provider credentials it already has configured. The runner never reads, copies, or prints pi's `~/.pi/agent/auth.json`, and the executor never asks for a key in chat. **Cost knob:** one cell is 3 runs × 2 harnesses of a bounded task (Task 3 states the ceiling). The row is opt-in and never part of `bun run test`. No version bump or publish.

**Amended 2026-10-24 by plan 203 (OpenRouter ships; live benchmarks and acceptance are unchanged).** Task 5 of that plan adds the provider-level probe and the OpenRouter cell below, not this plan's full runner. Existing Hyper/OpenCode Go acceptance journeys and benchmark model choices do not change. pi-ai 1.4.0's source-derived OpenRouter lever reference is in `packages/providers/openrouter/src/__tests__/fixtures/README.md`; Task 1 still verifies the installed CLI/version and actual headless wire workload.

**Amended 2026-10-25 by plan 204 (Sign in with ChatGPT provider; the two cells below, nothing else moves).** Plan 204 Task 6 proves the lever set by construction — `packages/providers/openai-codex/src/__tests__/cache-levers.test.ts` compares Prism's wire request against the request installed pi-ai **1.4.0** `api/openai-responses.js` actually builds for the same transcript (`src/__tests__/fixtures/pi-request-openai-chatgpt.json`, generated with a fake fetch, no upstream). `prompt_cache_key` and its 64-character clamp, `session_id` + `x-client-request-id`, `store: false`, `include: ["reasoning.encrypted_content"]`, `reasoning` effort/summary, the tool array, and every `input` item are byte-equal across three turns; the only difference is where the prompt sits — pi puts it in a leading `developer` item, Prism in the Responses `instructions` field, with identical text — so the cached prefix is the same bytes downstream. **Measured, sanctioned route:** `provider-probe.mjs --provider openai-codex --model gpt-6.1-sol --credential keyring:openai-codex --turns 4` reports `reuse: 0.983` (turns 2–4 each read 8 192 of the 8 334-token prefix) in `docs/_evidence/cache-probe/openai-codex-gpt-6.1-sol-2026-10-25.json`; a first run of the same probe read 8 192 on turns 2–3 and 0 on turn 4 (`reuse 0.655`), so a single cold turn on this route is a routing/TTL outlier rather than a lever difference — the threshold stays ≥ 0.8 and the recorded run clears it. **The `Prism ≥ pi` gate is still pending on pi's side:** pi's only configured credential is the private `openai-codex` route (`pi auth check --provider openai` → `not_ready`), which reported 0.969/0.982 on a ~7 k-token prefix in plan 204 Task 1 (g); that is a different upstream, so the same-route cell is `unmeasured`, not a pass. **Codex CLI cell measured like for like (2026-10-25, `docs/_evidence/cache-probe/codex-cli-turn2-2026-10-25.json`):** the same model and account, two turns in one `codex exec` session (`--json`, `-c model_reasoning_effort='low'`, no tools invoked — the shape `provider-probe.mjs` uses), reading `token_count.info.last_token_usage` per turn. Turn 2 caches **17 664 of 20 972** tokens (0.842) when the first prompt is bare, but only **12 288** once the first prompt carries user content: 0.638 with a 665-token prefix and 0.481 with a 12 552-token one, i.e. it reuses its fixed harness block and nothing of the conversation. Prism, same model, same prefix size, reuses **8 192 of 8 352** (0.981) and reuses 98.3 % of the prior prefix whatever the new turn adds, so it leads in every shape measured; it also grows input by 18 tokens per turn where codex grows by 708–3 085. Caveat recorded with the numbers: codex's chatgpt-mode bodies were not proxied, so why the conversation falls out of its prefix is unverified, and its 12 288 block is a permanent server-side harness cache that predates the run (codex starts ahead on a cold session, Prism ahead per turn). so plan 204 Task 7 (WebSocket continuation) does **not** run; the open question is only pi's sanctioned-route cell above.

**Amended 2026-10-28 by plan 205 (Command Code provider; three cells, nothing else moves).** The offline lever proof is `packages/providers/commandcode/src/__tests__/cache-levers.test.ts` against `src/__tests__/fixtures/pi-request-{chat,responses,messages}.json` — requests recorded from installed `pi-commandcode-provider` 0.7.10 on pi-ai 1.4.0 with a fake fetch, no upstream (provenance in the fixtures README). Per wire it asserts the cache-relevant fields match the reference (`prompt_cache_key` + 64-character clamp, `store: false`, `include`, `x-client-request-id`; the exact `cache_control` placement on system/last message with no TTL and no tool marker; no cache field at all on Chat) and that the cached prefix cannot move: system or instructions, tools and every earlier message stay byte-identical across the three turns. **Measured, probe run (4 requests per wire, plan 203 fixture):** reuse 0.997 (Chat, `minimax/minimax-m3.1-flash`; turns 2–4 each read 8 704 of the 8 727-token prefix), 1.002 (Responses, `gpt-5.6-luna`; 8 333/8 336) and 1.000 (Messages, `claude-haiku-5-5`; 16 898/16 902, one 16 898-token cache write on turn 1) in `docs/_evidence/cache-probe/commandcode-<model>-2026-10-27.json`. **Reference side, same models, Task 1 (f) commands with a 4-turn session:** pi read 9 734 (Chat), 8 310 (Responses) and 14 291 (Messages) tokens on turn 2 and kept reading the whole conversation on later turns (the Chat run's **first** turn already read 9 733 because the gateway prefix cache still held the same text from the Prism probe — direct evidence that the Chat cache is upstream-wide and lever-free); its hit rates are 99.74–99.81 % Chat, 99.96 % Responses, 99.97 % Messages. **Verdict: no lever or prefix gap, Prism ≈ pi.** The Chat cell reaches ~100 % with no cache field on either side, so the lever-equivalence claim holds on the wire, not just in the numbers. The residual 0.03–0.4-point difference is the probe's growing suffix against pi's reuse of the whole prior turn, not a missing marker or a moving prefix; the strict per-cell median gate stays with the standing runner, which is not present in this tree (only `provider-probe.mjs` exists), so these cells run as the 4-request probe diagnostic, the same treatment plan 203/204 gave their provider cells. Messages note: the probe's explicit breakpoint set (`system_prompt`, `tools`, `message_id: anchor`) makes Prism mark system + tools while pi's client marks system + last message, which is why the probe ratio converges on the system prefix; the offline test compares the default (system + last message) placement, which is the shape both clients ship. The provider also learned the reference's adaptive shape this task: `thinking: {type: "adaptive", display: "summarized"}` (verified accepted live, 200 on `claude-haiku-5-5`).

**Amended 2026-10-31 by plans 211–212 (host adoption ships in 0.13.0).** Start this plan when plan 212 is complete. Plan 211 adds package skills to the system catalog in the cached prefix; its Task 9 names the fixture agent with package skills that this plan's parity fixtures must include. Plan 212 adds no agent-side bytes.

**Amended 2026-10-31 by plan 213 (Kilo provider; three cells, nothing else moves).** The offline lever proof is `packages/providers/kilo/src/__tests__/cache-levers.test.ts` against `packages/providers/kilo/src/__tests__/fixtures/kilo-cli-request-{chat,responses,messages}.json` — real `@kilocode/cli` 7.8.18 requests captured through a loopback recorder (provenance and the paid-402 capture caveat in the fixtures README). Per wire it asserts the task-id header, the cache fields the CLI sends, and that system/instructions, tools and every earlier message stay byte-identical across the plan-203 three turns. The CLI sends no `prompt_cache_key`; Prism's Responses route now strips the codec-derived key. Messages keeps the CLI placement (first two system messages plus the last two non-system messages, no TTL, no tool marker). **Live probe, free model only:** `provider-probe.mjs --provider kilo --model nvidia/nemotron-3.5-super-vl:free --turns 4` measured an 8571-token prefix with `4336` cache-read tokens on turns 2–4 (reuse `0.506`) for Chat (`docs/_evidence/cache-probe/kilo-nvidia-nemotron-3.5-super-vl-free-2026-10-31.json`); the same probe with the route forced measured `0.506` for Responses and `0.337` for Messages (two warm turns read 4336, turn 3 read 0). Chat and Responses clear the `cacheReadTokens > 0` diagnostic; Messages is below the 0.8 ratio threshold because this free route exposes only about half of the 8571-token prefix as cache reads. The standard Responses/Messages cells use paid GPT-6 Luna and Claude Haiku 5.5, which return 402 on the reference account's negative balance; those cells are **unmeasured**, not parity. The CLI headless reference has not run the plan-203 fixture, so all three `Prism ≥ CLI` gates remain part of the 0.13.0 parity workload, the same treatment plan 203/204 gave their provider cells.

**Amended 2026-10-31 by plan 214 (LiteLLM provider ships without a parity cell; owner decision).** `@arnilo/prism-provider-litellm` has no cell in the parity matrix. LiteLLM is a gateway proxy fronting over a hundred backends with heterogeneous caching behaviors; per-backend parity is deferred to after 0.13.0 by owner decision 2026-10-31. The package ships a provider-agnostic caching policy (byte-stable prefix, no markers by default, opt-in marker routes, operator breakpoint injection documented, and faithful mapping of reported cache usage). Cache figures measured by `scripts/cache-parity/provider-probe.mjs --provider litellm` are recorded for information only, with no threshold, and do not block 0.13.0 release acceptance.

**Amended 2026-11-01 by plan 206 Task 3 (Ollama Cloud; one cell).** Offline proof: `packages/providers/ollama-cloud/src/__tests__/cache-levers.test.ts` checks both real serializers over the plan-203 three-turn fixture against installed pi-ai 1.4.0 / pi-ollama-cloud 0.13.1's captured request lever set (no cache fields or affinity headers), and verifies byte-stable tools/system/earlier messages even when callers request cache hints. The probe now accepts opt-in `--ttft` and Ollama-only `--route native|openai` (default native), reads `OLLAMA_API_KEY`, and writes distinct route reports. **Measured 2026-11-01, `gemma4:31b`:** four turns each for pi, native Prism, and compat Prism; exactly **12 generation requests**. Same deterministic plan-203 transcript, padding, tools, suffixes and 128-token cap, supplied to pi through a run-scoped `context_with_system` extension without replacing its wire codec or cache policy. Prism's two routes each report reuse **1.00227**, above the **>0.5** threshold, and **33,504 cache-read tokens ≥ pi's 25,088** over four turns. Pi ran first and its first turn was cold; the warm-only check removes that advantage and still passes: **25,152 ≥ 25,088** on turns 2–4 for both Prism routes. The ratio can exceed one because later suffixes also become cached. **Latency:** median warm text TTFT native **726.62 ms**, compat **716.59 ms**, pi **2,206.59 ms**; both satisfy Prism ≤ pi × 1.15 (**2,537.58 ms**). Installed pi JSON mode emits `message_update.assistantMessageEvent.text_delta`, so first-text timing can be measured directly by an extension; no total-duration substitution or owner metric decision is needed. Prism starts its timer before `generate`, pi at `before_provider_request` (Prism includes more preparation, a conservative comparison). Evidence and exact caveats: `docs/_evidence/206-task3-cache-parity.md`, route JSON reports and the pi comparison under `docs/_evidence/cache-probe/`. **Verdict: this bounded diagnostic passes both cache and latency conditions.** It is not the still-unimplemented three-run coding-task gate below, and does not complete or waive any of this plan's tasks.

### Parity matrix

| Cell | Prism | Reference | Enablement | Ceiling |
| --- | --- | --- | --- | --- |
| Hyper Chat | `hyper`, Task 1 pinned model | pi same upstream model | Existing parity flags/key | 120 requests |
| Hyper Messages | `hyper`, Task 1 pinned model | pi same upstream model | Existing parity flags/key | 120 requests |
| OpenCode Go Chat | `opencode-go`, Task 1 pinned model | pi same upstream model | Existing parity flags/key | 120 requests |
| OpenCode Go Messages | `opencode-go`, Task 1 pinned model | pi same upstream model | Existing parity flags/key | 120 requests |
| OpenRouter Anthropic | `openrouter`, `anthropic/claude-haiku-4.5` | `pi -p --mode json --provider openrouter --model anthropic/claude-haiku-4.5` plus Task 1 isolation flags | Owner authorization, `OPENROUTER_API_KEY`, `PRISM_LIVE_OPENROUTER_PAID=1` | 120 requests (3 × 2 harnesses × 20) |
| OpenAI Codex (sanctioned route) | `openai-codex`, `gpt-6.1-sol` | `pi -p --mode json --provider openai --model gpt-6.1-sol` (Sign in with ChatGPT inside pi's `openai` provider) | Plan 204 grant in the OS keyring; pi's `openai` provider signed in — `pi auth check --provider openai` still reports `not_ready` (2026-10-25) | 4 + 4 generation requests (one probe run each side) |
| OpenAI Codex (first-party reference) | measured | `codex exec --json -m gpt-6.1-sol` then `codex exec resume <id> --json`, same thread | Existing Codex CLI login | 2 requests |
| Command Code Chat | `commandcode`, `minimax/minimax-m3.1-flash` | `pi -p --mode json --provider commandcode --model minimax/minimax-m3.1-flash` | `COMMAND_CODE_API_KEY` (the probe reads it as `COMMANDCODE_API_KEY`) | 4 + 4 generation requests (one probe run each side, plan 203 fixture) |
| Command Code Responses | `commandcode`, `gpt-5.6-luna` | `pi -p --mode json --provider commandcode --model gpt-5.6-luna` | same key | 4 + 4 generation requests |
| Command Code Messages | `commandcode`, `claude-haiku-5-5` | `pi -p --mode json --provider commandcode --model claude-haiku-5-5` | same key | 4 + 4 generation requests |
| Kilo Chat | `kilo`, `nvidia/nemotron-3.5-super-vl:free` | `kilo run --format json -m kilo/nvidia/nemotron-3.5-super-vl:free` | `KILO_API_KEY`; free model | 4 + 4 generation requests (one probe each side, plan 203 fixture) |
| Kilo Responses | `kilo`, `openai/gpt-6-luna` | `kilo run --format json -m kilo/openai/gpt-6-luna` | Paid credit; the reference account returns 402, so the cell is unmeasured while it stays negative | 4 + 4 generation requests |
| Kilo Messages | `kilo`, `anthropic/claude-haiku-5.5` | `kilo run --format json -m kilo/anthropic/claude-haiku-5.5` | Paid credit; the reference account returns 402, so the cell is unmeasured while it stays negative | 4 + 4 generation requests |
| Ollama Cloud | `ollama-cloud`, `gemma4:31b`, native default; OpenAI compat diagnostic | `pi -p --mode json --provider ollama-cloud --model gemma4:31b`, same fixed four-turn workload | `OLLAMA_API_KEY`, `PRISM_LIVE_PROVIDER_TESTS=1`, `PRISM_LIVE_CACHE_PARITY=1`; metric: four-turn cache-read total ≥ pi, warm median text TTFT ≤ pi × 1.15; measured pass on both routes | 8 probe requests (4 per route) + 4 pi requests = 12; each probe CLI invocation adds 1 + N free metadata reads |

OpenRouter never uses `openrouter/free` or `openrouter/auto` for this comparison. Without paid authorization, its cell is `unmeasurable` / deferred with a reason, not parity and not a silent pass. With the paid flag explicitly enabled, a missing key or inconclusive result fails strict mode. The deferred cell does not move the existing release acceptance workload. `scripts/cache-parity/provider-probe.mjs --provider openrouter --model anthropic/claude-haiku-4.5 --turns 4` is a separate **four-generation-request** diagnostic (plus one catalog call), not part of the 120-request harness run or `release:gate`. It reads keys only from env/private `live.env`; it never consumes pi's auth file. Its `fixtures/three-turn-coding.json` may later be reused by Task 3, but the probe has no dependency on that runner.

## Tasks

- [ ] Task 1: Reference harness check: pi headless (read-only)
  - Acceptance Criteria:
    - Functional: The task note records, for pi (`pi --version`, 1.3.0 on 2026-10-16, dated):
      - (a) **Routing pi through the proxy without editing `~/.pi`.** How to point pi's `hyper` and `opencode-go` providers at a custom base URL for one run: a run-scoped agent/config directory, a run-scoped models file, or an `--extension`. Verify against pi's docs (find-docs) and the installed source. The run must leave `~/.pi/agent/*` unchanged; Task 3 checks this with a checksum before and after. If pi can only take a base URL from a config that also holds credentials, record that and choose the option that passes the key through env (`--api-key` is rejected because it puts the key in process arguments).
      - (b) **The headless command.** `pi -p --mode json --no-session --model <provider>/<id> --thinking <level> "<task>"`, run in the fixture workdir with built-in tools (`read`, `bash`, `edit`, `write`). It runs without approval prompts. For a reproducible baseline it also disables the owner's personal extras: `--no-extensions --no-mcp --no-skills --no-prompt-templates --no-context-files --no-approve`. The note records which of these change pi's request prefix, and the comparison runs with all of them.
      - (c) **What pi sends and receives.** From the proxy log of one short run per provider and route model: the endpoint and format pi uses for each test model (Chat Completions or Anthropic Messages); where it places `cache_control` markers; whether it sends a session or affinity header (for example `x-opencode-session`) or a `prompt_cache_key`. Also whether pi's `--mode json` output reports per-request usage. If it does, Task 3 cross-checks it against the proxy as a second source.
      - (d) **Model ids.** pi's catalog ids can differ from Prism's (pi lists `hyper/deepseek-v4-pro-0813` where Prism's catalog has `deepseek-v4-pro`). Map each test model to the same upstream id on both sides, using the upstream `model` field in the proxy log, not the display name.
      - (e) **Differences Prism should match.** Any marker placement or affinity header pi uses that Prism does not. This becomes Task 4's first investigation list.
      - (f) **OpenRouter cell:** verify the pinned `anthropic/claude-haiku-4.5` model on both sides and pi's `--provider openrouter` command, using the same isolation/base-URL procedure. Source-only lever evidence already exists in plan 203; no paid wire run unless the owner authorizes it and `PRISM_LIVE_OPENROUTER_PAID=1`. Record `unmeasurable` with that reason while authorization is limited to the random free router.
    - Functional: The note fixes the test matrix (one model per provider and route, from plan 183 Task 1 (e), which pi also lists), the workload (Task 3), and the cell budget.
    - Performance: n/a — read-only; at most one short pi run per provider.
    - Code Quality: Every config fact cites pi's docs URL and date, or the installed source path and version.
    - Security: No pi config file with a key is written inside the repository; `~/.pi/agent/auth.json` is never read by the runner or quoted in the note.
  - Approach:
    - Documentation Reviewed:
      - `pi --help` (1.3.0: `--print`, `--mode json`, `--no-session`, `--model provider/id`, `--thinking`, the `--no-*` switches), `pi --list-models hyper|opencode-go`, pi's docs on custom providers and base URLs (find-docs), plan 182 Task 5 (`scripts/wire-proxy.mjs`), plan 183 Task 1.
    - Options Considered:
      - Crush for Hyper and OpenCode for OpenCode Go. Replaced by the owner on 2026-10-16: pi is installed with both providers configured, and one reference for both providers keeps the comparison simpler.
      - Read pi's session files for usage. Rejected: `--no-session` keeps runs ephemeral, and the proxy measures both harnesses the same way.
      - Run pi with the owner's normal extensions and MCP servers. Rejected: they add tools and prompts that differ between machines and change the prefix; the baseline is pi's own coding-agent behaviour.
    - Chosen Approach:
      - Check pi's headless and base-URL facts first, so the runner is built on them.
    - API Notes and Examples:
      ```bash
      bun scripts/wire-proxy.mjs --upstream https://hyper.charm.land/v1 --listen 127.0.0.1:8787 --usage-log /tmp/pi-hyper.jsonl
      # base-URL override per Task 1 (a); then, in the fixture workdir:
      pi -p --mode json --no-session --no-extensions --no-mcp --no-skills --no-prompt-templates --no-context-files --no-approve \
         --model hyper/<id> --thinking medium "$(cat scripts/cache-parity/task.md)"
      ```
    - Files to Create/Edit:
      - this plan (task note only).
    - References:
      - owner decisions 2026-10-16 (cache parity; pi as the reference, run headless).
  - Test Cases to Write:
    - n/a — read-only.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 2: Wire-level prefix stability
  - Acceptance Criteria:
    - Functional: `prefixStabilityConformance` (`src/testing/prefix-stability-conformance.ts`) gains `encode?: (request: ProviderRequest) => Promise<JsonObject>`, plus `segments?: (body) => { tools?: unknown; system?: unknown; messages: unknown[] }` with defaults for the OpenAI Chat and Anthropic Messages formats. For each consecutive pair it asserts:
      - `JSON.stringify(tools)` is equal;
      - `JSON.stringify(system)` is equal;
      - `messages[i]` is byte-equal for every `i` below the earlier request's last index, allowing only cache markers to move. The comparison ignores `cache_control` on the earlier request's last block, and the default breakpoint is allowed to move forward (plan 182 Task 8).
      A failure names the segment, the index, and the first differing byte offset.
    - Functional: Each of `hyper` and `opencode-go` runs it for each route over a ten-turn tool loop on the replay harness. The run uses the package's real encoder with thinking replay on, and a skill load mid-session, which is the existing fixture's scenario. The kernel's built-in `openai-compatible` provider runs it too.
    - Performance: Each run is under 500 ms offline.
    - Code Quality: The encoder comes from the package (its exported route encoder or the routed provider's `encode` seam added in plan 182 Task 7); no re-implementation in the test.
    - Security: n/a — offline fixtures with no secrets.
  - Approach:
    - Documentation Reviewed:
      - `src/testing/prefix-stability-conformance.ts:1-60` (request-level runner, `minContinuity`); plan 182 Tasks 7–8; `src/__tests__/prefix-stability-conformance.test.ts`.
    - Options Considered:
      - Compare the whole encoded body as a byte prefix. Rejected: JSON field order places `tools` after `messages` in the Chat body, so a growing message list always shifts later bytes. Segment equality is what the upstream cache keys on.
    - Chosen Approach:
      - Segment equality on the real encoder, in the existing conformance runner.
    - API Notes and Examples:
      ```ts
      await prefixStabilityConformance({
        host, skills,
        encode: (r) => hyperRouteEncoder("anthropic")(r),
        segments: anthropicSegments,
      });
      ```
    - Files to Create/Edit:
      - `src/testing/prefix-stability-conformance.ts`, `src/__tests__/prefix-stability-conformance.test.ts`, `src/provider-kit/routed-provider.ts` (an `encode(request)` method on the returned provider, if plan 182 did not add one), `packages/providers/{hyper,opencode-go}/src/__tests__/prefix-stability.test.ts` (new), `scripts/compat-baseline/arnilo__prism.txt` (if `/testing` or kit signatures change), `docs/testing.md`, `docs/provider-kit.md`, `CHANGELOG.md`.
    - References:
      - plan 182 Tasks 7–8.
  - Test Cases to Write:
    - `wire_prefix_detects_reordered_tools`, `wire_prefix_detects_mutated_earlier_message`, `wire_prefix_detects_system_timestamp`, `wire_prefix_allows_moved_cache_marker`: each seeds one defect and fails on it.
    - `hyper_wire_prefix_stable_{openai,anthropic}`, `opencode_go_wire_prefix_stable_{openai,anthropic}`, `builtin_wire_prefix_stable`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new `/testing` option.
    - Docs pages to create/edit:
      - `docs/testing.md` (prefix stability, wire mode), `docs/provider-kit.md` ("Cache-friendly encoders").
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 3: The parity runner
  - Acceptance Criteria:
    - Functional: `scripts/cache-parity/` contains:
      - `fixture/`: a small git repository template (about 15 files, one failing unit test and a short README), so a coding agent needs several reads, an edit, and a test run.
      - `task.md`: one fixed prompt ("Make the failing test pass without changing the test; run the tests; stop when green").
      - `run.mjs --provider <hyper|opencode-go|openrouter> --model <id> [--runs 3] [--harness prism,pi]`. The OpenRouter cell requires `PRISM_LIVE_OPENROUTER_PAID=1` and the pinned Anthropic model; it must not select a router alias.

      For each run, the runner:
      1. copies the fixture into a temp dir;
      2. starts `wire-proxy.mjs` with `--usage-log`;
      3. runs the harness with its base URL pointed at the proxy: Prism through `apps/prism-agent`'s one-shot coding worker (`hyper`/`opencode-go`/opt-in `openrouter` package, `baseUrl` override, `toolsCoding({ root })`, approval `allow`), and pi through the Task 1 headless command, with its base URL pointed at the proxy using the run-scoped override (never by editing `~/.pi`);
      4. stops at a turn ceiling (Prism `limits.maxTurns: 20`; for pi, a wall-clock timeout and a request ceiling enforced by the proxy (it returns 429 after the cell budget));
      5. records whether the fixture test passes at the end.
    - Functional: Metrics per run, from the proxy log only:
      - `requests`;
      - `promptTokens = Σ inputTokens`, using plan 182 Task 4's inclusive rule, applied by the proxy's own reader;
      - `cacheRead = Σ cacheReadTokens` and `cacheWrite = Σ cacheWriteTokens`;
      - `hitRate = cacheRead / promptTokens`;
      - `firstTurnExcludedHitRate`, the same over requests 2..n;
      - `taskSolved`.

      Report per cell: the median and spread over runs for each harness. A run where the task was not solved is reported, but excluded from the comparison only if *both* harnesses solved the task in at least 2 of 3 runs. Otherwise the cell is marked `inconclusive`.
    - Functional: Cross-check: for the Prism runs, the usage events Prism emitted (from the JSONL output) equal the proxy's figures per request. A mismatch fails the run with `usage_mismatch`, which is a Prism bug in the normalizer or codec.
    - Functional: Output is `docs/_evidence/cache-parity/<provider>-<model>-<date>.{json,md}` with Prism's commit and pi's version, model, route each harness used, per-run metrics, and medians. It contains no secret: the runner scans it with `assertNoSecretLeak` against the keys.
    - Performance: Budget per cell: at most 3 × 2 runs × 20 requests = 120 requests. The runner aborts a cell that exceeds it, reports `budget_exceeded`, and states the ceiling in `scripts/cache-parity/README.md` and the manifest row.
    - Code Quality: Pure metric functions, unit-tested; harness launch is behind an injected `spawn`, so `run.test.mjs` runs offline with a fake upstream and scripted harnesses. No new dependency.
    - Security:
      - The proxy listens on loopback only.
      - pi's run-scoped override files are written into the temp dir, never the repo. `~/.pi/agent` is checksummed before and after each run, and any change fails the run with `reference_config_mutated`.
      - Keys reach child processes through the environment, never as arguments (no `--api-key`).
      - Child stdout and stderr are scanned for the Prism keys before they are stored.
  - Approach:
    - Documentation Reviewed:
      - Task 1 (pi headless facts); plan 182 Task 5 (proxy); `apps/prism-agent/README.md` (one-shot JSONL mode, coding worker); `apps/prism-agent/src/{cli,scenarios}/*`.
    - Options Considered:
      - Compare Prism to the reference on synthetic prompts without tools. Rejected: cache behaviour in agent loops (tool results, thinking replay) is the claim being tested.
      - One run per harness. Rejected: harnesses are non-deterministic; three runs and medians are the minimum to separate noise from a real gap.
    - Chosen Approach:
      - A real coding task, same model, same proxy, medians over three runs.
    - API Notes and Examples:
      ```bash
      export PRISM_LIVE_ENV_FILE=~/.config/prism/live.env
      bun scripts/cache-parity/run.mjs --provider hyper --model qwen3.6-plus --runs 3
      # → docs/_evidence/cache-parity/hyper-qwen3.6-plus-2026-10-20.md
      #   prism      hitRate median 0.86 (0.84–0.88)  solved 3/3
      #   pi 1.3.0   hitRate median 0.83 (0.80–0.85)  solved 3/3
      ```
    - Files to Create/Edit:
      - `scripts/cache-parity/{run.mjs,metrics.mjs,harnesses.mjs,README.md,task.md}` (new; `harnesses.mjs` has two entries, `prism` and `pi`), `scripts/cache-parity/fixture/**` (new), `scripts/cache-parity/run.test.mjs` (new), `apps/prism-agent/src/cli/*` (a `--base-url` override for the provider package if the one-shot CLI lacks it; tentative until Task 1), `docs/live-testing.md` ("Cache parity"), `CHANGELOG.md`.
    - References:
      - plans 182, 183.
  - Test Cases to Write:
    - `metrics_compute_inclusive_hit_rate`, `metrics_exclude_unsolved_runs_only_when_both_solved`, `runner_marks_inconclusive_cell`, `runner_aborts_on_budget`, `runner_flags_usage_mismatch`, `runner_scans_outputs_for_keys`, `runner_writes_reference_config_outside_repo`, `runner_fails_if_pi_config_mutated`, `runner_never_passes_key_as_argument`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — operator tooling.
    - Docs pages to create/edit:
      - `docs/live-testing.md`, `scripts/cache-parity/README.md` (how to run, the budget, how to read the report).
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

- [ ] Task 4: The parity gate and the first run
  - Acceptance Criteria:
    - Functional: `scripts/live-matrix.json` gains `release/cache-parity`: `requires: ["PRISM_LIVE_PROVIDER_TESTS", "PRISM_LIVE_CACHE_PARITY", "HYPER_API_KEY", "OPENCODE_GO_API_KEY"]` plus `pi` on `PATH` with both providers ready (`pi auth` reports them; a missing binary or provider skips the cell with a reason, and strict mode fails it). Cells: Hyper chat route, Hyper Anthropic route, OpenCode Go chat route, OpenCode Go Anthropic route, with models from Task 1, plus the pinned OpenRouter Anthropic cell above. The row's `optional` list includes `PRISM_LIVE_OPENROUTER_PAID` and `OPENROUTER_API_KEY`; the runner enables that cell only for paid flag `1` and owner authorization, without gating the four existing cells on an OpenRouter key. Explicit paid opt-in with a missing key fails strict mode. `scope` lists all five cells; `cost` states 120 requests per enabled cell, and the separate provider probe's `turns` generation requests (default 4) plus catalog discovery. The OpenRouter cell invokes `pi -p --mode json --provider openrouter` with its pinned model and Task 1's isolation flags. While unauthorized, record the cell as `unmeasurable` with a reason; do not claim parity.
    - Functional: The gate passes when, for every conclusive cell, Prism's median `hitRate` is at least pi's median `hitRate`, and no Prism run reports `usage_mismatch`. An `inconclusive` cell fails strict mode and is rerun once.
    - Functional: The first run is recorded in `docs/_evidence/cache-parity-0.13.0.md`: commit, harness versions, a per-cell table, and a verdict. If Prism is behind on a cell, the executor investigates before changing code (`investigate-first` skill). The candidates, in order: the prefix segment that changed between requests (Task 2's runner on the recorded bodies), marker placement compared with pi's (Task 1 (c)), and a missing affinity header (Task 1 (d)). The fix lands in the owning plan 182 or 182 task, which is reopened with a note, and the cell is rerun. The evidence file keeps every run.
    - Performance: Record actual requests per cell against the ceiling.
    - Code Quality: The gate logic lives in `scripts/cache-parity/metrics.mjs`, not in the manifest runner.
    - Security: Same as Task 3.
  - Approach:
    - Documentation Reviewed:
      - `scripts/live-matrix.mjs` (row schema, strict mode); Task 3 report format; plan 186 Task 1 (triage classes).
    - Options Considered:
      - Allow a tolerance (Prism within 2 points of the reference). Rejected: the owner asked for "at least equal". Noise is handled by medians and one rerun of an inconclusive cell, not by a margin.
    - Chosen Approach:
      - A strict per-cell comparison of medians, a recorded first run, and an investigation loop for any gap.
    - API Notes and Examples:
      ```bash
      PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live
      ```
    - Files to Create/Edit:
      - `scripts/live-matrix.json`, `docs/live-testing.md` (generated table), `scripts/cache-parity/metrics.mjs`, `docs/_evidence/cache-parity-0.13.0.md` (new), `docs/_evidence/cache-parity/*` (reports), `CHANGELOG.md`.
    - References:
      - owner requirement 2026-10-16 ("cache hit rate at least equal to the native harnesses").
  - Test Cases to Write:
    - `parity_gate_passes_when_prism_median_at_least_pi`, `parity_gate_fails_on_lower_median`, `parity_gate_fails_on_usage_mismatch`, `parity_gate_strict_fails_inconclusive`, `parity_row_skips_without_pi`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit:
      - `docs/live-testing.md` (generated row), evidence files.
    - `docs/index.md` update: no
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`

## Verification (whole plan)

- `bun run build:core`
- `bun run typecheck`
- `bun test --timeout=0 src/__tests__/prefix-stability-conformance.test.ts`
- `bun run --filter '@arnilo/prism-provider-*' test`
- `bun test --timeout=0 scripts/cache-parity/run.test.mjs scripts/live-matrix.test.mjs scripts/live-doc-check.test.mjs`
- `bun test --timeout=0 src/__tests__/docs.test.ts`
- `bun scripts/release.mjs gate`
- `PRISM_LIVE_STRICT=1 PRISM_LIVE_CACHE_PARITY=1 PRISM_LIVE_FILTER=release/cache-parity bun run test:live` (owner env file; `pi` installed with Hyper and OpenCode Go configured)
- `bun run test`

## Compromises Made

- To be filled after tasks are completed and tests pass.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority.
