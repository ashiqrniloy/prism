# Reference host — Prism Agent

Prism Agent (`apps/prism-agent`, package `@arnilo/prism-agent`) is the private reference host. It proves that a realistic headless, multi-agent host can be built from the public SDK and published packages alone, and it finds SDK gaps before the 0.13.0 freeze. It is not an API and is never published. Prism Code (`packages/prism-code`), the old TUI lab, was deleted by plan 173.

## Target

- [roadmap.md](../../../../roadmap.md) §2.13 (hosts own the agent; §2.13.1 where things go, §2.13.3 the reference host), Phase 12.
- **The host only decides; it never assembles around the SDK.** It chooses which agents exist, their package sets, the workflow and its gates, `HostUi` routing, vendor adapters, and deployment. Behavior any host could want belongs in a package or the kernel.
- **Public surface only.** The host imports `@arnilo/prism`, its public subpaths, and published packages. `reference_host_imports_only_public_surface` (`src/__tests__/reference-host-boundary.test.ts:94`) fails closed on anything else, including retired 0.12 names.
- **The gap log.** A seam the host needs and the SDK lacks is never worked around: fix it in the SDK in the task that found it, or record it in the Phase 12 plan's `## Gap log`. No type-erasing `any` cast, no reach into package internals, no reimplemented package logic.

## Today

- Agents, one `createAgent` call each, in `apps/prism-agent/src/host/`: `orchestrator.ts` (`workflows` + `delegate`), `coding.ts` (`tools-coding`, `approval`, `context-files`, `hooks-json`, memory), `research.ts` (`tools-web`, `tools-browser`, `memory-rag`, `tools-research`), `external.ts` (a host adapter over `driver-process`), `remote.ts` (`connectAgent`). Shared wiring: `config.ts`, `store.ts` (`store-sqlite`), `host-ui.ts` (`HostUi` routing), `workflow.ts`, `schedule.ts`, `start.ts`.
- CLI: `bin/prism-agent.ts` dispatches `run`, `resume`, `acp`, `schedule` (`apps/prism-agent/src/cli/*`). `run` writes the kernel's own `AgentEvent` JSONL and exits with the documented codes (0 completed, 1 failed, 2 usage/config, 3 suspended, 4 research verdict failed).
- Vendor adapter: `apps/prism-agent/src/adapters/stream-cli.ts` (the Claude-Code-shaped dialect used by the external-worker scenario).
- Scenarios: `apps/prism-agent/src/scenarios/*.ts` — orchestrated workflow, approval gates, external and remote worker attribution, remote approval through the local `HostUi`, headless approval across processes, scheduled run across two processes, one-shot JSONL golden, research citations, browser unavailable. All deterministic on the mock provider and scripted CLIs.
- Docs: [apps/prism-agent/README.md](../../../../apps/prism-agent/README.md) (linked from `docs/index.md`). The deleted lab's last page is archived at [prism-code-0.12.md](../../../../docs/history/prism-code-0.12.md).

## Graft queries

- `graft ask "reference host coding agent createAgent packages approval" --source --in apps/prism-agent/`
- `graft ask "host ui routing remote approval" --source --in apps/prism-agent/`
- `graft callers startAgent --depth 2` (every entry point that builds an agent; `createCodingWorker`, `createOrchestrator`, `createResearchWorker` are the per-agent factories)

## Tests

- `bun run --filter @arnilo/prism-agent test` (from the repo root) runs `apps/prism-agent/src/__tests__/` — `smoke`, `golden`, `approval`, `headless-approval`, `workflow`, `external`, `remote`, `research`, `schedule`, `acp`, `cli`, `secrets`.
- The same leg runs inside `bun run release:gate`, right after the client-neutrality check.
- `src/__tests__/reference-host-boundary.test.ts` (public-surface boundary).

## Rules

- **Never add agent assembly or package logic to the host.** If a scenario needs a behavior the SDK lacks, add it to the SDK (with its test) or log the gap.
- **No skipped or networked scenarios.** The suite asserts it has no `test.skip` and reads no secret environment variable; a missing fixture fails, never skips.
- **Credential values stay refs** in `prism-agent.json`; the CLI accepts no literal secret.
- **The host renders nothing.** It has no TUI and depends on no terminal UI library; `acp` hands interaction to an ACP-capable editor.
- **A coding run that edits a file under approval** is the regression that matters: keep the approval scenario green in every task that touches tools, approval, or the loop.
