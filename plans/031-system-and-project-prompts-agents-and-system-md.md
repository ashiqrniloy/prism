# Phase 31 — System and project prompts (AGENTS.md and SYSTEM.md)

## Objectives

- Implement the documented standard system/project prompt layout — `<workspace>/AGENTS.md` (project prompt) and `~/.prism/agent/SYSTEM.md` (user/global system prompt) — as `SystemPromptContribution` layers fed into the existing `composeSystemPrompt`/`mergeSystemPromptConfig` pipeline, not a parallel mechanism.
- Reuse the existing `SystemPromptSource` + `mode` layering primitive; the project prompt is a `source: "app"` contribution and the global system prompt is a `source: "user"` contribution, both `mode: "append"`.
- Load both files through a host/CLI-owned Node filesystem loader (trust-gated for the workspace `AGENTS.md`, opt-in/auto for the user-owned `~/.prism/agent/SYSTEM.md`); standalone SDK use with no filesystem touches nothing and `AgentConfig.instructions`/`systemPrompt` keep working unchanged.
- Add explicit CLI flags to override (`--agents-md-file`/`--system-md-file`) or disable (`--no-agents-md`/`--no-system-md`) each layer, with `RunOptions.systemPrompt: false` still disabling all layers for a run.
- Keep secrets, events, and session store behavior unchanged: no prompt content is stored beyond what `AgentConfig.instructions`/`systemPrompt` already emits; redaction is unaffected.
- Document the layout, layering order, trust model, CLI flags, and the standalone-SDK escape hatch; ship a compile-checked example.

## Expected Outcome

- A workspace with `<workspace>/AGENTS.md` and a user with `~/.prism/agent/SYSTEM.md` both contribute to the composed system prompt in the documented order (`SYSTEM.md` as the base, then registered package contributions, then `AGENTS.md`, then host `AgentConfig.systemPrompt`, then `RunOptions.systemPrompt`); disabling a layer via its flag removes only that layer.
- Removing both files reverts to `AgentConfig.instructions` only — no hidden prompt, no filesystem read in standalone SDK use.
- Trust model: an untrusted workspace `AGENTS.md` is not loaded unless the user opts in (reuse Phase 10/16 `createPathTrustPolicy`); the user-owned `~/.prism/agent/SYSTEM.md` is loaded by the CLI when present, with `--no-system-md` to opt out.
- An `AGENTS.md`/`SYSTEM.md` carrying secret-looking text is treated like any caller-supplied prompt text: it flows through `redactProviderRequest` on the assembled `ProviderRequest`; no new redaction path is added.
- `docs/system-prompts.md` documents the `AGENTS.md`/`SYSTEM.md` layout, layering order, trust, and CLI flags; `docs/contribution-discovery.md` and `docs/cli-rpc.md` cross-reference; `docs/index.md` description updated; a compile-checked `examples/system-project-prompts.ts` ships.
- `npm test` stays network-free and under the documented `<30s` budget.

## Tasks

