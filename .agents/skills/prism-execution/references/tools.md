# Tools — registry, skills, commands, tool packages, approval, context files

The kernel tools, skills, and commands registries, plus the tool packages: `tools-coding`, `tools-web`, `tools-browser`, `tools-work`, `tools-computer-use`, and `tools-openapi`. Also covers `approval` and `context-files`.

## Target

- [roadmap.md](../../../../roadmap.md) §2.1 (Tools, Skills, Commands rows), §2.6 (Tools and Commands), §2.9 (tool, `approval`, `context-files` rows). The kernel parts land in Phases 1–3; the packages in Phase 7.
- **Kernel `ToolDefinition`:** `name`, `description`, `parameters` (JSON Schema, validated), `effects` (`read | write | execute | network | external`), and `execute(args, ctx)`. The context carries the session, signal, `host.ui`, and `progress()`.
- **Tool rules:**
  - A name collision fails closed.
  - `when` controls per-session visibility.
  - `disable.tools` removes a tool by name.
- **Skills (kernel):**
  - `SKILL.md` directory discovery
  - progressive disclosure: a catalog in `context.build` plus the `load_skill` tool
  - eager disclosure: full bodies
- **Approval (`@arnilo/prism-extensions/approval`):**
  - provides the `deny | ask | edits | auto` modes over `effects` and roots, as a `tool.call` gate
  - `ask` resolves through `host.ui` confirm, or suspends the run
  - hard denies always stay on
- **Package boundary:** tool packages carry their own hard denies (for example root escapes) through `tool.call`, but do not reimplement approval.
- **`tools-web` with no key or binary:** registers nothing, emits a status note, and provides `web.fetch` when it is configured.
- **Heavy dependencies stay isolated:** installing `tools-coding` never loads Playwright or the Office parsers.

## Today

- Kernel: `src/tools.ts` (`createToolRegistry`, schema validation), `src/agent-tool-dispatch.ts` and `src/loop/dispatch.ts` (dispatch through `RunController.executeTools`), `src/tool-effects.ts` (declared `effects`), `src/registry-options.ts`; skills in `src/skills.ts`, `src/skill-load.ts` (`load_skill`), `src/skill-disclosure.ts`, `src/skills-catalog.ts`.
- Tool packages (`packages/tools/*`): `coding` (file, search, shell, git, checks, todo, `ask_user_decision`, sandboxes, the `workspace` service, the `coding.targets` service, `tool.call` hard denies), `web` (Brave, Exa, Firecrawl, Obscura; provides `web.fetch`), `browser`, `work` (documents, sheets, diagrams, document reader, connectors, bundled skills), `computer-use`, `openapi`, `research` (citation ledger, `cite`, `run.end` check).
- Policy and instructions: `@arnilo/prism-extensions/approval` (`packages/extensions/approval`) owns prompting over `effects`; `@arnilo/prism-extensions/context-files` (`packages/extensions/context-files`) owns `AGENTS.md`/`SYSTEM.md` layers.
- In flight: plans 189 (coding tools) and 190 (skills) on the release path change tool names, schemas, and the skill load path; read them before touching these areas.
- Current docs: [tools.md](../../../../docs/tools.md), [agent.md](../../../../docs/agent.md) (skills), [coding-security.md](../../../../docs/coding-security.md), [resource-loading.md](../../../../docs/resource-loading.md); [`coding`](../../../../packages/tools/coding/README.md), [`web`](../../../../packages/tools/web/README.md), [`browser`](../../../../packages/tools/browser/README.md), [`work`](../../../../packages/tools/work/README.md), [`computer-use`](../../../../packages/tools/computer-use/README.md), [`openapi`](../../../../packages/tools/openapi/README.md), [`research`](../../../../packages/tools/research/README.md), [`approval`](../../../../packages/extensions/approval/README.md), [`files`](../../../../packages/extensions/context-files/README.md).

## Graft queries

- `graft ask "tool.call hard deny coding targets roots" --source`
- `graft ask "sandbox backend shell spawn native docker e2b" --source --in packages/tools/coding/`
- `graft ask "load_skill progressive disclosure catalog" --source`
- `graft callers createToolRegistry --depth 2`

## Tests

- Kernel: `src/__tests__/tools.test.ts`, `tool-effects.test.ts`, `tool-effects-annotation.test.ts`, `tool-narrowing.test.ts`, `tool-result-content.test.ts`, `skills.test.ts`, `skill-load.test.ts`, `skill-disclosure.test.ts`
- Packages: `packages/tools/<name>/src/__tests__/`, `packages/extensions/approval/src/__tests__/`, `packages/extensions/context-files/src/__tests__/` (run from each package directory)
- Published conformance: `@arnilo/prism/testing/tool-conformance` (including `assertGateIntegrity`) and `tool-effect-store-conformance`

## Rules

- Never follow symlinks in delete or glob. Never bypass read-before-write gates. Never let limits stand in for sandboxing.
- Text layers (instruction files, skills, `context.build` injections) add text only. They never grant tools or permissions.
- Money paths in sheets use exact decimal strings, never floats. The document reader extracts literal text only and never fetches or executes embedded content.
- Device and computer-use admission stays deny-by-default: consent, sandbox, approval, and bounds, or it fails closed.
- `ask_user` goes through `host.ui` (`select` or `input`). With no UI, it returns guidance and never fabricates an answer.
