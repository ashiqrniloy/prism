# prism examples

Compile-checked typed examples and runnable end-to-end mock demos. No network,
no real credentials — every demo uses the built-in `mock` provider or a fake key.

## Typecheck

Examples are part of `npm run typecheck` (separate `examples/tsconfig.json`,
`noEmit`, strict). They typecheck against package source, so no workspace
build is required to typecheck.

## Run a demo by hand

Node 24 strips TypeScript types natively, so after building the core package
once (`npm run build:core`) you can run any demo directly:

```bash
npm run build:core
node examples/compaction.ts
node examples/cli.ts
node examples/rpc.ts
node examples/provider-registration.ts
node examples/provider-resolver.ts
node examples/observational-memory-recall-status-view.ts
```

Each demo prints a single JSON line with its result.

## Files

- `sdk-basics.ts` — createAgent / createAgentSession / mock provider.
- `provider-registration.ts` — **demo**: register a provider package via the
  extension kernel; resolve providers/models from host-owned registries.
- `provider-resolver.ts` — **demo**: resolve an agent's provider from a mix of
  first-party package providers and a third-party own provider via `providerSource`.
- `api-key-auth.ts` — env + memory credential resolvers in host-defined order.
- `oauth-login.ts` — PKCE OAuth login against a token endpoint (fake host).
- `openrouter-model-cache-override.ts` — per-model routing/cache overrides.
- `tools.ts` — host-owned tool registry: allow/deny filter + dispatch.
- `context.ts` — ordered context-provider pipeline.
- `skills.ts` — skill registry + progressive disclosure activation.
- `extensions.ts` — extension kernel + event bus.
- `manifests.ts` — data-only Prism manifest: define + parse.
- `config-settings.ts` — layered config merge + settings providers.
- `system-prompts.ts` — layered system-prompt composition; disabling layers.
- `system-project-prompts.ts` — **demo**: auto-load `AGENTS.md`/`SYSTEM.md` via
  `loadSystemPromptFiles` (trust-gated) and prove the composed prompt reaches the provider.
- `jsonl-stores-branching.ts` — in-memory store + branching; JSONL persistence.
- `compaction.ts` — **demo**: LLM compaction with a mock summarizer provider.
- `observational-memory-recall-status-view.ts` — **demo**: recall tool +
  status/view commands; recall fails closed on invalid ids.
- `synapta-style-artifact-loop.ts` — **demo**: third-party host mixing first-party
  and own providers/tools/skills, `AGENTS.md`/`SYSTEM.md` system prompts, and the
  `generate-validate-revise` artifact loop with host-owned schema validation.
- `cli.ts` — **demo**: spawn the `prism` bin in print and json modes.
- `rpc.ts` — **demo**: drive the `prism` bin in rpc mode with a JSONL request.
- `tsconfig.json` — typecheck-only config.

**demo** = the file has a runnable `main()`; the others are compile-checked
illustrations only.
