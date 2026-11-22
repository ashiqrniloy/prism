# Session-Bench

Session-Bench is a multi-task, same-session benchmark for agent memory. Prism wrote it for plan 218.3 (Task 9) after a
survey on 2026-11-18. The survey found no published benchmark that meets all five of these criteria:

- one session that holds several agentic loops;
- dependencies the user does not restate;
- a session that outgrows the model's window;
- scoring by state checks or tests;
- an external licence that fits.

This document is the methodology. It is written so that an outside reader can rerun the benchmark and judge it.

## What it measures

The benchmark asks one question: **can an agent finish the later tasks of one long session that depend on earlier work
which has left the context window, and at what cost?**

One session is one scope document plus 8 to 14 user tasks that follow it. The scope document is a numbered plan with one
step per task. Each task is a full agentic loop with tools. The context must outgrow the window several times over.
When a later task needs something from an earlier one, only memory (or re-deriving it from the workspace) can supply it.

It reports:

- tasks passed;
- dependency checks passed, by class;
- re-derivation calls;
- whole-run tokens per passed task;
- the prompt-cache share.

### What it cannot tell you

- **It is authored by the project it measures.** Guardrails G1 to G8 below exist to limit that bias. They cannot remove
  it.
- **The tools are simulated.** The workspace is deterministic and in memory: files, tickets, team channels, a
  key-value config and project checks. It has no shell, no code execution and no network. Tool outputs are large and
  repetitive by design. Real outputs are messier.
- **One model family per run.** A run answers for the model it ran on. The live runs are plan 218.3 Tasks 11 and 12.
- **The user is scripted.** Prompts are templated, so every arm sees the same wording. No simulated user model reacts to
  the agent.
- **It holds four dependency classes.** It does not test long-term memory across sessions, multi-agent work or open-ended
  tasks.

## The environment (`env/workspace.mjs`)

A session's workspace is one JSON document: `files`, `tickets`, `messages` (channels), `config` and `rules`. It has
thirteen tools, the same for every arm and in this order:

| Tools | What they do |
| --- | --- |
| `list_files`, `read_file`, `search_files`, `write_file` | A flat file tree. `search_files` returns literal-match `path:line:text` lines, at most 50. |
| `list_tickets`, `get_ticket`, `update_ticket`, `create_ticket` | A ticket tracker. Each ticket has a status, an assignee, labels, a body and comments. |
| `read_messages`, `post_message` | Team channels such as `#release` and `#ops-gateway-3`. |
| `get_config`, `set_config` | A key-value service config. With no key, `get_config` lists every key. |
| `run_check` | Runs a named project rule. It returns a `PASS`/`FAIL` line for each config key the rule covers. |

Every call is logged with the task it ran in. A tool never throws: a bad argument returns an error string, as a real
tool would. The environment imports nothing from Prism.

## Sessions (`templates/`, `generate.mjs`)

There are three template families:

| Family | Domain | Where its tool facts live (`D1`) |
| --- | --- | --- |
| `service-config` | Upkeep of service configuration | A runbook file |
| `incident-desk` | Following through on incidents | A ticket body |
| `release-train` | Preparing a release | A channel message |

Each task has a **job**: a control piece of work over one large artifact, with its own check. A job is one of these:

- count the `ERROR` lines in a log and record the count;
- close the tickets a channel reports as resolved;
- run a rule check and fix the config value that fails;
- assign a ticket to the owner a guide names.

Each artifact is 17,000 to 18,500 tokens, so each task adds about half a window of tool output.

**Dependency sources** ride on the first tasks, at most two per task. **Dependent parts** fill the last tasks, one per
task. The first dependent task comes at least four tasks after the last source task. So at least three whole tasks lie
between a source and its dependent.

### Dependency classes

Every check carries a class label:

