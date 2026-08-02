# Release 0.0.22 — Third-party behavior integrations (Caveman, Ponytail)

Roadmap phase: Phase 5 (`roadmap.md`).
Baseline: `@arnilo/prism` **0.0.21** (Phase 4 exit gate passed 2026-07-31).
Target: `@arnilo/prism` **0.0.22** (optional packages `@arnilo/prism-caveman`, `@arnilo/prism-ponytail`).
Prerequisite: Phase 3 progressive-disclosure contracts live — consume `skillsDisclosure`, `createLoadedSkillSet`, `createLoadSkillTool`, `activateAllSkills`, priority budget + `skill_body` demotion; do **not** reimplement catalog/load/eviction.

## Objectives

- Add `@arnilo/prism-caveman` and `@arnilo/prism-ponytail` as optional packages that wire upstream Caveman and Ponytail into Prism contribution contracts.
- Map every upstream hook, skill, command, rule, and mode-lifecycle behavior to existing `Extension`, `Skill`, `CommandDefinition`, `SystemPromptContribution`, `InstructionInjector`, `SettingsProvider`, middleware, and session-custom-entry surfaces.
- Never reimplement upstream: load prompt fragments, skill bodies, hook helpers, and rules from the resolved upstream package path.
- Keep both packages inert until the host explicitly loads the extension (and, for mode persistence, supplies session append/read like OM `attach`).
- Consume Phase 3 progressive disclosure so large `SKILL.md` bodies stay catalog-only until `load_skill` (mode slices stay on `InstructionInjector`).

## Expected Outcome

- Hosts can `createCavemanExtension` / `createPonytailExtension` and `kernel.load([...])`; import alone registers nothing and starts no timers/watchers/network.
- Caveman registers skill set + commands; active level injects upstream prompt fragment; level persists as session custom `caveman-level` and restores on attach/resume.
- Ponytail registers skill set + commands; active mode injects via upstream `getPonytailInstructions` / `filterSkillBodyForMode`; mode persists as session custom `ponytail-mode`.
- Upstream missing → `setup` fails closed with bounded redacted error; no empty contributions.
- Skills participate in progressive catalog; mode slices never force `skillsDisclosure: "eager"`.
- Docs (`docs/caveman.md`, `docs/ponytail.md`), migration, package README/CHANGELOG, packed example, workspace manifests, and release gate agree on **0.0.22**.
- No core primitive added unless Task 0 proves a generic gap; no TUI status bar (status via extension events/metadata for host).

## Tasks

