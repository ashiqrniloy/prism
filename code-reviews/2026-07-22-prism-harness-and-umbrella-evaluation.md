# Prism coding-harness and npm umbrella evaluation — 2026-07-22

## Scope and evidence

Evaluated commit `4e8f5731507d8586738c276785a759820b331023` (`0.0.12` working tree), core plus all 34 first-party workspaces. Compared Prism against current documented Claude Code, Codex CLI, and OpenCode capabilities.

Local verification:

- `npm run sdk:ready`: **pass**, 41 seconds.
- Test total across core/workspaces: **2,091 tests; 2,058 pass; 33 explicit live skips; 0 fail**.
- Source size excluding generated `dist`: **59,238 production TypeScript lines / 342 files; 39,933 test lines / 200 files**.
- Pack: all 35 manifests pass. Core is **567.6 kB packed / 2.0 MB unpacked**; largest optional package is coding-agent at **84.6 kB / 372.1 kB**.
- Audit: **0 critical/high, 2 moderate**. Both are the MCP SDK's transitive `@hono/node-server` Windows encoded-backslash path-traversal advisory.
- Registry: `@arnilo/prism@0.0.12` and 0.0.12 profile packages are **not published**. npm `latest` is 0.0.11; this tree is one commit after tag `v0.0.11`.
- Temporary clean installs from local tarballs:

| profile | first-party packages | external packages | installed bytes |
| --- | ---: | ---: | ---: |
| `prism-base` | 6 | 5 | 3.38 MB |
| `prism-code` | 11 | 94 | 18.89 MB |
| `prism-sdk` | 11 | 106 | 20.97 MB |
| `prism-providers` | 11 | 2 | 3.00 MB |
| `prism-all` | 35 | 163 | 47.64 MB |

Counts include npm-resolved peers. `prism-code` currently reaches workflows through coding-agent's required peer and Zod through MCP's direct dependency even though its manifest and footprint docs undercount both.

External comparison sources:

- Claude Code: [overview](https://code.claude.com/docs/en/overview), [extension model](https://code.claude.com/docs/en/features-overview), [subagents](https://code.claude.com/docs/en/sub-agents), [hooks](https://code.claude.com/docs/en/hooks-guide), [permissions](https://code.claude.com/docs/en/permissions), [MCP](https://code.claude.com/docs/en/mcp).
- Codex: [CLI](https://developers.openai.com/codex/cli/features), [CLI reference](https://developers.openai.com/codex/cli/reference), [sandboxing](https://developers.openai.com/codex/concepts/sandboxing), [AGENTS.md](https://developers.openai.com/codex/guides/agents-md), [skills](https://developers.openai.com/codex/skills), [MCP](https://developers.openai.com/codex/mcp), [source](https://github.com/openai/codex).
- OpenCode: [intro](https://opencode.ai/docs), [agents](https://opencode.ai/docs/agents), [tools](https://opencode.ai/docs/tools), [permissions](https://opencode.ai/docs/permissions), [MCP](https://opencode.ai/docs/mcp-servers), [plugins](https://opencode.ai/docs/plugins), [source](https://github.com/anomalyco/opencode).

## Executive verdict

### Can Prism power a competitive coding harness?

**Yes as an engine; no as a finished product today.**

Prism already has enough runtime capability to underpin a serious coding harness: normalized provider streaming, bounded tool loops, steering, context budgets, compaction, durable sessions, approvals, sandbox composition, coding/Git tools, MCP, web/browser adapters, multi-agent/workflow primitives, AG-UI/ACP adapters, persistence, telemetry, and evaluations.

It does **not** yet provide the integrated reference host users compare with Claude Code, Codex, or OpenCode. The shipped `prism` binary accepts only the mock provider unless an embedding host supplies `createSession`; `prism-code` is install-only and has no exports or binary. There is no first-party TUI, IDE client, provider login/config flow, persistent session picker, default coding-agent assembly, LSP tool, background terminal manager, per-turn undo/redo, or real coding-quality benchmark.

Ratings:

| view | rating | verdict |
| --- | ---: | --- |
| General agent SDK foundation | 8.5/10 | Strong, unusually bounded and composable. |
| Coding-harness backend foundation | 8/10 | Core capabilities exist; integration remains host work. |
| Out-of-box local coding agent | 3/10 | Not a usable competitor after install. |
| Evidence for coding effectiveness | 4/10 | Excellent unit/security evidence; no end-to-end coding benchmark. |
| Production safety architecture | 8/10 | Strong fail-closed design; Docker-only reference sandbox raises deployment friction. |

Do not market Prism itself as a Claude Code/Codex/OpenCode competitor yet. Market it as a **coding-agent SDK capable of powering one** until a first-party reference host and end-to-end quality evidence exist.

## Competitive capability matrix

| capability | Prism | Claude Code / Codex / OpenCode baseline | assessment |
| --- | --- | --- | --- |
| Provider abstraction | Eight direct HTTP adapters, AI SDK adapter, OpenAI-compatible subpath | Claude is primarily Anthropic; Codex primarily OpenAI plus local/custom paths; OpenCode broad provider support | **Strength**. Prism is more provider-neutral than Claude/Codex. |
| Agent/tool loop | Multi-round tools, bounded concurrency, retry, steering, custom loop, artifact validate/revise | All three provide mature coding loops | **Competitive primitive**. Needs coding-host defaults and real task evidence. |
| Coding tools | shell/read/write/edit/list/search; structured Git/check/handoff | All provide shell/file/search; Codex/OpenCode add polished patch/diff flows | **Good base**, missing glob/gitignore-aware discovery, LSP, background terminal, integrated undo. |
| Context management | Budgets, omission reports, skills, system/project prompts, two compaction strategies | All compact; Claude/Codex/OpenCode progressively load skills/instructions | **Strong primitive**. Host assembly is too manual. |
| Sessions | memory/JSONL/SQLite/Postgres, branching/fork/clone/search, durable resume | Competitors expose session pickers, rename/archive/resume and cross-surface continuation | **Backend stronger than UX**. |
| Permissions | Core permission/trust/guardrail seams; coding execution policy; durable approvals | Competitors expose ready-to-use interactive modes/rules | **Strong enforcement, weak product UX**. |
| Sandbox | Disposable non-root digest-pinned Docker adapter; unified sandbox tree | Codex uses native OS sandboxes; Claude combines permissions and sandbox; OpenCode defaults are more permissive | **Secure but operationally heavy**. Add one native/local reference before low-friction parity. |
| MCP | Bounded client/server bridge, roots/sampling/elicitation, OAuth-capable HTTP | Table stakes in all three | **Competitive**, with moderate transitive advisory to track. |
| Web/browser | Brave/Exa/Firecrawl tools and host-supplied Playwright tools | Claude has web/Chrome; Codex has web search and MCP browser paths; OpenCode has built-in web tools | **Capabilities exist**, but `prism-code` does not install web tools and no host enables them. |
| Multi-agent | Supervisor, A2A, workflows, child delegation | Claude has rich subagents/teams; Codex and OpenCode expose subagent threads | **Backend exists**, but no simple coding subagent UX, isolated context orchestration, or worktree defaults. |
| Hooks/plugins | Middleware, extension kernel, contribution registries, inert discovery | Claude has broad lifecycle hooks/plugins/marketplaces; Codex now exposes hooks/plugins; OpenCode auto-loads JS/npm plugins | **Material gap**. Prism supplies APIs, not a usable extension ecosystem. |
| LSP/code intelligence | None | Claude and OpenCode document LSP/code-intelligence tooling; IDE clients add context | **P0 gap for large typed repositories**. |
| UI/protocol | print/JSON/RPC plus AG-UI and ACP mapping | Competitors ship TUI, IDE, desktop, web, remote control | **Largest product gap**. Protocol adapters are not a client. |
| Auth/config | Credential contracts, encrypted/keychain package, OpenAI Codex OAuth | Competitors ship interactive login, model/provider/config screens | **Primitive only**. No ready coding-host flow. |
| Evals/telemetry | Bounded eval package, OTel-like adapter, detailed limits | Competitors have internal product telemetry/evals; Codex and Claude expose usage/status | **Good SDK feature**, but no coding success benchmark. |

## What Prism does especially well

1. **Authority boundaries are explicit.** Providers, credentials, tools, stores, permissions, and extension activation remain host-owned. Unknown tools/providers fail closed.
2. **Resource ceilings are pervasive.** Provider frames, tool I/O, searches, shell output/time, browser actions, MCP payloads, workflows, persistence, and protocol streams have default and hard caps.
3. **Durability is a real primitive.** Session stores, run ledgers, checkpoint CAS, leases, ownership scopes, interruption/resume, SQLite/Postgres adapters, and replay are substantially beyond a toy loop.
4. **Provider implementation quality is high for a 0.x SDK.** Native adapters preserve provider-specific tools, media, thinking, usage, cache behavior, and model discovery while sharing bounded transport primitives.
5. **Testing/release discipline is strong.** Offline packed-consumer checks, export guards, conformance suites, docs checks, network-free defaults, security workflows, and live-test gates are unusually thorough.
6. **Package activation is safe.** Umbrellas install capabilities but do not start providers, listeners, browsers, telemetry, databases, or shell tools.

## Blocking gaps before a competitive coding-host claim

### P0 — Ship one integrated reference coding host

Current `src/cli-runner.ts` rejects every provider except `mock`; `templates/init/src/agent.ts.tmpl` creates a generic helpful assistant without coding tools, validation, policy, persistence, compaction, or UI. This proves SDK wiring, not a coding product.

Build one thin host over existing primitives, not more runtime abstractions. It needs:

- provider/model setup and interactive API-key/OpenAI Codex login;
- default `createCodingTools` + JSON Schema validator + permission/approval composition;
- persistent local sessions with resume/fork/search;
- coding compaction and context budget defaults;
- readable streaming tool/diff/check output;
- plan/build modes, user questions, abort/steer, and session status;
- optional MCP and web-tool configuration;
- TUI or an ACP client. A TUI gives shortest path to parity.

Best package boundary: a first-party app such as `@arnilo/prism-code-cli`, or a `prism code` subcommand that explicitly loads installed optional packages. Do not make core auto-activate tools or credentials.

### P0 — Add coding effectiveness evaluation

Current `benchmark-0.0.9` measures fake list/search/Git/browser throughput. Later benchmarks measure context/search/protocol overhead. These prove bounds and regressions, not whether an agent fixes software.

Add a reproducible, versioned end-to-end suite with:

- multi-file bug fixes;
- repository exploration;
- tests failing then passing;
- malformed/truncated tool calls;
- long-context compaction and resume;
- dependency docs lookup;
- permission/sandbox denials;
- at least one established external coding benchmark adapter.

Report success rate, retries, tool calls, tokens, cost, wall time, and patch validity by model/provider. No competitive claim is supportable without this.

### P0 — Add code intelligence and better repository discovery

`@arnilo/prism-coding-agent` has no LSP/symbol tool. `repo_list`/`repo_search` use Node filesystem traversal and hard-coded exclusions, not `.gitignore`/`.ignore`; there is no `repo_glob`. Competitors expose globbing and, increasingly, symbol-level navigation.

Minimum additions:

- host-supplied `CodeIntelligenceOperations` with one LSP reference adapter;
- definition, references, hover, symbols, diagnostics;
- gitignore-aware file enumeration, preferably via `git ls-files` first and existing traversal as fallback;
- glob filtering without adding a large dependency.

### P1 — Long-running command and change-management UX

Current shell waits for completion. Add a bounded background process/terminal handle with poll/read/stop. Integrate per-turn patch snapshots or Git-backed undo/redo. Structured Git exists, but users cannot undo the last agent turn as they can in OpenCode, nor inspect long-running checks while continuing the conversation.

### P1 — Make subagents simple for coding hosts

Supervisor/workflows can implement delegation, but they are not equivalent to a built-in Explore/Plan/Review agent model. Add thin reference compositions for read-only exploration, review, and isolated worktree execution. Keep existing supervisor/workflow primitives; do not add another engine.

### P1 — Extension UX

Contribution discovery is deliberately inert. That is safe, but a competitive host still needs explicit trusted plugin loading, lifecycle hooks, commands, and package distribution. Build this in the reference host with trust prompts and allowlists; keep core's explicit registries.

## First-party package evaluation

### Core and runtime packages

| package | verdict | notes |
| --- | --- | --- |
| `@arnilo/prism` | **Keep; production-quality SDK core with 0.x caveat** | Strong contracts/runtime/limits/persistence seams. Main debt: `contracts.ts` and `agents.ts` are large change hotspots; split only when active changes justify it. CLI is smoke/RPC scaffolding, not a real provider/coding CLI. |
| `@arnilo/prism-tool-validator-json-schema` | **Keep** | Small, bounded Ajv adapter. Correct home outside dependency-free core. Safe default profiles should include it. |
| `@arnilo/prism-workflows` | **Keep** | Rich durable DAG/schedule/replay/coordination layer with strong tests. Useful for hosted/background coding, but too much wiring for ordinary interactive coding without reference composition. |
| `@arnilo/prism-evals` | **Keep, expand coding datasets** | Good bounded evaluator primitives. Current package proves evaluator behavior, not coding-agent quality. |
| `@arnilo/prism-server` | **Keep optional** | Framework-free Web boundary is appropriately small and inert. Not a replacement for app server/TUI session APIs. |
| `@arnilo/prism-supervisor` | **Keep optional** | Solid bounded local delegation/A2A. Needs simpler coding subagent presets rather than more protocol surface. |
| `@arnilo/prism-ag-ui` | **Keep optional; fix dependency metadata** | Useful AG-UI/ACP bridge with default-deny projection. It is not a UI. `zod` is declared as a peer but unused by package source and already owned by protocol dependencies; remove unless an actual public type requires it. |

### Coding and execution packages

| package | verdict | notes |
| --- | --- | --- |
| `@arnilo/prism-coding-agent` | **Keep; highest-priority capability work** | Strong bounded shell/file/edit/Git/check foundations. Missing LSP, glob/gitignore behavior, background process handles, turn undo, and simple subagent/worktree composition. Root barrel imports `goal-verify`, making workflows a required peer for users who only need file tools. Move workflow integration to `./workflows` or another package. |
| `@arnilo/prism-coding-security` | **Keep** | Approval/containment and unified Docker tree are strong. Add a lower-friction native sandbox adapter only when a first-party coding host needs it. Do not weaken Docker defaults. |
| `@arnilo/prism-browser` | **Keep optional** | Good policy and bounded host-supplied Playwright seam. Correctly excluded from focused profiles today; browser binary remains host-owned. |
| `@arnilo/prism-web-tools` | **Keep; add to coding profile** | Tiny native-fetch package with useful bounded research tools. Coding agents routinely need current docs. Activation and credentials remain explicit, so profile inclusion is low risk. |

### Context, memory, and persistence

| package | verdict | notes |
| --- | --- | --- |
| `@arnilo/prism-compaction-llm` | **Keep; coding profile should include directly** | Coding preset is directly relevant and small. |
| `@arnilo/prism-compaction-observational-memory` | **Keep optional; remove from base/code profile path** | Sophisticated source-backed memory, but it is an alternative strategy, not part of a minimal base or every coding host. |
| `@arnilo/prism-memory` | **Keep; split/optionalize PostgreSQL dependency** | In-memory/contract users currently install `pg` because PostgreSQL implementation shares the root entrypoint. Move PostgreSQL adapter to a subpath with optional peer or separate package. |
| `@arnilo/prism-rag` | **Keep explicitly optional** | Clean small text/Markdown layer. Not yet competitive with mature RAG stacks: no loaders, rerankers, hybrid retrieval, or broad vector adapters. Do not add to focused umbrellas. |
| `@arnilo/prism-session-store-sqlite` | **Keep explicit** | Best default local durable store, but native `better-sqlite3` should not enter base/code automatically until reference host needs it. |
| `@arnilo/prism-session-store-postgres` | **Keep explicit** | Appropriate production adapter. Never add to focused local profiles. |

### Credentials, observability, and protocols

| package | verdict | notes |
| --- | --- | --- |
| `@arnilo/prism-credentials-node` | **Keep; split/optionalize keychain** | Encrypted-file users currently install native `@napi-rs/keyring`. Separate keychain subpath/package or make native peer optional. This is the main avoidable `prism-sdk` install cost/risk. |
| `@arnilo/prism-observability-opentelemetry` | **Keep; fix manifest** | Source uses structural tracer/meter interfaces and README says `@opentelemetry/api` is an optional peer, but manifest declares no such peer. Add optional peer or revise README. |
| `@arnilo/prism-mcp` | **Keep in coding/SDK profiles** | MCP is table stakes and implementation is bounded. Track/upgrade the SDK when the Hono advisory is fixed. Its transitive graph causes most `prism-code` external package count; that cost is justified only because MCP is expected in the profile. |

### Provider packages

| package | verdict | notes |
| --- | --- | --- |
| `@arnilo/prism-provider-openai` | **Keep** | Strongest provider package: Responses, media/upload, model metadata, Codex OAuth. |
| `@arnilo/prism-provider-anthropic` | **Keep** | Native Messages, tools, cache controls, thinking, media, discovery. Add scaffold support. |
| `@arnilo/prism-provider-google` | **Keep** | Native Gemini generateContent/tools/media. Add scaffold support; Vertex remains a documented gap. |
| `@arnilo/prism-provider-openrouter` | **Keep** | Valuable broad routing and cache/model behavior. |
| `@arnilo/prism-provider-kimi` | **Keep** | Useful coding-specific adapter; specialized but small. |
| `@arnilo/prism-provider-zai` | **Keep** | Useful coding/reasoning adapter; specialized but small. |
| `@arnilo/prism-provider-opencode-go` | **Keep** | Distinct auth/routes justify package. Prior consumer bug report now has regressions. |
| `@arnilo/prism-provider-neuralwatt` | **Keep while actively supported** | Most specialized adapter; good tests but should remain in all-provider/all only. |
| `@arnilo/prism-provider-ai-sdk` | **Keep atomic; make AI SDK peer optional for umbrellas** | Runtime uses only the host model object; `@ai-sdk/provider` is a type-level peer. Mark optional so `prism-providers` does not install it for consumers who never import this adapter. Require/document it when adapter is used. |

All direct HTTP provider packages are lightweight and dependency-free at runtime. Offline conformance is strong. Production confidence still depends on protected live canaries; the 33 default skips include credentialed/provider/browser/database/keychain checks.

## Umbrella package decisions

### Recommended graph

```text
prism-base
  @arnilo/prism
  @arnilo/prism-tool-validator-json-schema

prism-code
  prism-base
  prism-coding-agent
  prism-coding-security
  prism-compaction-llm
  prism-mcp
  prism-web-tools
  prism-workflows          # explicit if goal→verify remains part of profile

prism-sdk
  prism-base
  prism-workflows
  prism-mcp
  prism-credentials-node   # after keychain split/optionalization
  prism-observability-opentelemetry

prism-providers
  all nine provider/interoperability packages

prism-compaction
  both compaction strategies

prism-all
  unchanged: every first-party package
```

### Per-umbrella verdict

| umbrella | decision | add | remove/change |
| --- | --- | --- | --- |
| `@arnilo/prism-base` | **Narrow it** | nothing | Remove `@arnilo/prism-compaction`. Core already has default compaction; two optional LLM strategies do not belong in “minimal safe base.” Keep JSON Schema validation. |
| `@arnilo/prism-code` | **Broaden selectively** | `@arnilo/prism-web-tools`; direct `@arnilo/prism-compaction-llm`; make workflows explicit if retained | Stop inheriting observational memory through base. Do not add every provider, browser, AG-UI, evals, telemetry, or DB drivers. |
| `@arnilo/prism-sdk` | **Keep purpose, fix native dependency** | nothing now | Keep focused. Make keychain optional/split so SDK does not force a native module. Base narrowing should remove both optional compaction strategies from SDK transitively. |
| `@arnilo/prism-providers` | **Keep** | nothing | Keep all adapters. Mark AI SDK peer optional to avoid installing unused interop types. |
| `@arnilo/prism-compaction` | **Keep** | nothing | Correct family package for users who explicitly want both strategies. |
| `@arnilo/prism-all` | **Keep unchanged** | every new first-party runtime package by definition | It is intentionally heavy and should retain both DB adapters/UI/browser/etc. Do not use it as recommended production install. |

### Packages that should not be added to `prism-code`

- **All providers:** provider choice and auth remain deployment decisions. Continue documenting `prism-code + chosen provider`.
- **SQLite/Postgres:** native/local versus server persistence is a host choice.
- **Browser:** useful but requires host Playwright/browser/network policy; MCP can cover many coding users.
- **AG-UI/ACP:** protocol choice is a frontend decision and adds substantial protocol dependencies.
- **Evals/OTel:** development/operations concerns, not runtime requirements for every coding host.
- **RAG/general memory:** session compaction and repository tools cover the default coding path; add semantic memory only from measured need.

### Dependency metadata fixes before 0.0.12 publish

1. Move coding workflow integration out of coding-agent root or declare `@arnilo/prism-workflows` directly in `prism-code`; current hidden required peer makes docs and profile counts false.
2. Remove unused `zod` peer from `prism-ag-ui` unless public declarations demonstrably require it.
3. Add README-promised optional `@opentelemetry/api` peer to observability package, or remove install claim.
4. Split/optionalize `@napi-rs/keyring` in credentials-node.
5. Split/optionalize `pg` in memory.
6. Mark `@ai-sdk/provider` peer optional for the AI SDK adapter so provider umbrella remains lean.
7. Update profile footprint docs from the actual clean-install graph.

## Documentation and release-readiness findings

- Root README says “six provider adapters” despite eight direct HTTP adapters plus AI SDK interop.
- Root package table omits Anthropic and Google rows.
- `prism-all` README says “all seven provider adapters” but `prism-providers` contains nine packages.
- `templates/init/providers.json` and `prism init --provider` omit Anthropic and Google.
- Release docs claim `prism-code` reaches 10 first-party packages and three external roots; clean resolution is 11 first-party and four roots (`workflows` enters through coding-agent's peer; `zod` is a direct MCP dependency).
- Release docs' provider live-key list omits `ANTHROPIC_API_KEY` and `GOOGLE_API_KEY`/`GEMINI_API_KEY` even though live tests exist.
- 0.0.12 package installation examples currently point to registry versions that do not exist. Keep “after release” wording consistent across all docs or publish before presenting commands as current.

These are not runtime blockers, but they weaken confidence in umbrella decisions and should be fixed before release.

## Recommended order

1. **Correct 0.0.12 package graph and docs:** hidden peers, native optional dependencies, profile membership, provider counts/scaffold choices.
2. **Ship reference coding host:** real provider + tools + validator + approval + local persistence + coding compaction + TUI/ACP client.
3. **Add end-to-end coding benchmark:** no competitive claim before results.
4. **Add LSP/gitignore-aware discovery/background terminal/undo.**
5. **Add simple Explore/Plan/Review worktree subagent presets and trusted host plugin loading.**
6. **Only then evaluate broader profile additions** from measured install/use data.

## Final recommendation

Prism should continue as a host-owned SDK. Do not move application policy, provider credentials, or automatic capability activation into core. Competitive path is one thin first-party coding application over current primitives, not another wave of framework primitives.

For umbrellas, make `base` genuinely minimal, make `code` explicitly coding-focused (`LLM compaction + web + workflows`), keep provider/storage/UI choices explicit, and preserve `all` as the exhaustive test/convenience install.
