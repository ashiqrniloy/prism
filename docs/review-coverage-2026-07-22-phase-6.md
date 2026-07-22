# Review coverage — 2026-07-22 Phase 6

Working evidence for Plan 074 Task 0. Freezes Phase 6 / Release **0.0.11** scope, primitive ownership, finite limits, threats, tests, docs, and release gates before implementation.

**Evidence frozen:** 2026-07-22. **Prism source:** `a677113a409b1b60a3361a76c980e7411013916a` (post-0.0.10 / Task 0 freeze). **Release target:** 0.0.11. **Default test rule:** network-free fakes/fixtures; provider live canaries remain gated (`PRISM_LIVE_PROVIDER_TESTS=1` + host keys).

## Status legend

| Status | Meaning |
| --- | --- |
| `existing` | Current public contract covers the requirement. |
| `extend` | Owning task extends an existing core/package contract. |
| `new-package` | New optional workspace package behind existing provider-package seams. |
| `compose` | Existing public primitives suffice; package-local glue / docs / examples only. |
| `out-of-scope` | Coding-harness P2+ or later release; must not land in 0.0.11 tasks. |

## Frozen product decision

0.0.11 closes **coding-harness P1 fundamentals** only: bounded session search/index, assembler-time context budgets with omission reports, native Anthropic then Google provider packages, and a thin goal→verify coding helper/example.

**Not in 0.0.11** (owned by later phases — do not implement here):

| Deferred item | Owner phase |
| --- | --- |
| Additional subscription OAuth adapters | 0.0.12 Phase 7 |
| AG-UI/ACP-facing event adapter | 0.0.12 Phase 7 |
| Coding-aware compaction preset | 0.0.12 Phase 7 |
| Enterprise identity / Azure·Bedrock·Vertex / work connectors | 0.0.13+ |
| Always-on FTS reindex workers / indexer daemons | never in 0.0.11 |
| Goal database / second agent or workflow runtime | never in 0.0.11 |
| Shared core Anthropic Messages serializer extraction | defer until ≥2 byte-identical non-test consumers |
| Soft-raising hard caps; unbounded full-store scans as default search | never in 0.0.11 |

## Frozen external revisions

| Surface | Frozen reference | Compatibility decision |
| --- | --- | --- |
| Prism | [`a677113a409b1b60a3361a76c980e7411013916a`](../plans/074-release-0-0-11-coding-harness-fundamentals.md) | Caller/limit claims checked against shipped 0.0.10 tree. |
| Node.js | Local reference `v24.18.0`; release support remains Node 20 and current | Providers use `fetch` + existing `@arnilo/prism/providers/transport` SSE helpers; no vendor SDKs. |
| Anthropic Messages | ctx7 `/anthropics/anthropic-sdk-typescript` + official Messages docs at impl time | Stream SSE, tools, `cache_control` ephemeral `5m`/`1h`, thinking blocks, usage; package-local wire (OpenCode Go route is pattern only). |
| Google Gemini | ctx7 `/websites/ai_google_dev_gemini-api` + Gemini `generateContent` / stream docs at impl time | Tools/function calling, multimodal `inlineData`, usage metadata; Vertex enterprise identity stays 0.0.13. |
| SQLite FTS5 / PostgreSQL FTS | Adapter docs at impl time | Dialect-local FTS; metadata filters shared shape. |

## Frozen API and mode contract