- [x] Task 0 — Primitive review and freeze public API deltas for Phase 5
  - Acceptance Criteria:
    - Functional: inventory states whether existing `Extension`/`ExtensionAPI`, `Skill`/`parseSkillFile`, `CommandDefinition`, `SystemPromptContribution`, `InstructionInjector`, `SettingsProvider`, `ResourceLoader`, middleware hooks that core actually runs (`prompt_build`, `input_assembly`, `context`, …), and host-supplied session custom append/read (OM pattern) cover Caveman/Ponytail wiring without a new contribution kind.
    - Functional: written freeze lists exact public package exports (`createCavemanExtension`, `createPonytailExtension`, option shapes, mode/level customType strings, attach/session callbacks if required), peer/optional upstream resolution rules, and any **generic** core delta only if inventory proves a gap.
    - Functional: inventory explicitly records that middleware `session_start`/`session_shutdown` and extension lifecycle `session_start`/`before_agent_start` are **not** auto-fired by core today (OM precedent: host `attach` + wrappers); freeze chooses restore path (host attach vs inventing core emit — prefer attach).
    - Performance: freeze requires O(registered skills) setup, O(1) mode read/write per turn, bounded upstream prompt constants, zero default timers/watchers/background workers.
    - Code Quality: review cites file:line evidence; rejects reimplementing upstream prompts/skills, vendoring upstream trees into Prism, shelling out to hook scripts, and new core contribution kinds for mode state.
    - Security: upstream text treated untrusted + size-bounded; config paths host-owned + size-limited; no credential/network/fs mutation beyond optional config persistence; custom entries respect session ownership/redaction.
  - Approach:
    - Documentation Reviewed:
      - `roadmap.md` Phase 5 + Cross-Phase Caveman/Ponytail follow-on + third-party integration gaps.
      - `docs/extensions.md`, `docs/context-and-skills.md`, `docs/instruction-injection.md`, `docs/agent-session-runtime.md`, `docs/compaction-observational-memory.md` (attach/`appendEntry` pattern), `docs/migration.md`, `docs/index.md`.
      - Code: `src/contracts.ts` (`Extension`, `ExtensionAPI`, `Skill`, `CommandDefinition`, `InstructionInjector`, `SystemPromptContribution`, `SettingsProvider`, `ExtensionLifecycleEventName`), `src/extensions.ts`, `src/middleware.ts`, `src/contribution-parsing.ts` (`parseSkillFile`), `src/instruction-injection.ts`, `src/skill-disclosure.ts`, `packages/compaction-observational-memory/src/{extension,compose,runtime}.ts`.
      - Upstream Ponytail (installed): `~/.pi/agent/git/github.com/DietrichGebert/ponytail/` — `pi-extension/index.js`, `hooks/ponytail-{config,instructions,activate,mode-tracker,subagent}.js`, `skills/*`, `commands/*`, npm `@dietrichgebert/ponytail@4.8.4`.
      - Upstream Caveman: <https://github.com/juliusbrussee/caveman> (skills/commands/hooks/rules); pi adapter reference `~/.pi/agent/git/github.com/jonjonrankin/pi-caveman/extensions/caveman.ts` (pi TUI wiring — not content source of truth).
    - Options Considered:
      - Reimplement prompts/skills in Prism: reject (roadmap constraint; upstream drifts).
      - Vendor/fork upstream into package: reject (maintenance).
      - Shell out to upstream hook shells: reject (SDK harness, not shell host).
      - Rely on core auto-emitting `session_start` / `before_agent_start`: reject unless Task 0 finds call sites — today none under `src/` for those extension lifecycle names; middleware `session_start` never `run`.
      - Optional peer / `upstreamPath` resolve + map to existing contributions + OM-style host session callbacks: chosen.
    - Chosen Approach:
      - Task 0 freeze-only; no production code until Tasks 1–5.
      - Two new optional packages under workspace glob `packages/prism-*`: `packages/prism-caveman`, `packages/prism-ponytail` (roadmap said `packages/caveman|ponytail`; rename fits `workspaces` without root churn).
      - Default: **no core `src/` changes**. Mode restore/persist via host-supplied `getEntries` + `appendEntry` (or thin `attach({ session, appendEntry, getEntries })`) mirroring OM — not new middleware emit in core unless freeze proves hosts cannot restore otherwise.
      - Prompt path: `InstructionInjector` and/or `SystemPromptContribution` calling upstream builders; deactivation via `input_assembly` middleware and/or command handlers detecting `normal mode` / `stop caveman|ponytail`.
      - Skills: `parseSkillFile` on upstream `SKILL.md`; host wires registry + `createLoadSkillTool`.
    - API Notes and Examples:
      ```ts
      import { createCavemanExtension } from "@arnilo/prism-caveman";
      import { createPonytailExtension } from "@arnilo/prism-ponytail";
      import { createLoadSkillTool, createLoadedSkillSet, createSkillRegistry } from "@arnilo/prism";

      const caveman = createCavemanExtension({
        upstreamPath: "/path/to/juliusbrussee-caveman",
        defaultLevel: "full",
        showStatus: false,
        appendEntry: (entry, opts) => store.append(entry, opts),
        getEntries: () => session.store.getEntries(/* current branch */),
      });
      const ponytail = createPonytailExtension({
        upstreamPath: undefined, // resolve optional peer @dietrichgebert/ponytail
        defaultMode: "full",
        quietStartup: true,
        appendEntry: (entry, opts) => store.append(entry, opts),
        getEntries: () => session.store.getEntries(/* current branch */),
      });
      await kernel.load([caveman, ponytail]);
      ```
    - Files to Create/Edit:
      - `plans/005-Release-0-0-22-Third-Party-Behavior-Integrations.md`: freeze table (this task).
      - No production code in Task 0.
    - References:
      - `roadmap.md` Phase 5 Approach / Exit Gate.
      - Plan 002 OM attach precedent; plan 003 progressive disclosure contracts.
  - Primitive inventory (Task 0 complete — 2026-07-31):

    | Primitive | Covers Phase 5? | Evidence |
    | --- | --- | --- |
    | `Extension` + `ExtensionAPI.register*` | Yes — all contributions inert until host selects | `src/contracts.ts:1079–1085`, `1190–1215`; `src/extensions.ts:152–213` |
    | `Skill` + `parseSkillFile` | Yes — upstream `SKILL.md` → `Skill.instructions` | `src/contracts.ts:1021–1028`; `src/contribution-parsing.ts:87–110` |
    | `CommandDefinition` + RPC `command` | Yes — `/caveman`, `/ponytail` dispatch | `src/contracts.ts:904–925`; `src/rpc.ts:229–235` |
    | `InstructionInjector` + `runInstructionInjectors` | Yes — Ponytail mode slices; Caveman level fragments | `src/contracts.ts:948–981`; `src/instruction-injection.ts:26–41`; wired in `src/input.ts:191–205` |
    | `SystemPromptContribution` + `composeSystemPrompt` | Yes — Caveman level text (alternative/complement to injector) | `src/contracts.ts:1180–1186`; injector output composes via `src/input.ts:203–205` |
    | `SettingsProvider` | Partial — host defaults only; package-local bounded file IO for upstream `writeDefaultMode` / Caveman config | `src/contracts.ts:2055–2057`; upstream `hooks/ponytail-config.js` file paths stay package-local |
    | `ResourceLoader` | No — not needed; packages read upstream files directly with host-supplied `upstreamPath` | `src/contracts.ts:2043+`; `loadTextResource` is host-run-time, not extension setup |
    | Middleware `context` | Yes — runs in assembler | `src/input.ts:133` |
    | Middleware `input_assembly` | Yes — deactivation text detection | `src/input.ts:244`, `254` |
    | Middleware `prompt_build` | Yes — optional Caveman hook parity | `src/input.ts:265–276` |
    | Middleware `tool_call` | Yes — available if needed; neither upstream requires it for mode | `src/tools.ts:146` |
    | Middleware `session_start` / `session_shutdown` | **No auto-run** — declared only | `src/middleware.ts:13–14`; repo-wide grep: zero `run("session_start")` / `run("session_shutdown")` call sites |
    | Extension lifecycle `session_start` / `before_agent_start` | **Not auto-emitted** — host/extension bus only | `src/contracts.ts:1058–1062`; `src/agents.ts:451–452` emits `agent_started`, not extension lifecycle names; `src/extensions.ts:100` emits only on handler errors |
    | Session custom `kind: "custom"` + host `appendEntry` | Yes — mode/level persistence (OM precedent) | `src/contracts.ts:1218–1254`; OM `runtime.ts:309–313` (`data.type` discriminator) |
    | `createLoadSkillTool` / `createLoadedSkillSet` / `skillsDisclosure` | Yes — progressive catalog; mode slices stay on injector | `src/skill-disclosure.ts:35–50`; `src/skill-load.ts:89+`; `src/agents.ts:574` |
    | `api.use` middleware registration | Yes — extension registers `input_assembly` for deactivation | `src/extensions.ts:195`; `docs/extensions.md` |
    | `api.on` extension events | Partial — status/metadata for hosts; no TUI | `src/extensions.ts:121`; not required for core wiring |
    | New contribution kind for mode state | **Reject** — session custom entries suffice | OM `data: { type, … }` pattern |

    **Core delta verdict: none.** Existing primitives cover all roadmap Functional AC; no new contribution kind, no core `session_start` emit, no `ResourceLoader` requirement.

  - Upstream hook → Prism mapping (frozen):

    | Upstream (Ponytail pi-extension / hooks) | Prism surface | Notes |
    | --- | --- | --- |
    | `session_start` + `resolveSessionMode(entries)` | Host `attach()` reads `getEntries()` once; extension holds restored mode | No core emit; mirror OM `attach` |
    | `before_agent_start` + `getPonytailInstructions` | `InstructionInjector` (`when: "every_turn"`, skip when `off`) | Replaces pi `before_agent_start` |
    | `input` + `isDeactivationCommand` | `api.use("input_assembly", …)` middleware | Detect `stop ponytail` / `normal mode` |
    | `registerCommand("ponytail", …)` | `api.registerCommand` | Args via `CommandDefinition.execute` |
    | `appendEntry("ponytail-mode", { mode })` | Host `appendEntry(createSessionEntry({ kind: "custom", data: { type: "ponytail-mode", mode } }))` | Prism uses `data.type`, not pi `customType` |
    | `filterSkillBodyForMode` | Host skill render path / optional wrapper when building `Skill` for prompt | Consume upstream function; do not fork strings |
    | `ponytail-subagent` | Extension `api.on` / `metadata` only | No nested-agent runtime in Prism; document host responsibility |
    | `ponytail-statusline.sh` | **Skip** — events/metadata/`status` command | No shell scripts |
    | Caveman `caveman-activate` / `caveman-mode-tracker` | Same attach + custom `caveman-level` | Upstream hooks at `juliusbrussee/caveman/src/hooks/` |
    | Caveman `caveman-config` | Bounded package-local file IO + `CommandDefinition` | pi-caveman `caveman.ts` is UX reference only, not content source |
    | Caveman level prompt fragments | `InstructionInjector` and/or static upstream module import | Load from upstream `src/rules/` or hook modules — never pi-caveman embedded `BASE`/`INTENSITY` |

  - Freeze table (Task 0 locked):

    | Delta | Name / default | Notes |
    | --- | --- | --- |
    | Package paths | `packages/prism-caveman`, `packages/prism-ponytail` | npm: `@arnilo/prism-caveman`, `@arnilo/prism-ponytail`; workspace glob `packages/prism-*` |
    | Public exports | `createCavemanExtension`, `createPonytailExtension` only (`.`) | `sideEffects: false`; peer `@arnilo/prism@0.0.22` |
    | `CavemanExtensionOptions` | `upstreamPath: string` (required), `defaultLevel?: Level`, `showStatus?: boolean`, `appendEntry`, `getEntries`, `configPath?: string` | `Level` = upstream levels: `off\|lite\|full\|ultra\|wenyan-lite\|wenyan\|wenyan-ultra\|micro` |
    | `PonytailExtensionOptions` | `upstreamPath?: string`, `defaultMode?: Mode`, `quietStartup?: boolean`, `appendEntry`, `getEntries`, `configPath?: string` | `upstreamPath` optional when peer `@dietrichgebert/ponytail` resolvable; `Mode` = `off\|lite\|full\|ultra` |
    | Session custom discriminator | `data.type`: `"caveman-level"` \| `"ponytail-mode"` | Payload: `{ level }` or `{ mode }`; latest-on-branch wins (upstream `resolveSessionMode` scan order) |
    | `appendEntry` / `getEntries` | Required on both factories | Same contract as OM `ObservationalMemoryAttachOptions.appendEntry`; `getEntries(): readonly SessionEntry[]` or `session.entries()` |
    | Optional `attach(session)` | `createCavemanBehavior` / `createPonytailBehavior` helpers (Task 1+) | Thin wrapper: restore mode on attach, return `{ extension, restoreMode }` — not required on factory if host passes callbacks |
    | Upstream resolve | `resolveUpstreamRoot({ upstreamPath?, packageName })` | Caveman: `upstreamPath` must contain `skills/` marker; Ponytail: peer `@dietrichgebert/ponytail@^4.8.4` or path; miss → `setup` throws, zero registrations |
    | Size bounds (frozen) | `MAX_SKILL_FILE_BYTES = 262_144`, `MAX_CONFIG_FILE_BYTES = 16_384`, `MAX_INJECTED_INSTRUCTION_BYTES = 32_768` | Align `HARD_MAX_SKILL_INSTRUCTION_BYTES` (`src/skill-disclosure.ts:12`); errors redact absolute paths |
    | Performance | O(skills) setup scan; O(1) mode read/write per change; O(1) instruction lookup per turn | Zero default timers/watchers/network; `showStatus` emits metadata only |
    | Core `src/` changes | **none** | Rejected: core `session_start` emit, new contribution kind, vendoring upstream |

  - Roadmap Functional AC → primitive map (freeze checklist):

    | Roadmap AC | Primitive / package behavior |
    | --- | --- |
    | Caveman skills from upstream `SKILL.md` | `parseSkillFile` + `api.registerSkill` |
    | Caveman commands + level variants | `api.registerCommand` |
    | Caveman level persist/restore/inject | custom `caveman-level` + `InstructionInjector` + attach `getEntries` |
    | Caveman deactivation | `input_assembly` middleware |
    | Ponytail skills from upstream `SKILL.md` | `parseSkillFile` + `api.registerSkill` |
    | Ponytail commands + aliases | `api.registerCommand` |
    | Ponytail instructions + filter | `InstructionInjector` calling upstream `getPonytailInstructions` / `filterSkillBodyForMode` |
    | Ponytail mode persist/restore | custom `ponytail-mode` + attach |
    | Progressive disclosure | Host `skillsDisclosure: "progressive"` + `createLoadSkillTool`; injector for mode slice |
    | Inert until host loads extension | `Extension` kernel explicit `load` (`docs/extensions.md`) |
    | Fail closed missing upstream | `setup` throw before any `register*` |
    | No TUI status bar | Skip statusline scripts; optional extension event/metadata |

  - Rejected (confirmed in review):

    - Reimplement upstream prompts/skills in Prism packages.
    - Vendor upstream trees into `packages/prism-*`.
    - Shell out to `ponytail-statusline.sh` or Caveman hook shell scripts.
    - New core contribution kind for mode/level state.
    - Core auto-emit `session_start` / `before_agent_start` (prefer OM-style host attach + injectors).
    - `skillsDisclosure: "eager"` for these packages (mode on injector only).
    - Use pi-caveman embedded prompt constants as source of truth (juliusbrussee/caveman only).

  - Test Cases to Write:
    - Freeze doc checklist: every roadmap Functional AC maps to an existing primitive or an explicit rejected/core-gap row. **Done — see table above; zero core gaps.**
    - Confirm no Task 0 production diff. **Done — plan doc only.**
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: no (freeze only); later tasks add package APIs.
    - Docs pages to create/edit: none in Task 0.
    - `docs/index.md` update: no.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md` (applies from Task 5).

- [x] Task 1 — Scaffold both packages + fail-closed upstream resolution
  - Acceptance Criteria:
    - Functional: packages install/build/test in workspace; export factories from public `.` export only; `setup` without resolvable upstream throws/fails closed with redacted bounded error and registers zero contributions.
    - Functional: import is side-effect-free (`sideEffects: false`); no provider call, timer, watcher, or network on import or successful setup beyond reading local upstream files/config.
    - Performance: upstream resolve is O(1) path/module resolve; skill directory scan O(skills); no recursive whole-repo walk.
    - Code Quality: mirror OM package.json/tsconfig/test layout; peer `@arnilo/prism@0.0.22`; Ponytail optional peer `@dietrichgebert/ponytail`; Caveman documents `upstreamPath` (unpublished upstream).
    - Security: path confinement to host-supplied upstream root; read size caps on SKILL.md/config; errors redact home/absolute paths per Prism redaction helpers where applicable.
  - Approach:
    - Documentation Reviewed:
      - `packages/compaction-observational-memory/package.json`, Task 0 freeze, npm workspaces in root `package.json` (`packages/prism-*`).
      - Ponytail `package.json` exports/files; Caveman repo layout from roadmap + GitHub.
    - Options Considered:
      - Single `@arnilo/prism-behaviors` mega-package: reject (independent opt-in).
      - `packages/caveman` outside workspace glob + manual workspace entry: reject; use `packages/prism-*`.
      - Two packages + resolve helper: chosen.
    - Chosen Approach:
      - Scaffold `packages/prism-caveman` and `packages/prism-ponytail` with `create*Extension`, `resolveUpstreamRoot(options)`, shared local helper pattern (duplicate small resolve helper — no shared internal package unless freeze demands).
      - Workspace auto-includes via `packages/prism-*`; bump peer to 0.0.22 when release task runs (scaffold may use 0.0.21→0.0.22 in Task 5).
    - API Notes and Examples:
      ```ts
      // resolveUpstreamRoot({ upstreamPath, packageName: "@dietrichgebert/ponytail" })
      // → absolute root or throw bounded error
      ```
    - Files to Create/Edit:
      - `packages/prism-caveman/{package.json,tsconfig.json,src/index.ts,src/extension.ts,src/upstream.ts,src/__tests__/upstream.test.ts,README.md,CHANGELOG.md}`
      - `packages/prism-ponytail/{same}`
      - Root lockfile update via `npm install` after scaffold.
    - References:
      - OM package as template; roadmap Files to Create/Edit.
  - Test Cases to Write:
    - Missing upstream → setup fails; registries unchanged. **Done** — `packages/prism-*/src/__tests__/upstream.test.ts`.
    - Import does not start timers/network (assert no handle / nock unused). **Done** — `sideEffects: false` + metadata tests in `index.test.ts`.
    - Resolves `upstreamPath` directory that contains expected `skills/` marker. **Done** — fixture `fixtures/upstream-minimal/skills/`.
  - Task 1 complete (2026-07-31):
    - `packages/prism-caveman` and `packages/prism-ponytail` scaffolded with `package.json`, `tsconfig.json`, `src/{index,extension,upstream}.ts`, README/CHANGELOG stubs, fixture trees.
    - `resolveUpstreamRoot`: Caveman requires `upstreamPath` + `skills/` marker; Ponytail accepts `upstreamPath` or optional peer `@dietrichgebert/ponytail` via `createRequire`.
    - `create*Extension` `setup` resolves upstream first; failure throws `UpstreamResolveError` with redacted bounded message; zero `register*` on success (Task 2/3 wire contributions).
    - Bounds frozen in `upstream.ts`: `MAX_SKILL_FILE_BYTES`, `MAX_CONFIG_FILE_BYTES`, `MAX_INJECTED_INSTRUCTION_BYTES`.
    - Workspace lockfile updated via `npm install`; both packages build + 7 tests each green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (new packages exist; docs deferred to Task 5 stub README only).
    - Docs pages to create/edit: package README stubs pointing to upcoming `docs/caveman.md` / `docs/ponytail.md`. **Done** — package README stubs.
    - `docs/index.md` update: no until Task 5.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 2 — Caveman skills, commands, mode, prompts, config
  - Acceptance Criteria:
    - Functional: registers `caveman` + companion skills (`caveman-commit`, `caveman-review`, `caveman-stats`, `caveman-compress`, `caveman-help`, `cavecrew`) with `instructions` === upstream SKILL.md bodies (via `parseSkillFile`) and matching `toolNames`.
    - Functional: registers `/caveman`, `/caveman-commit`, `/caveman-review`, `/caveman-stats`, `/caveman-compress`, `/caveman-init`; `/caveman [lite|full|ultra|wenyan|wenyan-lite|wenyan-ultra|micro|off]` sets level; config/stats/compress dispatch upstream skill behavior through command handlers.
    - Functional: level restores from session custom `caveman-level` or host default; persists on change via `appendEntry`; injects active level prompt fragment from upstream (not reimplemented); `normal mode` / `stop caveman` deactivate injection without erasing history.
    - Functional: no TUI status bar; optional status exposed as extension event/metadata when `showStatus` semantics apply for hosts.
    - Performance: injection uses upstream constant/fragment lookup O(1); no background workers.
    - Code Quality: zero duplicated prompt/rule strings in package source; load from upstream files/modules only.
    - Security: config read/write size-limited, host-owned path only; injected text bounded; custom entry payload minimal (`{ level }`).
  - Approach:
    - Documentation Reviewed:
      - Task 0 freeze; pi-caveman `extensions/caveman.ts` command/level UX; juliusbrussee/caveman skills/hooks/rules; `docs/extensions.md`, `parseSkillFile`.
    - Options Considered:
      - Copy pi-caveman embedded prompts: reject (not upstream source of truth).
      - Load juliusbrussee/caveman resources + map hooks to Prism: chosen.
    - Chosen Approach:
      - `skills.ts`: discover/load upstream skill dirs.
      - `commands.ts`: Prism `CommandDefinition`s.
      - `mode.ts` + `prompts.ts`: level state + upstream fragment.
      - `config.ts`: bounded default level / showStatus file under host path.
      - `extension.ts`: register all; wire injector + input middleware + session callbacks.
    - API Notes and Examples:
      ```ts
      // /caveman ultra → append custom { customType: "caveman-level", data: { level: "ultra" } }
      // InstructionInjector returns upstream ultra fragment when level !== "off"
      ```
    - Files to Create/Edit:
      - `packages/prism-caveman/src/{skills,commands,mode,prompts,config,extension}.ts` + tests.
    - References:
      - Roadmap Functional (Caveman) AC; pi-caveman LEVELS list.
  - Test Cases to Write:
    - Skill bodies equal upstream files (fixture tree). **Done** — `caveman.test.ts` against `fixtures/upstream-full`.
    - Level set/persist/restore/inject ultra fragment. **Done** — command persist + injector ultra slice tests.
    - Deactivation stops injection; history intact. **Done** — `stop caveman` injector test.
    - Alias commands dispatch correct skill names. **Done** — `caveman-commit` dispatch test.
    - Config bounded path + size. **Done** — `readCavemanConfig` / `writeCavemanConfig` cap test.
  - Task 2 complete (2026-07-31):
    - `skills.ts` loads all 7 upstream `SKILL.md` via `parseSkillFile`; `requireCavemanSkills` fail-closed.
    - `commands.ts`: `caveman`, `caveman-init`, `caveman-commit|review|stats|compress` (skill dispatch metadata).
    - `mode.ts`: `caveman-level` custom entry persist/restore; `stop caveman` / `normal mode` deactivation.
    - `prompts.ts`: upstream `skills/caveman/SKILL.md` filtered per level (caveman-activate.js parity); no duplicated prompt strings.
    - `config.ts`: bounded `defaultLevel` / `showStatus` file IO.
    - `extension.ts`: registers skills, commands, `caveman-mode` injector, `input_assembly` middleware, optional `caveman:status` events.
    - 18 package tests green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; deferred full pages to Task 5.
    - Docs pages to create/edit: package README updated; `docs/caveman.md` in Task 5.
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 3 — Ponytail skills, commands, mode, instructions, config
  - Acceptance Criteria:
    - Functional: registers `ponytail` + companions (`ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`, `ponytail-review`) from upstream SKILL.md.
    - Functional: `/ponytail` supports `lite|full|ultra|off`, `status`, `default <mode>`; alias commands `/ponytail-review|audit|gain|debt|help` dispatch matching skills.
    - Functional: maps activate/config/instructions/mode-tracker/subagent behaviors onto Prism lifecycle/middleware/injector; `InstructionInjector` calls upstream `getPonytailInstructions` + `filterSkillBodyForMode`; mode persists `ponytail-mode`; `stop ponytail` / `normal mode` honored.
    - Functional: no TUI/statusline scripts executed; status via events/metadata / command `status` output only.
    - Performance: O(1) mode tracking per turn; instructions from upstream functions; no statusline shell scripts.
    - Code Quality: import upstream hooks modules (createRequire/import from resolved root); no forked instruction strings.
    - Security: same bounds as Caveman; `writeDefaultMode` only to host-configured path.
  - Approach:
    - Documentation Reviewed:
      - Upstream `pi-extension/index.js` (`resolveSessionMode`, `parsePonytailCommand`, `getPonytailInstructions`, `filterSkillBodyForMode`); `hooks/ponytail-*.js`; Task 0 freeze.
    - Options Considered:
      - Re-export pi-extension as Prism extension: reject (pi ExtensionAPI ≠ Prism).
      - Thin adapter calling upstream hook modules: chosen.
    - Chosen Approach:
      - Same file set as Caveman plus `instructions.ts` wrapping upstream getters.
      - Subagent hook: document/host event metadata only unless freeze finds a Prism nested-agent contribution already sufficient — do not invent a second agent runtime.
    - API Notes and Examples:
      ```ts
      import { getPonytailInstructions, filterSkillBodyForMode } from /* resolved upstream hooks */;
      // injector.contribute → getPonytailInstructions(currentMode)
      ```
    - Files to Create/Edit:
      - `packages/prism-ponytail/src/{skills,commands,mode,instructions,config,extension}.ts` + tests.
    - References:
      - Roadmap Functional (Ponytail) AC; installed ponytail pi-extension.
  - Test Cases to Write:
    - Mode set/status/default/persist/restore; lite instructions from upstream.
    - Deactivation; alias command → skill dispatch.
    - Skill bodies match upstream fixture/peer install.
    - No statusline script spawn.
  - Task 3 complete (2026-07-31):
    - `skills.ts` loads all 6 upstream `SKILL.md` via `parseSkillFile`; `requirePonytailSkills` fail-closed.
    - `commands.ts`: `ponytail` (lite|full|ultra|off, status, default), alias commands dispatch skill metadata.
    - `mode.ts`: `ponytail-mode` custom entry persist/restore.
    - `instructions.ts` + `upstream-hooks.ts`: `getPonytailInstructions` / `filterSkillBodyForMode` from upstream hooks (no forked strings).
    - `config.ts`: bounded `defaultMode` / `quietStartup` / `hideStatus` file IO at host `configPath`.
    - `extension.ts`: registers skills, commands, `ponytail-mode` injector, `input_assembly` middleware, `ponytail:status` / `ponytail:loaded` events.
    - 19 package tests green (`fixtures/upstream-full` with `type: commonjs` for hook require parity).
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes; docs in Task 5.
    - Docs pages to create/edit: none yet.
    - `docs/index.md` update: no.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 4 — Progressive disclosure wiring, packed example, host attach story
  - Acceptance Criteria:
    - Functional: example shows `SkillRegistry` of upstream skills, `activeSkills` / selective activate, default progressive catalog, host-registered `createLoadSkillTool({ registry, loaded })`; mode slices still from injector (not eager full SKILL.md every turn).
    - Functional: packed-install (or pack:dry-run + fixture) consumer loads both extensions through public exports only and observes opt-in injection.
    - Functional: demo/example proves import/setup inert until load + attach callbacks supplied.
    - Performance: example runs offline without network.
    - Code Quality: example lives under `examples/` and is wired into demo gate if required by release scripts; no core API duplication.
    - Security: example uses fixture upstream paths; no writes outside temp/host paths.
  - Approach:
    - Documentation Reviewed:
      - `examples/skills-progressive-disclosure.ts`, Phase 3 contracts, Task 0–3 APIs.
    - Options Considered:
      - Force eager disclosure for mode packages: reject (roadmap).
      - Document + example progressive + injector split: chosen.
    - Chosen Approach:
      - Add `examples/caveman-ponytail.ts` (or two small examples) with fixture upstream trees under `packages/*/fixtures/` or `examples/fixtures/`.
      - Document host must register load tool + pass session callbacks.
    - API Notes and Examples:
      ```ts
      const registry = createSkillRegistry([...cavemanSkills, ...ponytailSkills]);
      const loaded = createLoadedSkillSet();
      const tools = [createLoadSkillTool({ registry, loaded })];
      await session.run("…", { activeSkills: ["ponytail", "caveman"], skillsDisclosure: "progressive" });
      ```
    - Files to Create/Edit:
      - `examples/*caveman*ponytail*.ts`, fixtures, possibly `scripts` demo gate list, package test for packed consumer.
    - References:
      - `roadmap.md` Test Cases; plan 003 example pattern.
  - Test Cases to Write:
    - Progressive: first turn catalog-only for registered skills; after load_skill, body present.
    - Injector still adds mode slice while skill body unloaded.
    - Packed consumer import paths resolve.
  - Task 4 complete (2026-07-31):
    - `examples/caveman-ponytail.ts`: kernel load both extensions, `createMemorySessionStore` attach callbacks, progressive catalog, injector slices separate from catalog, `load_skill` for `ponytail-audit`, inert-until-load check.
    - Demo gate: `docs.test.ts` + `examples/README.md`.
    - `packed-consumer.test.ts` in both packages; install-smoke + packaging lists updated.
    - `examples/tsconfig.json` paths for `@arnilo/prism-caveman` / `@arnilo/prism-ponytail`.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes (example is public teaching surface).
    - Docs pages to create/edit: link from Task 5 pages.
    - `docs/index.md` update: via Task 5.
    - Documentation structure reference: prism-wiki.md.

- [x] Task 5 — Docs, migration, version bump, exit gate
  - Acceptance Criteria:
    - Functional: `docs/caveman.md` and `docs/ponytail.md` follow prism-wiki API page structure; `docs/extensions.md`, `docs/context-and-skills.md`, `docs/migration.md`, `docs/index.md` (new Third-party integrations group), package README/CHANGELOG updated; versions **0.0.22**.
    - Functional: release manifests/lockfile/peer ranges consistent; optional profile inclusion only after install-size review (default: **not** in `prism-code`/`prism-sdk` — opt-in packages only, like specialty extensions).
    - Performance: package budget / `sdk:ready` / release check pass; no unexplained tarball growth beyond declared baselines.
    - Code Quality: docs tripwires if present updated; no broken links.
    - Security: docs state untrusted upstream text, fail-closed missing upstream, session ownership for mode entries.
  - Approach:
    - Documentation Reviewed:
      - `.agents/skills/create-plan/references/prism-wiki.md`; existing OM docs page; `docs/release-and-install.md` handoff pattern.
    - Options Considered:
      - Bundle into `prism-all` by default: defer; size review — likely omit from profiles until demanded.
      - Standalone docs pages + index group: chosen.
    - Chosen Approach:
      - Write wiki-structured docs; migration `0.0.21 → 0.0.22`; bump workspace versions; run full exit gate.
    - API Notes and Examples:
      ```ts
      // as in roadmap Phase 5 API Notes
      ```
    - Files to Create/Edit:
      - `docs/caveman.md`, `docs/ponytail.md`, `docs/extensions.md`, `docs/context-and-skills.md`, `docs/index.md`, `docs/migration.md`, `docs/release-and-install.md` (as needed), package README/CHANGELOG, root version surfaces, `roadmap.md` completion evidence when gate passes.
    - References:
      - Roadmap Exit Gate; prism-wiki.md.
  - Test Cases to Write:
    - Docs tests: index links, export names, migration section present.
    - `npm run sdk:ready`; package tests; packed-install fixture; no-core-regression (core test suite unchanged green).
  - Task 5 complete (2026-07-31):
    - `docs/caveman.md`, `docs/ponytail.md` (wiki API structure); `docs/index.md` Third-party integrations group; `docs/extensions.md`, `docs/context-and-skills.md`, `docs/migration.md` (`0.0.21 → 0.0.22`), `docs/release-and-install.md` (46 manifests, 0.0.22 handoff).
    - Workspace **0.0.22** bump (46 packages + lockfile + `version` export); package README/CHANGELOG updates; `release.test.ts` graph 46; docs tripwire `phase5_third_party_behavior_docs_cover_caveman_ponytail_migration_and_example`.
    - Caveman/Ponytail **not** in `prism-code`/`prism-sdk`/`prism-all` profiles (opt-in only).
    - `npm run sdk:ready` green.
  - Documentation/Wiki Assessment:
    - Public API or behavior impacted: yes.
    - Docs pages to create/edit:
      - `docs/caveman.md`: new API page for `@arnilo/prism-caveman`.
      - `docs/ponytail.md`: new API page for `@arnilo/prism-ponytail`.
      - `docs/extensions.md`: link optional third-party extensions.
      - `docs/context-and-skills.md`: progressive disclosure + these packages.
      - `docs/migration.md`: 0.0.21 → 0.0.22.
      - Package README/CHANGELOG: install + inert-until-load.
    - `docs/index.md` update: yes — Third-party integrations group with Caveman + Ponytail entries; cross-link from Extensions/plugins and Context and skills.
    - Documentation structure reference: `.agents/skills/create-plan/references/prism-wiki.md`.

## Compromises Made

- Task 1: duplicated small `upstream.ts` per package (no shared internal package) — matches freeze; extract only if a third behavior package appears.
- Task 2: `caveman-stats` command dispatches skill metadata only (no Claude session-log hook); full stats need host session integration in Task 4 example.
- Task 2: `caveman-init` returns upstream guidance text; does not run `caveman-init.js` (host-owned repo writes).
- Task 3: `ponytail-subagent` hook not wired (host metadata only per freeze); no statusline shell scripts.

## Further Actions

- Tag/publish `@arnilo/prism@0.0.22` via `docs/release-and-install.md` 0.0.22 publish handoff when operator ready.
