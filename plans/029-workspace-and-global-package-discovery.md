# Phase 29 — Workspace and global package discovery (skills, tools, context, instruction injectors)

## Objectives
- Provide a standard, host/CLI-driven filesystem contribution loader (Node, optional) that scans `<workspace>/.agent/{skills,tools,context,instructions,agents}/<name>/` and `~/.prism/agent/{skills,tools,context,instructions,agents}/<name>/` and registers each discovered contribution into the matching contribution registry.
- Make skills the first-class, fully working kind (they are text-only: `SKILL.md` → `Skill`), with `name`, `description`, `instructions`, `context`, and `toolNames` honored exactly as in Phase 26.
- Treat tools/context/instructions/agents uniformly through the *same* discovery scanner, but register them as manifest-referenced contributions whose executable behavior is supplied by a host-loaded module (the manifest `module`/`exportName` field already on `ManifestContributionDeclaration`); Phase 33 supersedes the agent stub with `resolveAgentDefinition`.
- Keep merge order documented and tested: global first, workspace overrides same-name; explicit `AgentConfig`/`RunOptions` selections override discovered contributions (progressive disclosure preserved; discovery registers, it does not auto-activate).
- Keep discovery opt-in and loader-driven: SDK apps skip it entirely and pass explicit registries; the CLI uses it. No hidden global state in core, no automatic filesystem access, no automatic `import()` of untrusted code.
- Provider discovery stays config/package-driven (needs credentials, Phase 24 resolver handles wiring). Phase 29 never file-scans providers.
- First-party skills ship as installable packages (`@arnilo/prism-skill-*`), discovered like any third-party skill — not bundled in core; not added in this phase.

## Expected Outcome
- A workspace skill at `.agent/skills/my-skill/SKILL.md` is discovered by the CLI loader, loaded into the `skills` registry, selectable via `activeSkills: ["my-skill"]`, with `toolNames`/`context` honored (fail-fast at activation per Phase 26).
- A global skill at `~/.prism/agent/skills/global-skill/SKILL.md` is discovered; a same-named workspace skill overrides the global one (documented and tested).
- Discovered skills are inert until activated by an explicit `activeSkills` selection or `AgentConfig.skills` registry; discovery alone never activates, never grants tool access, never bypasses `toolNames` enforcement or permission hooks.
- No filesystem access happens without the explicit host/CLI loader; in-memory SDK use (mock provider, no `node/` imports from the agent path) is unaffected. `npm test` stays network-free and under the documented `<30s` budget.
- A `docs/contribution-discovery.md` page ships with workspace/global layout, merge order, trust model, and CLI flags; `docs/index.md` gets the entry; a compile-checked example lives under `examples/`.
- Boundary tests prove: `src/` (non-`node/`) imports no Node filesystem module from the agent runtime path; no `synapta*` import; no automatic discovery in core.

## Tasks