| Decision | Frozen choice |
| --- | --- |
| Search interface | `SessionIndex` with `search(query: SessionSearchQuery): Promise<PersistencePage<SessionSearchHit>>`. Optional on stores via `searchSessions?` **or** returned companion index — adapters implement one authoritative path; hosts must not need both. |
| Query / hit types | `SessionSearchQuery`, `SessionSearchHit` in core (next to session/persistence contracts). |
| Hit fields | Required: `sessionId`. Optional: `leafId` (branch tip for `checkout`), `updatedAt`, `label`, `summary`, `snippet`, safe display metadata. **Never** credentials, raw message bodies wholesale, or secret-looking payloads. |
| Workspace filter | Host-written `metadata.workspaceRoot` (string path/key). No first-class `prism_sessions.workspace` column in 0.0.11. Query field name: `workspaceRoot`. |
| Text / filters | Optional `query` (FTS/message+summary); `provider` / `model`; `label`/`summary` substring or FTS per adapter; `fromUpdatedAt`/`toUpdatedAt`; `OwnershipScope` (`tenantId`/`accountId`/`userId`). |
| Pagination | Reuse `PersistencePage` + `limit`/`cursor`/`order`. |
| Memory search | `createMemorySessionStore(entries?, options?)` with `sessionSearchMode: "linear" \| "unsupported"`; **default `"linear"`**. `"unsupported"` throws typed error (not empty success). JSONL: document unsupported unless a thin linear path is trivial — prefer explicit unsupported. |
| Context budget | `contextBudget` on `AssembleProviderInputOptions` (and forward from `AgentConfig`/`RunOptions` only if needed). Shape: `{ maxInputTokens?: number; maxInputBytes?: number; reportOmissions?: boolean }`. At least one max required when budget object present. |
| Eviction priority | Keep first: **system/AGENTS instructions → skills → context blocks → history/tool results** (drop from the end of that priority stack). Current user `input` and mandatory system prefix fail closed if they cannot fit. |
| Omission report | Prefer non-breaking: `ProviderRequest.metadata.contextBudgetReport` + typed helper `getContextBudgetReport(request)`. Report ids/kinds/sizes/tokenEstimates — not secret values. Raw session store entries untouched. |
| Token estimate | Finite heuristic: **UTF-16 code units / 4** (chars÷4) unless model supplies a cheaper local estimator later. Document as estimate, not billing. |
| Anthropic package | `@arnilo/prism-provider-anthropic`; exports `createAnthropicProviderPackage`, `createAnthropicMessagesProvider`, `listAnthropicModels` (caller-gated). |
| Google package | `@arnilo/prism-provider-google`; exports `createGoogleProviderPackage`, Gemini provider factory, `listGoogleModels` (caller-gated). |
| Goal/verify | `runCodingGoalVerify` exported from `@arnilo/prism-coding-agent`; example `examples/coding-goal-verify.ts`. No Goal table. |
| Package count | 0.0.10 graph **32** publishable packages → **34** after anthropic + google (**confirmed** at Task 13). |

## Capability traceability matrix

| Phase 6 roadmap criterion | Current 0.0.10 surface | Minimum 0.0.11 gap | Status / owner | Required proof | Docs | Release gate |
| --- | --- | --- | --- | --- | --- | --- |
| Bounded `SessionIndex` lists/filters by workspace, time, model/provider, label/summary, optional message FTS; hits return `sessionId` + optional `leafId` | `ProductionPersistenceStore.querySessions` metadata-only (`SessionQuery`); no text/FTS/workspace filters; `SessionStore` has no search | Core `SessionIndex` + query/hit types + optional store seam | `extend` / Task 1 | type/export smoke; invalid limit/query rejected; conformance empty/pagination/ownership | `public-contracts.md`, `session-stores.md` | offline + conformance |
| SQLite + PostgreSQL implement search with finite pages | DDL has `metadata`, entry `label`/`summary`; no FTS objects | Migrations + adapter `search`; metadata filters + optional FTS | `extend` / Task 2 | pagination, label/summary/FTS hits, ownership isolation, resume via `leafId`, migration drift | `sqlite-persistence.md`, `postgres-persistence.md` | offline adapter tests |
| Memory: linear fallback **or** explicit unsupported | `createMemorySessionStore(entries)` only; no options | Both modes; default linear; unsupported throws typed | `extend` / Task 3 | hit/miss/cap; unsupported ≠ empty | `session-stores.md` | offline |
| Token/context budget + omission report; no raw history delete | `assembleProviderInput` / message groups; no budget | `contextBudget` + deterministic eviction + report | `extend` / Task 4 | eviction order; omission completeness; zero-budget fail; cache-aware prefix when under budget | `input-and-prompt-assembly.md` | offline |
| Native Anthropic Messages package | OpenCode Go Anthropic **route** only; AI SDK escape hatch | New `@arnilo/prism-provider-anthropic` | `new-package` / Task 5 | offline conformance matrix + gated live | `providers/anthropic.md` | offline + opt-in live |
| Native Google Gemini package | No first-party Google package | New `@arnilo/prism-provider-google` after Anthropic | `new-package` / Task 6 | same conformance bar; Vertex out of scope | `providers/google.md` | offline + opt-in live |
| Thin goal→verify helper + example; no Goal DB / second runtime | `createCodingPlanMarkdown`, checks, `git_pr_handoff`, `suspend`/`resumeWorkflow`, `examples/durable-coding-workflow.ts` | `runCodingGoalVerify` + `examples/coding-goal-verify.ts` | `compose` / Task 7 | fail→suspend→approve→resume; bounded handoff; no secrets in plan state | `coding-agent-tools.md`, `agent-loops.md`, `workflows.md` | offline + example |
| Performance: finite search/budget; network-free benches | `querySessions` default `limit ?? 100`; no search/budget benches | Caps below; `scripts/benchmark-0.0.11.mjs` | `extend` / Tasks 1–4, 9 | schema/bounds; search+budget benches | `performance.md` | benchmark + `sdk:ready` |
| Code quality: optional seams; optional provider pkgs; helper composition | Provider package pattern; optional `readBranchPath` | Same pattern for search/budget; no core Anthropic extract | `compose` / Tasks 1–7 | ≥2-consumer rule for shared extract; package-local first | provider/session docs | pack/install |
| Security: ownership on search; no creds in hits/omissions; late-bound provider creds | `OwnershipScope` on persistence queries; provider redaction | Enforce on search; redact snippets/reports | `extend` / Tasks 1–6 | ownership empty/forbidden; secret scan fixtures | session + provider docs | offline + audit |
| Docs/migration 0.0.10 → 0.0.11 | Phase 5 docs | Update functional pages + two provider pages | `extend` / Task 8 | docs.test assertions | `migration.md`, index | docs tests |
| Version/release 0.0.11 | Graph at `0.0.10` | Bump to `0.0.11`; umbrella deps; dry-run | `extend` / Task 9 (renumbered Task 13) **done** | `sdk:ready` + release dry-run | `release-and-install.md` | Task 9/13 gates |

