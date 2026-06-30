# Agent definitions

## What it does

An agent definition declares what an agent needs — model, tools, skills, context, system prompt, instructions, loop — without owning how those are loaded or executed. Two helpers turn a definition into a runnable `Agent`:

- `resolveAgentDefinition(def, context)` (re-exported from `@arnilo/prism`): resolves a declarative `AgentDefinition` against the registries the host passes in. Missing dependencies fail closed before any provider turn.
- `resolveAgentBundle(bundle, options)` (Node subpath `@arnilo/prism/node/agent-definitions`): turns a discovered app-config agent bundle envelope into an `Agent` by building union skill/tool registries across three scopes, appending up to three prompt layers, and delegating to `resolveAgentDefinition`.

A third helper, `discoverAgentBundles(options)` (same Node subpath), scans an app-controlled `configRoot` for agent bundle envelopes without parsing or importing any file content; resolution happens later in `resolveAgentBundle`.

`AgentDefinition` is the same shape registered programmatically via `ExtensionAPI.registerAgent()` (see [Extensions](extensions.md)) — a definition is data, registration is inert, activation is run-owned.

## When to use it

Use `resolveAgentDefinition` when an app already holds a `AgentDefinition` (from an extension, a manifest, or hand-written config) and wants to turn it into an `Agent` against its registries — without wiring every field by hand.

Use `discoverAgentBundles` + `resolveAgentBundle` when a host app keeps per-agent bundles on disk under an app-controlled config root (for example `.clay/extensions/prism/agents/<agentName>/AGENT.md`) and wants to honor them as first-class agents. The bundle layout is host-owned: Prism never picks the config root, never touches the user's home directory, and never auto-runs resolution — the host calls `discoverAgentBundles` and then `resolveAgentBundle` explicitly.

Do not use the bundle loader to discover providers — provider/model packages stay config/package-driven (Phase 24; see [Provider packages](provider-packages.md)). Do not use it to auto-activate tools or skills: the bundle declares names, activation is run-owned (`RunOptions.activeSkills`, `toolNames` enforcement).

## Inputs / request

### `AgentDefinition` (contract, `@arnilo/prism`)

| Field | Meaning |
| --- | --- |
| `name` | Required agent name. |
| `description?` | Optional description. |
| `model?` | `ModelConfig` object, or a `"<provider>/<model>"` string resolved through `registries.models`. |
| `tools?` | Tool names to activate from the active tool registry / `registries.tools`. |
| `skills?` | Skill names resolved via `resolveActiveSkills()`; `toolNames` enforcement applies at activation. |
| `context?` | Context provider names from `registries.contextProviders`. |
| `systemPrompt?` | `SystemPromptConfig` layer (see [System prompts](system-prompts.md)). |
| `instructions?` | Base prompt text. |
| `loop?` | `AgentLoopStrategy` or `AgentLoopOptions` (see [Agent loops](agent-loops.md)). |
| `metadata?` | Free-form metadata. |
| `create?(config?)` | Optional escape hatch. When present, overrides declarative resolution: the helper builds a base `AgentConfig` from the declarative fields, calls `create(config)`, then merges `context.overrides`. |

### `AgentDefinitionResolutionContext` (contract, `@arnilo/prism`)

All fields optional — the host controls scope by which registries it passes.

| Field | Meaning |
| --- | --- |
| `registries?` | `ContributionRegistries` carrying `models`, `providers`, `tools`, `contextProviders`, ... |
| `providerSource?` | `ProviderResolver` override. |
| `tools?` | `ToolRegistry` or `readonly ToolDefinition[]` scope override. |
| `skillsRegistry?` | `SkillRegistry` override. |
| `overrides?` | `Partial<AgentConfig>` applied last, after declarative resolution. |

### App-config bundle layout

`resolveAgentBundle` reads a three-scope layout rooted at an app-controlled `configRoot` (plus optional repo contributions from `discoverContributions`):

| Scope | Path | Default include flag |
| --- | --- | --- |
| App-global prompt | `<configRoot>/agents/SYSTEM.md` | `include.systemPrompt` (default `true`) |
| Per-agent definition + body prompt | `<configRoot>/agents/<agentName>/AGENT.md` | `include.agentPrompt` (default `true`) |
| Repo project prompt | `<workspaceRoot>/AGENTS.md` | `include.repoPrompt` (default `true`) |
| App-global skills | `<configRoot>/agents/skills/<name>/SKILL.md` | `include.globalSkills` (default `true`) |
| App-global tools | `<configRoot>/agents/tools/<name>/manifest.json` | `include.globalTools` (default `true`) |
| Per-agent skills | `<configRoot>/agents/<agentName>/skills/<name>/SKILL.md` | `include.agentSkills` (default `true`) |
| Per-agent tools | `<configRoot>/agents/<agentName>/tools/<name>/manifest.json` | `include.agentTools` (default `true`) |
| Repo skills | `<workspaceRoot>/.agents/skills/<name>/SKILL.md` | `include.repoSkills` (default `true`) |
| Repo tools | `<workspaceRoot>/.agents/tools/<name>/manifest.json` | `include.repoTools` (default `true`) |

