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
- **Approval (`@arnilo/prism-approval`):**
  - provides the `deny | ask | edits | auto` modes over `effects` and roots, as a `tool.call` gate
  - `ask` resolves through `host.ui` confirm, or suspends the run
  - hard denies always stay on
- **Package boundary:** tool packages carry their own hard denies (for example root escapes) through `tool.call`, but do not reimplement approval.
- **`tools-web` with no key or binary:** registers nothing, emits a status note, and provides `web.fetch` when it is configured.
- **Heavy dependencies stay isolated:** installing `tools-coding` never loads Playwright or the Office parsers.

## Today (0.12 code being replaced)

- Kernel parts:
  - `src/tools.ts` (registry and validation)
  - `src/agent-tool-dispatch.ts`, `src/agent-session/session/tool-round.ts`
  - `src/tool-effects.ts`, `src/execution-policy.ts`, `src/security.ts` (`PermissionPolicy`)
  - `src/skills.ts`, `src/skill-load.ts`, `src/skill-disclosure.ts`
  - `src/registry-options.ts` (duplicate default is `"replace"`)
- Packages:
  - `packages/prism-coding-tools/src/{agent,security,openapi,computer-use-linux,dev,impeccable}`
  - `packages/web-tools/src/{brave.ts,exa.ts,firecrawl.ts,obscura,browser}`
  - `packages/prism-work/src/{connectors,documents,sheets,diagrams,document-reader,document-extraction,tools,skills}`
- Instruction files: `src/node/instruction-injectors.ts`, `src/node/system-project-prompts.ts`, `packages/agent-sdk/src/planes/instructions.ts`.
- Lab code being deleted: `packages/prism-code/src/{approval.ts,tools.ts,tool-modules.ts,web.ts,prompt.ts,skills.ts}`.
- Current docs (released contract): [tools.md](../../../../docs/tools.md), [coding-agent-tools.md](../../../../docs/coding-agent-tools.md), [coding-security.md](../../../../docs/coding-security.md), [tool-effects.md](../../../../docs/tool-effects.md), [tool-execution-primitives.md](../../../../docs/tool-execution-primitives.md), [context-and-skills.md](../../../../docs/context-and-skills.md), [web-tools.md](../../../../docs/web-tools.md), [browser-automation.md](../../../../docs/browser-automation.md), [work-tools.md](../../../../docs/work-tools.md), [documents.md](../../../../docs/documents.md), [sheets.md](../../../../docs/sheets.md), [computer-use-linux.md](../../../../docs/computer-use-linux.md), [openapi-tools.md](../../../../docs/openapi-tools.md), [system-prompts.md](../../../../docs/system-prompts.md).

## Graft queries

- `graft ask "tool dispatch blocked reason permission" --source`
- `graft ask "ExecutionPolicy spawn gate sandbox root" --source`
- `graft ask "load_skill progressive disclosure catalog" --source`
- `graft callers createToolRegistry --depth 2`

## Tests

- `src/__tests__/tools.test.ts`, `tool-effects.test.ts`, `execution-policy.test.ts`, `skills*.test.ts`, `tool-search.test.ts`
- `packages/prism-coding-tools/src/**/__tests__/`, `packages/web-tools/src/**/__tests__/`, `packages/prism-work` suites (run from each workspace directory)
- Target suite: tool conformance (`@arnilo/prism/testing/tool-conformance`)

## Rules

- Never follow symlinks in delete or glob. Never bypass read-before-write gates. Never let limits stand in for sandboxing.
- Text layers (instruction files, skills, `context.build` injections) add text only. They never grant tools or permissions.
- Money paths in sheets use exact decimal strings, never floats. The document reader extracts literal text only and never fetches or executes embedded content.
- Device and computer-use admission stays deny-by-default: consent, sandbox, approval, and bounds, or it fails closed.
- `ask_user` goes through `host.ui` (`select` or `input`). With no UI, it returns guidance and never fabricates an answer.