## Primitive and caller inventory

Frozen at `a677113a409b1b60a3361a76c980e7411013916a` (+ this evidence page).

| Primitive / symbol | Existing contract / callers | Phase 6 disposition |
| --- | --- | --- |
| `SessionStore` / `readBranchPath?` | Core; memory/JSONL omit path; sqlite/postgres implement | **Extend optional** with search seam (`searchSessions?` or companion `SessionIndex`). Do not require FTS on memory/JSONL. |
| `ProductionPersistenceStore.querySessions` | Metadata listing; sqlite/postgres | **Keep** for admin listing. Search is separate (`SessionIndex.search`); do not overload `SessionQuery` as sole FTS surface. |
| `SessionQuery` / `SessionRecord` / `OwnershipScope` / `PersistencePage` | Core contracts | Reuse ownership + page shape; add parallel search types. |
| `prism_sessions.metadata`, entry `label`/`summary` | sqlite/postgres DDL | Reuse for workspace/label/summary filters; FTS tables adapter-local. |
| `assembleProviderInput` / `createDefaultInputBuilder` / groups / `legacy`\|`cache_aware` | `src/input.ts` | **Extend** with `contextBudget` after groups built / before final request; no parallel assembler. |
| `ProviderRequest.metadata` | Core | Host omission report via frozen metadata key + helper. |
| Provider package setup (`defineProviderPackage`, conformance, transport SSE, media SSRF) | openai/kimi/opencode-go/… | Reuse. New anthropic/google packages follow same layout. |
| `packages/provider-opencode-go/src/anthropic-messages.ts` | Vendor OpenCode route | **Pattern only.** No shared core extract in 0.0.11. |
| Kimi Anthropic-compatible route | package-local | Unchanged; not a consumer of new anthropic package serializer. |
| `createCodingPlanMarkdown` / checks / `git_pr_handoff` / coding-checkpoint limits | coding-agent | Reuse inside `runCodingGoalVerify`. |
| `suspend` / `resumeWorkflow` | `@arnilo/prism-workflows` | Reuse; helper does not fork workflow engine. |
| `examples/durable-coding-workflow.ts` | Example pattern | Pattern for `examples/coding-goal-verify.ts`. |
| AI SDK provider package | Escape hatch | Remains escape hatch; not primary Anthropic/Google path. |

### Primitive decision

**Authorized new/extended core seams (minimal):**

