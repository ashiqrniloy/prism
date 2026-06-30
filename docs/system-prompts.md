# System prompts

## What it does

Layered system prompts let hosts compose caller-supplied prompt contributions before the default input builder turns them into system messages.

Public helpers:

- `composeSystemPrompt(contributions, { base })`
- `mergeSystemPromptConfig(config, override)`
- `SystemPromptContribution`, `SystemPromptMode`, `SystemPromptSource`, `SystemPromptConfig`

`AgentConfig.instructions` stays the simple base prompt path. `AgentConfig.systemPrompt` and `RunOptions.systemPrompt` add explicit layers on top.

## When to use it

Use this API when an app wants deterministic package/app/user/run prompt layers without filesystem discovery or package loading.

Do not use it for prompt template expansion, resource loading, settings discovery, credential lookup, provider calls, or hidden global prompts.

## Inputs / request

```ts
composeSystemPrompt([
  { id: "pkg", source: "package", mode: "append", text: "Package rule." },
  { id: "app", source: "app", mode: "replace", text: "App rule." },
  { id: "run", source: "run", mode: "append", text: "Run rule." },
], { base: "Base instruction." });
```

Known `source` order is deterministic: `user`, `package`, `app`, then `run`. Unknown custom sources sort between `package` and `app`. Multiple unknown sources keep their relative input order. Unknown sources intentionally rank below host/app and run layers, so a custom `replace` or `disable` cannot override `RunOptions.systemPrompt` by sorting after it.

> **Behavior change (Phase 31):** `source: "user"` is now the global base layer (rank 0), not a high-priority caller override. Without unknown custom sources, the file/host layering arrow remains `SYSTEM.md` (user) → package → `AGENTS.md` (app) → host `AgentConfig.systemPrompt` → `RunOptions.systemPrompt` (run). With unknown custom sources, the full layering arrow is `SYSTEM.md` (user) → package → unknown custom sources → `AGENTS.md` (app) → host `AgentConfig.systemPrompt` → `RunOptions.systemPrompt` (run). Earlier phases ranked `user` above `package`/`app`; Phase 37 moved unknown custom sources below app/run after discovering they could otherwise sort after `run` and override run-level prompt policy. `RunOptions.systemPrompt: false` still disables every configured layer for the run and keeps `AgentConfig.instructions` as the base prompt.

`mode` behavior:

| Mode | Behavior |
| --- | --- |
| `append` or omitted | Add text after earlier prompt text. |
| `prepend` | Add text before current prompt text. |
| `replace` | Clear earlier prompt text and use this text. |
| `disable` | Clear earlier prompt text and add no text. Later layers may still add text. |

`RunOptions.systemPrompt: false` disables configured prompt layers for that run while keeping `AgentConfig.instructions` as the base prompt.

## Outputs / response / events

`composeSystemPrompt()` returns the composed prompt string or `undefined` when no prompt text remains. The agent/session runtime passes that string to `assembleProviderInput()` as `systemInstructions`; it does not emit a separate event or store prompt layers.

## Request/response example

```json
{
  "base": "Base",
  "layers": [
    { "id": "app", "source": "app", "mode": "replace", "text": "App" },
    { "id": "run", "source": "run", "mode": "append", "text": "Run" }
  ],
  "composed": "App\n\nRun"
}
```

## Implementation example

```ts
import { composeSystemPrompt, createAgent } from "@arnilo/prism";

const prompt = composeSystemPrompt([
  { id: "app", source: "app", mode: "replace", text: "You are concise." },
  { id: "user", source: "user", mode: "append", text: "Prefer bullet points." },
], { base: "Base instruction." });

const agent = createAgent({
  model,
  provider,
  instructions: "Base instruction.",
  systemPrompt: { id: "app", source: "app", mode: "append", text: "Use safe JSON." },
});

await agent.createSession().run("Hi", {
  systemPrompt: { id: "run", source: "run", mode: "append", text: "Answer briefly." },
});
```

## Extension and configuration notes

Extensions and provider packages can register `SystemPromptContribution` values, but registration is inert. Hosts must select contributions and pass them to `AgentConfig.systemPrompt` or `RunOptions.systemPrompt`.

Manifests can declare `systemPromptContribution` kinds as data-only references:

```ts
import { definePrismManifest } from "@arnilo/prism";

export default definePrismManifest({
  name: "demo-prompts",
  contributions: [
    { kind: "systemPromptContribution", name: "demo.prompt", metadata: { id: "demo-prompt", source: "package", mode: "append" } },
  ],
});
```

The manifest entry does not load or apply the prompt. The host must still select it and pass the `SystemPromptContribution` to the runtime.