`AGENT.md` frontmatter mirrors the declarative `AgentDefinition` fields above that fit YAML: `name`, `description`, `model` (a `"<provider>/<model>"` string), `tools` (list), `skills` (list), `context` (list), and `instructions` (frontmatter value or the markdown body as the per-agent prompt layer). `systemPrompt` and `loop` are intentionally deferred from frontmatter — they carry complex types not easily represented in YAML; pass them through `context.overrides` or a `create()` escape hatch.

### `AgentBundle` / `DiscoverAgentBundlesOptions` (`@arnilo/prism/node/agent-definitions`)

`discoverAgentBundles({ configRoot, trust?, permission?, signal? })` returns one `AgentBundle` per subdirectory of `<configRoot>/agents/` that contains an `AGENT.md`. Each `AgentBundle` carries paths only — `name`, `path` (the `AGENT.md`), `configRoot`, an optional `systemPromptPath`, and the collected `globalSkills`/`globalTools`/`agentSkills`/`agentTools` path lists. No file content is parsed here.

### `ResolveAgentBundleOptions` (`@arnilo/prism/node/agent-definitions`)

| Field | Meaning |
| --- | --- |
| `readFile?` | File reader. Defaults to `node:fs/promises.readFile`. |
| `workspaceRoot?` | Workspace root for the repo prompt and repo contributions. |
| `repoContributions?` | Repo-level contributions from `discoverContributions` (see [Contribution discovery](contribution-discovery.md)). |
| `registries?` | Host registries (`models`, `providers`, `contextProviders`, ...). |
| `providerSource?` / `tools?` / `skillsRegistry?` | Forwarded to `AgentDefinitionResolutionContext`. |
| `overrides?` | `Partial<AgentConfig>` applied after resolution. |
| `trust?` | `TrustPolicy` gating the app-config root and workspace root **independently**. |
| `permission?` | `PermissionPolicy` asserting each prompt-file read. |
| `include?` | `AgentBundleScopeFlags` — every source defaults to `true`; set a flag to `false` to drop that scope's contributions for this resolution. |

## Outputs / response / events

`resolveAgentDefinition()` and `resolveAgentBundle()` return an `Agent` (sync or `Promise<Agent>` when the `create()` escape hatch is async). The helpers never emit events; the returned `Agent`/session emits the normal `AgentEvent` stream when run.

Skill and tool contributions are merged as a **union** across the enabled scopes — there is no override on name collision. A duplicate skill or tool name across two enabled scopes throws `Duplicate skill/tool name across scopes: <name> (found in <scope> and <other>)` so the conflict is surfaced instead of silently masked. Disable a scope via its `include` flag to resolve a collision deliberately.

Prompt layers are appended (never replace) in this fixed order, reusing `composeSystemPrompt`'s `source` rank (`user` → `package` → `app` → `run`):

1. `<configRoot>/agents/SYSTEM.md` — app-global, `source: "user"`.
2. `<configRoot>/agents/<agentName>/AGENT.md` body — per-agent, `source: "package"`.
3. `<workspaceRoot>/AGENTS.md` — repo project prompt, `source: "app"`.

The app-config root and the workspace root are trust-gated independently: an untrusted root contributes nothing for that layer (fail-closed, silent skip) while the other layers still load. `RunOptions.systemPrompt` (`source: "run"`) is appended last at run time and still wins. Missing files are skipped silently.

## Request/response example

A discovered bundle at `<configRoot>/agents/coding/AGENT.md`:

```yaml
---
name: coding
model: openai/gpt-4o
tools: [read, echo]
skills: [format]
context: [repo]
instructions: You are a careful coding agent.
---
Prefer minimal diffs. Cite the file you changed.
```

`discoverAgentBundles({ configRoot })` returns (paths only):

```json
[
  {
    "name": "coding",
    "path": "/app/agents/coding/AGENT.md",
    "configRoot": "/app",
    "systemPromptPath": "/app/agents/SYSTEM.md",
    "globalSkills": ["/app/agents/skills/format/SKILL.md"],
    "globalTools": [],
    "agentSkills": [],
    "agentTools": []
  }
]
```

## Implementation example

```ts
import { type AgentBundle } from "@arnilo/prism/node/agent-definitions";
import { discoverAgentBundles, resolveAgentBundle } from "@arnilo/prism/node/agent-definitions";
import { discoverContributions } from "@arnilo/prism/node/contribution-discovery";
import { createPathTrustPolicy } from "@arnilo/prism/node/trust";
import { createContributionRegistries } from "@arnilo/prism";

// 1. App owns configRoot; never auto-discovered, never the user's home dir.
const configRoot = "/app/cfg";
const workspaceRoot = "/repo";
const trust = createPathTrustPolicy({ trustedRoots: [configRoot, workspaceRoot] });

// 2. Discover bundle envelopes (paths only — no parse, no import).
const [bundle] = await discoverAgentBundles({ configRoot, trust });
if (!bundle) throw new Error("no agent bundle found");

// 3. Repo .agents/ contributions are a separate scan (opt-in discovery).
const registries = createContributionRegistries();
const repoContributions = await discoverContributions({
  kinds: ["skill", "tool"],
  workspaceRoot,
  trust,
});

// 4. Resolve the bundle into an Agent. Skills/tools union across scopes;
//    duplicate names across scopes throw. Prompt layers append: SYSTEM.md →
//    AGENT.md body → AGENTS.md. Drop the repo AGENTS.md layer here via flags.
const agent = await resolveAgentBundle(bundle as AgentBundle, {
  workspaceRoot,
  repoContributions,
  registries,
  trust,
  include: { repoPrompt: false },
});

// 5. The host still owns activation.
await agent.createSession().run("Hi", { activeSkills: ["format"] });
```