| Class | What it is | Example | Re-derivable? |
| --- | --- | --- | --- |
| `D1` tool-fact | A value read by a tool in task *k* is needed in task *k+m*, and nobody restates it | The incident ticket says "set `auth.timeout_ms` to 4500"; later, "apply the config change that the incident ticket you triaged calls for" | Yes, by re-reading. Re-reads are counted. |
| `D2` user-only | A constraint or preference stated only in conversation, never in a file or tool output | "every ticket you create from now on must carry the label `heron-42`"; later, "open a ticket to follow up on …" | No |
| `D3` own-decision | A choice the agent made earlier, which a later task must reuse | "add a feature flag for `bulk_export`; choose its name yourself"; later, "turn on the feature flag you added" | Only by guessing. Three look-alikes exist from the start (`flags.bulk_export_legacy`, `_pilot`, `_shadow`; v3), and turning one of them on fails the check. |
| `D4` superseded | A value the user changed mid-session; later tasks must use the new one | "we ship on Tuesday", then "change of plan: we ship on Thursday"; later, "announce the ship day" | No. A stale document still says Tuesday. |
| `C` control | No dependency on an earlier task: every job, and every source's own action | "count the ERROR lines in `logs/billing-4.log` …" | Not applicable. These checks detect harm. |

**Look-alike distractors** sit elsewhere in the workspace: an old runbook, last year's closed incident, a rejected
proposal in the channel, a `_legacy` flag and a stale release document. They hold the same key with a different value.

Every session has a `D2` and a `D4`. Sessions with 10 or more tasks also have a `D1` and a `D3`. Shorter sessions have
one of the two. Sessions with 12 or more tasks add a second `D1` or `D2`.

### Size rules (checked when each session is built)

The generator refuses to emit a session that breaks any of these rules. Sizes come from the oracle's trace: the prompt,
every tool output and the reply. They are counted at 3.5 characters per token, Prism's own estimate for English text.

- The session holds at least **4 × W** tokens.
- Every dependency spans at least **3 whole tasks** and **1.5 × W** tokens, counted from its last source to its
  dependent.
- No single task's output fills the window.

