# 033 — prism-graft: Graft context-graph integration (L0–L3)

Roadmap phase: **0.3.x** line, post-0.3.0 independent-versioning train.
Baseline: `@arnilo/prism` **0.3.0** graph (57 packages, plan 030 cut complete).
Target: new opt-in package `@arnilo/prism-graft` integrating [NanoNets/Graft](https://github.com/NanoNets/Graft) (`@nanonets/graft`) into any Prism-powered coding agent at four levels:

- **L0** — documented zero-code pull mode (agent uses `graft` CLI through its shell tool).
- **L1** — static surface: registered skill + `/graft` commands wrapping the CLI.
- **L2** — native tools: six `--json` CLI wrappers registered via `registerTool` ("pull" mode; graft's own best-correctness benchmark configuration).
- **L3** — deep/push parity with graft's Claude Code integration: per-turn retrieval-pack context provider, first-turn orientation injector, post-edit blast-radius middleware, session-persisted state.

Status: **draft** (analysis validated against graft `src/claude/hooks.ts`, `package.json@0.13.0`, `src/index.ts`; and Prism `src/extensions.ts`, `src/middleware.ts`, `src/contracts-core/agent.ts`, `packages/prism-ponytail/src/*`, `docs/indexed-code-search.md`).

## Objectives

- Ship `@arnilo/prism-graft` as an opt-in behavior/integration package following the proven `prism-ponytail` adapter skeleton: inert import, fail-closed `setup`, optional peer dependency, bounded reads, redacted errors.
- Integrate against the **vendor-sanctioned seam**: graft's programmatic API exports build/check/engine only — retrieval (`ask`/`grep`/`callers`/`skeleton`/`map`/`blast`/`check`) is reachable via the `graft` CLI with `--json` (graft's own hooks shell out exactly this way) or its bundled MCP server. This plan uses the CLI; no MCP hop.
- Reproduce graft's Claude Code deep integration natively on Prism's kernel: every Claude Code hook (`SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`) maps to an in-process Prism primitive (`session_start`/injector, `InstructionInjector.every_turn`, `tool_result` middleware, events) — no settings-file merging, no shell shims, kernel `dispose()` unwinds everything.
- Keep graft out of all umbrella profiles (`prism-all`, `prism-code`, `prism-sdk`): heavy install (native tree-sitter grammars, openai/anthropic SDK deps), pre-1.0 churn, external telemetry.

### Locked in / out

| Item | Decision | Why |
| --- | --- | --- |
| G1 Upstream seam | **In** — `execFile("graft", […, "--json"])` subprocess | Retrieval not exported from graft's library entry; graft's own hooks use this exact seam (`graftJson()` in `src/claude/hooks.ts`). |
| G2 Transport | **Out** — MCP server transport | Native `registerTool` wrappers are strictly better in-process (no stdio lifecycle, typed results). Revisit only if wrapper maintenance diverges. |
| G3 Peer policy | **In** — optional peer `@nanonets/graft@^0.13.0` + `upstreamPath`-style `cliPath` override | Pre-1.0 churn pin; missing CLI fails closed at `setup` with redacted error. |
| G4 Umbrellas | **Out of umbrellas** | Same honesty rule as Caveman/Ponytail/document-reader/NATS (manifest wording must match). |
| G5 Push gating | **In** — port graft's hook gates: <12-char prompts skipped, per-session seen-node dedup, pointers-only packs (no inlined source) | Per-turn injected tokens are fresh full-price every turn; cached orientation goes `first_turn` only. Graft benchmark: push wins speed, pull wins correctness — ship both, host selects. |
| G6 Background resync | **Out** (deferred) — no detached Stop-equivalent rebuild | Every graft query self-refreshes against the working tree (~3ms no-op when clean); a background rebuilder buys only statusline freshness. Deferred to Further Actions. |
| G7 Blast radius source | **In** — `graft callers <symbol>` / wiring read via `graft map --json`-class CLI calls, keyed on edited file path | Mirrors `handlePostEdit`; fails soft (no graph → silent skip). |
| G8 Telemetry | **In** — child env defaults `DO_NOT_TRACK=1`; option `allowUpstreamTelemetry: true` opts out of the default | Prism privacy posture; graft ping is anonymous but external. |
| G9 Secrets | **In** — fixed base child env; host supplies `GRAFT_API_KEY`/`GRAFT_PROVIDER`/`GRAFT_MODEL`/`GRAFT_BASE_URL` explicitly via `providerEnv` | Never inherit full process env into children (work-tools precedent). |
| G10 L4 index-backend seam | **Out** — no `RepositoryIndexBackend` implementation this plan | Second integration surface; demand-gate after L3 proves value. Named leftover. |

## Expected Outcome

- A host runs `npm install @arnilo/prism-graft`, resolves the `graft` CLI (optional peer or explicit `cliPath`), and loads `createGraftExtension({...})` into an extension kernel. Missing CLI ⇒ bounded redacted `setup` failure; import alone registers nothing (`sideEffects: false`).
- With `mode: "pull"` (default), sessions gain six read-only tools (`graft_ask`, `graft_grep`, `graft_callers`, `graft_skeleton`, `graft_map`, `graft_blast`), one usage skill, and `/graft` commands (`build`, `check`, `viz`, `status`).
- With `mode: "push"` (or `"both"`), each qualifying user turn resolves a pointers-only retrieval pack as context blocks (locators, not source; gated and deduped per session), plus a first-turn orientation block; editing a file through coding tools surfaces its dependents (blast radius) in the turn's tool-result metadata/events; state persists as session custom entries and restores across restarts.
- Package graph grows 57 → 58; `scripts/package-truth.mjs` regenerated; `docs/graft.md` published and navigated from `docs/index.md`; release gates green.

## Tasks

- [x] Task 1 — Primitive review and seam inventory (primitive-first, before any package code)
  - Acceptance Criteria:
    - Functional: written inventory (in this plan's Research Record section, updated in-place during execution) covering: extension kernel registrations used (`registerTool`, `registerSkill`, `registerCommand`, `registerInstructionInjector`), middleware hooks used (`session_start`, `input_assembly`, `tool_result`), `ContextProvider`/`InstructionContribution` shapes (`contextBlocks` honored, nothing else grants capability), ponytail adapter precedents (upstream resolution, bounded reads, redaction, session custom-entry persistence, deactivation phrases), and indexed-code-search contract touchpoint (G10 deferral rationale).
    - Functional: each planned capability mapped to an existing primitive; any capability NOT achievable with existing primitives listed explicitly with the minimal generic primitive proposed (expected: none — extension-package-only plan, zero core edits).
    - Code Quality: inventory cites file paths and exported symbols, not prose recollection.
    - Security: inventory records trust boundaries crossed (subprocess spawn, CLI stdout parsing, provider env) and the existing primitives that bound them.
  - Approach:
    - Documentation Reviewed:
      - `src/extensions.ts` (`createExtensionKernel`, tracked `createApi` registrations, unwind/dispose), `src/middleware.ts` (`MiddlewareHookName`: `session_start`, `input_assembly`, `prompt_build`, `context`, `tool_call`, `tool_result`, `retry`, `compaction`, `session_shutdown`), `src/contracts-core/agent.ts` (`ContextProvider.resolve → ContextBlock[]`, `InstructionContext`, `InstructionTiming`).
      - `packages/prism-ponytail/src/{extension,upstream,upstream-hooks,mode,skills,commands,instructions,config,types}.ts` — the adapter skeleton this plan clones.
      - `docs/indexed-code-search.md` (`RepositoryIndexBackend` — G10 deferral), `docs/extension-authoring.md`, `docs/instruction-injection.md`.
      - Upstream: graft `src/claude/hooks.ts` (hook gates, `graftJson`, `promptAskTimeout`, `handlePostEdit`, `handleStop`), `package.json` (`bin`, exports, deps), `src/index.ts` (programmatic surface = build/check/engine only).
    - Options Considered:
      - Add core primitives (e.g. generic "external CLI tool factory"): rejected — YAGNI; ponytail/caveman precedent shows per-package adapters suffice and avoid premature abstraction.
      - Library import of `@nanonets/graft` for retrieval: rejected — not exported; would depend on internals.
    - Chosen Approach:
      - Extension-package-only. Clone the ponytail skeleton; replace upstream skill-file loading with a CLI-runner primitive local to the package. No core changes; no new registries.
    - API Notes and Examples:
      ```ts
      // Kernel surface consumed (from src/extensions.ts createApi):
      api.registerTool(tool);            // L2 six wrappers
      api.registerSkill(skill);          // L1 usage skill
      api.registerCommand(command);      // L1 /graft commands
      api.registerInstructionInjector({ name, apply(ctx) }); // L3 push pack
      api.use<Message[]>("input_assembly", async (messages, next) => next(messages));
      ```
    - Files to Create/Edit:
      - `plans/033-Prism-Graft-L0-L3-Deep-Integration.md`: fill Research Record inventory (this task's deliverable).
    - References:
      - Analysis conversation (graft hooks decode); `docs/caveman.md`/`docs/ponytail.md` structure for the eventual API page.
  - Test Cases to Write:
    - none (documentation-of-decision task; verified by review checkbox).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (decision record only).
    - Docs pages to create/edit: none (reason: no surface change in this task).
    - `docs/index.md update`: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (applies from Task 3 onward).

- [x] Task 2 — Package scaffold: `packages/prism-graft` (manifest, resolution, types)
  - Acceptance Criteria:
    - Functional: package builds standalone (`npm run build` via `scripts/with-build-lock.mjs`), exports `createGraftExtension` and option/state types from `./src/index.ts`; import without `kernel.load` performs no I/O (inert, `sideEffects: false`).
    - Functional: `resolveGraftCli({ cliPath })` resolves the `graft` binary from (a) explicit override, else (b) optional peer `@nanonets/graft` `bin` target (`dist/cli.js` executed with `process.execPath`), else throws `GraftResolveError` (code `graft_resolve_failed`) at `setup` — fail closed.
    - Performance: resolution O(1) (single `require.resolve` probe + `accessSync`); no directory scans, no network, no timers.
    - Code Quality: strict TS, Biome clean; error paths bounded (≤512 chars) and redacted (absolute paths/home dir replaced, ponytail `redactPaths` pattern replicated locally — packages do not import each other).
    - Security: manifest carries `peerDependenciesMeta.@nanonets/graft.optional = true`; peer `@arnilo/prism: ^0.3.0`; `files` limited to `dist` + README/CHANGELOG/LICENSE; package absent from `prism-all`/`prism-code`/`prism-sdk` manifests.
  - Approach:
    - Documentation Reviewed:
      - `packages/prism-ponytail/package.json` (manifest shape, engines, publishConfig, keywords), `packages/prism-ponytail/src/upstream.ts` (`resolvePeerPackageRoot`, `readBoundedFile`, `redactPaths`, `UpstreamResolveError`), `scripts/package-truth.mjs` (graph derivation), plan 030 D4/D8 (umbrella exclusion, independent versions).
      - graft `package.json`: `bin: { graft: "dist/cli.js" }`, `main/types` present (resolution via `require.resolve("@nanonets/graft/package.json")` then `bin` relative path).
    - Options Considered:
      - Resolve global `graft` binary from `PATH` as fallback: rejected for default path — global installs drift from the pinned peer range; keep as host-explicit `cliPath`.
      - Spawn `npx @nanonets/graft` per call: rejected — network/install latency per call, nondeterministic version.
    - Chosen Approach:
      - Ponytail-style two-source resolution (explicit `cliPath` > optional peer bin). When resolved via peer package, execute `process.execPath <peerRoot>/dist/cli.js`; when `cliPath` points at a native executable, execute directly. Record resolved form in extension state for `graft status`.
    - API Notes and Examples:
      ```ts
      export interface GraftExtensionOptions {
        readonly cliPath?: string;                    // explicit graft CLI override
        readonly packageName?: string;                // peer package name override (tests)
        readonly mode?: "pull" | "push" | "both";     // default "pull"
        readonly retrievalBudgetMs?: number;          // default 8000 (graft's own child budget)
        readonly maxResultBytes?: number;             // default 512 KiB stdout cap
        readonly maxPromptChars?: number;             // default 4096 argv guard
        readonly allowUpstreamTelemetry?: boolean;    // default false → DO_NOT_TRACK=1
        readonly providerEnv?: Readonly<Record<string, string>>; // GRAFT_API_KEY etc.
        readonly editToolNames?: readonly string[];   // default ["write","edit","multiedit","apply_patch"]
        // session attach callbacks — OM pattern, identical to ponytail:
        readonly appendEntry: (entry: SessionEntry, opts?: unknown) => Promise<void>;
        readonly getEntries: () => readonly SessionEntry[] | Promise<readonly SessionEntry[]>;
        readonly quietStartup?: boolean;
        readonly hideStatus?: boolean;
      }
      ```
    - Files to Create/Edit:
      - `packages/prism-graft/package.json`: new manifest (version 0.0.1, independent first release; peer `@arnilo/prism@^0.3.0` per caret-current policy).
      - `packages/prism-graft/tsconfig.json`: clone ponytail's.
      - `packages/prism-graft/LICENSE`, `packages/prism-graft/README.md`, `packages/prism-graft/CHANGELOG.md`: house boilerplate.
      - `packages/prism-graft/src/index.ts`, `src/types.ts`, `src/upstream.ts`: exports, options, resolver/redaction.
      - Root: workspace glob already covers `packages/*` (verify; no root manifest edit expected).
    - References:
      - `packages/prism-ponytail/*`; graft `package.json` bin layout; plan 030 Decision D4/D8.
  - Test Cases to Write:
    - `__tests__/upstream.test.ts`: resolves peer-bin path from a fixture package layout; `cliPath` override wins; missing both ⇒ `GraftResolveError` with code and redacted message; redaction strips home dir and absolute paths; inert-import test (loading module registers nothing observable).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new package + subpath export).
    - Docs pages to create/edit: `docs/graft.md`: created in Task 8; placeholder link deferred until surface stabilizes.
    - `docs/index.md update`: yes — done in Task 8 together with the page.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 3 — CLI runner primitive + L0/L1 static surface (skill, commands, status events)
  - Acceptance Criteria:
    - Functional: `runGraftJson(cli, args, { cwd, timeoutMs, maxResultBytes })` spawns the CLI with array argv (never a shell), parses stdout as JSON, and recovers JSON from non-zero exits (graft `check` exits 1 when stale while printing valid JSON — graft's own `graftJson` behavior). Failures return `null` (fail soft at call sites) after one stderr log line.
    - Functional: child env is fixed-base (`PATH`, `HOME`, `NODE_ENV`, locale) + `DO_NOT_TRACK=1` unless `allowUpstreamTelemetry` + `providerEnv` entries; cwd bounded to the host-provided project dir.
    - Functional: registered skill `graft` documents pull-mode usage (prefer `graft ask` before grep-spelunking; locators→open source); commands `graft` (status/build/check/viz dispatch), plus thin aliases `graft-build`, `graft-check`, `graft-viz`; `status` reports resolved CLI form, mode, last known freshness (from persisted state, no live call unless `--check` flag).
    - Functional: startup emits `graft:loaded`; status changes emit `graft:status` (respects `quietStartup`/`hideStatus`).
    - Performance: command executions bounded by `retrievalBudgetMs` (default 8s); no warm calls at `setup` beyond existence check.
    - Code Quality: runner is a pure module (no globals); timeouts derive from caller budget minus fixed 2s overhead (graft's `HOOK_OVERHEAD_MS` rule), floored at 4s.
    - Security: stdout buffered to `maxResultBytes` then killed-and-discarded on overflow; argv elements never interpolated into a shell string; `viz` command requires explicit host invocation (it opens a browser/port — document, and default to `--no-open` flag passthrough).
  - Approach:
    - Documentation Reviewed:
      - graft `src/claude/hooks.ts` (`graftJson`, `promptAskTimeout`, timeout-derivation comments), graft README CLI section (`--json` flags per command; `graft check --json` exit-code semantics), `packages/prism-ponytail/src/{commands,extension}.ts` (command context shape, event emission), `src/contracts-core` command definition shape.
      - Node docs: `child_process.execFile` (array argv, no shell), `maxBuffer` semantics (we bound manually instead — `maxBuffer` throws late and unbounded-in-flight).
    - Options Considered:
      - Use graft's bundled MCP server via `packages/mcp`: rejected (G2) — extra transport lifecycle for six calls we can wrap directly.
      - `spawn` + manual JSON framing: rejected — `execFile` with explicit byte-bounded collection is fewer lines and deterministic.
    - Chosen Approach:
      - One runner module used by everything downstream (tools Task 4, injector Task 5, middleware Task 6). L0 ships as skill text only: instruct agents they may also call the CLI directly through their shell tool when the wrapper tools are absent (covers hosts that disable tool registration).
    - API Notes and Examples:
      ```ts
      const result = await runGraftJson(resolved, ["ask", prompt, ".", "--json", "-n", "3"], {
        cwd: projectDir, timeoutMs: opts.retrievalBudgetMs, maxResultBytes: opts.maxResultBytes,
        env: childEnv(opts),
      });
      // result: parsed JSON | null (null ⇒ caller skips silently)
      ```
    - Files to Create/Edit:
      - `packages/prism-graft/src/cli.ts`: runner + child-env builder + timeout math.
      - `packages/prism-graft/src/skills.ts`: skill definition (static body, size-capped constant — no upstream skill files to load).
      - `packages/prism-graft/src/commands.ts`: `/graft` command family.
      - `packages/prism-graft/src/extension.ts`: wire registrations; `graft:loaded`/`graft:status` events.
    - References:
      - `docs/tools.md` tool-definition conventions; `docs/context-and-skills.md` skill catalog rules.
  - Test Cases to Write:
    - `__tests__/cli.test.ts`: stub CLI via `GRAFT_TEST_CLI`-style option (fixture script printing JSON; variant exiting 1 with valid stdout; variant overrunning timeout ⇒ null within budget; variant printing > maxResultBytes ⇒ truncated/killed ⇒ null; env assertion — stub echoes received env, asserts `DO_NOT_TRACK` and absence of inherited secrets).
    - `__tests__/commands.test.ts`: `graft status` offline from persisted state; alias dispatch; `hideStatus` suppresses events.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (commands, skill, events `graft:loaded`/`graft:status`).
    - Docs pages to create/edit: `docs/graft.md`: sections drafted progressively (finalized Task 8).
    - `docs/index.md update`: deferred to Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 4 — L2: native pull tools (six `--json` wrappers)
  - Acceptance Criteria:
    - Functional: tools `graft_ask`, `graft_grep`, `graft_callers`, `graft_skeleton`, `graft_map`, `graft_blast` registered when `mode ∈ {"pull","both"}`; 1:1 argument mapping to CLI flags (`ask`: `query`, optional `scope` → `--in`, `count` → `-n`, `source` boolean → `--source`; `grep`: `pattern`, `ignoreCase`, `fixed`, `scope`; `callers`: `symbol`, `direction in|out`, `depth`; `skeleton`/`map`/`blast`: path/base/depth/format passthrough with allow-listed values). Results returned verbatim (parsed JSON re-stringified, bounded) with `metadata.graft = { command, ms }`.
    - Functional: tool annotations declare read-only/non-destructive; no tool mutates repo state except `build`-family, which stays command-only (not agent-callable) in this plan.
    - Functional: when the graph is missing/unbuilt, tools return a structured hint (`error: "graft_not_built"`, remediation: run `/graft build`) instead of raw CLI noise.
    - Performance: per-tool deadline = shared `retrievalBudgetMs`; concurrent calls allowed (CLI is stateless per invocation); results capped at `maxResultBytes`.
    - Code Quality: single table-driven factory (`defineGraftTools(specs)`) — six declarative specs, one executor; no per-tool copy-paste.
    - Security: `pattern`/`query`/`symbol` passed as single argv elements (regex metacharacters safe by construction); enum-validated flags reject unexpected values; output labeled `untrusted_index`-style provenance marker in metadata (`source: "graft-graph"`) consistent with indexed-search trust labeling.
  - Approach:
    - Documentation Reviewed:
      - graft README CLI reference (exact flags: `ask [--json] [-n N] [--source] [--in scope]`, `grep [-i] [--fixed] [--in]`, `callers [--direction out] [-d N]`, `skeleton`, `map [--max-dirs]`, `blast [--base] [--depth all] [--format json|markdown]`); `docs/coding-agent-tools.md` (tool naming/annotation conventions, `repo_search` precedent); `docs/tool-conformance.md`.
    - Options Considered:
      - Collapse to one `graft` meta-tool with `op` discriminator: rejected — worse schema validation, worse model ergonomics; graft's MCP server exposes six named tools for the same reason.
      - Wrap `build` as an agent tool: rejected — mutation-adjacent, slow cold builds; keep behind `/graft build` command where approval/negotiation lives.
    - Chosen Approach:
      - Declarative spec table → `ToolDefinition`s sharing the Task 3 runner. `mode: "pull"` default means a host gets L2 with zero additional configuration.
    - API Notes and Examples:
      ```ts
      // { name: "graft_callers", arguments: { symbol: "createExtensionKernel", direction: "out", depth: 2 } }
      // → exec: graft callers createExtensionKernel . --json --direction out -d 2   (flag order normalized in one place)
      ```
    - Files to Create/Edit:
      - `packages/prism-graft/src/tools.ts`: spec table + factory + `graft_not_built` mapping.
    - References:
      - graft MCP tool descriptions (`graft_find_code` etc.) reused as tool descriptions (adapted to CLI backing).
  - Test Cases to Write:
    - `__tests__/tools.test.ts`: per-tool spec → expected argv snapshot (stub CLI echoes argv as JSON); flag allow-list rejects unknown enum values; unbuilt-graph exit shape maps to `graft_not_built`; oversized output capped; `metadata.ms` monotonic sane.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (six new tool registrations).
    - Docs pages to create/edit: `docs/graft.md` tool table (Task 8).
    - `docs/index.md update`: deferred to Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 5 — L3a: push-mode retrieval-pack context provider
  - Acceptance Criteria:
    - Functional: context provider `graft-context` (Task 1 finding: `InstructionInjector.apply` is synchronous, so the async CLI ask rides `ContextProvider.resolve`, which receives `messages` + `signal` and participates in context-budget demotion) registered when `mode ∈ {"push","both"}`; attached via the registered graft skill's `context` array (flows through `agent-session/session.ts:438`) so activating the skill activates push mode — hosts may alternatively append it to `AgentConfig.context`. Per turn: extract latest user text → skip if `< 12` chars (graft's `MIN_PROMPT_CHARS`) or `> maxPromptChars` → run `graft ask <text> . --json -n 3` (scope-hint omitted v1) → emit a **pointers-only** pack as `ContextBlock`s (node titles + `file:line` locators + wikilink targets; never inlined source bodies); gates reject ⇒ empty block list.
    - Functional: dedup — node ids already emitted this session are dropped; if nothing remains, emit nothing. Seen-id set persists as session custom entries `{ kind: "custom", data: { type: "graft-state", seen: [...capped...], savedTokensApprox? } }` via `appendEntry` (OM attach pattern, `expectedParentId` CAS); restore scans `getEntries()` for latest `graft-state` (ponytail `resolveModeFromEntries` pattern).
    - Functional: first turn additionally contributes orientation (contents of `graft/INDEX.md`, size-capped 8 KiB, staleness banner via `graft check --json` drift counts) via the synchronous `graft-orient` instruction injector (`when: "first_turn"`; bounded `readFileSync`, no CLI ask — Task 1 finding) — mirrors Claude Code SessionStart orientation.
    - Performance: hard abort via `resolve` ctx `signal`; total provider wall time ≤ `retrievalBudgetMs`; seen-set capped at 256 ids (drop-oldest; `# ponytail:` ceiling comment — LRU eviction if sessions exceed).
    - Code Quality: gating heuristics isolated in pure functions (`shouldQuery(text)`, `formatPointerPack(askResult, seen)`) — unit-testable without spawning; provider is a thin async shell around them.
    - Security: pack content originates from local graph files (trusted-ish) but still flows through the context channel — size caps enforced (32 KiB block ceiling, ponytail parity); no provider keys touched here (asks are structural/$0).
  - Approach:
    - Documentation Reviewed:
      - graft `hooks.ts` `prompt` branch (gates, `-n 3`, scope hint, pointers-not-`--source` rationale comment), `src/claude/format.ts` (retrieval rendering — reimplement minimal pointer formatter, do not import), `docs/instruction-injection.md` (`InstructionContribution.instructions`/`contextBlocks` honored fields), `packages/prism-ponytail/src/mode.ts` (entry scan/persist), `docs/input-and-prompt-assembly.md`.
    - Options Considered:
      - Inject `ask --source` bundles (full answer inline): rejected — fresh full-price tokens every turn; graft's own hooks deliberately ship pointers-only for per-turn injection.
      - `InstructionInjector` for the retrieval pack (original plan sketch): rejected after Task 1 verification — `apply` is synchronous (`contracts-core/agent.ts:227`), cannot await the CLI ask; would force fire-and-forget staleness or core changes. `ContextProvider.resolve` is the purpose-built async seam and additionally routes packs through `applyContextBudget` demotion.
    - Chosen Approach:
      - Async `ContextProvider` carrying pure gate/formatter functions; session state via custom entries; orientation once via a separate synchronous injector (`graft-orient`, `first_turn`) so hosts can adopt the two independently.
    - API Notes and Examples:
      ```ts
      const graftProvider: ContextProvider = {
        name: "graft-context",
        async resolve(ctx) {
          const text = latestUserText(ctx.messages);
          if (!shouldQuery(text)) return [];
          const ask = await runGraftJson(resolved, ["ask", clip(text), ".", "--json", "-n", "3"],
            { cwd, timeoutMs: budget, maxResultBytes, env: childEnv(opts), signal: ctx.signal });
          if (!ask) return [];
          return formatPointerPack(ask, seenFor(sessionId)); // ContextBlock[] — pointers only
        },
      };
      // attached: registerSkill({ name: "graft", …, context: [graftProvider] })
      //           → session flattens active-skill context (agent-session/session.ts:438)
      ```
    - Files to Create/Edit:
      - `packages/prism-graft/src/injector.ts`: gates, formatter, orientation loader.
      - `packages/prism-graft/src/state.ts`: `graft-state` entry encode/decode/merge (cap logic).
    - References:
      - `docs/compaction-observational-memory.md` attach pattern; ponytail `INJECTOR_NAME` conventions.
  - Test Cases to Write:
    - `__tests__/injector.test.ts`: short-prompt skip; oversize skip; dedup across turns (second turn with overlapping nodes injects nothing); cap eviction at 257th id; pointers-only invariant (formatter output contains no fenced code blocks from crux/source fields); signal-abort ⇒ empty contribution; state round-trip through fake store.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (two injectors + `graft-state` session entry type).
    - Docs pages to create/edit: `docs/graft.md` push-mode section incl. entry schema JSON (Task 8).
    - `docs/index.md update`: deferred to Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 6 — L3b: post-edit blast-radius middleware
  - Acceptance Criteria:
    - Functional: `tool_result` middleware matches tool names against `editToolNames` (default `["write","edit","multiedit","apply_patch"]`), extracts the touched path from result metadata/path fields (host-shape tolerant, graft's `editedFilePath` dual-shape lesson), ignores paths under `graft/`, and: marks session dirty (persisted in `graft-state`), emits `graft:dirty` event with `{ path, staleCountEstimate }`, and appends a blast-radius notice to the tool result metadata — dependents computed via one bounded `graft callers`/wiring lookup; absent graph ⇒ silent no-op (fail soft, graft's rule).
    - Functional: no automatic rebuild spawn (G6); next `ask`/`grep` self-refreshes — document this in skill text and `docs/graft.md`.
    - Performance: middleware adds O(bounded CLI call) only on edit-tool results; lookups share `retrievalBudgetMs`; never blocks the tool result pipeline on failure (catch → `next(result)` unchanged).
    - Code Quality: path extraction pure function with table-driven tests across host shapes.
    - Security: path never executed; only compared/relayed; event payloads carry repo-relative paths (redacted absolute).
  - Approach:
    - Documentation Reviewed:
      - graft `hooks.ts` `handlePostEdit`/`editedFilePath`/`underGraft` (PostToolUse mechanics, Claude `file_path` vs Codex patch-header shapes), `docs/tool-effects.md` + `src/tool-effects.ts` (result metadata augmentation precedent), `docs/middleware-hooks.md`.
    - Options Considered:
      - Port the detached Stop-rebuild (G6): rejected — queries self-refresh structurally; a background builder adds process-lifecycle risk for cosmetic freshness.
      - Compute blast radius from `graft/.graph/wiring.json` directly (read file, walk edges in-process): viable and faster, but couples us to an internal artifact format pre-1.0; CLI route survives format churn. Revisit at L4.
    - Chosen Approach:
      - Middleware + CLI lookup + event emission; dirty flag only influences `graft status` output and the injector's staleness banner.
    - API Notes and Examples:
      ```ts
      api.use<ToolResult>("tool_result", async (result, next) => {
        const path = editedPathFrom(result, editToolNames);
        if (!path || underGraft(projectDir, path)) return next(result);
        const br = await blastRadiusFor(path);          // null-safe, budgeted
        await api.emit({ type: "graft:dirty", metadata: { path, stale: !br ? undefined : true } });
        return next(br ? withGraftMetadata(result, br) : result);
      });
      ```
    - Files to Create/Edit:
      - `packages/prism-graft/src/edit-watch.ts`: extraction, `underGraft`, blast-radius lookup, middleware factory.
    - References:
      - `docs/coding-agent-tools.md` tool-name truth (align `editToolNames` defaults with actual coding tool registry names at execution time).
  - Test Cases to Write:
    - `__tests__/edit-watch.test.ts`: extraction per host shape (direct `file_path` metadata; nested result path; patch-header synthetic case); `graft/` paths ignored; no-graph no-op passes result untouched; failing lookup degrades silently; event emitted once per edit.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new middleware behavior + `graft:dirty` event).
    - Docs pages to create/edit: `docs/graft.md` deep-integration section (Task 8).
    - `docs/index.md update`: deferred to Task 8.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 7 — Network-free example + combined demo fixture
  - Acceptance Criteria:
    - Functional: `examples/graft-extension.ts` compiles under the examples tsconfig and demonstrates: resolving a stub CLI (fixture script at `packages/prism-graft/fixtures/stub-graft.mjs`), kernel load, one pull-tool call, one push turn with pack injection, one simulated edit producing blast radius — all against fixture JSON, no real graft, no network, no native modules.
    - Performance: example runs < 1s; fixtures are static files.
    - Code Quality: mirrors `examples/caveman-ponytail.ts` structure (combined progressive-disclosure demo precedent).
    - Security: fixture stub accepts only `--echo-argv` style modes; example asserts `DO_NOT_TRACK` reached the child.
  - Approach:
    - Documentation Reviewed:
      - `examples/caveman-ponytail.ts`; ponytail `fixtures/` layout; `docs/docs.test.ts`-adjacent example compile checks (examples are compile-checked per `docs/index.md` notes).
    - Options Considered:
      - Live-CLI example guarded by env: rejected — house rule is network-free/mock demos; live coverage belongs to protected journeys (none for graft this plan; noted in Further Actions).
    - Chosen Approach:
      - Stub-CLI fixture doubles as the test seam used by Tasks 3–6 tests — one fixture, two consumers.
    - Files to Create/Edit:
      - `packages/prism-graft/fixtures/stub-graft.mjs`: deterministic JSON responses keyed by subcommand.
      - `examples/graft-extension.ts`: end-to-end demo.
    - References:
      - graft test seams (`GRAFT_TEST_CLI` concept in `hooks.ts`) — replicated as an options-level seam rather than env magic.
  - Test Cases to Write:
    - covered by example compile check + existing test suite invoking the same fixture.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (example only).
    - Docs pages to create/edit: `docs/graft.md` Implementation example references this file (Task 8).
    - `docs/index.md update`: examples list line gains `examples/graft-extension.ts` (Task 8, batched).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 8 — Documentation, navigation, package-truth, release bookkeeping
  - Acceptance Criteria:
    - Functional: `docs/graft.md` follows the prism-wiki API page structure exactly (What/When/Inputs/Outputs/Request-response/Implementation/Extension-config/Security-performance/Related) covering `createGraftExtension`, options table, tool table, injector names, `graft-state` entry schema, events, L0 guidance (zero-code pull via host shell tool + graft-generated instruction files).
    - Functional: `docs/index.md` gains one Extensions/plugins entry (functional description + link) and the examples-list addition; navigation grouping unchanged otherwise.
    - Functional: `node scripts/package-truth.mjs` regenerated — graph 58 packages; derived docs literals updated; drift gate green.
    - Performance: n/a (docs).
    - Code Quality: docs lint/tests (`docs.test.ts`) green; terminology matches manifests (opt-in, not in code/sdk/all profiles).
    - Security: docs state telemetry default-off posture, fixed-env child policy, `GRAFT_API_KEY` host-supplied via `providerEnv` (recommend routing through Prism credential resolution), pre-1.0 upstream pin caveat.
  - Approach:
    - Documentation Reviewed:
      - `docs/ponytail.md`/`docs/caveman.md` (page shape), `.agents/skills/create-plan/references/prism-wiki.md` (required sections), `docs/release-and-install.md` (package-count narrative regeneration), `docs/index.md` Extensions/plugins group.
    - Options Considered:
      - Fold graft docs into `ponytail.md`-style single page vs separate: separate page (new package, distinct surface) — matches Caveman/Ponytail precedent of one page per behavior package.
    - Chosen Approach:
      - Single `docs/graft.md`; batch all index/nav/truth updates in this final task to keep intermediate commits navigable.
    - API Notes and Examples:
      - Request/response JSON blocks: `graft_ask` tool call + `graft-state` entry + `graft:status` event.
    - Files to Create/Edit:
      - `docs/graft.md`: new page (full structure).
      - `docs/index.md`: Extensions/plugins entry + examples line.
      - `scripts/package-truth.json`: regenerated output.
      - `docs/release-and-install.md`: regenerated count/literals (script-driven only; hand-edits forbidden by drift gate).
    - References:
      - prism-wiki reference; plan 030 Task ordering precedent (docs last, gates after).
  - Test Cases to Write:
    - run `docs.test.ts`, package-truth drift gate, full `npm test` — recorded as verification, no new test file.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (this task *is* the documentation surface).
    - Docs pages to create/edit: as listed above.
    - `docs/index.md update`: yes — Extensions/plugins entry `[Graft context-graph integration](graft.md)`.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [x] Task 9 — Final verification sweep
  - Acceptance Criteria:
    - Functional: full workspace build + typecheck + Biome lint + `npm test` green including new package tests; compat/public-export contract tests unaffected (no core edits); `pack:dry-run` for `prism-graft` produces expected tarball contents (dist only, no fixtures leakage beyond intended).
    - Performance: no regression in core suites; new package contributes no startup cost to hosts that don't load it.
    - Code Quality: no TODOs left in dist-facing code; `ponytail:` ceilings commented where accepted (seen-set cap, no-background-rebuild).
    - Security: threat-review checklist over new boundaries (subprocess argv/env/stdout bounds, path handling) attached to plan Compromises section; audit level unchanged (new package adds no runtime deps to core; peer-only).
  - Approach:
    - Documentation Reviewed: `scripts/with-build-lock.mjs`, `scripts/coverage-thresholds.json` (add `prism-graft` row if denominator requires), prior plan verification sweeps.
    - Options Considered: skip dry-run — rejected, cheap and catches `files` mistakes.
    - Chosen Approach: standard gates in dependency order, evidence summarized into this plan's Compromises/Further Actions.
    - Files to Create/Edit:
      - `plans/033-Prism-Graft-L0-L3-Deep-Integration.md`: checkboxes + closing sections.
      - `scripts/coverage-thresholds.json`: possible new-row edit (tentative — verify whether script auto-includes new packages first).
    - References: plan 030 verification task shape.
  - Test Cases to Write:
    - none new; execution of existing suites is the deliverable.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no.
    - Docs pages to create/edit: none (reason: verification only).
    - `docs/index.md update`: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Research Record

### Task 1 inventory — primitive map (verified against source)

Execution notes:
- **Task 2**: `resolveGraftCli` also rejects **relative** `cliPath` and existence-checks explicit paths at resolve time (fail-closed posture extends to the explicit branch); tests cover both. Fixture `fixtures/graft-package-fixture` (manifest-declared bin → `dist/cli.js`) doubles as the explicit-`cliPath` test target.
- **Task 3**: runner returns `{ ok, value, reason? }` (`RunGraftResult`) instead of the sketched bare `parsed \| null` — required so graft `check`'s exit-1-with-valid-JSON recovery is distinguishable at call sites; `value === null` still means "caller skips silently". Timeout math lives in `childTimeoutMs(budget)` (budget − 2s, floor 4s); `runGraftJson` honors its `timeoutMs` verbatim. Docs-truth upkeep normally deferred to Task 8 was pulled forward because the scaffold itself flips the generated counts: regenerated `scripts/package-truth.json`, bumped canonical narrative in `docs/release-and-install.md` (59/58/31), named graft in the release page + README umbrella omission wording + `plans/README.md` index, added house changelog lineage sections, and bumped the three sanctioned frozen-count/omission assertions in `src/__tests__/docs.test.ts`. New workspace packages must be followed by one root `npm install` or `npm ls` (packaging guard) reports an unmet link.
- **Task 4**: tools declare Prism-native read-only effects as `{ kind: "none", idempotency: "none" }` (the validator rejects any other idempotency paired with kind "none") and `kind: "search"` (no generic `"tool"` ToolKind exists). Success results carry both `value` (parsed JSON) and bounded re-stringified `content[0].text`; failures map stderr tails through `RunGraftResult.detail` → `code: "graft_not_built"` with `/graft build` remediation, else `invalid_arguments` / `<reason>`. Deliberate ceiling: `blast` stays `--json` only (markdown passthrough needs a raw-text runner branch; marked `# ponytail:` in code). Fixture stub echoes argv for all six subcommands and simulates an unbuilt graph on a `__UNBUILT__` sentinel.
- **Task 5**: provider rides `Skill.context` (`graft-context`) + separate synchronous injector `graft-orient` (`when: "first_turn"`); freshness for the staleness banner snapshots at kernel load because the injector seam is sync — refresh lands via the next `/graft check`. Seen-ids/savedTokens persist through the existing `persistGraftPatch` (`graft-state` entries, CAS), read per-resolve from `getEntries()` — no in-memory session cache needed. Ask result shape is parsed tolerantly (`nodes|results|matches|hits`, `id|symbol|name`, `path|file`) since graft 0.x has churned it; formatter is pure and never emits fenced source bodies. Orientation cut is byte-accurate including the truncation suffix. Per-resolve `ctx.sessionId` threads into persistence. Gates/formatter/cap/loader are pure functions; provider shell degrades every failure (null, throw, abort) to an empty contribution.
- **Task 6**: `editToolNames` default corrected against the actual coding-agent registry — `"write" | "edit" | "move"` (no `multiedit`/`apply_patch` exists here; plan's own execution-time alignment rule applied). Canonical touched-path source is `ToolResult.metadata.path` (host stamps absolute paths there); extractor tolerates `filePath`/`file_path` and graft's dual string/object shape, then filters `underGraft`, relativizes for events/metadata. Middleware is pure-core (`createEditWatchMiddleware`) + thin wiring (`wireEditWatch`): blast lookup budgeted off shared runner; absent graph ⇒ result passed untouched but dirty still recorded; any throw ⇒ `next(result)` unchanged. Dirty flag added to `graft-state`; `graft:dirty` carries repo-relative path + optional `staleCountEstimate`. Session id read best-effort from result metadata (`sessionId`), since the tool_result hook has no context object. Fixture contract: `blast <*.ts>` → dependents summary, `__NOGRAPH__` → exit-2 stderr, other targets → argv echo. No auto-rebuild anywhere (G6) — skill text now states the one-turn lag/self-refresh behavior.
- **Task 7**: skipped creating a second `stub-graft.mjs` — the chosen "one fixture, two consumers" approach already lives at `fixtures/graft-package-fixture/bin/graft.mjs` (moved out of `dist/` after CI: the root `.gitignore` `dist/` rule silently excluded the fixture from the commit); the example drives it via **`packageRoot`** resolution (manifest bin runs through node — an absolute `cliPath` spawn hits EACCES on non-executable fixtures). Fixture grew two deterministic modes for the demo: `ask …__PACK__…` → retrieval-pack nodes payload, plus a static `graft/INDEX.md` for orientation. To make the `DO_NOT_TRACK` child-env guard observable, `runGraftJson`/`childEnv` (+ `childTimeoutMs`, `DEFAULT_MAX_RESULT_BYTES`) are now public exports. Demo covers all four beats: pull-tool call, push turn via `assembleProviderInput({ contextProviders })` with pointers + orientation + dedup-empty second turn, simulated edit producing `graftBlast` metadata, env probe. Gated by the repo examples compile+run check (`docs.test.ts` demos array) and listed in `examples/README.md`.
- **Task 8**: `docs/graft.md` follows the prism-wiki page structure exactly (What/When/Inputs/Outputs/Request-response/Implementation/Extension-config/Security-performance/Related), including the L0 zero-code alternative, telemetry default-off/fixed-env child policy, `providerEnv` credential-routing note, and the pre-1.0 tolerant-parsing caveat. `docs/index.md`: Third-party integrations entry + examples-list line + stale "57-package graph" narrative corrected to 59/root+58. Truth/bookkeeping gates that encode graph-growth formulas were extended with a graft term mirroring the wiki precedent: `phase24-truth` (counts + umbrella omits), `phase27-release` (publishable/workspace), `phase29-freeze`/`phase30-freeze` (`added` term); `phase16-freeze` lockfile name-set exclusion gained `packages/prism-graft` (workspace link only, no new external deps). Phase 13–21 baseline `manifestCount`s refreshed to the coherent current tree (counted workspace 55 / publishable 56 / provider 17 / prism-family dirs 11) with dated `$comment` trail entries per established precedent. `budgets.json` root `packedBytes` re-baselined 891578→938567: measurement showed pre-existing docs-line drift (938368 packed at HEAD before any plan-033 change); graft's own delta is 199 bytes of docs. `release.test.ts` package count 58→59. Full `npm test` green (core 1669, script suites 365).

Every planned capability mapped to an existing primitive. **No capability gap found; zero core edits required.** One planned-shape correction: the push-mode retrieval ask cannot run inside an `InstructionInjector` (sync `apply`) — it rides `ContextProvider`, which is strictly better suited (async, abortable, budget-participating). Task 5 updated accordingly.

| Planned capability | Primitive (file · symbol · line) | Fit notes |
| --- | --- | --- |
| L2 six pull tools | `src/extensions.ts` `createApi.registerTool` (tracked, unwound on dispose); shape `src/contracts-protocol.ts:340` `ToolDefinition` — `name/kind?/description/parameters/exclusive/effect/elicitation/execute(args, ctx) → ToolResult` | `execute` is async ⇒ CLI subprocess awaits natively. `parameters` JsonObject = JSON-schema surface for per-tool args. |
| Edit-result interception | `src/tools.ts:152` `middleware.run<ToolCallContent>("tool_call", …)`; `src/tools.ts:255` `middleware.run<ToolResult>("tool_result", raw)`; registry sourced from `agent.config.middleware` (`src/agent-session/session.ts:637`) | `ToolResult` (`contracts-protocol.ts:375`) carries `metadata?: Readonly<Record<string, unknown>>` ⇒ blast-radius augmentation has an official field; `name` drives edit-tool matching. Host wires kernel middleware into agent config (example precedent: `examples/caveman-ponytail.ts`). |
| Push-mode retrieval pack (async) | `src/contracts-core/agent.ts:185` `ContextProvider { name; resolve(ctx: ContextResolutionContext) → Promise<ContextBlock[]> \| ContextBlock[] }`; ctx carries `messages`, `signal`, sessionId/runId/metadata. Flows into runs three ways: `AgentConfig.context`, **active-skill `Skill.context`** (flattened at `src/agent-session/session.ts:438`), and post-injector merge (`injectedBlocks`, `src/input.ts` `resolveContextProviders`) | The async seam. Registered graft skill can carry the provider so enabling the skill enables push mode; providers' blocks pass through `applyContextBudget` ⇒ token-budget demotion for packs comes free. |
| Orientation (first-turn, sync-cheap) | `InstructionInjector` (`contracts-core/agent.ts:227`) — `apply(ctx: InstructionContext): InstructionContribution` is **synchronous**; contribution = `{ instructions?, contextBlocks?, when: "first_turn"\|"every_turn"\|"on_input", predicate? }` | Sync-only ⇒ bounded `readFileSync` of `graft/INDEX.md` (8 KiB cap) is fine here; the CLI ask must NOT go here (finding above). Injectors run once per turn inside `assembleProviderInput` (`src/input.ts:191`, Phase 30 note), redacted input, turn/predicate filtered. |
| Gating/dedup/format pure logic | plain module functions (no primitive needed) | `shouldQuery`, `formatPointerPack`, seen-set merge — unit-tested without spawn. |
| Session state persistence | `createSessionEntry({ sessionId, parentId: entries.at(-1)?.id, kind: "custom", data: { type, … } })` + `appendEntry(entry, { expectedParentId })` CAS — exact pattern `packages/prism-ponytail/src/mode.ts` (`persistMode`, `resolveModeFromEntries`) | `graft-state` entry type clones this. Restore = latest-match scan over `getEntries()`. |
| L1 commands | `CommandDefinition` (`contracts-core/agent.ts:154`) via `registerCommand`; execution precedent `kernel.registries.commands.get("graft").execute(...)` (caveman-ponytail example:76) | `CommandExecutionContext` carries `signal`. |
| L1 skill | `Skill` (`contracts-core/agent.ts:271`) — static `instructions` body; no upstream skill-file loading needed (unlike ponytail, graft needs no file harvest) | Simpler than ponytail: skills.ts shrinks to constants. |
| Status/savings events | `api.emit({ type: "graft:*", metadata })` via `ExtensionEventBus` (`src/extensions.ts:55-108`) — `ponytail:status` precedent | Host TUI consumes; no statusline scripts (house rule). |
| Middleware wiring | `api.use(hook, mw)` registers into kernel `MiddlewareRegistry`; host passes it as `config.middleware`; runtime hooks invoked at `tools.ts:152/255`, `input.ts:133` (`context`), `session.ts:673` (`provider_request`), `1482` (`retry`), `1726` (`compaction`) | `session_start`/`session_shutdown` are declared hook names (`src/middleware.ts:13-14`) without a core invocation site found — treat as host-invoked; graft does not depend on them. |

Trust boundaries crossed (all bounded by existing primitives/patterns):
1. Subprocess spawn — array argv (no shell), fixed-base env + explicit `providerEnv` (+ `DO_NOT_TRACK=1` default), cwd pinned, wall-clock deadline, byte-capped stdout before parse.
2. CLI stdout → JSON — parse after cap; non-zero exit with valid stdout recovered (graft `check` semantics).
3. Tool-result path extraction — string handling only, never executed; repo-relative relay; absolute paths redacted in events.
4. Instruction channel — 32 KiB instruction ceiling / 8 KiB orientation cap / 512 KiB result cap (ponytail parity constants).
5. Child secrets — `GRAFT_API_KEY` etc. only via host-supplied `providerEnv`; never inherited process env.

Seed findings from pre-plan analysis (superseded where the table above differs):

- **Graft surface**: CLI subcommands all support `--json`; `check` signals drift via exit code 1 with valid stdout (must recover, not treat as failure). Child budget in graft's installed hooks: 8s (15s for cold-refresh-after-upgrade repos); overhead reserve 2s; floor 4s. Prompt gate: `<12` chars never queried. Push packs are pointers-only by design; `--source` bundles are for agent-initiated pulls.
- **Graft library gap**: `src/index.ts` exports `Graft` engine (init/check), `buildContext`, `checkContext`, AI factories — no `ask`/`grep`/`callers`/`map`/`blast`. CLI subprocess is the sanctioned retrieval seam (graft's own hooks use `execFileSync(process.execPath, [graftCliPath(), …])`).
- **Prism kernel mapping** (Claude Code → Prism): `SessionStart` → `first_turn` orientation injector; `UserPromptSubmit` → `every_turn` injector returning `instructions`; `PostToolUse` → `tool_result` middleware; `Stop` background rebuild → intentionally unmapped (G6); statusline → `graft:*` events; `.mcp.json` server → native `registerTool`; `SKILL.md` → `registerSkill`.
- **Adapter precedent**: `prism-ponytail` provides resolution/bounding/redaction/session-persistence patterns to clone; packages never import each other — helpers duplicated locally.
- **Trust labels**: indexed-code-search labels index results `untrusted_index`; graft tool metadata adopts analogous `source: "graft-graph"` marker.

## Compromises Made

### Verification evidence (Task 9 sweep)

- **Gates**: full workspace build + typecheck clean; `npm test` green across all 54 suites (core 1669/1669 incl. docs 146, release, packaging, freeze/truth gates; workspace packages incl. prism-graft 61/61); Biome check clean on all plan-touched files (pre-existing assist/format findings in unrelated files `src/index.ts`, `coding-security`, `phase30-antigravity-probe` left untouched — outside this plan's diff). `npm pack --dry-run` for `@arnilo/prism-graft`: 26 files — dist only + package.json/README/LICENSE/CHANGELOG; no fixtures, no tests, no maps. Coverage summary gate satisfied with a new evidence-based row (`prism-graft`: lines 95.76 / branches 81.45 / functions 92.63).
- **Threat-review checklist over the new boundaries**:
  - Subprocess argv: array argv only, no shell; prompts capped (`maxPromptChars` 4096); tool args are single-element strings (no argv injection surface).
  - Subprocess env: fixed-base env; host env never inherited; only explicit `GRAFT_*` keys from `providerEnv` pass through; `DO_NOT_TRACK=1` default with demo/test proof.
  - Stdout/stderr bounds: `maxResultBytes` cap (default 512 KiB) before parse; stderr tail redacted via shared `redactPaths`; timeouts derived from caller budget minus overhead.
  - Path handling: `cliPath` rejects relative paths and existence-checks absolutes at resolve time; upstream paths in errors redacted (home dir → `~`); edited-path extraction filters to `underGraft` and relativizes before events/metadata.
  - Upstream output treated as untrusted: bounded reads everywhere (INDEX.md cut 8 KiB byte-accurate, pack ceiling 32 KiB), pointers-only formatters never emit source bodies.
- **Audit posture unchanged**: peer-only optional dependency, zero runtime deps in the package manifest, no core edits (compat/public-export contract suites untouched and green).
- **Accepted ceilings (`ponytail:` comments in code)**: seen-set is a capped linear-scan array (LRU map only beyond 256 pushes); no background rebuild — dirty recorded, `/graft build` or graft's self-refresh covers resync; blast stays `--json` only; freshness snapshots at kernel load because the injector seam is synchronous.

## Further Actions

- To be filled after task completion with improvements, rationale, and priority. Known candidates ahead of time: L4 `RepositoryIndexBackend` seam (G10), detached background resync revisited (G6), scope-hint narrowing for monorepos (`--in` from last-edited scope, graft's `lastFileScopeHint`), protected live journey against a real graft-built repo, MCP-transport alternative if CLI churn bites.
- Post-sweep additions: none blocking. All sweep findings were resolved in-plan (coverage threshold row, biome fixes on touched files, budgets re-baseline documented under Task 8). The candidates above remain the priority queue.