No `APPEND_SYSTEM.md`, prompt template, settings, or manifest discovery happens in core. `SYSTEM.md` / `AGENTS.md` walk-up loading is a Node/CLI concern — see [AGENTS.md and SYSTEM.md files](#agentsmd-and-systemmd-files) below.

## Security and performance notes

- Composition is a single in-memory pass plus deterministic ordering; no dependency, watcher, filesystem read, provider call, or tokenizer is added.
- Prompt text is caller-supplied content. Do not put secrets in prompts, settings, manifests, session entries, package metadata, or docs examples.
- Unknown custom sources rank before app/run layers; prefer `source: "package"` for package defaults and `source: "run"` only for host-selected run overrides.
- `replace`/`disable` make prompt policy explicit; they are not permission or sandbox controls.

## AGENTS.md and SYSTEM.md files

### What it does

The Node loader `loadSystemPromptFiles` reads two standard prompt files and returns them as `SystemPromptContribution` layers that feed `composeSystemPrompt` — the same pipeline as explicit `AgentConfig.systemPrompt` layers. There is no parallel mechanism and no hidden global: the loader is a sibling of `src/node/instruction-injectors.ts`, opt-in by passing roots.

- `SYSTEM.md` at `<globalRoot>/.prism/agent/SYSTEM.md` — the user-owned global prompt, tagged `source: "user"` (the Phase 31 base layer). No trust gate; its presence is the user's explicit choice.
- `AGENTS.md` at `<workspaceRoot>/AGENTS.md` — the project prompt, tagged `source: "app"`. Trust-gated via `createPathTrustPolicy`; an untrusted workspace contributes nothing (fail-closed, silent skip).

The `prism` CLI auto-loads both in print/json modes (see [CLI/RPC](cli-rpc.md)); RPC mode does **not** auto-read them (the host owns the session factory).

### When to use it

Use `loadSystemPromptFiles` when a Node host or the CLI wants to honor the standard `AGENTS.md` / `SYSTEM.md` layout without wiring prompt text by hand. Hosts pass `workspaceRoot` (defaults to `process.cwd()` on the CLI) and `globalRoot` (host-controlled; the CLI no longer defaults it to the user's home directory — pass it explicitly from a host adapter or use `--system-md-file`).

Do not use it to load arbitrary prompt templates, settings, or manifests — it reads exactly two filenames and nothing else. Do not use it from the SDK entrypoint (`@arnilo/prism`) — it lives in the Node subpath `@arnilo/prism/node/system-prompts` and performs real filesystem I/O.

### Inputs / request

`loadSystemPromptFiles(options)`:

| Field | Meaning |
| --- | --- |
| `workspaceRoot?` | Reads `<workspaceRoot>/AGENTS.md` (trust-gated, `source: "app"`). |
| `globalRoot?` | Reads `<globalRoot>/.prism/agent/SYSTEM.md` (user-owned, `source: "user"`). |
| `agentsMdPath?` | Override the AGENTS.md path (still `source: "app"`, still trust-gated). |
| `systemMdPath?` | Override the SYSTEM.md path (still `source: "user"`, no trust gate). |
| `trust?` | `TrustPolicy` (e.g. `createPathTrustPolicy`) fail-closed against the workspace. |
| `permission?` | `PermissionPolicy` asserting each read (`assertPermission`). |

Passing no roots returns `[]` and performs no filesystem I/O — the SDK escape hatch. `AgentConfig.instructions` / `AgentConfig.systemPrompt` keep working unchanged.

CLI flags:

| Flag | Meaning |
| --- | --- |
| `--no-agents-md` | Skip auto-loading `<workspaceRoot>/AGENTS.md`. |
| `--no-system-md` | Skip auto-loading the global `SYSTEM.md` layer. The CLI does not default to the user's home directory; pass `globalRoot` from a host adapter or use `--system-md-file` to opt in. |
| `--agents-md-file <path>` | Read AGENTS.md from `<path>` instead (trust-gated, `source: "app"`). |
| `--system-md-file <path>` | Read SYSTEM.md from `<path>` instead (user-owned, `source: "user"`). |

`--system <text>` stays as `AgentConfig.instructions` (the base prompt) and is composed below the file layers. `RunOptions.systemPrompt` is not surfaced as a CLI flag (the `--system` base + the two file layers cover the CLI surface).

### Outputs / response / events

`loadSystemPromptFiles()` returns `readonly SystemPromptContribution[]` — `SYSTEM.md` first (`source: "user"`), then `AGENTS.md` (`source: "app"`). Input order here only matters for the stable tie-break when sources collide; rank order (`user` → `package` → `app` → `run`) is enforced inside `composeSystemPrompt`. The CLI passes a non-empty result as `AgentConfig.systemPrompt`; the runtime composes it with `instructions` (base) and emits no separate event.

### Request/response example

```json
{
  "base": "You are helpful.",
  "layers": [
    { "id": "system-md", "source": "user", "mode": "append", "text": "Global system policy." },
    { "id": "agents-md", "source": "app", "mode": "append", "text": "Project rule." }
  ],
  "composed": "You are helpful.\n\nGlobal system policy.\n\nProject rule."
}
```

### Implementation example

```ts
import { composeSystemPrompt } from "@arnilo/prism";
import { loadSystemPromptFiles } from "@arnilo/prism/node/system-prompts";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";

// Trust gate mirrors discoverContributions — untrusted AGENTS.md is skipped silently.
const trust = createPathTrustPolicy({ trustedRoots: [workspaceRoot] });
const layers = await loadSystemPromptFiles({ workspaceRoot, globalRoot, trust });
const composed = composeSystemPrompt(layers, { base: "You are helpful." });
```

A complete runnable example lives at `examples/system-project-prompts.ts`.

### Agent bundle prompt layers (Phase 34)

`resolveAgentBundle()` (from `@arnilo/prism/node/agent-definitions`) appends up to three prompt sources for a discovered agent bundle, in this fixed order, all reusing `composeSystemPrompt`'s `source` rank (`user` → `package` → `app` → `run`):

1. `<configRoot>/agents/SYSTEM.md` — app-global prompt, `source: "user"`.
2. `<configRoot>/agents/<agentName>/AGENT.md` — the per-agent bundle's markdown body (below the front fence), `source: "package"`.
3. `<workspaceRoot>/AGENTS.md` — the repo-level project prompt, `source: "app"`.

Each layer is independently toggled via `ResolveAgentBundleOptions.include` (`systemPrompt`, `agentPrompt`, `repoPrompt`); all default to `true`. The app-config root and workspace root are trust-gated **independently** — an untrusted root contributes nothing (fail-closed, no throw). `RunOptions.systemPrompt` (`source: "run"`) still wins and is appended last at run time. Missing files are skipped silently.

### Extension and configuration notes

The loader reads text only with two `readFile` calls max — no `readdir`, no scan, no `import()`. It does not fit `discoverContributions`' named-subdir scanner (these are root-level single files), so it is a sibling adapter over the shared `readOptionalFile` helper rather than another scanner kind. Override paths (`agentsMdPath` / `systemMdPath`) reuse the same trust gate, so a `--agents-md-file` opt-in still fails closed outside trusted roots.

### Security and performance notes

- **Trust gating**: `AGENTS.md` (and `--agents-md-file`) pass through `createPathTrustPolicy` + `isPathInsideReal`, which resolve symlinks and fail closed. Untrusted workspaces contribute nothing — the run still works with base instructions. `SYSTEM.md` (whether from a host-supplied `globalRoot` or an explicit `--system-md-file`) is user-owned and is not trust-gated.
- **No code execution**: the loader never `import()`s or `eval()`s a discovered file — it reads prompt text only.
- **Redaction**: loaded prompt text is caller/host-supplied content subject to `redactProviderRequest` like any system instruction. Do not put secrets in `AGENTS.md` / `SYSTEM.md`, settings, manifests, or docs examples.
- **Performance**: two `readFile` calls per CLI print/json run; missing files are ENOENT-skipped. Default SDK use (no roots) performs no I/O. RPC mode does not auto-read these files.

## Related APIs

- [Input and prompt assembly](input-and-prompt-assembly.md): default input builder receives the composed system instruction string.
- [Agent/session runtime](agent-session-runtime.md): runtime fields `AgentConfig.systemPrompt` and `RunOptions.systemPrompt`.
- [Contribution discovery (workspace)](contribution-discovery.md): the scanner for `.agents/<kind>/<name>/` contributions; `AGENTS.md`/`SYSTEM.md` loading is a sibling loader, not a scanner kind.
- [Contribution registries](contribution-registries.md): inert system prompt contribution registry.
- [Extensions](extensions.md): `registerSystemPromptContribution()`.
- [CLI/RPC](cli-rpc.md): the `--no-agents-md` / `--no-system-md` / `--agents-md-file` / `--system-md-file` flags, and the `--agents-config <path>` app-config bundle flag.
- [Agent definitions](agent-definitions.md): `resolveAgentBundle` appends `SYSTEM.md` → `AGENT.md` body → repo `AGENTS.md` as a three-layer prompt model on top of this loader.
- [Public contracts](public-contracts.md): exported prompt contribution contracts.