- [ ] Task 1 — Primitive review: inventory existing discovery/registration primitives before adding code
  - Acceptance Criteria:
    - Functional: A short `Primitive Review` section is added to this plan (Compromises/Further Actions below is not the place) documenting, for each Phase 29 kind (skill/tool/context/instructions/agent), which existing primitive already covers registration and which gaps require new code. Reuses identified primitive where it covers the need; only generic new primitives are proposed.
    - Performance: Review performs no filesystem I/O; it is a read + write of analysis text.
    - Code Quality: Every proposed new file/function is justified against an existing one; no duplicate registry, no parallel skill loader that re-implements `SkillRegistry.register`.
    - Security: Review explicitly states that provider discovery is out of scope (credentials) and that no auto-execute of untrusted modules is proposed.
  - Approach:
    - Documentation Reviewed:
      - `src/contributions.ts` — `ContributionRegistry<T>` (`register`/`get`/`resolve`/`list`) and `ContributionRegistries` (already has `skills`, `tools`, `contextProviders`, `agents`, `systemPromptContributions`). These are the registration targets.
      - `src/skills.ts` — `createSkillRegistry()` and `resolveActiveSkills()` (Phase 26 already enforces `toolNames`); discovery only feeds `Skill` objects in here.
      - `src/contracts.ts` `Skill` (`name`, `description?`, `instructions?`, `context?`, `toolNames?`, `metadata?`) — the exact shape a discovered `SKILL.md` must produce.
      - `src/manifests.ts` `ManifestContributionDeclaration` (`kind`, `name`, `module?`, `exportName?`, `resource?`, `metadata?`) — already the generic "file points at a contribution" primitive; reuse for tool/context/agent manifest-referenced kinds instead of inventing a new shape.
      - `src/node/config.ts` (`readConfigFile`, `loadConfigFiles`, `defaultUserConfigPath`, `isMissingFile`) — the existing pattern for optional + ENOENT-tolerant Node file reads; discovery reuses the same missing-file tolerance.
      - `src/node/trust.ts` — `createPathTrustPolicy`, `isPathInsideReal` (realpath-safe, fails closed). Reused for workspace trust; global dir is host-owned and trusted by the loader itself.
      - `src/resources.ts` `loadTextResource` + `assertPermission` — the existing pattern for permission-gated file reads.
      - Roadmap Phase 24 note: provider discovery is explicitly NOT added here.
    - Options Considered:
      - Reuse `ManifestContributionDeclaration` as the on-disk declaration shape (one `manifest.json` per contribution dir): generic, already typed, already covers `tool`/`contextProvider`/`agent`/`skill`/`systemPromptContribution`. Chosen for tool/context/agent/instructions kinds.
      - A per-kind bespoke loader per file format: more code, more drift. Rejected; one scanner + small per-kind adapters.
      - Auto `import()` of declared `module` paths inside the loader: rejected for core (host-controlled only). The loader produces `DiscoveredContribution` records; a host-owned step performs the dynamic import. Marked `ponytail:` — Phase 33 supersedes agent resolution; tool/context execution stays host-owned.
    - Chosen Approach:
      - One generic scanner reads each kind directory and produces `DiscoveredContribution[]`. A tiny per-kind adapter turns a directory into the right contribution. Skills are fully realized in core (text only). Tool/context/instructions/agent produce manifest-referenced registrations whose execution is host-owned; agent stubs defer to Phase 33's `resolveAgentDefinition`.
    - Files to Create/Edit:
      - `plans/029-workspace-and-global-package-discovery.md` (this file): append a `Primitive Review` subsection under this task once complete.
    - References:
      - `src/contributions.ts`, `src/skills.ts`, `src/manifests.ts`, `src/node/config.ts`, `src/node/trust.ts`, `src/resources.ts`.
      - Roadmap Phase 29; non-negotiable boundary "Host controlled. No hidden globals."

