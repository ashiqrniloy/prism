# Tools — registry, coding tools, sandbox, process, forge, policy

Tool registration and dispatch, coding toolset, sandboxing, process sessions,
forge, tool effects, extension/contribution registries.

## Docs (current contracts)

- [tools.md](../../../../docs/tools.md): registration, allow/deny filtering, bounded artifact-loop dispatch, progressive loading.
- [coding-agent-tools.md](../../../../docs/coding-agent-tools.md): shell/read/write/edit/search toolset, caps, Git awareness.
- [tool-effects.md](../../../../docs/tool-effects.md): effect declarations, claim/CAS store, reconciliation.
- [tool-execution-primitives.md](../../../../docs/tool-execution-primitives.md): bounded schema validation, parallel dispatch.
- [coding-security.md](../../../../docs/coding-security.md): approval, workspace modes, Docker/native sandboxes, egress policy.
- [process-sessions.md](../../../../docs/process-sessions.md): process registry, durable recovery, ownership fencing.
- [forge-integration.md](../../../../docs/forge-integration.md): GitHub adapter, effect-recorded mutations.
- [extensions.md](../../../../docs/extensions.md): extension kernel, registries, lifecycle events.

## Graft queries

- `graft ask "tool dispatch blocked reason matrix" --source`
- `graft ask "ExecutionPolicy spawn gate" --source`
- `graft callers assertToolDispatchConforms`

## Tests

- `src/__tests__/tools.test.ts`, `tool-effects.test.ts`, `execution-policy.test.ts`, `tool-search.test.ts`
- `packages/prism-coding-tools/src/**/__tests__/`
- `src/__tests__/contributions*.test.ts`, `extensions.test.ts`, `middleware.test.ts`

## Don't do

- Don't grant instructions/tools/permissions from injectors — they layer text only.
- Don't follow symlinks in delete/glob; don't bypass read-before-write gates.
- Limits never sandbox host access — gate with permission/trust policy plus `/security`.

Adjacent: `openapi-tools.md`, `language-intelligence.md` (LSP), `contribution-discovery.md`/`contribution-registries.md` (extension loading), `configuration-and-manifests.md`.