- [x] Task 1 — Primitive review: inventory existing system-prompt / discovery / trust / CLI primitives before adding code
  - Acceptance Criteria:
    - Functional: A `Primitive Review` subsection is appended under this task documenting, for each Phase 31 concern (project prompt file, global system prompt file, layering order vs. current `sourceRank`, trust gating, CLI auto-load + override/disable flags, SDK escape hatch, redaction, event/store impact), which existing primitive already covers it and which gap requires new code. Reuses the identified primitive where it covers the need; only generic new primitives are proposed.
    - Performance: Review performs no I/O; read + write of analysis text only.
    - Code Quality: Every proposed new file/function is justified against an existing one; no duplicate prompt pipeline, no parallel composition path, no new `SystemPromptSource` value introduced where reordering suffices.
    - Security: Review explicitly states `AGENTS.md` is trust-gated, `SYSTEM.md` is user-owned, and produced prompt text is subject to existing redaction with no new secret surface.
  - Approach:
    - Documentation Reviewed:
      - `src/system-prompts.ts` `composeSystemPrompt`/`mergeSystemPromptConfig`/`asContributions`/`sourceRank` — the layered prompt primitive Phase 31 layers into, not beside. Current `sourceRank = {package:0, app:1, user:2, run:3}`; Phase 31's documented order (`SYSTEM.md` user global → package → app/project → host → run) requires `user` to be the **base** (rank 0), so a rank reorder is in scope and any test/doc encoding the old order must be realigned.
      - `src/contracts.ts` `SystemPromptContribution`/`SystemPromptMode`/`SystemPromptSource`/`SystemPromptConfig`, `AgentConfig.instructions`/`systemPrompt`, `RunOptions.systemPrompt` — the public layering surface; already covers `{id, source, mode, text, metadata}` for both files with no new field.
      - `src/node/contribution-discovery.ts` `discoverContributions`/`readOptionalFile`/`isPathInsideReal`/`assertPermission`/`isMissingFile` — the read + trust pattern to reuse for root-level `AGENTS.md`/`SYSTEM.md`; the named-subdir `scanKindRoot` does **not** fit root files, so a small sibling root-file loader is the minimal addition (ponytail: one `readdir`-free `readFile`, not a new scan kind).
      - `src/node/trust.ts` `createPathTrustPolicy`/`isPathInsideReal` — Phase 10/16 trust used to gate workspace `AGENTS.md`.
      - `src/security.ts` `assertPermission`/`redactAgentEvent` + `src/redaction.ts` `redactProviderRequest` — redaction already runs on the assembled `ProviderRequest`; prompt-text contributions need no new redaction code.
      - `src/cli-runner.ts` `parseCliArgs`/`runCli`/`defaultCreateSession`/`runOptions` — currently passes only `instructions: options.system`; the loader is wired here, contributions flow into `AgentConfig.systemPrompt`. `--system` is already taken, so disable/override flags must use distinct names.
      - `docs/system-prompts.md`, `docs/contribution-discovery.md`, `docs/cli-rpc.md`, `docs/index.md` — docs pages to update (Task 7).
      - `examples/system-prompts.ts` and `src/__tests__/system-prompts.test.ts` — existing example/test encoding the old `package, app, user, run` ordering; Task 2 realigns them.
      - `.agents/skills/create-plan/references/prism-wiki.md` — API page structure (Task 7).
    - Options Considered:
      - Add a new `SystemPromptSource` value (e.g. `"global"`) for `SYSTEM.md` to avoid reordering `user`: rejected — the roadmap explicitly assigns `SYSTEM.md` `source: "user"` and `AGENTS.md` `source: "app"`; a new source duplicates a concept the existing `user`/`app` sources already name, and the reordering is one `Map` literal (ponytail: shortest diff).
      - Route `AGENTS.md`/`SYSTEM.md` through the `discoverContributions` subdir scanner as a new `ContributionFileKind`: rejected — both files are root-level single files (`<workspace>/AGENTS.md`, `~/.prism/agent/SYSTEM.md`), not named subdirs under `.agents/{kind}s/`; forcing them through `scanKindRoot` adds special-casing. A dedicated 2-call `readFile` loader is smaller than extending the scanner.
      - Auto-load both files from core (hidden global): rejected — non-negotiable boundary "Host controlled. No hidden globals." The loader is Node/CLI-owned and opt-in-or-trust-gated; SDK API users get nothing unless they pass the contributions themselves.
      - Treat `SYSTEM.md` as opt-in behind `--discover-global` (mirror Phase 29): rejected for the CLI — roadmap states "walk-up discoverability: the CLI loads `AGENTS.md` and `~/.prism/agent/SYSTEM.md` automatically when present and trusted." `SYSTEM.md` lives in the user's own home and is treated as user-trusted; CLI loads it by default with `--no-system-md` to opt out. `AGENTS.md` is workspace-owned and stays trust-gated. SDK API is unaffected (no FS).
    - Chosen Approach:
      - Reorder `sourceRank` to `{user:0, package:1, app:2, run:3}` so `SYSTEM.md` (`source:"user"`) is the base layer and the documented arrow order holds (Task 2).
      - Add a Node `loadSystemPromptFiles({workspaceRoot?, globalRoot?, trust?, permission?})` returning `SystemPromptContribution[]` (Task 3): reads `<workspaceRoot>/AGENTS.md` (trust-gated, `source:"app"`, `id:"agents-md"`) and `~/.prism/agent/SYSTEM.md` (`source:"user"`, `id:"system-md"`) when the corresponding root is supplied and the file exists; missing files are skipped (ENOENT-tolerant). No `import()`, no module execution.
      - Wire the CLI to auto-load both files (Task 4): `AGENTS.md` trust-gated via `createPathTrustPolicy({trustedRoots:[workspaceRoot]})`, `SYSTEM.md` from `homedir()`; new flags `--no-agents-md`/`--no-system-md` (disable), `--agents-md-file <path>`/`--system-md-file <path>` (override path). Loaded contributions flow into `AgentConfig.systemPrompt` (merged with any explicitly passed contributions). The existing `--system` text stays `AgentConfig.instructions` (base).
    - API Notes and Examples:
      ```ts
      // src/node/system-project-prompts.ts (new, Node subpath)
      import { readFile } from "node:fs/promises";
      import { join } from "node:path";
      import type { SystemPromptContribution } from "../contracts.js";
      import { isPathInsideReal } from "./trust.js";
      import { assertPermission } from "../security.js";
      import type { PermissionPolicy, TrustPolicy } from "../security.js";

      export interface SystemPromptFilesOptions {
        readonly workspaceRoot?: string;        // reads <workspaceRoot>/AGENTS.md (trust-gated)
        readonly globalRoot?: string;            // reads <globalRoot>/.prism/agent/SYSTEM.md
        readonly trust?: TrustPolicy;
        readonly permission?: PermissionPolicy;
      }

      export async function loadSystemPromptFiles(
        options: SystemPromptFilesOptions,
      ): Promise<readonly SystemPromptContribution[]> {
        const out: SystemPromptContribution[] = [];
        // ponytail: user-owned global file is the base (source:"user"); workspace file is source:"app".
        const system = await readGlobal(options.globalRoot, options.permission);
        if (system) out.push(system);
        const agents = await readAgents(options.workspaceRoot, options.trust, options.permission);
        if (agents) out.push(agents);
        return out;
      }
      ```
    - Files to Create/Edit:
      - `plans/031-system-and-project-prompts-agents-and-system-md.md` (this file): append `Primitive Review` subsection once complete.
    - References:
      - `src/system-prompts.ts`, `src/contracts.ts`, `src/node/contribution-discovery.ts`, `src/node/trust.ts`, `src/security.ts`, `src/redaction.ts`, `src/cli-runner.ts`.
      - Roadmap Phase 31; non-negotiable boundaries "Host controlled. No hidden globals" and "Defaults are replaceable."
      - Plans 013 (trust model), 016 (redaction/session-data hardening), 029 (workspace/global discovery), 030 (instruction injection).
  - **Primitive Review** (Task 1 output — no code; read + analysis only):
    - **Layered composition primitive:** Covered. `composeSystemPrompt(contributions, {base})` ranks contributions by `source` (current `sourceRank = {package:0, app:1, user:2, run:3}`) with stable tie-break by input index, applies `append`/`prepend`/`replace`/`disable` modes, and joins non-empty parts with `\n\n`. `mergeSystemPromptConfig(config, override)` concatenates config + run contributions (`override:false` → `[]`). No new composition primitive needed. → **Gap (Task 2):** the current rank puts `user` (`package:0 < app:1 < user:2 < run:3`) **above** package/app, but Phase 31's documented layering arrow (`SYSTEM.md` user global → package → `AGENTS.md` app → host → run) requires `user` to be the **base** (rank 0). One `Map` literal reorder to `{user:0, package:1, app:2, run:3}`; no new `SystemPromptSource` value. This is a behavior change for any caller currently relying on `source:"user"` as a high-priority caller override → documented in `docs/system-prompts.md` (Task 7) and the existing `system-prompts.test.ts`/`examples/system-prompts.ts` are realigned in Task 2.
    - **Project prompt file (`AGENTS.md`, root):** No existing primitive handles root-level singleton files. `discoverContributions` (`src/node/contribution-discovery.ts`) scans **named subdirs** under `<root>/.agents/<kind>s/<name>/` (one `readdir` + `stat.isDirectory` + `isPathInsideReal` per entry) — it cannot represent a root-level `<workspaceRoot>/AGENTS.md` without special-casing `scanKindRoot`/`readEntry`/`kindDirName`, which would muddy the documented subdir layout. → **Gap (Task 3, minimal new code):** a sibling Node loader `loadSystemPromptFiles` that does at most two `readFile` calls (no `readdir`, no scan), returning `{id:"agents-md", source:"app", mode:"append", text}` when the file exists and passes trust. Mirrors the per-kind adapter precedent of `src/node/instruction-injectors.ts` (host-owned, no core auto-`import()`).
    - **Global system prompt file (`SYSTEM.md`, root):** Same gap as `AGENTS.md` — root singleton, not a named subdir. Same loader returns `{id:"system-md", source:"user", mode:"append", text}` from `<globalRoot>/.prism/agent/SYSTEM.md`. → No separate primitive; folded into the same `loadSystemPromptFiles` (Task 3).
    - **File read + ENOENT tolerance:** Covered by `readOptionalFile(path)` / `isMissingFile(error)` in `src/node/contribution-discovery.ts`, but both are **private** (module-local). → **Gap (small, Task 3):** either (a) re-export `readOptionalFile`/`isMissingFile` from the contribution-discovery module so the new loader reuses them, or (b) duplicate the ~6-line helpers locally. Choice: **export** them (reuse over duplication per the ladder; one new `export` keyword, no logic change), keeping the new loader's `readFile` path identical to the scanner's. Marked as a `ponytail:` comment in Task 3.
    - **Trust gating for workspace `AGENTS.md`:** Covered. `createPathTrustPolicy({trustedRoots})` + `isPathInsideReal` (realpath-resolved, fail-closed against symlink escapes) is the Phase 10/16 trust primitive already consumed by `discoverContributions`. → **No new trust code:** the loader passes an optional `trust: TrustPolicy` and skips the contribution when `trust.check({kind:"project", target:<workspaceRoot>/AGENTS.md})` returns `!trusted` (fail-closed, no throw), exactly mirroring `scanKindRoot`'s untrusted-root skip. The CLI builds the policy the same way discovery does (`createPathTrustPolicy({trustedRoots:[workspaceRoot]})`).
    - **`SYSTEM.md` trust:** User-owned file under `~/.prism/agent/`. → **No workspace trust check** for this file (its presence is the user's explicit choice); the contribution is returned whenever `globalRoot` is supplied and the file exists. `permission` is still asserted per read. This matches Phase 29's stance that the global root is opt-in/explicit and user-controlled, not workspace-trust-gated.
    - **Permission:** Covered. `assertPermission(policy, {kind:"resource", action:"load", target})` (`src/security.ts`) is asserted per file read in the loader, same as `scanKindRoot` asserts per directory. → **No new permission code.**
    - **CLI auto-load + override/disable:** Partially covered, needs wiring. `runCli` already resolves `--instruction`/`--injector-file` against discovered injectors (`resolveCliInjectors`) and threads results into `RunOptions`/`AgentConfig`; `defaultCreateSession` already accepts `instructions: options.system` (base). → **Gap (Task 4, wiring only):** add four flags (`--no-agents-md`/`--no-system-md` bool, `--agents-md-file`/`--system-md-file` value) to `valueFlags`/`boolFlags`/`CliOptions`, call `loadSystemPromptFiles` in `runCli`, and pass the resulting `SystemPromptContribution[]` into `AgentConfig.systemPrompt` (optionally merging with any caller-supplied contributions). `--system <text>` stays as `AgentConfig.instructions` (base) — distinct concern, no overload. RPC mode stays host-owned (no auto-load unless the host supplies a `createSession`).
    - **SDK escape hatch:** Covered by construction. `loadSystemPromptFiles` performs filesystem I/O **only** when `workspaceRoot`/`globalRoot` is passed; an SDK/embedded host that never passes roots gets `[]` and no `readFile` call. `composeSystemPrompt`/`mergeSystemPromptConfig` are pure in-memory functions. → **No new SDK-visible primitive**; existing `AgentConfig.instructions`/`systemPrompt`/`RunOptions.systemPrompt` keep working unchanged when no files are loaded.
    - **Layering order at runtime:** Covered. `RuntimeAgentSession.run` (`src/agents.ts:112`) calls `composeSystemPrompt(mergeSystemPromptConfig(this.agent.config.systemPrompt, options.systemPrompt), { base: this.agent.config.instructions })`. Since both `AGENTS.md` (`source:"app"`) and `SYSTEM.md` (`source:"user"`) flow in through `AgentConfig.systemPrompt` (CLI puts them there in Task 4), the **single** `composeSystemPrompt` pass applies the reordered rank (Task 2) and yields the documented arrow order with zero new composition code. → **No new runtime code** beyond the existing `mergeSystemPromptConfig` call.
    - **Redaction:** Covered. The assembled `ProviderRequest` (including `systemInstructions` carrying the file text) is passed through `redactProviderRequest(middlewareRequest, this.activeRedactor)` at `src/agents.ts:159` before the provider call; `redactSecrets` (`src/redaction.ts`) replaces known secret strings with `[REDACTED]` and is cycle-safe/JSON-shape-preserving. → **No new redaction code.** Failure mode documented: `redactSecrets` only redacts *caller-registered* secrets (`createSecretRedactor(secrets)`); prompt text that does not contain a registered secret passes through untouched — so any `AGENTS.md`/`SYSTEM.md` content must be treated as trusted-ish prompt text (project/user owning the file is the trust boundary), and a Task 5 redaction assertion must register the fake secret token in the redactor for the assertion to be meaningful.
    - **Events / store impact:** Covered, no change. The runtime emits no separate event for system-prompt layers and does not store composed prompt content beyond what `AgentConfig.instructions`/`systemPrompt` already serialize (callers opt into storing `AgentConfig` in session metadata; file text is not re-stored). → **No new event, no new store field.**
    - **Package subpath precedent:** Covered. `package.json` `exports` already lists per-concern Node subpaths (`./node/trust`, `./node/contribution-discovery`, `./node/instruction-injectors`, ...). → **No new pattern:** add `./node/system-prompts` (`{types, default}` over `dist/node/system-project-prompts.*`) following the identical shape. The `package.json` edit + barrel are listed in Task 3.
    - **No-privilege enforcement:** Covered by architecture. The loader returns only `SystemPromptContribution` records (data: `{id, source, mode, text, metadata}`); it cannot grant tools, skills, permissions, or provider slots. `replace`/`disable` modes are policy opts inside `composeSystemPrompt`, not privilege controls. → **No new enforcement code.** Task 6's boundary test pins this.

- [x] Task 2 — Realign `SystemPromptSource` rank so `user` (`SYSTEM.md`) is the base layer
  - Acceptance Criteria:
    - Functional: `src/system-prompts.ts` `sourceRank` becomes `{user:0, package:1, app:2, run:3}` so that, with default `append` mode, contributing `SYSTEM.md` (`source:"user"`), a package contribution, `AGENTS.md` (`source:"app"`), a host config contribution, and a run contribution composes text in that stacked order. `replace`/`prepend`/`disable` modes keep their existing semantics, just evaluated against the new rank order. `mergeSystemPromptConfig(config, false)` still clears configured layers and keeps `AgentConfig.instructions` (base).
    - Performance: One `Map` literal change; no algorithmic cost added.
    - Code Quality: No new `SystemPromptSource` value, no new function; the existing `composeSystemPrompt` loop and stable secondary sort by input index are unchanged. The realignment is documented in `docs/system-prompts.md` (Task 7) as a behavior change: the `user` source is now the global base, not a high-priority caller override.
    - Security: Rank change does not alter redaction or storage; prompt text is still caller/host-supplied content processed through `redactProviderRequest`.
  - Approach:
    - Documentation Reviewed:
      - `src/system-prompts.ts` `sourceRank`/`rank`/`composeSystemPrompt` — the only rank definition site.
      - `src/__tests__/system-prompts.test.ts` `compose_system_prompt_appends_prepends_and_replaces_in_order` — encodes the old `package<app<user<run` order and is updated here to assert the new order.
      - `examples/system-prompts.ts` comment "package, app, user, then run order" — updated to "user, package, app, then run order."
    - Options Considered:
      - Leave `sourceRank` and instead emit `SYSTEM.md` with `mode:"prepend"` on top of the existing pipeline: rejected — `prepend` only reorders within a contribution and cannot express "run before package regardless of input order"; it would also race with caller `prepend`/`replace` layers. Reordering the rank is the single source of truth.
      - Introduce a separate `source:"global"` value to keep `source:"user"` high-priority for legacy callers: rejected (see Task 1); Phase 31 redefines `source:"user"` as the global base, which is the documented intent going forward and aligns the roadmap arrow order with one `Map` literal.
    - Chosen Approach:
      - Edit `sourceRank` to user=0/package=1/app=2/run=3; update the one order-encoding test and the example comment.
    - API Notes and Examples:
      ```ts
      // src/system-prompts.ts
      const sourceRank = new Map<string, number>([
        ["user", 0],     // SYSTEM.md global base (Phase 31)
        ["package", 1],
        ["app", 2],      // AGENTS.md project (Phase 31)
        ["run", 3],
      ]);
      ```
    - Files to Create/Edit:
      - `src/system-prompts.ts`: replace the `sourceRank` `Map` literal.
      - `src/__tests__/system-prompts.test.ts`: update `compose_system_prompt_appends_prepends_and_replaces_in_order` expectations to the new order; keep `disable` and `RunOptions.systemPrompt:false` cases valid.
      - `examples/system-prompts.ts`: update comment.
    - References:
      - `src/system-prompts.ts`, `src/__tests__/system-prompts.test.ts`, `examples/system-prompts.ts`.
  - **Outcome / deviation:** rank reordered to `{user:0, package:1, app:2, run:3}` in `src/system-prompts.ts` with a behavioral-change `ponytail:` comment. First test expectation updated to `"App\n\nRun"` (traced: user prepends onto Base → package appends → app replaces all → run appends). Disable test **restructured, not just re-expectationed**: under the new rank a `source:"user"` disable sits at rank 0 and clears only base, not `app` — preserving the test's intent ("disable clears earlier layers") required moving the disable to `source:"run"` (rank 3) and re-adding post-disable via an unknown source (`source:"post"`, rank 10). `RunOptions.systemPrompt:false` case unchanged/valid. All 3 `system-prompts.test.ts` tests pass; `examples/` typecheck clean.

- [x] Task 3 — Add Node system/project prompt file loader (`loadSystemPromptFiles`)
  - Acceptance Criteria:
    - Functional: New Node module exports `loadSystemPromptFiles(options: SystemPromptFilesOptions): Promise<readonly SystemPromptContribution[]>`. When `globalRoot` is set and `<globalRoot>/.prism/agent/SYSTEM.md` exists, it returns `{id:"system-md", source:"user", mode:"append", text}`. When `workspaceRoot` is set and `<workspaceRoot>/AGENTS.md` exists **and** passes `trust` (when provided), it returns `{id:"agents-md", source:"app", mode:"append", text}`. Missing files are skipped silently (ENOENT-tolerant). Untrusted workspace `AGENTS.md` returns no contribution (fail closed, no throw). Each read is asserted through `permission` when provided. The function performs no `import()`/`require()`.
    - Performance: At most two `readFile` calls; no directory scan.
    - Code Quality: Reuses `src/node/contribution-discovery.ts`'s `isMissingFile` and `readOptionalFile` patterns (duplicated locally or lifted to a shared helper — minified duplication is acceptable per ponytail, prefer lifting only if a third consumer appears). No new contract type beyond the small `SystemPromptFilesOptions` interface. No `node:*` import surface leaked into core runtime.
    - Security: Trust gating mirrors Phase 10/16 (`createPathTrustPolicy` + `isPathInsideReal`); the global `SYSTEM.md` is user-owned and read without a workspace trust check (its presence is the user's choice). `permission` is asserted per file read via `assertPermission`.
  - Approach:
    - Documentation Reviewed:
      - `src/node/contribution-discovery.ts` `readOptionalFile`/`isMissingFile`/`assertPermission`/`isPathInsideReal` usage — the read+trust pattern to mirror.
      - `src/contracts.ts` `SystemPromptContribution` — the returned shape; `id`/`source`/`mode`/`text` fields are sufficient.
      - `src/node/trust.ts` `isPathInsideReal` — symlink-resolved, fail-closed containment for the workspace `AGENTS.md`.
    - Options Considered:
      - Extend `discoverContributions` with a pseudo-kind `"prompt-file"` that scans root files: rejected — root-level singleton files do not match the named-subdir scan shape and would special-case `readEntry`/`kindDirName`; a sibling loader is smaller and the discovery module already documents itself as subdir-scanning.
      - Read both files unconditionally: rejected — workspace `AGENTS.md` must be trust-gated (Phase 10/16) and the global root must be explicitly supplied so SDK/embedded hosts that never pass `globalRoot`/`workspaceRoot` see no filesystem access.
    - Chosen Approach:
      - New file `src/node/system-project-prompts.ts` exporting `loadSystemPromptFiles` + `SystemPromptFilesOptions`. Re-export `loadSystemPromptFiles` from the existing `@arnilo/prism/node/contribution-discovery` barrel? No — expose on a dedicated subpath `@arnilo/prism/node/system-prompts` to keep concerns separated and match the per-module Node subpath precedent (`@arnilo/prism/node/trust`, `@arnilo/prism/node/instruction-injectors`). Mark the subpath decision as a `ponytail:` comment.
    - API Notes and Examples:
      ```ts
      import { loadSystemPromptFiles } from "@arnilo/prism/node/system-prompts";
      import { createPathTrustPolicy } from "@arnilo/prism/node/trust";

      const trust = createPathTrustPolicy({ trustedRoots: [workspaceRoot] });
      const layers = await loadSystemPromptFiles({
        workspaceRoot,          // → <workspaceRoot>/AGENTS.md, trust-gated
        globalRoot: homedir(),  // → ~/.prism/agent/SYSTEM.md, user-owned
        trust,
      });
      // layers: [{id:"system-md", source:"user", mode:"append", text:"..."}, {id:"agents-md", source:"app", mode:"append", text:"..."}]
      ```
    - Files to Create/Edit:
      - `src/node/system-project-prompts.ts` (new): `loadSystemPromptFiles`, `SystemPromptFilesOptions`, private `readGlobal`/`readAgents` helpers.
      - `src/index.ts`/package subpath map: add `@arnilo/prism/node/system-prompts` export pointing at the new module (mirror existing Node subpaths in `package.json` `exports`).
    - References:
      - `src/node/contribution-discovery.ts`, `src/node/trust.ts`, `src/security.ts`, `src/contracts.ts`.
      - `package.json` `exports` map for existing Node subpaths.
  - **Outcome / deviation:** new module `src/node/system-project-prompts.ts` exports `loadSystemPromptFiles` + `SystemPromptFilesOptions` and two private helpers `readSystemFile`/`readAgentsFile` (plan named them `readGlobal`/`readAgents`; renamed to match the on-disk files `SYSTEM.md`/`AGENTS.md` for greppability — single-concept naming over generic global/agents). Reuse decision from Task 1's primitive review executed: exported only `readOptionalFile` from `contribution-discovery.ts` (one `export` keyword + `ponytail:` comment), keeping `isMissingFile` private — minimal public-API expansion, the loader's read path is byte-identical to the scanner's. Package.json `exports` got the new `./node/system-prompts` subpath (full name `system-project-prompts` to avoid clashes with the existing `system-prompts.ts` core runtime module; subpath name is the user-facing short id). **Not** re-exported through `src/index.ts` (main barrel): the loader does real fs I/O → Node-only, applied to `src/node/instruction-injectors.ts` precedent (subpath-only, no main-barrel pollution). CLI (Task 4) imports via relative `./node/system-project-prompts.js` inside `src/`; external consumers via the subpath. Ponytail self-check tests added now in `src/__tests__/system-project-prompts.test.ts` (AGENTS.md read path + no-roots escape hatch); Task 5 expands to trust-skip/SYSTEM.md/disable/redaction. Verified: loader + system-prompts + Phase 29/30 boundary tests all green; `@arnilo/prism/node/system-prompts` smoke-import exposes `loadSystemPromptFiles`; examples typecheck clean.

- [x] Task 4 — CLI auto-load of `AGENTS.md`/`SYSTEM.md` with override/disable flags
  - Acceptance Criteria:
    - Functional: `runCli` (print/json modes) auto-loads `<workspaceRoot>/AGENTS.md` (trust-gated, where `workspaceRoot` defaults to `process.cwd()`) and `~/.prism/agent/SYSTEM.md` (where the global root defaults to `homedir()`) when present and not disabled, composes them with any caller contributions into `AgentConfig.systemPrompt`, and passes them to `createAgent`. `--no-agents-md` skips `AGENTS.md`; `--no-system-md` skips `SYSTEM.md`; `--agents-md-file <path>` / `--system-md-file <path>` read the prompt text from the given path instead (still tagged `source:"app"`/`source:"user"` respectively, still trust-gated for `--agents-md-file`). RPC mode does **not** auto-read these files unless the session factory is supplied by the host (host-owned). The existing `--system <text>` stays as `AgentConfig.instructions` (base), coexisting with `SYSTEM.md` (a `source:"user"` layer) and `AGENTS.md` (`source:"app"`). `RunOptions.systemPrompt` from `--run-system`-style flags is out of scope (YAGNI — `--system` base + file layers cover the CLI surface).
    - Performance: Two `readFile` calls per CLI print/json run; missing files are ENOENT-skipped, no scan.
    - Code Quality: New flags added to `valueFlags`/`boolFlags` and the `CliOptions` interface; the load is a single call to `loadSystemPromptFiles` followed by merge into `AgentConfig.systemPrompt`. No CLI arg parser fork; mirrors existing `--instruction`/`--injector-file` plumbing precedent.
    - Security: `AGENTS.md` (and `--agents-md-file`) pass through `createPathTrustPolicy({trustedRoots:[workspaceRoot]})` (or the resolved file's parent for `--agents-md-file`); untrusted workspaces contribute nothing. `SYSTEM.md` from `homedir()` is user-owned. Loaded text is subject to `redactProviderRequest` like any system instruction; no secret is echoed into events/store.
  - Approach:
    - Documentation Reviewed:
      - `src/cli-runner.ts` `CliOptions`/`parseCliArgs`/`runCli`/`defaultCreateSession`/`runOptions` — wiring site; `--injector-file` resolution precedent (`resolveCliInjectors`).
      - `src/node/instruction-injectors.ts` `registerDiscoveredInstructionInjectors` — sibling Node-loader integration pattern.
      - Phase 10/16 trust (`createPathTrustPolicy`) and Phase 29 global-root opt-in behavior.
    - Options Considered:
      - Auto-load only under `--discover`: rejected — roadmap states walk-up discoverability for these two files; gating behind `--discover` would make the standard layout invisible to default CLI runs, defeating the phase goal. The dedicated trust gate covers the workspace-safety concern.
      - Reuse `--system <text>` to also accept a path: rejected — `--system` already means inline instruction text (base); overloading to a path breaks existing usage. Dedicated `--agents-md-file`/`--system-md-file` flags are explicit and ponytail-compliant.
      - Load `SYSTEM.md` only when `--discover-global` is set: rejected — `SYSTEM.md` is the user's own home file, distinct from the workspace-trust concerns of `--discover-global`; the roadmap auto-loads it. `--no-system-md` is the escape hatch.
    - Chosen Approach:
      - Add `--no-agents-md`/`--no-system-md` (bool) and `--agents-md-file`/`--system-md-file` (value) to the CLI; resolve in `runCli` before `defaultCreateSession`; build `AgentConfig.systemPrompt` from loaded contributions + any existing caller contributions; keep `instructions: options.system`.
    - API Notes and Examples:
      ```ts
      // cli-runner.ts (excerpt)
      const trust = createPathTrustPolicy({ trustedRoots: [runtime.workspaceRoot ?? process.cwd()] });
      const fileLayers = await loadSystemPromptFiles({
        ...(options.noAgentsMd ? {} : { workspaceRoot: agentsFileWorkspace(options), trust }),
        ...(options.noSystemMd ? {} : { globalRoot: options.systemMdFile ? undefined : runtime.globalRoot ?? homedir() }),
        ...
      });
      const systemPrompt = fileLayers.length ? fileLayers : undefined;
      // defaultCreateSession passes systemPrompt into createAgent alongside instructions: options.system.
      ```
    - Files to Create/Edit:
      - `src/cli-runner.ts`: add flags to `valueFlags`/`boolFlags`/`usage`, new `CliOptions` fields (`noAgentsMd`, `noSystemMd`, `agentsMdFile`, `systemMdFile`), load+merge in `runCli`, pass `systemPrompt` from `defaultCreateSession`/`runOptions`.
    - References:
      - `src/cli-runner.ts`, Task 3 loader, `src/node/trust.ts`.
  - **Outcome / deviation:** four flags added (`--no-agents-md`/`--no-system-md` bool, `--agents-md-file`/`--system-md-file` value) to `boolFlags`/`valueFlags`/`usage`/`CliOptions`/`parseCliArgs` switch. Load happens in `runCli` after injector resolution, only when `mode !== "rpc"` (RPC = host-owned, no auto-read). `CliOptions.systemPromptLayers` (runtime-populated, like `resolvedInstructionInjectors`) carries the layers; `defaultCreateSession` passes them as `AgentConfig.systemPrompt` when non-empty, coexisting with `instructions: options.system` (base). Trust policy built per-invocation via `createPathTrustPolicy({trustedRoots})`: `[workspaceRoot]` by default, plus `dirname(agentsMdFile)` when `--agents-md-file` is given so the explicit opt-in passes containment (user named it → trusted by that act). **Loader extended (not just `cli-runner.ts`):** Task 3's `loadSystemPromptFiles` gained `agentsMdPath`/`systemMdPath` override fields so the override paths reuse the existing trust gate and `readOptionalFile` instead of duplicating either in the CLI — one source of truth, no parallel read path. Plan listed only `src/cli-runner.ts` under Files to Create/Edit; this loader extension is the justified piggyback (the plan's own API-notes referenced `agentsFileWorkspace(options)` + still-trust-gated override). `RunOptions.systemPrompt` / `--run-system` deliberately not added (YAGNI per plan — `--system` base + file layers cover the CLI surface). `--system <text>` keeps meaning inline base text; not overloaded. Smoke-verified: AGENTS.md-present → loads; `--no-agents-md` → skips; absent files → ENOENT-skipped, no error. Functional layering assertions (does the composed prompt actually reach the provider in order) deferred to Task 5 (`cli-system-project-prompts.test.ts`) — the mock provider ignores system instructions so CLI smoke can't surface composition. All 36 passing tests (loader + system-prompts + 3 cli suites + phase29/30 boundaries) green; examples typecheck clean.

- [x] Task 5 — Tests for file loading, layering, trust, and SDK escape hatch
  - Acceptance Criteria:
    - Functional: New tests assert: (1) both files present → composed prompt text stacks `SYSTEM.md` then `AGENTS.md` (then base `AgentConfig.instructions`); (2) `--no-agents-md` removes only the `AGENTS.md` layer; (3) `--no-system-md` removes only the `SYSTEM.md` layer; (4) untrusted workspace `AGENTS.md` produces no contribution and the run still works with base instructions; (5) `--agents-md-file <path>`/`--system-md-file <path>` load from the given path; (6) `loadSystemPromptFiles` with no roots returns `[]` and performs no filesystem read (SDK escape hatch); (7) a `source:"run"` `RunOptions.systemPrompt` contribution still appends on top; (8) `RunOptions.systemPrompt:false` disables all file+config layers and keeps base instructions.
    - Performance: Tests use the in-memory mock provider and temp dirs (`node:fs/promises.mkdtemp`) only; no network.
    - Code Quality: Tests live alongside `src/__tests__/cli-discovery.test.ts` and `src/__tests__/system-prompts.test.ts` (extended in Task 2); a new `src/__tests__/system-project-prompts.test.ts` for the loader and `src/__tests__/cli-system-project-prompts.test.ts` for the CLI surface.
    - Security: A test fixtures a workspace `AGENTS.md` containing a fake secret token and asserts the assembled provider request is redacted (`redactProviderRequest`) — no raw secret in the request. Fixtures use obviously-fake non-real secrets.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/cli-discovery.test.ts`, `src/__tests__/cli-instruction-injectors.test.ts`, `src/__tests__/node-contribution-discovery.test.ts` — temp-dir + `CliRuntime` + `defaultCreateSession` test patterns.
      - `src/__tests__/system-prompts.test.ts` — `composeSystemPrompt` assertions (extended in Task 2).
      - `src/redaction.ts` `redactProviderRequest` + `createSecretRedactor` — used for the secret-in-AGENTS.md redaction assertion.
    - Options Considered:
      - Inline CLI tests in `cli-discovery.test.ts`: rejected — keeps concerns separable and discovery tests focused; a dedicated CLI file for the two prompt files is clearer and matches the per-feature test precedent.
    - Chosen Approach:
      - New test files as above; loader tests call `loadSystemPromptFiles` directly against temp dirs; CLI tests go through `runCli` with an injected `createSession` capturing the resolved `AgentConfig.systemPrompt`.
    - API Notes and Examples:
      ```ts
      // src/__tests__/system-project-prompts.test.ts (shape)
      const dir = await mkdtemp(join(tmpdir(), "prism-sp-"));
      await writeFile(join(dir, "AGENTS.md"), "Project rule.");
      const layers = await loadSystemPromptFiles({ workspaceRoot: dir, trust: createPathTrustPolicy({ trustedRoots: [dir] }) });
      assert.deepEqual(layers, [{ id: "agents-md", source: "app", mode: "append", text: "Project rule." }]);
      ```
    - Files to Create/Edit:
      - `src/__tests__/system-project-prompts.test.ts` (new): loader unit tests.
      - `src/__tests__/cli-system-project-prompts.test.ts` (new): CLI auto-load + disable/override flags.
      - `src/__tests__/system-prompts.test.ts`: extended in Task 2 for the reordered rank.
    - References:
      - Existing CLI/discovery tests, `src/redaction.ts`, `src/mock-provider.ts`.
  - **Outcome / deviation:** `src/__tests__/system-project-prompts.test.ts` expanded to 8 loader tests covering all 8 acceptance points apart from (2)/(3)/(7)/(8) which are pipeline/CLI-level: (1) both files → `composeSystemPrompt(layers, {base})` yields `"BASE\n\nGLOBAL\n\nPROJECT"` (Phase 31 rank user<package<app<run), (4) `createStaticTrustPolicy(false)` fail-closes AGENTS.md while SYSTEM.md still loads, (5) `agentsMdPath`/`systemMdPath` overrides load with same source tags + override still trust-gated when outside trusted roots, (6) no roots → `[]` no fs I/O, plus missing-files ENOENT-skip and trusted-passes cases. New `src/__tests__/cli-system-project-prompts.test.ts` (8 tests) goes through `runCli` with an injected `capturingSession` that mirrors `defaultCreateSession`'s `systemPrompt: options.systemPromptLayers` wiring and captures `ProviderRequest`: (1-cli) composed text reaches provider as `System instruction:\nBASE\n\nGLOBAL\n\nPROJECT`; (2) `--no-agents-md` keeps GLOBAL drops PROJECT; (3) `--no-system-md` keeps PROJECT drops GLOBAL; (5-cli) `--agents-md-file`/`--system-md-file` custom paths reach provider; security — fake secret `FAKE_SECRET_AKIAPHASE31TOKEN` in AGENTS.md with `AgentConfig.redactor = createSecretRedactor([SECRET])` → captured request contains `[REDACTED]` not the raw token, non-secret text survives. (7)/(8) are **direct `createAgent` + `session.run(prompt, runOptions)` tests, not runCli** — `RunOptions.systemPrompt` is deliberately not exposed as a CLI flag (YAGNI per plan), so the composition pipeline is asserted directly: (7) `source:"run"` appends on top → `...PROJECT\n\nRUN`; (8) `RunOptions.systemPrompt:false` keeps only `BASE`, drops both file layers. Pipeline traced: `composeSystemPrompt(mergeSystemPromptConfig(config, run), {base})` at `agents.ts:112` → `systemInstructions` → `instructionMessages` wraps as `role:"system"` text `"System instruction:\n<composed>"` (`input.ts:97`); redaction at `agents.ts:159` applies `config.redactor` before `provider.generate` so the mock `onRequest` sees the redacted request. **Deviations from plan spec:** (a) plan's API-notes `capturingSession` signature implied two-arg `createSession({}, runOpts)` — `createSession` takes a single `sessionConfig`, so `RunOptions.systemPrompt` injection via runCli is impossible without a session decorator (over-engineering); (7)/(8) moved to direct agent tests, documented inline with `ponytail:` comments. (b) An added RPC-no-auto-load test was removed: RPC server blocks on stdin EOF making exit-code asserts flaky, and the behavior is already enforced by the `if (options.mode !== "rpc")` guard in `runCli`; not in the 8 acceptance points. All 8 acceptance criteria covered. Verified: 16 new tests pass; full suite 618/618 green (Phase 29/30/31 boundaries included); examples typecheck clean.

- [x] Task 6 — Boundary test `phase31-boundaries.test.ts`
  - Acceptance Criteria:
    - Functional: New boundary test asserts: (1) `src/` imports no `synapta*` package and does not mention `synapta`; (2) the string literals `AGENTS.md` / `SYSTEM.md` appear only in `src/node/system-project-prompts.ts`, `src/cli-runner.ts`, and tests/docs (not in core runtime modules like `agents.ts`/`input.ts`/`system-prompts.ts`); (3) no new public contract type carries domain vocabulary (`workflow`/`node`/`step`); (4) no `node:*` import is reachable from `src/system-prompts.ts` or `src/contracts.ts` (filesystem stays in `src/node/`).
    - Performance: Static text scans only; no runtime cost.
    - Code Quality: Mirrors `phase30-boundaries.test.ts` `files(dir, predicate)` scan + anchored-contract-block pattern; one assertion per boundary.
    - Security: Boundary asserts the loader never executes discovered modules (no `import(` of arbitrary paths in `src/node/system-project-prompts.ts`) and trust gating is reachable.
  - Approach:
    - Documentation Reviewed:
      - `src/__tests__/phase30-boundaries.test.ts`, `src/__tests__/phase29-boundaries.test.ts` — boundary scan style and `srcFiles` exclusion of `src/__tests__`.
    - Options Considered:
      - Combine into `phase30-boundaries.test.ts`: rejected — phases stay independently greppable; the boundary crate per phase is the established pattern.
    - Chosen Approach:
      - New `src/__tests__/phase31-boundaries.test.ts` reusing the `files`/`srcText` helpers, asserting the four boundaries above.
    - Files to Create/Edit:
      - `src/__tests__/phase31-boundaries.test.ts` (new).
    - References:
      - `src/__tests__/phase30-boundaries.test.ts`, `src/__tests__/phase29-boundaries.test.ts`.
  - **Outcome / deviation:** new `src/__tests__/phase31-boundaries.test.ts` (6 tests) mirroring phase30's `files`/`srcText` scan + anchored-contract-block pattern, asserting all 4 functional boundaries + the security boundary: (1) `src/` (excl `__tests__`) imports no `synapta*` package and has no `\bsynapta\b` mention; (2) `AGENTS.md`/`SYSTEM.md` literals appear only in `src/node/system-project-prompts.ts` + `src/cli-runner.ts` (allowed-set check via `srcFiles.filter`), plus an explicit belt-and-braces scan of core runtime modules `agents.ts`/`input.ts`/`system-prompts.ts`/`contracts.ts` for neither literal; (3) anchored extraction of the SystemPrompt contract block (`SystemPromptMode`→`SystemPromptConfig`, end-anchored at the next `export` after `SystemPromptConfig`) asserts none of `workflow`/`node`/`step` appear; (4) `system-prompts.ts` and `contracts.ts` import no `node:*` builtins (filesystem stays in `src/node/`); (5-security) loader source (comments stripped first so the doc text "no `import()`" doesn't trip the scan) has no `import(`/`eval(` — never executes discovered modules; trust gating reachable via runtime assertions: `createStaticTrustPolicy(false)` skips untrusted AGENTS.md while SYSTEM.md still loads, and `createPathTrustPolicy({trustedRoots})` loads AGENTS.md from a trusted workspace; (6-belt-and-braces) a secret embedded in AGENTS.md text is redacted by `redactProviderRequest(request, createSecretRedactor([secret]))` on a synthesized request carrying the loader-produced system instruction text — the file layer is treated identically to any other system instruction, no special-casing. **Pre-test fix:** Task 2's `ponytail:` comment in `src/system-prompts.ts` mentioned the literal filenames `SYSTEM.md`/`AGENTS.md` — that violated boundary (2) ("not in core runtime modules like system-prompts.ts"). Reworded the comment to use source-tag language (`source: "user"` / `source: "app"`) instead of filenames; the documented layering arrow became `user → package → app → host config → run`. Verified after fix: all 6 boundary tests pass; full suite 624/624 green (was 618 + 6 new); examples typecheck clean.

- [x] Task 7 — Docs: update `system-prompts.md`, discovery + CLI cross-refs, index, add compile-checked example
  - Acceptance Criteria:
    - Functional: `docs/system-prompts.md` gains a `AGENTS.md` / `SYSTEM.md` section following the Prism wiki API-page structure (What it does / When to use / Inputs / Outputs / example / Extension+config notes / Security+performance / Related APIs): documents the two file paths, layering order (`SYSTEM.md` user base → package → `AGENTS.md` app → host `AgentConfig.systemPrompt` → `RunOptions.systemPrompt`), trust model, CLI flags (`--no-agents-md`/`--no-system-md`/`--agents-md-file`/`--system-md-file`), and the SDK escape hatch. The page also calls out the `sourceRank` realignment (Task 2) as a behavior change. `docs/contribution-discovery.md` adds a cross-reference to the new prompt-file loader; `docs/cli-rpc.md` documents the new flags; `docs/index.md` updates the System prompts entry description; `examples/system-project-prompts.ts` is a compile-checked demo.
    - Performance: Docs/example changes have no runtime effect; example must compile under `examples/tsconfig.json` without network or credentials.
    - Code Quality: Docs follow the wiki page structure; the example uses the mock provider and `loadSystemPromptFiles` against a temp layout or inline contributions, no real secrets.
    - Security: Docs state prompt text is caller/host-supplied content subject to `redactProviderRequest`; fixtures use obviously-fake text; no secret persistence claims.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` — required API-page headings.
      - `docs/system-prompts.md`, `docs/contribution-discovery.md`, `docs/cli-rpc.md`, `docs/index.md`, `examples/system-prompts.ts`.
    - Options Considered:
      - Create a new `docs/system-project-prompts.md` page: rejected — the layout is a feature of system prompts, not a separate API surface; extending `docs/system-prompts.md` keeps the layering story in one place and avoids index sprawl (ponytail: fewest files).
    - Chosen Approach:
      - Extend `docs/system-prompts.md` with the `AGENTS.md`/`SYSTEM.md` section per wiki structure; small `Related APIs`/cross-reference edits to discovery + CLI + index; new compile-checked `examples/system-project-prompts.ts`.
    - API Notes and Examples:
      ```ts
      // examples/system-project-prompts.ts (compile-checked)
      import { composeSystemPrompt, createAgent, createMockProvider, providerDone } from "@arnilo/prism";

      // Standalone SDK: no filesystem; layered contributions are passed explicitly.
      const layers = [
        { id: "system-md", source: "user" as const, mode: "append" as const, text: "Global system policy." },
        { id: "agents-md", source: "app" as const, mode: "append" as const, text: "Project rule." },
      ];
      const prompt = composeSystemPrompt(layers, { base: "You are helpful." });
      const agent = createAgent({
        model: { provider: "mock", model: "demo" },
        provider: createMockProvider([providerDone()]),
        instructions: "You are helpful.",
        systemPrompt: layers,
      });
      export function demo() { return { prompt, agent }; }
      ```
    - Files to Create/Edit:
      - `docs/system-prompts.md`: add `AGENTS.md`/`SYSTEM.md` section per wiki structure; note `sourceRank` realignment.
      - `docs/contribution-discovery.md`: cross-reference to `loadSystemPromptFiles` / `docs/system-prompts.md`.
      - `docs/cli-rpc.md`: document the four new flags.
      - `docs/index.md`: update System prompts entry to mention `AGENTS.md`/`SYSTEM.md` walk-up loading.
      - `examples/system-project-prompts.ts` (new): compile-checked demo.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`, existing docs pages and examples.
  - Outcome / Deviation:
    - **Docs produced:** `docs/system-prompts.md` gained the full `## AGENTS.md and SYSTEM.md files` section per wiki API-page structure (What it does / When to use / Inputs / Outputs+events / Request-response example / Implementation example / Extension+config notes / Security+performance / Related APIs); the stale inline ordering phrase was corrected from `package, app, user, then run` to `user, package, app, then run` and a Phase 31 **Behavior change** callout was added documenting the `sourceRank` realignment (Task 2) + the surviving `RunOptions.systemPrompt: false` kill switch. `docs/contribution-discovery.md` cross-references `loadSystemPromptFiles` as a *sibling* Node loader (explicitly not a scanner kind) plus a Related APIs link. `docs/cli-rpc.md` documents the four new flags in the flag table and rewords the trailing auto-load note to state AGENTS.md/SYSTEM.md are auto-loaded in print/json (trust-gated / user-owned), RPC is host-owned and skips auto-read. `docs/index.md` System prompts entry now mentions walk-up loading of both files. `examples/README.md` lists the new example as a demo.
    - **Example produced:** `examples/system-project-prompts.ts` is a *runnable* demo (not merely compile-checked as the plan stub suggested) — builds a temp workspace + temp global root, writes `SYSTEM.md` + `AGENTS.md`, loads them with `loadSystemPromptFiles` (workspace trust-gated), then runs a mock agent and asserts the composed prompt (`You are helpful.\n\nGlobal system policy.\n\nProject rule.`) reached the provider request. Runnable form was chosen over the plan's compile-only inline stub because `discover-skills.ts`/`instruction-injection.ts` set a runnable-demo precedent and `docs.test.ts` has a run-to-completion + no-secret gate that the file is now wired into — runnable gives a free end-to-end self-check. Uses `os.tmpdir()` so no fixtures are committed.
    - **Tests:** `src/__tests__/docs.test.ts` (a) fixed its stale ordering assertion to the new `user, package, app, then run` phrase, (b) added `examples/system-project-prompts.ts` to both the file-existence list and the run-to-completion/no-secret demos list, (c) added a new `system_prompt_docs_cover_agents_md_and_system_md_files_phase_31` test mirroring the Phase 30 instruction-injection pattern — asserts the `./node/system-prompts` subpath ships in `package.json`, the layering-arrow phrase is present, the four CLI flags appear in `docs/cli-rpc.md`, `docs/contribution-discovery.md` describes the loader as a sibling, and `docs/index.md` mentions both filenames.
    - **Verification (Task 7 scope):** `npm run build:core` clean; `tsc -p examples --noEmit` 0 errors; `node examples/system-project-prompts.ts` prints `{"composed":"You are helpful.\n\nGlobal system policy.\n\nProject rule.","reachedProvider":true}`; the 5 targeted docs tests pass; **full suite 625/625 green** (was 624 + 1 new docs test). No secret fixtures (text is obviously fake). The boundary test from Task 6 still passes — `AGENTS.md`/`SYSTEM.md` literals are confined to the loader + CLI + docs/tests, not core runtime.

- [x] Task 8 — Final verification: typecheck, tests, example compile, docs checks
  - Acceptance Criteria:
    - Functional: `npm run typecheck` (or `tsc --noEmit`) passes; `npm test` passes (network-free, under the `<30s` budget); `examples/` compile via `examples/tsconfig.json`; docs consistency check (if present) passes; `npm run boundary`/full test suite includes the new `phase31-boundaries.test.ts`.
    - Performance: Test wall time within the documented `<30s` release budget on Node 20.
    - Code Quality: No new lint/tsc warnings introduced; `examples/system-project-prompts.ts` compiles cleanly; no `AGENTS.md`/`SYSTEM.md` literals leak into core runtime (verified by Task 6 boundary).
    - Security: No secret fixtures in committed example/docs; redaction test (Task 5) passes.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` test budget; `package.json` scripts (`typecheck`, `test`, examples compile).
    - Options Considered:
      - None — verification task follows the per-phase convention.
    - Chosen Approach:
      - Run `npm run typecheck`, `npm test`, examples compile, and docs check; resolve any regressions before marking the plan complete.
    - Files to Create/Edit:
      - None (verification only); checkboxes in this plan flipped to `[x]` as each task passes.
    - References:
      - `package.json`, `docs/release-and-install.md`, `examples/tsconfig.json`.

## Compromises Made
- `sourceRank` realignment (Task 2) is a **behavior change** for any caller currently relying on `source:"user"` as a high-priority caller override. Under the new rank, `user` is the global base (rank 0), so a `mode:"disable"` contribution with `source:"user"` now clears only the base, not package/app layers. This is the documented Phase 31 layering arrow (`SYSTEM.md` user → package → `AGENTS.md` app → host → run) and is called out in `docs/system-prompts.md`; `RunOptions.systemPrompt:false` remains the unconditional kill switch. Migration surface is narrow (direct `composeSystemPrompt` callers using `source:"user"`+`mode:"disable"` as a kill switch).
- `RunOptions.systemPrompt` is **not** surfaced as a CLI flag (Task 4): `--system` (base instructions) + the two file layers + the four file-override/skip flags cover the CLI surface. `RunOptions.systemPrompt:false` is reachable only programmatically — adding a CLI flag would be pure YAGNI unless a host reports a concrete need.
- The Node loader `loadSystemPromptFiles` is **subpath-only** (`@arnilo/prism/node/system-prompts`), not re-exported from the main barrel `src/index.ts`, because it performs filesystem I/O — follows the `src/node/instruction-injectors.ts` precedent and keeps core runtime fs-free (asserted by the Task 6 boundary test).
- The example was promoted from the plan's *compile-checked stub* to a *runnable demo* to match the `discover-skills.ts`/`instruction-injection.ts` precedent and to gain a free end-to-end self-check via `docs.test.ts`'s run-to-completion gate. No committed fixtures (uses `os.tmpdir()`).

## Further Actions
- **Follow-up phases:** Phase 32 (Synapta-facing integration example + boundary lock) and Phase 33 (declarative agent definitions + resolver) are the remaining third-party-ergonomics track items per `roadmap.md`; the Phase 31 loader + CLI wiring are prerequisites for both.
- **Migration note for direct `composeSystemPrompt` callers:** audit any code using `source:"user"`+`mode:"disable"` as a kill switch — under the reordered rank it clears only the base, not package/app layers. Use `RunOptions.systemPrompt:false` for an unconditional disable. Low priority (narrow surface); could be added to `docs/system-prompts.md` as a migration callout if a consumer reports confusion.
- **Optional: `RunOptions.systemPrompt` CLI flag** — not added (YAGNI). Revisit only if a CLI consumer needs per-run layer overrides beyond `--system` base + the four file flags.
- **Optional: `loadSystemPromptFiles` search-up** — the loader reads exactly `<workspaceRoot>/AGENTS.md` (no parent walk-up). If nested-workspace ergonomics become a real complaint, a walk-up variant mirroring `discoverContributions`' root resolution could be added; deferred until requested.
- **Docs index sweep:** the System prompts entry in `docs/index.md` now mentions AGENTS.md/SYSTEM.md walk-up loading; no separate index entry was created for the Node subpath loader (it is documented within the system-prompts page, per fewest-files).