1. `SessionIndex` / `SessionSearchQuery` / `SessionSearchHit` + finite search-cap constants.
2. Optional `SessionStore` search hook (or documented companion index from adapter factories).
3. `contextBudget` on assemble options + `getContextBudgetReport` (+ estimate/apply helpers; may live in `src/context-budget.ts` re-exported).
4. Memory store options: `sessionSearchMode`.

**Authorized new packages:** `@arnilo/prism-provider-anthropic`, `@arnilo/prism-provider-google`.

**Authorized package-local compose:** `runCodingGoalVerify` in coding-agent + example.

**Rejected for 0.0.11:** Goal DB; second runtime; always-on indexer; `ToolDefinition.metadata`; core Anthropic shared serializer; Vertex/Bedrock/Azure enterprise adapters; raising hard caps; default unbounded full-store scan.

Promote additional shared helpers to core only with ≥2 non-test consumers **and** migration/conformance evidence.

## Frozen capability boundary

| Surface | Supported in 0.0.11 | Explicitly unsupported |
| --- | --- | --- |
| Session search | Metadata filters + optional FTS; finite pages; memory linear (capped) or unsupported throw | Daemon indexer; silent empty on unsupported; credential fields on hits; first-class workspace column |
| Context budget | Assembler eviction + omission report; heuristic estimate | Compaction/summarization as budget (0.0.12 preset); deleting store history; provider round-trip for count |
| Anthropic | Native Messages HTTP package; tools/cache/thinking/media/usage/discovery | Subscription OAuth (0.0.12); official SDK dependency; env scan at import |
| Google | Native Gemini HTTP package for coding-host semantics | Vertex enterprise identity (0.0.13); `@google/genai` runtime dep unless fetch proven impossible at impl (prefer fetch) |
| Goal/verify | Thin coding-agent helper + network-free example | Goal table; second workflow/agent engine; auto-push/PR network |

## Frozen finite limits and charging points

**Rule:** Search and budget paths must validate caps in O(1) before scan/query. No always-on watchers. Do not raise hard caps in Tasks 1–9 without updating this page + tests + docs.

### Session search (new — freeze defaults)

| Resource | Default / hard cap | Charge/check point | Failure/cleanup owner |
| --- | --- | --- | --- |
| Page `limit` | 20 / 100 | Before query/scan | Task 1 validation; Task 2–3 adapters |
| Query string bytes | 4 KiB / 16 KiB | Before parse/FTS | Task 1 |
| Snippet bytes per hit | 512 / 4 KiB | Before hit assembly | Task 2–3 |
| Cursor bytes | 1 KiB / 4 KiB | Before decode | Task 1–2 |
| Memory linear: sessions scanned | 1,000 / 5,000 | During scan; abort on signal | Task 3 |
| Memory linear: entries scanned | 10,000 / 50,000 | During scan | Task 3 |
| Memory linear: bytes scanned | 8 MiB / 64 MiB | During scan (serialized entry text) | Task 3 |
| DB FTS match candidates before page trim | adapter-local ≤ 1,000 / 5,000 | Before materializing snippets | Task 2 |

**Forbidden:** default path that scans entire store with no limit; background reindex workers; retaining unbounded snippet corpora.

Existing `querySessions` default `limit ?? 100` stays for admin listing; search defaults are tighter (20).

### Context budget (new — freeze defaults)

| Resource | Default / hard cap | Charge/check point | Owner |
| --- | --- | --- | --- |
| `maxInputTokens` when set | caller-required; hard max 2_000_000 | Before eviction | Task 4 |
| `maxInputBytes` when set | caller-required; hard max 32 MiB | Before eviction | Task 4 |
| Estimate cost | O(assembled messages); no network | During estimate | Task 4 |
| Omission report entries | 256 / 1,024 | When `reportOmissions` | Task 4 |

**Forbidden:** provider call for budgeting; mutating/deleting `SessionStore` entries from budget path.

### Providers / coding helper (reuse existing)

| Resource | Disposition |
| --- | --- |
| Stream/SSE/media/run limits | Reuse existing provider transport + run-limit ceilings (Tasks 5–6) |
| Coding checkpoint / check / PR handoff bytes | Reuse `packages/coding-agent` `DEFAULT_*` / `HARD_*` (Task 7) |
| Workflow suspend/resume | Existing workflow limits unchanged |