- [ ] Task 2 — Add `DiscoveredContribution` contract types (core, no Node import)
  - Acceptance Criteria:
    - Functional: `src/contracts.ts` exports `ContributionFileKind = "skill" | "tool" | "context" | "instructions" | "agent";` and `DiscoveredContribution { readonly kind: ContributionFileKind; readonly name: string; readonly origin: "global" | "workspace"; readonly path: string; readonly skill?: Skill; readonly declaration?: ManifestContributionDeclaration; readonly metadata?: Readonly<Record<string, unknown>>; }`. The type is the only public surface new to core this task and is runtime-side-effect-free.
    - Performance: Type-only — zero runtime cost.
    - Code Quality: The type lives next to `ManifestContributionDeclaration`/`Skill` and references them, not re-declares fields. No Synapta/domain vocabulary. Exported from `src/index.ts`.
    - Security: Declares no executable, no credential, no provider; the type is inert data.
  - Approach:
    - Documentation Reviewed:
      - `src/contracts.ts` `Skill`, `AgentDefinition`, `ContextProvider`, `ToolDefinition`, `SystemPromptContribution` — the registration targets, referenced not duplicated.
      - `src/manifests.ts` `ManifestContributionDeclaration` — reused as the manifest-referenced shape for non-skill kinds.
      - `.agents/skills/create-plan/references/prism-wiki.md` — API page structure for the docs page (Task 9).
      - Plan 024 — the precedent for "one contract type, public barrel export, no registry object on `AgentConfig`."
    - Options Considered:
      - One discriminated `DiscoveredContribution` with per-kind payloads (`skill?`, `declaration?`): chosen; lets the scanner emit one list and the registrar dispatch by `kind`.
      - Separate `DiscoveredSkill`/`DiscoveredTool`/... types: more surface, more drift. Rejected.
    - Chosen Approach:
      - Generic `DiscoveredContribution`; for skills it carries the realized `Skill` (text parsed up front because skills must be selectable by name with `instructions`); for other kinds it carries a `ManifestContributionDeclaration` whose `module` is resolved by the host later.
    - API Notes and Examples:
      ```ts
      // src/contracts.ts
      export type ContributionFileKind = "skill" | "tool" | "context" | "instructions" | "agent";

      export interface DiscoveredContribution {
        readonly kind: ContributionFileKind;
        readonly name: string;
        readonly origin: "global" | "workspace";
        readonly path: string;
        readonly skill?: Skill;                 // present when kind === "skill"
        readonly declaration?: ManifestContributionDeclaration; // present for other kinds
        readonly metadata?: Readonly<Record<string, unknown>>;
      }
      ```
    - Files to Create/Edit:
      - `src/contracts.ts`: add `ContributionFileKind` and `DiscoveredContribution`.
      - `src/index.ts`: `export type { ContributionFileKind, DiscoveredContribution } from "./contracts.js";`
    - References:
      - `src/contracts.ts` existing `Skill`, `ManifestContributionDeclaration`.
      - Plan 024 precedent for minimal contract-first export.

  - Test Cases to Write:
    - `src/__tests__/contribution-discovery.types.test.ts` (compile-only, comment-style placeholder reached in Task 5): type-imports `DiscoveredContribution` and `ContributionFileKind` from the barrel; assignment of a skill-kind and a tool-kind contribution both type-check.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public types `ContributionFileKind` and `DiscoveredContribution`.
    - Docs pages to create/edit:
      - `docs/contribution-discovery.md` (created in Task 9): document the `DiscoveredContribution` shape and `ContributionFileKind` enumeration as part of the discovery API.
    - `docs/index.md` update: yes, "Extensions/plugins" group entry → `docs/contribution-discovery.md` (added in Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 3 — Implement `discoverContributions()` Node scanner in `src/node/contribution-discovery.ts`
  - Acceptance Criteria:
    - Functional: `discoverContributions(options: DiscoveryOptions): Promise<readonly DiscoveredContribution[]>` scans, for each requested `kind`, both `workspaceRoot/.agent/<kind>s/<name>/` dirs (origin `"workspace"`) and `globalRoot/.prism/agent/<kind>s/<name>/` dirs (origin `"global"`, default `os.homedir()`), reading each `<name>/` subdirectory. Missing directories are skipped silently (reuse `isMissingFile`/ENOENT-tolerant pattern). Per `kind`: skill directories read `SKILL.md` (Task 4) and produce a `skill`; agent directories read `AGENT.md` frontmatter and produce a declaration referencing the file (`kind: "agent"`, `resource: <AGENT.md path>`); tool/context/instructions dirs read `manifest.json` (parsed via `parsePrismManifest`-shaped single-contribution JSON or a kind-specific `package.json`-style file) and produce a `declaration`. Returns a flat list with **merge order: global first, workspace overrides same `(kind, name)`** (workspace wins on collision; documented + tested).
    - Performance: One `readdir` per kind-root per origin; no recursive walk beyond one level of named subdirs. O(N) in number of contributions.
    - Code Quality: Uses `node:fs/promises`, `node:path`, `node:os` only; reuses `readConfigFile`'s missing-file helper pattern. No `import()` of contribution modules. Pure async function, no class state. Namespaced `ponytail:` comments for the merge order and the single-level scan ceiling.
    - Security: Respects `PermissionPolicy` via `assertPermission({ kind: "resource", action: "load", target })` for each directory read (reuse Phase 10/16 permission seam). Workspace roots must pass the host's path-trust check before scanning (Task 6 wires `TrustPolicy`); the scanner itself trusts the caller to have gated trust and only reads paths under the configured roots (fail-closed via `isPathInsideReal` against the configured root).
  - Approach:
    - Documentation Reviewed:
      - `src/node/config.ts` `loadConfigFiles`/`isMissingFile` — ENOENT-tolerant read pattern to reuse for missing kind roots and missing contribution dirs.
      - `src/node/trust.ts` `isPathInsideReal` — used to bound scanned paths (defensive; the discovered subdirectory must live under the configured kind-root).
      - `src/manifests.ts` `parsePrismManifest` and `ManifestContributionDeclaration` — declaration parsing for non-skill kinds.
      - `src/contracts.ts` `DiscoveredContribution` (Task 2).
      - `src/security.ts` `assertPermission` — gated read pattern.
      - Roadmap Phase 29 layout (`<workspace>/.agent/skills/<name>/`, `~/.prism/agent/skills/<name>/`).
    - Options Considered:
      - Per-kind loader modules (`discoverSkills`, `discoverTools`, ...): rejected — duplicates directory walk; one scanner + per-kind adapter is shorter.
      - Walking nested directory trees: rejected — single-level named-subdir scan is the documented layout; nested discovery is YAGNI. Marked ceiling in a `ponytail:` comment.
    - Chosen Approach:
      - One `discoverContributions()` reading a flat config of `{ kinds: ContributionFileKind[]; workspaceRoot?: string; globalRoot?: string; permission?; trustRoots? }`. Per-kind adapter functions `readSkill(dir, origin)`, `readAgent(dir, origin)`, `readManifestContribution(dir, kind, origin)` produce the contribution. Merge is a single `Map<string, DiscoveredContribution>` keyed by `${kind}/${name}`, insert global then workspace.
    - API Notes and Examples:
      ```ts
      // src/node/contribution-discovery.ts
      export interface DiscoveryOptions {
        readonly kinds: readonly ContributionFileKind[];
        readonly workspaceRoot?: string;       // scan .agent/<kind>s/
        readonly globalRoot?: string;          // scan .prism/agent/<kind>s/, default homedir()
        readonly permission?: PermissionContext;
        readonly trust?: TrustPolicy;          // optional; gate workspace root
      }
      export async function discoverContributions(options: DiscoveryOptions): Promise<readonly DiscoveredContribution[]> { /* ... */ }
      ```
      ```ts
      // ponytail: single-level named-subdir scan; nested layouts would need a recursive walk if added later.
      // ponytail: merge = global then workspace, workspace wins on (kind,name) collision. Per-namespace overrides are YAGNI until collisions bite.
      ```
    - Files to Create/Edit:
      - `src/node/contribution-discovery.ts`: `discoverContributions()` + private `readSkill`/`readAgent`/`readManifestContribution` adapters.
      - `src/node/index.ts`: re-export `discoverContributions`, `DiscoveryOptions`.
    - References:
      - `src/node/config.ts`, `src/node/trust.ts`, `src/manifests.ts`, `src/security.ts`.
      - Roadmap Phase 29 layout table.
  - Test Cases to Write:
    - `src/__tests__/node-contribution-discovery.test.ts` (`node:test` + `tmp` dir in `os.tmpdir()`): workspace skill at `.agent/skills/my-skill/SKILL.md` discovered with origin `"workspace"` and parsed `Skill` fields. Global skill at `~/.prism/agent/...` (use a temp global root) discovered with origin `"global"`. Same-name global + workspace → exactly one entry, origin `"workspace"` wins, workspace value retained. Missing kind directory → no throw, returns `[]` for that kind. Tool dir with `manifest.json` → declaration with `kind:"tool"`. Agent dir with `AGENT.md` → declaration with `kind:"agent"`, `resource` = AGENT.md path. No `import()` performed (assert file contents, not module load). All paths under `os.tmpdir()`, no real home dir touched.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new public `discoverContributions` helper + `DiscoveryOptions` (Node subpath).
    - Docs pages to create/edit:
      - `docs/contribution-discovery.md` (Task 9): document options, roots, merge order, permission/trust, and that no `import()` happens.
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 4 — `SKILL.md` / `AGENT.md` frontmatter parser (`loadSkillFile`)
  - Acceptance Criteria:
    - Functional: `parseSkillFile(text, path): Skill` parses a `SKILL.md` consisting of an optional YAML-ish fence-delimited frontmatter block (`---\n...\n---`) plus a body. Frontmatter keys map to `Skill`: `name` (required), `description?`, `toolNames?` (comma- or YAML-list), `context?` left to host wiring (file-declared context providers require a `module`, surfaced via declaration metadata — Phase 30 owns instruction injection; here `context` is left empty and a `ponytail:` comment notes the gap), and `metadata?`. The markdown body becomes `instructions`. Missing frontmatter → `name` falls back to the directory base name and the entire file is `instructions`. `parseAgentFrontmatter(text, path): ManifestContributionDeclaration` extracts `name`/`metadata` from an `AGENT.md` frontmatter; full agent resolution is Phase 33 (`ponytail:` comment).
    - Performance: O(file size); no regex backtracking hazards; runs only on discovered files.
    - Code Quality: One small parser, no frontend markdown dependency. Frontmatter parsing is tolerant: unknown keys ignored, not fatal. Two-line `splitFrontmatter` helper, then a tiny key/value reduce. Avoids a YAML dependency (subset covers scalar + simple list).
    - Security: No `eval`, no script execution. Validation: `name` must be non-empty identifier-shaped string; malformed frontmatter → throw a clear error naming the file.
  - Approach:
    - Documentation Reviewed:
      - Pi `SKILL.md` examples in this repo: `/home/arn/project/prism/.agents/skills/create-plan/SKILL.md` etc. — real frontmatter shape (`name`, `description`) to match.
      - `src/contracts.ts` `Skill` fields.
      - `src/skills.ts` `resolveActiveSkills` — confirms `toolNames` enforcement happens downstream, so the parser only needs to surface them.
    - Options Considered:
      - Pull in a YAML library (`yaml`/`js-yaml`): rejected — Phase 29 frontmatter is scalar + simple list; stdlib `String` parsing suffices, no new dependency (Ponytail rung 5).
      - Strict full Markdown AST parse: rejected — only frontmatter + raw body matter.
    - Chosen Approach:
      - Minimal frontmatter scanner: split on first `---\n` / closing `\n---\n`; parse `key: value` and block-list (`- item` or `key: [a, b]`) lines. Keep the rest as `instructions`.
    - API Notes and Examples:
      ```ts
      // src/contribution-parsing.ts (core, fs-free)
      export function parseSkillFile(text: string, path: string): Skill { /* ... */ }
      export function parseAgentFile(text: string, path: string): ManifestContributionDeclaration { /* ponytail: full resolution is Phase 33's resolveAgentDefinition */ }
      ```
    - Files to Create/Edit:
      - `src/contribution-parsing.ts`: `parseSkillFile`, `parseAgentFile`, private `splitFrontmatter`.
      - `src/index.ts`: export `parseSkillFile`, `parseAgentFile`.
    - References:
      - Existing `SKILL.md` files in `.agents/skills/`.
      - `src/contracts.ts` `Skill`, `src/manifests.ts` `ManifestContributionDeclaration`.
  - Test Cases to Write:
    - `src/__tests__/contribution-parsing.test.ts`: frontmatter + body → `instructions === body`, `toolNames` parsed as list. No frontmatter → name from basename, body is the file. Malformed frontmatter (unterminated fence) → throws naming the file. Empty file → `name` from basename, `instructions === ""`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — public `parseSkillFile`/`parseAgentFile`.
    - Docs pages to create/edit:
      - `docs/contribution-discovery.md` (Task 9): document the `SKILL.md`/`AGENT.md` format and accepted frontmatter keys.
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 5 — `registerDiscoveredContributions()`: register discovered skills synchronously, other kinds by reference
  - Acceptance Criteria:
    - Functional: `registerDiscoveredContributions(registries: ContributionRegistries, contributions: readonly DiscoveredContribution[]): void` registers skill-kind contributions into `registries.skills` (as `Skill`, via `ContributionRegistry.register(name, skill)`), instructions-kind into `registries.systemPromptContributions` (as a static-text contribution whose `text` is read lazily from `declaration.resource` — registered as a descriptor that the host can lift into `SystemPromptConfig`), and tool/context/agent kinds into their respective registries as **declaration-only** contributions carrying `metadata: { discovered: true, module, exportName, resource }`. The registrar performs NO `import()`; executable behavior for tool/context/agent is host-owned. Agent registration is a stub `AgentDefinition` whose `create()` throws `Agent file resolution requires Phase 33's resolveAgentDefinition` (fail-closed, documented); Phase 33 will replace the stub.
    - Performance: O(N) registrations; pure `Map.set` via existing `ContributionRegistry`.
    - Code Quality: Reuses `ContributionRegistries` and `ContributionRegistry.register`; introduces no new container. One dispatcher over `kind`. `ponytail:` comment on the agent stub + on instruction-contributions being descriptor-only until Phase 30.
    - Security: No code execution; no module loading; no privilege grant; no skill auto-activation (Phase 26 `toolNames` enforcement remains the activation gate).
  - Approach:
    - Documentation Reviewed:
      - `src/contributions.ts` `ContributionRegistries`/`ContributionRegistry.register` — the single registration primitive to reuse.
      - `src/contracts.ts` `SystemPromptContribution`, `AgentDefinition`, `ToolDefinition`, `ContextProvider`.
      - `src/skills.ts` `resolveActiveSkills` — confirms registration alone is inert; activation is the runtime's job.
      - Roadmap: "Discovery registers contributions, it does not auto-activate."
    - Options Considered:
      - Realize all kinds at registration (dynamic `import()`): rejected — core must not auto-execute untrusted modules; host owns execution. Tool/context/agent stay descriptors.
      - Skip tool/context/agent entirely until Phase 33: rejected — roadmap requires discovery for these kinds ("tools/context/instructions/agents analogously register"), but registration-as-descriptor satisfies it without execution.
    - Chosen Approach:
      - Skill → full `Skill` object registered. Instructions → static `SystemPromptContribution { source: "package", mode: "append", text }` registered (text read from file at registration time; cheap, host-controlled). Tool/context/agent → declaration-only entries (no executable) registered with discovery metadata; Phase 33 resolves agents; tool/context execution stays host-owned.
    - API Notes and Examples:
      ```ts
      // src/contributions.ts (extend)
      export function registerDiscoveredContributions(registries: ContributionRegistries, contributions: readonly DiscoveredContribution[]): void { /* dispatch by kind */ }
      ```
    - Files to Create/Edit:
      - `src/contributions.ts`: add `registerDiscoveredContributions`.
      - `src/index.ts`: export `registerDiscoveredContributions`.
    - References:
      - `src/contributions.ts`, `src/contracts.ts`, `src/skills.ts`.
      - Roadmap Phase 29 acceptance ("inert until activated").
  - Test Cases to Write:
    - `src/__tests__/contributions-discovered.test.ts`: register a skill contribution → `registries.skills.resolve("my-skill")` returns the parsed `Skill` with `toolNames`. Register agent stub → `registries.agents.resolve("agent-x")` returns a definition whose `create()` throws the documented Phase-33 error. Register tool descriptor → `registries.tools.get("t")` returns an object with `metadata.discovered === true` and no execution. Calling `registerDiscoveredContributions` twice for same `(kind,name)` → last wins (documented idempotency).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — public `registerDiscoveredContributions`; behavior of contribution registries extended (descriptor entries for tool/context/agent).
    - Docs pages to create/edit:
      - `docs/contribution-discovery.md` (Task 9): document registration semantics per kind, inert-until-activated, agent Phase-33 deferral.
      - `docs/contribution-registries.md`: cross-reference discovered-contribution registration.
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 6 — Trust model: workspace contributions gated, global trusted, no hidden auto-load
  - Acceptance Criteria:
    - Functional: The CLI/host loader checks the workspace kind-roots against the host `TrustPolicy` (reuse `createPathTrustPolicy` from `src/node/trust.ts`) before scanning workspace dirs; untrusted workspace roots are skipped with a clear logged reason and never raise. The global root under `~/.prism/` is loaded only when the host explicitly enables global discovery (CLI flag default off in core runtime, on in the CLI whitelist when `--discover-global` or trust preset is given). Reuses Phase 10/16 `assertPermission` for each file read inside a trusted root.
    - Performance: One `realpath` per root via `isPathInsideReal`; negligible.
    - Code Quality: No new trust concept; reuses `TrustPolicy`/`isPathInsideReal`. No silent eager loading.
    - Security: Untrusted workspace `.agent/` is not read. No symlink escape (Phase 16's realpath check already covers it). No credential/provider scanning.
  - Approach:
    - Documentation Reviewed:
      - `src/node/trust.ts` `createPathTrustPolicy`/`isPathInsideReal`.
      - `src/security.ts` `assertPermission`.
      - Roadmap non-negotiable: "Host controlled. No hidden globals"; Phase 10/16 trust model.
    - Options Considered:
      - Per-file trust prompt on every read: rejected — root-level trust is the existing Phase-16 granularity.
      - Auto-trust workspace `.agent/`: rejected — opposite of the boundary. Trust is explicit.
    - Chosen Approach:
      - Wrap `discoverContributions` for CLI use with a trust precheck; the core `discoverContributions` only bounds reads to configured roots, the CLI/host layer (Task 7) supplies trust roots and skips on denial.
    - Files to Create/Edit:
      - `src/node/contribution-discovery.ts`: thread `trust?: TrustPolicy` through `DiscoveryOptions`; skip a workspace root when `trust.check` returns `{ trusted: false }`. Document global-root opt-in.
    - References:
      - `src/node/trust.ts`, `src/security.ts`, Roadmap Phase 10/16.
  - Test Cases to Write:
    - `src/__tests__/node-contribution-discovery.test.ts` (extend): untrusted workspace root → no skill registered, no throw, returns `[]`. Symlink (`fs.symlink`) pointing outside the workspace kind-root → `isPathInsideReal` excludes it; no read. Global root supplied but `--discover-global` not enabled → global not scanned.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — discovery now honors `TrustPolicy`.
    - Docs pages to create/edit:
      - `docs/contribution-discovery.md` (Task 9): trust model section (workspace gate, global opt-in, symlink handling).
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 7 — CLI wiring: `--discover`, `--discover-kinds`, `--no-discovery`, `--discover-global` flags
  - Acceptance Criteria:
    - Functional: `src/cli-runner.ts`/`src/cli.ts` parse `--discover` (enable workspace discovery), `--discover-kinds <csv>` (default `skill`; allow `skill,tool,context,instructions,agent`), `--discover-global` (also scan `~/.prism/agent/`), `--no-discovery`. When `--discover` is set, the CLI builds `DiscoveryOptions` from the resolved workspace root + global flag, calls `discoverContributions`, then `registerDiscoveredContributions` into the agent's `ContributionRegistries` (built by the existing CLI bootstrap) **before** selecting active tools/skills. Skills discovered this way become selectable via `RunOptions.activeSkills`. Default (no flags): no discovery, no filesystem access — SDK-equivalent path unchanged.
    - Performance: Discovery adds one `readdir` per kind root, only when enabled; default runs pay zero.
    - Code Quality: Reuses existing CLI bootstrap and agent config assembly; discovery is additive. No change to in-memory default behavior.
    - Security: Default CLI run does NOT scan `~/.prism/agent/` unless `--discover-global` is passed; workspace discovery still gated by trust (Task 6).
  - Approach:
    - Documentation Reviewed:
      - `src/cli-runner.ts`, `src/cli.ts` — existing flag parsing and agent bootstrap to extend.
      - Plan 024 CLI precedent and Phase 9 CLI surface.
    - Options Considered:
      - Auto-discover by default: rejected — boundary requires opt-in.
      - Separate `prism discover` subcommand only: rejected — discovery must feed the runtime the same run uses; flag-on-run is the place.
    - Chosen Approach:
      - Four flags, additive, default-off. Build options, scan, register, then continue existing bootstrap.
    - Files to Create/Edit:
      - `src/cli-runner.ts`/`src/cli.ts`: parse flags, call `discoverContributions` + `registerDiscoveredContributions` before agent run when enabled.
    - References:
      - `src/cli-runner.ts`, `src/cli.ts`, `src/node/contribution-discovery.ts`, `src/contributions.ts`.
  - Test Cases to Write:
    - `src/__tests__/cli-discovery.test.ts`: `--discover` with a temp workspace skill → run activates it via `activeSkills` and the provider input contains the skill instructions (mock provider). `--no-discovery` default → no filesystem reads attempted (assert via spy/no node-fs usage). `--discover-kinds skill` ignores stray tool dirs (does not register tool descriptors). `--discover-global` scans a temp global root.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — new CLI flags.
    - Docs pages to create/edit:
      - `docs/contribution-discovery.md` (Task 9): CLI flags section.
      - `docs/cli.md`: add the four flags to the reference.
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 8 — Compile-checked example + boundary tests (no core auto-discovery, no `synapta*`, in-memory unaffected)
  - Acceptance Criteria:
    - Functional: An `examples/discover-skills.ts` typed example compiles (`tsc --noEmit` over examples) without network or real credentials. It builds a `SkillRegistry`/`ContributionRegistries`, calls `discoverContributions({ kinds: ["skill"], workspaceRoot: "./example-workspace", trust })` against a committed `examples/example-workspace/.agent/skills/greeter/SKILL.md`, registers, then runs a mock agent with `activeSkills: ["greeter"]` and prints the assembled provider input. Boundary tests: `src/__tests__/phase29-boundaries.test.ts` asserts (a) `src/` files outside `src/node/` do not import any `node:fs`/`node:os`/`node:path` module from the discovery path (i.e. discovery is Node-only and not reachable from the core runtime path that SDK apps use); (b) `src/` imports no `synapta*`; (c) `DiscoveredContribution` field names contain no `workflow`/`node`/`step` (generic only).
    - Performance: Example + tests run network-free, under existing test budget.
    - Code Quality: Example mirrors Plan 024 example style; boundary tests parity with other `phase*-boundaries.test.ts` files.
    - Security: Example uses mock provider only; no real credentials; example workspace `SKILL.md` contains no secret-looking text.
  - Approach:
    - Documentation Reviewed:
      - `examples/` existing structure (Plan 024 example as template).
      - Existing `phase*-boundaries.test.ts` for parity.
    - Options Considered:
      - Reuse an existing example workspace: rejected — needs a committed `SKILL.md` demonstrating frontmatter.
    - Chosen Approach:
      - Commit a tiny example workspace + example script + boundary test.
    - Files to Create/Edit:
      - `examples/discover-skills.ts`, `examples/example-workspace/.agent/skills/greeter/SKILL.md`.
      - `src/__tests__/phase29-boundaries.test.ts`.
    - References:
      - `examples/` (Plan 024), existing boundary tests.
  - Test Cases to Write:
    - Boundary tests listed above; example-compile check wired into the existing examples typecheck script.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no new public API; example references existing APIs.
    - Docs pages to create/edit:
      - `docs/contribution-discovery.md` (Task 9): link the example.
    - `docs/index.md` update: yes (Task 9).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 9 — Docs: `/docs/contribution-discovery.md`, `docs/index.md` entry, cross-references
  - Acceptance Criteria:
    - Functional: `docs/contribution-discovery.md` follows the Prism wiki API page structure (What it does / When to use it / Inputs-request / Outputs-response-events / Request-response example / Implementation example / Extension and configuration notes / Security and performance notes / Related APIs). Covers: workspace/global layout table (`<workspace>/.agent/{skills,tools,context,instructions,agents}/<name>/` and `~/.prism/agent/<kind>s/<name>/`); `SKILL.md`/`AGENT.md`/`manifest.json` formats and accepted frontmatter keys; merge order (global → workspace; explicit `AgentConfig`/`RunOptions` selections override discovered); trust model (workspace gate via `createPathTrustPolicy`, global opt-in, symlink handling); the CLI flags (`--discover`, `--discover-kinds`, `--discover-global`, `--no-discovery`); the rule that discovery registers but never activates and never grants tools/permissions; provider discovery exclusion (Phase 24); agent deferral to Phase 33. `docs/index.md` gains an entry in the "Extensions/plugins" group. `docs/extensions.md`, `docs/context-and-skills.md`, `docs/contribution-registries.md`, and `docs/cli.md` gain cross-references.
    - Performance: Docs change only.
    - Code Quality: Matches prism-wiki page structure exactly; includes a runnable TypeScript snippet mirroring the example.
    - Security: Trust model + "no auto-execute / no auto-activate / no provider scanning" called out under Security notes.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md` (page structure).
      - `docs/index.md` (grouping), `docs/extensions.md`, `docs/context-and-skills.md`, `docs/contribution-registries.md`, `docs/cli.md`.
    - Options Considered:
      - One mega page covering discovery + instruction injection + system prompts: rejected; Phase 29/30/31 each own a page per the roadmap.
    - Chosen Approach:
      - Single focused page + cross-references + index entry + docs-enforcement test extension (Task 10).
    - Files to Create/Edit:
      - `docs/contribution-discovery.md` (new).
      - `docs/index.md`: "Extensions/plugins" → "Contribution discovery (workspace & global)" link.
      - `docs/extensions.md`, `docs/context-and-skills.md`, `docs/contribution-registries.md`, `docs/cli.md`: cross-reference.
    - References:
      - `.agents/skills/create-plan/references/prism-wiki.md`; all `docs/*.md` touched.
  - Test Cases to Write:
    - Extend `src/__tests__/docs.test.ts`: assert `docs/contribution-discovery.md` exists and contains each required section heading; assert `docs/index.md` links it; assert the four CLI flags appear in `docs/cli.md`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes — this task IS the docs surface for Phase 29.
    - Docs pages to create/edit: see files above.
    - `docs/index.md` update: yes — "Extensions/plugins" group entry.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

- [ ] Task 10 — Final verification: full test run, typecheck, examples compile, package boundaries
  - Acceptance Criteria:
    - Functional: `npm test` (network-free), `tsc --noEmit`, examples typecheck, docs tests, and `npm pack --dry-run --json` all pass. No new first-party skill package is published in this phase (Phase 29 is discovery infra only). No `dist/__tests__` shipped. No provider auto-discovery introduced. No Synapta import.
    - Performance: `npm test` within the documented `<30s` budget (Node 20 baseline ~22s).
    - Code Quality: Public exports (`ContributionFileKind`, `DiscoveredContribution`, `discoverContributions`, `DiscoveryOptions`, `parseSkillFile`, `parseAgentFile`, `registerDiscoveredContributions`) all present in `src/index.ts` and the `node` subpath.
    - Security: No credential/provider scanning; no auto-execute; secrets-redaction path unaffected; example workspace contains no secret-like text.
  - Approach:
    - Documentation Reviewed:
      - `docs/release-and-install.md` (test budget + tarball rules).
      - Phase 17 acceptance gates.
    - Options Considered:
      - Publish a `@arnilo/prism-skill-greeter` first-party package here: rejected — Phase 29 ships discovery infra; first-party skill packages are a separate request, explicitly listed as not added in this phase.
    - Chosen Approach:
      - Run the existing verification matrix plus the Phase 29 boundary + docs tests.
    - Files to Create/Edit:
      - none (verification only); update this plan's checkboxes.
    - References:
      - `docs/release-and-install.md`, Phase 17 gates, this plan's tasks.
  - Test Cases to Write:
    - No new test cases; verify the existing matrix reports green and tarball dry-run is clean.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no — verification only.
    - Docs pages to create/edit: `none` (covered by Task 9).
    - `docs/index.md` update: no (Task 9 already).
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Primitive Review

(Filled by Task 1. Summary of findings under Compromises/Further Actions once Task 1 completes.)

## Compromises Made
- To be filled after tasks are completed and tests pass. Likely: tool/context/instructions/agent discoveries register as **descriptors** only in this phase (no auto `import()`); executable wiring is host-owned and fully realized for agents in Phase 33 (`resolveAgentDefinition`) and for tool/context execution by the host. `Skill.context` declared in a file `SKILL.md` is surfaced as metadata but not wired into `ContextProvider` objects in Phase 29 (file-declared context providers need a module); noted with a `ponytail:` comment.

## Further Actions
- To be filled after task completion with improvements, rationale, and priority. Likely candidates: ship a first-party `@arnilo/prism-skill-*` package once a real skill exists (Phase 29 explicitly defers packaging); Phase 30 instruction-injection consumes discovered `instructions` descriptors; Phase 33 `resolveAgentDefinition` replaces the Phase-29 agent stub for file-declared agents; consider a per-namespace registry override if same-name collisions across first-party + third-party packages become a problem (`ponytail:` noted in the scanner).