With W = 32K, the frozen set (v3; v1's seed and ids) has these sizes:

| Measure | Value |
| --- | --- |
| Smallest session | 141,227 tokens (4.4 W) |
| Smallest dependency span | 52,349 tokens (1.6 W) |
| Largest task | 25,205 tokens |

### Scope

Each session's scope document is a numbered plan with one step per task. A step names its subject in words that a
record would repeat, such as "triage the auth timeout_ms incident ticket". It never states a dependency's answer.

Every arm gets the scope as its **first user message**. The STM + WM arm also gets it through `memory:scope`. That is how
a host gives working memory its scope.

### User

The user is scripted and deterministic. Each prompt is `Task N. <job sentence> <source or dependent sentences>`. There
is no simulated user model.

### Generator and partitions

A session is a pure function of `SESSION_BENCH_SEED` and its id: `sb-<family>-<nn>`, with 20 per family. Sessions are
rebuilt on demand and never committed.

A **label-blind draw** splits the ids. Within each family, ids are ordered by `SHA-256(seed + ":" + id)` and split into
`dev` (12), `heldout-a` (4) and `heldout-b` (4). The draw reads the ids only.

`../work-outcome-session-bench.json` pins the following:

- the seed;
- `templateHash`: the bytes of every core file;
- `sessionsHash` and `scopesHash`: every generated session and scope;
- the draw and its `idsHash`;
- the window rules;
- counts.

`generate.mjs --check` regenerates the file and compares it byte for byte.

## Scoring (`checks.mjs`, `score.mjs`)

Checks are data, evaluated against the workspace state at the end of the task that owns them. They are deterministic
and never use an LLM judge. The check kinds are:

- `config-equals`
- `ticket-field`
- `tickets-status`
- `created-ticket-labelled`
- `message-posted` (with `includes`, and `excludes` where a check names one; v3's D4 check names none)
- `flag-created`
- `flag-on` (the flag that the source task created is now on and, from v3, none of the feature's look-alikes is)

A stored value matches the expected one when their string forms match (`sameScalar`): the tools accept strings,
numbers and booleans, and `get_config` shows no type, so `"719"` is the agent's 719 and `"false"` its false. This is
**v2** (plan 218.3 Task 11). v1 compared with `===`; on the first live model it failed every right answer the model
sent as a string. The fix changed only `checks.mjs`: v2 keeps v1's seed, sessions and partitions (`sessionsHash` and
`idsHash` unchanged, `templateHash` new). No evidence was recorded on v1.

**v3** (plan 218.3 Task 12, owner 2026-11-19), from Task 11's live findings. (1) The D4 check required the
announcement to include the new day and exclude the old one, so a correct announcement that mentions the change
failed (`oracle-context` passed 2 of 6): v3 requires the new day only. (2) D3 was partly re-derivable: listing the
config showed the agent's own flag beside one `_legacy` look-alike (`amnesic` found it in 1 of 6). v3 adds `_pilot` and
`_shadow` look-alikes per feature and fails the check when any look-alike is on, so turning on every candidate does
not pass. v3 keeps the seed, ids and partitions (`idsHash` unchanged); the look-alike flags change the sessions
(`sessionsHash` new) and the core files (`templateHash` new). Task 11's evidence stays v2 (its rule pins v2's hashes).
A risk recorded with the change: an agent that names its own flag exactly like a look-alike (`flags.<feature>_pilot`)
updates an existing key and fails `flag-created`; the suffixes were picked to be unlikely names for a new flag.

| Measure | Definition |
| --- | --- |
| Task passed | Every check of the task passes |
| Class rate | Checks of that class passed, divided by checks of that class |
| Re-derivation calls | Reads (file, ticket, channel, config key or listing, rule report, search) of an object that an earlier task already read |
| Whole-run tokens per passed task | All input plus all output, of the main agent and of every memory, summary or third-party model call, plus every embedding (`cost.embeddings`), divided by tasks passed |
| Cache share | Cached input tokens divided by input tokens, as providers report them. Offline mocks report none, so the report also gives `simulatedPrefixShare`: the characters each main request shares with the one before it. |

## The window

The window W lives in the harness, never in the product. This is the LOCA-Bench pilot's finding (plan 218.1 Task 4).
The default is **32,000 tokens**, with 2,048 reserved for output.

The runner wraps every provider, for the main agent and every worker:

- It estimates each request as a provider would: Prism's message estimate plus the tools and context blocks.
- It rejects a request over the input cap with `failureClass: "context_overflow"`.
- The model that the product sees declares W as its window.

`--window 64000` gives the sensitivity reading.

## Arms (`arms/`)

All arms share the model, sampling, workspace tools, system prompt, scope message, window and run limits. Only the
memory configuration differs. `arms/prism.mjs` gives every arm its configuration, `arms/references.mjs` holds the
reference compactors and `arms/third-party.mjs` the third-party systems.

**Decision arms** (the rule of plan 218.3 Task 12 reads these):

| Arm | Memory configuration |
| --- | --- |
| `memory-off-llm` | The memory system is not listed. `@arnilo/prism-extensions/compaction` (Prism's LLM-driven compaction) runs at its default trigger, which is the kernel's: 80% of the input cap. Its kept tail is set to session memory's default rule: `keepRecentTokens` = 20% of the input cap. |
| `STM-only` | `@arnilo/prism-memory-system` at its defaults (`stm`, `wm` on). No scope is set, so WM does not run. |
| `STM+WM` | The same config. The scope is set through `memory:scope`, so WM runs its model policy, including the look-ahead. |

**Side arms** (reported beside the decision arms with the same statistic, `sideComparisons` in the report; each one
differs from `memory-off-llm` in one named part):

| Arm | What differs from `memory-off-llm` |
| --- | --- |
| `claude-code-prompt` | The compaction package's `summaryPrompt` is Claude Code's compaction prompt. |
| `codex-prompt` | The compaction package's `summaryPrompt` is the Codex CLI's compaction prompt. |
| `mem0` | Mem0 3.3.1 (open-source library, Apache-2.0) runs beside the compaction at its documented defaults, in its documented pattern. |

**Calibration arms** (the benchmark's own instruments; they differ from the decision arms by design, and G6 exempts
them):

| Arm | Memory configuration |
| --- | --- |
| `oracle-context` | No compaction, and a window (1M) that no session reaches. This is the ceiling. |
| `amnesic` | Each task runs in a fresh session that holds only the scope message. This is the floor. |

**Why the LLM-compaction arms set `keepRecentTokens`.** The compaction package's default tail is an absolute 20,000
tokens. At W = 32K, that tail plus one 18K tool output never fits. With the default, every run after the first
overflowed and the arm passed 3 of 35 tasks: a configuration artefact, not a memory result. Matching the keep budget to
session memory's rule makes the two compaction systems keep the same amount and differ only in how they compact. This
was found during Task 9; the owner confirmed it on 2026-11-18 (Task 10). It applies to `memory-off-llm` and to every side
arm built on it.

### Reference compactors

The two prompts are not copied into the Prism tree. They are read at run time from the pinned Compact-Bench checkout
(arXiv 2610.31710, Apache-2.0, commit `9dd9a3f5…`, `harness/cb_common.py` `PROMPTS["claude"]` and `["codex"]`, which
Compact-Bench transcribed from the agents' CLIs), as plan 218.1 Task 3 used them. Each text is checked against a pinned
sha256, and a missing checkout or a changed text is refused. Fetch the checkout with
`bun scripts/memory-bench/external/compact-bench/fetch.mjs`. The arm config carries the hash, and the package gets the
text.

### Third-party memory systems

Each candidate was checked for four things: (a) a licence that allows this use, (b) a local runtime with no vendor
account, (c) model calls that can go to the same model as every other arm, and (d) countable tokens, embeddings
included. `THIRD_PARTY_CANDIDATES` records the result for each one.

| System | Version | Result |
| --- | --- | --- |
| Mem0 (npm `mem0ai`, `mem0ai/oss`) | 3.3.1 | **Included.** Apache-2.0. An in-process library with local SQLite stores. Its LLM and embedder are OpenAI-compatible clients with a `baseURL`. |
| Letta | 0.34.12 | Excluded. Letta is an agent, not a memory layer. Its memory works only inside its own agent loop, so running it would replace Prism's agent and break G6. |
| Zep | zep-cloud 4.1.0 | Excluded. A vendor-hosted service (account, key, data leaves the machine). Community Edition is no longer published. |
| Graphiti | 0.31.2 | Excluded. At its defaults the reranker scores from token logprobs (`top_logprobs=2`), which Prism's provider stream does not carry, and the LLM client uses the Responses API's structured parsing. Swapping both for non-defaults would break G10. |

**How Mem0 runs.** It uses its documented chat pattern on top of `memory-off-llm`'s compaction:

- After every exchange (the scope message included), the harness calls `add([user prompt, final answer], { userId:
  session })`.
- Before every task, the harness calls `search(task prompt)` at the defaults (top 20, threshold 0.1, BM25 plus entity
  boost).
- The results ride in one context block (`User Memories:` followed by one `- memory` line per result) that stays fixed
  for that task's loop.

These are Mem0's defaults: the additive extraction prompt, the `memory` (SQLite) vector store, the `sqlite` history
store and the search parameters. The harness sets the model, the embedder, the user id and the file paths.

**What Mem0 can reach.** Every chat and embedding call Mem0 makes goes to a local OpenAI-compatible endpoint
(`startModelEndpoint`, 127.0.0.1, an ephemeral port).

- Chat goes to the run's worker model through `windowedProviders`. It meets the same window and is metered as worker
  tokens.
- Embeddings go to the run's embedder and are metered apart (`cost.embeddings`). Offline, the embedder is a hashed bag of
  words. It is a mock, not Mem0's default. Mem0's default embedder (OpenAI `text-embedding-3-small`) needs a vendor key,
  so the live run's embedder is named in the gate record. Task 11 used Gemini `gemini-embedding-001` (`GEMINI_EMBEDDER`,
  3,072 dimensions, tokens estimated at 3.5 characters each because the API reports none; owner, 2026-11-18: OpenCode
  Go and Ollama Cloud serve no embedding model). Its free tier's 1,000 requests a day ended the arm mid-run, so the
  screen (Task 12, owner 2026-11-19: a local embedder, then "BGE-M3 for retrieval quality") uses BAAI `bge-m3` (MIT;
  the FP16 GGUF `gpustack/bge-m3-GGUF` at revision `2d48f173…`, sha256 `daec91ff…`): dense vectors, CLS pooling, 1,024
  dimensions, normalised (`LOCAL_EMBEDDER`). It is served by llama.cpp's `llama-server` (tag `b12533`, Vulkan backend)
  on the discrete AMD GPU, one server per process on 127.0.0.1, with llama-server's own token counts.
  `arms/third-party.mjs --install-embedder` clones llama.cpp, Vulkan-Headers (`v1.4.363`, the installed loader's
  version) and SPIRV-Headers into the cache, builds `llama-server` and downloads the model; `--check-embedder` checks
  the tag and the model's sha256. Both embedders are recorded deviations from Mem0's defaults (G10).
- Telemetry is off (`MEM0_TELEMETRY=false`), and Mem0's files live in a private temporary directory per session.
- A failed `add` or `search` is counted (`thirdPartyErrors`) and never fatal. The run goes on without that memory.

Mem0's extraction prompt alone is about 34,000 characters (about 9,800 tokens per write), so its worker spend is mostly
the prompt. The offline run shows this; the live run measures it.

**Install.** Run `timeout 600 bun scripts/memory-bench/session-bench/arms/third-party.mjs --install`. It runs `npm ci
--ignore-scripts` from the committed lock (`arms/lock/mem0/`) into `$PRISM_CACHE_DIR/session-bench/mem0-3.3.1`, never
into the Prism workspace. Native `better-sqlite3` has no build for this runtime, so the install puts a `bun:sqlite` shim
in its place (`arms/lock/mem0/better-sqlite3-bun`, the subset Mem0 uses), and Mem0's own SQL runs unchanged. `--check`
verifies the version, the lock and the shim. Without the install, the `mem0` arm refuses to run, and its tests are
skipped.

**Pins.** The gate record's `sessionBench` section (`owner-gate-m2.json`) is computed by `arms/pins.mjs`. It holds the
benchmark hashes (G1), every arm's memory-config hash (G6), the reference prompts' hashes, the candidates with their
reasons, Mem0's lock and shim hashes, Mem0's live embedder, and each arm's hash on the live model with the shared hash
(`live`, Task 11). `gate_record_pins_every_arm` fails when the code drifts from it.

## Guardrails against bias (`guardrails.mjs`)

`guardrails.mjs` checks these before any paid call. A failure stops the run.

| Guardrail | What is checked |
| --- | --- |
| **G1** frozen first | The partition file regenerates byte for byte, and its `templateHash` matches the core files. Once a gate record pins the benchmark (`sessionBench` in `owner-gate-m2.json`, Task 11), the record's hashes must match too. Any change is a new benchmark version and voids earlier evidence. |
| **G2** author separation | The core files (`env/`, `templates/`, `checks.mjs`, `agents.mjs`, `generate.mjs`, `score.mjs`) and every relative module they reach import nothing from `packages/memory/**` or any `@arnilo/prism-memory-…` package (such as `@arnilo/prism-memory-system`). This is a transitive import walk. The runner reads `dev` only: `heldout-a` and `heldout-b` stay unread until gate A. |
| **G3** checks are correct | A scripted oracle agent passes every check on every dev session. It takes the ground-truth actions straight against the workspace. |
| **G4** dependencies are real | A scripted amnesic agent, which runs each task with the scope only, fails every `D2` and `D4` check and passes every `C` check. |
| **G5** no leakage | No dependency answer appears in the scope or in the dependent task's prompt. No `D2` or `D4` answer appears in any file or tool output of the initial workspace, nor in any prompt but its own sources'. |
| **G6** equal treatment | The decision and side arms' shared configs hash equal, and the runner refuses an arm that differs outside `memory`. Each arm's config hash is in the report. The gate record pins each arm's memory-config hash (Task 10), and Task 11 adds the live hashes. |
| **G7** blind scoring | Rows are keyed by session, task and check. `scoreRows` refuses any row that names an arm. |
| **G8** pre-registered analysis | `ANALYSIS` in `score.mjs` fixes the analysis. Every arm, comparison and metric is reported, never a subset (`assertCompleteReport`). |
| **G9** full cost | One wrapper meters every provider call: the main agent and the workers separately. A probe run shows that the metered calls equal the provider calls. A third-party system's chat calls pass through the same wrapper, and its embeddings are metered apart. |
| **G10** third-party arms | Each included third-party system (`THIRD_PARTY_ARM_SPECS`) is an arm and declares that it runs at its documented defaults on the same model. |

`ANALYSIS` (G8) fixes these:

| Setting | Value |
| --- | --- |
| Metrics | task success, plus `D1`, `D2`, `D3`, `D4` and `C` |
| Comparisons | `memory-off-llm`→`STM-only`, `STM-only`→`STM+WM`, `memory-off-llm`→`STM+WM`. The side arms are compared with each decision arm in `sideComparisons`, with the same statistic, outside `ANALYSIS`, so adding them did not change the frozen core. |
| Pairing | Paired by check or task id |
| Statistic | `pairedClusterPermutation` (`../stats.mjs`), with sessions as clusters |
| Iterations and seed | 10,000 iterations, seed 7 |

The scripted agents (`agents.mjs`) share one plan per task. A dependent step has a `known` branch and an `unknown`
branch. The `unknown` branch re-derives the value when it can (`D1`), falls for the look-alike (`D3`, `D4`), or acts
without the value (`D2`).

The offline mock model in `run.mjs` uses the same plans. It knows a dependency only when that dependency's evidence
string is visible in the request it is sent: the transcript, a compaction summary or a memory block. The arm's context
handling therefore decides what the mock knows. A test proves this: a compaction summary that carries nothing loses
every `D2` and `D4` check.

## Reproduce

```sh
timeout 600  bun scripts/memory-bench/session-bench/generate.mjs --check     # the frozen v3 set
timeout 1800 bun scripts/memory-bench/session-bench/guardrails.mjs           # G1-G10, before any paid call
timeout 600  bun scripts/memory-bench/session-bench/arms/third-party.mjs --install   # Mem0 into the cache
timeout 1800 bun scripts/memory-bench/session-bench/run.mjs --offline        # dev, all eight arms, on mock models (about 50 s)
timeout 1800 bun scripts/memory-bench/session-bench/run.mjs --offline --per-template 1 --window 64000
timeout 900  bun test --timeout=0 scripts/memory-bench/session-bench
```

The offline run validates the harness. Every arm completes every dev session, and the calibration arms bracket the
results. Its scores are not evidence about memory: the mocks carry what they are shown.

Evidence and reports hold ids, counts, rates and hashes only. They never hold prompts, tool output or model text.

### The live run (`live.mjs`)

The live test run (Task 11) and the decision screen (Task 12) each need the owner's word. Each needs its rule written
into `docs/_evidence/memory-bench/218/gates/owner-gate-m2.json` first: `run.mjs --live` refuses unless
`sessionBenchTest` approves exactly `SESSION_BENCH_TEST_RULE` (its hash) and `sessionBench.live` pins its config hashes;
`screen.mjs --live` refuses unless `sessionBenchScreen` approves exactly `SESSION_BENCH_SCREEN_RULE` and
`sessionBench` pins its benchmark.

```sh
bun scripts/memory-bench/session-bench/live.mjs --rule                 # the rule, its hash and the live config hashes (no call)
# paid, as a systemd --user unit (a long run dies with the shell otherwise):
systemd-run --user --unit=prism-218-3-session-bench-test --collect --working-directory="$PWD" --setenv=PATH="$PATH" \
  -p StandardOutput=append:<log> -p StandardError=append:<log> bun scripts/memory-bench/session-bench/run.mjs --live
bun scripts/memory-bench/session-bench/run.mjs --live --status          # check-in: rows, input spent, projected total
bun scripts/memory-bench/session-bench/run.mjs --live --report          # evidence from the checkpoints
bun scripts/memory-bench/session-bench/guardrails.mjs --live            # the live guardrails of the evidence
```

One job is one (arm, session) with its own provider and wire proxy. A progress file is written after every task and a
checkpoint row (ids, counts, hashes) when the session ends; a re-run resumes from the rows. A quota, overload or
transport answer that outlasts the patient retries waits 15 minutes inside the request and is sent again
(`quotaWaitFetch`), so a quota window never fails a task. A provider error that still reaches a run makes the job a
fault: no row, a wait, the session again from its start. The job pool, the token ceiling and the fault waits are the
LOCA-Bench pilot's (`../external/loca-bench/pilot.mjs` `pool`, `wireUsage`). Order: a smoke job (`memory-off-llm` on the
smallest session), then the calibration arms with the live guardrails (`oracle-context` passes at least 60% of tasks;
`amnesic` fails at least 70% of `D2` and of `D4` checks; a miss stops the run), then the other arms. The report adds
per-arm wall time without quota waits, and the screen's size: sessions needed for the rule's effect at 80% power from
the measured variance of per-session paired differences, and its token cost.

### The decision screen (`screen.mjs`, plan 218.3 Task 12)

The screen runs on the same runner as the test run, with its own rule (`SESSION_BENCH_SCREEN_RULE`, gate section
`sessionBenchScreen`, evidence `docs/_evidence/memory-bench/218/session-bench-screen.json`). The owner fixed these on
2026-11-19, before the run:

- **Sessions and arms.** All 36 `dev` sessions on Session-Bench v3. The arms are the three decision arms and the three
  side arms. The calibration arms are not run again: Task 11's live guardrails held on this model. Any held-out id is
  refused (`assertDevOnly`).
- **Model and treatment.** Task 11's model, sampling, window and limits, so the shared config hash is Task 11's. Mem0
  uses the local embedder. The ceiling is 650M input tokens; Task 11 projected about 520M.
- **Analysis.** Paired by check (dependency, control) or by task, with sessions as clusters.
  `pairedClusterPermutation`, 10,000 resamples, seed 7. The dependency metric is D1 to D4 pooled.
- **STM is worth shipping** if `STM-only` beats `memory-off-llm` on dependency checks (95% interval lower bound > 0)
  and is not worse on control checks (lower bound of the `C` difference > −5 points).
- **WM's model policy is the default under a host scope** only if `STM+WM` beats `STM-only` on dependency checks (lower
  bound > 0) and its whole-run input tokens per passed task are at most 1.5× `STM-only`'s. Otherwise the deterministic
  policy is the default.
- **Side arms.** Each decision arm is compared with each side arm using the same statistic. When a side arm's interval
  lies entirely above a Prism arm's on task or dependency checks, that goes to the owner as a finding.
- **Detectable effect.** The report gives the effect the run could detect at its N, computed from the measured spread
  of per-session paired differences. Task 11's estimate at N = 36: about 23 points for `memory-off-llm` → `STM-only`
  and 8 to 12 points for `STM-only` → `STM+WM`.

`screenVerdict` is a pure function of the report and each arm's paired units. The units are rebuilt blind from the
checkpoint rows (`unitsFromRows`), and `screen.test.mjs` covers every branch on synthetic intervals. Criteria
amendment 11 makes rows M6 and M7 read this evidence.

```sh
bun scripts/memory-bench/session-bench/screen.mjs --rule      # the rule, its hash, the live config hashes (no call)
systemd-run --user --unit=prism-218-3-session-bench-screen --collect --working-directory="$PWD" --setenv=PATH="$PATH" \
  -p StandardOutput=append:<log> -p StandardError=append:<log> bun scripts/memory-bench/session-bench/screen.mjs --live
bun scripts/memory-bench/session-bench/screen.mjs --live --status | --report | --pause | --resume
```