## Threat and authority matrix

| Boundary | Trusted authority | Untrusted input | Mandatory control | Default / unsupported |
| --- | --- | --- | --- | --- |
| Search ownership | Host passes `OwnershipScope` | Model-supplied tenant ids | Adapters filter tenant/account/user when present; mismatch → empty or typed forbidden per existing persistence norms | Cross-tenant search unsupported |
| Search snippets | Adapter redaction-safe projection | Message/tool payloads | Snippet caps; never copy credential fields; prefer label/summary/FTS fragment | Raw full transcript as hit unsupported |
| Budget omissions | Assembler metadata helper | Dropped block contents | Report kinds/ids/sizes only; redactor still applies to provider messages | Secret values in omission report unsupported |
| Provider credentials | Host `CredentialValueSource` late-bound | Env/process ambient keys | No import/setup network or keychain scan; redact errors | Env auto-discovery unsupported |
| Goal/verify approval | Host approval policy | Model “approved” claims | Fail closed without approval; suspend/resume via workflows | Implicit approve unsupported |
| Provider headers | Provider-owned required headers win | Host override attempts on reserved names | Existing header-ownership rules | Host overwrite of provider auth headers unsupported |

## Validation matrix for Task 0

| Check | Frozen assertion |
| --- | --- |
| Traceability | Every Phase 6 roadmap criterion maps to exactly one primary owner among Tasks 1–9; 0.0.12+ items listed only under out-of-scope. |
| Primitive reuse | Only authorized core seams above; Anthropic/Google are new optional packages; goal/verify is compose-only. Shared Anthropic extract deferred (≥2-consumer rule). |
| Finite resources | Search/budget caps table enforced; no indexer daemons; no unbounded default scans. |
| Security claims | Ownership on search; hits/omissions credential-free; provider creds late-bound/redacted. |
| API names | `SessionIndex` / `SessionSearchQuery` / `SessionSearchHit`; `contextBudget` + `getContextBudgetReport`; `sessionSearchMode`; `createAnthropicProviderPackage` / `createGoogleProviderPackage`; `runCodingGoalVerify`; workspace key `metadata.workspaceRoot`. |
| Eviction order | system/AGENTS → skills → context → history/tool results. |

## Post-freeze extensions (Tasks 8–11)

Plan 074 inserted mid-run steer + ask_user_decision multi/free-text/suspend before docs/release (renumbered Tasks 12–13). Still inside 0.0.11; no Goal DB / no new `AgentRunInterruption` kinds.

| Extension | Frozen choice | Docs | Proof |
| --- | --- | --- | --- |
| Mid-run `steer` | Queue ≤8 / ≤64 KiB; softInterrupt aborts provider stream only; same `runId`; fail closed with no active run | `agent-session-runtime.md`, `cli-rpc.md`, `agent-loops.md` | agent + RPC tests |
| ask_user multi | `selectionMode: "multiple"` → `selectedIds` | `coding-agent-tools.md` | coding-agent tests |
| ask_user free-text | `allowCustom` + XOR `customText` | `coding-agent-tools.md` | coding-agent tests |
| ask_user suspend glue | `suspendAskUserDecision` + resume validators; agent adapter only | `coding-agent-tools.md`, `workflows.md` | workflow suspend→approve test |

## Documentation and release ownership

- Task 0 (this page): scope freeze, index link, docs.test evidence assertions.
- Tasks 1–7: original Phase 6 implementation owners (search/budget/providers/goal-verify).
- Tasks 8–11: steer + ask_user_decision multi/free-text/suspend glue.
- Task 12: session/input/provider/coding/workflows/migration/performance docs, READMEs/CHANGELOGs, index summaries.
- Task 13: version `0.0.11`, benchmarks, `sdk:ready`, pack/install/supply-chain, release dry-run — **done** (2,047 tests / 2,014 pass / 33 skip; 34/34 dry-run; no tag/publish).

No public implementation API changes in Task 0. This page, `roadmap.md` Phase 6, and Plan 074 are the authoritative pre-implementation boundary; later tasks may tighten defaults but cannot raise hard caps, add daemons/Goal DB/second runtime, or pull 0.0.12+ items without updating tests, docs, and this evidence.