For a hand-held `AgentDefinition` without a bundle, `resolveAgentDefinition` is the lighter path:

```ts
import { resolveAgentDefinition } from "@arnilo/prism";

const agent = resolveAgentDefinition(
  { name: "doc", model: "openai/gpt-4o", tools: ["echo"], instructions: "Be concise." },
  { registries, providerSource, tools: myToolRegistry, skillsRegistry },
);
```

## Extension and configuration notes

- `ExtensionAPI.registerAgent(agent)` contributes an inert `AgentDefinition` programmatically; its `create()` (if present) is only invoked when the host runs it through `resolveAgentDefinition`. See [Extensions](extensions.md).
- Bundle resolution is config over code: every seam lives on `AgentDefinition`, `AgentDefinitionResolutionContext`, or `ResolveAgentBundleOptions`. `systemPrompt` and `loop` are passed via `context.overrides` / `create()` rather than frontmatter.
- `parseAgentFile(text, path)` (re-exported from `@arnilo/prism`) is the stdlib-only frontmatter parser for `AGENT.md`. `parseContextFile` and `parseToolFile` parse colocated `CONTEXT.md` / tool descriptors inside the Node subpath.
- Repo contributions (`<workspaceRoot>/.agents/{skills,tools}/`) are scanned by `discoverContributions` and passed via `repoContributions`. Repo `.agents/` is preserved as a shared contribution surface across every agent that operates on the same repository; multiple agents from different apps can work the same repo, and all share its repo-level skills.

## Security and performance notes

- **App owns `configRoot`**: Prism never picks the config root, never defaults to the user's home directory, and never auto-runs discovery or resolution. The host calls `discoverAgentBundles` / `resolveAgentBundle` explicitly. `--agents-config <path>` on the `prism` CLI is the explicit opt-in.
- **All layers optional**: every prompt and contribution scope is independently togglable via `AgentBundleScopeFlags` (all default `true`); region can be enabled per agent or globally by the host.
- **Duplicate names error, not override**: skills/tools union across scopes throw on collision so a name shadow can never silently change behavior.
- **Independent trust gating**: `resolveAgentBundle` trust-gates the app-config root (`SYSTEM.md`) and the workspace root (`AGENTS.md`) independently via `createPathTrustPolicy` + `isPathInsideReal`; symlink escapes are excluded, untrusted roots contribute nothing (fail-closed). See [Security/auth/trust](settings-auth-trust-security.md).
- **No execution on discovery**: `discoverAgentBundles` returns paths only; `resolveAgentBundle` reads text only — it never `import()`s, `require()`s, or `eval()`s any contribution file. Tool descriptors parsed from `manifest.json` are descriptor-only `ToolDefinition` objects whose `execute()` throws `Discovered tool <name> requires host execution` if invoked. The host lifts them into live tools itself.
- **Secrets**: loaded prompt/skill text is caller- and host-supplied content subject to `redactProviderRequest` like any system instruction. Do not put secrets in `AGENT.md` / `SYSTEM.md` / `SKILL.md`, settings, manifests, or docs examples.
- **Performance**: `discoverAgentBundles` is one `readdir` per level; `resolveAgentBundle` reads each prompt file at most once per call. There is no cross-call cache — resolution is one-shot (memoize in the host if the same bundle is resolved repeatedly).

## Related APIs

- [Agent/session runtime](agent-session-runtime.md): `createAgent` / `createAgentSession`, the runtime `resolveAgentDefinition` builds onto.
- [System prompts](system-prompts.md): `composeSystemPrompt` source ranks and the `AGENT.md` body / `SYSTEM.md` / `AGENTS.md` prompt layering reused by `resolveAgentBundle`.
- [Contribution discovery (workspace)](contribution-discovery.md): `discoverContributions` for repo `.agents/` contributions passed as `repoContributions`.
- [Context and skills](context-and-skills.md): `resolveActiveSkills` and `RunOptions.activeSkills` activation that consumes discovered skills.
- [Tools](tools.md): `ToolDefinition` / `(toolNames)` enforcement and host-owned tool execution.
- [Agent loops](agent-loops.md): `resolveLoop` and loop strategies passed via `loop` / `context.overrides`.
- [Extensions](extensions.md): `registerAgent()` programmatic registration of inert `AgentDefinition` values.
- [CLI/RPC](cli-rpc.md): the `--agents-config <path>` flag.
- [Security/auth/trust](settings-auth-trust-security.md): `createPathTrustPolicy`, `assertPermission`, and the trust model.
