# Per-Turn Tool Narrowing

Release: 0.9.0 (P1). Extends R11 run-local tool narrowing with a per-turn seam so hosts like synapta can push plane-based tool allowlists into the model's choice set each turn.

## Objectives
- Host callback before each provider turn returns the effective tool subset for that turn.
- Cache cost documented honestly: toolset changes rewrite schemas; pairing guidance with tool-search/deferred schemas and the plan 088 tail contract.
- Per-run narrowing behavior unchanged.

## Expected Outcome
- Synapta's plane classifier (knowledge/metric/scenario/objects) narrows the live toolset each turn without session restarts; wrong-tool rates drop with smaller causally-relevant menus.

## Tasks

- [x] Task 1: Primitive review — toolset resolution seams
  - Acceptance Criteria:
    - Functional: Inventory toolset resolution (static tools, per-run narrowing R11, tool-search deferred schemas, MCP toolsets) and identify the single seam where a per-turn subset applies.
    - Performance / Code Quality / Security: analysis only.
  - Approach:
    - Documentation Reviewed:
      - `docs/tools.md` (per-run `toolNames`, `toolsDisclosure`), `docs/coding-agent-tools.md`, `docs/mcp-tools.md`, `src/tool-search.ts`, `selectRunTools` / `filterTools` (`src/tools.ts`), `assembleRoundContext` + `loopCtx.assemble` (`src/agent-session/session/assemble.ts`), `assembleProviderInput` (`src/input.ts`), `singleShotLoop` / GVR (`src/agent-loops.ts`), MCP `mapMcpToolsToDefinitions` (`packages/mcp/src/bridge.ts`).
    - Options Considered: n/a.
    - Chosen Approach:
      - Existing pipeline (no new primitive):
        1. Static: `AgentConfig.tools` via `activeTools()`. MCP `connectMcpTools` maps remotes to `ToolDefinition[]` (`mcp:${serverId}:`); host merges into that list. Mid-run MCP refresh is ignored (`assembleRoundContext` run-local snapshot).
        2. R11: `selectRunTools(listed, options.toolNames, resumed?.state?.toolNames)` once per run → `ctx.tools` / registry / `session.activeToolNames`. Resume intersects, never widens. Clamp helper already exists: `filterTools(tools, { allow })` (preserves run order).
        3. Tool-search: `createToolSearchState` + generated `search_tools` at run start on that snapshot. Per turn, `assembleProviderInput` runs `selectDisclosedTools` (activated ∪ topK ∪ `search_tools`) when `toolsDisclosure === "search"`.
        4. Per-turn assemble already exists: `singleShotLoop` and GVR call `ctx.assemble(nextInput, undefined, turn)` every turn.
      - Single schema seam: start of `loopCtx.assemble` in `assemble.ts`. Call host hook, clamp with `filterTools` against the run snapshot, pass the subset into `assembleProviderInput` so attention/budget/prompt/`request.tools`/plan 088 cache prefix all see the same menu. Do not reorder — `filterTools` keeps run order; hook return order is ignored.
      - Rejected seams: `provider-round.ts` / `generate` (after costing + `provider_request` middleware); `provider_request` middleware itself (default `errorPolicy: "event"` swallows throws); new MCP path (MCP is already `ToolDefinition[]`); `assembleProviderInput` internals (no session callback; used standalone).
      - Related dispatch seam (Task 2, not a new dispatcher): `bindDispatchToolCall` allow-list is the full run grant (`ctx.tools`). Turn-hidden callable-by-name needs a turn overlay there. `search_tools` index stays run-scoped; listing a hidden name is fine if dispatch rejects (default).
      - API hang: `AgentConfig` + `RunOptions` (run wins), same as `toolsDisclosure`. `AgentSessionConfig` is identity-only (id/store/leaf/metadata/ttl) — do not add the first callback there.
    - API Notes and Examples: n/a.
    - Files to Create/Edit: none.
    - References: ToolChoiceConfusion (minimal causal tool filtering), "Looking Is Not Picking" (attention isn't the bottleneck; menu size is a working lever).
  - Test Cases to Write: n/a.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: `none`.
    - `docs/index.md` update: no.
    - Documentation structure reference: n/a.

- [x] Task 2: `toolNarrowing` per-turn hook
  - Acceptance Criteria:
    - Functional: `createAgent({ toolNarrowing: async (ctx) => string[] })` (RunOptions override) — called at `loopCtx.assemble` before each provider turn with turn index, last assistant message, and current tool ids; returns allowed subset (must be subset of run-narrowed set; superset requests are clamped + warned). Tools hidden this turn remain callable-by-name only if host opts in (default off, prevents schema-less hallucinated calls failing silently).
    - Performance: Hook is async, cached per turn; adds one host call per turn; no schema rebuild when the returned subset equals previous turn's.
    - Code Quality: Same error-handling contract as other session callbacks (throw = fail the turn, not skip narrowing); `filterTools` on the run snapshot preserves run order so identical subsets stay byte-identical (plan 088).
    - Security: Narrowing is restrictive-only — hosts can never widen beyond run config; clamp is logged.
  - Approach:
    - Documentation Reviewed: Task 1; middleware conventions `src/middleware.ts`, `docs/middleware-hooks.md`.
    - Options Considered:
      - Host edits toolset via mutable session API: rejected — race-prone, no audit trail.
      - Per-turn callback: chosen — mirrors guardrail/middleware style, auditable per turn.
    - Chosen Approach: Callback on `AgentConfig` / `RunOptions` (run wins). Invoke at `loopCtx.assemble` before `assembleProviderInput`. Clamp with `filterTools` against the R11 snapshot (restrictive-only; preserves run order). Dispatch overlay in `bindDispatchToolCall` for hidden-this-turn (default: not callable by name).
    - API Notes and Examples:
      ```ts
      createAgent({
        toolNarrowing: async ({ turn, lastAssistantText, toolIds }) =>
          plane === "knowledge" ? toolIds.filter((id) => id.startsWith("wiki.")) : toolIds,
      });
      ```
    - Files to Create/Edit:
      - `src/contracts-core/agent.ts` / `src/contracts-protocol.ts`: `toolNarrowing` on `AgentConfig` + `RunOptions`; `tool_narrowing_clamped` event.
      - `src/tools.ts`: `clampTurnToolNames` (restrictive, preserves run order).
      - `src/agent-session/session/assemble.ts`: hook + clamp before `assembleProviderInput`.
      - `src/agent-session/session/tool-round.ts`: turn-local dispatch allow overlay.
      - `src/__tests__/tool-narrowing.test.ts`.
      - `docs/tools.md`, `docs/middleware-hooks.md`, `docs/coding-agent-tools.md`, `docs/agent-events.md`.
    - References: synapta classifyTurn planes; ToolChoiceConfusion.
  - Test Cases to Write:
    - Subset respected per turn; tools absent from request schema.
    - Superset return: clamped to run set, warning event, audit record.
    - Identical consecutive subsets: schema bytes identical (cache stability).
    - Hook throw: turn fails with host-visible error, no partial schema.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new session option.
    - Docs pages to create/edit: `docs/middleware-hooks.md` (per-turn tool narrowing section + cache-cost note); `docs/coding-agent-tools.md` cross-link.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3: Narrowing observability + example
  - Acceptance Criteria:
    - Functional: Turn metadata records effective tool count + ids hash; example `examples/tool-narrowing-planes.ts` shows plane-switched narrowing in one continuing session.
    - Performance: Metadata additive only.
    - Code Quality: Example under existing example conventions, fake provider.
    - Security: No tool args in metadata.
  - Approach:
    - Documentation Reviewed: plan 087 metadata patterns.
    - Options Considered: none simpler.
    - Chosen Approach: Reuse plan 087 turn metadata extension point.
    - API Notes and Examples:
      ```ts
      e.budgets; e.tools; // { count: 6, idsHash: "sha256:..." }
      ```
    - Files to Create/Edit:
      - `src/contracts-protocol.ts`: `ProviderTurnMetadata.tools`.
      - `src/observability.ts`: hash names from `request.tools` in `createProviderTurnMetadata`.
      - `src/__tests__/observability.test.ts`, `src/__tests__/tool-narrowing.test.ts`.
      - `examples/tool-narrowing-planes.ts`, `examples/README.md`.
      - `docs/agent-events.md`, `docs/tools.md`.
    - References: synapta planes.
  - Test Cases to Write:
    - Metadata reflects narrowing per turn; hash stable across identical subsets.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (metadata fields).
    - Docs pages to create/edit: `docs/agent-events.md` (tools metadata).
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made
- `toolNarrowing` lives on `AgentConfig` / `RunOptions`, not `AgentSessionConfig` (identity-only).
- Restrictive clamp only; hook return order ignored (`filterTools` keeps run order).
- `search_tools` index stays run-scoped; listing a hidden name is fine if dispatch rejects (default).
- `metadata.tools` is always filled from `request.tools` (count 0 when none) — no separate emit site, no timeline/OTel projection.
- Example is a mock one-run two-turn plane switch, not a synapta classifier.

## Further Actions
- Project `metadata.tools` onto the execution timeline if hosts need it next to `budgets` (low).
- Pair large run grants with `toolsDisclosure: "search"` when schema rewrite cost shows up (documented).
- Host owns plane classification; no core classifier.
